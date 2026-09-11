"""Typed Python view of ``collex.answer.evidence-bundle/v1``.

The producing contract lives in TypeScript
(``control-plane/src/answer/renderer.ts`` -> ``EvidenceBundle``); this module
is the consuming mirror. It is deliberately strict: a field that is missing,
of the wrong type, or carrying an unknown enum value raises
:class:`export.errors.BundleFormatError` instead of being silently defaulted,
because a silently defaulted citation field is exactly the kind of thing that
turns a verifiable document into a plausible-looking one.

OFFSET POLICY (project-wide, see ``control-plane/fixtures/offset_policy.json``
and ``control-plane/src/answer/evidencePack.ts``): ``locator.startChar`` /
``locator.endChar`` are **Unicode code point** indices into the NFC-normalized
canonical document text — not UTF-16 code units, not UTF-8 bytes. Python
``str`` indexing is code-point indexing, so slicing here agrees with the
database layer and with the TypeScript ``codePointSlice`` helper.

Additive optional fields this reader understands (all absent from the current
TypeScript producer; see docs/implementation/EXPORT.md "Üretici tarafında
gereken eklemeler"):

``texts``
    ``{documentVersionId: canonicalNfcText}``. When present, verification is
    upgraded from "the quote hashes to its recorded digest" to the full
    chain "the canonical text hashes to ``contentSha256`` AND the code-point
    span really yields this exact quote".
``synthetic`` / ``syntheticNotice`` (also accepted inside ``_meta``)
    Marks the bundle as built from the synthetic fixture corpus. Every
    human-visible surface of the export then says ``SENTETİK``.
``producer``
    Free-text identifier of the pipeline build that produced the bundle,
    reproduced verbatim in the document meta block.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from export.errors import BundleFormatError

#: The only bundle schema this package accepts.
BUNDLE_SCHEMA = "collex.answer.evidence-bundle/v1"

#: Answer-level status values (mirrors ``AnswerDocument["status"]``).
STATUSES = ("COMPLETE", "QUALIFIED", "PARTIAL", "ABSTAIN")

#: Per-claim verdicts (mirrors ``verification/finalize.ts`` ``Verdict``).
VERDICTS = (
    "SUPPORTED",
    "QUALIFIED",
    "CONFLICTING_AUTHORITIES",
    "INSUFFICIENT_EVIDENCE",
    "OUT_OF_DATE_SOURCE",
    "PARTIAL_SOURCE_COVERAGE",
)

#: ``ClaimDraft.treatment`` values.
TREATMENTS = ("supported", "qualified", "conflicted", "unsupported")

#: ``EvidenceStance`` values.
STANCES = ("supporting", "contrary", "neutral")

#: The five confidence dimensions, in the order they are always displayed.
#: Shared wording across every surface (console, Markdown, DOCX):
#: "Kaynak isabeti · Pasaj desteği · Otorite · Güncellik · Kapsam".
#: The English keys appear only in the Teknik künye sub-table.
# W15 · belge-ciktilari P1(71/72): "Kaynak isabeti" ve "Pasaj destegi"
# uydurulmus, belgede tanimi olmayan terimlerdi. Sutun adlari kendini anlatan
# hale getirildi; ayrica her sutunun tek cumlelik tanimi CONFIDENCE_LEGEND ile
# tablonun altina basiliyor (denetim raporundaki "Durum sozlugu" blogu gibi).
CONFIDENCE_DIMENSIONS = (
    ("retrieval", "Doğru kaynağa ulaşma"),
    ("entailment", "Alıntının sonucu karşılaması"),
    ("authority", "Kaynağın ağırlığı"),
    ("currentness", "Metnin güncelliği"),
    ("coverage", "Sorunun kapsanması"),
)

#: One sentence per column, printed under the table in every deliverable.
CONFIDENCE_LEGEND = (
    (
        "Doğru kaynağa ulaşma",
        "Sorunuza karşılık gelen belgenin bulunup bulunmadığı.",
    ),
    (
        "Alıntının sonucu karşılaması",
        "Getirilen alıntının, yazılan sonucu gerçekten söyleyip söylemediği.",
    ),
    (
        "Kaynağın ağırlığı",
        "Kaynağın kanun mu, yüksek mahkeme kararı mı, yoksa daha alt bir"
        " kaynak mı olduğu.",
    ),
    (
        "Metnin güncelliği",
        "Kullanılan metnin, dilekçe tarihinde yürürlükte olan metin olup"
        " olmadığı.",
    ),
    (
        "Sorunun kapsanması",
        "Sorunun ne kadarının kaynaklarla karşılandığı.",
    ),
)


def _fail(path: str, detail: str) -> BundleFormatError:
    return BundleFormatError(f"kanıt paketi alanı geçersiz: {path} — {detail}")


def _req(obj: Mapping[str, Any], key: str, path: str) -> Any:
    if key not in obj:
        raise _fail(f"{path}.{key}", "zorunlu alan yok")
    return obj[key]


def _str(obj: Mapping[str, Any], key: str, path: str, *, allow_empty: bool = True) -> str:
    value = _req(obj, key, path)
    if not isinstance(value, str):
        raise _fail(f"{path}.{key}", f"metin bekleniyordu, {type(value).__name__} geldi")
    if not allow_empty and value == "":
        raise _fail(f"{path}.{key}", "boş olamaz")
    return value


def _opt_str(obj: Mapping[str, Any], key: str, path: str) -> str | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _fail(f"{path}.{key}", f"metin bekleniyordu, {type(value).__name__} geldi")
    return value or None


def _bool(obj: Mapping[str, Any], key: str, path: str, *, default: bool | None = None) -> bool:
    if key not in obj and default is not None:
        return default
    value = _req(obj, key, path)
    if not isinstance(value, bool):
        raise _fail(f"{path}.{key}", f"boolean bekleniyordu, {type(value).__name__} geldi")
    return value


def _int(obj: Mapping[str, Any], key: str, path: str) -> int:
    value = _req(obj, key, path)
    # bool is a subclass of int; reject it explicitly.
    if isinstance(value, bool) or not isinstance(value, int):
        raise _fail(f"{path}.{key}", f"tamsayı bekleniyordu, {type(value).__name__} geldi")
    return value


def _opt_int(obj: Mapping[str, Any], key: str, path: str) -> int | None:
    if obj.get(key) is None:
        return None
    return _int(obj, key, path)


def _unit(obj: Mapping[str, Any], key: str, path: str) -> float:
    value = _req(obj, key, path)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _fail(f"{path}.{key}", f"sayı bekleniyordu, {type(value).__name__} geldi")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise _fail(f"{path}.{key}", f"[0,1] aralığında olmalı, {number} geldi")
    return number


def _str_tuple(obj: Mapping[str, Any], key: str, path: str) -> tuple[str, ...]:
    value = obj.get(key, [])
    if not isinstance(value, list):
        raise _fail(f"{path}.{key}", f"liste bekleniyordu, {type(value).__name__} geldi")
    out: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise _fail(f"{path}.{key}[{i}]", "metin bekleniyordu")
        out.append(item)
    return tuple(out)


def _enum(value: str, allowed: tuple[str, ...], path: str) -> str:
    if value not in allowed:
        raise _fail(path, f"bilinmeyen değer {value!r}; izinli: {', '.join(allowed)}")
    return value


@dataclass(frozen=True)
class Locator:
    """Position of the quote inside the canonical document version text."""

    #: Unicode code point offset, inclusive.
    start_char: int
    #: Unicode code point offset, exclusive.
    end_char: int
    article: str | None = None
    paragraph: str | None = None
    page: int | None = None

    @property
    def span(self) -> int:
        return self.end_char - self.start_char


@dataclass(frozen=True)
class EvidenceEntry:
    """One citable source: identity, provenance, exact quote, hashes."""

    evidence_id: str
    document_id: str
    document_version_id: str
    chunk_id: str
    source: str
    source_url: str
    title: str
    locator: Locator
    quote: str
    quote_sha256: str
    content_sha256: str
    retrieved_at: str
    court: str | None = None
    decision_date: str | None = None
    docket_no: str | None = None
    decision_no: str | None = None
    legislation_no: str | None = None
    authority_label: str | None = None
    authority_tier: int | None = None
    currentness_status: str | None = None
    stance: str = "neutral"
    retrieval_score: float | None = None
    synthetic: bool = False


@dataclass(frozen=True)
class Confidence:
    """The five confidence dimensions of a claim, each in [0,1]."""

    retrieval: float
    entailment: float
    authority: float
    currentness: float
    coverage: float

    def as_dict(self) -> dict[str, float]:
        return {
            "retrieval": self.retrieval,
            "entailment": self.entailment,
            "authority": self.authority,
            "currentness": self.currentness,
            "coverage": self.coverage,
        }


@dataclass(frozen=True)
class ClaimEntry:
    """One legal proposition plus its verdict and its cited evidence."""

    claim_id: str
    text: str
    material: bool
    treatment: str
    verdict: str
    confidence: Confidence
    evidence_ids: tuple[str, ...] = ()
    contrary_evidence_ids: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()

    @property
    def is_abstained(self) -> bool:
        """True when this claim carries no usable support of its own."""
        return self.verdict == "INSUFFICIENT_EVIDENCE" or self.treatment == "unsupported"


@dataclass(frozen=True)
class EvidenceBundle:
    """A parsed ``collex.answer.evidence-bundle/v1`` document."""

    schema: str
    question: str
    as_of: str
    status: str
    finalizable: bool
    verified_at: str
    reasons: tuple[str, ...]
    claims: tuple[ClaimEntry, ...]
    evidence: tuple[EvidenceEntry, ...]
    #: Optional canonical NFC texts keyed by documentVersionId.
    texts: Mapping[str, str] = None  # type: ignore[assignment]
    synthetic: bool = False
    synthetic_notice: str | None = None
    producer: str | None = None

    def __post_init__(self) -> None:
        if self.texts is None:
            object.__setattr__(self, "texts", {})

    @property
    def is_abstention(self) -> bool:
        return self.status == "ABSTAIN"

    def evidence_by_id(self) -> dict[str, EvidenceEntry]:
        return {item.evidence_id: item for item in self.evidence}


def _parse_locator(raw: Any, path: str) -> Locator:
    if not isinstance(raw, dict):
        raise _fail(path, "nesne bekleniyordu")
    return Locator(
        start_char=_int(raw, "startChar", path),
        end_char=_int(raw, "endChar", path),
        article=_opt_str(raw, "article", path),
        paragraph=_opt_str(raw, "paragraph", path),
        page=_opt_int(raw, "page", path),
    )


def _parse_evidence(raw: Any, index: int) -> EvidenceEntry:
    path = f"evidence[{index}]"
    if not isinstance(raw, dict):
        raise _fail(path, "nesne bekleniyordu")
    authority = raw.get("authority")
    authority_label: str | None = None
    authority_tier: int | None = None
    if isinstance(authority, dict):
        authority_label = _opt_str(authority, "label", f"{path}.authority")
        authority_tier = _opt_int(authority, "tier", f"{path}.authority")
    currentness = raw.get("currentness")
    currentness_status: str | None = None
    if isinstance(currentness, dict):
        currentness_status = _opt_str(currentness, "status", f"{path}.currentness")
    score = raw.get("retrievalScore")
    retrieval_score = None if score is None else _unit(raw, "retrievalScore", path)
    stance = raw.get("stance", "neutral")
    if not isinstance(stance, str):
        raise _fail(f"{path}.stance", "metin bekleniyordu")
    return EvidenceEntry(
        evidence_id=_str(raw, "evidenceId", path, allow_empty=False),
        document_id=_str(raw, "documentId", path, allow_empty=False),
        document_version_id=_str(raw, "documentVersionId", path, allow_empty=False),
        chunk_id=_str(raw, "chunkId", path),
        source=_str(raw, "source", path),
        source_url=_str(raw, "sourceUrl", path),
        title=_str(raw, "title", path),
        locator=_parse_locator(_req(raw, "locator", path), f"{path}.locator"),
        quote=_str(raw, "quote", path),
        quote_sha256=_str(raw, "quoteSha256", path),
        content_sha256=_str(raw, "contentSha256", path),
        retrieved_at=_str(raw, "retrievedAt", path),
        court=_opt_str(raw, "court", path),
        decision_date=_opt_str(raw, "decisionDate", path),
        docket_no=_opt_str(raw, "docketNo", path),
        decision_no=_opt_str(raw, "decisionNo", path),
        legislation_no=_opt_str(raw, "legislationNo", path),
        authority_label=authority_label,
        authority_tier=authority_tier,
        currentness_status=currentness_status,
        stance=_enum(stance, STANCES, f"{path}.stance"),
        retrieval_score=retrieval_score,
        synthetic=bool(raw.get("synthetic", False)),
    )


def _parse_claim(raw: Any, index: int) -> ClaimEntry:
    path = f"claims[{index}]"
    if not isinstance(raw, dict):
        raise _fail(path, "nesne bekleniyordu")
    conf_raw = _req(raw, "confidence", path)
    if not isinstance(conf_raw, dict):
        raise _fail(f"{path}.confidence", "nesne bekleniyordu")
    conf_path = f"{path}.confidence"
    confidence = Confidence(
        retrieval=_unit(conf_raw, "retrieval", conf_path),
        entailment=_unit(conf_raw, "entailment", conf_path),
        authority=_unit(conf_raw, "authority", conf_path),
        currentness=_unit(conf_raw, "currentness", conf_path),
        coverage=_unit(conf_raw, "coverage", conf_path),
    )
    return ClaimEntry(
        claim_id=_str(raw, "claimId", path, allow_empty=False),
        text=_str(raw, "text", path),
        material=_bool(raw, "material", path, default=True),
        treatment=_enum(_str(raw, "treatment", path), TREATMENTS, f"{path}.treatment"),
        verdict=_enum(_str(raw, "verdict", path), VERDICTS, f"{path}.verdict"),
        confidence=confidence,
        evidence_ids=_str_tuple(raw, "evidenceIds", path),
        contrary_evidence_ids=_str_tuple(raw, "contraryEvidenceIds", path),
        reasons=_str_tuple(raw, "reasons", path),
    )


def _parse_texts(raw: Any) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _fail("texts", "nesne bekleniyordu")
    out: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise _fail(f"texts[{key!r}]", "anahtar ve değer metin olmalı")
        out[key] = value
    return out


def parse_bundle(payload: Any) -> EvidenceBundle:
    """Validate and convert a decoded JSON bundle.

    Raises :class:`export.errors.BundleFormatError` on anything unexpected.
    """
    if not isinstance(payload, dict):
        raise BundleFormatError(
            "kanıt paketi bir JSON nesnesi olmalı,"
            f" {type(payload).__name__} geldi"
        )
    schema = _str(payload, "schema", "bundle")
    if schema != BUNDLE_SCHEMA:
        raise BundleFormatError(
            f"desteklenmeyen şema {schema!r}; beklenen {BUNDLE_SCHEMA!r}"
        )

    meta = payload.get("_meta")
    meta = meta if isinstance(meta, dict) else {}
    synthetic = bool(payload.get("synthetic", meta.get("synthetic", False)))
    notice = payload.get("syntheticNotice", meta.get("notice"))
    if notice is not None and not isinstance(notice, str):
        raise _fail("syntheticNotice", "metin bekleniyordu")

    claims_raw = payload.get("claims", [])
    if not isinstance(claims_raw, list):
        raise _fail("claims", "liste bekleniyordu")
    evidence_raw = payload.get("evidence", [])
    if not isinstance(evidence_raw, list):
        raise _fail("evidence", "liste bekleniyordu")

    evidence = tuple(_parse_evidence(item, i) for i, item in enumerate(evidence_raw))
    claims = tuple(_parse_claim(item, i) for i, item in enumerate(claims_raw))

    bundle = EvidenceBundle(
        schema=schema,
        question=_str(payload, "question", "bundle"),
        as_of=_str(payload, "asOf", "bundle"),
        status=_enum(_str(payload, "status", "bundle"), STATUSES, "bundle.status"),
        finalizable=_bool(payload, "finalizable", "bundle", default=False),
        verified_at=_str(payload, "verifiedAt", "bundle"),
        reasons=_str_tuple(payload, "reasons", "bundle"),
        claims=claims,
        evidence=evidence,
        texts=_parse_texts(payload.get("texts")),
        synthetic=synthetic,
        synthetic_notice=notice,
        producer=_opt_str(payload, "producer", "bundle"),
    )
    return bundle


def load_bundle(path: str | Path) -> EvidenceBundle:
    """Read and validate a bundle JSON file (UTF-8)."""
    file_path = Path(path)
    try:
        raw = file_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise BundleFormatError(f"kanıt paketi okunamadı: {file_path} ({exc})") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BundleFormatError(
            f"kanıt paketi geçerli JSON değil: {file_path} ({exc})"
        ) from exc
    return parse_bundle(payload)

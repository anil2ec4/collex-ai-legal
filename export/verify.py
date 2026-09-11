"""Pre-write integrity verification: the reason this export is worth trusting.

Nothing is written to disk until every citation in the bundle re-verifies
against the bundle's own hashes. The checks, in the order a sceptical reader
would run them by hand:

Per evidence entry
    ``QUOTE_EMPTY``              the quote is empty or whitespace only
    ``QUOTE_CONTROL_CHARS``      the quote carries characters that cannot be
                                 represented in an OOXML text node (a quote
                                 that would be silently mangled by Word is
                                 not a quote)
    ``HASH_MALFORMED``           ``quoteSha256``/``contentSha256`` is not
                                 64 lowercase hex digits
    ``QUOTE_HASH_MISMATCH``      ``sha256(quote.encode("utf-8"))`` differs
                                 from ``quoteSha256`` — the tamper detector
    ``LOCATOR_INVALID``          negative or non-increasing offsets
    ``LOCATOR_SPAN_MISMATCH``    ``endChar - startChar`` is not the quote's
                                 length in Unicode code points
    ``DUPLICATE_EVIDENCE_ID``    two entries claim the same evidence id
    ``CONTENT_HASH_MISMATCH``    (only when the bundle ships ``texts``) the
                                 canonical text does not hash to
                                 ``contentSha256``
    ``OFFSET_TEXT_MISMATCH``     (only when the bundle ships ``texts``) the
                                 code-point span does not yield this quote

Per claim
    ``UNKNOWN_EVIDENCE_ID``      a claim cites an evidence id the bundle does
                                 not contain — an invented citation
    ``DUPLICATE_CLAIM_ID``       two claims share a claim id

Bundle level
    ``ABSTAIN_WITH_CITATIONS``   informational warning: an ABSTAIN bundle
                                 still carries claim citations. The export
                                 does not silently drop them — the ÇEKİMSER
                                 section states the count explicitly.

Findings are HARD failures (export refused) unless listed in
:data:`WARNING_CODES`. Warnings are surfaced in the document itself, never
swallowed.

Note on hashing: ``quoteSha256`` is defined over the UTF-8 bytes of the quote
exactly as stored, so this module never normalizes before hashing. A quote
that is not already NFC is reported as the ``NON_NFC_QUOTE`` warning, because
the canonical text is NFC and a non-NFC slice usually means a boundary was
cut through a combining sequence.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Sequence

from export.bundle import EvidenceBundle, EvidenceEntry
from export.errors import ExportRefused

_HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")

# Characters that cannot survive a round trip through an OOXML text node.
# Tab (\x09) and LF (\x0a) are fine — python-docx maps them to <w:tab/> and
# <w:br/> and back. Carriage return is NOT: XML 1.0 line-ending normalization
# rewrites it on read, so a quote containing \r would come back different from
# the bytes that produced `quoteSha256`.
_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

#: Finding codes that do NOT block an export.
WARNING_CODES = frozenset({"NON_NFC_QUOTE", "ABSTAIN_WITH_CITATIONS", "UNCITED_EVIDENCE"})


def sha256_utf8(text: str) -> str:
    """SHA-256 hex over the UTF-8 bytes of ``text`` (project-wide convention)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class IntegrityFinding:
    """One verification result: a code, where it happened, and what it means."""

    code: str
    subject: str
    detail: str

    @property
    def is_warning(self) -> bool:
        return self.code in WARNING_CODES

    def __str__(self) -> str:
        # No square brackets here: findings are rendered into documents whose
        # citation markers ARE square brackets, and a finding must never be
        # able to look like a citation.
        level = "UYARI" if self.is_warning else "HATA"
        return f"{level} {self.code} ({self.subject}): {self.detail}"


@dataclass(frozen=True)
class VerificationReport:
    """Outcome of :func:`verify_bundle`."""

    findings: tuple[IntegrityFinding, ...]
    #: Evidence entries whose quote was checked against a canonical text.
    text_verified_ids: tuple[str, ...]
    #: Evidence entries checked against hashes only (no canonical text shipped).
    hash_only_ids: tuple[str, ...]

    @property
    def failures(self) -> tuple[IntegrityFinding, ...]:
        return tuple(f for f in self.findings if not f.is_warning)

    @property
    def warnings(self) -> tuple[IntegrityFinding, ...]:
        return tuple(f for f in self.findings if f.is_warning)

    @property
    def ok(self) -> bool:
        return not self.failures

    def summary(self) -> str:
        """One-line Turkish summary suitable for the document meta block."""
        checked = len(self.text_verified_ids) + len(self.hash_only_ids)
        if not self.ok:
            return f"BAŞARISIZ — {len(self.failures)} bütünlük hatası"
        # W15 · belge-ciktilari P0(128/132): bu satir avukatin ILK gordugu
        # kunye tablosunda duruyor. "Kanonik metin", "offset" ve "SHA-256"
        # oradan kalkti; ayrim (kaynagin kendi metniyle mi, kayitli metinle mi)
        # aynen korunuyor — yalniz yontemin ADI dusuyor.
        parts = [f"{checked} alıntının tamamı doğrulandı"]
        if self.text_verified_ids:
            parts.append(
                f"{len(self.text_verified_ids)} tanesi kaynağın kendi metniyle"
                " karşılaştırılarak"
            )
        if self.hash_only_ids:
            parts.append(
                f"{len(self.hash_only_ids)} tanesi kaydedilmiş metinle"
                " karşılaştırılarak"
            )
        summary = "; ".join(parts)
        if self.warnings:
            summary += f" ({len(self.warnings)} uyarı)"
        return summary


def _check_hashes(entry: EvidenceEntry, out: list[IntegrityFinding]) -> None:
    subject = entry.evidence_id
    for label, digest in (("quoteSha256", entry.quote_sha256), ("contentSha256", entry.content_sha256)):
        if not _HEX64.match(digest):
            out.append(
                IntegrityFinding(
                    "HASH_MALFORMED",
                    subject,
                    f"{label} 64 haneli küçük harf hex değil: {digest!r}",
                )
            )
    if _HEX64.match(entry.quote_sha256):
        actual = sha256_utf8(entry.quote)
        if actual != entry.quote_sha256:
            out.append(
                IntegrityFinding(
                    "QUOTE_HASH_MISMATCH",
                    subject,
                    "alıntının SHA-256 özeti kayıtlı değerle uyuşmuyor"
                    f" (hesaplanan {actual}, kayıtlı {entry.quote_sha256});"
                    " alıntı bu belgeden alınmamış ya da sonradan değiştirilmiş",
                )
            )


def _check_quote_shape(entry: EvidenceEntry, out: list[IntegrityFinding]) -> None:
    subject = entry.evidence_id
    if entry.quote.strip() == "":
        out.append(IntegrityFinding("QUOTE_EMPTY", subject, "alıntı boş"))
    illegal = _ILLEGAL_XML.search(entry.quote)
    if illegal is not None:
        out.append(
            IntegrityFinding(
                "QUOTE_CONTROL_CHARS",
                subject,
                "alıntı, belge formatında birebir taşınamayan kontrol karakteri"
                f" içeriyor (U+{ord(illegal.group()):04X})",
            )
        )
    if entry.quote and unicodedata.normalize("NFC", entry.quote) != entry.quote:
        out.append(
            IntegrityFinding(
                "NON_NFC_QUOTE",
                subject,
                "alıntı NFC normal formunda değil; kanonik metin NFC olduğuna göre"
                " offset sınırı bir birleşik karakter dizisini bölmüş olabilir",
            )
        )


def _check_locator(entry: EvidenceEntry, out: list[IntegrityFinding]) -> None:
    subject = entry.evidence_id
    loc = entry.locator
    if loc.start_char < 0 or loc.end_char < 0:
        out.append(
            IntegrityFinding(
                "LOCATOR_INVALID", subject, f"negatif offset {loc.start_char}-{loc.end_char}"
            )
        )
        return
    if loc.end_char <= loc.start_char:
        out.append(
            IntegrityFinding(
                "LOCATOR_INVALID",
                subject,
                f"bitiş offseti başlangıçtan büyük değil ({loc.start_char}-{loc.end_char})",
            )
        )
        return
    # Python str length IS the code point count — the project-wide offset unit.
    if loc.span != len(entry.quote):
        out.append(
            IntegrityFinding(
                "LOCATOR_SPAN_MISMATCH",
                subject,
                f"offset aralığı {loc.span} kod noktası, alıntı"
                f" {len(entry.quote)} kod noktası",
            )
        )


def _check_against_text(
    entry: EvidenceEntry, text: str, out: list[IntegrityFinding]
) -> None:
    subject = entry.evidence_id
    actual_content = sha256_utf8(text)
    if actual_content != entry.content_sha256:
        out.append(
            IntegrityFinding(
                "CONTENT_HASH_MISMATCH",
                subject,
                f"kanonik metnin SHA-256 özeti ({actual_content}) kayıtlı"
                f" contentSha256 ({entry.content_sha256}) ile uyuşmuyor",
            )
        )
    loc = entry.locator
    if loc.start_char < 0 or loc.end_char > len(text) or loc.end_char <= loc.start_char:
        out.append(
            IntegrityFinding(
                "OFFSET_TEXT_MISMATCH",
                subject,
                f"offset aralığı {loc.start_char}-{loc.end_char} kanonik metnin"
                f" {len(text)} kod noktalık sınırları dışında",
            )
        )
        return
    sliced = text[loc.start_char : loc.end_char]
    if sliced != entry.quote:
        out.append(
            IntegrityFinding(
                "OFFSET_TEXT_MISMATCH",
                subject,
                "kanonik metnin belirtilen kod noktası aralığı bu alıntıyı vermiyor",
            )
        )


def verify_bundle(bundle: EvidenceBundle) -> VerificationReport:
    """Re-check every citation in ``bundle`` against the bundle's own claims.

    Pure and offline: no network, no database, no filesystem. The only inputs
    are the bundle's quotes, hashes, offsets and (optionally) its canonical
    texts.
    """
    findings: list[IntegrityFinding] = []
    text_verified: list[str] = []
    hash_only: list[str] = []

    seen_evidence: set[str] = set()
    for entry in bundle.evidence:
        if entry.evidence_id in seen_evidence:
            findings.append(
                IntegrityFinding(
                    "DUPLICATE_EVIDENCE_ID",
                    entry.evidence_id,
                    "aynı evidenceId birden çok kez tanımlanmış",
                )
            )
        seen_evidence.add(entry.evidence_id)

        _check_quote_shape(entry, findings)
        _check_hashes(entry, findings)
        _check_locator(entry, findings)

        text = bundle.texts.get(entry.document_version_id)
        if text is None:
            hash_only.append(entry.evidence_id)
        else:
            _check_against_text(entry, text, findings)
            text_verified.append(entry.evidence_id)

    seen_claims: set[str] = set()
    for claim in bundle.claims:
        if claim.claim_id in seen_claims:
            findings.append(
                IntegrityFinding(
                    "DUPLICATE_CLAIM_ID",
                    claim.claim_id,
                    "aynı claimId birden çok kez tanımlanmış",
                )
            )
        seen_claims.add(claim.claim_id)
        for evidence_id in (*claim.evidence_ids, *claim.contrary_evidence_ids):
            if evidence_id not in seen_evidence:
                findings.append(
                    IntegrityFinding(
                        "UNKNOWN_EVIDENCE_ID",
                        claim.claim_id,
                        f"tespit, kanıt paketinde bulunmayan {evidence_id!r}"
                        " kaynağına atıf yapıyor (uydurulmuş atıf)",
                    )
                )

    cited = {
        evidence_id
        for claim in bundle.claims
        for evidence_id in (*claim.evidence_ids, *claim.contrary_evidence_ids)
    }
    if bundle.is_abstention and cited:
        findings.append(
            IntegrityFinding(
                "ABSTAIN_WITH_CITATIONS",
                "bundle",
                f"çekimser (ABSTAIN) pakette {len(cited)} kaynağa atıf yapılmış;"
                " çekimser cevapta atıf yayımlanmaz, sayı ÇEKİMSER bölümünde"
                " açıkça bildirilir",
            )
        )
    uncited = seen_evidence - cited
    if uncited and not bundle.is_abstention:
        findings.append(
            IntegrityFinding(
                "UNCITED_EVIDENCE",
                "bundle",
                f"{len(uncited)} kaynak değerlendirilmiş ancak hiçbir tespitte"
                " atıf yapılmamış; KAYNAKLAR bölümü yalnız atıf yapılanları içerir",
            )
        )

    return VerificationReport(
        findings=tuple(findings),
        text_verified_ids=tuple(text_verified),
        hash_only_ids=tuple(hash_only),
    )


def verify_bundle_or_refuse(bundle: EvidenceBundle) -> VerificationReport:
    """:func:`verify_bundle`, raising :class:`ExportRefused` on any failure."""
    report = verify_bundle(bundle)
    if not report.ok:
        raise ExportRefused(
            f"{len(report.failures)} alıntı/atıf doğrulanamadı"
            f" ({len(bundle.evidence)} kaynak kontrol edildi)",
            report.failures,
        )
    return report


def format_findings(findings: Iterable[IntegrityFinding]) -> str:
    """Human-readable multi-line rendering of findings."""
    items: Sequence[IntegrityFinding] = tuple(findings)
    if not items:
        return "(bulgu yok)"
    return "\n".join(f"  - {item}" for item in items)

"""Citation numbering plan — the contract both exporters render against.

The plan is computed once, from the bundle alone, and then BOTH the answer
body and the KAYNAKLAR appendix are rendered from it. That is what makes
"never invent, never drop a citation" checkable rather than aspirational:

* a number exists only because a claim referenced an evidence id that
  resolves inside the bundle (no invention);
* the appendix is exactly the set of numbered entries (no dropping);
* after writing, the produced document is parsed back and its two sets are
  compared against each other — :func:`assert_citation_closure`.

Numbering order mirrors ``numberEvidence`` in
``control-plane/src/answer/renderer.ts``: walk the claims in order, take the
supporting evidence ids first, then the contrary ones, assigning the next
free number on first sight.

ABSTAIN bundles get an EMPTY plan on purpose. An honest abstention publishes
no numbered authority; the count of considered-but-unpublished sources is
stated in the ÇEKİMSER section instead of being quietly dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

from export import text as T
from export.bundle import ClaimEntry, EvidenceBundle, EvidenceEntry
from export.errors import ExportRefused


@dataclass(frozen=True)
class CitationPlan:
    """Stable evidence -> citation-number assignment for one export."""

    bundle: EvidenceBundle
    numbers: Mapping[str, int]
    #: Appendix entries in citation order: ``(number, evidence)``.
    entries: tuple[tuple[int, EvidenceEntry], ...]
    #: Evidence present in the bundle that no claim cited.
    uncited: tuple[EvidenceEntry, ...]

    @property
    def numbered_ids(self) -> frozenset[int]:
        return frozenset(self.numbers.values())

    def number_for(self, evidence_id: str) -> int:
        try:
            return self.numbers[evidence_id]
        except KeyError as exc:  # pragma: no cover - guarded upstream
            raise ExportRefused(
                f"atıf numarası olmayan kaynak referansı: {evidence_id!r}"
            ) from exc

    def markers(self, evidence_ids: Iterable[str]) -> str:
        """``"[1][2]"`` for a sequence of evidence ids (empty string if none)."""
        return "".join(f"[{self.number_for(eid)}]" for eid in evidence_ids)

    def supporting_markers(self, claim: ClaimEntry) -> str:
        return self.markers(claim.evidence_ids)

    def contrary_markers(self, claim: ClaimEntry) -> str:
        return self.markers(claim.contrary_evidence_ids)


def build_citation_plan(bundle: EvidenceBundle) -> CitationPlan:
    """Assign citation numbers, refusing anything that cannot be resolved."""
    by_id = bundle.evidence_by_id()
    numbers: dict[str, int] = {}

    if not bundle.is_abstention:
        for claim in bundle.claims:
            for evidence_id in (*claim.evidence_ids, *claim.contrary_evidence_ids):
                if evidence_id not in by_id:
                    raise ExportRefused(
                        f"tespit {claim.claim_id!r}, kanıt paketinde bulunmayan"
                        f" {evidence_id!r} kaynağına atıf yapıyor"
                    )
                if evidence_id not in numbers:
                    numbers[evidence_id] = len(numbers) + 1

    entries = tuple(
        (numbers[evidence_id], by_id[evidence_id])
        for evidence_id in sorted(numbers, key=lambda eid: numbers[eid])
    )
    uncited = tuple(item for item in bundle.evidence if item.evidence_id not in numbers)
    return CitationPlan(bundle=bundle, numbers=numbers, entries=entries, uncited=uncited)


def assert_citation_closure(
    body_numbers: Iterable[int],
    appendix_numbers: Iterable[int],
    *,
    expected: Iterable[int] | None = None,
    where: str = "belge",
) -> None:
    """Fail unless body markers, appendix entries (and the plan) agree.

    Called on the RE-PARSED output document, not on the in-memory plan, so it
    catches rendering bugs — a marker written but no appendix entry emitted
    (a dangling citation), or an appendix entry nothing points at (an orphan).
    """
    body = frozenset(body_numbers)
    appendix = frozenset(appendix_numbers)
    problems: list[str] = []

    dangling = sorted(body - appendix)
    if dangling:
        problems.append(
            "gövdede atıf numarası var, KAYNAKLAR girişi yok: "
            + ", ".join(f"[{n}]" for n in dangling)
        )
    orphan = sorted(appendix - body)
    if orphan:
        problems.append(
            "KAYNAKLAR girişi var, gövdede atıf yok: "
            + ", ".join(f"[{n}]" for n in orphan)
        )
    if expected is not None:
        want = frozenset(expected)
        missing = sorted(want - appendix)
        if missing:
            problems.append(
                "planlanan atıf yazılmamış (düşürülmüş atıf): "
                + ", ".join(f"[{n}]" for n in missing)
            )
        extra = sorted(appendix - want)
        if extra:
            problems.append(
                "planda olmayan atıf yazılmış (uydurulmuş atıf): "
                + ", ".join(f"[{n}]" for n in extra)
            )

    if problems:
        raise ExportRefused(
            f"{where}: atıf bütünlüğü doğrulanamadı",
            [f"ATIF_BUTUNLUGU: {p}" for p in problems],
        )


def meta_rows(
    bundle: EvidenceBundle,
    plan: CitationPlan,
    *,
    generated_at: str,
    integrity_summary: str,
) -> Sequence[tuple[str, str]]:
    """Label/value pairs for the human meta block (künye).

    Terim sözlüğü (her yüzeyde aynen): durum insan diliyle (ham enum yalnız
    Teknik künyede), 'Kullanıma hazır mı?' (asla 'finalize'), kullanıcıya
    dönük tarihler GG.AA.YYYY. Ham ISO satırları :func:`tech_rows`
    tablosuna taşınmıştır.
    """
    rows: list[tuple[str, str]] = [
        ("Soru", bundle.question),
        ("Yürürlük hangi tarihe göre değerlendirildi", T.human_date(bundle.as_of)),
        ("Cevap durumu", T.STATUS_TR.get(bundle.status, bundle.status)),
        ("Belge üretim zamanı", T.human_timestamp(generated_at)),
        (
            "Kullanıma hazır mı?",
            T.FINALIZE_OK if bundle.finalizable else T.FINALIZE_BLOCKED,
        ),
        ("Sonuç sayısı", str(len(bundle.claims))),
        ("Pakette kaynak sayısı", str(len(bundle.evidence))),
        ("Atıf yapılan kaynak sayısı", str(len(plan.entries))),
        ("Atıf yapılmayan kaynak sayısı", str(len(plan.uncited))),
        ("Bütünlük doğrulaması", integrity_summary),
    ]
    if bundle.synthetic:
        rows.insert(
            0,
            (
                "Veri niteliği",
                "DENEME VERİSİ — gerçek hukukî kaynak değildir",
            ),
        )
    return rows


def tech_rows(
    bundle: EvidenceBundle,
    *,
    generated_at: str,
    system_version: str,
) -> Sequence[tuple[str, str]]:
    """The 'Teknik künye' sub-table: raw enums, ISO stamps, pipeline identity.

    Everything a machine (or a sceptical reader re-running the verification
    recipe) needs, kept out of the human künye so the lawyer-facing rows stay
    in Turkish and GG.AA.YYYY.
    """
    rows: list[tuple[str, str]] = [
        ("Durum kodu", bundle.status),
        ("Aynı tarih, makine biçiminde", bundle.as_of),
        ("Kaynak denetiminin yapıldığı zaman", bundle.verified_at),
        ("Belge üretim zamanı (ISO)", generated_at),
        ("Sistem sürümü", system_version),
    ]
    if bundle.producer:
        rows.append(("Üreten program", bundle.producer))
    return rows

"""Amendment -> target legislation resolver (brief section 6.8).

The resolver takes the text of an amendment provision (possibly an omnibus /
"torba" law amending many laws), extracts the TARGET legislation references,
and resolves each one against a search backend injected through the
``SearchPort`` protocol. It never searches on the amending law's own id — the
known real-world failure mode this module exists to prevent — and it NEVER
silently picks a candidate when the match is ambiguous:

    parse amendment text
    -> extract target law no/name/article references (multiple for torba)
    -> exact legislation lookup through SearchPort
    -> disambiguate candidates with metadata (number/name/type/date)
    -> decision: resolved | ambiguous | not_found | abstain

Confidence is a weighted combination of four transparent components
(``number_match``, ``name_similarity``, ``type_match``, ``date_plausibility``),
each 0..1. Components that carry no information for a given reference (e.g.
no ``as_of`` date, or a generic name like "Kanunun") are excluded and the
weights are renormalized over the informative ones, so a bare-number
reference can still resolve on an exact, unique number match.

``as_of`` semantics (Phase 1): the date is accepted, passed through to the
``SearchPort``, stored on the result, and used for the ``date_plausibility``
component against the candidate law's effective period. Selecting the correct
*document version* for that date is interface-level only for now — actual
version data (document_versions / effective_period rows) arrives in Phase 2
of the ingestion pipeline; nothing here needs to change for that, the same
``as_of`` value will drive version selection downstream.

Repealed ("mülga") targets stay resolvable: a historical amendment must still
resolve to the historical law; the result flags it via ``is_mulga`` plus a
note instead of dropping it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import date
from difflib import SequenceMatcher
from typing import Optional, Protocol, Sequence

from .abbreviations import lookup_abbreviation, lookup_by_number
from .normalize import normalize_turkish_search
from .parser import ParsedReference, parse_references

__all__ = [
    "AmendmentTargetResolver",
    "CandidateLaw",
    "ConfidenceComponents",
    "ResolverResult",
    "ScoredCandidate",
    "SearchPort",
    "TargetResolution",
]

# Decision thresholds. A single candidate above RESOLVE_THRESHOLD whose lead
# over the runner-up is at least RESOLVE_MARGIN resolves; anything else is
# ambiguous / abstain — never a silent model guess.
RESOLVE_THRESHOLD = 0.85
RESOLVE_MARGIN = 0.05

_WEIGHTS = {
    "number_match": 0.5,
    "name_similarity": 0.3,
    "type_match": 0.1,
    "date_plausibility": 0.1,
}
_NEUTRAL = 0.5
_DATE_OUT_OF_RANGE = 0.2

# Names that carry no identifying information ("Kanunun", "bu Kanun", "KHK").
_GENERIC_NAME_RE = re.compile(
    r"^(?:bu\s+|aynı\s+|anılan\s+|mezkur\s+|mezkûr\s+|söz\s+konusu\s+)?"
    r"(?:kanun\w*|khk|kanun hükmünde kararname\w*|cumhurbaşkanlığı kararnamesi\w*)$"
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CandidateLaw:
    """One legislation candidate returned by a ``SearchPort``."""

    mevzuat_id: str
    name: str
    legislation_no: Optional[str] = None
    law_type: str = "KANUN"  # KANUN | KHK | CBK | ...
    mulga: bool = False      # repealed
    effective_start: Optional[date] = None
    effective_end: Optional[date] = None
    aliases: tuple = ()


class SearchPort(Protocol):
    """Injected exact-lookup backend (DB, MCP tool, or a test fake)."""

    async def search_exact(
        self,
        *,
        legislation_no: str = "",
        name: str = "",
        as_of: Optional[date] = None,
    ) -> Sequence[CandidateLaw]:
        """Return candidate laws for an exact number and/or name lookup."""
        ...  # pragma: no cover - protocol


@dataclass(frozen=True)
class ConfidenceComponents:
    """Per-candidate confidence breakdown; every component is 0..1.

    ``used`` lists the components that were informative for this reference
    (the others hold the neutral 0.5 placeholder and did not affect the
    confidence).
    """

    number_match: float
    name_similarity: float
    type_match: float
    date_plausibility: float
    used: tuple = ()


@dataclass(frozen=True)
class ScoredCandidate:
    candidate: CandidateLaw
    confidence: float  # 0..1
    components: ConfidenceComponents


@dataclass
class TargetResolution:
    """Resolution outcome for ONE target legislation reference."""

    reference: ParsedReference
    decision: str  # "resolved" | "ambiguous" | "not_found" | "abstain"
    candidates: list = field(default_factory=list)  # ScoredCandidate, sorted desc
    selected: Optional[ScoredCandidate] = None      # only when decision == "resolved"
    is_mulga: bool = False
    as_of: Optional[date] = None
    notes: list = field(default_factory=list)
    article_refs: list = field(default_factory=list)  # ParsedReference articles


@dataclass
class ResolverResult:
    """Result of resolving one amendment text (possibly multiple targets)."""

    amendment_text: str
    references: list = field(default_factory=list)  # every ParsedReference found
    targets: list = field(default_factory=list)     # TargetResolution per target law
    as_of: Optional[date] = None
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _norm_no(no: Optional[str]) -> Optional[str]:
    if not no:
        return None
    stripped = str(no).strip().lstrip("0")
    return stripped or "0"


def _infer_law_type(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    normalized = normalize_turkish_search(name)
    if "kanun hükmünde kararname" in normalized or normalized == "khk":
        return "KHK"
    if "cumhurbaşkanlığı kararnamesi" in normalized:
        return "CBK"
    if "kanun" in normalized:
        return "KANUN"
    return None


def _is_generic_name(name: Optional[str]) -> bool:
    if not name:
        return True
    # A recognized abbreviation ("TCK", "İİK") is the OPPOSITE of generic:
    # it identifies exactly one instrument.
    if lookup_abbreviation(name) is not None:
        return False
    return bool(_GENERIC_NAME_RE.match(normalize_turkish_search(name)))


def _ref_names(ref: ParsedReference) -> tuple:
    """Every name spelling known for a reference (written + canonical)."""
    names = []
    for value in (ref.name, ref.canonical_name):
        if value and value not in names:
            names.append(value)
    return tuple(names)


def _name_similarity(ref_names: Sequence[str], candidate: CandidateLaw) -> float:
    """Best 0..1 similarity of the referenced name(s) against a candidate.

    Abbreviated references carry both the written form ("TCK") and the
    canonical name ("Türk Ceza Kanunu"); either matching the candidate is a
    full hit, which is what turns an abbreviation from an abstain into an
    exact match.
    """
    best = 0.0
    for ref_name in ref_names:
        ref_norm = normalize_turkish_search(ref_name)
        if not ref_norm:
            continue
        for target in (candidate.name, *candidate.aliases):
            target_norm = normalize_turkish_search(target)
            if not target_norm:
                continue
            if ref_norm == target_norm:
                return 1.0
            best = max(best, SequenceMatcher(None, ref_norm, target_norm).ratio())
    return best


def _enrich_with_abbreviation(ref: ParsedReference) -> tuple:
    """Fill legislation_no / canonical_name / mulga from the abbrev table.

    Returns ``(reference, notes)``. A hand-built reference carrying only
    ``name="TCK"`` becomes a numbered, HIGH-confidence exact reference instead
    of abstaining, and a repealed instrument is flagged rather than resolved
    silently.
    """
    notes: list = []
    by_name = lookup_abbreviation(ref.name or "")
    by_number = lookup_by_number(ref.legislation_no)
    entry = by_number or by_name
    if entry is None:
        return ref, notes

    updates: dict = {}
    if ref.legislation_no is None and by_name is not None:
        updates["legislation_no"] = by_name.legislation_no
        notes.append(
            f"Abbreviation {by_name.key!r} resolved to legislation no. "
            f"{by_name.legislation_no} ({by_name.canonical_name})."
        )
    if ref.abbreviation is None and by_name is not None:
        updates["abbreviation"] = by_name.key
    if ref.canonical_name is None:
        updates["canonical_name"] = entry.canonical_name
    if entry.mulga and not ref.mulga:
        updates["mulga"] = True
    if not updates:
        return ref, notes
    return replace(ref, **updates), notes


def _is_instrument_header(ref: ParsedReference) -> bool:
    """True for the amending instrument's own article headers ("MADDE 2 –").

    Those number the AMENDING law's articles, not the target's, so they must
    not be attached to a target resolution. Detection: uppercase "MADDE" in
    the original text (standard Resmî Gazete formatting).
    """
    return (
        ref.kind == "article"
        and ref.article_kind == "madde"
        and ref.raw[:5] == "MADDE"
    )


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


class AmendmentTargetResolver:
    """Resolves amendment provisions to their target legislation.

    ``search_port`` is any object satisfying ``SearchPort`` (dependency
    injection keeps this module free of network / DB concerns and makes the
    logic fully testable offline).
    """

    def __init__(
        self,
        search_port: SearchPort,
        *,
        threshold: float = RESOLVE_THRESHOLD,
        margin: float = RESOLVE_MARGIN,
        max_candidates: int = 5,
    ) -> None:
        self._port = search_port
        self._threshold = threshold
        self._margin = margin
        self._max_candidates = max_candidates

    # -- scoring ------------------------------------------------------------

    def _score(
        self,
        ref: ParsedReference,
        candidate: CandidateLaw,
        as_of: Optional[date],
    ) -> ScoredCandidate:
        used: list = []

        ref_no = _norm_no(ref.legislation_no)
        cand_no = _norm_no(candidate.legislation_no)
        number = _NEUTRAL
        if ref_no and cand_no:
            number = 1.0 if ref_no == cand_no else 0.0
            used.append("number_match")

        name_score = _NEUTRAL
        names = _ref_names(ref)
        if names and not _is_generic_name(ref.name):
            name_score = _name_similarity(names, candidate)
            used.append("name_similarity")

        type_score = _NEUTRAL
        ref_type = _infer_law_type(ref.name) or _infer_law_type(ref.canonical_name)
        if ref_type:
            type_score = 1.0 if ref_type == candidate.law_type else 0.0
            used.append("type_match")

        date_score = _NEUTRAL
        if as_of is not None and (
            candidate.effective_start is not None
            or candidate.effective_end is not None
        ):
            start_ok = (
                candidate.effective_start is None
                or candidate.effective_start <= as_of
            )
            end_ok = (
                candidate.effective_end is None or as_of < candidate.effective_end
            )
            date_score = 1.0 if (start_ok and end_ok) else _DATE_OUT_OF_RANGE
            used.append("date_plausibility")

        scores = {
            "number_match": number,
            "name_similarity": name_score,
            "type_match": type_score,
            "date_plausibility": date_score,
        }
        total_weight = sum(_WEIGHTS[key] for key in used)
        confidence = (
            sum(_WEIGHTS[key] * scores[key] for key in used) / total_weight
            if total_weight
            else 0.0
        )
        return ScoredCandidate(
            candidate=candidate,
            confidence=round(confidence, 4),
            components=ConfidenceComponents(
                number_match=number,
                name_similarity=round(name_score, 4),
                type_match=type_score,
                date_plausibility=date_score,
                used=tuple(used),
            ),
        )

    # -- single reference ---------------------------------------------------

    async def resolve_reference(
        self,
        ref: ParsedReference,
        *,
        as_of: Optional[date] = None,
        exclude_legislation_no: Optional[str] = None,
    ) -> TargetResolution:
        """Resolve one legislation reference to candidate laws + a decision.

        ``exclude_legislation_no`` removes the amending law itself from the
        candidate pool (it is never a valid target of its own amendment).
        """
        if ref.kind != "legislation":
            raise ValueError(
                f"resolve_reference() expects a legislation reference, got {ref.kind!r}"
            )

        ref, notes = _enrich_with_abbreviation(ref)
        if ref.mulga:
            notes.append(
                "Reference points at a historical/mülga instrument "
                f"({ref.canonical_name or ref.name}); target must be treated "
                "as repealed law, not current law."
            )
        candidates = list(
            await self._port.search_exact(
                legislation_no=ref.legislation_no or "",
                name=ref.name or "",
                as_of=as_of,
            )
        )
        # Fallback: unknown number but an informative name -> name lookup.
        if not candidates and ref.legislation_no and not _is_generic_name(ref.name):
            candidates = list(
                await self._port.search_exact(name=ref.name or "", as_of=as_of)
            )
            if candidates:
                notes.append(
                    "Number lookup empty; candidates found via name fallback."
                )

        exclude = _norm_no(exclude_legislation_no)
        if exclude is not None:
            kept = [
                c for c in candidates if _norm_no(c.legislation_no) != exclude
            ]
            if len(kept) != len(candidates):
                notes.append(
                    f"Amending law (no. {exclude_legislation_no}) excluded from candidates."
                )
            candidates = kept

        scored = sorted(
            (self._score(ref, c, as_of) for c in candidates),
            key=lambda sc: sc.confidence,
            reverse=True,
        )[: self._max_candidates]

        selected: Optional[ScoredCandidate] = None
        if not scored:
            decision = "not_found"
        else:
            top = scored[0]
            runner_up = scored[1].confidence if len(scored) > 1 else None
            if top.confidence >= self._threshold and (
                runner_up is None
                or top.confidence - runner_up >= self._margin
            ):
                decision = "resolved"
                selected = top
            elif top.confidence >= self._threshold:
                decision = "ambiguous"
                notes.append(
                    "Multiple candidates above threshold within margin; "
                    "manual resolution required (no silent pick)."
                )
            else:
                decision = "abstain"
                notes.append(
                    f"Top confidence {top.confidence:.2f} below threshold "
                    f"{self._threshold:.2f}; queued for manual resolution."
                )

        is_mulga = bool(ref.mulga or (selected and selected.candidate.mulga))
        if selected is not None and selected.candidate.mulga:
            notes.append(
                "Target is mülga (repealed); resolved as the historical target."
            )

        return TargetResolution(
            reference=ref,
            decision=decision,
            candidates=scored,
            selected=selected,
            is_mulga=is_mulga,
            as_of=as_of,
            notes=notes,
        )

    # -- full amendment text ------------------------------------------------

    async def resolve(
        self,
        amendment_text: str,
        as_of: Optional[date] = None,
        *,
        amending_legislation_no: Optional[str] = None,
    ) -> ResolverResult:
        """Resolve every target legislation referenced by ``amendment_text``.

        Omnibus ("torba") amendments naturally yield multiple targets; each is
        resolved independently. When ``amending_legislation_no`` is given,
        references to the amending law itself are treated as self-references:
        they are excluded from the target list and the port is never queried
        with the amending law's number (the classic wrong-changing-id bug).
        """
        references = parse_references(amendment_text)
        legislation_refs = [r for r in references if r.kind == "legislation"]
        articles = [
            r
            for r in references
            if r.kind == "article" and not _is_instrument_header(r)
        ]

        result_notes: list = []
        amending_no = _norm_no(amending_legislation_no)
        targets_refs: list = []
        for ref in legislation_refs:
            if amending_no is not None and _norm_no(ref.legislation_no) == amending_no:
                result_notes.append(
                    f"Reference to the amending law itself "
                    f"(no. {ref.legislation_no}) skipped as target."
                )
                continue
            targets_refs.append(ref)

        targets: list = []
        for index, ref in enumerate(targets_refs):
            window_start = ref.span[0]
            window_end = (
                targets_refs[index + 1].span[0]
                if index + 1 < len(targets_refs)
                else None
            )
            resolution = await self.resolve_reference(
                ref,
                as_of=as_of,
                exclude_legislation_no=amending_legislation_no,
            )
            resolution.article_refs = [
                a
                for a in articles
                if a.span[0] >= window_start
                and (window_end is None or a.span[0] < window_end)
            ]
            targets.append(resolution)

        if not targets:
            result_notes.append("No target legislation reference found in text.")

        return ResolverResult(
            amendment_text=amendment_text,
            references=references,
            targets=targets,
            as_of=as_of,
            notes=result_notes,
        )

"""Plain-Markdown export of an evidence bundle.

Same content contract as the DOCX export (:mod:`export.bundle_docx`) — künye,
answer body with numbered citation markers, per-claim confidence table, an
explicit ÇELİŞEN OTORİTELER section, an explicit ÇEKİMSER section, the
KAYNAKLAR appendix with exact quotes plus hashes, and the DOĞRULAMA recipe —
but as text, so it can be diffed, piped, or pasted anywhere. Stdlib only.

Two rendering rules make this safe AND verifiable at the same time:

*Quotes go inside a fenced block* whose fence is computed to be longer than
any backtick run in the quote. A fenced block preserves the quote byte for
byte (so it still hashes to ``quoteSha256``) while stripping every Markdown
and HTML meaning from it — an injected ``SYSTEM: ...`` line renders as
literal text inside a visibly quoted box.

*Every other untrusted string* (titles, court names, claim text, URLs, machine
reasons) goes through :func:`escape_inline`, the Python mirror of
``escapeInline`` in ``control-plane/src/answer/renderer.ts``. Escaping ``[``
and ``]`` has a second job here: it guarantees untrusted text can never
counterfeit a ``[3]`` citation marker, which is what makes the post-render
citation-closure check on this format meaningful.

Markdown has no pages, so the mandatory "machine-generated, lawyer review
required" footer is emitted at BOTH the top and the bottom of the file.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from export import text as T
from export.bundle import (
    CONFIDENCE_DIMENSIONS,
    CONFIDENCE_LEGEND,
    EvidenceBundle,
    EvidenceEntry,
)
from export.plan import (
    CitationPlan,
    assert_citation_closure,
    build_citation_plan,
    meta_rows,
    tech_rows,
)
from export.result import ExportResult
from export.verify import VerificationReport, verify_bundle_or_refuse

FORMAT_NAME = "md"

_BACKTICK_RUN = re.compile(r"`+")
_MARKER_LINE = re.compile(r"^- (?:Atıflar|Karşıt kaynaklar): (.+)$", re.MULTILINE)
_APPENDIX_HEADING = re.compile(r"^### \[(\d+)\] ", re.MULTILINE)
_MARKER = re.compile(r"\[(\d+)\]")


def escape_inline(value: str) -> str:
    """Neutralize HTML and Markdown-active syntax in untrusted inline text.

    Mirrors ``escapeInline`` in the TypeScript renderer, character for
    character, so the two implementations cannot drift into disagreeing about
    what is safe.
    """
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("[", "&#91;")
        .replace("]", "&#93;")
        .replace("`", "&#96;")
    )


def _fenced(quote: str) -> list[str]:
    """Fence ``quote`` verbatim with a delimiter it cannot contain."""
    longest = max((len(m.group()) for m in _BACKTICK_RUN.finditer(quote)), default=0)
    fence = "`" * max(3, longest + 1)
    return [fence, *quote.split("\n"), fence]


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    for row in rows:
        out.append("| " + " | ".join(row) + " |")
    return out


def _source_entry(number: int, entry: EvidenceEntry) -> list[str]:
    lines = [f"### [{number}] {escape_inline(entry.title)}", ""]
    if entry.court:
        lines.append(f"- Mahkeme/Daire: {escape_inline(entry.court)}")
    ek: list[str] = []
    if entry.docket_no:
        ek.append(f"E. {escape_inline(entry.docket_no)}")
    if entry.decision_no:
        ek.append(f"K. {escape_inline(entry.decision_no)}")
    if ek:
        lines.append(f"- Esas/Karar: {', '.join(ek)}")
    if entry.decision_date:
        lines.append(f"- Tarih: {escape_inline(T.human_date(entry.decision_date))}")
    if entry.legislation_no:
        lines.append(f"- Mevzuat No: {escape_inline(entry.legislation_no)}")
    if entry.locator.article:
        lines.append(f"- Madde: m. {escape_inline(entry.locator.article)}")
    if entry.locator.paragraph:
        lines.append(f"- Fıkra/Bent: {escape_inline(entry.locator.paragraph)}")
    if entry.locator.page is not None:
        lines.append(f"- Sayfa: {entry.locator.page}")
    if entry.authority_label:
        tier = "" if entry.authority_tier is None else f" (kademe {entry.authority_tier})"
        lines.append(f"- Otorite: {escape_inline(entry.authority_label)}{tier}")
    if entry.currentness_status:
        lines.append(
            "- Güncellik: "
            + T.CURRENTNESS_TR.get(entry.currentness_status, entry.currentness_status)
        )
    lines.append(
        f"- Sonuç yönü: {T.SONUC_YONU_TR.get(entry.stance, entry.stance)}"
    )
    if entry.synthetic:
        lines.append(f"- **{T.SYNTHETIC_FOOTER_TAG}** — gerçek hukukî kaynak değildir")
    lines.extend(["", "Alıntı (birebir):", ""])
    lines.extend(_fenced(entry.quote))
    lines.extend(
        [
            "",
            f"- Alıntı SHA-256: `{entry.quote_sha256}`",
            f"- Belge içerik SHA-256: `{entry.content_sha256}`",
            "- Alıntının kaynak metindeki yeri:"
            f" {entry.locator.start_char}–{entry.locator.end_char}",
            f"- Kaynak: {escape_inline(entry.source)}",
            f"- Kaynak URL: {escape_inline(T.safe_url(entry.source_url))}",
            f"- Alınma zamanı: {escape_inline(T.human_timestamp(entry.retrieved_at))}",
        ]
    )
    return lines


def render_bundle_markdown(
    bundle: EvidenceBundle,
    plan: CitationPlan,
    report: VerificationReport,
    *,
    generated_at: str,
    system_version: str,
) -> str:
    """Render the full Markdown deliverable. Pure function, no I/O."""
    out: list[str] = [f"# {T.TITLE}", ""]

    banner = T.synthetic_notice(bundle)
    if banner:
        out.extend([f"> **{escape_inline(banner)}**", ""])
    out.extend([f"> {T.LAWYER_REVIEW_FOOTER}", ""])

    # ---- künye ------------------------------------------------------------
    out.extend([f"## {T.H_META}", ""])
    out.extend(
        _table(
            ["Alan", "Değer"],
            [
                [escape_inline(label), escape_inline(value)]
                for label, value in meta_rows(
                    bundle,
                    plan,
                    generated_at=generated_at,
                    integrity_summary=report.summary(),
                )
            ],
        )
    )
    # Ham enum'lar, ISO damgalar ve pipeline kimliği ayrı alt tabloda kalır:
    # avukat künyesi Türkçe, makine künyesi eksiksiz.
    out.extend(["", f"### {T.H_TECH_META}", ""])
    out.extend(
        _table(
            ["Alan", "Değer"],
            [
                [escape_inline(label), escape_inline(value)]
                for label, value in tech_rows(
                    bundle,
                    generated_at=generated_at,
                    system_version=system_version,
                )
            ],
        )
    )
    out.extend(["", T.LAWYER_REVIEW_NOTICE, ""])
    if report.warnings:
        out.extend(["Doğrulama uyarıları:", ""])
        out.extend(f"- {escape_inline(str(w))}" for w in report.warnings)
        out.append("")

    # ---- answer body ------------------------------------------------------
    out.extend([f"## {T.H_BODY}", ""])
    if bundle.is_abstention:
        out.extend([T.ABSTENTION_TEXT, ""])
    elif not bundle.claims:
        out.extend(["(Bu belgede sonuç yok.)", ""])
    else:
        for index, claim in enumerate(bundle.claims, start=1):
            out.extend(
                [
                    f"### {index}. Sonuç — {T.VERDICT_TR[claim.verdict]}",
                    "",
                    escape_inline(claim.text),
                    "",
                ]
            )
            supporting = plan.supporting_markers(claim)
            out.append(
                f"- Atıflar: {supporting if supporting else '(doğrulanmış atıf yok)'}"
            )
            contrary = plan.contrary_markers(claim)
            if contrary:
                out.append(f"- Karşıt kaynaklar: {contrary}")
            out.append(
                f"- Nitelik: {T.TREATMENT_TR.get(claim.treatment, claim.treatment)}"
                f" | esasa etkili: {'evet' if claim.material else 'hayır'}"
            )
            if claim.verdict == "INSUFFICIENT_EVIDENCE":
                out.append(
                    "- Bu sonuç kaynak denetiminden geçemedi ve KAYNAKSIZ"
                    " kabul edilir; karara dayanak yapılmamalıdır."
                )
            for reason in claim.reasons:
                out.append(f"- Gerekçe: {escape_inline(reason)}")
            out.append("")

    # ---- confidence table -------------------------------------------------
    out.extend([f"## {T.H_CONFIDENCE}", ""])
    if bundle.claims:
        header = ["Sonuç", "Karar", *[label for _, label in CONFIDENCE_DIMENSIONS]]
        rows = []
        for index, claim in enumerate(bundle.claims, start=1):
            values = claim.confidence.as_dict()
            rows.append(
                [
                    f"{index}. Sonuç",
                    T.VERDICT_TR[claim.verdict],
                    *[T.pct(values[key]) for key, _ in CONFIDENCE_DIMENSIONS],
                ]
            )
        out.extend(_table(header, rows))
        out.extend(["", T.CONFIDENCE_NOTE, "", "Sütunların anlamı:", ""])
        out.extend(
            f"- **{escape_inline(label)}:** {escape_inline(meaning)}"
            for label, meaning in CONFIDENCE_LEGEND
        )
        # W15: sütun adları Türkçeleşti, ama ölçütlerin MAKİNE adları silinmedi —
        # bu paket bağımsız denetim için üretiliyor ve okuyucunun elindeki JSON
        # cevapta alanlar bu adlarla duruyor. Teknik ad, Türkçe adın ardından.
        out.extend(
            [
                "",
                "Teknik karşılıkları: "
                + " · ".join(
                    f"{escape_inline(label)} = `{key}`" for key, label in CONFIDENCE_DIMENSIONS
                ),
            ]
        )
    else:
        out.append("(Sonuç yok.)")
    out.append("")

    # ---- conflicting authorities -----------------------------------------
    out.extend([f"## {T.H_CONFLICT}", ""])
    conflicted = [
        c
        for c in bundle.claims
        if c.verdict == "CONFLICTING_AUTHORITIES" or c.contrary_evidence_ids
    ]
    if conflicted and not bundle.is_abstention:
        out.extend(
            [
                "Aşağıdaki sonuçlarda kaynaklar arasında çelişki var; iki taraf"
                " da gizlenmeden sunulmaktadır:",
                "",
            ]
        )
        for claim in conflicted:
            supporting = plan.supporting_markers(claim) or "(yok)"
            contrary = plan.contrary_markers(claim) or "(yok)"
            out.append(
                f"- {escape_inline(claim.claim_id)}: destekleyen {supporting}"
                f" — karşıt {contrary}"
            )
    else:
        out.append("Kaynaklar arasında çelişki bulunamadı.")
    out.append("")

    # ---- abstention -------------------------------------------------------
    out.extend([f"## {T.H_ABSTAIN}", ""])
    if bundle.is_abstention:
        out.extend(
            [
                T.ABSTENTION_TEXT,
                "",
                T.NO_CITATION_IN_ABSTENTION,
                "",
                f"Değerlendirilen ancak yayımlanmayan kaynak sayısı:"
                f" {len(bundle.evidence)}.",
            ]
        )
    else:
        abstained = [c for c in bundle.claims if c.is_abstained]
        if abstained:
            out.append(
                "Aşağıdaki sonuçlar için yeterli doğrulanabilir kaynak yoktur;"
                " kaynaksız kabul edilir ve karara dayanak yapılamaz:"
            )
            out.append("")
            for claim in abstained:
                out.append(
                    f"- {escape_inline(claim.claim_id)}"
                    f" — {T.VERDICT_TR[claim.verdict]}"
                )
        else:
            out.append("Dayanak bulunamayan sonuç yok.")
    out.append("")

    # ---- machine reasons --------------------------------------------------
    if bundle.reasons:
        out.extend([f"## {T.H_REASONS}", ""])
        out.extend(f"- {escape_inline(reason)}" for reason in bundle.reasons)
        out.append("")

    # ---- sources ----------------------------------------------------------
    out.extend([f"## {T.H_SOURCES}", ""])
    if plan.entries:
        for number, entry in plan.entries:
            out.extend(_source_entry(number, entry))
            out.append("")
    else:
        out.extend(
            [
                "Bu belgede numaralandırılmış kaynak YOKTUR (0 atıf).",
                "",
                T.NO_CITATION_IN_ABSTENTION,
                "",
            ]
        )
    if plan.uncited:
        out.extend(
            [
                f"Değerlendirilen ancak hiçbir sonuçta atıf yapılmayan"
                f" {len(plan.uncited)} kaynak vardır; bunlar bilerek"
                " numaralandırılmamıştır.",
                "",
            ]
        )

    # ---- verification -----------------------------------------------------
    out.extend([f"## {T.H_VERIFY}", "", T.VERIFY_INTRO, ""])
    for step_no, step in enumerate(T.VERIFY_STEPS, start=1):
        out.append(f"{step_no}. {step}")
    out.extend(
        [
            "",
            T.VERIFY_SELF_CHECK,
            "",
            T.UDF_NOTICE,
            "",
            "---",
            "",
            f"**{T.LAWYER_REVIEW_FOOTER}**",
        ]
    )
    if banner:
        out.append("")
        out.append(f"**{escape_inline(banner)}**")
    out.append("")
    return "\n".join(out)


def read_markdown_report(markdown: str) -> tuple[frozenset[int], frozenset[int]]:
    """Parse a rendered Markdown export back into (body markers, appendix nos).

    Used for the post-render closure check and by the test suite. Untrusted
    text cannot forge either set: claim text has its brackets escaped, and
    quotes live inside fenced blocks that no marker regex line-prefix matches.
    """
    body: set[int] = set()
    for line in _MARKER_LINE.finditer(markdown):
        body.update(int(m.group(1)) for m in _MARKER.finditer(line.group(1)))
    appendix = {int(m.group(1)) for m in _APPENDIX_HEADING.finditer(markdown)}
    return frozenset(body), frozenset(appendix)


def export_markdown(
    bundle: EvidenceBundle,
    out_path: str | Path,
    *,
    generated_at: str | None = None,
    system_version: str | None = None,
) -> ExportResult:
    """Verify, render, re-parse, and only then write the Markdown file.

    Raises :class:`export.errors.ExportRefused` — leaving no file behind — if
    any quote fails to re-verify or the rendered citations do not close.
    """
    from export import REPORT_FORMAT, __version__

    report = verify_bundle_or_refuse(bundle)
    plan = build_citation_plan(bundle)
    # Local time with explicit offset: the human künye shows GG.AA.YYYY HH:MM
    # "(yerel saat)", the Teknik künye keeps the full ISO stamp.
    stamp = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    version = system_version or f"ColleX export {__version__} ({REPORT_FORMAT})"

    markdown = render_bundle_markdown(
        bundle, plan, report, generated_at=stamp, system_version=version
    )
    body, appendix = read_markdown_report(markdown)
    assert_citation_closure(
        body, appendix, expected=plan.numbered_ids, where="Markdown çıktısı"
    )

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(markdown, encoding="utf-8", newline="\n")

    return ExportResult(
        path=target,
        format=FORMAT_NAME,
        citation_count=len(plan.entries),
        uncited_count=len(plan.uncited),
        verification=report,
        synthetic=bundle.synthetic,
    )

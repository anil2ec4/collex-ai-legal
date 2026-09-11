"""W14 · B-13 — the Atıf Denetim Raporu as a produced DOCX.

The three rules the writer must keep on the ARTIFACT, not just in the JSON:

1. an unresolved citation renders an EMPTY künye cell (never a guess);
2. "bulunamadı" and "belirsiz" are separate, and the legend says what each
   one means — the first is our positive finding that the authority is not in
   the sources we search, the second is a statement about OUR coverage;
3. the currency verdict is dated to the PETITION'S date, printed in the header.

All content is SENTETİK.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from export.audit import (
    AuditFormatError,
    BUCKET_LEGEND,
    EMPTY_CELL_NOTE,
    REVIEW_RECORD_DISCLAIMER,
    VERIFICATION_INCOMPLETE_LINE,
    export_audit_docx,
    parse_audit,
    read_audit_report,
)
from export.cli import EXIT_OK, EXIT_USAGE, main
from export.errors import ExportRefused


def make_report(*, review_complete: bool = False) -> dict:
    return {
        "schema": "collex.citation-audit/v1",
        "asOf": "2026-06-01",
        "matterId": "m-1",
        "documentTitle": "Karşı tarafın cevap dilekçesi (SENTETİK)",
        "generatedAt": "2026-09-02T11:00:00.000Z",
        "reviewComplete": review_complete,
        "rows": [
            {
                "raw": "6098 sayılı Türk Borçlar Kanunu m. 344",
                "count": 3,
                "bucket": "FOUND",
                "bucketLabel": "bulundu",
                "kunye": "6098 sayılı TBK m. 344 (SENTETİK)",
                "documentVersionId": "dv-1",
                "currency": "IN_FORCE",
                "currencyLabel": "yürürlükte",
                "quoteVerified": "DOGRULANDI",
                "quoteVerifiedLabel": "alıntı hash ile doğrulandı",
                "contrary": [],
                "reason": "",
                "href": "",
                "review": {
                    "reviewed": True,
                    "by": "Av. Ayşe Yılmaz",
                    "at": "2026-09-02T09:00:00Z",
                    "note": "Resmî metinle karşılaştırıldı.",
                },
            },
            {
                "raw": "Yargıtay 3. HD E. 2023/4521, K. 2024/1188",
                "count": 1,
                "bucket": "NOT_FOUND",
                "bucketLabel": "bulunamadı",
                "kunye": "",
                "documentVersionId": "",
                "currency": "UNKNOWN",
                "currencyLabel": "bilinmiyor",
                "quoteVerified": "ALINTI_YOK",
                "quoteVerifiedLabel": "alıntı yok",
                "contrary": [],
                "reason": "",
                "href": "",
                "review": {"reviewed": False, "by": "", "at": "", "note": ""},
            },
            {
                "raw": "2004 sayılı İİK m. 269",
                "count": 2,
                "bucket": "UNCERTAIN",
                "bucketLabel": "belirsiz",
                "kunye": "",
                "documentVersionId": "",
                "currency": "UNKNOWN",
                "currencyLabel": "bilinmiyor",
                "quoteVerified": "ALINTI_YOK",
                "quoteVerifiedLabel": "alıntı yok",
                "contrary": [
                    {"kunye": "Yargıtay 6. HD E. 2022/9001 (SENTETİK)", "note": "Aksi yönde."}
                ],
                "reason": "Bu kaynak kapsamımızın dışında.",
                "href": "",
                "review": {"reviewed": False, "by": "", "at": "", "note": ""},
            },
        ],
        "totals": {"FOUND": 1, "NOT_FOUND": 1, "UNCERTAIN": 1},
        "notices": [
            "Bu rapor makine üretimidir; her satırı avukat incelemesi gerektirir.",
            "Yürürlük durumu, bugüne göre değil DİLEKÇENİN TARİHİNE göre hesaplanmıştır.",
        ],
    }


def test_report_renders_with_one_row_per_citation(tmp_path: Path):
    report = parse_audit(make_report())
    out = tmp_path / "denetim.docx"
    result = export_audit_docx(report, out)

    assert out.is_file()
    assert result.row_count == 3
    assert result.found == 1 and result.not_found == 1 and result.uncertain == 1

    produced = read_audit_report(out)
    # Header row + three citation rows.
    assert len(produced.table_rows) == 4
    assert produced.table_rows[0][0] == "Atıf"
    assert produced.table_rows[1][0].startswith("6098 sayılı Türk Borçlar Kanunu")
    assert "(3×)" in produced.table_rows[1][0]


def test_unresolved_citations_render_an_empty_kunye_cell(tmp_path: Path):
    """The rule the whole feature stands on: never a fabricated künye."""
    report = parse_audit(make_report())
    out = tmp_path / "denetim.docx"
    export_audit_docx(report, out)
    produced = read_audit_report(out)

    resolved, not_found, uncertain = produced.table_rows[1:4]
    assert resolved[2] == "6098 sayılı TBK m. 344 (SENTETİK)"
    assert not_found[2] == "", "bulunamayan atıf için künye yazılmış"
    assert uncertain[2] == "", "belirsiz atıf için künye yazılmış"
    # And the two negative buckets stay distinguishable on the page.
    assert not_found[1].startswith("bulunamadı")
    assert uncertain[1].startswith("belirsiz")
    assert "kapsamımızın dışında" in uncertain[1]


def test_legend_explains_the_three_buckets_and_the_empty_cell_rule(tmp_path: Path):
    report = parse_audit(make_report())
    out = tmp_path / "denetim.docx"
    export_audit_docx(report, out)
    text = read_audit_report(out).full_text

    for label, meaning in BUCKET_LEGEND:
        assert f"{label}: {meaning}" in text, label
    assert EMPTY_CELL_NOTE in text
    assert REVIEW_RECORD_DISCLAIMER in text


def test_currency_is_dated_to_the_petition_not_to_today(tmp_path: Path):
    report = parse_audit(make_report())
    out = tmp_path / "denetim.docx"
    export_audit_docx(report, out)
    text = read_audit_report(out).full_text
    assert "01.06.2026 tarihine göre" in text
    assert "bugüne göre değil" in text


def test_review_columns_carry_who_when_and_the_note(tmp_path: Path):
    report = parse_audit(make_report())
    out = tmp_path / "denetim.docx"
    export_audit_docx(report, out)
    rows = read_audit_report(out).table_rows
    assert "Av. Ayşe Yılmaz" in rows[1][6]
    assert "Resmî metinle karşılaştırıldı." in rows[1][6]
    assert rows[2][6] == "incelenmedi"


def test_incomplete_review_prints_the_line_and_a_complete_one_does_not(tmp_path: Path):
    open_out = tmp_path / "acik.docx"
    done_out = tmp_path / "kapali.docx"
    export_audit_docx(parse_audit(make_report(review_complete=False)), open_out)
    export_audit_docx(parse_audit(make_report(review_complete=True)), done_out)
    assert VERIFICATION_INCOMPLETE_LINE in read_audit_report(open_out).paragraph_texts
    assert VERIFICATION_INCOMPLETE_LINE not in read_audit_report(done_out).paragraph_texts


def test_a_report_with_no_rows_still_renders(tmp_path: Path):
    payload = make_report()
    payload["rows"] = []
    payload["totals"] = {"FOUND": 0, "NOT_FOUND": 0, "UNCERTAIN": 0}
    out = tmp_path / "bos.docx"
    result = export_audit_docx(parse_audit(payload), out)
    assert result.row_count == 0
    assert len(read_audit_report(out).table_rows) == 1


def test_a_bad_asof_is_refused_before_anything_is_written(tmp_path: Path):
    payload = make_report()
    payload["asOf"] = "bugün"
    with pytest.raises(AuditFormatError):
        parse_audit(payload)


def test_a_wrong_schema_is_refused():
    with pytest.raises(AuditFormatError):
        parse_audit({"schema": "başka/v1", "asOf": "2026-06-01", "rows": []})


def test_cli_writes_the_report_and_rejects_the_wrong_input(tmp_path: Path, capsys):
    src = tmp_path / "denetim.json"
    src.write_text(json.dumps(make_report(), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "denetim.docx"

    assert main(["--audit", str(src), "--out", str(out), "--format", "denetim-docx"]) == EXIT_OK
    assert out.is_file()
    stdout = capsys.readouterr().out
    assert "DENETIM-DOCX yazıldı" in stdout
    assert "bulunamadı: 1" in stdout

    # The format is only valid with --audit …
    assert (
        main(["--bundle", str(src), "--out", str(out), "--format", "denetim-docx"]) == EXIT_USAGE
    )
    # … and --audit only accepts that format.
    assert main(["--audit", str(src), "--out", str(out), "--format", "md"]) == EXIT_USAGE
    # … and exactly one input mode may be given.
    assert main(["--audit", str(src), "--draft", str(src), "--out", str(out)]) == EXIT_USAGE


def test_self_check_refuses_a_report_whose_rows_would_be_lost(tmp_path: Path, monkeypatch):
    """A writer bug must cost the file, not produce a misleading report."""
    import export.audit as audit_module

    report = parse_audit(make_report())

    def broken(_report, *, system_version):  # noqa: ANN001
        document = audit_module.Document()
        audit_module._register(document)
        audit_module._para(document, audit_module.REVIEW_BANNER, audit_module.STYLE_WARNING)
        return document

    monkeypatch.setattr(audit_module, "build_audit_document", broken)
    out = tmp_path / "bozuk.docx"
    with pytest.raises(ExportRefused):
        export_audit_docx(report, out)
    assert not out.exists()
    assert list(tmp_path.glob("*.tmp")) == []

"""W14 · B-24 — the Sözleşme İnceleme Raporu as a produced DOCX (L-FIX).

L-EVID shipped the review engine and the JSON endpoint in phase A and
recorded that the DOCX half was NOT done (W14-L-EVID.md §13 item 1). These
tests pin the artifact, not the JSON — the three rules a reader can be misled
by if they hold only in the producer:

1. "yok" is a statement about the TEXT and the legend says so verbatim: a
   missing clause is not a defective contract;
2. an unsourced observation carries the ``KAYNAKSIZ`` label and NEVER the
   word "risk", in any Turkish inflection, in the written document;
3. the report says on its face that it is rule-based — no model ran.

Plus the property every ColleX exporter has: nothing is written when the
document does not verify against its own input (exit 2, no file).

All content is SENTETİK.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from export.cli import EXIT_OK, EXIT_REFUSED, EXIT_USAGE, main
from export.errors import ExportRefused
from export.review import (
    KAYNAKSIZ_PREFIX,
    REVIEW_BANNER,
    STATE_LEGEND,
    TITLE,
    UNSOURCED_NOTE,
    ReviewFormatError,
    export_review_docx,
    parse_review,
    read_review_report,
)


def make_report() -> dict:
    """A `collex.contract-review/v1` document in the shape reviewContract emits."""
    return {
        "schema": "collex.contract-review/v1",
        "documentTitle": "Kira sözleşmesi (SENTETİK)",
        "checklistId": "kira-v1",
        "checklistTitle": "Kira sözleşmesi kontrol listesi (SENTETİK)",
        "generatedAt": "2026-09-02T10:00:00.000Z",
        "clauseCount": 4,
        "findings": [
            {
                "itemId": "depozito",
                "label": "Depozito",
                "state": "VAR",
                "stateLabel": "var",
                "clauseNumbers": ["3"],
                "matchedTerm": "depozito",
                "note": "Tutarı ayrıca kontrol edin.",
            },
            {
                "itemId": "artis",
                "label": "Artış oranı",
                "state": "YOK",
                "stateLabel": "yok",
                "clauseNumbers": [],
                "matchedTerm": "",
                "note": "",
            },
            {
                "itemId": "tahliye",
                "label": "Tahliye taahhüdü",
                "state": "BELIRSIZ",
                "stateLabel": "belirsiz",
                "clauseNumbers": ["4"],
                "matchedTerm": "tahliye",
                "note": "Atıf içinde geçiyor olabilir.",
            },
        ],
        "clauses": [
            {
                "clauseNumber": "3",
                "index": 2,
                "itemIds": ["depozito"],
                "observations": [
                    {
                        "text": "Depozito iadesi için süre yazılmamış.",
                        "sourced": True,
                        "evidenceId": "E1",
                        "evidenceLabel": "6098 s.K. m. 299 (SENTETİK)",
                    }
                ],
            },
            {
                "clauseNumber": "4",
                "index": 3,
                "itemIds": [],
                "observations": [
                    {
                        "text": f"{KAYNAKSIZ_PREFIX} — Bu madde kaynağa bağlanamadı.",
                        "sourced": False,
                        "evidenceId": "",
                        "evidenceLabel": "",
                    }
                ],
            },
        ],
        "totals": {"VAR": 1, "YOK": 1, "BELIRSIZ": 1},
        "notices": [REVIEW_BANNER],
    }


@pytest.fixture()
def written(tmp_path: Path) -> Path:
    out = tmp_path / "inceleme.docx"
    result = export_review_docx(parse_review(make_report()), out)
    assert result.format == "inceleme-docx"
    assert result.finding_count == 3
    assert (result.var, result.yok, result.belirsiz) == (1, 1, 1)
    assert result.unsourced == 1
    assert out.exists()
    return out


def test_rule_1_the_yok_legend_says_it_is_about_the_TEXT(written: Path) -> None:
    produced = read_review_report(written)
    for label, meaning in STATE_LEGEND:
        assert label in produced.full_text
        if label == "yok":
            # The exact sentence that keeps a search result from reading as a
            # legal conclusion, printed verbatim on its legend line.
            assert f"{label}: {meaning}" in produced.paragraph_texts
            assert "hukuken zorunlu olduğu" in meaning


def test_rule_2_an_unsourced_observation_is_labelled_and_says_no_risk(written: Path) -> None:
    produced = read_review_report(written)
    # The legend states the rule and therefore has to say the word once
    # ("… 'risk' olarak adlandırılmaz"); every OTHER labelled line is an
    # observation and may not say it at all.
    assert UNSOURCED_NOTE in produced.paragraph_texts
    observations = [
        line
        for line in produced.paragraph_texts
        if KAYNAKSIZ_PREFIX in line and line != UNSOURCED_NOTE and line not in REVIEW_BANNER
    ]
    assert len(observations) == 1
    assert "risk" not in observations[0].lower()
    assert observations[0].startswith("Madde 4: ")


def test_rule_3_the_document_says_it_is_rule_based_at_top_and_bottom(written: Path) -> None:
    produced = read_review_report(written)
    assert produced.paragraph_texts[0] == REVIEW_BANNER
    assert produced.paragraph_texts[-1] == REVIEW_BANNER
    assert TITLE in produced.paragraph_texts


def test_the_table_carries_every_checklist_row_verbatim(written: Path) -> None:
    produced = read_review_report(written)
    # header + three findings
    assert len(produced.table_rows) == 4
    assert produced.table_rows[0][0] == "Başlık"
    assert [row[0] for row in produced.table_rows[1:]] == [
        "Depozito",
        "Artış oranı",
        "Tahliye taahhüdü",
    ]
    assert [row[1] for row in produced.table_rows[1:]] == ["var", "yok", "belirsiz"]
    # A YOK row has no clause number — and the cell is EMPTY, not "-".
    assert produced.table_rows[2][2] == ""


def test_self_check_refuses_when_a_KAYNAKSIZ_line_carries_the_word_risk(tmp_path: Path) -> None:
    """The producer strips it; this proves the WRITER refuses it too.

    A replayed or hand-edited JSON must not be able to publish a risk
    assessment under a report that says it makes none.
    """
    payload = make_report()
    payload["clauses"][1]["observations"][0]["text"] = (
        f"{KAYNAKSIZ_PREFIX} — Bu madde ciddi riskler taşıyor."
    )
    out = tmp_path / "riskli.docx"
    with pytest.raises(ExportRefused) as excinfo:
        export_review_docx(parse_review(payload), out)
    assert "KAYNAKSIZ_RISK" in excinfo.value.report()
    assert not out.exists(), "refused export must leave no file"


def test_parse_rejects_a_foreign_schema() -> None:
    payload = make_report()
    payload["schema"] = "collex.citation-audit/v1"
    with pytest.raises(ReviewFormatError):
        parse_review(payload)


def test_parse_rejects_a_report_without_findings() -> None:
    payload = make_report()
    del payload["findings"]
    with pytest.raises(ReviewFormatError):
        parse_review(payload)


def test_cli_review_writes_the_docx(tmp_path: Path, capsys) -> None:
    source = tmp_path / "review.json"
    source.write_text(json.dumps(make_report(), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "cli-inceleme.docx"
    code = main(["--review", str(source), "--out", str(out), "--format", "inceleme-docx"])
    assert code == EXIT_OK
    assert out.exists()
    assert "INCELEME-DOCX yazıldı" in capsys.readouterr().out


def test_cli_review_refuses_a_foreign_format(tmp_path: Path, capsys) -> None:
    source = tmp_path / "review.json"
    source.write_text(json.dumps(make_report(), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "x.docx"
    code = main(["--review", str(source), "--out", str(out), "--format", "denetim-docx"])
    assert code == EXIT_USAGE
    assert not out.exists()


def test_cli_inceleme_docx_needs_the_review_input(tmp_path: Path, capsys) -> None:
    bundle = tmp_path / "bundle.json"
    bundle.write_text("{}", encoding="utf-8")
    out = tmp_path / "x.docx"
    code = main(["--bundle", str(bundle), "--out", str(out), "--format", "inceleme-docx"])
    assert code == EXIT_USAGE
    assert "yalnızca --review girdisiyle" in capsys.readouterr().err


def test_cli_refuses_two_inputs(tmp_path: Path, capsys) -> None:
    source = tmp_path / "review.json"
    source.write_text(json.dumps(make_report(), ensure_ascii=False), encoding="utf-8")
    code = main(
        ["--review", str(source), "--audit", str(source), "--out", str(tmp_path / "x.docx")]
    )
    assert code == EXIT_USAGE
    assert "tam" in capsys.readouterr().err


def test_refused_export_leaves_no_temporary_file(tmp_path: Path) -> None:
    payload = make_report()
    payload["clauses"][1]["observations"][0]["text"] = f"{KAYNAKSIZ_PREFIX} riskli"
    out = tmp_path / "temizlik.docx"
    with pytest.raises(ExportRefused):
        export_review_docx(parse_review(payload), out)
    assert list(tmp_path.iterdir()) == [], "a refused export left files behind"
    assert EXIT_REFUSED == 2

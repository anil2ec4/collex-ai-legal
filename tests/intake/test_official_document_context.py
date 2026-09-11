"""Own article headings must not inherit a statute cited in the prior clause."""

import pytest

from intake.analysis import split_references


@pytest.mark.parametrize("heading", ["MADDE 2-", "Madde 2 –", "MADDE 2 —"])
def test_communique_heading_does_not_inherit_preceding_law(heading):
    text = (
        "MADDE 1- Bu Tebliğ, 492 sayılı Harçlar Kanununa bağlı tutarları belirler.\n"
        f"Dayanak\n{heading} Bu Tebliğ, 492 sayılı Kanunun mükerrer 138 inci "
        "maddesinin ikinci fıkrasına dayanılarak hazırlanmıştır."
    )
    matched, ambiguous = split_references(text)
    assert not any(e.get("articleNo") == "2" for e in matched)
    assert any(e.get("articleNo") == "2" for e in ambiguous)
    assert any(e.get("legislationNo") == "492" and e.get("articleNo") == "138"
               for e in matched)


def test_heading_also_ends_context_for_its_unqualified_body():
    matched, ambiguous = split_references(
        "TBK m. 315 uyarınca bildirim yapılır.\n"
        "MADDE 3- Taraflar m. 4 uyarınca ödeme yapar."
    )
    assert [(e.get("legislationNo"), e.get("articleNo")) for e in matched] == [("6098", "315")]
    assert {e.get("articleNo") for e in ambiguous} == {"3", "4"}


def test_inline_short_form_still_inherits_explicit_law():
    matched, ambiguous = split_references("TBK m. 315 uyarınca bildirim yapılır; m. 315 uygulanır.")
    assert len(matched) == 1
    assert matched[0]["count"] == 2
    assert ambiguous == []


def test_omnibus_amendment_does_not_assign_an_unqualified_article_to_the_last_law():
    matched, ambiguous = split_references(
        "7566 sayılı Kanunun 7 nci maddesi ile 492 sayılı Kanuna bağlı tarifede, "
        "9 uncu maddesi ile de aynı Kanuna bağlı başka tarifede değişiklik yapılmıştır."
    )
    assert any(e.get("legislationNo") == "7566" and e.get("articleNo") == "7" for e in matched)
    assert not any(e.get("articleNo") == "9" for e in matched)
    assert any(e.get("articleNo") == "9" for e in ambiguous)


def test_repeated_article_number_does_not_inherit_law_across_a_document_heading():
    matched, ambiguous = split_references(
        "MADDE 3- 492 sayılı Kanuna bağlı tarifeler belirlenir.\n"
        "MADDE 4- Cumhurbaşkanı Kararının 3 üncü maddesi uygulanır."
    )
    assert not any(e.get("legislationNo") == "492" and e.get("articleNo") == "3" for e in matched)
    # Existing identity de-duplication merges both unresolved article 3 forms.
    assert any(e.get("articleNo") == "3" and e.get("count") == 2 for e in ambiguous)


def test_explicit_adjacent_law_article_pairs_remain_resolved_with_multiple_laws():
    matched, _ = split_references("TBK m. 49 ve HMK m. 190 uygulanır.")
    assert {(e.get("legislationNo"), e.get("articleNo")) for e in matched} == {("6098", "49"), ("6100", "190")}

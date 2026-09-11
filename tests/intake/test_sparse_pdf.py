from intake.extract import extract_pdf
from tests.intake.pdf_fixtures import build_multipage_pdf, TEXT_PAGE


def test_header_only_pages_are_reported_without_discarding_their_text():
    outcome = extract_pdf(build_multipage_pdf([TEXT_PAGE, [], ["Yönetmelik Adı - 3"], ["Yönetmelik Adı - 4"]]))
    assert outcome.page_stats.to_json_dict()["sparsePages"] == [3, 4]
    assert outcome.page_stats.empty_pages == (2,)
    assert "Yönetmelik Adı" in outcome.text
    assert any("sayfa 3, 4" in w and "tamamının okunduğu" in w for w in outcome.warnings)


def test_short_real_text_is_preserved_with_uncertainty():
    outcome = extract_pdf(build_multipage_pdf([["Talep reddedildi."]]))
    assert outcome.text == "Talep reddedildi."
    assert outcome.page_stats.to_json_dict()["sparsePages"] == [1]
    assert outcome.warnings


def test_substantial_text_does_not_get_sparse_warning():
    outcome = extract_pdf(build_multipage_pdf([TEXT_PAGE]))
    assert not outcome.warnings
    assert "sparsePages" not in outcome.page_stats.to_json_dict()

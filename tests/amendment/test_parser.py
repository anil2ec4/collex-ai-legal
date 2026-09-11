# tests/amendment/test_parser.py
"""Fixture tests for the exact Turkish legal reference parser (brief 8.4).

Covers the curated cases from brief 6.8/8.4: legislation with number+name,
article variants incl. ek/geçici and "6/A" style, E/K court decision
spellings, and the false-positive guards ("m." as metre, initials, plain
prose, bare counts).
"""

from legal_reference.parser import parse_references


def only(refs, kind):
    return [r for r in refs if r.kind == kind]


class TestLegislationReferences:
    def test_law_number_with_full_name(self):
        refs = parse_references(
            "5237 sayılı Türk Ceza Kanunu uyarınca işlem yapılır."
        )
        laws = only(refs, "legislation")
        assert len(laws) == 1
        assert laws[0].legislation_no == "5237"
        assert laws[0].name == "Türk Ceza Kanunu"
        assert laws[0].raw == "5237 sayılı Türk Ceza Kanunu"

    def test_law_number_with_generic_name(self):
        refs = parse_references("6098 sayılı Kanunun hükümleri saklıdır.")
        laws = only(refs, "legislation")
        assert len(laws) == 1
        assert laws[0].legislation_no == "6098"
        assert laws[0].name == "Kanunun"

    def test_inflected_name_is_captured(self):
        refs = parse_references(
            "2004 sayılı İcra ve İflas Kanununun geçici 11 inci maddesi"
        )
        laws = only(refs, "legislation")
        assert len(laws) == 1
        assert laws[0].name == "İcra ve İflas Kanununun"

    def test_three_digit_law_number(self):
        refs = parse_references("213 sayılı Vergi Usul Kanunu")
        assert only(refs, "legislation")[0].legislation_no == "213"

    def test_bare_year_is_not_a_law(self):
        refs = parse_references("2004 yılında inşa edilen bina")
        assert only(refs, "legislation") == []

    def test_sayili_liste_is_not_a_law(self):
        refs = parse_references("Ekli 2 sayılı listede gösterilen kadrolar")
        assert only(refs, "legislation") == []


class TestArticleReferences:
    def test_prefix_variants(self):
        for text, expected in [
            ("m. 157 uygulanır", "157"),
            ("md. 157 uygulanır", "157"),
            ("madde 157 uygulanır", "157"),
        ]:
            refs = parse_references(text)
            arts = only(refs, "article")
            assert len(arts) == 1, text
            assert arts[0].article_no == expected
            assert arts[0].article_kind == "madde"

    def test_suffix_variants(self):
        for text in ["157. madde uygulanır", "157 nci maddesi uygulanır"]:
            arts = only(parse_references(text), "article")
            assert len(arts) == 1, text
            assert arts[0].article_no == "157"

    def test_slash_letter_article(self):
        # "6/A" style compound article numbers, both prefix and suffix forms.
        arts = only(parse_references("Kanunun 6/A maddesi uygulanır"), "article")
        assert [a.article_no for a in arts] == ["6/A"]
        arts = only(parse_references("bkz. m. 6/A hükmü"), "article")
        assert [a.article_no for a in arts] == ["6/A"]

    def test_ek_madde(self):
        arts = only(parse_references("Kanuna ek madde 5 eklenmiştir."), "article")
        assert len(arts) == 1
        assert arts[0].article_no == "5"
        assert arts[0].article_kind == "ek"

    def test_gecici_madde(self):
        arts = only(parse_references("geçici madde 2 uygulanır"), "article")
        assert len(arts) == 1
        assert arts[0].article_no == "2"
        assert arts[0].article_kind == "geçici"

    def test_gecici_madde_ordinal_form(self):
        arts = only(
            parse_references("Kanunun geçici 11 inci maddesi yürürlükten kaldırıldı."),
            "article",
        )
        assert len(arts) == 1
        assert arts[0].article_no == "11"
        assert arts[0].article_kind == "geçici"

    def test_ek_gecici_not_double_counted_as_plain_article(self):
        refs = parse_references("ek madde 5 hükmü")
        assert len(only(refs, "article")) == 1  # not also a plain "madde 5"


class TestCourtDecisionReferences:
    def test_short_e_k_form(self):
        refs = parse_references("Yargıtay 1. HD, E. 2021/123, K. 2022/456 sayılı kararı")
        decisions = only(refs, "court_decision")
        assert len(decisions) == 1
        d = decisions[0]
        assert d.docket_no == "2021/123"
        assert d.decision_no == "2022/456"
        assert d.year == 2021

    def test_spelled_out_esas_karar_with_colon(self):
        d = only(
            parse_references("Esas No: 2021/123; Karar No: 2022/456"),
            "court_decision",
        )[0]
        assert (d.docket_no, d.decision_no) == ("2021/123", "2022/456")

    def test_compact_form_with_em_dash(self):
        d = only(parse_references("E.2021/123 – K.2022/456"), "court_decision")[0]
        assert (d.docket_no, d.decision_no) == ("2021/123", "2022/456")

    def test_suffix_style(self):
        d = only(
            parse_references("2021/123 E., 2022/456 K. sayılı karar"),
            "court_decision",
        )[0]
        assert (d.docket_no, d.decision_no) == ("2021/123", "2022/456")

    def test_implausible_years_rejected(self):
        assert parse_references("E. 9999/1, K. 8888/2") == []


class TestOfficialGazetteBonus:
    def test_rg_date_and_number(self):
        refs = parse_references(
            "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete'de yayımlanmıştır."
        )
        rg = only(refs, "official_gazette")
        assert len(rg) == 1
        assert rg[0].rg_date == "26/9/2004"
        assert rg[0].rg_no == "25611"
        assert rg[0].year == 2004
        # The RG issue number must NOT leak out as a legislation reference.
        assert only(refs, "legislation") == []


class TestFalsePositiveGuards:
    def test_metre_abbreviation_is_not_an_article(self):
        refs = parse_references("Bina 100 m. yüksekliğindedir.")
        assert refs == []

    def test_metre_followed_by_number_is_not_an_article(self):
        refs = parse_references("Şerit 100 m. 200 m. arasında değişir.")
        assert only(refs, "article") == []

    def test_plain_prose_yields_nothing(self):
        assert parse_references("Bugün hava çok güzel, yarın toplantı var.") == []

    def test_initials_are_not_references(self):
        assert parse_references("M. Kemal 1923 yılında Cumhuriyeti kurdu.") == []
        assert parse_references("Raporu E. Yılmaz ve K. Demir hazırladı.") == []

    def test_bare_count_of_articles_is_not_a_reference(self):
        assert parse_references("Teklifle kanuna ek 3 madde eklenmesi önerildi.") == []

    def test_empty_input(self):
        assert parse_references("") == []


class TestAbbreviationReferences:
    """P1: lawyers write "TCK m. 157", not "5237 sayılı ... m. 157"."""

    def test_bare_abbreviation_yields_a_legislation_number(self):
        laws = only(parse_references("TCK m. 157 uyarınca"), "legislation")
        assert len(laws) == 1
        assert laws[0].legislation_no == "5237"
        assert laws[0].abbreviation == "TCK"
        assert laws[0].canonical_name == "Türk Ceza Kanunu"
        assert laws[0].raw == "TCK"

    def test_keyword_less_article_shorthand(self):
        for text, no, art in [
            ("TBK 49", "6098", "49"),
            ("İİK 89", "2004", "89"),
            ("HMK 177", "6100", "177"),
            ("CMK 100", "5271", "100"),
            ("TMK 706", "4721", "706"),
            ("TTK 5/A", "6102", "5/A"),
            ("VUK 359", "213", "359"),
        ]:
            refs = parse_references(text)
            assert only(refs, "legislation")[0].legislation_no == no, text
            assert only(refs, "article")[0].article_no == art, text

    def test_inflected_forms(self):
        for text in ["TCK'nın 157. maddesi", "TCK'nin 157. maddesi",
                     "TCK'nun 157. maddesi"]:
            assert only(parse_references(text), "legislation")[0].legislation_no == "5237"

    def test_dotted_and_dotless_spellings(self):
        for text in ["İİK'nun 89 uncu maddesi", "IIK 89 uncu maddesi",
                     "İIK 89 uncu maddesi"]:
            refs = parse_references(text)
            assert only(refs, "legislation")[0].legislation_no == "2004", text
            assert only(refs, "article")[0].article_no == "89", text

    def test_anayasa_resolves_but_anayasa_mahkemesi_does_not(self):
        refs = parse_references("Anayasa'nın 36'ncı maddesi")
        assert only(refs, "legislation")[0].legislation_no == "2709"
        assert only(parse_references("Anayasa Mahkemesi kararı"), "legislation") == []

    def test_number_and_abbreviation_together(self):
        laws = only(parse_references("5237 sayılı TCK'nın 157. maddesi"), "legislation")
        assert (laws[0].legislation_no, laws[0].abbreviation) == ("5237", "TCK")

    def test_explicit_number_wins_and_flags_mulga(self):
        laws = only(parse_references("765 sayılı TCK'nın 480. maddesi"), "legislation")
        assert laws[0].legislation_no == "765"
        assert laws[0].mulga is True

    def test_mulga_abbreviation_is_flagged(self):
        laws = only(parse_references("HUMK m. 74"), "legislation")
        assert (laws[0].legislation_no, laws[0].mulga) == ("1086", True)

    def test_s_dot_short_form_of_sayili(self):
        refs = parse_references("6098 s. TBK m. 49")
        assert only(refs, "legislation")[0].legislation_no == "6098"
        assert only(refs, "article")[0].article_no == "49"

    def test_year_after_abbreviation_is_not_an_article(self):
        refs = parse_references("TCK 2005 yılında yürürlüğe girdi.")
        assert only(refs, "article") == []

    def test_longer_abbreviation_wins(self):
        laws = only(parse_references("KVKK ve KVK farklı kanunlardır."), "legislation")
        assert [law.legislation_no for law in laws] == ["6698", "5520"]


class TestFikraAndBent:
    """P1/P2: fıkra and bent must not be swallowed into the article number."""

    def test_roman_fikra(self):
        arts = only(parse_references("madde 25/II"), "article")
        assert (arts[0].article_no, arts[0].paragraph) == ("25", "II")

    def test_numeric_fikra_and_bent(self):
        arts = only(parse_references("m.6/1-a"), "article")
        assert (arts[0].article_no, arts[0].paragraph, arts[0].clause) == ("6", "1", "a")

    def test_slash_fikra_suffix_form(self):
        # "91/1. maddesi" was MISSED by the Python parser entirely.
        arts = only(parse_references("91/1. maddesi"), "article")
        assert (arts[0].article_no, arts[0].paragraph) == ("91", "1")

    def test_lettered_article_is_not_a_fikra(self):
        arts = only(parse_references("md. 10/A"), "article")
        assert (arts[0].article_no, arts[0].paragraph) == ("10/A", None)

    def test_spelled_out_fikra_ordinal(self):
        arts = only(parse_references("157 nci maddesinin birinci fıkrası"), "article")
        assert (arts[0].article_no, arts[0].paragraph) == ("157", "1")


class TestCourtIdentity:
    """P2: an E./K. pair is ambiguous until the chamber is captured."""

    def test_yargitay_chamber(self):
        d = only(
            parse_references("Yargıtay 9. HD, E. 2017/1234, K. 2018/5678"),
            "court_decision",
        )[0]
        assert (d.court, d.chamber) == ("YARGITAY", "9. HD")

    def test_same_docket_different_chamber(self):
        a = only(parse_references("Yargıtay 9. HD E. 2020/1, K. 2021/2"), "court_decision")[0]
        b = only(parse_references("Yargıtay 4. CD E. 2020/1, K. 2021/2"), "court_decision")[0]
        assert a.docket_no == b.docket_no
        assert a.chamber != b.chamber

    def test_hgk_hyphenated_docket(self):
        d = only(
            parse_references("Yargıtay Hukuk Genel Kurulu 2017/9-1234 E., 2019/456 K."),
            "court_decision",
        )[0]
        assert d.docket_no == "2017/9-1234"
        assert (d.court, d.chamber) == ("YARGITAY", "HGK")

    def test_hyphenated_docket_without_karar(self):
        d = only(parse_references("Yargıtay HGK 2017/9-1234 E."), "court_decision")[0]
        assert (d.docket_no, d.decision_no) == ("2017/9-1234", None)

    def test_bare_chamber_implies_its_court(self):
        d = only(parse_references("HGK 2020/1 E., 2021/2 K."), "court_decision")[0]
        assert (d.court, d.chamber) == ("YARGITAY", "HGK")
        d = only(parse_references("İDDK E. 2018/1, K. 2019/2"), "court_decision")[0]
        assert (d.court, d.chamber) == ("DANISTAY", "IDDK")

    def test_danistay_bam_bim_sayistay_uyusmazlik(self):
        cases = [
            ("Danıştay 10. D. E. 2019/1, K. 2021/2", "DANISTAY", "10. D"),
            ("İstanbul BAM 5. HD 2021/1 E., 2021/2 K.", "BAM", "5. HD"),
            ("Ankara BİM 2. İdari Dava Dairesi E. 2020/1, K. 2020/2", "BIM", "2. IDD"),
            ("Sayıştay 5. Dairesi E. 2019/3 K. 2019/9", "SAYISTAY", "5. D"),
            ("Uyuşmazlık Mahkemesi E. 2020/1 K. 2020/5", "UYUSMAZLIK", None),
        ]
        for text, court, chamber in cases:
            d = only(parse_references(text), "court_decision")[0]
            assert (d.court, d.chamber) == (court, chamber), text

    def test_aym_bireysel_basvuru(self):
        d = only(parse_references("AYM Genel Kurulu B. No: 2019/12345"), "court_decision")[0]
        assert d.docket_no == "2019/12345"
        assert d.decision_no is None
        assert (d.court, d.chamber, d.docket_kind) == ("AYM", "GENEL KURUL", "basvuru")

    def test_aym_bolum_basvuru(self):
        d = only(
            parse_references("Anayasa Mahkemesi Birinci Bölüm B. No: 2016/1234"),
            "court_decision",
        )[0]
        assert (d.court, d.chamber) == ("AYM", "1. BOLUM")

    def test_basvuru_numarasi_long_form(self):
        d = only(parse_references("Başvuru Numarası: 2018/9876"), "court_decision")[0]
        assert (d.docket_no, d.docket_kind) == ("2018/9876", "basvuru")

    def test_decision_date_tail(self):
        d = only(
            parse_references("E.2021/1234 K.2022/567 T.12.05.2022"), "court_decision"
        )[0]
        assert d.decision_date == "12.05.2022"

    def test_sayili_karar_is_never_legislation(self):
        assert parse_references("K. 2021/5678 sayılı kararı incelendi.") == []


class TestTorbaParsing:
    TORBA = (
        "MADDE 1 – 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci "
        "fıkrası aşağıdaki şekilde değiştirilmiştir.\n"
        "MADDE 2 – 6098 sayılı Türk Borçlar Kanununun 344 üncü maddesine bir "
        "fıkra eklenmiştir.\n"
        "MADDE 3 – 2004 sayılı İcra ve İflas Kanununun geçici 11 inci maddesi "
        "yürürlükten kaldırılmıştır.\n"
    )

    def test_all_three_targets_parsed(self):
        laws = only(parse_references(self.TORBA), "legislation")
        assert [l.legislation_no for l in laws] == ["5237", "6098", "2004"]

    def test_articles_parsed_alongside(self):
        arts = only(parse_references(self.TORBA), "article")
        pairs = [(a.article_kind, a.article_no) for a in arts]
        # Instrument headers MADDE 1..3 plus the three target articles.
        assert ("madde", "157") in pairs
        assert ("madde", "344") in pairs
        assert ("geçici", "11") in pairs

    def test_references_sorted_by_position(self):
        refs = parse_references(self.TORBA)
        spans = [r.span[0] for r in refs]
        assert spans == sorted(spans)

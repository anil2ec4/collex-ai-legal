"""Generate the cross-language Turkish legal reference parity fixture.

The Python parser (``legal_reference/parser.py``) and the TypeScript parser
(``control-plane/src/retrieval/referenceParser.ts``) are two implementations
of ONE specification. They had drifted badly -- the TypeScript side captured
"K. 2021/5678 sayılı kararı" as legislation no. 5678, truncated law names at
the first non-ASCII letter, read "madde 25/II" as article "25/I" and accepted
year 9999 -- because nothing pinned them together.

This script writes ``evals/fixtures/reference_parity.json``: a single corpus
of realistic Turkish citation strings (plus the false-positive guards) with
their FULL expected parses, consumed by

  * ``control-plane/tests/parser-parity.test.ts``   (TypeScript side)
  * ``tests/contracts/test_parser_parity.py``       (Python side)

so any future divergence breaks CI in both languages. The fixture also pins
the abbreviation table and the search-side normalizer output for every input
(the normalizers are byte-for-byte compared on the same strings).

Every case carries a HAND-WRITTEN legal expectation (``expect``): the ordered
list of reference kinds with the fields a Turkish lawyer would insist on. The
generator refuses to write the fixture unless the live Python parser satisfies
those expectations, so the JSON can never silently record a regression as the
new truth.

Run with the project venv interpreter:
  .venv/Scripts/python.exe scripts/gen_reference_fixtures.py
"""

from __future__ import annotations

import json
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from legal_reference.abbreviations import ABBREVIATIONS  # noqa: E402
from legal_reference.normalize import normalize_turkish_search  # noqa: E402
from legal_reference.parser import ParsedReference, parse_references  # noqa: E402
from legal_reference.parity_cases import SHORT_FORM_CASES  # noqa: E402

OUT_PATH = REPO_ROOT / "evals" / "fixtures" / "reference_parity.json"

# Canonical serialization order. The TypeScript side maps its camelCase
# fields onto these exact snake_case keys.
FIELDS = (
    "kind",
    "raw",
    "span",
    "legislation_no",
    "article_no",
    "docket_no",
    "decision_no",
    "year",
    "name",
    "article_kind",
    "paragraph",
    "clause",
    "abbreviation",
    "canonical_name",
    "mulga",
    "court",
    "chamber",
    "docket_kind",
    "decision_date",
    "rg_date",
    "rg_no",
)


def serialize(ref: ParsedReference) -> dict:
    """Language-neutral dict for one parsed reference (all keys always present)."""
    return {
        "kind": ref.kind,
        "raw": ref.raw,
        "span": [ref.span[0], ref.span[1]],
        "legislation_no": ref.legislation_no,
        "article_no": ref.article_no,
        "docket_no": ref.docket_no,
        "decision_no": ref.decision_no,
        "year": ref.year,
        "name": ref.name,
        "article_kind": ref.article_kind,
        "paragraph": ref.paragraph,
        "clause": ref.clause,
        "abbreviation": ref.abbreviation,
        "canonical_name": ref.canonical_name,
        "mulga": bool(ref.mulga),
        "court": ref.court,
        "chamber": ref.chamber,
        "docket_kind": ref.docket_kind,
        "decision_date": ref.decision_date,
        "rg_date": ref.rg_date,
        "rg_no": ref.rg_no,
    }


@dataclass(frozen=True)
class Case:
    name: str
    group: str
    description: str
    text: str
    expect: tuple  # ((kind, {field: value}), ...) -- hand-written expectation


L = "legislation"
A = "article"
C = "court_decision"
G = "official_gazette"

TORBA = (
    "MADDE 1 – 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci "
    "fıkrası aşağıdaki şekilde değiştirilmiştir.\n"
    "MADDE 2 – 6098 sayılı Türk Borçlar Kanununun 344 üncü maddesine bir "
    "fıkra eklenmiştir.\n"
    "MADDE 3 – 2004 sayılı İcra ve İflas Kanununun geçici 11 inci maddesi "
    "yürürlükten kaldırılmıştır."
)


def build_cases() -> list:
    cases: list = []
    add = cases.append

    # ---------------------------------------------------------------- numbered
    add(Case(
        "law_full_name_ordinal_article", "legislation",
        "Canonical citation form. The law NAME must survive Turkish letters "
        "('Türk Ceza Kanunu', not 'T') and the apostrophe ordinal must parse.",
        "5237 sayılı Türk Ceza Kanunu'nun 157'nci maddesi",
        ((L, {"legislation_no": "5237", "name": "Türk Ceza Kanunu",
              "canonical_name": "Türk Ceza Kanunu"}),
         (A, {"article_no": "157", "article_kind": "madde"})),
    ))
    add(Case(
        "law_full_name_plain", "legislation",
        "Law with a full name and no article reference.",
        "5237 sayılı Türk Ceza Kanunu uyarınca işlem yapılır.",
        ((L, {"legislation_no": "5237", "name": "Türk Ceza Kanunu"}),),
    ))
    add(Case(
        "law_iik_full_name", "legislation",
        "İcra ve İflas Kanunu cited by number and full name.",
        "2004 sayılı İcra ve İflas Kanunu",
        ((L, {"legislation_no": "2004", "name": "İcra ve İflas Kanunu"}),),
    ))
    add(Case(
        "law_generic_name", "legislation",
        "Generic 'Kanunun' name: number carries all the information.",
        "6098 sayılı Kanunun hükümleri saklıdır.",
        ((L, {"legislation_no": "6098", "name": "Kanunun"}),),
    ))
    add(Case(
        "law_vuk_suffix_article", "legislation",
        "Three-digit law number plus a dotted suffix article.",
        "213 sayılı Vergi Usul Kanunu'nun 359. maddesi",
        ((L, {"legislation_no": "213", "name": "Vergi Usul Kanunu"}),
         (A, {"article_no": "359"})),
    ))
    add(Case(
        "khk_with_ek_article", "legislation",
        "Kanun Hükmünde Kararname with an 'ek NN nci madde'.",
        "375 sayılı Kanun Hükmünde Kararnamenin ek 27 nci maddesi",
        ((L, {"legislation_no": "375"}),
         (A, {"article_no": "27", "article_kind": "ek"})),
    ))
    add(Case(
        "cbk_with_article", "legislation",
        "Cumhurbaşkanlığı Kararnamesi (CBK) with an ordinal article.",
        "1 sayılı Cumhurbaşkanlığı Kararnamesinin 508 inci maddesi",
        ((L, {"legislation_no": "1"}), (A, {"article_no": "508"})),
    ))
    add(Case(
        "law_lettered_article", "legislation",
        "'5/A' is a LETTERED ARTICLE (ek madde style), not a fıkra.",
        "6102 sayılı Türk Ticaret Kanununun 5/A maddesi",
        ((L, {"legislation_no": "6102"}),
         (A, {"article_no": "5/A", "paragraph": None})),
    ))
    add(Case(
        "law_roman_fikra", "legislation",
        "'25/II' is madde 25 FIKRA II -- the old TS parser read it as '25/I'.",
        "4857 sayılı İş Kanunu madde 25/II",
        ((L, {"legislation_no": "4857"}),
         (A, {"article_no": "25", "paragraph": "II"})),
    ))
    add(Case(
        "law_kvkk_prefix_article", "legislation",
        "KVKK cited by number and name plus 'm. 9'.",
        "6698 sayılı Kişisel Verilerin Korunması Kanunu m. 9",
        ((L, {"legislation_no": "6698"}), (A, {"article_no": "9"})),
    ))
    add(Case(
        "law_number_plus_abbreviation", "legislation",
        "'5237 sayılı TCK' -- the abbreviation is a valid law NAME; the old "
        "Python pattern required a 'kanun' word and dropped this entirely.",
        "5237 sayılı TCK'nın 157. maddesi",
        ((L, {"legislation_no": "5237", "name": "TCK", "abbreviation": "TCK",
              "mulga": False}),
         (A, {"article_no": "157"})),
    ))
    add(Case(
        "law_number_selects_mulga_entry", "legislation",
        "'765 sayılı TCK' -- the explicit NUMBER wins over the abbreviation "
        "and flags the repealed instrument.",
        "765 sayılı TCK'nın 480. maddesi",
        ((L, {"legislation_no": "765", "mulga": True}),
         (A, {"article_no": "480"})),
    ))
    add(Case(
        "law_s_abbrev_for_sayili", "legislation",
        "'6098 s. TBK' -- 's.' is the common short form of 'sayılı'.",
        "6098 s. TBK m. 49",
        ((L, {"legislation_no": "6098", "name": "TBK", "abbreviation": "TBK"}),
         (A, {"article_no": "49"})),
    ))

    # ------------------------------------------------------------ abbreviation
    for text, key, no, art in [
        ("TCK m. 157", "TCK", "5237", "157"),
        ("TBK 49", "TBK", "6098", "49"),
        ("İİK 89", "İİK", "2004", "89"),
        ("HMK 177", "HMK", "6100", "177"),
        ("CMK 100", "CMK", "5271", "100"),
        ("TMK 706", "TMK", "4721", "706"),
        ("VUK 359", "VUK", "213", "359"),
        ("KVKK m. 9", "KVKK", "6698", "9"),
        ("KVK m. 5", "KVK", "5520", "5"),
        ("FSEK 71", "FSEK", "5846", "71"),
        ("TKHK m. 11", "TKHK", "6502", "11"),
        ("AATUHK 54", "AATUHK", "6183", "54"),
        ("GVK 94", "GVK", "193", "94"),
        ("KDVK 29", "KDVK", "3065", "29"),
        ("SerPK 21", "SERPK", "6362", "21"),
        ("İYUK m. 7", "İYUK", "2577", "7"),
    ]:
        add(Case(
            "abbrev_" + key.lower().replace("ı", "i").replace("i̇", "i"),
            "abbreviation",
            f"Bare abbreviation shorthand: {text!r} -> {no} m. {art}.",
            text,
            ((L, {"legislation_no": no, "abbreviation": key}),
             (A, {"article_no": art})),
        ))

    add(Case(
        "abbrev_ttk_lettered_article", "abbreviation",
        "'TTK 5/A' -- lettered article via the keyword-less shorthand.",
        "TTK 5/A",
        ((L, {"legislation_no": "6102", "abbreviation": "TTK"}),
         (A, {"article_no": "5/A"})),
    ))
    add(Case(
        "abbrev_inflected_genitive", "abbreviation",
        "Inflected abbreviation with apostrophe + fıkra tail.",
        "TCK'nın 157. maddesinin 1. fıkrası",
        ((L, {"legislation_no": "5237", "abbreviation": "TCK", "name": "TCK"}),
         (A, {"article_no": "157", "paragraph": "1"})),
    ))
    add(Case(
        "abbrev_iik_inflected_ordinal", "abbreviation",
        "'İİK'nun 89 uncu maddesi' -- the ordinal tail must stay with the "
        "article pass, not be eaten by the abbreviation shorthand.",
        "İİK'nun 89 uncu maddesi",
        ((L, {"legislation_no": "2004", "abbreviation": "İİK"}),
         (A, {"article_no": "89"})),
    ))
    add(Case(
        "abbrev_iik_dotless_spelling", "abbreviation",
        "Dotless spelling 'IIK' resolves to the same entry as 'İİK'.",
        "IIK 89 uyarınca haciz ihbarnamesi gönderilir.",
        ((L, {"legislation_no": "2004", "abbreviation": "İİK"}),
         (A, {"article_no": "89"})),
    ))
    add(Case(
        "abbrev_anayasa_genitive", "abbreviation",
        "'Anayasa'nın 36'ncı maddesi' -> 2709 m. 36.",
        "Anayasa'nın 36'ncı maddesi",
        ((L, {"legislation_no": "2709", "abbreviation": "ANAYASA"}),
         (A, {"article_no": "36"})),
    ))
    add(Case(
        "abbrev_is_kanunu_dotted", "abbreviation",
        "'İş K. m. 25' -- multi-token abbreviation with a trailing dot.",
        "İş K. m. 25",
        ((L, {"legislation_no": "4857", "abbreviation": "İŞK"}),
         (A, {"article_no": "25"})),
    ))
    add(Case(
        "abbrev_is_kanunu_spelled", "abbreviation",
        "'İş Kanunu 18. madde' -- spelled-out short name.",
        "İş Kanunu 18. madde",
        ((L, {"legislation_no": "4857", "abbreviation": "İŞK"}),
         (A, {"article_no": "18"})),
    ))
    add(Case(
        "abbrev_iyuk_dot_madde", "abbreviation",
        "'İYUK 7. madde' -- the keyword-less shorthand must hand the number "
        "back to the article pass when 'madde' follows.",
        "İYUK 7. madde",
        ((L, {"legislation_no": "2577", "abbreviation": "İYUK"}),
         (A, {"article_no": "7"})),
    ))
    add(Case(
        "abbrev_imar_kanunu", "abbreviation",
        "'İmar Kanunu 32. madde' -> 3194 m. 32.",
        "İmar Kanunu 32. madde",
        ((L, {"legislation_no": "3194", "abbreviation": "İMARK"}),
         (A, {"article_no": "32"})),
    ))
    add(Case(
        "abbrev_kabahatler", "abbreviation",
        "'Kabahatler Kanunu m. 32' -> 5326 m. 32.",
        "Kabahatler Kanunu m. 32",
        ((L, {"legislation_no": "5326", "abbreviation": "KABK"}),
         (A, {"article_no": "32"})),
    ))
    add(Case(
        "abbrev_cgtihk_lettered", "abbreviation",
        "'CGTİHK 105/A' -> 5275, lettered article.",
        "CGTİHK 105/A",
        ((L, {"legislation_no": "5275", "abbreviation": "CGTİHK"}),
         (A, {"article_no": "105/A"})),
    ))
    add(Case(
        "abbrev_ssgssk_fikra_bent", "abbreviation",
        "'SSGSSK 4/1-a' -> 5510 m. 4 f. 1 b. a.",
        "SSGSSK 4/1-a",
        ((L, {"legislation_no": "5510", "abbreviation": "SSGSSK"}),
         (A, {"article_no": "4", "paragraph": "1", "clause": "a"})),
    ))
    add(Case(
        "abbrev_mulga_ettk", "abbreviation",
        "'eski TTK' is the REPEALED 6762; the mulga flag must be set so the "
        "resolver treats it as historical law.",
        "eski TTK m. 5 uygulanır.",
        ((L, {"legislation_no": "6762", "abbreviation": "ETTK", "mulga": True}),
         (A, {"article_no": "5"})),
    ))
    add(Case(
        "abbrev_mulga_humk", "abbreviation",
        "HUMK (1086) is repealed by HMK (6100); flagged, not hidden.",
        "HUMK m. 74",
        ((L, {"legislation_no": "1086", "abbreviation": "HUMK", "mulga": True}),
         (A, {"article_no": "74"})),
    ))
    add(Case(
        "abbrev_kvkk_beats_kvk", "abbreviation",
        "Longest-first alternation: 'KVKK' must never be read as 'KVK'+'K'.",
        "KVKK ve KVK farklı kanunlardır.",
        ((L, {"legislation_no": "6698", "abbreviation": "KVKK"}),
         (L, {"legislation_no": "5520", "abbreviation": "KVK"})),
    ))
    add(Case(
        "abbrev_year_is_not_article", "abbreviation",
        "'TCK 2005' -- 2005 is a YEAR, never an article number.",
        "TCK 2005 yılında yürürlüğe girdi.",
        ((L, {"legislation_no": "5237", "abbreviation": "TCK"}),),
    ))

    # ----------------------------------------------------------------- article
    add(Case(
        "article_prefix_fikra_bent", "article",
        "'m.6/1-a' -> madde 6, fıkra 1, bent a.",
        "m.6/1-a",
        ((A, {"article_no": "6", "paragraph": "1", "clause": "a"}),),
    ))
    add(Case(
        "article_md_lettered", "article",
        "'md. 10/A' -> lettered article 10/A.",
        "md. 10/A",
        ((A, {"article_no": "10/A", "paragraph": None}),),
    ))
    add(Case(
        "article_roman_fikra_standalone", "article",
        "'madde 25/II' -> madde 25, fıkra II.",
        "madde 25/II",
        ((A, {"article_no": "25", "paragraph": "II"}),),
    ))
    add(Case(
        "article_roman_fikra_lowercased_input", "article",
        "hybrid.ts parses normalizeTurkishSearch(query), where 'II' has "
        "already folded to dotless 'ıı'. The Roman fıkra must survive that "
        "path instead of becoming the garbage article '25/ıı'.",
        "4857 sayılı iş kanunu madde 25/ıı",
        ((L, {"legislation_no": "4857"}),
         (A, {"article_no": "25", "paragraph": "II"})),
    ))
    add(Case(
        "article_roman_fikra_dotted_lowercase", "article",
        "Lowercase dotted 'ii' is the same fıkra II.",
        "madde 25/ii",
        ((A, {"article_no": "25", "paragraph": "II"}),),
    ))
    add(Case(
        "article_single_lowercase_letter_is_a_suffix", "article",
        "A SINGLE lowercase letter stays a lettered suffix/bent, never a "
        "Roman fıkra ('5/i' is not fıkra I).",
        "madde 5/i",
        ((A, {"article_no": "5/i", "paragraph": None}),),
    ))
    add(Case(
        "article_slash_fikra_suffix", "article",
        "'91/1. maddesi' -- the form the Python parser used to MISS entirely.",
        "91/1. maddesi",
        ((A, {"article_no": "91", "paragraph": "1"}),),
    ))
    add(Case(
        "article_dot_suffix", "article",
        "Plain dotted suffix form.",
        "157. madde uygulanır",
        ((A, {"article_no": "157"}),),
    ))
    add(Case(
        "article_ordinal_suffix", "article",
        "Ordinal suffix form ('nci').",
        "157 nci maddesi uygulanır",
        ((A, {"article_no": "157"}),),
    ))
    add(Case(
        "article_lettered_suffix", "article",
        "'6/A maddesi' -- lettered article in the suffix form.",
        "Kanunun 6/A maddesi uygulanır",
        ((A, {"article_no": "6/A"}),),
    ))
    add(Case(
        "article_ek_madde", "article",
        "'ek madde 5'.",
        "Kanuna ek madde 5 eklenmiştir.",
        ((A, {"article_no": "5", "article_kind": "ek"}),),
    ))
    add(Case(
        "article_gecici_madde", "article",
        "'geçici madde 2'.",
        "geçici madde 2 uygulanır",
        ((A, {"article_no": "2", "article_kind": "geçici"}),),
    ))
    add(Case(
        "article_gecici_ordinal", "article",
        "'geçici 11 inci maddesi'.",
        "Kanunun geçici 11 inci maddesi yürürlükten kaldırıldı.",
        ((A, {"article_no": "11", "article_kind": "geçici"}),),
    ))
    add(Case(
        "article_fikra_word", "article",
        "Spelled-out fıkra ordinal ('birinci fıkrası') becomes paragraph '1'.",
        "157 nci maddesinin birinci fıkrası",
        ((A, {"article_no": "157", "paragraph": "1"}),),
    ))
    add(Case(
        "article_madde_prefix_plain", "article",
        "'madde 36' prefix form.",
        "Anayasa madde 36",
        ((L, {"legislation_no": "2709"}), (A, {"article_no": "36"})),
    ))

    # ---------------------------------------------------------- court decision
    add(Case(
        "court_ek_with_date", "court",
        "'E.2021/1234 K.2022/567 T.12.05.2022' -- the T. date is captured.",
        "E.2021/1234 K.2022/567 T.12.05.2022",
        ((C, {"docket_no": "2021/1234", "decision_no": "2022/567",
              "year": 2021, "decision_date": "12.05.2022"}),),
    ))
    add(Case(
        "court_suffix_style", "court",
        "Suffix style '2021/1234 E., 2022/567 K.'.",
        "2021/1234 E., 2022/567 K.",
        ((C, {"docket_no": "2021/1234", "decision_no": "2022/567"}),),
    ))
    add(Case(
        "court_yargitay_hd", "court",
        "Chamber identity captured: Yargıtay 9. Hukuk Dairesi.",
        "Yargıtay 9. HD, E. 2017/1234, K. 2018/5678",
        ((C, {"docket_no": "2017/1234", "decision_no": "2018/5678",
              "court": "YARGITAY", "chamber": "9. HD"}),),
    ))
    add(Case(
        "court_yargitay_cd_suffix", "court",
        "Ceza dairesi with a suffix-style docket pair.",
        "Yargıtay 4. CD 2019/100 E., 2020/200 K.",
        ((C, {"docket_no": "2019/100", "decision_no": "2020/200",
              "court": "YARGITAY", "chamber": "4. CD"}),),
    ))
    add(Case(
        "court_hgk_hyphenated_docket", "court",
        "Yargıtay HGK hyphenated docket '2017/9-1234' (chamber inside the "
        "docket) -- previously MISSED by both parsers.",
        "Yargıtay Hukuk Genel Kurulu 2017/9-1234 E., 2019/456 K.",
        ((C, {"docket_no": "2017/9-1234", "decision_no": "2019/456",
              "court": "YARGITAY", "chamber": "HGK"}),),
    ))
    add(Case(
        "court_hgk_docket_only", "court",
        "Hyphenated docket with no paired karar number.",
        "Yargıtay HGK 2017/9-1234 E.",
        ((C, {"docket_no": "2017/9-1234", "decision_no": None,
              "court": "YARGITAY", "chamber": "HGK"}),),
    ))
    add(Case(
        "court_cgk", "court",
        "Yargıtay Ceza Genel Kurulu.",
        "Yargıtay CGK E. 2018/5, K. 2019/7",
        ((C, {"docket_no": "2018/5", "decision_no": "2019/7",
              "court": "YARGITAY", "chamber": "CGK"}),),
    ))
    add(Case(
        "court_bare_hgk_implies_yargitay", "court",
        "A bare 'HGK' implies Yargıtay; 'İDDK' implies Danıştay.",
        "HGK 2020/1 E., 2021/2 K.",
        ((C, {"docket_no": "2020/1", "court": "YARGITAY", "chamber": "HGK"}),),
    ))
    add(Case(
        "court_danistay_daire", "court",
        "Danıştay 10. Daire.",
        "Danıştay 10. D. E. 2019/1, K. 2021/2",
        ((C, {"docket_no": "2019/1", "decision_no": "2021/2",
              "court": "DANISTAY", "chamber": "10. D"}),),
    ))
    add(Case(
        "court_danistay_iddk", "court",
        "Danıştay İdari Dava Daireleri Kurulu.",
        "Danıştay İDDK E. 2018/100 K. 2019/200",
        ((C, {"docket_no": "2018/100", "decision_no": "2019/200",
              "court": "DANISTAY", "chamber": "IDDK"}),),
    ))
    add(Case(
        "court_bam_chamber", "court",
        "Bölge Adliye Mahkemesi (istinaf) with its chamber.",
        "İstanbul BAM 5. HD 2021/1 E., 2021/2 K.",
        ((C, {"docket_no": "2021/1", "decision_no": "2021/2",
              "court": "BAM", "chamber": "5. HD"}),),
    ))
    add(Case(
        "court_bim_chamber", "court",
        "Bölge İdare Mahkemesi with a spelled-out chamber.",
        "Ankara BİM 2. İdari Dava Dairesi E. 2020/1, K. 2020/2",
        ((C, {"docket_no": "2020/1", "decision_no": "2020/2",
              "court": "BIM", "chamber": "2. IDD"}),),
    ))
    add(Case(
        "court_aym_basvuru_genel_kurul", "court",
        "AYM bireysel başvuru ('B. No:') -- previously MISSED by both.",
        "AYM Genel Kurulu B. No: 2019/12345",
        ((C, {"docket_no": "2019/12345", "decision_no": None, "court": "AYM",
              "chamber": "GENEL KURUL", "docket_kind": "basvuru"}),),
    ))
    add(Case(
        "court_aym_basvuru_bolum", "court",
        "AYM Birinci Bölüm bireysel başvuru.",
        "Anayasa Mahkemesi Birinci Bölüm B. No: 2016/1234",
        ((C, {"docket_no": "2016/1234", "court": "AYM",
              "chamber": "1. BOLUM", "docket_kind": "basvuru"}),),
    ))
    add(Case(
        "court_basvuru_bare", "court",
        "Bare 'B. No:' with no court mention still defaults to AYM (bireysel "
        "başvuru numbering is AYM-specific).",
        "B. No: 2019/12345",
        ((C, {"docket_no": "2019/12345", "decision_no": None, "court": "AYM",
              "chamber": None, "docket_kind": "basvuru"}),),
    ))
    add(Case(
        "court_basvuru_numarasi", "court",
        "'Başvuru Numarası:' long form.",
        "Başvuru Numarası: 2018/9876",
        ((C, {"docket_no": "2018/9876", "court": "AYM",
              "docket_kind": "basvuru"}),),
    ))
    add(Case(
        "court_spelled_out_esas_karar", "court",
        "'Esas No: ... ; Karar No: ...'.",
        "Esas No: 2021/123; Karar No: 2022/456",
        ((C, {"docket_no": "2021/123", "decision_no": "2022/456"}),),
    ))
    add(Case(
        "court_en_dash_separator", "court",
        "Typographic en dash between E. and K. (unified by the shadow fold).",
        "E.2021/123 – K.2022/456",
        ((C, {"docket_no": "2021/123", "decision_no": "2022/456"}),),
    ))
    add(Case(
        "court_uyusmazlik", "court",
        "Uyuşmazlık Mahkemesi identity.",
        "Uyuşmazlık Mahkemesi E. 2020/1 K. 2020/5",
        ((C, {"docket_no": "2020/1", "decision_no": "2020/5",
              "court": "UYUSMAZLIK"}),),
    ))
    add(Case(
        "court_sayistay", "court",
        "Sayıştay daire identity.",
        "Sayıştay 5. Dairesi E. 2019/3 K. 2019/9",
        ((C, {"docket_no": "2019/3", "decision_no": "2019/9",
              "court": "SAYISTAY", "chamber": "5. D"}),),
    ))

    # -------------------------------------------------------- official gazette
    add(Case(
        "rg_date_and_number", "gazette",
        "Resmî Gazete date + issue number; the issue number must NEVER leak "
        "out as a legislation number.",
        "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete'de yayımlanmıştır.",
        ((G, {"rg_date": "26/9/2004", "rg_no": "25611", "year": 2004}),),
    ))
    add(Case(
        "rg_mukerrer", "gazette",
        "'mükerrer' (repeat) issue.",
        "1/7/2005 tarihli ve 25862 mükerrer sayılı Resmî Gazete",
        ((G, {"rg_no": "25862", "year": 2005}),),
    ))
    add(Case(
        "rg_number_without_date_is_dropped", "guard",
        "'25611 sayılı Resmî Gazete' with no date yields NOTHING -- it is "
        "certainly not law no. 25611.",
        "25611 sayılı Resmî Gazete'de yayımlandı.",
        (),
    ))

    # ------------------------------------------------------------------ guards
    add(Case(
        "guard_metre_abbreviation", "guard",
        "'100 m.' is metres, never madde.",
        "Bina 100 m. yüksekliğindedir.",
        (),
    ))
    add(Case(
        "guard_metre_pair", "guard",
        "Two measurements in a row still yield nothing.",
        "Şerit 100 m. 200 m. arasında değişir.",
        (),
    ))
    add(Case(
        "guard_initials_m", "guard",
        "'M. Kemal' is a personal initial, not madde.",
        "M. Kemal 1923 yılında Cumhuriyeti kurdu.",
        (),
    ))
    add(Case(
        "guard_initials_e_k", "guard",
        "'E. Yılmaz ve K. Demir' are initials, not an esas/karar pair.",
        "Raporu E. Yılmaz ve K. Demir hazırladı.",
        (),
    ))
    add(Case(
        "guard_bare_article_count", "guard",
        "'ek 3 madde eklenmesi' is a COUNT of articles, not a reference.",
        "Teklifle kanuna ek 3 madde eklenmesi önerildi.",
        (),
    ))
    add(Case(
        "guard_sayili_karar_is_not_a_law", "guard",
        "'K. 2021/5678 sayılı kararı' -- the TS parser used to emit "
        "legislation no. 5678 here. It must emit NOTHING.",
        "K. 2021/5678 sayılı kararı incelendi.",
        (),
    ))
    add(Case(
        "guard_implausible_years", "guard",
        "Docket years outside 1900..2099 are rejected.",
        "E. 9999/1, K. 8888/2",
        (),
    ))
    add(Case(
        "guard_sayili_liste", "guard",
        "'2 sayılı liste' is an annex, not a law.",
        "Ekli 2 sayılı listede gösterilen kadrolar",
        (),
    ))
    add(Case(
        "guard_bare_year", "guard",
        "A bare year is not a law number.",
        "2004 yılında inşa edilen bina",
        (),
    ))
    add(Case(
        "guard_anayasa_mahkemesi_is_a_court", "guard",
        "'Anayasa Mahkemesi' is a COURT; it must not resolve to the "
        "Constitution (2709).",
        "Anayasa Mahkemesi kararı bağlayıcıdır.",
        (),
    ))
    add(Case(
        "guard_plain_prose", "guard",
        "Ordinary prose yields nothing.",
        "Bugün hava çok güzel, yarın toplantı var.",
        (),
    ))
    add(Case(
        "guard_glued_m_abbreviation", "guard",
        "'adam. 3' -- 'm.' glued to the end of a word is not madde.",
        "olay yerindeki adam. 3 gün sonra dinlendi",
        (),
    ))
    add(Case(
        "guard_empty_input", "guard",
        "Empty input yields an empty list.",
        "",
        (),
    ))

    # ------------------------------------------------------------- multi-target
    add(Case(
        "torba_three_targets", "multi",
        "Omnibus (torba) amendment: three target laws, three target articles, "
        "plus the amending instrument's own MADDE 1..3 headers.",
        TORBA,
        ((A, {"article_no": "1"}),
         (L, {"legislation_no": "5237"}),
         (A, {"article_no": "157", "paragraph": "1"}),
         (A, {"article_no": "2"}),
         (L, {"legislation_no": "6098"}),
         (A, {"article_no": "344"}),
         (A, {"article_no": "3"}),
         (L, {"legislation_no": "2004"}),
         (A, {"article_no": "11", "article_kind": "geçici"})),
    ))
    add(Case(
        "two_laws_one_sentence", "multi",
        "Two laws and two articles in one sentence, in text order.",
        "6102 sayılı Türk Ticaret Kanununun 4 üncü maddesi ile 6098 sayılı "
        "Türk Borçlar Kanununun 344 üncü maddesi birlikte uygulanır.",
        ((L, {"legislation_no": "6102"}), (A, {"article_no": "4"}),
         (L, {"legislation_no": "6098"}), (A, {"article_no": "344"})),
    ))
    add(Case(
        "amending_and_target_law", "multi",
        "Amending law (7418) and its target (5651) both parsed; deciding "
        "which is the TARGET is the resolver's job, not the parser's.",
        "7418 sayılı Kanunun 29 uncu maddesiyle 5651 sayılı İnternet "
        "Ortamında Yapılan Yayınların Düzenlenmesi Hakkında Kanunun 8 inci "
        "maddesi değiştirilmiştir.",
        ((L, {"legislation_no": "7418"}), (A, {"article_no": "29"}),
         (L, {"legislation_no": "5651"}), (A, {"article_no": "8"})),
    ))
    add(Case(
        "law_article_and_decision", "multi",
        "Legislation + article + a chambered court decision in one string.",
        "TCK m. 157 uyarınca Yargıtay 15. CD E. 2019/1, K. 2020/2 sayılı "
        "kararı emsal alınmıştır.",
        ((L, {"legislation_no": "5237"}), (A, {"article_no": "157"}),
         (C, {"docket_no": "2019/1", "decision_no": "2020/2",
              "court": "YARGITAY", "chamber": "15. CD"})),
    ))

    # ------------------------------------------------------------ short forms
    # W14 L-FIX (L-SOURCES IR-1). B-38's cases live in
    # legal_reference/parity_cases.py so BOTH runtimes can import them; if the
    # generator does not append them here, the next regeneration of
    # evals/fixtures/reference_parity.json silently drops every short-form case
    # and the parity test keeps passing over a smaller fixture. A test that
    # gets easier when a file is rebuilt is worse than no test.
    cases.extend(Case(**entry) for entry in SHORT_FORM_CASES)

    return cases


def check(case: Case, refs: list) -> None:
    """Fail loudly when the live parser disagrees with the hand-written spec."""
    got = [(r.kind, r) for r in refs]
    if len(got) != len(case.expect):
        raise AssertionError(
            f"{case.name}: expected {len(case.expect)} reference(s), got "
            f"{len(got)}: {[(r.kind, r.raw) for r in refs]}"
        )
    for index, (kind, fields) in enumerate(case.expect):
        actual_kind, ref = got[index]
        if actual_kind != kind:
            raise AssertionError(
                f"{case.name}[{index}]: expected kind {kind!r}, got "
                f"{actual_kind!r} ({ref.raw!r})"
            )
        for field, expected in fields.items():
            actual = getattr(ref, field)
            if actual != expected:
                raise AssertionError(
                    f"{case.name}[{index}].{field}: expected {expected!r}, "
                    f"got {actual!r} (raw={ref.raw!r})"
                )


def main() -> None:
    cases = build_cases()
    names = [case.name for case in cases]
    duplicates = {name for name in names if names.count(name) > 1}
    if duplicates:
        raise AssertionError(f"duplicate case names: {sorted(duplicates)}")
    if len(cases) < 70:
        raise AssertionError(
            f"parity corpus must hold at least 70 inputs, has {len(cases)}"
        )

    serialized: list = []
    for case in cases:
        if unicodedata.normalize("NFC", case.text) != case.text:
            raise AssertionError(f"{case.name}: fixture text must already be NFC")
        if any(ord(char) > 0xFFFF for char in case.text):
            # UTF-16 (JavaScript) and code point (Python) indices only agree on
            # BMP text; every real Turkish citation is BMP.
            raise AssertionError(f"{case.name}: fixture text must be BMP-only")
        refs = parse_references(case.text)
        check(case, refs)
        for ref in refs:
            start, end = ref.span
            if case.text[start:end] != ref.raw:
                raise AssertionError(
                    f"{case.name}: span {ref.span} does not slice back to raw"
                )
        serialized.append({
            "name": case.name,
            "group": case.group,
            "description": case.description,
            "text": case.text,
            "normalized": normalize_turkish_search(case.text),
            "expected": [serialize(ref) for ref in refs],
        })

    fixture = {
        "policy": {
            "fields": list(FIELDS),
            "offset_unit": "unicode_code_points",
            "normal_form": "NFC",
            "bmp_only": True,
            "description": (
                "One corpus, two implementations. Every case is parsed by "
                "legal_reference/parser.py (Python) and by "
                "control-plane/src/retrieval/referenceParser.ts (TypeScript); "
                "both must produce the serialized `expected` list EXACTLY, "
                "and both normalizers must produce `normalized` for the same "
                "input. Spans are half-open [start, end) indices into the NFC "
                "text; the corpus is BMP-only so JavaScript UTF-16 indices "
                "and Python code point indices coincide."
            ),
        },
        "generated_by": "scripts/gen_reference_fixtures.py",
        "abbreviations": [
            {
                "key": entry.key,
                "legislation_no": entry.legislation_no,
                "canonical_name": entry.canonical_name,
                "mulga": entry.mulga,
                "variants": list(entry.variants),
            }
            for entry in ABBREVIATIONS
        ],
        "cases": serialized,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    total_refs = sum(len(case["expected"]) for case in serialized)
    print(
        f"wrote {OUT_PATH} ({len(serialized)} cases, {total_refs} references, "
        f"{len(ABBREVIATIONS)} abbreviations)"
    )


if __name__ == "__main__":
    main()

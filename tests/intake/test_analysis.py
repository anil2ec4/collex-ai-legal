# -*- coding: utf-8 -*-
"""W14 B-37 — quality of the heuristic document preview.

Two independent lanes measured the same four defects on real fixtures, and
each one is a thing a lawyer sees on the FIRST screen after an upload:

* UXAUDIT: all seven entries in "TARİHLER" started or ended mid-word;
  "TALEPLER" missed the numbered SONUÇ VE İSTEM items (fesih, tahliye,
  148.500 TL) and reported two subordinate clauses instead; "ATIFLAR"
  listed the LEASE'S OWN article numbers as if they were statute articles,
  and split `TBK m. 315` from a later bare `m. 315` into two authorities.
* DAILYFLOW: `kira_sozlesmesi.txt` reported NO client although
  "KİRAYA VEREN: Ali Yılmaz" is written in plain sight; `ihtarname.docx`
  listed the same attorney twice (W12-FIX2 de-duplicated `references` and
  `dates` and never came back for `parties`); "İHTAR EDEN" and "MUHATAP"
  were never recognised at all.

Everything here is pure: regexes over text, no database, no network.
"""

from __future__ import annotations

import pytest

from intake.analysis import (
    CONTEXT_ELLIPSIS,
    DATE_CONTEXT_RADIUS,
    analyze,
    context_window,
    extract_claims,
    extract_dates,
    extract_demand_items,
    extract_parties,
    split_references,
)

KIRA_SOZLESMESI = """KİRA SÖZLEŞMESİ

KİRAYA VEREN: Ali Yılmaz
KİRACI: Mehmet Demir
KİRACI VEKİLİ: Av. Ayşe Kaya

Madde 1 - Kiralanan taşınmaz İzmir ili Konak ilçesinde bulunmaktadır.
Madde 3 - Kira bedeli aylık 12.500 TL olarak kararlaştırılmıştır.
Madde 7 - Tahliye taahhüdü ayrıca düzenlenmiştir.

Sözleşme 12.05.2024 tarihinde imzalanmış ve 01.06.2024 tarihinde
yürürlüğe girmiştir.
"""

IHTARNAME = """İHTARNAME

İHTAR EDEN: Zeynep Ak
İHTAR EDEN VEKİLİ: Av. Ayşe Kaya
MUHATAP: Mehmet Demir

Sayın Muhatap,

Müvekkilim adına, Av. Ayşe Kaya olarak, TBK m. 315 uyarınca temerrüt
ihtarında bulunuyoruz. Aynı kanunun m. 315 hükmü otuz günlük süre
öngörmektedir. Ödeme 15.03.2026 tarihine kadar yapılmalıdır.
"""

DILEKCE = """İZMİR 3. SULH HUKUK MAHKEMESİ'NE

DAVACI: Ali Yılmaz
DAVACI VEKİLİ: Av. Ayşe Kaya
DAVALI: Mehmet Demir

AÇIKLAMALAR

Müvekkil ile davalı arasında 12.05.2024 tarihli kira sözleşmesi vardır.
TBK m. 315 uyarınca ihtar keşide edilmiştir.

SONUÇ VE İSTEM:
1- Kira sözleşmesinin feshine, 2- Taşınmazın tahliyesine, 3- 148.500 TL
kira alacağının davalıdan tahsiline karar verilmesini talep ederiz.
"""


# ---------------------------------------------------------------------------
# parties
# ---------------------------------------------------------------------------

def test_a_lease_yields_BOTH_the_landlord_and_the_tenant():
    """DAILYFLOW's finding: 'KİRAYA VEREN: Ali Yılmaz' produced no party at
    all, because the label is TWO WORDS and the pattern only ever matched
    single-word role labels. A lease with no landlord is not a preview."""
    parties = extract_parties(KIRA_SOZLESMESI)
    by_name = {p["name"]: p for p in parties}
    assert "Ali Yılmaz" in by_name, f"landlord missing from {parties}"
    assert by_name["Ali Yılmaz"]["role"] == "kiralayan"
    assert "Mehmet Demir" in by_name
    assert by_name["Mehmet Demir"]["role"] == "kiracı"


def test_turkish_notice_roles_are_recognised():
    parties = {p["name"]: p.get("role") for p in extract_parties(IHTARNAME)}
    assert parties.get("Zeynep Ak") == "ihtar eden"
    assert parties.get("Mehmet Demir") == "muhatap"


def test_the_same_attorney_appears_exactly_ONCE():
    """The header line and the free-text 'Av. …' rule find the same person;
    de-duplication used to key on (name, role) and let both through."""
    names = [p["name"] for p in extract_parties(IHTARNAME)]
    kaya = [n for n in names if "Ayşe Kaya" in n]
    assert len(kaya) == 1, f"the vekil is listed {len(kaya)} times: {names}"
    assert len(names) == len(set(names))

    # Same rule inside a dilekçe, where the vekil is named on a compound
    # label ("DAVACI VEKİLİ") and again in the body.
    dilekce_names = [p["name"] for p in extract_parties(DILEKCE)]
    assert len([n for n in dilekce_names if "Ayşe Kaya" in n]) == 1


def test_a_compound_label_resolves_to_its_last_role_word():
    parties = {p["name"]: p.get("role") for p in extract_parties(DILEKCE)}
    assert parties.get("Ali Yılmaz") == "davacı"
    assert parties.get("Mehmet Demir") == "davalı"
    # "DAVACI VEKİLİ: Av. Ayşe Kaya" — the person named is the vekil.
    assert parties.get("Av. Ayşe Kaya") == "vekil"


# ---------------------------------------------------------------------------
# date context — word boundaries
# ---------------------------------------------------------------------------

def _starts_or_ends_mid_word(context: str, text: str) -> bool:
    body = context.strip()
    if body.startswith(CONTEXT_ELLIPSIS):
        body = body[len(CONTEXT_ELLIPSIS):].strip()
    if body.endswith(CONTEXT_ELLIPSIS):
        body = body[: -len(CONTEXT_ELLIPSIS)].strip()
    if not body:
        return True
    head = body.split(" ", 1)[0]
    tail = body.rsplit(" ", 1)[-1]
    # Every leading and trailing token must appear as a WHOLE word in the
    # source: a mid-word cut produces a fragment that does not.
    words = set(text.split())
    normalized = {w.strip(".,;:()[]\"'") for w in words} | words
    return not (
        any(head == w or head.strip(".,;:()[]\"'") == w for w in normalized)
        and any(tail == w or tail.strip(".,;:()[]\"'") == w for w in normalized)
    )


@pytest.mark.parametrize("document", [KIRA_SOZLESMESI, IHTARNAME, DILEKCE])
def test_no_date_context_starts_or_ends_mid_word(document: str):
    """UXAUDIT measured 7/7 contexts broken mid-word ('… SONUÇ VE İSTE')."""
    dates = extract_dates(document)
    assert dates, "fixture has no dates"
    for entry in dates:
        assert not _starts_or_ends_mid_word(entry["context"], document), (
            f"context cut mid-word: {entry['context']!r}"
        )


def test_context_window_marks_truncation_and_never_grows_past_the_radius():
    text = "birinci ikinci ucuncu ONHEDEF dorduncu besinci altinci"
    start = text.index("ONHEDEF")
    window = context_window(text, start, start + len("ONHEDEF"), 8)
    assert "ONHEDEF" in window
    assert window.startswith(CONTEXT_ELLIPSIS)
    assert window.endswith(CONTEXT_ELLIPSIS)
    # Shrunk to boundaries, so it can never be LONGER than match + 2*radius.
    assert len(window) <= len("ONHEDEF") + 2 * 8 + 2 * (len(CONTEXT_ELLIPSIS) + 1)


def test_a_short_document_context_is_not_marked_as_truncated():
    text = "Sözleşme 12.05.2024 tarihlidir."
    (entry,) = extract_dates(text)
    assert CONTEXT_ELLIPSIS not in entry["context"]
    assert entry["context"] == "Sözleşme 12.05.2024 tarihlidir."


def test_the_radius_is_still_the_documented_one():
    assert DATE_CONTEXT_RADIUS == 40


# ---------------------------------------------------------------------------
# references — three buckets
# ---------------------------------------------------------------------------

def test_contract_clause_numbers_are_NOT_legal_references():
    """A lease's own 'Madde 3' listed under ATIFLAR reads as TBK m. 3."""
    matched, ambiguous = split_references(KIRA_SOZLESMESI)
    assert matched == [], f"a lease clause was presented as a citation: {matched}"
    raws = [entry["raw"] for entry in ambiguous]
    assert "Madde 1" in raws and "Madde 3" in raws and "Madde 7" in raws


def test_a_short_form_resolves_from_context_and_MERGES_with_the_full_form():
    """'TBK m. 315' and a later bare 'm. 315' are ONE authority, not two."""
    matched, ambiguous = split_references(IHTARNAME)
    assert len(matched) == 1, f"expected one authority, got {matched}"
    entry = matched[0]
    assert entry["legislationNo"] == "6098"
    assert entry["articleNo"] == "315"
    assert entry["count"] == 2
    assert ambiguous == []


def test_a_short_form_does_not_cross_a_paragraph_break():
    """A bare article number three paragraphs below a law is not that law's
    article — that is how a lease's clause numbers would be laundered into
    citations again."""
    text = (
        "TBK m. 315 uyarınca ihtar gönderilmiştir.\n"
        "\n"
        "Madde 3 - Kira bedeli aylık 12.500 TL olarak kararlaştırılmıştır.\n"
    )
    matched, ambiguous = split_references(text)
    assert [e["articleNo"] for e in matched] == ["315"]
    assert [e["articleNo"] for e in ambiguous] == ["3"]


def test_the_three_buckets_are_reported_separately_by_analyze():
    analysis, _warnings = analyze(KIRA_SOZLESMESI)
    assert analysis["references"] == []            # eşleşti: none
    assert analysis["referencesAmbiguous"]          # belirsiz: the clauses
    # bulunamadı = both empty; a document with neither says so through the
    # few-signals warning rather than looking confidently empty.
    empty, warnings = analyze("Sadece düz bir cümle.")
    assert empty["references"] == [] and empty["referencesAmbiguous"] == []
    assert warnings


# ---------------------------------------------------------------------------
# claims — the numbered SONUÇ VE İSTEM block
# ---------------------------------------------------------------------------

def test_numbered_demand_items_are_captured_individually():
    """The operative part of a petition. The sentence splitter used to
    swallow the whole block as one 'claim' because the items are separated
    by commas, not full stops."""
    items = extract_demand_items(DILEKCE)
    assert [item["ordinal"] for item in items] == [1, 2, 3]
    texts = [item["text"] for item in items]
    assert "Kira sözleşmesinin feshine" in texts[0]
    assert "tahliyesine" in texts[1]
    assert "148.500 TL" in texts[2]
    assert all(item["source"] == "heuristic" for item in items)
    assert all(item["fromDemandBlock"] for item in items)


def test_the_demand_items_lead_the_claims_and_are_not_duplicated():
    claims = extract_claims(DILEKCE)
    assert claims[:3] == extract_demand_items(DILEKCE)
    texts = [c["text"] for c in claims]
    assert len(texts) == len(set(texts))
    # No claim is the whole block re-wrapped.
    assert not any(len(t) > 250 for t in texts), texts


def test_a_document_without_a_demand_block_still_finds_talep_sentences():
    text = "Müvekkil, kira alacağının tahsilini talep etmektedir."
    assert extract_demand_items(text) == []
    claims = extract_claims(text)
    assert len(claims) == 1
    assert claims[0]["source"] == "heuristic"
    assert "ordinal" not in claims[0]

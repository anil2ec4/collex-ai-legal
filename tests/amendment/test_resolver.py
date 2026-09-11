# tests/amendment/test_resolver.py
"""Curated resolver tests per brief 6.8.

Covers: (a) single explicit target, (b) similar numbers disambiguated by
name, (c) torba kanun with three targets, (d) mülga target flagged but still
resolved, (e) geçici/ek article parsing on the resolver path, (f) as_of
pass-through, (g) the amending-law-id negative test, plus ambiguous/abstain/
not_found decisions (never a silent pick).
"""

from datetime import date

import pytest

from legal_reference.parser import ParsedReference
from legal_reference.resolver import AmendmentTargetResolver

pytestmark = pytest.mark.asyncio


class TestSingleExplicitTarget:
    async def test_resolves_single_target(self, resolver):
        result = await resolver.resolve(
            "5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci "
            "fıkrası aşağıdaki şekilde değiştirilmiştir."
        )
        assert len(result.targets) == 1
        target = result.targets[0]
        assert target.decision == "resolved"
        assert target.selected is not None
        assert target.selected.candidate.mevzuat_id == "mv-5237"
        assert target.selected.confidence >= 0.85
        assert target.is_mulga is False

    async def test_confidence_components_are_exposed(self, resolver):
        result = await resolver.resolve(
            "5237 sayılı Türk Ceza Kanununun 157 nci maddesi değiştirilmiştir."
        )
        components = result.targets[0].selected.components
        assert components.number_match == 1.0
        assert components.name_similarity > 0.85
        assert components.type_match == 1.0
        assert 0.0 <= components.date_plausibility <= 1.0
        assert "number_match" in components.used
        assert "name_similarity" in components.used

    async def test_article_attached_to_target(self, resolver):
        result = await resolver.resolve(
            "5237 sayılı Türk Ceza Kanununun 157 nci maddesi değiştirilmiştir."
        )
        arts = result.targets[0].article_refs
        assert [a.article_no for a in arts] == ["157"]


class TestSimilarNumbersDisambiguateByName:
    async def test_name_separates_6102_from_6112(self, resolver, fake_port):
        # The fake port deliberately returns the near-number 6112 (RTÜK law)
        # alongside 6102 (TTK); the name must decide, with a clear margin.
        result = await resolver.resolve(
            "6102 sayılı Türk Ticaret Kanununun 4 üncü maddesi değiştirilmiştir."
        )
        target = result.targets[0]
        candidate_ids = {sc.candidate.mevzuat_id for sc in target.candidates}
        assert "mv-6112" in candidate_ids  # the confusable near-number was seen
        assert target.decision == "resolved"
        assert target.selected.candidate.mevzuat_id == "mv-6102"
        by_id = {sc.candidate.mevzuat_id: sc for sc in target.candidates}
        assert by_id["mv-6102"].confidence - by_id["mv-6112"].confidence > 0.3


class TestTorbaKanun:
    TORBA = (
        "MADDE 1 – 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci "
        "fıkrası aşağıdaki şekilde değiştirilmiştir.\n"
        "MADDE 2 – 6098 sayılı Türk Borçlar Kanununun 344 üncü maddesine bir "
        "fıkra eklenmiştir.\n"
        "MADDE 3 – 2004 sayılı İcra ve İflas Kanununun geçici 11 inci maddesi "
        "yürürlükten kaldırılmıştır.\n"
    )

    async def test_three_targets_three_resolutions(self, resolver):
        result = await resolver.resolve(self.TORBA)
        assert len(result.targets) == 3
        resolved_ids = [t.selected.candidate.mevzuat_id for t in result.targets]
        assert resolved_ids == ["mv-5237", "mv-6098", "mv-2004"]
        assert all(t.decision == "resolved" for t in result.targets)

    async def test_each_target_gets_its_own_articles(self, resolver):
        result = await resolver.resolve(self.TORBA)
        articles = [
            [(a.article_kind, a.article_no) for a in t.article_refs]
            for t in result.targets
        ]
        assert articles == [
            [("madde", "157")],
            [("madde", "344")],
            [("geçici", "11")],
        ]

    async def test_instrument_headers_not_attached(self, resolver):
        # "MADDE 1/2/3 –" number the amending instrument, not the targets.
        result = await resolver.resolve(self.TORBA)
        for target in result.targets:
            assert all(a.raw[:5] != "MADDE" for a in target.article_refs)


class TestMulgaTarget:
    async def test_repealed_target_flagged_but_resolved(self, resolver):
        result = await resolver.resolve(
            "765 sayılı Türk Ceza Kanununun 480 inci maddesi değiştirilmiştir."
        )
        target = result.targets[0]
        # A historical amendment still resolves to the historical target...
        assert target.decision == "resolved"
        assert target.selected.candidate.mevzuat_id == "mv-765"
        # ...but the repeal is flagged, never hidden.
        assert target.is_mulga is True
        assert any("mülga" in note for note in target.notes)


class TestGeciciEkOnResolverPath:
    async def test_gecici_article_reaches_target(self, resolver):
        result = await resolver.resolve(
            "2004 sayılı İcra ve İflas Kanununun geçici 11 inci maddesi "
            "yürürlükten kaldırılmıştır."
        )
        target = result.targets[0]
        assert target.decision == "resolved"
        assert [(a.article_kind, a.article_no) for a in target.article_refs] == [
            ("geçici", "11")
        ]

    async def test_ek_article_reaches_target(self, resolver):
        result = await resolver.resolve(
            "5271 sayılı Ceza Muhakemesi Kanununa ek madde 5 eklenmiştir."
        )
        target = result.targets[0]
        assert target.selected.candidate.mevzuat_id == "mv-5271"
        assert [(a.article_kind, a.article_no) for a in target.article_refs] == [
            ("ek", "5")
        ]


class TestAsOfInterface:
    """as_of is accepted and passed through (brief 6.8 / task f).

    Phase 1 scope: the date reaches the SearchPort and the result, and feeds
    the date_plausibility component. Actual per-version selection uses real
    document_versions data that arrives with Phase 2 ingestion.
    """

    async def test_as_of_accepted_and_passed_through(self, resolver, fake_port):
        as_of = date(2010, 6, 1)
        result = await resolver.resolve(
            "5237 sayılı Türk Ceza Kanununun 157 nci maddesi değiştirilmiştir.",
            as_of=as_of,
        )
        assert result.as_of == as_of
        assert result.targets[0].as_of == as_of
        assert fake_port.calls, "resolver must query the port"
        assert all(call["as_of"] == as_of for call in fake_port.calls)

    async def test_as_of_disambiguates_old_vs_new_same_name(self, resolver):
        # Deliberately confusable pair: old (6762, mülga) and new (6102) TTK
        # share the exact same name. Without as_of this is ambiguous; with a
        # 2015 as_of the repealed law's effective period rules it out.
        ref = ParsedReference(
            kind="legislation", raw="Türk Ticaret Kanunu", name="Türk Ticaret Kanunu"
        )
        without = await resolver.resolve_reference(ref)
        assert without.decision == "ambiguous"
        assert without.selected is None  # NO silent pick
        top_ids = {sc.candidate.mevzuat_id for sc in without.candidates[:2]}
        assert top_ids == {"mv-6102", "mv-6762"}

        with_date = await resolver.resolve_reference(ref, as_of=date(2015, 1, 1))
        assert with_date.decision == "resolved"
        assert with_date.selected.candidate.mevzuat_id == "mv-6102"


class TestAmendingLawNegative:
    """(g) The known real-world bug: never search on the amending law's id."""

    TEXT = (
        "7418 sayılı Kanunun 29 uncu maddesiyle 5651 sayılı İnternet "
        "Ortamında Yapılan Yayınların Düzenlenmesi ve Bu Yayınlar Yoluyla "
        "İşlenen Suçlarla Mücadele Edilmesi Hakkında Kanunun 8 inci maddesi "
        "değiştirilmiştir."
    )

    async def test_amending_law_is_not_a_target_and_never_queried(
        self, resolver, fake_port
    ):
        result = await resolver.resolve(
            self.TEXT, amending_legislation_no="7418"
        )
        # Exactly one target: the actual amended law, not the amending one.
        assert len(result.targets) == 1
        target = result.targets[0]
        assert target.decision == "resolved"
        assert target.selected.candidate.mevzuat_id == "mv-5651"
        # The port must never have been asked for the amending law's number.
        assert all(call["legislation_no"] != "7418" for call in fake_port.calls)
        # The amending law never appears among the candidates either.
        assert all(
            sc.candidate.legislation_no != "7418" for sc in target.candidates
        )
        # The self-reference is surfaced as a note, not silently dropped.
        assert any("7418" in note for note in result.notes)

    async def test_self_reference_still_visible_in_parsed_references(
        self, resolver
    ):
        result = await resolver.resolve(
            self.TEXT, amending_legislation_no="7418"
        )
        parsed_numbers = {
            r.legislation_no
            for r in result.references
            if r.kind == "legislation"
        }
        assert parsed_numbers == {"7418", "5651"}


class TestAbbreviationResolution:
    """P1: an abbreviation hit is an EXACT match, never an abstain.

    Before the abbreviation table existed, a reference carrying only
    name="TCK" scored 0.32 and abstained, so the most common Turkish citation
    form fell out of the exact-reference lane entirely.
    """

    async def test_name_only_abbreviation_resolves_exactly(self, resolver):
        ref = ParsedReference(kind="legislation", raw="TCK", name="TCK")
        result = await resolver.resolve_reference(ref)
        assert result.decision == "resolved"
        assert result.selected.candidate.mevzuat_id == "mv-5237"
        assert result.selected.confidence >= 0.85
        assert any("TCK" in note for note in result.notes)

    async def test_abbreviation_is_not_treated_as_a_generic_name(self, resolver):
        ref = ParsedReference(kind="legislation", raw="TCK", name="TCK")
        result = await resolver.resolve_reference(ref)
        assert "name_similarity" in result.selected.components.used

    async def test_parsed_abbreviation_text_resolves_end_to_end(self, resolver):
        result = await resolver.resolve("TCK'nın 157. maddesi değiştirilmiştir.")
        assert len(result.targets) == 1
        target = result.targets[0]
        assert target.decision == "resolved"
        assert target.selected.candidate.mevzuat_id == "mv-5237"
        assert [a.article_no for a in target.article_refs] == ["157"]

    async def test_keyword_less_shorthand_resolves(self, resolver):
        result = await resolver.resolve("TBK 49 uyarınca sorumluluk doğar.")
        target = result.targets[0]
        assert target.decision == "resolved"
        assert target.selected.candidate.mevzuat_id == "mv-6098"
        assert [a.article_no for a in target.article_refs] == ["49"]

    async def test_port_is_queried_with_the_resolved_number(self, resolver, fake_port):
        ref = ParsedReference(kind="legislation", raw="İİK", name="İİK")
        await resolver.resolve_reference(ref)
        assert any(call["legislation_no"] == "2004" for call in fake_port.calls)

    async def test_mulga_abbreviation_is_flagged_before_resolution(self, resolver):
        result = await resolver.resolve("eski TTK m. 5 uygulanır.")
        target = result.targets[0]
        assert target.is_mulga is True
        assert any("mülga" in note for note in target.notes)
        # ...and it still resolves to the HISTORICAL law, not the current one.
        assert target.selected.candidate.mevzuat_id == "mv-6762"

    async def test_mulga_flag_survives_even_without_a_selection(self, resolver):
        # Unknown historical instrument: nothing to select, but the caller must
        # still learn the reference is historical.
        ref = ParsedReference(kind="legislation", raw="CMUK", name="CMUK")
        result = await resolver.resolve_reference(ref)
        assert result.is_mulga is True
        assert any("mülga" in note for note in result.notes)


class TestNoSilentGuess:
    async def test_unknown_number_is_not_found(self, resolver):
        result = await resolver.resolve(
            "9999 sayılı Hayali Kanunun 1 inci maddesi değiştirilmiştir."
        )
        target = result.targets[0]
        assert target.decision == "not_found"
        assert target.selected is None
        assert target.candidates == []

    async def test_near_number_without_name_abstains(self, resolver):
        # 6104 does not exist; the port near-matches 6102, but a number
        # mismatch with no distinctive name must abstain, not guess.
        result = await resolver.resolve(
            "6104 sayılı Kanunun 3 üncü maddesi değiştirilmiştir."
        )
        target = result.targets[0]
        assert target.decision == "abstain"
        assert target.selected is None
        assert target.candidates  # candidates are surfaced for manual review
        assert all(sc.confidence < 0.85 for sc in target.candidates)

    async def test_no_reference_text_yields_no_targets(self, resolver):
        result = await resolver.resolve("Bugün hava çok güzel.")
        assert result.targets == []
        assert any("No target" in note for note in result.notes)

    async def test_non_legislation_reference_rejected(self, resolver):
        ref = ParsedReference(kind="article", raw="m. 5", article_no="5")
        with pytest.raises(ValueError):
            await resolver.resolve_reference(ref)

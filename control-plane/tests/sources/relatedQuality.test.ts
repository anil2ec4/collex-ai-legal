/**
 * W17 — the four quality defects a LIVE run exposed, and the guards that keep
 * them closed.
 *
 * On 05.09.2026 the "olayı anlat → ilgili kararlar" flow was run against the
 * real official sources with this account:
 *
 *   "Müvekkil kiracı, işyeri kirasını iki ay üst üste ödemedi. Kiralayan
 *    noterden ihtarname gönderdi ve otuz gün içinde ödenmemesi üzerine tahliye
 *    davası açtı. Kiracı ödemede temerrüde düşmediğini, ihtarnamenin usulsüz
 *    tebliğ edildiğini savunuyor."
 *
 * It answered in 46 s with 63 rows whose top entries were **Danıştay Vergi
 * Dava Daireleri Kurulu** and **Yargıtay 8. Ceza Dairesi** — for a rental
 * eviction file. Four causes, all measured:
 *
 *   1. only ONE concept fired out of 164 (the generic "kira"), because a
 *      concept fired only when its KEY appeared verbatim;
 *   2. the queries that went out were bare single words ("kira", "tahliye"),
 *      which every archive answers;
 *   3. MUTABAKAT counted QUERIES, so three phrasings of one subject looked
 *      like three independent agreements;
 *   4. the administrative archive was searched for a private-law file.
 *
 * After the fix the same account produced six specific queries, all six ran
 * (33 s), Danıştay was left out with a written reason, and Yargıtay's kira
 * chambers (3. and 6. HD) reached the first seven rows. These tests hold each
 * of those four properties in place.
 */

import { describe, expect, it } from "vitest";

import { analyzeIntake } from "../../src/planner/intake.js";
import {
  buildRelatedQueries,
  compareRelatedRows,
  narrowSourcesByAnchors,
  type OrderableRow,
} from "../../src/sources/relatedSearch.js";

/** The account, verbatim, exactly as it was sent to the live sources. */
const OLAY =
  "Müvekkil kiracı, işyeri kirasını iki ay üst üste ödemedi. Kiralayan noterden" +
  " ihtarname gönderdi ve otuz gün içinde ödenmemesi üzerine tahliye davası açtı." +
  " Kiracı ödemede temerrüde düşmediğini, ihtarnamenin usulsüz tebliğ edildiğini" +
  " savunuyor.";

function issuesOf(question: string) {
  return analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" }).issues;
}

describe("W17 (1) — the account's own institution is recognised", () => {
  it("fires 'temerrüt nedeniyle tahliye', not only the generic 'kira'", () => {
    const labels = issuesOf(OLAY).map((i) => i.label);
    expect(labels).toContain("temerrüt nedeniyle tahliye");
    // The generic concept may still fire; what may not happen is it firing ALONE.
    expect(labels.indexOf("temerrüt nedeniyle tahliye")).toBeLessThan(
      labels.includes("kira") ? labels.indexOf("kira") : Number.MAX_SAFE_INTEGER,
    );
  });

  it("does not read 'ihtarname' as 'temerrüt faizi'", () => {
    // An earlier attempt fired concepts on any expansion term, and "ihtar" —
    // a term of "temerrüt faizi" — matched the word "ihtarname". A rental
    // eviction file is not an interest claim.
    expect(issuesOf(OLAY).map((i) => i.label)).not.toContain("temerrüt faizi");
  });

  it("still fires nothing on the decoys", () => {
    for (const decoy of [
      "yağmur suyu giderleri kime ait",
      "gerçekten böyle bir belge var mı",
      "abonelik başvurusu nasıl yapılır",
    ]) {
      const conceptual = issuesOf(decoy).filter((i) => i.concept !== undefined);
      // The fallback issue is the raw question, not a recognised concept.
      expect(conceptual.every((i) => i.label === i.concept && i.expandedTerms.length === 1)).toBe(
        true,
      );
    }
  });
});

describe("W17 (2) — no query is a bare generic word", () => {
  const built = buildRelatedQueries(OLAY, 8);

  it("generates only queries that carry more than one word", () => {
    expect(built.queries.length).toBeGreaterThan(0);
    for (const q of built.queries) {
      expect(q.text.trim().split(/\s+/u).length, q.text).toBeGreaterThan(1);
    }
  });

  it("never emits 'kira' or 'tahliye' on their own", () => {
    const texts = built.queries.map((q) => q.text.trim());
    expect(texts).not.toContain("kira");
    expect(texts).not.toContain("tahliye");
  });

  it("ties a one-word concept to its recorded statutory anchor", () => {
    // "kira" has an anchor in the table, so it survives as "kira TBK m.299"
    // rather than disappearing: the concept is still searched, just not alone.
    expect(built.queries.some((q) => /^kira\s+TBK/u.test(q.text))).toBe(true);
  });
});

describe("W17 (3) — agreement counts SUBJECTS before phrasings", () => {
  const base: OrderableRow = {
    kararId: "yargitay::a",
    sourceId: "yargitay",
    merci: "Yargıtay",
    provider: "BEDESTEN",
    externalId: "a",
    title: "a",
    bulanSorgular: ["s1"],
    mutabakat: 1,
    bulanKonular: ["i1"],
    konuMutabakati: 1,
    kaynakSirasi: 1,
    merciAgirligi: 0,
    siralamaTarihi: "2020-01-01",
  };

  it("puts two subjects above three phrasings of one subject", () => {
    const twoSubjects = { ...base, kararId: "yargitay::b", konuMutabakati: 2, mutabakat: 2 };
    const threePhrasings = { ...base, konuMutabakati: 1, mutabakat: 3 };
    expect(compareRelatedRows(twoSubjects, threePhrasings)).toBeLessThan(0);
  });

  it("uses the source's own rank before the decision date", () => {
    const sourceFirstButOlder = { ...base, kaynakSirasi: 1, siralamaTarihi: "2019-01-01" };
    const sourceFifthButNewer = {
      ...base,
      kararId: "yargitay::c",
      kaynakSirasi: 5,
      siralamaTarihi: "2026-07-01",
    };
    expect(compareRelatedRows(sourceFirstButOlder, sourceFifthButNewer)).toBeLessThan(0);
  });

  it("stays a total, deterministic order", () => {
    const rows: OrderableRow[] = [
      { ...base, kararId: "yargitay::z" },
      { ...base, kararId: "yargitay::a" },
      { ...base, kararId: "yargitay::m" },
    ];
    const once = [...rows].sort(compareRelatedRows).map((r) => r.kararId);
    const twice = [...rows].reverse().sort(compareRelatedRows).map((r) => r.kararId);
    expect(once).toEqual(twice);
  });
});

describe("W17 (4) — the archive is chosen by the statute, and it is said out loud", () => {
  it("leaves the administrative archive out of a TBK/İİK file", () => {
    const narrowed = narrowSourcesByAnchors(issuesOf(OLAY));
    expect(narrowed).toBeDefined();
    expect(narrowed!.family).toBe("adli");
    expect(narrowed!.sources).toEqual(["yargitay"]);
    // The note is read by a lawyer, so it carries the source NAME, not its id.
    expect(narrowed!.dropped).toContain("Danıştay");
  });

  it("narrows nothing when the statutes disagree", () => {
    const mixed = [
      { issueId: "i1", kind: "conceptual" as const, label: "a", material: true, expandedTerms: ["a"], anchors: ["TBK m.1"] },
      { issueId: "i2", kind: "conceptual" as const, label: "b", material: true, expandedTerms: ["b"], anchors: ["2577 s.K. m.7"] },
    ];
    expect(narrowSourcesByAnchors(mixed)).toBeUndefined();
  });

  it("narrows nothing when a statute is not in the table", () => {
    const unknown = [
      { issueId: "i1", kind: "conceptual" as const, label: "a", material: true, expandedTerms: ["a"], anchors: ["Bilinmeyen K. m.1"] },
    ];
    // Searching too widely is a nuisance; searching the wrong archive and
    // calling the list complete is a lie. Uncertainty widens, never narrows.
    expect(narrowSourcesByAnchors(unknown)).toBeUndefined();
  });

  it("narrows nothing when the concept recorded no anchor", () => {
    const noAnchor = [
      { issueId: "i1", kind: "conceptual" as const, label: "a", material: true, expandedTerms: ["a"] },
    ];
    expect(narrowSourcesByAnchors(noAnchor)).toBeUndefined();
  });
});

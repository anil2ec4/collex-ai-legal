/**
 * W14 L-FIX — B-13's resolver, and the line it must not cross.
 *
 * The Atıf Denetim Raporu shipped in phase A with `UNWIRED_RESOLVER`: every
 * row said "belirsiz", so the report could not do the one thing it exists for
 * — tell a real künye from an invented one. These tests pin the wired
 * resolver's verdicts AND the honesty rule that bounds them.
 *
 * No database: the single corpus call is injected through the resolver's
 * `lookup` seam. The corpus-backed behaviour itself was measured over real
 * HTTP against collex_demo (see docs/implementation/waves/W14-L-FIX.md).
 */

import { describe, expect, it } from "vitest";
import {
  REASON_COURT_DECISION,
  REASON_LAW_OUT_OF_SCOPE,
  REASON_SHORT_FORM,
  REASON_STORE_UNAVAILABLE,
  REASON_UNPARSED,
  absentArticleNote,
  createCorpusCitationResolver,
  type PinLookup,
} from "../../src/contracts/corpusResolver.js";
import {
  auditCitations,
  extractAuditCitations,
  pairArticlesWithTheirLaw,
} from "../../src/contracts/citationAudit.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";
import type { ChunkProvenance } from "../../src/store/chunkStore.js";
import type { AuditCitation } from "../../src/contracts/citationAudit.js";

const AS_OF = "2026-06-01";
const NOW = () => new Date("2026-09-02T10:00:00.000Z");

/** One pinned chunk, in the shape the lanes hand back (ChunkProvenance). */
function chunkRow(over: Partial<ChunkProvenance> = {}): ChunkProvenance {
  return {
    chunkId: "c1",
    documentVersionId: "v1",
    documentId: "d1",
    ordinal: 0,
    articleNo: "157",
    paragraphNo: null,
    structuralPath: ["madde-157"],
    startChar: 0,
    endChar: 10,
    originalText: "Sentetik madde metni.",
    chunkSha256: "a".repeat(64),
    versionSha256: "b".repeat(64),
    normalizerVersion: "trnorm-v1",
    title: "Türk Ceza Kanunu (SENTETİK)",
    source: "MEVZUAT",
    externalId: "kanun-5237",
    canonicalSourceUrl: null,
    documentType: "kanun",
    legislationNo: "5237",
    docketNo: null,
    decisionNo: null,
    decisionDate: null,
    publicationDate: null,
    tokenCount: 3,
    scope: "public",
    ...over,
  };
}

/**
 * A canned pin lookup: `answers` is consumed in order, one entry per call the
 * resolver makes. Injected through the `lookup` seam rather than through a
 * fake `Sql`, because `exactPinLookup` composes its query out of postgres.js
 * FRAGMENTS — a fake tag is called to build the query as well as to run it,
 * so a queue of canned rows would be drained by query construction and the
 * test would measure the fake. The corpus-backed path itself is measured
 * over real HTTP (see docs/implementation/waves/W14-L-FIX.md).
 */
function fakeLookup(
  answers: Array<ChunkProvenance[]> | (() => never),
): PinLookup {
  if (typeof answers === "function") {
    return async () => answers();
  }
  const queue = [...answers];
  return async () =>
    (queue.shift() ?? []).map((provenance) => ({ provenance }));
}

function citationOf(text: string): AuditCitation {
  const found = extractAuditCitations(text);
  return found[found.length - 1] as AuditCitation;
}

describe("B-13 · pairing a bare article with its law", () => {
  it("gives 'm. 157' the 5237 that precedes it", () => {
    const paired = pairArticlesWithTheirLaw(
      parseReferences("5237 sayılı Kanun m. 157 uyarınca"),
    );
    const article = paired.find((r) => r.kind === "article");
    expect(article?.legislationNo).toBe("5237");
    // W17: the paired row now stands for the WHOLE citation, because the
    // separate law row is dropped once an article claims it. It therefore
    // reads the way the document wrote it — an article with no statute would
    // send the lawyer looking for "m. 157" of nothing.
    expect(article?.raw).toBe("5237 sayılı Kanun m. 157");
    // And the law is no longer a citation of its own.
    expect(paired.filter((r) => r.kind === "legislation")).toHaveLength(0);
  });

  it("keeps a law cited WITHOUT an article as its own citation", () => {
    const paired = pairArticlesWithTheirLaw(parseReferences("6100 sayılı Kanun uyarınca"));
    expect(paired.filter((r) => r.kind === "legislation")).toHaveLength(1);
  });

  it("a new law ends the run, so the next article belongs to the new law", () => {
    const paired = pairArticlesWithTheirLaw(
      parseReferences("6098 sayılı Kanun m. 299 ile 5237 sayılı Kanun m. 157"),
    );
    const articles = paired.filter((r) => r.kind === "article");
    expect(articles.map((a) => a.legislationNo)).toEqual(["6098", "5237"]);
  });

  it("an article with no law before it is left alone", () => {
    const paired = pairArticlesWithTheirLaw(parseReferences("m. 157 uyarınca"));
    expect(paired.find((r) => r.kind === "article")?.legislationNo).toBeUndefined();
  });
});

describe("B-13 · the corpus resolver's verdicts", () => {
  it("resolves an article of a law that is in the corpus", async () => {
    const resolve = createCorpusCitationResolver({ lookup: fakeLookup([[chunkRow()]]) });
    const out = await resolve(citationOf("5237 sayılı Kanun m. 157"), AS_OF);
    expect(out?.kunye).toBe("5237 sayılı Türk Ceza Kanunu (SENTETİK) m. 157");
    expect(out?.currency).toBe("IN_FORCE");
    expect(out?.documentVersionId).toBe("v1");
  });

  it("a court decision that misses is belirsiz — NEVER bulunamadı", async () => {
    // Holding SOME decisions of a chamber is not holding all of them.
    const resolve = createCorpusCitationResolver({ lookup: fakeLookup([[]]) });
    const out = await resolve(
      citationOf("Yargıtay 15. CD E. 2024/1187 K. 2024/2356"),
      AS_OF,
    );
    expect(out?.absent).toBeUndefined();
    expect(out?.uncertainReason).toBe(REASON_COURT_DECISION);
  });

  it("a law that is not in the corpus is belirsiz with the scope reason", async () => {
    const resolve = createCorpusCitationResolver({ lookup: fakeLookup([[], []]) });
    const out = await resolve(citationOf("9999 sayılı Kanun m. 3"), AS_OF);
    expect(out?.absent).toBeUndefined();
    expect(out?.uncertainReason).toBe(REASON_LAW_OUT_OF_SCOPE);
  });

  it("an article missing from a law we DO hold is still belirsiz, with the facts", async () => {
    // THE HONESTY LINE. Measured 02.09.2026: the demo corpus holds articles
    // {1, 2, 12, 49, 50, 51} of 6098 — an excerpt. Reporting "bulunamadı"
    // here would have told a lawyer that a real provision looked invented,
    // and nothing in the schema says whether a stored law is whole.
    const resolve = createCorpusCitationResolver({
      lookup: fakeLookup([[], [chunkRow({ legislationNo: "6098", articleNo: "1" })]]),
    });
    const out = await resolve(citationOf("6098 sayılı Kanun m. 5"), AS_OF);
    expect(out?.absent).toBeUndefined();
    expect(out?.uncertainReason).toBe(absentArticleNote("6098", "5"));
    // The sentence says what was read and refuses the conclusion.
    expect(out?.uncertainReason).toContain("bulunamadı");
    expect(out?.uncertainReason).toContain("yalnız bölümlerini taşıyor olabilir");
    expect(out?.uncertainReason).not.toContain("YOK");
  });

  it("an unresolved short form says which sentence to rewrite", async () => {
    const resolve = createCorpusCitationResolver({ lookup: fakeLookup([]) });
    const out = await resolve(
      { raw: "anılan karar", count: 1, parsed: { kind: "short_form", raw: "anılan karar" } },
      AS_OF,
    );
    expect(out?.uncertainReason).toBe(REASON_SHORT_FORM);
  });

  it("a reference the parser could not pin down at all is unparsed", async () => {
    const resolve = createCorpusCitationResolver({ lookup: fakeLookup([]) });
    const out = await resolve({ raw: "ilgili mevzuat", count: 1 }, AS_OF);
    expect(out?.uncertainReason).toBe(REASON_UNPARSED);
  });

  it("a bare article with no statute never becomes a row at all (W17/b)", () => {
    // MEASURED on an icra-itiraz text: "taraflar arasındaki sözleşmenin
    // 5. maddesi uyarınca zaten ödenmiştir" produced the audit row
    // "5. maddesi — belirsiz", telling the lawyer to go verify a provision
    // that is a clause of the parties' OWN contract. An orphan article carries
    // nothing to look up, so the row could only ever be "belirsiz" — noise at
    // best, a false errand at worst. The sentence still stands in the claim
    // text, and now reaches the unsourced pass, which is where it belongs.
    expect(extractAuditCitations("sözleşmenin 5. maddesi uyarınca")).toEqual([]);
    expect(extractAuditCitations("Şartnamenin 12. maddesine göre")).toEqual([]);
    // NON-VACUITY: an article that DOES have its statute is still a row.
    expect(extractAuditCitations("TBK m. 475 uyarınca").map((c) => c.raw)).toEqual([
      "TBK m. 475",
    ]);
  });

  it("an unreachable corpus is belirsiz and says so — never a finding", async () => {
    const resolve = createCorpusCitationResolver({
      lookup: fakeLookup(() => {
        throw new Error("ECONNREFUSED 127.0.0.1:55432");
      }),
    });
    const out = await resolve(citationOf("5237 sayılı Kanun m. 157"), AS_OF);
    expect(out?.absent).toBeUndefined();
    expect(out?.uncertainReason).toBe(REASON_STORE_UNAVAILABLE);
    // The driver's text never reaches the report.
    expect(out?.uncertainReason).not.toContain("ECONNREFUSED");
  });

  it("end to end: a wired report separates resolved rows from unresolved ones", async () => {
    const resolve = createCorpusCitationResolver({
      lookup: fakeLookup([
        [chunkRow({ articleNo: null })], // "5237 sayılı Kanun" (the bare law)
        [chunkRow()], // "m. 157" paired to 5237
        [], // the decision: a miss
      ]),
    });
    const report = await auditCitations(
      {
        text: "5237 sayılı Kanun m. 157 ve Yargıtay 15. CD E. 2024/1187 K. 2024/2356.",
        asOf: AS_OF,
      },
      resolve,
      { now: NOW },
    );
    // Nothing is ever accused.
    expect(report.totals.NOT_FOUND).toBe(0);
    // And the report is no longer uniformly "belirsiz": at least one row
    // carries a real künye, which is what wiring the resolver bought.
    expect(report.rows.some((row) => row.kunye !== "")).toBe(true);
    for (const row of report.rows) {
      if (row.bucket !== "FOUND") expect(row.kunye).toBe("");
    }
  });
});

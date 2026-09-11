/**
 * (f) Property test: over randomized fixture packs, the RuleBasedDrafter
 * NEVER produces a claim without evidenceIds, never cites an id outside the
 * pack, and never invents text beyond quote + citation metadata.
 */

import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  citeLabel,
  type AnswerCandidate,
} from "../../src/answer/evidencePack.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import { tokenize } from "../../src/llm/lexicalEntailment.js";
import { MapTextPort, makeCandidate, mulberry32, spanOf } from "./fixtures.js";

const WORDS = [
  "kasten",
  "öldürme",
  "tazminat",
  "sözleşme",
  "fesih",
  "kira",
  "artış",
  "ceza",
  "hüküm",
  "madde",
  "iptal",
  "karar",
  "mülkiyet",
  "hak",
  "süre",
  "başvuru",
  "5237",
  "6098",
  "81",
  "344",
];

const SOURCES = ["MEVZUAT", "BEDESTEN", "AYM", "KVKK", "REKABET"];
const COURTS = [
  undefined,
  "Yargıtay 4. Hukuk Dairesi",
  "Anayasa Mahkemesi",
  "İstanbul Bölge Adliye Mahkemesi",
  "Danıştay İçtihatları Birleştirme Kurulu",
];
const STANCES = ["supporting", "contrary", "neutral"] as const;

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

function randomText(rand: () => number): string {
  const words: string[] = [];
  const count = 6 + Math.floor(rand() * 30);
  for (let i = 0; i < count; i += 1) words.push(pick(rand, WORDS));
  return words.join(" ");
}

function randomFixture(rand: () => number, run: number): {
  candidates: AnswerCandidate[];
  texts: Map<string, string>;
} {
  const texts = new Map<string, string>();
  const candidates: AnswerCandidate[] = [];
  const docCount = 1 + Math.floor(rand() * 4);
  for (let d = 0; d < docCount; d += 1) {
    const versionId = `docv-${run}-${d}`;
    const text = randomText(rand);
    texts.set(versionId, text);
    const candCount = 1 + Math.floor(rand() * 3);
    for (let c = 0; c < candCount; c += 1) {
      const len = text.length;
      let start = Math.floor(rand() * len);
      let end = start + 1 + Math.floor(rand() * (len - start));
      if (rand() < 0.2) {
        // Deliberately corrupt some candidates: out-of-range offsets.
        start = len + 5;
        end = len + 20;
      }
      candidates.push({
        hitId: `hit-${run}-${d}-${c}`,
        documentId: `doc-${run}-${d}`,
        documentVersionId: versionId,
        chunkId: `chunk-${run}-${d}-${c}`,
        source: pick(rand, SOURCES),
        sourceUrl: "https://example.gov.tr/x",
        title: `${pick(rand, WORDS)} belgesi`,
        startChar: start,
        endChar: end,
        score: rand(),
        stance: pick(rand, STANCES),
        ...(rand() < 0.5 ? { court: pick(rand, COURTS) } : {}),
        ...(rand() < 0.5 ? { legislationNo: pick(rand, ["5237", "6098"]) } : {}),
        ...(rand() < 0.5 ? { article: pick(rand, ["81", "344"]) } : {}),
        ...(rand() < 0.4 ? { decisionDate: "2024-03-12" } : {}),
        ...(rand() < 0.4 ? { docketNo: "2023/45", decisionNo: "2024/12" } : {}),
      });
    }
  }
  return { candidates, texts };
}

describe("RuleBasedDrafter properties over random fixtures", () => {
  it("every claim is evidence-backed and strictly quote+metadata grounded", async () => {
    const rand = mulberry32(0xc011ec);
    const drafter = new RuleBasedDrafter();

    for (let run = 0; run < 25; run += 1) {
      const { candidates, texts } = randomFixture(rand, run);
      const pack = await buildEvidencePack(candidates, new MapTextPort(texts), {
        asOf: "2025-01-15",
        now: () => "2026-08-27T00:00:00Z",
      });
      const claims = await drafter.draftClaims({ question: "rastgele soru", pack });
      const knownIds = new Set(pack.items.map((i) => i.ref.evidenceId));

      for (const claim of claims) {
        // Never a claim without evidence.
        expect(claim.evidenceIds.length).toBeGreaterThanOrEqual(1);
        // Every cited id resolves inside the pack.
        for (const id of claim.evidenceIds) expect(knownIds.has(id)).toBe(true);

        // Never invents beyond quotes: the claim text embeds EVERY cited
        // quote exactly, and every claim token comes from one of the cited
        // quotes or from a citation label built off cited metadata.
        const cited = claim.evidenceIds.map(
          (id) => pack.items.find((i) => i.ref.evidenceId === id)!,
        );
        const allowed = new Set<string>();
        for (const item of cited) {
          expect(claim.text).toContain(item.ref.quote);
          for (const token of tokenize(item.ref.quote)) allowed.add(token);
          for (const token of tokenize(citeLabel(item.ref))) allowed.add(token);
        }
        for (const token of tokenize(claim.text)) {
          expect(allowed.has(token)).toBe(true);
        }

        // Consolidation NEVER crosses a provision boundary: everything a
        // single claim cites is the same article of the same document
        // version, so two provisions can never share one claim's evidence.
        if (cited.length > 1) {
          const provisions = new Set(
            cited.map((i) => `${i.ref.documentVersionId}|${i.ref.locator.article ?? ""}`),
          );
          expect(provisions.size).toBe(1);
          expect([...provisions][0]!.endsWith("|")).toBe(false);
        }
      }

      // Every non-contrary pack item is drafted exactly once — consolidation
      // groups passages, it never drops one.
      const draftedIds = claims.flatMap((c) => c.evidenceIds);
      expect(new Set(draftedIds).size).toBe(draftedIds.length);
      expect(draftedIds.slice().sort()).toEqual(
        pack.items
          .filter((i) => i.stance !== "contrary")
          .map((i) => i.ref.evidenceId)
          .sort(),
      );

      // Contrary-stance evidence is never drafted into an affirmative claim.
      const contraryIds = new Set(
        pack.items.filter((i) => i.stance === "contrary").map((i) => i.ref.evidenceId),
      );
      for (const claim of claims) {
        for (const id of claim.evidenceIds) expect(contraryIds.has(id)).toBe(false);
      }
    }
  });

  it("returns no claims for an empty pack (citation-first: no evidence, no claims)", async () => {
    const pack = await buildEvidencePack([], new MapTextPort(new Map()), {
      asOf: "2025-01-15",
    });
    const claims = await new RuleBasedDrafter().draftClaims({ question: "soru", pack });
    expect(claims).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * Claim ORDER and GROUPING — the reported product defect.
 *
 * The old drafter ordered claims by authority tier and then by evidenceId,
 * which is a SHA-256 prefix. On a question about one article of one statute
 * every passage shares tier 1, so a hash decided which "Tespit" came first
 * and the article the reader asked about did not lead. The fixture below is
 * that exact shape: three articles of one law, the asked one deliberately
 * placed LAST in the pack so ordering cannot pass by accident.
 * ------------------------------------------------------------------------ */

const TEXT_TCK_DOLANDIRICILIK =
  "5237 sayılı Türk Ceza Kanunu\n" +
  "MADDE 155 - (1) Güveni kötüye kullanma suçunda ceza altı aydan iki yıla kadar hapistir.\n" +
  "MADDE 158 - (1) Nitelikli dolandırıcılık hâlinde ceza üç yıldan on yıla kadar hapistir.\n" +
  "MADDE 157 - (1) Hileli davranışlarla bir kimseyi aldatan kişi bir yıldan beş yıla kadar hapis cezası ile cezalandırılır.\n" +
  "(2) Bu suçun soruşturulması ve kovuşturulması şikâyete bağlı değildir.";

const VERSION_DOL = "docv-tck-dolandiricilik";

function slice(quote: string): { startChar: number; endChar: number } {
  return spanOf(TEXT_TCK_DOLANDIRICILIK, quote);
}

/** Candidates in PACK (= retrieval) order; m.157 comes last on purpose. */
function dolandiricilikCandidates(): AnswerCandidate[] {
  const common = {
    documentId: "doc-tck",
    documentVersionId: VERSION_DOL,
    source: "MEVZUAT",
    sourceUrl: "https://mevzuat.gov.tr/tck",
    title: "Türk Ceza Kanunu",
    legislationNo: "5237",
    effectiveFrom: "2005-06-01",
  };
  return [
    makeCandidate({
      ...common,
      chunkId: "c-155-1",
      article: "155",
      score: 0.4,
      ...slice("Güveni kötüye kullanma suçunda ceza altı aydan iki yıla kadar hapistir."),
    }),
    makeCandidate({
      ...common,
      chunkId: "c-158-1",
      article: "158",
      score: 0.5,
      ...slice("Nitelikli dolandırıcılık hâlinde ceza üç yıldan on yıla kadar hapistir."),
    }),
    makeCandidate({
      ...common,
      chunkId: "c-157-1",
      article: "157",
      // A pinned exact-reference hit is scored 1 by the pipeline.
      score: 1,
      ...slice(
        "Hileli davranışlarla bir kimseyi aldatan kişi bir yıldan beş yıla kadar hapis cezası ile cezalandırılır.",
      ),
    }),
    makeCandidate({
      ...common,
      chunkId: "c-157-2",
      article: "157",
      paragraph: "2",
      score: 1,
      ...slice("Bu suçun soruşturulması ve kovuşturulması şikâyete bağlı değildir."),
    }),
  ];
}

async function dolandiricilikPack(): Promise<Awaited<ReturnType<typeof buildEvidencePack>>> {
  return buildEvidencePack(
    dolandiricilikCandidates(),
    new MapTextPort(new Map([[VERSION_DOL, TEXT_TCK_DOLANDIRICILIK]])),
    { asOf: "2025-06-01", now: () => "2026-08-27T00:00:00Z" },
  );
}

describe("claim order answers the question that was asked", () => {
  const QUESTION = "TCK m. 157 dolandırıcılık suçunun cezası nedir?";

  it("leads with the article the reader cited, not with a hash order", async () => {
    const pack = await dolandiricilikPack();
    const claims = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });

    const articleOf = (claimId: string): string | undefined =>
      pack.items.find((i) => `claim-${i.ref.evidenceId}` === claimId)?.ref.locator.article;

    expect(articleOf(claims[0]!.claimId)).toBe("157");
    // ...and the rest follow the retrieval signal, not the identifier bytes.
    expect(claims.map((c) => articleOf(c.claimId))).toEqual(["157", "158", "155"]);
  });

  it("resolves the abbreviation the same way retrieval does", async () => {
    // "TCK" and "5237 sayılı Türk Ceza Kanunu" are the same citation, so they
    // must produce the same leading claim.
    const pack = await dolandiricilikPack();
    const drafter = new RuleBasedDrafter();
    const abbreviated = await drafter.draftClaims({ question: QUESTION, pack });
    const spelledOut = await drafter.draftClaims({
      question: "5237 sayılı Türk Ceza Kanunu m. 157 uyarınca ceza nedir?",
      pack,
    });
    expect(spelledOut.map((c) => c.claimId)).toEqual(abbreviated.map((c) => c.claimId));
  });

  it("falls back to the retrieval signal when the question cites nothing", async () => {
    const pack = await dolandiricilikPack();
    const claims = await new RuleBasedDrafter().draftClaims({
      question: "Dolandırıcılık suçunun cezası nedir?",
      pack,
    });
    const scoreOf = (claimId: string): number =>
      pack.items.find((i) => `claim-${i.ref.evidenceId}` === claimId)!.retrievalScore;
    const scores = claims.map((c) => scoreOf(c.claimId));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("is deterministic for a given pack", async () => {
    const drafter = new RuleBasedDrafter();
    const first = await drafter.draftClaims({ question: QUESTION, pack: await dolandiricilikPack() });
    const second = await drafter.draftClaims({ question: QUESTION, pack: await dolandiricilikPack() });
    expect(second).toEqual(first);
  });
});

describe("passages of one provision are consolidated into one claim", () => {
  it("cites both fıkra of m.157 from a single Tespit", async () => {
    const pack = await dolandiricilikPack();
    const claims = await new RuleBasedDrafter().draftClaims({
      question: "TCK m. 157 dolandırıcılık suçunun cezası nedir?",
      pack,
    });

    // Four passages, three provisions -> three claims.
    expect(pack.items).toHaveLength(4);
    expect(claims).toHaveLength(3);

    const lead = claims[0]!;
    expect(lead.evidenceIds).toHaveLength(2);
    expect(lead.text).toContain("bir yıldan beş yıla kadar hapis");
    expect(lead.text).toContain("şikâyete bağlı değildir");
    // One citation label, then the passages — no invented connective prose.
    expect(lead.text.startsWith("5237 sayılı Türk Ceza Kanunu, m. 157: ")).toBe(true);

    // The claim id stays anchored to the group's FIRST passage in retrieval
    // order, which is the one a caller finds by scanning the evidence list.
    const firstOf157 = pack.items.find((i) => i.ref.locator.article === "157")!;
    expect(lead.claimId).toBe(`claim-${firstOf157.ref.evidenceId}`);
  });

  it("never merges two articles, and never merges across document versions", async () => {
    const other = makeCandidate({
      documentId: "doc-tck",
      documentVersionId: "docv-tck-other-version",
      source: "MEVZUAT",
      sourceUrl: "https://mevzuat.gov.tr/tck",
      title: "Türk Ceza Kanunu",
      legislationNo: "5237",
      article: "157",
      chunkId: "c-157-1-v2",
      score: 1,
      startChar: 0,
      endChar: 30,
    });
    const pack = await buildEvidencePack(
      [...dolandiricilikCandidates(), other],
      new MapTextPort(
        new Map([
          [VERSION_DOL, TEXT_TCK_DOLANDIRICILIK],
          ["docv-tck-other-version", TEXT_TCK_DOLANDIRICILIK],
        ]),
      ),
      { asOf: "2025-06-01", now: () => "2026-08-27T00:00:00Z" },
    );
    const claims = await new RuleBasedDrafter().draftClaims({
      question: "TCK m. 157 cezası nedir?",
      pack,
    });

    // Same article, two versions -> two claims, never one.
    for (const claim of claims) {
      const versions = new Set(
        claim.evidenceIds.map(
          (id) => pack.items.find((i) => i.ref.evidenceId === id)!.ref.documentVersionId,
        ),
      );
      expect(versions.size).toBe(1);
    }
    expect(claims).toHaveLength(4);
  });
});

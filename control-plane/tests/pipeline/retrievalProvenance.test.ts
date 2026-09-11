/**
 * WHY a passage is in the answer must reach the reader, not just WHICH lane
 * produced it.
 *
 * `EvidenceView.retrieval` used to carry `lanes: ["relation"]` and nothing
 * else, which is not an explanation: the citator lane exists precisely because
 * an amending provision and the article it rewrites share almost no
 * vocabulary, so "the relation lane found it" is the question, not the answer.
 * The edge itself — relation id, direction, role, resolver identity and the
 * confidence recorded at ingest — is the whole value of that lane, and a
 * lawyer has to be able to see it. Citation expansion and divergence
 * completion had the same hole.
 *
 * These tests pin that the three provenance blocks travel from the RankedHit
 * through the pipeline, out of the HTTP answer route, and that they stay
 * ADDITIVE: an ordinary lexical/exact hit carries none of them.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/api/server.js";
import { InMemoryAnswerStore } from "../../src/api/answerService.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import type { AnswerResult } from "../../src/pipeline/types.js";
import type { RankedHit } from "../../src/retrieval/hybrid.js";
import {
  Q_APPLICATION,
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  hitDecisionAgainst,
  hitTck,
  makeHit,
  ok,
  standardTexts,
} from "./fakes.js";

const OPENAPI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "api",
  "openapi.yaml",
);

const VERSION_AMENDING = "docv-torba-v1";

/**
 * The synthetic amending instrument: it names neither "dolandırıcılık" nor any
 * word of the question, which is exactly why only a stored edge can reach it.
 */
const TEXT_AMENDING =
  "MADDE 1 - (1) 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci fıkrasında yer alan " +
  '"bir yıldan beş yıla kadar" ibaresi "üç yıldan yedi yıla kadar" şeklinde değiştirilmiştir.\n';

const QUOTE_AMENDING = TEXT_AMENDING.split("\n")[0] as string;

/** A hit as the citator lane produces it: appended, unpinned, edge attached. */
function hitAmendingInstrument(): RankedHit {
  const base = makeHit({
    chunkId: "chunk-torba-1",
    documentId: "doc-torba",
    documentVersionId: VERSION_AMENDING,
    text: TEXT_AMENDING,
    passage: QUOTE_AMENDING,
    title: "7999 sayılı Torba Kanun (sentetik)",
    source: "MEVZUAT",
    documentType: "kanun",
    legislationNo: "7999",
    articleNo: "1",
    fusedScore: 0,
  });
  return {
    ...base,
    lanes: [{ lane: "relation", rank: 1, score: 1 }],
    relation: {
      direction: "inbound",
      kind: "AMENDS",
      role: "amending",
      relationId: "rel-7999-5237-157",
      resolutionStatus: "resolved",
      confidence: 0.95,
      resolverVersion: "amendment-resolver-v1",
      viaChunkId: "chunk-tck-157-v1",
      targetLegislationNo: "5237",
      targetArticleNo: "157",
    },
  };
}

/** A hit as one-hop citation expansion produces it. */
function hitByCitation(): RankedHit {
  return {
    ...hitTck("v2"),
    chunkId: "chunk-tck-157-v2",
    citation: { citedByChunkId: "chunk-torba-1", reference: "5237 m.157" },
  };
}

/** A hit as the divergence-completion pass produces it. */
function hitByDivergence(): RankedHit {
  return {
    ...hitDecisionAgainst(),
    contrary: {
      polarity: "NEGATIVE",
      markers: ["unsurları oluşmamıştır"],
      opposesChunkId: "chunk-decision-for",
      opposesPolarity: "AFFIRMATIVE",
    },
  };
}

function pipelineWith(hits: RankedHit[]): AnswerPipeline {
  return new AnswerPipeline({
    retrieval: new StubCorpus(() => ok(hits)),
    texts: standardTexts(new Map([[VERSION_AMENDING, TEXT_AMENDING]])),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
  });
}

function evidenceFor(result: AnswerResult, chunkId: string) {
  const item = result.evidence.find((e) => e.chunkId === chunkId);
  expect(item, `no evidence for chunk ${chunkId}`).toBeDefined();
  return item!;
}

describe("the citator edge reaches the answer contract", () => {
  it("carries relationId, direction, role, resolver and confidence per hit", async () => {
    const { result } = await pipelineWith([
      hitTck("v1"),
      hitAmendingInstrument(),
    ]).answer({ question: Q_NORM_CONTENT, asOf: "2026-06-01" });

    const amending = evidenceFor(result, "chunk-torba-1");
    expect(amending.retrieval.lanes).toContain("relation");
    expect(amending.retrieval.relation).toEqual({
      direction: "inbound",
      kind: "AMENDS",
      role: "amending",
      relationId: "rel-7999-5237-157",
      resolutionStatus: "resolved",
      confidence: 0.95,
      resolverVersion: "amendment-resolver-v1",
      viaChunkId: "chunk-tck-157-v1",
      targetLegislationNo: "5237",
      targetArticleNo: "157",
    });
    // The anchor names a passage that really is in the answer, so "why is this
    // here?" resolves to something the reader can look at.
    expect(
      result.evidence.some((e) => e.chunkId === amending.retrieval.relation?.viaChunkId),
    ).toBe(true);
  });

  it("survives JSON serialization (it is a wire contract, not an object graph)", async () => {
    const { result } = await pipelineWith([
      hitTck("v1"),
      hitAmendingInstrument(),
    ]).answer({ question: Q_NORM_CONTENT, asOf: "2026-06-01" });

    const roundTripped = JSON.parse(JSON.stringify(result)) as AnswerResult;
    expect(evidenceFor(roundTripped, "chunk-torba-1").retrieval.relation?.relationId).toBe(
      "rel-7999-5237-157",
    );
  });

  it("reaches an HTTP client through POST /v1/answer", async () => {
    const app = createApp({
      answerPipeline: pipelineWith([hitTck("v1"), hitAmendingInstrument()]),
      answerStore: new InMemoryAnswerStore(),
    });
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT, asOf: "2026-06-01" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnswerResult;
    const relation = evidenceFor(body, "chunk-torba-1").retrieval.relation;
    expect(relation?.kind).toBe("AMENDS");
    expect(relation?.role).toBe("amending");
    expect(relation?.resolverVersion).toBe("amendment-resolver-v1");
  });

  it("is documented in openapi.yaml, so the contract and its description agree", () => {
    const spec = readFileSync(OPENAPI, "utf8");
    for (const field of [
      "relationId",
      "resolutionStatus",
      "resolverVersion",
      "viaChunkId",
      "citedByChunkId",
      "opposesChunkId",
    ]) {
      expect(spec).toContain(field);
    }
  });
});

describe("citation-expansion and divergence provenance travel the same way", () => {
  it("names the passage whose text carried the citation", async () => {
    const { result } = await pipelineWith([hitByCitation()]).answer({
      question: Q_NORM_CONTENT,
      asOf: "2026-06-01",
    });
    expect(evidenceFor(result, "chunk-tck-157-v2").retrieval.citation).toEqual({
      citedByChunkId: "chunk-torba-1",
      reference: "5237 m.157",
    });
  });

  it("names the passage whose outcome the contrary one opposes", async () => {
    // An APPLICATION question on purpose: a NORM_CONTENT one scopes case law
    // out of the evidence set entirely (questionIntent.ts), so there would be
    // no contrary source card to carry provenance in the first place.
    const { result } = await pipelineWith([hitTck("v1"), hitByDivergence()]).answer({
      question: Q_APPLICATION,
      asOf: "2026-06-01",
    });
    const contrary = evidenceFor(result, "chunk-decision-against").retrieval.contrary;
    expect(contrary?.opposesChunkId).toBe("chunk-decision-for");
    expect(contrary?.opposesPolarity).toBe("AFFIRMATIVE");
    expect(contrary?.markers).toEqual(["unsurları oluşmamıştır"]);
  });
});

describe("the three blocks are ADDITIVE", () => {
  it("an ordinary exact/lexical hit carries none of them", async () => {
    const { result } = await pipelineWith([hitTck("v1")]).answer({
      question: Q_NORM_CONTENT,
      asOf: "2026-06-01",
    });
    const plain = evidenceFor(result, "chunk-tck-157-v1");
    expect(plain.retrieval.relation).toBeUndefined();
    expect(plain.retrieval.citation).toBeUndefined();
    expect(plain.retrieval.contrary).toBeUndefined();
    // The key is absent, not present-and-null: a client that checks
    // `"relation" in retrieval` must see the same answer as one that checks
    // for undefined.
    expect(Object.keys(plain.retrieval).sort()).toEqual([
      "fusedScore",
      "lanes",
      "pinReason",
      "pinned",
      "queries",
    ]);
  });
});

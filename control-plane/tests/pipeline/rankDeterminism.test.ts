/**
 * W14 N-7 — the answer must not depend on ids the INGEST minted.
 *
 * WHAT THIS PINS. `AnswerPipeline`'s rank stage breaks a score tie between two
 * candidate passages. Until 03.09.2026 it broke it on `hit.chunkId`, a
 * `gen_random_uuid()` written by `ingestion/`; every passage that arrives on
 * the citation, citator or contrary lane carries `fusedScore: 0`, so on a real
 * question the tie group is most of the candidate list and the uuid alone
 * decided the order. The coverage-aware cap then kept a DIFFERENT top-8 after
 * every re-ingest of a byte-identical corpus, which is what made
 * `scripts/run_evals.py`'s answer layer report a different distribution from
 * run to run (STATUS S40).
 *
 * HOW IT IS PINNED. One corpus, two ingests: the same twelve passages, the same
 * order out of retrieval, the same everything — except that the second "ingest"
 * minted chunk ids that sort in the OPPOSITE direction. The two answers must be
 * identical when projected onto CORPUS identity (which document, which article),
 * and the kept set must be the first eight in corpus order in both.
 *
 * NON-VACUITY. Restore `return a.hit.chunkId < b.hit.chunkId ? -1 : ...` in the
 * rank stage of `src/pipeline/answerPipeline.ts` and this file fails: the
 * descending ingest keeps documents 05..12 while the ascending one keeps 01..08.
 * (Verified by reintroducing the defect on 03.09.2026 — see
 * docs/implementation/waves/W14-N7.md §5.)
 *
 * The twelve passages are deliberately IDENTICAL in wording apart from a
 * trailing marker that carries no question word, so the coverage-aware cap
 * performs no swaps and the kept set is decided by the tie-break alone. This
 * test is about the tie-break, not about coverage.
 */

import { describe, expect, it } from "vitest";

import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import type { CorpusSearchResult } from "../../src/pipeline/ports.js";
import type { RankedHit } from "../../src/retrieval/hybrid.js";
import { MapTextPort, StubCorpus, deterministicOptions, makeHit } from "./fakes.js";

const QUESTION = "Hileli davranışlarla aldatan kişiye hangi ceza verilir?";
const AS_OF = "2026-06-01";
const DOCUMENT_COUNT = 12;
const EVIDENCE_CAP = 8;

/** Stable corpus id of document n: "kanun-n7-01" … "kanun-n7-12". */
function externalIdOf(n: number): string {
  return `kanun-n7-${String(n).padStart(2, "0")}`;
}

function passageOf(n: number): string {
  return (
    "(1) Hileli davranışlarla bir kimseyi aldatan kişiye hapis cezası verilir. " +
    `[SENTETIK-${String(n).padStart(2, "0")}]`
  );
}

function textOf(n: number): string {
  return `SENTETİK KANUN ${externalIdOf(n)}\nMADDE 1 - ${passageOf(n)}\n`;
}

/**
 * One "ingest" of the same twelve documents.
 *
 * `direction` decides which uuid each passage is given: `asc` mints ids that
 * sort the same way as corpus identity, `desc` mints ids that sort the
 * opposite way. Nothing else differs — not the text, not the order the hits
 * come back in, not the score.
 */
function ingest(direction: "asc" | "desc"): {
  hits: RankedHit[];
  texts: MapTextPort;
} {
  const hits: RankedHit[] = [];
  const texts = new Map<string, string>();
  for (let n = 1; n <= DOCUMENT_COUNT; n += 1) {
    const rank = direction === "asc" ? n : DOCUMENT_COUNT + 1 - n;
    const chunkId = `00000000-0000-4000-8000-${String(rank).padStart(12, "0")}`;
    const versionId = `10000000-0000-4000-8000-${String(rank).padStart(12, "0")}`;
    const text = textOf(n);
    texts.set(versionId, text);
    hits.push(
      makeHit({
        chunkId,
        documentId: externalIdOf(n),
        documentVersionId: versionId,
        text,
        passage: passageOf(n),
        title: `Sentetik Kanun ${String(n).padStart(2, "0")}`,
        source: "MEVZUAT",
        documentType: "kanun",
        legislationNo: String(9000 + n),
        articleNo: "1",
        // Every candidate ties: this is exactly the citation/citator/contrary
        // situation the defect lived in.
        fusedScore: 0,
      }),
    );
  }
  return { hits, texts: new MapTextPort(texts) };
}

async function answerOf(direction: "asc" | "desc"): Promise<{
  keptDocuments: string[];
  status: string;
  droppedDocuments: string[];
}> {
  const { hits, texts } = ingest(direction);
  const pipeline = new AnswerPipeline({
    // The hits always arrive in CORPUS order; only their ids differ.
    retrieval: new StubCorpus((): CorpusSearchResult => ({
      status: "ok",
      hits: [...hits],
      warnings: [],
    })),
    texts,
    ...deterministicOptions(),
  });
  const { result } = await pipeline.answer({ question: QUESTION, asOf: AS_OF });
  return {
    status: result.status,
    keptDocuments: result.evidence.map((item) => item.documentId),
    droppedDocuments: result.contraryCoverage.observed
      .filter((row) => row.reason === "EVIDENCE_CAP_APPLIED")
      .map((row) => row.title),
  };
}

describe("N-7 — the rank tie-break uses corpus identity, not the ingest's uuid", () => {
  it("two ingests of one corpus keep the SAME passages", async () => {
    const ascending = await answerOf("asc");
    const descending = await answerOf("desc");

    // The cap really bit: twelve candidates, eight kept.
    expect(ascending.keptDocuments).toHaveLength(EVIDENCE_CAP);
    expect(ascending.droppedDocuments).toHaveLength(DOCUMENT_COUNT - EVIDENCE_CAP);

    expect(descending.status).toBe(ascending.status);
    expect(descending.keptDocuments).toEqual(ascending.keptDocuments);
    expect(descending.droppedDocuments).toEqual(ascending.droppedDocuments);
  });

  it("keeps the first eight in CORPUS order, whichever uuids the ingest minted", async () => {
    const expected = [1, 2, 3, 4, 5, 6, 7, 8].map(externalIdOf);
    for (const direction of ["asc", "desc"] as const) {
      const answer = await answerOf(direction);
      expect(answer.keptDocuments, `direction=${direction}`).toEqual(expected);
    }
  });
});

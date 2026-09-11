/**
 * W12 lane B — answer honesty, end to end and offline.
 *
 * The audit of 02.09.2026 proved on the demo corpus that a question the
 * corpus cannot answer ("Kira sözleşmesinde depozito iadesi ne zaman
 * yapılır?") came back ŞERHLİ and finalizable, led by TCK m.157: one decision
 * matched on "sözleşme", it cited m.157, and citation expansion stamped the
 * article as a pinned, score-1 hit. These tests reproduce that shape against
 * fakes and pin the four behaviours that close it:
 *
 *   1. the question-coverage gate abstains with QUESTION_NOT_COVERED and lists
 *      the retrieved passages by identity only;
 *   2. an expanded provision arrives unpinned, on the citation lane, and can
 *      never lead the answer unless the question cited it;
 *   3. an uploaded document is reachable under file scope and is labelled
 *      "yüklediğiniz belge";
 *   4. a corpus that cannot be reached is CORPUS_UNAVAILABLE in Turkish, never
 *      driver text; and the cloud-AI switch is per request, with the
 *      citation-first invariant holding for a cloud drafter too.
 */

import { describe, expect, it } from "vitest";

import {
  AI_UNAVAILABLE_MESSAGE_TR,
  AnswerPipeline,
  RULE_BASED_LABEL_TR,
} from "../../src/pipeline/answerPipeline.js";
import type { CorpusRetrievalPort, CorpusSearchResult } from "../../src/pipeline/ports.js";
import type { ClaimDraft } from "../../src/evidence/types.js";
import type { DrafterInput, DrafterPort, EntailmentPort } from "../../src/llm/ports.js";
import type { RankedHit } from "../../src/retrieval/hybrid.js";
import { COVERAGE_SET_ASIDE_TEXT } from "../../src/answer/renderer.js";
import { CORPUS_UNAVAILABLE_MESSAGE_TR } from "../../src/retrieval/corpusErrors.js";
import {
  MapTextPort,
  Q_APPLICATION,
  Q_ARTICLE_LEVEL,
  Q_BARE_LAW,
  QUOTE_TBK_49,
  Q_NORM_CONTENT,
  Q_UNANSWERABLE,
  STANDARD_FACTS,
  StubCorpus,
  TEXT_TCK_V2,
  VERSION_TCK_V2,
  deterministicOptions,
  factsPort,
  hitDecisionAgainst,
  hitDecisionFor,
  hitTck,
  makeHit,
  ok,
  standardTexts,
  tbkArticle49Pinned,
  tbkTexts,
  tbkWholeLawPinned,
} from "../pipeline/fakes.js";

/** The audited question: the corpus has nothing on rental deposits. */
const Q_NEAR_MISS = "Kira sözleşmesinde depozito iadesi ne zaman yapılır?";

/** Q_APPLICATION without its citation, so the gate — not a pin — decides. */
const Q_APPLICATION_UNCITED =
  "Araç satışında kapora alındıktan sonra teslim edilmemesi dolandırıcılık suçunu oluşturur mu?";

/**
 * TCK m.157 as citation expansion now delivers it: unpinned, on the citation
 * lane, reached from the decision that cited it. `fusedScore` is deliberately
 * HIGHER than the seed's so the ordering tests cannot pass on score alone.
 */
function expandedTck(fusedScore = 0.2): RankedHit {
  const base = hitTck("v2");
  return makeHit({
    chunkId: base.chunkId,
    documentId: base.documentId,
    documentVersionId: base.documentVersionId,
    text: TEXT_TCK_V2,
    passage: base.provenance.originalText,
    title: base.provenance.title ?? "",
    source: base.provenance.source,
    documentType: base.provenance.documentType,
    legislationNo: "5237",
    articleNo: "157",
    canonicalSourceUrl: base.provenance.canonicalSourceUrl ?? undefined,
    pinned: false,
    fusedScore,
    citation: { citedByChunkId: "chunk-decision-for", reference: "5237 m.157" },
  });
}

const UPLOAD_FILE_ID = "a1b2c3d4e5f60718";
const VERSION_UPLOAD = "docv-upload-kira";
const TEXT_UPLOAD =
  "KİRA SÖZLEŞMESİ (taslak)\n" +
  "Madde 7 - Depozito iadesi: kiracı, kira sözleşmesi sona erdiğinde ve anahtar teslim " +
  "edildiğinde depozitonun on beş gün içinde iadesini talep edebilir.\n";
const QUOTE_UPLOAD = TEXT_UPLOAD.split("\n")[1] as string;

function uploadHit(): RankedHit {
  return makeHit({
    chunkId: "chunk-upload-7",
    documentId: "doc-upload",
    documentVersionId: VERSION_UPLOAD,
    text: TEXT_UPLOAD,
    passage: QUOTE_UPLOAD,
    title: "kira_sozlesmesi_taslak.docx",
    source: "UPLOAD",
    documentType: "sozlesme",
    scope: "tenant",
    fusedScore: 0.05,
  });
}

function pipelineWith(
  corpus: CorpusRetrievalPort,
  extra: Partial<ConstructorParameters<typeof AnswerPipeline>[0]> = {},
): AnswerPipeline {
  return new AnswerPipeline({
    retrieval: corpus,
    texts: standardTexts(
      new Map([[VERSION_UPLOAD, TEXT_UPLOAD], ...tbkTexts()]),
    ),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 0. W14 B-07 — a bare law abbreviation must not knock the gate over
// ---------------------------------------------------------------------------

describe("B-07 · a BARE law reference pins, but exempts nothing", () => {
  it("abstains on the audited question even with 'tbk ya gore' appended", async () => {
    // Measured 02.09.2026 (DAILYFLOW §2): the same question WITHOUT those
    // three words abstained; WITH them it produced 8 pieces of evidence and 6
    // findings about haksız fiil, at `coverage.ratio 0`.
    const corpus = new StubCorpus(() => ok(tbkWholeLawPinned()));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_BARE_LAW,
      asOf: "2026-06-01",
    });

    expect(result.status).toBe("ABSTAIN");
    expect(result.finalizable).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(result.bundle.evidence).toEqual([]);
    expect(result.reasons).toContain("QUESTION_NOT_COVERED");
    expect(result.warnings).toContain("QUESTION_NOT_COVERED:2");
    // The passages are still reported BY IDENTITY, never quoted.
    const observed = result.contraryCoverage.observed.filter(
      (passage) => passage.reason === "QUESTION_NOT_COVERED",
    );
    expect(observed.map((passage) => passage.chunkId).sort()).toEqual([
      "chunk-tbk-49",
      "chunk-tbk-51",
    ]);
    expect(result.markdown).not.toContain(QUOTE_TBK_49);
  });

  it("gives the identical answer with and without the bare abbreviation", async () => {
    const withoutAbbreviation = "kira sozlesmesinde depozito iadesi ne zaman yapilir";
    const corpus = new StubCorpus(() => ok(tbkWholeLawPinned()));
    const bare = await pipelineWith(corpus).answer({
      question: Q_BARE_LAW,
      asOf: "2026-06-01",
    });
    const plain = await pipelineWith(new StubCorpus(() => ok(tbkWholeLawPinned()))).answer({
      question: withoutAbbreviation,
      asOf: "2026-06-01",
    });
    expect(bare.result.status).toBe(plain.result.status);
    expect(bare.result.evidence.length).toBe(plain.result.evidence.length);
  });

  it("an ARTICLE-level reference keeps today's behaviour exactly", async () => {
    const corpus = new StubCorpus(() => ok(tbkArticle49Pinned()));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_ARTICLE_LEVEL,
      asOf: "2026-06-01",
    });

    expect(result.coverage?.gate).toBe("bypassed-by-reference");
    // The named article is admitted by right; the other article of the same
    // law is not — it must anchor the question on its own, and does not.
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["chunk-tbk-49"]);
    expect(result.status).not.toBe("ABSTAIN");
    expect(result.claims.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 1. Coverage gate
// ---------------------------------------------------------------------------

describe("the question-coverage gate (QUESTION_NOT_COVERED)", () => {
  it("abstains on the audited question instead of answering with TCK m.157", async () => {
    const corpus = new StubCorpus(() => ok([hitDecisionFor(), hitDecisionAgainst(), expandedTck()]));
    const { result, pack } = await pipelineWith(corpus).answer({ question: Q_NEAR_MISS, asOf: "2026-06-01" });

    expect(result.status).toBe("ABSTAIN");
    expect(result.finalizable).toBe(false);
    expect(result.reasons).toContain("QUESTION_NOT_COVERED");
    expect(result.reasons).toContain("ABSTENTION_NOT_FINALIZABLE");
    expect(result.reasons).not.toContain("NO_EVIDENCE");

    // ZERO source cards, zero claims, zero bundle evidence — the S2 invariant.
    expect(result.evidence).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(result.bundle.evidence).toEqual([]);
    expect(pack.items).toEqual([]);
    expect(result.markdown).not.toContain("## Kaynaklar");
    expect(result.markdown).not.toMatch(/^### \[\d+\]/m);

    // The passages ARE reported — by identity, with the reason, never quoted.
    const setAside = result.contraryCoverage.observed.filter((p) => p.reason === "QUESTION_NOT_COVERED");
    expect(setAside.map((p) => p.chunkId).sort()).toEqual(
      ["chunk-decision-against", "chunk-decision-for", "chunk-tck-157-v2"].sort(),
    );
    expect(result.markdown).not.toContain(hitDecisionFor().provenance.originalText);
    expect(result.markdown).not.toContain("üç yıldan yedi yıla");
    expect(result.warnings).toContain("QUESTION_NOT_COVERED:3");
  });

  it("reports the coverage the reader needs: ratio, missing words, the set-aside sentence", async () => {
    const corpus = new StubCorpus(() => ok([hitDecisionFor(), hitDecisionAgainst(), expandedTck()]));
    const { result } = await pipelineWith(corpus).answer({ question: Q_NEAR_MISS, asOf: "2026-06-01" });

    expect(result.coverage).toBeDefined();
    expect(result.coverage?.gate).toBe("failed");
    expect(result.coverage?.setAside).toBe(3);
    expect(result.coverage?.lexemes).toEqual(["kira", "sözleşmesinde", "depozito", "iadesi"]);
    expect(result.coverage?.missing).toEqual(expect.arrayContaining(["kira", "depozito"]));
    expect(result.coverage?.ratio).toBeLessThan(0.4);
    expect(result.coverage?.floor).toBe(0.4);

    // W15: the coverage line no longer prints a bare percentage — it counts
    // the question's own words, which is what the reader can act on. The
    // MEASURED behaviour is unchanged: the ratio, the set-aside sentence, the
    // missing words and the machine code must all still reach the markdown.
    expect(result.markdown).toContain("Sorunuzdaki 4 anahtar sözcükten ");
    expect(result.markdown).toContain(" tanesi kaynaklarda karşılık buldu");
    expect(result.markdown).toContain(COVERAGE_SET_ASIDE_TEXT);
    expect(result.markdown).toContain("Karşılığı bulunamayan sözcükler: ");
    expect(result.markdown).toContain("(QUESTION_NOT_COVERED)");
    expect(result.markdown).toContain(
      "sorunuzla yalnız aynı sözcükleri paylaşıyor; dayanak sayılmadı (QUESTION_NOT_COVERED)",
    );

    const coverageStage = result.trace.find((s) => s.name === "coverage");
    expect(coverageStage?.notes).toContain("gate=failed");
    expect(coverageStage?.counts["passages"]).toBe(3);
  });

  it("is bypassed when the question cites the provision the exact lane pinned", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")]))).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    });
    expect(result.status).toBe("COMPLETE");
    expect(result.finalizable).toBe(true);
    expect(result.coverage?.gate).toBe("bypassed-by-reference");
    expect(result.coverage?.setAside).toBe(0);
    // A NORM_CONTENT question is answered BY the cited text: never "partial".
    expect(result.coverage?.partiallyCovered).not.toBe(true);
    expect(result.reasons).not.toContain("QUESTION_PARTIALLY_COVERED");
    expect(result.markdown).toContain(
      "Sorunuzda bir madde ya da karar açıkça anıldığı için o hükmün metni doğrudan alındı",
    );
    expect(result.markdown).toContain("(bypassed-by-reference)");
    expect(result.markdown).toContain(" tanesi kaynaklarda karşılık buldu");
  });

  // W12-FIX (02.09.2026): the bypass used to admit the WHOLE pack. The audit
  // question prefixed with a citation came back QUALIFIED and finalizable
  // with seven unpinned dolandırıcılık passages.
  describe("the reference bypass admits passage by passage", () => {
    const Q_NEAR_MISS_CITED = "TCK m. 157 uyarınca kira sözleşmesinde depozito iadesi ne zaman yapılır?";

    it("admits the pinned text, sets unrelated lexical hits aside, and refuses to finalize", async () => {
      const corpus = new StubCorpus(() => ok([hitTck("v1"), hitDecisionFor(), hitDecisionAgainst()]));
      const { result } = await pipelineWith(corpus).answer({ question: Q_NEAR_MISS_CITED, asOf: "2025-06-01" });

      expect(result.coverage?.gate).toBe("bypassed-by-reference");
      // Only the cited provision is quoted.
      expect(result.evidence.map((e) => e.chunkId)).toEqual(["chunk-tck-157-v1"]);
      expect(result.evidence[0]?.retrieval.pinned).toBe(true);
      // The decisions are reported by identity, never quoted.
      const setAside = result.contraryCoverage.observed.filter((p) => p.reason === "QUESTION_NOT_COVERED");
      expect(setAside.map((p) => p.chunkId).sort()).toEqual(["chunk-decision-against", "chunk-decision-for"]);
      expect(result.warnings).toContain("QUESTION_NOT_COVERED:2");
      expect(result.coverage?.setAside).toBe(2);
      expect(result.markdown).not.toContain(hitDecisionFor().provenance.originalText);

      // The provision text does not answer a deposit question: not finalizable, and it says why.
      expect(result.coverage?.partiallyCovered).toBe(true);
      expect(result.coverage?.missing).toEqual(expect.arrayContaining(["kira", "depozito"]));
      expect(result.status).toBe("PARTIAL");
      expect(result.finalizable).toBe(false);
      expect(result.reasons).toContain("QUESTION_PARTIALLY_COVERED");
      expect(result.warnings).toContain("QUESTION_PARTIALLY_COVERED");
      expect(result.markdown).toContain("sorunun kendisi cevaplanmış sayılmaz");
      expect(result.markdown).toContain("Karşılığı bulunamayan sözcükler: ");
    });

    it("an edge from a set-aside passage admits nothing (closure runs from the admitted set only)", async () => {
      // expandedTck() is TCK v2 reached by citation FROM chunk-decision-for,
      // which the bypass sets aside; the expansion must follow it out.
      const corpus = new StubCorpus(() => ok([hitTck("v1"), hitDecisionFor(), expandedTck(0.9)]));
      const { result } = await pipelineWith(corpus).answer({ question: Q_NEAR_MISS_CITED, asOf: "2025-06-01" });
      expect(result.evidence.map((e) => e.chunkId)).toEqual(["chunk-tck-157-v1"]);
      expect(result.warnings).toContain("QUESTION_NOT_COVERED:2");
    });

    it("a non-pinned passage that anchors the question on its own is still admitted", async () => {
      // The kapora decisions carry the question's own words ("kapora", "teslim", "araç").
      const corpus = new StubCorpus(() => ok([hitTck("v1"), hitDecisionFor(), hitDecisionAgainst()]));
      const { result } = await pipelineWith(corpus).answer({ question: Q_APPLICATION, asOf: "2025-06-01" });
      expect(result.coverage?.gate).toBe("bypassed-by-reference");
      expect(result.evidence.map((e) => e.chunkId).sort()).toEqual(
        ["chunk-decision-against", "chunk-decision-for", "chunk-tck-157-v1"].sort(),
      );
      expect(result.coverage?.partiallyCovered).not.toBe(true);
      expect(result.reasons).not.toContain("QUESTION_PARTIALLY_COVERED");
    });
  });

  it("passes when a passage genuinely addresses the question, without any citation", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitDecisionFor()]))).answer({
      question: Q_APPLICATION_UNCITED,
      asOf: "2026-06-01",
    });
    expect(result.coverage?.gate).toBe("passed");
    expect(result.status).not.toBe("ABSTAIN");
    expect(result.evidence).toHaveLength(1);
    expect(result.coverage?.bestPassageCovered).toBeGreaterThanOrEqual(2);
  });

  it("keeps NO_EVIDENCE for an empty retrieval (nothing was set aside)", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([]))).answer({
      question: Q_UNANSWERABLE,
      asOf: "2026-06-01",
    });
    expect(result.status).toBe("ABSTAIN");
    expect(result.reasons).toContain("NO_EVIDENCE");
    expect(result.reasons).not.toContain("QUESTION_NOT_COVERED");
    expect(result.coverage?.setAside).toBe(0);
    expect(result.markdown).not.toContain(COVERAGE_SET_ASIDE_TEXT);
  });

  it("the floor is a pipeline option", async () => {
    const corpus = new StubCorpus(() => ok([hitDecisionFor()]));
    const strict = await pipelineWith(corpus, { coverageFloor: 0.9 }).answer({
      question: Q_APPLICATION_UNCITED,
      asOf: "2026-06-01",
    });
    expect(strict.result.status).toBe("ABSTAIN");
    expect(strict.result.reasons).toContain("QUESTION_NOT_COVERED");
    expect(strict.result.coverage?.floor).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// 1b. The evidence cap must not manufacture an abstention
// ---------------------------------------------------------------------------

describe("the evidence cap is coverage-aware", () => {
  const Q_TORBA = "Dolandırıcılık suçunun cezasını artıran torba kanun ne zaman yürürlüğe girer?";
  const TEXT_TORBA =
    "MADDE 1 - (1) 5237 sayılı Kanunun 157 nci maddesindeki ceza ibaresi değiştirilmiştir.\n" +
    "MADDE 3 - (1) Bu Kanun yayımı tarihinde yürürlüğe girer.\n";
  const QUOTE_TORBA_3 = TEXT_TORBA.split("\n")[1] as string;

  /** Eight strong passages that all say the same thing about dolandırıcılık. */
  function fillers(): { hits: RankedHit[]; texts: Map<string, string> } {
    const hits: RankedHit[] = [];
    const texts = new Map<string, string>();
    for (let i = 0; i < 8; i += 1) {
      const text = `MADDE 2${i}0 - (1) Dolandırıcılık suçunun cezası bu fıkrada ağırlaştırılır (${i}).\n`;
      const version = `docv-filler-${i}`;
      texts.set(version, text);
      hits.push(
        makeHit({
          chunkId: `chunk-filler-${i}`,
          documentId: `doc-filler-${i}`,
          documentVersionId: version,
          text,
          passage: text.split("\n")[0] as string,
          title: `Sentetik Kanun ${i}`,
          source: "MEVZUAT",
          documentType: "kanun",
          legislationNo: `900${i}`,
          articleNo: `2${i}0`,
          fusedScore: 0.2 - i * 0.01,
        }),
      );
    }
    return { hits, texts };
  }

  function torbaHit(): RankedHit {
    return makeHit({
      chunkId: "chunk-torba-3",
      documentId: "doc-torba",
      documentVersionId: "docv-torba-v1",
      text: TEXT_TORBA,
      passage: QUOTE_TORBA_3,
      title: "7999 sayılı Torba Kanun (sentetik)",
      source: "MEVZUAT",
      documentType: "kanun",
      legislationNo: "7999",
      articleNo: "3",
      // Ranked LAST: a plain top-8 cut drops it.
      fusedScore: 0.01,
    });
  }

  it("keeps the one passage that carries the question's own words instead of an eighth repeat", async () => {
    const { hits, texts } = fillers();
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([...hits, torbaHit()])),
      texts: new MapTextPort(new Map([...texts, ["docv-torba-v1", TEXT_TORBA]])),
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_TORBA, asOf: "2026-06-01" });

    // Nine candidates, cap 8 — and the torba passage survives the cap.
    expect(result.evidence).toHaveLength(8);
    expect(result.evidence.some((e) => e.chunkId === "chunk-torba-3")).toBe(true);
    const rank = result.trace.find((s) => s.name === "rank")!;
    expect(rank.counts["coverageSwaps"]).toBe(1);
    expect(rank.notes.some((n) => n.startsWith("COVERAGE_SWAP:chunk-torba-3:chunk-filler-"))).toBe(true);
    // The displaced filler is reported, by identity, as capped out.
    expect(result.contraryCoverage.observed.filter((p) => p.reason === "EVIDENCE_CAP_APPLIED")).toHaveLength(1);

    // ...so the gate sees a pack that addresses the question.
    expect(result.status).not.toBe("ABSTAIN");
    expect(result.coverage?.gate).toBe("passed");
    expect(result.coverage?.covered).toEqual(expect.arrayContaining(["yürürlüğe", "girer"]));
  });

  it("never displaces a pinned passage, and swaps nothing when the kept set already covers the question", async () => {
    const { hits, texts } = fillers();
    const pinnedFirst = { ...(hits[0] as RankedHit), pinned: true, pinReason: "exact-reference" };
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([pinnedFirst, ...hits.slice(1)])),
      texts: new MapTextPort(texts),
      ...deterministicOptions(),
    });
    // Eight candidates, cap 8: nothing to cut, nothing to swap.
    const { result } = await pipeline.answer({ question: "Dolandırıcılık suçunun cezası nedir?", asOf: "2026-06-01" });
    expect(result.evidence).toHaveLength(8);
    expect(result.trace.find((s) => s.name === "rank")!.counts["coverageSwaps"]).toBe(0);
    expect(result.evidence[0]!.retrieval.pinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Citation expansion never leads
// ---------------------------------------------------------------------------

describe("an expanded provision never leads the answer", () => {
  it("the seed decision leads; TCK m.157 follows as context even with a higher score", async () => {
    const corpus = new StubCorpus(() => ok([hitDecisionFor(), expandedTck(0.2)]));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_APPLICATION_UNCITED,
      asOf: "2026-06-01",
    });
    expect(result.status).not.toBe("ABSTAIN");

    const decision = result.evidence.find((e) => e.chunkId === "chunk-decision-for")!;
    const article = result.evidence.find((e) => e.chunkId === "chunk-tck-157-v2")!;
    // Non-vacuous: the expansion carries the higher retrieval signal...
    expect(article.retrievalScore).toBeGreaterThan(decision.retrievalScore);
    expect(article.retrieval.pinned).toBe(false);
    expect(article.retrieval.lanes).toEqual(["citation"]);
    expect(article.retrieval.citation?.citedByChunkId).toBe("chunk-decision-for");
    // ...and still does not lead.
    expect(result.claims[0]!.evidenceIds).toContain(decision.evidenceId);
    expect(result.claims[0]!.evidenceIds).not.toContain(article.evidenceId);
    expect(result.claims.some((c) => c.evidenceIds.includes(article.evidenceId))).toBe(true);
  });

  it("...unless the question itself cited that provision", async () => {
    const corpus = new StubCorpus(() => ok([hitDecisionFor(), expandedTck(0.01)]));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_APPLICATION,
      asOf: "2026-06-01",
    });
    const article = result.evidence.find((e) => e.chunkId === "chunk-tck-157-v2")!;
    expect(result.claims[0]!.evidenceIds).toContain(article.evidenceId);
  });
});

// ---------------------------------------------------------------------------
// 3. File scope and upload origin
// ---------------------------------------------------------------------------

describe("uploaded documents (file scope)", () => {
  it("threads filters.fileIds to the corpus port and marks the evidence as an upload", async () => {
    const corpus = new StubCorpus(() => ok([uploadHit()]));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_NEAR_MISS,
      asOf: "2026-06-01",
      filters: { fileIds: [UPLOAD_FILE_ID] },
    });

    for (const call of corpus.calls) expect(call.filters).toEqual({ fileIds: [UPLOAD_FILE_ID] });
    expect(result.fileScope).toEqual({ fileIds: [UPLOAD_FILE_ID], includeCorpus: false });

    // The upload answers the deposit question the corpus could not.
    expect(result.status).not.toBe("ABSTAIN");
    expect(result.coverage?.gate).toBe("passed");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.origin).toBe("upload");
    expect(result.evidence[0]!.quote).toBe(QUOTE_UPLOAD);
    expect(result.markdown).toContain("yüklediğiniz belge");
    // W15: the banner heading names what it answers ("kapsam" meant three
    // different things in this product) and "yerel korpus" became the
    // canonical "hukuk kütüphaneniz". The BOND is unchanged: a file-scoped
    // answer must say it searched only the reader's files.
    expect(result.markdown).toContain("**BU CEVAP NEREDE ARANDI**");
    expect(result.markdown).toContain("Yalnız yüklediğiniz 1 belgede");
    expect(result.markdown).toContain("hukuk kütüphaneniz taranmadı");
  });

  it("includeCorpus is reported and corpus evidence keeps origin 'corpus'", async () => {
    const corpus = new StubCorpus(() => ok([uploadHit(), hitDecisionFor()]));
    const { result } = await pipelineWith(corpus).answer({
      question: Q_NEAR_MISS,
      asOf: "2026-06-01",
      filters: { fileIds: [UPLOAD_FILE_ID], includeCorpus: true },
    });
    expect(result.fileScope?.includeCorpus).toBe(true);
    expect(result.markdown).toContain("ve hukuk kütüphanenizde arandı");
    const origins = new Map(result.evidence.map((e) => [e.chunkId, e.origin]));
    expect(origins.get("chunk-upload-7")).toBe("upload");
    expect(origins.get("chunk-decision-for")).toBe("corpus");
  });

  it("without file scope nothing changes: no banner, no fileScope, origin corpus", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")]))).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    });
    expect(result.fileScope).toBeUndefined();
    expect(result.markdown).not.toContain("**BU CEVAP NEREDE ARANDI**");
    expect(result.evidence[0]!.origin).toBe("corpus");
  });
});

// ---------------------------------------------------------------------------
// 4a. Typed corpus failures
// ---------------------------------------------------------------------------

class RefusingCorpus implements CorpusRetrievalPort {
  readonly name = "refusing-corpus";
  async search(): Promise<CorpusSearchResult> {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:55432");
    (error as Error & { code: string }).code = "ECONNREFUSED";
    throw error;
  }
}

describe("a corpus that cannot be reached is CORPUS_UNAVAILABLE", () => {
  it("from a typed port outcome", async () => {
    const corpus = new StubCorpus(() => ({
      status: "error",
      hits: [],
      warnings: [],
      error: CORPUS_UNAVAILABLE_MESSAGE_TR,
      errorCode: "CORPUS_UNAVAILABLE",
    }));
    const { result } = await pipelineWith(corpus).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.status).toBe("PARTIAL");
    expect(result.finalizable).toBe(false);
    expect(result.reasons).toContain("RETRIEVAL_DEGRADED");
    expect(result.reasons).toContain("CORPUS_UNAVAILABLE");
    expect(result.warnings.some((w) => w.startsWith("CORPUS_UNAVAILABLE:primary:"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("RETRIEVAL_ERROR:"))).toBe(false);
    expect(result.markdown).toContain("Bu bilgisayardaki hukuk kütüphanesi açılamadı");
    expect(result.markdown).toContain("(CORPUS_UNAVAILABLE)");
  });

  it("from a port that THROWS a connection error — no driver text survives", async () => {
    const { result } = await pipelineWith(new RefusingCorpus()).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.status).toBe("PARTIAL");
    expect(result.reasons).toContain("CORPUS_UNAVAILABLE");
    for (const field of [...result.warnings, ...result.reasons, result.markdown]) {
      expect(field).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|55432/);
    }
    expect(result.warnings.some((w) => w === `CORPUS_UNAVAILABLE:primary:${CORPUS_UNAVAILABLE_MESSAGE_TR}`)).toBe(true);
  });

  it("a non-connection failure keeps RETRIEVAL_DEGRADED semantics and its diagnostic", async () => {
    const corpus = new StubCorpus(() => ({ status: "error", hits: [], warnings: [], error: "relation does not exist" }));
    const { result } = await pipelineWith(corpus).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.status).toBe("PARTIAL");
    expect(result.reasons).toContain("RETRIEVAL_DEGRADED");
    expect(result.reasons).not.toContain("CORPUS_UNAVAILABLE");
    expect(result.warnings).toContain("RETRIEVAL_ERROR:primary:relation does not exist");
  });
});

// ---------------------------------------------------------------------------
// 4b. Cloud switch
// ---------------------------------------------------------------------------

class FakeCloudDrafter implements DrafterPort {
  readonly calls: DrafterInput[] = [];
  constructor(private readonly behaviour: "cite-pack" | "cite-unknown" | "throw" = "cite-pack") {}
  async draftClaims(input: DrafterInput): Promise<ClaimDraft[]> {
    this.calls.push(input);
    if (this.behaviour === "throw") throw new Error("cloud model unavailable");
    const first = input.pack.items[0];
    if (first === undefined) return [];
    const ids = this.behaviour === "cite-unknown" ? [first.ref.evidenceId, "ev-uydurma-0000"] : [first.ref.evidenceId];
    return [
      {
        claimId: "claim-cloud-1",
        text: `Bulut taslak: "${first.ref.quote}"`,
        material: true,
        evidenceIds: ids,
        treatment: "supported",
        confidence: { retrieval: 1, entailment: 0, authority: 1, currentness: 1, coverage: 1 },
      },
    ];
  }
}

class FakeCloudEntailment implements EntailmentPort {
  calls = 0;
  async assess(): Promise<{ entails: boolean; score: number; rationale: string }> {
    this.calls += 1;
    return { entails: true, score: 1, rationale: "bulut hakem (sahte)" };
  }
}

describe("cloud AI is a per-request switch", () => {
  const cloudOf = (drafter: FakeCloudDrafter, entailment: FakeCloudEntailment) => ({
    drafter,
    entailment,
    label: "Bulut (sahte)",
  });

  it("useCloudAi: true routes ONLY that request through the cloud ports", async () => {
    const drafter = new FakeCloudDrafter();
    const entailment = new FakeCloudEntailment();
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])), {
      cloud: cloudOf(drafter, entailment),
    });

    const cloud = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01", useCloudAi: true });
    expect(cloud.result.aiUsed).toEqual({ drafter: true, entailment: true, label: "Bulut (sahte)" });
    expect(drafter.calls).toHaveLength(1);
    expect(entailment.calls).toBeGreaterThan(0);
    expect(cloud.result.claims[0]!.claimId).toBe("claim-cloud-1");
    expect(cloud.result.claims[0]!.entailments[0]!.rationale).toBe("bulut hakem (sahte)");
    expect(cloud.result.warnings.some((w) => w.startsWith("AI_UNAVAILABLE"))).toBe(false);

    const local = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(local.result.aiUsed).toEqual({ drafter: false, entailment: false, label: RULE_BASED_LABEL_TR });
    expect(drafter.calls).toHaveLength(1); // untouched by the second run
    expect(local.result.claims[0]!.claimId).not.toBe("claim-cloud-1");
  });

  it("useCloudAi without configured ports warns AI_UNAVAILABLE and continues rule-based", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")]))).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useCloudAi: true,
    });
    expect(result.warnings).toContain(`AI_UNAVAILABLE:${AI_UNAVAILABLE_MESSAGE_TR}`);
    expect(result.aiUsed).toEqual({ drafter: false, entailment: false, label: RULE_BASED_LABEL_TR });
    expect(result.status).toBe("COMPLETE");
  });

  it("the citation-first invariant holds for the cloud drafter: an unknown id fails validation", async () => {
    const drafter = new FakeCloudDrafter("cite-unknown");
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")])), {
      cloud: cloudOf(drafter, new FakeCloudEntailment()),
    }).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01", useCloudAi: true });

    expect(result.warnings.some((w) => w.startsWith("DRAFTER_CITED_UNKNOWN_EVIDENCE:claim-cloud-1:ev-uydurma-0000"))).toBe(true);
    const claim = result.claims[0]!;
    expect(claim.citationChecks.some((c) => c.evidenceId === "ev-uydurma-0000" && !c.ok && c.reason === "EVIDENCE_NOT_IN_PACK")).toBe(true);
    expect(claim.evidenceIds).not.toContain("ev-uydurma-0000");
    expect(claim.verdict).not.toBe("SUPPORTED");
    expect(result.finalizable).toBe(false);
    expect(result.status).not.toBe("COMPLETE");
  });

  it("a failing cloud drafter degrades to PARTIAL and says which port was used", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")])), {
      cloud: cloudOf(new FakeCloudDrafter("throw"), new FakeCloudEntailment()),
    }).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01", useCloudAi: true });
    expect(result.status).toBe("PARTIAL");
    expect(result.reasons).toContain("DRAFTER_DEGRADED");
    expect(result.aiUsed).toEqual({ drafter: false, entailment: true, label: "Bulut (sahte)" });
  });

  it("the gate runs BEFORE the cloud drafter: nothing leaves the machine for an uncovered question", async () => {
    const drafter = new FakeCloudDrafter();
    const { result } = await pipelineWith(
      new StubCorpus(() => ok([hitDecisionFor(), hitDecisionAgainst(), expandedTck()])),
      { cloud: cloudOf(drafter, new FakeCloudEntailment()) },
    ).answer({ question: Q_NEAR_MISS, asOf: "2026-06-01", useCloudAi: true });
    expect(result.status).toBe("ABSTAIN");
    expect(drafter.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Text port sanity for the upload fixture (keeps the fixture honest)
// ---------------------------------------------------------------------------

describe("upload fixture", () => {
  it("quotes are sliced from the canonical text, not from the hit", async () => {
    const texts = new MapTextPort(new Map([[VERSION_UPLOAD, TEXT_UPLOAD]]));
    const { result } = await new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([uploadHit()])),
      texts,
      ...deterministicOptions(),
    }).answer({ question: Q_NEAR_MISS, asOf: "2026-06-01", filters: { fileIds: [UPLOAD_FILE_ID] } });
    expect(result.evidence[0]!.quote).toBe(QUOTE_UPLOAD);
  });
});

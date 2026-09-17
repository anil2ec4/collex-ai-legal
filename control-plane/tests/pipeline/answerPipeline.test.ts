/**
 * End-to-end behaviour of the citation-first answer pipeline, entirely offline.
 *
 * These are the same five behaviours `control-plane/scripts/demo.mjs` proves
 * against the real corpus, expressed against fakes so they run in CI without a
 * database — plus three properties the demo cannot show: an injection payload
 * must not change control flow, the trace must always be populated, and a
 * broken store must degrade to PARTIAL instead of throwing.
 */

import { describe, expect, it } from "vitest";

import {
  AnswerPipeline,
  IntakeValidationError,
  guardAnswerMarkdown,
} from "../../src/pipeline/answerPipeline.js";
import type { AnswerResult, ClaimView } from "../../src/pipeline/types.js";
import type { CorpusRetrievalPort } from "../../src/pipeline/ports.js";
import { runTamperCheck } from "../../src/pipeline/tamper.js";
import { CURRENTNESS_NEUTRAL_SCORE } from "../../src/answer/evidencePack.js";
import {
  CURRENTNESS_NOT_APPLICABLE_LABEL_TR,
  FINALIZE_TR,
  UPLOAD_ONLY_EVIDENCE_TEXT,
} from "../../src/answer/renderer.js";
import {
  TEMPORAL_COMPARISON_MISSING,
  UPLOAD_ONLY_EVIDENCE,
} from "../../src/answer/verifier.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";
import { FIXTURES } from "../security/corpus.js";
import {
  BrokenCorpus,
  MapTextPort,
  Q_APPLICATION,
  Q_NORM_CONTENT,
  Q_TEMPORAL,
  Q_UNANSWERABLE,
  Q_UPLOAD,
  QUOTE_157_V1,
  QUOTE_157_V2,
  QUOTE_UPLOAD,
  STANDARD_FACTS,
  StubCorpus,
  TEXT_TCK_V1,
  UPLOAD_FILE_ID,
  VERSION_INJECTED,
  VERSION_TCK_V1,
  VERSION_TCK_V2,
  deterministicOptions,
  factsPort,
  hitAmendingLaw,
  hitDecisionAgainst,
  hitDecisionFor,
  hitTck,
  hitUpload,
  injectedDocument,
  laneError,
  ok,
  standardTexts,
  torbaTexts,
  uploadTexts,
} from "./fakes.js";

function pipelineWith(corpus: CorpusRetrievalPort, texts = standardTexts()): AnswerPipeline {
  return new AnswerPipeline({
    retrieval: corpus,
    texts,
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
  });
}

/** Code-point slice — the project offset policy. */
function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

describe("S1 — a supported answer binds every claim to a verifiable passage", () => {
  it("returns COMPLETE with quotes re-derivable from the canonical text", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.schema).toBe("collex.answer.result/v1");
    expect(result.status).toBe("COMPLETE");
    expect(result.finalizable).toBe(true);
    expect(result.evidence).toHaveLength(1);

    const evidence = result.evidence[0]!;
    expect(evidence.legislationNo).toBe("5237");
    expect(evidence.article).toBe("157");
    expect(evidence.quote).toBe(QUOTE_157_V1);

    // The full chain, recomputed here rather than trusted: canonical text ->
    // content digest -> code-point span -> quote -> quote digest.
    expect(sha256HexUtf8(TEXT_TCK_V1)).toBe(evidence.contentSha256);
    expect(codePointSlice(TEXT_TCK_V1, evidence.startChar, evidence.endChar)).toBe(evidence.quote);
    expect(sha256HexUtf8(evidence.quote)).toBe(evidence.quoteSha256);

    // Every claim carries the five confidence dimensions and a valid citation.
    expect(result.claims.length).toBeGreaterThan(0);
    for (const claim of result.claims) {
      expect(Object.keys(claim.confidence).sort()).toEqual([
        "authority", "coverage", "currentness", "entailment", "retrieval",
      ]);
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      expect(claim.citationChecks.every((c) => c.ok)).toBe(true);
    }
  });

  it("never lets a search snippet become evidence: quotes come from the canonical text", async () => {
    // The retrieval hit claims a passage that is NOT what the canonical text
    // holds at those offsets. buildEvidencePack slices the canonical text, so
    // the provider's string cannot survive.
    const hit = hitTck("v1");
    const forged = { ...hit, provenance: { ...hit.provenance, originalText: "UYDURMA PASAJ" } };
    const pipeline = pipelineWith(new StubCorpus(() => ok([forged])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.evidence[0]!.quote).toBe(QUOTE_157_V1);
    expect(result.evidence[0]!.quote).not.toContain("UYDURMA");
    expect(result.markdown).not.toContain("UYDURMA");
  });

  it("rejects a candidate whose canonical text cannot be fetched, and says so", async () => {
    const pipeline = pipelineWith(
      new StubCorpus(() => ok([hitTck("v1")])),
      new MapTextPort(new Map()),
    );
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.evidence).toHaveLength(0);
    expect(result.rejectedEvidence).toHaveLength(1);
    expect(result.rejectedEvidence[0]!.reason).toBe("CANONICAL_TEXT_UNAVAILABLE");
    expect(result.status).toBe("ABSTAIN");
    expect(result.warnings.some((w) => w.startsWith("EVIDENCE_REJECTED:"))).toBe(true);
  });
});

describe("S2 — abstention is honest and has ZERO citation cards", () => {
  it("abstains with no evidence, no claims and no source section", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([])));
    const { result } = await pipeline.answer({ question: Q_UNANSWERABLE, asOf: "2026-06-01" });

    expect(result.status).toBe("ABSTAIN");
    expect(result.evidence).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(result.bundle.evidence).toEqual([]);
    expect(result.reasons).toContain("NO_EVIDENCE");

    // W15: aynı ölçüm — çekimser cevabın markdown gövdesi, cevabın neden
    // yazılmadığını açıkça söyler. Eski cümle ("cevap vermekten kaçınıyoruz")
    // avukata bunun bir kural mı arıza mı olduğunu söylemiyordu.
    expect(result.markdown).toContain("Dayanak bulunamadı — bu yüzden cevap yazılmadı.");
    expect(result.markdown).not.toContain("## Kaynaklar");
    expect(result.markdown).not.toMatch(/^### \[\d+\]/m);
  });

  it("reports an abstention as NOT finalizable", async () => {
    // Saying "finalizable" next to "we could not answer" would read as "safe
    // to rely on", so canFinalize([]) is false: finalizability needs at least
    // one material claim, not merely the absence of a failing one.
    const pipeline = pipelineWith(new StubCorpus(() => ok([])));
    const { result } = await pipeline.answer({ question: Q_UNANSWERABLE });

    expect(result.finalizable).toBe(false);
    expect(result.reasons).toContain("ABSTENTION_NOT_FINALIZABLE");
  });

  it("distinguishes 'nothing to find' from 'we could not look'", async () => {
    const broken = pipelineWith(new StubCorpus(() => laneError("relation does not exist")));
    const { result } = await broken.answer({ question: Q_UNANSWERABLE, asOf: "2026-06-01" });

    expect(result.status).toBe("PARTIAL");
    expect(result.reasons).toContain("RETRIEVAL_DEGRADED");
  });
});

describe("S3 — contrary authority is surfaced, not hidden", () => {
  it("marks the claims CONFLICTING_AUTHORITIES and keeps both sides", async () => {
    const pipeline = pipelineWith(
      new StubCorpus(() => ok([hitTck("v2"), hitDecisionFor(), hitDecisionAgainst()])),
    );
    const { result } = await pipeline.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    const dockets = result.evidence.map((e) => e.docketNo);
    expect(dockets).toContain("2023/4521");
    expect(dockets).toContain("2023/7810");

    const against = result.evidence.find((e) => e.docketNo === "2023/7810")!;
    expect(against.stance).toBe("contrary");
    expect(against.polarity).toBe("NEGATIVE");
    expect(against.polarityMarkers.length).toBeGreaterThan(0);

    const conflicted = result.claims.filter((c) => c.verdict === "CONFLICTING_AUTHORITIES");
    expect(conflicted.length).toBeGreaterThan(0);
    expect(result.contraryCoverage.contraryEvidenceIds).toContain(against.evidenceId);
    expect(result.contraryCoverage.conflictedClaimIds.length).toBeGreaterThan(0);
    // W15: "otorite" kanonik sözlükte "kaynak"tır; bölüm başlığı değişti,
    // ölçülen davranış (çelişkili tespitlerin ayrı bir başlık altında
    // sayılması) aynı.
    expect(result.markdown).toContain("Kaynakları çelişen tespitler");
  });

  it("executes contrary-authority lanes and records each one", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v2"), hitDecisionAgainst()]));
    const pipeline = pipelineWith(corpus);
    const { result } = await pipeline.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    expect(result.contraryCoverage.executed).toBe(true);
    expect(result.contraryCoverage.usable).toBe(true);
    expect(result.contraryCoverage.lanes.length).toBeGreaterThan(0);
    for (const lane of result.contraryCoverage.lanes) {
      expect(lane.query).not.toBe("");
      expect(lane.status).toBe("ok");
    }
    // The primary query plus one query per executed lane.
    expect(corpus.calls).toHaveLength(1 + result.contraryCoverage.lanes.length);
  });

  it("V-21: an off-topic question runs NO contrary lane and says so plainly", async () => {
    // MEASURED (W14-F-VERIFY §3, V-21): "en iyi balik restorani hangisi"
    // executed two contrary lanes — two full retrievals, trigram budget
    // included — and the answer then read "2 karşıt otorite sorgusu
    // çalıştırıldı; karşıt otorite pasajı bulunamadı", which tells the lawyer
    // a real scan came back empty. Nothing was there to contradict.
    const corpus = new StubCorpus(() => ok([]));
    const pipeline = pipelineWith(corpus);
    const { result } = await pipeline.answer({
      question: "en iyi balik restorani hangisi",
      asOf: "2026-06-01",
    });

    // ONE retrieval: the primary lane. No contrary query was sent at all.
    expect(corpus.calls).toHaveLength(1);
    expect(corpus.calls.every((call) => !call.query.includes("aksi yönde"))).toBe(true);
    expect(result.contraryCoverage.executed).toBe(false);
    expect(result.contraryCoverage.skipped).toBe(true);
    expect(result.contraryCoverage.lanes).toEqual([]);

    // …and the sentence says a scan was not NEEDED, never that one found
    // nothing.
    expect(result.contraryCoverage.note).toContain("aleyhe kaynak taraması gerekmedi ve yapılmadı");
    expect(result.contraryCoverage.note).not.toContain("çalıştırıldı");
    expect(result.contraryCoverage.note).not.toContain("aleyhe kaynak bulunamadı");
    expect(result.markdown).toContain("Aleyhe kaynak taraması yapılmadı");
    expect(result.markdown).toContain("tarama gerekmedi");
    expect(result.markdown).not.toMatch(/\d+ ayrı aleyhe kaynak araması yapıldı/u);
    expect(result.status).toBe("ABSTAIN");
  });

  it("V-21: the skip NEVER fires for an answer that has evidence", async () => {
    // The guarantee this must not weaken. One passage that anchors the
    // question is enough for every planned lane to run, exactly as before.
    const corpus = new StubCorpus(() => ok([hitTck("v2")]));
    const pipeline = pipelineWith(corpus);
    const { result } = await pipeline.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    expect(result.contraryCoverage.skipped).toBe(false);
    expect(result.contraryCoverage.executed).toBe(true);
    expect(result.contraryCoverage.lanes.length).toBeGreaterThan(0);
    expect(corpus.calls).toHaveLength(1 + result.contraryCoverage.lanes.length);
  });

  it("V-21: a PINNED passage keeps the lanes running even with no lexical anchor", async () => {
    // A pinned hit means the reader cited a text by name and the coverage
    // gate is BYPASSED for it, so the answer can still stand: the skip must
    // not reach that case.
    const pinned = { ...hitTck("v1"), pinned: true };
    const corpus = new StubCorpus(() => ok([pinned]));
    const pipeline = pipelineWith(corpus);
    const { result } = await pipeline.answer({
      question: "en iyi balik restorani hangisi",
      asOf: "2026-06-01",
    });

    expect(result.contraryCoverage.skipped).toBe(false);
    expect(result.contraryCoverage.lanes.length).toBeGreaterThan(0);
  });

  it("reports a contrary lane outage as a lane failure, not as absence of authority", async () => {
    const corpus = new StubCorpus((request) =>
      request.query === Q_APPLICATION ? ok([hitTck("v2")]) : laneError("lane timeout"),
    );
    const pipeline = pipelineWith(corpus);
    const { result } = await pipeline.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    expect(result.contraryCoverage.executed).toBe(true);
    expect(result.contraryCoverage.usable).toBe(false);
    expect(result.contraryCoverage.note).toContain("hepsi hata verdi");
    expect(result.warnings.some((w) => w.startsWith("RETRIEVAL_ERROR:contrary"))).toBe(true);
    // The PRIMARY lane still worked, so the answer itself is not degraded by
    // the outage. (Since W12-FIX the answer IS partial for a different,
    // stated reason: the cited statute alone does not cover an application
    // question about kapora — QUESTION_PARTIALLY_COVERED, never
    // RETRIEVAL_DEGRADED.)
    expect(result.reasons).not.toContain("RETRIEVAL_DEGRADED");
    expect(result.reasons).toContain("QUESTION_PARTIALLY_COVERED");
  });
});

describe("S4 — the same question at two dates cites the version in force", () => {
  it("answers from v1 before the amendment and v2 after it", async () => {
    const corpus = new StubCorpus((request) =>
      ok([hitTck(request.asOf < "2026-01-15" ? "v1" : "v2")]),
    );
    const pipeline = pipelineWith(corpus);

    const before = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    const after = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2026-06-01" });

    const a = before.result.evidence[0]!;
    const b = after.result.evidence[0]!;

    expect(a.documentVersionId).toBe(VERSION_TCK_V1);
    expect(b.documentVersionId).toBe(VERSION_TCK_V2);
    expect(a.quote).toBe(QUOTE_157_V1);
    expect(b.quote).toBe(QUOTE_157_V2);
    expect(a.quote).not.toBe(b.quote);

    expect(a.currentness.status).toBe("IN_FORCE");
    expect(b.currentness.status).toBe("IN_FORCE");
    expect(before.result.asOf).toBe("2025-06-01");
    expect(after.result.asOf).toBe("2026-06-01");
  });

  it("marks a superseded version OUT_OF_DATE when it is cited after its period", async () => {
    // v1 offered at a date on which only v2 was in force.
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2026-06-01" });

    expect(result.evidence[0]!.currentness.status).toBe("OUT_OF_DATE");
    expect(result.status).not.toBe("COMPLETE");
    expect(result.claims.some((c) => c.verdict === "OUT_OF_DATE_SOURCE")).toBe(true);
  });

  it("defaults asOf to today when the caller omits it", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v2")])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT });
    expect(result.asOf).toBe("2026-06-01");
  });
});

describe("S5 — one changed character breaks the citation and the answer", () => {
  it("rejects the tampered quote with its reason code and refuses to finalize", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const run = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(run.result.status).toBe("COMPLETE");

    const target = run.result.evidence[0]!;
    const tamper = await runTamperCheck(run.document, {
      evidenceId: target.evidenceId,
      position: 12,
    });

    expect(tamper.originalValidation).toEqual({ ok: true });
    expect(tamper.changedCodePoints).toBe(1);
    expect(tamper.tamperedValidation.ok).toBe(false);
    expect(tamper.rejectionReason).toBe("QUOTE_OFFSET_MISMATCH");

    const claim = tamper.claims.find((c) => c.claimId === `claim-${target.evidenceId}`)!;
    expect(claim.before.treatment).toBe("supported");
    expect(claim.after.treatment).toBe("unsupported");

    expect(tamper.finalizableBefore).toBe(true);
    expect(tamper.finalizableAfter).toBe(false);
    expect(tamper.statusAfter).not.toBe("COMPLETE");
  });

  it("rejects a shifted offset and a forged quote digest with distinct reasons", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const run = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    const shifted = await runTamperCheck(run.document, { mode: "offset-shift" });
    expect(shifted.rejectionReason).toBe("QUOTE_OFFSET_MISMATCH");

    const rehashed = await runTamperCheck(run.document, { mode: "quote-hash" });
    expect(rehashed.rejectionReason).toBe("QUOTE_HASH_MISMATCH");
  });
});

describe("S7 — an uploaded document is the lawyer's own text, not law (currentness not applicable)", () => {
  // The integration probe of 02.09.2026: a file-scoped answer came back
  // PARTIAL with OUT_OF_DATE_SOURCE because currentness treated the upload
  // like legislation with no yürürlük. These tests pin the fix AND its limit:
  // the corpus part of a mixed answer keeps the strict rule.
  const scoped = { fileIds: [UPLOAD_FILE_ID] };
  const mixed = { fileIds: [UPLOAD_FILE_ID], includeCorpus: true };

  /** Origin of the first validated citation of a claim. */
  function originOf(result: AnswerResult, claim: ClaimView): string | undefined {
    const id = claim.evidenceIds[0];
    return result.evidence.find((e) => e.evidenceId === id)?.origin;
  }

  it("answers from the upload alone: finalizable, no OUT_OF_DATE_SOURCE, currentness NOT_APPLICABLE", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitUpload()])), uploadTexts());
    const { result, document } = await pipeline.answer({
      question: Q_UPLOAD,
      asOf: "2026-06-01",
      filters: scoped,
    });

    expect(["COMPLETE", "QUALIFIED"]).toContain(result.status);
    expect(result.finalizable).toBe(true);
    expect(result.reasons).not.toContain("NOT_FINALIZABLE");
    expect(result.reasons.some((r) => r.startsWith("OUT_OF_DATE_SOURCE"))).toBe(false);
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims.some((c) => c.verdict === "OUT_OF_DATE_SOURCE")).toBe(false);

    // The dimension is NOT APPLICABLE — neutral, not "current".
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.origin).toBe("upload");
    expect(result.evidence[0]!.quote).toBe(QUOTE_UPLOAD);
    expect(result.evidence[0]!.currentness.status).toBe("NOT_APPLICABLE");
    expect(result.evidence[0]!.currentness.score).toBe(CURRENTNESS_NEUTRAL_SCORE);
    expect(result.evidence[0]!.currentness.rationale).toContain("yürürlük değerlendirilemez");
    for (const claim of result.claims) {
      expect(claim.currentnessApplicable).toBe(false);
      expect(claim.confidence.currentness).toBe(CURRENTNESS_NEUTRAL_SCORE);
    }
    expect(document.claims.every((c) => c.currentnessApplicable === false)).toBe(true);

    // The finalizable line says what the answer rests on — the reader's own
    // document, not law — and the claim's Güncellik is the label, not a %.
    expect(result.reasons).toContain(UPLOAD_ONLY_EVIDENCE);
    expect(result.markdown).toContain(
      `- Kesinleştirme: ${FINALIZE_TR.yes} ${UPLOAD_ONLY_EVIDENCE_TEXT}`,
    );
    expect(result.markdown).toContain(`- Güncellik: ${CURRENTNESS_NOT_APPLICABLE_LABEL_TR}`);
    expect(result.markdown).not.toMatch(/- Güncellik: %/);
    expect(result.markdown).toContain("- Kaynak türü: yüklediğiniz belge");
    expect(result.bundle.evidence[0]!.origin).toBe("upload");
    expect(result.bundle.evidence[0]!.currentness.status).toBe("NOT_APPLICABLE");
    expect(result.bundle.reasons).toContain(UPLOAD_ONLY_EVIDENCE);
  });

  it("a stale corpus source in the same answer still raises OUT_OF_DATE_SOURCE (strict rule for the corpus part)", async () => {
    // TCK v1 offered on a date on which only v2 was in force, next to the upload.
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitUpload(), hitTck("v1")])), uploadTexts());
    const { result } = await pipeline.answer({ question: Q_UPLOAD, asOf: "2026-06-01", filters: mixed });

    const own = result.claims.find((c) => originOf(result, c) === "upload")!;
    const stale = result.claims.find((c) => originOf(result, c) === "corpus")!;
    expect(own).toBeDefined();
    expect(stale).toBeDefined();

    expect(stale.verdict).toBe("OUT_OF_DATE_SOURCE");
    expect(stale.currentnessApplicable).toBe(true);
    expect(stale.confidence.currentness).toBeLessThan(0.9);
    expect(own.verdict).toBe("SUPPORTED");
    expect(own.currentnessApplicable).toBe(false);

    expect(result.evidence.find((e) => e.origin === "corpus")!.currentness.status).toBe("OUT_OF_DATE");
    expect(result.evidence.find((e) => e.origin === "upload")!.currentness.status).toBe("NOT_APPLICABLE");

    expect(result.finalizable).toBe(false);
    expect(result.status).toBe("PARTIAL");
    expect(result.reasons.some((r) => r.startsWith("OUT_OF_DATE_SOURCE:"))).toBe(true);
    // Mixed answer: the corpus part carried the strict rule, so it is NOT
    // marked as resting on the upload alone.
    expect(result.reasons).not.toContain(UPLOAD_ONLY_EVIDENCE);
    expect(result.markdown).toContain(`- Kesinleştirme: ${FINALIZE_TR.no}`);
    expect(result.markdown).not.toContain(UPLOAD_ONLY_EVIDENCE_TEXT);
  });

  it("an in-force corpus source next to the upload keeps the answer finalizable and unmarked", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitUpload(), hitTck("v2")])), uploadTexts());
    const { result } = await pipeline.answer({ question: Q_UPLOAD, asOf: "2026-06-01", filters: mixed });

    expect(result.status).toBe("COMPLETE");
    expect(result.finalizable).toBe(true);
    expect(result.reasons).not.toContain(UPLOAD_ONLY_EVIDENCE);
    const law = result.claims.find((c) => originOf(result, c) === "corpus")!;
    expect(law.currentnessApplicable).toBe(true);
    expect(law.confidence.currentness).toBe(1);
    expect(result.markdown).toContain(`- Kesinleştirme: ${FINALIZE_TR.yes}`);
    expect(result.markdown).not.toContain(UPLOAD_ONLY_EVIDENCE_TEXT);
  });

  it("validation still gates the upload: one changed character and it is not finalizable", async () => {
    const run = await pipelineWith(new StubCorpus(() => ok([hitUpload()])), uploadTexts()).answer({
      question: Q_UPLOAD,
      asOf: "2026-06-01",
      filters: scoped,
    });
    expect(run.result.finalizable).toBe(true);

    const tamper = await runTamperCheck(run.document, {
      evidenceId: run.result.evidence[0]!.evidenceId,
      position: 12,
    });
    expect(tamper.finalizableBefore).toBe(true);
    expect(tamper.finalizableAfter).toBe(false);
    expect(tamper.rejectionReason).toBe("QUOTE_OFFSET_MISMATCH");
    expect(tamper.statusAfter).not.toBe("COMPLETE");
  });

  it("the corpus-only path is untouched: a stale statute alone is still OUT_OF_DATE and not upload-marked", async () => {
    const { result } = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")]))).answer({
      question: Q_NORM_CONTENT,
      asOf: "2026-06-01",
    });
    expect(result.claims.some((c) => c.verdict === "OUT_OF_DATE_SOURCE")).toBe(true);
    expect(result.claims.every((c) => c.currentnessApplicable === true)).toBe(true);
    expect(result.reasons).not.toContain(UPLOAD_ONLY_EVIDENCE);
    expect(result.markdown).toContain(`- Kesinleştirme: ${FINALIZE_TR.no}`);
  });
});

describe("injection-bearing evidence never alters control flow", () => {
  const payload = (() => {
    const fixture = FIXTURES.find((f) => f.id === "adv-inject-001");
    if (fixture === undefined || typeof fixture.payload !== "string") {
      throw new Error("adversarial fixture adv-inject-001 is missing or not a string");
    }
    return fixture.payload;
  })();

  it("produces the same shape of answer as an equivalent benign passage", async () => {
    const injected = injectedDocument(payload);
    const texts = standardTexts(new Map([[VERSION_INJECTED, injected.text]]));

    const benign = await pipelineWith(
      new StubCorpus(() => ok([hitDecisionFor()])),
    ).answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    const hostile = await pipelineWith(
      new StubCorpus(() => ok([injected.hit])),
      texts,
    ).answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    // Same stages, same lane count, same number of evidence rows: the payload
    // changed nothing about what the pipeline decided to do.
    expect(hostile.result.trace.map((s) => s.name)).toEqual(
      benign.result.trace.map((s) => s.name),
    );
    expect(hostile.result.evidence).toHaveLength(benign.result.evidence.length);
    expect(hostile.result.contraryCoverage.lanes.length).toBe(
      benign.result.contraryCoverage.lanes.length,
    );
  });

  it("keeps the payload byte-exact but renders it only inside a quotation", async () => {
    const injected = injectedDocument(payload);
    const texts = standardTexts(new Map([[VERSION_INJECTED, injected.text]]));
    const { result } = await pipelineWith(
      new StubCorpus(() => ok([injected.hit])),
      texts,
    ).answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    expect(result.evidence).toHaveLength(1);
    // The evidence is NOT laundered: it still hashes to its recorded digest.
    expect(sha256HexUtf8(result.evidence[0]!.quote)).toBe(result.evidence[0]!.quoteSha256);
    expect(result.evidence[0]!.quote).toContain("SYSTEM:");

    // Every rendered line that carries the payload is a blockquote line, so it
    // reads as quoted evidence and never as a top-level instruction.
    const lines = result.markdown.split("\n").filter((l) => l.includes("SYSTEM:"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith("> ")).toBe(true);
  });

  it("neutralizes an exfiltration payload: no live off-allowlist link survives", async () => {
    const exfil = FIXTURES.find((f) => f.id === "adv-exfil-001");
    expect(exfil).toBeDefined();
    const injected = injectedDocument(String(exfil!.payload));
    const texts = standardTexts(new Map([[VERSION_INJECTED, injected.text]]));
    const { result } = await pipelineWith(
      new StubCorpus(() => ok([injected.hit])),
      texts,
    ).answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    // No markup channel survives: there is not a single unescaped `<` in the
    // output, so `<img>` and its `onerror` handler are inert visible text.
    expect(result.markdown).not.toContain("<");
    expect(result.markdown).toContain("&lt;img");
    // And the attacker host cannot autolink: `://` is defanged everywhere.
    expect(result.markdown).not.toContain("https://attacker.example");
    expect(result.markdown).toContain("https&#58;//attacker.example");
    // The handler text that remains is quoted evidence, never a bare line.
    const handlerLines = result.markdown.split("\n").filter((l) => l.includes("onerror"));
    expect(handlerLines.length).toBeGreaterThan(0);
    for (const line of handlerLines) {
      expect(line.startsWith("> ") || line.startsWith("### ")).toBe(true);
    }
  });

  it("guards the markdown idempotently and emits no raw markup", async () => {
    const injected = injectedDocument(payload);
    const texts = standardTexts(new Map([[VERSION_INJECTED, injected.text]]));
    const { result } = await pipelineWith(
      new StubCorpus(() => ok([injected.hit])),
      texts,
    ).answer({ question: Q_APPLICATION, asOf: "2026-06-01" });

    expect(guardAnswerMarkdown(result.markdown)).toBe(result.markdown);
    expect(result.markdown).not.toContain("<");
  });
});

describe("the trace is always populated", () => {
  // "coverage" (W12): the question-coverage gate runs between evidence and
  // draft, on every answer — including abstentions and broken stores.
  const stages = [
    "intake", "normalize", "parseReferences", "intent", "plan",
    "retrieve", "rank", "versionFacts", "evidence", "coverage", "draft", "verify", "render",
  ];

  it("records every stage with timings and counts on a successful answer", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.trace.map((s) => s.name)).toEqual(stages);
    for (const stage of result.trace) {
      expect(typeof stage.ms).toBe("number");
      expect(Number.isFinite(stage.ms)).toBe(true);
      expect(stage.counts).toBeTypeOf("object");
      expect(Array.isArray(stage.notes)).toBe(true);
    }
    const retrieve = result.trace.find((s) => s.name === "retrieve")!;
    expect(retrieve.counts["queries"]).toBeGreaterThan(0);
    expect(retrieve.counts["distinctPassages"]).toBe(1);
  });

  it("records every stage on an abstention too", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([])));
    const { result } = await pipeline.answer({ question: Q_UNANSWERABLE });
    expect(result.trace.map((s) => s.name)).toEqual(stages);
    expect(result.trace.find((s) => s.name === "evidence")!.counts["accepted"]).toBe(0);
  });

  it("records every stage when the store is broken", async () => {
    const pipeline = pipelineWith(new BrokenCorpus());
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT });
    expect(result.trace.map((s) => s.name)).toEqual(stages);
  });
});

describe("a store failure degrades instead of throwing", () => {
  it("returns PARTIAL with a warning when the port throws", async () => {
    const pipeline = pipelineWith(new BrokenCorpus());
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.status).toBe("PARTIAL");
    expect(result.finalizable).toBe(false);
    expect(result.reasons).toContain("RETRIEVAL_DEGRADED");
    expect(result.warnings.some((w) => w.includes("RETRIEVAL_PORT_THREW"))).toBe(true);
  });

  it("returns PARTIAL when the port reports a typed error", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => laneError("statement timeout")));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.status).toBe("PARTIAL");
    expect(result.warnings.some((w) => w.startsWith("RETRIEVAL_ERROR:primary:"))).toBe(true);
  });

  it("survives a failing version-facts port with conservative currentness", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: {
        fetch: () => Promise.reject(new Error("facts table is gone")),
      },
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.warnings.some((w) => w.startsWith("VERSION_FACTS_FAILED:"))).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.currentness.status).toBe("UNKNOWN");
  });

  it("degrades to PARTIAL when the drafter throws", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      drafter: { draftClaims: () => Promise.reject(new Error("model adapter unavailable")) },
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.status).toBe("PARTIAL");
    expect(result.reasons).toContain("DRAFTER_DEGRADED");
    expect(result.warnings.some((w) => w.startsWith("DRAFTER_FAILED:"))).toBe(true);
  });

  it("treats a failing entailment port as unsupported, never as supported", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      entailment: { assess: () => Promise.reject(new Error("judge unavailable")) },
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.warnings.some((w) => w.startsWith("ENTAILMENT_PORT_FAILED:"))).toBe(true);
    expect(result.status).not.toBe("COMPLETE");
    for (const claim of result.claims) expect(claim.confidence.entailment).toBe(0);
  });

  it("W21 #22: a failing judge leaves every claim 'not checked', never a measured shortfall", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      entailment: { assess: () => Promise.reject(new Error("judge unavailable")) },
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(result.claims.length).toBeGreaterThan(0);
    for (const claim of result.claims) {
      expect(claim.reasons).toContain(`ENTAILMENT_NOT_CHECKED:${claim.claimId}`);
      expect(claim.reasons.join(" ")).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
      for (const entailment of claim.entailments) expect(entailment.rationale).toContain("denetlenemedi");
    }
    expect(result.reasons.join(" ")).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
    expect(result.markdown).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
    expect(result.finalizable).toBe(false);
  });
});

describe("request contract", () => {
  it("rejects an invalid intake with IntakeValidationError", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([])));
    await expect(pipeline.answer({ question: "a" })).rejects.toBeInstanceOf(
      IntakeValidationError,
    );
    await expect(
      pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2026-02-31" }),
    ).rejects.toBeInstanceOf(IntakeValidationError);
  });

  it("always carries a corpus provenance banner and a synthetic-marked bundle", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    // W15: aynı ölçüm, yeni sözcükler — "SENTETİK" yerine "deneme
    // belgeleri", "KORPUS" yerine "hukuk kütüphanesi".
    expect(result.corpusNotice).toMatch(/DENEME BELGELER/i);
    expect(result.markdown).toContain("HUKUK KÜTÜPHANESİ UYARISI");
    expect(result.bundle.schema).toBe("collex.answer.evidence-bundle/v1");
    expect(result.bundle.synthetic).toBe(true);
    expect(result.bundle.syntheticNotice).toBe(result.corpusNotice);
    expect(result.bundle.producer).toBeTypeOf("string");
  });

  it("W18: drops the deneme-belgeleri banner only when EVERY admitted document is real", async () => {
    const real = STANDARD_FACTS.map((f) => ({ ...f, synthetic: false }));
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(real),
      ...deterministicOptions(),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.corpusNotice).not.toMatch(/DENEME BELGELER/i);
    expect(result.corpusNotice).toMatch(/hukuk kütüphanesine kaydedilmiştir/);
    expect(result.bundle.synthetic).toBe(false);
    expect(result.bundle.syntheticNotice).toBe(result.corpusNotice);
    expect(result.markdown).toContain("HUKUK KÜTÜPHANESİ UYARISI");
    expect(result.corpusProvenance).toEqual({ real: 1, synthetic: 0, unknown: 0 });

    // Unknown provenance keeps the warning: the store did not say, so the
    // reader is not told the texts are real.
    const unknownPipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])));
    const unknown = (await unknownPipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" })).result;
    expect(unknown.corpusNotice).toMatch(/DENEME BELGELER/i);
    expect(unknown.bundle.synthetic).toBe(true);
    expect(unknown.corpusProvenance?.real).toBe(0);
  });

  it("forwards filters and limits to the corpus port unchanged", async () => {
    const corpus = new StubCorpus(() => ok([]));
    const pipeline = pipelineWith(corpus);
    await pipeline.answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      filters: { documentTypes: ["kanun"] },
      limits: { resultLimit: 3 },
    });

    expect(corpus.calls.length).toBeGreaterThan(0);
    for (const call of corpus.calls) {
      expect(call.asOf).toBe("2025-06-01");
      expect(call.filters).toEqual({ documentTypes: ["kanun"] });
      expect(call.limits).toEqual({ resultLimit: 3 });
    }
  });
});

describe("wall budget (W12-FIX2, P1-5b) — TIME_BUDGET_EXCEEDED is a PARTIAL answer, never a hang", () => {
  it("skips drafting once the budget is gone, keeps the passages, says why", async () => {
    let tick = 0;
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      // Every clock read costs 10 "ms"; the retrieval stage alone burns the budget.
      monotonic: () => (tick += 10),
      timeBudgetMs: 30,
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.status).toBe("PARTIAL");
    expect(result.finalizable).toBe(false);
    expect(result.reasons).toContain("TIME_BUDGET_EXCEEDED");
    expect(result.reasons).not.toContain("NO_CLAIMS_DRAFTED");
    expect(result.reasons).not.toContain("ABSTENTION_NOT_FINALIZABLE");
    expect(result.claims).toEqual([]);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.warnings.filter((w) => w.startsWith("TIME_BUDGET_EXCEEDED:"))).toHaveLength(1);
    expect(result.warnings.find((w) => w.startsWith("TIME_BUDGET_EXCEEDED:"))).toMatch(/^TIME_BUDGET_EXCEEDED:\d+ms>30ms$/u);
    expect(result.trace.some((s) => s.notes.includes("SKIPPED_TIME_BUDGET_EXCEEDED"))).toBe(true);
    expect(result.markdown).toContain("(TIME_BUDGET_EXCEEDED)");
    expect(result.aiUsed?.drafter).toBe(false);
  });

  it("does not fire on the default budget with the deterministic clock; 0 disables it", async () => {
    const normal = await pipelineWith(new StubCorpus(() => ok([hitTck("v1")]))).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(normal.result.reasons).not.toContain("TIME_BUDGET_EXCEEDED");
    expect(normal.result.status).toBe("COMPLETE");
    let tick = 0;
    const disabled = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      monotonic: () => (tick += 10_000),
      timeBudgetMs: 0,
    });
    const { result } = await disabled.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.status).toBe("COMPLETE");
  });

  it("caps quotes at maxQuoteCodePoints and flags them (alıntı kısaltıldı)", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      maxQuoteCodePoints: 40,
    });
    const { result, pack } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    const tck = result.evidence.find((e) => e.documentVersionId === VERSION_TCK_V1);
    expect(tck?.quoteTruncated).toBe(true);
    expect(Array.from(tck!.quote).length).toBeLessThanOrEqual(40);
    expect(tck?.quoteSha256).toBe(sha256HexUtf8(tck!.quote));
    expect(codePointSlice(pack.texts[VERSION_TCK_V1]!, tck!.startChar, tck!.endChar)).toBe(tck!.quote);
    expect(result.warnings.some((w) => /^QUOTE_TRUNCATED:.*>40$/u.test(w))).toBe(true);
    // Stored bundle + tamper check still hold on the window.
    expect(result.bundle.evidence.find((e) => e.evidenceId === tck!.evidenceId)?.quote).toBe(tck!.quote);
  });
});

// ---------------------------------------------------------------------------
// W14 B-09 — a temporal question owes the reader a version comparison
//
// Measured 02.09.2026 (DAILYFLOW §2, question 3): `asOf 2024-06-01` plus
// "2026 öncesi mi sonrası mı uygulanır?" returned the v1 text alone — not one
// word about the amending law, the difference between the texts, or the lehe
// kanun test — and was declared TAM and KESİNLEŞTİRİLEBİLİR.
// ---------------------------------------------------------------------------

describe("B-09 — a temporal question is never COMPLETE without the comparison", () => {
  const texts = (): MapTextPort => standardTexts(new Map([...torbaTexts()]));

  it("refuses COMPLETE when only one version is in evidence, and says why", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])), texts());
    const { result } = await pipeline.answer({ question: Q_TEMPORAL, asOf: "2024-06-01" });

    expect(result.status).not.toBe("COMPLETE");
    expect(result.reasons).toContain(TEMPORAL_COMPARISON_MISSING);
    expect(result.temporal?.applicable).toBe(true);
    expect(result.temporal?.present).toBe(false);
    expect(result.temporal?.note).toContain("karşılaştırılmadı");
    // Verbatim in the answer text AND in the export bundle (KABUL).
    expect(result.markdown).toContain(TEMPORAL_COMPARISON_MISSING);
    expect(result.markdown).toContain(
      "Sorulan tarih için hangi metnin uygulanacağı karşılaştırılmadı",
    );
    expect(result.bundle.reasons).toContain(TEMPORAL_COMPARISON_MISSING);
  });

  it("lists both versions and names the amending law when the comparison IS there", async () => {
    const corpus = new StubCorpus(() =>
      ok([hitTck("v1"), hitTck("v2"), hitAmendingLaw("chunk-tck-157-v1")]),
    );
    const { result } = await pipelineWith(corpus, texts()).answer({
      question: Q_TEMPORAL,
      asOf: "2024-06-01",
    });

    expect(result.temporal?.applicable).toBe(true);
    expect(result.temporal?.present).toBe(true);
    expect(result.reasons).not.toContain(TEMPORAL_COMPARISON_MISSING);
    // Both versions of TCK m.157 are listed, each with its role at the date.
    const versions = result.temporal?.versions ?? [];
    expect(versions.map((entry) => entry.documentVersionId).sort()).toEqual(
      [VERSION_TCK_V1, VERSION_TCK_V2].sort(),
    );
    expect(versions.map((entry) => entry.role)).toContain("sorulan-tarihte");
    // ...and the instrument that amended it is named by its own identity.
    expect(result.temporal?.amendedBy.map((entry) => entry.legislationNo)).toContain("7999");
    expect(result.temporal?.amendedBy[0]?.kind).toBe("AMENDS");
  });

  it("changes nothing for a question with no temporal wording", async () => {
    const pipeline = pipelineWith(new StubCorpus(() => ok([hitTck("v1")])), texts());
    const { result } = await pipeline.answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    });
    expect(result.temporal).toBeUndefined();
    expect(result.reasons).not.toContain(TEMPORAL_COMPARISON_MISSING);
    expect(result.status).toBe("COMPLETE");
  });
});

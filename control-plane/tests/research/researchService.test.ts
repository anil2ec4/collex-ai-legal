/**
 * Offline tests for the live deep-research service (Lane F2).
 *
 * A ScriptedGateway plays the REAL payload shapes of the Python tools; no
 * network, no clocks beyond injected constants.
 */

import { describe, expect, it } from "vitest";
import { validateEvidence, sha256HexUtf8 } from "../../src/verification/validator.js";
import {
  canonicalizeFetchedText,
  selectQuoteSpans,
} from "../../src/research/liveEvidence.js";
import {
  clampResearchBudgets,
  runResearch,
  DEFAULT_RESEARCH_BUDGETS,
  RESEARCH_BUDGET_CEILING,
} from "../../src/research/researchService.js";
import {
  QUESTION,
  ScriptedGateway,
  bedestenFailurePayload,
  bedestenSearchPayload,
  bedestenDecision,
  callShapes,
  contraryDecisionText,
  fixedClocks,
  happyScripts,
  injectedDecisionText,
  mevzuatNoResultsText,
  primaryDecisionText,
  withinKanunText,
} from "./helpers.js";

const BIG_BUDGET = { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 120_000 };

describe("budget clamping", () => {
  it("uses defaults when nothing is requested", () => {
    expect(clampResearchBudgets(undefined)).toEqual(DEFAULT_RESEARCH_BUDGETS);
  });

  it("clamps oversized budgets to the contract ceiling", () => {
    expect(
      clampResearchBudgets({ maxToolCalls: 9_999, maxFetches: 500, maxWallTimeMs: 10 ** 9 }),
    ).toEqual(RESEARCH_BUDGET_CEILING);
  });

  it("clamps non-positive budgets up to 1", () => {
    const clamped = clampResearchBudgets({ maxToolCalls: 0, maxFetches: -3 });
    expect(clamped.maxToolCalls).toBe(1);
    expect(clamped.maxFetches).toBe(1);
  });
});

describe("quote span selection", () => {
  it("selects overlapping paragraphs with code-point offsets", () => {
    const text = canonicalizeFetchedText(primaryDecisionText("7001"));
    const spans = selectQuoteSpans(text, "dolandırıcılık 5237 157");
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.endChar).toBeGreaterThan(span.startChar);
      const quote = Array.from(text).slice(span.startChar, span.endChar).join("");
      expect(quote.trim().length).toBeGreaterThan(0);
      expect(text.includes(quote)).toBe(true);
    }
  });
});

describe("happy path (search -> reserved fetch -> evidence -> verified answer)", () => {
  it("invokes local passage selection in the real research composition", async () => {
    let calls = 0;
    const run = await runResearch({ question: QUESTION, budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()), ...fixedClocks(),
      localPassageEmbedder: { async embed(texts) {
        calls++;
        expect(texts[0]).toMatch(/^query: /);
        return texts.map(() => [1, ...Array<number>(383).fill(0)]);
      } },
    });
    expect(calls).toBe(1);
    expect(run.result.evidence.length).toBeGreaterThan(0);
  });
  it("qualifies same-issue contrary authority while keeping citations hash-pinned to fetched text", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });
    const { result } = run;

    expect(result.schema).toBe("collex.answer.result/v1");
    expect(result.status).toBe("QUALIFIED");
    expect(result.claims.some((claim) => claim.verdict === "CONFLICTING_AUTHORITIES")).toBe(true);
    expect(result.contraryCoverage.conflictedClaimIds.length).toBeGreaterThan(0);
    expect(result.finalizable).toBe(true);
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.research.mode).toBe("live");
    expect(result.research.upstream.healthy).toBe(true);

    // Every citation revalidates deterministically against the canonical
    // fetched text, and its contentSha256 IS the fetched text's hash.
    for (const item of run.pack.items) {
      const text = run.pack.texts[item.ref.documentVersionId];
      expect(text).toBeDefined();
      expect(validateEvidence(item.ref, text as string)).toEqual({ ok: true });
      expect(item.ref.contentSha256).toBe(sha256HexUtf8(text as string));
    }

    // Budgets respected and reported.
    expect(result.research.budgetSpent.toolCalls).toBeLessThanOrEqual(24);
    expect(result.research.budgetSpent.fetches).toBeLessThanOrEqual(6);
    expect(result.research.toolCalls.every((t) => t.ms >= 0)).toBe(true);

    // The fetched-documents report matches the store.
    expect(result.research.fetchedDocuments.length).toBe(
      result.research.budgetSpent.fetches,
    );
  });

  it("stamps origin 'live' on every fetched passage (W12-B2 §2 applied in API2)", async () => {
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(run.pack.items.length).toBeGreaterThan(0);
    for (const item of run.pack.items) expect(item.origin).toBe("live");
    for (const view of run.result.evidence) expect(view.origin).toBe("live");
    for (const row of run.result.bundle.evidence) expect(row.origin).toBe("live");
    // The stored-answer shape (research/routes.ts toAnswerEntry) is the
    // result itself, so a persisted live answer carries it too.
    expect(run.result.evidence.every((e) => e.currentness.status !== "NOT_APPLICABLE")).toBe(true);
  });

  it("never cites a search snippet: every contentSha256 is a FETCHED text hash", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });

    // The complete universe of fetchable full texts in this scenario.
    const fetchedHashes = new Set(
      ["7001", "7002", "7101", "7102", "7103"].map((id) =>
        sha256HexUtf8(
          canonicalizeFetchedText(
            id.startsWith("71") ? contraryDecisionText(id) : primaryDecisionText(id),
          ),
        ),
      ),
    );
    // Everything a SEARCH ever returned (payload metadata; snippets live here).
    const searchPayloadJson = JSON.stringify(bedestenSearchPayload([bedestenDecision("x")]));

    expect(run.pack.items.length).toBeGreaterThan(0);
    for (const item of run.pack.items) {
      expect(fetchedHashes.has(item.ref.contentSha256)).toBe(true);
      expect(sha256HexUtf8(searchPayloadJson)).not.toBe(item.ref.contentSha256);
      // The quote is a literal slice of the fetched canonical text.
      const text = run.pack.texts[item.ref.documentVersionId] as string;
      expect(
        Array.from(text)
          .slice(item.ref.locator.startChar, item.ref.locator.endChar)
          .join(""),
      ).toBe(item.ref.quote);
    }
  });
});

describe("court/date filters at the evidence boundary (contract D)", () => {
  it("keeps matching-court rulings citable; without filters behavior is unchanged", async () => {
    const baseline = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(baseline.result.evidence.length).toBeGreaterThan(0);
    expect(baseline.result.warnings.some((w) => w.startsWith("EVIDENCE_FILTERED"))).toBe(false);

    // Fixture decisions are Yargıtay, dated 2023-05-11: an enclosing filter
    // changes nothing about what is citable.
    const matching = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      filters: { courtTypes: ["Yargıtay"], dateFrom: "2023-01-01", dateTo: "2023-12-31" },
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(matching.result.evidence.length).toBe(baseline.result.evidence.length);
    expect(matching.result.warnings.some((w) => w.startsWith("EVIDENCE_FILTERED"))).toBe(false);
  });

  it("excludes out-of-scope rulings from evidence and counts the exclusion", async () => {
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      filters: { courtTypes: ["Danıştay"] },
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    // Every fetched decision is a Yargıtay ruling: none may be cited.
    expect(run.result.evidence).toEqual([]);
    expect(run.result.warnings.some((w) => /^EVIDENCE_FILTERED:\d+$/.test(w))).toBe(true);
  });
});

describe("mandatory contrary lane + reserved contrary fetch", () => {
  it("executes contrary searches and fetches contrary authority in full", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });

    expect(run.result.contraryCoverage.executed).toBe(true);
    expect(run.result.contraryCoverage.usable).toBe(true);
    expect(run.result.contraryCoverage.lanes.length).toBeGreaterThan(0);

    const fetchedIds = gateway.calls
      .filter((c) => c.toolName === "fetch")
      .map((c) => String(c.args["id"]));
    // 7101 is the top hit of the first contrary lane.
    expect(fetchedIds).toContain("7101");

    // Contrary evidence is classified contrary and stays out of the claims.
    const contraryItems = run.pack.items.filter((i) => i.stance === "contrary");
    expect(contraryItems.length).toBeGreaterThan(0);
    const citedIds = new Set(run.result.claims.flatMap((c) => c.evidenceIds));
    for (const item of contraryItems) {
      expect(citedIds.has(item.ref.evidenceId)).toBe(false);
    }
  });

  it("reserves a fetch slot for the contrary lane when maxFetches is tight", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    await runResearch({
      question: QUESTION,
      budgets: { maxToolCalls: 24, maxFetches: 2 },
      gateway,
      ...fixedClocks(),
    });
    const fetchedIds = gateway.calls
      .filter((c) => c.toolName === "fetch")
      .map((c) => String(c.args["id"]));
    expect(fetchedIds).toHaveLength(2);
    expect(fetchedIds).toContain("7101"); // the contrary candidate got its slot
    expect(fetchedIds).toContain("7001"); // alongside the best primary
  });

  it("with a single fetch slot the contrary candidate wins it", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    await runResearch({
      question: QUESTION,
      budgets: { maxToolCalls: 24, maxFetches: 1 },
      gateway,
      ...fixedClocks(),
    });
    const fetchedIds = gateway.calls
      .filter((c) => c.toolName === "fetch")
      .map((c) => String(c.args["id"]));
    expect(fetchedIds).toEqual(["7101"]);
  });
});

describe("budgets are hard", () => {
  it("tool-call cap yields a typed PARTIAL and stops gateway calls at the cap", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    const run = await runResearch({
      question: QUESTION,
      budgets: { maxToolCalls: 6, maxFetches: 6 },
      gateway,
      ...fixedClocks(),
    });
    expect(run.result.status).toBe("PARTIAL");
    expect(gateway.calls.length).toBeLessThanOrEqual(6);
    expect(run.result.research.budgetSpent.toolCalls).toBeLessThanOrEqual(6);
    expect(
      run.result.reasons.some((r) =>
        /BUDGET_EXHAUSTED|RESEARCH_COVERAGE_INCOMPLETE/u.test(r),
      ),
    ).toBe(true);
    // The spy: nothing was called after the executor terminated.
    const callsAtEnd = gateway.calls.length;
    expect(run.result.research.toolCalls.length).toBe(callsAtEnd);
  });

  it("wall-time exhaustion terminates as typed PARTIAL via the executor accounting", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    let tick = 0;
    const run = await runResearch({
      question: QUESTION,
      budgets: { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 60_000 },
      gateway,
      now: () => "2026-08-27T10:00:00.000Z",
      monotonic: () => {
        tick += 25_000;
        return tick;
      },
      newRunId: () => "run-walltime",
      today: () => "2026-08-27",
    });
    expect(run.result.status).toBe("PARTIAL");
    expect(run.result.reasons).toContain("BUDGET_EXHAUSTED:maxWallTimeMs");
    // Hard stop: only the calls made before exhaustion exist.
    expect(gateway.calls.length).toBeLessThan(5);
  });
});

describe("upstream degradation", () => {
  it("mid-run gateway failures produce PARTIAL with upstream.healthy=false", async () => {
    const scripts = happyScripts();
    const gateway = new ScriptedGateway({
      ...scripts,
      // Contrary searches and all fetches fail at the transport level.
      search_bedesten_unified: (args) => {
        const phrase = String(args["phrase"] ?? "");
        if (/bozma|karşı oy|beraat/u.test(phrase)) return { error: "UNAVAILABLE" };
        return scripts["search_bedesten_unified"]!(args);
      },
      fetch: () => ({ error: "TIMEOUT" }),
    });
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });
    expect(run.result.status).toBe("PARTIAL");
    expect(run.result.research.upstream.healthy).toBe(false);
    expect(
      run.result.research.upstream.notes.some((n) => n.startsWith("UPSTREAM_DEGRADED")),
    ).toBe(true);
    expect(run.unreachable).toBe(false); // some calls DID succeed
    // Provider failure is never a silent no-result: the failed lanes are typed.
    const failed = run.result.research.toolCalls.filter((t) => !t.ok);
    expect(failed.length).toBeGreaterThan(0);
  });

  it("a degraded provider payload (error_code body) becomes a typed failure, not empty hits", async () => {
    const scripts = happyScripts();
    const gateway = new ScriptedGateway({
      ...scripts,
      search_bedesten_unified: () => ({ ok: bedestenFailurePayload() }),
    });
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });
    // Every bedesten lane failed typed; the run degrades honestly.
    expect(run.result.status).toBe("PARTIAL");
    const bedestenCalls = run.result.research.toolCalls.filter(
      (t) => t.tool === "search_bedesten_unified",
    );
    expect(bedestenCalls.length).toBeGreaterThan(0);
    expect(bedestenCalls.every((t) => !t.ok)).toBe(true);
  });
});

describe("injection in fetched documents", () => {
  it("flags the payload and changes NOTHING about the tool-call flow", async () => {
    const cleanGateway = new ScriptedGateway(happyScripts());
    const injectedGateway = new ScriptedGateway(
      happyScripts({
        textFor: (id) =>
          id === "7001"
            ? injectedDecisionText(id)
            : id.startsWith("71")
              ? contraryDecisionText(id)
              : primaryDecisionText(id),
      }),
    );

    const clean = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: cleanGateway,
      ...fixedClocks(),
    });
    const injected = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: injectedGateway,
      ...fixedClocks(),
    });

    // Telemetry fired…
    expect(
      injected.result.research.upstream.notes.some((n) =>
        n.startsWith("INJECTION_FLAGGED:BEDESTEN:7001"),
      ),
    ).toBe(true);
    const doc7001 = injected.result.research.fetchedDocuments.find(
      (d) => d.externalId === "7001",
    );
    expect(doc7001?.injectionFlagged).toBe(true);
    expect(
      clean.result.research.fetchedDocuments.find((d) => d.externalId === "7001")
        ?.injectionFlagged,
    ).toBeUndefined();

    // …and the CONTROL FLOW is identical: same tools, same arguments, in order.
    expect(callShapes(injectedGateway)).toEqual(callShapes(cleanGateway));

    // The injected line is data: if quoted at all, it is escaped in markdown.
    expect(injected.result.markdown).not.toMatch(/^SYSTEM:/mu);
  });
});

describe("determinism", () => {
  it("same scripted gateway + fixed clocks => byte-identical result", async () => {
    const runA = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    const runB = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(runA.result.markdown).toBe(runB.result.markdown);
    expect(JSON.stringify(runA.result)).toBe(JSON.stringify(runB.result));
  });
});

describe("fileIds contract", () => {
  it("accepts fileIds but records that the uploaded-claims template is v1 interface-only", async () => {
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      fileIds: ["file-1"],
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(run.result.warnings.some((w) => w.startsWith("FILE_IDS_IGNORED"))).toBe(true);
  });
});

describe("payload realism guard", () => {
  it("the within-law read is opaque text and never spawns fetch candidates", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });
    const withinCalls = gateway.calls.filter((c) => c.toolName === "search_within_kanun");
    expect(withinCalls.length).toBe(1);
    // Sanity: the fixture really is the formatted-report string shape.
    expect(withinKanunText("madde 157")).toContain("MADDE 157");
    expect(mevzuatNoResultsText("x")).toMatch(/^No results found/u);
    // No get_mevzuat_content fetches happened (mevzuat search had no hits).
    expect(gateway.calls.some((c) => c.toolName === "get_mevzuat_content")).toBe(false);
  });
});

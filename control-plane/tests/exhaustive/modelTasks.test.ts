/**
 * W20 acceptance J and L: model provenance and task honesty.
 *
 *   L  TASK HONESTY     every public task has distinct, tested semantics; a
 *                       model-required task REFUSES without a model instead
 *                       of returning its deterministic subset.
 *   J  MODEL PROVENANCE a model-emitted quote that does not occur exactly in
 *                       the source is rejected and counted; every stored
 *                       model observation slices the canonical text back to
 *                       its quote.
 *
 * The model here is `ScriptedModel`, a TEST DOUBLE. It proves the product
 * consumes model output correctly — schema checks, quote location, task
 * routing, synthesis citation checks — never that a real model can do the
 * work. No real model was called by this suite.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { AnalysisWorker } from "../../src/exhaustive/worker.js";
import { locateQuote, MODEL_EXTRACTOR_VERSION, validateExtraction } from "../../src/exhaustive/modelExtractor.js";
import { TASK_SPECS } from "../../src/exhaustive/tasks.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { get, insertUpload, isWeighRequest, linkFiles, paragraphs, post, ScriptedModel } from "./durableFixtures.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_modeltasks_test");

const FAKE_QUOTE = "Bu cümle belgede hiç geçmiyor ama model onu alıntı diye yazdı.";

const PETITION = [
  "Davacı Ahmet Yılmaz, kiracının Mart 2024 kira bedelini ödemediğini iddia etmektedir.",
  "Davacı ayrıca kiracının depozitoyu hiç yatırmadığını iddia etmektedir.",
  "Banka dekontu kira bedelinin 05.03.2024 tarihinde ödendiğini göstermektedir.",
  "Davalı, ödemenin banka havalesiyle yapıldığını savunmaktadır.",
  "Anlaşmazlık kira bedelinin ödenip ödenmediğine ilişkindir.",
  "Tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir.",
];
const REPORT = [
  "Bilirkişiye göre ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.",
  "Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.",
];
// Its own upload, surrounded by filler exactly like the report's figure: the
// topic key is a HEURISTIC over the words around a value (contradictions.ts
// says so), and two figures whose neighbours differ are not compared.
const RECEIPT = ["Tahsilat makbuzuna göre ödenen kira bedeli 45.000 TL olarak tespit edilmiştir."];

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;

function routerWith(model: ScriptedModel | undefined) {
  return createExhaustiveRouter({
    store,
    matters,
    models: () => (model === undefined ? {} : { extraction: model, synthesis: model }),
  });
}

async function runTask(
  model: ScriptedModel | undefined,
  task: string,
  extra: Record<string, unknown> = {},
  workerOptions: Partial<ConstructorParameters<typeof AnalysisWorker>[0]> = {},
): Promise<{ findings: any; runId: string; matterId: string }> {
  const app = routerWith(model);
  const matter = await matters.create({ title: `Görev ${task}` });
  await linkFiles(matters, matter.id, ["mt-petition", "mt-report", "mt-receipt"]);
  const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task, ...extra });
  expect(started.status).toBe(202);
  await new AnalysisWorker({
    store,
    retryBackoffMs: 0,
    stageBackoffMs: 0,
    models: () => (model === undefined ? {} : { extraction: model, synthesis: model }),
    ...workerOptions,
  }).drain();
  const findings = await get(app, `/v1/matters/${matter.id}/analysis/${started.body.runId}/findings`);
  expect(findings.status).toBe(200);
  return { findings: findings.body, runId: started.body.runId, matterId: matter.id };
}

function kinds(findings: any): Set<string> {
  return new Set(findings.items.map((item: { kind: string }) => item.kind));
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, { fileId: "mt-petition", title: "Dava dilekçesi", blocks: paragraphs(PETITION, 10) });
  await insertUpload(sql, { fileId: "mt-report", title: "Bilirkişi raporu", blocks: paragraphs(REPORT, 6) });
  await insertUpload(sql, { fileId: "mt-receipt", title: "Tahsilat makbuzu", blocks: paragraphs(RECEIPT, 6) });
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("L: task honesty without a model", () => {
  it("capabilities say which tasks need a model, and why", async () => {
    const app = routerWith(undefined);
    const matter = await matters.create({ title: "Yetenekler" });
    const response = await get(app, `/v1/matters/${matter.id}/analysis/capabilities`);
    expect(response.status).toBe(200);
    const byTask = new Map(response.body.tasks.map((t: { task: string }) => [t.task, t]));
    expect((byTask.get("contradictions") as any).available).toBe(true);
    expect((byTask.get("chronology") as any).available).toBe(true);
    for (const task of ["claim_evidence", "full_review", "red_team"]) {
      expect((byTask.get(task) as any).available).toBe(false);
      expect((byTask.get(task) as any).messageTr).toContain("yerel dil modeli");
    }
    expect(response.body.model.configured).toBe(false);
  });

  it("a model-required task REFUSES instead of returning its deterministic part", async () => {
    const app = routerWith(undefined);
    const matter = await matters.create({ title: "Modelsiz tam inceleme" });
    await linkFiles(matters, matter.id, ["mt-petition"]);
    for (const task of ["full_review", "claim_evidence", "red_team"]) {
      const response = await post(app, `/v1/matters/${matter.id}/analysis`, { task });
      expect(response.status).toBe(409);
      expect(response.body.error.kind).toBe("MODEL_REQUIRED");
    }
    // The default task is full_review, so an empty body refuses too.
    const empty = await post(app, `/v1/matters/${matter.id}/analysis`, {});
    expect(empty.body.error.kind).toBe("MODEL_REQUIRED");
    const runs = await sql`
      select count(*)::int as n from app_private.matter_analysis_runs
      where matter_id = ${matter.id}::uuid`;
    expect(Number(runs[0]!["n"])).toBe(0);
  });

  it("contradictions and chronology run deterministically and produce DIFFERENT results", async () => {
    const contradictions = await runTask(undefined, "contradictions");
    const chronology = await runTask(undefined, "chronology");

    const c = kinds(contradictions.findings);
    const t = kinds(chronology.findings);
    expect(c.has("contradiction")).toBe(true);
    expect(c.has("event")).toBe(false);
    for (const kind of c) expect(TASK_SPECS.contradictions.produces).toContain(kind);

    expect(t.has("event")).toBe(true);
    for (const kind of t) expect(TASK_SPECS.chronology.produces).toContain(kind);
    const events = chronology.findings.items.filter((item: { kind: string }) => item.kind === "event");
    expect(events.every((event: { occurredOn: string | null }) => event.occurredOn !== null)).toBe(true);
    expect(events.every((event: { datePrecision: string | null }) => event.datePrecision === "exact")).toBe(true);
    // Chronology conflicts are DATE conflicts only.
    for (const item of chronology.findings.items.filter((i: { kind: string }) => i.kind === "contradiction")) {
      expect(item.attributes.valueKind).toBe("date");
    }
  });
});

describe("L: model-required tasks with a scripted model", () => {
  it("claim_evidence weighs claims against evidence and names missing support", async () => {
    const model = new ScriptedModel("scripted-a", { unsupportedClaimMarker: "depozitoyu" });
    const { findings } = await runTask(model, "claim_evidence");
    const k = kinds(findings);
    for (const kind of ["claim", "evidence", "missing_support"]) expect(k.has(kind)).toBe(true);
    for (const kind of k) expect(TASK_SPECS.claim_evidence.produces).toContain(kind);

    const supported = findings.items.find(
      (item: { kind: string; title: string }) => item.kind === "claim" && item.title.includes("ödemediğini"),
    );
    expect(supported.supportStatus).toBe("supported");
    // The support is traceable to the evidence's exact span.
    expect(supported.sources.some((s: { role: string }) => s.role === "support")).toBe(true);
    const unsupported = findings.items.find(
      (item: { kind: string; title: string }) => item.kind === "claim" && item.title.includes("depozitoyu"),
    );
    expect(unsupported.supportStatus).toBe("unsupported");
    expect(findings.links.some((link: { linkKind: string }) => link.linkKind === "supports")).toBe(true);
  });

  it("full_review adds parties and chronology, and splits favorable/unfavorable only with a client role", async () => {
    const withoutRole = await runTask(new ScriptedModel("scripted-b"), "full_review");
    const k = kinds(withoutRole.findings);
    for (const kind of ["entity", "event", "claim", "evidence", "contradiction"]) expect(k.has(kind)).toBe(true);
    expect(k.has("favorable_point")).toBe(false);
    expect(withoutRole.findings.summary.synthesis.notes.join(" ")).toContain("sıfatı belirtilmediği");

    const withRole = await runTask(new ScriptedModel("scripted-c"), "full_review", { clientRole: "davalı" });
    const r = kinds(withRole.findings);
    expect(r.has("favorable_point")).toBe(true);
    expect(r.has("unfavorable_point")).toBe(true);
    // The point citing an entry it was never shown was rejected, not stored.
    expect(withRole.findings.summary.synthesis.rejected).toBeGreaterThan(0);
    expect(withRole.findings.items.some((item: { title: string }) => item.title === "Dayanaksız nokta")).toBe(false);
  });

  it("red_team labels hypothetical arguments and states that contrary authority was not searched", async () => {
    const model = new ScriptedModel("scripted-d", { unsupportedClaimMarker: "depozitoyu" });
    const { findings } = await runTask(model, "red_team", { clientRole: "davacı" });
    const k = kinds(findings);
    for (const kind of ["opposing_theory", "weakness", "hypothetical_argument", "unsupported_proposition"]) {
      expect(k.has(kind)).toBe(true);
    }
    for (const kind of k) expect(TASK_SPECS.red_team.produces).toContain(kind);
    for (const item of findings.items) {
      expect(item.hypothetical).toBe(item.kind === "hypothetical_argument");
      expect(item.sources.length).toBeGreaterThan(0);
    }
    expect(findings.summary.synthesis.contraryAuthority.performed).toBe(false);
  });

  it("every task's result kinds differ from every other task's", async () => {
    const produced = new Map<string, string>();
    for (const task of Object.keys(TASK_SPECS)) {
      produced.set(task, [...TASK_SPECS[task as keyof typeof TASK_SPECS].produces].sort().join(","));
    }
    expect(new Set(produced.values()).size).toBe(produced.size);
  });
});

describe("J: model provenance", () => {
  it("a quote the source does not contain is rejected, counted and never stored", async () => {
    const model = new ScriptedModel("scripted-e", { fakeQuote: FAKE_QUOTE });
    const { runId } = await runTask(model, "claim_evidence");

    const rejected = await sql`
      select coalesce(sum(rejected_quotes), 0)::int as n from app_private.matter_analysis_units
      where run_id = ${runId}::uuid`;
    expect(Number(rejected[0]!["n"])).toBeGreaterThan(0);
    const stored = await sql`
      select count(*)::int as n from app_private.matter_observations
      where run_id = ${runId}::uuid and quote = ${FAKE_QUOTE}`;
    expect(Number(stored[0]!["n"])).toBe(0);

    // Every stored MODEL observation slices the canonical text to its quote,
    // with offsets the application derived, and carries its model identity.
    const rows = await sql`
      select o.quote, o.model_id, o.model_schema_version, o.origin,
             substring(v.canonical_text from o.start_char + 1
                       for o.end_char - o.start_char) as slice
      from app_private.matter_observations o
      join legal.document_versions v on v.id = o.document_version_id
      where o.run_id = ${runId}::uuid and o.origin = 'model'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(String(row["slice"])).toBe(String(row["quote"]));
      expect(row["model_id"]).toBe("scripted-e");
      // mx-v3 since the repair-binding rule changed (W21 review #10); read from the code, not a literal.
      expect(row["model_schema_version"]).toBe(MODEL_EXTRACTOR_VERSION);
    }
  });

  it("locateQuote is exact: no whitespace folding, no fuzzy match", () => {
    const text = "Davacı kira bedelini ödemediğini iddia etmektedir.";
    expect(locateQuote(text, "kira bedelini ödemediğini")).toEqual(
      expect.objectContaining({ startChar: 7, occurrences: 1 }),
    );
    expect(locateQuote(text, "kira  bedelini ödemediğini")).toBeUndefined();
    expect(locateQuote(text, "Kira bedelini ödemediğini")).toBeUndefined();
    expect(locateQuote(text, "kira")).toBeUndefined(); // too short to locate anything
    // NFD input is the same character and is found.
    expect(locateQuote(text, "ödemediğini iddia".normalize("NFD"))).toBeDefined();
  });

  it("an ambiguous quote (found twice in the unit) is rejected, never pinned to the first place", () => {
    const text =
      "Davacıya göre kira bedeli ödenmiştir. Davalıya göre ise kira bedeli ödenmiştir sözü doğru değildir.";
    const result = validateExtraction(
      {
        items: [
          { kind: "claim", text: "Kira bedeli ödendi.", quote: "kira bedeli ödenmiştir" },
          {
            kind: "defense",
            text: "Davalı ödeme iddiasına itiraz ediyor.",
            quote: "Davalıya göre ise kira bedeli ödenmiştir sözü doğru değildir",
          },
        ],
      },
      text,
      ["claim", "defense"],
    );
    // The first quote has one text but two locations: rejected like a missing one.
    expect(result.rejectedQuotes).toBe(1);
    expect(result.items.map((item) => item.kind)).toEqual(["defense"]);
    expect(result.items[0]!.occurrences).toBe(1);
  });

  it("items failing the strict schema are counted, not coerced", () => {
    const text = "Davacı kira bedelini ödemediğini iddia etmektedir.";
    const result = validateExtraction(
      {
        items: [
          { kind: "claim", text: "İddia", quote: "kira bedelini ödemediğini" },
          { kind: "claim", text: "İddia", quote: "kira bedelini ödemediğini", extra: 1 },
          { kind: "unknown_kind", text: "x", quote: "kira bedelini ödemediğini" },
          { kind: "claim", text: "İddia", quote: "belgede olmayan bir cümle burada" },
        ],
      },
      text,
      ["claim"],
    );
    expect(result.items.length).toBe(1);
    expect(result.invalidItems).toBe(2);
    expect(result.rejectedQuotes).toBe(1);
  });
});

describe("a model outage never fakes completeness", () => {
  // W21 round two (R2-19): a transport failure is waited out for the outage
  // window without spending attempts (w21WorkerRecovery.test.ts). A window of
  // 0 is an outage that has already lasted too long: the model stays
  // unreachable, every attempt is spent, and the run must say so.
  const OUTAGE_SPENT = { modelOutageWindowMs: 0 };

  it("extraction failing every attempt leaves the run incomplete, with the units named", async () => {
    const model = new ScriptedModel("scripted-f", {
      failWhen: (request) => request.instruction.includes("şu türdeki öğeleri çıkar"),
      failCode: "UNREACHABLE",
    });
    const { findings } = await runTask(model, "claim_evidence", {}, OUTAGE_SPENT);
    expect(findings.processingCoverage.complete).toBe(false);
    expect(findings.processingCoverage.analysisUnitsFailed).toBe(findings.processingCoverage.analysisUnitsTotal);
    expect(findings.exhaustiveClaimRefusedBecause).not.toBeNull();
  });

  it("weighing failing its whole retry budget keeps the findings but refuses analytical completeness", async () => {
    // W21: processing coverage answers ONLY "was the source read?" — every
    // unit was read here, so it is complete. That the claim/evidence
    // comparison failed is an INTELLIGENCE gap (W20 put a SYNTHESIS_FAILED
    // gap into processing coverage; the three layers are now separate).
    const model = new ScriptedModel("scripted-g", {
      failWhen: (request) => isWeighRequest(request),
      failCode: "UNREACHABLE",
    });
    const { findings } = await runTask(model, "claim_evidence", {}, OUTAGE_SPENT);
    expect(findings.processingCoverage.complete).toBe(true);
    expect(findings.intelligenceCoverage.complete).toBe(false);
    expect(findings.intelligenceCoverage.failedStages).toContain("claim_weighing");
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(0);
    expect(findings.analysisCompleteness.complete).toBe(false);
    expect(findings.analysisCompleteness.refusedBecause).toContain("analiz aşamaları tamamlanmadı");
    // W21 hostile review: every page read, weighing failed — the exhaustive
    // claim is still refused (the field no longer follows the source alone).
    expect(findings.exhaustiveClaimRefusedBecause).not.toBeNull();
    expect(kinds(findings).has("claim")).toBe(true);
    // No claim may be called unsupported on the strength of a failed search.
    for (const item of findings.items.filter((entry: { kind: string }) => entry.kind === "claim")) {
      expect(item.supportStatus).toBe("search_incomplete");
    }
  });
});

describe("W21: the AI policy decides whether the model tasks may run", () => {
  it("DETERMINISTIC_ONLY refuses the model tasks even with a model configured, and says why", async () => {
    const model = new ScriptedModel("scripted-test-model", {});
    const app = createExhaustiveRouter({
      store,
      matters,
      models: () => ({ extraction: model, synthesis: model }),
      aiPolicy: () => "DETERMINISTIC_ONLY",
    });
    const matter = await matters.create({ title: "İlke: yapay zekâ kapalı" });
    await linkFiles(matters, matter.id, ["mt-petition"]);
    const caps = await get(app, `/v1/matters/${matter.id}/analysis/capabilities`);
    expect(caps.body.model).toEqual(
      expect.objectContaining({ configured: true, usable: false, code: "AI_POLICY_DETERMINISTIC" }),
    );
    const full = caps.body.tasks.find((t: { task: string }) => t.task === "full_review");
    expect(full.available).toBe(false);
    expect(full.messageTr).toContain("Yapay zekâ kullanımı kapalı");
    const refused = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "full_review" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.kind).toBe("MODEL_REQUIRED");
    // The deterministic tasks are unaffected by the model decision.
    const contradictions = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "contradictions" });
    expect(contradictions.status).toBe(202);
    const runs = await sql`
      select count(*)::int as n from app_private.matter_analysis_runs
      where matter_id = ${matter.id}::uuid`;
    expect(Number(runs[0]!["n"])).toBe(1);
  });

  it("an outside endpoint is named MODEL_OFF_MACHINE, not 'no model'", async () => {
    const app = createExhaustiveRouter({
      store,
      matters,
      models: () => ({}),
      aiPolicy: () => "LOCAL_PREFERRED",
      localTrust: () => "CLOUD",
    });
    const matter = await matters.create({ title: "Dışarıdaki model" });
    const caps = await get(app, `/v1/matters/${matter.id}/analysis/capabilities`);
    expect(caps.body.model).toEqual(expect.objectContaining({ configured: false, usable: false, code: "MODEL_OFF_MACHINE" }));
    const full = caps.body.tasks.find((t: { task: string }) => t.task === "full_review");
    expect(full.messageTr).toContain("kendi ağınızda değil");
  });

  it("LOCAL_PREFERRED with an on-machine model: usable, code OK", async () => {
    const model = new ScriptedModel("scripted-test-model", {});
    const app = createExhaustiveRouter({
      store,
      matters,
      models: () => ({ extraction: model, synthesis: model }),
      aiPolicy: () => "LOCAL_PREFERRED",
    });
    const matter = await matters.create({ title: "Yerel model" });
    const caps = await get(app, `/v1/matters/${matter.id}/analysis/capabilities`);
    expect(caps.body.model).toEqual(expect.objectContaining({ configured: true, usable: true, code: "OK" }));
  });
});

// W21 (from lane C): an address that IS set but that the trust rules refuse —
// an unlisted LAN host such as http://192.168.1.20:11434 without
// COLLEX_TRUSTED_LOCAL_HOSTS — was reported as "no model is configured",
// because the route never passed the refusal on and suppressed every
// MODEL_UNAVAILABLE reason.
describe("W21: a configured but refused model address is named, not reported missing", () => {
  const LAN_REFUSAL = "Bu adres kendi ağınızda görünüyor ama güvenilir olarak tanımlanmamış.";
  const ENV_KEYS = ["COLLEX_LOCAL_LLM_BASE_URL", "COLLEX_LOCAL_LLM_MODEL", "COLLEX_TRUSTED_LOCAL_HOSTS"] as const;

  async function withEnv<T>(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, body: () => Promise<T>): Promise<T> {
    const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    try {
      return await body();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  async function refusalSurface(app: ReturnType<typeof createExhaustiveRouter>, title: string) {
    const matter = await matters.create({ title });
    await linkFiles(matters, matter.id, ["mt-petition"]);
    const caps = await get(app, `/v1/matters/${matter.id}/analysis/capabilities`);
    const full = caps.body.tasks.find((t: { task: string }) => t.task === "full_review");
    const refused = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "full_review" });
    return { model: caps.body.model, full, refused };
  }

  it("the route's refusal reaches capabilities and the 409 message", async () => {
    const app = createExhaustiveRouter({
      store,
      matters,
      models: () => ({}),
      aiPolicy: () => "LOCAL_PREFERRED",
      localTrust: () => null,
      localRefusedReason: () => LAN_REFUSAL,
    });
    const { model, full, refused } = await refusalSurface(app, "Reddedilen yerel ağ adresi");
    expect(model).toEqual(expect.objectContaining({ configured: false, usable: false, code: "MODEL_UNAVAILABLE" }));
    expect(model.reasonTr).toContain(LAN_REFUSAL);
    expect(model.reasonTr).not.toContain("ayarlı bir yerel model yok");
    expect(full.available).toBe(false);
    expect(full.messageTr).toContain(LAN_REFUSAL);
    expect(full.messageTr).not.toContain("şu an yapılandırılmış");
    expect(refused.status).toBe(409);
    expect(refused.body.error.kind).toBe("MODEL_REQUIRED");
    expect(refused.body.error.message).toContain(LAN_REFUSAL);
  });

  it("without an injected reason, an unlisted LAN address in the environment is named the same way", async () => {
    await withEnv(
      { COLLEX_LOCAL_LLM_BASE_URL: "http://192.168.1.20:11434", COLLEX_LOCAL_LLM_MODEL: "qwen2.5:7b" },
      async () => {
        const app = createExhaustiveRouter({
          store,
          matters,
          models: () => ({}),
          aiPolicy: () => "LOCAL_PREFERRED",
          localTrust: () => null,
        });
        const { model, full, refused } = await refusalSurface(app, "Ortamda reddedilen adres");
        expect(model.code).toBe("MODEL_UNAVAILABLE");
        expect(model.reasonTr).toContain("güvenilir olarak tanımlanmamış");
        expect(full.messageTr).toContain("güvenilir olarak tanımlanmamış");
        expect(refused.status).toBe(409);
        expect(refused.body.error.message).toContain("güvenilir olarak tanımlanmamış");
      },
    );
  });

  it("positive control: with no address at all, the plain 'not configured' sentence stays", async () => {
    await withEnv({}, async () => {
      const app = createExhaustiveRouter({ store, matters, models: () => ({}), aiPolicy: () => "LOCAL_PREFERRED" });
      const { model, full, refused } = await refusalSurface(app, "Adres yok");
      expect(model.code).toBe("MODEL_UNAVAILABLE");
      expect(model.reasonTr).toContain("ayarlı bir yerel model yok");
      expect(full.messageTr).toContain("şu an yapılandırılmış");
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).not.toContain("güvenilir olarak tanımlanmamış");
    });
  });
});

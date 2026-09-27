/**
 * HTTP surface for exhaustive Matter analysis (W20: asynchronous + durable).
 *
 *   GET  /v1/matters/{matterId}/analysis/capabilities   which tasks can run
 *   POST /v1/matters/{matterId}/analysis                start (or resume) a run
 *   GET  /v1/matters/{matterId}/analysis                list this matter's runs
 *   GET  /v1/matters/{matterId}/analysis/{runId}        status + progress + coverage
 *   GET  /v1/matters/{matterId}/analysis/{runId}/findings   Matter Intelligence
 *   POST /v1/matters/{matterId}/analysis/{runId}/cancel request cancellation
 *   GET  /v1/matters/{matterId}/intelligence            latest result per task,
 *                                                       with stale-source flags
 *
 * W19 executed the whole run inside the POST. A model-assisted review of a
 * large matter takes minutes to hours, and an HTTP request is exactly the
 * wrong place to hold that: a closed tab, a proxy timeout or a restart lost
 * it. POST now only freezes the run's identity and census (one transaction)
 * and returns 202 with a run id; the durable worker (worker.ts) does the
 * work; the client polls. A request for exactly the same work — same task,
 * same files, same pinned versions, same model — joins the active run
 * instead of starting a second census.
 *
 * Every run response carries `processingCoverage` — LIVE while the run is in
 * progress (derived from the ledger), stored once it finishes — so a caller
 * never infers how much was read from the absence of a field.
 *
 * W21: reading everything is not analysing everything. Each run response
 * also carries `extractionCoverage` (what structured extraction achieved),
 * `intelligenceCoverage` (which claims, comparisons, contradiction batches
 * and synthesis groups reached a terminal state) and `analysisCompleteness`,
 * the one combined statement. `processingCoverage.complete === true` with
 * `analysisCompleteness.complete === false` is a normal, reported state.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues, zodMessageTr } from "../api/zodIssues.js";
import { trustLabelTr, type EndpointTrust } from "../llm/endpointTrust.js";
import { matterFileIds, resolveMatterScope } from "../matters/scope.js";
import type { MatterStore } from "../matters/types.js";
import {
  deriveAnalysisCompleteness,
  deriveExtractionCoverage,
  deriveIntelligenceCoverage,
  type AnalysisCompleteness,
  type ExtractionCoverage,
  type IntelligenceCoverage,
} from "./analysisCoverage.js";
import type { DurableAnalysisStore, DurableRunRow } from "./durableStore.js";
import { canonicalRunIdentity, runIdentityKey, type RunIdentity } from "./identity.js";
import { INTEL_VERSION } from "./intelligence.js";
import {
  decideModelTasks,
  resolveEffectiveAiPolicy,
  type AiPolicy,
  type ModelTaskDecision,
} from "../llm/aiPolicy.js";
import { resolveLocalGenerationConfig } from "../llm/localGenerationConfig.js";
import { MODEL_EXTRACTOR_VERSION } from "./modelExtractor.js";
import { coverageSentenceTr, refuseExhaustiveClaim, type ProcessingCoverage } from "./processingCoverage.js";
import { EXTRACTOR_VERSION, planUnits, runReduce, UNIT_BUILDER_VERSION } from "./runner.js";
import { STAGE_SCHEMA_VERSION } from "./stageTypes.js";
import { ANALYSIS_TASKS, TASK_SPECS, taskAvailability, type AnalysisTask } from "./tasks.js";
import type { WorkerModelRoutes } from "./worker.js";


/** A run that is no longer queued or working (done, failed, cancelled). */
function runEndedOf(status: string): boolean {
  return !["queued", "mapping", "aggregating", "reducing"].includes(status);
}
export const analysisRequestSchema = z
  .object({
    task: z.enum(ANALYSIS_TASKS).default("full_review"),
    /**
     * Restrict to specific uploads of the matter. Omitted means the WHOLE
     * matter, which is the point of the feature; when given, the ids are
     * verified as members (scope never widens).
     */
    fileIds: z.array(z.string().min(1).max(200)).max(200).optional(),
    /**
     * The client's procedural role ("davacı", "davalı", ...). Only used to
     * split favorable/unfavorable points and to aim the red team; without
     * it the product says it did not make that split.
     */
    clientRole: z.string().trim().min(2).max(100).optional(),
  })
  .strict();

export interface ExhaustiveRouterDeps {
  readonly store: DurableAnalysisStore;
  readonly matters: MatterStore;
  /** Wakes the durable worker after a run is created or cancelled. */
  readonly worker?: { kick(): void } | undefined;
  /** The configured model routes; resolved per request, never cached. */
  readonly models?: (() => WorkerModelRoutes) | undefined;
  /** W21: the application AI policy; absent -> read from the environment per call. */
  readonly aiPolicy?: (() => AiPolicy) | undefined;
  /** W21: where the configured local endpoint runs, even when the route table refused it. */
  readonly localTrust?: (() => EndpointTrust | null) | undefined;
  /**
   * W21: why the configured local model address was REFUSED by the trust
   * rules (an unlisted LAN host such as http://192.168.1.20:11434 without
   * COLLEX_TRUSTED_LOCAL_HOSTS, a bad scheme), or null. Absent -> read from
   * the environment per call. A set-but-refused address is never reported
   * as "no model is configured".
   */
  readonly localRefusedReason?: (() => string | null) | undefined;
}

/** A model-task decision and the reason a task refusal should name, if any. */
interface ModelGate {
  readonly decision: ModelTaskDecision;
  /** Undefined only when the plain "no model is configured" sentence applies. */
  readonly blockedReasonTr: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PROVIDER_FAMILY = "openai-compatible";

function notFound(c: Context): Response {
  return c.json({ error: { kind: "MATTER_NOT_FOUND", message: "Bu dava dosyası bulunamadı." } }, 404);
}

function runNotFound(c: Context): Response {
  return c.json({ error: { kind: "RUN_NOT_FOUND", message: "Bu inceleme bulunamadı." } }, 404);
}

/** Why a finished run no longer speaks for the matter as it is now. */
export const RUN_NOT_CURRENT_TR =
  "Bu inceleme bittikten sonra dosyaya belge eklendi, bir belge değişti ya da dosyadan çıkarıldı;" +
  " sonuç dosyanın bugünkü hâlinin tamamını kapsamıyor. Güncel sonuç için incelemeyi yeniden başlatın.";
export const MATTER_MEMBERS_UNKNOWN_TR =
  "Dosyanın güncel belge listesi okunamadı; incelemeden sonra belge eklenip eklenmediği bilinmiyor.";

/** How the matter's documents changed since a run froze its scope. */
export interface ScopeDrift {
  /** Pinned files whose current version differs (or that were deleted). */
  readonly changed: string[];
  /** Documents of the matter the run never read (whole-matter runs). */
  readonly added: string[];
  /** Pinned files that are no longer documents of the matter. */
  readonly removed: string[];
  readonly membersUnknown: boolean;
}

export function isDrifted(drift: ScopeDrift): boolean {
  return drift.changed.length > 0 || drift.added.length > 0 || drift.removed.length > 0;
}

function modelReady(routes: WorkerModelRoutes): boolean {
  return routes.extraction !== undefined && routes.synthesis !== undefined;
}

/**
 * The combined statement of a FINISHED run, from its stored layers, through
 * the one contract (deriveAnalysisCompleteness) — never re-assembled from the
 * three flags. W21 read `analysisComplete` off the three flags alone, so a
 * contradictions run that compared only matched pairs was listed "inceleme
 * tamamlandı" while its own view refused that claim (W22).
 */
function storedCompleteness(run: DurableRunRow): AnalysisCompleteness | null {
  if (
    run.status !== "done" ||
    run.coverage === undefined ||
    run.extractionCoverage === undefined ||
    run.intelligenceCoverage === undefined
  ) {
    return null;
  }
  return deriveAnalysisCompleteness({
    task: run.task,
    source: run.coverage,
    extraction: run.extractionCoverage,
    intelligence: run.intelligenceCoverage,
    active: false,
  });
}

/** Source read, extraction complete, every analytical stage complete, and not limited. */
function analysisCompleteOf(run: DurableRunRow): boolean {
  return storedCompleteness(run)?.complete === true;
}

/** What a run read: the whole matter, or documents the lawyer selected (W22). */
export type RunScope = "whole_matter" | "selected";

function scopeOf(run: DurableRunRow): RunScope {
  return run.snapshot?.wholeMatter === false ? "selected" : "whole_matter";
}

/**
 * W22: the list's reading chip, said by the server. A run over 2 of the 8
 * documents was listed "dosyanın tamamı okundu" — the console composed that
 * from `complete` alone and never knew the scope.
 */
export function readLabelTr(scope: RunScope, documentCount: number, complete: boolean): string {
  if (scope === "selected") {
    return complete
      ? `seçilen ${documentCount} belgenin tamamı okundu (dosyanın tamamı değil)`
      : `seçilen ${documentCount} belgenin tamamı okunmadı`;
  }
  return complete ? "dosyanın tamamı okundu" : "dosyanın tamamı okunmadı";
}

/**
 * W22: the list's analysis chip, from the derived completeness contract.
 * W23: a model task (full_review, red_team) that is LIMITED ran every stage;
 * only its rule lane compared matched value pairs, and the chip says that
 * instead of implying the whole task compared only value pairs.
 */
export function analysisLabelTr(completeness: AnalysisCompleteness | null, task?: AnalysisTask): string {
  if (completeness === null) return "inceleme eksik kaldı";
  if (completeness.complete) return "inceleme tamamlandı";
  if (completeness.state === "LIMITED") {
    if (task === "chronology") return "kronoloji bitti; tarih çelişkileri yalnız eşleşen tarih çiftleri arasında arandı";
    return task !== undefined && TASK_SPECS[task].requiresModel
      ? "inceleme bitti; tarih, tutar ve oranlarda yalnız eşleşen değer çiftleri karşılaştırıldı"
      : "inceleme bitti; yalnız eşleşen değer çiftleri karşılaştırıldı";
  }
  return "inceleme eksik kaldı";
}

export function createExhaustiveRouter(deps: ExhaustiveRouterDeps): Hono {
  const app = new Hono();
  const routes = (): WorkerModelRoutes => deps.models?.() ?? {};
  /** The trust rules' refusal of a configured local address, or "". */
  const refusedReason = (): string => {
    if (deps.localRefusedReason !== undefined) return (deps.localRefusedReason() ?? "").trim();
    const resolved = resolveLocalGenerationConfig();
    return resolved.kind === "REFUSED" ? resolved.refusal.message.trim() : "";
  };
  /**
   * W21: may the model tasks run at all (AI policy + where the model runs)?
   * The refused-address reason is passed on, so an address that is set but
   * refused reaches the capabilities and the 409 message as what it is.
   */
  const modelGate = (models: WorkerModelRoutes): ModelGate => {
    const missing = models.extraction === undefined || models.synthesis === undefined;
    const refused = missing ? refusedReason() : "";
    const decision = decideModelTasks(
      deps.aiPolicy?.() ?? resolveEffectiveAiPolicy().policy,
      models,
      deps.localTrust?.() ?? null,
      refused === "" ? null : refused,
    );
    // Only a plain "no model is configured" keeps the task's own sentence;
    // the AI policy, an outside endpoint and a refused address are named.
    const plainNoModel = decision.code === "MODEL_UNAVAILABLE" && refused === "";
    return { decision, blockedReasonTr: decision.allowed || plainNoModel ? undefined : decision.reasonTr };
  };

  /** Live coverage for an active run; the stored one for a finished run. */
  async function coverageOf(run: DurableRunRow): Promise<ProcessingCoverage | null> {
    const finished = run.status === "done" || run.status === "failed" || run.status === "cancelled";
    if (finished && run.coverage !== undefined) return run.coverage;
    if (run.snapshot === undefined) return run.coverage ?? null;
    const ledger = await deps.store.loadLedger(run.runId);
    const documents = await deps.store.loadVersionDocuments(run.snapshot.versions, { withText: false });
    return runReduce(documents, ledger, [], []).coverage;
  }

  /**
   * The two analytical layers: stored once a run is done, derived LIVE from
   * the ledger and the task rows otherwise (a failed or cancelled run is
   * derived too, and is never finalized, so it is never complete).
   */
  async function analysisLayersOf(
    run: DurableRunRow,
  ): Promise<{ extraction: ExtractionCoverage; intelligence: IntelligenceCoverage }> {
    if (run.status === "done" && run.extractionCoverage !== undefined && run.intelligenceCoverage !== undefined) {
      return { extraction: run.extractionCoverage, intelligence: run.intelligenceCoverage };
    }
    const spec = TASK_SPECS[run.task];
    const terminal = run.status === "failed" || run.status === "cancelled";
    const extraction = deriveExtractionCoverage(
      await deps.store.loadExtractionLedger(run.runId),
      spec.requiresModel && spec.modelKinds.length > 0,
      terminal,
    );
    const tasks = await deps.store.loadTasks(run.runId);
    const weighPlan = tasks.find((row) => row.stage === "plan" && row.taskKey === "weigh");
    const details = (weighPlan?.result?.["details"] ?? {}) as Record<string, unknown>;
    const intelligence = deriveIntelligenceCoverage({
      task: run.task,
      tasks,
      claimsTotal: Number(details["claims"] ?? 0),
      defensesTotal: Number(details["defenses"] ?? 0),
      evidenceItemsTotal: Number(details["evidenceUniverse"] ?? 0),
      modelAvailable: modelReady(routes()),
      finalized: false,
      terminal,
    });
    return { extraction, intelligence };
  }

  /** Files whose current version is no longer the one the run read. */
  async function changedSources(run: DurableRunRow): Promise<string[]> {
    if (run.snapshot === undefined) return [];
    const current = await deps.store.currentVersions(run.snapshot.fileIds);
    return run.snapshot.versions
      .filter(([fileId, versionId]) => (current.get(fileId) ?? null) !== versionId)
      .map(([fileId]) => fileId);
  }

  /** The matter's current documents, or null when the matter store cannot answer. */
  async function currentMembers(matterId: string): Promise<readonly string[] | null> {
    try {
      return await matterFileIds(deps.matters, matterId);
    } catch {
      return null;
    }
  }

  /**
   * W21 round-two review: a run froze the matter's documents when it
   * started. A document added to the matter since (a whole-matter run), a
   * pinned document changed or deleted, or one removed from the matter
   * makes the result NOT CURRENT: its "every document was read" and its
   * "no support was found" findings no longer speak for the matter.
   */
  async function scopeDrift(run: DurableRunRow, members?: readonly string[] | null): Promise<ScopeDrift> {
    const changed = await changedSources(run);
    if (run.snapshot === undefined) return { changed, added: [], removed: [], membersUnknown: false };
    const current = members === undefined ? await currentMembers(run.matterId) : members;
    if (current === null) return { changed, added: [], removed: [], membersUnknown: true };
    const pinned = new Set(run.snapshot.fileIds);
    const memberSet = new Set(current);
    return {
      changed,
      added: run.snapshot.wholeMatter === false ? [] : current.filter((fileId) => !pinned.has(fileId)),
      removed: run.snapshot.fileIds.filter((fileId) => !memberSet.has(fileId) && !changed.includes(fileId)),
      membersUnknown: false,
    };
  }

  /**
   * W22: the lawyer-facing names of the documents a drift names. The stale
   * banner printed "dosyaya eklenen belgeler: 3f9a1c0d2b7e4a51" — a raw id.
   * A pinned file is named by its document title, an added one by the name
   * it was filed under in the matter; an id is shown only when neither exists.
   */
  async function driftNames(run: DurableRunRow, drift: ScopeDrift): Promise<Record<string, string>> {
    const ids = new Set([...drift.changed, ...drift.added, ...drift.removed]);
    const names: Record<string, string> = {};
    if (ids.size === 0) return names;
    try {
      const pinned = (run.snapshot?.versions ?? []).filter(([fileId]) => ids.has(fileId));
      if (pinned.length > 0) {
        for (const document of await deps.store.loadVersionDocuments(pinned, { withText: false })) {
          if (document.extractionFailed !== true && document.fileName !== "") names[document.fileId] = document.fileName;
        }
      }
    } catch {
      // Names are a courtesy; the ids stay.
    }
    try {
      for (const item of await deps.matters.listItems(run.matterId)) {
        if (item.kind !== "file" || item.refId === null || !ids.has(item.refId) || names[item.refId] !== undefined) continue;
        const fileName = item.payload["fileName"];
        if (typeof fileName === "string" && fileName.trim() !== "") names[item.refId] = fileName;
      }
    } catch {
      // As above.
    }
    return names;
  }

  async function runView(run: DurableRunRow): Promise<Record<string, unknown>> {
    const coverage = await coverageOf(run);
    const progress = await deps.store.progress(run.runId);
    const layers = await analysisLayersOf(run);
    const active = run.status !== "done" && run.status !== "failed" && run.status !== "cancelled";
    const derived =
      coverage === null
        ? null
        : deriveAnalysisCompleteness({
            task: run.task,
            source: coverage,
            extraction: layers.extraction,
            intelligence: layers.intelligence,
            active,
          });
    const spec = TASK_SPECS[run.task];
    const drift = await scopeDrift(run);
    const sourceChanged = drift.changed;
    const stale = isDrifted(drift);
    const notCurrent = stale ? RUN_NOT_CURRENT_TR : drift.membersUnknown ? MATTER_MEMBERS_UNKNOWN_TR : null;
    // A run that was complete (or finished-but-limited) for the documents it
    // froze is not complete for the matter as it is now. W22: the STATE says
    // so too — "COMPLETE" next to complete:false was the stale run's view.
    const completeness: AnalysisCompleteness | null =
      derived !== null && notCurrent !== null && !active && (derived.complete || derived.state === "LIMITED")
        ? {
            ...derived,
            state: "INCOMPLETE",
            analysisLimited: false,
            complete: false,
            refusedBecause: notCurrent,
            headlineTr: notCurrent,
          }
        : derived;
    return {
      runId: run.runId,
      matterId: run.matterId,
      task: run.task,
      taskTitle: spec.titleTr,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      error: run.error,
      cancelRequested: run.cancelRequested,
      progress,
      analysisProgress: await deps.store.taskProgress(run.runId),
      processingCoverage: coverage,
      extractionCoverage: layers.extraction,
      intelligenceCoverage: layers.intelligence,
      // The ONLY field that may license "the analysis is complete".
      analysisCompleteness: completeness,
      coverageSummary:
        coverage === null ? null : coverageSentenceTr(coverage, { runEnded: runEndedOf(run.status) }),
      // Present whenever an exhaustive claim is NOT permitted. A caller that
      // renders "tüm çelişkiler" must check this first.
      // W21: also refused while extraction or an analytical stage is
      // incomplete or still running — "every page read" never licenses
      // "tüm çelişkiler" on its own. The source reason keeps priority.
      exhaustiveClaimRefusedBecause:
        coverage === null
          ? "İnceleme kapsamı hesaplanamadı."
          : refuseExhaustiveClaim(coverage, { runEnded: runEndedOf(run.status) }) ??
            completeness?.refusedBecause ??
            notCurrent,
      // A finished run is an immutable snapshot of the versions it read; a
      // newer upload of one of those files makes the result STALE, and the
      // lawyer is told which files changed rather than shown old findings as
      // current.
      sourceChanged,
      sourceAdded: drift.added,
      sourceRemoved: drift.removed,
      // W22 (additive): the names of the documents above, by id.
      sourceNames: await driftNames(run, drift),
      stale,
      // W22 (additive): what the run read — the whole matter or a selection.
      scope: scopeOf(run),
      documentCount: run.snapshot?.fileIds.length ?? null,
      summary: run.summary,
      model: run.modelId,
      limitsTr: spec.limitsTr,
    };
  }

  async function ownedRun(matterId: string, runId: string): Promise<DurableRunRow | undefined> {
    if (!UUID_RE.test(matterId) || !UUID_RE.test(runId)) return undefined;
    const run = await deps.store.getRun(runId);
    return run === undefined || run.matterId !== matterId ? undefined : run;
  }

  app.get("/v1/matters/:matterId/analysis/capabilities", (c) => {
    if (!UUID_RE.test(c.req.param("matterId"))) return notFound(c);
    const models = routes();
    const gate = modelGate(models);
    const decision = gate.decision;
    const ready = decision.allowed;
    const trust: EndpointTrust | undefined = models.extraction?.trust;
    return c.json({
      model: {
        configured: modelReady(models),
        ...(models.extraction !== undefined ? { model: models.extraction.model } : {}),
        ...(trust !== undefined ? { where: trustLabelTr(trust) } : {}),
        // W21: configured is not usable — the AI policy and the on-machine
        // rule decide, and the reason is said in plain Turkish.
        usable: ready,
        code: decision.code,
        reasonTr: decision.reasonTr,
      },
      tasks: ANALYSIS_TASKS.map((task) => {
        const spec = TASK_SPECS[task];
        const availability = taskAvailability(task, ready, gate.blockedReasonTr);
        return {
          task,
          titleTr: spec.titleTr,
          descriptionTr: spec.descriptionTr,
          requiresModel: spec.requiresModel,
          available: availability.available,
          ...(availability.messageTr !== undefined ? { messageTr: availability.messageTr } : {}),
          limitsTr: spec.limitsTr,
        };
      }),
    });
  });

  app.post("/v1/matters/:matterId/analysis", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);

    let body: unknown = {};
    try {
      const raw = await c.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek okunamadı." } }, 400);
    }
    const parsed = analysisRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İnceleme isteği doğrulanamadı.",
            // W22: Turkish sentences, the field named by its path.
            issues: fieldIssues(parsed.error, zodMessageTr),
          },
        },
        400,
      );
    }
    const task: AnalysisTask = parsed.data.task;
    const clientRole = parsed.data.clientRole ?? null;

    // Resolve the scope the SAME way /v1/answer does, so "the whole file"
    // means the same set of documents in both places.
    const scope = await resolveMatterScope(deps.matters, {
      matterId,
      ...(parsed.data.fileIds !== undefined ? { fileIds: parsed.data.fileIds } : {}),
    });
    if (scope.kind === "MATTER_NOT_FOUND") return notFound(c);
    if (scope.kind === "STORE_UNAVAILABLE") {
      return c.json({ error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı." } }, 503);
    }
    if (scope.kind === "MATTER_EMPTY") {
      return c.json(
        {
          error: {
            kind: "MATTER_EMPTY",
            message: "Bu dosyada henüz belge yok. Önce belge ekleyin, sonra dosyanın tamamını inceletin.",
          },
        },
        409,
      );
    }
    if (scope.kind === "FILES_OUTSIDE_MATTER") {
      return c.json(
        {
          error: {
            kind: "FILES_OUTSIDE_MATTER",
            message: `Seçilen belgelerden bazıları bu dosyaya bağlı değil: ${scope.outside.join(", ")}.`,
          },
        },
        409,
      );
    }
    if (scope.kind === "MATTER_TOO_LARGE") {
      return c.json(
        {
          error: {
            kind: "MATTER_TOO_LARGE",
            message: `Bu dosyada ${scope.fileCount} belge var; tek incelemede en çok ${scope.limit} belge taranabilir.`,
          },
        },
        413,
      );
    }

    // A model-required task does not start without a model — it is never
    // quietly downgraded to its deterministic part.
    const models = routes();
    const gate = modelGate(models);
    const availability = taskAvailability(task, gate.decision.allowed, gate.blockedReasonTr);
    if (!availability.available) {
      return c.json(
        { error: { kind: "MODEL_REQUIRED", message: availability.messageTr ?? "Model gerekiyor." } },
        409,
      );
    }
    const spec = TASK_SPECS[task];

    // Freeze the identity: pinned VERSION ids, not just file ids.
    const current = await deps.store.currentVersions(scope.fileIds);
    const versions = [...scope.fileIds]
      .sort()
      .map((fileId) => [fileId, current.get(fileId) ?? null] as const);
    const extraction = spec.requiresModel ? models.extraction : undefined;
    const identity: RunIdentity = {
      tenantId: deps.store.tenantId,
      matterId,
      task,
      versions,
      unitBuilderVersion: UNIT_BUILDER_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      modelSchemaVersion: spec.requiresModel ? MODEL_EXTRACTOR_VERSION : null,
      // The reduce builders AND the analytical stage schema: a change to
      // either makes earlier results incomparable, so it is a new run.
      intelVersion: `${INTEL_VERSION}+${STAGE_SCHEMA_VERSION}`,
      model:
        extraction === undefined
          ? null
          : {
              provider: PROVIDER_FAMILY,
              modelId:
                models.synthesis !== undefined && models.synthesis.model !== extraction.model
                  ? `${extraction.model}+${models.synthesis.model}`
                  : extraction.model,
              trust: extraction.trust,
            },
      clientRole,
    };
    const identityKey = runIdentityKey(identity);

    let runId = await deps.store.findActiveRun(identityKey);
    let resumed = runId !== undefined;
    if (runId === undefined) {
      const documents = await deps.store.loadVersionDocuments(versions, { withText: true });
      const units = planUnits(documents);
      const created = await deps.store.createRun({
        matterId,
        task,
        identityKey,
        snapshot: {
          versions,
          fileIds: [...scope.fileIds],
          wholeMatter: parsed.data.fileIds === undefined,
          clientRole,
          synthesisModel: spec.requiresModel ? models.synthesis?.model ?? null : null,
          identity: canonicalRunIdentity(identity),
        },
        units,
        modelId: extraction?.model ?? null,
        provider: extraction === undefined ? null : PROVIDER_FAMILY,
        trust: extraction?.trust ?? null,
        modelSchemaVersion: spec.requiresModel ? MODEL_EXTRACTOR_VERSION : null,
      });
      runId = created.runId;
      resumed = created.resumed;
    }
    deps.worker?.kick();

    const run = await deps.store.getRun(runId);
    if (run === undefined) return runNotFound(c);
    return c.json(
      {
        ...(await runView(run)),
        resumed,
        links: {
          self: `/v1/matters/${matterId}/analysis/${runId}`,
          findings: `/v1/matters/${matterId}/analysis/${runId}/findings`,
          cancel: `/v1/matters/${matterId}/analysis/${runId}/cancel`,
        },
      },
      202,
    );
  });

  app.get("/v1/matters/:matterId/analysis", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);
    const runs = await deps.store.listRuns(matterId);
    const members = await currentMembers(matterId);
    const views = [];
    for (const run of runs) {
      const drift = await scopeDrift(run, members);
      const stale = isDrifted(drift);
      const complete = !stale && (run.coverage?.complete ?? false);
      const current = !stale && !drift.membersUnknown;
      const completeness = current ? storedCompleteness(run) : null;
      const scope = scopeOf(run);
      const documentCount = run.snapshot?.fileIds.length ?? 0;
      views.push({
        runId: run.runId,
        task: run.task,
        taskTitle: TASK_SPECS[run.task].titleTr,
        status: run.status,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        // A run over documents the matter no longer has as they were is not
        // "the whole file read" or "complete" for the matter now.
        complete,
        analysisComplete: completeness?.complete === true,
        // W22 (additive): the derived state, what the run read, and the two
        // chips as the server says them — a 2-of-8 selection is never
        // "dosyanın tamamı okundu", a matched-pairs run never "tamamlandı".
        analysisState: completeness?.state ?? null,
        scope,
        documentCount,
        readTr: readLabelTr(scope, documentCount, complete),
        analysisTr: analysisLabelTr(completeness, run.task),
        stale,
        sourceChanged: drift.changed,
        sourceAdded: drift.added,
        sourceRemoved: drift.removed,
        coverageSummary:
          run.coverage === undefined
            ? null
            : coverageSentenceTr(run.coverage, { runEnded: runEndedOf(run.status) }),
      });
    }
    return c.json({ runs: views });
  });

  app.get("/v1/matters/:matterId/intelligence", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);
    const latest = await deps.store.latestFinishedRuns(matterId);
    const members = await currentMembers(matterId);
    const tasks = [];
    for (const run of latest) {
      const drift = await scopeDrift(run, members);
      const stale = isDrifted(drift);
      tasks.push({
        task: run.task,
        taskTitle: TASK_SPECS[run.task].titleTr,
        runId: run.runId,
        finishedAt: run.finishedAt,
        complete: !stale && (run.coverage?.complete ?? false),
        analysisComplete: !stale && !drift.membersUnknown && analysisCompleteOf(run),
        coverageSummary:
          run.coverage === undefined
            ? null
            : coverageSentenceTr(run.coverage, { runEnded: runEndedOf(run.status) }),
        // Derived intelligence is a cache: when a source changed, or the
        // matter gained or lost a document, the cached result is flagged stale
        // and a new run is needed to rebuild it.
        stale,
        sourceChanged: drift.changed,
        sourceAdded: drift.added,
        sourceRemoved: drift.removed,
        items: (run.summary["items"] as Record<string, number> | undefined) ?? {},
      });
    }
    return c.json({ matterId, tasks });
  });

  app.get("/v1/matters/:matterId/analysis/:runId", async (c) => {
    const run = await ownedRun(c.req.param("matterId"), c.req.param("runId"));
    if (run === undefined) return runNotFound(c);
    return c.json(await runView(run));
  });

  app.get("/v1/matters/:matterId/analysis/:runId/findings", async (c) => {
    const run = await ownedRun(c.req.param("matterId"), c.req.param("runId"));
    if (run === undefined) return runNotFound(c);
    if (run.status !== "done" && run.status !== "cancelled" && run.status !== "failed") {
      return c.json(
        {
          error: { kind: "RUN_NOT_FINISHED", message: "İnceleme henüz bitmedi." },
          progress: await deps.store.progress(run.runId),
        },
        409,
      );
    }
    const view = await runView(run);
    const findings = await deps.store.loadFindings(run.runId);
    return c.json({ ...view, ...findings });
  });

  app.post("/v1/matters/:matterId/analysis/:runId/cancel", async (c) => {
    const run = await ownedRun(c.req.param("matterId"), c.req.param("runId"));
    if (run === undefined) return runNotFound(c);
    const outcome = await deps.store.requestCancel(run.runId);
    if (outcome === "not_found") return runNotFound(c);
    if (outcome === "not_active") {
      return c.json({ error: { kind: "RUN_NOT_ACTIVE", message: "Bu inceleme zaten bitmiş." } }, 409);
    }
    deps.worker?.kick();
    return c.json({ runId: run.runId, status: "cancelling" }, 202);
  });

  return app;
}

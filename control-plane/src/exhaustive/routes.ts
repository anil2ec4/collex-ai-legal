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
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import { trustLabelTr, type EndpointTrust } from "../llm/endpointTrust.js";
import { resolveMatterScope } from "../matters/scope.js";
import type { MatterStore } from "../matters/types.js";
import type { DurableAnalysisStore, DurableRunRow } from "./durableStore.js";
import { canonicalRunIdentity, runIdentityKey, type RunIdentity } from "./identity.js";
import { INTEL_VERSION } from "./intelligence.js";
import { MODEL_EXTRACTOR_VERSION } from "./modelExtractor.js";
import { coverageSentenceTr, refuseExhaustiveClaim, type ProcessingCoverage } from "./processingCoverage.js";
import { EXTRACTOR_VERSION, planUnits, runReduce, UNIT_BUILDER_VERSION } from "./runner.js";
import { ANALYSIS_TASKS, TASK_SPECS, taskAvailability, type AnalysisTask } from "./tasks.js";
import type { WorkerModelRoutes } from "./worker.js";

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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PROVIDER_FAMILY = "openai-compatible";

function notFound(c: Context): Response {
  return c.json({ error: { kind: "MATTER_NOT_FOUND", message: "Bu dava dosyası bulunamadı." } }, 404);
}

function runNotFound(c: Context): Response {
  return c.json({ error: { kind: "RUN_NOT_FOUND", message: "Bu inceleme bulunamadı." } }, 404);
}

function modelReady(routes: WorkerModelRoutes): boolean {
  return routes.extraction !== undefined && routes.synthesis !== undefined;
}

export function createExhaustiveRouter(deps: ExhaustiveRouterDeps): Hono {
  const app = new Hono();
  const routes = (): WorkerModelRoutes => deps.models?.() ?? {};

  /** Live coverage for an active run; the stored one for a finished run. */
  async function coverageOf(run: DurableRunRow): Promise<ProcessingCoverage | null> {
    const finished = run.status === "done" || run.status === "failed" || run.status === "cancelled";
    if (finished && run.coverage !== undefined) return run.coverage;
    if (run.snapshot === undefined) return run.coverage ?? null;
    const ledger = await deps.store.loadLedger(run.runId);
    const documents = await deps.store.loadVersionDocuments(run.snapshot.versions, { withText: false });
    return runReduce(documents, ledger, [], []).coverage;
  }

  /** Files whose current version is no longer the one the run read. */
  async function changedSources(run: DurableRunRow): Promise<string[]> {
    if (run.snapshot === undefined) return [];
    const current = await deps.store.currentVersions(run.snapshot.fileIds);
    return run.snapshot.versions
      .filter(([fileId, versionId]) => (current.get(fileId) ?? null) !== versionId)
      .map(([fileId]) => fileId);
  }

  async function runView(run: DurableRunRow): Promise<Record<string, unknown>> {
    const coverage = await coverageOf(run);
    const progress = await deps.store.progress(run.runId);
    const spec = TASK_SPECS[run.task];
    const sourceChanged = await changedSources(run);
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
      processingCoverage: coverage,
      coverageSummary: coverage === null ? null : coverageSentenceTr(coverage),
      // Present whenever an exhaustive claim is NOT permitted. A caller that
      // renders "tüm çelişkiler" must check this first.
      exhaustiveClaimRefusedBecause:
        coverage === null ? "İnceleme kapsamı hesaplanamadı." : refuseExhaustiveClaim(coverage) ?? null,
      // A finished run is an immutable snapshot of the versions it read; a
      // newer upload of one of those files makes the result STALE, and the
      // lawyer is told which files changed rather than shown old findings as
      // current.
      sourceChanged,
      stale: sourceChanged.length > 0,
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
    const ready = modelReady(models);
    const trust: EndpointTrust | undefined = models.extraction?.trust;
    return c.json({
      model: {
        configured: ready,
        ...(models.extraction !== undefined ? { model: models.extraction.model } : {}),
        ...(trust !== undefined ? { where: trustLabelTr(trust) } : {}),
      },
      tasks: ANALYSIS_TASKS.map((task) => {
        const spec = TASK_SPECS[task];
        const availability = taskAvailability(task, ready);
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
            issues: fieldIssues(parsed.error),
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
    const availability = taskAvailability(task, modelReady(models));
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
      intelVersion: INTEL_VERSION,
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
    return c.json({
      runs: runs.map((run) => ({
        runId: run.runId,
        task: run.task,
        taskTitle: TASK_SPECS[run.task].titleTr,
        status: run.status,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        complete: run.coverage?.complete ?? false,
        coverageSummary: run.coverage === undefined ? null : coverageSentenceTr(run.coverage),
      })),
    });
  });

  app.get("/v1/matters/:matterId/intelligence", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);
    const latest = await deps.store.latestFinishedRuns(matterId);
    const tasks = [];
    for (const run of latest) {
      const sourceChanged = await changedSources(run);
      tasks.push({
        task: run.task,
        taskTitle: TASK_SPECS[run.task].titleTr,
        runId: run.runId,
        finishedAt: run.finishedAt,
        complete: run.coverage?.complete ?? false,
        coverageSummary: run.coverage === undefined ? null : coverageSentenceTr(run.coverage),
        // Derived intelligence is a cache: when a source changed, the cached
        // result is flagged stale and a new run is needed to rebuild it.
        stale: sourceChanged.length > 0,
        sourceChanged,
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

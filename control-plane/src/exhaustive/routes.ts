/**
 * HTTP surface for exhaustive Matter analysis.
 *
 *   POST /v1/matters/{matterId}/analysis        start a run
 *   GET  /v1/matters/{matterId}/analysis        list this matter's runs
 *   GET  /v1/matters/{matterId}/analysis/{id}   one run: status + coverage
 *
 * Additive: no existing path, parameter or response field changes.
 *
 * The run is EXECUTED SYNCHRONOUSLY here and its ledger is durable, which is
 * the honest shape for the deterministic extractor: it is fast, and a run
 * that is still writing rows when the response is sent would report coverage
 * nobody could trust. When a model-assisted extractor is wired the same
 * ledger supports resuming a long run, because the census is written before
 * the work starts.
 *
 * The response ALWAYS carries `processingCoverage`, including on the paths
 * where the run went badly — a caller must never have to infer how much was
 * read from the absence of a field.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import { resolveMatterScope } from "../matters/scope.js";
import type { MatterStore } from "../matters/types.js";
import {
  coverageSentenceTr,
  refuseExhaustiveClaim,
} from "./processingCoverage.js";
import {
  planUnits,
  runAggregate,
  runMap,
  runReduce,
} from "./runner.js";
import type { AnalysisTask, ExhaustiveStore } from "./store.js";

const taskSchema = z.enum([
  "full_review",
  "contradictions",
  "chronology",
  "claim_evidence",
  "red_team",
]);

export const analysisRequestSchema = z
  .object({
    task: taskSchema.default("full_review"),
    /**
     * Restrict to specific uploads of the matter. Omitted means the WHOLE
     * matter, which is the point of the feature; when given, the ids are
     * verified as members (scope never widens).
     */
    fileIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  })
  .strict();

export interface ExhaustiveRouterDeps {
  readonly store: ExhaustiveStore;
  readonly matters: MatterStore;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function notFound(c: Context): Response {
  return c.json(
    {
      error: {
        kind: "MATTER_NOT_FOUND",
        message: "Bu dava dosyası bulunamadı.",
      },
    },
    404,
  );
}

export function createExhaustiveRouter(deps: ExhaustiveRouterDeps): Hono {
  const app = new Hono();

  app.post("/v1/matters/:matterId/analysis", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);

    let body: unknown = {};
    try {
      const text = await c.req.text();
      if (text.trim() !== "") body = JSON.parse(text);
    } catch {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İstek okunamadı.",
          },
        },
        400,
      );
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

    // Resolve the scope the SAME way /v1/answer does, so "the whole file"
    // means the same set of documents in both places.
    const scope = await resolveMatterScope(deps.matters, {
      matterId,
      ...(parsed.data.fileIds !== undefined ? { fileIds: parsed.data.fileIds } : {}),
    });
    if (scope.kind === "MATTER_NOT_FOUND") return notFound(c);
    if (scope.kind === "STORE_UNAVAILABLE") {
      return c.json(
        {
          error: {
            kind: "STORE_UNAVAILABLE",
            message: "Yerel veritabanına ulaşılamadı.",
          },
        },
        503,
      );
    }
    if (scope.kind === "MATTER_EMPTY") {
      return c.json(
        {
          error: {
            kind: "MATTER_EMPTY",
            message:
              "Bu dosyada henüz belge yok. Önce belge ekleyin, sonra" +
              " dosyanın tamamını inceletin.",
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
            message:
              "Seçilen belgelerden bazıları bu dosyaya bağlı değil:" +
              ` ${scope.outside.join(", ")}.`,
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
            message:
              `Bu dosyada ${scope.fileCount} belge var; tek incelemede en çok` +
              ` ${scope.limit} belge taranabilir.`,
          },
        },
        413,
      );
    }

    const task = parsed.data.task as AnalysisTask;
    const documents = await deps.store.loadScope(scope.fileIds);
    const units = planUnits(documents);

    // Pick up an INTERRUPTED run over the same matter and the same scope
    // rather than starting a fresh census. This is what makes "a failure on
    // unit 846 of 1 200 does not reprocess units 1-845" real.
    //
    // Reuse is deliberately scoped to ONE run. Reusing across FINISHED runs
    // looks like a saving and is a correctness bug: a reused unit emits no
    // observations, so a second analysis of an unchanged matter came back
    // with complete coverage and ZERO findings. A new request is a new
    // question and gets its own complete extraction.
    const resumed = await deps.store.findResumableRun(matterId, scope.fileIds);
    const runId =
      resumed ??
      (await deps.store.createRun({ matterId, task, fileIds: scope.fileIds }));
    // The census is durable BEFORE any analysis begins.
    await deps.store.saveUnits(runId, units);

    const reusable = await deps.store.reusableUnits(runId);
    const { ledger, observations } = runMap(units, documents, { reusable });
    const relations = runAggregate(observations);
    const result = runReduce(documents, ledger, observations, relations);

    // ORDER MATTERS. The observations are persisted BEFORE the units are
    // marked done. The other way round, a failure between the two left units
    // recorded as read with nothing to show for them — and because a done
    // unit is skipped on resume, that evidence would never be produced
    // again while coverage still counted the unit as processed.
    const observationIds = await deps.store.saveObservations(
      runId,
      matterId,
      observations,
    );
    await deps.store.saveRelations(runId, relations, observationIds);
    await deps.store.recordProgress(runId, ledger);
    // A run whose coverage is incomplete is still a FINISHED run; the
    // status says the work stopped, `processingCoverage.complete` says
    // whether it covered everything. They are different facts.
    await deps.store.finishRun(runId, "done", result.coverage);

    return c.json(
      {
        runId,
        matterId,
        task,
        status: "done",
        processingCoverage: result.coverage,
        // The one sentence the product is allowed to say about how much it
        // read, produced in exactly one place.
        coverageSummary: coverageSentenceTr(result.coverage),
        // Present when an exhaustive claim is NOT permitted. A caller that
        // renders "tüm çelişkiler" must check this first.
        exhaustiveClaimRefusedBecause: refuseExhaustiveClaim(result.coverage) ?? null,
        findings: {
          observations: observations.length,
          relations: relations.map((relation) => ({
            relation: relation.relation,
            rationale: relation.rationale,
            subjectOverlap: relation.subjectOverlap,
            left: {
              fileId: relation.left.fileId,
              statement: relation.left.statement,
            },
            right: {
              fileId: relation.right.fileId,
              statement: relation.right.statement,
            },
          })),
        },
      },
      201,
    );
  });

  app.get("/v1/matters/:matterId/analysis", async (c) => {
    const matterId = c.req.param("matterId");
    if (!UUID_RE.test(matterId)) return notFound(c);
    const runs = await deps.store.listRuns(matterId);
    return c.json({ runs });
  });

  app.get("/v1/matters/:matterId/analysis/:runId", async (c) => {
    const matterId = c.req.param("matterId");
    const runId = c.req.param("runId");
    if (!UUID_RE.test(matterId) || !UUID_RE.test(runId)) return notFound(c);
    const run = await deps.store.getRun(runId);
    if (run === undefined || run.matterId !== matterId) {
      return c.json(
        {
          error: {
            kind: "RUN_NOT_FOUND",
            message: "Bu inceleme bulunamadı.",
          },
        },
        404,
      );
    }
    return c.json({
      ...run,
      processingCoverage: run.coverage ?? null,
      coverageSummary:
        run.coverage === undefined ? null : coverageSentenceTr(run.coverage),
      exhaustiveClaimRefusedBecause:
        run.coverage === undefined ? null : refuseExhaustiveClaim(run.coverage) ?? null,
    });
  });

  return app;
}

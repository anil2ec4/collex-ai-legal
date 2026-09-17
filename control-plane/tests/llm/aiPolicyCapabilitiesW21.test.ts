/**
 * W21 lane C (#20), end to end: the surfaces the finding names — the matter
 * capabilities `model.code`, the task message and the 409 of a model-required
 * task — over the REAL route table (resolveModelRoutes, no trust injected by
 * hand) and the REAL createApp wiring (server.ts hands the table's trust to
 * the exhaustive router). Before the fix, LOCAL_ONLY + a hosted "local"
 * address answered MODEL_UNAVAILABLE "ayarlı bir yerel model yok" and the 409
 * said the model was "şu an yapılandırılmış değil" — false: a model IS
 * configured, it is off-machine.
 *
 * Needs the scratch PostgreSQL: the exhaustive routes are mounted only with a
 * database. No model is called: the table refuses the endpoint at startup.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/server.js";
import { resolveEffectiveAiPolicy } from "../../src/llm/aiPolicy.js";
import { resolveModelRoutes } from "../../src/llm/providerFactory.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import type { Sql } from "../../src/store/db.js";
import { insertUpload, linkFiles, paragraphs } from "../exhaustive/durableFixtures.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_lanec_test");

const noFetch = (async () => {
  throw new Error("no request may be made: the endpoint is refused before any adapter exists");
}) as unknown as typeof fetch;

const HOSTED_ENV = {
  COLLEX_LOCAL_LLM_BASE_URL: "https://inference.example.com",
  COLLEX_LOCAL_LLM_MODEL: "uzak-model",
};

let sql: Sql;
let matters: MatterStore;

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, {
    fileId: "lanec-petition",
    title: "Dava dilekçesi",
    blocks: paragraphs(["Davacı, kiracının Mart 2024 kira bedelini ödemediğini iddia etmektedir."], 6),
  });
  matters = new PgMatterStore({ sql });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

/** serve.mjs in shape: the table resolved once, handed to createApp with the policy. */
function appFor(env: Record<string, string>) {
  const effective = resolveEffectiveAiPolicy(env);
  const table = resolveModelRoutes(env, { policy: effective, fetchImpl: noFetch });
  const app = createApp({ sql, matterStore: matters, modelRoutes: table, aiPolicy: () => effective });
  return { table, app };
}

async function matterWithFile(title: string): Promise<string> {
  const matter = await matters.create({ title });
  await linkFiles(matters, matter.id, ["lanec-petition"]);
  return matter.id;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("#20 capabilities and the 409 name MODEL_OFF_MACHINE for a hosted address under LOCAL_ONLY", () => {
  const cases: Array<{ name: string; env: Record<string, string> }> = [
    { name: "COLLEX_AI_POLICY=LOCAL_ONLY", env: { ...HOSTED_ENV, COLLEX_AI_POLICY: "LOCAL_ONLY" } },
    { name: "COLLEX_DATA_BOUNDARY=LOCAL_ONLY", env: { ...HOSTED_ENV, COLLEX_DATA_BOUNDARY: "LOCAL_ONLY" } },
  ];
  for (const testCase of cases) {
    it(`${testCase.name}: model.code MODEL_OFF_MACHINE, the task message and the 409 say 'outside', never 'not configured'`, async () => {
      const { table, app } = appFor(testCase.env);
      expect(table.status).toBe("refused");
      expect(table.trust).toBe("CLOUD");
      expect(table.roles).toEqual({});
      const matterId = await matterWithFile(`Dışarıdaki model · ${testCase.name}`);

      const caps = await app.request(`/v1/matters/${matterId}/analysis/capabilities`);
      expect(caps.status).toBe(200);
      const body = (await caps.json()) as {
        model: { configured: boolean; usable: boolean; code: string; reasonTr: string };
        tasks: Array<{ task: string; available: boolean; messageTr?: string }>;
      };
      expect(body.model).toEqual(expect.objectContaining({ configured: false, usable: false, code: "MODEL_OFF_MACHINE" }));
      expect(body.model.reasonTr).toContain("kendi ağınızda değil");
      expect(body.model.reasonTr).not.toContain("ayarlı bir yerel model yok");
      const full = body.tasks.find((task) => task.task === "full_review");
      expect(full?.available).toBe(false);
      expect(full?.messageTr).toContain("kendi ağınızda değil");
      expect(full?.messageTr).not.toContain("yapılandırılmış değil");

      const refused = await app.request(`/v1/matters/${matterId}/analysis`, json({ task: "full_review" }));
      expect(refused.status).toBe(409);
      const error = (await refused.json()) as { error: { kind: string; message: string } };
      expect(error.error.kind).toBe("MODEL_REQUIRED");
      expect(error.error.message).toContain("kendi ağınızda değil");
      expect(error.error.message).not.toContain("yapılandırılmış değil");

      // The deterministic tasks are unaffected by where the model is.
      const contradictions = await app.request(`/v1/matters/${matterId}/analysis`, json({ task: "contradictions" }));
      expect(contradictions.status).toBe(202);
    });
  }

  it("nothing configured at all is still honestly MODEL_UNAVAILABLE 'no local model'", async () => {
    const { table, app } = appFor({ COLLEX_AI_POLICY: "LOCAL_ONLY" });
    expect(table.status).toBe("not_configured");
    const matterId = await matterWithFile("Modelsiz");
    const caps = await app.request(`/v1/matters/${matterId}/analysis/capabilities`);
    const body = (await caps.json()) as { model: { code: string; reasonTr: string } };
    expect(body.model.code).toBe("MODEL_UNAVAILABLE");
    expect(body.model.reasonTr).toContain("ayarlı bir yerel model yok");
  });
});

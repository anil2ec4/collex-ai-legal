/**
 * PgLegislationWatchStore against real SQL: one jsonb document per matter in
 * app_private.settings (no migration), listed by its key prefix only.
 *
 * Owns the scratch database `collex_lwatch_test` (created and dropped here,
 * never another name). Skips — with the environment named — when the local
 * PostgreSQL cluster is not reachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createDb, type Sql } from "../../src/store/db.js";
import { PgContactStore } from "../../src/matters/contacts.js";
import { LEGISLATION_WATCH_SCHEMA } from "../../src/legislationWatch/check.js";
import { PgLegislationWatchStore, type WatchDocument } from "../../src/legislationWatch/store.js";
import { planMigrations } from "../store/testDb.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

const TEST_DB_NAME = "collex_lwatch_test";
const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const ADMIN_URL = "postgres://postgres@" + HOST_PORT + "/postgres";
const TEST_DB_URL = "postgres://postgres@" + HOST_PORT + "/" + TEST_DB_NAME;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

let available = false;
{
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await admin`select 1`;
    available = true;
  } catch {
    available = false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function admin(statement: string): Promise<void> {
  if (!/\bcollex_lwatch_test\b/u.test(statement)) throw new Error("this suite owns collex_lwatch_test only");
  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(statement);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const TENANT = "00000000-0000-0000-0000-000000000001";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

function doc(matterId: string, checkedAt: string): WatchDocument {
  return {
    schema: LEGISLATION_WATCH_SCHEMA,
    matterId,
    baselines: {
      "KANUN:6098": {
        lawKey: "KANUN:6098",
        method: "lw-fp-1",
        mevzuatId: "10098",
        title: "TÜRK BORÇLAR KANUNU",
        rgDate: "2011-02-04",
        fingerprint: "a".repeat(64),
        latestNoteDate: "2020-03-12",
        recordedAt: checkedAt,
        articles: { "madde:475": { fingerprint: "b".repeat(64), latestNoteDate: "2020-03-12", recordedAt: checkedAt } },
      },
    },
    lastAsked: { "KANUN:6098": checkedAt },
    lastResult: null,
    updatedAt: checkedAt,
  };
}

describe.skipIf(!available)("legislation watch baselines in app_private.settings (collex_lwatch_test)", () => {
  let db: Sql;

  beforeAll(async () => {
    await admin("drop database if exists collex_lwatch_test with (force)");
    await admin("create database collex_lwatch_test template template0 encoding 'UTF8' locale 'C'");
    const plan = await planMigrations();
    const runner = postgres(TEST_DB_URL, { max: 1, connect_timeout: 10, onnotice: () => undefined });
    try {
      for (const file of plan.runnable) {
        await runner.unsafe(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
    } finally {
      await runner.end({ timeout: 10 });
    }
    db = createDb({ url: TEST_DB_URL, max: 2, applicationName: "collex-lwatch-test" });
  });

  afterAll(async () => {
    if (db !== undefined) await db.end({ timeout: 5 });
    await admin("drop database if exists collex_lwatch_test with (force)");
  });

  it("saves, reloads and replaces one document per matter, and lists only its own keys", async () => {
    const store = new PgLegislationWatchStore({ sql: db, tenantId: TENANT });
    expect(await store.load(M1)).toBeUndefined();
    await store.save(doc(M1, "2026-10-01T09:00:00.000Z"));
    await store.save(doc(M2, "2026-10-02T09:00:00.000Z"));
    await store.save(doc(M1, "2026-11-15T09:00:00.000Z"));
    // A neighbour in the same table must never be read as a watch document.
    await new PgContactStore({ sql: db, tenantId: TENANT }).save([]);

    const loaded = await store.load(M1);
    expect(loaded?.baselines["KANUN:6098"]?.recordedAt).toBe("2026-11-15T09:00:00.000Z");
    expect(loaded?.baselines["KANUN:6098"]?.articles["madde:475"]?.fingerprint).toBe("b".repeat(64));
    expect((await store.list()).map((d) => d.matterId)).toEqual([M1, M2]);

    const keys = await db`select key from app_private.settings where tenant_id = ${TENANT} order by key`;
    expect(keys.map((row) => row["key"])).toEqual([
      "contacts",
      `legislation-watch:${M1}`,
      `legislation-watch:${M2}`,
    ]);
  });
});

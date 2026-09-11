/**
 * Scratch-database lifecycle for the retrieval-QUALITY regression tests.
 *
 * Separate database, separate corpus, separate purpose from tests/store:
 * tests/store pins the SQL contracts (offsets, hashes, RLS, temporal
 * predicate); this suite pins the retrieval MECHANISMS that the fixture-corpus
 * eval measured as broken on 2026-08-27 — a dead lexical lane, contrary
 * authority never surfaced, as-of version selection, and citation-form
 * sensitivity.
 *
 * Like tests/store, these are REAL integration tests against the local scratch
 * PostgreSQL 18 at 127.0.0.1:55432 and they do NOT skip: a silently skipped
 * integration suite is indistinguishable from a passing one.
 *
 * Objects created/dropped, and nothing else: database `collex_quality_test`.
 * Never touches remote Supabase.
 *
 * The migration SELECTION rule (which files need pgvector and are therefore
 * unrunnable here) is imported from tests/store/testDb.ts rather than copied,
 * so there is exactly one place that rule lives on the TypeScript side and it
 * cannot drift between the two suites.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createDb, type Sql } from "../../src/store/db.js";
import { planMigrations } from "../store/testDb.js";

export const QUALITY_DB_NAME = "collex_quality_test";

const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const ADMIN_URL = "postgres://postgres@" + HOST_PORT + "/postgres";
export const QUALITY_DB_URL =
  "postgres://postgres@" + HOST_PORT + "/" + QUALITY_DB_NAME;

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

/** Fail loudly (never skip) when the scratch server is not reachable. */
export async function requireScratchPostgres(): Promise<string> {
  const admin = postgres(ADMIN_URL, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    const rows = await admin`select version() as version`;
    return String(rows[0]?.["version"] ?? "unknown");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "retrieval-quality tests require the LOCAL scratch PostgreSQL at " +
        HOST_PORT +
        " (user postgres, no password) and must not be skipped. " +
        "Connection failed: " +
        detail,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Drop + recreate `collex_quality_test` and apply every non-pgvector
 * migration. supabase/seed.sql is deliberately NOT applied: this suite asserts
 * on complete result sets, so the corpus must contain exactly the documents
 * qualityCorpus.ts defines and nothing else.
 */
export async function resetQualityDatabase(): Promise<string[]> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(
      "drop database if exists " + QUALITY_DB_NAME + " with (force)",
    );
    await admin.unsafe(
      "create database " +
        QUALITY_DB_NAME +
        " template template0 encoding 'UTF8' locale 'C'",
    );
  } finally {
    await admin.end({ timeout: 5 });
  }

  const plan = await planMigrations();
  const runner = postgres(QUALITY_DB_URL, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    for (const file of plan.runnable) {
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await runner.unsafe(text);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error("migration " + file + " failed: " + detail);
      }
    }
  } finally {
    await runner.end({ timeout: 10 });
  }
  return plan.runnable;
}

/** Pooled client for the quality scratch database (via the real factory). */
export function connectQualityDb(): Sql {
  return createDb({
    url: QUALITY_DB_URL,
    max: 4,
    statementTimeoutMs: 30_000,
    applicationName: "collex-quality-tests",
  });
}

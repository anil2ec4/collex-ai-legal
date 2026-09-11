/**
 * /v1/health composition (W12 integration, contract [H]).
 *
 * The route stays FAST and never throws: the database probe (lane A's
 * `checkDatabase`, 3 s race) and the corpus count run in parallel under the
 * same budget, so the worst case is one timeout, not two. Without a `sql`
 * client the database is reported as `off` (an API-only or test instance),
 * which is different from `down` (configured but unreachable).
 *
 *   corpus.publicDocuments  legal.documents rows with scope = 'public'
 *   corpus.uploads          scope = 'tenant' AND source = 'UPLOAD' — the same
 *                           rows GET /v1/files lists (the fixture corpus'
 *                           own tenant-scoped dilekçe carries another source
 *                           and is not an upload)
 *   corpus                  null whenever the database is not `ok`
 */

import { join, resolve } from "node:path";
import type { Sql } from "../store/db.js";
import {
  checkDatabase,
  DEFAULT_HEALTH_TIMEOUT_MS,
  type DatabaseHealth,
  type MigrationHealth,
  type RlsHealth,
} from "../store/health.js";

export type HealthDbState = DatabaseHealth["db"] | "off";

export interface CorpusCounts {
  publicDocuments: number;
  uploads: number;
}

export interface DatabaseHealthReport {
  db: HealthDbState;
  dbName: string | null;
  migrations: MigrationHealth | null;
  corpus: CorpusCounts | null;
  /**
   * Additive (W14 B-05): row-security policy count. A complete database has
   * `present === expected`; fewer means a migration ran only half-way and the
   * lawyer's rows are not protected by a policy (ENGRISK E3). null when the
   * database is off/down.
   */
  rls: RlsHealth | null;
}

/**
 * The ONE originals directory, resolved to an absolute path (W14 M-SRV IR-1,
 * raised by C-UI as IR-1 and by C-FINAL §7(2)).
 *
 * WHY IT IS HERE AND NOT COMPUTED TWICE. `createApp` hands the same value to
 * `createFilesRouter` and `createMatterPackageRouter`; before W14 L-VERIFY
 * (V-4) those two computed it independently and "Aslını indir" answered 404
 * for every document on a `COLLEX_DATA_DIR` installation. `/v1/health` must
 * not become the third independent computation, so the fallback that used to
 * live inside each router — `<repoRoot>/var/uploads` — is applied HERE, once,
 * and the resolved string is what every consumer (both routers and this
 * report) receives.
 *
 * WHY IT IS ON /v1/health AT ALL. Settings › "Verilerim nerede?" could say
 * only WHERE the folder name is written (a launcher line), never the folder
 * itself. A lawyer looking for her own originals needs the path, and the path
 * is not a machine token: it is the answer to her question. It is absolute so
 * it can be pasted into Explorer as-is.
 */
export function resolveUploadsDir(options: {
  uploadsDir?: string | undefined;
  repoRoot: string;
}): string {
  const configured = options.uploadsDir?.trim();
  // A relative COLLEX_DATA_DIR resolves against the process cwd, exactly as
  // `intake/ingest.py` and `scripts/serve.mjs` resolve it.
  return configured !== undefined && configured !== ""
    ? resolve(configured)
    : resolve(join(options.repoRoot, "var", "uploads"));
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work.catch(() => undefined), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Bounded corpus count; undefined on any failure or timeout. */
export async function countCorpus(sql: Sql, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS): Promise<CorpusCounts | undefined> {
  const rows = await withTimeout(
    sql`
      select count(*) filter (where scope = 'public')::int as public_documents,
             count(*) filter (where scope = 'tenant' and source = 'UPLOAD')::int as uploads
      from legal.documents`,
    timeoutMs,
  );
  const row = rows?.[0];
  if (row === undefined) return undefined;
  const pub = row["public_documents"];
  const uploads = row["uploads"];
  return {
    publicDocuments: typeof pub === "number" ? pub : Number(pub ?? 0),
    uploads: typeof uploads === "number" ? uploads : Number(uploads ?? 0),
  };
}

/**
 * Database part of /v1/health. `sql` absent -> `db: 'off'`. Both probes run
 * concurrently within `timeoutMs`; nothing here rejects.
 */
export async function reportDatabaseHealth(
  sql: Sql | undefined,
  options: { timeoutMs?: number; dbName?: string } = {},
): Promise<DatabaseHealthReport> {
  const dbName = options.dbName ?? null;
  if (sql === undefined) return { db: "off", dbName, migrations: null, corpus: null, rls: null };
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const [health, corpus] = await Promise.all([
    checkDatabase(sql, { timeoutMs }).catch((): DatabaseHealth => ({ db: "down" })),
    countCorpus(sql, timeoutMs),
  ]);
  return {
    db: health.db,
    dbName: health.dbName ?? dbName,
    migrations: health.migrations ?? null,
    corpus: health.db === "ok" && corpus !== undefined ? corpus : null,
    rls: health.rls ?? null,
  };
}

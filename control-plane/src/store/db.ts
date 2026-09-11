/**
 * postgres.js client factory + typed row-mapping helpers for the ColleX
 * store layer.
 *
 * The DSN comes from the COLLEX_DB_URL environment variable unless a url is
 * passed explicitly (tests pass the scratch-database url directly). Pool and
 * timeout defaults are deliberately conservative: the retrieval lanes are
 * short, index-backed queries, so anything that runs long is a bug and gets
 * cut off server-side by statement_timeout instead of pinning a pooled
 * connection.
 *
 * The as* helpers are runtime-checked row mappers: postgres.js rows are
 * untyped at the driver boundary, and a silent shape drift (renamed column,
 * unexpected NULL) must fail loudly at the mapping site rather than surface
 * later as corrupt provenance.
 */

import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/** A single result row as handed back by postgres.js. */
export type SqlRow = Record<string, unknown>;

export interface DbOptions {
  /** Postgres DSN; defaults to the COLLEX_DB_URL environment variable. */
  url?: string;
  /** Max pooled connections (default 5). */
  max?: number;
  /** Seconds an idle pooled connection is kept open (default 30). */
  idleTimeoutS?: number;
  /** Seconds to wait when establishing a new connection (default 10). */
  connectTimeoutS?: number;
  /** Server-side statement timeout in milliseconds (default 15000). */
  statementTimeoutMs?: number;
  /** application_name reported to Postgres (default "collex-control-plane"). */
  applicationName?: string;
}

/** Resolve the store DSN from the environment; throws when unset. */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env["COLLEX_DB_URL"];
  if (url === undefined || url.trim() === "") {
    throw new Error(
      "COLLEX_DB_URL is not set; provide a Postgres DSN " +
        "(e.g. postgres://postgres@127.0.0.1:55432/collex)",
    );
  }
  return url;
}

/** Create a pooled postgres.js client for the store layer. */
export function createDb(options: DbOptions = {}): Sql {
  const url = options.url ?? resolveDatabaseUrl();
  return postgres(url, {
    max: options.max ?? 5,
    idle_timeout: options.idleTimeoutS ?? 30,
    connect_timeout: options.connectTimeoutS ?? 10,
    // NOTICE chatter (e.g. "extension already exists") is not an error.
    onnotice: () => undefined,
    connection: {
      application_name: options.applicationName ?? "collex-control-plane",
      statement_timeout: options.statementTimeoutMs ?? 15_000,
    },
  });
}

// --------------------------------------------------------------------------
// Typed row mappers
// --------------------------------------------------------------------------

function fail(column: string, expected: string, value: unknown): never {
  throw new TypeError(
    `row column "${column}": expected ${expected}, got ` +
      `${value === null ? "null" : typeof value}`,
  );
}

export function asText(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") fail(column, "text", value);
  return value;
}

export function asTextOrNull(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail(column, "text or null", value);
  return value;
}

export function asInt(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(column, "integer", value);
  }
  return value;
}

export function asIntOrNull(row: SqlRow, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return asInt(row, column);
}

export function asFloat(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(column, "finite float", value);
  }
  return value;
}

export function asTextArray(row: SqlRow, column: string): string[] {
  const value = row[column];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(column, "text[]", value);
  }
  return value as string[];
}

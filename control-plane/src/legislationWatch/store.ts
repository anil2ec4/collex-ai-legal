/**
 * Where a matter's legislation-watch baselines and last result live: ONE
 * jsonb document per matter under `app_private.settings`
 * (key `legislation-watch:<matterId>`), exactly the way contacts and saved
 * checklists are kept. No migration: the table, its RLS and its ledger
 * sentinel already exist (20260902120000_matters_persistence.sql), and the
 * key fits the table's 1..100 character check.
 *
 * The stored value is UNTRUSTED on the way back in (it is a jsonb column any
 * earlier version could have written): `normalizeWatchDocument` keeps only
 * well-formed baselines, and a malformed one is dropped — which re-records
 * it at the next check instead of comparing against garbage.
 */

import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID, assertUuid } from "../store/answerStore.js";
import type { ArticleBaseline, LawBaseline, WatchResult } from "./check.js";
import { LEGISLATION_WATCH_SCHEMA } from "./check.js";

export const WATCH_SETTINGS_KEY_PREFIX = "legislation-watch:";

export interface WatchDocument {
  schema: typeof LEGISLATION_WATCH_SCHEMA;
  matterId: string;
  baselines: Record<string, LawBaseline>;
  lastAsked: Record<string, string>;
  lastResult: WatchResult | null;
  updatedAt: string;
}

export interface LegislationWatchStore {
  load(matterId: string): Promise<WatchDocument | undefined>;
  save(doc: WatchDocument): Promise<void>;
  /** Every stored document (for the across-matters summary). */
  list(): Promise<WatchDocument[]>;
}

export function watchSettingsKey(matterId: string): string {
  return `${WATCH_SETTINGS_KEY_PREFIX}${matterId}`;
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeArticle(value: unknown): ArticleBaseline | undefined {
  const r = rec(value);
  if (r === undefined || typeof r["recordedAt"] !== "string") return undefined;
  const fp = r["fingerprint"];
  if (fp !== null && (typeof fp !== "string" || !/^[0-9a-f]{64}$/u.test(fp))) return undefined;
  return { fingerprint: fp as string | null, latestNoteDate: strOrNull(r["latestNoteDate"]), recordedAt: r["recordedAt"] };
}

function normalizeBaseline(lawKey: string, value: unknown): LawBaseline | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const fingerprint = r["fingerprint"];
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(fingerprint)) return undefined;
  if (typeof r["method"] !== "string" || typeof r["mevzuatId"] !== "string" || typeof r["recordedAt"] !== "string") {
    return undefined;
  }
  const articles: Record<string, ArticleBaseline> = {};
  const rawArticles = rec(r["articles"]) ?? {};
  for (const [key, entry] of Object.entries(rawArticles)) {
    const article = normalizeArticle(entry);
    if (article !== undefined) articles[key] = article;
  }
  return {
    lawKey,
    method: r["method"],
    mevzuatId: r["mevzuatId"],
    title: typeof r["title"] === "string" ? r["title"] : "",
    rgDate: strOrNull(r["rgDate"]),
    fingerprint,
    latestNoteDate: strOrNull(r["latestNoteDate"]),
    recordedAt: r["recordedAt"],
    articles,
  };
}

/** Narrow a stored value into a document; undefined when it is not one. */
export function normalizeWatchDocument(matterId: string, value: unknown): WatchDocument | undefined {
  const r = rec(value);
  if (r === undefined) return undefined;
  const baselines: Record<string, LawBaseline> = {};
  for (const [lawKey, entry] of Object.entries(rec(r["baselines"]) ?? {})) {
    const baseline = normalizeBaseline(lawKey, entry);
    if (baseline !== undefined) baselines[lawKey] = baseline;
  }
  const lastAsked: Record<string, string> = {};
  for (const [lawKey, at] of Object.entries(rec(r["lastAsked"]) ?? {})) {
    if (typeof at === "string") lastAsked[lawKey] = at;
  }
  const last = rec(r["lastResult"]);
  const lastResult =
    last !== undefined && last["schema"] === LEGISLATION_WATCH_SCHEMA && Array.isArray(last["rows"])
      ? (last as unknown as WatchResult)
      : null;
  return {
    schema: LEGISLATION_WATCH_SCHEMA,
    matterId,
    baselines,
    lastAsked,
    lastResult,
    updatedAt: typeof r["updatedAt"] === "string" ? r["updatedAt"] : "",
  };
}

export class InMemoryLegislationWatchStore implements LegislationWatchStore {
  private readonly docs = new Map<string, string>();

  async load(matterId: string): Promise<WatchDocument | undefined> {
    const raw = this.docs.get(matterId);
    return raw === undefined ? undefined : normalizeWatchDocument(matterId, JSON.parse(raw));
  }

  async save(doc: WatchDocument): Promise<void> {
    // Serialised like the jsonb column would be: no shared references.
    this.docs.set(doc.matterId, JSON.stringify(doc));
  }

  async list(): Promise<WatchDocument[]> {
    const out: WatchDocument[] = [];
    for (const [matterId, raw] of this.docs) {
      const doc = normalizeWatchDocument(matterId, JSON.parse(raw));
      if (doc !== undefined) out.push(doc);
    }
    return out;
  }
}

export class PgLegislationWatchStore implements LegislationWatchStore {
  private readonly sql: Sql;
  private readonly tenantId: string;

  constructor(options: { sql: Sql; tenantId?: string }) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
  }

  async load(matterId: string): Promise<WatchDocument | undefined> {
    const rows = await this.sql`
      select value from app_private.settings
      where tenant_id = ${this.tenantId} and key = ${watchSettingsKey(matterId)}`;
    const row = rows[0] as SqlRow | undefined;
    return row === undefined ? undefined : normalizeWatchDocument(matterId, row["value"]);
  }

  async save(doc: WatchDocument): Promise<void> {
    await this.sql`
      insert into app_private.settings (tenant_id, key, value, updated_at)
      values (${this.tenantId}, ${watchSettingsKey(doc.matterId)},
              ${this.sql.json(doc as never)}, now())
      on conflict (tenant_id, key) do update set
        value = excluded.value,
        updated_at = now()`;
  }

  async list(): Promise<WatchDocument[]> {
    // `starts_with` rather than LIKE: the prefix is a literal, never a pattern.
    const rows = await this.sql`
      select key, value from app_private.settings
      where tenant_id = ${this.tenantId}
        and starts_with(key, ${WATCH_SETTINGS_KEY_PREFIX})
      order by key`;
    const out: WatchDocument[] = [];
    for (const row of rows as SqlRow[]) {
      const matterId = String(row["key"]).slice(WATCH_SETTINGS_KEY_PREFIX.length);
      const doc = normalizeWatchDocument(matterId, row["value"]);
      if (doc !== undefined) out.push(doc);
    }
    return out;
  }
}

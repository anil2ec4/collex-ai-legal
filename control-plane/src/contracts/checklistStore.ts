/**
 * Durable contract checklists (W14 B-24, wired by L-FIX).
 *
 * B-24's acceptance is "the lawyer's checklist is SAVED and runs again on the
 * next contract". Phase A shipped `InMemoryChecklistStore`, which loses every
 * list when the server window closes — so the second contract had to be typed
 * from scratch and the item was, in effect, not delivered.
 *
 * WHY NO NEW TABLE. L-EVID's integration request 9.3 offered the choice and
 * named the cheap end: `app_private.settings` is already a
 * `(tenant_id, key) -> jsonb` store with RLS and a policy (migration
 * 20260902120000). A checklist is a small document keyed by the tenant, which
 * is exactly what that table is for, so this store writes ONE row under the
 * key `contractChecklists` and needs no DDL at all. Adding a table would have
 * meant a migration, a policy, an RLS count change and a health-report change
 * for data measured in kilobytes.
 *
 * The row is written whole on every `put`. Concurrency is not a concern here
 * (one lawyer, one window, ADR "single worker"), and a last-write-wins
 * document is easier to reason about than a partial merge.
 */

import { LOCAL_TENANT_ID, assertUuid } from "../store/answerStore.js";
import type { Sql, SqlRow } from "../store/db.js";
import type { Checklist } from "./clauseReview.js";
import type { ChecklistStore } from "./routes.js";

/** The `app_private.settings` key this store owns. */
export const CHECKLIST_SETTINGS_KEY = "contractChecklists";

/** Upper bound on what one tenant may store, so the row stays small. */
export const MAX_CHECKLISTS = 100;

export interface PgChecklistStoreOptions {
  sql: Sql;
  tenantId?: string;
}

/** Keep only the fields the review engine reads; drop anything else. */
function sanitize(value: unknown): Checklist | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = raw["id"];
  const title = raw["title"];
  const items = raw["items"];
  if (typeof id !== "string" || id === "" || typeof title !== "string") return undefined;
  if (!Array.isArray(items)) return undefined;
  const clean: Checklist["items"] = [];
  for (const entry of items) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const itemId = item["id"];
    const label = item["label"];
    const terms = item["terms"];
    if (typeof itemId !== "string" || itemId === "" || typeof label !== "string") continue;
    if (!Array.isArray(terms)) continue;
    const weak = item["weakTerms"];
    const note = item["note"];
    clean.push({
      id: itemId,
      label,
      terms: terms.filter((t): t is string => typeof t === "string"),
      ...(Array.isArray(weak)
        ? { weakTerms: weak.filter((t): t is string => typeof t === "string") }
        : {}),
      ...(typeof note === "string" ? { note } : {}),
    });
  }
  return { id, title, items: clean };
}

export class PgChecklistStore implements ChecklistStore {
  private readonly sql: Sql;
  private readonly tenantId: string;

  constructor(options: PgChecklistStoreOptions) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
  }

  private async readAll(): Promise<Map<string, Checklist>> {
    const rows = await this.sql`
      select value from app_private.settings
      where tenant_id = ${this.tenantId} and key = ${CHECKLIST_SETTINGS_KEY}`;
    const value = (rows[0] as SqlRow | undefined)?.["value"];
    const out = new Map<string, Checklist>();
    if (!Array.isArray(value)) return out;
    for (const entry of value) {
      const checklist = sanitize(entry);
      // A stored document is data we wrote, but it survives restarts and
      // upgrades: read it defensively rather than trusting its shape.
      if (checklist !== undefined) out.set(checklist.id, checklist);
    }
    return out;
  }

  private async writeAll(all: Map<string, Checklist>): Promise<void> {
    const document = [...all.values()].slice(0, MAX_CHECKLISTS);
    await this.sql`
      insert into app_private.settings (tenant_id, key, value, updated_at)
      values (${this.tenantId}, ${CHECKLIST_SETTINGS_KEY},
              ${this.sql.json(document as never)}, now())
      on conflict (tenant_id, key) do update set
        value = excluded.value,
        updated_at = now()`;
  }

  async list(): Promise<Checklist[]> {
    return [...(await this.readAll()).values()];
  }

  async get(id: string): Promise<Checklist | undefined> {
    return (await this.readAll()).get(id);
  }

  async put(checklist: Checklist): Promise<void> {
    const all = await this.readAll();
    if (!all.has(checklist.id) && all.size >= MAX_CHECKLISTS) {
      throw new Error(`checklist limit reached (${MAX_CHECKLISTS})`);
    }
    all.set(checklist.id, checklist);
    await this.writeAll(all);
  }
}

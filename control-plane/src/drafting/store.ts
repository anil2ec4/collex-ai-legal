/**
 * Draft store (W12 contract [P], DraftStore half).
 *
 * The HTTP layer only ever talks to `DraftStore`. This module owns the
 * interface and the bounded in-memory implementation; lane A implements
 * `PgDraftStore` (control-plane/src/store/draftStore.ts) against the same
 * interface, storing every `put()` as a new row (draft_id, version_no).
 *
 * Every `put()` is a NEW VERSION of the draft: `get()` returns the highest
 * version, `versions()` the full history, `list()` one summary per draft.
 * `warm()` is the persistent store's hook to load a draft that is not in
 * its cache before `get()` is consulted; the in-memory store has nothing to
 * warm and treats it as a no-op.
 *
 * Bounded like `InMemoryAnswerStore` and for the same reason: a draft embeds
 * evidence quotes, and an unbounded map keyed by client-created objects is a
 * memory-exhaustion vector.
 */

import type { Draft } from "./types.js";
import { shadowFold } from "../retrieval/normalize.js";

/** One row of GET /v1/drafts and GET /v1/drafts/{id}/versions. */
export interface DraftSummary {
  draftId: string;
  version: number;
  kind: string;
  template: string;
  title: string;
  matterId: string | null;
  createdAt: string;
  unsupportedCount: number;
}

export interface DraftStore {
  put(draft: Draft): void;
  get(draftId: string): Draft | undefined;
  warm?(draftId: string): Promise<void>;
  /** `q` (W14 B-29/B-26) filters on the draft TITLE; a store may ignore it. */
  list?(opts?: { matterId?: string; limit?: number; q?: string }): Promise<DraftSummary[]>;
  versions?(draftId: string): Promise<DraftSummary[]>;
  /**
   * Additive (W14 B-26): the stored BODY of one version; `undefined` when the
   * draft or the version does not exist. Implemented by both stores since
   * W14 L-FIX — see the note on `InMemoryDraftStore.getVersionBody`.
   */
  getVersionBody?(draftId: string, version: number): Promise<Record<string, unknown> | undefined>;
  /**
   * Additive (W14 B-26): drop every version of a draft; `false` = unknown id,
   * which is what makes a second DELETE answer 404.
   */
  remove?(draftId: string): Promise<boolean>;
  /**
   * Additive (W12-FIX, 02.09.2026): whether the LAST `put` of this draft
   * reached durable storage. A persistent store resolves it after the
   * background write settles; a memory store answers true. The HTTP routes
   * report a failed write in the response (`persisted:false` + a Turkish
   * warning) instead of a stderr line the lawyer never sees.
   */
  persisted?(draftId: string): Promise<boolean>;
  /**
   * Additive (W12-FIX): the matter is gone — null `matterId` on every
   * stored version and cached entry that pointed at it, so later versions
   * can still be written (the FK on app_private.drafts refused them).
   */
  detachMatter?(matterId: string): Promise<void>;
}

/** Summary row of one draft version (the shape every store returns). */
export function summarizeDraft(draft: Draft): DraftSummary {
  return {
    draftId: draft.draftId,
    version: typeof draft.version === "number" ? draft.version : 1,
    kind: draft.kind,
    template: draft.template,
    title: draft.title,
    matterId: draft.matterId ?? null,
    createdAt: draft.updatedAt ?? draft.createdAt,
    unsupportedCount: draft.unsupportedCount,
  };
}

export class InMemoryDraftStore implements DraftStore {
  /** draftId -> versions, ascending by `version`. Insertion order = LRU. */
  private readonly entries = new Map<string, Draft[]>();

  constructor(private readonly capacity: number = 64) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("draft store capacity must be a positive integer");
    }
  }

  put(draft: Draft): void {
    const existing = this.entries.get(draft.draftId) ?? [];
    this.entries.delete(draft.draftId);
    const version = typeof draft.version === "number" ? draft.version : 1;
    // A re-put of the same version replaces it; a new version is appended.
    const kept = existing.filter((d) => (d.version ?? 1) !== version);
    kept.push(draft);
    kept.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    this.entries.set(draft.draftId, kept);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get(draftId: string): Draft | undefined {
    const versions = this.entries.get(draftId);
    if (versions === undefined || versions.length === 0) return undefined;
    return versions[versions.length - 1];
  }

  async warm(_draftId: string): Promise<void> {
    // Nothing to load: every draft this store knows is already in memory.
  }

  async list(opts: { matterId?: string; limit?: number; q?: string } = {}): Promise<DraftSummary[]> {
    const limit = Number.isInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 50;
    // W14 L-FIX: the title filter `PgDraftStore.list` applies as
    // `title ilike '%q%'`, so `GET /v1/drafts?q=` answers in memory mode too.
    // `shadowFold` (retrieval/normalize.ts) is the repo's one Turkish-aware
    // case fold — it maps İ→i and I→ı explicitly, which a plain
    // toLowerCase() does not (U+0130 lowercases to i + U+0307 and then fails
    // a substring test). The Pg lane folds through the database collation
    // instead, so the two agree on every title except one containing a
    // dotted/dotless I, where this side matches MORE.
    const needle = typeof opts.q === "string" ? shadowFold(opts.q.trim()) : "";
    const rows: DraftSummary[] = [];
    for (const versions of this.entries.values()) {
      const latest = versions[versions.length - 1];
      if (latest === undefined) continue;
      if (opts.matterId !== undefined && (latest.matterId ?? null) !== opts.matterId) continue;
      if (needle !== "" && !shadowFold(latest.title ?? "").includes(needle)) continue;
      rows.push(summarizeDraft(latest));
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.slice(0, limit);
  }

  async versions(draftId: string): Promise<DraftSummary[]> {
    return (this.entries.get(draftId) ?? []).map(summarizeDraft);
  }

  /**
   * W14 L-FIX (B-26, defect (c)). The BODY of one stored version.
   *
   * This store already holds every version in `entries` — `versions()` has
   * always summarised them — so the memory mode answered a typed 501
   * ("eski sürümler yalnız kalıcı depoda saklanır") for a document it was
   * holding in RAM. That sentence was true of the STORE it described and
   * false of this one, which is worse than a missing feature: the lawyer
   * was told to go and find a database that would not have helped.
   *
   * Same contract as `PgDraftStore.getVersionBody`: `undefined` when the
   * draft or that version does not exist, so the route answers 404, and the
   * same input guards so a hostile id never reaches the map.
   */
  async getVersionBody(
    draftId: string,
    version: number,
  ): Promise<Record<string, unknown> | undefined> {
    if (typeof draftId !== "string" || draftId === "" || draftId.length > 200) return undefined;
    if (!Number.isInteger(version) || version < 1) return undefined;
    const found = (this.entries.get(draftId) ?? []).find((d) => (d.version ?? 1) === version);
    return found === undefined ? undefined : (found as unknown as Record<string, unknown>);
  }

  /**
   * W14 L-FIX (B-26, defect (c)). Drop EVERY version of a draft.
   *
   * Returns false when the id names nothing, which is what makes the second
   * DELETE answer 404 instead of a second 204 (the Pg store's contract).
   */
  async remove(draftId: string): Promise<boolean> {
    if (typeof draftId !== "string" || draftId === "" || draftId.length > 200) return false;
    return this.entries.delete(draftId);
  }

  async persisted(_draftId: string): Promise<boolean> {
    return true;
  }

  async detachMatter(matterId: string): Promise<void> {
    for (const [draftId, versions] of this.entries) {
      if (!versions.some((d) => d.matterId === matterId)) continue;
      this.entries.set(
        draftId,
        versions.map((d) => (d.matterId === matterId ? { ...d, matterId: null } : d)),
      );
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

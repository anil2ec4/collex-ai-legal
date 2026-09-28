/**
 * "Atıf yaptığım mevzuat değişti mi?" — HTTP surface.
 *
 *   GET  /v1/matters/{id}/legislation-watch   the cited laws/articles (read
 *        now from the matter's drafts, answers and uploads) + the last result.
 *        No upstream call.
 *   POST /v1/matters/{id}/legislation-watch   run one check: sequential
 *        `search_mevzuat` / `get_mevzuat_content` calls through the existing
 *        gateway, bounded by time, call count and law count; a bound that
 *        stops it answers 200 with `complete:false` and names the reason.
 *   GET  /v1/legislation-watch                the last result of every matter
 *        that has one (counts only; no upstream call).
 *
 * localGuard runs before every route (ADR-025), so a foreign page cannot start
 * a check. Without a provider gateway the POST answers a typed 503 and the GET
 * says `available:false` with the reason — the console draws the button
 * disabled with that sentence (the vaporware gate).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues, zodMessageTr } from "../api/zodIssues.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import { isUuid } from "../matters/store.js";
import type { MatterStore } from "../matters/types.js";
import {
  LEGISLATION_WATCH_SCHEMA,
  MAX_WATCH_LAWS,
  WATCH_NOTICES,
  runLegislationWatch,
  type WatchResult,
} from "./check.js";
import {
  collectMatterCitations,
  type WatchAnswerPort,
  type WatchDraftPort,
  type WatchFilePort,
} from "./collect.js";
import type { LegislationWatchStore, WatchDocument } from "./store.js";

export interface LegislationWatchRouterDeps {
  matters: MatterStore;
  store: LegislationWatchStore;
  /** The same gateway the sources lane uses; absent = the check is closed. */
  gateway?: ProviderGateway;
  drafts?: WatchDraftPort;
  answers?: WatchAnswerPort;
  files?: WatchFilePort;
  now?: () => Date;
  /** Budget clock (ms) — tests advance it. */
  clock?: () => number;
  /** Server-side bounds; each may only LOWER the module default. */
  limits?: { timeBudgetMs?: number; maxCalls?: number; callTimeoutMs?: number };
  log?: (line: string) => void;
}

export const WATCH_SOURCE_UNAVAILABLE_TR =
  "Resmî mevzuat kaynağına bağlantı bu sunucuda kurulmadı; kontrol çalıştırılamaz. " +
  "ColleX'i kaynak bağlantısıyla (masaüstündeki ColleX simgesiyle) yeniden başlatın.";
export const WATCH_RUNNING_TR =
  "Bu dosya için bir mevzuat kontrolü zaten sürüyor; bitmesini bekleyin.";
export const WATCH_NOT_PERSISTED_TR =
  "Kontrol tamamlandı ama sonucu ve karşılaştırma noktaları kaydedilemedi; bir sonraki kontrol bunları yeniden kaydeder.";

const watchRequestSchema = z
  .object({
    maxLaws: z.number().int().min(1).max(MAX_WATCH_LAWS).optional(),
    rebaseline: z.boolean().optional(),
  })
  .strict();

function notFound(c: Context): Response {
  return c.json({ error: { kind: "MATTER_NOT_FOUND", message: "Dava dosyası bulunamadı." } }, 404);
}

function storeUnavailable(c: Context): Response {
  return c.json(
    {
      error: {
        kind: "STORE_UNAVAILABLE",
        message: "Yerel veritabanına ulaşılamadı; mevzuat değişikliği kontrolü şu an açılamıyor.",
      },
    },
    503,
  );
}

function emptyDocument(matterId: string): WatchDocument {
  return {
    schema: LEGISLATION_WATCH_SCHEMA,
    matterId,
    baselines: {},
    lastAsked: {},
    lastResult: null,
    updatedAt: "",
  };
}

export function createLegislationWatchRouter(deps: LegislationWatchRouterDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const running = new Set<string>();
  const log = deps.log ?? ((line: string) => console.error(line));

  const collectFor = async (matterId: string) => {
    const items = await deps.matters.listItems(matterId);
    return collectMatterCitations(items, {
      ...(deps.drafts !== undefined ? { drafts: deps.drafts } : {}),
      ...(deps.answers !== undefined ? { answers: deps.answers } : {}),
      ...(deps.files !== undefined ? { files: deps.files } : {}),
    });
  };

  app.get("/v1/matters/:id/legislation-watch", async (c) => {
    const matterId = c.req.param("id");
    if (!isUuid(matterId)) return notFound(c);
    let doc: WatchDocument | undefined;
    let collected;
    try {
      if ((await deps.matters.get(matterId)) === undefined) return notFound(c);
      collected = await collectFor(matterId);
      doc = await deps.store.load(matterId);
    } catch {
      return storeUnavailable(c);
    }
    return c.json({
      matterId,
      available: deps.gateway !== undefined,
      unavailableReason: deps.gateway !== undefined ? null : WATCH_SOURCE_UNAVAILABLE_TR,
      running: running.has(matterId),
      citations: collected.citations,
      unreadSources: collected.unreadSources,
      sourcesRead: collected.sourcesRead,
      citationsTruncated: collected.truncated,
      baselineLaws: doc === undefined ? 0 : Object.keys(doc.baselines).length,
      lastResult: doc?.lastResult ?? null,
      notices: [...WATCH_NOTICES],
    });
  });

  app.post("/v1/matters/:id/legislation-watch", async (c) => {
    const matterId = c.req.param("id");
    if (!isUuid(matterId)) return notFound(c);

    let body: unknown = {};
    const raw = await c.req.text().catch(() => "");
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı.", issues: [] } }, 400);
      }
    }
    const parsed = watchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Kontrol isteği geçersiz.",
            issues: fieldIssues(parsed.error, zodMessageTr),
          },
        },
        400,
      );
    }

    let doc: WatchDocument;
    let collected;
    try {
      if ((await deps.matters.get(matterId)) === undefined) return notFound(c);
      if (deps.gateway === undefined) {
        return c.json({ error: { kind: "LEGISLATION_SOURCE_UNAVAILABLE", message: WATCH_SOURCE_UNAVAILABLE_TR } }, 503);
      }
      if (running.has(matterId)) {
        return c.json({ error: { kind: "WATCH_RUNNING", message: WATCH_RUNNING_TR } }, 409);
      }
      collected = await collectFor(matterId);
      doc = (await deps.store.load(matterId)) ?? emptyDocument(matterId);
    } catch {
      return storeUnavailable(c);
    }
    const gateway = deps.gateway;

    running.add(matterId);
    let result: WatchResult;
    let persisted = true;
    try {
      const output = await runLegislationWatch({
        matterId,
        collected,
        baselines: doc.baselines,
        lastAsked: doc.lastAsked,
        gateway,
        ...(parsed.data.rebaseline !== undefined ? { rebaseline: parsed.data.rebaseline } : {}),
        ...(parsed.data.maxLaws !== undefined ? { maxLaws: parsed.data.maxLaws } : {}),
        ...(deps.limits?.timeBudgetMs !== undefined ? { timeBudgetMs: deps.limits.timeBudgetMs } : {}),
        ...(deps.limits?.maxCalls !== undefined ? { maxCalls: deps.limits.maxCalls } : {}),
        ...(deps.limits?.callTimeoutMs !== undefined ? { callTimeoutMs: deps.limits.callTimeoutMs } : {}),
        now,
        ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
        // The lawyer's "Vazgeç" closes the request; the run stops between
        // calls and keeps what it already compared.
        ...(c.req.raw.signal !== undefined ? { signal: c.req.raw.signal } : {}),
      });
      result = output.result;
      try {
        await deps.store.save({
          schema: LEGISLATION_WATCH_SCHEMA,
          matterId,
          baselines: output.baselines,
          lastAsked: output.lastAsked,
          lastResult: result,
          updatedAt: result.checkedAt,
        });
      } catch {
        persisted = false;
        log(`[legislation-watch] matter ${matterId}: result not persisted (store write failed)`);
      }
    } finally {
      running.delete(matterId);
    }
    return c.json({ ...result, persisted, ...(persisted ? {} : { warnings: [WATCH_NOT_PERSISTED_TR] }) });
  });

  app.get("/v1/legislation-watch", async (c) => {
    let docs: WatchDocument[];
    const matters: Array<{
      matterId: string;
      title: string;
      checkedAt: string;
      complete: boolean;
      stopReason: string | null;
      counts: WatchResult["counts"];
    }> = [];
    try {
      docs = await deps.store.list();
      for (const doc of docs) {
        if (doc.lastResult === null) continue;
        const matter = await deps.matters.get(doc.matterId);
        // A deleted matter's document is left behind in settings; it is not
        // a matter the lawyer has, so it is not listed.
        if (matter === undefined) continue;
        matters.push({
          matterId: doc.matterId,
          title: matter.title,
          checkedAt: doc.lastResult.checkedAt,
          complete: doc.lastResult.complete,
          stopReason: doc.lastResult.stopReason,
          counts: doc.lastResult.counts,
        });
      }
    } catch {
      return storeUnavailable(c);
    }
    matters.sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : a.matterId < b.matterId ? -1 : 1));
    return c.json({ available: deps.gateway !== undefined, matters, notices: [...WATCH_NOTICES] });
  });

  return app;
}

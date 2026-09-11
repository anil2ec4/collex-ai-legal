/**
 * Record housekeeping — W14, B-26 ("sessizce yok sayma" biter).
 *
 *   DELETE /v1/answers/{runId}          204; second call 404
 *   DELETE /v1/drafts/{draftId}         204; second call 404
 *   GET    /v1/drafts/{id}/versions/{n} the BODY of one stored version
 *
 * Diagnosis (DAILYFLOW, 02.09.2026): asking the same question twice opened a
 * second row and nothing could ever remove it, so the research history was
 * permanently polluted; a draft's older version existed as a row but its text
 * could not be read back, so "sürüm var, geri dönüş yok".
 *
 * Deleting an answer or a draft also drops the matter item that referenced it
 * — the same discipline DELETE /v1/files must follow (B-26): a record is
 * never left pointing at something that is gone.
 *
 * Mounted by `createMattersRouter` (see the note there): this wave's file
 * ownership puts `src/api/server.ts` in another lane, and none of these three
 * paths is claimed by an existing handler.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AnswerStore } from "../api/answerService.js";
import type { MatterStore } from "./types.js";

/** What this router needs from the draft store (structural, no lane import). */
export interface DraftAdminPort {
  get?(draftId: string): unknown;
  warm?(draftId: string): Promise<void>;
  versions?(draftId: string): Promise<Array<{ draftId: string; version: number }>>;
  /** Additive (W14 B-26): the stored BODY of one version. */
  getVersionBody?(draftId: string, version: number): Promise<Record<string, unknown> | undefined>;
  /** Additive (W14 B-26): drop every version of a draft; false = unknown id. */
  remove?(draftId: string): Promise<boolean>;
}

/** Matter bookkeeping this router performs after a delete. */
export interface RecordsMatterPort {
  removeItemsByRef?(kind: "answer" | "draft" | "file", refId: string): Promise<number>;
}

export interface RecordsRouterDeps {
  answers?: AnswerStore & { remove?(runId: string): Promise<boolean> };
  drafts?: DraftAdminPort;
  store?: MatterStore & RecordsMatterPort;
}

const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,200}$/u;
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,200}$/u;

export const DELETE_UNSUPPORTED_MESSAGE_TR =
  "Bu sunucuda kayıt silme kapalı: kalıcı depo bağlı değil.";
export const VERSION_BODY_UNAVAILABLE_MESSAGE_TR =
  "Bu sürümün metni okunamıyor: eski sürümler yalnız kalıcı depoda saklanır.";

const notFound = (c: Context, message: string) =>
  c.json({ error: { kind: "NOT_FOUND", message } }, 404);

const storeUnavailable = (c: Context) =>
  c.json(
    {
      error: {
        kind: "STORE_UNAVAILABLE",
        message: "Yerel veritabanına ulaşılamadı; kayıt silinemedi.",
      },
    },
    503,
  );

export function createRecordsRouter(deps: RecordsRouterDeps): Hono {
  const app = new Hono();
  const { answers, drafts, store } = deps;

  /** Drop the matter item that pointed at a deleted record (best effort). */
  const detachItems = async (kind: "answer" | "draft", refId: string): Promise<void> => {
    if (store?.removeItemsByRef === undefined) return;
    try {
      await store.removeItemsByRef(kind, refId);
    } catch {
      // The record is already gone; bookkeeping on another table must not
      // turn a successful delete into an error.
    }
  };

  app.delete("/v1/answers/:runId", async (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID_RE.test(runId)) {
      return notFound(c, "Bu araştırma no ile kayıtlı cevap bulunamadı.");
    }
    if (answers === undefined || answers.remove === undefined) {
      return c.json({ error: { kind: "NOT_SUPPORTED", message: DELETE_UNSUPPORTED_MESSAGE_TR } }, 501);
    }
    let removed: boolean;
    try {
      removed = await answers.remove(runId);
    } catch {
      return storeUnavailable(c);
    }
    if (!removed) return notFound(c, "Bu araştırma no ile kayıtlı cevap bulunamadı.");
    await detachItems("answer", runId);
    return c.body(null, 204);
  });

  app.delete("/v1/drafts/:draftId", async (c) => {
    const draftId = c.req.param("draftId");
    if (!DRAFT_ID_RE.test(draftId)) return notFound(c, "Taslak bulunamadı.");
    if (drafts === undefined || drafts.remove === undefined) {
      return c.json({ error: { kind: "NOT_SUPPORTED", message: DELETE_UNSUPPORTED_MESSAGE_TR } }, 501);
    }
    let removed: boolean;
    try {
      removed = await drafts.remove(draftId);
    } catch {
      return storeUnavailable(c);
    }
    if (!removed) return notFound(c, "Taslak bulunamadı.");
    await detachItems("draft", draftId);
    return c.body(null, 204);
  });

  app.get("/v1/drafts/:draftId/versions/:version", async (c) => {
    const draftId = c.req.param("draftId");
    const versionRaw = c.req.param("version");
    if (!DRAFT_ID_RE.test(draftId)) return notFound(c, "Taslak bulunamadı.");
    if (!/^\d{1,6}$/u.test(versionRaw)) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Sürüm numarası 1 veya daha büyük bir tam sayı olmalı.",
          },
        },
        400,
      );
    }
    const version = Number(versionRaw);
    if (version < 1) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Sürüm numarası 1 veya daha büyük bir tam sayı olmalı.",
          },
        },
        400,
      );
    }
    if (drafts === undefined) return notFound(c, "Taslak bulunamadı.");
    try {
      if (drafts.getVersionBody !== undefined) {
        const body = await drafts.getVersionBody(draftId, version);
        if (body === undefined) return notFound(c, "Bu sürüm bulunamadı.");
        return c.json(body, 200);
      }
      // A store without version bodies (the in-memory fallback) can still
      // serve the version it holds; anything older is an honest 501, never a
      // silent empty document.
      await drafts.warm?.(draftId);
      const latest = drafts.get?.(draftId) as { version?: number } | undefined;
      if (latest === undefined) return notFound(c, "Taslak bulunamadı.");
      const latestVersion = typeof latest.version === "number" ? latest.version : 1;
      if (latestVersion === version) return c.json(latest as Record<string, unknown>, 200);
      return c.json(
        { error: { kind: "NOT_SUPPORTED", message: VERSION_BODY_UNAVAILABLE_MESSAGE_TR } },
        501,
      );
    } catch {
      return storeUnavailable(c);
    }
  });

  return app;
}

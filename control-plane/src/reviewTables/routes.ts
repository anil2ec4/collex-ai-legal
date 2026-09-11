/**
 * HTTP surface of the persisted review grid (W20).
 *
 *   POST /v1/review-tables                                   create + queue
 *   GET  /v1/review-tables?matterId=                         recent tables
 *   GET  /v1/review-tables/{tableId}                         definition + cells + progress
 *   POST /v1/review-tables/{tableId}/cells/{row}/{col}/retry retry ONE cell
 *   POST /v1/review-tables/{tableId}/cancel                  stop the rest
 *   GET  /v1/review-tables/{tableId}/export.csv              the grid as CSV
 *
 * Additive: no existing path changes. The console grid now creates a table
 * here and polls it instead of looping over /v1/answer in the browser, so a
 * closed tab or a restarted server no longer loses finished cells.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import { resolveMatterScope } from "../matters/scope.js";
import type { MatterStore } from "../matters/types.js";
import type { ColumnMode, PgReviewTableStore, ReviewCell } from "./store.js";

export const GRID_MAX_FILES = 50;
export const GRID_MAX_QUESTIONS = 10;

const questionSchema = z.union([
  z.string().trim().min(1).max(1000),
  z
    .object({
      text: z.string().trim().min(1).max(1000),
      mode: z.enum(["answer", "extract_dates", "extract_amounts", "extract_ratios"]).default("answer"),
    })
    .strict(),
]);

export const reviewTableRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    matterId: z.string().uuid().optional(),
    fileIds: z.array(z.string().min(1).max(200)).min(1).max(GRID_MAX_FILES),
    questions: z.array(questionSchema).min(1).max(GRID_MAX_QUESTIONS),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
    useLocalAi: z.boolean().optional(),
  })
  .strict();

export interface ReviewTableRouterDeps {
  readonly store: PgReviewTableStore;
  readonly matters: MatterStore;
  readonly worker?: { kick(): void } | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const MODE_TR: Readonly<Record<ColumnMode, string>> = {
  answer: "hedefli cevap",
  extract_dates: "belgenin tamamındaki tarihler",
  extract_amounts: "belgenin tamamındaki tutarlar",
  extract_ratios: "belgenin tamamındaki oranlar",
};

const SUPPORT_TR: Readonly<Record<string, string>> = {
  verified: "kaynağıyla doğrulandı",
  partially_verified: "kısmen doğrulandı",
  unverified: "doğrulanamadı",
  abstained: "karşılık bulunamadı",
  no_evidence: "kaynak bulunamadı",
  exhaustive_complete: "belgenin tamamı okundu",
  exhaustive_incomplete: "belge tam okunamadı",
};

function notFound(c: Context): Response {
  return c.json({ error: { kind: "TABLE_NOT_FOUND", message: "Bu inceleme tablosu bulunamadı." } }, 404);
}

/**
 * CSV field. Quoted, and a leading = + - @ (or tab/CR) is prefixed with an
 * apostrophe: a question or an extracted sentence must never become a
 * formula when the lawyer opens the file in a spreadsheet.
 */
export function csvField(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function createReviewTableRouter(deps: ReviewTableRouterDeps): Hono {
  const app = new Hono();

  app.post("/v1/review-tables", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek okunamadı." } }, 400);
    }
    const parsed = reviewTableRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Tablo isteği doğrulanamadı.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    const request = parsed.data;
    const fileIds = [...new Set(request.fileIds)];

    // Scope never widens: with a matter, every file must be a member.
    if (request.matterId !== undefined) {
      const scope = await resolveMatterScope(deps.matters, { matterId: request.matterId, fileIds });
      if (scope.kind === "MATTER_NOT_FOUND") {
        return c.json({ error: { kind: "MATTER_NOT_FOUND", message: "Bu dava dosyası bulunamadı." } }, 404);
      }
      if (scope.kind === "FILES_OUTSIDE_MATTER") {
        return c.json(
          {
            error: {
              kind: "FILES_OUTSIDE_MATTER",
              message: `Seçilen belgelerden bazıları bu dosyaya bağlı değil: ${scope.outside.join(", ")}.`,
            },
          },
          409,
        );
      }
      if (scope.kind === "STORE_UNAVAILABLE") {
        return c.json({ error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı." } }, 503);
      }
    }

    const uploads = await deps.store.currentUploads(fileIds);
    const missing = fileIds.filter((id) => !uploads.has(id));
    if (missing.length > 0) {
      return c.json(
        { error: { kind: "FILES_NOT_FOUND", message: `Bu belgeler bulunamadı: ${missing.join(", ")}.` } },
        409,
      );
    }

    const tableId = await deps.store.create({
      title: request.title ?? "İnceleme tablosu",
      matterId: request.matterId ?? null,
      options: {
        ...(request.asOf !== undefined ? { asOf: request.asOf } : {}),
        ...(request.useLocalAi === true ? { useLocalAi: true } : {}),
      },
      columns: request.questions.map((question) =>
        typeof question === "string" ? { question, mode: "answer" as const } : { question: question.text, mode: question.mode },
      ),
      rows: fileIds.map((fileId) => ({
        fileId,
        fileName: uploads.get(fileId)!.title,
        // Pinned: a later re-upload does not silently change what a finished
        // cell was answered from.
        documentVersionId: uploads.get(fileId)!.versionId,
      })),
    });
    deps.worker?.kick();
    return c.json({ tableId, status: "queued", progress: await deps.store.progress(tableId) }, 202);
  });

  app.get("/v1/review-tables", async (c) => {
    const matterId = c.req.query("matterId");
    if (matterId !== undefined && !UUID_RE.test(matterId)) {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "Dosya kimliği geçersiz." } }, 400);
    }
    return c.json({ tables: await deps.store.listTables(matterId ?? null) });
  });

  app.get("/v1/review-tables/:tableId", async (c) => {
    const tableId = c.req.param("tableId");
    if (!UUID_RE.test(tableId)) return notFound(c);
    const table = await deps.store.getTable(tableId);
    if (table === undefined) return notFound(c);
    return c.json({
      ...table,
      progress: await deps.store.progress(tableId),
      modesTr: MODE_TR,
      supportTr: SUPPORT_TR,
    });
  });

  app.post("/v1/review-tables/:tableId/cells/:rowNo/:columnNo/retry", async (c) => {
    const tableId = c.req.param("tableId");
    const rowNo = Number(c.req.param("rowNo"));
    const columnNo = Number(c.req.param("columnNo"));
    if (!UUID_RE.test(tableId) || !Number.isInteger(rowNo) || !Number.isInteger(columnNo) || rowNo < 1 || columnNo < 1) {
      return notFound(c);
    }
    const outcome = await deps.store.retryCell(tableId, rowNo, columnNo);
    if (outcome === "not_found") return notFound(c);
    if (outcome === "busy") {
      return c.json({ error: { kind: "CELL_BUSY", message: "Bu hücre şu an hesaplanıyor." } }, 409);
    }
    deps.worker?.kick();
    return c.json({ tableId, rowNo, columnNo, state: "pending" }, 202);
  });

  app.post("/v1/review-tables/:tableId/cancel", async (c) => {
    const tableId = c.req.param("tableId");
    if (!UUID_RE.test(tableId)) return notFound(c);
    if (!(await deps.store.requestCancel(tableId))) {
      const exists = await deps.store.getTable(tableId);
      if (exists === undefined) return notFound(c);
      return c.json({ error: { kind: "TABLE_NOT_ACTIVE", message: "Bu tablo zaten bitmiş." } }, 409);
    }
    deps.worker?.kick();
    return c.json({ tableId, status: "cancelling" }, 202);
  });

  app.get("/v1/review-tables/:tableId/export.csv", async (c) => {
    const tableId = c.req.param("tableId");
    if (!UUID_RE.test(tableId)) return notFound(c);
    const table = await deps.store.getTable(tableId);
    if (table === undefined) return notFound(c);
    const cells = new Map<string, ReviewCell>(table.cells.map((cell) => [`${cell.rowNo}:${cell.columnNo}`, cell]));
    const lines = [
      [
        "Belge", "Belge kimliği", "Belge sürümü", "Soru", "Yöntem", "Durum", "Cevap",
        "Destek", "Kaynak konumları", "Alıntı parmak izleri", "Kapsam", "Araştırma no",
      ],
    ];
    for (const row of table.rows) {
      for (const column of table.columns) {
        const cell = cells.get(`${row.rowNo}:${column.columnNo}`);
        const coverage = cell?.processingCoverage as { complete?: boolean } | null | undefined;
        lines.push([
          row.fileName ?? row.fileId,
          row.fileId,
          row.documentVersionId ?? "",
          column.question,
          MODE_TR[column.mode],
          cell === undefined ? "çalıştırılmadı" : cell.state === "done" ? cell.answerStatus ?? "" : cell.state,
          cell?.answerText ?? cell?.error ?? "",
          cell?.supportState === null || cell?.supportState === undefined ? "" : SUPPORT_TR[cell.supportState] ?? cell.supportState,
          (cell?.provenance ?? [])
            .map((entry) => `${entry.locator ?? ""}${entry.locator ? " " : ""}[${entry.startChar}-${entry.endChar}]`)
            .join(" | "),
          (cell?.provenance ?? []).map((entry) => entry.quoteSha256).join(" | "),
          coverage === null || coverage === undefined ? "" : coverage.complete === true ? "tam" : "eksik",
          cell?.answerRunId ?? "",
        ]);
      }
    }
    const csv = "﻿" + lines.map((line) => line.map(csvField).join(";")).join("\r\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="inceleme-tablosu-${tableId.slice(0, 8)}.csv"`,
      },
    });
  });

  return app;
}

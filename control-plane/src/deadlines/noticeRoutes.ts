/**
 * "Tebligattan süreye" HTTP end.
 *
 *   POST /v1/deadlines/from-notice
 *     { fileId } | { text }            exactly one — the served document
 *     candidateId?                     the lawyer's pick among dateCandidates
 *     tebligDate?  YYYY-MM-DD          or a date the lawyer typed (never both)
 *     ruleId?                          or a rule the lawyer chose
 *   -> 200 NoticeReading (serviceNotice.ts)
 *
 * READ-ONLY: this route never writes. Every proposal carries a ready
 * `matterItem`; the lawyer's confirm posts it to the existing
 * `POST /v1/matters/{id}/items:batch`, whose (kind, dueDate, title) dedupe
 * key suppresses a second confirm of the same deadline.
 *
 * Errors (Turkish message, English kind): 400 INVALID_REQUEST (fieldIssues:
 * every issue names its field), 400 RULE_NOT_COMPUTABLE, 404 FILE_NOT_FOUND,
 * 422 NOTICE_TEXT_EMPTY (the upload has no readable text), 503
 * STORE_UNAVAILABLE (no document store on this server, or it did not
 * answer). The 1 MiB JSON body limit of the app applies before this route.
 */

import { Hono } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import type { DraftFileChunk } from "../drafting/types.js";
import {
  MAX_NOTICE_TEXT_CODE_POINTS,
  NoticeInputError,
  readServiceNotice,
  textFromChunks,
  type NoticeChoice,
} from "./serviceNotice.js";

const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** Upload ids are the first 16 hex characters of the file's SHA-256. */
const NOTICE_FILE_ID_RE = /^[0-9a-f]{16}$/u;

export const NOTICE_STORE_UNAVAILABLE_MESSAGE =
  "Belge deposuna ulaşılamadı; yüklenmiş belgeden okunamıyor. Belgenin metnini yapıştırarak deneyebilir ya da ColleX'i yeniden başlatabilirsiniz.";
export const NOTICE_FILE_NOT_FOUND_MESSAGE = "Bu kimlikle yüklenmiş bir belge bulunamadı.";
export const NOTICE_TEXT_EMPTY_MESSAGE =
  "Belgede okunabilir metin yok (taranmış bir sayfa olabilir ve yazıya çevrilmemiş olabilir). Tebliğ tarihini ve süre kuralını elle girin.";

/** The document port this route needs: full chunk text of one upload. */
export interface NoticeFilePort {
  getChunks(fileIds: readonly string[], tenantId: string): Promise<DraftFileChunk[]>;
  existingFileIds?(fileIds: readonly string[], tenantId?: string): Promise<string[]>;
}

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

export const noticeRequestSchema = z
  .object(
    {
      fileId: z.string(REQ).min(1, "Belge kimliği boş olamaz.").max(64, "En fazla 64 karakter.").optional(),
      text: z
        .string(REQ)
        .refine((v) => v.trim() !== "", "Metin boş olamaz.")
        .refine(
          (v) => Array.from(v).length <= MAX_NOTICE_TEXT_CODE_POINTS,
          `Metin en fazla ${MAX_NOTICE_TEXT_CODE_POINTS} karakter olabilir; belgenin tebligatla ilgili sayfalarını gönderin.`,
        )
        .optional(),
      candidateId: z
        .string(REQ)
        .regex(/^t\d{1,4}$/u, "Tarih seçimi okumadaki bir tarihin kimliği olmalı (ör. t1).")
        .optional(),
      tebligDate: z
        .string(REQ)
        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Tarih YYYY-AA-GG biçiminde olmalı (ör. 2026-10-14).")
        .optional(),
      ruleId: z.string(REQ).min(1, "Kural kimliği boş olamaz.").max(100, "En fazla 100 karakter.").optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.")
  .superRefine((value, ctx) => {
    const hasFile = value.fileId !== undefined;
    const hasText = value.text !== undefined;
    if (hasFile === hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFile ? "text" : "fileId"],
        message: hasFile
          ? "Yüklenmiş belge ile yapıştırılmış metin birlikte gönderilemez; birini seçin."
          : "Yüklenmiş bir belge (fileId) ya da belgenin metni (text) gerekli.",
      });
    }
    if (value.candidateId !== undefined && value.tebligDate !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tebligDate"],
        message: "Belgedeki bir tarihi seçin ya da tarihi elle girin — ikisi birlikte gönderilemez.",
      });
    }
  });

export type NoticeRequest = z.infer<typeof noticeRequestSchema>;

function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

export interface NoticeRouterDeps {
  /** Upload reader; without it `{fileId}` answers 503 and `{text}` still works. */
  files?: NoticeFilePort;
}

export function createNoticeDeadlineRouter(deps: NoticeRouterDeps = {}): Hono {
  const app = new Hono();

  app.post("/v1/deadlines/from-notice", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İstek gövdesi geçerli bir istek biçiminde olmalı.",
            issues: [{ path: "body", message: "Gövde okunamadı." }],
          },
        },
        400,
      );
    }
    const parsed = noticeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Tebligat okuma isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error, turkishZodMessage),
          },
        },
        400,
      );
    }
    const request = parsed.data;

    let rawText: string;
    let source: Parameters<typeof readServiceNotice>[1];
    if (request.text !== undefined) {
      rawText = request.text;
      source = { source: "text" };
    } else {
      const fileId = request.fileId ?? "";
      if (!NOTICE_FILE_ID_RE.test(fileId)) {
        return c.json({ error: { kind: "FILE_NOT_FOUND", message: NOTICE_FILE_NOT_FOUND_MESSAGE } }, 404);
      }
      if (deps.files === undefined) {
        return c.json({ error: { kind: "STORE_UNAVAILABLE", message: NOTICE_STORE_UNAVAILABLE_MESSAGE } }, 503);
      }
      let chunks: DraftFileChunk[];
      let exists: boolean | undefined;
      try {
        chunks = (await deps.files.getChunks([fileId], LOCAL_TENANT_ID)).filter((ch) => ch.fileId === fileId);
        if (chunks.length === 0 && deps.files.existingFileIds !== undefined) {
          exists = (await deps.files.existingFileIds([fileId], LOCAL_TENANT_ID)).includes(fileId);
        }
      } catch {
        return c.json({ error: { kind: "STORE_UNAVAILABLE", message: NOTICE_STORE_UNAVAILABLE_MESSAGE } }, 503);
      }
      if (chunks.length === 0) {
        return exists === true
          ? c.json({ error: { kind: "NOTICE_TEXT_EMPTY", message: NOTICE_TEXT_EMPTY_MESSAGE } }, 422)
          : c.json({ error: { kind: "FILE_NOT_FOUND", message: NOTICE_FILE_NOT_FOUND_MESSAGE } }, 404);
      }
      const rebuilt = textFromChunks(chunks);
      if (rebuilt.text.trim() === "") {
        return c.json({ error: { kind: "NOTICE_TEXT_EMPTY", message: NOTICE_TEXT_EMPTY_MESSAGE } }, 422);
      }
      rawText = rebuilt.text;
      source = {
        source: "file",
        fileId,
        fileName: chunks[0]?.fileName ?? null,
        gapCodePoints: rebuilt.gapCodePoints,
      };
    }

    const choice: NoticeChoice = {
      ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
      ...(request.tebligDate !== undefined ? { tebligDate: request.tebligDate } : {}),
      ...(request.ruleId !== undefined ? { ruleId: request.ruleId } : {}),
    };
    try {
      return c.json(readServiceNotice(rawText, source, choice), 200);
    } catch (error) {
      if (error instanceof NoticeInputError) {
        return c.json(
          { error: { kind: error.kind, message: error.message, issues: [{ path: error.path, message: error.message }] } },
          400,
        );
      }
      throw error;
    }
  });

  return app;
}

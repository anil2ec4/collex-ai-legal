/**
 * Drafting HTTP sub-router (wire contract #3 of the 2026-08 wave; W12 lane C
 * additions marked):
 *
 *   POST /v1/drafts                       create an evidence-bound draft
 *   GET  /v1/drafts?matterId=&limit=      list drafts (W12)
 *   GET  /v1/drafts/{id}                  fetch the latest version
 *   PUT  /v1/drafts/{id}                  revise -> new version (W12)
 *   GET  /v1/drafts/{id}/versions         version history (W12)
 *   GET  /v1/drafts/{id}/export?format=   md (rendered here) | docx | udf (Python; udf = deneysel)
 *   POST /v1/drafts/{id}/import-docx      W22: verified Word round trip (docxImport.ts)
 *   GET  /v1/draft-templates              template registry (13 templates)
 *
 * Exported as `createDraftingRouter(deps)`; the API integration mounts it
 * onto the main server (this lane does NOT touch src/api/server.ts).
 *
 * DOCX/UDF export shells out to the repo venv's Python:
 *   python -X utf8 -m export.cli --draft <tmp.json> --out <tmp.docx|udf>
 *          --format dilekce-docx|dilekce-udf --quiet
 * via a dependency-injected runner (`deps.exec`), so tests assert the CLI
 * contract with a fake and never spawn a process. The default runner uses
 * `node:child_process.execFile` with an argument ARRAY and a 60 s timeout —
 * no shell is ever involved, so no draft content can inject into a command
 * line. The Python side re-verifies the draft's evidence closure and REFUSES
 * (exit 2) rather than writing an unverifiable document.
 */

import { Hono } from "hono";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  UNRECOGNIZED_FIELD_MESSAGE_TR,
  fieldIssues,
  unrecognizedFieldLabel,
} from "../api/zodIssues.js";
import { composeDraft, DraftValidationError } from "./composer.js";
import { resolveDraftEvidence } from "./evidence.js";
import { normalizeDraftRequestInput } from "./input.js";
import { renderDraftMarkdown } from "./markdown.js";
import { reviseDraft, type DraftPatch } from "./revise.js";
import {
  QUOTE_ALTERED,
  QUOTE_ALTERED_MESSAGE_TR,
  findAlteredQuotes,
} from "./quoteIntegrity.js";
import {
  LABEL_NIHAI,
  isFinalCopy,
  parseExportMode,
  type ExportMode,
} from "./exportMode.js";
import {
  PLACEHOLDER_UNFILLED,
  findUnfilledPlaceholders,
  placeholderRefusalMessage,
  withLivePlaceholders,
} from "./placeholders.js";
import { auditDraftCitations } from "../contracts/draftAudit.js";
import {
  defaultDraftDocxReadExec,
  registerDraftDocxImportRoute,
  type DraftDocxReadExec,
} from "./docxImport.js";
import { InMemoryDraftStore, type DraftStore } from "./store.js";
import { DRAFT_TEMPLATES, FIELD_GROUPS, labelForPath } from "./templates.js";
import type { Draft, DraftAnswerLookup, DraftRequest, DraftingFilePort } from "./types.js";
import {
  DRAFT_PERSIST_FAILED,
  DRAFT_PERSIST_FAILED_MESSAGE_TR,
  persistFailedWarning,
} from "../store/persistNotice.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** No registered media type exists for UYAP UDF; the file is a zip container. */
const UDF_MIME = "application/octet-stream";

/** Exporter-process timeout (W12): a hung Python must not hold the request. */
export const EXPORT_TIMEOUT_MS = 60_000;

/** The experimental-format note, verbatim on every udf surface. */
export const UDF_EXPERIMENTAL_NOTE = "deneysel — UYAP Doküman Editörü'nde açarak doğrulayın";

/**
 * Draft ids are `dft-<uuid>` (composer); the export route accepts nothing
 * that could not be one — validated BEFORE the store is consulted and long
 * before a process is spawned (W12-FIX2, P2-14). The temp files handed to
 * the exporter carry fixed names, never the id.
 */
export const DRAFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;

/** Client-facing detail of an exporter crash: a correlation id, never stderr. */
export function exportFailureDetail(correlationId: string): string {
  return `Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`;
}

/**
 * Human export file name (W12-FIX2, P2-5): "<Belge> - <Dosya> - v<N>.<ext>",
 * ASCII-safe for the `filename=` parameter (Turkish letters transliterated,
 * everything else but letters, digits, space, dot, dash and underscore
 * dropped). The UTF-8 original travels in `filename*`.
 */
export function exportFileName(
  draft: { title?: string; template: string; version?: number; draftId: string },
  ext: "md" | "docx" | "udf",
  matterTitle?: string,
  mode?: ExportMode,
): { ascii: string; utf8: string } {
  const version = typeof draft.version === "number" ? draft.version : 1;
  const parts = [draft.title !== undefined && draft.title.trim() !== "" ? draft.title.trim() : draft.template];
  if (matterTitle !== undefined && matterTitle.trim() !== "") parts.push(matterTitle.trim());
  parts.push(`v${version}`);
  // W14 · B-02: the clean filing copy and the audit copy must never be
  // confused on disk — "… - v2 - NİHAİ.docx" vs "… - v2 - TASLAK.docx".
  // Omitted for the default mode so existing names do not change.
  if (mode !== undefined && isFinalCopy(mode)) parts.push(LABEL_NIHAI);
  const clean = (value: string): string =>
    value.replace(/[\u0000-\u001f"\\/:*?<>|]+/gu, " ").replace(/\s+/gu, " ").trim();
  const utf8 = `${parts.map(clean).join(" - ")}.${ext}`;
  const ascii = `${parts
    .map((part) => asciiSafe(clean(part)))
    .filter((part) => part !== "")
    .join(" - ")}.${ext}`;
  return { ascii: ascii === `.${ext}` ? `${draft.draftId}.${ext}` : ascii.slice(0, 120), utf8 };
}

/**
 * W14 · B-13: "<Belge> - <Dosya> - v<N> - Atıf Denetim Raporu.docx".
 * The report is about the draft, so it carries the draft's identity.
 */
export function auditFileName(
  draft: { title?: string; template: string; version?: number; draftId: string },
  matterTitle?: string,
): { ascii: string; utf8: string } {
  const base = exportFileName(draft, "docx", matterTitle);
  return {
    ascii: base.ascii.replace(/\.docx$/u, " - Atif Denetim Raporu.docx"),
    utf8: base.utf8.replace(/\.docx$/u, " - Atıf Denetim Raporu.docx"),
  };
}

const TR_ASCII: Readonly<Record<string, string>> = Object.freeze({
  ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U", â: "a", Â: "A", î: "i", Î: "I", û: "u", Û: "U",
});

/** Turkish letters transliterated; anything non-ASCII-safe dropped. */
export function asciiSafe(value: string): string {
  return Array.from(value)
    .map((point) => TR_ASCII[point] ?? point)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9 ._-]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * RFC 8187 `value-chars` for an ext-value: every octet outside `attr-char`
 * percent-encoded. `encodeURIComponent` leaves `'`, `(`, `)` and `*`
 * unescaped, and none of them is an attr-char — "Dilekçe (v2).docx" produced
 * a `filename*` a strict parser rejects (27.09.2026). `!` is an attr-char and
 * may stay.
 */
export function encodeRfc8187(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (ch) => `%${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/** RFC 6266 Content-Disposition with an ASCII filename and a UTF-8 filename*. */
export function contentDisposition(name: { ascii: string; utf8: string }): string {
  return `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeRfc8187(name.utf8)}`;
}

// ---------------------------------------------------------------------------
// Request schema (wire contract #3 + W12 HMK m.119 fields)
// ---------------------------------------------------------------------------

/** zod messages are user-facing (contract C): Turkish, never "Required". */
const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

const vekilSchema = z
  .object({
    ad: z.string(REQ).min(1, "Vekil adı boş bırakılamaz.").max(200, "En fazla 200 karakter."),
    baro: z.string(REQ).max(100, "En fazla 100 karakter.").optional(),
    sicilNo: z.string(REQ).max(40, "En fazla 40 karakter.").optional(),
    adres: z.string(REQ).max(500, "En fazla 500 karakter.").optional(),
  })
  .strict("Tanınmayan alan.");

const partySchema = z
  .object({
    ad: z.string(REQ).min(1, "Ad boş bırakılamaz.").max(300, "En fazla 300 karakter."),
    rol: z.string(REQ).min(1, "Rol boş bırakılamaz.").max(100, "En fazla 100 karakter."),
    tckn: z
      .string(REQ)
      .regex(/^\d{11}$/u, "T.C. kimlik numarası 11 rakamdan oluşmalıdır.")
      .optional(),
    vkn: z.string(REQ).regex(/^\d{10}$/u, "Vergi kimlik numarası 10 rakamdan oluşmalıdır.").optional(),
    adres: z.string(REQ).max(500, "En fazla 500 karakter.").optional(),
    vekil: vekilSchema.optional(),
  })
  .strict("Tanınmayan alan.");

const eventSchema = z
  .object({
    tarih: z.string(REQ).max(40, "En fazla 40 karakter.").optional(),
    metin: z
      .string(REQ)
      .min(1, "Olay metni boş bırakılamaz.")
      .max(4000, "En fazla 4.000 karakter."),
  })
  .strict();

const dateInput = z
  .string(REQ)
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})$/u, "Tarih GG.AA.YYYY veya YYYY-AA-GG biçiminde olmalı.");

const arabuluculukSchema = z
  .object({
    yapildi: z.boolean({ required_error: "Arabuluculuk yapıldı mı? (evet/hayır)", invalid_type_error: "evet/hayır seçin." }),
    tarih: dateInput.optional(),
    sonuc: z.string(REQ).max(300, "En fazla 300 karakter.").optional(),
  })
  .strict("Tanınmayan alan.");

const matterSchema = z
  .object(
    {
      baslik: z.string(REQ).max(300, "En fazla 300 karakter.").optional(),
      mahkeme: z.string(REQ).max(200, "En fazla 200 karakter.").optional(),
      esasNo: z.string(REQ).max(60, "En fazla 60 karakter.").optional(),
      davaDegeri: z.string(REQ).max(100, "En fazla 100 karakter.").optional(),
      arabuluculuk: arabuluculukSchema.optional(),
      vekil: vekilSchema.optional(),
      matterId: z.string(REQ).max(200, "En fazla 200 karakter.").nullable().optional(),
      tarih: dateInput.optional(),
      taraflar: z
        .array(partySchema, { required_error: "En az bir taraf (ad ve rol) girin." })
        .max(20, "En fazla 20 taraf."),
      olaylar: z
        .array(eventSchema, { required_error: "En az bir olay girin." })
        .max(100, "En fazla 100 olay."),
      talepler: z
        .array(
          z.string(REQ).min(1, "Talep boş bırakılamaz.").max(2000, "En fazla 2.000 karakter."),
          { required_error: "En az bir talep girin." },
        )
        .max(50, "En fazla 50 talep."),
      ekBilgiler: z.record(z.unknown()).optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

const evidenceSchema = z
  .object({
    runId: z.string(REQ).min(1, "Araştırma no boş olamaz.").max(200).optional(),
    fileIds: z
      .array(z.string(REQ).min(1, "Dosya kimliği boş olamaz.").max(200))
      .max(20, "En fazla 20 dosya.")
      .optional(),
  })
  .strict("Tanınmayan alan.");

export const draftRequestSchema = z
  .object(
    {
      kind: z.enum(["dilekce", "sozlesme"], {
        required_error: "Belge türü zorunludur.",
        invalid_type_error: "Belge türü 'dilekce' veya 'sozlesme' olmalı.",
      }),
      template: z.string(REQ).min(1, "Şablon seçin.").max(100),
      matter: matterSchema,
      evidence: evidenceSchema.optional(),
      instructions: z.string(REQ).max(4000, "En fazla 4.000 karakter.").optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

// ---- PUT /v1/drafts/{id} body (W12 contract [D]) ----------------------------

const bindingSchema = z.union([
  z.literal("lexical"),
  z
    .object({
      kind: z.literal("entailment"),
      score: z.number(REQ).min(0, "Skor 0-1 aralığında olmalı.").max(1, "Skor 0-1 aralığında olmalı."),
      judge: z.string(REQ).min(1, "Yargıç adı boş olamaz.").max(100),
    })
    .strict("Tanınmayan alan."),
]);

const patchParagraphSchema = z
  .object({
    id: z.string(REQ).max(200, "En fazla 200 karakter.").optional(),
    text: z.string(REQ).max(20_000, "En fazla 20.000 karakter."),
    evidenceIds: z.array(z.string(REQ).min(1).max(200)).max(50, "En fazla 50 kanıt.").optional(),
    role: z.string(REQ).max(40).optional(),
    binding: bindingSchema.optional(),
  })
  .strict("Tanınmayan alan.");

const patchSectionSchema = z
  .object({
    id: z.string(REQ).min(1, "Bölüm kimliği boş olamaz.").max(100),
    paragraphs: z.array(patchParagraphSchema).max(400, "En fazla 400 paragraf."),
  })
  .strict("Tanınmayan alan.");

/** Additive (W14 · B-36): one review box as a client may send it. */
const reviewMarkSchema = z
  .object({
    checked: z.boolean({ required_error: "İşaret durumu evet/hayır olmalı.", invalid_type_error: "evet/hayır seçin." }),
    by: z.string(REQ).max(200, "En fazla 200 karakter.").optional(),
    note: z.string(REQ).max(2000, "En fazla 2.000 karakter.").optional(),
  })
  .strict("Tanınmayan alan.");

export const draftPatchSchema = z
  .object(
    {
      sections: z.array(patchSectionSchema, { required_error: "Bölüm listesi zorunludur." }).max(40, "En fazla 40 bölüm."),
      evidenceUse: z.record(z.boolean()).optional(),
      note: z.string(REQ).max(2000, "En fazla 2.000 karakter.").optional(),
      /** Additive (W14 · B-36): the three pre-filing boxes. */
      reviewChecklist: z.record(reviewMarkSchema).optional(),
      /** Additive (W14 · B-36): per-evidence review state. */
      evidenceReview: z.record(reviewMarkSchema).optional(),
      /** Additive (W12-FIX): the version the client edited; 409 when it moved on. */
      baseVersion: z.number(REQ).int("Sürüm tam sayı olmalı.").min(1, "Sürüm 1 veya daha büyük olmalı.").optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

// ---------------------------------------------------------------------------
// Exporter-process dependency
// ---------------------------------------------------------------------------

export interface DraftDocxExecRequest {
  pythonPath: string;
  args: string[];
  cwd: string;
  /** Additive (W12): kill the child after this many ms (default 60 s). */
  timeoutMs?: number;
}

export interface DraftDocxExecResult {
  code: number;
  stderr: string;
}

export type DraftDocxExec = (request: DraftDocxExecRequest) => Promise<DraftDocxExecResult>;

/** Repo root, derived from this module's location (control-plane/src/drafting). */
function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** ALWAYS the repo venv interpreter — never a bare `python` (CLAUDE.md). */
function defaultPythonPath(repoRoot: string): string {
  return process.platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
}

/** Real runner: execFile + argument array — shell-free by construction. */
/** Shared shell-free Python exporter runner for drafting and contract reports. */
export const defaultDraftDocxExec: DraftDocxExec = ({ pythonPath, args, cwd, timeoutMs }) =>
  new Promise((resolvePromise) => {
    try {
      execFile(
        pythonPath,
        args,
        {
          cwd,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          timeout: timeoutMs ?? EXPORT_TIMEOUT_MS,
        },
        (error, _stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof (error as { code?: unknown }).code === "number"
                ? (error as unknown as { code: number }).code
                : 1;
          const killed = error !== null && (error as { killed?: boolean }).killed === true;
          resolvePromise({
            code,
            stderr: killed ? `zaman aşımı (${timeoutMs ?? EXPORT_TIMEOUT_MS} ms)\n${stderr ?? ""}` : (stderr ?? ""),
          });
        },
      );
    } catch (error) {
      // `execFile` can throw synchronously when Windows refuses to spawn a
      // child (for example EPERM under a locked-down desktop policy). Keep
      // the route's typed EXPORT_FAILED contract instead of leaking a 500.
      const code = error as { code?: unknown; message?: unknown };
      resolvePromise({
        code: 1,
        stderr: `dışa aktarıcı başlatılamadı: ${String(code.message ?? code.code ?? "bilinmeyen hata")}`,
      });
    }
  });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface DraftingDependencies {
  /** Draft persistence; defaults to a bounded in-memory store. */
  store?: DraftStore;
  /** Lookup for `evidence.runId` (the API's InMemoryAnswerStore fits). */
  answers?: DraftAnswerLookup;
  /** Port for `evidence.fileIds` (implemented by the upload lane). */
  files?: DraftingFilePort;
  /** DOCX/UDF exporter-process runner; injected as a fake in tests. */
  exec?: DraftDocxExec;
  pythonPath?: string;
  repoRoot?: string;
  now?: () => Date;
  /** Server-log sink for exporter stderr (default process.stderr); tests inject. */
  log?: (line: string) => void;
  /**
   * Additive (W12-FIX2): the matter's title for export file names and the
   * document meta ("Dosya: Yılmaz / Kira tahliye" instead of a UUID). The
   * API integration passes the matter store's lookup.
   */
  matterTitle?: (matterId: string) => Promise<string | undefined>;
  /** Additive (W22): the Word read-back runner of the import route; tests inject. */
  docxRead?: DraftDocxReadExec;
}

/** W14 · B-13: the Atıf Denetim Raporu format, additive on the enum. */
export const AUDIT_FORMAT = "denetim-docx";

type ExportFormat = "md" | "docx" | "udf" | typeof AUDIT_FORMAT;

export function createDraftingRouter(deps: DraftingDependencies = {}): Hono {
  const app = new Hono();
  const store = deps.store ?? new InMemoryDraftStore();
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const pythonPath = deps.pythonPath ?? defaultPythonPath(repoRoot);
  const runExporter = deps.exec ?? defaultDraftDocxExec;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const matterTitleOf = async (draft: Draft): Promise<string | undefined> => {
    if (deps.matterTitle === undefined || typeof draft.matterId !== "string" || draft.matterId === "") return undefined;
    try {
      return await deps.matterTitle(draft.matterId);
    } catch {
      return undefined; // a cold matter store costs the nice name, nothing else
    }
  };

  app.get("/v1/draft-templates", (c) =>
    c.json({
      templates: DRAFT_TEMPLATES.map((template) => ({
        id: template.id,
        kind: template.kind,
        // Additive (W12-FIX2): the template's field of law (relevance gate).
        domain: template.domain,
        title: template.title,
        description: template.description,
        requiredFields: template.requiredFields,
        // Additive (contract B/W12): human-labeled, typed input fields.
        fields: template.fields.map((field) => ({ ...field })),
      })),
      // Additive (W12): fieldset order for form builders.
      fieldGroups: Object.values(FIELD_GROUPS),
    }),
  );

  /** Residual zod default messages, translated (contract C: Türkçe). */
  const turkishZodMessage = (message: string): string => {
    if (message === "Required") return "Bu alan zorunludur.";
    if (message === "Invalid input") return "Geçersiz değer.";
    if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
    if (message.startsWith("Invalid literal value")) return "Geçersiz seçim.";
    if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
    if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
    return message;
  };

  /** {path,label,message} issues with human labels (contract C). */
  const labeledIssues = (
    issues: readonly { path: string; label?: string; message: string }[],
    templateId: string | undefined,
  ) =>
    issues.map((issue) => {
      const message = turkishZodMessage(issue.message);
      // V-19: an unrecognized key belongs to no template field, so
      // `labelForPath` falls through and echoes the bare key. Both halves
      // used to be EMPTY (zod reports the key at the parent's path); the key
      // now names the path, and the label says in Turkish what it is.
      const label =
        issue.label ??
        (message === UNRECOGNIZED_FIELD_MESSAGE_TR && issue.path !== ""
          ? unrecognizedFieldLabel(issue.path)
          : labelForPath(issue.path, templateId));
      return { path: issue.path, label, message };
    });

  const readJson = async (c: { req: { json(): Promise<unknown> } }): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  const invalidJson = { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } };

  /**
   * W12-FIX: the response says whether the version reached the database.
   * `persisted:true` is additive on every store; a failed write adds ONE
   * Turkish warning (under its machine code in machineWarnings) — never a
   * silent 200 with "kaydedildi".
   */
  const withPersistOutcome = async (draft: Draft): Promise<Record<string, unknown>> => {
    const ok = store.persisted === undefined ? true : await store.persisted(draft.draftId);
    if (ok) return { ...draft, persisted: true };
    return {
      ...draft,
      persisted: false,
      warnings: [...draft.warnings, DRAFT_PERSIST_FAILED_MESSAGE_TR],
      machineWarnings: [
        ...(draft.machineWarnings ?? []),
        persistFailedWarning(DRAFT_PERSIST_FAILED, DRAFT_PERSIST_FAILED_MESSAGE_TR),
      ],
    };
  };

  app.post("/v1/drafts", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const body = normalizeDraftRequestInput(read.body);
    const templateId =
      typeof (body as { template?: unknown } | null)?.template === "string"
        ? ((body as { template: string }).template)
        : undefined;
    const parsed = draftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Taslak isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: labeledIssues(fieldIssues(parsed.error), templateId),
          },
        },
        400,
      );
    }
    const request = parsed.data as DraftRequest;

    const resolved = await resolveDraftEvidence(request.evidence, {
      ...(deps.answers !== undefined ? { answers: deps.answers } : {}),
      ...(deps.files !== undefined ? { files: deps.files } : {}),
      now,
    });
    if (resolved.issues.length > 0) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Taslak kanıtı çözümlenemedi — seçilen araştırma/dosyalar bulunamadı.",
            issues: labeledIssues(resolved.issues, request.template),
          },
        },
        400,
      );
    }

    let draft;
    try {
      draft = composeDraft(request, resolved.pack, { now });
    } catch (error) {
      if (error instanceof DraftValidationError) {
        return c.json(
          {
            error: {
              kind: "INVALID_REQUEST",
              message: error.message,
              issues: labeledIssues(error.issues, request.template),
            },
          },
          400,
        );
      }
      throw error;
    }
    draft.warnings.push(...resolved.warnings);
    if (resolved.machineWarnings.length > 0) {
      draft.machineWarnings = [...(draft.machineWarnings ?? []), ...resolved.machineWarnings];
    }

    store.put(draft);
    return c.json(await withPersistOutcome(draft), 200);
  });

  // W12: list (latest version per draft).
  //
  // W14 L-FIX (L-MATTER integration request 7): `?q=` reaches the store. Both
  // stores have filtered on the draft title since W14 phase A; only the route
  // was dropping the parameter, so "Dilekçelerim" searched nothing and
  // answered with the unfiltered list — a silent wrong answer, which is the
  // failure mode B-26 exists to end. An unrecognised query parameter is now a
  // typed 400 rather than a silently ignored filter, for the same reason.
  const DRAFT_LIST_PARAMS = new Set(["matterId", "limit", "q"]);
  app.get("/v1/drafts", async (c) => {
    const unknown = [...new URL(c.req.url).searchParams.keys()].filter(
      (name) => !DRAFT_LIST_PARAMS.has(name),
    );
    if (unknown.length > 0) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message:
              `Tanınmayan sorgu parametresi: ${unknown.join(", ")}.` +
              " Kullanılabilir olanlar: matterId, limit, q.",
          },
        },
        400,
      );
    }
    const matterId = c.req.query("matterId");
    const q = c.req.query("q");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
    if (limitRaw !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500)) {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "limit 1 ile 500 arasında bir tam sayı olmalı." } },
        400,
      );
    }
    if (q !== undefined && q.length > 200) {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "Arama metni en fazla 200 karakter olabilir." } },
        400,
      );
    }
    const drafts =
      store.list === undefined
        ? []
        : await store.list({
            ...(matterId !== undefined && matterId !== "" ? { matterId } : {}),
            ...(limit !== undefined ? { limit } : {}),
            ...(q !== undefined && q.trim() !== "" ? { q: q.trim() } : {}),
          });
    return c.json({ drafts }, 200);
  });

  app.get("/v1/drafts/:id", async (c) => {
    const id = c.req.param("id");
    await store.warm?.(id);
    const draft = store.get(id);
    if (draft === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    return c.json(draft, 200);
  });

  // W12: revise -> new version. trustEntailment is ALWAYS false over HTTP.
  app.put("/v1/drafts/:id", async (c) => {
    const id = c.req.param("id");
    await store.warm?.(id);
    if (store.get(id) === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    // W12-FIX: the stored draft is read AFTER the body has been received, so
    // no other request can land a version between this read and the put
    // below (the section is synchronous from here to `store.put`).
    const draft = store.get(id);
    if (draft === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    const parsed = draftPatchSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Düzenleme isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: labeledIssues(fieldIssues(parsed.error), draft.template),
          },
        },
        400,
      );
    }
    // Optimistic concurrency (W12-FIX): a client that says which version it
    // edited is refused when the draft has moved on — two tabs, or a console
    // save racing the AI paragraph writer, used to overwrite each other with
    // two 200s. Clients that send no baseVersion keep the old behaviour.
    const { baseVersion, ...patch } = parsed.data;
    const currentVersion = typeof draft.version === "number" ? draft.version : 1;
    if (baseVersion !== undefined && baseVersion !== currentVersion) {
      return c.json(
        {
          error: {
            kind: "VERSION_CONFLICT",
            message:
              `Taslak siz düzenlerken değişti (sürüm ${currentVersion}, sizin sürümünüz ${baseVersion}).` +
              " Yeniden yükleyip düzenlemenizi yeni sürüm üzerine uygulayın.",
            currentVersion,
            baseVersion,
          },
        },
        409,
      );
    }
    let result;
    try {
      result = reviseDraft(draft, patch as DraftPatch, { trustEntailment: false, now });
    } catch (error) {
      if (error instanceof DraftValidationError) {
        return c.json(
          {
            error: {
              kind: "INVALID_REQUEST",
              message: error.message,
              issues: labeledIssues(error.issues, draft.template),
            },
          },
          400,
        );
      }
      throw error;
    }
    store.put(result.draft);
    // Additive: the soft issues ride along with the saved draft.
    return c.json({ ...(await withPersistOutcome(result.draft)), issues: result.issues }, 200);
  });

  app.get("/v1/drafts/:id/versions", async (c) => {
    const id = c.req.param("id");
    await store.warm?.(id);
    if (store.get(id) === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    const versions = store.versions === undefined ? [] : await store.versions(id);
    return c.json({ versions }, 200);
  });

  app.get("/v1/drafts/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!DRAFT_ID_RE.test(id)) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    await store.warm?.(id);
    const draft = store.get(id);
    if (draft === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    const format = c.req.query("format");
    if (
      format !== "docx" &&
      format !== "md" &&
      format !== "udf" &&
      format !== AUDIT_FORMAT
    ) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message:
              "Dışa aktarma biçimi 'docx', 'md', 'udf' veya 'denetim-docx'" +
              " (Atıf Denetim Raporu) olmalı (format parametresi)." +
              ` udf: ${UDF_EXPERIMENTAL_NOTE}.`,
          },
        },
        400,
      );
    }

    // W14 · B-02: two ADDITIVE switches; omitted = today's behaviour.
    const parsedMode = parseExportMode(c.req.query("annex"), c.req.query("marks"));
    if (!parsedMode.ok) {
      return c.json({ error: { kind: "INVALID_REQUEST", message: parsedMode.message } }, 400);
    }
    const mode = parsedMode.mode;

    // W14 · B-01: the quote-integrity gate runs BEFORE any format is
    // produced. Markdown is rendered here in TypeScript and never reached
    // the Python verification, so a draft whose quoted passage had been
    // edited came out as a 200 with a fabricated "Dayanak [K-n]" next to it
    // (W13-UXAUDIT P0-1). DOCX/UDF are refused again by
    // `export/draft.py::verify_draft_or_refuse` — the two checks are
    // deliberately redundant and share one canonical form.
    const altered = findAlteredQuotes(draft);
    if (altered.length > 0) {
      const correlationId = randomUUID();
      log(
        `[collex] EXPORT_REFUSED id=${correlationId} draftId=${draft.draftId} format=${format}` +
          ` reason=${QUOTE_ALTERED} paragraphs=${JSON.stringify(altered.map((f) => f.paragraphId))}`,
      );
      return c.json(
        {
          error: {
            kind: "EXPORT_REFUSED",
            message:
              `Dışa aktarma REDDEDİLDİ: ${QUOTE_ALTERED_MESSAGE_TR} (${QUOTE_ALTERED}).` +
              " Aşağıdaki paragraflar atıf yaptıkları alıntıyı artık birebir içermiyor;" +
              " dosya yazılmadı.",
            code: QUOTE_ALTERED,
            paragraphs: altered.map((finding) => ({
              paragraphId: finding.paragraphId,
              sectionId: finding.sectionId,
              ref: finding.ref,
            })),
            detail: exportFailureDetail(correlationId),
            correlationId,
          },
        },
        409,
      );
    }

    // 27.09.2026: the NİHAİ (filing) copy may not carry a system placeholder
    // ("[Kararın özeti — doldurun]", "[DAVANIN GÖRÜLDÜĞÜ] MAHKEMESİ'NE") or a
    // KAYNAKSIZ stub addressed to the lawyer. Refused BEFORE any format is
    // produced, like the quote-integrity gate above; the Python exporter
    // applies the identical test to the tokens written into its JSON
    // (`export/draft.py::refuse_unfilled_placeholders`). The TASLAK copies are
    // untouched: they print the placeholders, visibly.
    if (isFinalCopy(mode) && format !== AUDIT_FORMAT) {
      const open = findUnfilledPlaceholders(draft);
      if (open.length > 0) {
        const correlationId = randomUUID();
        log(
          `[collex] EXPORT_REFUSED id=${correlationId} draftId=${draft.draftId} format=${format}` +
            ` reason=${PLACEHOLDER_UNFILLED} paragraphs=${JSON.stringify(open.map((f) => f.paragraphId))}`,
        );
        return c.json(
          {
            error: {
              kind: "EXPORT_REFUSED",
              message: placeholderRefusalMessage(open),
              code: PLACEHOLDER_UNFILLED,
              placeholders: open.map((finding) => ({
                paragraphId: finding.paragraphId,
                sectionId: finding.sectionId,
                text: finding.text,
              })),
              detail: exportFailureDetail(correlationId),
              correlationId,
            },
          },
          409,
        );
      }
    }

    const matterTitle = await matterTitleOf(draft);
    if (format === "md") {
      const markdown = renderDraftMarkdown(draft, {
        ...(matterTitle !== undefined ? { matterTitle } : {}),
        mode,
      });
      return c.body(markdown, 200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": contentDisposition(exportFileName(draft, "md", matterTitle, mode)),
      });
    }

    // DOCX / UDF / denetim raporu: hand the JSON to the Python exporter and
    // stream the file back.
    const fmt: ExportFormat = format;
    const audit = fmt === AUDIT_FORMAT;
    const workDir = await mkdtemp(join(tmpdir(), "collex-draft-"));
    const jsonPath = join(workDir, audit ? "audit.json" : "draft.json");
    const outPath = join(workDir, audit ? "denetim.docx" : `draft.${fmt}`);
    const experimental: Record<string, string> =
      fmt === "udf" ? { "x-collex-experimental": "udf" } : {};
    try {
      if (audit) {
        // W14 · B-13: our own draft needs no resolver — every citation in it
        // is already a hashed evidence entry, so the report is a
        // re-verification (plus B-36's review record), not a lookup.
        await writeFile(
          jsonPath,
          JSON.stringify(
            auditDraftCitations(draft, {
              ...(matterTitle !== undefined ? { matterTitle } : {}),
              now,
            }),
          ),
          "utf8",
        );
      } else {
        // `matterTitle` is additive on the wire JSON; the Python parser reads
        // it for the "Dosya" meta row and ignores it otherwise. Every
        // paragraph's `placeholders` is normalized to its UNFILLED set (legacy
        // drafts included), so the exporter's NİHAİ gate decides on exactly
        // the tokens the check above decided on.
        const wire = withLivePlaceholders(draft);
        await writeFile(
          jsonPath,
          JSON.stringify(matterTitle !== undefined ? { ...wire, matterTitle } : wire),
          "utf8",
        );
      }
      const result = await runExporter({
        pythonPath,
        args: audit
          ? ["-X", "utf8", "-m", "export.cli", "--audit", jsonPath, "--out", outPath, "--format", AUDIT_FORMAT, "--quiet"]
          : [
          "-X",
          "utf8",
          "-m",
          "export.cli",
          "--draft",
          jsonPath,
          "--out",
          outPath,
          "--format",
          fmt === "udf" ? "dilekce-udf" : "dilekce-docx",
          // W14 · B-02: additive; the CLI defaults match these values.
          "--annex",
          mode.annex,
          "--marks",
          mode.marks,
          "--quiet",
        ],
        cwd: repoRoot,
        timeoutMs: EXPORT_TIMEOUT_MS,
      });
      if (result.code !== 0) {
        // Exit 2 is the exporter REFUSING an unverifiable draft — that is a
        // server-side integrity failure, never the client's fault. Either
        // way the child's stderr stays in the server log (P2-14).
        const label = fmt === "udf" ? "UDF" : audit ? "Atıf Denetim Raporu" : "DOCX";
        const correlationId = randomUUID();
        log(
          `[collex] ${result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED"} id=${correlationId} draftId=${draft.draftId}` +
            ` format=${fmt} code=${result.code} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
        );
        return c.json(
          {
            error: {
              kind: result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED",
              message:
                result.code === 2
                  ? `${label} dışa aktarıcı taslağı REDDETTİ: kanıt bütünlüğü doğrulanamadı;` +
                    " dosya yazılmadı."
                  : `${label} dışa aktarıcı beklenmedik biçimde sonlandı; dosya üretilmedi.`,
              detail: exportFailureDetail(correlationId),
              correlationId,
              ...(fmt === "udf" ? { note: UDF_EXPERIMENTAL_NOTE } : {}),
            },
          },
          500,
          experimental,
        );
      }
      const bytes = await readFile(outPath);
      return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
        "content-type": fmt === "udf" ? UDF_MIME : DOCX_MIME,
        "content-disposition": contentDisposition(
          audit
            ? auditFileName(draft, matterTitle)
            : exportFileName(draft, fmt as "md" | "docx" | "udf", matterTitle, mode),
        ),
        ...experimental,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // W22 "Word'de düzelttim, geri yükle": the verified DOCX round trip. Every
  // save goes through `reviseDraft`, exactly like PUT above.
  registerDraftDocxImportRoute(app, {
    store,
    exec: deps.docxRead ?? defaultDraftDocxReadExec,
    pythonPath,
    repoRoot,
    now,
    log,
    draftIdPattern: DRAFT_ID_RE,
    withPersistOutcome,
  });

  return app;
}

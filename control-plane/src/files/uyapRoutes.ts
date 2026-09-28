/**
 * "UYAP'tan indirdiğim klasörü dosyalarıma dağıt" (W22) — HTTP end.
 *
 *   POST /v1/files/uyap-preview   multipart (one .zip, or the documents of a
 *                                 folder as repeated `file` fields) or JSON
 *                                 `{dir}` (a folder on THIS computer)
 *                                 → per document: court, esas, karar, type,
 *                                   date (each with its quoted span), sha256,
 *                                   duplicate check, matter match, proposal.
 *                                 NOTHING is ingested.
 *   POST /v1/files/uyap-import    `{previewId, rows:[{path, action, …}]}` —
 *                                 only the rows the lawyer confirmed are
 *                                 ingested, one by one, through THE single
 *                                 intake path, and filed under the matter.
 *
 * Competitors sell a browser extension that logs into UYAP as the lawyer.
 * This does not: the lawyer downloads, ColleX reads the download on this
 * computer. No credential, no network.
 *
 * Invariants this file keeps:
 *
 *  - ONE intake path. The preview runs `intake.cli --uyap-scan`, which reads
 *    and never writes. The import runs `intakeFileArgs` — the exact argument
 *    vector `POST /v1/files` uses — once per confirmed document, so
 *    quarantine, extraction, OCR, the page cap and `process_file` are the
 *    ones a single upload meets.
 *  - The preview decides nothing the lawyer did not confirm. A row is filed
 *    only with an explicit `assign` (named matter) or `new` (prefilled matter
 *    the lawyer accepted); `ambiguous` and `no_esas` rows are never assigned
 *    by the server.
 *  - Duplicates are decided by sha256 over the ORIGINAL bytes — the digest
 *    `process_file` records — and never re-ingested; the reason is on the row.
 *  - Matter scope never widens (ADR-030): a document is linked only to the
 *    matter its row names, through the same `MatterLinker` every upload uses.
 *  - A path is never taken from the import request: rows name a path the
 *    PREVIEW produced, and the server resolves it inside the preview's root.
 *  - The bytes are re-hashed before ingest and the intake's own sha256 is
 *    compared after: a document that changed since the preview is refused
 *    and never linked.
 */

import type { Context, Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  MATTER_LINK_FAILED_MESSAGE_TR,
  MATTER_NOT_FOUND_MESSAGE_TR,
  MATTER_STORE_UNAVAILABLE_MESSAGE_TR,
  type MatterLinker,
} from "../api/matterLink.js";
import { fieldIssues, zodMessageTr } from "../api/zodIssues.js";
import type { MatterStore } from "../matters/types.js";
import { invalidateLexicalStats } from "../store/chunkStore.js";
import {
  classifyStoreError,
  intakeFileArgs,
  isCliError,
  parseCliJson,
  safeUploadName,
  type IntakeExec,
  type IntakeExecResult,
} from "./routes.js";
import type { FilesReadStore } from "./store.js";
import {
  courtKey,
  esasKey,
  importSummarySentence,
  matchReading,
  type MatterRef,
  type UyapImportCounts,
  type UyapMatch,
  type UyapReading,
  type UyapScan,
  type UyapScanDocument,
} from "./uyapMatch.js";

/** Mirrors `intake/cli.py` BATCH_MAX_FILES (a test parses the Python line). */
export const UYAP_MAX_FILES = 200;

/**
 * Wall budget of ONE preview process. The scan reads every document of the
 * download (OCR off) in one process; 200 PDFs at pypdf speed do not fit the
 * 180 s single-upload budget, and a cut preview is worth nothing.
 */
export const UYAP_SCAN_TIMEOUT_MS = 600_000;

/** How long a preview can be confirmed. */
export const UYAP_PREVIEW_TTL_MS = 30 * 60_000;

/** Previews held at once (oldest dropped first, with its staged files). */
export const UYAP_MAX_PREVIEWS = 8;

/** Same cap as a single upload (`intake/quarantine.py` UPLOAD_CAP_MIB). */
const UPLOAD_CAP_BYTES = 25 * 1024 * 1024;

export const UYAP_MESSAGES_TR = {
  notConfigured: "Belge deposu bu sunucuda yapılandırılmamış.",
  needInput:
    "Önizleme için bir klasör yolu ({dir}), bir .zip arşivi ya da klasörün belgeleri ('file' alanları) gönderin.",
  zipAlone: "ZIP arşivini tek başına gönderin; yanına başka dosya eklemeyin.",
  zipTooBig: "Arşiv 25 MB sınırını aşıyor; arşivi bilgisayarınızda açıp klasör olarak verin.",
  tooMany: `Tek seferde en fazla ${UYAP_MAX_FILES} belge önizlenebilir; klasörü bölün.`,
  dirNotAbsolute: "Klasör yolu tam yol olmalı (örneğin C:\\Users\\...\\UYAP ya da /Users/.../UYAP).",
  scanTimeout:
    "Klasörün okunması 10 dakikayı aştı; klasörü birkaç parçaya bölüp yeniden deneyin.",
  duplicatesUnknown:
    "Yüklü belgeler okunamadığı için aynı belgenin zaten yüklü olup olmadığı denetlenemedi; önizleme yapılmadı.",
  previewNotFound:
    "Önizleme bulunamadı ya da süresi doldu (30 dakika); klasörü yeniden önizleyin.",
  importBusy: "Bu önizleme şu anda aktarılıyor; bitmesini bekleyin.",
  unknownRow: "Bu belge önizlemede yok.",
  changed: "Belge önizlemeden sonra değişmiş ya da silinmiş; klasörü yeniden önizleyin.",
  notImportable: "Bu belge güvenlik denetiminden geçmedi; aktarılamaz.",
  matterCreateFailed: "Yeni dava dosyası açılamadı; belge aktarılmadı.",
  added: (title: string) => `“${title}” dosyasına eklendi.`,
  duplicateLinked: (title: string) =>
    `Bu belge zaten yüklüydü; yeniden yüklenmedi, “${title}” dosyasına bağlandı.`,
  duplicateSkipped: "Bu belge zaten yüklüydü; atlandı.",
  unmatchedSkipped: "Eşleşen dosya bulunmadı; atlandı.",
  skipped: "Sizin seçiminizle atlandı.",
  scanFailedFor: "Belgenin yazısı okunamadı (taranmış olabilir); yalnız dosya adına bakıldı. Aktarımda, bu bilgisayarda yazı tanıma kuruluysa yeniden denenir.",
} as const;

// ---------------------------------------------------------------------------
// Router context
// ---------------------------------------------------------------------------

export interface UyapMatterDeps {
  matters: MatterStore;
  linker: MatterLinker;
  /** Where uploaded .zip / folder documents are staged (default os.tmpdir()). */
  stagingRoot?: string;
  now?: () => Date;
}

export interface UyapContext extends UyapMatterDeps {
  dsn: string;
  runIntake: IntakeExec;
  pythonPath: string;
  repoRoot: string;
  log: (line: string) => void;
  getStore: () => Promise<FilesReadStore>;
  cliFailure: (
    c: Context,
    result: IntakeExecResult,
    parsed: Record<string, unknown> | undefined,
  ) => Response;
  configured: boolean;
}

// ---------------------------------------------------------------------------
// Preview rows
// ---------------------------------------------------------------------------

export type UyapAction = "assign" | "skip" | "new";

export interface UyapDuplicate {
  fileId: string;
  name: string;
  matterId: string | null;
  matterTitle: string | null;
}

export interface UyapPreviewRow {
  path: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  kind: string | null;
  /** The document's text was read (false: only its name was). */
  readable: boolean;
  error: { kind: string; message: string } | null;
  warnings: string[];
  reading: UyapReading;
  match: UyapMatch;
  /** Already uploaded (same sha256). */
  duplicate: UyapDuplicate | null;
  /** The same bytes appear earlier in this download (that row's path). */
  duplicateInBatchOf: string | null;
  /** False when the quarantine refused the file: it can never be imported. */
  importable: boolean;
  proposedAction: UyapAction;
  /** Turkish notes the row shows (conflict, name-only reading, duplicate). */
  notes: string[];
}

interface PreviewEntry {
  id: string;
  createdAt: number;
  expiresAt: number;
  root: string;
  stagingDir: string | null;
  order: string[];
  rows: Map<string, UyapPreviewRow>;
  importing: boolean;
}

function isFileLike(value: unknown): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string"
  );
}

/**
 * A browser folder upload names each file by its relative path
 * ("UYAP/ekler/rapor.pdf"). Keep the folders, drop everything that could
 * climb out of the staging directory or that a file system cannot store.
 */
export function safeRelativeUploadPath(raw: string): string {
  const parts = raw
    .replace(/\\/gu, "/")
    .split("/")
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/gu, "_").trim())
    .filter((part) => part !== "" && !/^\.+$/u.test(part))
    .map((part) => (part.length > 120 ? part.slice(-120) : part));
  if (parts.length === 0) return "yukleme.bin";
  return parts.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function sha256Of(path: string): Promise<string | undefined> {
  return await new Promise((resolvePromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", () => resolvePromise(undefined));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function isScan(value: unknown): value is UyapScan {
  if (value === null || typeof value !== "object") return false;
  const scan = value as Record<string, unknown>;
  return typeof scan["root"] === "string" && Array.isArray(scan["documents"]) && Array.isArray(scan["skipped"]);
}

export function buildPreviewRows(
  documents: readonly UyapScanDocument[],
  matters: readonly MatterRef[],
  existing: ReadonlyMap<string, UyapDuplicate>,
): UyapPreviewRow[] {
  const firstPathBySha = new Map<string, string>();
  return documents.map((doc) => {
    const duplicate = existing.get(doc.sha256) ?? null;
    const firstPath = firstPathBySha.get(doc.sha256);
    if (firstPath === undefined) firstPathBySha.set(doc.sha256, doc.path);
    const match = matchReading(doc.reading, matters);
    // An extraction failure (a scan without OCR here) may still be read at
    // import time; a quarantine refusal never will be.
    const importable = doc.error === null || doc.error.kind === "EXTRACTION_FAILED";
    const proposedAction: UyapAction =
      !importable || duplicate !== null || firstPath !== undefined
        ? "skip"
        : match.status === "matched"
          ? "assign"
          : match.status === "unmatched"
            ? "new"
            : "skip";
    const notes: string[] = [];
    const reading = doc.reading;
    if (reading.esasConflict && reading.esas !== null && reading.filename.esas !== null) {
      notes.push(
        `Dosya adındaki esas numarası (${reading.filename.esas.value}) ile belgenin içindeki` +
          ` (${reading.esas.value}) farklı; belgenin içindeki esas numarası kullanıldı.`,
      );
    } else if (reading.esas !== null && reading.esas.source === "filename") {
      notes.push("Esas numarası belgenin içinde bulunamadı; dosya adından okundu.");
    }
    if (doc.error !== null && importable) notes.push(UYAP_MESSAGES_TR.scanFailedFor);
    if (doc.error !== null && !importable) notes.push(`${doc.error.message} (${doc.error.kind})`);
    if (duplicate !== null) {
      notes.push(
        `Bu belge zaten yüklü (${duplicate.name})` +
          (duplicate.matterTitle !== null ? `, “${duplicate.matterTitle}” dosyasında.` : "."),
      );
    }
    if (firstPath !== undefined) notes.push(`Aynı belge bu klasörde bir kez daha var: ${firstPath}.`);
    return {
      path: doc.path,
      name: doc.name,
      sizeBytes: doc.sizeBytes,
      sha256: doc.sha256,
      kind: doc.kind,
      readable: reading.textRead,
      error: doc.error,
      warnings: doc.warnings,
      reading,
      match,
      duplicate,
      duplicateInBatchOf: firstPath ?? null,
      importable,
      proposedAction,
      notes,
    };
  });
}

// ---------------------------------------------------------------------------
// Import request
// ---------------------------------------------------------------------------

const newMatterSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    court: z.string().trim().max(200),
    docketNo: z.string().trim().max(100),
  })
  .strict();

export const uyapImportSchema = z
  .object({
    previewId: z.string().uuid(),
    rows: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1024),
            action: z.enum(["assign", "skip", "new"]),
            matterId: z.string().uuid().optional(),
            newMatter: newMatterSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(UYAP_MAX_FILES),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.rows.forEach((row, index) => {
      if (seen.has(row.path)) {
        ctx.addIssue({ code: "custom", path: ["rows", index, "path"], message: "Bu belge listede iki kez var." });
      }
      seen.add(row.path);
      if (row.action === "assign" && row.matterId === undefined) {
        ctx.addIssue({ code: "custom", path: ["rows", index, "matterId"], message: "Eklenecek dava dosyasını seçin." });
      }
      if (row.action === "new" && row.newMatter === undefined) {
        ctx.addIssue({ code: "custom", path: ["rows", index, "newMatter"], message: "Açılacak dosyanın bilgilerini gönderin." });
      }
      if (row.action !== "assign" && row.matterId !== undefined) {
        ctx.addIssue({ code: "custom", path: ["rows", index, "matterId"], message: "Dava dosyası yalnız “ekle” seçiminde verilir." });
      }
      if (row.action !== "new" && row.newMatter !== undefined) {
        ctx.addIssue({ code: "custom", path: ["rows", index, "newMatter"], message: "Yeni dosya bilgisi yalnız “yeni dosya aç” seçiminde verilir." });
      }
    });
  });

export type UyapImportRequest = z.infer<typeof uyapImportSchema>;

export type UyapOutcome = "added" | "duplicate" | "unmatched" | "skipped" | "failed";

export interface UyapImportRow {
  path: string;
  name: string;
  outcome: UyapOutcome;
  fileId: string | null;
  matterId: string | null;
  matterTitle: string | null;
  reason: string;
  error: { kind: string; message: string; correlationId?: string } | null;
  warnings: string[];
}

const previewDirSchema = z.object({ dir: z.string().trim().min(1).max(1024) }).strict();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function mountUyapRoutes(app: Hono, ctx: UyapContext): void {
  const previews = new Map<string, PreviewEntry>();
  const now = (): number => (ctx.now ?? (() => new Date()))().getTime();
  const stagingRoot = ctx.stagingRoot ?? tmpdir();

  const drop = (entry: PreviewEntry): void => {
    previews.delete(entry.id);
    if (entry.stagingDir !== null) void rm(entry.stagingDir, { recursive: true, force: true });
  };
  const sweep = (): void => {
    const at = now();
    for (const entry of [...previews.values()]) {
      if (entry.expiresAt <= at && !entry.importing) drop(entry);
    }
    while (previews.size >= UYAP_MAX_PREVIEWS) {
      const oldest = [...previews.values()].filter((e) => !e.importing).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest === undefined) break;
      drop(oldest);
    }
  };

  const invalid = (c: Context, message: string, issues?: Array<{ path: string; message: string }>): Response =>
    c.json({ error: { kind: "INVALID_REQUEST", message, ...(issues !== undefined ? { issues } : {}) } }, 400);

  const storeDown = (c: Context, error: unknown): Response => {
    const kind = classifyStoreError(error);
    return c.json(
      {
        error: {
          kind: "STORE_UNAVAILABLE",
          message: UYAP_MESSAGES_TR.duplicatesUnknown,
          ...(kind === "other" ? { detail: "dosya deposu sorgusu başarısız oldu" } : {}),
        },
      },
      503,
    );
  };

  /**
   * sha256 → the stored upload carrying it (with one matter, if linked), for
   * exactly the digests asked about.
   *
   * `listFiles` is ONE page (MAX_FILE_PAGE rows): a duplicate check built on
   * it would silently miss every older upload. The upload id IS the first 16
   * hex characters of the sha256 (`intake/ingest.py`), so the exact question
   * is "do these ids exist", and the full digest is then compared against
   * the stored one — a 64-bit prefix is never taken for the whole digest.
   * A store without that lookup (a test fake, an older store) is walked page
   * by page to the end instead.
   */
  const knownUploads = async (digests: readonly string[]): Promise<Map<string, UyapDuplicate>> => {
    const store = await ctx.getStore();
    const wanted = new Map<string, string>();
    for (const sha of digests) wanted.set(sha.slice(0, 16), sha);
    const byId = new Map<string, UyapDuplicate>();
    const bySha = new Map<string, UyapDuplicate>();
    const keep = (fileId: string, sha: string, name: string): void => {
      if (wanted.get(fileId) !== sha) return;
      const dup: UyapDuplicate = { fileId, name, matterId: null, matterTitle: null };
      bySha.set(sha, dup);
      byId.set(fileId, dup);
    };
    if (wanted.size === 0) return bySha;
    if (store.existingFileIds !== undefined && store.originalRef !== undefined) {
      for (const fileId of await store.existingFileIds([...wanted.keys()])) {
        const ref = await store.originalRef(fileId);
        if (ref !== undefined) keep(fileId, ref.sha256, ref.name);
      }
    } else if (store.listFilePage !== undefined) {
      for (let offset = 0; ; ) {
        const page = await store.listFilePage({ limit: 200, offset });
        for (const f of page.files) keep(f.fileId, f.sha256, f.name);
        offset += page.files.length;
        if (page.files.length === 0 || offset >= page.page.total) break;
      }
    } else {
      for (const f of await store.listFiles()) keep(f.fileId, f.sha256, f.name);
    }
    if (store.fileMatterLinks !== undefined && byId.size > 0) {
      try {
        const links = await store.fileMatterLinks([...byId.keys()]);
        for (const [fileId, link] of links) {
          const dup = byId.get(fileId);
          if (dup !== undefined) {
            dup.matterId = link.matterId;
            dup.matterTitle = link.matterTitle;
          }
        }
      } catch {
        // A database without the matters tables still answers the duplicate
        // question; only the "which matter" half is missing.
      }
    }
    return bySha;
  };

  const matterRefs = async (): Promise<MatterRef[]> =>
    (await ctx.matters.list()).map((m) => ({ id: m.id, title: m.title, court: m.court, docketNo: m.docketNo }));

  app.post("/v1/files/uyap-preview", async (c) => {
    if (!ctx.configured) {
      return c.json({ error: { kind: "STORE_UNAVAILABLE", message: UYAP_MESSAGES_TR.notConfigured } }, 503);
    }
    sweep();
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    let scanTarget: string;
    let stageArg: string | undefined;
    let stagingDir: string | null = null;
    let source: { kind: "zip" | "files" | "dir"; label: string };

    if (contentType.startsWith("multipart/form-data")) {
      let body: Record<string, unknown>;
      try {
        body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
      } catch {
        return invalid(c, UYAP_MESSAGES_TR.needInput);
      }
      const stray = Object.keys(body).filter((key) => key !== "file");
      if (stray.length > 0) {
        return invalid(
          c,
          "Önizleme isteğinde tanınmayan alan var.",
          stray.map((key) => ({ path: key, message: "Tanınmayan alan." })),
        );
      }
      const raw = body["file"];
      const files = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(isFileLike);
      if (files.length === 0) return invalid(c, UYAP_MESSAGES_TR.needInput);
      const zips = files.filter((f) => /\.zip$/iu.test(f.name));
      if (zips.length > 0 && files.length !== 1) return invalid(c, UYAP_MESSAGES_TR.zipAlone);
      if (files.length > UYAP_MAX_FILES) return invalid(c, UYAP_MESSAGES_TR.tooMany);
      stagingDir = await mkdtemp(join(stagingRoot, "collex-uyap-"));
      const docsDir = join(stagingDir, "belgeler");
      try {
        if (zips.length === 1) {
          const zip = zips[0] as File;
          if (zip.size > UPLOAD_CAP_BYTES) {
            await rm(stagingDir, { recursive: true, force: true });
            return invalid(c, UYAP_MESSAGES_TR.zipTooBig);
          }
          const zipPath = join(stagingDir, safeUploadName(zip.name));
          await writeFile(zipPath, Buffer.from(await zip.arrayBuffer()));
          scanTarget = zipPath;
          stageArg = docsDir;
          source = { kind: "zip", label: safeUploadName(zip.name) };
        } else {
          const used = new Set<string>();
          for (const [index, file] of files.entries()) {
            let rel = safeRelativeUploadPath(file.name);
            if (used.has(rel.toLocaleLowerCase("tr-TR"))) rel = `${String(index + 1).padStart(3, "0")}/${rel}`;
            used.add(rel.toLocaleLowerCase("tr-TR"));
            const target = resolve(docsDir, rel);
            if (!isInside(docsDir, target)) continue;
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, Buffer.from(await file.arrayBuffer()));
          }
          await mkdir(docsDir, { recursive: true });
          scanTarget = docsDir;
          source = { kind: "files", label: `${files.length} dosya` };
        }
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
      }
    } else {
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return invalid(c, UYAP_MESSAGES_TR.needInput);
      }
      const parsed = previewDirSchema.safeParse(json);
      if (!parsed.success) {
        return invalid(c, "Önizleme isteği doğrulanamadı.", fieldIssues(parsed.error, zodMessageTr));
      }
      if (!isAbsolute(parsed.data.dir)) {
        return invalid(c, UYAP_MESSAGES_TR.dirNotAbsolute, [{ path: "dir", message: UYAP_MESSAGES_TR.dirNotAbsolute }]);
      }
      scanTarget = resolve(parsed.data.dir);
      source = { kind: "dir", label: scanTarget };
    }

    const cleanup = async (): Promise<void> => {
      if (stagingDir !== null) await rm(stagingDir, { recursive: true, force: true });
    };

    const result = await ctx.runIntake({
      pythonPath: ctx.pythonPath,
      args: [
        "-X", "utf8", "-m", "intake.cli", "--dsn", ctx.dsn,
        "--uyap-scan", scanTarget,
        ...(stageArg !== undefined ? ["--stage-dir", stageArg] : []),
        "--json",
      ],
      cwd: ctx.repoRoot,
      timeoutMs: UYAP_SCAN_TIMEOUT_MS,
    });
    const parsedOut = parseCliJson(result.stdout);
    const scan = parsedOut?.["uyapScan"];
    if (result.timedOut === true) {
      await cleanup();
      return c.json({ error: { kind: "UPLOAD_TIMEOUT", message: UYAP_MESSAGES_TR.scanTimeout } }, 504);
    }
    if (result.code !== 0 || !isScan(scan)) {
      await cleanup();
      return ctx.cliFailure(c, result, parsedOut);
    }

    let existing: Map<string, UyapDuplicate>;
    try {
      existing = await knownUploads(scan.documents.map((d) => d.sha256));
    } catch (error) {
      await cleanup();
      return storeDown(c, error);
    }
    let matters: MatterRef[];
    try {
      matters = await matterRefs();
    } catch {
      await cleanup();
      return c.json({ error: { kind: "STORE_UNAVAILABLE", message: MATTER_STORE_UNAVAILABLE_MESSAGE_TR } }, 503);
    }

    const rows = buildPreviewRows(scan.documents, matters, existing);
    const createdAt = now();
    const entry: PreviewEntry = {
      id: randomUUID(),
      createdAt,
      expiresAt: createdAt + UYAP_PREVIEW_TTL_MS,
      root: scan.root,
      stagingDir,
      order: rows.map((r) => r.path),
      rows: new Map(rows.map((r) => [r.path, r])),
      importing: false,
    };
    previews.set(entry.id, entry);

    const count = (predicate: (r: UyapPreviewRow) => boolean): number => rows.filter(predicate).length;
    return c.json(
      {
        previewId: entry.id,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        readerVersion: scan.readerVersion,
        source,
        total: rows.length,
        skipped: scan.skipped,
        rows,
        summary: {
          total: rows.length,
          matched: count((r) => r.match.status === "matched"),
          ambiguous: count((r) => r.match.status === "ambiguous"),
          unmatched: count((r) => r.match.status === "unmatched"),
          noEsas: count((r) => r.match.status === "no_esas"),
          duplicates: count((r) => r.duplicate !== null || r.duplicateInBatchOf !== null),
          unreadable: count((r) => !r.readable),
          esasConflicts: count((r) => r.reading.esasConflict),
        },
      },
      200,
    );
  });

  app.post("/v1/files/uyap-import", async (c) => {
    if (!ctx.configured) {
      return c.json({ error: { kind: "STORE_UNAVAILABLE", message: UYAP_MESSAGES_TR.notConfigured } }, 503);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "Aktarım isteği JSON gövdesi taşımalı.");
    }
    const parsed = uyapImportSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, "Aktarım isteği doğrulanamadı.", fieldIssues(parsed.error, zodMessageTr));
    }
    const request = parsed.data;
    sweep();
    const entry = previews.get(request.previewId);
    if (entry === undefined || entry.expiresAt <= now()) {
      return c.json({ error: { kind: "UYAP_PREVIEW_NOT_FOUND", message: UYAP_MESSAGES_TR.previewNotFound } }, 404);
    }
    if (entry.importing) {
      return c.json({ error: { kind: "UYAP_IMPORT_IN_PROGRESS", message: UYAP_MESSAGES_TR.importBusy } }, 409);
    }
    const unknownRows = request.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !entry.rows.has(row.path));
    if (unknownRows.length > 0) {
      return invalid(
        c,
        "Aktarım isteğinde önizlemede olmayan belge var.",
        unknownRows.map(({ index }) => ({ path: `rows.${index}.path`, message: UYAP_MESSAGES_TR.unknownRow })),
      );
    }

    // Every named matter must exist BEFORE any document is ingested.
    const named = [...new Set(request.rows.flatMap((r) => (r.action === "assign" && r.matterId ? [r.matterId] : [])))];
    const missing: string[] = [];
    for (const matterId of named) {
      const existence = await ctx.linker.exists(matterId);
      if (existence === "unavailable") {
        return c.json({ error: { kind: "STORE_UNAVAILABLE", message: MATTER_STORE_UNAVAILABLE_MESSAGE_TR } }, 503);
      }
      if (existence === "missing") missing.push(matterId);
    }
    if (missing.length > 0) {
      return c.json({ error: { kind: "MATTER_NOT_FOUND", message: MATTER_NOT_FOUND_MESSAGE_TR, matterIds: missing } }, 404);
    }

    let known: Map<string, UyapDuplicate>;
    try {
      known = await knownUploads([...entry.rows.values()].map((r) => r.sha256));
    } catch (error) {
      return storeDown(c, error);
    }

    entry.importing = true;
    try {
      const decisions = new Map(request.rows.map((r) => [r.path, r]));
      const titles = new Map<string, string>();
      for (const matterId of named) {
        try {
          titles.set(matterId, (await ctx.matters.get(matterId))?.title ?? "");
        } catch {
          titles.set(matterId, "");
        }
      }
      const created = new Map<string, { matterId: string; title: string; court: string; docketNo: string }>();
      const createdList: Array<{ matterId: string; title: string; court: string; docketNo: string }> = [];
      const out: UyapImportRow[] = [];
      let ingested = false;

      const targetFor = async (
        decision: UyapImportRequest["rows"][number],
      ): Promise<{ matterId: string; title: string } | undefined> => {
        if (decision.action === "assign" && decision.matterId !== undefined) {
          return { matterId: decision.matterId, title: titles.get(decision.matterId) ?? "" };
        }
        const spec = decision.newMatter;
        if (spec === undefined) return undefined;
        const key = [courtKey(spec.court), esasKey(spec.docketNo) ?? courtKey(spec.docketNo), courtKey(spec.title)].join("|");
        const already = created.get(key);
        if (already !== undefined) return { matterId: already.matterId, title: already.title };
        const matter = await ctx.matters.create({
          title: spec.title,
          court: spec.court,
          docketNo: spec.docketNo,
          kind: "dava",
        });
        const record = { matterId: matter.id, title: matter.title, court: matter.court, docketNo: matter.docketNo };
        created.set(key, record);
        createdList.push(record);
        return { matterId: record.matterId, title: record.title };
      };

      const link = async (matterId: string, fileId: string, name: string): Promise<string[]> => {
        const outcome = await ctx.linker.link(matterId, "file", fileId, { fileName: name });
        return outcome.ok ? [] : [outcome.warning ?? `MATTER_LINK_FAILED:${MATTER_LINK_FAILED_MESSAGE_TR}`];
      };

      for (const path of entry.order) {
        const row = entry.rows.get(path) as UyapPreviewRow;
        const decision = decisions.get(path) ?? { path, action: "skip" as const };
        const base = { path, name: row.name, fileId: null, matterId: null, matterTitle: null, error: null, warnings: [] as string[] };
        const knownNow = known.get(row.sha256);

        if (decision.action === "skip") {
          if (knownNow !== undefined || row.duplicateInBatchOf !== null) {
            out.push({ ...base, outcome: "duplicate", fileId: knownNow?.fileId ?? null, reason: UYAP_MESSAGES_TR.duplicateSkipped });
          } else if (row.match.status !== "matched") {
            out.push({ ...base, outcome: "unmatched", reason: UYAP_MESSAGES_TR.unmatchedSkipped });
          } else {
            out.push({ ...base, outcome: "skipped", reason: UYAP_MESSAGES_TR.skipped });
          }
          continue;
        }
        if (!row.importable) {
          out.push({ ...base, outcome: "failed", reason: UYAP_MESSAGES_TR.notImportable, error: row.error });
          continue;
        }

        let target: { matterId: string; title: string } | undefined;
        try {
          target = await targetFor(decision);
        } catch {
          target = undefined;
        }
        if (target === undefined) {
          out.push({
            ...base,
            outcome: "failed",
            reason: UYAP_MESSAGES_TR.matterCreateFailed,
            error: { kind: "STORE_UNAVAILABLE", message: UYAP_MESSAGES_TR.matterCreateFailed },
          });
          continue;
        }
        const filed = { matterId: target.matterId, matterTitle: target.title };

        if (knownNow !== undefined) {
          const warnings = await link(target.matterId, knownNow.fileId, knownNow.name);
          out.push({
            ...base,
            ...filed,
            outcome: "duplicate",
            fileId: knownNow.fileId,
            reason: UYAP_MESSAGES_TR.duplicateLinked(target.title),
            warnings,
          });
          continue;
        }

        const absolute = resolve(entry.root, path);
        const digest = isInside(entry.root, absolute) ? await sha256Of(absolute) : undefined;
        if (digest !== row.sha256) {
          out.push({
            ...base,
            outcome: "failed",
            reason: UYAP_MESSAGES_TR.changed,
            error: { kind: "CHANGED_SINCE_PREVIEW", message: UYAP_MESSAGES_TR.changed },
          });
          continue;
        }

        const result = await ctx.runIntake({
          pythonPath: ctx.pythonPath,
          args: intakeFileArgs(ctx.dsn, absolute),
          cwd: ctx.repoRoot,
        });
        const body = parseCliJson(result.stdout);
        if (result.code !== 0 || result.timedOut === true || body === undefined || typeof body["fileId"] !== "string") {
          out.push({ ...base, outcome: "failed", ...failureOf(result, body, ctx.log) });
          continue;
        }
        ingested = true;
        const fileId = body["fileId"];
        if (body["sha256"] !== row.sha256) {
          // Changed between the re-hash and the intake's own read: stored,
          // but NOT filed under the matter the lawyer confirmed for other bytes.
          out.push({
            ...base,
            outcome: "failed",
            fileId,
            reason: UYAP_MESSAGES_TR.changed,
            error: { kind: "CHANGED_SINCE_PREVIEW", message: UYAP_MESSAGES_TR.changed },
          });
          continue;
        }
        known.set(row.sha256, { fileId, name: row.name, matterId: target.matterId, matterTitle: target.title });
        const warnings = [
          ...(Array.isArray(body["warnings"]) ? (body["warnings"] as unknown[]).filter((w): w is string => typeof w === "string") : []),
          ...(await link(target.matterId, fileId, row.name)),
        ];
        const existed = body["action"] === "already-existed";
        out.push({
          ...base,
          ...filed,
          outcome: existed ? "duplicate" : "added",
          fileId,
          reason: existed ? UYAP_MESSAGES_TR.duplicateLinked(target.title) : UYAP_MESSAGES_TR.added(target.title),
          warnings,
        });
      }
      if (ingested) invalidateLexicalStats();

      const counts: UyapImportCounts = {
        total: out.length,
        added: out.filter((r) => r.outcome === "added").length,
        matters: new Set(out.filter((r) => r.outcome === "added").map((r) => r.matterId)).size,
        duplicates: out.filter((r) => r.outcome === "duplicate").length,
        unmatched: out.filter((r) => r.outcome === "unmatched").length,
        skipped: out.filter((r) => r.outcome === "skipped").length,
        failed: out.filter((r) => r.outcome === "failed").length,
      };
      return c.json(
        {
          previewId: entry.id,
          total: out.length,
          rows: out,
          createdMatters: createdList,
          summary: counts,
          sentence: importSummarySentence(counts),
        },
        200,
      );
    } finally {
      entry.importing = false;
    }
  });
}

/** A failed single-document intake as a row (stderr only in the server log). */
function failureOf(
  result: IntakeExecResult,
  body: Record<string, unknown> | undefined,
  log: (line: string) => void,
): Pick<UyapImportRow, "reason" | "error"> {
  if (result.timedOut === true) {
    const message = "Belge işleme süresi aşıldı (180 sn); bu belgeyi tek başına yüklemeyi deneyin.";
    return { reason: message, error: { kind: "UPLOAD_TIMEOUT", message } };
  }
  if (result.code === 2 && isCliError(body)) {
    return { reason: body.error.message, error: { kind: body.error.kind, message: body.error.message } };
  }
  const correlationId = randomUUID();
  log(
    `[collex] INTAKE_FAILED id=${correlationId} code=${result.code} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
  );
  const message = "Belge işleme aracı beklenmedik biçimde sonlandı.";
  return {
    reason: message,
    error: { kind: "INTAKE_FAILED", message: `${message} Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`, correlationId },
  };
}

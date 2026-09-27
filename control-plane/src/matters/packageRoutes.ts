/**
 * Dosya paketi — W14 B-30, HTTP half (L-FIX).
 *
 *   POST /v1/matters/{id}/package   -> application/zip
 *
 * L-EVID shipped the packager, the CLI and its tests in phase A and filed the
 * HTTP endpoint as integration request 9.4, because the data it needs lives in
 * three other lanes: the matter and its items (L-MATTER), the uploaded bytes
 * and their sha256 (the files lane), and the stored answers/drafts (the API's
 * shared stores). This module is that join, and nothing more: it builds a
 * `collex.matter-package/v1` plan and hands it to `python -m export.cli
 * --package`, exactly the way the drafting router hands a draft to
 * `--draft`.
 *
 * WHAT IT DOES NOT DO. It never reads a file's bytes itself and never
 * computes a hash: the plan carries the absolute path and the sha256 THE
 * DATABASE recorded at intake, and the Python packager re-computes the digest
 * and refuses the whole archive if one file does not match (export/package.py).
 * So a document silently altered on disk cannot end up in a package that
 * claims to be the file as filed. That refusal reaches the caller as
 * 500 EXPORT_REFUSED with a correlation id, and NOTHING is written — the same
 * contract every other ColleX exporter has.
 *
 * A record the package cannot include is reported in `notes`, never dropped:
 * an archive that quietly omits a document is worse than one that says which
 * document is missing and why.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MatterStore } from "./types.js";
import { encodeRfc8187 } from "../drafting/routes.js";

/** Same exec seam the drafting router uses; tests inject a fake. */
export interface PackageExecRequest {
  pythonPath: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}
export interface PackageExecResult {
  code: number;
  stderr: string;
}
export type PackageExec = (request: PackageExecRequest) => Promise<PackageExecResult>;

/** What this router needs from the files lane (structural, no lane import). */
export interface PackageFilePort {
  originalRef?(
    fileId: string,
    tenantId?: string,
  ): Promise<{ sha256: string; kind: string; name: string; mime: string } | undefined>;
}

/** What it needs from the answer store. */
export interface PackageAnswerPort {
  get?(runId: string): unknown;
  warm?(runId: string): Promise<void>;
}

/** What it needs from the draft store. */
export interface PackageDraftPort {
  get?(draftId: string): unknown;
  warm?(draftId: string): Promise<void>;
}

export interface PackageRouterDeps {
  store: MatterStore;
  files?: PackageFilePort;
  answers?: PackageAnswerPort;
  drafts?: PackageDraftPort;
  exec?: PackageExec;
  pythonPath?: string;
  repoRoot?: string;
  uploadsDir?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export const PACKAGE_SCHEMA = "collex.matter-package/v1";
export const PACKAGE_FORMAT = "dosya-paketi-zip";
export const ZIP_MIME = "application/zip";
/** A matter package copies whole files; 5 minutes, not the draft's 60 s. */
export const PACKAGE_TIMEOUT_MS = 300_000;

export const ORIGINAL_EXTENSIONS = [".pdf", ".docx", ".txt", ".udf"] as const;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MATTER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const PACKAGE_EMPTY_MESSAGE_TR =
  "Bu dosyada paketlenecek belge, cevap veya taslak yok.";
export const PACKAGE_UNAVAILABLE_MESSAGE_TR =
  "Dosya paketi bu sunucuda yapılandırılmadı: belge deposu bağlı değil.";

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function defaultPythonPath(repoRoot: string): string {
  return process.platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
}

const execFileRunner: PackageExec = async ({ pythonPath, args, cwd, timeoutMs }) => {
  const { execFile } = await import("node:child_process");
  return new Promise((resolvePromise) => {
    execFile(
      pythonPath,
      args,
      { cwd, timeout: timeoutMs ?? PACKAGE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolvePromise({ code, stderr: String(stderr ?? "") });
      },
    );
  });
};

/** ASCII-safe archive name; the human name rides in Content-Disposition. */
function safeName(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned === "" ? fallback : cleaned.slice(0, 120);
}

/** RFC 6266/8187 disposition, same helper shape as the drafting router's. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/"/gu, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc8187(name)}`;
}

/**
 * A name no earlier entry of the same folder already took (27.09.2026).
 *
 * THE DEFECT. Two drafts of the same template and version were both planned
 * as "<title> - v1.docx" and rendered to the same work path: one draft was
 * silently lost and the manifest still verified. Two uploads called
 * "dilekce.pdf" made zipfile write a duplicate member and the packager
 * refused with a FALSE tampering message. Names are now unique per folder,
 * deterministically — the second one gets " (2)" before its extension, in the
 * order the matter lists its items — and compared case-insensitively, because
 * the archive is unpacked on Windows.
 */
export function uniqueArchiveName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLocaleLowerCase("tr-TR")); n += 1) {
    candidate = `${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLocaleLowerCase("tr-TR"));
  return candidate;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createMatterPackageRouter(deps: PackageRouterDeps): Hono {
  const app = new Hono();
  const { store } = deps;
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const pythonPath = deps.pythonPath ?? defaultPythonPath(repoRoot);
  const uploadsDir = deps.uploadsDir ?? join(repoRoot, "var", "uploads");
  const runExporter = deps.exec ?? execFileRunner;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const notFound = (c: Context) =>
    c.json(
      { error: { kind: "MATTER_NOT_FOUND", message: "Dava dosyası bulunamadı." } },
      404,
    );

  app.post("/v1/matters/:id/package", async (c) => {
    const matterId = c.req.param("id");
    if (!MATTER_ID_RE.test(matterId)) return notFound(c);

    let matter;
    let items;
    try {
      matter = await store.get(matterId);
      if (matter === undefined) return notFound(c);
      items = await store.listItems(matterId);
    } catch {
      return c.json(
        {
          error: {
            kind: "STORE_UNAVAILABLE",
            message: "Yerel veritabanına ulaşılamadı; paket hazırlanamadı.",
          },
        },
        503,
      );
    }

    const notes: string[] = [];
    const documents: { fileName: string; sourcePath: string; sha256: string }[] = [];
    const drafts: { fileName: string; draftPath: string }[] = [];
    const answers: { fileName: string; bundlePath: string }[] = [];
    // One name per archive folder (uniqueArchiveName).
    const documentNames = new Set<string>();
    const draftNames = new Set<string>();

    const workDir = await mkdtemp(join(tmpdir(), "collex-package-"));
    try {
      // ---- uploaded documents --------------------------------------------
      for (const item of items) {
        if (item.kind !== "file" || item.refId === null) continue;
        if (deps.files?.originalRef === undefined) {
          notes.push(
            `Belge ${item.refId}: belge deposu bağlı değil, aslı pakete konmadı.`,
          );
          continue;
        }
        let ref;
        try {
          ref = await deps.files.originalRef(item.refId);
        } catch {
          ref = undefined;
        }
        if (ref === undefined || !SHA256_RE.test(ref.sha256)) {
          notes.push(`Belge ${item.refId}: kaydı bulunamadı, pakete konmadı.`);
          continue;
        }
        // Same resolution the /v1/files/{id}/original route performs: the
        // stored name is `<sha256><ext>` and the sha256 comes from the
        // database, so no request can name a path.
        const candidates = [
          ...(ref.kind !== "" ? [`.${ref.kind.toLowerCase()}`] : []),
          ...ORIGINAL_EXTENSIONS,
        ].filter((ext) =>
          ORIGINAL_EXTENSIONS.includes(ext as (typeof ORIGINAL_EXTENSIONS)[number]),
        );
        let sourcePath: string | undefined;
        let extension = "";
        for (const ext of candidates) {
          const candidate = join(uploadsDir, `${ref.sha256}${ext}`);
          try {
            const info = await stat(candidate);
            if (info.isFile()) {
              sourcePath = candidate;
              extension = ext;
              break;
            }
          } catch {
            // next extension
          }
        }
        if (sourcePath === undefined) {
          notes.push(
            // N-2: names the DATA FOLDER, not `var/uploads` — on a
            // COLLEX_DATA_DIR installation that path is empty and the
            // sentence sent the lawyer to the wrong folder. Same wording as
            // `files/routes.ts :: ORIGINAL_MISSING_MESSAGE_TR`.
            `Belge ${ref.name !== "" ? ref.name : item.refId}: aslı bilgisayarda` +
              " bulunamadı — veri klasörünüzdeki uploads klasöründe yok" +
              " (varsayılan: var/uploads); pakete yalnız adı yazıldı.",
          );
          continue;
        }
        documents.push({
          fileName: uniqueArchiveName(safeName(ref.name, `${item.refId}${extension}`), documentNames),
          sourcePath,
          sha256: ref.sha256,
        });
      }

      // ---- answers --------------------------------------------------------
      let answerIndex = 0;
      for (const item of items) {
        if (item.kind !== "answer" || item.refId === null) continue;
        answerIndex += 1;
        if (deps.answers?.get === undefined) {
          notes.push(`Araştırma ${item.refId}: cevap deposu bağlı değil.`);
          continue;
        }
        try {
          await deps.answers.warm?.(item.refId);
        } catch {
          // a cold store costs the record, not the package
        }
        const stored = deps.answers.get(item.refId) as { bundle?: unknown } | undefined;
        const bundle = stored?.bundle;
        if (bundle === undefined) {
          notes.push(`Araştırma ${item.refId}: kanıt paketi bulunamadı.`);
          continue;
        }
        const bundlePath = join(workDir, `answer-${answerIndex}.json`);
        await writeFile(bundlePath, JSON.stringify(bundle), "utf8");
        answers.push({ fileName: `arastirma-${answerIndex}.json`, bundlePath });
      }

      // ---- drafts ---------------------------------------------------------
      let draftIndex = 0;
      for (const item of items) {
        if (item.kind !== "draft" || item.refId === null) continue;
        draftIndex += 1;
        if (deps.drafts?.get === undefined) {
          notes.push(`Taslak ${item.refId}: taslak deposu bağlı değil.`);
          continue;
        }
        try {
          await deps.drafts.warm?.(item.refId);
        } catch {
          // as above
        }
        const draft = deps.drafts.get(item.refId) as
          | { title?: unknown; version?: unknown }
          | undefined;
        if (draft === undefined) {
          notes.push(`Taslak ${item.refId}: kaydı bulunamadı.`);
          continue;
        }
        const draftPath = join(workDir, `draft-${draftIndex}.json`);
        await writeFile(draftPath, JSON.stringify(draft), "utf8");
        const title = typeof draft.title === "string" ? draft.title : item.refId;
        const version = typeof draft.version === "number" ? draft.version : 1;
        drafts.push({
          fileName: uniqueArchiveName(`${safeName(title, `taslak-${draftIndex}`)} - v${version}.docx`, draftNames),
          draftPath,
        });
      }

      if (documents.length === 0 && drafts.length === 0 && answers.length === 0) {
        return c.json(
          { error: { kind: "PACKAGE_EMPTY", message: PACKAGE_EMPTY_MESSAGE_TR, notes } },
          422,
        );
      }

      const generatedAt = now().toISOString();
      const plan = {
        schema: PACKAGE_SCHEMA,
        matterId,
        matterTitle: matter.title,
        generatedAt,
        notes,
        documents,
        drafts,
        answers,
      };
      const planPath = join(workDir, "plan.json");
      const outPath = join(workDir, "paket.zip");
      await writeFile(planPath, JSON.stringify(plan), "utf8");

      const result = await runExporter({
        pythonPath,
        args: [
          "-X",
          "utf8",
          "-m",
          "export.cli",
          "--package",
          planPath,
          "--out",
          outPath,
          "--format",
          PACKAGE_FORMAT,
          "--quiet",
        ],
        cwd: repoRoot,
        timeoutMs: PACKAGE_TIMEOUT_MS,
      });

      if (result.code !== 0) {
        // Exit 2 is the packager REFUSING (a document whose bytes no longer
        // match the recorded sha256, say). That is an integrity finding, not
        // a client error, and the child's stderr stays in the server log.
        const correlationId = randomUUID();
        log(
          `[collex] ${result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED"}` +
            ` id=${correlationId} matterId=${matterId} format=${PACKAGE_FORMAT}` +
            ` code=${result.code} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
        );
        return c.json(
          {
            error: {
              kind: result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED",
              // 27.09.2026: the refusal has several causes (a document whose
              // bytes no longer match its digest, a draft whose quote was
              // altered, a colliding name); the old sentence named only the
              // first and read as TAMPERING when two uploads merely shared a
              // name. The sentence now claims only what is known; the finding
              // itself stays in the server log (stderr never reaches a body).
              message:
                result.code === 2
                  ? "Paket REDDEDİLDİ: paketteki kayıtlardan biri doğrulanamadı (örneğin" +
                    " kayıtlı özetiyle uyuşmayan bir belge ya da alıntısı değiştirilmiş bir" +
                    " taslak); hiçbir dosya yazılmadı. Hangi kaydın reddedildiği sunucu" +
                    " günlüğünde bu kayıt numarasıyla yazılı."
                  : "Paketleyici beklenmedik biçimde sonlandı; dosya üretilmedi.",
              detail:
                "Ayrıntı sunucu günlüğünde bu numarayla kayıtlı:" +
                ` ${correlationId}`,
              correlationId,
            },
          },
          500,
        );
      }

      const bytes = await readFile(outPath);
      const name = `${safeName(matter.title, "dosya")} - ${isoDay(now())}.zip`;
      return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
        "content-type": ZIP_MIME,
        "content-length": String(bytes.byteLength),
        "content-disposition": contentDisposition(name),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  return app;
}

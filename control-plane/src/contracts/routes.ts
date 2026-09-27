/**
 * `createContractsRouter` — the Atıf Denetim Raporu (B-13) and the rule-based
 * sözleşme/kontrol listesi incelemesi (B-24).
 *
 * MOUNTING. This router declares ABSOLUTE paths and is meant to be mounted at
 * `/` by `control-plane/src/api/server.ts` (owned by L-SAFE):
 *
 *     app.route("/", createContractsRouter({ resolveCitation, checklists }));
 *
 * Endpoints:
 *   POST /v1/citation-audit          — audit the citations of any document
 *   POST /v1/contracts/review        — run a checklist over a contract
 *   POST /v1/contracts/review/export — same review, self-checked DOCX
 *   POST /v1/contracts/petition-analysis — karşı dilekçe analizi (W16 · D)
 *   GET  /v1/contracts/checklists    — the saved checklists
 *   PUT  /v1/contracts/checklists/{id} — save one (full replace)
 *
 * The citation resolver is INJECTED. This lane owns the audit's discipline
 * (three buckets, as-of currency, the empty-cell rule); it does not own the
 * retrieval lanes it would have to call, so the port stays explicit and the
 * default answers UNCERTAIN for everything — a router with no resolver
 * wired reports honestly that it could not decide, and never that a citation
 * was not found.
 */

import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fieldIssues } from "../api/zodIssues.js";

import {
  CitationAuditError,
  auditCitations,
  extractAuditCitations,
  type CitationAuditReport,
  type CitationResolver,
} from "./citationAudit.js";
import {
  ContractReviewError,
  reviewContract,
  verifyReviewEvidence,
  type Checklist,
  type ContractReviewReport,
} from "./clauseReview.js";
import type { DraftAnswerLookup } from "../drafting/types.js";
import {
  asciiSafe,
  contentDisposition,
  defaultDraftDocxExec,
  EXPORT_TIMEOUT_MS,
  type DraftDocxExec,
} from "../drafting/routes.js";
import {
  PetitionAnalysisError,
  analyzePetition,
  type ContrarySearchPort,
  type PetitionAnalysisReport,
} from "./petitionAnalysis.js";
import type { DraftingFilePort } from "../drafting/types.js";

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

const isoDate = z
  .string(REQ)
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Tarih YYYY-AA-GG biçiminde olmalı (ör. 2026-09-02).");

const auditSchema = z
  .object({
    text: z.string(REQ).max(2_000_000, "Metin en fazla 2.000.000 karakter olabilir.").optional(),
    citations: z
      .array(
        z
          .object({
            raw: z.string(REQ).min(1, "Atıf boş olamaz.").max(600, "En fazla 600 karakter."),
            count: z.number(REQ).int().min(1).max(10_000).optional(),
          })
          .strict("Tanınmayan alan."),
      )
      .max(500, "En fazla 500 atıf.")
      .optional(),
    asOf: isoDate,
    matterId: z.string(REQ).max(200, "En fazla 200 karakter.").optional(),
    documentTitle: z.string(REQ).max(300, "En fazla 300 karakter.").optional(),
  })
  .strict("Tanınmayan alan.");

const checklistItemSchema = z
  .object({
    id: z.string(REQ).min(1, "Başlık kimliği boş olamaz.").max(100, "En fazla 100 karakter."),
    label: z.string(REQ).min(1, "Başlık adı boş olamaz.").max(200, "En fazla 200 karakter."),
    terms: z
      .array(z.string(REQ).min(1).max(200))
      .min(1, "En az bir aranacak ifade girin.")
      .max(50, "En fazla 50 ifade."),
    weakTerms: z.array(z.string(REQ).min(1).max(200)).max(50, "En fazla 50 ifade.").optional(),
    note: z.string(REQ).max(2000, "En fazla 2.000 karakter.").optional(),
  })
  .strict("Tanınmayan alan.");

const checklistSchema = z
  .object({
    id: z.string(REQ).min(1, "Liste kimliği boş olamaz.").max(100, "En fazla 100 karakter."),
    title: z.string(REQ).min(1, "Liste adı boş olamaz.").max(200, "En fazla 200 karakter."),
    items: z.array(checklistItemSchema).min(1, "Listede en az bir başlık olmalı.").max(200, "En fazla 200 başlık."),
  })
  .strict("Tanınmayan alan.");

const reviewSchema = z
  .object({
    text: z.string(REQ).min(1, "Sözleşme metni boş olamaz.").max(2_000_000, "Metin çok uzun."),
    documentTitle: z.string(REQ).max(300, "En fazla 300 karakter.").optional(),
    /** Either the checklist itself, or the id of a saved one. */
    checklist: checklistSchema.optional(),
    checklistId: z.string(REQ).max(100, "En fazla 100 karakter.").optional(),
    evidence: z
      .array(
        z
          .object({
            evidenceId: z.string(REQ).min(1).max(200),
            label: z.string(REQ).min(1).max(600),
            quote: z.string(REQ).min(1).max(20_000),
            quoteSha256: z.string(REQ).regex(/^[0-9a-f]{64}$/u, "SHA-256 64 onaltılık karakter olmalı."),
            /**
             * The answer run that holds this quote. Additive (2026-09-27): a
             * quote is a source only when the answer store holds it under
             * this run — a digest the request computed itself proves nothing.
             */
            runId: z.string(REQ).min(1, "Araştırma no boş olamaz.").max(200).optional(),
          })
          .strict("Tanınmayan alan."),
      )
      .max(200, "En fazla 200 kaynak.")
      .optional(),
    observations: z
      .array(
        z
          .object({
            clauseIndex: z.number(REQ).int().min(0).max(10_000),
            text: z.string(REQ).min(1).max(4000),
            evidenceId: z.string(REQ).max(200).optional(),
          })
          .strict("Tanınmayan alan."),
      )
      .max(500, "En fazla 500 gözlem.")
      .optional(),
  })
  .strict("Tanınmayan alan.");

const petitionAnalysisSchema = z
  .object({
    text: z
      .string(REQ)
      .max(2_000_000, "Metin en fazla 2.000.000 karakter olabilir.")
      .optional(),
    /**
     * An uploaded document to analyse instead of pasted text. Resolved through
     * the SAME `DraftingFilePort` the drafting lane uses, so no second reading
     * path for tenant uploads can appear.
     */
    fileId: z
      .string(REQ)
      .regex(/^[0-9a-f]{16}$/u, "Belge kimliği 16 onaltılık karakter olmalı.")
      .optional(),
    asOf: isoDate,
    matterId: z.string(REQ).max(200, "En fazla 200 karakter.").optional(),
    documentTitle: z.string(REQ).max(300, "En fazla 300 karakter.").optional(),
    /** true when the document being analysed is one of OUR OWN. */
    own: z.boolean(REQ).optional(),
  })
  .strict("Tanınmayan alan.");

/** Saved checklists; the API integration may back this with settings/matters. */
export interface ChecklistStore {
  list(): Promise<Checklist[]> | Checklist[];
  get(id: string): Promise<Checklist | undefined> | Checklist | undefined;
  put(checklist: Checklist): Promise<void> | void;
}

/** In-memory default so the lane is usable and testable on its own. */
export class InMemoryChecklistStore implements ChecklistStore {
  private readonly items = new Map<string, Checklist>();

  constructor(seed: readonly Checklist[] = []) {
    for (const checklist of seed) this.items.set(checklist.id, checklist);
  }

  list(): Checklist[] {
    return [...this.items.values()];
  }

  get(id: string): Checklist | undefined {
    return this.items.get(id);
  }

  put(checklist: Checklist): void {
    this.items.set(checklist.id, checklist);
  }
}

/**
 * The default resolver: it decides NOTHING. Every citation comes back
 * UNCERTAIN with the reason stated plainly. This is the honest behaviour for
 * an unwired deployment — the alternative (defaulting to "bulunamadı") would
 * accuse every citation of being invented because we did not look.
 */
export const UNWIRED_RESOLVER: CitationResolver = async () => ({
  uncertainReason:
    "Kaynak sorgusu bu kurulumda bağlı değil; atıf denetlenemedi." +
    " Bu, atıfın bulunmadığı anlamına GELMEZ.",
});

export interface ContractsDependencies {
  /** Resolves one citation as of a date; defaults to `UNWIRED_RESOLVER`. */
  resolveCitation?: CitationResolver;
  checklists?: ChecklistStore;
  now?: () => Date;
  /**
   * The answer store, used ONLY to verify review evidence
   * (`verifyReviewEvidence`): an observation may call something a risk only
   * when its quote is held under the named answer run. Absent = every
   * observation is KAYNAKSIZ, whatever the request carries.
   */
  answers?: DraftAnswerLookup;
  /**
   * W16 · D. Runs one contrary-authority lane. ABSENT BY DEFAULT: the lanes
   * are then still built and shown with the state ÇALIŞTIRILMADI, which is
   * the honest half of the vaporware gate — the lawyer sees the query and is
   * told it did not run, and never reads a blank lane as "aleyhe kaynak yok".
   */
  contrarySearch?: ContrarySearchPort;
  /**
   * W16 · D. Reads an uploaded document's chunks so `{ fileId }` can be
   * analysed. Same port the drafting lane binds `evidence.fileIds` through —
   * there is no second reading path. Absent = `fileId` answers a typed 503
   * that says so.
   */
  files?: DraftingFilePort;
  /** Tenant the `files` port is read as. Defaults to "local". */
  tenantId?: string;
  /** DOCX exporter process; defaults to the shared shell-free venv runner. */
  exportExec?: DraftDocxExec;
  /** Python interpreter and repository root for `export.cli --review`. */
  pythonPath?: string;
  repoRoot?: string;
  /** Server-log sink for exporter stderr. */
  log?: (line: string) => void;
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function defaultPythonPath(repoRoot: string): string {
  return process.platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
}

function reviewFileName(documentTitle: string): { ascii: string; utf8: string } {
  const clean = documentTitle
    .replace(/[\u0000-\u001f"\\/:*?<>|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || "Sözleşme";
  const utf8 = `${clean} - İnceleme Raporu.docx`;
  const suffix = " - Inceleme Raporu.docx";
  const base = asciiSafe(clean) || "Sozlesme";
  return { ascii: `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`, utf8 };
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<
  { ok: true; body: unknown } | { ok: false }
> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

const invalidJson = {
  error: { kind: "INVALID_REQUEST", message: "İstek gövdesi geçerli JSON değil." },
} as const;

/**
 * What the analysis says when `{ fileId }` is asked for on an installation
 * whose upload store is not wired into this router. A typed refusal that
 * NAMES the reason beats a 404 on a route the console can see.
 */
export const PETITION_FILE_UNWIRED_TR =
  "Yüklenen belgeler bu kurulumda dilekçe analizine bağlı değil." +
  " Dilekçe metnini yapıştırarak yeniden deneyin.";

export const PETITION_FILE_EMPTY_TR =
  "Bu belgeden metin okunamadı: belge bulunamadı ya da metin katmanı boş." +
  " Belgeyi 'Belgelerim' ekranından açıp metninin çıkarıldığını doğrulayın.";

/**
 * A file is stored as passages, so the analysis sees a passage boundary as a
 * paragraph boundary. Said out loud on every file-based report, because it
 * can split one long claim into two.
 */
export const PETITION_FILE_CHUNK_NOTICE_TR =
  "Bu rapor yüklenen bir belgeden üretildi. Belge pasajlar hâlinde saklandığı" +
  " için pasaj sınırı paragraf sınırı sayılır; uzun bir iddia iki iddia" +
  " olarak görünebilir.";

export function createContractsRouter(deps: ContractsDependencies = {}): Hono {
  const app = new Hono();
  const resolver = deps.resolveCitation ?? UNWIRED_RESOLVER;
  const checklists = deps.checklists ?? new InMemoryChecklistStore();
  const now = deps.now ?? (() => new Date());
  const tenantId = deps.tenantId ?? "local";
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const pythonPath = deps.pythonPath ?? defaultPythonPath(repoRoot);
  const runExporter = deps.exportExec ?? defaultDraftDocxExec;
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  // ---- B-13: Atıf Denetim Raporu -----------------------------------------
  app.post("/v1/citation-audit", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = auditSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Denetim isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    const body = parsed.data;
    if (body.text === undefined && (body.citations ?? []).length === 0) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Denetlenecek metin ya da atıf listesi verilmedi.",
          },
        },
        400,
      );
    }
    let report: CitationAuditReport;
    try {
      report = await auditCitations(body, resolver, { now });
    } catch (error) {
      if (error instanceof CitationAuditError) {
        return c.json({ error: { kind: "INVALID_REQUEST", message: error.message } }, 400);
      }
      throw error;
    }
    return c.json(report, 200);
  });

  /** Preview: what WOULD be audited, without spending the lookups. */
  app.post("/v1/citation-audit/preview", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = z
      .object({ text: z.string(REQ).max(2_000_000) })
      .strict("Tanınmayan alan.")
      .safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "Denetlenecek metin verilmedi." } },
        400,
      );
    }
    const citations = extractAuditCitations(parsed.data.text);
    return c.json({ citations: citations.map(({ raw, count }) => ({ raw, count })) }, 200);
  });

  // ---- B-24: sözleşme / kontrol listesi incelemesi -------------------------
  app.get("/v1/contracts/checklists", async (c) =>
    c.json({ checklists: await checklists.list() }, 200),
  );

  app.put("/v1/contracts/checklists/:id", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = checklistSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Kontrol listesi doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    if (parsed.data.id !== c.req.param("id")) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Adresteki liste kimliği ile gövdedeki kimlik aynı olmalı.",
          },
        },
        400,
      );
    }
    await checklists.put(parsed.data);
    return c.json(parsed.data, 200);
  });

  app.post("/v1/contracts/review", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = reviewSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İnceleme isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    const body = parsed.data;
    let checklist: Checklist | undefined = body.checklist;
    if (checklist === undefined && body.checklistId !== undefined) {
      checklist = await checklists.get(body.checklistId);
      if (checklist === undefined) {
        return c.json(
          { error: { kind: "NOT_FOUND", message: "Kontrol listesi bulunamadı." } },
          404,
        );
      }
    }
    if (checklist === undefined) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Bir kontrol listesi verin ya da kayıtlı bir listenin kimliğini gönderin.",
          },
        },
        400,
      );
    }
    let report: ContractReviewReport;
    try {
      report = reviewContract(
        { ...body, checklist },
        { now, verifiedEvidence: await verifyReviewEvidence(body.evidence ?? [], deps.answers) },
      );
    } catch (error) {
      if (error instanceof ContractReviewError) {
        return c.json({ error: { kind: "INVALID_REQUEST", message: error.message } }, 400);
      }
      throw error;
    }
    return c.json(report, 200);
  });

  /**
   * Produce the same rule-based report as `/review`, then hand that exact
   * JSON to `export.cli --review`. The exporter re-parses and self-checks the
   * report before publishing a DOCX; stderr never reaches the lawyer.
   */
  app.post("/v1/contracts/review/export", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = reviewSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İnceleme isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    const body = parsed.data;
    let checklist: Checklist | undefined = body.checklist;
    if (checklist === undefined && body.checklistId !== undefined) {
      checklist = await checklists.get(body.checklistId);
      if (checklist === undefined) {
        return c.json({ error: { kind: "NOT_FOUND", message: "Kontrol listesi bulunamadı." } }, 404);
      }
    }
    if (checklist === undefined) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Bir kontrol listesi verin ya da kayıtlı bir listenin kimliğini gönderin.",
          },
        },
        400,
      );
    }

    let report: ContractReviewReport;
    try {
      report = reviewContract(
        { ...body, checklist },
        { now, verifiedEvidence: await verifyReviewEvidence(body.evidence ?? [], deps.answers) },
      );
    } catch (error) {
      if (error instanceof ContractReviewError) {
        return c.json({ error: { kind: "INVALID_REQUEST", message: error.message } }, 400);
      }
      throw error;
    }

    const workDir = await mkdtemp(join(tmpdir(), "collex-contract-review-"));
    const jsonPath = join(workDir, "review.json");
    const outPath = join(workDir, "review.docx");
    try {
      await writeFile(jsonPath, JSON.stringify(report), "utf8");
      const result = await runExporter({
        pythonPath,
        args: [
          "-X",
          "utf8",
          "-m",
          "export.cli",
          "--review",
          jsonPath,
          "--out",
          outPath,
          "--format",
          "inceleme-docx",
          "--quiet",
        ],
        cwd: repoRoot,
        timeoutMs: EXPORT_TIMEOUT_MS,
      });
      if (result.code !== 0) {
        const correlationId = randomUUID();
        log(
          `[collex] ${result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED"}` +
            ` id=${correlationId} format=inceleme-docx code=${result.code}` +
            ` stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
        );
        return c.json(
          {
            error: {
              kind: result.code === 2 ? "EXPORT_REFUSED" : "EXPORT_FAILED",
              message:
                result.code === 2
                  ? "İnceleme dışa aktarıcısı raporu REDDETTİ; dosya yazılmadı."
                  : "İnceleme dışa aktarıcısı beklenmedik biçimde sonlandı; dosya üretilmedi.",
              detail: `Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`,
              correlationId,
            },
          },
          500,
        );
      }
      const bytes = await readFile(outPath);
      return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": contentDisposition(reviewFileName(report.documentTitle)),
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // ---- W16 · D: karşı dilekçe analizi -------------------------------------
  app.post("/v1/contracts/petition-analysis", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return c.json(invalidJson, 400);
    const parsed = petitionAnalysisSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Dilekçe analizi isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }
    const body = parsed.data;
    if ((body.text === undefined || body.text.trim() === "") && body.fileId === undefined) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Analiz edilecek dilekçe metni ya da belge kimliği verilmedi.",
          },
        },
        400,
      );
    }
    if (body.text !== undefined && body.fileId !== undefined) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Aynı istekte hem metin hem belge kimliği verilemez; birini seçin.",
          },
        },
        400,
      );
    }

    let text = body.text ?? "";
    let fromFile = false;
    if (body.fileId !== undefined) {
      if (deps.files === undefined) {
        return c.json(
          { error: { kind: "STORE_UNAVAILABLE", message: PETITION_FILE_UNWIRED_TR } },
          503,
        );
      }
      let chunks;
      try {
        chunks = await deps.files.getChunks([body.fileId], tenantId);
      } catch {
        return c.json(
          { error: { kind: "STORE_UNAVAILABLE", message: PETITION_FILE_EMPTY_TR } },
          503,
        );
      }
      // Passage order is the document's own order; never the store's.
      text = [...chunks]
        .sort((a, b) => a.startChar - b.startChar || a.ordinal - b.ordinal)
        .map((chunk) => chunk.text.trim())
        .filter((value) => value !== "")
        .join("\n\n");
      if (text.trim() === "") {
        return c.json({ error: { kind: "NOT_FOUND", message: PETITION_FILE_EMPTY_TR } }, 404);
      }
      fromFile = true;
    }

    let report: PetitionAnalysisReport;
    try {
      report = await analyzePetition(
        {
          text,
          asOf: body.asOf,
          ...(body.matterId !== undefined ? { matterId: body.matterId } : {}),
          ...(body.documentTitle !== undefined ? { documentTitle: body.documentTitle } : {}),
          ...(body.own !== undefined ? { own: body.own } : {}),
        },
        {
          resolveCitation: resolver,
          ...(deps.contrarySearch !== undefined ? { contrarySearch: deps.contrarySearch } : {}),
          now,
        },
      );
    } catch (error) {
      if (error instanceof PetitionAnalysisError) {
        return c.json({ error: { kind: "INVALID_REQUEST", message: error.message } }, 400);
      }
      throw error;
    }
    if (fromFile) report.notices.push(PETITION_FILE_CHUNK_NOTICE_TR);
    return c.json(report, 200);
  });

  return app;
}

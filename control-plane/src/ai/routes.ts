/**
 * Cloud-AI HTTP sub-router (W12 lane E, contract [AI]).
 *
 *   GET  /v1/ai/status             configured? model? what leaves the machine
 *   POST /v1/ai/analyze-document   {fileId, useCloudAi:true, focus?}
 *   POST /v1/ai/ocr                multipart {file: PDF, useCloudAi:'true'}
 *   POST /v1/ai/draft-paragraph    {draftId, sectionId, instructions, evidenceIds, useCloudAi:true, ...}
 *
 * Gates, in order, on EVERY POST:
 *   1. consent — the body must carry `useCloudAi === true` (JSON) or the
 *      form field 'true' (multipart); otherwise 400 AI_CONSENT_REQUIRED.
 *      Consent is per request: the lawyer decides each time that THIS
 *      document / draft evidence / PDF may leave the machine.
 *   2. configuration — no ANTHROPIC_API_KEY -> 503 AI_NOT_CONFIGURED.
 *   3. request validation (zod, Turkish messages), then local guards
 *      (file exists, PDF magic/size/pages) BEFORE any network call.
 *
 * Every model output is bound to evidence before it is returned: analysis
 * quotes are verified as exact substrings (analysis.ts), paragraph citations
 * pass the entailment judge (paragraph.ts), OCR text is stamped with a
 * provenance header (ocr.ts). Nothing the model says is ever presented as
 * sourced on its own authority.
 *
 * Exported as `createAiRouter(deps)`; the integration lane mounts it on the
 * main server (this lane does NOT touch src/api/server.ts).
 *
 * LIVE-UNTESTED: see anthropicAdapter.ts and docs/implementation/AI.md.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import {
  AnthropicApiError,
  type AnalyzeFocus,
  type AnthropicAnswerAdapter,
} from "../llm/anthropicAdapter.js";
import { sanitizeMarkdown } from "../security/renderGuard.js";
import { DRAFT_PERSIST_FAILED_MESSAGE_TR } from "../store/persistNotice.js";
import {
  ANALYSIS_DISCLAIMER,
  ANALYSIS_TOKEN_BUDGET,
  DOCUMENT_ANALYSIS_SCHEMA,
  selectChunksWithinBudget,
  verifyAnalysis,
  type DocumentAnalysisBody,
} from "./analysis.js";
import { AI_LIVE_TESTED, HIGHER_QUALITY_AI_MODEL, createAiAdapter, type AiConfig } from "./config.js";
import {
  AI_MAX_CALLS_PER_HOUR,
  AI_MAX_INPUT_TOKENS_PER_DAY,
  AI_RATE_LIMITED_KIND,
  InMemoryAiLedger,
  aiRateLimitedMessage,
  overCeiling,
  type AiLedger,
  type AiLedgerEntry,
} from "./ledger.js";
import { describeMask, maskDocumentText, type MaskParties, type MaskResult } from "./masking.js";
import {
  OCR_MAX_BYTES,
  OCR_MAX_PAGES,
  OCR_SCHEMA,
  PAGE_SEPARATOR,
  buildProvenanceHeader,
  estimatePdfPageCount,
  looksLikePdf,
  ocrUploadName,
  renderUploadText,
  transcribePdf,
} from "./ocr.js";
import {
  ENTAILMENT_THRESHOLD,
  NOTE_AI_KAYNAKSIZ_DUZENLEYICI,
  aiParagraphDraftWarnings,
  aiParagraphNote,
  aiRevisionNote,
  buildParagraphPatch,
  judgeRow,
  locateRevisedParagraph,
  newParagraphId,
  paragraphIds,
  pickRole,
  recountUnsupported,
  toEvidenceRef,
  uncheckedRow,
  type EntailmentRow,
} from "./paragraph.js";
import type {
  AiDraftLike,
  AiDraftParagraph,
  AiDraftStore,
  AiFilesPort,
  DraftPatchParagraph,
  ReviseFn,
} from "./types.js";

/** Local single-user tenant (mirrors drafting/types.ts LOCAL_TENANT_ID). */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * W14 B-23 — masking, the audit ledger and the cost ceiling.
 *
 * Three obligations the cloud lane did not meet, all of them the lawyer's
 * obligations rather than ours:
 *
 *   MASKING   Ankara Barosu HUBİTEM v1.0 requires client-identifying data to
 *             be anonymised before it reaches an AI tool. Until now the
 *             document went out as written.
 *   RECORD    KVKK m.9 (as amended by law 7499) makes the LAWYER the data
 *             controller for a transfer abroad; TBB's 28.08.2026 guidance
 *             keeps final responsibility with them. Neither is possible
 *             without a record of what was sent.
 *   CEILING   ENGRISK E13: no cumulative call/token limit existed at all, so
 *             combined with the CSRF hole B-04 closes, a foreign page could
 *             loop requests and spend the lawyer's API budget without limit.
 *
 * ADR-018 is NOT loosened by any of this: default OFF, per-request consent,
 * no remembered consent, `liveTested:false` until a real smoke run is
 * recorded. Masking is an ADDITIONAL gate in front of that, never a
 * substitute for it.
 */

export const AI_NOT_CONFIGURED_MESSAGE = "Bulut yapay zekâ kapalı — ANTHROPIC_API_KEY tanımlı değil.";

/**
 * Sections the paragraph writer must never touch (W12-FIX2, P2-17): the
 * machine-owned verification appendix and the contrary-authority section,
 * whose paragraphs are one-per-decision with a fixed note. Ids mirror
 * drafting/types.ts (EK_DOGRULAMA_SECTION_ID, KARSI_ICTIHAT_SECTION_ID);
 * re-declared, not imported (lane boundary).
 */
export const AI_LOCKED_SECTION_IDS: ReadonlySet<string> = new Set(["ek-dogrulama", "karsi-ictihat"]);
export const AI_LOCKED_SECTION_MESSAGE_TR =
  "Bu bölüme yapay zekâ paragrafı yazılamaz: doğrulama eki makineye, karşı içtihat bölümü ise kararlara aittir.";
// W15: eski metin "gövdede useCloudAi:true gönderin" diyordu — avukatın
// ekranda yapamayacağı bir programcı talimatı. Onayın ne anlama geldiği
// (metin bu bilgisayardan çıkar) önce, ne yapılacağı sonra yazılır.
export const AI_CONSENT_MESSAGE =
  "Bu işlem için seçtiğiniz belgenin metni bu bilgisayardan çıkar ve Anthropic " +
  "firmasının sunucularına gönderilir. Her istek için ayrı onay gerekir: üst " +
  "çubuktaki “Bulut yapay zekâ” düğmesini açıp işlemi yeniden başlatın.";

export interface AiRouterDeps {
  /**
   * W20: the data boundary in force. Under LOCAL_ONLY every POST under
   * /v1/ai/* is refused with 403 BEFORE the handler runs.
   */
  dataBoundary?: () => "LOCAL_ONLY" | "ALLOW_CLOUD";
  config: AiConfig | null;
  /**
   * Audit ledger + ceiling source (B-23). Defaults to a bounded in-memory
   * ledger so the limits apply even on an instance without a database — a
   * limit that silently disappears when the store is missing is not a limit.
   */
  aiLedger?: AiLedger;
  /**
   * Party names for masking, looked up per matter. Absent = identifiers are
   * still masked (they need no lookup), names are not.
   */
  matterParties?: (matterId: string) => Promise<MaskParties | undefined>;
  files?: AiFilesPort;
  drafts?: AiDraftStore;
  revise?: ReviseFn;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  tenantId?: string;
  /** Pre-built adapter (tests: fake fetch + zero retry delay). */
  adapter?: AnthropicAnswerAdapter;
  /** Analysis input budget override (tests). */
  analysisTokenBudget?: number;
  /** OCR pages per request override (tests). */
  ocrBatchSize?: number;
  /** stderr sink for failure codes (never carries the key or a body). */
  log?: (line: string) => void;
}

/* ----------------------------- schemas ------------------------------- */

/**
 * Every cloud route must say what to do about masking. There is no default:
 * a request that does not choose is refused, so nothing can leave the
 * machine because a caller forgot a field.
 *
 *   "mask"      mask identifiers and party names, then send
 *   "preview"   mask and RETURN the masked text — send nothing
 *   "as-is"     send unmasked (the lawyer's explicit "Maskelemeden gönder")
 */
const maskModeSchema = z.enum(["mask", "preview", "as-is"], {
  errorMap: () => ({
    message:
      "maskMode alanı zorunludur: 'preview' (önizle, gönderme), 'mask' (maskele ve gönder) " +
      "veya 'as-is' (maskelemeden gönder).",
  }),
});

export const MASK_MODE_REQUIRED_MESSAGE_TR =
  "Bulut yapay zekâya göndermeden önce maskeleme seçimi zorunludur: önce önizlemeyi " +
  "(maskMode:'preview') isteyin, sonra 'mask' ya da 'as-is' seçin.";

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

const analyzeSchema = z
  .object({
    fileId: z.string(REQ).min(1, "Dosya kimliği boş olamaz.").max(200, "En fazla 200 karakter."),
    useCloudAi: z.literal(true, {
      errorMap: () => ({ message: "useCloudAi tam olarak true olmalı." }),
    }),
    focus: z.enum(["dilekce", "sozlesme", "genel"]).optional(),
    // B-23: mandatory, no default (see maskModeSchema).
    maskMode: maskModeSchema,
    /** Matter whose party names should be masked, when known. */
    matterId: z.string().max(200).optional(),
  })
  .strict("Tanınmayan alan.");

const draftParagraphSchema = z
  .object({
    draftId: z.string(REQ).min(1, "Taslak kimliği boş olamaz.").max(200),
    sectionId: z.string(REQ).min(1, "Bölüm kimliği boş olamaz.").max(200),
    paragraphId: z.string(REQ).min(1).max(200).optional(),
    insertAfter: z.string(REQ).min(1).max(200).optional(),
    instructions: z
      .string(REQ)
      .min(1, "Talimat boş olamaz.")
      .max(4000, "En fazla 4.000 karakter."),
    evidenceIds: z
      .array(z.string(REQ).min(1, "Kanıt kimliği boş olamaz.").max(200))
      .max(12, "En fazla 12 kanıt."),
    useCloudAi: z.literal(true, {
      errorMap: () => ({ message: "useCloudAi tam olarak true olmalı." }),
    }),
    length: z.enum(["normal", "uzun"]).optional(),
  })
  .strict("Tanınmayan alan.");

/* ----------------------------- helpers ------------------------------- */

function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Invalid literal value")) return "useCloudAi tam olarak true olmalı.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

function invalid(c: Context, message: string, issues: { path: string; message: string }[] = []) {
  return c.json({ error: { kind: "INVALID_REQUEST", message, issues } }, 400);
}

function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  // V-19: an unrecognized key is reported at the PARENT object's path with
  // the key names in `keys`. Two stray fields are TWO issues, each named by
  // its own path — joining them into one dotted string ("a.b") read as a
  // nested path that does not exist.
  return fieldIssues(error, turkishZodMessage);
}

function consentRequired(c: Context) {
  return c.json({ error: { kind: "AI_CONSENT_REQUIRED", message: AI_CONSENT_MESSAGE } }, 400);
}

function notConfigured(c: Context) {
  return c.json({ error: { kind: "AI_NOT_CONFIGURED", message: AI_NOT_CONFIGURED_MESSAGE } }, 503);
}

/** Typed mapping of an adapter failure; never echoes a body or the key. */
function upstreamFailure(c: Context, error: AnthropicApiError, log: (line: string) => void) {
  log(`[collex-ai] upstream failure code=${error.code}${error.status !== undefined ? ` status=${error.status}` : ""}`);
  switch (error.code) {
    case "TIMEOUT":
      return c.json(
        {
          error: {
            kind: "AI_TIMEOUT",
            message: "Bulut yapay zekâ süresinde yanıt vermedi (60 sn; OCR 300 sn) — yeniden deneyin.",
          },
        },
        504,
      );
    case "NETWORK":
      return c.json(
        {
          error: {
            kind: "AI_UPSTREAM_UNAVAILABLE",
            message: "Anthropic API'ye ulaşılamadı (ağ hatası); bağlantıyı kontrol edip yeniden deneyin.",
          },
        },
        502,
      );
    case "REFUSAL":
      return c.json(
        {
          error: {
            kind: "AI_REFUSED",
            message: "Model isteği reddetti (güvenlik sınıflandırması); çıktı üretilmedi.",
          },
        },
        502,
      );
    case "TRUNCATED":
      return c.json(
        {
          error: {
            kind: "AI_OUTPUT_TRUNCATED",
            message: "Model çıktısı uzunluk sınırında kesildi; daha az sayfa veya parça ile yeniden deneyin.",
          },
        },
        502,
      );
    case "MALFORMED":
      return c.json(
        {
          error: {
            kind: "AI_MALFORMED_OUTPUT",
            message: "Model beklenen yapıda cevap vermedi; hiçbir tespit yazılmadı.",
          },
        },
        502,
      );
    case "CONFIG":
      return notConfigured(c);
    case "HTTP":
    default: {
      if (error.status === 401 || error.status === 403) {
        return c.json(
          {
            error: {
              kind: "AI_AUTH_FAILED",
              message: `Anthropic API anahtarı reddedildi (HTTP ${error.status}); anahtarı kontrol edin.`,
            },
          },
          502,
        );
      }
      if (error.status === 429) {
        return c.json(
          {
            error: {
              kind: "AI_RATE_LIMITED",
              message: "Anthropic API istek sınırı aşıldı (HTTP 429); kısa bir süre sonra yeniden deneyin.",
            },
          },
          503,
        );
      }
      return c.json(
        {
          error: {
            kind: "AI_UPSTREAM_FAILED",
            message: `Anthropic API isteği başarısız oldu (HTTP ${error.status ?? "?"}).`,
          },
        },
        502,
      );
    }
  }
}

function unexpectedFailure(c: Context, error: unknown, log: (line: string) => void) {
  const name = (error as { name?: unknown } | null)?.name;
  log(`[collex-ai] unexpected failure name=${typeof name === "string" ? name : "unknown"}`);
  return c.json(
    {
      error: {
        kind: "AI_FAILED",
        message: "Bulut yapay zekâ isteği beklenmedik biçimde sonlandı; sistemi başlatan kişiye bildirin.",
      },
    },
    500,
  );
}

/* ------------------------------ router ------------------------------- */

export function createAiRouter(deps: AiRouterDeps): Hono {
  const app = new Hono();
  // W20: the data boundary is enforced HERE, before any handler: under
  // LOCAL_ONLY no POST under /v1/ai/* runs, so no document byte reaches the
  // cloud provider however the key is configured. GET (status, ledger)
  // stays readable.
  app.use("/v1/ai/*", async (c, next) => {
    if (c.req.method !== "GET" && deps.dataBoundary?.() === "LOCAL_ONLY") {
      return c.json(
        {
          error: {
            kind: "DATA_BOUNDARY_LOCAL_ONLY",
            message:
              "Veri sınırı yalnız yerel: bulut yapay zekâ kullanılamaz;" +
              " belge bu bilgisayardan dışarı gönderilmedi.",
          },
        },
        403,
      );
    }
    await next();
  });
  const now = deps.now ?? (() => new Date());
  const tenantId = deps.tenantId ?? LOCAL_TENANT_ID;
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const config = deps.config;

  const ledger: AiLedger = deps.aiLedger ?? new InMemoryAiLedger();

  /**
   * The ceiling check every cloud route runs BEFORE it builds a request.
   * Returns the typed 429 to send, or undefined to proceed.
   */
  const refuseOverCeiling = async (c: Context): Promise<Response | undefined> => {
    const usage = await ledger.usage(now());
    const reason = overCeiling(usage);
    if (reason === undefined) return undefined;
    return c.json(
      {
        error: {
          kind: AI_RATE_LIMITED_KIND,
          message: aiRateLimitedMessage(reason),
          limits: {
            callsPerHour: AI_MAX_CALLS_PER_HOUR,
            inputTokensPerDay: AI_MAX_INPUT_TOKENS_PER_DAY,
          },
          usage,
        },
      },
      429,
    );
  };

  /** Mask a body of text for a request, resolving matter party names. */
  const maskFor = async (text: string, matterId?: string): Promise<MaskResult> => {
    let parties: MaskParties | undefined;
    if (matterId !== undefined && matterId !== "" && deps.matterParties !== undefined) {
      try {
        parties = await deps.matterParties(matterId);
      } catch {
        // A matter lookup failure must not silently DISABLE masking of the
        // identifiers, which need no lookup at all.
        parties = undefined;
      }
    }
    return maskDocumentText(text, parties ?? {});
  };

  /** Record one cloud call. Best-effort: never blocks or fails the request. */
  const recordCall = (entry: Omit<AiLedgerEntry, "at">): void => {
    void ledger.record({ at: now().toISOString(), ...entry });
  };

  let adapter: AnthropicAnswerAdapter | undefined = deps.adapter;
  const getAdapter = (): AnthropicAnswerAdapter | undefined => {
    if (adapter === undefined && config !== null) {
      adapter = createAiAdapter(config, deps.fetchImpl);
    }
    return adapter;
  };

  app.get("/v1/ai/status", async (c) => {
    const configured = config !== null;
    const notes: string[] = [
      // W15: "istek gövdesi useCloudAi:true taşırken" ifadesi avukat diline
      // çevrildi; kurulum koşulu (anahtar) teknik adıyla parantezde kaldı.
      "Bulut yapay zekâ varsayılan olarak KAPALIDIR; yalnızca bu bilgisayarda bulut anahtarı " +
        "tanımlıyken ve siz o istekte onay kutusunu işaretlediğinizde çalışır " +
        "(teknik adı: ANTHROPIC_API_KEY).",
      "Onay her istek için ayrı verilir: onayladığınız istekte seçilen belge bölümleri, taslaktaki " +
        "alıntılar veya yüklediğiniz PDF Anthropic sunucularına gönderilir — veri bu bilgisayardan ÇIKAR.",
      "Model çıktısı hiçbir zaman doğrudan kaynak sayılmaz: analiz alıntıları belge metniyle birebir, " +
        `paragraf bağları entailment eşiğiyle (≥%${Math.round(ENTAILMENT_THRESHOLD * 100)}) doğrulanır; ` +
        "OCR metni sağlama başlığı taşır.",
      configured
        ? `Model: ${config.model}. Daha yüksek kalite için COLLEX_AI_MODEL=${HIGHER_QUALITY_AI_MODEL} ` +
          "(daha pahalı)."
        : "Model tanımlı değil (anahtar yok).",
      ...(configured ? config.warnings : []),
      ...(AI_LIVE_TESTED
        ? []
        : [
            "Canlı sınanmadı: bu ortamda hiçbir gerçek Anthropic çağrısı yapılmadı; ilk kanıt " +
              "control-plane/scripts/ai-live-smoke.mjs olacaktır.",
          ]),
    ];
    const current = adapter ?? deps.adapter;
    // B-23: the ceiling and today's consumption, so "Bugün: N çağrı / ~M
    // jeton" is a fact the lawyer can read rather than a number on an
    // Anthropic invoice at the end of the month.
    const window = await ledger.usage(now());
    return c.json(
      {
        configured,
        model: configured ? config.model : null,
        consent: "per-request",
        dataLeavesMachine: true,
        notes,
        liveTested: AI_LIVE_TESTED,
        provider: "anthropic",
        // Additive (W14 B-23).
        limits: {
          callsPerHour: AI_MAX_CALLS_PER_HOUR,
          inputTokensPerDay: AI_MAX_INPUT_TOKENS_PER_DAY,
        },
        today: window,
        masking: {
          required: true,
          modes: ["preview", "mask", "as-is"],
          note:
            "Gönderimden önce maskeleme seçimi zorunludur; önizleme metnin " +
            "tamamını gösterir. Maskeleme kural tabanlıdır (ad, TCKN, VKN, " +
            "IBAN, telefon) ve eksik kalabilir — metni okuyun.",
        },
        ...(current !== undefined ? { usage: { ...current.usage, calls: current.calls } } : {}),
      },
      200,
    );
  });

  /**
   * B-23 (b): the ledger the lawyer reads in Ayarlar › "Bulut AI kayıt
   * defteri". Never carries document text — see src/ai/ledger.ts.
   */
  app.get("/v1/ai/ledger", async (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 50;
    const [entries, window] = await Promise.all([ledger.list(limit), ledger.usage(now())]);
    return c.json({
      schema: "collex.ai.ledger/v1",
      entries,
      today: window,
      limits: {
        callsPerHour: AI_MAX_CALLS_PER_HOUR,
        inputTokensPerDay: AI_MAX_INPUT_TOKENS_PER_DAY,
      },
      note:
        "Bu kayıt defteri yalnızca çağrının şeklini tutar: tarih, uç, dosya, " +
        "karakter sayısı, model. Belge metni, istem ve model çıktısı SAKLANMAZ.",
    });
  });

  /* ---------------------- analyze-document -------------------------- */

  app.post("/v1/ai/analyze-document", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, "İstek gövdesi JSON olmalı.");
    }
    if ((body as { useCloudAi?: unknown } | null)?.useCloudAi !== true) return consentRequired(c);
    if (config === null) return notConfigured(c);

    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(c, "Belge analizi isteği doğrulanamadı — eksik veya hatalı alanlar var.", zodIssues(parsed.error));
    }
    const focus: AnalyzeFocus = parsed.data.focus ?? "genel";

    if (deps.files === undefined) {
      return c.json(
        {
          error: {
            kind: "STORE_UNAVAILABLE",
            message: "Dosya deposu bu örnekte yapılandırılmamış; belge analizi yapılamaz.",
          },
        },
        503,
      );
    }
    let chunks;
    try {
      chunks = await deps.files.getChunks([parsed.data.fileId], tenantId);
    } catch {
      return c.json(
        {
          error: {
            kind: "STORE_UNAVAILABLE",
            message: "Dosya deposuna ulaşılamadı (yerel Postgres kapalı olabilir).",
          },
        },
        503,
      );
    }
    if (chunks.length === 0) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }

    const selection = selectChunksWithinBudget(chunks, deps.analysisTokenBudget ?? ANALYSIS_TOKEN_BUDGET);
    const fileName = chunks[0]?.fileName ?? parsed.data.fileId;

    // ---- B-23: mask, preview, count ------------------------------------
    // The chunks are masked INDIVIDUALLY so offsets within a chunk stay the
    // chunk's own and the model still sees the document's structure.
    const maskMode = parsed.data.maskMode;
    const maskedChunks = [] as { chunkId: string; ordinal: number; text: string }[];
    let maskSummary: MaskResult = { text: "", masked: [], clean: true };
    if (maskMode === "as-is") {
      for (const chunk of selection.selected) {
        maskedChunks.push({ chunkId: chunk.chunkId, ordinal: chunk.ordinal, text: chunk.text });
      }
    } else {
      const counts = new Map<string, { kind: MaskResult["masked"][number]["kind"]; label: string; count: number }>();
      for (const chunk of selection.selected) {
        const result = await maskFor(chunk.text, parsed.data.matterId);
        maskedChunks.push({ chunkId: chunk.chunkId, ordinal: chunk.ordinal, text: result.text });
        for (const entry of result.masked) {
          const seen = counts.get(entry.kind);
          if (seen === undefined) counts.set(entry.kind, { ...entry });
          else seen.count += entry.count;
        }
      }
      const masked = [...counts.values()];
      maskSummary = { text: "", masked, clean: masked.length === 0 };
    }

    // "preview" sends NOTHING. The lawyer sees exactly what would leave the
    // machine and then chooses; there is no path where text is sent without
    // having been shown first.
    if (maskMode === "preview") {
      return c.json(
        {
          schema: "collex.ai.mask-preview/v1",
          fileId: parsed.data.fileId,
          fileName,
          maskMode,
          masked: maskSummary.masked,
          clean: maskSummary.clean,
          summary: describeMask(maskSummary),
          chunksAnalyzed: maskedChunks.length,
          chunksTotal: chunks.length,
          preview: maskedChunks.map((chunk) => ({ chunkId: chunk.chunkId, text: chunk.text })),
          sent: false,
        },
        200,
      );
    }

    const overCeilingResponse = await refuseOverCeiling(c);
    if (overCeilingResponse !== undefined) return overCeilingResponse;

    const ai = getAdapter();
    if (ai === undefined) return notConfigured(c);

    try {
      const { value, usage } = await ai.analyzeDocument({
        fileName,
        focus,
        chunks: maskedChunks,
      });
      recordCall({
        route: "analyze-document",
        model: config.model,
        chars: maskedChunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
        inputTokens: Number((usage as { inputTokens?: number })?.inputTokens ?? 0),
        fileId: parsed.data.fileId,
        ...(parsed.data.matterId !== undefined ? { matterId: parsed.data.matterId } : {}),
        masked: maskMode === "mask",
      });
      // Verification runs against the MASKED chunks that were actually
      // sent: an exact-quote check against the unmasked original would pass
      // for text the model never saw, which is the opposite of a check.
      const verified = verifyAnalysis(
        value,
        selection.selected.map((chunk, index) => ({
          ...chunk,
          text: maskedChunks[index]?.text ?? chunk.text,
        })),
        focus,
      );
      const warnings = [...selection.warnings];
      if (maskMode === "mask" && !maskSummary.clean) {
        warnings.push(describeMask(maskSummary));
      }
      if (maskMode === "as-is") {
        warnings.push(
          "Bu belge MASKELENMEDEN gönderildi: kişisel veriler (ad, TCKN, IBAN, telefon) " +
            "olduğu gibi Anthropic sunucularına ulaştı.",
        );
      }
      if (verified.kaynaksizCount > 0) {
        warnings.push(
          `${verified.kaynaksizCount} tespit KAYNAKSIZ: alıntısı belge metninde birebir bulunamadı; ` +
            "tespit silinmedi, işaretlendi.",
        );
      }
      const response: DocumentAnalysisBody = {
        schema: DOCUMENT_ANALYSIS_SCHEMA,
        fileId: parsed.data.fileId,
        fileName,
        focus,
        model: config.model,
        chunksAnalyzed: maskedChunks.length,
        chunksTotal: chunks.length,
        // Additive (B-23): what was hidden before sending.
        maskMode,
        masked: maskSummary.masked,
        ...verified,
        ozet: sanitizeMarkdown(verified.ozet),
        warnings,
        disclaimer: ANALYSIS_DISCLAIMER,
        usage,
        liveTested: false,
      };
      return c.json(response, 200);
    } catch (error) {
      if (error instanceof AnthropicApiError) return upstreamFailure(c, error, log);
      return unexpectedFailure(c, error, log);
    }
  });

  /* ------------------------------ ocr ------------------------------- */

  app.post("/v1/ai/ocr", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return invalid(c, "multipart/form-data gövdesi, 'file' alanı ve useCloudAi=true gerekli.");
    }
    if (body["useCloudAi"] !== "true" && body["useCloudAi"] !== true) return consentRequired(c);
    if (config === null) return notConfigured(c);

    const upload = body["file"];
    if (
      upload === null ||
      upload === undefined ||
      typeof upload === "string" ||
      typeof (upload as File).arrayBuffer !== "function"
    ) {
      return invalid(c, "'file' alanında bir PDF dosyası bekleniyor.", [
        { path: "file", message: "Bu alan zorunludur." },
      ]);
    }
    const file = upload as File;
    if (file.size > OCR_MAX_BYTES) {
      return c.json(
        {
          error: {
            kind: "PAYLOAD_TOO_LARGE",
            message: `PDF boyutu sınırı aşıldı: ${file.size} > ${OCR_MAX_BYTES} bayt (32 MB).`,
          },
        },
        413,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      return c.json(
        {
          error: {
            kind: "UNSUPPORTED_TYPE",
            message: "Yalnızca PDF kabul edilir (dosya PDF imzası taşımıyor).",
          },
        },
        415,
      );
    }
    const pageCount = estimatePdfPageCount(bytes);
    if (pageCount !== undefined && pageCount > OCR_MAX_PAGES) {
      return c.json(
        {
          error: {
            kind: "PAYLOAD_TOO_LARGE",
            message: `PDF sayfa sınırı aşıldı: ${pageCount} > ${OCR_MAX_PAGES} sayfa.`,
          },
        },
        413,
      );
    }

    // B-23: the OCR route sends WHOLE PDF PAGES to the model, so it is the
    // most expensive path per call and the one a loop would abuse first.
    const ocrOverCeiling = await refuseOverCeiling(c);
    if (ocrOverCeiling !== undefined) return ocrOverCeiling;

    const ai = getAdapter();
    if (ai === undefined) return notConfigured(c);
    const fileName = file.name === "" ? "belge.pdf" : file.name;

    try {
      const run = await transcribePdf(ai, {
        bytes,
        fileName,
        pageCount,
        ...(deps.ocrBatchSize !== undefined ? { batchSize: deps.ocrBatchSize } : {}),
      });
      const header = buildProvenanceHeader(fileName, now(), config.model);
      const text = run.pages.map((page) => page.text).join(PAGE_SEPARATOR);
      recordCall({
        route: "ocr",
        model: config.model,
        chars: bytes.length,
        inputTokens: Number((run.usage as { inputTokens?: number })?.inputTokens ?? 0),
        // OCR sends the PDF ITSELF; there is nothing to mask in an image.
        // The ledger says so honestly rather than claiming masking happened.
        masked: false,
      });
      return c.json(
        {
          schema: OCR_SCHEMA,
          fileName,
          pageCount: run.pageCount,
          pages: run.pages,
          text,
          warnings: run.warnings,
          provenanceHeader: header,
          model: config.model,
          usage: run.usage,
          requests: run.requests,
          /** Console handoff: upload this as a new TXT through POST /v1/files. */
          upload: {
            fileName: ocrUploadName(fileName),
            text: renderUploadText(header, run.pages),
          },
          liveTested: false,
        },
        200,
      );
    } catch (error) {
      if (error instanceof AnthropicApiError) return upstreamFailure(c, error, log);
      return unexpectedFailure(c, error, log);
    }
  });

  /* ------------------------- draft-paragraph ------------------------ */

  app.post("/v1/ai/draft-paragraph", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, "İstek gövdesi JSON olmalı.");
    }
    if ((body as { useCloudAi?: unknown } | null)?.useCloudAi !== true) return consentRequired(c);
    if (config === null) return notConfigured(c);

    const parsed = draftParagraphSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(c, "Paragraf isteği doğrulanamadı — eksik veya hatalı alanlar var.", zodIssues(parsed.error));
    }
    const request = parsed.data;
    if (request.paragraphId !== undefined && request.insertAfter !== undefined) {
      return invalid(c, "paragraphId ve insertAfter birlikte verilemez.", [
        { path: "insertAfter", message: "paragraphId ile birlikte kullanılamaz." },
      ]);
    }
    if (AI_LOCKED_SECTION_IDS.has(request.sectionId)) {
      return invalid(c, AI_LOCKED_SECTION_MESSAGE_TR, [{ path: "sectionId", message: AI_LOCKED_SECTION_MESSAGE_TR }]);
    }
    if (deps.drafts === undefined || deps.revise === undefined) {
      return c.json(
        {
          error: {
            kind: "DRAFTING_UNAVAILABLE",
            message: "Taslak deposu veya düzenleyici bu örnekte bağlı değil; paragraf yazılamaz.",
          },
        },
        503,
      );
    }

    await deps.drafts.warm?.(request.draftId);
    const draft = deps.drafts.get(request.draftId);
    if (draft === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);
    }
    const section = draft.sections.find((s) => s.id === request.sectionId);
    if (section === undefined) {
      return invalid(c, "Taslakta böyle bir bölüm yok.", [
        { path: "sectionId", message: `'${request.sectionId}' kimlikli bölüm bulunamadı.` },
      ]);
    }
    const evidenceById = new Map(draft.evidence.map((entry) => [entry.evidenceId, entry]));
    const unknown = request.evidenceIds.filter((id) => !evidenceById.has(id));
    if (unknown.length > 0) {
      return invalid(c, "Seçilen kanıtlar taslağın kanıt listesinde yok.", [
        { path: "evidenceIds", message: `Bilinmeyen kanıt: ${unknown.join(", ")}` },
      ]);
    }
    const subset = request.evidenceIds.map((id) => evidenceById.get(id)!);
    const anchorId = request.paragraphId ?? request.insertAfter;
    const anchor = anchorId !== undefined ? section.paragraphs.find((p) => p.id === anchorId) : undefined;
    if (anchorId !== undefined && anchor === undefined) {
      const path = request.paragraphId !== undefined ? "paragraphId" : "insertAfter";
      return invalid(c, "Bölümde böyle bir paragraf yok.", [
        { path, message: `'${anchorId}' kimlikli paragraf bulunamadı.` },
      ]);
    }

    const paragraphOverCeiling = await refuseOverCeiling(c);
    if (paragraphOverCeiling !== undefined) return paragraphOverCeiling;

    const ai = getAdapter();
    if (ai === undefined) return notConfigured(c);
    const warnings: string[] = [];

    try {
      const written = await ai.writeParagraph({
        instructions: request.instructions,
        draftTitle: draft.title,
        sectionTitle: section.title,
        kind: draft.kind,
        length: request.length ?? "normal",
        evidence: subset.map((entry) => ({
          evidenceId: entry.evidenceId,
          label: entry.label,
          quote: entry.quote,
        })),
        ...(request.paragraphId !== undefined && anchor !== undefined ? { existingText: anchor.text } : {}),
        ...(request.insertAfter !== undefined && anchor !== undefined ? { contextBefore: anchor.text } : {}),
      });
      let usage = written.usage;
      recordCall({
        route: "draft-paragraph",
        model: config.model,
        chars:
          request.instructions.length +
          subset.reduce((sum, entry) => sum + entry.quote.length, 0),
        inputTokens: Number((written.usage as { inputTokens?: number })?.inputTokens ?? 0),
        draftId: request.draftId,
        sectionId: request.sectionId,
        // Evidence quotes are bound to hashed passages: masking them would
        // break the exact-quote verification this product is built on.
        // The ledger records that fact instead of hiding it.
        masked: false,
      });
      // Model output is untrusted text: sanitize before it enters a draft.
      const text = sanitizeMarkdown(written.value.text).trim();
      if (text === "") {
        return c.json(
          {
            error: {
              kind: "AI_MALFORMED_OUTPUT",
              message: "Model boş bir paragraf döndürdü; taslak değiştirilmedi.",
            },
          },
          502,
        );
      }

      // Entailment judge per cited evidence; strip below the threshold.
      const rows: EntailmentRow[] = [];
      const retrievedAt = now().toISOString();
      for (const evidenceId of written.value.evidenceIds) {
        const entry = evidenceById.get(evidenceId);
        if (entry === undefined) continue; // adapter already filtered; defense in depth
        let judgement: Awaited<ReturnType<typeof ai.assess>>;
        try {
          judgement = await ai.assess(text, toEvidenceRef(entry, retrievedAt));
        } catch (error) {
          // W21 R2-29: one unreadable or self-contradicting judgement (the
          // adapter throws MALFORMED) is a binding the judge did not check,
          // not a reason to throw away the paid paragraph and every other
          // id's valid judgement with a 502. That binding is not kept and
          // the answer says it was not checked. Transport failures still
          // fail the request as before.
          if (error instanceof AnthropicApiError && error.code === "MALFORMED") {
            rows.push(uncheckedRow(evidenceId));
            continue;
          }
          throw error;
        }
        rows.push(judgeRow(evidenceId, judgement));
      }
      usage = ai.usage; // running total includes the judge calls
      const kept = rows.filter((row) => row.kept);
      const unchecked = rows.filter((row) => row.checked === false);
      const stripped = rows.filter((row) => !row.kept && row.checked !== false);
      if (unchecked.length > 0) {
        warnings.push(
          `${unchecked.length} kanıt bağı denetlenemedi (hakemin yanıtı okunamadı ya da kendi içinde ` +
            `çelişkiliydi) ve paragrafa yazılmadı: ${unchecked.map((r) => r.evidenceId).join(", ")}.`,
        );
      }
      if (stripped.length > 0) {
        warnings.push(
          `${stripped.length} kanıt bağı entailment eşiğinin (≥%${Math.round(ENTAILMENT_THRESHOLD * 100)}) ` +
            `altında kaldı ve paragrafa yazılmadı: ${stripped.map((r) => r.evidenceId).join(", ")}.`,
        );
      }
      if (written.value.evidenceIds.length === 0 && subset.length > 0) {
        warnings.push("Model verilen kanıtlardan hiçbirine dayanmadı; paragraf KAYNAKSIZ işaretlendi.");
      }
      const kaynakli = kept.length > 0;
      // R2-29: with nothing kept, an unchecked binding gets the "denetlenemedi"
      // note, never the measured-shortfall NOTE_AI_KAYNAKSIZ.
      const note = aiParagraphNote(rows);
      const paragraphId = request.paragraphId ?? newParagraphId(section.id);
      const patchParagraph: DraftPatchParagraph = {
        id: paragraphId,
        text,
        evidenceIds: kept.map((row) => row.evidenceId),
        role: pickRole(section, request),
        ...(kaynakli
          ? {
              binding: {
                kind: "entailment" as const,
                score: Math.min(...kept.map((row) => row.score)),
                judge: config.model,
              },
            }
          : {}),
        note,
        supported: kaynakli,
      };
      const built = buildParagraphPatch(
        draft,
        {
          sectionId: request.sectionId,
          ...(request.paragraphId !== undefined ? { paragraphId: request.paragraphId } : {}),
          ...(request.insertAfter !== undefined ? { insertAfter: request.insertAfter } : {}),
        },
        patchParagraph,
        aiRevisionNote(config.model, kaynakli),
      );
      if (built.patch === undefined) {
        return invalid(c, "Paragraf hedefi bulunamadı.", built.issues);
      }

      const idsBefore = paragraphIds(draft);
      const revised = deps.revise(draft, built.patch, { trustEntailment: true, now });
      const result = revised.draft;
      // Post-condition: the AI paragraph carries the AI note; a stricter
      // verdict from the reviser (supported:false despite kept evidence) is
      // never overridden — it is surfaced instead.
      // W21: located by id OR, on append/insertAfter, as the new paragraph the
      // product reviser renamed (drafting/revise.ts gives an id it does not
      // know a fresh one); the old id-only lookup missed it and reported the
      // judge's verdict for a paragraph saved as KAYNAKSIZ.
      const located = locateRevisedParagraph(result, idsBefore, {
        sectionId: request.sectionId,
        paragraphId,
        text,
      });
      // W21: the response's `kaynakli` is the SAVED paragraph's state: true
      // only when a binding the judge kept is attached to the paragraph the
      // reviser saved as supported (the console reads it as "kaynaklı sayıldı").
      let sourced = false;
      let responseParagraph: AiDraftParagraph | DraftPatchParagraph;
      if (located !== undefined) {
        responseParagraph = located.paragraph;
        const keptIds = new Set(kept.map((row) => row.evidenceId));
        const attachedKept = located.paragraph.evidenceIds.filter((id) => keptIds.has(id));
        if (kaynakli && (located.paragraph.supported === false || attachedKept.length === 0)) {
          // W21: not NOTE_AI_KAYNAKSIZ ("hiçbir kanıt eşiği geçmedi"): a
          // binding did pass the judge; the reviser's rules rejected it.
          located.paragraph.note = NOTE_AI_KAYNAKSIZ_DUZENLEYICI;
          if (located.paragraph.supported !== false) {
            located.paragraph.supported = false;
            result.unsupportedCount = recountUnsupported(result);
          }
          warnings.push("Düzenleyici paragrafın kanıt bağını kabul etmedi; paragraf KAYNAKSIZ işaretlendi.");
        } else if (!kaynakli && located.paragraph.supported !== false) {
          located.paragraph.supported = false;
          located.paragraph.note = note;
          result.unsupportedCount = recountUnsupported(result);
        } else {
          located.paragraph.note = note;
          sourced = kaynakli;
          // W21: a kept binding the reviser dropped while keeping another is
          // named, so no reader takes every judge-kept row as written.
          const dropped = kept.filter((row) => !located.paragraph.evidenceIds.includes(row.evidenceId));
          if (sourced && dropped.length > 0) {
            warnings.push(
              `${dropped.length} kanıt bağı entailment denetimini geçti, ancak taslağın dayanak kurallarınca ` +
                `kabul edilmedi ve paragrafa yazılmadı: ${dropped.map((row) => row.evidenceId).join(", ")}.`,
            );
          }
        }
      } else {
        // Fail closed: a paragraph that cannot be found in the saved draft is
        // not reported as sourced, whatever the judge said.
        responseParagraph = { ...patchParagraph, supported: false };
        warnings.push(
          "Düzenleyici yeni paragrafı kaydedilen taslakta bırakmadı ya da paragraf orada bulunamadı; " +
            "paragraf kaynaklı sayılmadı. Taslak yine de kaydedildi; taslağı açıp denetleyin.",
        );
      }
      if (kaynakli && !sourced) {
        // W21: the reviser copied the judge-time note ("— kaynaklı") into the
        // draft's warnings; the saved paragraph is KAYNAKSIZ, so the line is too.
        const judgedLine = revisionNoteWarning(aiRevisionNote(config.model, true));
        const finalLine = revisionNoteWarning(aiRevisionNote(config.model, false));
        result.warnings = result.warnings.map((line) => (line === judgedLine ? finalLine : line));
      }
      // R2-29: "kaynak bağları entailment ile doğrulandı" is not written for a
      // paragraph whose only bindings were never checked.
      for (const line of aiParagraphDraftWarnings(rows)) {
        if (!result.warnings.includes(line)) result.warnings.push(line);
      }
      deps.drafts.put(result);
      // W12-FIX: a paid paragraph that did not reach the database is said so.
      const persisted = deps.drafts.persisted === undefined ? true : await deps.drafts.persisted(result.draftId);
      if (!persisted) warnings.push(DRAFT_PERSIST_FAILED_MESSAGE_TR);

      return c.json(
        {
          draft: { ...result, persisted },
          persisted,
          paragraph: responseParagraph,
          entailment: rows.map((row) => ({
            evidenceId: row.evidenceId,
            score: row.score,
            entails: row.entails,
            kept: row.kept,
            rationale: row.rationale,
            // R2-29: only on a binding the judge could not check.
            ...(row.checked === false ? { checked: false } : {}),
          })),
          threshold: ENTAILMENT_THRESHOLD,
          kaynakli: sourced,
          warnings,
          issues: revised.issues,
          model: config.model,
          usage,
          liveTested: false,
        },
        200,
      );
    } catch (error) {
      if (error instanceof AnthropicApiError) return upstreamFailure(c, error, log);
      return unexpectedFailure(c, error, log);
    }
  });

  return app;
}

/**
 * The draft warning drafting/revise.ts writes for a revision note (mirrors its
 * "Düzenleme notu: " line, sanitized and flattened the same way).
 */
function revisionNoteWarning(note: string): string {
  return `Düzenleme notu: ${sanitizeMarkdown(note).replace(/\s*\n+\s*/g, " ").trim()}`;
}

/** Re-exported for the integration lane (type of the mounted draft-store dep). */
export type { AiDraftLike, AiDraftStore, AiFilesPort, ReviseFn };

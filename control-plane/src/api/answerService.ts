/**
 * HTTP-facing glue for the citation-first answer pipeline.
 *
 * Three responsibilities, all deliberately kept OUT of server.ts so they can be
 * unit-tested without a Hono app and reused by scripts/demo.mjs:
 *
 *  1. `answerRequestSchema` — zod validation of the untrusted request body.
 *  2. `clampAnswerLimits` — the server tier is a hard CEILING on retrieval
 *     work. A client may only ask for LESS, never more (same rule the research
 *     budgets already follow in server.ts `clampRequestedBudgets`).
 *  3. `InMemoryAnswerStore` — the bounded run cache that makes
 *     `GET /v1/answers/{runId}/evidence-bundle` possible after a POST.
 *
 * The evidence bundle produced here is `collex.answer.evidence-bundle/v1`, the
 * SAME contract the Python exporter in `export/bundle.py` consumes. The
 * optional `texts` map is the additive field that upgrades the exporter's
 * verification from "the quote re-hashes to its digest" to the full chain
 * "the canonical text hashes to contentSha256 AND the recorded code-point span
 * really yields this exact quote".
 */

import { z } from "zod";
import type { AnswerRun, AnswerRequest } from "../pipeline/answerPipeline.js";
import type { AnswerResult, ExportableEvidenceBundle, FileScopeView } from "../pipeline/types.js";
import type { CorpusSearchLimits } from "../pipeline/ports.js";

/**
 * The pipeline as the API sees it. `AnswerPipeline` satisfies this structurally,
 * so tests inject a fake without constructing a database-backed pipeline.
 */
export interface AnswerPort {
  answer(request: AnswerRequest): Promise<AnswerRun>;
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

export const answerFiltersSchema = z
  .object({
    sources: z.array(z.string().min(1).max(200)).max(50).optional(),
    documentTypes: z.array(z.string().min(1).max(200)).max(50).optional(),
    // Additive (contract D): court/date narrowing, sent only when the user
    // sets it. Plumbed verbatim into the retrieval port's filters.
    courtTypes: z.array(z.string().min(1).max(200)).max(20).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    // Additive (W14 B-16, L-SOURCES IR-5, wired by L-FIX): daire, yıl aralığı
    // and hariç tutulacak kelimeler. `POST /v1/search` accepted these from
    // the day L-SOURCES landed them and `passesCourtDateFilters` applies them
    // for BOTH routes, but `/v1/answer` — the route the console actually
    // asks a question through — rejected them as unknown fields, so
    // "Karar ara" could narrow a search and could not narrow an answer.
    // Bounds are copied from the search schema verbatim so one form cannot
    // accept what the other refuses.
    chambers: z.array(z.string().min(1).max(40)).max(20).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional(),
    // Additive (W12-B, file scope): restrict retrieval to the caller's own
    // uploaded documents; `includeCorpus` unions the public corpus back in.
    fileIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    includeCorpus: z.boolean().optional(),
  })
  .strict();

/** Matter ids are UUIDs (app_private.matters.id); anything else is a 404 upstream. */
const matterIdSchema = z
  .string()
  .uuid("matterId UUID biçiminde olmalı (dava dosyası kimliği).");

/**
 * Query SCOPE — where to look — as opposed to `filters`, which says which
 * documents to keep once found (W19 phase C, `src/matters/scope.ts`).
 *
 * `scope.matterId` is resolved to the matter's own uploads ON THE SERVER, so
 * a browser never has to enumerate (and could not enumerate) the membership
 * of a matter holding a hundred documents. Naming both a matter and explicit
 * `fileIds` VERIFIES the ids against that membership; it never widens past
 * the matter.
 *
 * The `fileIds` cap here is the same 50 as `filters.fileIds` because it
 * bounds what a client may TYPE. A matter expanded server-side is bounded
 * separately by MATTER_SCOPE_MAX_FILES, which is far larger.
 *
 * Legacy `filters.fileIds` / `filters.includeCorpus` keep working unchanged;
 * when both are present, `scope` wins and the legacy pair is ignored.
 */
export const answerScopeSchema = z
  .object({
    matterId: matterIdSchema.optional(),
    fileIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    includeCorpus: z.boolean().optional(),
  })
  .strict();

export const answerLimitsSchema = z
  .object({
    resultLimit: z.number().int().min(1).max(100).optional(),
    lexicalLimit: z.number().int().min(1).max(200).optional(),
    trigramLimit: z.number().int().min(1).max(200).optional(),
    trigramMinSimilarity: z.number().min(0).max(1).optional(),
    perDocumentCap: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const answerRequestSchema = z
  .object({
    question: z.string().min(3, "question must be at least 3 characters").max(2000),
    asOf: isoDate.optional(),
    filters: answerFiltersSchema.optional(),
    limits: answerLimitsSchema.optional(),
    /**
     * Include the canonical document texts in the evidence bundle. Off by
     * default: the texts are large, and only an auditor re-deriving quotes
     * from offsets needs them.
     */
    includeTexts: z.boolean().optional(),
    /**
     * Additive (W12-B/E): route THIS request through the configured cloud
     * ports (consent per request). Unconfigured -> AI_UNAVAILABLE warning and
     * the rule-based drafter continues.
     */
    useCloudAi: z.boolean().optional(),
    /** Additive (W20): draft + verify with the configured local model. */
    useLocalAi: z.boolean().optional(),
    /**
     * Additive (W12-A, contract [M]): file the answer under this matter. The
     * matter must exist (404 MATTER_NOT_FOUND before any retrieval work).
     *
     * This is FILING, not scoping: it says where to put the answer, not
     * where to look for evidence. Use `scope.matterId` to search a matter.
     */
    matterId: matterIdSchema.optional(),
    /**
     * Additive (W19 phase C): where to SEARCH. See `answerScopeSchema`.
     */
    scope: answerScopeSchema.optional(),
  })
  .strict();

export type AnswerApiRequest = z.infer<typeof answerRequestSchema>;

// ---------------------------------------------------------------------------
// Limit clamping
// ---------------------------------------------------------------------------

/**
 * Server tier for one answer. These are the ceilings a client cannot exceed.
 * They bound the work a single unauthenticated question can cause: five
 * retrieval lanes x resultLimit rows, each of which is materialized against a
 * canonical document.
 */
export const DEFAULT_ANSWER_LIMITS: Required<CorpusSearchLimits> = Object.freeze({
  resultLimit: 20,
  lexicalLimit: 40,
  trigramLimit: 40,
  trigramMinSimilarity: 0.35,
  perDocumentCap: 4,
});

/**
 * Clamp requested retrieval limits to the server tier.
 *
 * Count-like dimensions clamp DOWNWARD (`min(requested, tier)`): asking for
 * fewer rows is always allowed, asking for more is not.
 * `trigramMinSimilarity` is inverted — a LOWER threshold means MORE candidate
 * rows — so it clamps UPWARD (`max(requested, tier)`). Both directions say the
 * same thing: a request may only reduce the work the server does.
 */
export function clampAnswerLimits(
  tier: Required<CorpusSearchLimits>,
  requested: CorpusSearchLimits | undefined,
): Required<CorpusSearchLimits> {
  const down = (key: "resultLimit" | "lexicalLimit" | "trigramLimit" | "perDocumentCap"): number => {
    const asked = requested?.[key];
    if (typeof asked !== "number" || !Number.isFinite(asked)) return tier[key];
    return Math.min(asked, tier[key]);
  };
  const asked = requested?.trigramMinSimilarity;
  const similarity =
    typeof asked === "number" && Number.isFinite(asked)
      ? Math.max(asked, tier.trigramMinSimilarity)
      : tier.trigramMinSimilarity;
  return {
    resultLimit: down("resultLimit"),
    lexicalLimit: down("lexicalLimit"),
    trigramLimit: down("trigramLimit"),
    perDocumentCap: down("perDocumentCap"),
    trigramMinSimilarity: similarity,
  };
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

/**
 * The evidence bundle for a completed run, optionally carrying the canonical
 * texts the quotes were sliced from.
 *
 * The texts come from `run.pack.texts`, which `buildEvidencePack` filled with
 * the NFC-normalized canonical text of every document version it actually
 * quoted — the same strings the deterministic validator ran against.
 */
export function buildAnswerBundle(
  run: AnswerRun,
  options: { includeTexts?: boolean } = {},
): ExportableEvidenceBundle {
  const bundle = run.result.bundle;
  if (options.includeTexts !== true) return bundle;
  return { ...bundle, texts: { ...run.pack.texts } };
}

/**
 * Cap on the canonical texts a STORED answer may carry, in UTF-8 bytes
 * (W12-FIX2, review P1-5b). A question over a 3 MB upload stored the whole
 * document text with every answer (one row per question, all of them
 * carrying the same megabytes). Above the cap the bundle is stored WITHOUT
 * `texts`: quotes, offsets and hashes stay, the exporter's full-chain
 * re-slice degrades to hash verification, and the answer says so
 * (STORED_WITHOUT_TEXTS).
 */
export const MAX_STORED_TEXT_BYTES = 5 * 1024 * 1024;

export const STORED_WITHOUT_TEXTS = "STORED_WITHOUT_TEXTS";
export const STORED_WITHOUT_TEXTS_MESSAGE_TR =
  "Kaynak metinleri 5 MB'ı aştığı için cevap kaydına tam metinler yazılmadı; alıntılar ve özetler " +
  "(sağlama değerleri) kayıtta, dışa aktarma alıntı özetiyle doğrular.";

/** UTF-8 size of a texts map (what the jsonb column would hold). */
export function textsByteLength(texts: Readonly<Record<string, string>>): number {
  let total = 0;
  for (const text of Object.values(texts)) total += Buffer.byteLength(text, "utf8");
  return total;
}

/**
 * The bundle to STORE: with canonical texts when they fit `maxBytes`,
 * without them (and `textsOmitted: true`) otherwise.
 */
export function boundedAnswerBundle(
  run: AnswerRun,
  maxBytes: number = MAX_STORED_TEXT_BYTES,
): { bundle: ExportableEvidenceBundle; textsOmitted: boolean; textBytes: number } {
  const textBytes = textsByteLength(run.pack.texts);
  if (textBytes > maxBytes) {
    return { bundle: buildAnswerBundle(run, { includeTexts: false }), textsOmitted: true, textBytes };
  }
  return { bundle: buildAnswerBundle(run, { includeTexts: true }), textsOmitted: false, textBytes };
}

// ---------------------------------------------------------------------------
// Answer store contract (W12-A, contract [P])
// ---------------------------------------------------------------------------

/** Which pipeline produced an answer: the local corpus or live research. */
export type AnswerMode = "local" | "live";

export interface StoredAnswer {
  runId: string;
  result: AnswerResult;
  /** Bundle WITH canonical texts; the GET route drops them unless asked. */
  bundle: ExportableEvidenceBundle;
  storedAt: string;
  /** Additive: producing pipeline; absent means "local". */
  mode?: AnswerMode;
  /** Additive: the question, denormalized for listings (falls back to result.question). */
  question?: string;
  /**
   * Additive: the matter (dava dosyası) this answer is filed under. `null` =
   * explicitly none; absent = unspecified (a re-put keeps the stored value).
   */
  matterId?: string | null;
}

/** Listing row for GET /v1/answers and the matter page (no texts, no evidence). */
export interface AnswerSummary {
  runId: string;
  question: string;
  status: string;
  mode: AnswerMode;
  matterId: string | null;
  createdAt: string;
  evidenceCount: number;
  finalizable: boolean;
  /**
   * Additive (W12-API2): the file scope the answer was restricted to, read
   * from the stored `result.fileScope`. Present only for an answer asked
   * over the lawyer's own uploads ("Belge" in the console); absent for a
   * corpus or live answer.
   */
  fileScope?: FileScopeView;
  /**
   * Additive (W14 B-26): the title of the matter the answer is filed under,
   * so the listing does not need one GET /v1/matters/{id} per row (the
   * console's N+1). Absent for an answer with no matter, and for stores that
   * cannot join (the in-memory one).
   */
  matterTitle?: string;
}

/**
 * The four statuses `/v1/answers?status=` accepts (W14 B-26). Anything else
 * is a 400: the filter used to be dropped on the floor while the console
 * believed it had filtered.
 */
export const ANSWER_STATUSES = ["COMPLETE", "QUALIFIED", "PARTIAL", "ABSTAIN"] as const;
export type AnswerStatusFilter = (typeof ANSWER_STATUSES)[number];

/** Filters of `AnswerStore.list` (every field optional; combinable). */
export interface AnswerListOptions {
  matterId?: string;
  limit?: number;
  /**
   * Additive (W12-API2): only answers whose `fileScope.fileIds` contains
   * this upload id (the questions asked over one document).
   */
  fileId?: string;
  /**
   * Additive (W14 B-26): case-insensitive substring of the QUESTION. The
   * parameter existed on the wire and was silently ignored — the worst
   * failure mode, because the screen looked filtered.
   */
  q?: string;
  /** Additive (W14 B-26): one of ANSWER_STATUSES. */
  status?: string;
}

/** Turkish-insensitive "contains" used by every AnswerStore's `q` filter. */
export function questionMatchesQuery(question: string, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (needle === "") return true;
  return question.toLocaleLowerCase("tr-TR").includes(needle);
}

/**
 * What the API and the matters router talk to. `put`/`get` are synchronous
 * (the HTTP route stores the answer it just produced and answers at once);
 * the optional async members are what a durable store adds:
 *
 *  - `warm(runId)`  load a runId that is not in memory (after a restart, or
 *                   after cache eviction) so that a following `get` finds it;
 *  - `list(opts)`   newest-first summaries, optionally filtered by matter
 *                   and/or by an upload id in the answer's file scope;
 *  - `attach(runId, matterId)` file an answer under a matter (null detaches).
 *
 * Callers use `await store.warm?.(runId)` before `store.get(runId)`; a store
 * without `warm` (this in-memory one) simply serves its cache.
 */
export interface AnswerStore {
  put(entry: StoredAnswer): void;
  get(runId: string): StoredAnswer | undefined;
  warm?(runId: string): Promise<void>;
  list?(opts?: AnswerListOptions): Promise<AnswerSummary[]>;
  attach?(runId: string, matterId: string | null): Promise<void>;
  /**
   * Additive (W12-FIX): whether the LAST `put` of this run reached durable
   * storage (a memory store answers true). POST /v1/answer reports a failed
   * write in the body instead of a stderr line only.
   */
  persisted?(runId: string): Promise<boolean>;
  /**
   * Additive (W14 B-26): forget one answer for good — cache row and durable
   * row. `false` means the runId was not there. Without it the same question
   * asked twice left two rows nobody could ever remove.
   */
  remove?(runId: string): Promise<boolean>;
}

/** Hard ceiling on one listing; the console never needs more. */
export const MAX_ANSWER_LIST_LIMIT = 200;
export const DEFAULT_ANSWER_LIST_LIMIT = 50;

/** Clamp a requested listing limit into [1, MAX_ANSWER_LIST_LIMIT]. */
export function clampListLimit(limit: number | undefined, fallback = DEFAULT_ANSWER_LIST_LIMIT): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_ANSWER_LIST_LIMIT);
}

/**
 * Narrow an untrusted `fileScope` value (a stored result, a jsonb column)
 * into the wire shape, or undefined when it is absent or malformed. Only
 * string ids survive; `includeCorpus` is true only when literally true.
 */
export function fileScopeOf(value: unknown): FileScopeView | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const ids = rec["fileIds"];
  if (!Array.isArray(ids)) return undefined;
  const fileIds = ids.filter((id): id is string => typeof id === "string" && id !== "");
  if (fileIds.length === 0) return undefined;
  return { fileIds, includeCorpus: rec["includeCorpus"] === true };
}

/** True when the summary's file scope names `fileId`. */
export function answerCoversFile(summary: Pick<AnswerSummary, "fileScope">, fileId: string): boolean {
  return summary.fileScope !== undefined && summary.fileScope.fileIds.includes(fileId);
}

/** The listing row of a stored answer (shared by every AnswerStore). */
export function summarizeStoredAnswer(entry: StoredAnswer): AnswerSummary {
  const result = entry.result as Partial<AnswerResult> | undefined;
  const question =
    typeof entry.question === "string"
      ? entry.question
      : typeof result?.question === "string"
        ? result.question
        : "";
  const fileScope = fileScopeOf(result?.fileScope);
  return {
    runId: entry.runId,
    question,
    status: typeof result?.status === "string" ? result.status : "",
    mode: entry.mode ?? "local",
    matterId: entry.matterId ?? null,
    createdAt: entry.storedAt,
    evidenceCount: Array.isArray(result?.evidence) ? result.evidence.length : 0,
    finalizable: result?.finalizable === true,
    ...(fileScope !== undefined ? { fileScope } : {}),
  };
}

/**
 * Bounded in-memory cache of completed answers, oldest evicted first.
 *
 * Bounded on purpose: an answer holds the canonical text of every document it
 * quoted, so an unbounded map is a memory-exhaustion vector reachable by
 * anyone who can POST a question. Durable persistence is `PgAnswerStore`
 * (store/answerStore.ts), which wraps this cache and writes through to
 * app_private.answers; this class alone is what the offline tests and the
 * demo use.
 */
export class InMemoryAnswerStore implements AnswerStore {
  private readonly entries = new Map<string, StoredAnswer>();

  constructor(private readonly capacity: number = 32) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("answer store capacity must be a positive integer");
    }
  }

  put(entry: StoredAnswer): void {
    // A re-put without matterId keeps the filing the cache already knows.
    const previous = this.entries.get(entry.runId);
    const merged: StoredAnswer =
      entry.matterId === undefined && previous?.matterId !== undefined
        ? { ...entry, matterId: previous.matterId }
        : entry;
    this.entries.delete(entry.runId);
    this.entries.set(entry.runId, merged);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get(runId: string): StoredAnswer | undefined {
    return this.entries.get(runId);
  }

  /** Nothing to load: the cache IS the store. */
  async warm(_runId: string): Promise<void> {
    return;
  }

  async list(opts: AnswerListOptions = {}): Promise<AnswerSummary[]> {
    const limit = clampListLimit(opts.limit);
    const fileId = opts.fileId;
    const q = opts.q;
    const status = opts.status;
    const rows = [...this.entries.values()]
      .filter((entry) => opts.matterId === undefined || entry.matterId === opts.matterId)
      .map(summarizeStoredAnswer)
      .filter((summary) => fileId === undefined || answerCoversFile(summary, fileId))
      // W14 (B-26): the two filters that used to be dropped silently.
      .filter((summary) => q === undefined || questionMatchesQuery(summary.question, q))
      .filter((summary) => status === undefined || summary.status === status)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return rows.slice(0, limit);
  }

  async attach(runId: string, matterId: string | null): Promise<void> {
    const entry = this.entries.get(runId);
    if (entry === undefined) return;
    this.entries.set(runId, { ...entry, matterId });
  }

  /** W14 (B-26): forget one answer. */
  async remove(runId: string): Promise<boolean> {
    return this.entries.delete(runId);
  }

  get size(): number {
    return this.entries.size;
  }
}

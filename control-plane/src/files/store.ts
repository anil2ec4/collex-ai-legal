/**
 * Read-side store for tenant uploads (wire contract #1, GET half) plus the
 * DraftingFilePort the drafting lane binds `evidence.fileIds` through.
 *
 * The WRITE path (upload/delete) goes through `intake.cli` — the Python side
 * owns quarantine, extraction and the ingestion pipeline. Reads do NOT shell
 * out: list/detail/chunks are direct SQL over the same tables the pipeline
 * wrote (`legal.documents` / `legal.document_versions` / `legal.chunks`),
 * mirroring the queries in `intake/ingest.py` (list_files / show_file) so the
 * two readers cannot drift in meaning:
 *
 *   - only `scope='tenant'`, `source='UPLOAD'` rows of the local tenant;
 *   - the CURRENT version = the one whose system_period is open
 *     (`upper_inf`), per ADR-012 (temporal close-on-append in the database);
 *   - chunk previews are whitespace-collapsed and capped at 240 code points;
 *   - `contentSha256` handed to drafting is `document_versions.content_sha256`
 *     — the sha256 hex over the UTF-8 bytes of the file's FULL extracted
 *     (NFC canonical) text, exactly what the drafting contract requires and
 *     what the Python exporter re-verifies.
 *
 * W12-F: chunk counts come from ONE grouped join (never a correlated per-row
 * subquery), and `showFile` returns a WINDOW of previews (`chunks`/`offset`,
 * default 12) while `chunkCount` stays the document's TOTAL — a 30 000-chunk
 * upload no longer ships every preview on every detail read.
 */

import { createDb, type Sql, type SqlRow } from "../store/db.js";
import type { DraftFileChunk, DraftingFilePort } from "../drafting/types.js";
import { LOCAL_TENANT_ID } from "../drafting/types.js";
import {
  TR_FILTER_SQL_FROM,
  TR_FILTER_SQL_TO,
  foldTurkishForFilter,
  normalizeTurkishSearch,
} from "../retrieval/normalize.js";

/** GET /v1/files row (contract #1; matches intake/ingest.py list_files). */
export interface FileListEntry {
  fileId: string;
  name: string;
  mime: string;
  sha256: string;
  kind: string;
  uploadedAt: string;
  chars: number;
  chunkCount: number;
  /** Additive: original uploaded byte count when the intake stored it. */
  sizeBytes?: number;
  /**
   * Additive (W12-API2): PDF per-page statistics on the LIST row too, read
   * from the same `metadata.fixture_meta.upload.page_stats` block the detail
   * read uses (the list query already fetches `v.metadata`, so this costs
   * no extra round trip). Absent for non-PDF uploads and older intakes.
   */
  pages?: FilePageStats;
  /**
   * Additive (W14 B-26): the matter this upload is filed under, and its
   * title. The console had to call GET /v1/matters/{id} per row to show it.
   * Absent when the upload is dosyasız, and when the matters tables are not
   * present in this database.
   */
  matterId?: string;
  matterTitle?: string;
}

/** Additive (W14 B-32): which slice of the file list a response carries. */
export interface FilePage {
  offset: number;
  limit: number;
  total: number;
}

/** Paging + scope of `listFiles` (W14 B-32 / B-26). */
export interface FileListOptions {
  limit?: number;
  offset?: number;
  /** Only these upload ids (the `?matterId=` filter resolves to this). */
  fileIds?: readonly string[];
}

/** What `listFiles` returns once paging exists. */
export interface FileListPage {
  files: FileListEntry[];
  page: FilePage;
}

/** One document-body hit of the general search (W14 B-29). */
export interface ChunkSearchHit {
  fileId: string;
  fileName: string;
  chunkId: string;
  ordinal: number;
  snippet: string;
  startChar: number;
  endChar: number;
}

/** What DELETE /v1/files/{id} would orphan (W14 B-26). */
export interface FileUsage {
  fileId: string;
  matterItems: Array<{ itemId: string; matterId: string; matterTitle: string }>;
  draftIds: string[];
  answerRunIds: string[];
}

/** Default / maximum page of GET /v1/files (W14 B-32). */
export const DEFAULT_FILE_PAGE = 50;
export const MAX_FILE_PAGE = 200;

/** One chunk preview inside GET /v1/files/{id}. */
export interface FileChunkPreview {
  chunkId: string;
  ordinal: number;
  preview: string;
  startChar: number;
  endChar: number;
}

/** Extraction summary block (same shape POST /v1/files returns). */
export interface FileExtraction {
  chars: number;
  chunkCount: number;
  pages?: number;
  /**
   * W21 (#29): true when local OCR read at least one page of this file
   * (`pages.ocrPages`, or the intake's `OCR_PAGES:<n>` warning). Before W21
   * it was hard-coded false, so the console never took its "read by OCR"
   * branch for pages OCR did read.
   */
  ocr: boolean;
}

/**
 * Additive (W12-F): per-page text-layer statistics of a PDF, written by
 * intake/extract.py. `emptyPages` are 1-based page numbers WITHOUT a usable
 * text layer (a mixed scan); they were not indexed and the file's warnings
 * carry `SCANNED_PAGES:<n>` for the console dictionary. `sparsePages` are
 * pages with a text layer that is too short to establish full readability;
 * their short extracted text is preserved, but OCR is not implied.
 *
 * W21 (#29): the intake computes these AFTER local OCR. `emptyPages` lists
 * only pages NOTHING read; a page local OCR read is in `ocrPages` instead
 * (it is searchable and citable, and its quotes must be checked against the
 * original). W21 (#25): `sparsePages` also holds scanned pages of which only
 * a short text layer (a stamp, an e-signature footer) was read. W21 round
 * two (R2-32/R2-33): and pages local OCR read but NOT fully — low
 * confidence, only a few characters beyond a short text layer, or lines
 * withheld as possible misread copies; such a page is in `ocrPages` too,
 * and the warnings name the reason (`OCR_LOW_CONFIDENCE_PAGES`,
 * `OCR_WITHHELD_LINES_PAGES`).
 */
export interface FilePageStats {
  pageCount: number;
  pagesWithText: number;
  emptyPages: number[];
  /** 1-based pages whose text layer exists but is too sparse to trust. */
  sparsePages?: number[];
  /** W21 (#29): 1-based pages local OCR read (additive; absent = none). */
  ocrPages?: number[];
}

/** `OCR_PAGES:<n>` with n >= 1 — the intake's machine code for "OCR read pages". */
const OCR_PAGES_WARNING_RE = /^OCR_PAGES:([1-9]\d*)$/u;

/**
 * W21 (#29): did local OCR read any page of this file? Decided from what
 * the intake recorded — the page statistics or its machine warning code —
 * never assumed.
 */
export function extractionUsedOcr(pages: FilePageStats | undefined, warnings: unknown): boolean {
  if (pages?.ocrPages !== undefined && pages.ocrPages.length > 0) return true;
  return (
    Array.isArray(warnings) &&
    warnings.some((warning) => typeof warning === "string" && OCR_PAGES_WARNING_RE.test(warning))
  );
}

/** Additive (W12-F): which slice of the chunk previews `chunks` holds. */
export interface FileChunkWindow {
  offset: number;
  limit: number;
  /** Same as `chunkCount`: the document's total chunk count. */
  total: number;
}

/** GET /v1/files/{id} body: identity + analysis + chunk previews. */
export interface FileDetail extends FileListEntry {
  extraction: FileExtraction;
  /** Heuristic v1 analysis: {parties, references, dates, claims}. */
  analysis: Record<string, unknown>;
  warnings: string[];
  chunks: FileChunkPreview[];
  /** Additive (W12-F): PDF per-page statistics when the intake recorded them. */
  pages?: FilePageStats;
  /** Additive (W12-F): the preview window `chunks` covers. */
  chunkWindow?: FileChunkWindow;
}

/** Preview window requested on GET /v1/files/{id}. */
export interface ChunkWindowRequest {
  offset: number;
  limit: number;
}

/** Default / maximum number of previews per detail read. */
export const DEFAULT_CHUNK_WINDOW = 12;
export const MAX_CHUNK_WINDOW = 200;

/**
 * What the files router reads through; PostgresFilesStore is the real one.
 *
 * Everything W14 added is OPTIONAL so a store written before this wave (and
 * every test fake) still satisfies the port. A route whose filter needs a
 * method the store does not have answers a typed 400 — it never pretends to
 * have filtered (W13-BACKLOG B-26).
 */
export interface FilesReadStore extends DraftingFilePort {
  listFiles(tenantId?: string): Promise<FileListEntry[]>;
  showFile(
    fileId: string,
    tenantId?: string,
    window?: ChunkWindowRequest,
  ): Promise<FileDetail | undefined>;
  /** Additive (W14 B-32): one PAGE of the list plus the total. */
  listFilePage?(opts: FileListOptions, tenantId?: string): Promise<FileListPage>;
  /** Additive (W14 B-26): the upload ids filed under one matter. */
  matterFileIds?(matterId: string, tenantId?: string): Promise<string[]>;
  /** Additive (W14 B-26): matter link (id + title) for the rows of one page. */
  fileMatterLinks?(
    fileIds: readonly string[],
    tenantId?: string,
  ): Promise<Map<string, { matterId: string; matterTitle: string }>>;
  /** Additive (W14 B-29): document-body search over the lawyer's uploads. */
  searchChunks?(
    q: string,
    opts?: { limit?: number; tenantId?: string },
  ): Promise<ChunkSearchHit[]>;
  /**
   * Additive (W14 B-26, completed by L-FIX): which of these upload ids still
   * exist. `POST /v1/answer` uses it to refuse a question asked over a
   * deleted document with 404 FILE_NOT_FOUND instead of answering ABSTAIN.
   */
  existingFileIds?(fileIds: readonly string[], tenantId?: string): Promise<string[]>;
  /** Additive (W14 B-26): what a delete would orphan. */
  fileUsage?(fileId: string, tenantId?: string): Promise<FileUsage>;
  /** Additive (W14 B-26): drop the matter items that referenced a deleted file. */
  removeMatterItemsForFile?(fileId: string, tenantId?: string): Promise<number>;
  /** Additive (W14 B-30): identity of the stored original (sha256 + kind). */
  originalRef?(
    fileId: string,
    tenantId?: string,
  ): Promise<{ sha256: string; kind: string; name: string; mime: string } | undefined>;
}

const PREVIEW_CHARS = 240;

/** Whitespace-collapsed preview capped at 240 CODE POINTS (mirrors Python). */
export function chunkPreview(text: string): string {
  const collapsed = text.split(/\s+/u).filter((part) => part !== "").join(" ");
  const points = [...collapsed];
  if (points.length <= PREVIEW_CHARS) return collapsed;
  return `${points.slice(0, PREVIEW_CHARS - 1).join("")}…`;
}

/** The upload block process_file wrote under metadata.fixture_meta.upload. */
function uploadMeta(metadata: unknown): Record<string, unknown> {
  if (metadata === null || typeof metadata !== "object") return {};
  const fixtureMeta = (metadata as Record<string, unknown>)["fixture_meta"];
  if (fixtureMeta === null || typeof fixtureMeta !== "object") return {};
  const upload = (fixtureMeta as Record<string, unknown>)["upload"];
  if (upload === null || typeof upload !== "object") return {};
  return upload as Record<string, unknown>;
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === "string" ? value : "";
}

function metaNonNegativeInt(meta: Record<string, unknown>, key: string): number | undefined {
  const value = meta[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

/** Narrow the stored page_stats block (untrusted JSON) into FilePageStats. */
export function pageStatsOf(value: unknown): FilePageStats | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const pageCount = rec["pageCount"];
  const pagesWithText = rec["pagesWithText"];
  const emptyPages = rec["emptyPages"];
  const sparsePages = rec["sparsePages"];
  const ocrPages = rec["ocrPages"];
  const isCount = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!isCount(pageCount) || !isCount(pagesWithText)) return undefined;
  const isPage = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= pageCount;
  return {
    pageCount,
    pagesWithText,
    emptyPages: Array.isArray(emptyPages)
      ? emptyPages.filter(isPage)
      : [],
    ...(Array.isArray(sparsePages)
      ? { sparsePages: sparsePages.filter(isPage) }
      : {}),
    ...(Array.isArray(ocrPages) ? { ocrPages: ocrPages.filter(isPage) } : {}),
  };
}

/** Clamp a requested preview window into [0, MAX]; absent = the default. */
export function normalizeChunkWindow(window: ChunkWindowRequest | undefined): ChunkWindowRequest {
  const limit = Math.min(
    MAX_CHUNK_WINDOW,
    Math.max(1, Math.floor(window?.limit ?? DEFAULT_CHUNK_WINDOW)),
  );
  const offset = Math.max(0, Math.floor(window?.offset ?? 0));
  return { offset, limit };
}

export interface PostgresFilesStoreOptions {
  /** Postgres DSN of the local product database (e.g. collex_local). */
  dsn?: string;
  /** Existing postgres.js client to reuse (the store then never closes it). */
  db?: Sql;
}

/**
 * postgres.js-backed reader. Owns its pool ONLY when constructed from a DSN;
 * a shared `db` is never closed by `end()`.
 */
export class PostgresFilesStore implements FilesReadStore {
  private readonly sql: Sql;
  private readonly ownsPool: boolean;

  constructor(options: PostgresFilesStoreOptions) {
    if (options.db !== undefined) {
      this.sql = options.db;
      this.ownsPool = false;
    } else if (options.dsn !== undefined && options.dsn !== "") {
      this.sql = createDb({
        url: options.dsn,
        max: 3,
        // A refused/black-holed local port must surface as a typed 503
        // quickly, not after the driver's default wait.
        connectTimeoutS: 5,
        applicationName: "collex-files-store",
      });
      this.ownsPool = true;
    } else {
      throw new Error("PostgresFilesStore requires a dsn or a db client");
    }
  }

  /** Close the pool this store opened (no-op for a shared client). */
  async end(): Promise<void> {
    if (this.ownsPool) await this.sql.end({ timeout: 5 });
  }

  async listFiles(tenantId: string = LOCAL_TENANT_ID): Promise<FileListEntry[]> {
    const page = await this.listFilePage({ limit: MAX_FILE_PAGE, offset: 0 }, tenantId);
    return page.files;
  }

  /**
   * W14 (B-32): ONE page of the list.
   *
   * Two measured defects are fixed here.
   *  1. `length(v.canonical_text)` detoasted every document's whole canonical
   *     text on every list read (ENGRISK: 91 % of 148,9 ms). `chars` is read
   *     from the upload metadata when the intake recorded it, and only falls
   *     back to the detoast for rows written before that
   *     (`intake/ingest.py` writing `chars` is L-SAFE's half — see the
   *     L-MATTER report's integrationRequests).
   *  2. The chunk-count subquery scanned ALL of `legal.chunks` on every call.
   *     It is now a LATERAL bound to the page's rows only.
   */
  async listFilePage(
    opts: FileListOptions = {},
    tenantId: string = LOCAL_TENANT_ID,
  ): Promise<FileListPage> {
    const sql = this.sql;
    const limit = Math.min(MAX_FILE_PAGE, Math.max(1, Math.floor(opts.limit ?? DEFAULT_FILE_PAGE)));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const ids = opts.fileIds === undefined ? undefined : [...opts.fileIds];
    const idClause = ids === undefined ? sql`` : sql`and d.external_id = any(${ids}::text[])`;
    const totals = await sql`
      select count(*)::int as total
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId} ${idClause}`;
    const total = Number((totals[0] as SqlRow | undefined)?.["total"] ?? 0);
    if (ids !== undefined && ids.length === 0) {
      return { files: [], page: { offset, limit, total: 0 } };
    }
    const rows = await sql`
      with page as (
        select d.external_id, d.title, v.id as version_id, v.created_at, v.metadata
        from legal.documents d
        join legal.document_versions v
          on v.document_id = d.id and upper_inf(v.system_period)
        where d.scope = 'tenant' and d.source = 'UPLOAD'
          and d.tenant_id = ${tenantId} ${idClause}
        order by v.created_at, d.external_id
        limit ${limit} offset ${offset}
      )
      select p.external_id,
             p.title,
             p.created_at,
             p.metadata,
             coalesce(
               (p.metadata -> 'fixture_meta' -> 'upload' ->> 'chars')::int,
               (select length(v2.canonical_text)::int
                from legal.document_versions v2 where v2.id = p.version_id)
             ) as chars,
             coalesce(cc.chunk_count, 0)::int as chunk_count
      from page p
      left join lateral (
        select count(*)::int as chunk_count
        from legal.chunks c
        where c.document_version_id = p.version_id
      ) cc on true
      order by p.created_at, p.external_id`;
    return {
      files: rows.map((row: SqlRow) => this.toListEntry(row)),
      page: { offset, limit, total },
    };
  }

  /** W14 (B-26): the upload ids filed under one matter (`file` items). */
  async matterFileIds(matterId: string, tenantId: string = LOCAL_TENANT_ID): Promise<string[]> {
    const rows = await this.sql`
      select distinct i.ref_id
      from app_private.matter_items i
      where i.tenant_id = ${tenantId} and i.kind = 'file'
        and i.matter_id = ${matterId}::uuid and i.ref_id is not null`;
    return rows.map((row: SqlRow) => String(row["ref_id"]));
  }

  /** W14 (B-26): matter id + title for the uploads of one page. */
  async fileMatterLinks(
    fileIds: readonly string[],
    tenantId: string = LOCAL_TENANT_ID,
  ): Promise<Map<string, { matterId: string; matterTitle: string }>> {
    const out = new Map<string, { matterId: string; matterTitle: string }>();
    if (fileIds.length === 0) return out;
    const rows = await this.sql`
      select distinct on (i.ref_id) i.ref_id, i.matter_id, m.title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${tenantId} and i.kind = 'file'
        and i.ref_id = any(${[...fileIds]}::text[])
      order by i.ref_id, i.created_at`;
    for (const row of rows as SqlRow[]) {
      out.set(String(row["ref_id"]), {
        matterId: String(row["matter_id"]),
        matterTitle: typeof row["title"] === "string" ? row["title"] : "",
      });
    }
    return out;
  }

  /**
   * W14 (B-29): document-body search over the lawyer's OWN uploads.
   *
   * `plainto_tsquery('turkish', …)` against the `search_tsv_tr` index that
   * already exists, unioned with a trigram-free ILIKE fallback for a phrase
   * the Turkish dictionary stems away. Only the chunk's own text is returned
   * (a snippet, whitespace-collapsed) with its code-point offsets, so the
   * console can scroll the document page to the hit (ADR-003).
   */
  async searchChunks(
    q: string,
    opts: { limit?: number; tenantId?: string } = {},
  ): Promise<ChunkSearchHit[]> {
    const needle = q.trim();
    if (needle === "") return [];
    const tenantId = opts.tenantId ?? LOCAL_TENANT_ID;
    const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20)));
    // `search_text` is the ingest-time Turkish-lowercased text, so the tsquery
    // gets the same lowercasing (the database locale would read "KIDEM" as
    // "kidem") and the substring lane compares the SAME fold on both sides.
    const tsNeedle = normalizeTurkishSearch(needle);
    const folded = foldTurkishForFilter(needle);
    const pattern = "%" + folded.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await this.sql`
      select d.external_id, d.title, v.metadata,
             c.id as chunk_id, c.ordinal, c.original_text, c.start_char, c.end_char
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      join legal.chunks c on c.document_version_id = v.id
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId}
        and (c.search_tsv_tr @@ plainto_tsquery('turkish', ${tsNeedle})
             or lower(translate(c.search_text, ${TR_FILTER_SQL_FROM}, ${TR_FILTER_SQL_TO})) like ${pattern})
      order by d.external_id, c.ordinal
      limit ${limit}`;
    return rows.map((row: SqlRow) => {
      const meta = uploadMeta(row["metadata"]);
      return {
        fileId: String(row["external_id"]),
        fileName: metaString(meta, "name") || String(row["title"] ?? ""),
        chunkId: String(row["chunk_id"]),
        ordinal: Number(row["ordinal"]),
        snippet: chunkPreview(String(row["original_text"] ?? "")),
        startChar: Number(row["start_char"]),
        endChar: Number(row["end_char"]),
      };
    });
  }

  /**
   * W14 (B-26): what a DELETE would orphan — matter records, drafts that used
   * the file as evidence, answers asked over it. The console shows this
   * BEFORE the delete instead of leaving dangling rows with no warning.
   */
  async fileUsage(fileId: string, tenantId: string = LOCAL_TENANT_ID): Promise<FileUsage> {
    const items = await this.sql`
      select i.item_id, i.matter_id, m.title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${tenantId} and i.kind = 'file' and i.ref_id = ${fileId}`;
    const drafts = await this.sql`
      select distinct draft_id
      from app_private.drafts
      where tenant_id = ${tenantId}
        and body -> 'evidence' @> ${this.sql.json([{ fileId }] as never)}::jsonb`;
    const answers = await this.sql`
      select run_id
      from app_private.answers
      where tenant_id = ${tenantId}
        and result @> ${this.sql.json({ fileScope: { fileIds: [fileId] } } as never)}::jsonb`;
    return {
      fileId,
      matterItems: (items as SqlRow[]).map((row) => ({
        itemId: String(row["item_id"]),
        matterId: String(row["matter_id"]),
        matterTitle: typeof row["title"] === "string" ? row["title"] : "",
      })),
      draftIds: (drafts as SqlRow[]).map((row) => String(row["draft_id"])),
      answerRunIds: (answers as SqlRow[]).map((row) => String(row["run_id"])),
    };
  }

  /** W14 (B-26): drop the `file` matter items that referenced a deleted id. */
  async removeMatterItemsForFile(
    fileId: string,
    tenantId: string = LOCAL_TENANT_ID,
  ): Promise<number> {
    const rows = await this.sql`
      delete from app_private.matter_items
      where tenant_id = ${tenantId} and kind = 'file' and ref_id = ${fileId}
      returning item_id`;
    return rows.length;
  }

  /** W14 (B-30): the identity the stored original is named by on disk. */
  /**
   * W14 L-FIX (B-26, the piece L-MATTER left open): which of `fileIds` still
   * exist, in ONE query.
   *
   * A question asked over a deleted upload used to run the whole pipeline
   * against an empty file scope and come back ABSTAIN — "kaynak bulunamadı" —
   * which reads on screen as "your document does not support this", the exact
   * silent-wrong-answer B-26 exists to end. `POST /v1/answer` now refuses
   * with 404 FILE_NOT_FOUND before any retrieval, and this is the lookup it
   * uses: same visibility predicate as `originalRef`, one round trip for up
   * to the 50 ids the request schema allows.
   */
  async existingFileIds(
    fileIds: readonly string[],
    tenantId: string = LOCAL_TENANT_ID,
  ): Promise<string[]> {
    const ids = [...new Set(fileIds.filter((id) => typeof id === "string" && id !== ""))];
    if (ids.length === 0) return [];
    const rows = await this.sql`
      select d.external_id
      from legal.documents d
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId}
        and d.external_id = any(${ids}::text[])`;
    return (rows as SqlRow[]).map((row) => String(row["external_id"]));
  }

  async originalRef(
    fileId: string,
    tenantId: string = LOCAL_TENANT_ID,
  ): Promise<{ sha256: string; kind: string; name: string; mime: string } | undefined> {
    const rows = await this.sql`
      select v.metadata
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId} and d.external_id = ${fileId}`;
    const row = rows[0] as SqlRow | undefined;
    if (row === undefined) return undefined;
    const meta = uploadMeta(row["metadata"]);
    return {
      sha256: metaString(meta, "sha256"),
      kind: metaString(meta, "kind"),
      name: metaString(meta, "name"),
      mime: metaString(meta, "mime"),
    };
  }

  async showFile(
    fileId: string,
    tenantId: string = LOCAL_TENANT_ID,
    window?: ChunkWindowRequest,
  ): Promise<FileDetail | undefined> {
    const { offset, limit } = normalizeChunkWindow(window);
    const rows = await this.sql`
      select d.external_id,
             d.title,
             v.id as version_id,
             v.created_at,
             length(v.canonical_text)::int as chars,
             v.metadata,
             coalesce(cc.chunk_count, 0)::int as chunk_count
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      left join (
        select document_version_id, count(*) as chunk_count
        from legal.chunks
        group by document_version_id
      ) cc on cc.document_version_id = v.id
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId}
        and d.external_id = ${fileId}`;
    const row = rows[0];
    if (row === undefined) return undefined;

    // Only the requested window of previews leaves the database.
    const chunkRows = await this.sql`
      select id, ordinal, original_text, start_char, end_char
      from legal.chunks
      where document_version_id = ${row["version_id"] as string}
      order by ordinal
      limit ${limit} offset ${offset}`;

    const entry = this.toListEntry(row);
    const meta = uploadMeta(row["metadata"]);
    const chunks: FileChunkPreview[] = chunkRows.map((chunk: SqlRow) => ({
      chunkId: String(chunk["id"]),
      ordinal: Number(chunk["ordinal"]),
      preview: chunkPreview(String(chunk["original_text"] ?? "")),
      startChar: Number(chunk["start_char"]),
      endChar: Number(chunk["end_char"]),
    }));

    const pages = meta["pages"];
    const analysis = meta["analysis"];
    const warnings = meta["warnings"];
    const extraction: FileExtraction = {
      chars: entry.chars,
      chunkCount: entry.chunkCount,
      // W21 (#29): from what the intake recorded, no longer a constant false.
      ocr: extractionUsedOcr(entry.pages, warnings),
      ...(typeof pages === "number" ? { pages } : {}),
    };
    // `pages` arrives with the list entry (toListEntry reads page_stats), so
    // the detail and the list can never disagree about a file's scan state.
    return {
      ...entry,
      extraction,
      analysis:
        analysis !== null && typeof analysis === "object"
          ? (analysis as Record<string, unknown>)
          : {},
      warnings: Array.isArray(warnings) ? warnings.map((w) => String(w)) : [],
      chunks,
      chunkWindow: { offset, limit, total: entry.chunkCount },
    };
  }

  /**
   * DraftingFilePort: FULL chunk text (never previews) plus the file-level
   * contentSha256 (sha256 over the UTF-8 bytes of the whole canonical text,
   * straight from document_versions.content_sha256).
   */
  async getChunks(
    fileIds: readonly string[],
    tenantId: string,
  ): Promise<DraftFileChunk[]> {
    if (fileIds.length === 0) return [];
    const rows = await this.sql`
      select d.external_id,
             d.title,
             v.metadata,
             v.content_sha256,
             c.id as chunk_id,
             c.ordinal,
             c.original_text,
             c.start_char,
             c.end_char
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      join legal.chunks c on c.document_version_id = v.id
      where d.scope = 'tenant' and d.source = 'UPLOAD'
        and d.tenant_id = ${tenantId}
        and d.external_id = any(${[...fileIds]})
      order by array_position(${[...fileIds]}::text[], d.external_id), c.ordinal`;
    // 27.09.2026: the CALLER's order (Ek-n numbering is the lawyer's order),
    // not `external_id` — a hex digest prefix ordered the exhibits before.
    return rows.map((row: SqlRow): DraftFileChunk => {
      const meta = uploadMeta(row["metadata"]);
      const fileName = metaString(meta, "name") || String(row["title"] ?? "");
      return {
        fileId: String(row["external_id"]),
        fileName,
        chunkId: String(row["chunk_id"]),
        ordinal: Number(row["ordinal"]),
        text: String(row["original_text"] ?? ""),
        startChar: Number(row["start_char"]),
        endChar: Number(row["end_char"]),
        contentSha256: String(row["content_sha256"]),
      };
    });
  }

  private toListEntry(row: SqlRow): FileListEntry {
    const meta = uploadMeta(row["metadata"]);
    const pages = pageStatsOf(meta["page_stats"]);
    const sizeBytes = metaNonNegativeInt(meta, "size_bytes");
    return {
      fileId: String(row["external_id"]),
      name: metaString(meta, "name") || String(row["title"] ?? ""),
      mime: metaString(meta, "mime"),
      sha256: metaString(meta, "sha256"),
      kind: metaString(meta, "kind"),
      uploadedAt: isoTimestamp(row["created_at"]),
      chars: Number(row["chars"]),
      chunkCount: Number(row["chunk_count"] ?? 0),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(pages !== undefined ? { pages } : {}),
    };
  }
}

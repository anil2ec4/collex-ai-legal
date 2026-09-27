/**
 * Postgres-backed implementations of the answer-pipeline ports.
 *
 * These are the only place the pipeline touches SQL, and each adapter is
 * FAIL-SOFT by contract: a dead pool, a missing extension or a broken lane
 * becomes a typed `status: "error"` / an empty facts map, never an exception
 * that aborts an answer. The pipeline turns that into a PARTIAL answer with an
 * explicit warning — a lawyer must be told the corpus was only partly
 * searched, not handed a silent 500.
 *
 * Retrieval reuses `retrieval/searchService.searchLegalCorpus` verbatim (zod
 * validation, hybrid lanes, contained lane failures, Outcome envelope); this
 * module only adapts its envelope onto CorpusSearchResult.
 */

import type { Sql, SqlRow } from "../store/db.js";
import { asText, asTextOrNull } from "../store/db.js";
import { fetchCanonicalText } from "../store/chunkStore.js";
import { searchLegalCorpus } from "../retrieval/searchService.js";
import type { DenseLane } from "../retrieval/hybrid.js";
import {
  CORPUS_UNAVAILABLE,
  CORPUS_UNAVAILABLE_MESSAGE_TR,
  isCorpusUnavailable,
} from "../retrieval/corpusErrors.js";
import type { CanonicalTextPort } from "../answer/evidencePack.js";
import type {
  CorpusRetrievalPort,
  CorpusSearchRequest,
  CorpusSearchResult,
  VersionFacts,
  VersionFactsPort,
} from "./ports.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

/** Hybrid retrieval over the local corpus. Never throws. */
/**
 * W20: `denseLane` wires a real semantic lane (embeddings/denseLane.ts)
 * into the answer pipeline's retrieval. Absent = the NoopDenseLane default,
 * reported as DISABLED.
 */
export function createStoreRetrievalPort(
  sql: Sql,
  options: { denseLane?: DenseLane } = {},
): CorpusRetrievalPort {
  return {
    name: "postgres-hybrid",
    async search(request: CorpusSearchRequest): Promise<CorpusSearchResult> {
      let outcome;
      try {
        outcome = await searchLegalCorpus(sql, {
          query: request.query,
          asOf: request.asOf,
          ...(request.filters !== undefined ? { filters: request.filters } : {}),
          ...(request.limits !== undefined ? { limits: request.limits } : {}),
        }, options.denseLane !== undefined ? { denseLane: options.denseLane } : {});
      } catch (error) {
        // searchLegalCorpus already contains its own failures; reaching here
        // means something outside it broke (pool torn down, driver bug). A
        // connection-class failure is typed so the lawyer reads ONE Turkish
        // sentence, never the driver's prose.
        if (isCorpusUnavailable(error)) {
          return {
            status: "error",
            hits: [],
            warnings: [],
            error: CORPUS_UNAVAILABLE_MESSAGE_TR,
            errorCode: CORPUS_UNAVAILABLE,
          };
        }
        return { status: "error", hits: [], warnings: [], error: safeMessage(error) };
      }

      if (outcome.status === "ok") {
        return { status: "ok", hits: outcome.data, warnings: outcome.warnings };
      }
      if (outcome.status === "partial") {
        return {
          status: "partial",
          hits: outcome.data,
          warnings: outcome.warnings,
          error: outcome.error.safeMessage,
        };
      }
      return {
        status: "error",
        hits: [],
        warnings: [],
        error: outcome.error.safeMessage,
        ...(outcome.reasonCode === CORPUS_UNAVAILABLE ? { errorCode: CORPUS_UNAVAILABLE } : {}),
      };
    },
  };
}

/**
 * Canonical text fetch for evidence building.
 *
 * `undefined` means "cannot be produced" for every reason — unknown id, bad id
 * shape, store down. buildEvidencePack records the candidate as
 * CANONICAL_TEXT_UNAVAILABLE, which is exactly the right outcome: without the
 * canonical text there is nothing to quote and nothing to verify.
 */
export function createStoreTextPort(sql: Sql): CanonicalTextPort {
  return {
    async getCanonicalText(documentVersionId: string): Promise<string | undefined> {
      if (!UUID_RE.test(documentVersionId)) return undefined;
      try {
        const record = await fetchCanonicalText(sql, documentVersionId);
        return record === null ? undefined : record.canonicalText;
      } catch {
        return undefined;
      }
    },
  };
}

function joinCourt(court: string | null, chamber: string | null): string | undefined {
  const parts = [court, chamber].filter((p): p is string => p !== null && p.trim() !== "");
  return parts.length === 0 ? undefined : parts.join(" ");
}

function mapFactsRow(row: SqlRow): VersionFacts {
  const from = asTextOrNull(row, "effective_from");
  const to = asTextOrNull(row, "effective_to");
  const court = joinCourt(asTextOrNull(row, "court"), asTextOrNull(row, "chamber"));
  const syntheticText = asTextOrNull(row, "synthetic");
  const synthetic = syntheticText === "true" ? true : syntheticText === "false" ? false : undefined;
  const upload = asTextOrNull(row, "upload") === "true";
  return {
    documentVersionId: asText(row, "document_version_id"),
    ...(court !== undefined ? { court } : {}),
    ...(from !== null ? { effectiveFrom: from } : {}),
    ...(to !== null ? { effectiveTo: to } : {}),
    ...(synthetic !== undefined ? { synthetic } : {}),
    ...(upload ? { upload: true } : {}),
  };
}

/**
 * Court/chamber + effective-period bounds per document version.
 *
 * These live on legal.document_versions but are not part of the chunk
 * provenance projection, and both are load-bearing: the court decides the
 * authority tier, and the effective period decides whether the version was in
 * force on the question's as_of date. Reading them here keeps the store
 * retrieval layer untouched.
 */
export function createStoreVersionFactsPort(sql: Sql): VersionFactsPort {
  return {
    async fetch(documentVersionIds: readonly string[]): Promise<Map<string, VersionFacts>> {
      const ids = [...new Set(documentVersionIds)].filter((id) => UUID_RE.test(id));
      const out = new Map<string, VersionFacts>();
      if (ids.length === 0) return out;
      try {
        const rows = await sql`
          select
            v.id::text as document_version_id,
            v.court as court,
            v.chamber as chamber,
            lower(v.effective_period)::text as effective_from,
            upper(v.effective_period)::text as effective_to,
            (v.metadata #>> '{fixture_meta,synthetic}') as synthetic,
            (d.scope = 'tenant' and d.source = 'UPLOAD')::text as upload
          from legal.document_versions v
          join legal.documents d on d.id = v.document_id
          where v.id = any(${ids}::uuid[])`;
        for (const row of rows) {
          const facts = mapFactsRow(row);
          out.set(facts.documentVersionId, facts);
        }
      } catch {
        // Fail soft: an empty map degrades authority/currentness to their
        // conservative defaults instead of failing the whole answer.
        return new Map();
      }
      return out;
    },
  };
}

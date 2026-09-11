/**
 * Capability-surface contracts for the ColleX research control-plane.
 *
 * ProviderCode, FailureKind, Outcome<T>, ProviderFailure and SearchFilters
 * follow the Master Build Brief section 6.5 verbatim. The remaining types
 * (SearchHit and the capability input/output shapes) are additive: they may
 * gain fields over time but never lose or change existing ones.
 */

import type { ParsedReference } from "../retrieval/referenceParser.js";

export type ProviderCode =
  | "BEDESTEN"
  | "EMSAL"
  | "AYM"
  | "MEVZUAT"
  | "KIK"
  | "KVKK"
  | "REKABET"
  | "SAYISTAY"
  | "BDDK"
  | "BTK"
  | "GIB"
  | "SIGORTA"
  /**
   * Additive (W14/B-15): the Uyuşmazlık Mahkemesi lane. Its search tool was
   * already planned and its rows already carried `provider: "UYUSMAZLIK"`, but
   * the code was not part of this union, so the envelope mis-attributed the
   * call to BEDESTEN and the fetch descriptor could not be registered — the
   * whole court was unreachable as evidence.
   */
  | "UYUSMAZLIK";

export type FailureKind =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "PARSER_ERROR"
  | "NOT_FOUND";

export type Outcome<T> =
  | {
      status: "ok";
      data: T;
      provider: ProviderCode;
      observedAt: string;
      warnings: string[];
    }
  | {
      status: "partial";
      data: T;
      provider: ProviderCode;
      observedAt: string;
      warnings: string[];
      error: ProviderFailure;
    }
  | {
      status: "error";
      provider: ProviderCode;
      observedAt: string;
      error: ProviderFailure;
    };

export interface ProviderFailure {
  kind: FailureKind;
  retryable: boolean;
  retryAfterMs?: number;
  upstreamStatus?: number;
  correlationId: string;
  safeMessage: string;
}

export interface SearchFilters {
  sourceFamilies?: ProviderCode[];
  courtTypes?: string[];
  dateFrom?: string;
  dateTo?: string;
  asOf?: string;
  documentTypes?: string[];
}

/** One normalized search result row across all providers. */
export interface SearchHit {
  hitId: string;
  provider: ProviderCode;
  /** Raw MCP tool that produced the hit (audit/debug; planner never sees it). */
  toolName: string;
  externalId: string;
  title: string;
  snippet?: string;
  sourceUrl?: string;
  court?: string;
  decisionDate?: string;
  documentType?: string;
  score?: number;
}

export interface LegalSearchInput {
  query: string;
  exactReferences: ParsedReference[];
  filters: SearchFilters;
  candidateLimit: number;
}

export interface LegalSearchCapability {
  search(input: LegalSearchInput): Promise<Outcome<SearchHit[]>>;
}

/** Canonical fetched-document contract (Master Build Brief section 6.7, generalized to all providers). */
export interface FetchedDocument {
  source: ProviderCode;
  externalId: string;
  sourceUrl: string;
  retrievedAt: string;
  mediaType: "text/markdown";
  text: string;
  /** SHA-256 hex over the UTF-8 bytes of the NFC canonical text. */
  contentSha256: string;
  rawSnapshotRef?: string;
}

export interface DocumentFetchInput {
  externalId: string;
  provider?: ProviderCode;
  /** Long documents are paginated upstream (5,000-char pages); 1-indexed. */
  page?: number;
}

export interface DocumentFetchCapability {
  fetch(input: DocumentFetchInput): Promise<Outcome<FetchedDocument>>;
}

export interface SearchWithinInput {
  /** Document or issue identifier understood by the search_within_* family. */
  targetId: string;
  phrase: string;
  pageSize?: number;
}

export interface DocumentSearchWithinCapability {
  searchWithin(input: SearchWithinInput): Promise<Outcome<SearchHit[]>>;
}

export interface ResolveTargetInput {
  /** The amending law the user mentioned (e.g. "7499"). */
  amendingLegislationNo?: string;
  /** Direct target when already known. */
  targetLegislationNo?: string;
  articleNo?: string;
  /** ISO date; resolution happens against the version valid at this date. */
  asOf?: string;
}

export interface ResolvedTarget {
  logicalDocumentId: string;
  currentVersionId: string;
  legislationNo: string;
  asOf: string;
}

export interface LegislationResolveTargetCapability {
  resolveTarget(input: ResolveTargetInput): Promise<Outcome<ResolvedTarget>>;
}

export interface SourceHealthReport {
  provider: ProviderCode | "ALL";
  healthy: boolean;
  checkedAt: string;
  details?: string;
}

export interface SourceHealthCapability {
  health(): Promise<Outcome<SourceHealthReport[]>>;
}

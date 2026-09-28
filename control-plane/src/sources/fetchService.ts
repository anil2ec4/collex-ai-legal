/**
 * "Tam metni getir" — the ONLY thing in the sources lane that produces
 * citable evidence (W14/B-16).
 *
 * It walks the exact same road as live research (`research/liveEvidence.ts`):
 * canonicalize (CRLF folded, then NFC) -> SHA-256 over UTF-8 -> quote spans at
 * Unicode CODE POINT offsets. A card produced here and a passage produced by a
 * research run are byte-identical for the same upstream text, which is what
 * lets "Taslakta kullan" hand it to the drafter as a normal `[K-n]`.
 *
 * What it refuses to do:
 *  - build a card from a SEARCH SUMMARY (brief 10.2). The input is an id from
 *    a typed row; the text always comes from a document.fetch tool.
 *  - report a card when the upstream failed. A failure is typed and named.
 *  - claim an offset it cannot re-derive: `startChar`/`endChar` index the
 *    canonical text whose `contentSha256` the card carries, and
 *    `quoteSha256` is the hash of the slice itself.
 */

import { randomUUID } from "node:crypto";
import { FAILURE_DETAIL_TR } from "../gateway/failureText.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import {
  canonicalizeFetchedText,
  selectQuoteSpans,
  type QuoteSpan,
} from "../research/liveEvidence.js";
import {
  DOCUMENT_TOO_LARGE_PREFIX,
  MAX_DOCUMENT_PAGES,
  assemblePagedDocument,
  parseFetchPayload,
  type FetchParse,
} from "../research/payloads.js";
import { scanForInjection } from "../security/untrusted.js";
import { checkFetchUrl } from "../security/urlPolicy.js";
import {
  codePointLength,
  codePointSlice,
  sha256HexUtf8,
} from "../verification/validator.js";
import { fetchKind, type FetchKindDescriptor } from "./catalog.js";

export const DEFAULT_SOURCE_FETCH_TIMEOUT_MS = 80_000;

/** Max quote spans a single card offers. */
export const DEFAULT_CARD_QUOTE_SPANS = 2;

export interface SourceFetchRequest {
  /** Catalog fetch kind ("karar", "mevzuat", "aym", ...). */
  kind: string;
  /** The id from a typed search row; never free text the user typed. */
  externalId: string;
  /**
   * Optional relevance query: the spans offered on the card are the paragraphs
   * that best overlap it. Absent = the first quotable paragraph.
   */
  query?: string;
  /** Extra tool arguments the caller may legitimately set (e.g. page_number). */
  extra?: Readonly<Record<string, unknown>>;
}

export interface SourceQuote {
  /** Unicode code point offset (inclusive) into the canonical text. */
  startChar: number;
  /** Unicode code point offset (exclusive). */
  endChar: number;
  quote: string;
  /** SHA-256 over the UTF-8 bytes of `quote`. */
  quoteSha256: string;
  /** Lexical overlap with `query` in [0,1]; 0 when no query was given. */
  score: number;
}

/** A hash-sealed source card — the citable unit of the "Karar ara" screen. */
export interface SourceCard {
  cardId: string;
  kind: string;
  kindLabel: string;
  provider: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  /** False when the URL is outside the allow-list; the card still stands. */
  sourceUrlAllowed: boolean;
  /** SHA-256 over the UTF-8 bytes of the canonical text. */
  contentSha256: string;
  /** Length of the canonical text in Unicode code points. */
  contentCodePoints: number;
  /** Deterministic identity, identical to the live-research lane's. */
  documentId: string;
  documentVersionId: string;
  /** ISO timestamp of the fetch. */
  retrievedAt: string;
  /** "resmî kaynak" — never "SENTETİK": this text came from the upstream. */
  originLabel: string;
  quotes: SourceQuote[];
  /** Injection heuristics on the fetched text; telemetry only. */
  injectionFlagged: boolean;
  /** Full canonical text, so the card can be re-verified offline. */
  text: string;
}

export interface SourceFetchFailure {
  kind: string;
  message: string;
  correlationId: string;
}

export type SourceFetchResult =
  | { ok: true; card: SourceCard }
  | { ok: false; failure: SourceFetchFailure };

export class UnknownFetchKindError extends Error {
  constructor(readonly requestedKind: string) {
    super(`unknown fetch kind: ${requestedKind}`);
    this.name = "UnknownFetchKindError";
  }
}

const FETCH_FAILURE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  RATE_LIMITED:
    "Kaynak sunucu istek sınırına takıldı (RATE_LIMITED); biraz sonra tekrar deneyin.",
  TIMEOUT: "Kaynak sunucu süresinde yanıt vermedi (TIMEOUT).",
  UNAVAILABLE: "Kaynak sunucuya ulaşılamadı (UNAVAILABLE); belge getirilemedi.",
  UNAUTHORIZED: "Bu kaynak için gerekli kimlik tanımlı değil (UNAUTHORIZED).",
  INVALID_REQUEST: "Belge isteği geçersiz (INVALID_REQUEST).",
  PARSER_ERROR: "Kaynak beklenmedik biçimde yanıt verdi (PARSER_ERROR); belge okunamadı.",
  NOT_FOUND: "Bu kimlikle bir belge bulunamadı (NOT_FOUND).",
  DOCUMENT_TOO_LARGE: `Belge ${MAX_DOCUMENT_PAGES} sayfadan uzun; ColleX tam metni mühürleyemedi ve bir kısmını tam metin gibi göstermez (DOCUMENT_TOO_LARGE). Belgeyi kaynağından açın.`,
});

export function fetchFailureMessageTr(kind: string, detail?: "TLS_CERTIFICATE"): string {
  if (detail !== undefined && kind === "UNAVAILABLE") {
    const clause = FAILURE_DETAIL_TR[detail];
    return `${clause.charAt(0).toLocaleUpperCase("tr-TR")}${clause.slice(1)} (${kind}).`;
  }
  return (
    FETCH_FAILURE_MESSAGES[kind] ??
    `Belge getirilemedi (${kind}). Kaynak kartı üretilmedi.`
  );
}

export interface SourceFetchDeps {
  gateway: ProviderGateway;
  now?: () => string;
  newId?: () => string;
  perCallTimeoutMs?: number;
  /** Max quote spans on the card (default DEFAULT_CARD_QUOTE_SPANS). */
  maxSpans?: number;
}

function buildInput(
  descriptor: FetchKindDescriptor,
  request: SourceFetchRequest,
): Record<string, unknown> {
  return {
    ...(descriptor.extraInput ?? {}),
    ...(request.extra ?? {}),
    // The id parameter is written LAST so a caller's `extra` can never
    // overwrite the identity the row supplied.
    [descriptor.idParam]: request.externalId,
  };
}

function toQuote(text: string, span: QuoteSpan): SourceQuote {
  const quote = codePointSlice(text, span.startChar, span.endChar);
  return {
    startChar: span.startChar,
    endChar: span.endChar,
    quote,
    quoteSha256: sha256HexUtf8(quote),
    score: span.score,
  };
}

/**
 * Fetch one record in full and build its hash-sealed card. Never throws for an
 * upstream problem — that is a typed `{ok:false}` — and throws only for an
 * unknown fetch kind, which is a caller bug the router turns into a 400.
 */
export async function fetchSourceCard(
  request: SourceFetchRequest,
  deps: SourceFetchDeps,
): Promise<SourceFetchResult> {
  const descriptor = fetchKind(request.kind);
  if (descriptor === undefined) throw new UnknownFetchKindError(request.kind);

  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());
  const timeoutMs = deps.perCallTimeoutMs ?? DEFAULT_SOURCE_FETCH_TIMEOUT_MS;
  const retrievedAt = now();
  const input = buildInput(descriptor, request);

  const fail = (kind: string, detail?: "TLS_CERTIFICATE"): SourceFetchResult => ({
    ok: false,
    failure: { kind, message: fetchFailureMessageTr(kind, detail), correlationId: newId() },
  });

  let outcome;
  try {
    outcome = await deps.gateway.callTool(
      { toolName: descriptor.toolName, args: input },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch {
    return fail("UNAVAILABLE");
  }
  if (outcome.status === "error") return fail(outcome.error.kind, outcome.error.detail);

  const first = parseFetchPayload(descriptor.toolName, input, outcome.data);
  // A paged tool (KVKK, BTK, GİB, Rekabet, AYM, BDDK, Sigorta Tahkim) returns
  // 5 000 characters at a time: the card seals the WHOLE text or nothing.
  const parsed = await assemblePagedDocument(first, async (page): Promise<FetchParse> => {
    const args = { ...input, page_number: page };
    try {
      const next = await deps.gateway.callTool(
        { toolName: descriptor.toolName, args },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (next.status === "error") {
        return { kind: "failure", failure: { kind: next.error.kind, retryable: false, safeMessage: "page fetch failed" } };
      }
      return parseFetchPayload(descriptor.toolName, args, next.data);
    } catch {
      return { kind: "failure", failure: { kind: "UNAVAILABLE", retryable: true, safeMessage: "page fetch failed" } };
    }
  });
  if (parsed.kind === "failure") {
    return fail(
      parsed.failure.safeMessage.startsWith(DOCUMENT_TOO_LARGE_PREFIX) ? "DOCUMENT_TOO_LARGE" : parsed.failure.kind,
      parsed.failure.detail,
    );
  }

  const text = canonicalizeFetchedText(parsed.doc.text);
  if (text.trim() === "") return fail("PARSER_ERROR");

  const contentSha256 = sha256HexUtf8(text);
  const documentId = `live:${descriptor.provider}:${parsed.doc.externalId}`;
  const spans = selectQuoteSpans(text, request.query ?? "", {
    maxSpans: deps.maxSpans ?? DEFAULT_CARD_QUOTE_SPANS,
  });
  const injection = scanForInjection(text);
  const sourceUrl = parsed.doc.sourceUrl;

  return {
    ok: true,
    card: {
      cardId: newId(),
      kind: descriptor.kind,
      kindLabel: descriptor.label,
      provider: descriptor.provider,
      externalId: parsed.doc.externalId,
      title: parsed.doc.title,
      sourceUrl,
      sourceUrlAllowed: sourceUrl === "" ? false : checkFetchUrl(sourceUrl).ok,
      contentSha256,
      contentCodePoints: codePointLength(text),
      documentId,
      documentVersionId: `${documentId}@${contentSha256.slice(0, 16)}`,
      retrievedAt,
      // TRMARKET: for a lawyer "(SENTETİK)" reads as "this system invents
      // decisions". A document pulled from the upstream at run time says what
      // it is — an official source, with the day it was fetched.
      originLabel: "resmî kaynak",
      quotes: spans.map((span) => toQuote(text, span)),
      injectionFlagged: injection.flagged,
      text,
    },
  };
}

/**
 * Re-verify a card offline: the canonical text must still hash to
 * `contentSha256`, and every quote must slice back at its own offsets. This is
 * the same check the deterministic validator runs over an evidence bundle, and
 * it is what makes "hash'li kanıt kartı" a claim rather than a label.
 */
export function verifySourceCard(card: SourceCard): {
  ok: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  if (sha256HexUtf8(card.text) !== card.contentSha256) {
    problems.push("CONTENT_HASH_MISMATCH");
  }
  if (codePointLength(card.text) !== card.contentCodePoints) {
    problems.push("CONTENT_LENGTH_MISMATCH");
  }
  for (const quote of card.quotes) {
    const slice = codePointSlice(card.text, quote.startChar, quote.endChar);
    if (slice !== quote.quote) problems.push(`QUOTE_OFFSET_MISMATCH:${quote.startChar}`);
    else if (sha256HexUtf8(quote.quote) !== quote.quoteSha256) {
      problems.push(`QUOTE_HASH_MISMATCH:${quote.startChar}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

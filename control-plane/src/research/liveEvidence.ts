/**
 * Fetched-document evidence builder for live deep research (Lane F2; brief
 * §10 "Search snippet'i cite edilemez; full fetch gerekir" + §6.7 canonical
 * fetch contract).
 *
 * Live evidence quotes come EXCLUSIVELY from full documents fetched via the
 * document.fetch capability:
 *
 *   - the fetched markdown is canonicalized (CRLF/CR folded to "\n", then NFC)
 *     and hashed (SHA-256 over UTF-8) — `EvidenceRef.contentSha256` is the
 *     hash of that canonical fetched text, which the deterministic validator
 *     re-checks;
 *   - quote spans are Unicode CODE POINT offsets into that canonical text
 *     (project offset policy, ADR-003), selected at paragraph level by lexical
 *     overlap with the research question;
 *   - fetched texts live in an in-memory per-run store keyed by
 *     (source, externalId, sha256) and are exposed for the evidence-bundle
 *     `texts` path, so every citation can be re-derived offline.
 *
 * A search snippet never enters this module. There is nothing here a snippet
 * could even become: candidates are built only from stored fetched documents.
 */

import type { CanonicalTextPort, AnswerCandidate, EvidenceStance } from "../answer/evidencePack.js";
import { assessQuestionCoverage } from "../answer/coverage.js";
import type { InjectionScanResult } from "../security/untrusted.js";
import { codePointLength, codePointSlice, sha256HexUtf8 } from "../verification/validator.js";

// ---------------------------------------------------------------------------
// Canonical text
// ---------------------------------------------------------------------------

/**
 * Canonical form of a fetched markdown body: line endings folded to "\n",
 * then NFC. All offsets and hashes in this lane are computed over THIS string;
 * `buildEvidencePack`'s own `.normalize("NFC")` is a no-op on it.
 */
export function canonicalizeFetchedText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").normalize("NFC");
}

// ---------------------------------------------------------------------------
// In-memory fetched-document store
// ---------------------------------------------------------------------------

/** A fully fetched live document, canonicalized and hashed. */
export interface LiveFetchedDocument {
  /** Provider family ("BEDESTEN", "MEVZUAT", "AYM", ...). */
  source: string;
  externalId: string;
  sourceUrl: string;
  title: string;
  toolName: string;
  retrievedAt: string;
  mediaType: "text/markdown";
  /** Canonical NFC text (see canonicalizeFetchedText). */
  text: string;
  /** SHA-256 hex over the UTF-8 bytes of `text`. */
  contentSha256: string;
}

export interface StoredLiveDocument {
  doc: LiveFetchedDocument;
  /** Deterministic identity derived from (source, externalId). */
  documentId: string;
  /** Deterministic version identity derived from the content hash. */
  documentVersionId: string;
  /** Injection telemetry over the fetched text (flags only; never control flow). */
  injection: InjectionScanResult;
}

/**
 * Per-run in-memory store of fetched documents, keyed by
 * (source, externalId, sha256). Same key twice is a no-op (same content), so a
 * re-fetch cannot spawn a second version of identical text.
 */
export class LiveDocumentStore {
  private readonly byKey = new Map<string, StoredLiveDocument>();
  private readonly byVersionId = new Map<string, StoredLiveDocument>();

  put(doc: LiveFetchedDocument, injection: InjectionScanResult): StoredLiveDocument {
    const key = `${doc.source}|${doc.externalId}|${doc.contentSha256}`;
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const documentId = `live:${doc.source}:${doc.externalId}`;
    const documentVersionId = `${documentId}@${doc.contentSha256.slice(0, 16)}`;
    const stored: StoredLiveDocument = { doc, documentId, documentVersionId, injection };
    this.byKey.set(key, stored);
    this.byVersionId.set(documentVersionId, stored);
    return stored;
  }

  list(): StoredLiveDocument[] {
    return [...this.byKey.values()];
  }

  getByVersionId(documentVersionId: string): StoredLiveDocument | undefined {
    return this.byVersionId.get(documentVersionId);
  }

  /** CanonicalTextPort over the stored fetched texts (for buildEvidencePack). */
  textPort(): CanonicalTextPort {
    return {
      getCanonicalText: async (documentVersionId: string): Promise<string | undefined> =>
        this.byVersionId.get(documentVersionId)?.doc.text,
    };
  }

  /** documentVersionId -> canonical text (the bundle `texts=true` path). */
  texts(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const stored of this.byVersionId.values()) {
      out[stored.documentVersionId] = stored.doc.text;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Quote span selection (paragraph-level lexical overlap)
// ---------------------------------------------------------------------------

export interface QuoteSpan {
  /** Unicode code point offset (inclusive) into the canonical text. */
  startChar: number;
  /** Unicode code point offset (exclusive). */
  endChar: number;
  /** Lexical overlap score with the query in [0,1]. */
  score: number;
}

export interface SelectQuoteOptions {
  /** Max spans returned per document (default 2). */
  maxSpans?: number;
  /** Minimum paragraph length in code points to be quotable (default 40). */
  minSpanCodePoints?: number;
  /** Maximum span length in code points; longer paragraphs are cut (default 600). */
  maxSpanCodePoints?: number;
}

interface Block {
  startChar: number;
  endChar: number;
  text: string;
}

/** Split canonical text into blank-line-separated blocks with CP offsets. */
function paragraphBlocks(canonicalText: string): Block[] {
  const blocks: Block[] = [];
  const lines = canonicalText.split("\n");
  let offset = 0; // code point offset of the current line start
  let current: { start: number; parts: string[]; end: number } | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const lineLength = codePointLength(line);
    const blank = line.trim() === "";
    if (blank) {
      if (current !== undefined) {
        blocks.push({
          startChar: current.start,
          endChar: current.end,
          text: current.parts.join("\n"),
        });
        current = undefined;
      }
    } else if (current === undefined) {
      current = { start: offset, parts: [line], end: offset + lineLength };
    } else {
      current.parts.push(line);
      current.end = offset + lineLength;
    }
    offset += lineLength + 1; // +1 for the "\n" separator
  }
  if (current !== undefined) {
    blocks.push({ startChar: current.start, endChar: current.end, text: current.parts.join("\n") });
  }
  return blocks;
}

/**
 * Select the paragraph spans of a fetched document that best match the query,
 * by normalized-token overlap. Deterministic: score desc, then position asc.
 * When nothing overlaps, the first quotable paragraph is returned so the
 * document stays representable — the entailment verifier then judges it.
 */
export function selectQuoteSpans(
  canonicalText: string,
  queryText: string,
  options: SelectQuoteOptions = {},
): QuoteSpan[] {
  const maxSpans = options.maxSpans ?? 2;
  const minLen = options.minSpanCodePoints ?? 40;
  const maxLen = options.maxSpanCodePoints ?? 600;
  if (maxSpans <= 0 || !Number.isFinite(maxLen) || maxLen < 1) return [];

  const points = Array.from(canonicalText);
  const scored: QuoteSpan[] = [];
  for (const block of paragraphBlocks(canonicalText)) {
    const length = block.endChar - block.startChar;
    if (length < minLen) continue;
    // Score what will actually be quoted, not a whole paragraph whose
    // relevant tail is then discarded. Overlapping search windows avoid
    // losing a sentence merely because it crosses a window boundary.
    const stride = Math.max(1, Math.floor(maxLen / 2));
    for (let offset = block.startChar; offset < block.endChar; offset += stride) {
      let startChar = offset;
      let endChar = Math.min(offset + Math.floor(maxLen), block.endChar);
      while (startChar > block.startChar && startChar < endChar && !/\s/u.test(points[startChar - 1]!)) startChar++;
      while (endChar < block.endChar && endChar > startChar && !/\s/u.test(points[endChar]!)) endChar--;
      if (endChar - startChar < minLen) continue;
      const quote = points.slice(startChar, endChar).join("");
      const score = assessQuestionCoverage(queryText, [quote]).ratio;
      if (quote.trim() !== "") scored.push({ startChar, endChar, score });
      if (endChar === block.endChar) break;
    }
  }

  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.startChar - b.startChar));
  const positive: QuoteSpan[] = [];
  for (const span of scored) {
    if (span.score <= 0 || positive.length >= maxSpans) break;
    if (positive.some((chosen) => span.startChar < chosen.endChar && chosen.startChar < span.endChar)) continue;
    positive.push(span);
  }
  if (positive.length > 0) {
    // Stable document order for equal-rank presentation.
    return positive.sort((a, b) => a.startChar - b.startChar);
  }
  return scored.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Answer candidates from fetched documents
// ---------------------------------------------------------------------------

export interface LiveCandidateMetadata {
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
}

export interface BuildLiveCandidatesOptions {
  /** Actual question, without planner expansions, for procedural-question exceptions. */
  questionText?: string;
  onStockAffirmanceExcluded?: () => void;
  /** For judgments with explicit reasoning headings, avoid quoting party/court summaries as the reasoning. */
  preferReasoning?: boolean;
  /** Query the spans are selected against (question + issue labels). */
  queryText: string;
  stance: EvidenceStance;
  /** Citation metadata carried over from the TYPED search hit, if any. */
  metadata?: LiveCandidateMetadata;
  quotes?: SelectQuoteOptions;
}

/**
 * Build evidence-pack candidates from ONE stored fetched document. Offsets are
 * code points into the stored canonical text, so `buildEvidencePack` slices
 * the exact quote and its self-check validator passes by construction.
 */
export function buildLiveCandidates(
  stored: StoredLiveDocument,
  options: BuildLiveCandidatesOptions,
): AnswerCandidate[] {
  let text = stored.doc.text;
  let offset = 0;
  if (options.preferReasoning) {
    const heading = /^(?:[A-ZÇĞİÖŞÜIVX]+[.)]\s*)?(?:DEĞERLENDİRME VE GEREKÇE|Değerlendirme ve Gerekçe|GEREKÇE)\s*$/mu.exec(text);
    if (heading !== null) {
      offset = codePointLength(text.slice(0, heading.index + heading[0].length));
      text = text.slice(heading.index + heading[0].length);
      const ending = /^(?:[IVX]+[.)]\s*)?(?:KARAR|HÜKÜM|SONUÇ)\s*$/mu.exec(text);
      if (ending !== null) text = text.slice(0, ending.index);
      if (isOnlyStockAffirmance(text) && !/\b371\b|temyiz|bozma|bozulma|onama|onanma/iu.test(options.questionText ?? options.queryText)) {
        options.onStockAffirmanceExcluded?.();
        return [];
      }
    }
  }
  const spans = selectQuoteSpans(text, options.queryText, options.quotes)
    .map(span => ({ ...span, startChar: span.startChar + offset, endChar: span.endChar + offset }));
  const meta = options.metadata ?? {};
  return spans.map((span, index) => ({
    hitId: `${stored.documentVersionId}#q${index + 1}`,
    documentId: stored.documentId,
    documentVersionId: stored.documentVersionId,
    chunkId: `${stored.documentVersionId}#q${index + 1}`,
    source: stored.doc.source,
    sourceUrl: stored.doc.sourceUrl,
    title: stored.doc.title,
    ...(meta.court !== undefined ? { court: meta.court } : {}),
    ...(meta.decisionDate !== undefined ? { decisionDate: meta.decisionDate } : {}),
    ...(meta.docketNo !== undefined ? { docketNo: meta.docketNo } : {}),
    ...(meta.decisionNo !== undefined ? { decisionNo: meta.decisionNo } : {}),
    ...(meta.legislationNo !== undefined ? { legislationNo: meta.legislationNo } : {}),
    startChar: span.startChar,
    endChar: span.endChar,
    score: span.score > 0 ? 0.4 + 0.6 * Math.min(1, span.score) : 0.4,
    stance: options.stance,
  }));
}

/** A closed, observed template; extra substantive text must prevent exclusion. */
export function isOnlyStockAffirmance(text: string): boolean {
  const normalized = text.replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim()
    .replace("6100 sayılı Hukuk Muhakemeleri Kanunu'nun (6100 sayılı Kanun)", "6100 sayılı Kanun'un")
    .replace("uygun olup davalı vekili tarafından", "uygun olup davacı vekili tarafından");
  const withoutTopic = normalized.replace(/^Uyuşmazlık, [^.]+ ilişkindir\.\s*/u, "");
  const reversal = "Bölge adliye mahkemelerinin nihai kararlarının bozulması 6100 sayılı Kanun'un 371. maddesinde yer alan sebeplerden birinin varlığı hâlinde mümkündür.";
  const affirmance = "Temyizen incelenen karar, tarafların karşılıklı iddia ve savunmalarına, dayandıkları belgelere, uyuşmazlığa uygulanması gereken hukuk kuralları ile hukuki ilişkinin nitelendirilmesine, dava şartlarına, yargılama ve ispat kuralları ile kararda belirtilen gerekçelere göre usul ve kanuna uygun olup davacı vekili tarafından temyiz dilekçesinde ileri sürülen nedenler kararın bozulmasını gerektirecek nitelikte görülmemiştir.";
  return withoutTopic === reversal + " " + affirmance;
}

/** Convenience: sha256 of a fetched raw body after canonicalization. */
export function sha256OfFetchedText(raw: string): string {
  return sha256HexUtf8(canonicalizeFetchedText(raw));
}

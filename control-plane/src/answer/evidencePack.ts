/**
 * EvidencePack builder (Master Build Brief section 9 — citation-first answers).
 *
 * Turns ranked retrieval candidates into fully materialized `EvidenceRef`s:
 *  - REAL quote extraction against the canonical NFC text using Unicode
 *    CODE POINT offsets (project-wide offset policy; see
 *    verification/validator.ts and fixtures/offset_policy.json);
 *  - SHA-256 hashes over the UTF-8 bytes of quote and full canonical text;
 *  - a deterministic self-check through `validateEvidence` so nothing that
 *    would fail the downstream validator ever enters a pack;
 *  - rule-based authority classification (mevzuat > AYM > içtihadı
 *    birleştirme > yüksek mahkeme dairesi > BAM/ilk derece > kurul kararı);
 *  - currentness assessment of the evidence's effective period against the
 *    question's `as_of` date (mülga/repeal aware).
 *
 * Everything here is deterministic and offline; the only I/O is the injected
 * `CanonicalTextPort`.
 */

import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { EvidenceRef } from "../evidence/types.js";
import {
  codePointLength,
  codePointSlice,
  sha256HexUtf8,
  validateEvidence,
} from "../verification/validator.js";
import { contentLexemes, lexemesMatch, stemTurkish } from "./coverage.js";

/**
 * Default cap on one quote, in Unicode code points (W12-FIX2, review P1-5b).
 * A 3.4 MB upload used to reach the answer as one multi-megabyte quote; the
 * chunker now caps generic chunks at 4 000 characters, and this cap bounds
 * every OTHER chunker's output (a long madde, a full decision section) the
 * same way: the quote shown is a window of at most this many code points
 * around the best match of the question's words, and the evidence ref —
 * offsets, quote, quoteSha256 — describes THAT window exactly, so the
 * deterministic validator and the Python exporter re-derive it unchanged.
 */
export const DEFAULT_MAX_QUOTE_CODE_POINTS = 4000;

/** Stance of a candidate relative to the researched proposition. */
export type EvidenceStance = "supporting" | "contrary" | "neutral";

/**
 * Where the passage's document came from (additive, W12 lane B):
 *  - "upload": a document the lawyer uploaded (legal.documents.scope =
 *    'tenant'); rendered as "yüklediğiniz belge";
 *  - "corpus": the local legal corpus;
 *  - "live":   reserved for the live research lane.
 */
export type EvidenceOrigin = "upload" | "corpus" | "live";

/**
 * How retrieval reached the passage (additive, W12 lane B). The drafter uses
 * it: a provision reached by following a citation out of another passage
 * ("citation") or a stored amendment edge ("relation") is context, and never
 * leads an answer unless the question itself cited it.
 */
export type EvidenceArrival = "direct" | "citation" | "relation" | "contrary";

/**
 * RankedHit-like retrieval candidate: identity + provenance + the code point
 * span of the passage inside the canonical document version text.
 */
export interface AnswerCandidate {
  hitId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  /** Provider/source family, e.g. "MEVZUAT", "BEDESTEN", "AYM", "KVKK". */
  source: string;
  sourceUrl: string;
  title: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  article?: string;
  paragraph?: string;
  page?: number;
  /** Unicode code point offset (inclusive) of the passage in the canonical text. */
  startChar: number;
  /** Unicode code point offset (exclusive) of the passage in the canonical text. */
  endChar: number;
  /** Normalized retrieval score in [0,1] when the ranking layer provides one. */
  score?: number;
  /** Start of the version's effective period (ISO date), when known. */
  effectiveFrom?: string;
  /** End of the version's effective period (ISO date); absent = still in force. */
  effectiveTo?: string;
  /** True when the provision/document is repealed (mülga). */
  repealed?: boolean;
  stance?: EvidenceStance;
  origin?: EvidenceOrigin;
  arrival?: EvidenceArrival;
}

/** Port for fetching the canonical NFC text of a document version. */
export interface CanonicalTextPort {
  getCanonicalText(documentVersionId: string): Promise<string | undefined>;
}

/** Authority tier: 1 is the most authoritative. */
export type AuthorityTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AuthorityAssessment {
  tier: AuthorityTier;
  label: string;
  rationale: string;
  /** Rule-based confidence weight in [0,1] used for the claim `authority` axis. */
  score: number;
}

/**
 * Currentness of one passage at the question's as-of date.
 *
 * "NOT_APPLICABLE" (additive, W12-B2) is the state of an UPLOADED document
 * (origin "upload"): the lawyer's own file is neither legislation nor a
 * decision, so it has no yürürlük period to assess. It is rendered as
 * "yüklediğiniz belge — yürürlük değerlendirilemez" and carries the NEUTRAL
 * score (see CURRENTNESS_NEUTRAL_SCORE), so it neither raises
 * OUT_OF_DATE_SOURCE nor blocks finalization — and it never vouches for the
 * document either: the answer's finalizable line says the document's
 * accuracy and currentness were not checked.
 */
export type CurrentnessStatus =
  | "IN_FORCE"
  | "OUT_OF_DATE"
  | "REPEALED"
  | "NOT_YET_IN_FORCE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

/**
 * Score of a NOT_APPLICABLE currentness assessment.
 *
 * NEUTRAL means "this dimension does not gate the claim": the finalization
 * threshold (verification/finalize.ts, CURRENTNESS_THRESHOLD) fails closed on
 * anything below 0.9, so a value that must not block has to sit at the top
 * of the range. It is NOT a statement that the uploaded document is current;
 * the verifier excludes NOT_APPLICABLE passages from the claim's currentness
 * axis whenever a corpus passage is present (the strict rule still applies
 * to the corpus part of a mixed answer), and reports the claim's
 * `currentnessApplicable: false` so every surface can render the label
 * instead of a percentage.
 */
export const CURRENTNESS_NEUTRAL_SCORE = 1.0;

/** Turkish rationale carried by a NOT_APPLICABLE assessment. */
export const CURRENTNESS_NOT_APPLICABLE_RATIONALE_TR =
  "Yüklediğiniz belge — yürürlük değerlendirilemez: belge mevzuat veya içtihat " +
  "değildir, yürürlük dönemi kavramı uygulanmaz; belgenin doğruluğu ve güncelliği " +
  "denetlenmemiştir.";

export interface CurrentnessAssessment {
  status: CurrentnessStatus;
  /** Confidence weight in [0,1] used for the claim `currentness` axis. */
  score: number;
  asOf: string;
  rationale: string;
}

export interface EvidenceItem {
  ref: EvidenceRef;
  authority: AuthorityAssessment;
  currentness: CurrentnessAssessment;
  /** Retrieval confidence in [0,1] (candidate score, defaulted conservatively). */
  retrievalScore: number;
  stance: EvidenceStance;
  /** Carried verbatim from the candidate (additive; absent when unknown). */
  origin?: EvidenceOrigin;
  arrival?: EvidenceArrival;
  /**
   * Additive (W12-FIX2): the candidate span was longer than the quote cap;
   * `ref` describes the window that was kept, this records the original
   * span so the reader can tell "alıntı kısaltıldı" from a short passage.
   */
  quoteTruncated?: { originalStartChar: number; originalEndChar: number; originalCodePoints: number };
}

export interface RejectedCandidate {
  candidate: AnswerCandidate;
  reason: string;
}

export interface EvidencePack {
  asOf: string;
  builtAt: string;
  items: EvidenceItem[];
  rejected: RejectedCandidate[];
  /** Canonical NFC text per documentVersionId, for deterministic re-validation. */
  texts: Record<string, string>;
}

export interface BuildEvidencePackOptions {
  /** ISO date the question is asked "as of"; drives currentness assessment. */
  asOf: string;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
  /**
   * Additive (W12-B2): origin stamped on every candidate that carries none.
   * The live research lane builds its candidates from fetched documents and
   * should pass `"live"` here so its evidence is marked honestly on every
   * shared surface (source card, bundle, stored result); a candidate that
   * already carries an origin is never overridden.
   */
  defaultOrigin?: EvidenceOrigin;
  /**
   * Additive (W12-FIX2): cap every quote at `maxCodePoints`, keeping the
   * window that carries the most of `focus`'s content words (the question).
   * Absent = no cap (the pre-W12-FIX2 behaviour; tests that assert whole
   * chunk quotes rely on it).
   */
  quoteCap?: { maxCodePoints: number; focus?: string };
}

function isSpace(point: string | undefined): boolean {
  return point !== undefined && /\s/u.test(point);
}

/**
 * The window of at most `max` code points of `quote` that carries the most
 * of `focus`'s content words (ties: the earliest), snapped to word
 * boundaries and trimmed of surrounding whitespace. Offsets are code points
 * relative to `quote`. Deterministic; no focus (or no match) = the head.
 * Exported for tests.
 */
export function bestQuoteWindow(
  quote: string,
  max: number,
  focus: string | undefined,
): { start: number; end: number } {
  const points = Array.from(quote);
  const total = points.length;
  if (total <= max) return { start: 0, end: total };

  const focusStems = focus === undefined ? [] : contentLexemes(focus).map((word) => stemTurkish(word));
  const matches: number[] = [];
  if (focusStems.length > 0) {
    // Walk the code points once; a word is a maximal run of letters/marks/digits.
    let wordStart = -1;
    const flush = (end: number): void => {
      if (wordStart === -1) return;
      const word = normalizeTurkishSearch(points.slice(wordStart, end).join(""));
      const stem = stemTurkish(word);
      if (stem.length >= 3 && focusStems.some((f) => lexemesMatch(f, stem))) matches.push(wordStart);
      wordStart = -1;
    };
    for (let i = 0; i < total; i += 1) {
      if (/[\p{L}\p{M}\p{N}]/u.test(points[i] as string)) {
        if (wordStart === -1) wordStart = i;
      } else flush(i);
    }
    flush(total);
  }

  let start = 0;
  if (matches.length > 0) {
    let best = -1;
    const lead = Math.floor(max / 3);
    for (const position of matches) {
      const candidate = Math.max(0, Math.min(position - lead, total - max));
      let count = 0;
      for (const m of matches) if (m >= candidate && m < candidate + max) count += 1;
      if (count > best || (count === best && candidate < start)) {
        best = count;
        start = candidate;
      }
    }
  }
  // Snap to word boundaries: start at the first character after a space,
  // end at the last character before one; never grow past `max`.
  while (start > 0 && start < total && !isSpace(points[start - 1])) start += 1;
  let end = Math.min(total, start + max);
  while (end > start + 1 && end < total && !isSpace(points[end])) end -= 1;
  while (start < end && isSpace(points[start])) start += 1;
  while (end > start && isSpace(points[end - 1])) end -= 1;
  if (end <= start) return { start: 0, end: Math.min(total, max) };
  return { start, end };
}

const KURUL_SOURCES = new Set([
  "KVKK",
  "REKABET",
  "BDDK",
  "BTK",
  "KIK",
  "SAYISTAY",
  "GIB",
  "SIGORTA",
]);

/**
 * Rule-based authority classification. Tiers (brief 9.1 layer 5):
 *   1 mevzuat > 2 AYM > 3 Yargıtay/Danıştay içtihadı birleştirme >
 *   4 daire kararı > 5 BAM/ilk derece > 6 kurul kararı > 7 unknown.
 */
export function classifyAuthority(candidate: {
  source: string;
  court?: string;
  legislationNo?: string;
}): AuthorityAssessment {
  const source = candidate.source.toUpperCase();
  const court = normalizeTurkishSearch(candidate.court ?? "");

  if (source === "MEVZUAT" || (candidate.legislationNo !== undefined && court === "")) {
    return {
      tier: 1,
      label: "Mevzuat",
      score: 1.0,
      rationale: "Kaynak mevzuat metnidir; bağlayıcı norm.",
    };
  }
  if (source === "AYM" || court.includes("anayasa mahkemesi")) {
    return {
      tier: 2,
      label: "Anayasa Mahkemesi",
      score: 0.95,
      rationale: "Anayasa Mahkemesi kararı.",
    };
  }
  if (court.includes("içtihadı birleştirme") || court.includes("içtihatları birleştirme")) {
    return {
      tier: 3,
      label: "İçtihadı Birleştirme Kararı",
      score: 0.9,
      rationale: "Yargıtay/Danıştay içtihadı birleştirme kararı; bağlayıcı içtihat.",
    };
  }
  if (court.includes("yargıtay") || court.includes("danıştay")) {
    return {
      tier: 4,
      label: "Yüksek mahkeme daire kararı",
      score: 0.8,
      rationale: "Yargıtay/Danıştay daire (veya kurul dışı) kararı.",
    };
  }
  if (
    court.includes("bölge adliye") ||
    court.includes("bölge idare") ||
    court.includes("istinaf") ||
    court.includes("asliye") ||
    court.includes("sulh") ||
    court.includes("ağır ceza") ||
    court.includes("idare mahkemesi") ||
    court.includes("vergi mahkemesi") ||
    court.includes("iş mahkemesi")
  ) {
    return {
      tier: 5,
      label: "İstinaf/ilk derece kararı",
      score: 0.65,
      rationale: "BAM veya ilk derece mahkemesi kararı; emsal gücü sınırlı.",
    };
  }
  if (KURUL_SOURCES.has(source) || court.includes("kurul")) {
    return {
      tier: 6,
      label: "Kurul kararı",
      score: 0.55,
      rationale: "İdari kurul/kurum kararı; yargı içtihadı değildir.",
    };
  }
  return {
    tier: 7,
    label: "Sınıflandırılamadı",
    score: 0.4,
    rationale: "Kaynak otorite sınıfı kural tabanlı olarak belirlenemedi.",
  };
}

/** Compare ISO dates by their YYYY-MM-DD prefix (lexicographic-safe). */
function isoDay(value: string): string {
  return value.slice(0, 10);
}

/**
 * Currentness of one evidence item at `asOf` (brief 9.1 layer 5; mülga aware).
 * Score is a conservative confidence for the claim `currentness` axis.
 */
export function assessCurrentness(
  candidate: {
    effectiveFrom?: string;
    effectiveTo?: string;
    repealed?: boolean;
    decisionDate?: string;
    origin?: EvidenceOrigin;
  },
  asOf: string,
): CurrentnessAssessment {
  // An uploaded document is the lawyer's own text, not law: there is no
  // yürürlük period to compare as_of against. Treating it like legislation
  // with no dates made every file-scoped answer PARTIAL / OUT_OF_DATE_SOURCE
  // (integration probe, 02.09.2026). The dimension is not applicable, and it
  // says so; it does not pretend the document is current.
  if (candidate.origin === "upload") {
    return {
      status: "NOT_APPLICABLE",
      score: CURRENTNESS_NEUTRAL_SCORE,
      asOf,
      rationale: CURRENTNESS_NOT_APPLICABLE_RATIONALE_TR,
    };
  }
  const day = isoDay(asOf);
  const from = candidate.effectiveFrom === undefined ? undefined : isoDay(candidate.effectiveFrom);
  const to = candidate.effectiveTo === undefined ? undefined : isoDay(candidate.effectiveTo);

  if (from !== undefined && day < from) {
    return {
      status: "NOT_YET_IN_FORCE",
      score: 0.1,
      asOf,
      rationale: `as_of (${day}) yürürlük başlangıcından (${from}) önce; bu sürüm o tarihte geçerli değildi.`,
    };
  }
  if (to !== undefined && day >= to) {
    if (candidate.repealed === true) {
      return {
        status: "REPEALED",
        score: 0.1,
        asOf,
        rationale: `Hüküm mülga: ${to} itibarıyla yürürlükten kaldırılmış; as_of (${day}) sonrası.`,
      };
    }
    return {
      status: "OUT_OF_DATE",
      score: 0.2,
      asOf,
      rationale: `Sürümün yürürlüğü ${to} tarihinde sona ermiş; as_of (${day}) itibarıyla güncel değil.`,
    };
  }
  if (candidate.repealed === true && to === undefined) {
    return {
      status: "REPEALED",
      score: 0.1,
      asOf,
      rationale: "Hüküm mülga olarak işaretli (yürürlükten kalkış tarihi bilinmiyor).",
    };
  }
  if (from !== undefined) {
    return {
      status: "IN_FORCE",
      score: 1.0,
      asOf,
      rationale: `as_of (${day}) itibarıyla yürürlükte (yürürlük: ${from}${to === undefined ? " → devam" : ` → ${to}`}).`,
    };
  }
  if (candidate.decisionDate !== undefined) {
    // Court/board decisions have no effective period; treat as current unless
    // superseded data says otherwise.
    return {
      status: "IN_FORCE",
      score: 0.95,
      asOf,
      rationale: "Karar metni; yürürlük dönemi kavramı uygulanmaz, güncel kabul edildi.",
    };
  }
  return {
    status: "UNKNOWN",
    score: 0.7,
    asOf,
    rationale: "Yürürlük dönemi bilgisi yok; güncellik doğrulanamadı (muhafazakâr skor).",
  };
}

/** Deterministic evidence id derived from version + span (stable across runs). */
export function deterministicEvidenceId(
  documentVersionId: string,
  startChar: number,
  endChar: number,
): string {
  return `ev-${sha256HexUtf8(`${documentVersionId}|${startChar}|${endChar}`).slice(0, 16)}`;
}

/**
 * "N sayılı <başlık>" without ever doubling the prefix.
 *
 * Amendment-law titles frequently already BEGIN with "7999 sayılı ..."; the
 * old unconditional prefix produced "7999 sayılı 7999 sayılı Bazı
 * Kanunlarda ..." on every surface (tespit metni, taslak Dayanak satırı,
 * DAYANAK KAYNAKLARI eki). This is THE single builder for that label:
 * `citeLabel` and the drafting lane's `draftEvidenceLabel` both call it, so
 * every surface inherits the fix.
 */
export function legislationLabel(legislationNo: string, title: string): string {
  // NOTE: no `\b` after "sayılı" — JS \b is ASCII-only and never matches
  // after the Turkish dotless ı; a lookahead for whitespace/end does the job.
  return /^\s*\d+\s+sayılı(?=\s|$)/u.test(title)
    ? title.trim()
    : `${legislationNo} sayılı ${title}`;
}

/** Human-readable citation label built ONLY from evidence metadata. */
export function citeLabel(ref: EvidenceRef): string {
  const parts: string[] = [];
  if (ref.court !== undefined && ref.court !== "") parts.push(ref.court);
  else if (ref.legislationNo !== undefined && ref.legislationNo !== "") {
    parts.push(legislationLabel(ref.legislationNo, ref.title));
  } else parts.push(ref.title);
  if (ref.docketNo !== undefined && ref.docketNo !== "") parts.push(`E. ${ref.docketNo}`);
  if (ref.decisionNo !== undefined && ref.decisionNo !== "") parts.push(`K. ${ref.decisionNo}`);
  if (ref.decisionDate !== undefined && ref.decisionDate !== "") parts.push(ref.decisionDate);
  if (ref.locator.article !== undefined && ref.locator.article !== "") {
    parts.push(`m. ${ref.locator.article}`);
  }
  return parts.join(", ");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Build an EvidencePack from retrieval candidates.
 *
 * Candidates whose canonical text cannot be fetched, whose offsets are out of
 * range, or whose materialized EvidenceRef fails the deterministic validator
 * are recorded under `rejected` and never become citable evidence.
 */
export async function buildEvidencePack(
  candidates: readonly AnswerCandidate[],
  texts: CanonicalTextPort,
  options: BuildEvidencePackOptions,
): Promise<EvidencePack> {
  const now = options.now ?? (() => new Date().toISOString());
  const items: EvidenceItem[] = [];
  const rejected: RejectedCandidate[] = [];
  const textCache: Record<string, string> = {};

  for (const candidate of candidates) {
    let canonical: string | undefined = textCache[candidate.documentVersionId];
    if (canonical === undefined) {
      const fetched = await texts.getCanonicalText(candidate.documentVersionId);
      if (fetched === undefined) {
        rejected.push({ candidate, reason: "CANONICAL_TEXT_UNAVAILABLE" });
        continue;
      }
      canonical = fetched.normalize("NFC");
      textCache[candidate.documentVersionId] = canonical;
    }

    const total = codePointLength(canonical);
    if (
      !Number.isInteger(candidate.startChar) ||
      !Number.isInteger(candidate.endChar) ||
      candidate.startChar < 0 ||
      candidate.endChar <= candidate.startChar ||
      candidate.endChar > total
    ) {
      rejected.push({ candidate, reason: "OFFSET_OUT_OF_RANGE" });
      continue;
    }

    let { startChar, endChar } = candidate;
    let quote = codePointSlice(canonical, startChar, endChar);
    if (quote.trim() === "") {
      rejected.push({ candidate, reason: "EMPTY_QUOTE" });
      continue;
    }

    // Quote cap (W12-FIX2): the ref below describes the WINDOW — offsets,
    // quote and quoteSha256 all move together, so validateEvidence and the
    // exporter's offset re-slice keep agreeing with what is shown.
    let quoteTruncated: EvidenceItem["quoteTruncated"];
    const cap = options.quoteCap;
    if (cap !== undefined && Number.isInteger(cap.maxCodePoints) && cap.maxCodePoints > 0) {
      const originalCodePoints = codePointLength(quote);
      if (originalCodePoints > cap.maxCodePoints) {
        const window = bestQuoteWindow(quote, cap.maxCodePoints, cap.focus);
        quoteTruncated = {
          originalStartChar: startChar,
          originalEndChar: endChar,
          originalCodePoints,
        };
        endChar = startChar + window.end;
        startChar = startChar + window.start;
        quote = codePointSlice(canonical, startChar, endChar);
      }
    }

    const ref: EvidenceRef = {
      evidenceId: deterministicEvidenceId(candidate.documentVersionId, startChar, endChar),
      documentId: candidate.documentId,
      documentVersionId: candidate.documentVersionId,
      chunkId: candidate.chunkId,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      title: candidate.title,
      ...(candidate.court !== undefined ? { court: candidate.court } : {}),
      ...(candidate.decisionDate !== undefined ? { decisionDate: candidate.decisionDate } : {}),
      ...(candidate.docketNo !== undefined ? { docketNo: candidate.docketNo } : {}),
      ...(candidate.decisionNo !== undefined ? { decisionNo: candidate.decisionNo } : {}),
      ...(candidate.legislationNo !== undefined
        ? { legislationNo: candidate.legislationNo }
        : {}),
      locator: {
        ...(candidate.article !== undefined ? { article: candidate.article } : {}),
        ...(candidate.paragraph !== undefined ? { paragraph: candidate.paragraph } : {}),
        ...(candidate.page !== undefined ? { page: candidate.page } : {}),
        startChar,
        endChar,
      },
      quote,
      quoteSha256: sha256HexUtf8(quote),
      contentSha256: sha256HexUtf8(canonical),
      retrievedAt: now(),
    };

    // Defensive self-check: a pack must never contain evidence the
    // deterministic validator would reject downstream.
    const check = validateEvidence(ref, canonical);
    if (!check.ok) {
      rejected.push({ candidate, reason: `SELF_CHECK_FAILED:${check.reason}` });
      continue;
    }

    // The candidate's own origin wins; the caller's default fills a blank.
    const origin = candidate.origin ?? options.defaultOrigin;
    items.push({
      ref,
      authority: classifyAuthority(candidate),
      currentness: assessCurrentness(
        origin !== undefined ? { ...candidate, origin } : candidate,
        options.asOf,
      ),
      retrievalScore: candidate.score === undefined ? 0.5 : clamp01(candidate.score),
      stance: candidate.stance ?? "neutral",
      ...(origin !== undefined ? { origin } : {}),
      ...(candidate.arrival !== undefined ? { arrival: candidate.arrival } : {}),
      ...(quoteTruncated !== undefined ? { quoteTruncated } : {}),
    });
  }

  return {
    asOf: options.asOf,
    builtAt: now(),
    items,
    rejected,
    texts: textCache,
  };
}

/**
 * Deterministic v0 lexical entailment — a CONSERVATIVE FLOOR, not semantics.
 *
 * This is NOT a semantic entailment model. It combines:
 *  1. normalized (tr-TR) token overlap: what fraction of the claim's content
 *     tokens appear in the evidence (quote + citation metadata); and
 *  2. number/reference agreement: every number-like token in the claim
 *     (kanun no, madde, E./K. numbers, dates, amounts) must also occur in the
 *     evidence — a single mismatched number is a hard failure (score capped),
 *     because in legal text "5237" vs "5271" changes the law being cited.
 *
 * It can only under-accept, never over-accept relative to a human judgement
 * on direct quotes; paraphrases legitimately fail here and should be routed
 * to a real entailment model (anthropicAdapter.ts) when available.
 */

import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { EvidenceRef } from "../evidence/types.js";
import { citeLabel } from "../answer/evidencePack.js";
import type { EntailmentJudgement, EntailmentPort } from "./ports.js";

/** Connectives/function words ignored by the overlap measure. */
const STOPWORDS = new Set([
  "ve",
  "veya",
  "ile",
  "bu",
  "şu",
  "o",
  "bir",
  "için",
  "gibi",
  "göre",
  "uyarınca",
  "gereğince",
  "kapsamında",
  "olarak",
  "olan",
  "da",
  "de",
  "ki",
  "mi",
  "mı",
  "mu",
  "mü",
]);

/** Tokenize normalized text; "/" is kept inside tokens so "2023/45" survives. */
export function tokenize(text: string): string[] {
  return normalizeTurkishSearch(text)
    .split(/[^\p{L}\p{N}/]+/u)
    .map((t) => t.replace(/^\/+|\/+$/g, ""))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Canonical form of a number-like token: strip leading zeros per "/" part. */
function canonicalNumber(token: string): string {
  return token
    .split("/")
    .map((part) => String(Number.parseInt(part, 10)))
    .join("/");
}

/** Extract number-like tokens ("5237", "2023/45", "81", "2024") from text. */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of normalizeTurkishSearch(text).matchAll(/\d+(?:\/\d+)*/gu)) {
    out.add(canonicalNumber(match[0]));
    // A compound "2023/45" also implies its parts for date-format tolerance.
    if (match[0].includes("/")) {
      for (const part of match[0].split("/")) out.add(canonicalNumber(part));
    }
  }
  return out;
}

/** All evidence-side text a claim may legitimately draw tokens from. */
function evidenceSurface(evidence: EvidenceRef): string {
  return [
    evidence.quote,
    evidence.title,
    citeLabel(evidence),
    evidence.court ?? "",
    evidence.decisionDate ?? "",
    evidence.docketNo ?? "",
    evidence.decisionNo ?? "",
    evidence.legislationNo ?? "",
    evidence.locator.article ?? "",
    evidence.locator.paragraph ?? "",
  ].join(" \n ");
}

export interface LexicalEntailmentOptions {
  /** Score at/above which `entails` is true (default: finalize threshold 0.85). */
  threshold?: number;
}

/** Content tokens of `claimText` that occur in the given evidence surface. */
export function matchedClaimTokens(
  claimText: string,
  surface: string,
): Set<string> {
  const evidenceTokens = new Set(tokenize(surface));
  const out = new Set<string>();
  for (const token of new Set(tokenize(claimText))) {
    if (evidenceTokens.has(token)) out.add(token);
  }
  return out;
}

/** The evidence-side surface a claim may legitimately draw tokens from. */
export function evidenceSurfaceOf(evidence: EvidenceRef): string {
  return evidenceSurface(evidence);
}

export class LexicalEntailmentPort implements EntailmentPort {
  private readonly threshold: number;

  constructor(options: LexicalEntailmentOptions = {}) {
    this.threshold = options.threshold ?? 0.85;
  }

  async assess(claimText: string, evidence: EvidenceRef): Promise<EntailmentJudgement> {
    return this.measure(claimText, evidenceSurface(evidence), 1);
  }

  /**
   * The same measure over the UNION of several passages' surfaces (W14 B-31).
   *
   * The number rule stays a hard failure over that union: a claim naming
   * "158 inci madde" while none of its cited passages mentions 158 still
   * fails, which is the guarantee that made the rule worth having. What
   * changes is only the unit of the overlap — "carried by these passages
   * together" instead of "carried by this one passage" — for a claim whose
   * text IS those passages' quotes.
   */
  async assessSet(
    claimText: string,
    evidence: readonly EvidenceRef[],
  ): Promise<EntailmentJudgement> {
    if (evidence.length === 0) {
      return {
        entails: false,
        score: 0,
        rationale: "lexical-v0: iddiaya bağlı doğrulanmış kanıt yok.",
      };
    }
    const surface = evidence.map((item) => evidenceSurface(item)).join(" \n ");
    return this.measure(claimText, surface, evidence.length);
  }

  private measure(
    claimText: string,
    surface: string,
    passages: number,
  ): EntailmentJudgement {
    const claimTokens = tokenize(claimText);
    if (claimTokens.length === 0) {
      return {
        entails: false,
        score: 0,
        rationale: "lexical-v0: iddia metninde içerik token'ı yok.",
      };
    }

    const evidenceTokens = new Set(tokenize(surface));
    const uniqueClaimTokens = [...new Set(claimTokens)];
    const matched = uniqueClaimTokens.filter((t) => evidenceTokens.has(t));
    const overlap = matched.length / uniqueClaimTokens.length;

    const claimNumbers = extractNumbers(claimText);
    const evidenceNumbers = extractNumbers(surface);
    const mismatched = [...claimNumbers].filter((n) => !evidenceNumbers.has(n));

    const scope = passages > 1 ? ` (${passages} pasajın birleşimi)` : "";
    if (mismatched.length > 0) {
      const score = Math.min(overlap, 0.2);
      return {
        entails: false,
        score,
        rationale:
          `lexical-v0${scope}: sayı/referans uyuşmazlığı — iddiadaki [${mismatched.join(", ")}] ` +
          `kanıtta yok (kanıt sayıları: [${[...evidenceNumbers].join(", ")}]). ` +
          "Sayı uyuşmazlığı sert başarısızlıktır.",
      };
    }

    const score = overlap;
    return {
      entails: score >= this.threshold,
      score,
      rationale:
        `lexical-v0${scope} (muhafazakâr taban, semantik DEĞİL): token örtüşmesi ` +
        `${matched.length}/${uniqueClaimTokens.length} = ${score.toFixed(3)}; ` +
        "sayı/referanslar uyumlu.",
    };
  }
}

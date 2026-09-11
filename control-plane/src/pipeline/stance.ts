/**
 * Deterministic outcome-polarity classification of a retrieved passage
 * (brief 10.2 contrary-authority branch).
 *
 * WHAT THIS IS: a small, auditable marker table over the operative Turkish
 * phrasings courts and boards use when a claim/charge SUCCEEDS versus when it
 * FAILS. It reads the exact canonical passage that was retrieved — nothing
 * else — and reports which markers fired, so a reviewer can check the call.
 *
 * WHAT THIS IS NOT: a semantic model. It cannot decide whether two decisions
 * are really about the same issue; that linkage is the verifier's job
 * (answer/verifier.ts `addressesSameIssue`). Here we only answer "did this
 * passage come out for or against?".
 *
 * NEGATIVE WINS: when both a negative and an affirmative marker fire, the
 * passage is classified NEGATIVE. Surfacing an opposing authority that turns
 * out to be irrelevant costs a lawyer one read; hiding a real one costs the
 * case. The system is built to over-surface conflict, never to under-surface.
 *
 * LEGISLATION IS NEVER CONTRARY AUTHORITY. A statute passage states a norm; it
 * does not "come out" either way, so `classifyStance` refuses to mark any
 * legislative document type as contrary regardless of the words it contains.
 */

import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { EvidenceStance } from "../answer/evidencePack.js";

export type OutcomePolarity = "AFFIRMATIVE" | "NEGATIVE" | "NEUTRAL";

/**
 * Operative phrases of a NEGATIVE outcome: the charge/claim/application did
 * not succeed, or the norm was held inapplicable. Stems (not whole words) so
 * Turkish suffixation does not require an entry per inflection.
 */
export const NEGATIVE_OUTCOME_MARKERS: readonly string[] = Object.freeze([
  "unsurları oluşmadığ",
  "unsurlarının oluşmadığ",
  "unsurları oluşmamış",
  "unsurlarının oluşmamış",
  "suçun unsurları oluşmad",
  "oluşmadığı hakkında",
  "suç oluşmaz",
  "suçu oluşmaz",
  "oluşturmadığ",
  "uygulanmaz",
  "beraat",
  "davanın reddine",
  "istemin reddine",
  "talebin reddi",
  "talebinin reddi",
  "şikayetin reddine",
  "başvurunun reddine",
  "iptal isteminin reddi",
  "ihlal bulunmadığ",
  "aykırılık bulunmadığ",
  "kusuru bulunmadığ",
  "delil bulunmamakta",
  "hukuki nitelikte",
  "bozulmasına",
  "kabul edilemez",
  "aksi yönde",
]);

/**
 * Operative phrases of an AFFIRMATIVE outcome: the charge/claim/application
 * succeeded, or the norm was held applicable.
 */
export const AFFIRMATIVE_OUTCOME_MARKERS: readonly string[] = Object.freeze([
  "suçunu oluşturduğ",
  "suçu oluşturduğ",
  "oluşturduğu kabul",
  "oluşturduğ",
  "unsurları oluşmuş",
  "unsurlarının oluştuğ",
  "kabul edilmelidir",
  "ihlal edildiğ",
  "ihlal ettiğ",
  "kabulüne",
  "mahkumiyetine",
  "mahkûmiyetine",
  "cezalandırılmasına",
]);

/**
 * Document types whose passages state a norm rather than decide an outcome.
 * Matching is on the normalized type string CONTAINING one of these stems, so
 * "kanun", "khk", "cumhurbaskanligi_kararnamesi", "yonetmelik", ... all land
 * here without an exhaustive enumeration of every source's naming.
 */
const LEGISLATIVE_TYPE_STEMS: readonly string[] = Object.freeze([
  "kanun",
  "khk",
  "kararname",
  "tüzük",
  "tuzuk",
  "yönetmelik",
  "yonetmelik",
  "tebliğ",
  "teblig",
  "genelge",
  "mevzuat",
  "anayasa",
]);

export interface PolarityAssessment {
  polarity: OutcomePolarity;
  /** Markers that fired, verbatim from the tables above. */
  markers: string[];
  /** Turkish rationale naming the markers (surfaced to the operator). */
  rationale: string;
}

function matches(haystack: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => haystack.includes(marker));
}

/** Classify the outcome polarity of one passage. Pure and deterministic. */
export function classifyOutcomePolarity(passage: string): PolarityAssessment {
  const normalized = normalizeTurkishSearch(passage);
  const negative = matches(normalized, NEGATIVE_OUTCOME_MARKERS);
  if (negative.length > 0) {
    return {
      polarity: "NEGATIVE",
      markers: negative,
      rationale: `Olumsuz sonuç ibareleri tespit edildi: ${negative.join(", ")}.`,
    };
  }
  const affirmative = matches(normalized, AFFIRMATIVE_OUTCOME_MARKERS);
  if (affirmative.length > 0) {
    return {
      polarity: "AFFIRMATIVE",
      markers: affirmative,
      rationale: `Olumlu sonuç ibareleri tespit edildi: ${affirmative.join(", ")}.`,
    };
  }
  return {
    polarity: "NEUTRAL",
    markers: [],
    rationale: "Pasajda sonuç yönünü belirleyen kalıp ibare bulunamadı.",
  };
}

/** True when the document type denotes a legislative instrument, not a ruling. */
export function isLegislativeDocumentType(documentType: string): boolean {
  const normalized = normalizeTurkishSearch(documentType);
  return LEGISLATIVE_TYPE_STEMS.some((stem) => normalized.includes(stem));
}

export interface StanceAssessment extends PolarityAssessment {
  stance: EvidenceStance;
}

/**
 * Map (documentType, passage) onto the EvidenceStance the evidence pack uses.
 *
 * Legislation is always "neutral": a norm text is the thing the parties argue
 * ABOUT, never the authority pointing the other way.
 */
export function classifyStance(documentType: string, passage: string): StanceAssessment {
  const assessment = classifyOutcomePolarity(passage);
  if (isLegislativeDocumentType(documentType)) {
    return {
      ...assessment,
      stance: "neutral",
      rationale: `${assessment.rationale} Mevzuat metni karşıt otorite olarak sınıflandırılmaz.`,
    };
  }
  if (assessment.polarity === "NEGATIVE") return { ...assessment, stance: "contrary" };
  if (assessment.polarity === "AFFIRMATIVE") return { ...assessment, stance: "supporting" };
  return { ...assessment, stance: "neutral" };
}

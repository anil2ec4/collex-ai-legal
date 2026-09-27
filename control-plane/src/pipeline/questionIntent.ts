/**
 * Question intent: is the reader asking WHAT A NORM SAYS, or HOW IT APPLIES?
 *
 * This distinction decides which authority may answer, and it is the one place
 * where the pipeline is allowed to narrow the evidence set:
 *
 *   NORM_CONTENT ("TCK m. 157 dolandırıcılık suçunun cezası nedir?")
 *     The answer is the text of the provision in force on the as_of date. A
 *     decision holding that the provision does NOT apply to a particular set of
 *     facts is not an authority against that text — it disputes the
 *     application, not the wording. Answering such a question from case law
 *     would be a category error, and marking the statute claim "conflicted"
 *     because an unrelated acquittal exists would be a false conflict.
 *
 *   APPLICATION ("... teslim edilmemesi TCK m. 157 dolandırıcılık suçunu
 *   oluşturur mu?")
 *     The answer IS the case law, and every opposing decision is directly
 *     relevant. Nothing is scoped out.
 *
 * NARROWING IS NEVER SILENT. Passages scoped out of a NORM_CONTENT answer are
 * reported by identity in `contraryCoverage.observed`, with the reason, so the
 * reader can see exactly what was set aside and re-ask as an application
 * question.
 *
 * DEFAULT IS APPLICATION. NORM_CONTENT requires BOTH an explicit legislative
 * reference AND a norm-content phrasing, and is refused as soon as any
 * application phrasing appears. When in doubt the pipeline keeps every
 * passage, because over-surfacing authority is the safe failure.
 */

import { classifyWantedShape, type WantedShapeAssessment } from "../answer/answerShape.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences, type ParsedReference } from "../retrieval/referenceParser.js";
import { explicitResearchFocus } from "../retrieval/researchFocus.js";

export type QuestionIntent = "NORM_CONTENT" | "APPLICATION";

/** Phrasings that ask what a provision says or prescribes. */
export const NORM_CONTENT_MARKERS: readonly string[] = Object.freeze([
  "cezası nedir",
  "ceza nedir",
  "cezası ne kadar",
  "cezası kaç yıl",
  "kaç yıl hapis",
  "ne kadar hapis",
  "hangi ceza",
  "yaptırımı nedir",
  "hükmü nedir",
  "hükmü ne",
  "metni nedir",
  "ne diyor",
  "ne der",
  "nasıl düzenlen",
  "düzenlemesi nedir",
  "tanımı nedir",
  "kapsamı nedir",
  "süresi nedir",
  "süresi ne kadar",
  "şartları nelerdir",
  "unsurları nelerdir",
  "ne öngör",
]);

/**
 * Phrasings that ask whether a norm applies to facts, or what the outcome is.
 * Any of these forces APPLICATION even alongside a norm-content marker.
 */
export const APPLICATION_MARKERS: readonly string[] = Object.freeze([
  "oluşturur mu",
  "oluşur mu",
  "oluşup oluşmadığ",
  "sayılır mı",
  "uygulanır mı",
  "uygulanabilir mi",
  "geçerli mi",
  "mümkün mü",
  "gerekir mi",
  "kabul edilir mi",
  "sorumlu mu",
  "sorumlu olur mu",
  "hak kazanır mı",
  "ihlal eder mi",
  "ihlal oluşturur mu",
  "somut olayda",
  "olayımızda",
  "müvekkil",
  "içtihat",
  "aksi yönde",
  "karşıt",
  "emsal karar",
]);

/**
 * Phrasings that ask WHICH TEXT applied WHEN (W14 B-09).
 *
 * Measured 02.09.2026 (DAILYFLOW §2, question 3): with `asOf 2024-06-01`,
 * "2024'te işlenen suçta 2026 öncesi mi sonrası mı uygulanır?" came back with
 * the v1 text alone — not one word about the amending law, the difference
 * between the two texts, or the lehe kanun test — and the answer was declared
 * TAM and KESİNLEŞTİRİLEBİLİR. As-of is the one headline capability neither
 * competitor has; answering a temporal question from a single version and
 * calling it complete is the worst possible way to own it.
 */
export const TEMPORAL_MARKERS: readonly string[] = Object.freeze([
  "öncesi",
  "sonrası",
  "önce mi",
  "sonra mı",
  "tarihinde yürürlükte",
  "tarihi itibarıyla",
  "tarihi itibariyle",
  "yürürlükte olan",
  "yürürlükteki",
  "hangisi uygulanır",
  "hangi metin",
  "hangi hâli",
  "hangi hali",
  "lehe kanun",
  "lehe olan",
  "değişiklikten önce",
  "değişiklikten sonra",
  "eski hâli",
  "eski hali",
  "yeni hâli",
  "yeni hali",
]);

/** Additive (W14 B-09): is this a "which version applied then?" question? */
export interface TemporalAssessment {
  /** True when the answer must compare versions before it may be COMPLETE. */
  isTemporal: boolean;
  /** Markers that fired, verbatim; "asOf" when the request carried a date. */
  markers: string[];
  /** Turkish rationale for the operator. */
  rationale: string;
}

export interface QuestionIntentAssessment {
  intent: QuestionIntent;
  /** Markers that fired, verbatim. */
  markers: string[];
  /** Turkish rationale, shown to the operator when narrowing was applied. */
  rationale: string;
  /**
   * Additive (W14 B-09). Temporality is a SEPARATE axis, not a third value of
   * `intent`: `intent` decides which authority may answer (and is rendered in
   * `contraryCoverage.scope`), while this decides whether the answer owes the
   * reader a version comparison. A question can be both norm-content and
   * temporal ("m.157'nin 2024'te yürürlükte olan metni nedir?").
   */
  temporal: TemporalAssessment;
  /**
   * Additive (W22 follow-up). A THIRD, separate axis: the KIND of value an
   * answer must carry — a DATE for "ne zaman", an AMOUNT for "ücreti ne
   * kadar", a PERSON for "kim", a COURT for "hangi mahkeme" (answer/
   * answerShape.ts). It narrows nothing: the rule-based drafter orders its
   * claims with it and the pipeline checks the lead passage against it.
   */
  answerShape: WantedShapeAssessment;
}

/**
 * Is the reader asking which text applied on a date? (W14 B-09)
 *
 * WHAT COUNTS, AND WHY NOT `asOf` ALONE. The backlog's sketch also made an
 * explicit `asOf` sufficient. Measured against this repository, it is not the
 * right trigger: every `/v1/answer` from the console and every gold row of
 * `scripts/run_evals.py` carries an explicit `asOf`, so the rule would make
 * EVERY answer owe a version comparison and every single-version provision
 * answer come back QUALIFIED with "karşılaştırılmadı" attached — six existing
 * pipeline tests flipped COMPLETE -> QUALIFIED when it was tried, none of them
 * about a temporal question. That is trap §C.6 exactly: an honesty line that
 * appears on every answer is a line nobody reads, and it would slander the
 * as-of feature it is supposed to defend.
 *
 * An `asOf` is a FILTER ("show me the law as it stood then"), and the pipeline
 * already honours it by retrieving the version in force. A temporal QUESTION
 * asks which of two texts applies, and says so in words — that is what the
 * marker list above is. `asOfProvided` is kept as an option (unit-tested) so
 * the stricter rule can be switched on deliberately, with a re-measurement,
 * rather than by accident.
 */
export function classifyTemporalQuestion(
  question: string,
  options: { asOfProvided?: boolean } = {},
): TemporalAssessment {
  const normalized = normalizeTurkishSearch(question);
  const markers = TEMPORAL_MARKERS.filter((marker) =>
    normalized.includes(normalizeTurkishSearch(marker)),
  );
  const asOfProvided = options.asOfProvided === true;
  if (markers.length === 0 && !asOfProvided) {
    return {
      isTemporal: false,
      markers: [],
      rationale: "Soru belirli bir tarihteki metni sormuyor; sürüm karşılaştırması aranmadı.",
    };
  }
  const fired = asOfProvided ? ["asOf", ...markers] : [...markers];
  return {
    isTemporal: true,
    markers: fired,
    rationale:
      "Soru, belirli bir tarihte hangi metnin uygulanacağını soruyor " +
      `(${fired.join(", ")}); cevabın ilgili hükmün birden fazla sürümünü ` +
      "yan yana göstermesi gerekir.",
  };
}

/**
 * Classify a question. Pure, deterministic, and biased towards APPLICATION.
 */
export function classifyQuestionIntent(
  question: string,
  references: readonly ParsedReference[],
  options: { asOfProvided?: boolean } = {},
): QuestionIntentAssessment {
  const normalized = normalizeTurkishSearch(question);
  const temporal = classifyTemporalQuestion(question, options);
  const answerShape = classifyWantedShape(question);
  const applicationMarkers = APPLICATION_MARKERS.filter((m) => normalized.includes(m));
  if (applicationMarkers.length > 0) {
    return {
      intent: "APPLICATION",
      markers: applicationMarkers,
      rationale:
        "Soru bir normun somut olaya uygulanmasını sorguluyor " +
        `(${applicationMarkers.join(", ")}); tüm otorite türleri kanıt olarak değerlendirildi.`,
      temporal,
      answerShape,
    };
  }

  const hasLegislativeReference = references.some(
    (ref) => ref.kind === "legislation" && ref.legislationNo !== undefined,
  );
  const normMarkers = NORM_CONTENT_MARKERS.filter((m) => normalized.includes(m));
  if (hasLegislativeReference && normMarkers.length > 0) {
    return {
      intent: "NORM_CONTENT",
      markers: normMarkers,
      rationale:
        "Soru, açıkça atıf yapılan bir hükmün içeriğini soruyor " +
        `(${normMarkers.join(", ")}); cevap, as_of tarihinde yürürlükte olan mevzuat ` +
        "metninden verildi. Bir hükmün somut olaya uygulanmadığına dair karar, o hükmün " +
        "metnine karşı otorite değildir.",
      temporal,
      answerShape,
    };
  }

  return {
    intent: "APPLICATION",
    markers: normMarkers,
    rationale:
      "Soru norm içeriği kalıbına girmedi; kanıt kümesi daraltılmadan " +
      "tüm otorite türleri değerlendirildi.",
    temporal,
    answerShape,
  };
}

// ---------------------------------------------------------------------------
// W14 B-08 — the LEGAL QUESTION inside a fact pattern
// ---------------------------------------------------------------------------

/**
 * Length (in Unicode code points) above which a question is treated as a fact
 * pattern with a legal question inside it.
 *
 * WHY THIS EXISTS. Measured 02.09.2026 (DAILYFLOW §2, question 7): the SAME
 * legal question returned 8 pieces of evidence and two Yargıtay decisions in
 * its two-sentence form, and — as a 1 178-character account of what actually
 * happened, which is how a lawyer types — 1 piece of evidence, 0 case law,
 * `QUESTION_NOT_COVERED:7`, `coverage.ratio 0,07`. The coverage gate measures
 * the question's content lexemes against the retrieved passages; a narrative
 * carries ~80 of them (names, dates, amounts, places) that no legal passage
 * can ever contain, so the ratio collapses and every passage is set aside.
 * The product was punishing the reader for giving it context.
 *
 * 400 code points is a documented constant, not a tuned one: the audited short
 * forms are 40–120 code points and the audited fact pattern is 1 178, so any
 * threshold in that gap separates them. It is deliberately far from both ends
 * so that a slightly wordy question does not change code path.
 */
export const LONG_QUESTION_CODE_POINTS = 400;

/** Which text the coverage gate measured (additive, W14 B-08). */
export type CoverageMeasuredOn = "soru" | "soru+olay";

export interface LegalQuestionExtraction {
  /** The text the coverage gate measures. */
  legalQuestion: string;
  /**
   * "soru+olay": the whole text as written (short questions — unchanged
   * behaviour). "soru": the legal question extracted from a fact pattern; the
   * narrative still went to retrieval as a ranking signal.
   */
  measuredOn: CoverageMeasuredOn;
  /** Code-point length of the text as written. */
  codePoints: number;
}

/** Unicode code-point length (the project measures text in code points). */
function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** Sentences, keeping their terminator so "?" survives the split. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/**
 * Separate the legal question from the facts around it.
 *
 * The rule is deterministic and deliberately generous: every interrogative
 * sentence, plus the last sentence (in a Turkish fact pattern the ask is
 * almost always last), plus every sentence carrying a parsed legal reference
 * (that is where "TBK m. 49 uyarınca" lives). Order is preserved. Nothing is
 * dropped from RETRIEVAL — the narrative is still the query, because the names
 * and amounts in it are what rank the right decision first; what changes is
 * only which text the coverage gate is measured against.
 */
export function extractLegalQuestion(
  question: string,
  references: readonly ParsedReference[] = parseReferences(question),
): LegalQuestionExtraction {
  const length = codePoints(question);
  if (length <= LONG_QUESTION_CODE_POINTS) {
    const focus = explicitResearchFocus(question);
    // Short explicit citations can cross abbreviation sentence boundaries;
    // retain their entire context instead of risking a detached article.
    if (focus !== undefined && references.length === 0) {
      return { legalQuestion: focus, measuredOn: "soru", codePoints: length };
    }
    return { legalQuestion: question, measuredOn: "soru+olay", codePoints: length };
  }
  const sentences = sentencesOf(question);
  if (sentences.length <= 1) {
    return { legalQuestion: question, measuredOn: "soru+olay", codePoints: length };
  }
  const referenceRaws = references
    .map((reference) => reference.raw.trim())
    .filter((raw) => raw !== "");
  const keep = new Set<number>();
  sentences.forEach((sentence, index) => {
    if (sentence.includes("?")) keep.add(index);
    if (referenceRaws.some((raw) => sentence.includes(raw))) keep.add(index);
  });
  keep.add(sentences.length - 1);
  const selected = [...keep].sort((a, b) => a - b).map((index) => sentences[index] as string);
  const legalQuestion = selected.join(" ").trim();
  if (legalQuestion === "" || codePoints(legalQuestion) === length) {
    return { legalQuestion: question, measuredOn: "soru+olay", codePoints: length };
  }
  return { legalQuestion, measuredOn: "soru", codePoints: length };
}

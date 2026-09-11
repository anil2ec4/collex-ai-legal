/**
 * What each exhaustive task actually DOES (W20 task honesty).
 *
 * W19 advertised five tasks and ran one generic deterministic pipeline for
 * all of them: a "full review" was the amount/date/ratio comparison under a
 * grander name. That is the kind of cosmetic enum a lawyer cannot see
 * through, so every task now has its own specification, and a task that
 * cannot be done honestly without a language model REFUSES to start when no
 * model is configured instead of quietly returning the deterministic subset.
 *
 *   contradictions  deterministic. Value propositions (dates, amounts,
 *                   ratios) are extracted from EVERY unit and compared across
 *                   the whole matter; output is source-linked pairs with a
 *                   CONTRADICTION / TENSION / CORROBORATION verdict and an
 *                   open question per contradiction. Free-text statements
 *                   that disagree without a comparable value are NOT in
 *                   scope here and the task says so.
 *   chronology      deterministic. Every dated statement becomes an event
 *                   with its date precision and source span; the same date
 *                   and topic in several documents is one event with several
 *                   sources; date conflicts are reported as chronology
 *                   conflicts.
 *   claim_evidence  model-required. Claims, defenses, evidence and legal
 *                   issues are extracted per unit (each with a verified exact
 *                   quote), then every claim is weighed against candidate
 *                   evidence: supporting, opposing, ambiguous, or none — a
 *                   claim with no support is reported as missing support.
 *   full_review     model-required. Everything above plus parties/entities,
 *                   facts, requests, procedural events, credibility issues,
 *                   and — only when the lawyer names the client's role —
 *                   favorable and unfavorable points.
 *   red_team        model-required. The strongest opposing theory,
 *                   weaknesses, the client's unsupported propositions,
 *                   contrary evidence, procedural vulnerabilities, and
 *                   hypothetical arguments that are ALWAYS labelled as such.
 *                   Verified contrary AUTHORITY is not produced by this task
 *                   (it reads the matter's documents, not case law) and the
 *                   result states that explicitly.
 */

import type { ModelItemKind } from "./modelExtractor.js";

export const ANALYSIS_TASKS = [
  "full_review",
  "contradictions",
  "chronology",
  "claim_evidence",
  "red_team",
] as const;

export type AnalysisTask = (typeof ANALYSIS_TASKS)[number];

/** Lawyer-facing kinds of derived intelligence (mirrors the migration). */
export type IntelItemKind =
  | "entity"
  | "event"
  | "fact"
  | "claim"
  | "defense"
  | "evidence"
  | "legal_issue"
  | "request"
  | "procedural_event"
  | "credibility_issue"
  | "contradiction"
  | "question"
  | "missing_support"
  | "favorable_point"
  | "unfavorable_point"
  | "opposing_theory"
  | "weakness"
  | "unsupported_proposition"
  | "contrary_evidence"
  | "procedural_vulnerability"
  | "hypothetical_argument";

export interface TaskSpec {
  readonly task: AnalysisTask;
  /** Button / heading text. TERM_TR-style plain Turkish. */
  readonly titleTr: string;
  /** One sentence the lawyer reads before starting it. */
  readonly descriptionTr: string;
  /** Cannot be done honestly without a language model. */
  readonly requiresModel: boolean;
  /** What model-assisted extraction asks for, per unit (empty = none). */
  readonly modelKinds: readonly ModelItemKind[];
  /** What the task produces. Tests pin that each task differs. */
  readonly produces: readonly IntelItemKind[];
  /** What the task explicitly does NOT do (shown with the result). */
  readonly limitsTr: readonly string[];
}

const ALL_MODEL_KINDS: readonly ModelItemKind[] = [
  "entity",
  "event",
  "fact",
  "claim",
  "defense",
  "evidence",
  "legal_issue",
  "request",
  "procedural_event",
  "credibility_issue",
  "possible_conflict",
];

export const TASK_SPECS: Readonly<Record<AnalysisTask, TaskSpec>> = Object.freeze({
  contradictions: {
    task: "contradictions",
    titleTr: "Çelişkileri bul",
    descriptionTr:
      "Seçilen belgelerin her bölümündeki tarih, tutar ve oranları çıkarır" +
      " ve benzer bağlamda farklı değer söyleyen yerleri kaynaklarıyla eşleştirir.",
    requiresModel: false,
    modelKinds: [],
    produces: ["contradiction", "question"],
    limitsTr: [
      "Yalnız tarih, tutar ve oran içeren ifadeler karşılaştırılır; değer" +
        " içermeyen serbest metin çelişkileri bu incelemenin kapsamı dışındadır.",
      "Hangi ifadelerin aynı konuya ait olduğu kelime örtüşmesiyle belirlenir;" +
        " her eşleşme kaynaktan doğrulanmalıdır.",
    ],
  },
  chronology: {
    task: "chronology",
    titleTr: "Kronolojiyi çıkar",
    descriptionTr:
      "Belgelerdeki her tarihli ifadeyi, tarihin kesinliği ve kaynağıyla" +
      " birlikte zaman sırasına dizer; benzer bağlamda farklı tarihleri gösterir.",
    requiresModel: false,
    modelKinds: [],
    produces: ["event", "contradiction", "question"],
    limitsTr: [
      "Yalnız metinde açıkça yazılı tarihler kullanılır; tarihi yazılmamış" +
        " olaylar kronolojide yer almaz.",
    ],
  },
  claim_evidence: {
    task: "claim_evidence",
    titleTr: "İddia ve delilleri eşleştir",
    descriptionTr:
      "İddiaları, savunmaları ve delilleri çıkarır; her iddiayı destekleyen," +
      " çürüten ve belirsiz kalan delilleri gösterir, desteksiz iddiaları işaretler.",
    requiresModel: true,
    modelKinds: ["claim", "defense", "evidence", "fact", "legal_issue"],
    produces: ["claim", "defense", "evidence", "legal_issue", "missing_support"],
    limitsTr: [
      "İddia ve delil tespitini yerel dil modeli yapar; her tespit belgedeki" +
        " birebir alıntıya bağlıdır ve alıntısı bulunamayan tespit atılır.",
    ],
  },
  full_review: {
    task: "full_review",
    titleTr: "Dosyanın tamamını incele",
    descriptionTr:
      "Taraflar, olaylar, iddialar, savunmalar, deliller, çelişkiler, hukuki" +
      " meseleler ve açık sorular için dosyanın her bölümünü okur.",
    requiresModel: true,
    modelKinds: ALL_MODEL_KINDS,
    produces: [
      "entity",
      "event",
      "fact",
      "claim",
      "defense",
      "evidence",
      "legal_issue",
      "request",
      "procedural_event",
      "credibility_issue",
      "contradiction",
      "question",
      "missing_support",
      "favorable_point",
      "unfavorable_point",
    ],
    limitsTr: [
      "Lehe ve aleyhe noktalar yalnız müvekkilin sıfatı belirtildiğinde" +
        " çıkarılır.",
      "Özet aşaması, çok büyük dosyalarda bulguların sınırlı bir özetini görür;" +
        " bu durumda sonuç bunu açıkça belirtir.",
    ],
  },
  red_team: {
    task: "red_team",
    titleTr: "Karşı tarafın gözüyle incele",
    descriptionTr:
      "Karşı tarafın en güçlü tezini, zayıf noktaları, desteksiz iddiaları," +
      " aleyhe delilleri ve usul risklerini kaynaklarıyla gösterir.",
    requiresModel: true,
    modelKinds: [
      "claim",
      "defense",
      "evidence",
      "fact",
      "legal_issue",
      "procedural_event",
      "credibility_issue",
    ],
    produces: [
      "claim",
      "evidence",
      "opposing_theory",
      "weakness",
      "unsupported_proposition",
      "contrary_evidence",
      "procedural_vulnerability",
      "hypothetical_argument",
    ],
    limitsTr: [
      "Karşı içtihat taraması bu incelemenin parçası değildir; içtihat için" +
        " ayrıca araştırma yapılmalıdır.",
      "Varsayımsal argümanlar her zaman \"varsayımsal\" olarak etiketlenir;" +
        " belgeden çıkan bir tespit değildir.",
    ],
  },
});

export interface TaskAvailability {
  readonly task: AnalysisTask;
  readonly available: boolean;
  readonly reason?: "MODEL_REQUIRED";
  readonly messageTr?: string;
}

/**
 * Whether a task may start. A model-required task with no configured model
 * is NOT downgraded to its deterministic part: it refuses, with a sentence.
 */
export function taskAvailability(task: AnalysisTask, modelReady: boolean): TaskAvailability {
  const spec = TASK_SPECS[task];
  if (spec.requiresModel && !modelReady) {
    return {
      task,
      available: false,
      reason: "MODEL_REQUIRED",
      messageTr:
        `"${spec.titleTr}" için yerel dil modeli gerekiyor ve şu an yapılandırılmış` +
        " değil. Model olmadan bu inceleme yarım yapılmaz; tarih, tutar ve oran" +
        " çelişkileri ile kronoloji modelsiz çalışır.",
    };
  }
  return { task, available: true };
}

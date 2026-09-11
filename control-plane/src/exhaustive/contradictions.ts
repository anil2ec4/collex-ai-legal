/**
 * Contradiction detection over normalized propositions.
 *
 * The rule this module exists to enforce
 * --------------------------------------
 * **A difference is not automatically a contradiction.** Two documents can
 * mention different amounts because they are about different things, or
 * because one is a claim and the other a payment, or because one is rounded.
 * Reporting every difference as a contradiction would bury the two that
 * matter under forty that do not, and a lawyer would stop reading the list.
 *
 * So the verdict vocabulary keeps the weaker readings available:
 *
 *   CONTRADICTION         same subject, same predicate, values that cannot
 *                         both be true.
 *   TENSION               comparable and different, but reconcilable — a
 *                         rounded figure, a month-precision date.
 *   CORROBORATION         two independent statements that agree. Worth
 *                         surfacing: corroboration is evidence too.
 *   INDEPENDENT           about the same subject, not in conflict.
 *   INSUFFICIENT_EVIDENCE comparable in principle, but this text does not
 *                         settle it.
 *
 * Why this beats top-K, structurally
 * ----------------------------------
 * The two halves of a contradiction are usually far apart — a claim in the
 * petition on page 3 and the expert report on page 604 — and they rarely
 * share wording, so no ranked retrieval puts both in one small result set.
 * This engine does not rank: it compares EVERY pair of propositions that
 * share a topic, over the whole census. That is only affordable because
 * propositions are small and normalized, which is why extraction is a
 * separate step.
 *
 * Every verdict carries both spans, so the reader is always one click from
 * the two passages and can overrule the machine.
 */

import type { PropositionKind } from "./observations.js";

export type ObservationRelation =
  | "CONTRADICTION"
  | "TENSION"
  | "CORROBORATION"
  | "INDEPENDENT"
  | "INSUFFICIENT_EVIDENCE";

/** The minimum a comparison needs to know about a stored observation. */
export interface ComparableObservation {
  readonly observationId: string;
  readonly kind: PropositionKind;
  readonly subject: string;
  readonly predicate: string;
  readonly normalizedValue: string;
  readonly fileId: string;
  readonly unitNo: number;
  readonly statement: string;
  readonly datePrecision?: string | undefined;
}

export interface RelationVerdict {
  readonly left: ComparableObservation;
  readonly right: ComparableObservation;
  readonly relation: ObservationRelation;
  /** Turkish, reviewable: says WHY, in terms of the two values. */
  readonly rationale: string;
  readonly detector: string;
  /** Topic overlap that made the pair comparable, in [0,1]. */
  readonly subjectOverlap: number;
}

export const DETECTOR_VERSION = "contradiction-v2";

/**
 * How much of the two topic keys must overlap before a pair is COMPARED.
 *
 * A heuristic, and named as one. Too low and unrelated sentences are
 * compared; too high and a contradiction phrased differently is missed. The
 * threshold decides what is EXAMINED, never what is asserted, so the cost of
 * being slightly generous is a reviewable INDEPENDENT verdict rather than a
 * false claim. It has NOT been measured against real Turkish case files.
 */
export const DEFAULT_SUBJECT_OVERLAP = 0.4;

/** Jaccard overlap of two topic keys. */
export function subjectOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter((token) => token !== ""));
  const right = new Set(b.split(" ").filter((token) => token !== ""));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Amounts within this fraction of each other read as a rounding difference. */
const ROUNDING_TOLERANCE = 0.01;

function compareValues(
  left: ComparableObservation,
  right: ComparableObservation,
): { relation: ObservationRelation; rationale: string } {
  if (left.normalizedValue === right.normalizedValue) {
    return {
      relation: "CORROBORATION",
      rationale:
        "İki belge aynı değeri söylüyor; ifadeler birbirini doğruluyor.",
    };
  }

  if (left.kind === "date") {
    // A date recorded to different precision is not a conflict.
    if (
      left.datePrecision !== undefined &&
      right.datePrecision !== undefined &&
      (left.datePrecision !== "exact" || right.datePrecision !== "exact")
    ) {
      return {
        relation: "TENSION",
        rationale:
          `Tarihler farklı (${describe(left)} / ${describe(right)})` +
          " ama en az biri kesin gün bildirmiyor; aynı olayın farklı" +
          " kesinlikte kaydı olabilir.",
      };
    }
    if (left.normalizedValue.slice(0, 7) === right.normalizedValue.slice(0, 7)) {
      return {
        relation: "TENSION",
        rationale:
          `Aynı ay içinde iki farklı gün geçiyor` +
          ` (${describe(left)} / ${describe(right)}).`,
      };
    }
    return {
      relation: "CONTRADICTION",
      rationale:
        `Benzer bağlamda iki farklı tarih var:` +
        ` ${describe(left)} ve ${describe(right)}.` +
        " İkisi birden doğru olamaz — aynı olaya ilişkinse; bağlamı kaynaktan doğrulayın.",
    };
  }

  const leftNumber = Number(left.normalizedValue);
  const rightNumber = Number(right.normalizedValue);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    const larger = Math.max(Math.abs(leftNumber), Math.abs(rightNumber));
    const gap = Math.abs(leftNumber - rightNumber);
    if (larger > 0 && gap / larger <= ROUNDING_TOLERANCE) {
      return {
        relation: "TENSION",
        rationale:
          "Değerler çok yakın; yuvarlama farkı olabilir." +
          " Yine de asıl belgelerden doğrulayın.",
      };
    }
  }

  const unit = left.kind === "amount" ? "tutar" : "oran";
  return {
    relation: "CONTRADICTION",
    rationale:
      `Benzer bağlamda iki farklı ${unit} var:` +
      ` ${describe(left)} ve ${describe(right)}.` +
      " İkisi birden doğru olamaz — aynı şeye ilişkinse; bağlamı kaynaktan doğrulayın.",
  };
}

function describe(observation: ComparableObservation): string {
  if (observation.kind === "date") {
    const [year, month, day] = observation.normalizedValue.split("-");
    if (year !== undefined && month !== undefined && day !== undefined) return `${day}.${month}.${year}`;
  }
  if (observation.kind === "amount") {
    const kurus = Number(observation.normalizedValue);
    if (Number.isFinite(kurus)) {
      return `${(kurus / 100).toLocaleString("tr-TR")} TL`;
    }
  }
  if (observation.kind === "ratio") {
    const perMille = Number(observation.normalizedValue);
    if (Number.isFinite(perMille)) return `%${perMille / 10}`;
  }
  return observation.normalizedValue;
}

export interface CompareOptions {
  readonly minimumSubjectOverlap?: number;
  /**
   * Compare propositions that came from the SAME analysis unit.
   *
   * Off by default. Two figures in one paragraph are usually a calculation
   * ("45 000 TL of which 5 000 TL interest"), not a disagreement, and
   * including them floods the list with noise. Cross-document disagreement is
   * what the reader cannot find by reading.
   */
  readonly includeSameUnit?: boolean;
}

/**
 * Compare every comparable pair and return the verdicts worth showing.
 *
 * INDEPENDENT pairs are dropped from the result — they are the majority and
 * carry no information — while CORROBORATION is kept, because "two documents
 * independently say the same thing" is evidence a lawyer uses.
 */
export function detectRelations(
  observations: readonly ComparableObservation[],
  options: CompareOptions = {},
): RelationVerdict[] {
  const threshold = options.minimumSubjectOverlap ?? DEFAULT_SUBJECT_OVERLAP;
  const verdicts: RelationVerdict[] = [];

  // Deterministic order, so two runs over the same census produce the same
  // list in the same order.
  const sorted = [...observations].sort(
    (a, b) =>
      a.fileId.localeCompare(b.fileId) ||
      a.unitNo - b.unitNo ||
      a.observationId.localeCompare(b.observationId),
  );

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i] as ComparableObservation;
      const right = sorted[j] as ComparableObservation;
      if (left.kind !== right.kind) continue;
      if (left.predicate !== right.predicate) continue;
      if (
        options.includeSameUnit !== true &&
        left.fileId === right.fileId &&
        left.unitNo === right.unitNo
      ) {
        continue;
      }
      const overlap = subjectOverlap(left.subject, right.subject);
      if (overlap < threshold) continue;

      const { relation, rationale } = compareValues(left, right);
      if (relation === "INDEPENDENT") continue;
      verdicts.push({
        left,
        right,
        relation,
        rationale,
        detector: DETECTOR_VERSION,
        subjectOverlap: overlap,
      });
    }
  }

  // Strongest first: a lawyer reads the top of this list.
  const rank: Record<ObservationRelation, number> = {
    CONTRADICTION: 0,
    TENSION: 1,
    INSUFFICIENT_EVIDENCE: 2,
    CORROBORATION: 3,
    INDEPENDENT: 4,
  };
  return verdicts.sort(
    (a, b) =>
      rank[a.relation] - rank[b.relation] ||
      b.subjectOverlap - a.subjectOverlap ||
      a.left.observationId.localeCompare(b.left.observationId),
  );
}

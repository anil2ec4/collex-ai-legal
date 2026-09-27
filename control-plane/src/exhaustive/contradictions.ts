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

import { parsePredicate, VALUE_EVENT_TR, type PropositionKind, type ValueEvent } from "./observations.js";

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
  /** Topic overlap of the two keys, in [0,1] (1 for a pair joined by its event). */
  readonly subjectOverlap: number;
  /**
   * What made the pair comparable (contradiction-v3): both values are the
   * date of the same named event ("event"), or their topic keys overlapped
   * ("topic"). Absent on verdicts stored before contradiction-v3.
   */
  readonly pairedBy?: "event" | "topic" | undefined;
  /** The event both dates belong to, when pairedBy is "event". */
  readonly event?: ValueEvent | undefined;
}

/**
 * contradiction-v3 (W22). Two dates of the same named event (observations.ts
 * DateEvent: işe giriş, işten çıkış / fesih, tebliğ, ihtarname) are compared
 * whatever their other words, and a day's difference within one month is a
 * CONTRADICTION for them, not a TENSION ("tebliğ 22.12.2023 / 26.12.2023"
 * decides a deadline). Two dates of different events are never compared. A
 * value marked never-compared (the date of a cited decision, a partial-claim
 * amount) is left out, and every comparison is counted
 * (ValueComparisonStats), so the analysis can say how many pairs it compared
 * instead of implying it compared them all.
 */
/*
 * contradiction-v4 (W23). Two amounts of the same named wage (net ücret,
 * brüt ücret; observations.ts AmountEvent) are compared whatever their other
 * words, as two dates of one event are; a net and a gross wage never are;
 * two wage amounts said for explicitly different years are not paired by
 * their label (differentPeriods). The stats also count per value kind
 * (ValueComparisonStats.byKind).
 */
export const DETECTOR_VERSION = "contradiction-v4";

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
  event: ValueEvent | undefined,
): { relation: ObservationRelation; rationale: string } {
  const eventTr = event === undefined ? undefined : VALUE_EVENT_TR[event];
  if (left.normalizedValue === right.normalizedValue) {
    return {
      relation: "CORROBORATION",
      rationale:
        eventTr === undefined
          ? "İki belge aynı değeri söylüyor; ifadeler birbirini doğruluyor."
          : `İki belge “${eventTr}” için aynı ${left.kind === "date" ? "tarihi" : "tutarı"} söylüyor; ifadeler birbirini doğruluyor.`,
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
    if (eventTr !== undefined) {
      // Two exact dates of one named event: a day matters (a tebliğ date
      // starts a deadline), so even a difference within one month is not
      // softened to TENSION.
      return {
        relation: "CONTRADICTION",
        rationale:
          `“${eventTr}” için iki farklı tarih var: ${describe(left)} ve ${describe(right)}.` +
          " İkisi birden doğru olamaz — aynı işleme ilişkinse; bağlamı kaynaktan doğrulayın.",
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
  if (eventTr !== undefined) {
    // contradiction-v4: two amounts of one named wage (net / brüt ücret).
    // A wage can change over time, so the sentence says so.
    return {
      relation: "CONTRADICTION",
      rationale:
        `“${eventTr}” için iki farklı ${unit} var: ${describe(left)} ve ${describe(right)}.` +
        " İkisi birden doğru olamaz — aynı döneme ilişkinse; bağlamı kaynaktan doğrulayın.",
    };
  }
  return {
    relation: "CONTRADICTION",
    rationale:
      `Benzer bağlamda iki farklı ${unit} var:` +
      ` ${describe(left)} ve ${describe(right)}.` +
      " İkisi birden doğru olamaz — aynı şeye ilişkinse; bağlamı kaynaktan doğrulayın.",
  };
}

/**
 * An amount in minor units (kuruş, cents) as Turkish writes money, without
 * its currency: "45.000", and "99.284,50" — never "99.284,5" (W22). The
 * minor units are shown with two digits whenever there are any.
 */
export function formatMinorUnits(minor: number): string {
  const major = minor / 100;
  const options: Intl.NumberFormatOptions =
    Math.round(minor) % 100 === 0 ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return major.toLocaleString("tr-TR", options);
}

function describe(observation: ComparableObservation): string {
  if (observation.kind === "date") {
    const [year, month, day] = observation.normalizedValue.split("-");
    if (year !== undefined && month !== undefined && day !== undefined) return `${day}.${month}.${year}`;
  }
  if (observation.kind === "amount") {
    const kurus = Number(observation.normalizedValue);
    if (Number.isFinite(kurus)) {
      return `${formatMinorUnits(kurus)} TL`;
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
 * How much of the census was actually COMPARED (contradiction-v3). The engine
 * compares a pair only when both values name the same event or their topic
 * keys overlap; every other pair of the same kind was never looked at, and a
 * result that does not say so reads as "every contradiction was checked".
 */
export interface ValueComparisonStats {
  /** Values that could be compared (a never-compared value is not one). */
  readonly values: number;
  /** Values left out by rule: dates of cited decisions, partial-claim amounts. */
  readonly valuesNeverCompared: number;
  /** Pairs of the same kind (and currency) in different units: what COULD be compared. */
  readonly candidatePairs: number;
  /** Pairs compared because both are the date of the same named event. */
  readonly pairsComparedByEvent: number;
  /** Pairs compared because their topic keys overlapped at the threshold. */
  readonly pairsComparedByTopic: number;
  /**
   * contradiction-v4 (additive): the same counts per value kind, so a task
   * that reports only DATE conflicts (chronology) can say how many date pairs
   * it compared. Absent on stats stored before contradiction-v4.
   */
  readonly byKind?: Partial<Record<PropositionKind, KindComparisonStats>> | undefined;
}

/** Candidate and compared pairs of one value kind (contradiction-v4). */
export interface KindComparisonStats {
  readonly candidatePairs: number;
  readonly pairsCompared: number;
}

/** The four-digit years a statement names outside its dates ("2023 Aralık ayı", "2019 yılı"). */
function yearsNamed(statement: string): Set<string> {
  const withoutDates = statement.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{1,2}-\d{1,2}/gu, " ");
  return new Set(withoutDates.match(/(?<![\p{N}.,/])(?:19|20)\d{2}(?![\p{N}]|[.,/]\d)/gu) ?? []);
}

/**
 * Two amounts of one named wage said for explicitly DIFFERENT years ("2019
 * yılı net ücreti" / "2023 Aralık ayı bordrosunda net ücret") are two
 * periods' wages, not two answers to one question (contradiction-v4). Only
 * when both statements name a year and they share none; they may still be
 * compared by their topic keys, as any two amounts are.
 */
function differentPeriods(left: ComparableObservation, right: ComparableObservation): boolean {
  if (left.kind !== "amount") return false;
  const a = yearsNamed(left.statement);
  const b = yearsNamed(right.statement);
  if (a.size === 0 || b.size === 0) return false;
  for (const year of a) if (b.has(year)) return false;
  return true;
}

/**
 * Compare every comparable pair; return the verdicts worth showing and the
 * count of what was compared.
 *
 * INDEPENDENT pairs are dropped from the result — they are the majority and
 * carry no information — while CORROBORATION is kept, because "two documents
 * independently say the same thing" is evidence a lawyer uses.
 */
export function compareValueObservations(
  observations: readonly ComparableObservation[],
  options: CompareOptions = {},
): { verdicts: RelationVerdict[]; stats: ValueComparisonStats } {
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
  const parts = sorted.map((observation) => parsePredicate(observation.predicate));
  const valuesNeverCompared = parts.filter((part) => part.neverCompared).length;
  let candidatePairs = 0;
  let pairsComparedByEvent = 0;
  let pairsComparedByTopic = 0;
  const byKind: Partial<Record<PropositionKind, { candidatePairs: number; pairsCompared: number }>> = {};
  const kindTally = (kind: PropositionKind) => (byKind[kind] ??= { candidatePairs: 0, pairsCompared: 0 });

  for (let i = 0; i < sorted.length; i += 1) {
    const leftParts = parts[i]!;
    if (leftParts.neverCompared) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const rightParts = parts[j]!;
      if (rightParts.neverCompared) continue;
      const left = sorted[i] as ComparableObservation;
      const right = sorted[j] as ComparableObservation;
      if (left.kind !== right.kind) continue;
      if (leftParts.base !== rightParts.base) continue;
      if (
        options.includeSameUnit !== true &&
        left.fileId === right.fileId &&
        left.unitNo === right.unitNo
      ) {
        continue;
      }
      candidatePairs += 1;
      kindTally(left.kind).candidatePairs += 1;
      // Two dates of two DIFFERENT named events are never compared (an işe
      // giriş date and a tebliğ date answer different questions); two dates
      // of the SAME event always are.
      if (leftParts.event !== undefined && rightParts.event !== undefined && leftParts.event !== rightParts.event) {
        continue;
      }
      const sameEvent =
        leftParts.event !== undefined && leftParts.event === rightParts.event && !differentPeriods(left, right);
      const overlap = subjectOverlap(left.subject, right.subject);
      if (!sameEvent && overlap < threshold) continue;
      if (sameEvent) pairsComparedByEvent += 1;
      else pairsComparedByTopic += 1;
      kindTally(left.kind).pairsCompared += 1;

      const event = sameEvent ? leftParts.event : undefined;
      const { relation, rationale } = compareValues(left, right, event);
      if (relation === "INDEPENDENT") continue;
      verdicts.push({
        left,
        right,
        relation,
        rationale,
        detector: DETECTOR_VERSION,
        subjectOverlap: sameEvent ? 1 : overlap,
        pairedBy: sameEvent ? "event" : "topic",
        ...(event !== undefined ? { event } : {}),
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
  verdicts.sort(
    (a, b) =>
      rank[a.relation] - rank[b.relation] ||
      b.subjectOverlap - a.subjectOverlap ||
      a.left.observationId.localeCompare(b.left.observationId) ||
      a.right.observationId.localeCompare(b.right.observationId),
  );
  return {
    verdicts,
    stats: {
      values: sorted.length - valuesNeverCompared,
      valuesNeverCompared,
      candidatePairs,
      pairsComparedByEvent,
      pairsComparedByTopic,
      byKind,
    },
  };
}

/** The verdicts of compareValueObservations (see there). */
export function detectRelations(
  observations: readonly ComparableObservation[],
  options: CompareOptions = {},
): RelationVerdict[] {
  return compareValueObservations(observations, options).verdicts;
}

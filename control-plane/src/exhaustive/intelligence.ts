/**
 * The reduce stage: from persisted observations to Matter Intelligence.
 *
 * Input is ALWAYS the complete persisted observation set of a run — never
 * what one process happened to produce in memory. That is the W20 fix for
 * resumption: units finished by a worker that later died contributed their
 * observations to the database, and a resumed run must see them. The reduce
 * stage is therefore a pure function of (task, stored observations) plus,
 * for model-required tasks, a bounded synthesis step.
 *
 * Every item produced here carries at least one SOURCE: an observation id,
 * and through it an exact version/offset/quote-hash span. The database
 * refuses to commit an item without one (deferred constraint trigger), and
 * this module drops such an item before it gets that far and counts it.
 *
 * Deterministic part
 * ------------------
 *   relations      value comparisons (dates/amounts/ratios) across the
 *                  whole census — contradictions.ts, unchanged gates.
 *   events         dated statements grouped by (date, topic key).
 *   contradiction  one item per CONTRADICTION/TENSION relation.
 *   question       one open question per CONTRADICTION.
 *   model items    claims/evidence/etc. become items one-to-one; entities
 *                  and legal issues are grouped by their normalized name.
 *
 * The analytical stages after this (W21)
 * --------------------------------------
 * Claim/defense weighing, the semantic contradiction lane and the
 * hierarchical synthesis are durable per-task stages (stageTypes.ts,
 * stagePlanner.ts, stageFinalize.ts). W20 ran them here, inside one lease,
 * over a PREFIX — the first 25 claims, 8 candidates each, the first 40
 * findings — and reported the cut in a note. That code is gone: nothing in
 * this module bounds the analysis universe.
 */

import { createHash } from "node:crypto";
import {
  compareValueObservations,
  DEFAULT_SUBJECT_OVERLAP,
  subjectOverlap,
  type ComparableObservation,
  type RelationVerdict,
  type ValueComparisonStats,
} from "./contradictions.js";
import { MODEL_EXTRACTOR_VERSION } from "./modelExtractor.js";
import { EXTRACTOR_VERSION, parsePredicate, VALUE_EVENT_TR, type PropositionKind } from "./observations.js";
import { SUPPORT_UNIVERSE_KINDS } from "./stageTypes.js";
import { TASK_SPECS, type AnalysisTask, type IntelItemKind } from "./tasks.js";

/**
 * Version of the builders here (and of the W21 stage assembly).
 *
 * intel-v3 (W22): chronology events are grouped by date AND topic (the same
 * named event, or overlapping topic keys) instead of by the exact topic-key
 * string — one fact told by five documents was five events; the date of a
 * cited decision is never an event; a date written alone ("… talep ederiz.
 * 05.02.2024") is titled as such instead of "05.02.2024 — 05.02.2024"; and
 * one contradiction item is built per (values, files) pair, not one per
 * observation pair ("99.284,5 TL ve 5.000 TL" was listed twice).
 */
export const INTEL_VERSION = "intel-v3";

/** One stored observation, as the reduce stage reads it back. */
export interface StoredObservation {
  readonly observationId: string;
  readonly observationKey: string | null;
  readonly unitNo: number;
  readonly fileId: string;
  readonly documentVersionId: string;
  /** Database kind: 'proposition' for deterministic values, else the model kind. */
  readonly kind: string;
  readonly origin: "deterministic" | "model";
  readonly statement: string;
  readonly subject: string;
  readonly predicate: string;
  readonly normalizedValue: string;
  /** For deterministic propositions: date / amount / ratio. */
  readonly valueKind?: PropositionKind | undefined;
  readonly occurredOn?: string | undefined;
  readonly datePrecision?: string | undefined;
  readonly startChar: number;
  readonly endChar: number;
  readonly quote: string;
  readonly quoteSha256: string;
  readonly locator?: string | undefined;
  readonly extractorVersion: string;
  readonly modelId?: string | undefined;
  readonly provider?: string | undefined;
  readonly confidence?: number | undefined;
  readonly party?: string | undefined;
  readonly role?: string | undefined;
  readonly entityType?: string | undefined;
}

export type IntelSourceRole = "basis" | "mention" | "support" | "oppose" | "ambiguous";

export interface IntelSourceRef {
  readonly observationId: string;
  readonly role: IntelSourceRole;
}

export interface IntelItemDraft {
  readonly kind: IntelItemKind;
  readonly key: string;
  title: string;
  body?: string | undefined;
  occurredOn?: string | undefined;
  datePrecision?: string | undefined;
  partyRole?: string | undefined;
  stance?: "favorable" | "unfavorable" | "neutral" | "unknown" | undefined;
  supportStatus?:
    | "supported"
    | "opposed"
    | "ambiguous"
    | "unsupported"
    | "disputed"
    | "no_support_in_candidates"
    | "search_incomplete"
    | "not_weighed"
    | undefined;
  readonly hypothetical: boolean;
  confidence?: number | undefined;
  readonly producer: "deterministic" | "model";
  readonly producerVersion: string;
  modelId?: string | undefined;
  provider?: string | undefined;
  attributes: Record<string, unknown>;
  sources: IntelSourceRef[];
}

export type IntelLinkKind =
  | "supports"
  | "opposes"
  | "ambiguous"
  | "concerns_issue"
  | "contradicts"
  | "weakens"
  | "answers";

export interface IntelLinkDraft {
  /** `${kind}:${key}` of each end. */
  readonly from: string;
  readonly to: string;
  readonly linkKind: IntelLinkKind;
  readonly rationale?: string | undefined;
  readonly confidence?: number | undefined;
  readonly producer: "deterministic" | "model";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

/**
 * Whitespace-folded text bounded to `max` UTF-16 units, never ending in a
 * lone surrogate. Every clip in the exhaustive modules goes through this
 * one: a cut that split an astral character (an emoji in WhatsApp evidence)
 * produced a string PostgreSQL rejects as jsonb, and the planning insert
 * that carried it failed on every retry (W21 review #14).
 */
export function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  if (trimmed.length <= max) return trimmed;
  let cut = trimmed.slice(0, Math.max(0, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** The text would be clipped at `max` (after the same whitespace collapse as `clip`). */
export function isClipped(text: string, max: number): boolean {
  return text.replace(/\s+/gu, " ").trim().length > max;
}

export function itemRef(item: { kind: string; key: string }): string {
  return `${item.kind}:${item.key}`;
}

function formatDateTr(iso: string, precision: string | undefined): string {
  const [year, month, day] = iso.split("-");
  if (precision === "year") return `${year}`;
  if (precision === "month") return `${month}.${year}`;
  return `${day}.${month}.${year}`;
}

// ---------------------------------------------------------------------------
// Relations: deterministic value comparison over the WHOLE stored census
// ---------------------------------------------------------------------------

/**
 * Compare every deterministic value proposition of the run.
 *
 * Observation ids are the REAL stored ids, so a relation can be written
 * without the synthetic-id mapping W19 needed (and a resumed run compares
 * propositions produced by a worker that has since died).
 */
export function relationsFromObservations(
  observations: readonly StoredObservation[],
): RelationVerdict[] {
  return compareStoredValues(observations).verdicts;
}

/** relationsFromObservations, with the count of what was compared (contradiction-v3). */
export function compareStoredValues(
  observations: readonly StoredObservation[],
): { verdicts: RelationVerdict[]; stats: ValueComparisonStats } {
  const comparable: ComparableObservation[] = [];
  for (const observation of observations) {
    if (observation.origin !== "deterministic") continue;
    if (observation.kind !== "proposition") continue;
    if (observation.valueKind === undefined) continue;
    comparable.push({
      observationId: observation.observationId,
      kind: observation.valueKind,
      subject: observation.subject,
      predicate: observation.predicate,
      normalizedValue: observation.normalizedValue,
      fileId: observation.fileId,
      unitNo: observation.unitNo,
      statement: observation.statement,
      datePrecision: observation.datePrecision,
    });
  }
  return compareValueObservations(comparable);
}

// ---------------------------------------------------------------------------
// Deterministic items
// ---------------------------------------------------------------------------

function deterministicItem(
  kind: IntelItemKind,
  key: string,
  title: string,
  sources: IntelSourceRef[],
  extra: Partial<IntelItemDraft> = {},
): IntelItemDraft {
  return {
    kind,
    key,
    title: clip(title, 480),
    hypothetical: false,
    producer: "deterministic",
    producerVersion: `${INTEL_VERSION}/${EXTRACTOR_VERSION}`,
    attributes: {},
    sources,
    ...extra,
  };
}

function modelItem(
  kind: IntelItemKind,
  key: string,
  observation: StoredObservation,
  extra: Partial<IntelItemDraft> = {},
): IntelItemDraft {
  return {
    kind,
    key,
    title: clip(observation.statement, 480),
    hypothetical: false,
    producer: "model",
    producerVersion: `${INTEL_VERSION}/${MODEL_EXTRACTOR_VERSION}`,
    modelId: observation.modelId,
    provider: observation.provider,
    confidence: observation.confidence,
    attributes: {},
    sources: [{ observationId: observation.observationId, role: "basis" }],
    ...extra,
  };
}

/** A statement with no word in it: the date written alone ("... talep ederiz. 05.02.2024"). */
function isBareValue(statement: string): boolean {
  return !/\p{L}/u.test(statement);
}

/** Shown for a date written alone in its sentence (intel-v3). */
export const BARE_DATE_TITLE_TR =
  "tarih metinde tek başına yazılmış (belgenin imza ya da düzenleme tarihi olabilir)";

/** Deterministic order of observations: document, then place in it. */
function byPlace(a: StoredObservation, b: StoredObservation): number {
  return (
    a.fileId.localeCompare(b.fileId) ||
    a.startChar - b.startChar ||
    a.observationId.localeCompare(b.observationId)
  );
}

/**
 * Chronology events from dated deterministic propositions (intel-v3).
 *
 * The same fact told by several documents is ONE event with several
 * sources. W20/W21 grouped on the exact topic-key string, so 01.03.2018 told
 * by a petition, a witness, a notice and an expert report was four events.
 * Two dated statements of one day are now one event when they name the same
 * event (işe giriş, tebliğ, ...) or their topic keys overlap at the
 * comparison threshold; two statements naming DIFFERENT events stay apart.
 * The date of a cited court decision is not an event of the case.
 */
function buildEvents(observations: readonly StoredObservation[]): IntelItemDraft[] {
  const byDate = new Map<string, StoredObservation[]>();
  for (const observation of observations) {
    if (observation.origin !== "deterministic" || observation.valueKind !== "date") continue;
    if (observation.occurredOn === undefined) continue;
    if (parsePredicate(observation.predicate).neverCompared) continue;
    const key = `${observation.occurredOn}|${observation.datePrecision ?? ""}`;
    const bucket = byDate.get(key);
    if (bucket === undefined) byDate.set(key, [observation]);
    else bucket.push(observation);
  }
  const events: IntelItemDraft[] = [];
  for (const sameDay of byDate.values()) {
    const ordered = [...sameDay].sort(byPlace);
    const events_ = ordered.map((member) => parsePredicate(member.predicate).event);
    // Union-find over the day's statements. A group carries at most ONE named
    // event: two groups naming different events are never joined, not even
    // through a third statement similar to both.
    const parent = ordered.map((_member, index) => index);
    const groupEvent = [...events_];
    const root = (index: number): number => {
      let at = index;
      while (parent[at] !== at) at = parent[at] as number;
      return at;
    };
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = root(i);
        const b = root(j);
        if (a === b) continue;
        const left = groupEvent[a];
        const right = groupEvent[b];
        if (left !== undefined && right !== undefined && left !== right) continue;
        const sameEvent = events_[i] !== undefined && events_[i] === events_[j];
        const bare = isBareValue(ordered[i]!.statement) || isBareValue(ordered[j]!.statement);
        const similar = !bare && subjectOverlap(ordered[i]!.subject, ordered[j]!.subject) >= DEFAULT_SUBJECT_OVERLAP;
        if (!sameEvent && !similar) continue;
        const [keep, drop] = a < b ? [a, b] : [b, a];
        parent[drop] = keep;
        groupEvent[keep] = left ?? right;
      }
    }
    const groups = new Map<number, number[]>();
    ordered.forEach((_member, index) => {
      const at = root(index);
      const bucket = groups.get(at);
      if (bucket === undefined) groups.set(at, [index]);
      else bucket.push(index);
    });
    for (const indexes of groups.values()) {
      const members = indexes.map((index) => ordered[index] as StoredObservation);
      // The basis is the first statement that says something beyond the date.
      const basisIndex = Math.max(0, members.findIndex((member) => !isBareValue(member.statement)));
      const basis = members[basisIndex] as StoredObservation;
      const event = indexes.map((index) => events_[index]).find((value) => value !== undefined);
      const files = new Set(members.map((member) => member.fileId));
      const date = formatDateTr(basis.occurredOn as string, basis.datePrecision);
      const groupKey = `${basis.occurredOn}|${members.map((member) => member.observationKey ?? member.observationId).join(",")}`;
      events.push(
        deterministicItem(
          "event",
          `d:${shortHash(groupKey)}`,
          `${date} — ${isBareValue(basis.statement) ? BARE_DATE_TITLE_TR : basis.statement}`,
          [basis, ...members.filter((member) => member !== basis)].map((member, index) => ({
            observationId: member.observationId,
            role: index === 0 ? "basis" : "mention",
          })),
          {
            occurredOn: basis.occurredOn,
            datePrecision: basis.datePrecision,
            attributes: {
              topicKey: basis.subject,
              documents: files.size,
              mentions: members.length,
              ...(event !== undefined ? { event, eventTr: VALUE_EVENT_TR[event] } : {}),
            },
          },
        ),
      );
    }
  }
  return events.sort(
    (a, b) =>
      (a.occurredOn ?? "").localeCompare(b.occurredOn ?? "") || a.key.localeCompare(b.key),
  );
}

/** Contradiction items and one open question per CONTRADICTION. */
function buildRelationItems(
  relations: readonly RelationVerdict[],
  onlyDates: boolean,
): { items: IntelItemDraft[]; links: IntelLinkDraft[] } {
  const items: IntelItemDraft[] = [];
  const links: IntelLinkDraft[] = [];
  // intel-v3: one item per (relation, the two values, the two documents). A
  // petition that asks "5.000 TL ihbar ve 5.000 TL fazla çalışma" holds two
  // observations of one value; each paired with the same figure elsewhere
  // produced the same item twice. The second observation becomes a mention.
  const byValues = new Map<string, IntelItemDraft>();
  for (const relation of relations) {
    if (relation.relation !== "CONTRADICTION" && relation.relation !== "TENSION") continue;
    if (onlyDates && relation.left.kind !== "date") continue;
    const valuesKey = [
      `${relation.left.fileId}=${relation.left.normalizedValue}`,
      `${relation.right.fileId}=${relation.right.normalizedValue}`,
    ]
      .sort()
      .join("|");
    const duplicateOf = byValues.get(`${relation.relation}|${valuesKey}`);
    if (duplicateOf !== undefined) {
      for (const side of [relation.left, relation.right]) {
        if (!duplicateOf.sources.some((source) => source.observationId === side.observationId)) {
          duplicateOf.sources.push({ observationId: side.observationId, role: "mention" });
        }
      }
      continue;
    }
    const pairKey = `${relation.left.observationId}:${relation.right.observationId}`;
    const sources: IntelSourceRef[] = [
      { observationId: relation.left.observationId, role: "basis" },
      { observationId: relation.right.observationId, role: "basis" },
    ];
    const contradiction = deterministicItem(
      "contradiction",
      `r:${shortHash(pairKey)}`,
      relation.rationale,
      sources,
      {
        body:
          `1) ${clip(relation.left.statement, 400)}\n` +
          `2) ${clip(relation.right.statement, 400)}`,
        attributes: {
          relation: relation.relation,
          valueKind: relation.left.kind,
          subjectOverlap: Number(relation.subjectOverlap.toFixed(3)),
          detector: relation.detector,
          ...(relation.pairedBy !== undefined ? { pairedBy: relation.pairedBy } : {}),
          ...(relation.event !== undefined ? { event: relation.event, eventTr: VALUE_EVENT_TR[relation.event] } : {}),
        },
      },
    );
    items.push(contradiction);
    byValues.set(`${relation.relation}|${valuesKey}`, contradiction);
    if (relation.relation === "CONTRADICTION") {
      const question = deterministicItem(
        "question",
        `q:${shortHash(pairKey)}`,
        "Hangi değer doğru? Benzer bağlamda iki farklı değer geçiyor;" +
          " aynı şeye ilişkinse asıl kaynaklardan netleştirilmeli.",
        sources.map((source) => ({ ...source })),
        { body: relation.rationale, attributes: { origin: "contradiction" } },
      );
      items.push(question);
      links.push({
        from: itemRef(question),
        to: itemRef(contradiction),
        linkKind: "answers",
        producer: "deterministic",
      });
    }
  }
  return { items, links };
}

const MODEL_KIND_TO_ITEM: Readonly<Record<string, IntelItemKind>> = {
  entity: "entity",
  event: "event",
  fact: "fact",
  claim: "claim",
  defense: "defense",
  evidence: "evidence",
  legal_issue: "legal_issue",
  request: "request",
  procedural_event: "procedural_event",
  credibility_issue: "credibility_issue",
  possible_conflict: "question",
};

/** Items from verified model observations, for the kinds the task produces. */
function buildModelItems(
  task: AnalysisTask,
  observations: readonly StoredObservation[],
): IntelItemDraft[] {
  const spec = TASK_SPECS[task];
  const wanted = new Set<string>(spec.modelKinds);
  const produces = new Set<IntelItemKind>(spec.produces);
  const items: IntelItemDraft[] = [];
  const grouped = new Map<string, IntelItemDraft>();

  for (const observation of observations) {
    if (observation.origin !== "model" || !wanted.has(observation.kind)) continue;
    const kind = MODEL_KIND_TO_ITEM[observation.kind];
    if (kind === undefined) continue;
    // A task that reads a kind to reason with does not necessarily REPORT
    // it (red team reads facts but reports weaknesses); keep claims and
    // evidence available to synthesis regardless. Every support-bearing kind
    // the task extracted stays too (W21 round-two review): red team asks for
    // procedural events and credibility issues, and a "complete search" that
    // silently left them out could call a claim unsupported although a
    // verified service record says exactly what it claims. What a task
    // REPORTS is still filtered at the end (stageFinalize).
    const reported =
      produces.has(kind) || kind === "claim" || kind === "evidence" || kind === "defense" || SUPPORT_UNIVERSE_KINDS.has(kind);
    if (!reported && kind !== "legal_issue") continue;

    if (kind === "entity" || kind === "legal_issue") {
      // One item per distinct name / issue, every mention a source.
      const groupKey = `${kind}|${observation.normalizedValue}`;
      const existing = grouped.get(groupKey);
      if (existing !== undefined) {
        existing.sources.push({ observationId: observation.observationId, role: "mention" });
        if (existing.partyRole === undefined && observation.role !== undefined) {
          existing.partyRole = observation.role;
        }
        continue;
      }
      const item = modelItem(kind, `${kind === "entity" ? "e" : "l"}:${shortHash(groupKey)}`, observation, {
        partyRole: observation.role,
        attributes:
          kind === "entity"
            ? { entityType: observation.entityType ?? "other", name: observation.normalizedValue }
            : { issueKey: observation.normalizedValue },
      });
      grouped.set(groupKey, item);
      items.push(item);
      continue;
    }

    const key = `m:${shortHash(observation.observationKey ?? observation.observationId)}`;
    items.push(
      modelItem(kind, key, observation, {
        ...(kind === "question" ? { title: clip(`Olası çelişki: ${observation.statement}`, 480) } : {}),
        partyRole: observation.party ?? observation.role,
        occurredOn: observation.occurredOn,
        datePrecision: observation.datePrecision,
        attributes:
          kind === "fact"
            ? { subject: observation.subject, predicate: observation.predicate, value: observation.normalizedValue }
            : { subject: observation.subject },
      }),
    );
  }
  return items;
}

/**
 * Everything the reduce stage can build WITHOUT a model, for one task.
 * Pure: the same stored observations always give the same items.
 */
export function buildDeterministicIntel(
  task: AnalysisTask,
  observations: readonly StoredObservation[],
  relations: readonly RelationVerdict[],
): { items: IntelItemDraft[]; links: IntelLinkDraft[] } {
  const items: IntelItemDraft[] = [];
  const links: IntelLinkDraft[] = [];
  if (task === "chronology" || task === "full_review") items.push(...buildEvents(observations));
  if (task !== "claim_evidence") {
    const fromRelations = buildRelationItems(relations, task === "chronology");
    items.push(...fromRelations.items);
    links.push(...fromRelations.links);
  }
  if (TASK_SPECS[task].requiresModel) items.push(...buildModelItems(task, observations));
  return { items, links };
}

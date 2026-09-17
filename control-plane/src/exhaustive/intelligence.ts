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
  detectRelations,
  type ComparableObservation,
  type RelationVerdict,
} from "./contradictions.js";
import { MODEL_EXTRACTOR_VERSION } from "./modelExtractor.js";
import { EXTRACTOR_VERSION, type PropositionKind } from "./observations.js";
import { SUPPORT_UNIVERSE_KINDS } from "./stageTypes.js";
import { TASK_SPECS, type AnalysisTask, type IntelItemKind } from "./tasks.js";

/** Version of the builders here (and of the W21 stage assembly). */
export const INTEL_VERSION = "intel-v2";

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
  return detectRelations(comparable);
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

/** Chronology events from dated deterministic propositions. */
function buildEvents(observations: readonly StoredObservation[]): IntelItemDraft[] {
  const groups = new Map<string, StoredObservation[]>();
  for (const observation of observations) {
    if (observation.origin !== "deterministic" || observation.valueKind !== "date") continue;
    if (observation.occurredOn === undefined) continue;
    const key = `${observation.occurredOn}|${observation.subject}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [observation]);
    else bucket.push(observation);
  }
  const events: IntelItemDraft[] = [];
  for (const [groupKey, members] of groups) {
    const first = members[0] as StoredObservation;
    const files = new Set(members.map((member) => member.fileId));
    events.push(
      deterministicItem(
        "event",
        `d:${shortHash(groupKey)}`,
        `${formatDateTr(first.occurredOn as string, first.datePrecision)} — ${first.statement}`,
        members.map((member, index) => ({
          observationId: member.observationId,
          role: index === 0 ? "basis" : "mention",
        })),
        {
          occurredOn: first.occurredOn,
          datePrecision: first.datePrecision,
          attributes: { topicKey: first.subject, documents: files.size },
        },
      ),
    );
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
  for (const relation of relations) {
    if (relation.relation !== "CONTRADICTION" && relation.relation !== "TENSION") continue;
    if (onlyDates && relation.left.kind !== "date") continue;
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
        },
      },
    );
    items.push(contradiction);
    if (relation.relation === "CONTRADICTION") {
      const question = deterministicItem(
        "question",
        `q:${shortHash(pairKey)}`,
        "Hangi değer doğru? Benzer bağlamda iki farklı değer geçiyor;" +
          " aynı şeye ilişkinse asıl kaynaklardan netleştirilmeli.",
        sources,
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

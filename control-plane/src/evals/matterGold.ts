/**
 * Whole-Matter GOLD format and scorer (W21).
 *
 * A lawyer annotates one Matter — its files, the claims and defenses in
 * them, which evidence supports or opposes what, the contradictions, the
 * chronology, the legal issues — and ALSO what the system must NOT say
 * (expected abstentions), what completeness it must (or must not) claim, and
 * which alternative readings are acceptable. This module:
 *
 *   1. validates such a gold file (zod, strict);
 *   2. LOCATES every annotated passage itself: a passage is `fileId` + exact
 *      `quote`; the offsets are found by the application in the file text.
 *      An annotator's `startChar` is only a hint that is CHECKED, never
 *      trusted: a quote that does not occur, occurs ambiguously, or does not
 *      sit at the hinted offset makes the gold file invalid;
 *   3. scores one analysis run — the JSON returned by
 *      GET /v1/matters/{id}/analysis/{runId}/findings — against the gold.
 *
 * The run's own provenance is not trusted blindly either: a run source whose
 * quote is not the file text at its offsets is "unverified" and can match
 * nothing. Offsets are Unicode code points, as everywhere in the product.
 *
 * Scores are per category (recall, precision) and never folded into one
 * number: a system that finds every contradiction but also asserts one the
 * lawyer said must not be asserted has not "scored 90%" — it has done both,
 * and the report says both.
 */

import { z } from "zod";
import { cpLength, foldTurkishCase } from "../retrieval/turkishAnalyzer.js";

export const MATTER_GOLD_SCHEMA = "collex.matter.gold/v1";
export const MATTER_GOLD_SCORE_SCHEMA = "collex.matter.gold.score/v1";

/**
 * A run span is credited for a gold span when the overlap is at least this
 * share of EACH of them (so of the longer one): a run quote that merely
 * contains a gold passage inside a much longer stretch — three numbered
 * paragraphs, a whole page — does not stand for that passage. Detecting a
 * forbidden assertion (expected abstentions) keeps the lenient reading, a
 * share of the SHORTER span: see `spansTouch`.
 */
export const SPAN_OVERLAP_MIN = 0.5;

const idSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/u, "ids use letters, digits and . _ : - (max 80)");
const dateSchema = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/u, "dates are YYYY, YYYY-MM or YYYY-MM-DD");
const relationSchema = z.enum(["CONTRADICTION", "TENSION"]);
const supportStatusSchema = z.enum([
  "supported",
  "opposed",
  "ambiguous",
  "unsupported",
  "disputed",
  "no_support_in_candidates",
  "search_incomplete",
  "not_weighed",
]);

export const goldPassageSchema = z
  .object({
    fileId: z.string().min(1).max(200),
    /** Copied EXACTLY from the file text (no correction, no shortening). */
    quote: z.string().min(1).max(4000),
    /** Which occurrence (1-based) when the quote occurs more than once. */
    occurrence: z.number().int().min(1).optional(),
    /** Optional hint, checked against the text; never trusted on its own. */
    startChar: z.number().int().min(0).optional(),
  })
  .strict();

const fileSchema = z
  .object({
    fileId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    /** The file text the offsets refer to (inline for synthetic samples). */
    text: z.string().min(1).max(2_000_000).optional(),
  })
  .strict();

const partyStatementSchema = z
  .object({
    id: idSchema,
    statement: z.string().min(1).max(2000),
    party: z.string().min(1).max(100).optional(),
    sources: z.array(goldPassageSchema).min(1).max(20),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const evidenceLinkSchema = z
  .object({
    id: idSchema,
    /** Id of a claim or defense in this gold file. */
    target: idSchema,
    stance: z.enum(["supports", "opposes"]),
    evidence: z.array(goldPassageSchema).min(1).max(20),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const contradictionSchema = z
  .object({
    id: idSchema,
    relation: relationSchema,
    left: goldPassageSchema,
    right: goldPassageSchema,
    explanation: z.string().max(2000).optional(),
  })
  .strict();

const chronologySchema = z
  .object({
    id: idSchema,
    date: dateSchema,
    precision: z.enum(["exact", "month", "year", "approximate"]).optional(),
    description: z.string().min(1).max(1000),
    sources: z.array(goldPassageSchema).min(1).max(20),
  })
  .strict();

const legalIssueSchema = z
  .object({
    id: idSchema,
    statement: z.string().min(1).max(2000),
    sources: z.array(goldPassageSchema).max(20).optional(),
    /** Every keyword must appear in the run item's title/body (Turkish case-folded). */
    keywords: z.array(z.string().min(2).max(100)).max(10).optional(),
  })
  .strict();

const abstentionSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: idSchema,
      type: z.literal("no_contradiction"),
      left: goldPassageSchema,
      right: goldPassageSchema,
      relations: z.array(relationSchema).min(1),
      reason: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("no_support_status"),
      target: idSchema,
      statuses: z.array(supportStatusSchema).min(1),
      reason: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("no_item"),
      kinds: z.array(z.string().min(1).max(60)).min(1),
      passage: goldPassageSchema,
      reason: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("no_event_date"),
      passage: goldPassageSchema,
      date: dateSchema,
      reason: z.string().min(1).max(2000),
    })
    .strict(),
]);

const completenessSchema = z
  .object({
    id: idSchema,
    type: z.enum(["run_finished", "coverage_complete", "coverage_gap_reported", "all_files_processed"]),
    description: z.string().max(1000).optional(),
  })
  .strict();

const alternativeSchema = z
  .object({
    id: idSchema,
    /** The gold entry this alternative widens. */
    appliesTo: idSchema,
    description: z.string().min(1).max(2000),
    /** A claim may also be read as a defense (or the reverse). */
    acceptKinds: z.array(z.enum(["claim", "defense"])).min(1).optional(),
    /** A contradiction may also be labelled with one of these. */
    acceptRelations: z.array(relationSchema).min(1).optional(),
    /** Other passages that express the same thing. */
    acceptSources: z.array(goldPassageSchema).min(1).max(20).optional(),
    /**
     * For a contradiction entry: the side the acceptSources restate. Required
     * there — a restatement stands in for ONE side, never for both.
     */
    side: z.enum(["left", "right"]).optional(),
    /** Another acceptable date for a chronology event. */
    acceptDate: dateSchema.optional(),
    /** Finding it is correct; missing it is not an error. */
    optional: z.boolean().optional(),
  })
  .strict();

export const matterGoldSchema = z
  .object({
    schema: z.literal(MATTER_GOLD_SCHEMA),
    id: idSchema,
    title: z.string().min(1).max(300),
    /** synthetic = written for tests/demos; lawyer_annotated = real gold. */
    source: z.enum(["synthetic", "lawyer_annotated"]),
    annotators: z.array(z.string().min(1).max(100)).max(10),
    adjudication: z.enum(["pending", "agreed", "disputed"]),
    clientRole: z.string().min(1).max(100).optional(),
    notes: z.string().max(4000).optional(),
    files: z.array(fileSchema).min(1).max(200),
    // A category that is ABSENT was not annotated and is not scored; an EMPTY
    // list means "there is none": every run item of that kind is then wrong.
    claims: z.array(partyStatementSchema).optional(),
    defenses: z.array(partyStatementSchema).optional(),
    evidenceLinks: z.array(evidenceLinkSchema).optional(),
    contradictions: z.array(contradictionSchema).optional(),
    chronology: z.array(chronologySchema).optional(),
    legalIssues: z.array(legalIssueSchema).optional(),
    expectedAbstentions: z.array(abstentionSchema).optional(),
    completenessRequirements: z.array(completenessSchema).optional(),
    alternatives: z.array(alternativeSchema).optional(),
  })
  .strict()
  .superRefine((gold, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    const fileIds = new Set<string>();
    for (const file of gold.files) {
      if (fileIds.has(file.fileId)) issue(`duplicate fileId: ${file.fileId}`);
      fileIds.add(file.fileId);
    }
    const ids = new Set<string>();
    const register = (id: string): void => {
      if (ids.has(id)) issue(`duplicate id: ${id}`);
      ids.add(id);
    };
    const partyIds = new Set<string>();
    for (const entry of [...(gold.claims ?? []), ...(gold.defenses ?? [])]) {
      register(entry.id);
      partyIds.add(entry.id);
    }
    for (const list of [gold.evidenceLinks, gold.contradictions, gold.chronology, gold.legalIssues, gold.expectedAbstentions, gold.completenessRequirements, gold.alternatives]) {
      for (const entry of list ?? []) register(entry.id);
    }
    for (const link of gold.evidenceLinks ?? []) {
      if (!partyIds.has(link.target)) issue(`${link.id}: target ${link.target} is not a claim or defense`);
    }
    for (const abstention of gold.expectedAbstentions ?? []) {
      if (abstention.type === "no_support_status" && !partyIds.has(abstention.target)) {
        issue(`${abstention.id}: target ${abstention.target} is not a claim or defense`);
      }
    }
    for (const alternative of gold.alternatives ?? []) {
      if (!ids.has(alternative.appliesTo)) issue(`${alternative.id}: appliesTo ${alternative.appliesTo} does not exist`);
      const forContradiction = (gold.contradictions ?? []).some((entry) => entry.id === alternative.appliesTo);
      if (forContradiction && alternative.acceptSources !== undefined && alternative.side === undefined) {
        issue(`${alternative.id}: acceptSources for contradiction ${alternative.appliesTo} must name the side (left or right)`);
      }
      if (!forContradiction && alternative.side !== undefined) {
        issue(`${alternative.id}: side applies only to a contradiction`);
      }
    }
    for (const issueEntry of gold.legalIssues ?? []) {
      if ((issueEntry.sources ?? []).length === 0 && (issueEntry.keywords ?? []).length === 0) {
        issue(`${issueEntry.id}: a legal issue needs sources or keywords`);
      }
    }
    for (const event of gold.chronology ?? []) {
      const precision = event.precision ?? precisionOf(event.date);
      if (precision === "exact" && event.date.length !== 10) issue(`${event.id}: exact precision needs YYYY-MM-DD`);
      if (precision === "month" && event.date.length < 7) issue(`${event.id}: month precision needs YYYY-MM`);
    }
    if (gold.source === "lawyer_annotated" && gold.annotators.length === 0) {
      issue("lawyer_annotated gold needs at least one annotator");
    }
  });

export type MatterGold = z.infer<typeof matterGoldSchema>;
export type GoldPassage = z.infer<typeof goldPassageSchema>;

function precisionOf(date: string): "exact" | "month" | "year" {
  return date.length === 10 ? "exact" : date.length === 7 ? "month" : "year";
}

// ---------------------------------------------------------------------------
// Locating passages (the application finds the offsets)
// ---------------------------------------------------------------------------

export interface LocatedSpan {
  readonly fileId: string;
  /** Code-point offsets into the file text, [start, end). */
  readonly start: number;
  readonly end: number;
}

export interface LocatedGold {
  readonly gold: MatterGold;
  /** fileId -> text the spans refer to. */
  readonly texts: ReadonlyMap<string, string>;
  /** "<entry id>#<path>" -> span, for every annotated passage. */
  readonly spans: ReadonlyMap<string, LocatedSpan>;
}

function cpIndex(text: string, utf16Index: number): number {
  return cpLength(text.slice(0, utf16Index));
}

/** Code-point slice; the product's offsets are code points. */
export function sliceCodePoints(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

function locate(
  passage: GoldPassage,
  texts: ReadonlyMap<string, string>,
  label: string,
): { span?: LocatedSpan; error?: string } {
  const text = texts.get(passage.fileId);
  if (text === undefined) {
    return { error: `${label}: file ${passage.fileId} has no text; supply the product's extracted text for it` };
  }
  const short = passage.quote.length > 40 ? `${passage.quote.slice(0, 40)}…` : passage.quote;
  const positions: number[] = [];
  for (let at = text.indexOf(passage.quote); at !== -1; at = text.indexOf(passage.quote, at + 1)) positions.push(at);
  if (positions.length === 0) return { error: `${label}: quote not found in ${passage.fileId}: «${short}»` };
  const cpPositions = positions.map((at) => cpIndex(text, at));
  let start: number;
  if (passage.startChar !== undefined) {
    if (!cpPositions.includes(passage.startChar)) {
      return { error: `${label}: startChar ${passage.startChar} does not point at the quote in ${passage.fileId}` };
    }
    start = passage.startChar;
  } else if (passage.occurrence !== undefined) {
    if (passage.occurrence > cpPositions.length) {
      return { error: `${label}: occurrence ${passage.occurrence} but the quote occurs ${cpPositions.length} time(s)` };
    }
    start = cpPositions[passage.occurrence - 1] as number;
  } else if (cpPositions.length > 1) {
    return { error: `${label}: quote occurs ${cpPositions.length} times in ${passage.fileId}; add "occurrence"` };
  } else {
    start = cpPositions[0] as number;
  }
  return { span: { fileId: passage.fileId, start, end: start + cpLength(passage.quote) } };
}

/** Every annotated passage with the key it is stored under. */
function passagesOf(gold: MatterGold): Array<[string, GoldPassage]> {
  const out: Array<[string, GoldPassage]> = [];
  for (const entry of [...(gold.claims ?? []), ...(gold.defenses ?? [])]) {
    entry.sources.forEach((source, index) => out.push([`${entry.id}#sources.${index}`, source]));
  }
  for (const link of gold.evidenceLinks ?? []) {
    link.evidence.forEach((source, index) => out.push([`${link.id}#evidence.${index}`, source]));
  }
  for (const contradiction of gold.contradictions ?? []) {
    out.push([`${contradiction.id}#left`, contradiction.left], [`${contradiction.id}#right`, contradiction.right]);
  }
  for (const event of gold.chronology ?? []) {
    event.sources.forEach((source, index) => out.push([`${event.id}#sources.${index}`, source]));
  }
  for (const issue of gold.legalIssues ?? []) {
    (issue.sources ?? []).forEach((source, index) => out.push([`${issue.id}#sources.${index}`, source]));
  }
  for (const abstention of gold.expectedAbstentions ?? []) {
    if (abstention.type === "no_contradiction") {
      out.push([`${abstention.id}#left`, abstention.left], [`${abstention.id}#right`, abstention.right]);
    } else if (abstention.type === "no_item" || abstention.type === "no_event_date") {
      out.push([`${abstention.id}#passage`, abstention.passage]);
    }
  }
  for (const alternative of gold.alternatives ?? []) {
    (alternative.acceptSources ?? []).forEach((source, index) =>
      out.push([`${alternative.id}#acceptSources.${index}`, source]),
    );
  }
  return out;
}

/**
 * Validate a gold file and locate every passage. `texts` supplies file text
 * for files whose text is not inline (a lawyer's gold file refers to the
 * product's extracted text; it never has to carry client text itself).
 */
export function parseMatterGold(
  raw: unknown,
  texts: Readonly<Record<string, string>> = {},
): { located?: LocatedGold; errors: string[] } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { errors: ["not JSON"] };
    }
  }
  const parsed = matterGoldSchema.safeParse(value);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      ),
    };
  }
  const gold = parsed.data;
  const textMap = new Map<string, string>();
  for (const file of gold.files) {
    const text = texts[file.fileId] ?? file.text;
    if (text !== undefined) textMap.set(file.fileId, text);
  }
  const known = new Set(gold.files.map((file) => file.fileId));
  const errors: string[] = [];
  const spans = new Map<string, LocatedSpan>();
  for (const [key, passage] of passagesOf(gold)) {
    if (!known.has(passage.fileId)) {
      errors.push(`${key}: file ${passage.fileId} is not listed in files`);
      continue;
    }
    const found = locate(passage, textMap, key);
    if (found.error !== undefined) errors.push(found.error);
    else spans.set(key, found.span as LocatedSpan);
  }
  if (errors.length > 0) return { errors };
  return { located: { gold, texts: textMap, spans }, errors: [] };
}

// ---------------------------------------------------------------------------
// Run findings (the subset the scorer reads; extra fields are ignored)
// ---------------------------------------------------------------------------

const runSourceSchema = z
  .object({
    fileId: z.string(),
    startChar: z.number().int(),
    endChar: z.number().int(),
    quote: z.string(),
    role: z.string().optional(),
    observationId: z.string().optional(),
  })
  .passthrough();

const runItemSchema = z
  .object({
    itemId: z.string().optional(),
    kind: z.string(),
    title: z.string(),
    body: z.string().nullable().optional(),
    occurredOn: z.string().nullable().optional(),
    datePrecision: z.string().nullable().optional(),
    supportStatus: z.string().nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    sources: z.array(runSourceSchema),
  })
  .passthrough();

const runSideSchema = z
  .object({ observationId: z.string(), fileId: z.string(), statement: z.string().optional() })
  .passthrough();

export const runFindingsSchema = z
  .object({
    status: z.string().optional(),
    processingCoverage: z
      .object({
        complete: z.boolean(),
        filesTotal: z.number().optional(),
        filesProcessed: z.number().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    exhaustiveClaimRefusedBecause: z.string().nullable().optional(),
    items: z.array(runItemSchema),
    links: z
      .array(z.object({ fromItemId: z.string(), toItemId: z.string(), linkKind: z.string() }).passthrough())
      .optional(),
    relations: z
      .array(z.object({ relation: z.string(), left: runSideSchema, right: runSideSchema }).passthrough())
      .optional(),
  })
  .passthrough();

export type RunFindingsInput = z.infer<typeof runFindingsSchema>;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface CategoryScore {
  /** Gold entries (optional ones included). */
  readonly gold: number;
  /** Gold entries that must be found (not marked optional). */
  readonly required: number;
  readonly found: number;
  readonly recall: number | null;
  /** Run assertions of this category. */
  readonly runAssertions: number;
  readonly matchedRunAssertions: number;
  readonly precision: number | null;
  readonly missed: string[];
  /** Item ids (or assertion keys) the gold does not account for. */
  readonly unmatched: string[];
}

export interface EvidenceLinkScore extends CategoryScore {
  /**
   * Support/oppose assertions whose evidence could not be tied to a verified
   * span (the source's quote is not the file text at its offsets, names a
   * file this gold cannot read, or the link names an item the run does not
   * contain). They match no gold link and stay in `runAssertions`.
   */
  readonly unresolvedRunAssertions: number;
}

export interface ContradictionScore extends CategoryScore {
  /** Among found pairs: the run's label is the gold label or an accepted one. */
  readonly labelAccuracy: number | null;
  /** Run relations whose observations could not be tied to a verified span. */
  readonly unresolvedRunAssertions: number;
}

export interface AbstentionViolation {
  readonly id: string;
  readonly type: string;
  readonly by: string[];
}

export interface CompletenessResult {
  readonly id: string;
  readonly type: string;
  readonly status: "met" | "not_met" | "unknown";
  readonly detailTr: string;
}

export interface MatterGoldScore {
  readonly schema: typeof MATTER_GOLD_SCORE_SCHEMA;
  readonly goldId: string;
  readonly goldSource: MatterGold["source"];
  readonly adjudication: MatterGold["adjudication"];
  readonly runStatus: string | null;
  readonly categories: {
    readonly claims: CategoryScore | null;
    readonly defenses: CategoryScore | null;
    readonly evidenceLinks: EvidenceLinkScore | null;
    readonly contradictions: ContradictionScore | null;
    readonly chronology: CategoryScore | null;
    readonly legalIssues: CategoryScore | null;
  };
  readonly abstentions: {
    readonly total: number;
    readonly respected: number;
    readonly respectRate: number | null;
    readonly violated: AbstentionViolation[];
    /**
     * Could not be checked: the run made an assertion of the forbidden kind
     * (a relation, a support status, an item kind, a date) without tying it
     * to a verified source — the source's quote is not the file text at its
     * offsets, names a file this gold cannot read, or is missing — so it may
     * be exactly the forbidden assertion. Never counted as respected.
     */
    readonly unverifiable: AbstentionViolation[];
  } | null;
  readonly completeness: CompletenessResult[];
  readonly provenance: {
    readonly runSources: number;
    readonly verified: number;
    /** Quote is not the file text at the given offsets. */
    readonly unverified: number;
    /** The source names a file this gold does not have text for. */
    readonly outOfScope: number;
  };
  readonly noticesTr: string[];
}

interface RunSpan extends LocatedSpan {
  readonly role: string;
  readonly observationId: string | undefined;
}

interface RunItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly occurredOn: string | null;
  /** What the run itself says it knows about the date (exact/month/year/approximate). */
  readonly datePrecision: string | null;
  readonly supportStatus: string | null;
  readonly relation: string | null;
  /** Verified spans that state the item itself (basis/mention). */
  readonly basis: RunSpan[];
  /** Verified spans attached as support/oppose evidence. */
  readonly evidence: RunSpan[];
  /** Basis/mention sources that could not be checked (unverified or out of scope). */
  readonly uncheckedBasis: number;
  /** The keys of those unchecked basis/mention sources (sourceKey). */
  readonly uncheckedBasisKeys: string[];
  /** Support/oppose sources that could not be checked: evidence the run asserted that can match nothing. */
  readonly uncheckedEvidence: Array<{ readonly key: string; readonly stance: "supports" | "opposes" }>;
}

/**
 * A run source's identity for de-duplication: its observation id when it has
 * one (stageFinalize gives a link's evidence and the claim's mirrored
 * support source the same one), otherwise its file and offsets.
 */
function sourceKey(source: { observationId?: string | undefined; fileId: string; startChar: number; endChar: number }): string {
  return source.observationId ?? `${source.fileId}:${source.startChar}-${source.endChar}`;
}

function overlapOf(a: LocatedSpan, b: LocatedSpan): number {
  if (a.fileId !== b.fileId) return 0;
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Credit rule: the overlap covers at least SPAN_OVERLAP_MIN of BOTH spans.
 * A run span holding a gold passage inside a stretch more than twice as long
 * identifies nothing in particular and earns no credit.
 */
export function spansMatch(a: LocatedSpan, b: LocatedSpan): boolean {
  const overlap = overlapOf(a, b);
  if (overlap <= 0) return false;
  const longer = Math.max(a.end - a.start, b.end - b.start);
  return overlap >= SPAN_OVERLAP_MIN * longer;
}

/**
 * Detection rule for expected abstentions: the overlap covers at least
 * SPAN_OVERLAP_MIN of the SHORTER span. A run item that asserts the forbidden
 * thing on a longer stretch containing the passage has still asserted it; the
 * strict credit rule must not let such a violation slip by.
 */
export function spansTouch(a: LocatedSpan, b: LocatedSpan): boolean {
  const overlap = overlapOf(a, b);
  if (overlap <= 0) return false;
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return overlap >= SPAN_OVERLAP_MIN * shorter;
}

function anyMatch(left: readonly LocatedSpan[], right: readonly LocatedSpan[]): boolean {
  return left.some((a) => right.some((b) => spansMatch(a, b)));
}

function anyTouch(left: readonly LocatedSpan[], right: readonly LocatedSpan[]): boolean {
  return left.some((a) => right.some((b) => spansTouch(a, b)));
}

/** Coarse to fine. "approximate" is below every gold precision. */
const PRECISION_RANK: Readonly<Record<string, number>> = { approximate: -1, year: 0, month: 1, exact: 2 };

function dateMatches(
  goldDate: string,
  precision: string | undefined,
  runDate: string | null,
  runPrecision: string | null = null,
): boolean {
  if (runDate === null) return false;
  const effective = precision ?? precisionOf(goldDate);
  // What the run itself knows caps what it asserts: a month-only event is
  // stored as YYYY-MM-01 and must not be credited as that exact day.
  if (runPrecision !== null) {
    const runRank = PRECISION_RANK[runPrecision];
    if (runRank === undefined || runRank < (PRECISION_RANK[effective] ?? 2)) return false;
  }
  const width = effective === "exact" ? 10 : effective === "month" ? 7 : 4;
  return runDate.slice(0, width) === goldDate.slice(0, width);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

/**
 * Maximum one-to-one assignment (augmenting paths). `adjacent[e]` lists the
 * run assertions that match gold entry e; the result names, per entry, the
 * run assertion credited to it, or -1. One run assertion is credited to at
 * most one gold entry: a single quote covering two claims has not found two
 * claims.
 */
function assignOneToOne(adjacent: ReadonlyArray<readonly number[]>): number[] {
  const ownerOf = new Map<number, number>();
  const augment = (entry: number, seen: Set<number>): boolean => {
    for (const candidate of adjacent[entry] ?? []) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const owner = ownerOf.get(candidate);
      if (owner === undefined || augment(owner, seen)) {
        ownerOf.set(candidate, entry);
        return true;
      }
    }
    return false;
  };
  for (let entry = 0; entry < adjacent.length; entry += 1) augment(entry, new Set<number>());
  const assigned = adjacent.map(() => -1);
  for (const [candidate, entry] of ownerOf) assigned[entry] = candidate;
  return assigned;
}

interface RecallTally {
  /** Ids of the required gold entries credited under the one-to-one assignment. */
  readonly credited: ReadonlySet<string>;
  /** Run assertions that matched more than one required gold entry. */
  readonly shared: number;
}

/**
 * Credit required gold entries one-to-one. Optional entries take no part: a
 * run assertion is never spent on an entry whose absence is not an error.
 */
function tallyRecall(
  entryIds: readonly string[],
  candidateCount: number,
  isOptional: (id: string) => boolean,
  matches: (entryIndex: number, candidate: number) => boolean,
): RecallTally {
  const requiredIndexes = entryIds.map((_, index) => index).filter((index) => !isOptional(entryIds[index] as string));
  const adjacent = requiredIndexes.map((entryIndex) => {
    const list: number[] = [];
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      if (matches(entryIndex, candidate)) list.push(candidate);
    }
    return list;
  });
  const assigned = assignOneToOne(adjacent);
  const credited = new Set<string>();
  assigned.forEach((candidate, position) => {
    if (candidate >= 0) credited.add(entryIds[requiredIndexes[position] as number] as string);
  });
  const uses = new Map<number, number>();
  for (const list of adjacent) for (const candidate of list) uses.set(candidate, (uses.get(candidate) ?? 0) + 1);
  const shared = [...uses.values()].filter((count) => count > 1).length;
  return { credited, shared };
}

function recallOf(
  ids: readonly string[],
  credited: ReadonlySet<string>,
  isOptional: (id: string) => boolean,
): { required: number; found: number; missed: string[] } {
  const required = ids.filter((id) => !isOptional(id));
  const missed = required.filter((id) => !credited.has(id));
  return { required: required.length, found: required.length - missed.length, missed };
}

const BASIS_ROLES = new Set(["basis", "mention", ""]);
const EVIDENCE_ROLES = new Set(["support", "oppose"]);

/** Score one run's findings against a located gold file. Pure. */
export function scoreMatterRun(located: LocatedGold, runJson: unknown): MatterGoldScore {
  const parsedRun = runFindingsSchema.safeParse(runJson);
  if (!parsedRun.success) {
    throw new Error(
      `run findings JSON has the wrong shape: ${parsedRun.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  }
  const run = parsedRun.data;
  const { gold, texts, spans } = located;

  // --- verify the run's provenance against the file texts -----------------
  let runSources = 0;
  let verified = 0;
  let unverified = 0;
  let outOfScope = 0;
  const observationSpans = new Map<string, RunSpan>();
  const codePoints = new Map<string, string[]>();
  const quoteAt = (fileId: string, text: string, start: number, end: number): string => {
    let points = codePoints.get(fileId);
    if (points === undefined) {
      points = Array.from(text);
      codePoints.set(fileId, points);
    }
    return points.slice(start, end).join("");
  };
  const items: RunItem[] = run.items.map((item, index) => {
    const basis: RunSpan[] = [];
    const evidence: RunSpan[] = [];
    // A basis source that cannot be checked leaves open WHAT the item states:
    // it may be exactly a passage the gold says must not be asserted.
    let uncheckedBasis = 0;
    const uncheckedBasisKeys: string[] = [];
    // A support/oppose source that cannot be checked is still evidence the
    // run ASSERTED: it matches nothing, but it is not dropped (R2-38).
    const uncheckedEvidence: Array<{ key: string; stance: "supports" | "opposes" }> = [];
    const unchecked = (source: (typeof item.sources)[number]): void => {
      const role = source.role ?? "";
      if (BASIS_ROLES.has(role)) {
        uncheckedBasis += 1;
        uncheckedBasisKeys.push(sourceKey(source));
      } else if (EVIDENCE_ROLES.has(role)) {
        uncheckedEvidence.push({ key: sourceKey(source), stance: role === "support" ? "supports" : "opposes" });
      }
    };
    for (const source of item.sources) {
      runSources += 1;
      const text = texts.get(source.fileId);
      if (text === undefined) {
        outOfScope += 1;
        unchecked(source);
        continue;
      }
      if (
        source.startChar < 0 ||
        source.endChar <= source.startChar ||
        quoteAt(source.fileId, text, source.startChar, source.endChar) !== source.quote
      ) {
        unverified += 1;
        unchecked(source);
        continue;
      }
      verified += 1;
      const span: RunSpan = {
        fileId: source.fileId,
        start: source.startChar,
        end: source.endChar,
        role: source.role ?? "",
        observationId: source.observationId,
      };
      if (source.observationId !== undefined && !observationSpans.has(source.observationId)) {
        observationSpans.set(source.observationId, span);
      }
      if (EVIDENCE_ROLES.has(span.role)) evidence.push(span);
      else if (BASIS_ROLES.has(span.role)) basis.push(span);
    }
    const relation = item.attributes?.["relation"];
    return {
      id: item.itemId ?? `item-${index + 1}`,
      kind: item.kind,
      title: item.title,
      body: item.body ?? "",
      occurredOn: item.occurredOn ?? null,
      datePrecision: item.datePrecision ?? null,
      supportStatus: item.supportStatus ?? null,
      relation: typeof relation === "string" ? relation : null,
      basis,
      evidence,
      uncheckedBasis,
      uncheckedBasisKeys,
      uncheckedEvidence,
    };
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  // --- helpers over gold ----------------------------------------------------
  const alternativesOf = new Map<string, NonNullable<MatterGold["alternatives"]>>();
  for (const alternative of gold.alternatives ?? []) {
    const bucket = alternativesOf.get(alternative.appliesTo) ?? [];
    bucket.push(alternative);
    alternativesOf.set(alternative.appliesTo, bucket);
  }
  const altSpans = (id: string): LocatedSpan[] =>
    (alternativesOf.get(id) ?? []).flatMap((alternative) =>
      (alternative.acceptSources ?? []).map((_, index) => spans.get(`${alternative.id}#acceptSources.${index}`) as LocatedSpan),
    );
  const entrySpans = (id: string, count: number, field = "sources"): LocatedSpan[] => [
    ...Array.from({ length: count }, (_, index) => spans.get(`${id}#${field}.${index}`) as LocatedSpan),
    ...altSpans(id),
  ];
  const isOptional = (id: string): boolean => (alternativesOf.get(id) ?? []).some((alternative) => alternative.optional === true);
  const acceptedKinds = (id: string, primary: string): Set<string> => {
    const kinds = new Set([primary]);
    for (const alternative of alternativesOf.get(id) ?? []) for (const kind of alternative.acceptKinds ?? []) kinds.add(kind);
    return kinds;
  };

  // --- claims and defenses --------------------------------------------------
  interface PartyEntry {
    readonly id: string;
    readonly kinds: Set<string>;
    readonly spans: LocatedSpan[];
  }
  const partyEntries = (list: MatterGold["claims"], primary: "claim" | "defense"): PartyEntry[] =>
    (list ?? []).map((entry) => ({
      id: entry.id,
      kinds: acceptedKinds(entry.id, primary),
      spans: entrySpans(entry.id, entry.sources.length),
    }));
  const claimEntries = partyEntries(gold.claims, "claim");
  const defenseEntries = partyEntries(gold.defenses, "defense");
  const allParty = [...claimEntries, ...defenseEntries];
  const itemMatchesParty = (item: RunItem, entry: PartyEntry): boolean =>
    entry.kinds.has(item.kind) && anyMatch(item.basis, entry.spans);
  // One run item is one assertion: it is credited to at most one claim or
  // defense (both together, since a claim may be accepted as a defense).
  const partyTally = tallyRecall(
    allParty.map((entry) => entry.id),
    items.length,
    isOptional,
    (entryIndex, candidate) => itemMatchesParty(items[candidate] as RunItem, allParty[entryIndex] as PartyEntry),
  );
  let sharedRunAssertions = partyTally.shared;

  const scoreParty = (entries: PartyEntry[], kind: "claim" | "defense", annotated: boolean): CategoryScore | null => {
    if (!annotated) return null;
    const runItems = items.filter((item) => item.kind === kind);
    const { required, found, missed } = recallOf(
      entries.map((entry) => entry.id),
      partyTally.credited,
      isOptional,
    );
    const unmatched = runItems.filter((item) => !allParty.some((entry) => itemMatchesParty(item, entry))).map((item) => item.id);
    return {
      gold: entries.length,
      required,
      found,
      recall: ratio(found, required),
      runAssertions: runItems.length,
      matchedRunAssertions: runItems.length - unmatched.length,
      precision: ratio(runItems.length - unmatched.length, runItems.length),
      missed,
      unmatched,
    };
  };

  // --- evidence links -------------------------------------------------------
  interface EvidenceUnit {
    readonly key: string;
    /** Undefined when the link names an item the run does not contain. */
    readonly target: RunItem | undefined;
    readonly stance: "supports" | "opposes";
    /** Undefined for an UNRESOLVED assertion: its evidence has no verified span. */
    readonly span: RunSpan | undefined;
  }
  const units = new Map<string, EvidenceUnit>();
  const addUnit = (target: RunItem, stance: "supports" | "opposes", span: RunSpan): void => {
    const key = `${target.id}|${stance}|${span.fileId}:${span.start}-${span.end}`;
    if (!units.has(key)) units.set(key, { key, target, stance, span });
  };
  // A support/oppose the run asserted whose evidence cannot be checked
  // matches no gold link but stays a run assertion, exactly as an
  // unverifiable claim, event or contradiction does (R2-38): dropping it
  // would let the category built to catch false support score precision 1
  // on the one link it could check. Keys line up across the two routes
  // stageFinalize writes the same judgement by (a link from the evidence
  // item, and a support/oppose source on the claim with the same
  // observationId), so the two count once — as verified spans already do.
  const addUnresolved = (key: string, target: RunItem | undefined, stance: "supports" | "opposes"): void => {
    if (!units.has(key)) units.set(key, { key, target, stance, span: undefined });
  };
  for (const link of run.links ?? []) {
    if (link.linkKind !== "supports" && link.linkKind !== "opposes") continue;
    const from = byId.get(link.fromItemId);
    const to = byId.get(link.toItemId);
    if (from === undefined || to === undefined) {
      addUnresolved(`link:${link.fromItemId}|${link.toItemId}|${link.linkKind}`, to, link.linkKind);
      continue;
    }
    for (const span of from.basis) addUnit(to, link.linkKind, span);
    for (const key of from.uncheckedBasisKeys) addUnresolved(`${to.id}|${link.linkKind}|unverified:${key}`, to, link.linkKind);
    if (from.basis.length === 0 && from.uncheckedBasisKeys.length === 0) {
      // The evidence item cites nothing at all: the link is an assertion with no evidence.
      addUnresolved(`link:${from.id}|${to.id}|${link.linkKind}`, to, link.linkKind);
    }
  }
  for (const item of items) {
    for (const span of item.evidence) addUnit(item, span.role === "support" ? "supports" : "opposes", span);
    for (const entry of item.uncheckedEvidence) addUnresolved(`${item.id}|${entry.stance}|unverified:${entry.key}`, item, entry.stance);
  }
  let evidenceLinks: EvidenceLinkScore | null = null;
  if (gold.evidenceLinks !== undefined) {
    const partyById = new Map(allParty.map((entry) => [entry.id, entry]));
    const unitMatches = (unit: EvidenceUnit, link: NonNullable<MatterGold["evidenceLinks"]>[number]): boolean => {
      if (unit.span === undefined || unit.target === undefined) return false;
      const target = partyById.get(link.target);
      return (
        target !== undefined &&
        unit.stance === link.stance &&
        itemMatchesParty(unit.target, target) &&
        anyMatch([unit.span], entrySpans(link.id, link.evidence.length, "evidence"))
      );
    };
    const all = [...units.values()];
    const links = gold.evidenceLinks;
    const tally = tallyRecall(
      links.map((link) => link.id),
      all.length,
      isOptional,
      (entryIndex, candidate) =>
        unitMatches(all[candidate] as EvidenceUnit, links[entryIndex] as NonNullable<MatterGold["evidenceLinks"]>[number]),
    );
    sharedRunAssertions += tally.shared;
    const { required, found, missed } = recallOf(
      links.map((link) => link.id),
      tally.credited,
      isOptional,
    );
    const unmatched = all.filter((unit) => !(gold.evidenceLinks ?? []).some((link) => unitMatches(unit, link))).map((unit) => unit.key);
    evidenceLinks = {
      gold: gold.evidenceLinks.length,
      required,
      found,
      recall: ratio(found, required),
      runAssertions: all.length,
      matchedRunAssertions: all.length - unmatched.length,
      precision: ratio(all.length - unmatched.length, all.length),
      missed,
      unmatched,
      unresolvedRunAssertions: all.filter((unit) => unit.span === undefined).length,
    };
  }

  // --- contradictions -------------------------------------------------------
  interface PairAssertion {
    readonly key: string;
    readonly relation: string;
    readonly left: LocatedSpan | undefined;
    readonly right: LocatedSpan | undefined;
  }
  const pairs = new Map<string, PairAssertion>();
  for (const relation of run.relations ?? []) {
    if (relation.relation !== "CONTRADICTION" && relation.relation !== "TENSION") continue;
    const ids = [relation.left.observationId, relation.right.observationId].sort();
    const key = `obs:${ids.join("|")}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        key,
        relation: relation.relation,
        left: observationSpans.get(relation.left.observationId),
        right: observationSpans.get(relation.right.observationId),
      });
    }
  }
  for (const item of items) {
    if (item.kind !== "contradiction") continue;
    const [left, right] = item.basis;
    const obs = [left?.observationId, right?.observationId];
    const key =
      obs[0] !== undefined && obs[1] !== undefined ? `obs:${[obs[0], obs[1]].sort().join("|")}` : `item:${item.id}`;
    if (!pairs.has(key)) pairs.set(key, { key, relation: item.relation ?? "CONTRADICTION", left, right });
  }
  // Credit: the two run sides are two passages, not one, and each stands for
  // exactly one gold side. A paragraph quoted as one side that holds both
  // gold sides identifies neither of them.
  const pairMatches = (assertion: PairAssertion, a: readonly LocatedSpan[], b: readonly LocatedSpan[]): boolean => {
    const { left, right } = assertion;
    if (left === undefined || right === undefined) return false;
    if (overlapOf(left, right) > 0) return false;
    const leftA = anyMatch([left], a);
    const leftB = anyMatch([left], b);
    const rightA = anyMatch([right], a);
    const rightB = anyMatch([right], b);
    if ((leftA && leftB) || (rightA && rightB)) return false;
    return (leftA && rightB) || (leftB && rightA);
  };
  // Detection (expected abstentions): the lenient reading, so a forbidden
  // relation asserted over a longer stretch is still caught.
  const pairTouches = (assertion: PairAssertion, a: readonly LocatedSpan[], b: readonly LocatedSpan[]): boolean => {
    if (assertion.left === undefined || assertion.right === undefined) return false;
    return (
      (anyTouch([assertion.left], a) && anyTouch([assertion.right], b)) ||
      (anyTouch([assertion.left], b) && anyTouch([assertion.right], a))
    );
  };
  const sideSpans = (id: string, side: "left" | "right"): LocatedSpan[] =>
    (alternativesOf.get(id) ?? [])
      .filter((alternative) => alternative.side === side)
      .flatMap((alternative) =>
        (alternative.acceptSources ?? []).map((_, index) => spans.get(`${alternative.id}#acceptSources.${index}`) as LocatedSpan),
      );
  // An alternative's acceptSources restate ONE named side, never both: a
  // restatement paired with the very side it restates is no contradiction.
  const goldPairSides = (id: string): [LocatedSpan[], LocatedSpan[]] => [
    [spans.get(`${id}#left`) as LocatedSpan, ...sideSpans(id, "left")],
    [spans.get(`${id}#right`) as LocatedSpan, ...sideSpans(id, "right")],
  ];
  const allPairs = [...pairs.values()];
  const unresolvedRunAssertions = allPairs.filter((pair) => pair.left === undefined || pair.right === undefined).length;
  let contradictions: ContradictionScore | null = null;
  if (gold.contradictions !== undefined) {
    const entries = gold.contradictions;
    const sides = entries.map((entry) => goldPairSides(entry.id));
    const tally = tallyRecall(
      entries.map((entry) => entry.id),
      allPairs.length,
      isOptional,
      (entryIndex, candidate) => {
        const [a, b] = sides[entryIndex] as [LocatedSpan[], LocatedSpan[]];
        return pairMatches(allPairs[candidate] as PairAssertion, a, b);
      },
    );
    sharedRunAssertions += tally.shared;
    const { required, found, missed } = recallOf(
      entries.map((entry) => entry.id),
      tally.credited,
      isOptional,
    );
    let labelled = 0;
    let labelCorrect = 0;
    entries.forEach((entry, index) => {
      const [a, b] = sides[index] as [LocatedSpan[], LocatedSpan[]];
      const hits = allPairs.filter((pair) => pairMatches(pair, a, b));
      const accepted = new Set<string>([entry.relation]);
      for (const alternative of alternativesOf.get(entry.id) ?? []) for (const rel of alternative.acceptRelations ?? []) accepted.add(rel);
      if (hits.length > 0) {
        labelled += 1;
        if (hits.some((pair) => accepted.has(pair.relation))) labelCorrect += 1;
      }
    });
    const unmatched = allPairs
      .filter((pair) => !(gold.contradictions ?? []).some((entry) => pairMatches(pair, ...goldPairSides(entry.id))))
      .map((pair) => pair.key);
    contradictions = {
      gold: gold.contradictions.length,
      required,
      found,
      recall: ratio(found, required),
      runAssertions: allPairs.length,
      matchedRunAssertions: allPairs.length - unmatched.length,
      precision: ratio(allPairs.length - unmatched.length, allPairs.length),
      missed,
      unmatched,
      labelAccuracy: ratio(labelCorrect, labelled),
      unresolvedRunAssertions,
    };
  }

  // --- chronology -----------------------------------------------------------
  // The chronology category is the product's timeline: its event items.
  const dated = items.filter((item) => (item.kind === "event" || item.kind === "procedural_event") && item.occurredOn !== null);
  // A date, though, is shown on EVERY dated item (a fact, a claim, evidence):
  // a forbidden date (no_event_date) is checked against all of them.
  const anyDated = items.filter((item) => item.occurredOn !== null);
  let chronology: CategoryScore | null = null;
  if (gold.chronology !== undefined) {
    const eventMatches = (item: RunItem, event: NonNullable<MatterGold["chronology"]>[number]): boolean => {
      const dates = [event.date, ...(alternativesOf.get(event.id) ?? []).flatMap((alt) => (alt.acceptDate === undefined ? [] : [alt.acceptDate]))];
      return (
        dates.some((date) =>
          dateMatches(date, date === event.date ? event.precision : undefined, item.occurredOn, item.datePrecision),
        ) &&
        anyMatch(item.basis, entrySpans(event.id, event.sources.length))
      );
    };
    const events = gold.chronology;
    const tally = tallyRecall(
      events.map((event) => event.id),
      dated.length,
      isOptional,
      (entryIndex, candidate) =>
        eventMatches(dated[candidate] as RunItem, events[entryIndex] as NonNullable<MatterGold["chronology"]>[number]),
    );
    sharedRunAssertions += tally.shared;
    const { required, found, missed } = recallOf(
      events.map((event) => event.id),
      tally.credited,
      isOptional,
    );
    const unmatched = dated.filter((item) => !(gold.chronology ?? []).some((event) => eventMatches(item, event))).map((item) => item.id);
    chronology = {
      gold: gold.chronology.length,
      required,
      found,
      recall: ratio(found, required),
      runAssertions: dated.length,
      matchedRunAssertions: dated.length - unmatched.length,
      precision: ratio(dated.length - unmatched.length, dated.length),
      missed,
      unmatched,
    };
  }

  // --- legal issues ---------------------------------------------------------
  let legalIssues: CategoryScore | null = null;
  if (gold.legalIssues !== undefined) {
    const runIssues = items.filter((item) => item.kind === "legal_issue");
    const issueMatches = (item: RunItem, issue: NonNullable<MatterGold["legalIssues"]>[number]): boolean => {
      if (anyMatch(item.basis, entrySpans(issue.id, (issue.sources ?? []).length))) return true;
      const keywords = issue.keywords ?? [];
      if (keywords.length === 0) return false;
      const haystack = foldTurkishCase(`${item.title} ${item.body}`);
      return keywords.every((keyword) => haystack.includes(foldTurkishCase(keyword)));
    };
    const issues = gold.legalIssues;
    const tally = tallyRecall(
      issues.map((issue) => issue.id),
      runIssues.length,
      isOptional,
      (entryIndex, candidate) =>
        issueMatches(runIssues[candidate] as RunItem, issues[entryIndex] as NonNullable<MatterGold["legalIssues"]>[number]),
    );
    sharedRunAssertions += tally.shared;
    const { required, found, missed } = recallOf(
      issues.map((issue) => issue.id),
      tally.credited,
      isOptional,
    );
    const unmatched = runIssues.filter((item) => !(gold.legalIssues ?? []).some((issue) => issueMatches(item, issue))).map((item) => item.id);
    legalIssues = {
      gold: gold.legalIssues.length,
      required,
      found,
      recall: ratio(found, required),
      runAssertions: runIssues.length,
      matchedRunAssertions: runIssues.length - unmatched.length,
      precision: ratio(runIssues.length - unmatched.length, runIssues.length),
      missed,
      unmatched,
    };
  }

  // --- expected abstentions (things that must NOT be asserted) --------------
  let abstentions: MatterGoldScore["abstentions"] = null;
  if (gold.expectedAbstentions !== undefined) {
    const violated: AbstentionViolation[] = [];
    const unverifiable: AbstentionViolation[] = [];
    // An item that makes the forbidden assertion but cites no verified basis
    // (none at all, or one that could not be checked) may be exactly the
    // forbidden one: unknown, which is not "respected". A verified basis on
    // another passage rules it out.
    const cannotBeRuledOut = (item: RunItem): boolean => item.basis.length === 0 || item.uncheckedBasis > 0;
    for (const abstention of gold.expectedAbstentions) {
      let by: string[] = [];
      let unchecked: string[] = [];
      if (abstention.type === "no_contradiction") {
        const a = [spans.get(`${abstention.id}#left`) as LocatedSpan];
        const b = [spans.get(`${abstention.id}#right`) as LocatedSpan];
        const forbidden = allPairs.filter((pair) => (abstention.relations as string[]).includes(pair.relation));
        by = forbidden.filter((pair) => pairTouches(pair, a, b)).map((pair) => pair.key);
        // A forbidden relation the run did not tie to its sources may be
        // exactly this pair.
        unchecked = forbidden.filter((pair) => pair.left === undefined || pair.right === undefined).map((pair) => pair.key);
      } else if (abstention.type === "no_support_status") {
        // Any item kind counts: a claim the run filed as a defense (or the
        // missing-support note about it) must not slip past the check.
        const target = allParty.find((entry) => entry.id === abstention.target) as PartyEntry;
        const asserting = items.filter(
          (item) => item.supportStatus !== null && (abstention.statuses as string[]).includes(item.supportStatus),
        );
        by = asserting.filter((item) => anyTouch(item.basis, target.spans)).map((item) => item.id);
        unchecked = asserting.filter(cannotBeRuledOut).map((item) => item.id);
      } else if (abstention.type === "no_item") {
        const span = spans.get(`${abstention.id}#passage`) as LocatedSpan;
        const asserting = items.filter((item) => abstention.kinds.includes(item.kind));
        by = asserting.filter((item) => anyTouch(item.basis, [span])).map((item) => item.id);
        unchecked = asserting.filter(cannotBeRuledOut).map((item) => item.id);
      } else {
        // Every dated item, whatever its kind.
        const span = spans.get(`${abstention.id}#passage`) as LocatedSpan;
        const asserting = anyDated.filter((item) =>
          dateMatches(abstention.date, undefined, item.occurredOn, item.datePrecision),
        );
        by = asserting.filter((item) => anyTouch(item.basis, [span])).map((item) => item.id);
        unchecked = asserting.filter(cannotBeRuledOut).map((item) => item.id);
      }
      if (by.length > 0) violated.push({ id: abstention.id, type: abstention.type, by });
      else if (unchecked.length > 0) unverifiable.push({ id: abstention.id, type: abstention.type, by: unchecked });
    }
    const total = gold.expectedAbstentions.length;
    const respected = total - violated.length - unverifiable.length;
    abstentions = { total, respected, respectRate: ratio(respected, total), violated, unverifiable };
  }

  // --- completeness requirements --------------------------------------------
  const coverage = run.processingCoverage;
  const completeness: CompletenessResult[] = (gold.completenessRequirements ?? []).map((requirement) => {
    const base = { id: requirement.id, type: requirement.type };
    if (requirement.type === "run_finished") {
      if (run.status === undefined) return { ...base, status: "unknown", detailTr: "Koşunun durumu yanıtta yok." };
      return run.status === "done"
        ? { ...base, status: "met", detailTr: "İnceleme bitti." }
        : { ...base, status: "not_met", detailTr: `İnceleme durumu: ${run.status}.` };
    }
    if (coverage === undefined || coverage === null) {
      return { ...base, status: "unknown", detailTr: "İşleme kapsamı yanıtta yok; tamam sayılmadı." };
    }
    if (requirement.type === "coverage_complete") {
      return coverage.complete
        ? { ...base, status: "met", detailTr: "Kapsam tam bildirildi." }
        : { ...base, status: "not_met", detailTr: "Kapsam eksik bildirildi." };
    }
    if (requirement.type === "coverage_gap_reported") {
      if (coverage.complete) {
        return {
          ...base,
          status: "not_met",
          detailTr: "Altın dosyaya göre bir eksik var, ama sistem kapsamı TAM bildirdi.",
        };
      }
      if (run.exhaustiveClaimRefusedBecause === undefined) {
        // The gap was reported, but whether the "all of it" claim was refused
        // cannot be read from this response: unknown, never met.
        return {
          ...base,
          status: "unknown",
          detailTr: "Kapsam eksik bildirildi, ama 'tümü' iddiasının reddedilip reddedilmediği yanıtta yok; karşılandı sayılmadı.",
        };
      }
      return run.exhaustiveClaimRefusedBecause !== null && run.exhaustiveClaimRefusedBecause.trim() !== ""
        ? { ...base, status: "met", detailTr: "Kapsam eksik bildirildi ve 'tümü' iddiası reddedildi." }
        : { ...base, status: "not_met", detailTr: "Kapsam eksik, ama 'tümü' iddiası reddedilmedi." };
    }
    // all_files_processed
    if (coverage.filesTotal === undefined || coverage.filesProcessed === undefined) {
      return { ...base, status: "unknown", detailTr: "Dosya sayıları yanıtta yok." };
    }
    const expected = gold.files.length;
    return coverage.filesProcessed === coverage.filesTotal && coverage.filesTotal === expected
      ? { ...base, status: "met", detailTr: `${expected} dosyanın tamamı işlendi.` }
      : {
          ...base,
          status: "not_met",
          detailTr: `İşlenen dosya ${coverage.filesProcessed}/${coverage.filesTotal}; altın dosyada ${expected} dosya var.`,
        };
  });

  // --- notices --------------------------------------------------------------
  const noticesTr: string[] = [];
  if (gold.source === "synthetic") {
    noticesTr.push("Altın dosya sentetiktir; sonuç yalnız düzeneğin çalıştığını gösterir, hukukî kalite hükmü değildir.");
  }
  if (gold.adjudication !== "agreed") {
    noticesTr.push(`Altın dosyanın avukat onayı: ${gold.adjudication === "pending" ? "bekliyor" : "tartışmalı"}.`);
  }
  if (abstentions !== null && abstentions.violated.length > 0) {
    noticesTr.push(
      `Sistem, altın dosyada 'söylenmemeli' denen ${abstentions.violated.length} şeyi söyledi; bu, bulunan doğrulardan ayrı bir hatadır.`,
    );
  }
  if (abstentions !== null && abstentions.unverifiable.length > 0) {
    noticesTr.push(
      `${abstentions.unverifiable.length} 'söylenmemeli' kaydı denetlenemedi: sistemin, kaynağı doğrulanamayan ya da` +
        ` hiç gösterilmeyen bir kaydı tam da söylenmemesi gereken şey olabilir; uyuldu sayılmadı.`,
    );
  }
  if (sharedRunAssertions > 0) {
    noticesTr.push(
      `${sharedRunAssertions} sistem kaydı altın dosyada birden çok kayda uyuyordu; her biri yalnız bir altın kayıt için sayıldı.`,
    );
  }
  if (unverified > 0 || outOfScope > 0) {
    noticesTr.push(
      `${unverified + outOfScope} kaynak alıntısı dosya metninde belirtilen yerde doğrulanamadı; bu kaynaklar hiçbir eşleşmeye sayılmadı,` +
        " ama onlara dayanan sistem kayıtları (iddia, delil bağlantısı, olay, çelişki) sistemin söylediği olarak kesinlik" +
        " hesabında kaldı.",
    );
  }
  if (completeness.some((result) => result.status === "unknown")) {
    noticesTr.push("Bazı tamlık koşulları yanıttan okunamadı; 'bilinmiyor' olarak bırakıldı, karşılandı sayılmadı.");
  }
  noticesTr.push("Puanlar tek bir sayıda birleştirilmez; her kategori ayrı okunmalıdır.");

  return {
    schema: MATTER_GOLD_SCORE_SCHEMA,
    goldId: gold.id,
    goldSource: gold.source,
    adjudication: gold.adjudication,
    runStatus: run.status ?? null,
    categories: {
      claims: scoreParty(claimEntries, "claim", gold.claims !== undefined),
      defenses: scoreParty(defenseEntries, "defense", gold.defenses !== undefined),
      evidenceLinks,
      contradictions,
      chronology,
      legalIssues,
    },
    abstentions,
    completeness,
    provenance: { runSources, verified, unverified, outOfScope },
    noticesTr,
  };
}

const CATEGORY_TR: Record<keyof MatterGoldScore["categories"], string> = {
  claims: "İddialar",
  defenses: "Savunmalar",
  evidenceLinks: "Delil bağlantıları",
  contradictions: "Çelişkiler",
  chronology: "Kronoloji",
  legalIssues: "Hukukî meseleler",
};

/** Plain-Turkish Markdown of a score (numbers and ids only; no file text). */
export function renderMatterScoreMarkdown(score: MatterGoldScore): string {
  const fmt = (value: number | null): string => (value === null ? "—" : value.toFixed(3));
  const lines = [
    `# Dosya bazında altın karşılaştırma: ${score.goldId}`,
    "",
    ...score.noticesTr.map((notice) => `> ${notice}`),
    "",
    "| Kategori | Altın | Aranan | Bulunan | Duyarlılık | Sistem iddiası | Doğru | Kesinlik | Kaçan |",
    "|---|---|---|---|---|---|---|---|---|",
    ...(Object.keys(CATEGORY_TR) as Array<keyof MatterGoldScore["categories"]>).map((key) => {
      const category = score.categories[key];
      if (category === null) return `| ${CATEGORY_TR[key]} | işaretlenmedi | — | — | — | — | — | — | — |`;
      return (
        `| ${CATEGORY_TR[key]} | ${category.gold} | ${category.required} | ${category.found} | ${fmt(category.recall)}` +
        ` | ${category.runAssertions} | ${category.matchedRunAssertions} | ${fmt(category.precision)} | ${category.missed.join(", ") || "—"} |`
      );
    }),
    "",
  ];
  const evidenceLinks = score.categories.evidenceLinks;
  if (evidenceLinks !== null) {
    lines.push(
      `Delil bağlantıları · kaynağı doğrulanamayan sistem bağlantısı: ${evidenceLinks.unresolvedRunAssertions}` +
        " (hiçbir altın kayda eşleşmedi; sistem iddiası olarak kesinlik hesabında)",
      "",
    );
  }
  const contradictions = score.categories.contradictions;
  if (contradictions !== null) {
    lines.push(
      `Çelişki etiket doğruluğu: ${fmt(contradictions.labelAccuracy)} · kaynağa bağlanamayan sistem çelişkisi: ${contradictions.unresolvedRunAssertions}`,
      "",
    );
  }
  if (score.abstentions !== null) {
    lines.push(
      `Söylenmemesi gerekenler: ${score.abstentions.respected}/${score.abstentions.total} uyuldu` +
        (score.abstentions.violated.length > 0
          ? ` · ihlal: ${score.abstentions.violated.map((violation) => violation.id).join(", ")}`
          : "") +
        (score.abstentions.unverifiable.length > 0
          ? ` · denetlenemedi: ${score.abstentions.unverifiable.map((entry) => entry.id).join(", ")}`
          : ""),
      "",
    );
  }
  for (const result of score.completeness) {
    const status = result.status === "met" ? "karşılandı" : result.status === "not_met" ? "KARŞILANMADI" : "bilinmiyor";
    lines.push(`- ${result.id} (${result.type}): ${status} — ${result.detailTr}`);
  }
  lines.push(
    "",
    `Kaynak doğrulama: ${score.provenance.verified}/${score.provenance.runSources} doğrulandı, ${score.provenance.unverified} doğrulanamadı, ${score.provenance.outOfScope} kapsam dışı.`,
    "",
  );
  return lines.join("\n");
}

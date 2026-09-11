/**
 * Typed readers over recorded step outcomes + the planner note codec.
 *
 * SECURITY INVARIANT (brief 10.2): raw text inside provider documents is NEVER
 * treated as planner instructions. The planner consumes recorded outcomes only
 * through the narrow, typed extractors in this module:
 *
 *  - `extractHits` reads structured hit fields (externalId/provider) — the only
 *    place a provider-supplied ID may enter a later tool call;
 *  - `extractDocumentText` returns the document body ONLY so that the strict
 *    deterministic reference parser (retrieval/referenceParser.ts) can extract
 *    exact E./K. references from it. Free text never flows into tool inputs.
 *
 * Planner notes are metadata the planner itself attaches to every decision it
 * emits (`PlannerDecision.note`); the executor records them verbatim. They let
 * the planner and the coverage reporter re-associate recorded steps with the
 * template/issue/role that produced them without re-deriving inputs.
 */

import type { Outcome } from "../capabilities/types.js";

/**
 * Role of a planned step inside a research template instance.
 *
 *  - `legislation`  statute lookup (search_mevzuat / search_kanun);
 *  - `statute`      reading inside a known statute (search_within_* family);
 *  - `amendment`    legislation.resolveTarget (current-version / target resolution);
 *  - `primary`      primary-authority search for the issue (case law / regulator);
 *  - `contrary`     MANDATORY contrary-authority search (brief 10.2);
 *  - `fetch`        full document fetch of a recorded hit (snippets are not citable);
 *  - `followUp`     bounded search for an E./K. reference parsed out of fetched text;
 *  - `gap`          round-2 retry for an issue that produced no judicial evidence.
 */
export type StepRole =
  | "legislation"
  | "statute"
  | "amendment"
  | "primary"
  | "contrary"
  | "fetch"
  | "followUp"
  | "gap";

const STEP_ROLES: ReadonlySet<string> = new Set([
  "legislation",
  "statute",
  "amendment",
  "primary",
  "contrary",
  "fetch",
  "followUp",
  "gap",
]);

/** Search-shaped roles whose hits count as evidence for an issue. */
export const EVIDENCE_SEARCH_ROLES: ReadonlySet<StepRole> = new Set<StepRole>([
  "legislation",
  "primary",
  "followUp",
  "gap",
]);

/**
 * Roles whose hits count as *judicial/regulator* evidence (a statute hit is
 * primary source but it is not authority on how the rule is applied). The
 * round-2 gap analysis is measured against these, because the gap query is a
 * case-law query.
 */
export const JUDICIAL_SEARCH_ROLES: ReadonlySet<StepRole> = new Set<StepRole>([
  "primary",
  "followUp",
  "gap",
]);

/**
 * Roles whose top hit is worth fetching in full. Contrary hits are included:
 * brief 10.2 forbids citing a search snippet, so opposing authority found by a
 * contrary search must be fetched before it can be relied on.
 */
export const FETCHABLE_SEARCH_ROLES: ReadonlySet<StepRole> = new Set<StepRole>([
  "legislation",
  "primary",
  "contrary",
  "followUp",
  "gap",
]);

export interface PlannerNote {
  version: "v1";
  template: string;
  issueId: string;
  role: StepRole;
  round: number;
}

const NOTE_PREFIX = "collex-planner/v1";
const NOTE_RE =
  /^collex-planner\/v1;template=(?<template>[A-Za-z0-9_-]+);issue=(?<issue>[A-Za-z0-9_-]+);role=(?<role>[A-Za-z]+);round=(?<round>\d+)$/u;

export function encodePlannerNote(fields: {
  template: string;
  issueId: string;
  role: StepRole;
  round: number;
}): string {
  return `${NOTE_PREFIX};template=${fields.template};issue=${fields.issueId};role=${fields.role};round=${fields.round}`;
}

/** Strict parse; returns undefined for absent or foreign notes. */
export function parsePlannerNote(note: string | undefined): PlannerNote | undefined {
  if (note === undefined) return undefined;
  const m = note.match(NOTE_RE);
  const g = m?.groups;
  if (!g?.["template"] || !g["issue"] || !g["role"] || !g["round"]) return undefined;
  if (!STEP_ROLES.has(g["role"])) return undefined;
  const round = Number.parseInt(g["round"], 10);
  if (!Number.isInteger(round) || round < 1) return undefined;
  return {
    version: "v1",
    template: g["template"],
    issueId: g["issue"],
    role: g["role"] as StepRole,
    round,
  };
}

/** Structured search hit fields the planner is allowed to consume. */
export interface TypedHit {
  externalId: string;
  provider: string;
  /**
   * Additive (W14/B-15): the legislation TYPE label a `search_mevzuat` row
   * carries. It is a closed vocabulary printed by the tool itself, mapped
   * through planner/templates.ts WITHIN_BY_TYPE onto a `search_within_*` tool
   * NAME — never interpolated into a query and never used for control flow
   * beyond that table lookup, so the untrusted-payload rule still holds.
   */
  legislationKind?: string;
  /**
   * Additive (W14/B-15): the official instrument number of a legislation row,
   * already narrowed to digits by the payload parser. It is the `mevzuat_no`
   * argument of the `search_within_*` family.
   */
  legislationNo?: string;
}

/**
 * Extract structured hits from a recorded search outcome. Defensive narrowing:
 * anything that is not an array of objects carrying a non-empty string
 * `externalId` is ignored. Hit `provider` falls back to the outcome provider.
 */
export function extractHits(outcome: Outcome<unknown>): TypedHit[] {
  if (outcome.status === "error") return [];
  const data: unknown = outcome.data;
  if (!Array.isArray(data)) return [];
  const hits: TypedHit[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const externalId = rec["externalId"];
    if (typeof externalId !== "string" || externalId.length === 0) continue;
    const provider =
      typeof rec["provider"] === "string" && rec["provider"].length > 0
        ? rec["provider"]
        : outcome.provider;
    const legislationKind = rec["legislationKind"];
    const legislationNo = rec["legislationNo"];
    hits.push({
      externalId,
      provider,
      ...(typeof legislationKind === "string" && legislationKind.length > 0
        ? { legislationKind }
        : {}),
      // Re-narrowed here too: `extractHits` is the trust boundary, and a
      // payload could reach it through a path that did not go through
      // parseSearchPayload.
      ...(typeof legislationNo === "string" && /^[0-9]{1,12}$/u.test(legislationNo)
        ? { legislationNo }
        : {}),
    });
  }
  return hits;
}

/**
 * Extract the canonical text of a fetched document outcome. Returned ONLY for
 * exact-reference parsing; callers must never copy this text into tool inputs.
 */
export function extractDocumentText(outcome: Outcome<unknown>): string | undefined {
  if (outcome.status === "error") return undefined;
  const data: unknown = outcome.data;
  if (data === null || typeof data !== "object") return undefined;
  const text = (data as Record<string, unknown>)["text"];
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

export interface TypedFailure {
  kind: string;
  safeMessage?: string;
}

/** Typed failure of an error outcome (for coverage / failed-lane reporting). */
export function extractFailure(outcome: Outcome<unknown>): TypedFailure | undefined {
  if (outcome.status === "ok") return undefined;
  if (outcome.status === "partial") {
    return { kind: outcome.error.kind, safeMessage: outcome.error.safeMessage };
  }
  return { kind: outcome.error.kind, safeMessage: outcome.error.safeMessage };
}

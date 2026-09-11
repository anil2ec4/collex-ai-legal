/**
 * Matter query scope: "search everything in THIS matter".
 *
 * The gap this closes
 * -------------------
 * `matterId` on `POST /v1/answer` used to mean only "file the answer under
 * this matter" (contract [M]). It never reached retrieval. A lawyer who had
 * put eighty documents into one matter and asked a question about it was
 * answered from the whole corpus unless the browser had ALSO enumerated all
 * eighty ids into `filters.fileIds` — which it could not, because that field
 * caps at 50 and the browser does not know the membership.
 *
 * So this module resolves membership on the SERVER. The browser sends a
 * matter id; the server turns it into the file ids the matter actually
 * contains, under the caller's own tenant.
 *
 * Why a separate `scope` and not another filter flag
 * --------------------------------------------------
 * `filters` describes properties of documents to KEEP (source, chamber,
 * year). Scope describes WHERE TO LOOK AT ALL. Overloading `filters.matterId`
 * would put a membership lookup behind a word that means predicate, and the
 * two have different failure modes: an unknown chamber is an empty result, an
 * unknown matter is a 404. Legacy `filters.fileIds` / `filters.includeCorpus`
 * keep working untouched.
 *
 * Scope NEVER widens
 * ------------------
 * When a caller names both a matter and explicit file ids, the ids are
 * VERIFIED against the matter's membership. Anything outside is refused by
 * name rather than quietly dropped or quietly allowed — the first would hide
 * a mistake, the second would let a request reach another matter's evidence.
 *
 * Tenancy is structural, not checked
 * ----------------------------------
 * The store handed in here is already bound to one tenant (`PgMatterStore`
 * carries `tenantId` in every statement; RLS is the second line). A matter
 * belonging to another tenant therefore resolves to `MATTER_NOT_FOUND`, the
 * same answer as a matter that does not exist — no existence oracle.
 *
 * The same file may belong to MANY matters. Membership is a link, never a
 * copy: nothing here duplicates a document, a chunk or an embedding.
 */

import type { MatterStore } from "./types.js";

/**
 * Server ceiling on how many documents one scoped question may search.
 *
 * This is NOT the 50-id request cap on `filters.fileIds` — that one bounds
 * what a browser may type into a request body. This one bounds the work a
 * single question can cause after the server expanded a matter, and it is
 * deliberately far larger: a real litigation matter holding several hundred
 * documents is the case this build exists for. Beyond it the caller is told
 * to narrow, rather than being served a silently truncated "whole matter".
 */
export const MATTER_SCOPE_MAX_FILES = 500;

export interface MatterScopeRequest {
  /** Search every document linked to this matter. */
  readonly matterId?: string | undefined;
  /** Explicit uploads. With `matterId`, these are verified as members. */
  readonly fileIds?: readonly string[] | undefined;
  /** Union the public corpus back in. Default false: matter evidence only. */
  readonly includeCorpus?: boolean | undefined;
}

export interface ResolvedMatterScope {
  readonly kind: "RESOLVED";
  /** Empty means "no scope" — search the corpus as before. */
  readonly fileIds: readonly string[];
  readonly includeCorpus: boolean;
  /** Present when the scope came from a matter (for the on-screen banner). */
  readonly matterId?: string;
  /** How many documents the matter contributed, before any intersection. */
  readonly matterFileCount?: number;
}

export type MatterScopeOutcome =
  | ResolvedMatterScope
  | { readonly kind: "MATTER_NOT_FOUND"; readonly matterId: string }
  | { readonly kind: "MATTER_EMPTY"; readonly matterId: string }
  | {
      readonly kind: "FILES_OUTSIDE_MATTER";
      readonly matterId: string;
      readonly outside: readonly string[];
    }
  | {
      readonly kind: "MATTER_TOO_LARGE";
      readonly matterId: string;
      readonly fileCount: number;
      readonly limit: number;
    }
  | { readonly kind: "STORE_UNAVAILABLE"; readonly matterId: string };

/**
 * Every distinct upload linked to a matter, in stable link order.
 *
 * Reads `kind: "file"` items and takes their `refId`, which the intake lane
 * writes as the upload's file id. Duplicates are collapsed: linking the same
 * document twice is a user action with no retrieval meaning.
 */
export async function matterFileIds(
  store: MatterStore,
  matterId: string,
): Promise<readonly string[]> {
  const items = await store.listItems(matterId);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const refId = item.refId;
    if (typeof refId !== "string" || refId === "") continue;
    if (seen.has(refId)) continue;
    seen.add(refId);
    out.push(refId);
  }
  return out;
}

/**
 * Turn a scope request into the concrete file ids retrieval should search.
 *
 * Returns a typed outcome for every refusal so the route can answer with the
 * right status and a sentence a lawyer can act on, instead of an empty
 * result that reads as "your documents do not support this".
 */
export async function resolveMatterScope(
  store: MatterStore,
  request: MatterScopeRequest,
): Promise<MatterScopeOutcome> {
  const includeCorpus = request.includeCorpus === true;
  const explicit = dedupe(request.fileIds ?? []);
  const matterId = request.matterId;

  // No matter named: legacy file scope, unchanged.
  if (matterId === undefined || matterId === null || matterId === "") {
    return { kind: "RESOLVED", fileIds: explicit, includeCorpus };
  }

  let members: readonly string[];
  try {
    const matter = await store.get(matterId);
    if (matter === undefined) return { kind: "MATTER_NOT_FOUND", matterId };
    members = await matterFileIds(store, matterId);
  } catch {
    // A store that cannot answer must not be reported as an empty matter:
    // "this matter has no documents" and "I could not read the matter" are
    // different facts and only one of them is the lawyer's problem.
    return { kind: "STORE_UNAVAILABLE", matterId };
  }

  if (members.length === 0) return { kind: "MATTER_EMPTY", matterId };

  // The ceiling applies to what will actually be SEARCHED, so an explicit
  // subset is taken into account. Checking the whole matter first refused
  // the very request the error message asks for: "narrow the question to
  // specific documents" was rejected for a large matter even when the
  // caller HAD narrowed it.
  if (explicit.length === 0 && members.length > MATTER_SCOPE_MAX_FILES) {
    return {
      kind: "MATTER_TOO_LARGE",
      matterId,
      fileCount: members.length,
      limit: MATTER_SCOPE_MAX_FILES,
    };
  }

  if (explicit.length === 0) {
    return {
      kind: "RESOLVED",
      fileIds: members,
      includeCorpus,
      matterId,
      matterFileCount: members.length,
    };
  }

  // Both given: the explicit list must be a SUBSET of the matter. Anything
  // else is named and refused — scope never widens past the matter.
  const membership = new Set(members);
  const outside = explicit.filter((id) => !membership.has(id));
  if (outside.length > 0) {
    return { kind: "FILES_OUTSIDE_MATTER", matterId, outside };
  }
  return {
    kind: "RESOLVED",
    fileIds: explicit,
    includeCorpus,
    matterId,
    matterFileCount: members.length,
  };
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

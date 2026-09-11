/**
 * The frozen identity of an exhaustive analysis run (W20, ADR-034).
 *
 * Why a run needs more than "matter + files"
 * ------------------------------------------
 * W19 resumed an unfinished run when the matter and the selected file ids
 * matched. That was not enough to be safe:
 *
 *   - a CHRONOLOGY request picked up an interrupted CONTRADICTIONS run over
 *     the same files, and answered a different question than was asked;
 *   - a file re-uploaded while the run was interrupted has a NEW current
 *     version, and resuming would have mixed units read from the old version
 *     with units read from the new one under one ledger;
 *   - a change of extractor, prompt schema or model makes finished units
 *     incomparable with the ones still to come.
 *
 * So a run is identified by everything its results depend on. Two requests
 * resume the same run only when this identity is byte-for-byte equal, and it
 * is hashed so the database can enforce "at most one active run per
 * identity" with a unique index rather than a race-prone lookup.
 *
 * Version semantics: the identity pins the DOCUMENT VERSION ids. A run is an
 * immutable snapshot — it keeps reading the versions it was created over, and
 * a request after a source change has a different identity and gets a new
 * run. The ledger therefore never names one version while an observation
 * came from another.
 */

import { createHash } from "node:crypto";
import type { AnalysisTask } from "./tasks.js";

/** Which model produced model-assisted observations, when one did. */
export interface ModelIdentity {
  /** Provider family, e.g. "openai-compatible". Never a URL or a key. */
  readonly provider: string;
  readonly modelId: string;
  /** LOCAL_PROCESS / TRUSTED_LOCAL_NETWORK / CLOUD. */
  readonly trust: string;
}

export interface RunIdentity {
  readonly tenantId: string;
  readonly matterId: string;
  readonly task: AnalysisTask;
  /**
   * Every selected file with the document version pinned for it. `null`
   * means the file was selected but had no readable version when the run was
   * created — that is part of the identity too, so the run that reported the
   * file as missing is not resumed once the file exists.
   */
  readonly versions: ReadonlyArray<readonly [fileId: string, versionId: string | null]>;
  readonly unitBuilderVersion: string;
  readonly extractorVersion: string;
  /** Prompt/schema version of model-assisted extraction, or null. */
  readonly modelSchemaVersion: string | null;
  /** Version of the reduce-stage builders (intelligence.ts). */
  readonly intelVersion: string;
  readonly model: ModelIdentity | null;
  /** The client's procedural role, when the lawyer gave one. */
  readonly clientRole: string | null;
}

/** Code-unit comparison: deterministic on every platform and locale. */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The canonical serialization. Field order is fixed here, versions are
 * sorted by file id, and ids are lower-cased, so two equal identities always
 * serialize to the same bytes.
 */
export function canonicalRunIdentity(identity: RunIdentity): string {
  const versions = [...identity.versions]
    .map(([fileId, versionId]) => [fileId, versionId === null ? null : versionId.toLowerCase()] as const)
    .sort((left, right) => byCodeUnits(left[0], right[0]));
  return JSON.stringify({
    v: 1,
    tenantId: identity.tenantId.toLowerCase(),
    matterId: identity.matterId.toLowerCase(),
    task: identity.task,
    versions,
    unitBuilderVersion: identity.unitBuilderVersion,
    extractorVersion: identity.extractorVersion,
    modelSchemaVersion: identity.modelSchemaVersion,
    intelVersion: identity.intelVersion,
    model:
      identity.model === null
        ? null
        : {
            provider: identity.model.provider,
            modelId: identity.model.modelId,
            trust: identity.model.trust,
          },
    clientRole: identity.clientRole,
  });
}

/** sha256 hex of the canonical identity: the `identity_key` column. */
export function runIdentityKey(identity: RunIdentity): string {
  return createHash("sha256").update(canonicalRunIdentity(identity), "utf8").digest("hex");
}

/**
 * Stable identity of one observation inside a run.
 *
 * Built from where the observation came from (run, unit, producer and its
 * version) and what it says (kind, exact span, normalized value). The unique
 * index on (run_id, observation_key) turns "a unit was processed twice" —
 * two workers racing on an expired lease, a retry after a lost commit
 * acknowledgement — into a no-op instead of a duplicated finding.
 */
export function observationKey(parts: {
  readonly runId: string;
  readonly unitNo: number;
  readonly origin: "deterministic" | "model";
  readonly producerVersion: string;
  readonly kind: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly value: string;
}): string {
  const canonical = JSON.stringify([
    parts.runId.toLowerCase(),
    parts.unitNo,
    parts.origin,
    parts.producerVersion,
    parts.kind,
    parts.startChar,
    parts.endChar,
    parts.value,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

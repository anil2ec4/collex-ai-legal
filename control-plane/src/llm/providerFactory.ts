/**
 * ONE place that turns configuration into model providers, per ROLE (W20).
 *
 * W19 built LocalGenerationAdapter and then nothing consumed it: the answer
 * pipeline still only knew "rule-based" or "Anthropic", and the exhaustive
 * runner only knew its patterns. Routing is now explicit and central:
 *
 *   answer            drafts citation-first claims in /v1/answer
 *   verifier          judges claim <-> passage entailment in /v1/answer
 *   matterExtraction  reads each analysis unit (exhaustive review)
 *   matterSynthesis   weighs claims against evidence, red-team points
 *
 * Every role is filled by the same configured local endpoint; a role may
 * name a different MODEL on that endpoint (`COLLEX_LOCAL_LLM_MODEL_<ROLE>`),
 * so the bake-off winner for extraction need not be the one that drafts.
 * No model family is named anywhere: the model is a setting.
 *
 * Boundaries, in this order, before any adapter exists:
 *   1. the endpoint must classify (endpointTrust.ts) — a DNS name is CLOUD,
 *      a LAN address needs the explicit allow-list, metadata is refused;
 *   2. the data boundary must allow that trust (LOCAL_ONLY refuses CLOUD);
 *   3. each adapter re-checks both on EVERY call (localGenerationAdapter).
 * There is no fallback from a refused local endpoint to a cloud one — a
 * refusal leaves the role EMPTY and callers use their deterministic path.
 *
 * All adapters built from one endpoint share ONE request gate, so the
 * appliance's concurrency limit (default 1 on an 8 GB machine) holds across
 * roles instead of per adapter.
 */

import { boundaryAllows, type DataBoundary, type EndpointTrust } from "./endpointTrust.js";
import { LocalGenerationAdapter, RequestGate } from "./localGenerationAdapter.js";
import {
  LOCAL_LLM_ENV,
  readTrustedLocalHosts,
  resolveDataBoundary,
  resolveLocalGenerationConfig,
} from "./localGenerationConfig.js";

export const MODEL_ROLES = ["answer", "verifier", "matterExtraction", "matterSynthesis"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Optional per-role model override on the SAME endpoint. */
export const ROLE_MODEL_ENV: Readonly<Record<ModelRole, string>> = Object.freeze({
  answer: "COLLEX_LOCAL_LLM_MODEL_ANSWER",
  verifier: "COLLEX_LOCAL_LLM_MODEL_VERIFIER",
  matterExtraction: "COLLEX_LOCAL_LLM_MODEL_EXTRACTION",
  matterSynthesis: "COLLEX_LOCAL_LLM_MODEL_SYNTHESIS",
});

type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ModelRouteTable {
  readonly status: "not_configured" | "refused" | "configured";
  readonly boundary: DataBoundary;
  readonly roles: Readonly<Partial<Record<ModelRole, LocalGenerationAdapter>>>;
  /** Model name per role, for health and the run identity. */
  readonly models: Readonly<Partial<Record<ModelRole, string>>>;
  readonly trust: EndpointTrust | null;
  /** Credential-free endpoint (never a key). */
  readonly baseUrl: string | null;
  /** Plain Turkish reason when not configured or refused. */
  readonly messageTr: string | null;
  readonly warnings: readonly string[];
}

export interface ResolveModelRoutesOptions {
  /** Injectable transport (tests). Production uses globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

function readTrimmed(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolve every role once. Call it at startup and keep the table: adapters
 * hold the shared request gate, so rebuilding them per request would defeat
 * the concurrency limit.
 */
export function resolveModelRoutes(
  env: EnvLike = process.env,
  options: ResolveModelRoutesOptions = {},
): ModelRouteTable {
  const boundary = resolveDataBoundary(env);
  const empty = {
    boundary,
    roles: {},
    models: {},
    trust: null,
    baseUrl: null,
  } as const;
  const resolved = resolveLocalGenerationConfig(env);
  if (resolved.kind === "NOT_CONFIGURED") {
    return { ...empty, status: "not_configured", messageTr: null, warnings: [] };
  }
  if (resolved.kind === "REFUSED") {
    return { ...empty, status: "refused", messageTr: resolved.refusal.message, warnings: [] };
  }
  const config = resolved.config;
  const refusal = boundaryAllows(boundary, config.trust);
  if (refusal !== undefined) {
    return { ...empty, status: "refused", messageTr: refusal.message, warnings: config.warnings };
  }

  const gate = new RequestGate(config.concurrency);
  const apiKey = readTrimmed(env, LOCAL_LLM_ENV.apiKey);
  const trustedLocalHosts = readTrustedLocalHosts(env);
  const byModel = new Map<string, LocalGenerationAdapter>();
  const roles: Partial<Record<ModelRole, LocalGenerationAdapter>> = {};
  const models: Partial<Record<ModelRole, string>> = {};
  for (const role of MODEL_ROLES) {
    const model = readTrimmed(env, ROLE_MODEL_ENV[role]) ?? config.model;
    let adapter = byModel.get(model);
    if (adapter === undefined) {
      adapter = new LocalGenerationAdapter({
        config: { ...config, model },
        boundary,
        apiKey,
        trustedLocalHosts,
        gate,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
      byModel.set(model, adapter);
    }
    roles[role] = adapter;
    models[role] = model;
  }
  return {
    status: "configured",
    boundary,
    roles,
    models,
    trust: config.trust,
    baseUrl: config.baseUrl,
    messageTr: null,
    warnings: config.warnings,
  };
}

/** Human label for results ("Yerel model · <model> · bu bilgisayar"). */
export function localModelLabel(adapter: LocalGenerationAdapter): string {
  const where = adapter.trust === "LOCAL_PROCESS" ? "bu bilgisayar" : "yerel ağ";
  return `Yerel model ${adapter.model} (${where})`;
}

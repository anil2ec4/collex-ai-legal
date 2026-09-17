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
 *
 * W21 — the application AI policy (aiPolicy.ts) is a fourth gate:
 *   - DETERMINISTIC_ONLY leaves every role empty (no model at all);
 *   - an endpoint that is someone else's computer (trust CLOUD) is refused
 *     for this "local" table unless the policy is CLOUD_ALLOWED — before
 *     W21 the default ALLOW_CLOUD boundary let a hosted address fill all
 *     four roles, so matter analysis could send a whole file off-machine
 *     with no per-request consent;
 *   - even under CLOUD_ALLOWED such an endpoint never fills the two matter
 *     roles (`matterAnalysisAllowed: false`): matter analysis has no
 *     per-request consent. The answer roles stay, and the answer pipeline
 *     uses them only for a request that consents (decideProvider).
 * The boundary handed to every adapter is the EFFECTIVE one (the stricter of
 * COLLEX_DATA_BOUNDARY and the policy).
 */

import {
  isOnPremisesTrust,
  resolveEffectiveAiPolicy,
  type AiPolicy,
  type EffectiveAiPolicy,
} from "./aiPolicy.js";
import { boundaryAllows, type DataBoundary, type EndpointTrust } from "./endpointTrust.js";
import { LocalGenerationAdapter, RequestGate } from "./localGenerationAdapter.js";
import {
  LOCAL_LLM_ENV,
  readTrustedLocalHosts,
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
  /** The EFFECTIVE boundary every adapter re-checks per call. */
  readonly boundary: DataBoundary;
  /** W21: the effective AI policy this table was built under. */
  readonly policy: AiPolicy;
  /**
   * W21: the matter roles are filled (on-machine or own-network endpoint).
   * False for an outside endpoint admitted under CLOUD_ALLOWED, and for
   * every table that is not configured.
   */
  readonly matterAnalysisAllowed: boolean;
  readonly roles: Readonly<Partial<Record<ModelRole, LocalGenerationAdapter>>>;
  /** Model name per role, for health and the run identity. */
  readonly models: Readonly<Partial<Record<ModelRole, string>>>;
  /**
   * Where the endpoint runs. W21: KEPT for a classified endpoint that was
   * refused (an outside address under LOCAL_ONLY or LOCAL_PREFERRED) —
   * informational only, no adapter exists — so every consumer can say "the
   * model is outside" (MODEL_OFF_MACHINE), not "no model". Null when nothing
   * is configured or the address itself failed classification.
   */
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
  /**
   * W21: the effective AI policy, resolved ONCE by the caller (serve.mjs).
   * Absent -> resolved from `env` (COLLEX_AI_POLICY + COLLEX_DATA_BOUNDARY).
   */
  readonly policy?: EffectiveAiPolicy;
}

/** W21: a configured endpoint under DETERMINISTIC_ONLY. */
const POLICY_DETERMINISTIC_TR =
  "Yapay zekâ kullanımı kapalı olarak ayarlandığı için ayarlı model kullanılmıyor.";
/** W21: an outside endpoint under LOCAL_PREFERRED (the default). */
const OFF_MACHINE_REFUSED_TR =
  "Ayarlı model adresi bu bilgisayarda ya da kendi ağınızda değil; yapay zekâ ilkesi" +
  " dışarıdaki servislere izin vermediği için kullanılmadı.";
/** W21: an outside endpoint admitted under CLOUD_ALLOWED. */
const OFF_MACHINE_NO_MATTER_TR =
  "Ayarlı model dışarıdaki bir serviste: yalnız onay verdiğiniz yanıtlarda kullanılır," +
  " dosya incelemesinde kullanılmaz.";

/**
 * W21 (#23): a DNS name that LOOKS like this computer but is answered by the
 * network resolver (`localhost.localdomain`, anything under `.localdomain` or
 * `.localhost`). endpointTrust.ts classifies it CLOUD like any other DNS name,
 * so it is refused under LOCAL_ONLY / LOCAL_PREFERRED; the generic "outside
 * service" sentence alone reads as a mistake to an operator who meant
 * loopback, so the table also says what to write instead.
 */
const LOOPBACK_ALIAS_HINT_TR =
  "Ayarlı adres bu bilgisayarı kastediyor görünse de ad çözümlemesi ağdaki DNS sunucusuna" +
  " gider; bu bilgisayar için 'localhost' ya da 127.0.0.1 yazın.";

function looksLikeLoopbackAlias(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost.localdomain" || host.endsWith(".localdomain") || host.endsWith(".localhost");
}

const MATTER_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>(["matterExtraction", "matterSynthesis"]);

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
  const policy = options.policy ?? resolveEffectiveAiPolicy(env);
  const boundary = policy.boundary;
  const empty = {
    boundary,
    policy: policy.policy,
    matterAnalysisAllowed: false,
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
  // W21 (#23): a loopback-looking DNS name is CLOUD; the refusal (or, under
  // CLOUD_ALLOWED, a warning) tells the operator what to write instead.
  const aliasHint = config.trust === "CLOUD" && looksLikeLoopbackAlias(config.baseUrl) ? LOOPBACK_ALIAS_HINT_TR : null;
  const withHint = (messageTr: string): string => (aliasHint === null ? messageTr : `${messageTr} ${aliasHint}`);
  const refusal = boundaryAllows(boundary, config.trust);
  if (refusal !== undefined) {
    // W21: the trust is kept here too, exactly as for the policy refusal
    // below. Before this, LOCAL_ONLY (the recommended production profile)
    // reported a hosted address as "no local model is configured"
    // (MODEL_UNAVAILABLE) while LOCAL_PREFERRED named it MODEL_OFF_MACHINE.
    // Roles and models stay empty: nothing becomes callable.
    return { ...empty, status: "refused", messageTr: withHint(refusal.message), warnings: config.warnings, trust: config.trust };
  }
  // W21: the policy, after the boundary. Neither refusal falls back anywhere.
  if (policy.policy === "DETERMINISTIC_ONLY") {
    return { ...empty, status: "refused", messageTr: POLICY_DETERMINISTIC_TR, warnings: config.warnings };
  }
  const onPremises = isOnPremisesTrust(config.trust);
  if (!onPremises && policy.policy !== "CLOUD_ALLOWED") {
    // The trust is kept (informational only; no adapter exists): health and
    // matter analysis can then say "the model is outside", not "no model".
    return { ...empty, status: "refused", messageTr: withHint(OFF_MACHINE_REFUSED_TR), warnings: config.warnings, trust: config.trust };
  }

  const gate = new RequestGate(config.concurrency);
  const apiKey = readTrimmed(env, LOCAL_LLM_ENV.apiKey);
  const trustedLocalHosts = readTrustedLocalHosts(env);
  const byModel = new Map<string, LocalGenerationAdapter>();
  const roles: Partial<Record<ModelRole, LocalGenerationAdapter>> = {};
  const models: Partial<Record<ModelRole, string>> = {};
  for (const role of MODEL_ROLES) {
    // An outside endpoint never reads a matter: no per-request consent there.
    if (!onPremises && MATTER_ROLES.has(role)) continue;
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
    policy: policy.policy,
    matterAnalysisAllowed: onPremises,
    roles,
    models,
    trust: config.trust,
    baseUrl: config.baseUrl,
    messageTr: null,
    warnings: onPremises
      ? config.warnings
      : [...config.warnings, OFF_MACHINE_NO_MATTER_TR, ...(aliasHint === null ? [] : [aliasHint])],
  };
}

/** Human label for results ("Yerel model · <model> · bu bilgisayar"). */
export function localModelLabel(adapter: LocalGenerationAdapter): string {
  // W21: an outside endpoint is never called "yerel" (it used to read "yerel ağ").
  if (adapter.trust === "CLOUD") return `Dışarıdaki model ${adapter.model} (dışarıdaki bir serviste)`;
  const where = adapter.trust === "LOCAL_PROCESS" ? "bu bilgisayar" : "yerel ağ";
  return `Yerel model ${adapter.model} (${where})`;
}

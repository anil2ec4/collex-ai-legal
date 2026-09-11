/**
 * Local generation provider configuration — model-agnostic on purpose.
 *
 * Nothing here names a model family. The endpoint speaks the OpenAI
 * chat-completions shape, which Ollama, llama.cpp's server and LM Studio all
 * expose, so the same adapter reaches any of them and the choice of model is
 * a setting rather than a code change. Committing the product to one model in
 * code is how you end up unable to measure a better one.
 *
 * Intended deployment (documented, NOT measured here)
 * ---------------------------------------------------
 * The target appliance is an Apple M2 Mac mini with 8 GB of unified memory,
 * sitting next to the Windows workstation that runs the rest of ColleX. It is
 * OPTIONAL: with no local endpoint configured the product keeps working
 * exactly as before on its deterministic ports.
 *
 * That machine's throughput has NOT been measured from here and no number is
 * claimed. `scripts/probe_local_generation.mjs` is the harness that measures
 * it on the machine itself; `docs/implementation/LOCAL-GENERATION.md` records
 * what has to be true before a number may be written down.
 *
 * Because 8 GB is the constraint, the defaults are deliberately small:
 * concurrency 1, a modest generation budget, and a context ceiling that is a
 * SETTING rather than whatever the model advertises. A model card claiming
 * 128K context does not mean 128K fits in 8 GB alongside the weights.
 */

import {
  classifyEndpoint,
  type DataBoundary,
  type EndpointDecision,
  type EndpointTrust,
} from "./endpointTrust.js";

/** Environment variable names. Values are NEVER logged or echoed. */
export const LOCAL_LLM_ENV = {
  baseUrl: "COLLEX_LOCAL_LLM_BASE_URL",
  model: "COLLEX_LOCAL_LLM_MODEL",
  apiKey: "COLLEX_LOCAL_LLM_API_KEY",
  contextTokens: "COLLEX_LOCAL_LLM_CONTEXT_TOKENS",
  maxOutputTokens: "COLLEX_LOCAL_LLM_MAX_OUTPUT_TOKENS",
  concurrency: "COLLEX_LOCAL_LLM_CONCURRENCY",
  timeoutMs: "COLLEX_LOCAL_LLM_TIMEOUT_MS",
  trustedHosts: "COLLEX_TRUSTED_LOCAL_HOSTS",
} as const;

/** Name of the data-boundary setting. */
export const DATA_BOUNDARY_ENV = "COLLEX_DATA_BOUNDARY" as const;

/**
 * One request at a time by default.
 *
 * On an 8 GB machine a second concurrent generation does not halve latency,
 * it evicts the first one's KV cache. Long work is decomposed into many small
 * resumable units instead (see the exhaustive analysis lane), which is also
 * what makes a failure cost one unit rather than a whole run.
 */
export const DEFAULT_LOCAL_CONCURRENCY = 1;

/** Conservative context ceiling; raise only after measuring on the box. */
export const DEFAULT_LOCAL_CONTEXT_TOKENS = 8192;
export const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_LOCAL_TIMEOUT_MS = 120_000;

export interface LocalGenerationConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly trust: EndpointTrust;
  readonly authority: string;
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
  /** True when an API key was supplied (the VALUE is never exposed here). */
  readonly authenticated: boolean;
  /** Turkish notes about ignored or clamped settings. */
  readonly warnings: readonly string[];
}

export type LocalGenerationResolution =
  | { readonly kind: "CONFIGURED"; readonly config: LocalGenerationConfig }
  /** Nothing configured — not an error; the deterministic ports still run. */
  | { readonly kind: "NOT_CONFIGURED" }
  | { readonly kind: "REFUSED"; readonly refusal: EndpointDecision & { ok: false } };

type EnvLike = Record<string, string | undefined>;

/** Remove any userinfo and trailing slashes from a URL. */
function stripCredentials(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return raw.replace(/\/+$/u, "");
  }
}

function readTrimmed(env: EnvLike, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value === "" ? undefined : value;
}

function readPositiveInt(
  env: EnvLike,
  key: string,
  fallback: number,
  warnings: string[],
  label: string,
): number {
  const raw = readTrimmed(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    warnings.push(`${label} ayarı sayı olmadığı için yok sayıldı.`);
    return fallback;
  }
  return parsed;
}

/**
 * Trusted local-network authorities, comma separated (`host:port`).
 *
 * Exported so the settings surface and the health report read the SAME list
 * the classifier enforces — a documented allow-list that the enforcement
 * path does not consult is worse than none.
 */
export function readTrustedLocalHosts(env: EnvLike = process.env): readonly string[] {
  const raw = readTrimmed(env, LOCAL_LLM_ENV.trustedHosts);
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

/**
 * The data boundary in force.
 *
 * Defaults to ALLOW_CLOUD so existing installs behave exactly as before:
 * cloud AI is already off unless a key is present, and this setting does not
 * silently change that. LOCAL_ONLY is an explicit, deliberate choice.
 */
export function resolveDataBoundary(env: EnvLike = process.env): DataBoundary {
  return readTrimmed(env, DATA_BOUNDARY_ENV)?.toUpperCase() === "LOCAL_ONLY"
    ? "LOCAL_ONLY"
    : "ALLOW_CLOUD";
}

export function resolveLocalGenerationConfig(
  env: EnvLike = process.env,
): LocalGenerationResolution {
  const baseUrl = readTrimmed(env, LOCAL_LLM_ENV.baseUrl);
  if (baseUrl === undefined) return { kind: "NOT_CONFIGURED" };

  const decision = classifyEndpoint(baseUrl, {
    trustedLocalHosts: readTrustedLocalHosts(env),
  });
  if (!decision.ok) return { kind: "REFUSED", refusal: decision };

  const warnings: string[] = [];
  const model = readTrimmed(env, LOCAL_LLM_ENV.model);
  if (model === undefined) {
    warnings.push(
      "Yerel model adı ayarlanmadığı için yerel yapay zekâ kapalı kaldı.",
    );
    return { kind: "NOT_CONFIGURED" };
  }

  const apiKey = readTrimmed(env, LOCAL_LLM_ENV.apiKey);
  if (decision.trust === "TRUSTED_LOCAL_NETWORK" && apiKey === undefined) {
    warnings.push(
      "Ağdaki model sunucusu için parola ayarlanmadı; sunucuyu yalnız" +
        " kendi ağınızda ve erişimi kısıtlı tutun.",
    );
  }

  return {
    kind: "CONFIGURED",
    config: {
      // Credentials embedded in the URL (http://user:pass@host) are
      // STRIPPED, not carried: `baseUrl` is surfaced by /v1/health and by
      // the adapter's toJSON, both of which promise never to expose a
      // secret. A credential belongs in COLLEX_LOCAL_LLM_API_KEY, which is
      // held off the adapter entirely.
      baseUrl: stripCredentials(baseUrl),
      model,
      trust: decision.trust,
      authority: decision.authority,
      contextTokens: readPositiveInt(
        env,
        LOCAL_LLM_ENV.contextTokens,
        DEFAULT_LOCAL_CONTEXT_TOKENS,
        warnings,
        "Bağlam boyutu",
      ),
      maxOutputTokens: readPositiveInt(
        env,
        LOCAL_LLM_ENV.maxOutputTokens,
        DEFAULT_LOCAL_MAX_OUTPUT_TOKENS,
        warnings,
        "Yanıt boyutu",
      ),
      concurrency: readPositiveInt(
        env,
        LOCAL_LLM_ENV.concurrency,
        DEFAULT_LOCAL_CONCURRENCY,
        warnings,
        "Eşzamanlılık",
      ),
      timeoutMs: readPositiveInt(
        env,
        LOCAL_LLM_ENV.timeoutMs,
        DEFAULT_LOCAL_TIMEOUT_MS,
        warnings,
        "Zaman aşımı",
      ),
      authenticated: apiKey !== undefined,
      warnings,
    },
  };
}

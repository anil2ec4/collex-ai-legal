/**
 * Cloud-AI configuration (W12 lane E, contract [AI]).
 *
 * Default OFF. `resolveAiConfig(env)` returns null unless ANTHROPIC_API_KEY
 * is set; nothing in this module ever logs, echoes or serializes the key:
 *
 *  - `AiConfig.apiKey` is a prototype getter over a private field, so it is
 *    not an own enumerable property (JSON.stringify skips it even without
 *    toJSON);
 *  - `toJSON()` returns only {configured, model, baseUrl, toolChoice};
 *  - `util.inspect` / console.log print "[gizli]" in place of the key.
 *
 * Environment variable NAMES (values are never written anywhere):
 *   ANTHROPIC_API_KEY       enables the lane
 *   COLLEX_AI_MODEL         default 'claude-sonnet-5'; 'claude-opus-5' is the
 *                           higher-quality option (more expensive)
 *   COLLEX_AI_BASE_URL      optional (proxy / gateway); must be http(s)
 *   COLLEX_AI_TOOL_CHOICE   'forced' (default) | 'auto' — see anthropicAdapter
 *
 * LIVE-UNTESTED: no key exists in this environment; see docs/implementation/AI.md.
 */

import { inspect } from "node:util";
import {
  AnthropicAnswerAdapter,
  DEFAULT_ANTHROPIC_MODEL,
  type AnthropicAdapterOptions,
  type AnthropicToolChoiceMode,
} from "../llm/anthropicAdapter.js";
import type { DrafterPort, EntailmentPort } from "../llm/ports.js";

export const AI_ENV = {
  apiKey: "ANTHROPIC_API_KEY",
  model: "COLLEX_AI_MODEL",
  baseUrl: "COLLEX_AI_BASE_URL",
  toolChoice: "COLLEX_AI_TOOL_CHOICE",
} as const;

export const DEFAULT_AI_MODEL = DEFAULT_ANTHROPIC_MODEL;
/** Documented higher-quality (and more expensive) alternative. */
export const HIGHER_QUALITY_AI_MODEL = "claude-opus-5";

/**
 * Honesty flag surfaced by /v1/ai/status and the docs: flips to true only
 * when a supervised live smoke (scripts/ai-live-smoke.mjs) has been run and
 * its output recorded in docs/implementation/AI.md.
 */
export const AI_LIVE_TESTED = false;

export interface AiConfigJson {
  configured: true;
  model: string;
  baseUrl: string | null;
  toolChoice: AnthropicToolChoiceMode;
}

/**
 * The key lives OUTSIDE the instance (module-private WeakMap): no own
 * property, no symbol, nothing for JSON.stringify / Object.keys /
 * getOwnPropertySymbols / spread / inspect to find.
 */
const apiKeys = new WeakMap<AiConfig, string>();

export class AiConfig {
  readonly model: string;
  readonly baseUrl: string | undefined;
  readonly toolChoice: AnthropicToolChoiceMode;
  /** Turkish notes about ignored/invalid optional settings. */
  readonly warnings: readonly string[];

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    toolChoice?: AnthropicToolChoiceMode;
    warnings?: readonly string[];
  }) {
    if (options.apiKey.trim() === "") {
      throw new RangeError("AiConfig requires a non-empty apiKey");
    }
    apiKeys.set(this, options.apiKey);
    this.model = options.model ?? DEFAULT_AI_MODEL;
    this.baseUrl = options.baseUrl;
    this.toolChoice = options.toolChoice ?? "forced";
    this.warnings = options.warnings ?? [];
  }

  /** Prototype getter: never an own enumerable property, never serialized. */
  get apiKey(): string {
    return apiKeys.get(this) ?? "";
  }

  toJSON(): AiConfigJson {
    return {
      configured: true,
      model: this.model,
      baseUrl: this.baseUrl ?? null,
      toolChoice: this.toolChoice,
    };
  }

  [inspect.custom](): string {
    return `AiConfig { model: '${this.model}', baseUrl: ${
      this.baseUrl === undefined ? "default" : `'${this.baseUrl}'`
    }, toolChoice: '${this.toolChoice}', apiKey: [gizli] }`;
  }

  toString(): string {
    return this[inspect.custom]();
  }
}

type EnvLike = Record<string, string | undefined>;

function readTrimmed(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Read the cloud-AI configuration from the environment. Returns null when
 * ANTHROPIC_API_KEY is absent or blank — the lane is then OFF and every
 * POST /v1/ai/* answers 503 AI_NOT_CONFIGURED.
 */
export function resolveAiConfig(env: EnvLike = process.env): AiConfig | null {
  const apiKey = readTrimmed(env, AI_ENV.apiKey);
  if (apiKey === undefined) return null;

  const warnings: string[] = [];
  const model = readTrimmed(env, AI_ENV.model) ?? DEFAULT_AI_MODEL;

  let baseUrl: string | undefined;
  const rawBaseUrl = readTrimmed(env, AI_ENV.baseUrl);
  if (rawBaseUrl !== undefined) {
    if (/^https?:\/\//iu.test(rawBaseUrl)) {
      baseUrl = rawBaseUrl.replace(/\/+$/u, "");
    } else {
      warnings.push(
        `${AI_ENV.baseUrl} http(s) ile başlamıyor; yok sayıldı, varsayılan Anthropic adresi kullanılıyor.`,
      );
    }
  }

  let toolChoice: AnthropicToolChoiceMode = "forced";
  const rawToolChoice = readTrimmed(env, AI_ENV.toolChoice);
  if (rawToolChoice !== undefined) {
    if (rawToolChoice === "forced" || rawToolChoice === "auto") {
      toolChoice = rawToolChoice;
    } else {
      warnings.push(
        `${AI_ENV.toolChoice} 'forced' veya 'auto' olmalı; yok sayıldı ('forced' kullanılıyor).`,
      );
    }
  }

  return new AiConfig({
    apiKey,
    model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    toolChoice,
    warnings,
  });
}

/** Human label of the cloud ports (result.aiUsed.label, contract [R]). */
export function aiLabel(config: AiConfig): string {
  return `Anthropic ${config.model}`;
}

/** Build the adapter behind the ports (shared by createAiPorts and the router). */
export function createAiAdapter(
  config: AiConfig,
  fetchImpl?: typeof fetch,
  overrides: Partial<Omit<AnthropicAdapterOptions, "apiKey" | "fetchImpl">> = {},
): AnthropicAnswerAdapter {
  return new AnthropicAnswerAdapter({
    apiKey: config.apiKey,
    model: config.model,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    toolChoice: config.toolChoice,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...overrides,
  });
}

export interface AiPorts {
  drafter: DrafterPort;
  entailment: EntailmentPort;
  label: string;
  /** The adapter instance behind both ports (usage totals, tool methods). */
  adapter: AnthropicAnswerAdapter;
}

/**
 * Cloud ports for the answer pipeline's per-request `cloud` option
 * (contract [R]): the SAME adapter serves as drafter and entailment judge.
 */
export function createAiPorts(config: AiConfig, fetchImpl?: typeof fetch): AiPorts {
  const adapter = createAiAdapter(config, fetchImpl);
  return { drafter: adapter, entailment: adapter, label: aiLabel(config), adapter };
}

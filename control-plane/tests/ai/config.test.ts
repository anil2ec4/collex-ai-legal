/**
 * resolveAiConfig / AiConfig: default OFF, env names, and the guarantee that
 * the key is never serialized, inspected or enumerated.
 */

import { describe, expect, it } from "vitest";
import { inspect } from "node:util";

import {
  AI_ENV,
  AiConfig,
  DEFAULT_AI_MODEL,
  HIGHER_QUALITY_AI_MODEL,
  aiLabel,
  createAiPorts,
  resolveAiConfig,
} from "../../src/ai/config.js";
import { AnthropicAnswerAdapter } from "../../src/llm/anthropicAdapter.js";

const KEY = "sk-ant-TEST-anahtar-0123456789-asla-loglanmaz";

describe("resolveAiConfig", () => {
  it("is OFF (null) without ANTHROPIC_API_KEY, blank included", () => {
    expect(resolveAiConfig({})).toBeNull();
    expect(resolveAiConfig({ [AI_ENV.apiKey]: "" })).toBeNull();
    expect(resolveAiConfig({ [AI_ENV.apiKey]: "   " })).toBeNull();
    expect(resolveAiConfig({ [AI_ENV.model]: "claude-opus-5" })).toBeNull();
  });

  it("defaults to claude-sonnet-5 and documents claude-opus-5 as the upgrade", () => {
    const config = resolveAiConfig({ [AI_ENV.apiKey]: KEY });
    expect(config).not.toBeNull();
    expect(config!.model).toBe("claude-sonnet-5");
    expect(DEFAULT_AI_MODEL).toBe("claude-sonnet-5");
    expect(HIGHER_QUALITY_AI_MODEL).toBe("claude-opus-5");
    expect(config!.baseUrl).toBeUndefined();
    expect(config!.toolChoice).toBe("forced");
    expect(config!.warnings).toEqual([]);
  });

  it("honours model, base URL and tool-choice overrides; rejects bad ones with Turkish warnings", () => {
    const good = resolveAiConfig({
      [AI_ENV.apiKey]: ` ${KEY} `,
      [AI_ENV.model]: " claude-opus-5 ",
      [AI_ENV.baseUrl]: "https://proxy.example.test/anthropic/",
      [AI_ENV.toolChoice]: "auto",
    })!;
    expect(good.apiKey).toBe(KEY);
    expect(good.model).toBe("claude-opus-5");
    expect(good.baseUrl).toBe("https://proxy.example.test/anthropic");
    expect(good.toolChoice).toBe("auto");

    const bad = resolveAiConfig({
      [AI_ENV.apiKey]: KEY,
      [AI_ENV.baseUrl]: "ftp://nope",
      [AI_ENV.toolChoice]: "sometimes",
    })!;
    expect(bad.baseUrl).toBeUndefined();
    expect(bad.toolChoice).toBe("forced");
    expect(bad.warnings).toHaveLength(2);
    for (const warning of bad.warnings) expect(warning).toMatch(/yok sayıldı/);
  });

  it("never serializes, enumerates or inspects the key", () => {
    const config = resolveAiConfig({ [AI_ENV.apiKey]: KEY })!;
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(JSON.parse(JSON.stringify(config))).toEqual({
      configured: true,
      model: "claude-sonnet-5",
      baseUrl: null,
      toolChoice: "forced",
    });
    expect(Object.keys(config)).not.toContain("apiKey");
    expect(JSON.stringify(Object.entries(config))).not.toContain(KEY);
    expect(inspect(config)).not.toContain(KEY);
    expect(inspect(config)).toContain("[gizli]");
    expect(String(config)).not.toContain(KEY);
    expect(`${config}`).not.toContain(KEY);
    // The getter still works for the transport.
    expect(config.apiKey).toBe(KEY);
  });

  it("refuses an empty key at construction", () => {
    expect(() => new AiConfig({ apiKey: "" })).toThrow(RangeError);
  });
});

describe("createAiPorts", () => {
  it("returns one adapter serving as both drafter and entailment judge, with a label", () => {
    const config = resolveAiConfig({ [AI_ENV.apiKey]: KEY })!;
    const ports = createAiPorts(config, (async () => new Response("{}")) as typeof fetch);
    expect(ports.label).toBe("Anthropic claude-sonnet-5");
    expect(aiLabel(config)).toBe(ports.label);
    expect(ports.adapter).toBeInstanceOf(AnthropicAnswerAdapter);
    expect(ports.drafter).toBe(ports.adapter);
    expect(ports.entailment).toBe(ports.adapter);
    expect(ports.adapter.model).toBe("claude-sonnet-5");
    expect(JSON.stringify(ports)).not.toContain(KEY);
  });
});

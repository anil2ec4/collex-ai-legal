import { describe, expect, it } from "vitest";
import {
  assertCanonicalPageSize,
  assertValidPolicy,
  clampLegacyPageSize,
  DEFAULT_POLICIES,
  getPolicy,
  PolicyViolationError,
  type ProviderPolicy,
} from "../src/capabilities/policy.js";

describe("provider policies (brief 6.6)", () => {
  it("ships the two brief-default endpoint policies with the brief numbers", () => {
    const legislation = getPolicy("bedesten:legislation-search");
    expect(legislation).toMatchObject({
      timeoutMs: 15_000,
      maxAttempts: 2,
      maxConcurrent: 2,
      staleIfErrorSeconds: 3_600,
    });
    expect(legislation.breaker).toEqual({
      minimumSamples: 8,
      failureRatio: 0.5,
      openMs: 30_000,
    });

    const fetchPolicy = getPolicy("bedesten:decision-fetch");
    expect(fetchPolicy.timeoutMs).toBe(20_000);
    expect(fetchPolicy.staleIfErrorSeconds).toBeUndefined();
  });

  it("every shipped policy passes its own assertion helper", () => {
    for (const [key, policy] of Object.entries(DEFAULT_POLICIES)) {
      expect(() => assertValidPolicy(policy, key)).not.toThrow();
    }
  });

  it("getPolicy throws for unknown endpoint keys (no silent defaults)", () => {
    expect(() => getPolicy("unknown:endpoint")).toThrow(PolicyViolationError);
  });

  it("assertValidPolicy rejects inconsistent policies", () => {
    const base = getPolicy("bedesten:decision-fetch");
    const broken: ProviderPolicy = { ...base, timeoutMs: 0 };
    expect(() => assertValidPolicy(broken)).toThrow(PolicyViolationError);
    expect(() =>
      assertValidPolicy({ ...base, maxAttempts: 3 as unknown as 1 | 2 }),
    ).toThrow(PolicyViolationError);
    expect(() =>
      assertValidPolicy({ ...base, breaker: { ...base.breaker, failureRatio: 1.5 } }),
    ).toThrow(PolicyViolationError);
  });

  it("canonical page size: 1..20 accepted, everything else rejected", () => {
    expect(() => assertCanonicalPageSize(1)).not.toThrow();
    expect(() => assertCanonicalPageSize(20)).not.toThrow();
    expect(() => assertCanonicalPageSize(0)).toThrow(PolicyViolationError);
    expect(() => assertCanonicalPageSize(21)).toThrow(PolicyViolationError);
    expect(() => assertCanonicalPageSize(2.5)).toThrow(PolicyViolationError);
  });

  it("legacy page size clamps into 1..20 and records a warning", () => {
    const warnings: string[] = [];
    expect(clampLegacyPageSize(50, warnings)).toBe(20);
    expect(clampLegacyPageSize(0, warnings)).toBe(1);
    expect(clampLegacyPageSize(10, warnings)).toBe(10);
    expect(warnings).toHaveLength(2);
  });
});

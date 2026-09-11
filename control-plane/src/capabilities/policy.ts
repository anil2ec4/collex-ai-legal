/**
 * Provider execution policies (Master Build Brief section 6.6).
 *
 * Policies are keyed by upstream endpoint/failure domain — NOT by tool name —
 * so the circuit breaker and bulkhead react to the real upstream, and court
 * vs. legislation traffic cannot starve each other through a shared key.
 *
 * The numbers are the brief's starting defaults; tune against live baselines
 * and upstream terms of use.
 */

export interface ProviderPolicy {
  timeoutMs: number;
  /** Exactly one retry owner in the whole chain; nested retries are banned. */
  maxAttempts: 1 | 2;
  maxConcurrent: number;
  breaker: {
    minimumSamples: number;
    failureRatio: number;
    openMs: number;
  };
  /** When set, a stale cached result may be served on error as `partial` + freshness warning. */
  staleIfErrorSeconds?: number;
}

export const DEFAULT_POLICIES: Readonly<Record<string, ProviderPolicy>> = Object.freeze({
  "bedesten:legislation-search": Object.freeze({
    timeoutMs: 15_000,
    maxAttempts: 2,
    maxConcurrent: 2,
    breaker: Object.freeze({ minimumSamples: 8, failureRatio: 0.5, openMs: 30_000 }),
    staleIfErrorSeconds: 3_600,
  }),
  "bedesten:decision-fetch": Object.freeze({
    timeoutMs: 20_000,
    maxAttempts: 2,
    maxConcurrent: 2,
    breaker: Object.freeze({ minimumSamples: 8, failureRatio: 0.5, openMs: 30_000 }),
  }),
}) as Readonly<Record<string, ProviderPolicy>>;

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/** Assert a policy object is internally consistent; throws PolicyViolationError. */
export function assertValidPolicy(policy: ProviderPolicy, key = "policy"): void {
  const fail = (detail: string): never => {
    throw new PolicyViolationError(`${key}: ${detail}`);
  };
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) {
    fail(`timeoutMs must be > 0, got ${policy.timeoutMs}`);
  }
  if (policy.maxAttempts !== 1 && policy.maxAttempts !== 2) {
    fail(`maxAttempts must be 1 or 2, got ${String(policy.maxAttempts)}`);
  }
  if (!Number.isInteger(policy.maxConcurrent) || policy.maxConcurrent < 1) {
    fail(`maxConcurrent must be an integer >= 1, got ${policy.maxConcurrent}`);
  }
  const { minimumSamples, failureRatio, openMs } = policy.breaker;
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
    fail(`breaker.minimumSamples must be an integer >= 1, got ${minimumSamples}`);
  }
  if (!(failureRatio > 0 && failureRatio <= 1)) {
    fail(`breaker.failureRatio must be in (0, 1], got ${failureRatio}`);
  }
  if (!Number.isFinite(openMs) || openMs <= 0) {
    fail(`breaker.openMs must be > 0, got ${openMs}`);
  }
  if (policy.staleIfErrorSeconds !== undefined) {
    if (!Number.isFinite(policy.staleIfErrorSeconds) || policy.staleIfErrorSeconds <= 0) {
      fail(`staleIfErrorSeconds must be > 0 when set, got ${policy.staleIfErrorSeconds}`);
    }
  }
}

/** Look up a policy by endpoint key; throws for unknown keys (no silent defaults). */
export function getPolicy(key: string): ProviderPolicy {
  const policy = DEFAULT_POLICIES[key];
  if (!policy) {
    throw new PolicyViolationError(`no provider policy registered for endpoint key: ${key}`);
  }
  return policy;
}

export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 20;

/**
 * Canonical API contract: reject page sizes outside 1..20 (brief 6.6).
 */
export function assertCanonicalPageSize(pageSize: number): void {
  if (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
    throw new PolicyViolationError(
      `page_size must be an integer in ${MIN_PAGE_SIZE}..${MAX_PAGE_SIZE}, got ${pageSize}`,
    );
  }
}

/**
 * Legacy-tool behaviour: clamp into 1..20 and append a warning instead of
 * rejecting (brief 6.6: "Legacy tool gerekiyorsa 20'ye clamp edip warnings
 * içine yazsın").
 */
export function clampLegacyPageSize(pageSize: number, warnings: string[]): number {
  if (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE) {
    warnings.push(`page_size ${pageSize} clamped to ${MIN_PAGE_SIZE}`);
    return MIN_PAGE_SIZE;
  }
  if (pageSize > MAX_PAGE_SIZE) {
    warnings.push(`page_size ${pageSize} clamped to ${MAX_PAGE_SIZE}`);
    return MAX_PAGE_SIZE;
  }
  return pageSize;
}

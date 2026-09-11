/**
 * Security guard layer (Master Build Brief section 12.4).
 * See src/security/POLICY.md for the trust-boundary pipeline, what each
 * module enforces, delegated threats, and explicit non-goals.
 */

export {
  markUntrusted,
  scanForInjection,
  wrapEvidenceForModel,
  UNTRUSTED_BLOCK_CLOSE,
  UNTRUSTED_BLOCK_OPEN,
  UNTRUSTED_PREAMBLE,
} from "./untrusted.js";
export type {
  InjectionScanResult,
  InjectionSignal,
  UntrustedText,
} from "./untrusted.js";

/**
 * Both render-guard entry points. `sanitizeMarkdown` is for arbitrary
 * untrusted markdown (no angle bracket survives); `sanitizeAnswerMarkdown` is
 * the answer renderer's guard, identical except that ONE line-leading `"> "`
 * per line survives as a structural blockquote marker. A caller that reaches
 * for the barrel must be able to pick the right one.
 */
export { sanitizeAnswerMarkdown, sanitizeMarkdown } from "./renderGuard.js";

export {
  ALLOWED_SOURCE_HOSTS,
  KNOWN_SOURCE_FAMILIES,
  UrlPolicyError,
  assertSafeFetchUrl,
  checkFetchUrl,
  isAllowedSourceHost,
  resolveSourceUrl,
} from "./urlPolicy.js";
export type { UrlCheckResult, UrlRejectionReason } from "./urlPolicy.js";

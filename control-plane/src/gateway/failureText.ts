/**
 * Classify a provider's failure TEXT onto the typed FailureKind taxonomy.
 *
 * MEASURED DEFECT, 27.09.2026. `HttpMcpGateway` mapped EVERY MCP tool result
 * carrying `isError: true` to INVALID_REQUEST. With the network down the
 * lawyer read "Emsal (UYAP) kararları: arama isteği bu kaynak için geçersiz
 * (INVALID_REQUEST)" and "Belge isteği geçersiz (INVALID_REQUEST)" — so they
 * rephrased a correct query — while the real fact was "the source could not
 * be reached". A tool error is a SENTENCE; this module reads it.
 *
 * Order of evidence, strongest first:
 *
 *  1. The shared machine marker `"<KIND> retry_after=N.N: …"` that every
 *     Python lane now emits (`legal_contracts.failure_marker`,
 *     `bedesten_failure_fields`, the mevzuat tools' typed ToolError). The
 *     kind is taken verbatim and `retry_after` becomes `retryAfterMs`.
 *  2. A leading kind token (`UNAVAILABLE: …`).
 *  3. FastMCP's own ARGUMENT validation (`validation error for call[tool]`,
 *     "Missing required argument") and a tool's own input refusal — the only
 *     texts that may stay INVALID_REQUEST.
 *  4. Wording: timeout, rate limit, credential, network/TLS/5xx, not found,
 *     parse. A pydantic error on anything OTHER than `call[...]` is the
 *     upstream's response failing its model — PARSER_ERROR, not the caller's
 *     fault.
 *  5. Nothing recognised: UNAVAILABLE, NOT retryable — the same answer
 *     `legal_contracts.classify_exception` gives an unknown exception, so the
 *     two runtimes stay mirrored. An unknown tool failure is never presented
 *     as the lawyer's invalid request.
 *
 * The provider text itself is UNTRUSTED and is never echoed: callers keep
 * their own machine-only `safeMessage`.
 */

import type { FailureKind } from "../capabilities/types.js";

export const FAILURE_KIND_VALUES: readonly FailureKind[] = Object.freeze([
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "PARSER_ERROR",
  "NOT_FOUND",
]);

const KIND_ALTERNATION = FAILURE_KIND_VALUES.join("|");

/** `"UNAVAILABLE retry_after=30.0: …"` anywhere in the text. */
const TYPED_MARKER_RE = new RegExp(
  `\\b(${KIND_ALTERNATION}) retry_after=(\\d+(?:\\.\\d+)?)`,
  "u",
);

/** `"UNAVAILABLE: …"` / `"TIMEOUT - …"` at the start. */
const LEADING_KIND_RE = new RegExp(`^(${KIND_ALTERNATION})\\b`, "u");

/** FastMCP wraps a non-FastMCP exception as `Error calling tool 'x': <msg>`. */
const TOOL_ERROR_PREFIX_RE = /^Error calling tool '[^']*'\s*:?\s*/u;

const ARGUMENT_VALIDATION_RE =
  /validation errors? for call\[|missing required argument|unexpected keyword argument|unknown tool|extra inputs are not permitted|must be a non-empty|is required|cannot be empty|invalid (?:mevzuat_tur|decision type|argument|parameter)/iu;

const MODEL_VALIDATION_RE = /\bvalidation errors? for [A-Za-z_]/u;

const TIMEOUT_RE = /timed?\s*out|timeout|zaman aşımı/iu;
const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests/iu;
const AUTH_RE =
  /\b40[13]\b|unauthori[sz]ed|forbidden|api[_ ]?(?:key|token)|credential|module disabled/iu;
const NETWORK_RE =
  /\bssl\b|certificate|\btls\b|handshake|connect|network|unreachable|could not reach|refused|reset by peer|broken pipe|name or service not known|nodename nor servname|getaddrinfo|name resolution|\bdns\b|proxy|\b50[0-4]\b|server error|service unavailable|bad gateway|gateway time|unavailable|remote ?protocol|eof occurred|circuit|ulaşılamadı/iu;
const NOT_FOUND_RE = /\b404\b|not found|bulunamadı/iu;
const PARSE_RE = /\bpars(?:e|ing)\b|\bjson\b|decode|unexpected (?:format|shape|content)|expected a pdf/iu;

export interface ClassifiedFailureText {
  kind: FailureKind;
  retryable: boolean;
  /** From the marker's `retry_after`, when it carried a positive value. */
  retryAfterMs?: number;
  /** Which rule decided — for tests and the server log, never for a screen. */
  basis: "marker" | "leading-kind" | "argument-validation" | "wording" | "unknown";
  /**
   * Additive (W22 follow-up): the source ANSWERED, but its TLS certificate
   * did not verify. Still UNAVAILABLE (the closed FailureKind enum is not
   * widened); `detail` lets a surface say the more precise Turkish sentence
   * `FAILURE_DETAIL_TR.TLS_CERTIFICATE` instead of "ulaşılamadı".
   */
  detail?: "TLS_CERTIFICATE";
}

/**
 * The gateway's safe message for a certificate failure
 * (`legal_contracts.outcomes.TLS_CERTIFICATE_SAFE_MESSAGE`) and the driver
 * wording it replaces. The gateway turns certificate verification ON for
 * every host it used to reach with it off; this is how that failure reads.
 */
const TLS_CERTIFICATE_RE =
  /TLS certificate could not be verified|CERTIFICATE_VERIFY_FAILED|certificate verify failed/iu;

/** Turkish clause per `detail` — the machine code follows in parentheses. */
export const FAILURE_DETAIL_TR: Readonly<Record<NonNullable<ClassifiedFailureText["detail"]>, string>> =
  Object.freeze({
    TLS_CERTIFICATE: "kaynağın güvenlik sertifikası doğrulanamadı; bağlantı güvenli kurulamadığı için belge alınmadı",
  });

function withDetail(text: string, classified: ClassifiedFailureText): ClassifiedFailureText {
  return classified.kind === "UNAVAILABLE" && TLS_CERTIFICATE_RE.test(text)
    ? { ...classified, detail: "TLS_CERTIFICATE" }
    : classified;
}

function retryableKind(kind: FailureKind): boolean {
  return kind === "RATE_LIMITED" || kind === "TIMEOUT" || kind === "UNAVAILABLE";
}

/** Classify one provider failure text (see the module comment for the order). */
export function classifyFailureText(raw: string | undefined | null): ClassifiedFailureText {
  const text = String(raw ?? "").trim().replace(TOOL_ERROR_PREFIX_RE, "");
  return withDetail(text, classifyKind(text));
}

function classifyKind(text: string): ClassifiedFailureText {

  const marker = TYPED_MARKER_RE.exec(text);
  if (marker !== null) {
    const kind = marker[1] as FailureKind;
    const seconds = Number(marker[2]);
    const retryAfterMs =
      Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
    return {
      kind,
      // A marker with retry_after=0.0 is the unknown/non-retryable answer.
      retryable: retryableKind(kind) && (retryAfterMs !== undefined || kind !== "UNAVAILABLE"),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      basis: "marker",
    };
  }

  const leading = LEADING_KIND_RE.exec(text);
  if (leading !== null) {
    const kind = leading[1] as FailureKind;
    return { kind, retryable: retryableKind(kind), basis: "leading-kind" };
  }

  if (ARGUMENT_VALIDATION_RE.test(text)) {
    return { kind: "INVALID_REQUEST", retryable: false, basis: "argument-validation" };
  }
  if (MODEL_VALIDATION_RE.test(text)) {
    return { kind: "PARSER_ERROR", retryable: false, basis: "wording" };
  }
  if (TIMEOUT_RE.test(text)) return { kind: "TIMEOUT", retryable: true, basis: "wording" };
  if (RATE_LIMIT_RE.test(text)) {
    return { kind: "RATE_LIMITED", retryable: true, basis: "wording" };
  }
  if (AUTH_RE.test(text)) return { kind: "UNAUTHORIZED", retryable: false, basis: "wording" };
  if (NETWORK_RE.test(text)) return { kind: "UNAVAILABLE", retryable: true, basis: "wording" };
  if (NOT_FOUND_RE.test(text)) return { kind: "NOT_FOUND", retryable: false, basis: "wording" };
  if (PARSE_RE.test(text)) return { kind: "PARSER_ERROR", retryable: false, basis: "wording" };

  return { kind: "UNAVAILABLE", retryable: false, basis: "unknown" };
}

/**
 * The typed kind of a machine error CODE a provider payload carried
 * (`error_code: "UNAVAILABLE"`, `"UNEXPECTED_ERROR"`, `"INVALID_DECISION_TYPE"`),
 * optionally helped by the free text next to it. An exact FailureKind wins;
 * otherwise the text (code first, then prose) is classified.
 */
export function classifyFailureCode(
  code: string | undefined,
  ...texts: ReadonlyArray<string | undefined>
): ClassifiedFailureText {
  const upper = code?.trim().toUpperCase();
  if (upper !== undefined && (FAILURE_KIND_VALUES as readonly string[]).includes(upper)) {
    const kind = upper as FailureKind;
    return { kind, retryable: retryableKind(kind), basis: "leading-kind" };
  }
  // The prose is the stronger evidence when it carries a marker; the code
  // wording ("RATE", "TIMEOUT", "INVALID") decides otherwise.
  for (const text of texts) {
    if (text !== undefined && TYPED_MARKER_RE.test(text)) return classifyFailureText(text);
  }
  if (upper !== undefined && upper !== "") {
    if (upper.includes("RATE")) return { kind: "RATE_LIMITED", retryable: true, basis: "wording" };
    if (upper.includes("TIMEOUT")) return { kind: "TIMEOUT", retryable: true, basis: "wording" };
    if (upper.startsWith("INVALID")) {
      return { kind: "INVALID_REQUEST", retryable: false, basis: "wording" };
    }
  }
  for (const text of texts) {
    if (text === undefined || text.trim() === "") continue;
    const classified = classifyFailureText(text);
    if (classified.basis !== "unknown") return classified;
  }
  return { kind: "UNAVAILABLE", retryable: false, basis: "unknown" };
}

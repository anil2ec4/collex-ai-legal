/**
 * URL policy for outbound source fetches (Master Build Brief section 12.4,
 * threat rows "SSRF" and "Tool exfiltration").
 *
 * DESIGN CONTRACT — the fetch layer NEVER follows a model-provided raw URL.
 * The public API takes `(source, externalId)` pairs only; the only way a URL
 * comes into existence is `resolveSourceUrl`, which expands a server-side
 * template for a known provider family onto an allowlisted host. Any URL that
 * still has to be checked (e.g. a `sourceUrl` echoed back by an upstream
 * response) must pass `assertSafeFetchUrl` before a socket is opened.
 *
 * PURE STRING POLICY — this module performs no DNS resolution and no network
 * I/O. Consequently it cannot (and does not try to) detect that a DNS name
 * such as `127.0.0.1.nip.io` resolves to a loopback address. It does not need
 * to: any host that is not literally present in `ALLOWED_SOURCE_HOSTS` is
 * rejected, so DNS-rebinding / wildcard-DNS tricks never reach the network
 * layer. The explicit loopback / RFC1918 / metadata checks below are
 * defense-in-depth that produce more precise telemetry reasons, not the
 * primary control.
 */

export type UrlRejectionReason =
  | "UNPARSEABLE_URL"
  | "NON_HTTPS_SCHEME"
  | "HAS_USERINFO"
  | "NON_DEFAULT_PORT"
  | "NON_ASCII_OR_PUNYCODE_HOST"
  | "IP_LITERAL_HOST"
  | "LOOPBACK_OR_LOCAL_HOST"
  | "PRIVATE_OR_LINK_LOCAL_ADDRESS"
  | "METADATA_ENDPOINT"
  | "HOST_NOT_IN_ALLOWLIST"
  | "UNKNOWN_SOURCE_FAMILY"
  | "INVALID_EXTERNAL_ID";

/** Error thrown by the assert-style entry points of this module. */
export class UrlPolicyError extends Error {
  readonly reason: UrlRejectionReason;
  constructor(reason: UrlRejectionReason, detail: string) {
    super(`url policy violation (${reason}): ${detail}`);
    this.name = "UrlPolicyError";
    this.reason = reason;
  }
}

/**
 * Exact-match host allowlist for canonical Turkish legal sources. Enumerated
 * from the upstream clients in this repository (mcp_server_main.py and the
 * per-institution modules). Exact matching is deliberate: no suffix or
 * wildcard logic, so `evil-mevzuat.gov.tr.attacker.example` style hosts can
 * never qualify.
 */
export const ALLOWED_SOURCE_HOSTS: readonly string[] = Object.freeze(
  [
    // Legislation (mevzuat.gov.tr + Bedesten legislation mirror)
    "mevzuat.gov.tr",
    "www.mevzuat.gov.tr",
    "mevzuat.adalet.gov.tr",
    "bedesten.adalet.gov.tr",
    "adalet.gov.tr",
    "www.adalet.gov.tr",
    "www.resmigazete.gov.tr",
    "resmigazete.gov.tr",
    // High courts / case-law banks
    "karararama.yargitay.gov.tr",
    "karararama.danistay.gov.tr",
    "emsal.uyap.gov.tr",
    "kararlar.uyusmazlik.gov.tr",
    "anayasa.gov.tr",
    "www.anayasa.gov.tr",
    "normkararlarbilgibankasi.anayasa.gov.tr",
    "kararlarbilgibankasi.anayasa.gov.tr",
    // Regulators
    "www.kvkk.gov.tr",
    "kvkk.gov.tr",
    "www.rekabet.gov.tr",
    "rekabet.gov.tr",
    "www.sayistay.gov.tr",
    "sayistay.gov.tr",
    "www.bddk.org.tr",
    "bddk.org.tr",
    "www.btk.gov.tr",
    "btk.gov.tr",
    "gib.gov.tr",
    "www.gib.gov.tr",
    "ekap.kik.gov.tr",
    "ekapv2.kik.gov.tr",
    "kik.gov.tr",
    "www.kik.gov.tr",
    "www.sigortatahkim.org",
    "sigortatahkim.org",
  ].sort(),
);

const ALLOWED_HOST_SET: ReadonlySet<string> = new Set(ALLOWED_SOURCE_HOSTS);

/** Exact, case-insensitive allowlist membership. No suffix matching. */
export function isAllowedSourceHost(host: string): boolean {
  return ALLOWED_HOST_SET.has(host.toLowerCase());
}

const IPV4_DOTTED = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Dotted quad embedded anywhere in a DNS name (e.g. 127.0.0.1.nip.io). */
const EMBEDDED_IPV4 = /(?:^|\.)\d{1,3}(?:\.\d{1,3}){3}(?:$|\.)/;
const ASCII_DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** C0 controls, space, DEL — the WHATWG parser strips some of these silently. */
const CONTROL_OR_SPACE = new RegExp("[\u0000-\u0020\u007f]");
/** Anything outside printable ASCII `!`..`~`. */
const NON_PRINTABLE_ASCII = /[^!-~]/;

function classifyIpLiteral(hostname: string): UrlRejectionReason | undefined {
  // Bracketed IPv6 (WHATWG keeps the brackets in `hostname`).
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    // `::1` loopback and `::` unspecified (the IPv6 twin of 0.0.0.0, which many
    // stacks route to the local host). WHATWG already compresses both forms.
    if (inner === "::1" || inner === "0:0:0:0:0:0:0:1" || inner === "::") {
      return "LOOPBACK_OR_LOCAL_HOST";
    }
    if (inner.startsWith("fe80") || inner.startsWith("fc") || inner.startsWith("fd")) {
      return "PRIVATE_OR_LINK_LOCAL_ADDRESS";
    }
    return "IP_LITERAL_HOST";
  }
  if (IPV4_DOTTED.test(hostname)) {
    const octets = hostname.split(".").map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (hostname === "169.254.169.254") return "METADATA_ENDPOINT";
    if (a === 127) return "LOOPBACK_OR_LOCAL_HOST";
    if (a === 0) return "LOOPBACK_OR_LOCAL_HOST";
    if (a === 10) return "PRIVATE_OR_LINK_LOCAL_ADDRESS";
    if (a === 172 && b >= 16 && b <= 31) return "PRIVATE_OR_LINK_LOCAL_ADDRESS";
    if (a === 192 && b === 168) return "PRIVATE_OR_LINK_LOCAL_ADDRESS";
    if (a === 169 && b === 254) return "PRIVATE_OR_LINK_LOCAL_ADDRESS";
    if (a === 100 && b >= 64 && b <= 127) return "PRIVATE_OR_LINK_LOCAL_ADDRESS"; // CGNAT
    return "IP_LITERAL_HOST";
  }
  // Conservative: a dotted quad embedded in a DNS name (127.0.0.1.nip.io and
  // friends) is treated as an IP-literal trick. We never resolve DNS, so any
  // such host is rejected outright.
  if (EMBEDDED_IPV4.test(hostname)) {
    return "IP_LITERAL_HOST";
  }
  return undefined;
}

export type UrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason; detail: string };

/**
 * Validate a URL string against the fetch policy WITHOUT throwing.
 * Rejects: unparseable input, embedded control characters, non-https schemes,
 * userinfo (`user:pass@host` tricks), explicit non-default ports, IP-literal
 * hosts (v4, v6, embedded quads), loopback / RFC1918 / link-local /
 * cloud-metadata targets, non-ASCII or punycode hosts, and every host that is
 * not in `ALLOWED_SOURCE_HOSTS`.
 */
export function checkFetchUrl(raw: string): UrlCheckResult {
  // The WHATWG parser silently strips tab/CR/LF; reject them up front so the
  // checked string is exactly the fetched string.
  if (CONTROL_OR_SPACE.test(raw)) {
    return { ok: false, reason: "UNPARSEABLE_URL", detail: "control or space character in url" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "UNPARSEABLE_URL", detail: raw.slice(0, 128) };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "NON_HTTPS_SCHEME", detail: url.protocol };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "HAS_USERINFO", detail: "credentials embedded in url" };
  }
  // WHATWG normalizes an explicit `:443` on https to the empty string, so any
  // non-empty port here is a genuinely non-default port.
  if (url.port !== "") {
    return { ok: false, reason: "NON_DEFAULT_PORT", detail: url.port };
  }

  const hostname = url.hostname.toLowerCase();

  const ipReason = classifyIpLiteral(hostname);
  if (ipReason !== undefined) {
    return { ok: false, reason: ipReason, detail: hostname };
  }

  // Cloud instance-metadata names get their own reason so SSRF telemetry can
  // separate "someone probed IMDS" from "someone probed localhost".
  if (
    hostname === "metadata.google.internal" ||
    hostname === "metadata.goog" ||
    hostname === "metadata"
  ) {
    return { ok: false, reason: "METADATA_ENDPOINT", detail: hostname };
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    return { ok: false, reason: "LOOPBACK_OR_LOCAL_HOST", detail: hostname };
  }

  // Node's URL applies IDNA, so a Unicode host arrives here as punycode.
  const labels = hostname.split(".");
  // Empty labels (trailing dot FQDN form, `a..b`) are a host-shape problem, not
  // an encoding one — report them as a plain allowlist miss.
  if (labels.some((label) => label.length === 0)) {
    return { ok: false, reason: "HOST_NOT_IN_ALLOWLIST", detail: hostname };
  }
  if (
    NON_PRINTABLE_ASCII.test(hostname) ||
    labels.some((label) => label.startsWith("xn--") || !ASCII_DNS_LABEL.test(label))
  ) {
    return { ok: false, reason: "NON_ASCII_OR_PUNYCODE_HOST", detail: hostname };
  }

  if (!isAllowedSourceHost(hostname)) {
    return { ok: false, reason: "HOST_NOT_IN_ALLOWLIST", detail: hostname };
  }

  return { ok: true, url };
}

/** Throwing variant of `checkFetchUrl`; returns the parsed URL when safe. */
export function assertSafeFetchUrl(raw: string): URL {
  const result = checkFetchUrl(raw);
  if (!result.ok) {
    throw new UrlPolicyError(result.reason, result.detail);
  }
  return result.url;
}

/**
 * Per-provider canonical URL templates. Keys are the provider families the
 * control-plane knows (aligned with the capability registry sources). The
 * exact deep-link path per provider may be refined later, but every template
 * MUST stay on an `ALLOWED_SOURCE_HOSTS` host — `resolveSourceUrl` re-asserts
 * this through `assertSafeFetchUrl` before returning.
 */
const PROVIDER_URL_TEMPLATES: Readonly<Record<string, (encodedId: string) => string>> =
  Object.freeze({
    bedesten: (id: string) => `https://mevzuat.adalet.gov.tr/ictihat/${id}`,
    yargitay: (id: string) => `https://karararama.yargitay.gov.tr/getDokuman?id=${id}`,
    danistay: (id: string) => `https://karararama.danistay.gov.tr/getDokuman?id=${id}`,
    emsal: (id: string) => `https://emsal.uyap.gov.tr/getDokuman?id=${id}`,
    uyusmazlik: (id: string) => `https://kararlar.uyusmazlik.gov.tr/Home/GetDocument/${id}`,
    anayasa_norm: (id: string) => `https://normkararlarbilgibankasi.anayasa.gov.tr/ND/${id}`,
    anayasa_bireysel: (id: string) => `https://kararlarbilgibankasi.anayasa.gov.tr/BB/${id}`,
    mevzuat: (id: string) => `https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=${id}`,
    kvkk: (id: string) => `https://www.kvkk.gov.tr/Icerik/${id}`,
    rekabet: (id: string) => `https://www.rekabet.gov.tr/Karar?kararId=${id}`,
    sayistay: (id: string) => `https://www.sayistay.gov.tr/kararlar/${id}`,
    bddk: (id: string) => `https://www.bddk.org.tr/Mevzuat/DokumanGetir/${id}`,
    btk: (id: string) => `https://www.btk.gov.tr/kurul-kararlari/${id}`,
    gib: (id: string) => `https://gib.gov.tr/ozelge/${id}`,
    kik: (id: string) => `https://ekapv2.kik.gov.tr/kurul-kararlari/${id}`,
    sigorta_tahkim: (id: string) => `https://www.sigortatahkim.org/kararlar/${id}`,
  });

/** Provider families `resolveSourceUrl` accepts (sorted, frozen). */
export const KNOWN_SOURCE_FAMILIES: readonly string[] = Object.freeze(
  Object.keys(PROVIDER_URL_TEMPLATES).sort(),
);

/**
 * External IDs may contain letters, digits, `.`, `_`, `-` and internal `/`
 * segment separators (e.g. Anayasa "ND 2023/107"-style ids). Path traversal
 * segments and every other character are rejected.
 */
const EXTERNAL_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXTERNAL_ID_MAX_LENGTH = 512;

function encodeExternalId(externalId: string): string {
  if (externalId.length === 0 || externalId.length > EXTERNAL_ID_MAX_LENGTH) {
    throw new UrlPolicyError("INVALID_EXTERNAL_ID", "empty or oversized external id");
  }
  const segments = externalId.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || !EXTERNAL_ID_SEGMENT.test(segment)) {
      throw new UrlPolicyError("INVALID_EXTERNAL_ID", externalId.slice(0, 128));
    }
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * The ONLY constructor of outbound source URLs. Callers pass a provider
 * family plus the provider's own document id; the canonical https URL comes
 * from the server-side template table above. A raw URL supplied by a model,
 * a document body, or an upstream response is never fetched directly.
 */
export function resolveSourceUrl(source: string, externalId: string): string {
  const family = source.trim().toLowerCase();
  const template = PROVIDER_URL_TEMPLATES[family];
  if (template === undefined) {
    throw new UrlPolicyError("UNKNOWN_SOURCE_FAMILY", family.slice(0, 64));
  }
  const url = template(encodeExternalId(externalId));
  // Defense-in-depth: even our own templates must satisfy the fetch policy.
  assertSafeFetchUrl(url);
  return url;
}

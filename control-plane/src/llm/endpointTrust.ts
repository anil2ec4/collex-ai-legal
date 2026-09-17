/**
 * Where an inference endpoint lives, and what a Matter is allowed to reach.
 *
 * The problem
 * -----------
 * Privileged legal text is about to be sent to a model. Before this module
 * the only notion of "local" in the AI lane was a hardcoded `127.0.0.1` in
 * the embedding config, and the Anthropic adapter's base URL was never
 * classified at all. There was no way to say "this Matter never leaves the
 * machine" and have the system ENFORCE it rather than merely default to it.
 *
 * Three trust levels, because two are not enough
 * ----------------------------------------------
 * `LOCAL_PROCESS`          — loopback. The bytes never touch a network
 *                            interface. This is the safe default.
 * `TRUSTED_LOCAL_NETWORK`  — a private-range host on the user's own LAN (the
 *                            intended shape: a small inference appliance such
 *                            as a Mac mini next to the workstation). Reaching
 *                            it puts privileged text on a wire, so it must be
 *                            named EXPLICITLY in an allow-list. It is never
 *                            inferred from the address alone.
 * `CLOUD`                  — anything else. Someone else's computer.
 *
 * Why the allow-list is mandatory for LAN
 * ---------------------------------------
 * "Private address ⇒ trusted" is how a configuration field becomes a
 * server-side request forgery primitive: whoever can influence a setting
 * points it at `10.0.0.5/…` and the product cheerfully posts the client file
 * there. So a private address is REFUSED unless its host:port was
 * independently listed by the operator. Loopback needs no list — it cannot
 * leave the machine.
 *
 * This module is deliberately separate from `security/urlPolicy.ts`. That one
 * guards OUTBOUND FETCHES OF SOURCE DOCUMENTS, where loopback is an attack
 * (a request forged into the host) and is rejected. Here loopback is the
 * SAFEST case. The two policies are opposites and must not share a function.
 */

/** Where an endpoint physically is, from this machine's point of view. */
export type EndpointTrust = "LOCAL_PROCESS" | "TRUSTED_LOCAL_NETWORK" | "CLOUD";

/**
 * How far privileged text may travel.
 *
 * `LOCAL_ONLY` permits LOCAL_PROCESS and TRUSTED_LOCAL_NETWORK and forbids
 * CLOUD — with NO silent fallback. A local model being unavailable is a
 * failure the caller is told about, never a reason to send the file to a
 * cloud provider instead.
 */
export type DataBoundary = "LOCAL_ONLY" | "ALLOW_CLOUD";

export type EndpointRejection =
  | "UNPARSEABLE"
  | "UNSUPPORTED_SCHEME"
  | "METADATA_ENDPOINT"
  | "PRIVATE_HOST_NOT_TRUSTED"
  | "BOUNDARY_FORBIDS_CLOUD";

export interface EndpointClassification {
  readonly ok: true;
  readonly trust: EndpointTrust;
  /** Normalized `host:port` — the form an allow-list entry must match. */
  readonly authority: string;
  readonly host: string;
  readonly port: string;
}

export interface EndpointRefusal {
  readonly ok: false;
  readonly reason: EndpointRejection;
  /** Turkish, safe to show: never contains a credential or a full URL. */
  readonly message: string;
  readonly detail?: string;
}

export type EndpointDecision = EndpointClassification | EndpointRefusal;

const IPV4_DOTTED = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;
const IPV4_MAPPED_DOTTED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u;
/**
 * WHATWG `URL` canonicalizes `::ffff:127.0.0.1` to the HEX form
 * `::ffff:7f00:1`, so matching only the dotted spelling would classify a
 * mapped loopback address as public. Both spellings are handled.
 */
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u;

/**
 * Hostnames that mean "this machine" without asking a DNS server: only
 * `localhost` (reserved by RFC 6761 and answered by the OS resolver from its
 * own table). W21: `localhost.localdomain` is NOT here any more. It is not a
 * reserved name, has no built-in loopback mapping on the target systems and
 * goes to the network resolver, so trusting it as LOCAL_PROCESS let whatever
 * DNS answered decide where a privileged prompt went. It is now a DNS name
 * like any other (CLOUD); use `localhost` or a loopback IP instead.
 */
const LOOPBACK_NAMES = new Set(["localhost"]);

type Placement = "loopback" | "private" | "metadata" | "public";

function placeIpv6(inner: string): Placement {
  const value = inner.toLowerCase();
  if (value === "::1" || value === "0:0:0:0:0:0:0:1" || value === "::") return "loopback";
  if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) {
    return "private";
  }
  // An IPv4-mapped IPv6 address must not smuggle an address past the v4
  // branch in either direction — classify by the address it embeds.
  const dotted = value.match(IPV4_MAPPED_DOTTED);
  if (dotted !== null) return placeHost(dotted[1] as string);
  const hex = value.match(IPV4_MAPPED_HEX);
  if (hex !== null) {
    const high = Number.parseInt(hex[1] as string, 16);
    const low = Number.parseInt(hex[2] as string, 16);
    if (Number.isInteger(high) && Number.isInteger(low)) {
      const embedded =
        `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
      return placeHost(embedded);
    }
  }
  return "public";
}

function placeHost(hostname: string): Placement {
  const lower = hostname.toLowerCase();
  if (LOOPBACK_NAMES.has(lower)) return "loopback";
  if (lower.startsWith("[") && lower.endsWith("]")) return placeIpv6(lower.slice(1, -1));

  if (lower.match(IPV4_DOTTED) !== null) {
    const octets = lower.split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "public";
    const [a, b] = octets as [number, number, number, number];
    // Cloud instance metadata is never an inference endpoint; it is a
    // credential oracle. Refused by name before any range test.
    if (lower === "169.254.169.254") return "metadata";
    // W21 R2-31: loopback is 127/8 and the exact "this host" address
    // 0.0.0.0. The rest of 0.0.0.0/8 is "this network" (RFC 1122 / RFC
    // 6890), not loopback; Linux 5.3+ routes it as ordinary unicast, so a
    // prompt sent to 0.1.2.3 can leave through the default gateway. It is
    // placed "public" (LOCAL_ONLY refuses it), never LOCAL_PROCESS. The
    // IPv4-mapped IPv6 branch reuses this test, so [::ffff:0.8.8.8] follows.
    if (a === 127 || lower === "0.0.0.0") return "loopback";
    if (a === 10) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 169 && b === 254) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
    return "public";
  }
  if (lower === "metadata.google.internal" || lower === "metadata.goog" || lower === "metadata") {
    return "metadata";
  }
  // A DNS NAME is never treated as local, even if it resolves to a private
  // address today: we do not resolve DNS, and a name whose address record can
  // change is not a trust boundary.
  return "public";
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

export interface ClassifyEndpointOptions {
  /**
   * `host:port` authorities the operator has explicitly declared trusted on
   * the local network. Only these may reach TRUSTED_LOCAL_NETWORK; a private
   * address that is not listed is refused.
   */
  readonly trustedLocalHosts?: readonly string[];
}

/**
 * Classify an inference endpoint URL.
 *
 * Never throws on bad input: a caller configuring a broken URL gets a typed
 * refusal it can put on screen, not an exception in the middle of a run.
 */
export function classifyEndpoint(
  rawUrl: string,
  options: ClassifyEndpointOptions = {},
): EndpointDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: "UNPARSEABLE",
      message: "Model adresi okunamadı; adresi kontrol edin.",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: "UNSUPPORTED_SCHEME",
      message: "Model adresi yalnız http veya https olabilir.",
      detail: url.protocol,
    };
  }

  const host = url.hostname;
  const port = url.port === "" ? defaultPort(url.protocol) : url.port;
  const authority = `${host.toLowerCase()}:${port}`;
  const placement = placeHost(host);

  if (placement === "metadata") {
    return {
      ok: false,
      reason: "METADATA_ENDPOINT",
      message: "Bu adres bir model sunucusu değil; kullanılamaz.",
      detail: host,
    };
  }
  if (placement === "loopback") {
    return { ok: true, trust: "LOCAL_PROCESS", authority, host, port };
  }
  if (placement === "private") {
    const allowed = new Set(
      (options.trustedLocalHosts ?? []).map((entry) => entry.trim().toLowerCase()),
    );
    if (!allowed.has(authority)) {
      return {
        ok: false,
        reason: "PRIVATE_HOST_NOT_TRUSTED",
        message:
          "Bu adres kendi ağınızda görünüyor ama güvenilir olarak" +
          " tanımlanmamış. Kullanmak için adresi ayarlarda açıkça ekleyin.",
        detail: authority,
      };
    }
    return { ok: true, trust: "TRUSTED_LOCAL_NETWORK", authority, host, port };
  }
  return { ok: true, trust: "CLOUD", authority, host, port };
}

/**
 * Does `boundary` permit sending privileged text to an endpoint of `trust`?
 *
 * The whole point of LOCAL_ONLY: this returns a refusal for CLOUD and the
 * caller must NOT fall back. "The local model was busy" is not a licence to
 * send the client file to someone else's computer.
 */
export function boundaryAllows(
  boundary: DataBoundary,
  trust: EndpointTrust,
): EndpointRefusal | undefined {
  if (boundary === "ALLOW_CLOUD") return undefined;
  if (trust === "CLOUD") {
    return {
      ok: false,
      reason: "BOUNDARY_FORBIDS_CLOUD",
      message:
        "Bu dosya yalnız bu bilgisayarda işlenecek biçimde ayarlanmış," +
        " bu yüzden dışarıdaki bir yapay zekâ servisine gönderilmedi.",
    };
  }
  return undefined;
}

/** Lawyer-facing name of a trust level (no engineering vocabulary). */
export function trustLabelTr(trust: EndpointTrust): string {
  switch (trust) {
    case "LOCAL_PROCESS":
      return "bu bilgisayarda";
    case "TRUSTED_LOCAL_NETWORK":
      return "kendi ağınızdaki bilgisayarda";
    default:
      return "dışarıdaki bir serviste";
  }
}

/**
 * Loopback guard for the control-plane HTTP API (W14 B-04; ENGRISK E4/E5/E14).
 *
 * ColleX has no authentication: it binds 127.0.0.1 and trusts whoever can
 * reach the socket. On a single-user laptop that is the right trade — but the
 * BROWSER can reach the socket too, on behalf of any page the lawyer happens
 * to have open. ENGRISK measured, with real requests against a running
 * instance, that this was exploitable today:
 *
 *   - `POST /v1/matters` with `Origin: https://evil.example` and
 *     `content-type: text/plain` answered **201** and really created the
 *     record. `text/plain` and `multipart/form-data` are CORS-safelisted
 *     request types, so the browser sends them WITHOUT a preflight: a foreign
 *     page can write to the lawyer's workspace with a plain `fetch`.
 *   - `POST /v1/files` (multipart) answered **200**: a foreign page could
 *     push a document into the lawyer's corpus.
 *   - `Host: evil.example` answered **200**: with DNS rebinding a foreign
 *     origin becomes same-origin for the browser, and then it can READ —
 *     `/v1/answers?texts=true` and `/v1/settings` are client data.
 *
 * Aggravating factor: `/v1/ai/*` was reachable the same way, and ADR-018's
 * "per-request consent" is a `useCloudAi: true` field IN THE BODY — an
 * attacker writes it themselves. So a foreign page could ship a client
 * document to a cloud model and spend the lawyer's money.
 *
 * Three defences, in one middleware, installed as the FIRST `app.use("*")`:
 *
 *  1. **Host allow-list** (DNS-rebinding): the `Host` header must name a
 *     loopback name. Anything else answers `421 Misdirected Request` — the
 *     status that says "this server does not serve that name", which is
 *     exactly true. This is the READ defence and matters most.
 *  2. **Origin / Sec-Fetch-Site check on state-changing methods**: a foreign
 *     `Origin`, or a `Sec-Fetch-Site` that is neither `same-origin` nor
 *     `none`, answers a typed `403 FORBIDDEN_ORIGIN` in Turkish BEFORE any
 *     route runs (so no pipeline, no intake process, no model call). A local
 *     script (curl, the CLI probes, `demo.mjs`) sends no `Origin` and no
 *     `Sec-Fetch-Site` and is unaffected; the console is same-origin and is
 *     unaffected.
 *  3. **Security headers on `/v1/*`**: `cache-control: no-store` (the
 *     evidence bundle returns the full text of client documents and must not
 *     land in the browser's disk cache), `x-content-type-options: nosniff`,
 *     `referrer-policy: no-referrer`.
 *
 * What this is NOT: authentication. It does not stop a local process, and it
 * is not meant to. It stops the browser from being used as a confused deputy.
 *
 * The console's hash-pinned CSP is untouched by this module.
 */

import type { MiddlewareHandler } from "hono";

/** Host names that mean "this machine". IPv6 brackets are stripped first. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

/** Methods that cannot change state and therefore skip the Origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const FOREIGN_HOST_MESSAGE_TR =
  "ColleX yalnız bu bilgisayarda (127.0.0.1) çalışır; bu adres üzerinden erişilemez.";

export const FORBIDDEN_ORIGIN_MESSAGE_TR =
  "Bu istek başka bir web sayfasından geldi ve reddedildi. ColleX'i yalnız kendi " +
  "penceresinden kullanın.";

/** Headers added to every `/v1/*` response. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});

/**
 * Strip the port and IPv6 brackets from a Host/Origin authority.
 * `[::1]:8787` -> `::1`, `127.0.0.1:8787` -> `127.0.0.1`.
 */
export function hostnameOf(authority: string | undefined): string {
  if (authority === undefined) return "";
  let value = authority.trim().toLowerCase();
  // Strip a scheme if this came from an Origin header.
  const schemeAt = value.indexOf("://");
  if (schemeAt !== -1) value = value.slice(schemeAt + 3);
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close === -1 ? value.slice(1) : value.slice(1, close);
  }
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

/** True when `host` is a loopback name this server may answer for. */
export function isLocalHostHeader(host: string | undefined): boolean {
  // A missing Host header is an HTTP/1.0-style request; hono/undici always
  // supplies one for HTTP/1.1, and `app.request("/path")` in tests supplies
  // "localhost". Treat an absent header as local: it cannot have come from a
  // browser, which always sends Host.
  if (host === undefined || host === "") return true;
  return LOCAL_HOSTS.has(hostnameOf(host));
}

/**
 * True when `origin` names the same host this request was addressed to.
 * Both are reduced to hostnames: the console may be opened as
 * `http://localhost:8787` while `Host` says `127.0.0.1:8787` only if the user
 * typed it that way, and in that case the browser's Origin matches its own
 * Host — so comparing hostnames is right AND both must be loopback anyway
 * (the Host check above already ran).
 */
export function isOwnOrigin(origin: string, host: string | undefined): boolean {
  if (origin === "null") return false; // sandboxed iframe / data: document
  const originHost = hostnameOf(origin);
  if (originHost === "") return false;
  if (!LOCAL_HOSTS.has(originHost)) return false;
  const hostName = hostnameOf(host);
  return hostName === "" || originHost === hostName || LOCAL_HOSTS.has(hostName);
}

export interface LocalGuardOptions {
  /**
   * Called instead of the built-in JSON body when a request is refused; the
   * tests use it to assert the guard ran before any route. Optional.
   */
  onRefused?: (reason: "host" | "origin", path: string) => void;
}

/**
 * The middleware. Install as the first `app.use("*", …)` in `createApp`.
 */
export function localGuard(options: LocalGuardOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    if (!isLocalHostHeader(host)) {
      options.onRefused?.("host", c.req.path);
      return c.json({ error: { kind: "FOREIGN_HOST", message: FOREIGN_HOST_MESSAGE_TR } }, 421);
    }

    if (!SAFE_METHODS.has(c.req.method.toUpperCase())) {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      const foreignOrigin = origin !== undefined && origin !== "" && !isOwnOrigin(origin, host);
      const foreignSite = site !== undefined && site !== "same-origin" && site !== "none";
      if (foreignOrigin || foreignSite) {
        options.onRefused?.("origin", c.req.path);
        return c.json(
          { error: { kind: "FORBIDDEN_ORIGIN", message: FORBIDDEN_ORIGIN_MESSAGE_TR } },
          403,
        );
      }
    }

    await next();

    if (c.req.path.startsWith("/v1/")) {
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
        c.header(name, value);
      }
    }
  };
}

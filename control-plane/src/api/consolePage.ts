/**
 * Static operator-console page loader + its Content-Security-Policy.
 *
 * The page is one self-contained HTML file (`control-plane/public/console.html`)
 * with inline CSS and inline JS: no build step, no bundler, no CDN. That is a
 * deliberate constraint — an operator console that pulls script from a third
 * party is an evidence system with an unaudited code path in it.
 *
 * Inline code plus a strict CSP normally conflict, so the policy is derived
 * FROM THE FILE: every `<style>` and `<script>` block is hashed with SHA-256 at
 * load time and pinned in the policy. Editing the page changes the hash
 * automatically; injecting a script into the page (or into a response that
 * renders it) does not match any pinned hash and will not execute. Everything
 * else is denied outright — `default-src 'none'` — with two exceptions:
 * `connect-src 'self'` so the page can call `/v1/answer` on its own origin,
 * and `img-src 'none'` because the console shows no images at all (the
 * "remote image off" row of the brief's exfiltration threat table).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Candidate locations, first hit wins: src/api/… and dist/api/… both resolve. */
const CANDIDATES = ["../../public/console.html"] as const;

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

export interface ConsolePage {
  html: string;
  /** Content-Security-Policy header value, with inline blocks pinned by hash. */
  csp: string;
  /** SHA-256 of the whole file — a build fingerprint the tests can assert on. */
  sha256: string;
}

export class ConsolePageMissingError extends Error {
  constructor(searched: readonly string[]) {
    super(`operator console page not found; searched: ${searched.join(", ")}`);
    this.name = "ConsolePageMissingError";
  }
}

function sha256Base64(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function hashesOf(html: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const body = match[1] ?? "";
    out.push(`'sha256-${sha256Base64(body)}'`);
  }
  return out;
}

/** Build the CSP for a given page body. Pure — exported for the tests. */
export function buildConsoleCsp(html: string): string {
  const scripts = hashesOf(html, SCRIPT_BLOCK);
  const styles = hashesOf(html, STYLE_BLOCK);
  return [
    "default-src 'none'",
    `script-src ${scripts.length > 0 ? scripts.join(" ") : "'none'"}`,
    `style-src ${styles.length > 0 ? styles.join(" ") : "'none'"}`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

let cached: ConsolePage | undefined;

/**
 * Load (and memoize) the console page. Throws `ConsolePageMissingError` when
 * the file is absent so the route can answer a typed 503 rather than serving
 * an empty body that looks like a broken console.
 */
export function loadConsolePage(options: { reload?: boolean } = {}): ConsolePage {
  if (cached !== undefined && options.reload !== true) return cached;
  const searched: string[] = [];
  for (const candidate of CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    searched.push(path);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    const page: ConsolePage = {
      html,
      csp: buildConsoleCsp(html),
      sha256: createHash("sha256").update(html, "utf8").digest("hex"),
    };
    cached = page;
    return page;
  }
  throw new ConsolePageMissingError(searched);
}

/** Security headers served with the console page (CSP is added by the route). */
export const CONSOLE_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
});

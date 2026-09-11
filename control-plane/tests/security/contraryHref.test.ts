/**
 * W17 — the aleyhe-kaynak link is provider text, and it reaches an anchor.
 *
 * Until this wave every contrary hit came back with an empty `href`, so
 * `petitionLaneRow`'s `a.href = h.href` in `public/console.html` was dormant.
 * Making the link real (the report tells the lawyer to open the full text and
 * check the quote, and there was nothing to open) turns an UNTRUSTED provider
 * string into a clickable anchor, so the server now runs every one of them
 * through the same allowlist the fetch layer uses.
 *
 * These tests pin the policy end of that bond. The wiring end — that
 * `createApp`'s contrary port calls `checkFetchUrl` before setting `href` —
 * is pinned by the source assertion at the bottom, because the port itself
 * only exists when a real MCP gateway is configured.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkFetchUrl } from "../../src/security/urlPolicy.js";

const SERVER_TS = fileURLToPath(new URL("../../src/api/server.ts", import.meta.url));
const CONSOLE_HTML = fileURLToPath(new URL("../../public/console.html", import.meta.url));

describe("W17 · a contrary hit's link passes the source allowlist", () => {
  it("accepts the URL the real provider actually served", () => {
    // MEASURED, 06.09.2026 — the live probe returned these.
    for (const url of [
      "https://mevzuat.adalet.gov.tr/ictihat/1223426300",
      "https://mevzuat.adalet.gov.tr/ictihat/71370900",
    ]) {
      const checked = checkFetchUrl(url);
      expect(checked.ok).toBe(true);
    }
  });

  it("refuses every shape that would make the anchor dangerous", () => {
    const refused = [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://mevzuat.adalet.gov.tr/ictihat/1",
      "https://evil.example/ictihat/1",
      "https://mevzuat.adalet.gov.tr.attacker.example/ictihat/1",
      "https://user:pass@mevzuat.adalet.gov.tr/ictihat/1",
      "https://127.0.0.1/ictihat/1",
      "https://mevzuat.adalet.gov.tr:8443/ictihat/1",
    ];
    for (const url of refused) {
      const checked = checkFetchUrl(url);
      expect(checked.ok, `expected ${url} to be refused`).toBe(false);
    }
  });
});

describe("W17 · the wiring that makes that check load-bearing", () => {
  const server = readFileSync(SERVER_TS, "utf8");

  it("the contrary port checks the URL before it becomes an href", () => {
    const port = server.slice(server.indexOf("contrarySearch: async (lane, asOf)"));
    const body = port.slice(0, port.indexOf("\n          }\n"));
    expect(body).toContain("checkFetchUrl(row.sourceUrl)");
    // NON-VACUITY: the raw provider field must not reach `href` directly.
    expect(body).not.toMatch(/href:\s*row\.sourceUrl/u);
  });

  it("the screen still assigns the href it is given, so the server is the gate", () => {
    // If this ever stops being true the check above stops mattering; the test
    // exists so the two halves cannot drift apart silently.
    const page = readFileSync(CONSOLE_HTML, "utf8");
    expect(page).toContain("a.href = h.href;");
  });
});

describe("W17 · the link opens in a new tab and leaks nothing", () => {
  const page = readFileSync(CONSOLE_HTML, "utf8");
  const lane = page.slice(page.indexOf("function petitionLaneRow"));
  const body = lane.slice(0, lane.indexOf("\n  }\n"));

  it("sets target and rel on the full-text link", () => {
    // MEASURED in the browser, 06.09.2026: the report takes ~33 s, is not
    // persisted anywhere on the page, and the link had no target — one click
    // on "Tam metne git" navigated the console away and the whole analysis
    // was gone.
    expect(body).toContain('a.target = "_blank"');
    expect(body).toContain('a.rel = "noreferrer noopener"');
  });

  it("says so in the link's own words", () => {
    expect(body).toContain("Tam metne git (yeni sekmede)");
  });
});

describe("W17 · the search subject is stated once, not twice", () => {
  it("suppresses the standalone concept line when the note already names it", () => {
    // MEASURED in the browser, 06.09.2026: a borrowed-term claim printed
    // "Sorgular şu kavram üzerine kuruldu: eser sözleşmesi" and then, directly
    // underneath, "Sorgular, dilekçenin tamamından çıkan «eser sözleşmesi»
    // kavramı üzerine kuruldu: …". B-27: a repeated warning is an unread one.
    const page = readFileSync(CONSOLE_HTML, "utf8");
    expect(page).toContain("if (contrary.baseTerm && !contrary.note) {");
    // NON-VACUITY: the line is still drawn when there is no note.
    expect(page).toContain("Sorgular şu kavram üzerine kuruldu: ");
  });
});

describe("W17/b · the empty-citation line matches the claim's kind", () => {
  const page = readFileSync(CONSOLE_HTML, "utf8");

  it("does not call a talep or a list a vakıa", () => {
    // MEASURED in the browser, 06.09.2026 (icra itirazı): the SONUÇ VE İSTEM
    // card read "Bu iddiada tanınan biçimde atıf yok. Vakıa cümlelerinin atfı
    // olmaması olağandır." — a fixed sentence about a kind the block is not.
    expect(page).toContain('c.claim && c.claim.kind === "TALEP"');
    expect(page).toContain('c.claim && c.claim.kind === "DIGER"');
  });

  it("never calls a missing citation on a legal claim ordinary", () => {
    // A HUKUKI_SEBEP block with no citation is exactly what a lawyer must
    // look at; the vakıa sentence would excuse it.
    expect(page).toContain('c.claim && c.claim.kind === "HUKUKI_SEBEP"');
    expect(page).toContain("dayanağını elden kontrol edin");
  });
});

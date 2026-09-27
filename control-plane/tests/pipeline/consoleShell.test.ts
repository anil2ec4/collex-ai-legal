import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * W23 (27.09.2026) — the console's application shell.
 *
 * On a wide screen (>= 1100 px) the masthead becomes a left sidebar: brand,
 * quick search, active matter, the five views, help/theme and the status
 * badges. The markup did not move — the same elements are placed with
 * `display: contents` and grid rows — so the narrow layouts and the keyboard
 * order are unchanged. Measured in Chromium at 1440/1280/1100/1099/1024/820/
 * 390/360 px, light and dark: 0 horizontal overflow on all 16 views.
 */
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

describe("W23 application shell", () => {
  it("marks the body as the shell and gives each of the five views an icon", () => {
    expect(html).toContain('<body class="shell">');
    expect((html.match(/<svg class="tabico" viewBox="0 0 24 24" aria-hidden="true">/gu) ?? []).length).toBe(5);
    for (const view of ["dosyalarim", "arastir", "belgeler", "taslak", "ayarlar"]) {
      expect(html).toMatch(new RegExp(`aria-controls="view-${view}"><svg class="tabico"`, "u"));
    }
  });

  it("draws the sidebar only on wide screens and keeps it out of print", () => {
    const wide = style.indexOf("@media screen and (min-width: 1100px) {");
    expect(wide).toBeGreaterThan(-1);
    const block = style.slice(wide, style.indexOf("\n}\n", wide));
    expect(block).toContain("position: fixed; top: 0; bottom: 0; left: 0;");
    expect(block).toContain("body.shell .masthead > .topbar, body.shell .topbar .tools { display: contents; }");
    // The draft editor needs three columns: the sidebar shrinks to an icon rail.
    expect(block).toContain("body.shell.editing { --side: 68px; }");
    expect(style).toContain("@media print {\n  body.shell .masthead { position: static;");
    // Icons are hidden until the sidebar shows them (narrow tabs stay text-only).
    expect(style).toMatch(/\.tabico \{[^}]*display: none; \}/u);
  });

  it("controls use one 8 px corner token; only status badges stay pill-shaped", () => {
    expect(style).toContain("--r-ctl: 8px;");
    expect(style).toContain("button.ghost, .themebtn, .helpbtn, select.matterpick, label.rchip span { border-radius: var(--r-ctl); }");
  });

  it("aligns every input of a template-form row on one line (the 22 px offset)", () => {
    expect(style).toContain(
      "#tplfields .formgrid > .tfield:not(.span2) {\n  display: grid; grid-row: span 4; grid-template-rows: subgrid;",
    );
    expect(style).toContain("#tplfields .formgrid > .tfield:not(.span2) > .tin { grid-row: 2; align-self: start; }");
  });

  it("no visible sentence points the lawyer to a 'top bar' the wide layout no longer has", () => {
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    const markup = html.slice(html.indexOf("<body"), html.indexOf("<script>")).replace(/<!--[\s\S]*?-->/gu, "");
    const strings = script.match(/"(?:[^"\\\n]|\\.)*"/gu) ?? [];
    for (const text of [...strings, markup]) {
      expect(text).not.toMatch(/[Üü]st çubu/u);
    }
  });
});

describe("W23 faiz hesabı screen", () => {
  it("is a hidden, argument-less view with a work card, reached from Araştır", () => {
    expect(html).toContain('<section id="view-faiz" hidden aria-label="Faiz hesabı görünümü">');
    expect(html).toContain('harc: "arastir", faiz: "arastir",');
    expect(html).toContain('dilekce: true, harc: true, faiz: true,');
    expect(html).toContain('if (name === "faiz") { openFaiz(); }');
    expect(html).toContain('id: "faiz", fam: "hesap", title: "Faiz hesapla",');
  });

  it("draws an unknown rate as the lawyer's to enter, never as 0, and prints the disclaimer once", () => {
    const start = html.indexOf("  function renderFaizResult(out, body) {");
    const fn = html.slice(start, html.indexOf("\n  }\n", start));
    expect(fn).toContain('r.annualPercent === null ? "oranı siz gireceksiniz"');
    expect(fn).toContain('r.interest === null ? "oran girilince hesaplanır"');
    expect(fn).toContain('body.totalInterest === null ? "eksik oranlar girilince hesaplanır"');
    expect(fn).toContain('chip("Resmî Gazete metniyle karşılaştırılmadı", "warn")');
    // The disclaimer is drawn by the result only (B-27: no sentence twice).
    expect(html).not.toContain('host.appendChild(el("p", "fhelp", faizRates.disclaimer');
    expect((fn.match(/body\.disclaimer/gu) ?? []).length).toBe(1);
  });
});

describe("W23 hearing brief print", () => {
  it("prints only the hearing preparation card, and cleans up after the print dialog", () => {
    expect(html).toContain('acts.appendChild(ghostBtn("Tek sayfa yazdır / PDF", function () {');
    expect(html).toContain('window.addEventListener("afterprint", done);');
    expect(style).toContain("body.printprep * { visibility: hidden; }");
    expect(style).toContain("body.printprep #takvim-detail, body.printprep #takvim-detail * { visibility: visible; }");
  });
});

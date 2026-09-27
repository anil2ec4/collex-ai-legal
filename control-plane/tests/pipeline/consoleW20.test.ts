/**
 * W20 console locks: the Matter "Dosya incelemesi" tab and the persisted grid.
 *
 * These pin BEHAVIOUR the product claims, in the page's own source:
 *   - a task button exists only for a task the server says is available
 *     (a model-required task is never offered without a model);
 *   - the "whole file" claim is never built by the page: it prints the
 *     server's coverage sentence and, when completeness is refused, the
 *     itemized gaps;
 *   - hypothetical arguments and model findings are labelled as such;
 *   - every source opens the document through the existing focus path;
 *   - the grid creates a persisted table and polls it, keeps a browser
 *     fallback for an older server, retries one cell alone, and its CSV
 *     cannot inject a spreadsheet formula.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "..", "public", "console.html"), "utf8");

describe("W20 · Dosya incelemesi (Matter tab)", () => {
  it("adds ONE Matter tab and renders it from the server", () => {
    expect(html).toContain('["inceleme", "Dosya incelemesi", null]');
    expect(html).toContain('else if (tab === "inceleme") { renderMatterAnalysis(panel); }');
    expect(html).toContain('getJson("/v1/matters/" + enc(m.id) + "/analysis/capabilities")');
  });

  it("offers a button ONLY for a task the server says it can run", () => {
    expect(html).toContain("var available = caps.tasks.filter(function (t) { return t.available; });");
    expect(html).toContain("available.forEach(function (t) {");
    expect(html).toContain("Bunlar modelsiz yarım yapılmaz");
  });

  it("never builds the completeness claim itself", () => {
    expect(html).toContain("if (run.coverageSummary) { card.appendChild(el(\"p\", null, run.coverageSummary)); }");
    // W21 hostile review: the "not fully read" box follows SOURCE gaps only;
    // the refusal field now also covers incomplete analysis.
    expect(html).toContain("if (active || !cov || cov.complete !== false) { return; }");
    // W22: the box lists the places; the server's headline (analysisCompleteness
    // .headlineTr) already says the file was not wholly read, so the box does
    // not say it a second time.
    expect(html).toContain('box.appendChild(el("strong", "r3t", "Okunamayan ya da güvenilir biçimde okunamayan yerler:"));');
    expect(html).not.toContain("Dosyanın tamamı okunmadı; bu sonuç “bütün dosya” için söylenemez.");
    for (const reason of [
      "UNREADABLE_NO_TEXT", "UNIT_FAILED", "UNIT_NOT_PROCESSED", "NO_SOURCE_MAP",
      "SYNTHESIS_FAILED", "OCR_LOW_CONFIDENCE", "TEXT_OUTSIDE_UNITS",
    ]) {
      expect(html).toContain(`${reason}: "`);
    }
  });

  it("says when a result is over an old version of a document", () => {
    expect(html).toContain("Bu inceleme belgelerin eski sürümüne dayanıyor.");
  });

  it("labels hypothetical arguments and model findings", () => {
    expect(html).toContain('if (it.hypothetical) { chips.appendChild(chip("Varsayım — belgeden çıkan bir tespit değil", "warn")); }');
    expect(html).toContain("Yerel dil modelinin tespiti — alıntıdan doğrulayın");
  });

  it("opens every source through the existing document focus path", () => {
    expect(html).toContain("gotoDocument(src.fileId, src.chunkId ? { focusChunk: src.chunkId } : {});");
  });

  it("polls while a run is active and can stop it", () => {
    expect(html).toContain("var ANALYSIS_POLL_MS = 1500;");
    expect(html).toContain('"/analysis/" + enc(runId) + "/cancel"');
  });
});

describe("W20 · the grid is persisted server-side", () => {
  it("creates a table and polls it", () => {
    expect(html).toContain('postJson("/v1/review-tables", serverBody)');
    expect(html).toContain("function pollGridTable()");
    expect(html).toContain("function gridCellOfStored(c)");
    expect(html).toContain('<div id="gridrecent"></div>');
  });

  it("keeps the browser loop only as a fallback for an older server", () => {
    expect(html).toContain("if (res.status === 404 || res.status === 405) { runGridInBrowser(files, questions); return; }");
    expect(html).toContain("function runGridInBrowser(files, questions)");
  });

  it("retries ONE cell and cancels the rest on the server", () => {
    expect(html).toContain('"/cells/" + at.rowNo + "/" + at.columnNo + "/retry"');
    expect(html).toContain('if (gridState.tableId) { postJson("/v1/review-tables/" + enc(gridState.tableId) + "/cancel", {}); }');
  });

  it("marks whole-document columns and never mixes them with top-K answers", () => {
    expect(html).toContain('"Belgedeki bütün tarihler (tamamı okunur)": "extract_dates"');
    expect(html).toContain('exhaustive_incomplete: ["Belge tam okunamadı", "bad"]');
  });

  it("neutralizes spreadsheet formulas in the CSV", () => {
    expect(html).toContain("if (/^[=+\\-@\\t\\r]/.test(t)) { t = \"'\" + t; }");
  });
});

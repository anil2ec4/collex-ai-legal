/**
 * W21 console locks: reading everything is not analysing everything.
 *
 * The Matter "Dosya incelemesi" tab shows three SEPARATE layers — what was
 * read (kaynak), what was extracted (çıkarım), what was analysed (analiz) —
 * and never writes a whole-analysis-complete sentence of its own: that
 * sentence comes only from the server's `analysisCompleteness`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "..", "public", "console.html"), "utf8");

describe("W21 · three coverage layers in the Matter tab", () => {
  it("renders the three layers from the server's analysisCompleteness, with their own labels", () => {
    expect(html).toContain("function renderAnalysisLayers(card, run) {");
    expect(html).toContain("var ac = run.analysisCompleteness;");
    expect(html).toContain('["Kaynak kapsamı", ac.sectionsTr.source, ac.sourceComplete]');
    expect(html).toContain('["Çıkarım kapsamı", ac.sectionsTr.extraction, ac.extractionComplete]');
    expect(html).toContain('["Analiz kapsamı", ac.sectionsTr.analysis, ac.intelligenceComplete]');
    expect(html).toContain("box.appendChild(el(\"p\", \"anlz-head\", ac.headlineTr));");
    // Called from the one place coverage is drawn, right after the source sentence.
    expect(html).toContain(
      'if (run.coverageSummary) { card.appendChild(el("p", null, run.coverageSummary)); }\n    renderAnalysisLayers(card, run);',
    );
  });

  it("never composes a whole-analysis-complete sentence itself", () => {
    expect(html).not.toContain("Tam inceleme tamamlandı");
    expect(html).not.toContain("tamamlandı: seçilen belgelerin tamamı okundu");
  });

  it("the runs list keeps 'pages read' and 'analysis complete' as two different chips", () => {
    expect(html).toContain('chip(r.complete ? "dosyanın tamamı okundu" : "dosyanın tamamı okunmadı"');
    expect(html).toContain('chip(r.analysisComplete ? "inceleme tamamlandı" : "inceleme eksik kaldı"');
  });

  it("support states say how much was searched", () => {
    expect(html).toContain('no_support_in_candidates: ["Aday deliller arasında destek bulunamadı", "warn"]');
    expect(html).toContain('search_incomplete: ["Karşılaştırma tamamlanmadı", "warn"]');
    expect(html).toContain('not_weighed: ["Delillerle karşılaştırılmadı", "warn"]');
  });

  it("shows the hierarchical summaries and marks the semantic contradiction lane", () => {
    expect(html).toContain('["review_summary", "Genel değerlendirme"]');
    expect(html).toContain('["issue_summary", "Kısım özetleri"]');
    expect(html).toContain('it.attributes.lane === "semantic"');
  });

  it("reports analysis-task progress next to reading progress", () => {
    expect(html).toContain("function analysisProgressTr(run) {");
    expect(html).toContain('" bölüm okundu" + analysisProgressTr(run)');
  });

  it("the new CSS obeys the house rules (no tiny fonts, no uppercase transform)", () => {
    const block = html.slice(html.indexOf("/* W21 · okunan"), html.indexOf(".anlz-head"));
    expect(block).not.toMatch(/font-size:\s*(?:[0-9]|1[0-2])px/u);
    expect(block).not.toContain("text-transform");
  });
});

describe("W21 · Ayarlar shows the AI policy, the local model and local OCR", () => {
  it("renders them from health and never says 'ready' by default", () => {
    expect(html).toContain('row("Yapay zekâ ilkesi", pol');
    expect(html).toContain('row("Yerel model", lm.state === "configured"');
    expect(html).toContain('row("Taranmış sayfaları bu bilgisayarda okuma", ocr');
    // Only OCR_READY is usable (said in words, never a bare "hazır" — the W15
    // lock); no answer yet is "denetleniyor", never usable.
    expect(html).toContain('(ocr.state === "OCR_READY" ? "kurulu ve kullanılabilir" : "kullanılamıyor")');
    expect(html).toContain("denetleniyor — sonuç gelene kadar taranmış sayfalar okunmamış sayılır");
    expect(html).toContain("canlı sınanmadı");
    for (const policy of ["LOCAL_ONLY", "LOCAL_PREFERRED", "CLOUD_ALLOWED", "DETERMINISTIC_ONLY"]) {
      expect(html).toContain(`${policy}: "`);
    }
  });
});

describe("W21 hostile-review fixes · 'not compiled' is never shown as 'nothing found'", () => {
  it("the 'file not fully read' box follows SOURCE gaps only", () => {
    expect(html).toContain("if (active || !cov || cov.complete !== false) { return; }");
  });

  it("every analysis gap line is shown (no silent cut)", () => {
    expect(html).not.toContain("gaps.slice(0, 12)");
    expect(html).toContain('gaps.forEach(function (line) { ulg.appendChild(el("li", null, line)); });');
  });

  it("an empty result is described by the run's state", () => {
    expect(html).toContain("İnceleme durdurulduğu için tespitler derlenmedi");
    expect(html).toContain("İnceleme tamamlanamadığı için tespitler kaydedilmedi");
    expect(html).toContain("inceleme eksik kaldığı için bu, dosyada tespit olmadığı anlamına gelmez");
  });
});

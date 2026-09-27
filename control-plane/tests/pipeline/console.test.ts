/**
 * The operator console is itself an injection target. These tests hold the
 * three properties that make it safe to point at untrusted legal text:
 *
 *  1. the shipped page never opens a markup channel (no markup-assigning API,
 *     no dynamic code evaluation, no remote asset);
 *  2. the served Content-Security-Policy pins the page's own inline script and
 *     style by SHA-256 and denies every other origin;
 *  3. `guardAnswerForConsole` re-guards the markdown idempotently and LABELS
 *     instruction-shaped passages instead of editing them (editing evidence
 *     would break the verification chain the product exists to provide).
 *
 * The forbidden identifiers are spelled as regular expressions on purpose:
 * written as plain strings they would appear verbatim in this file and, more
 * importantly, a future reader could satisfy the grep simply by mentioning
 * them in a comment inside the page.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { buildConsoleCsp, loadConsolePage } from "../../src/api/consolePage.js";
import {
  CONTRARY_LANE_LABEL_TR,
  CONTRARY_LANE_MEANING_TR,
  CONTRARY_LANE_STATES,
  EVALUATIVE_WORD_STEMS,
  PETITION_ANALYSIS_SUMMARY_TR,
} from "../../src/contracts/petitionAnalysis.js";
import {
  DRAFT_TEMPLATES,
  KAPSAM_ACIKLAMASI,
  KAPSAM_SABIT_CUMLE,
} from "../../src/drafting/templates.js";
import { SEMANTIC_RERANK_DISCLAIMER } from "../../src/retrieval/semanticRerank.js";
import { RELATED_RANKING_DISCLAIMER } from "../../src/sources/relatedSearch.js";
import { guardAnswerForConsole } from "../../src/api/consoleGuard.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import type { AnswerResult } from "../../src/pipeline/types.js";
import { FIXTURES } from "../security/corpus.js";
import {
  Q_APPLICATION,
  STANDARD_FACTS,
  StubCorpus,
  VERSION_INJECTED,
  deterministicOptions,
  factsPort,
  hitDecisionFor,
  injectedDocument,
  ok,
  standardTexts,
} from "./fakes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE_HTML = resolve(HERE, "..", "..", "public", "console.html");

/** Anything that would open a markup or code-execution channel in the page. */
const FORBIDDEN_IN_PAGE: ReadonlyArray<readonly [string, RegExp]> = [
  ["inner HTML assignment", /innerHTML/],
  ["outer HTML assignment", /outerHTML/],
  ["adjacent HTML insertion", /insertAdjacentHTML/],
  ["legacy document writing", /document\s*\.\s*write/],
  ["dynamic evaluation", /\beval\s*\(/],
  ["function constructor", /new\s+Function/],
  ["sanitizer-API HTML setter", /setHTML/],
  ["frame srcdoc", /srcdoc/],
  ["javascript scheme", /javascript\s*:/],
];

/** Anything that would let the page reach a third party. */
const FORBIDDEN_REMOTE: ReadonlyArray<readonly [string, RegExp]> = [
  ["external script", /<script[^>]+\bsrc\s*=/i],
  ["external stylesheet", /<link[^>]+\brel\s*=\s*["']?stylesheet/i],
  ["image element", /<img\b/i],
  ["hard-coded remote origin", /https?:\/\/(?!127\.0\.0\.1)/i],
];

describe("the shipped console page opens no markup or code channel", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it.each(FORBIDDEN_IN_PAGE)("has no %s", (_label, pattern) => {
    expect(html).not.toMatch(pattern);
  });

  it.each(FORBIDDEN_REMOTE)("has no %s", (_label, pattern) => {
    expect(html).not.toMatch(pattern);
  });

  it("writes untrusted values only through textContent on created elements", () => {
    expect(html).toContain("textContent");
    expect(html).toContain("document.createElement");
  });

  it("creates an anchor only behind the server's URL decision", () => {
    // The one place an anchor is produced must be gated on the boolean the
    // server computed from the source-host allowlist.
    expect(html).toContain("item.sourceUrlAllowed === true");
    expect(html).toContain("noopener noreferrer nofollow");
  });

  it("is theme aware in both directions", () => {
    expect(html).toContain("color-scheme: light dark");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("renders the five confidence dimensions, the abstention state and the trace", () => {
    for (const dim of ["retrieval", "entailment", "authority", "currentness", "coverage"]) {
      expect(html).toContain(`["${dim}",`);
    }
    // W15: damga "DAYANAK BULUNAMADI (ÇEKİMSER)"dir — "çekimser" tek başına
    // yazılmaz; hüküm çipi de büyük harfli bir damga değil, kısa bir cümledir.
    expect(html).toContain("DAYANAK BULUNAMADI (ÇEKİMSER)");
    expect(html).toContain('CONFLICTING_AUTHORITIES: ["Kaynaklar çelişiyor", "warn"]');
    expect(html).toContain("İşlem izi");
    // W15 şerit D: mühür artık ne yapacağını söylüyor. "Ara ve doğrula",
    // avukatta "doğrulanmış cevap" garantisi izlenimi bırakıyordu; doğrulanan
    // şey alıntının kaynağıyla birebir aynı olmasıdır.
    expect(html).toContain("Ara ve dayanağıyla getir");
  });
});

describe("the three-view application shell (Araştır · Dosyalar · Taslak)", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("carries the hash-routed views and their nav tabs", () => {
    // W12 (UI-1): the 2026-08 three-view shell became the five-tab desk; the
    // original three views survive (the file view is now "Belgeler") and the
    // matter/document pages are hash-routed too.
    for (const id of [
      "view-arastir",
      "view-belgeler",
      "view-taslak",
      "view-dosyalarim",
      "view-ayarlar",
      "view-dosya",
      "view-belge",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const label of ["Araştır", "Dosyalar", "Taslak"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-view="arastir"');
  });

  it("offers the live deep-research mode with the honest upstream banner", () => {
    // W15 şerit E: "Derin araştırma" ekranda hiçbir yerde tanımlanmıyordu.
    // Aynı iş artık avukatın kendi sözcükleriyle anılıyor; ölçülen davranış
    // (canlı araştırma kipinin var olması ve dürüst bandı taşıması) aynı.
    expect(html).toContain("Resmî kaynaklarda araştırma");
    expect(html).toContain("/v1/research");
    // W15 şerit D · adım 23: aynı dürüstlük bandı, avukat adıyla. "Canlı mod"
    // ekranda hiçbir yerde tanımlanmıyordu; seçeneğin adı artık "Resmî
    // kaynaklarda". Ölçülen davranış değişmedi: bant hâlâ üst kaynağın o
    // andaki erişilebilirliğini ve arama listelerinin dayanak SAYILMADIĞINI
    // söylüyor.
    expect(html).toContain("Resmî kaynaklarda arama internete çıkar");
    expect(html).toContain("arama sonuç listeleri asla dayanak sayılmaz");
    expect(html).toContain("Araştırma izi");
  });

  it("wires the file and drafting endpoints of this wave's contract", () => {
    expect(html).toContain("/v1/files");
    expect(html).toContain("/v1/drafts");
    expect(html).toContain("/v1/draft-templates");
  });

  it("marks unsupported draft paragraphs loudly and forces lawyer review", () => {
    expect(html).toContain("KAYNAKSIZ");
    expect(html).toContain("Bu taslak makine üretimidir — avukat incelemesi zorunludur");
  });

  it("degrades to a typed notice when an endpoint is not mounted yet", () => {
    expect(html).toContain("henüz açık değil");
    expect(html).toContain("→ 404");
  });

  it("is LF-only, so the pinned CSP hash matches what a browser receives", () => {
    // CRLF in the served file breaks the SHA-256 pin against the browser's
    // normalized bytes; the page must never carry a carriage return.
    expect(html.includes("\r")).toBe(false);
  });
});

describe("the lawyer-facing surface of the 2026-08 UX wave", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("carries the shared terminology dictionary (stance, intent, lanes)", () => {
    // Sonuç yönü — raw enums must never reach the reader naked.
    expect(html).toContain("talebi destekliyor");
    expect(html).toContain("talebin aksine");
    expect(html).toContain("yön belirtmez (norm metni)");
    // Question intent and contrary-lane kinds in Turkish.
    expect(html).toContain("uygulama sorusu");
    expect(html).toContain("madde metni sorusu");
    expect(html).toContain("aksi sonuç araması");
    expect(html).toContain("karşı oy araması");
    expect(html).toContain("tamamlandı");
  });

  it("translates machine warning codes through the pattern dictionary", () => {
    // FIX: one STORE_UNAVAILABLE sentence on every surface, addressed to the
    // solo lawyer (the launcher), never "sistemi başlatan kişiye bildirin".
    // W15 şerit D · adım 24: the sentence still names the ONE thing the
    // lawyer must do, but it no longer names a .cmd file he has never seen.
    // "Veritabanı" became the canonical "kendi kayıtlarınız".
    expect(html).toContain("Kendi kayıtlarınıza ulaşılamadı.");
    expect(html).toContain("ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın");
    expect(html).not.toContain("sistemi başlatan kişiye bildirin");
    expect(html).toContain("kapsam dışı bırakıldı");
    // W15 şerit E: "korpus" ekrandan kalktı; söylenen şey aynı.
    expect(html).toContain("bu soruya dayanak olabilecek doğrulanmış bir pasaj bulunamadı");
    expect(html).toContain("WARN_PATTERNS");
  });

  it("uses the binding finalizability wording in both directions", () => {
    expect(html).toContain(
      "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır",
    );
    // W15 adım 13/e: aynı ölçüm, yeni cümle. "En az bir doğrulama başarısız"
    // avukatta "program çöktü" izlenimi bırakıyordu; kastedilen ColleX'in
    // kendi iç kontrollerinden birinin sonuç üretememesidir. Metin
    // src/answer/renderer.ts FINALIZE_TR ile birebir aynıdır.
    expect(html).toContain(
      "KESİNLEŞTİRİLEMEZ — iç kontrollerden biri sonuç veremedi; aşağıdaki gerekçeleri okumadan kullanmayın",
    );
    // The full-width review band for non-finalizable answers.
    expect(html).toContain("Bu cevap KESİNLEŞTİRİLEMEZ");
  });

  it("names the five confidence dimensions per the shared dictionary", () => {
    for (const label of [
      "Kaynak isabeti",
      "Pasaj desteği",
      "Otorite",
      "Güncellik",
      "Kapsam",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Güven ayrıntıları");
  });

  it("summarizes claim confidence in one human sentence with the weak axis named", () => {
    expect(html).toContain("confidenceSummary");
    // W15 lane C: the PERCENTAGE left the main flow (an unexplained "%100" is
    // exactly the accuracy claim this product does not make), but the WEAK
    // AXIS IS STILL NAMED — a fixed sentence would hide a repealed provision
    // behind a cheerful "Kapsam" blame.
    expect(html).toContain("yanı zayıf");
    expect(html).toContain("Bu dayanağın zayıf yanı çıkmadı");
    expect(html).toContain("Bu dayanağın en zayıf yanı:");
    // the number itself is not deleted; it lives in the audit record
    expect(html).toContain("function confidenceDump(claims, numbers)");
    expect(html).toContain('d.appendChild(el("summary", null, "Ölçüt sayıları ("');
  });

  it("anchors citations to source cards and splits pinned from context claims", () => {
    expect(html).toContain('"kaynak-" + n');
    expect(html).toContain('"#kaynak-"');
    // FIX: the heading matches the TOC, the Markdown and every card ("Tespit");
    // "Doğrulanmış" stays only on the per-card "Doğrulanmış atıflar" line —
    // a PARTIAL answer lists YETERSİZ KANIT cards under this heading.
    expect(html).toContain("\"Tespitler\", \"sec-tespitler\"");
    expect(html).not.toContain("Doğrulanmış pasajlar");
    expect(html).toContain("Sorunun doğrudan dayanağı");
    expect(html).toContain("Bağlam için getirilen komşu hükümler");
    // W15 lane C: the quote is no longer somewhere ELSE on the page, so the
    // "[1] numaralı kaynağa git" jump is gone — the source card is drawn
    // INSIDE the finding it supports, and the `#kaynak-n` anchor is minted
    // only on the FIRST drawing (one evidence item may support two findings).
    expect(html).not.toContain("numaralı kaynağa git");
    expect(html).toContain("function embeddedSourceCard(item, n)");
    expect(html).toContain("var firstDraw = renderAnchors && n !== undefined && anchoredEvidence[n] !== true;");
    expect(html).toContain("bodyBox.appendChild(embeddedSourceCard(item, numbers[id]));");
    expect(html).toContain("Bu tespitin dayandığı alıntı");
  });

  it("reorders the source card: effect badge, verified line, technical foldout", () => {
    expect(html).toContain("● yürürlükte");
    expect(html).toContain("● mülga");
    expect(html).toContain("karakteri karakterine doğrulandı");
    // W15 lane C: the foldout is named after the QUESTION it answers, and the
    // machine name survives one layer down, never alone.
    expect(html).not.toContain('"Teknik doğrulama ayrıntıları"');
    expect(html).toContain('det.appendChild(el("summary", null, "Bu alıntı nasıl doğrulandı?"));');
    expect(html).toContain('" (Teknik adı: SHA-256.)"');
    expect(html).toContain("Alıntının belgedeki yeri: ");
    expect(html).toContain(". harften ");
    expect(html).toContain("Unicode karakter sayımı");
    expect(html).not.toContain("(code point)");
  });

  it("keeps the sticky mini table of contents for long answers", () => {
    expect(html).toContain("İçindekiler");
    for (const id of ["sec-tespitler", "sec-karsit", "sec-kaynaklar", "sec-uyarilar", "sec-iz"]) {
      expect(html).toContain(id);
    }
  });

  it("gates live mode on /v1/research/health and offers draft-only attach", () => {
    expect(html).toContain("/v1/research/health");
    expect(html).toContain("Canlı mod bu sunucuda kapalı");
    expect(html).toContain("Taslakta kullan");
  });

  it("builds template fields dynamically and maps server issues per field", () => {
    expect(html).toContain("renderTemplateFields");
    expect(html).toContain("data-path");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Bu alan zorunludur");
    expect(html).toContain("En az bir taraf adı girin.");
    expect(html).toContain("En az bir olay girin.");
    expect(html).toContain("En az bir talep girin.");
  });

  it("displays the contrary-authority draft section distinctly (contract A)", () => {
    expect(html).toContain("karsi-ictihat");
    expect(html).toContain("talebin aksi yönündedir");
  });

  it("ships the full-document viewer with code-point highlighting", () => {
    expect(html).toContain("openFullDocument");
    expect(html).toContain("Belgeyi tam metniyle aç");
    expect(html).toContain("evidence-bundle?texts=true");
    expect(html).toContain("Array.from(text)");
  });

  it("ships the additive search filters with capability sniffing (contract D)", () => {
    expect(html).toContain("courtTypes");
    expect(html).toContain("dateFrom");
    expect(html).toContain("dateTo");
    expect(html).toContain("isFilterRejection");
    // W15 şerit E: "sunucu", "filtre" ve "sorgu" bir aradaydı; ölçülen
    // davranış aynı — daraltmanın uygulanmadığı SESSİZ kalmaz ve avukat
    // sonucun aslında ne kadar geniş arandığını okur.
    expect(html).toContain("Seçtiğiniz daraltmalar bu kurulumda uygulanamadı");
    expect(html).toContain("aşağıdaki sonuç, arşivin tamamında arandı");
  });

  it("meets the accessibility contract: roles, live regions, real copy buttons", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("aria-selected");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    // W15 şerit E: "özet değeri" ve "pano" avukat sözlüğünde yok.
    expect(html).toContain("Parmak izini kopyala");
    expect(html).toContain("kopyalanamadı — elle seçin");
    expect(html).toContain("◐ Tema: ");
  });

  it("speaks lawyer Turkish on the files view", () => {
    expect(html).toContain("Otomatik ön inceleme — bağlayıcı değildir");
    // FIX (HON-1): the privacy sentence names its two exceptions instead of
    // an unconditional "internete gönderilmez".
    // W15 şerit E: aynı gizlilik sözü, avukat cümlesiyle ve "OCR" olmadan.
    expect(html).toContain("Belgeleriniz bu bilgisayarda okunur ve burada kalır; yalnız siz bulut yapay zekâyı açarsanız dışarı gider.");
    expect(html).not.toContain("internete gönderilmez");
    expect(html).not.toContain("bu bilgisayardan çıkmaz");
    expect(html).not.toContain("hiçbir kayıt dışarı gitmez");
    expect(html).toContain("aranabilir PDF");
    expect(html).not.toContain("sezgisel analiz v1");
  });

  it("renames the presets without the duplicate scenario", () => {
    expect(html).toContain("Değişiklik öncesi (1–5 yıl, 2025)");
    expect(html).toContain("Değişiklik sonrası (3–7 yıl, 2026)");
    expect(html).toContain("Karşıt içtihat örneği");
    expect(html).not.toContain('"Kaynaklı cevap"');
  });

  it("shows the verdict ledger in lawyer terms and moves the runId to the trace", () => {
    // W15 adım 13/f-g: aynı üç bilgi (değerlendirme tarihi, kaynak/tespit
    // sayısı, denetim dosyası bağlantısı) duruyor; dikey künye sütunu tek
    // sessiz cümleye aktı ve bağlantıdan "(JSON)" ibaresi kalktı — makine
    // adı Sözlük'te kaldı.
    expect(html).toContain("tarihinde yürürlükte olan metne göre değerlendirildi");
    expect(html).toContain('"Denetim dosyasını indir"');
    expect(html).not.toContain("(JSON — alıntıların bağımsız denetimi için)");
    expect(html).toContain("Araştırma no");
  });
});

describe("the W12 daily desk (UI-1): shell, matters, deadlines, honesty lines", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("carries the five pill tabs, the two hidden pages and the active-matter selector", () => {
    for (const id of [
      "view-dosyalarim",
      "view-arastir",
      "view-belgeler",
      "view-taslak",
      "view-ayarlar",
      "view-dosya",
      "view-belge",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const label of ["Dosyalarım", "Araştır", "Belgeler", "Taslak", "Ayarlar"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('id="matterselect"');
    expect(html).toContain("Dosyasız çalışma");
    expect(html).toContain('id="pill-db"');
    expect(html).toContain('id="pill-mcp"');
    expect(html).toContain('id="pill-ai"');
    expect(html).toContain("HIDDEN_VIEWS");
    expect(html).toContain("function parseHash");
  });

  it("has exactly one style block and one script block (hash-pinned CSP)", () => {
    expect(html.match(/<style\b/gi)).toHaveLength(1);
    expect(html.match(/<script\b/gi)).toHaveLength(1);
  });

  it("uses no inline event-handler or style attributes (CSP has no unsafe-inline)", () => {
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle\s*=/i);
  });

  it("wires every W12 endpoint the desk relies on", () => {
    for (const endpoint of [
      "/v1/health",
      "/v1/matters",
      "/v1/matters/deadlines",
      "/v1/settings",
      "/v1/deadlines/rules",
      "/v1/deadlines/compute",
      "/v1/research/start",
      "/v1/research/runs/",
      "/v1/answers?limit=20",
      "/v1/answers?matterId=",
      "/v1/drafts?matterId=",
      '"?q=" + encodeURIComponent(q)',
      "?chunks=60&offset=",
    ]) {
      expect(html).toContain(endpoint);
    }
  });

  it("plumbs the active matter into every request that accepts a matterId", () => {
    expect(html).toContain("function setActiveMatter");
    expect(html).toContain("function readActiveMatter");
    expect(html).toContain("collex.console.matter.v1");
    // /v1/answer, /v1/research(/start) and the document-page question
    expect(html).toContain("payload.matterId = activeMatter.id");
    // /v1/drafts — matter.matterId in the existing draft form submission
    expect(html).toContain("matter.matterId = activeMatter.id");
    // /v1/files multipart field
    expect(html).toContain('fd.append("matterId", matterId)');
  });

  it("translates the W12 warning/reason codes (Turkish first, code in the technical line)", () => {
    for (const code of [
      "EVIDENCE_FILTERED",
      "UPSTREAM_DEGRADED",
      "DRAFTER_DEGRADED",
      "RESEARCH_COVERAGE_INCOMPLETE",
      "BUDGET_EXHAUSTED",
      "TIMEOUT",
      "STORE_UNAVAILABLE",
      "SCANNED_PAGES",
      "CORPUS_UNAVAILABLE",
      "QUESTION_NOT_COVERED",
      "AI_UNAVAILABLE",
      "AI_DRAFTER_USED",
      "MATTER_NOT_FOUND",
      "MATTER_LINK_FAILED",
      "ITEM_NOT_FOUND",
      "TOO_MANY_RUNS",
      "UPLOAD_TIMEOUT",
      "AI_CONSENT_REQUIRED",
      "AI_NOT_CONFIGURED",
    ]) {
      expect(html).toMatch(new RegExp(`\\[/\\^${code}`));
    }
    // W15 şerit D · adım 24: aynı ölçüm — kapalı bir programın uyarısı
    // avukata NE YAPACAĞINI söyler. Dosya adı yerine masaüstündeki simge.
    expect(html).toContain("ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın");
    // W15 şerit E: "dizine alma" yazılım terimiydi. Ölçülen davranış aynı —
    // metinsiz sayfalar avukata bildirilir — ama artık SONUCU söylüyor:
    // o sayfalar aramada çıkmaz ve o sayfalardan alıntı yapılamaz.
    expect(html).toContain("bu sayfalar taranmış görüntü olabilir; aramada çıkmazlar");
    expect(html).toContain("aramada çıkmaz ve bu sayfalardan alıntı yapılamaz");
    expect(html).toContain("Metin katmanı çok seyrek olan sayfalar ayrıca işaretlendi");
    expect(html).toContain("seyrek metin uyarısı");
    expect(html).toContain("bu sayfaların tamamı okunmuş sayılmaz");
    expect(html).toContain("metin katmanlı");
    expect(html).toContain('typeof f.sizeBytes === "number" ? " (yaklaşık " + fmtSizeTR(f.sizeBytes)');
    expect(html).not.toContain("fmtSizeTR(f.sizeBytes || 0)");
  });

  it("explains sparse text-layer pages even when no page is completely empty", () => {
    const start = html.indexOf("  function scannedText(");
    const end = html.indexOf("  function fileRowCard(", start);
    const rendered = runInNewContext(
      html.slice(start, end) +
        '; scannedText({ pageCount: 12, pagesWithText: 12, emptyPages: [], sparsePages: [3, 12] })',
      {},
    ) as string;
    expect(rendered).toContain("Metin katmanı çok seyrek olan sayfalar ayrıca işaretlendi");
    expect(rendered).toContain("sayfa 3, 12");
  });

  it("speaks the answer-honesty lines of lane B (coverage, set-aside, provenance, AI label)", () => {
    // W15 adım 14: ana akışta artık sayı var, yüzde yok — "%22" avukata iyi
    // mi kötü mü olduğunu söylemiyordu. Ölçüm SİLİNMEDİ: yüzdenin kendisi
    // künyenin katlanmış "Teknik ayrıntı — destek için" kapağında durur.
    expect(html).toContain("anahtar sözcükten");
    expect(html).toContain("tanesi kaynaklarda karşılık buldu");
    expect(html).toContain("Teknik ayrıntı — destek için");
    expect(html).toContain("Soru kapsamı: %");
    expect(html).toContain("soru sözcüklerinin kaynaklarda karşılığı");
    expect(html).toContain(
      "Aşağıda listelenen pasajlar sorunuzla yalnız kelime düzeyinde benziyor; dayanak değildir.",
    );
    expect(html).toContain("Karşılığı bulunamayan sözcükler");
    expect(html).toContain("yüklediğiniz belge");
    // W15 şerit E: "korpus" ve "SENTETİK" kanonik sözlüğün karşılıklarına
    // taşındı. Ölçülen davranış aynı: deneme belgeleriyle çalışıldığı her
    // kaynak çipinde açıkça yazar.
    expect(html).toContain("deneme belgeleri — örnek metin, gerçek karar değil");
    expect(html).toContain("canlı resmî kaynak");
    expect(html).toContain("yürürlük değerlendirilemez");
    expect(html).toContain("function answerMetaBlock");
    expect(html).toContain("function originChip");
    expect(html).toContain("data.aiUsed.label");
  });

  it("ships the live-research progress panel with Turkish step states", () => {
    expect(html).toContain("function startLiveRun");
    expect(html).toContain("function renderProgress");
    expect(html).toContain("/v1/research/runs/");
    expect(html).toContain("PROGRESS_STATUS_TR");
    expect(html).toContain("zaman aşımı");
    expect(html).toContain("LIVE_POLL_MS = 1000");
  });

  it("ships the deadline form contract of lane D and files the result as a matter item", () => {
    expect(html).toContain("DOĞRULANMADI — madde metniyle kontrol edin");
    expect(html).toContain("Dosyaya kaydet");
    expect(html).toContain("applyAdliTatil");
    expect(html).toContain("dueDateTr");
    expect(html).toContain("dueWeekday");
    expect(html).toContain('kind: "deadline"');
    expect(html).toContain('source: "hesap"');
    expect(html).toContain("GECİKMİŞ");
    expect(html).toContain("Süre başlat");
    // W14 B2 (UXAUDIT P2-8): the panel now also looks 90 days BACK, so the
    // title says what it shows. "Bugün / Bu hafta" over a 212-day-overdue
    // deadline was a lie the panel told every morning.
    expect(html).toContain("Yaklaşan ve geciken süreler");
  });

  it("keeps the local-workspace honesty lines and first-run states", () => {
    expect(html).toContain("Bu çalışma alanı yereldir; UYAP ile eşitlenmez");
    // W14 F-UI (V-16). The honesty line used to end with "Belge deposu:
    // collex_demo" and the status pill with "· collex_demo": a DATABASE NAME
    // in front of the lawyer, on every matter page and in the masthead. The
    // sentence stays; the machine name moves to the one place it answers a
    // real question — Ayarlar › "Verilerim nerede?".
    expect(html).toContain("Belgeler bu bilgisayarda saklanır");
    expect(html).not.toContain("Belge deposu:");
    expect(html).not.toContain('"Veritabanı: " + (DB_STATE_TR[db] || db) + (h.dbName ? " · " + h.dbName : "")');
    // W15 şerit E: "KORPUS" kanonik sözlüğün karşılığına taşındı. Ölçülen
    // davranış aynı ve daha da açık: deneme kurulumunda gerçek mevzuat
    // olmadığı ve sonuçların dosyada kullanılmaması gerektiği yazar — ve
    // damga hâlâ arşivi adlandırır, arkasındaki veritabanını değil.
    expect(html).toContain("DENEME BELGELERİ — gerçek mevzuat yok, sonuçları dosyada kullanmayın");
    expect(html).not.toMatch(/DENEME BELGELER\u0130 \(" \+ \(h\.dbName/u);
    // W15 şerit D · adım 23-24: aynı iki gerçeği (bağlantı kapalı + kütüphane
    // boş) taşıyan aynı kart; "korpus" ve ".cmd" gitti, yapılacak iş kaldı.
    expect(html).toContain("Resmî kaynaklara bağlantı şu an kapalı ve bu bilgisayardaki hukuk kütüphaneniz de boş.");
    expect(html).toContain("Verilerim nerede?");
    // W15 şerit E: "sezgisel çıkarım" mühendis diliydi. Ölçülen davranış aynı:
    // otomatik okunan her tarih kesin DEĞİL diye işaretlenir ve UYAP'tan teyit
    // istenir.
    expect(html).toContain("belge metninden otomatik okundu, kesin değildir — UYAP'tan teyit edin");
    expect(html).toContain("function maybeWelcome");
    expect(html).toContain("function corpusEmpty");
  });

  it("gates cloud AI behind an explicit consent dialog and keeps it off by default", () => {
    expect(html).toContain("Bulut yapay zekâ: kapalı");
    expect(html).toContain("useCloudAi = true");
    expect(html).toContain("Anthropic");
    expect(html).toContain("collex.console.cloudai.v1");
    // W14 F-UI (V-18): the environment-variable name is a MACHINE name and no
    // longer stands inside a Turkish sentence; one sentence carries the state.
    // W15 şerit E: "sunucu" avukatın kendi bilgisayarıdır.
    expect(html).toContain('var AI_OFF_TEXT = "Bulut yapay zekâ bu kurulumda kapalı — Ayarlar › Sistem durumu";');
    expect(html).not.toContain("ANTHROPIC_API_KEY tanımlı değil");
    expect(html).toContain("canlı sınanmadı");
  });

  it("leaves the clearly marked hooks for UI-2 (AI analizi card, Bulut OCR, talep handoff)", () => {
    expect(html).toContain('id = "belge-ai-hook"');
    expect(html).toContain('id = "belge-ocr-hook"');
    expect(html).toContain("function renderAiAnalysisHook");
    expect(html).toContain("collex.handoff.talepler");
    expect(html).toContain("function applyHandoffTalepler");
  });

  it("renders user-facing dates through fmtDateTR (GG.AA.YYYY) on the new surfaces", () => {
    expect(html).toContain("fmtDateTR(r.payload.dueDate)");
    expect(html).toContain("fmtDateTR(p.date)");
    expect(html).toContain("fmtDateTR(d.date)");
  });

  it("closes modals with Escape and traps focus inside forms too", () => {
    expect(html).toContain("Kapat (Esc)");
    expect(html).toContain('event.key === "Escape"');
    expect(html).toContain("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
  });
});

describe("the W12 Taslak editor, cloud-AI hooks and header compaction (UI-2)", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("keeps the console contract: one style, one script, LF-only, textContent-only DOM", () => {
    expect(html.match(/<style\b/gi)).toHaveLength(1);
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    expect(html.includes("\r")).toBe(false);
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle\s*=/i);
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/i);
  });

  it("renders the template picker grouped and the form from fields[] by group and kind", () => {
    expect(html).toContain("KIND_GROUP_TR");
    expect(html).toContain("Dilekçeler");
    expect(html).toContain("Sözleşmeler");
    expect(html).toContain("fieldGroupsCache");
    expect(html).toContain("function renderTemplateFields");
    expect(html).toContain("function buildField");
    for (const kind of ["party-list", "event-list", '"list"', '"date"', '"select"', '"number"']) {
      expect(html).toContain(kind);
    }
    // party rows post DraftParty[] (ad/rol/tckn|vkn/adres/vekil), event rows DraftEvent[]
    expect(html).toContain("function collectParties");
    expect(html).toContain("function collectEvents");
    expect(html).toContain("party.tckn = kimlik");
    expect(html).toContain("party.vkn = kimlik");
    expect(html).toContain("party.vekil = { ad: vad }");
    // prefill from the matter and the profile, marked as automatic
    expect(html).toContain("function applyDraftPrefill");
    expect(html).toContain("otomatik — kontrol edin");
    expect(html).toContain("ROLE_PAIRS");
    // evidence source: son araştırma · dosyadaki kayıtlı araştırma · seçili belgeler
    expect(html).toContain('id="ev-saved"');
    expect(html).toContain("function loadSavedRuns");
    expect(html).toContain("Dosyadaki kayıtlı araştırma");
    expect(html).toContain("Seçili belgeler");
  });

  it("ships the three-column editor with the live linter mirroring composer.ts evidenceOverlaps", () => {
    for (const fn of [
      "function openEditor",
      "function renderEditor",
      "function renderEditorSection",
      "function renderParagraph",
      "function lintParagraph",
      "function evidenceOverlapsClient",
      "function lintTokens",
      "function lintNumbers",
      "function renderEvidencePane",
      "function openQuotePicker",
      "function saveDraft",
      "function openVersionsModal",
      "function rebuildFromEditor",
      "function insertFact",
      "function openAddEvidenceModal",
    ]) {
      expect(html).toContain(fn);
    }
    expect(html).toContain("QUOTE_OVERLAP_FLOOR = 0.7");
    expect(html).toContain('"plaintext-only"');
    for (const id of ["edtop", "edkaynaksiz", "edversion", "edsave", "edoutline", "edtext", "edevidence", "edissues", "ednote"]) {
      expect(html).toContain(`"${id}"`);
    }
    // PUT wire shape: sections[{id, paragraphs[{id,text,evidenceIds,role,binding:"lexical"}]}], evidenceUse, note
    // FIX: an accepted entailment binding is sent back as itself; everything else is lexical.
    expect(html).toContain('p.binding.kind === "entailment") ? p.binding : "lexical"');
    expect(html).toContain("patch.baseVersion = d.version");
    expect(html).toContain("evidenceUse: editor.evidenceUse");
    expect(html).toContain('"PUT", patch');
    expect(html).toContain("/versions");
    expect(html).toContain("export?format=");
    expect(html).toContain("UYAP Doküman Editörü'nde açarak doğrulayın");
    // paragraph tools, outline dots, evidence toggles, review banners
    for (const label of ["Alıntı ekle", "KAYNAKSIZ olarak bırak", "Paragraf ekle", "Dayanak olarak kullan", "Olaylara ekle",
      "Araştırmadan kanıt ekle", "Belgeden kanıt ekle", "Yeniden oluştur", "Sürümler",
      // W15 şerit E: sayaç neyi saydığını söylemiyordu ("KAYNAKSIZ: 3").
      // Damga korunuyor — dürüstlük sözleşmesinin parçası — ama sayının
      // yanına ne sayıldığı yazıldı.
      "KAYNAKSIZ paragraf: "]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Talebin aksi yönündeki karar dayanak yapılamaz");
    expect(html).toContain("Yüklenen belge hukukî sebep olamaz");
    expect(html).toContain("Kanıt kümesi taslak oluşturulurken sabitlenir");
    // unsaved-changes guard + Ctrl+S
    // W15 şerit E: ayrılma onayı artık tarayıcının window.confirm'i değil,
    // uygulamanın kendi kartıdır; ölçülen davranış (kaydedilmemiş değişiklik
    // varken uyarma) korunur, yalnız metin avukat diline taşındı.
    expect(html).toContain("beforeunload");
    expect(html).toContain("Taslakta kaydedilmemiş değişiklikleriniz var.");
    expect(html).toContain("Taslakta kal");
    expect(html).toContain("Kaydetmeden ayrıl");
    expect(html).toContain('event.key === "s"');
  });

  it("gates every cloud-AI surface on configured + per-request consent and names the disabled reason", () => {
    expect(html).toContain("function renderAiAnalysisHook");
    expect(html).toContain("function renderAiAnalysis");
    expect(html).toContain("function renderOcrHook");
    expect(html).toContain("function openOcrDialog");
    expect(html).toContain("function openAiParagraphDialog");
    expect(html).toContain("function ensureCloudAi");
    expect(html).toContain("/v1/ai/analyze-document");
    expect(html).toContain("/v1/ai/ocr");
    expect(html).toContain("/v1/ai/draft-paragraph");
    // W14 F-UI (V-18): every disabled cloud surface names the SAME Turkish
    // reason; the env-var name appears exactly once, in Ayarlar, after a
    // Turkish sentence and in parentheses.
    expect(html).toContain("aiB.title = AI_OFF_TEXT;");
    expect(html).toContain("var AI_DISABLED_HINT = AI_OFF_TEXT;");
    expect((html.match(/ANTHROPIC_API_KEY/gu) ?? []).length).toBe(1);
    // W15 şerit E: ana akış artık avukatın sorusunu cevaplıyor ("dışarı bir
    // şey gidiyor mu?"); ortam değişkeni adı SİLİNMEDİ, Ayarlar'daki tek
    // "Teknik ayrıntı" kabına indi ve orada bir kez geçiyor.
    expect(html).toContain("kapalı — bu bilgisayardan dışarı hiçbir metin gitmiyor");
    expect(html).toContain('"Ortam değişkeni: ANTHROPIC_API_KEY"');
    expect(html).toContain('fd.append("useCloudAi", "true")');
    expect(html).toContain("useCloudAi: true, focus: focus.value");
    // W15 adım 14: künyedeki üretim satırı artık avukatın sorduğu soruyu
    // cevaplıyor ("bunu bir yapay zekâ mı yazdı?"); ölçülen davranış aynı —
    // bulut taslağında her cümlenin dayanağının yerel olarak doğrulandığı
    // ekranda yazar.
    expect(html).toContain("dayanağı bu bilgisayarda tek tek doğrulandı");
    expect(html).toContain("canlı sınanmadı");
    expect(html).toContain("Belge olarak yükle");
  });

  it("translates the AI error kinds, UPLOAD_ONLY_EVIDENCE and the not-applicable currentness", () => {
    for (const code of [
      "UPLOAD_ONLY_EVIDENCE", "AI_TIMEOUT", "AI_UPSTREAM_UNAVAILABLE", "AI_AUTH_FAILED", "AI_RATE_LIMITED",
      "AI_UPSTREAM_FAILED", "AI_REFUSED", "AI_OUTPUT_TRUNCATED", "AI_MALFORMED_OUTPUT", "DRAFTING_UNAVAILABLE", "PAYLOAD_TOO_LARGE",
    ]) {
      expect(html).toMatch(new RegExp(`\\[/\\^${code}`));
    }
    expect(html).toContain("NOT_APPLICABLE:");
    expect(html).toContain("yüklediğiniz belge — yürürlük değerlendirilemez");
    expect(html).toContain("claim.currentnessApplicable === false");
    expect(html).toContain("Cevap yalnızca yüklediğiniz belgedeki pasajlara dayanır");
    expect(html).toContain('e.origin = "live"');
    expect(html).toContain("function answerModeLabel");
    expect(html).toContain("/v1/answers?fileId=");
    expect(html).toContain("pages.pageCount + \" sayfa\"");
  });

  it("compacts the header after first run and merges the demo-corpus notice into one line", () => {
    expect(html).toContain('classList.toggle("compact", !first)');
    expect(html).toContain("body.compact .monomark");
    // W15 adım 2: #demobanner ÖLÜ KODDU — applyHealth onu koşulsuz gizliyordu,
    // yani deneme uyarısını taşıyan tek yüzey damganın içiydi. Eleman kaldırıldı;
    // uyarı artık İKİ bağımsız yüzeyde ve metni tek kaynaktan (TERM_TR) gelir.
    expect(html).not.toContain('id="demobanner"');
    expect(html).toContain("function applyDemoNotice(on)");
    expect(html).toContain('TERM_TR["deneme belgeleri"]');
    expect(html).toContain('defineTerm(chipNode, "deneme belgeleri")');
    // typography: small-caps only for nav tabs and eyebrows; print covers the editor
    expect(html).toContain("font-variant-caps: normal;");
    expect(html).toContain("body.editing #edoutline, body.editing #edevidence");
  });
});

describe("Content-Security-Policy", () => {
  it("pins the page's inline script and style by SHA-256", () => {
    const page = loadConsolePage({ reload: true });
    const script = page.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    const style = page.html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
    expect(script).not.toBeNull();
    expect(style).not.toBeNull();

    const scriptHash = createHash("sha256").update(script![1]!, "utf8").digest("base64");
    const styleHash = createHash("sha256").update(style![1]!, "utf8").digest("base64");
    expect(page.csp).toContain(`script-src 'sha256-${scriptHash}'`);
    expect(page.csp).toContain(`style-src 'sha256-${styleHash}'`);
  });

  it("denies everything else and allows only same-origin XHR", () => {
    const csp = loadConsolePage().csp;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'none'");
    expect(csp).toContain("font-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("changes the pinned hash when the inline script changes", () => {
    const original = buildConsoleCsp("<style>a{}</style><script>var a=1;</script>");
    const edited = buildConsoleCsp("<style>a{}</style><script>var a=2;</script>");
    expect(original).not.toBe(edited);
  });

  it("pins nothing when there is nothing to pin", () => {
    expect(buildConsoleCsp("<p>hi</p>")).toContain("script-src 'none'");
    expect(buildConsoleCsp("<p>hi</p>")).toContain("style-src 'none'");
  });
});

describe("guardAnswerForConsole", () => {
  const payload = (() => {
    const fixture = FIXTURES.find((f) => f.id === "adv-inject-001");
    if (fixture === undefined || typeof fixture.payload !== "string") {
      throw new Error("adversarial fixture adv-inject-001 is missing");
    }
    return fixture.payload;
  })();

  async function answerWith(hitPayload: string | undefined): Promise<AnswerResult> {
    const injected = hitPayload === undefined ? undefined : injectedDocument(hitPayload);
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([injected?.hit ?? hitDecisionFor()])),
      texts:
        injected === undefined
          ? standardTexts()
          : standardTexts(new Map([[VERSION_INJECTED, injected.text]])),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    const run = await pipeline.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });
    return run.result;
  }

  it("flags an instruction-shaped passage without editing the evidence", async () => {
    const result = await answerWith(payload);
    const guarded = guardAnswerForConsole(result);

    expect(guarded.guard.flaggedEvidenceIds).toHaveLength(1);
    const flags = guarded.guard.evidence[0]!;
    expect(flags.injectionFlagged).toBe(true);
    expect(flags.injectionSignals.length).toBeGreaterThan(0);

    // The evidence itself is untouched: same quote, same digest.
    expect(guarded.evidence[0]!.quote).toBe(result.evidence[0]!.quote);
    expect(guarded.evidence[0]!.quoteSha256).toBe(result.evidence[0]!.quoteSha256);
  });

  it("leaves a benign passage unflagged", async () => {
    const guarded = guardAnswerForConsole(await answerWith(undefined));
    expect(guarded.guard.flaggedEvidenceIds).toEqual([]);
    expect(guarded.guard.evidence[0]!.injectionFlagged).toBe(false);
    expect(guarded.guard.evidence[0]!.invisibleChars).toBe(0);
  });

  it("reports the markdown as already guarded, and is idempotent", async () => {
    const result = await answerWith(payload);
    const once = guardAnswerForConsole(result);
    const twice = guardAnswerForConsole(once);

    expect(once.guard.markdownWasGuarded).toBe(true);
    expect(twice.markdown).toBe(once.markdown);
    expect(twice.guard.markdownWasGuarded).toBe(true);
  });

  it("enforces the guard on markdown from any other producer", () => {
    const hostile: AnswerResult = {
      schema: "collex.answer.result/v1",
      runId: "run-x",
      question: "q",
      normalizedQuestion: "q",
      asOf: "2026-06-01",
      status: "ABSTAIN",
      finalizable: false,
      reasons: [],
      warnings: [],
      claims: [],
      evidence: [],
      rejectedEvidence: [],
      contraryCoverage: {
        executed: false,
        skipped: false,
        usable: false,
        lanes: [],
        contraryEvidenceIds: [],
        conflictedClaimIds: [],
        observed: [],
        scope: { intent: "APPLICATION", rationale: "", scopedOut: 0 },
        note: "",
      },
      trace: [],
      markdown: "<script>alert(1)</script> [x](javascript:alert(2)) https://evil.example/a",
      bundle: {
        schema: "collex.answer.evidence-bundle/v1",
        question: "q",
        asOf: "2026-06-01",
        status: "ABSTAIN",
        finalizable: false,
        verifiedAt: "2026-06-01T00:00:00.000Z",
        reasons: [],
        claims: [],
        evidence: [],
      },
      corpusNotice: "SENTETİK",
      generatedAt: "2026-06-01T00:00:00.000Z",
    };

    const guarded = guardAnswerForConsole(hostile);
    expect(guarded.guard.markdownWasGuarded).toBe(false);
    expect(guarded.markdown).not.toContain("<script");
    expect(guarded.markdown).not.toContain("](javascript:");
    expect(guarded.markdown).not.toContain("https://evil.example");
  });

  it("counts invisible/BiDi control characters in a quote", async () => {
    const result = await answerWith("Karar metni‮ters yon​ devam eder.");
    const guarded = guardAnswerForConsole(result);
    expect(guarded.guard.evidence[0]!.invisibleChars).toBe(2);
  });
});

describe("W12-FIX2 console pins", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  // W15 adım 7: LANG-7'nin ölçtüğü davranış korunuyor — bulut yapay zekânın
  // ekranda TEK bir adı vardır. Değişen, o adın kendisi: "Bulut AI" bir avukat
  // sözcüğü değildi ("AI" kısaltmasının Türkçe karşılığı ekranda hiç yazmıyordu).
  // Tek ad artık "bulut yapay zekâ"dır ve "Bulut AI" varyantı da yasaklılara girer.
  it("names cloud AI 'bulut yapay zekâ' everywhere — no other variant (LANG-7)", () => {
    expect(html).toContain('<span class="t">Bulut yapay zekâ</span>');
    expect(html).toContain("Bulut yapay zekâ bu kurulumda kapalı");
    expect(html).not.toMatch(/Bulut AI/u);
    expect(html).not.toMatch(/bulut ai\b/u);
    expect(html).not.toMatch(/BULUT AI/u);
    expect(html).not.toMatch(/yapay zeka\b/iu);
    expect(html).not.toMatch(/Cloud AI/u);
  });

  it("lists relevance-gated sources under their own heading with the force-use toggle (P1-1b)", () => {
    expect(html).toContain("Kullanılmayan kaynaklar (alakasız görünüyor)");
    expect(html).toContain("Yine de dayanak olarak kullan");
    expect(html).toContain("hukuk alanı bu belgeyle uyuşmuyor");
    expect(html).toContain("talep/olay metniyle ortak sözcük yok");
    expect(html).toMatch(/\[\/\^DOMAIN_MISMATCH:\//u);
    expect(html).toMatch(/\[\/\^NOT_RELEVANT:\//u);
  });

  it("translates the budget, quote-cap and stored-size warnings; marks a shortened quote (P1-5b)", () => {
    expect(html).toMatch(/\[\/\^TIME_BUDGET_EXCEEDED\//u);
    expect(html).toMatch(/\[\/\^QUOTE_TRUNCATED\//u);
    expect(html).toMatch(/\[\/\^STORED_WITHOUT_TEXTS\//u);
    expect(html).toContain('chip("alıntı kısaltıldı", "mute")');
    expect(html).toContain("item.quoteTruncated === true");
  });

  it("preselects 'Son araştırma' when a run exists in this session (P2-6) and names exports humanly (P2-5)", () => {
    expect(html).toContain("function preselectLastRun()");
    expect(html).toMatch(/preselectLastRun\(\);\s*syncEvidenceHint\(\);/u);
    expect(html).toContain('exportFileName(d, "docx")');
    expect(html).not.toContain('"taslak-" + d.draftId');
    // Timestamps shown to the lawyer are converted to local time (versions list).
    expect(html).toContain("saatine çevrilir");
  });

  it("carries the 390 px compact rules (P2-8)", () => {
    expect(html).toContain("@media (max-width: 480px)");
    expect(html).toContain('grid-template-areas: "brand theme" "matter matter" "pills pills"');
    expect(html).toContain(".edacts { margin-top: 6px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))");
  });
});

/* ===================================================================== *
 * W14 — L-CONSOLE (B-10, B-21, B-22, B-27, B-28)
 *
 * These pin the console's own behaviour contract. Where a claim is about a
 * COLOUR RATIO the test does not grep for a string: it parses the token
 * block out of the page and computes the WCAG contrast, so the numbers in
 * W14-L-CONSOLE.md cannot drift away from the file.
 * ===================================================================== */

/** Read one custom-property value out of a `{ … }` token block. */
function tokenValue(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (m === null) throw new Error(`token --${name} not found in block`);
  return m[1]!.trim();
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "").trim();
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe("W14 B-28 · accessibility: the four P0 ratios are computed, not asserted by hand", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  /** Light palette = the bare `:root { … }` block; dark = `:root[data-theme="dark"] { … }`. */
  const lightBlock = (() => {
    const m = html.match(/:root\s*\{([\s\S]*?)\n\}/);
    if (m === null) throw new Error("light :root block not found");
    return m[1]!;
  })();
  const darkBlock = (() => {
    const m = html.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    if (m === null) throw new Error("dark :root block not found");
    return m[1]!;
  })();

  const themes: ReadonlyArray<readonly [string, string]> = [
    ["light", lightBlock],
    ["dark", darkBlock],
  ];

  it.each(themes)("focus ring reaches WCAG 2.4.11 (>= 3:1) in the %s theme", (_name, block) => {
    // The ring is two layers: an inner surface halo and an OUTER --seal ring.
    // What must reach 3:1 is the outer ring against the surfaces it sits on.
    const seal = tokenValue(block, "seal");
    for (const surface of ["panel", "paper", "panel-2"]) {
      expect(contrast(seal, tokenValue(block, surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(themes)("input border reaches 3:1 against its own fill in the %s theme", (_name, block) => {
    const border = tokenValue(block, "border");
    for (const surface of ["panel-2", "panel", "paper"]) {
      expect(contrast(border, tokenValue(block, surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(themes)("the GECİKMİŞ chip and the toast reach 4.5:1 in the %s theme", (_name, block) => {
    // Both now paint --paper on --ink and carry the meaning colour as a 4 px edge.
    expect(contrast(tokenValue(block, "paper"), tokenValue(block, "ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("the active view tab reaches 4.5:1 in the %s theme", (_name, block) => {
    const onSeal = tokenValue(block, "on-seal");
    for (const fill of ["btn", "btn-deep"]) {
      expect(contrast(onSeal, tokenValue(block, fill))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defines the ring as a two-layer seal ring and keeps the element's own radius", () => {
    expect(html).toContain("--ring: 0 0 0 2px var(--panel), 0 0 0 4px var(--seal);");
    expect(html).toContain(":focus-visible { outline: none; box-shadow: var(--ring); }");
    // The old low-contrast tinted ring is gone in both themes.
    expect(html).not.toContain("0 0 0 3px color-mix(in srgb, var(--seal) 18%, transparent)");
    expect(html).not.toContain("0 0 0 3px color-mix(in srgb, var(--seal) 26%, transparent)");
  });

  it("gives every text control a real border instead of a transparent one", () => {
    for (const rule of [
      "  border: 1px solid var(--border);\n  border-radius: var(--r);\n  padding: 16px 18px;",
      "  border: 1px solid var(--border);\n  border-radius: var(--r-sm);\n  padding: 11px 14px;",
      "  border: 1px solid var(--border);\n  border-radius: var(--r-sm);\n  padding: 10px 13px;",
    ]) {
      expect(html).toContain(rule);
    }
    // W23 (27.09.2026): the light palette went neutral; the contrast test
    // above still requires >= 3:1 on every surface for the new value.
    expect(html).toContain("--border: #84848c;");
    expect(html).toContain("--border: #8d7d59;");
  });

  it("removes the hard-coded #fff from the toast and the overdue chip", () => {
    expect(html).not.toContain(".toast.bad { background: var(--bad); color: #fff; }");
    expect(html).not.toContain(".days.late { color: #fff;");
    expect(html).toContain(".toast.bad { border-left: 4px solid var(--bad); }");
    expect(html).toContain(".toast.warn { border-left: 4px solid var(--warn); }");
    expect(html).toContain(".days.late { color: var(--paper); background: var(--ink);");
  });

  it("uses --on-seal (light in BOTH themes) on solid seal fills", () => {
    expect(html).toContain("--on-seal: #fdf9f0;");
    expect(html).toContain("--on-seal: #fdf3ee;");
    expect(html).toContain("  color: var(--on-seal);\n  background: linear-gradient(180deg, var(--btn), var(--btn-deep));");
    // The dark-theme gel highlight that sat on the active tab is gone.
    expect(html).not.toContain("box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 6px 18px -8px var(--btn-deep);");
  });

  it("closes the 900–1100 px dead zone that pushed the status pills off screen", () => {
    expect(html).toContain("@media (max-width: 1200px)");
    expect(html).toContain('grid-template-areas: "brand matter theme" "pills pills pills";');
  });

  it("scrims the modal and reduces motion in ONE universal block", () => {
    expect(html).toContain("--scrim: rgba(34, 31, 25, .55);");
    expect(html).toContain("--scrim: rgba(6, 5, 4, .70);");
    expect(html).toContain("background: var(--scrim);\n  backdrop-filter: blur(2px);");
    expect(html).toContain("animation-iteration-count: 1 !important;");
    expect(html).toContain("transition-duration: 1ms !important;");
    expect(html).toContain("html { scroll-behavior: auto; }");
  });

  it("never hides the UDF 'deneysel' tag at any breakpoint", () => {
    expect(html).not.toContain(".edacts a.dl.udf .tag { display: none; }");
    expect(html).toContain(".edacts a.dl.udf .tag { display: inline;");
  });
});

describe("W14 B-10 · silent upload failure, twin matter, dead active matter", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("reports an upload failure to the CALLING view, not the hidden files pane", () => {
    expect(html).toContain("function fileErrorCard(fileName, err, httpStatus, host)");
    expect(html).toContain('errorHost: function () { return document.getElementById("matterupload-errors"); }');
    expect(html).toContain('upErr.id = "matterupload-errors"');
    // The failure survives the caller's own re-render (refreshMatterPage is async).
    expect(html).toContain("var lastUploadFailures = { matterId: null, list: [] };");
    expect(html).toContain("lastUploadFailures.matterId === m.id");
  });

  it("never lets a failed upload end silently and never paints a partial one green", () => {
    expect(html).toContain("function uploadFailureLine(failures, total)");
    expect(html).toContain('" yüklenemedi — "');
    expect(html).toContain('toast(uploadFailureLine(failures, total), "bad")');
    expect(html).toContain('uploadFailureLine(failures, total), "warn")');
    expect(html).toContain("if (okCount === total) {");
    expect(html).not.toContain('if (okCount) {\n        toast(okCount + "/" + total + " belge yüklendi"');
  });

  it("locks every record form against a double submit", () => {
    expect(html).toContain("function lockSubmit(key, button, busyText)");
    expect(html).toContain("if (submitLocks[key] === true) { return null; }");
    for (const key of [
      'lockSubmit("newmatter"', 'lockSubmit("settings"',
      'lockSubmit("deadline-compute"', 'lockSubmit("draft-create"',
    ]) {
      expect(html).toContain(key);
    }
    expect(html).toContain("if (release === null) { return; }");
    expect(html).toContain("button.disabled = true;\n      if (busyText) { button.textContent = busyText; }");
  });

  it("warns before opening a second matter with the same title or docket number", () => {
    expect(html).toContain("function duplicateMatterOf(title, docketNo)");
    expect(html).toContain('hit = { m: m, why: "aynı başlık" }');
    expect(html).toContain('hit = { m: m, why: "aynı esas numarası" }');
    expect(html).toContain("Bu başlıkla açık bir dosyanız zaten var");
    expect(html).toContain("Yine de yeni dosya aç");
  });

  it("prunes the selector to GET /v1/matters and forgets a dead active matter", () => {
    expect(html).toContain("function forgetActiveMatter()");
    expect(html).toContain("function noticeMatterNotFound(body)");
    expect(html).toContain('body.error.kind === "MATTER_NOT_FOUND"');
    expect(html).toContain("if (activeMatter && !seen && mattersLoaded) { forgetActiveMatter(); }");
    expect(html).toContain("Aktif dosya artık yok:");
    // the old fallback that re-added a server-unknown matter to the picker
    expect(html).not.toContain('o2.textContent = "Dosya: " + cpTruncate(activeMatter.title, 40);');
    expect(html).toContain("var mattersLoaded = false;");
  });
});

describe("W14 B-21 · document × question grid (tabular review)", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("ships the grid view, hash-routed and argument-less", () => {
    expect(html).toContain('id="view-izgara"');
    // W14 B2 widened the map (six more hidden views); the grid's own entries stay.
    expect(html).toContain('dosya: "dosyalarim", belge: "belgeler", izgara: "arastir"');
    expect(html).toContain("izgara: true");
    expect(html).toContain('if (name === "izgara") { openGrid(); }');
  });

  it("drives the grid off the EXISTING answer endpoint, one cell per request", () => {
    for (const fn of [
      "function openGrid()", "function runGrid()", "function renderGridTable()",
      "function gridCellOf(data)", "function gridCsv()", "function finishGrid(",
    ]) {
      expect(html).toContain(fn);
    }
    expect(html).toContain("filters: { fileIds: [job.file.fileId], includeCorpus: false }");
    expect(html).toContain('postJson("/v1/answer", payload)');
    expect(html).toContain("gridState.cancelled = true;");
    expect(html).toContain("GRID_MAX_QUESTIONS = 6");
  });

  it("never leaves a cell blank and anchors a filled cell to its source offset", () => {
    // W15 şerit E: "kapsanmadı" uydurma bir durum adıydı; hücre yine BOŞ
    // KALMAZ, ama artık ne olduğunu tam cümleyle söyler.
    // W21 #18: the old lock pinned a whole-document "not found" drawn from the retrieved passages only; CB3 names what was examined.
    expect(html).toContain('"Bu soru için getirilen pasajlarda karşılık bulunamadı; belgenin tamamı taranmadı."');
    // W15 şerit E: "kapsanmadı" edilgen ve uydurma bir durum adıydı; hücre
    // artık sorunun neden cevapsız kaldığını tam cümleyle söylüyor.
    // W21 #18: "şu sözcüklerin geçtiği bir yer yok" claimed the whole document was scanned; the browser never scans it (CB3).
    expect(html).toContain('"Bu soru için getirilen pasajlarda karşılığı bulunamadı — bu pasajlarda şu sözcükler geçmiyor: "');
    expect(html).toContain("gotoDocument(f.fileId, { focusChunk: cell.chunkId });");
    expect(html).toContain("if (opts.focusChunk) { setTimeout(function () { highlightChunk(opts.focusChunk); }, 80); }");
    // showView used to pass {} and kill docPage.pendingOpts entirely
    expect(html).toContain('if (name === "belge") { openDocument(arg); }');
    expect(html).toContain('" · konum " + cell.startChar + "–" + cell.endChar');
  });

  it("exports the grid with every cell's source as its own column", () => {
    // W15 şerit E: sütun adları avukatın gördüğü sözcüklerdir; "Unicode" ve
    // "SHA-256" teknik adları Sözlük'e taşındı. Ölçülen davranış aynı: her
    // hücrenin kaynağı KENDİ sütunundadır ve hiçbiri düşürülmedi.
    // W21 (#19): "Belge durumu" is appended LAST, as in the server export; the
    // nine W15 columns keep their names and positions.
    expect(html).toContain('["Belge", "Belge kimliği", "Soru", "Durum", "Cevap", "Kaynak pasaj", "Metindeki yeri", "Alıntının parmak izi", "Araştırma no", "Belge durumu"]');
    expect(html).toContain('a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(');
    // W15 şerit E: "CSV" ve "pano" bilgisayar diliydi; ölçülen davranış aynı —
    // tablo panoya kopyalanabiliyor ve dosya olarak indirilebiliyor.
    expect(html).toContain("Tabloyu kopyala — Excel'e yapıştırın");
    expect(html).toContain("Tabloyu indir (Excel'de açılır)");
  });
});

describe("W14 B-22 · named work cards (the vaporware gate)", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("starts the question box EMPTY and leaves the demo question in the examples strip", () => {
    expect(html).toContain('<textarea id="q" name="q" spellcheck="false" placeholder="Örn. TCK m. 157 dolandırıcılık suçunun cezası nedir?"></textarea>');
    expect(html).toContain("Örnek sorular");
    expect(html).toContain("Değişiklik öncesi (1–5 yıl, 2025)");
  });

  it("shows at least eight named jobs, each on an endpoint that exists today", () => {
    expect(html).toContain('id="workcards"');
    expect(html).toContain("function renderWorkCards()");
    // W15 şerit D · adım 22: kartlar ÇIKTININ değil İŞİN adıyla yazılıyor ve
    // üç aileye ayrılıyor. İki kart düştü ("Hukukî soru sor" — soru kutusu
    // artık ekranın en üstünde; "Takvim ve duruşma hazırlığı" — Dosyalarım'ın
    // süre panelindeki "Takvimi aç" düğmesi zaten canlı giriş noktası).
    const titles = [
      "Belgeyi özetle", "Tarih sırası çıkar", "Aynı soruyu birçok belgeye sor",
      "Sözleşmeyi kontrol listemle karşılaştır",
      "Karar ve mevzuat ara", "Aleyhe kararları da tara", "Resmî kaynaklarda araştır",
      "Hangi kaynaklara bakabiliyoruz?",
      "Süre hesapla", "Harç ve gider hesapla", "Dilekçemdeki atıfları denetle",
      "Dilekçe taslağı hazırla", "Kayıtlı araştırmalarım",
    ];
    for (const t of titles) expect(html).toContain(`title: "${t}"`);
    expect(titles.length).toBeGreaterThanOrEqual(8);
    // Hiçbir gizli görünüm yetim kalmadı: ızgara, karar-ara, denetim, harç,
    // sözleşme ve kapsam görünümlerinin dosyadaki tek girişi bu kartlardır.
    for (const view of ["izgara", "karar-ara", "denetim", "harc", "sozlesme", "kapsam"]) {
      expect(html).toContain(`gotoView("${view}")`);
    }
    // Üç aile ve "Hazır işler" çekmecesi.
    for (const fam of ["Belgelerimle çalış", "Karar ve mevzuat bul", "Hesap ve denetim"]) {
      expect(html).toContain(`label: "${fam}"`);
    }
    expect(html).toContain("<summary>Hazır işler</summary>");
    // Avukat işini çıktı biçimine göre seçmez: "Çıktı:" satırları kalktı.
    expect(html).not.toContain('"Çıktı: "');
  });

  it("keeps the vaporware gate: an unavailable job is disabled with its reason", () => {
    expect(html).toContain('typeof card.blocked === "function" ? card.blocked() : null');
    // W15 şerit D · adım 22: kapı aynı kapı — çalışmayan iş DEVRE DIŞI çizilir
    // ve gerekçesini söyler. Değişen tek şey gerekçenin NEREDE durduğu: eskiden
    // yalnız fare ipucundaydı (dokunmatik ekranda ve klavyeyle görünmezdi) ve
    // kartın ne yaptığını anlatan satırın YERİNE geçiyordu; artık o satırın
    // altında, kendi görünür satırında durur.
    expect(html).toContain('b.appendChild(el("span", "wl", card.line));');
    // W15 şerit E (yapısal b): gerekçe tam opak kalır ve önünde sabit
    // "Şu an kullanılamıyor — " öneki durur.
    expect(html).toContain('b.appendChild(el("span", "wb", "Şu an kullanılamıyor — " + why));');
    expect(html).toContain("button.workcard[disabled] .wb { opacity: 1; }");
    expect(html).toContain("Canlı araştırma şu an kapalı. ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın.");
    expect(html).toContain("Önce Belgeler'e bir belge yükleyin.");
    // The vaporware gate is about ENDPOINTS, not names. The one endpoint the
    // console asked for and that has NOT landed is the grid's DOCX export
    // (W14-L-CONSOLE §6.1, still open in W14-L-FIX §8): the page must not
    // reference it anywhere, so no control can be drawn for it.
    expect(html).not.toContain("/v1/exports/grid");
    // Nor for the contract-review DOCX export, which also has no HTTP endpoint
    // (W14-L-FIX §11.6): the CLI produces it, the server does not serve it.
    expect(html).not.toContain("inceleme-docx");
  });
});

describe("W14 B-27 · warning budget, machine dictionary, undefined terms", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("declares the budget and routes every visible warning sentence through it", () => {
    expect(html).toContain("var WARN_BUDGET_BLOCKS = 4;");
    expect(html).toContain("var WARN_BUDGET_SENTENCES = 8;");
    expect(html).toContain("function noticeLine(box, cls, text)");
    // no sentence is written twice, and the overflow leaves the main flow
    expect(html).toContain("if (!key || answerNotice.seen[key] === true) { return false; }");
    expect(html).toContain("answerNotice.overflow.push(key);");
    expect(html).toContain("function beginAnswerNotices()");
    expect(html).toContain("beginAnswerNotices();");
  });

  it("builds exactly the three fixed blocks plus the conditional abstention block", () => {
    expect(html).toContain('el("section", "verdict warnblock " + st[1])');
    expect(html).toContain('el("section", "card answermeta warnblock")');
    expect(html).toContain('el("section", "card warnblock warncard")');
    expect(html).toContain('el("section", "abstain-panel warnblock")');
    // the duplicated full-width "Kesinleştirilemez" band is gone
    expect(html).not.toContain('"Bu cevap KESİNLEŞTİRİLEMEZ: en az bir doğrulama başarısız. "');
    // …its sentence now lives once, inside the folded warnings card
    expect(html).toContain("Bu cevap KESİNLEŞTİRİLEMEZ: aşağıdaki gerekçeleri okumadan kullanmayın.");
    expect(html).toContain('fold.appendChild(el("summary", null, "Uyarılar ve doğrulama gerekçeleri ("');
  });

  it("keeps raw machine codes out of the main flow", () => {
    expect(html).toContain("function warnGroupList(codes, opts)");
    expect(html).toContain("var withRaw = !!(opts && opts.raw === true);");
    expect(html).toContain("if (withRaw && g.raws.length) {");
    expect(html).toContain("function observedReasonTR(reason, withRaw)");
    // both raw-enabled call sites are inside a <details>
    // W21: the fold also passes whether claims were written, so a budget spent AFTER
    // drafting is not worded as "tespit yazımı eksik bırakıldı"; the raw codes still fold.
    expect(html).toContain("warnGroupList(data.warnings, { raw: true, claimsWritten: (data.claims || []).length > 0 })");
    expect(html).toContain("warnGroupList(data.reasons, { raw: true, claimsWritten: (data.claims || []).length > 0 })");
    expect(html).toContain('obsTech.appendChild(el("summary", null, "Teknik ayrıntılar — ham kodlar"))');
    expect(html).toContain('rejDet.appendChild(el("summary", null, "Teknik ayrıntılar — kimlik ve ham gerekçe"))');
    // the intent enum no longer trails the Turkish name in the main flow
    expect(html).not.toContain('" (" + cov.scope.intent + ") — " + cov.scope.rationale');
  });

  it("keeps UUIDs and Unicode offsets off the document page's main flow", () => {
    expect(html).toContain(".chunkline .tech { display: none; }");
    expect(html).toContain("#doc-text.showtech .chunkline .tech { display: inline; }");
    // W15 şerit E (yapısal f): tek "Teknik ayrıntı" kalıbı, varsayılan kapalı.
    expect(html).toContain("Teknik ayrıntı — destek için (bölüm kimliği ve metindeki yer)");
  });

  it("de-duplicates the contrary-authority table by DOCUMENT", () => {
    expect(html).toContain("var seenDoc = {};");
    expect(html).toContain("seenDoc[key].hits += 1;");
    expect(html).toContain('"Kaç aramada"');
  });

  it("defines every term it puts on the lawyer's screen", () => {
    // W15 adım 4: TERM_TR dizgeden NESNEYE çevrildi ({ad, tanim, neden?, teknik?,
    // nerede?}) çünkü aynı tanımın hem satır içi "?" kartını hem Sözlük ekranını
    // beslemesi gerekiyor. Ölçülen davranış aynı: bu beş terimin tanımı vardır.
    for (const term of ["aktif dosya", "KAYNAKSIZ", "K-n", "sürüm", "deneysel"]) {
      const at = html.indexOf(`"${term}": {`);
      expect(at, `TERM_TR "${term}" maddesini taşımalı`).toBeGreaterThan(0);
      expect(html.slice(at, at + 700)).toContain("tanim:");
    }
    expect(html).toContain("function defineTerm(node, key)");
    expect(html).toContain('defineTerm(sel, "aktif dosya")');
    expect(html).toContain('defineTerm(chip("aktif dosya", "ok"), "aktif dosya")');
    expect(html).toContain('"KAYNAKSIZ")');
    expect(html).toContain('"K-n")');
    expect(html).toContain('"deneysel")');
  });

  it("states abstention as a fork in the road, never as a failure", () => {
    const m = html.match(/var ABSTAIN_NEUTRAL_TR\s*=\s*\n?\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]!).not.toMatch(/başarısız/);
    expect(m![1]!).toContain("Bu soru elinizdeki kaynaklarda karşılık bulmuyor");
    // W15 adım 12: dört çıkış yolu duruyor, her biri artık ne yaptığını
    // KENDİ satırında söylüyor (answerExit: düğme + açıklama satırı).
    expect(html).toContain('answerExit(ab, "Resmî kaynaklarda ara"');
    expect(html).toContain('answerExit(ab, "Belge yükle"');
    expect(html).toContain('answerExit(ab, "Soruyu daralt"');
    expect(html).toContain('answerExit(ab, "Değerlendirme tarihini değiştir"');
    // "önerilen" sabit yazılmaz: canlı araştırma kapalıyken avukat çalışmayan
    // düğmeye yollanmaz.
    expect(html).toContain('var liveOk = !!(health && health.mcp === "ok");');
    expect(html).toContain("recommended: liveOk");
    expect(html).toContain("recommended: !liveOk");
    // Sınanabilir cümle ve iki dallı NEDEN satırı (yedek cümle zorunlu).
    expect(html).toContain("Aşağıda hiçbir kaynak kartı ve hiçbir tespit yoktur.");
    expect(html).toContain("Neden: sorunuzdaki şu sözcüklerin taranan kaynaklarda karşılığı yok");
    expect(html).toContain("Neden: sorunuzun sözcükleri kaynaklarda geçiyor");
    // Sıfır sayan sayaç kalktı: "gösterilen kaynak kartı: 0 · üretilen
    // tespit: 0" avukata bir şey söylemiyordu ve ölçülmüş bir eksiklik gibi
    // okunuyordu. (Cümlenin kendisi yalnız koddaki gerekçe yorumunda kalır.)
    expect(html).not.toContain('el("p", "counts",');
    expect(html).not.toContain("Bu soruya mevcut korpusta doğrulanabilir kaynak bulunamadı.");
  });

  it("writes the upload disclaimer once per answer, not once per claim card", () => {
    expect(html).toContain("var UPLOAD_CLAIM_NOTE_TR =");
    expect(html).toContain('if (!currentUploadOnly) { box.appendChild(el("p", "conf-note", UPLOAD_CLAIM_NOTE_TR)); }');
    expect(html).toContain('if (currentUploadOnly) { noticeLine(box, "line setaside", UPLOAD_CLAIM_NOTE_TR); }');
  });

  it("says what SENTETİK means and surfaces a degraded retrieval lane", () => {
    expect(html).toContain("deneme belgeleri — örnek metin, gerçek karar değil");
    expect(html).toContain('/^RETRIEVAL_LANE_DEGRADED/.test(String(w))');
    expect(html).toContain('warnTR("RETRIEVAL_LANE_DEGRADED:").text');
  });
});

/* ====================================================================
 * W14 FAZ B2 (L-CONSOLE-B) — the six screens this wave landed.
 *
 * Every assertion below is about a control the console draws for an
 * endpoint that answered a REAL request during this wave's browser walk
 * (see W14-L-CONSOLE-B.md). The vaporware gate is the rule these tests
 * protect: a control whose endpoint does not answer is not drawn.
 * ================================================================== */
describe("W14 B2 · new screens", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("ships six hash-routed, argument-less views, each with its own back link", () => {
    for (const view of ["karar-ara", "denetim", "takvim", "kapsam", "harc", "sozlesme"]) {
      expect(html).toContain(`id="view-${view}"`);
      expect(html).toContain(`id="${view}-back"`);
    }
    for (const entry of ['"karar-ara": true', "denetim: true", "takvim: true", "kapsam: true", "harc: true", "sozlesme: true"]) {
      expect(html).toContain(entry);
    }
    for (const call of [
      'if (name === "karar-ara") { openKararAra(); }',
      'if (name === "denetim") { openDenetim(); }',
      'if (name === "takvim") { openTakvim(); }',
      'if (name === "kapsam") { openKapsam(); }',
      'if (name === "harc") { openHarc(); }',
      'if (name === "sozlesme") { openSozlesme(); }',
    ]) {
      expect(html).toContain(call);
    }
  });

  it("B-16 Karar ara: real filters, and a progress line with no percentage", () => {
    expect(html).toContain('getJson("/v1/sources/catalog")');
    // W14 M-UI: the call now also hands fetch the "Vazgeç" AbortSignal. The
    // contract this line pins is unchanged (this screen searches through
    // POST /v1/sources/search with the collected body) and the signal is
    // pinned on top of it, so the assertion got STRICTER, not looser.
    expect(html).toContain('sendJson("/v1/sources/search", "POST", body, busy.signal)');
    expect(html).toContain('sendJson("/v1/sources/fetch", "POST",');
    for (const field of [
      "body.exactPhrase = true", "body.excludeTerms = ex", "body.chamber =",
      "body.yearFrom =", "body.yearTo =", "body.decisionType =", "body.legislationNo =",
    ]) {
      expect(html).toContain(field);
    }
    // progress names the sources and counts calls; it never invents a percentage
    // W15 şerit E: kaynak seçilmemişken ekran ARTIK varsayım listesi yazmaz
    // ("Yargıtay · Danıştay" bir ölçüm değil, bir tahmindi). Ölçülen davranış
    // korunuyor: kaynaklar adlarıyla anılır, çağrı sayısı sayılır, yüzde
    // uydurulmaz — çağrı sayısı yalnız "Teknik ayrıntı" kabına indi.
    expect(html).toContain('el("b", null, "Şu kaynaklara soruluyor: ")');
    expect(html).toContain('"Kaynağa gönderilen çağrı: " + calls');
    expect(html).toContain("Arama ColleX'in varsayılan kaynaklarında yapılıyor.");
    expect(html).not.toContain('labels = ["Yargıtay", "Danıştay"]');
    expect(html).not.toContain("Math.round((done / total) * 100)");
    // a filter the selected sources do not support is DISABLED with its reason
    expect(html).toContain("Seçili kaynaklardan hiçbiri daire süzgecini desteklemiyor.");
    expect(html).toContain("Kanun no yalnız mevzuat kaynaklarında kullanılır.");
    // saved searches live in this browser and say so
    expect(html).toContain('var SAVED_SEARCH_KEY = "collex.console.savedsearches.v1";');
    expect(html).toContain("bu tarayıcıda saklanır");
  });

  it("B-16: a failed source is named and partial results are still drawn", () => {
    expect(html).toContain("function failedSourcesBlock(failed)");
    // W15 şerit E: "ulaşılamadı" ile "orada karar yok" ayrı cümlelerdir.
    expect(html).toContain('"Cevap veremeyen kaynaklar (" + failed.length + ") — bu liste eksiktir"');
    expect(html).toContain("Bu, oralarda karar olmadığı anlamına gelmez");
    // the empty case is never silent: two DIFFERENT sentences, never a blank list
    expect(html).toContain("Ulaşılabilen kaynaklardan künye gelmedi.");
    expect(html).toContain("Kaynaklar cevap verdi; sonuç gerçekten boş.");
    // the typed upstream error is shown verbatim, with the machine code in parens
    expect(html).toContain('el("h3", "fname", "Kaynaklara ulaşılamadı")');
    // W15 şerit E (yapısal f): makine kodu silinmedi, tek "Teknik ayrıntı"
    // kabına indi; ana akışta tek başına duran kod kalmaz.
    expect(html).toContain("techBox(card, [err.kind,");
  });

  it("B-16: rows are a LIST capped at 96 px, and a fetched card is hash-verified", () => {
    expect(html).toContain(".srclist { display: block;");
    expect(html).toContain("max-height: 96px;");
    expect(html).toContain("function fetchedSourceCard(payload)");
    expect(html).toContain("hashSpan(c.contentSha256");
    // a source URL outside the allow-list is NOT made clickable
    expect(html).toContain("Bu adres ColleX'in tanıdığı resmî kaynaklar arasında değil.");
    expect(html).toContain("adresi kopyalayıp tarayıcınıza kendiniz yapıştırabilirsiniz");
    // a failed library write is never silent
    expect(html).toContain("Belge yerel kütüphaneye yazılamadı; kartın kendisi ve alıntıları etkilenmedi.");
    // the snippet is labelled as NOT evidence
    expect(html).toContain("Aşağıdaki satırlar KÜNYEDİR, kanıt değildir");
    // W15 şerit E: "şüpheli talimat kalıbı" tanımsız uydurma bir terimdi;
    // avukat tehlikenin ne olduğunu ve ne yapacağını öğrenemiyordu.
    expect(html).toContain("programa iş yaptırmaya çalışan gizli bir yazı var gibi görünüyor");
    expect(html).toContain("içindeki yönergelere uymayın");
  });

  it("B-13 Atıf Denetim Raporu: three buckets kept apart, künye cell left EMPTY", () => {
    expect(html).toContain('sendJson("/v1/citation-audit/preview", "POST", { text: text })');
    // W14 M-UI: same endpoint, same body — plus the "Vazgeç" AbortSignal.
    expect(html).toContain('sendJson("/v1/citation-audit", "POST", body, busy.signal)');
    expect(html).toContain('["FOUND", "found", "Bulundu"]');
    expect(html).toContain('["NOT_FOUND", "notfound", "Bulunamadı"]');
    expect(html).toContain('["UNCERTAIN", "uncertain", "Belirsiz"]');
    // each bucket gets its own colour; two are never the same
    expect(html).toContain(".audstate.found { color: var(--ok); }");
    expect(html).toContain(".audstate.notfound { color: var(--bad); }");
    expect(html).toContain(".audstate.uncertain { color: var(--ink-faint); }");
    // an unresolved künye is an EMPTY cell — never "?", "—" or a guess
    expect(html).toContain('var ck = el("td", "kunye", r.kunye || "");');
    expect(html).toContain("Künye çözümlenemedi — sistem künye uydurmaz.");
    expect(html).not.toContain('r.kunye || "—"');
    expect(html).not.toContain('r.kunye || "?"');
    // the audit date is the PETITION's date and it is required
    expect(html).toContain("Dilekçenin tarihi (zorunlu)");
    expect(html).toContain('"Yürürlük — " + fmtDateTR(body.asOf) + " tarihine göre"');
    expect(html).toContain('toast("Dilekçenin tarihini girin.", "warn")');
    // one-sentence summary + audit timestamp
    expect(html).toContain("function auditSentence(t)");
    expect(html).toContain('metaRow(meta, "Denetim tarihi", fmtDateTimeTR(body.generatedAt)');
    // an empty bucket is still drawn, so "0 bulunamadı" cannot be mistaken for "not checked"
    // W15 şerit E: "kova" (bucket) yazılım terimiydi; ölçülen davranış aynı —
    // boş bir başlık sessiz kalmaz, neden boş olduğunu söyler.
    expect(html).toContain("Bu başlıkta atıf yok — taradığımız kaynaklarda karşılığı bulunamayan atıf çıkmadı.");
  });

  it("B-13: the DOCX report button exists only where the export endpoint answers", () => {
    expect(html).toContain('"/v1/drafts/" + enc(denetimState.draftId) + "/export?format=denetim-docx"');
    // pasted text has no draft, so the button is disabled WITH its reason
    // W15 şerit E: "dışa aktarım ucu" makine diliydi ve gerekçe yalnız fare
    // ipucundaydı. Ölçülen davranış aynı: düğme kapalıdır ve nedenini söyler —
    // ama artık görünür bir satırda söyler.
    expect(html).toContain("Word raporu yalnız ColleX'te hazırlanmış taslaklar için üretilebilir.");
    // the draft editor path audits the FULL draft text, not chunk previews
    expect(html).toContain("function auditDraftFromEditor()");
    expect(html).toContain('ghostBtn("Atıfları denetle", auditDraftFromEditor)');
    // the document path says WHAT it audited, because previews are capped
    // W15 şerit E: "bölüm önizlemesi" ve "karakter" ürünün iç kavramlarıydı;
    // ölçülen davranış aynı — denetimin belgenin TAMAMI üzerinde yapılmadığı
    // ve tam sonuç için ne yapılacağı ekranda yazar.
    expect(html).toContain("Bu denetim, belgenin TAMAMI üzerinde değil, her bölümünün ilk birkaç satırı üzerinde yapıldı");
    expect(html).toContain("Tam sonuç için belgenin tam metnini aşağıdaki kutuya yapıştırın.");
    // W15 şerit E: aynı dürüstlük, avukat cümlesiyle.
    expect(html).toContain("Eksik metin bir atfı gözden kaçırabilir; olmayan bir hükmü ise asla var göstermez.");
  });

  it("B-17 Takvim: month grid, hearing prep, .ics, overdue vs next kept apart", () => {
    expect(html).toContain('getJson("/v1/matters/deadlines?from=" + w.from + "&until=" + w.until + "&include=computed")');
    expect(html).toContain('href="/v1/matters/calendar.ics"');
    // W15 şerit E: ".ics" ekrandan kalktı (kanonik sözlük: "takvim dosyası").
    // Ölçülen davranış aynı: dışa aktarmanın ne olduğu ve hangi programın
    // açtığı ekranda yazar, ve tek seferlik olduğu söylenir.
    expect(html).toContain("Outlook ve Google Takvim bu dosyayı açar");
    expect(html).toContain("sonradan eklenen süreler için yeniden indirin");
    // W15 şerit E (yapısal e): gizlenemez süre uyarısı iki ekranda da var.
    expect(html).toContain("Buradaki süreler ColleX'in hesabıdır; bağlayıcı değildir. Her süreyi dosyanızdaki tebliğ tarihinden ve ilgili maddeden doğrulayın.");
    expect(html).toContain('"/v1/matters/" + enc(it.row.matterId) + "/hearings/" + enc(it.row.itemId) + "/prep"');
    expect(html).toContain('el("div", "fieldlabel", "Açık süreler (" + (p.openDeadlines || []).length + ")")');
    expect(html).toContain('el("div", "fieldlabel", "Son belgeler")');
    expect(html).toContain('el("div", "fieldlabel", "Dosya kronolojisi")');
    // hearing sub-kinds and statuses are Turkish labels over ASCII machine codes
    expect(html).toContain('var HEARING_KIND_TR = { durusma: "Duruşma", kesif: "Keşif", "e-durusma": "e-Duruşma" };');
    // an OVERDUE deadline is never read as "the next one"
    expect(html).toContain('overdue ? "En yakın GECİKMİŞ süre" : "Sonraki süre"');
    // and the home panel looks BACKWARDS too, or an overdue deadline is invisible
    expect(html).toContain("var from = addDaysIso(todayIso(), -90);");
    expect(html).toContain('el("div", "fieldlabel", "Gecikmiş (" + late + ")")');
  });

  it("B-14 Kapsam: unmeasured fields say oelcuelmedi, never zero", () => {
    expect(html).toContain('getJson("/v1/sources/manifest")');
    expect(html).toContain('s.sonErisim ? fmtDateTimeTR(s.sonErisim) : "ölçülmedi"');
    expect(html).toContain('var text = "ölçülmedi";');
    expect(html).toContain("Ölçülmemiş her alan “ölçülmedi” der; sıfır yazılmaz.");
    // the honesty note and the gap list are printed verbatim from the endpoint
    expect(html).toContain('el("p", "note-p", m.durustlukNotu || "")');
    expect(html).toContain('box.appendChild(el("b", null, g.baslik || ""));');
    // NOT_YET_WIRED tools are listed first
    expect(html).toContain('a.state === "NOT_YET_WIRED" ? 0 : 1');
  });

  it("B-03 Yedekleme: state, the verbatim warning, and a restore explanation", () => {
    expect(html).toContain('getJson("/v1/backup")');
    expect(html).toContain('sendJson("/v1/backup", "POST", {})');
    // W15 şerit E: aynı dürüst uyarı, ama artık bir sonraki adımı da veriyor.
    expect(html).toContain("Henüz hiç yedek alınmadı. Bilgisayarınız bozulursa dosyalarınızın kopyası olmaz");
    // W15 şerit E: "BitLocker'lı klasör" tanımsız bir Windows özelliğiydi ve
    // cümle avukatın bu ekrandan yapamayacağı bir işi emrediyordu. Ölçülen
    // davranış aynı: yedeğin müvekkil verisi taşıdığı ve korunması gerektiği
    // ekranda yazar, ve artık NE YAPILACAĞI da yazar.
    expect(html).toContain("Bu klasörde müvekkil belgeleri var.");
    expect(html).toContain("şifreyle korunan bir diske alın");
    // W15 şerit E: damga sonucunu ve yapılacak işi de söylüyor.
    expect(html).toContain('chip("son bir haftadır yedek alınmadı — yenileyin", "warn")');
    // W15 şerit E: "sunucu", "yapılandırılmadı" ve çıplak .cmd dosya adı
    // kalktı. Ölçülen davranış aynı: yedekleme kapalıysa ekran avukata BAŞKA
    // BİR YOL gösterir, ve geri yüklemenin klasörü bölmeden yapılacağı yazar.
    expect(html).toContain("Yedekleme bu ekrandan açılmamış.");
    expect(html).toContain("“ColleX Yedekle” kısayolunu çift tıklayarak yedek alabilirsiniz");
    expect(html).toContain("Bu klasörü açıp içinden tek tek dosya kopyalamayın");
    expect(html).toContain("Bir yedekleme zaten sürüyor; bitmesini bekleyin.");
  });

  it("B-35 Harç: an unknown tariff amount is ASKED FOR, never invented", () => {
    expect(html).toContain('getJson("/v1/fees/tariffs")');
    expect(html).toContain('sendJson("/v1/fees/compute", "POST", body)');
    // W15 şerit E: "tutar girilmeli" edilgendi ve kimin gireceğini söylemiyordu.
    // Ölçülen davranış aynı: bilinmeyen tutar UYDURULMAZ, avukattan istenir.
    expect(html).toContain('typeof s.amount === "number" ? fmtTL(s.amount) : "tarifeden siz gireceksiniz"');
    // W15 şerit E: "ColleX bunları uydurmaz" savunmacı bir cümleydi. Ölçülen
    // davranış aynı ve daha da açık: bilinmeyen tutar TAHMİN EDİLMEZ.
    expect(html).toContain("Bilinmeyen bir tutar tahmin edilmez");
    expect(html).toContain("eksik kalemler girilince hesaplanır");
    // W15 şerit E: damga NEYİN doğrulanmadığını söylemiyordu; avukat "bu harç
    // yanlış" diye okuyabiliyordu. Ölçülen davranış aynı: doğrulanmamış tarife
    // satırı işaretlenir.
    expect(html).toContain('chip("tarife metni ile karşılaştırılmadı", "warn")');
    expect(html).toContain("body.overrides = ov;");
    expect(html).toContain('el("p", "note-p", body.disclaimer || "")');
  });

  it("B-24 Sözleşme: rule-based, and the notices are printed verbatim", () => {
    expect(html).toContain('getJson("/v1/contracts/checklists")');
    expect(html).toContain('sendJson("/v1/contracts/checklists/" + enc(cl.id), "PUT", cl)');
    expect(html).toContain('sendJson("/v1/contracts/review", "POST", body)');
    expect(html).toContain('fetch("/v1/contracts/review/export"');
    expect(html).toContain("DOCX raporu indir");
    // W15 şerit E: "kural tabanlı" mühendis ifadesiydi; söylenen şey aynı.
    expect(html).toContain("Yapay zekâ kullanılmaz: metin, sizin hazırladığınız kontrol listesiyle karşılaştırılır. Hukukî değerlendirme yapılmaz.");
    expect(html).toContain('el("h3", "fname", "Bu incelemeyi nasıl okumalı")');
    // an unsourced observation is styled as an observation, never as a "risk"
    expect(html).toContain('"obsline" + (x.o.sourced === false ? " unsourced" : "")');
    expect(html).toContain(".obsline.unsourced { color: var(--bad);");
    // checklist editor labels (W14-L-EVID §8.6)
    // W15 şerit E: "zayıf ifade" ve "Notum" tanımsız etiketlerdi; her ikisi de
    // artık ne yaptıklarını kendi etiketlerinde söylüyor.
    // 2026-09-27: the weak-term label said ANY weak hit made the row
    // "şüpheli"; the engine (and ChecklistItem.weakTerms) makes it BELİRSİZ
    // only when no strong term matched — the label now says what runs.
    for (const label of ["Aranacak ifadeler (virgülle)",
      "Şüpheli ifadeler — aranan ifadelerin hiçbiri geçmez de yalnızca bunlardan biri geçerse madde “var” değil “belirsiz” işaretlenir",
      "Kendi notunuz (isteğe bağlı — inceleme sonucunda bu satırın altında görünür)"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("“kesin var” değil “şüpheli”");
  });

  it("B-24 Sözleşme (2026-09-27): counts checklist items, quotes the contract, drops nothing", () => {
    // The VAR chip counts CHECKLIST ITEMS; "N madde sözleşmede bulundu" read
    // as a count of the contract's clauses.
    expect(html).toContain('chip((t.VAR || 0) + " kontrol maddesinin karşılığı bulundu", "ok")');
    expect(html).not.toContain('" madde sözleşmede bulundu"');
    // the section-aware label and the contract's own sentence, as text
    expect(html).toContain("var labels = f.clauseLabels || [];");
    expect(html).toContain('(f.matches || []).forEach(function (m) {');
    expect(html).toContain('mid.appendChild(el("div", "clexcerpt" + (m.negated ? " neg" : ""),');
    expect(html).toContain('if (f.reason) { mid.appendChild(el("div", "why", f.reason)); }');
    expect(html).toContain(".clexcerpt { font-size: var(--fs-xs);");
    // an observation whose clause does not exist is shown, never dropped
    expect(html).toContain("(body.unattachedObservations || []).forEach(function (o) {");
    expect(html).toContain('obs.push({ where: c.label || ("Madde " + c.clauseNumber), o: o });');
  });

  it("B-19 klasör bırakma: recursive walk, unsupported files named not swallowed", () => {
    expect(html).toContain("function collectDroppedEntries(dataTransfer)");
    expect(html).toContain("function walkEntries(entries)");
    expect(html).toContain("webkitGetAsEntry");
    expect(html).toContain("var BATCH_EXT = /\\.(pdf|docx|txt|udf)$/i;");
    expect(html).toContain('" dosya atlandı (desteklenmeyen tür)"');
    expect(html).toContain('id="folderinput"');
  });

  it("B-30 / B-37: original bytes download, ambiguous references kept separate", () => {
    expect(html).toContain('orig.href = "/v1/files/" + enc(f.fileId) + "/original";');
    expect(html).toContain('el("a", "dl alt", "Aslını indir")');
    expect(html).toContain('panelHead(box, "Eşleşen atıflar")');
    expect(html).toContain('panelHead(box, "Belirsiz atıflar")');
    expect(html).toContain("Kanun bağlamı bulunamadı — sözleşme madde numarası olabilir.");
  });
});

describe("W14 B2 · design system completion", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("declares the spacing and type scales as tokens", () => {
    for (const token of ["--sp-1:", "--sp-4:", "--sp-7:", "--fs-xs:", "--fs-md:", "--fs-2xl:", "--lh-body:"]) {
      expect(html).toContain(token);
    }
  });

  it("makes the 390 px shell one scrollable strip per row, not a wrapped block", () => {
    // both the tabs and the status pills stay on ONE line and scroll
    expect(html).toContain("nav.views, body.compact nav.views {\n    display: flex; flex-wrap: nowrap; overflow-x: auto;");
    expect(html).toContain(".topbar .pills, body.compact .topbar .pills {\n    display: flex; flex-wrap: nowrap; overflow-x: auto;");
    // and they SAY they scroll (right-edge fade), instead of silently clipping
    expect(html).toContain("mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 22px), transparent 100%);");
    // a wide table scrolls inside its own box; the page never does
    expect(html).toContain(".tablescroll { overflow-x: auto; max-width: 100%; }");
    expect(html).toContain(".audwrap > * { min-width: 0; }");
    expect(html).toContain("Tablo geniştir — yana kaydırarak bütün sütunları görebilirsiniz.");
  });

  it("template cards are scannable: name + one line + meta, with search and filter", () => {
    expect(html).toContain('search.placeholder = "Şablon ara — ad ya da amaç";');
    expect(html).toContain("function firstSentence(text)");
    expect(html).toContain('el("p", "purpose", purpose)');
    expect(html).toContain('" zorunlu alan"');
    // the monospace "Zorunlu: …" wall is no longer inside the card
    expect(html).toContain("button.tpl .req { display: none; }");
    expect(html).not.toContain('el("div", "req", "Zorunlu: "');
    // Turkish-aware search folding (İ/I/ı/i)
    expect(html).toContain("function shadowFold(text)");
  });

  it("an in-page anchor never throws the reader out of the view they are in", () => {
    // Measured defect (02.09.2026): clicking [K-1] set the hash to "#kaynak-1",
    // parseHash saw an unknown view and fell back to "dosyalarim" — the lawyer
    // was ejected from the answer by clicking one of its own citations.
    expect(html).toContain("function inPageAnchorId(raw)");
    expect(html).toContain("var anchorId = inPageAnchorId(raw);");
    expect(html).toContain("if (anchorId) {\n      revealAnchorTarget(anchorId);\n      return;\n    }");
    expect(html).toContain("function revealAnchorTarget(id)");
    // an anchor is only "in-page" when the element actually exists
    expect(html).toContain("return document.getElementById(id) ? id : null;");
  });

  it("UXAUDIT P1-6: the fixed boilerplate is written once, extra sources collapse", () => {
    // the two constant sentences move OUT of every card into one section line
    expect(html).toContain('out.appendChild(el("p", "srcintro",');
    expect(html).toContain("if (!(opts && opts.sharedBoilerplate === true)) {");
    expect(html).toContain("sharedBoilerplate: true");
    // first three sources open, the rest one click away — none dropped
    expect(html).toContain("var SRC_OPEN = 3;");
    expect(html).toContain('card.setAttribute("data-extra-src", "1");');
    expect(html).toContain('ghostBtn("Diğer " + extra + " kaynağı göster"');
    // and a citation into a collapsed source opens it
    expect(html).toContain('Array.prototype.forEach.call(host.querySelectorAll("[data-extra-src]"), function (n) { n.hidden = false; });');
  });

  it("the first-run card says what the product DOES and drives a live checklist", () => {
    const m = html.match(/function maybeWelcome\(\)[\s\S]*?\n  \}\n/);
    expect(m).not.toBeNull();
    const body = m![0]!;
    // first sentence is the product, not a privacy warning
    expect(body).toContain("WELCOME_TITLE_TR");
    expect(body).not.toContain("Anthropic'e gönderir");
    expect(body).toContain("welcomeSteps()");
    expect(html).toContain("function welcomeSteps()");
    // W15 lane A: the title now promises what the lawyer can VERIFY, in the
    // wave's canonical vocabulary — no "SHA-256", no "korpus".
    expect(html).toContain('var WELCOME_TITLE_TR = "ColleX — her cümlenin altında dayanağı yazar";');
    // each step is checked off REAL state, not a counter
    expect(html).toContain("var hasProfile = !!(settingsCache && settingsCache.profile && settingsCache.profile.ad);");
    expect(html).toContain("var hasMatter = mattersCache.length > 0;");
    expect(html).toContain("var hasFile = Object.keys(filesIndex).length > 0;");
    // SCR-14 budget: the card's ENTIRE prose lives in three constants and is
    // at most 90 words. (The status line below them is generated, one line.)
    const prose = html.match(
      /var WELCOME_TITLE_TR = [\s\S]*?var WELCOME_STEPS_TR = \[[\s\S]*?\];/,
    );
    expect(prose).not.toBeNull();
    const quoted = prose![0]!.match(/"[^"]+"/g) ?? [];
    const wordCount = quoted.join(" ").replace(/"/g, "").split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(90);
    expect(wordCount).toBeGreaterThan(20);
  });

  // ------------------------------------------------------------------ //
  // W15 lane A — the two explanation screens and the welcome card.      //
  // ------------------------------------------------------------------ //

  it("keeps the honesty paragraph in its own constant under its own 45-word ceiling", () => {
    const m = html.match(/var WELCOME_LIMITS_TR = [\s\S]*?;\n/);
    expect(m).not.toBeNull();
    const quoted = m![0]!.match(/"[^"]+"/g) ?? [];
    const text = quoted.join(" ").replace(/"/g, "");
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(45);
    expect(wordCount).toBeGreaterThan(10);
    // the honesty contract: no percentage, no guarantee, no outcome forecast,
    // and NOT the absolute claim that an unsourced sentence is never written
    expect(text).toContain("yüzde vermez");
    expect(text).toContain("garanti vermez");
    expect(text).toContain("KAYNAKSIZ diye işaretler");
    expect(text).toContain("Son kontrol her zaman sizindir");
    expect(text).not.toContain("hiç kurmaz");
    expect(html).toContain('card.appendChild(el("p", "wlimits", WELCOME_LIMITS_TR));');
  });

  it("writes the first-run system line in lawyer Turkish and never says 'hazır' for a demo or empty library", () => {
    const m = html.match(/function welcomeSystemLine\(\)[\s\S]*?\n  \}\n/);
    expect(m).not.toBeNull();
    const body = m![0]!;
    // the four branches the design names
    expect(body).toContain("Sistem durumu okunamadı — Ayarlar › Sistem durumu.");
    // …and that fallback fires on an UNANSWERED health call too: loadHealth
    // fills `health` with a placeholder object, which is fine for the badges
    // but would print "canlı araştırma kapalı" as if it had been measured.
    expect(body).toContain("if (!h || !healthKnown)");
    expect(html).toContain("healthKnown = !!got;");
    expect(body).toContain("hukuk kütüphanesi — DENEME BELGELERİ (gerçek mevzuat değil)");
    expect(body).toContain("hukuk kütüphanesi boş — şu an yalnız kendi yüklediğiniz belgelerde arayabilirsiniz");
    expect(html).toContain('ok: "kendi kayıtlarınız açık",');
    expect(body).toContain("bulut yapay zekâ ");
    // the invariant: the word "hazır" appears in NO branch of this line
    expect(body).not.toContain("hazır");
    // no engineering vocabulary survived — DB_STATE_TR's "şema eksik" is an
    // engineer's sentence, so this line has its own lawyer-Turkish map
    expect(body).not.toContain("DB_STATE_TR[");
    expect(html).toContain('missing: "kendi kayıtlarınız henüz kurulmadı",');
    expect(body).not.toContain("veritabanı");
    expect(body).not.toContain("korpus");
    // and an unmeasured count is never printed as 0
    expect(body).toContain("hukuk kütüphanesi sayılamadı");
    // the line is an explanation, not a warning: it is not a notice block
    expect(html).toContain('card.appendChild(el("p", "expl-def wsys", welcomeSystemLine()));');
  });

  it("keeps the welcome card's compact switch and hangs its visibility on a local key", () => {
    const m = html.match(/function maybeWelcome\(\)[\s\S]*?\n  \}\n/);
    expect(m).not.toBeNull();
    const body = m![0]!;
    // the compact state machine is untouched
    expect(body).toContain('document.body.classList.toggle("compact", !first);');
    // dismissal is remembered locally, and a failed settings call still draws
    expect(body).toContain("!welcomeSeen() && (known || (settingsCache === null && settingsFailed))");
    expect(html).toContain('var WELCOME_SEEN_KEY = "collex.welcome.seen";');
    expect(html).toContain("function dismissWelcome()");
    expect(html).toContain('writeStore(WELCOME_SEEN_KEY, "1");');
    // "show it again" really clears the key and redraws
    expect(html).toContain("function showWelcomeAgain()");
    expect(html).toContain("window.localStorage.removeItem(WELCOME_SEEN_KEY)");
    // and the top bar's menu item calls exactly that
    expect(html).toContain('["Karşılama kartını yeniden göster", function () { showWelcomeAgain(); }]');
  });

  it("leaves a one-line, dismissable guide bar once the welcome card is gone", () => {
    const m = html.match(/function drawGuideBar\(host\)[\s\S]*?\n  \}\n/);
    expect(m).not.toBeNull();
    const body = m![0]!;
    expect(html).toContain('var GUIDEBAR_KEY = "collex.guidebar.hidden";');
    // closed stays closed
    expect(body).toContain('if (readStore(GUIDEBAR_KEY) === "1") { return; }');
    expect(body).toContain('writeStore(GUIDEBAR_KEY, "1");');
    // and it is a route to both screens, not a warning
    expect(body).toContain('ghostBtn("Nasıl çalışır?", function () { gotoView("nasil"); })');
    expect(body).toContain('ghostBtn("Sözlük", function () { gotoView("sozluk"); })');
    expect(html).toContain(".guidebar {");
  });

  it("draws the 'Nasıl çalışır?' screen with all eight sections in lawyer Turkish", () => {
    expect(html).toContain("function openNasil()");
    const m = html.match(/function openNasil\(\)[\s\S]*?\n  \}\n/);
    const body = m![0]!;
    expect(body).toContain("ColleX nasıl çalışır?");
    expect(body).toContain("Beş dakikada okunur.");
    // 1 — one framed sentence
    expect(body).toContain("Bağlayamadığı tespiti yazmaz.");
    // 2..7 — the section headings
    expect(body).toContain("Bir sorunun yolculuğu");
    expect(body).toContain("Cevabın üstündeki etiket ne demek?");
    expect(body).toContain("Bu bir doğruluk garantisi değildir");
    expect(body).toContain("ColleX ne yapmaz");
    expect(body).toContain("Bir cevabı nasıl denetlersiniz?");
    expect(body).toContain("Verileriniz nerede duruyor?");
    // 8 — the FAQ uses the existing collapsed pattern
    expect(body).toContain("Sık sorulan beş soru");
    expect(body).toContain('el("details", "mini")');
    // the bottom bar
    expect(body).toContain('ghostBtn("Sözlüğü aç"');
    expect(body).toContain('ghostBtn("Karşılama ekranını yeniden göster", showWelcomeAgain, "small")');
    // KESİNLEŞTİRİLEMEZ is a SEPARATE axis, not a fifth status.
    // W15 şerit F: the sentence is no longer hand-written here — it is read
    // from TERM_TR, so the screen and the glossary cannot drift apart. The
    // MEASURED behaviour is unchanged: the same line, on the same screen.
    expect(body).toContain('var kesin = TERM_TR["KESİNLEŞTİRİLEMEZ"];');
    expect(body).toContain('el("p", "expl-def", kesin.ad + " — " + kesin.tanim + " " + kesin.neden)');
    expect(html).toContain('tanim: "İç kontrollerden biri sonuç veremedi.",');
    expect(html).toContain("var NASIL_ETIKET_TR");
    expect(html).toContain("DAYANAK BULUNAMADI (ÇEKİMSER) — Yeterli dayanak bulunamadığı için ColleX cevap yazmadı.");
    // the one explicit denial sentence stays on a permanent screen
    expect(html).toContain(
      "Bu bir doğruluk garantisi değildir — her tespiti kendi gözünüzle kaynağından okuyabilesiniz diye kurulmuş bir düzendir.",
    );
    // these are explanations, NOT warnings: they never pass through noticeLine
    expect(body).not.toContain("noticeLine(");
    expect(body).toContain('el("p", "expl-def"');
  });

  it("builds every glossary entry from TERM_TR and writes no second definition", () => {
    expect(html).toContain("function openSozluk()");
    expect(html).toContain("function glossItem(key)");
    const item = html.match(/function glossItem\(key\)[\s\S]*?\n  \}\n/)![0]!;
    // every visible part of an entry is read off the object — nothing typed twice
    expect(item).toContain("var t = TERM_TR[key];");
    expect(item).toContain('box.appendChild(el("b", "gt", t.ad));');
    expect(item).toContain('box.appendChild(el("p", null, t.tanim));');
    expect(item).toContain('"Neden önemli: " + t.neden');
    expect(item).toContain('"Nerede görürsünüz: " + t.nerede');
    expect(item).toContain('"(Teknik adı: " + t.teknik + ".)"');
    // each entry carries the anchor the inline "?" card deep-links to
    expect(item).toContain("box.id = termSlug(key);");
    // the search box filters as you type, over the whole entry
    expect(html).toContain('search.className = "tin search";');
    expect(html).toContain('search.placeholder = "Sözlükte ara — terim ya da kelime";');
    expect(html).toContain('search.addEventListener("input", function () { glossFilter = this.value; renderGloss(); });');
    // the empty result says what to DO, not just that nothing was found
    expect(html).toContain(
      '"Bu kelime sözlükte yok. Aradığınız şey bir ekranda geçiyorsa yanındaki ? düğmesine basın."',
    );
    // and the pending deep-link anchor is consumed exactly once
    const open = html.match(/function openSozluk\(\)[\s\S]*?\n  \}\n/)![0]!;
    expect(open).toContain("var anchor = pendingTermAnchor;");
    expect(open).toContain("pendingTermAnchor = null;");
  });

  it("carries at least 22 glossary terms and never shows the banned vocabulary as a heading", () => {
    const block = html.match(/var TERM_TR = \{[\s\S]*?\n  \};/)![0]!;
    const names = block.match(/\n      ad: "([^"]+)"/g) ?? [];
    expect(names.length).toBeGreaterThanOrEqual(22);
    // the canonical dictionary: the left column never becomes a heading
    const joined = names.join(" ");
    for (const banned of ["korpus", "SHA-256", "Unicode", "ABSTAIN", "chunk", "endpoint", "JSON"]) {
      expect(joined).not.toContain(banned);
    }
    // …but the technical name is not deleted; it lives one layer down
    expect(block).toContain('teknik: "SHA-256"');
    expect(block).toContain('teknik: "Unicode karakter sayımı"');
    expect(block).toContain('teknik: "JSON"');
  });

  it("routes to both explanation screens from the top bar, Ayarlar and the views map", () => {
    // hidden views, argument-free, highlighting Ayarlar
    expect(html).toContain('nasil: "ayarlar", sozluk: "ayarlar"');
    expect(html).toContain("nasil: true, sozluk: true");
    expect(html).toContain('if (name === "nasil") { openNasil(); }');
    expect(html).toContain('if (name === "sozluk") { openSozluk(); }');
    // the Ayarlar card sits ABOVE "Neyi tarıyoruz" and offers both doors
    const settings = html.slice(
      html.indexOf('<section class="card" aria-label="Nasıl çalışır">'),
      html.indexOf('<section class="card" aria-label="Verilerim nerede">'),
    );
    expect(settings).toContain("<h3 class=\"fname\">Nasıl çalışır?</h3>");
    expect(settings).toContain('id="nasil-open"');
    expect(settings).toContain('id="sozluk-open"');
    expect(settings.indexOf("Nasıl çalışır?")).toBeLessThan(settings.indexOf("Neyi tarıyoruz, neyi taramıyoruz?"));
    expect(settings).toContain(
      "ColleX'in ne yaptığını, ne yapmadığını ve bir cevabı nasıl denetleyeceğinizi beş dakikada anlatır.",
    );
    // the top-bar "?" menu is really wired and carries four screens + one action
    expect(html).toContain("function wireHelpMenu()");
    expect(html).toContain("wireHelpMenu();");
    expect(html).toContain('["Nasıl çalışır?", function () { gotoView("nasil"); }]');
    expect(html).toContain('["Sözlük", function () { gotoView("sozluk"); }]');
    expect(html).toContain('["Neyi tarıyoruz?", function () { gotoView("kapsam"); }]');
    // nothing opens itself: the menu is drawn only on a click
    const openMenu = html.match(/function openHelpMenu\(\)[\s\S]*?\n  \}\n/)![0]!;
    expect(openMenu).toContain("menu.hidden = false;");
    expect(html).toContain('btn.addEventListener("click", function (ev) {');
  });
});

/* ===================================================================== *
 * W14 — F-UI (phase C): the console findings of W14-L-VERIFY.
 *
 * Every claim below was measured in a real browser against a real server
 * (port 8973, collex_demo) before and after the fix; the numbers live in
 * W14-F-UI.md. What is pinned here is the CODE that produces them — plus,
 * where the claim is a COLOUR RATIO, the ratio itself, computed from the
 * token block so the number cannot drift away from the file.
 * ===================================================================== */

describe("W14 F-UI · V-5: a deadline computed with no matter is never lost", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("shows a real 'pick a matter' option instead of an empty selection", () => {
    // Measured defect: selectInput(mattersCache…, "") matched no option, so the
    // select reported value "" while LOOKING like a chosen matter, and
    // "Dosyaya kaydet" POSTed to /v1/matters//items -> 404.
    expect(html).toContain('var mopts = [["", "— dosya seçin —"]].concat(');
    expect(html).toContain('var preset = opts.matterId || (activeMatter ? activeMatter.id : "");');
    expect(html).not.toContain('var msel = selectInput(mattersCache.map(function (m) { return [m.id, m.title]; }),');
  });

  it("sends NO request when no matter is chosen, and keeps the calculation", () => {
    expect(html).toContain("if (!msel.value) { explainNoMatter(); return; }");
    expect(html).toContain("function explainNoMatter()");
    // the calculation stays on screen: the explanation repeats the computed date
    expect(html).toContain('"Hesaplanan son gün: " + (comp.dueDateTr || fmtDateTR(comp.dueDate))');
    expect(html).toContain("Bu pencere kapanmadı");
    // and the modal is closed only on a SUCCESSFUL save
    expect(html).toContain("if (item) { closeDocModal(); }");
  });

  it("offers both ways out: pick an existing matter, or open a new one here", () => {
    expect(html).toContain("Dosyayı aç ve süreyi kaydet");
    expect(html).toContain('sendJson("/v1/matters", "POST", { title: t, kind: "dava" })');
    expect(html).toContain("Dosyalarım'a git (hesabı bırak)");
  });
});

describe("W14 F-UI · V-5 (B-27): no toast ever shows a bare machine string", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("translates every HTTP status into a Turkish sentence first", () => {
    expect(html).toContain("function httpStatusTR(status)");
    expect(html).toContain("var HTTP_STATUS_TR = {");
    for (const code of ["400:", "403:", "404:", "409:", "413:", "429:"]) {
      expect(html).toContain(code);
    }
    // the old shape — the raw code as the WHOLE user-facing text — is gone
    expect(html).not.toContain('return { text: "HTTP " + httpStatus, raw: "" };');
    expect(html).toContain('return { text: httpStatusTR(httpStatus), raw: "HTTP " + httpStatus };');
  });

  it("never leaves an unknown error kind as the leading words of a sentence", () => {
    expect(html).toContain("if (err.message) { return { text: String(err.message), raw: err.kind }; }");
    expect(html).toContain("return { text: httpStatusTR(httpStatus), raw: err.kind };");
    expect(html).not.toContain('return { text: err.kind + (err.message ? ": " + err.message : ""), raw: "" };');
  });

  it("audits every toast: a status code only ever appears through httpStatusTR", () => {
    const toasts = html.match(/toast\((?:[^()]|\([^()]*\))*\)/gu) ?? [];
    expect(toasts.length).toBeGreaterThan(20);
    for (const call of toasts) {
      if (call.includes("HTTP ")) expect(call).toContain("httpStatusTR(");
    }
  });
});

describe("W14 F-UI · V-7: the quote picker separates relevance-gated evidence", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("splits the list and labels the gated half with its reason", () => {
    // Measured defect: the gate parked 8/8 sources in unusedEvidence and the
    // picker still listed them as K-1..K-6, unwarned, one click from insertion.
    expect(html).toContain("var pickGated = visible.filter(function (x) { return x.unused && !!x.entry.unusedReason; });");
    expect(html).toContain('list.appendChild(el("div", "fieldlabel", "Alaka kapısının elediği kaynaklar (" + pickGated.length + ")"));');
    expect(html).toContain('chip("ALAKASIZ GÖRÜNÜYOR — " + (UNUSED_REASON_PICK_TR[e.unusedReason] || "taslakta kullanılmıyor"), "bad")');
    expect(html).toContain("var UNUSED_REASON_PICK_TR = {");
  });

  it("makes inserting a gated source a deliberate act", () => {
    expect(html).toContain("add.disabled = true;");
    expect(html).toContain("Alaka uyarısını okudum; bu kaynağı yine de dayanak yapmak istiyorum.");
    expect(html).toContain('cb.addEventListener("change", function () { add.disabled = !cb.checked; });');
    expect(html).toContain(".card.gated {");
  });
});

describe("W14 F-UI · V-8 / V-9: modals are bound to history and keep their header", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("pushes one history entry per modal and closes it on Back", () => {
    expect(html).toContain("function pushModalHistory()");
    expect(html).toContain('window.history.pushState({ collexModal: true }, "", window.location.href);');
    expect(html).toContain('window.addEventListener("popstate", function () {\n    if (docModalState.open) { closeDocModal("history"); }\n  });');
    // a user-initiated close gives the entry back, so Back is never dead
    expect(html).toContain("try { window.history.back(); } catch (e)");
    // and a chained modal does NOT stack a second entry
    expect(html).toContain('closeDocModal(chained ? "keep" : "user");');
    // a hash change never leaves a modal hanging over another view
    expect(html).toContain('if (docModalState.open) { closeDocModal("history"); }\n    var raw =');
  });

  it("keeps 'Kapat (Esc)' reachable once the panel scrolls", () => {
    // Measured defect: getBoundingClientRect().top = -560 px on the deadline modal.
    expect(html).toContain(".docpanel .dochead {");
    expect(html).toContain("  position: sticky;\n  top: -22px;");
    expect(html).toContain("  margin: -22px -26px 0;\n  padding: 22px 26px 10px;");
    // the panel is the scroller in EVERY modal, not only the form ones
    expect(html).toContain("  padding: 22px 26px;\n  /* W14 F-UI (V-9): panelin KENDİSİ kaydırılır");
  });
});

describe("W14 F-UI · V-10 / V-12 / V-13 / V-17: the four interaction defects", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("V-10: saving the profile does not move the page under the cursor", () => {
    // W14 C-UI: the wrapper gained an OPTIONAL explicit anchor (V-10 residue,
    // see the C-UI block below). The V-10 contract itself is unchanged: the
    // wrapper exists, it measures a delta, and it does nothing when there is
    // no anchor at all.
    expect(html).toContain("function preserveFocusPosition(fn, explicitAnchor)");
    expect(html).toContain("var delta = anchor.getBoundingClientRect().top - before;");
    expect(html).toContain("preserveFocusPosition(function () {\n        fillSettingsForm(settingsCache);");
    // …and it does nothing when nothing is focused (first paint must not scroll)
    expect(html).toContain('["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].indexOf(focused.tagName) >= 0) ? focused : null;');
  });

  it("V-12: 'Kayıtlı taslaklar' is re-read every time the Taslak view is shown", () => {
    // the showView("taslak") branch now refreshes the list on every entry, not
    // only on the templates fetch and on closeEditor — a draft created on the
    // matter page used to stay invisible until a hard reload.
    expect(html).toContain("dönüşte yeniden çekilir. */\n      if (templatesCache.length) { renderSavedDrafts(); }");
    // 27.09.2026: a fourth call site — right after "Taslağı oluştur" saves
    // v1, the list no longer says "Henüz kayıtlı taslağınız yok".
    expect((html.match(/renderSavedDrafts\(\);/gu) ?? []).length).toBe(4);
    expect(html).toContain("above the editor right after v1 was saved");
  });

  it("V-13: an empty query leaves a PERSISTENT validation line, not a 3.6 s toast", () => {
    expect(html).toContain("function kararFieldError(text)");
    expect(html).toContain('<p class="fielderr" id="karar-qerr" role="alert"></p>');
    // W15 şerit E: "sorgu" ekrandan kalktı; ölçülen davranış aynı.
    expect(html).toContain('kararFieldError("Aranacak ifadeyi yazın; boş kutuyla arama yapılamaz.");');
    expect(html).toContain('input.setAttribute("aria-invalid", "true"); input.focus();');
  });

  it("V-17: choosing a template brings its form into view and focuses the first field", () => {
    expect(html).toContain('if (form && form.scrollIntoView) { form.scrollIntoView({ block: "start", behavior: "smooth" }); }');
    expect(html).toContain("if (firstField && firstField.focus) { firstField.focus({ preventScroll: true }); }");
  });
});

describe("W14 F-UI · V-11: the sentence splitter knows a Turkish legal citation", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("no longer ends a sentence at the first period", () => {
    // Measured defect: /^[^.!?]{3,120}[.!?]/ cut all seven petition templates at
    // "…dava dilekçesi taslağı (HMK m." — inside the citation.
    expect(html).not.toContain("var m = s.match(/^[^.!?]{3,120}[.!?]/);");
    expect(html).toContain("function sentenceCut(s)");
    expect(html).toContain("function abbrevBeforeDot(s, i)");
    expect(html).toContain("var SENTENCE_ABBR_TR = [");
  });

  it("requires all three conditions before a period ends a sentence", () => {
    // (a) not inside a künye parenthesis
    expect(html).toContain("if (depth > 0) { continue; }");
    // (b) followed by whitespace — so "m.119" and "352/1" never split
    expect(html).toContain("if (next && !/\\s/.test(next)) { continue; }");
    // (c) the preceding token is not an abbreviation or a bare number/letter
    expect(html).toContain('if (ch === "." && abbrevBeforeDot(s, i)) { continue; }');
    expect(html).toContain('if (/^\\d+$/.test(word)) { return true; }');
    expect(html).toContain("return SENTENCE_ABBR_TR.indexOf(word.toLocaleLowerCase(\"tr-TR\")) >= 0;");
    // and a period that closes a citation parenthesis IS a sentence end
    expect(html).toContain('if (j >= 0 && /[)\\]»”"\']/.test(s.charAt(j))) { return false; }');
    // the purpose line otherwise stops at the first top-level colon
    expect(html).toContain("if (colon >= 20) { return colon; }");
  });

  it("keeps the whole description one hover away and clamps the card to two lines", () => {
    expect(html).toContain('p.title = t.description || "";');
    expect(html).toContain("button.tpl p.purpose { display: -webkit-box; -webkit-line-clamp: 2;");
  });
});

describe("W14 F-UI · V-3: the Karar ara screen asks the endpoint, not the health badge", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("probes /v1/sources/search itself and draws the honest state", () => {
    expect(html).toContain("function probeSourcesGateway(gate)");
    // the probe passes the schema (so it reaches the gateway check) but is
    // refused at validation, so NO official upstream is contacted
    expect(html).toContain('{ query: "gecit yoklamasi", yearFrom: 2001, yearTo: 2000 }');
    // W15 şerit E: "sunucu" ve "geçit" ekrandan kalktı; ölçülen davranış
    // (kapalıyken dürüst kırmızı durum) korunuyor, yalnız cümle avukat dilinde.
    expect(html).toContain("Karar arama şu an çalışmıyor");
    expect(html).toContain("setKararFormEnabled(false,");
    // W15 şerit E (yapısal b): saydamlık tıklamayı engellemez. Kapalı form
    // GERÇEKTEN kapatılır ve gerekçe satırı tam opak kalır.
    expect(html).toContain("form.gateoff > *:not(.offreason) { opacity: .75; }");
    expect(html).toContain("form.gateoff button, form.gateoff label.rchip { pointer-events: none; }");
    expect(html).toContain('f.disabled = off;');
    expect(html).toContain('"Şu an kullanılamıyor — "');
    // the old, wrong signal (health.mcp) no longer decides this screen
    expect(html).not.toContain('if (health && health.mcp !== "ok") {');
    // re-enabling restores the per-source filter locks rather than opening them.
    // W16 şerit B: aynı satır artık KİPİN kendi kilitlerini de geri koyar
    // ("Bu aramayı kaydet" yalnız ifade kipinde çalışır), yani iddia
    // GENİŞLEDİ — gevşemedi.
    expect(html).toContain("if (enabled) { renderKararFilters(); setKararMode(kararMode); }");
    // the server's own sentence, which may carry a command-line flag, is
    // disclosed, not printed in the main flow (B-27). W15 şerit E (yapısal f):
    // tek "Teknik ayrıntı" kalıbı — details.tech, varsayılan kapalı.
    expect(html).toContain('if (err && err.message) { techBox(note, err.message); }');
    expect(html).toContain('d.appendChild(el("summary", null, "Teknik ayrıntı — destek için"));');
  });
});

describe("W14 F-UI · V-15 / V-16 / V-20 / V-22: contrast, machine names, narrow shell, first screen", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  const lightBlock = (() => {
    const m = html.match(/:root\s*\{([\s\S]*?)\n\}/);
    if (m === null) throw new Error("light :root block not found");
    return m[1]!;
  })();
  const darkBlock = (() => {
    const m = html.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    if (m === null) throw new Error("dark :root block not found");
    return m[1]!;
  })();

  it.each([["light", lightBlock], ["dark", darkBlock]] as ReadonlyArray<readonly [string, string]>)(
    "V-15: the faint sub-line reaches AA (>= 4.5:1) on every surface in the %s theme",
    (_name, block) => {
      // Measured defect: dark --ink-faint #8a8069 on --panel #201b15 = 4.37:1
      // under a 12.5 px file-row sub-line.
      const faint = tokenValue(block, "ink-faint").split("/")[0]!.trim();
      for (const surface of ["panel", "panel-2", "paper"]) {
        expect(contrast(faint, tokenValue(block, surface))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("V-16: the database name appears exactly once, in Ayarlar, as the answer to a question", () => {
    const hits = html.match(/dbName/gu) ?? [];
    // one read for the Ayarlar "Verilerim nerede?" line, two for the one
    // system-status row that prints it (guard + value) — and nowhere else.
    expect(hits.length).toBe(3);
    expect(html).toContain('document.getElementById("wheredb").textContent = h.dbName || "collex_local";');
    expect(html).not.toContain("Belge deposu:");
  });

  it("V-20: the matters table becomes a labelled card list below 640 px", () => {
    // Measured defect: 554 px of table inside a 345 px container at 390 px.
    expect(html).toContain("var MATTER_COLUMNS = [");
    expect(html).toContain('td.setAttribute("data-label", MATTER_COLUMNS[idx]);');
    expect(html).toContain("table.matters, table.matters tbody, table.matters tr, table.matters td { display: block; width: auto; }");
    expect(html).toContain("table.matters thead { display: none; }");
    expect(html).toContain("content: attr(data-label);");
    expect(html).toContain("#matterlist .scrollx { overflow-x: visible; }");
    // no column is dropped — every one keeps its Turkish label
    for (const label of ["Müvekkil", "Karşı taraf", "Mahkeme / E.", "Durum", "Sonraki süre", "Son işlem"]) {
      expect(html).toContain(label);
    }
  });

  it("V-22: the first-run masthead is trimmed, and only in the first-run state", () => {
    // Measured defect: content began at y = 537 px on a 900 px viewport.
    expect(html).toContain("  font-size: 23px;\n  line-height: 1.22;");
    expect(html).toContain(".monogram { width: 34px; height: 34px; display: block; }");
    expect(html).toContain(".masthead .rule {\n  margin: 11px auto 0;");
    expect(html).toContain("  margin: 12px auto 18px;\n  max-width: 880px;");
    // The single-row topbar this line used to pin was measured overflowing the
    // page (W21 closing browser check: 1255 px of topbar in a 1064 px content
    // area, 91 px of horizontal page scroll at 1280 px, theme button off
    // screen). The first-run masthead trim below is what V-22 is about and is
    // unchanged; the topbar is now two rows at every width.
    expect(html).toContain('grid-template-areas: "brand . theme" "matter pills pills";');
    expect(html).not.toContain('grid-template-areas: "brand matter pills theme"');
    // the compact (post-first-run) chrome is untouched: it still hides the block
    expect(html).toContain("body.compact .monomark, body.compact .masthead .brand");
  });
});

/**
 * W14 C-UI — the six defects the independent verification lane left standing
 * on the console half (`W14-F-VERIFY.md` §6): N-4, N-6, N-5, N-2 and the
 * V-10 / V-22 residues. Every assertion below pins a MEASURED behaviour, not
 * a preference; the numbers are in `W14-C-UI.md`.
 */
describe("W14 C-UI · N-2: the originals folder is named, never a bare repo path", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");
  const STANDARD = "uploads (varsayılan: var/uploads)";

  it("uses the standard wording in Ayarlar and in the restore explanation", () => {
    // Measured defect (F-VERIFY N-2): with COLLEX_DATA_DIR set, the originals
    // were written under <data>/uploads while the card still said the repo's
    // own var/uploads — and said it as a bare path.
    expect(html).toContain("&lt;veri klasörü&gt;/" + STANDARD);
    expect(html).toContain("“<veri klasörü>/" + STANDARD + "”");
    expect(html).not.toContain('depo klasöründeki <span class="ep">var/uploads</span>');
    expect(html).not.toContain("veritabanı dökümü ve var/uploads klasörü");
  });

  it("never leaves the default path standing on its own anywhere in the page", () => {
    // The only admissible occurrences are the ones LABELLED as the default.
    const stray: number[] = [];
    const needle = "var/uploads";
    for (let i = html.indexOf(needle); i >= 0; i = html.indexOf(needle, i + 1)) {
      const label = "varsayılan: ";
      if (html.slice(Math.max(0, i - label.length), i) !== label) stray.push(i);
    }
    expect(stray).toEqual([]);
  });
});

describe("W14 C-UI · N-4: a künye row shows the source's matching sentence, or says there is none", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("draws a second line on EVERY row and never leaves it blank", () => {
    // Measured defect: Bedesten's search reply carries no snippet at all
    // (0 of 10 rows) and its `title` restates the künye, so the old branch
    // `r.title !== kunyeLine(r)` drew nothing at all on the row.
    expect(html).not.toContain('if (r.title && r.title !== kunyeLine(r)) { main.appendChild(el("div", "snip", r.title)); }');
    // W15 şerit E: "döndürmüyor" programcı fiiliydi; gerekçe de yalnız fare
    // ipucundaydı (dokunmatikte ve klavyede hiç görünmüyordu). Ölçülen
    // davranış korunuyor — satır BOŞ BIRAKILMAZ ve nedeni ekranda yazar —
    // ama gerekçe artık görünür metindir ve listede bir kez durur.
    expect(html).toContain('var KARAR_NO_SNIPPET_TR = "Bu kaynak, arama listesinde karardan cümle vermiyor');
    expect(html).toContain('el("div", "snip nosnip", KARAR_NO_SNIPPET_TR)');
    expect(html).toContain('list.appendChild(el("p", "expl-def", KARAR_NO_SNIPPET_WHY_TR));');
    expect(html).not.toContain("none.title = KARAR_NO_SNIPPET_WHY_TR;");
    // …and a title that merely restates the künye is not passed off as a sentence
    expect(html).toContain("function titleAddsNothing(title, kunye)");
    expect(html).toContain("return k.indexOf(t) >= 0 || t.indexOf(k) >= 0;");
    expect(html).toContain("if (!snip && r.title && !titleAddsNothing(r.title, kunyeLine(r))) { snip = String(r.title).trim(); }");
    expect(html).toContain(".srcrow .snip.nosnip {");
  });

  it("hands the lawyer the ordering the upstream refuses to give", () => {
    // The source server orders by decision date, not relevance; the client
    // cannot re-rank the corpus, only the page it holds — and it says so.
    expect(html).toContain("var KARAR_SORTS = [");
    for (const label of [
      "Kaynağın kendi sırası (varsayılan)",
      "Karar tarihi — yeniden eskiye",
      "Karar tarihi — eskiden yeniye",
      "Merci / daire adına göre",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("function sortedKararRows(rows, state)");
    expect(html).toContain("function renderKararRows(list, rows, query, state)");
    expect(html).toContain('inp.placeholder = "Merci, esas no, karar no";');
    // W15 şerit E: "sunucu" kalktı ve en önemli uyarı (bu bir ilgililik
    // sıralaması DEĞİLDİR) ilk cümle oldu; boş süzgeç durumu ne yapılacağını
    // söylüyor ve yeniden arama yapılmadığını yine yazıyor.
    expect(html).toContain("Bu bir ilgililik sıralaması değildir: kaynağın sonraki sayfalarında daha uygun kararlar olabilir.");
    expect(html).toContain("Listenin sırasını kaynağın kendisi belirledi; ColleX yalnızca elindeki bu sayfayı yeniden sıralayabilir.");
    expect(html).toContain("Bu süzgeçle bu sayfada karar künyesi kalmadı. Süzgeci boşaltın; yeniden arama yapılmaz, aynı sonuçlar geri gelir.");
    // the page's own shape (how many chambers, which date span) is stated
    expect(html).toContain("function pageShapeLine(rows)");
    expect(html).toContain("bits.push(dates[0] === dates[dates.length - 1]");
  });

  it("asks for the exact phrase by default and offers ONE click back", () => {
    // Measured: without it the same query returns one chamber on one day;
    // with it, five to eight chambers across many dates.
    expect(html).toContain('<input type="checkbox" id="karar-exact" checked>');
    expect(html).toContain('<p class="hintline" id="karar-exacthint">');
    expect(html).toContain("Tam ifade olmadan yeniden ara");
    expect(html).toContain('document.getElementById("karar-exact").checked = false;\n          runKararSearch();');
    // the result head says which mode produced the list
    expect(html).toContain('head.appendChild(chip("tam ifade", "mute"));');
  });
});

describe("W14 C-UI · N-5: finding cards collapse, and the honesty bands do not", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("opens the first finding and folds the rest, with the counts on screen", () => {
    // Measured defect: a 7-finding corpus answer was 6 108 px = 6.8 screens.
    expect(html).toContain("function claimCard(claim, index, numbers, pinnedPrimary, startOpen)");
    expect(html).toContain("out.appendChild(claimCard(claim, cardNo, numbering.numbers, claimIsPinned(claim), cardNo === 1));");
    expect(html).toContain('var CLAIM_OPEN_TR = "Ayrıntıyı aç";');
    expect(html).toContain('toggle.setAttribute("aria-expanded", open ? "true" : "false");');
    expect(html).toContain('box.appendChild(el("p", "claimcounts", countBits.join(" · ")));');
    // W15 lane C: the counter reads as a sentence and uses the canonical word
    // ("aleyhe kaynak", never "karşıt otorite").
    expect(html).toContain('(claim.evidenceIds || []).length + " kaynağa dayanıyor",');
    expect(html).toContain('"aleyhe " + ((claim.contraryEvidenceIds || []).length) + " kaynak"');
    // and the folded cover keeps the source's title AND its in-force badge,
    // so a folded finding still says where it came from and whether the
    // provision is repealed
    expect(html).toContain('var srcHead = el("p", "claimsrchead");');
    expect(html).toContain("var headEff = currentnessChip(headItem.currentness);");
    expect(html).toContain(".claim.collapsed .claimbody { display: none; }");
    expect(html).toContain("function claimFoldBar(scope, total)");
    expect(html).toContain(" tespit — ilki açık, kalanı katlı");
  });

  it("keeps the confidence warning and the finding text OUTSIDE the folded part", () => {
    // A honesty band that folds away is a honesty band that is not shown.
    const conf = html.indexOf('box.appendChild(el("p", "conf-note " + conf[0], conf[1]));');
    const text = html.indexOf('box.appendChild(el("div", "text", cpTruncate(claim.text, 160)));');
    const counts = html.indexOf('box.appendChild(el("p", "claimcounts", countBits.join(" · ")));');
    const bodyStart = html.indexOf('var bodyBox = el("div", "claimbody");');
    expect(conf).toBeGreaterThan(0);
    expect(text).toBeGreaterThan(0);
    expect(counts).toBeGreaterThan(0);
    expect(bodyStart).toBeGreaterThan(0);
    expect(conf).toBeLessThan(bodyStart);
    expect(text).toBeLessThan(bodyStart);
    expect(counts).toBeLessThan(bodyStart);
    // the clamp shortens the text, it never deletes it
    expect(html).toContain("-webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;\n  font-size: 15px;");
  });

  it("prints every finding in full, folded or not", () => {
    expect(html).toContain("  .claim.collapsed .claimbody { display: block; }");
    expect(html).toContain("  .claim .ctoggle, .claimfold { display: none; }");
  });
});

describe("W14 C-UI · N-6: a matter opened from '+ Yeni dosya' becomes the active matter", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("puts the new matter in the list BEFORE making it active", () => {
    // Measured defect: setActiveMatter() ran first, renderMatterSelect() could
    // not find the id in mattersCache, and B-10's dead-matter pruning forgot
    // it in the same frame — #matterselect stayed on "Dosyasız çalışma" and
    // the next upload was silently unlinked.
    const fn = html.slice(html.indexOf("function submitNewMatter(opts)"));
    const body = fn.slice(0, fn.indexOf("/* ------------------------------ Dosya sayfası"));
    const seed = body.indexOf("mattersCache = mattersCache.concat([m]);");
    const activate = body.indexOf("setActiveMatter(m);");
    expect(seed).toBeGreaterThan(0);
    expect(activate).toBeGreaterThan(0);
    expect(seed).toBeLessThan(activate);
    expect(body).toContain("if (!mattersCache.some(function (x) { return x && x.id === m.id; })) {");
  });

  it("still prunes an active matter the server does not know", () => {
    // the B-10 guard that caused the defect is NOT weakened, only fed in order
    expect(html).toContain("if (activeMatter && !seen && mattersLoaded) { forgetActiveMatter(); }");
  });
});

describe("W14 C-UI · V-10 residue: the profile save no longer moves the page", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("anchors the compensation on the button that sent the request", () => {
    // Measured defect: lockSubmit disables the button for the duration of the
    // request; a disabled button loses focus, so document.activeElement was
    // <body> when the re-render ran and nothing was compensated — 224 px.
    expect(html).toContain("function preserveFocusPosition(fn, explicitAnchor)");
    expect(html).toContain("var focused = explicitAnchor || document.activeElement;");
    expect(html).toContain('}, document.getElementById("settingssave"));');
    // the mechanism itself is untouched
    expect(html).toContain("var delta = anchor.getBoundingClientRect().top - before;");
  });
});

describe("W14 C-UI · V-22 residue: first content sits above a quarter of the screen", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("trims the first-run masthead further, and ONLY in the first-run state", () => {
    // Measured: masthead 235 px, first card at 336 px = 37 % of 900 px.
    // After: masthead 129 px, first card at 220 px = 24.4 %.
    expect(html).toContain("body:not(.compact) .monomark { display: none; }");
    expect(html).toContain("body:not(.compact) .masthead { padding-top: 4px; }");
    expect(html).toContain("body:not(.compact) .masthead .brand { font-size: 20px; line-height: 1.2; }");
    expect(html).toContain("body:not(.compact) .masthead .rule { display: none; }");
    expect(html).toContain("body:not(.compact) nav.views { margin: 6px auto 0; padding: 4px; }");
    // the brand and the tagline share ONE line rather than stacking
    expect(html).toContain("body:not(.compact) .masthead .brand,\n  body:not(.compact) .masthead .tagline { display: inline; vertical-align: baseline; }");
    // the compact chrome keeps every measure it had
    expect(html).toContain("body.compact .masthead { padding-top: 8px; }");
    expect(html).toContain("body.compact nav.views { margin: 8px auto 0; padding: 4px; }");
  });

  it("does not re-open the header the 480 px shell deliberately hides", () => {
    // body:not(.compact) out-specifies the narrow-shell rules, so the block
    // is fenced above that breakpoint.
    const start = html.indexOf("@media (min-width: 481px) {\n  body:not(.compact) .monomark");
    expect(start).toBeGreaterThan(0);
    const block = html.slice(start, html.indexOf("\n}", html.indexOf("body:not(.compact) .stamp", start)));
    expect(block).toContain("body:not(.compact) .stamp { margin: 10px auto 14px;");
    expect(html).toContain(".monomark, .masthead .brand, .masthead .tagline, .masthead .rule { display: none; }");
  });
});

/**
 * W14 M-UI. C-FINAL §7(6) named the smallest change that most improves how the
 * product feels: the corpus/answer path had no progress line and no cancel, so
 * the lawyer's most common negative outcome (the phrase is not in the archive)
 * was also the longest silent wait. These tests hold the three properties that
 * make the fix honest rather than decorative:
 *
 *   1. the panel shows MEASURED seconds and never a percentage — the server
 *      reports no progress, so a percentage would be a number nobody measured;
 *   2. "Vazgeç" is a real AbortController whose signal reaches fetch, and the
 *      resulting AbortError is never drawn as a failure;
 *   3. the screen never claims more than it knows: the browser stopped waiting,
 *      it did not stop the server.
 */
describe("W14 M-UI · a long wait says what it is doing, and can be stopped", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  /** The body of the shared progress component, for "contains no ..." checks. */
  const busyBody = (() => {
    const start = html.indexOf("function beginBusy(opts) {");
    const end = html.indexOf("function markExportStarted(node, label)");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return html.slice(start, end);
  })();

  it("draws ONE shared progress card with a real phase line and measured seconds", () => {
    expect(html).toContain("function beginBusy(opts) {");
    expect(html).toContain('var phaseLine = el("p", "busyphase", opts.phase || "İstek gönderildi; cevap bekleniyor.");');
    expect(html).toContain('var timeLine = el("p", "busytime", "geçen süre: " + busySeconds(0));');
    expect(html).toContain("function busySeconds(ms) {");
    // Turkish decimal comma, one decimal, from the browser's own clock
    expect(html).toContain('return (Math.max(0, ms) / 1000).toFixed(1).replace(".", ",") + " sn";');
    expect(html).toContain('timeLine.textContent = "geçen süre: " + busySeconds(ms);');
    expect(html).toContain("var BUSY_TICK_MS = 200;");
  });

  it("never invents a percentage or a filling bar in the progress card", () => {
    // The one number on the card is the measured elapsed time. A percentage
    // would be a number this product never measured (CLAUDE.md, "Ölçülen
    // sayılar"), and a filling bar is a percentage drawn as geometry.
    expect(busyBody).not.toContain("%");
    expect(busyBody).not.toContain("width:");
    expect(busyBody).not.toContain("Math.round((");
    expect(busyBody).toContain('el("p", "busytime"');
  });

  it("only offers the honest long-wait sentence AFTER the wait is really long", () => {
    expect(html).toContain("var BUSY_LONG_WAIT_MS = 3000;");
    expect(html).toContain("if (waitLine && ms >= BUSY_LONG_WAIT_MS) { waitLine.hidden = false; }");
    expect(html).toContain("waitLine.hidden = true;");
    // and the sentence itself names the measured worst case without a number
    expect(html).toContain("En uzun bekleme, aradığınız ifadenin arşivde hiç");
  });

  it("cancels with a real AbortController whose signal reaches fetch", () => {
    expect(html).toContain('var controller = (typeof window.AbortController === "function")');
    expect(html).toContain("? new window.AbortController() : null;");
    expect(html).toContain("signal: controller ? controller.signal : undefined,");
    expect(html).toContain("if (controller) { try { controller.abort(); } catch (e) { /* desteklenmiyorsa yoksay */ } }");
    // every JSON helper forwards the signal, and forwards NOTHING when absent
    expect(html).toContain("function postJson(url, payload, signal) {");
    expect(html).toContain("function sendJson(url, method, payload, signal) {");
    expect(html).toContain("function getJson(url, signal) {");
    expect(html).toContain("if (signal) { init.signal = signal; }");
    // and every cancellable flow actually passes it — asserted per CALL SITE,
    // because one flow keeping the signal must not cover for another dropping
    // it (the answer form, its filter-less retry and the document page are
    // three separate requests to the same endpoint).
    expect(html).toContain('postJson("/v1/answer", payload, busy.signal).then(function (res) {');
    expect(html).toContain('return postJson("/v1/answer", retryPayload, busy.signal);');
    expect(html).toContain('return postJson("/v1/answer", payload, busy.signal);');
    expect(html).toContain('sendJson("/v1/sources/search", "POST", body, busy.signal)');
    expect(html).toContain('sendJson("/v1/citation-audit", "POST", body, busy.signal)');
    expect(html).toContain("if (uploadBusy.signal) { upInit.signal = uploadBusy.signal; }");
  });

  it("never draws a cancelled request as a failure", () => {
    expect(html).toContain("function isAbortError(error) {");
    expect(html).toContain('if (error.name === "AbortError") { return true; }');
    const guards = html.match(/if \(busy\.cancelled\(\) \|\| isAbortError\(error\)\) \{ return; \}/gu) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("if (uploadCancelled || isAbortError(error)) { return; }");
  });

  it("returns the screen to a clean state that says what it does NOT know", () => {
    expect(html).toContain("function busyCancelledCard(host, ms, opts) {");
    expect(html).toContain('box.appendChild(el("h3", "fname", "Vazgeçildi"));');
    expect(html).toContain('"Bekleme " + busySeconds(ms) + " sonra durduruldu. " + BUSY_ABORT_NOTE_TR));');
    // the honest limit: aborting the fetch does not abort the server
    // W15 şerit E: "sunucu" kalktı; ölçülen dürüstlük aynı — vazgeçmek işi
    // durdurmayabilir ve bu söylenir.
    expect(html).toContain("ColleX bu işi arka planda bitirse bile");
    // and one click back, with the question kept
    expect(html).toContain('retryLabel: "Aynı soruyu yeniden sor"');
    expect(html).toContain('retryLabel: "Aynı aramayı yeniden yap"');
    expect(html).toContain('detail: "Soru kutusu ve tarih olduğu gibi duruyor."');
  });

  it("the live run's Vazgeç stops the WAIT and never claims to stop the run", () => {
    // There is no cancel endpoint for a live run, so the button may not say
    // the run was stopped — it says the waiting was.
    expect(html).toContain("function renderProgress(panel, view, started, onCancel) {");
    expect(html).toContain('if (view.state === "running" && typeof onCancel === "function") {');
    expect(html).toContain("renderProgress(panel, view, started, stopWaiting);");
    expect(html).toContain('box.appendChild(el("h3", "fname", "Beklemekten vazgeçildi"));');
    // W15 şerit E: "sunucu" kalktı ve liste tek adıyla anılıyor
    // ("Kayıtlı araştırmalarım"); eskiden üç ayrı adla geçiyordu.
    expect(html).toContain("Araştırma arka planda sürüyor olabilir");
    expect(html).toContain("“Kayıtlı araştırmalarım”");
    expect(html).toContain("if (liveStopped) { return; }");
  });

  it("the upload's Vazgeç stops the QUEUE and never paints a partial upload green", () => {
    expect(html).toContain('uploadBusy.phase(done + "/" + total + " gönderiliyor: " + cpTruncate(f.name, 48));');
    expect(html).toContain("uploadCancelled = true;");
    expect(html).toContain("files.length = 0;");
    expect(html).toContain('toast("Yükleme durduruldu — " + okCount + "/" + total + " belge yüklendi" +');
    expect(html).toContain("sürmekte olan belge yarım kalmış olabilir.");
  });

  it("the backup shows progress but NO Vazgeç, and writes the reason on screen", () => {
    const start = html.indexOf("function runBackup() {");
    const end = html.indexOf("B-19 · Klasör / toplu yükleme", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = html.slice(start, end);
    expect(body).toContain("noCancelReason:");
    expect(body).not.toContain("onCancel");
    expect(html).toContain("eksik kopyalanmış bir klasör");
    expect(body).toContain('title: "Yedek alınıyor"');
  });

  it("an export link cannot report progress, so it says where the file appears", () => {
    // An <a download> completes outside this page's view: a spinner we could
    // never end would be a lie, so the page points at the browser instead.
    expect(html).toContain("function markExportStarted(node, label) {");
    // W15 şerit E: "sunucu" kalktı; ölçülen dürüstlük aynı — sayfa
    // göremediği bir işin ilerlemesini uydurmaz ve bunu söyler.
    expect(html).toContain("Bu sayfada ilerleme çubuğu gösterilemez");
    expect(html).toContain("tarayıcınızın indirilenler bölümünden görürsünüz.");
    expect(html).toContain('acts.appendChild(markExportStarted(docx, "DOCX"));');
    // W15 şerit E: "Markdown" avukatın bilmediği bir dosya biçimi adıydı.
    expect(html).toContain('acts.appendChild(markExportStarted(md, "Düz metin dosyası"));');
    expect(html).toContain('markExportStarted(udf, "UDF dosyası");');
    expect(html).toContain('acts.appendChild(markExportStarted(dl, "Denetim raporu (DOCX)"));');
  });
});

describe("W14 M-UI · the server lane's two new fields reach the screen", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("Ayarlar names the REAL originals folder when /v1/health reports it", () => {
    expect(html).toContain('<p class="note-p" id="whereuploadsline" hidden></p>');
    expect(html).toContain('var upDir = typeof h.uploadsDir === "string" ? h.uploadsDir.trim() : "";');
    expect(html).toContain('whereLine.hidden = upDir === "";');
    expect(html).toContain('whereLine.appendChild(document.createTextNode("Bu kurulumda o klasörün yeri: "));');
    expect(html).toContain('whereLine.appendChild(el("span", "ep", upDir));');
    // an older server that does not send the field leaves the honest C-UI
    // wording standing alone — the console never guesses a path
    // W15 şerit E: "sunucunun kendisi bildirir" kalktı; ölçülen dürüstlük
    // aynı — konsol bir yol UYDURMAZ, yalnız bildirileni yazar.
    expect(html).toContain("bu yolu ColleX'in kendisi bildirir, tahmin etmez.");
    expect(html).toContain("&lt;veri klasörü&gt;/uploads (varsayılan: var/uploads)");
  });

  it("Karar ara says how many records the SOURCE holds, and never writes 0", () => {
    expect(html).toContain("function sourceTotalLine(body, shown) {");
    expect(html).toContain('var total = (typeof body.totalRecords === "number" && isFinite(body.totalRecords))');
    expect(html).toContain('p.appendChild(el("b", null, "Kaynakta " + fmtCount(total) + " kayıt var"));');
    expect(html).toContain('" — burada ilk " + shown + " tanesi listeleniyor.');
    // null is NOT 0: an unreported count says so in words
    // W15 şerit E: "sorgu" ve "küme" avukat dili değildi; bilgi aynı.
    expect(html).toContain("Kaynak, bu aramaya toplam kaç kararının uyduğunu bildirmedi.");
    expect(html).toContain("card.appendChild(sourceTotalLine(body, rows.length));");
    // Turkish thousands separator, and the per-source breakdown by source NAME
    expect(html).toContain("function fmtCount(n) {");
    expect(html).toContain('if (i > 0 && (s.length - i) % 3 === 0) { outStr += "."; }');
    expect(html).toContain('kararSourceName(t.sourceId) + " — " + fmtCount(t.totalRecords) + " kayıt"');
  });
});

describe("W14 M-UI · the two residues C-UI left open", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("prints the brand ONCE on the first-run screen (masthead residue)", () => {
    // Measured on this run: with the small copy still drawn the status pills
    // wrapped to a second row, masthead 162 px and the first card at 253 px
    // (28,1 % of 900 px). Without it: 129 px and 220 px (24,4 %).
    expect(html).toContain("body:not(.compact) .topbar .brandmini { display: none; }");
    // and ONLY there: the compact shell keeps the brand in its top bar
    expect(html).not.toContain("body.compact .topbar .brandmini { display: none; }");
  });

  it("folds the contrary-authority SEARCH TRACE, never the finding (card length)", () => {
    // The lane dump was already folded on the branch with no contrary
    // authority; the branch WITH one drew it open. Both branches now use the
    // same shape — since W15 lane C that shape is ONE foldout, "#sec-karsit",
    // inside the audit drawer, and BOTH branches reach it.
    expect(html).toContain('"Aleyhe karar taraması (" + laneCount + " arama)"');
    expect(html).toContain("laneTable(covDet);");
    expect(html).toContain("covDet.appendChild(cl);");
    expect(html).toContain("tespitte kaynaklar çelişiyor. Her iki taraf da gizlenmeden gösterilir:");
    expect(html).toContain("belge taramada bulundu ancak bu sorunun kanıt kümesine alınmadı.");
    // What may never fold: the SCAN'S RESULT, and the sentence that stops it
    // being read as "there is no contrary decision".
    expect(html).toContain('out.appendChild(anim(el("p", "contraryresult", contraryResultTR)));');
    expect(html).toContain("Bu, aksi yönde karar olmadığı anlamına gelmez; yalnızca bu arşivde bulunmadığı anlamına gelir.");
    // …and a contrary decision itself is now an OPEN block under the finding
    // it contradicts, never a foldout and never a separate section.
    expect(html).toContain('var cb = el("div", "contrablock");');
    expect(html).toContain("Bu tespitin aksine karar var");
    expect(html).toContain("cb.appendChild(embeddedSourceCard(item, numbers[id]));");
  });
});

describe("W15 şerit B · cevap ekranı başlığı, dayanak bulunamadı ve künye", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("gives the largest type to a Turkish sentence and demotes the machine stamp to a badge", () => {
    // Ölçülen kusur: cevabın en büyük yazısı "TAM" idi ve tek başına hiçbir
    // şey söylemiyordu; üstelik small-caps + açılmış harf aralığıyla, yani
    // ekranın en kritik satırı en zor okunan biçimde çiziliyordu.
    expect(html).toContain('mid.appendChild(el("div", "word", st[3]));');
    expect(html).toContain("Her tespit bir alıntıya bağlandı.");
    expect(html).toContain("Bazı tespitler alıntıya bağlanamadı.");
    expect(html).toContain("Bu soruya cevap yazılmadı.");
    // Damga SİLİNMEZ: küçülür ve yanında karşılığını açan "?" taşır.
    expect(html).toContain('chip("Durum: " + st[0], st[1] + " sentence")');
    expect(html).toContain('data.status === "ABSTAIN" ? "ÇEKİMSER" : "durum etiketi"');
    // .word artık bir cümle taşıyor: small-caps ve harf aralığı kalktı.
    expect(html).toContain("font-variant-caps: normal; color: var(--vd, var(--ink));");
    expect(html).toContain(".chip.sentence { font-variant-caps: normal;");
  });

  it("keeps the uploadOnly branch and the finalize line as separate axes", () => {
    // uploadOnly dalı dört damgalı taksonomiye EZİLMEZ: "TAM" burada sorunun
    // cevaplandığı anlamına gelmez.
    expect(html).toContain('" pasaj bulundu"');
    // Sondaki "(Teknik durum: TAM)" parantezi kalktı; aynı bilgi bir alttaki
    // "Durum: …" rozetinde, "?" düğmesiyle birlikte duruyor. (Cümlenin
    // kendisi yalnız koddaki gerekçe yorumunda kalır.)
    expect(html).not.toContain('+ "(Teknik durum: "');
    // .fin ayrı eksendir ve durum satırıyla birleştirilmez.
    expect(html).toContain('el("div", "fin warnline " + (data.finalizable ? "yes" : "no"))');
    expect(html).toContain("FINALIZE_TR.yes : FINALIZE_TR.no");
  });

  it("writes the künye as one quiet sentence and names the download in Turkish", () => {
    expect(html).toContain("tarihinde yürürlükte olan metne göre değerlendirildi");
    expect(html).toContain('answerEvidenceSummary(data.evidence || []) + " · "');
    expect(html).toContain('documents.size + " belge · " + evidence.length + " alıntı"');
    expect(html).toContain('" tespit"');
    expect(html).toContain('"denetim-dosyasi-" + data.runId + ".json"');
    // Açıklama cümlesi UYARI DEĞİLDİR: noticeLine()'dan geçmez.
    expect(html).toContain('mid.appendChild(el("p", "expl-def",');
  });

  it("turns abstention into a fork with a mandatory fallback reason", () => {
    expect(html).toContain("Dayanak bulunamadı — bu yüzden cevap yazılmadı.");
    expect(html).toContain("Bu bir arıza değil, ürünün kuralıdır:");
    // Sınanabilir cümle silinmez.
    expect(html).toContain("Aşağıda hiçbir kaynak kartı ve hiçbir tespit yoktur.");
    // İki dal ve YEDEK cümle.
    expect(html).toContain("Neden: sorunuzdaki şu sözcüklerin taranan kaynaklarda karşılığı yok");
    expect(html).toContain("Neden: sorunuzun sözcükleri kaynaklarda geçiyor");
    expect(html).toContain("function selectQuestionWord(word)");
    // Kapalı yolun gerekçesi tam opak kalır ve sabit önek taşır.
    expect(html).toContain('"Şu an kullanılamıyor — " + blocked');
    expect(html).toContain('b.setAttribute("aria-disabled", "true");');
    // ÇEKİMSER'de § numarası ve İçindekiler çizilmez, ÇAPALAR korunur.
    expect(html).toContain('suppressSectionNumbers = data.status === "ABSTAIN";');
    expect(html).toContain("if (!suppressSectionNumbers) { h.appendChild(");
    expect(html).toContain("h.id = anchorId;");
  });

  it("keeps every coverage-loss line of the künye block visible, never folded", () => {
    // Kodun kendi kuralı: bir arama şeridinin sessizce düşmesi KAPSAM
    // kaybıdır ve katlanmış kartta saklanamaz.
    expect(html).toContain('noticeLine(box, "line setaside", warnTR("RETRIEVAL_LANE_DEGRADED:").text);');
    expect(html).toContain("sorunun kendisi cevaplanmış sayılmaz.");
    expect(html).toContain('if (currentUploadOnly) { noticeLine(box, "line setaside", UPLOAD_CLAIM_NOTE_TR); }');
    expect(html).toContain('"Veri kaynağı: " + data.corpusNotice');
    // "yerel korpus" künyeden kalktı.
    expect(html).toContain("hukuk kütüphaneniz taranmadı.");
    expect(html).not.toContain("yerel korpus taranmadı");
    // Üretim satırı avukatın sorduğu soruyu cevaplıyor.
    expect(html).toContain("Bu cevabı yapay zekâ yazmadı:");
    expect(html).toContain("dayanağı bu bilgisayarda tek tek doğrulandı");
  });

  it("keeps the console and the exported document on ONE dictionary", () => {
    // renderer.ts kendi yorumunda bu sabitlerin HER YÜZEYDE aynı olmasını
    // şart koşuyor; ekran ile indirilen belge farklı kelime kullanamaz.
    const renderer = readFileSync(resolve(HERE, "..", "..", "src", "answer", "renderer.ts"), "utf8");
    for (const label of [
      "Kaynakla destekleniyor",
      "Kaynaklar çelişiyor",
      "Dayanak yetersiz",
      "Kaynak o tarihte yürürlükte değil",
      "Kaynak soruyu kısmen karşılıyor",
      "DAYANAK BULUNAMADI (ÇEKİMSER)",
    ]) {
      expect(html).toContain(label);
      expect(renderer).toContain(label);
    }
    expect(html).toContain(
      "KESİNLEŞTİRİLEMEZ — iç kontrollerden biri sonuç veremedi; aşağıdaki gerekçeleri okumadan kullanmayın",
    );
    expect(renderer).toContain(
      "KESİNLEŞTİRİLEMEZ — iç kontrollerden biri sonuç veremedi; aşağıdaki gerekçeleri okumadan kullanmayın",
    );
  });
});

describe("W15 şerit C · cevap ekranı gövdesi: dayanak tespitin altında, denetim kaydı tek çekmecede", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("draws the source card INSIDE the finding and mints each #kaynak-n anchor once", () => {
    // Measured defect: the lawyer read a finding, clicked "[1] numaralı
    // kaynağa git", landed in a separate "Kaynaklar" section and lost their
    // place coming back. The quote now sits under the finding it supports.
    expect(html).toContain("function embeddedSourceCard(item, n)");
    expect(html).toContain("var anchoredEvidence = {};");
    expect(html).toContain("if (firstDraw) { anchoredEvidence[n] = true; }");
    expect(html).toContain("anchoredEvidence = {};");
    // one evidence item may support two findings — the id may not be minted twice
    expect(html).toContain("{ anchor: firstDraw, viewer: currentRunId !== null }");
    // the separate section survives ONLY for evidence no finding uses
    expect(html).toContain("Hiçbir tespite bağlanmayan kaynaklar (");
    expect(html).toContain("return !linkedEvidence[id] && evidenceById[id];");
  });

  it("keeps the source title and its in-force badge on the folded cover", () => {
    expect(html).toContain('var srcHead = el("p", "claimsrchead");');
    expect(html).toContain("var headEff = currentnessChip(headItem.currentness);");
    // …outside .claimbody, which is what the fold hides
    const cover = html.indexOf('box.appendChild(srcHead);');
    const body = html.indexOf('var bodyBox = el("div", "claimbody");');
    expect(cover).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(0);
    expect(cover).toBeLessThan(body);
  });

  it("collects the three audit sections into ONE drawer and keeps their anchors", () => {
    expect(html).toContain('audit.appendChild(el("summary", null, "Bu cevabın denetim kaydı"));');
    // the anchors the work cards and pendingAnswerJump depend on now sit on <details>
    expect(html).toContain('if (renderAnchors) { covDet.id = "sec-karsit"; }');
    expect(html).toContain('if (renderAnchors) { fold.id = "sec-uyarilar"; }');
    expect(html).toContain('if (renderAnchors) { tracePane.id = "sec-iz"; }');
    // …so a jump has to open every fold above the target first
    expect(html).toContain("function openFoldedAncestors(start)");
    expect(html).toContain('if (cur.tagName === "DETAILS") { cur.open = true; }');
    expect(html).toContain("if (firstPanel && firstPanel.nodeType === 1) { openFoldedAncestors(firstPanel); }");
    expect(html).toContain("openFoldedAncestors(node);");
    // a failed verification port un-folds the warnings AND the drawer itself
    expect(html).toContain('var FAILED_PORT_CODES = ["CANONICAL_TEXT_PORT_FAILED", "VERSION_FACTS_FAILED",');
    expect(html).toContain('"ENTAILMENT_PORT_FAILED", "DRAFTER_FAILED"];');
    expect(html).toContain("if (auditAlarm) { audit.open = true; }");
    expect(html).toContain("if (auditAlarm) { fold.open = true; }");
    expect(html).toContain("Bu cevabı olduğu gibi kullanmayın: aşağıdaki gerekçelerden en az biri, ");
  });

  it("W15-SÖZLÜK P0: no bare percentage on a meter, and it says what it is NOT", () => {
    // An unexplained "%100" is exactly the accuracy claim this product does
    // not make. Three verbal tiers, written in words AND colour.
    expect(html).toContain(
      'var METER_HEAD_TR =\n    "Bunlar kaynak eşleşmesinin gücünü gösterir; cevabın doğruluk oranı DEĞİLDİR.";',
    );
    expect(html).toContain("function meterLevel(value)");
    expect(html).toContain('if (value >= 85) { return ["", "güçlü"]; }');
    expect(html).toContain('if (value >= 50) { return [" mid", "orta"]; }');
    expect(html).toContain('return [" low", "zayıf"];');
    expect(html).toContain('box.appendChild(el("div", "val lvl" + lvl[0], lvl[1]));');
    expect(html).not.toContain('box.appendChild(el("div", "val", "%" + value));');
    // the colour is never the only channel
    expect(html).toContain(".meters .val.lvl.low { color: var(--bad); }");
    // the same rule reaches the draft editor's own two score readouts
    // W15 şerit E: damganın içine sığmayan uzun cümle kendi satırına indi.
    expect(html).toContain("kaynakla bağı: ");
    expect(html).toContain('table(t, ["Kanıt", "Kaynakla anlam bağı", "Sonuç", "Gerekçe"], rows);');
    // the numbers are not deleted — they move into the audit record
    expect(html).toContain("function confidenceDump(claims, numbers)");
    expect(html).toContain('cells.push("%" + pct(conf[dim[0]]));');
    // …and an unmeasured axis is still a sentence, never a zero
    expect(html).toContain('if (dim[0] === "currentness" && naCurrentness) { cells.push(CURRENTNESS_NA_TR); return; }');
  });

  it("puts the technical line behind a foldout named after the lawyer's question", () => {
    expect(html).toContain('det.appendChild(el("summary", null, "Bu alıntı nasıl doğrulandı?"));');
    expect(html).toContain("Aşağıdaki numaralar, metnin tek bir harfi değişse bile bambaşka çıkar.");
    // the explanation is a DEFINITION, not a warning: it may not eat the budget
    expect(html).toContain('det.appendChild(el("p", "expl-def",\n      "Aşağıdaki numaralar');
    expect(html).toContain('" (Teknik adı: SHA-256.)"');
    // the version id is a uuid, so no "7. sürüm" may be invented from it
    expect(html).toContain("Alıntının alındığı belge sürümü: ");
    expect(html).not.toContain('". sürümü — belge her yeniden yüklendiğinde numara artar"');
  });

  it("keeps fillDocText's THREE conditional branches — a positive line is never fixed text", () => {
    // W15 şerit E: üç KOŞULLU dalın hepsi duruyor; yalnız cümleler avukat
    // diline geçti. Olumlu satır hâlâ hesaplanır, sabit basılmaz.
    expect(html).toContain("Cevapta gösterilen alıntı bu metinde ");
    expect(html).toContain("⚠ Cevaptaki alıntı, belgenin bu metniyle bire bir örtüşmedi.");
    expect(html).toContain("Bu alıntıyı dilekçede kullanmayın");
    expect(html).toContain("⚠ Bu belge, cevabın hazırlandığı andaki hâliyle aynı değil");
    // the positive line is COMPUTED, never printed unconditionally
    expect(html).toContain("var matches = quoteSlice === item.quote;");
    expect(html).toContain("if (matches && item.contentSha256) {");
  });
});

/**
 * W15 şerit E — kalan ekranların dili.
 *
 * Bu blok, şerit E'nin KAPATTIĞI altı yapısal kusuru ve kalan ekranlardaki
 * dil kararlarını kilitler. Her satır ÖLÇÜLEN bir davranışı pinler; hiçbiri
 * estetik tercih değildir.
 */
describe("W15 şerit E: kalan ekranların dili ve altı yapısal kusur", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("(a) 'Kayıtlı taslaklar' kartı şablon araması yazılınca kaybolmaz", () => {
    // Ölçülen kusur: renderTemplates ilk iş olarak #templates içini siliyor ve
    // kartı bir daha eklemiyordu; avukat arama kutusuna tek harf yazdığı anda
    // üzerinde çalıştığı taslakların listesi ekrandan kayboluyordu.
    expect(html).toContain('<div id="draftsbox"></div>');
    expect(html).toContain('var target = document.getElementById("draftsbox") || document.getElementById("templates");');
    // ve renderTemplates hâlâ yalnız KENDİ kabını siliyor
    expect(html).toContain('function renderTemplates(templates) {\n    var target = document.getElementById("templates");\n    target.textContent = "";');
  });

  it("(b) kapalı form GERÇEKTEN kapanır ve gerekçesi tam opak kalır", () => {
    // Saydamlık tıklamayı ve yazmayı engellemez: avukat kapalı görünen formu
    // dolduruyor, düğmeye basıyor ve hiçbir şey olmuyordu.
    expect(html).toContain("function gateForm(form, reason)");
    expect(html).toContain("f.disabled = off;");
    expect(html).toContain('var p = el("p", "offreason", "Şu an kullanılamıyor — " + String(reason));');
    expect(html).toContain("form.gateoff > *:not(.offreason) { opacity: .75; }");
    expect(html).toContain("form.gateoff button, form.gateoff label.rchip { pointer-events: none; }");
    expect(html).toContain(".offreason {\n  opacity: 1;");
    // ve eski, gerekçeyi de soluklaştıran %55 kuralı geri gelmez
    expect(html).not.toContain("form.gateoff { opacity: .55; }");
    // devre dışı iş kartında da açıklama satırı KALIR, gerekçe altına eklenir
    expect(html).toContain('b.appendChild(el("span", "wl", card.line));');
    expect(html).toContain('b.appendChild(el("span", "wb", "Şu an kullanılamıyor — " + why));');
    expect(html).toContain("button.workcard[disabled] .wb { opacity: 1; }");
  });

  it("(c) yıkıcı işlemler uygulamanın kendi onay kartından geçer", () => {
    expect(html).toContain("function askConfirm(host, opts)");
    // silinecek içeriğin ilk 60 karakteri gösterilir
    expect(html).toContain("cpTruncate(String(o.what), 60)");
    // vazgeçme düğmesi ÖNCE gelir ve odağı alır
    expect(html).toContain("acts.appendChild(no);\n    acts.appendChild(yes);");
    expect(html).toContain("try { no.focus(); }");
    // üç yıkıcı iş + taslaktan ayrılma onayı
    expect(html).toContain('title: "Bu paragraf taslaktan silinsin mi?"');
    expect(html).toContain('title: "Bu kayıtlı arama silinsin mi?"');
    expect(html).toContain('title: "Bu satır silinsin mi?"');
    expect(html).toContain("function askLeaveDraft(name, arg)");
    expect(html).toContain('no: "Taslakta kal"');
    expect(html).toContain('yes: "Kaydetmeden ayrıl"');
    // tarayıcının kendi penceresi artık hiçbir yerde kullanılmıyor
    expect(html).not.toContain("window.confirm(");
    // düğmeler ne yapacağını söyler
    expect(html).toContain('"Paragrafı sil"');
  });

  it("(d) teknik arıza ile 'sonuç yok' AYNI cümleyle anlatılmaz", () => {
    expect(html).toContain("function res3(parent, kind, title, text, tech)");
    // atıf denetiminde arıza başlığı "Metin okunamadı"dır
    expect(html).toContain('errCard(out, "Metin okunamadı",');
    expect(html).toContain("bu, metinde atıf olmadığı anlamına gelmez");
    expect(html).toContain('errCard(out, "Denetim tamamlanamadı",');
    expect(html).toContain("bu, atıflarınızın hatalı olduğu anlamına gelmez");
    // "hiç aranmadı" ayrı bir cümledir
    expect(html).toContain("Bu araştırmada hiçbir kaynağa soru gitmedi.");
    expect(html).toContain("bu araştırma resmî kaynaklara hiç bağlanmadı");
    // kayıtlı taslak listesinde üç hâl ayrı
    expect(html).toContain("taslaklarınız olabilir, ama bu ekranda gösterilemiyor");
    expect(html).toContain("bu, taslağınız yok demek değildir");
    // cevap veremeyen kaynak, "orada karar yok" demek değildir
    expect(html).toContain("Bu, oralarda karar olmadığı anlamına gelmez");
  });

  it("(e) takvim ve duruşma hazırlığı gizlenemez süre uyarısını taşır", () => {
    const note = "Buradaki süreler ColleX'in hesabıdır; bağlayıcı değildir. " +
      "Her süreyi dosyanızdaki tebliğ tarihinden ve ilgili maddeden doğrulayın.";
    // iki ayrı yüzey: takvimde ay ızgarasının ÜSTÜNDE, duruşma hazırlığında
    // "Açık süreler" listesinin ALTINDA
    expect((html.match(/Buradaki süreler ColleX'in hesabıdır/gu) ?? []).length).toBe(2);
    expect(html).toContain(`<p class="duenote">${note}</p>`);
    expect(html).toContain(`d1.appendChild(el("p", "duenote", "${note}"));`);
    // katlanmaz, kapatılamaz: yazdırmada gizlenen listelerde yer almaz
    // yazdırmada gizlenen sınıf listelerinde .duenote yer almaz
    // W15 şerit F: footer.note ve .strip bu listelerden ÇIKARILDI (kâğıda basılan
    // nüsha uyarısız çıkıyordu). Ölçülen davranış aynı: .duenote hiçbir yazdırma
    // gizleme listesinde yer almaz.
    for (const hideRule of [
      ".bench, .themebtn, .presets, .runbar, kbd.hint { display: none; }",
      "nav.views, .dropzone, .filebtns, .exports, .tplgrid, form#draftform, .statusline { display: none; }",
      "nav.toc, .docmodal, .topbar, .toolbar, .subtabs, .toast, .actions { display: none; }",
    ]) {
      expect(html).toContain(hideRule);
      expect(hideRule).not.toContain("duenote");
    }
  });

  it("(f) TEK 'Teknik ayrıntı' kalıbı vardır ve varsayılan kapalıdır", () => {
    expect(html).toContain("function techBox(parent, lines)");
    expect(html).toContain('var d = el("details", "mini tech");');
    expect(html).toContain('d.appendChild(el("summary", null, "Teknik ayrıntı — destek için"));');
    // <details> varsayılan kapalıdır: techBox hiçbir yerde open yapmaz
    expect(html).not.toMatch(/mini tech"\);\n\s*d\.open = true/u);
    // hata kartı makine kodunu ana akışa değil bu kaba koyar
    expect(html).toContain("function errMessageTech(res)");
    expect(html).toContain("function errCard(parent, title, message, tech)");
    expect(html).toContain("if (tech) { techBox(e, tech); }");
    // errMessage artık ham kodu cümlenin sonuna EKLEMEZ
    expect(html).not.toContain('(t.raw ? " (" + t.raw + ")" : "")');
  });

  it("kalan ekranlarda yasak sözcükler ana akışta geçmez", () => {
    // Yorum satırları avukata görünmez; ölçüm yalnız görünen metin üzerindedir.
    const visible = html
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " ");
    for (const w of ["korpusta", "Korpusta", "yerel korpus", "araç çağrısı", "kapsanmadı",
      "şema eksik", "Bulut OCR", "kanıt paketi", "izin listesinde", "sezgisel çıkarım",
      "şüpheli talimat kalıbı", "Bu kovada", "geçidi", "geçidine"]) {
      expect(visible).not.toContain(w);
    }
  });

  it("hata bildirimi kendiliğinden kaybolmaz ve kendi 'Kapat'ını taşır", () => {
    // Ölçülen kusur: bütün bildirimler 3,6 saniyede siliniyordu; "Taslak
    // kaydedilemedi" gibi kritik hatalar okunmadan gidiyordu.
    expect(html).toContain('if (tone === "bad") {');
    expect(html).toContain('close.className = "toastclose";');
    expect(html).toContain("toast.timer = setTimeout(function () { t.hidden = true; }, 6000);");
    expect(html).not.toContain("}, 3600);");
  });

  it("ızgaranın altı soru sınırı sessizce uygulanmaz", () => {
    expect(html).toContain("function gridDroppedQuestions()");
    expect(html).toContain('<div class="res3 broke" id="griddrop" role="status" hidden></div>');
    expect(html).toContain('" soru sorulabilir; ilk " + GRID_MAX_QUESTIONS + " satır kullanıldı."');
    expect(html).toContain('dropBox.appendChild(el("p", null, "Tabloya alınmayan sorular:"));');
    expect(html).toContain("Her satıra bir soru yazın — en çok 6 soru.");
  });

  it("boş durumun en büyük ögesi süsleme değil talimattır", () => {
    expect(html).toContain(".placeholder .mark { display: none; }");
    expect(html).toContain("font-size: 18px;\n  line-height: var(--lh-body);\n  color: var(--ink);");
    // boş liste seçilebilir seçenek kılığına girmez
    expect(html).toContain('none.textContent = "— bu dosyada kayıtlı araştırma yok —";');
    expect(html).toContain("none.disabled = true;");
  });

  it("her ekranın başında tek cümlelik 'bu ekranda ne yapılır' satırı vardır", () => {
    expect(html).toContain(".screenlead {");
    for (const lead of [
      "Bu ekranda dilekçe ve sözleşme taslağı hazırlarsınız",
      "Bu ekranda dosyalarınızdaki süreleri ve duruşmaları ay ay görürsünüz",
      "Bu ekranda kendi belgelerinizi",
      "Bu ekranda seçtiğiniz belgelerin her birine aynı soruları sorar",
      "Bu ekranda Yargıtay, Danıştay ve Mevzuat Bilgi Sistemi gibi resmî kaynaklarda",
      "Bu ekrana dilekçenizin metnini yapıştırırsınız",
      "Bu ekranda ColleX'in bugün hangi kaynaklara bakabildiğini",
      "Bu ekranda başvurma harcı",
      "Bu ekranda bir sözleşme metnini kendi kontrol listenizle karşılaştırır",
    ]) {
      expect(html).toContain(lead);
    }
  });
});

/* =====================================================================
 * W15 ŞERİT F · KİLİTLEME
 *
 * Bu blok, dalganın anlaşılırlık kazanımlarını YAPISAL olarak kilitler.
 * Ölçtüğü şey davranıştır, biçim değil: bir sonraki değişiklik ekrana bir
 * mühendislik sözcüğü, açıklamayı uyarı kılığında bir cümle, ikinci bir
 * tanım metni ya da bir doğruluk iddiası geri koyarsa buradan geçemez.
 *
 * Ortak ayrım: GÖRÜNEN metin ile KOD. Konsolun tamamı `textContent` ile
 * çizildiği için avukatın gördüğü her sözcük dosyada bir dizge sabiti
 * olarak durur; kod adları (mcpState, JSON.parse, quoteSha256) dizge
 * değildir. Ayrıca KATLANMIŞ teknik katman — techBox kutusu, TERM_TR'nin
 * `teknik` alanı ve "(Teknik adı: …)" cümlesi — ana akış sayılmaz: teknik
 * ad silinmez, bir katman aşağıda durur (W15-DEĞİŞMEZLER §2, §3).
 * ===================================================================== */
describe("W15 şerit F · kilitleme", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  const SCRIPT_OPEN = "<script>";
  const scriptStart = html.indexOf(SCRIPT_OPEN) + SCRIPT_OPEN.length;
  const scriptEnd = html.indexOf("</script>");
  const bodyStart = html.indexOf("</style>") + "</style>".length;

  const rawScript = html.slice(scriptStart, scriptEnd);
  const rawBody = html.slice(bodyStart, scriptStart - SCRIPT_OPEN.length);

  // Yorumları boşluğa çeviren, dizgeleri koruyan küçük tarayıcı. Kaba bir
  // regex bunu yapamaz: bir dizgenin içindeki eğik çizgi çifti yorum değildir.
  function stripJsComments(src: string): string {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const two = src.slice(i, i + 2);
      if (two === "/" + "*") {
        const end = src.indexOf("*" + "/", i);
        const stop = end < 0 ? src.length : end + 2;
        out += src.slice(i, stop).replace(/[^\n]/gu, " ");
        i = stop;
      } else if (two === "//") {
        let end = src.indexOf("\n", i);
        if (end < 0) { end = src.length; }
        out += " ".repeat(end - i);
        i = end;
      } else if (src[i] === '"' || src[i] === "'") {
        const quote = src[i]!;
        let j = i + 1;
        while (j < src.length && src[j] !== quote) {
          if (src[j] === "\\") { j += 1; }
          j += 1;
        }
        out += src.slice(i, j + 1);
        i = j + 1;
      } else {
        out += src[i];
        i += 1;
      }
    }
    return out;
  }

  // Katlanmış teknik kutunun tamamını (parantez eşleyerek, dizgelerin
  // içindeki parantezleri sayMAdan) boşluğa çevirir.
  function blankTechBoxes(src: string): string {
    let out = src;
    for (;;) {
      const at = out.indexOf("techBox(");
      if (at < 0) { return out; }
      let depth = 0;
      let i = at + "techBox".length;
      for (; i < out.length; i += 1) {
        const c = out[i]!;
        if (c === '"' || c === "'") {
          const quote = c;
          i += 1;
          while (i < out.length && out[i] !== quote) {
            if (out[i] === "\\") { i += 1; }
            i += 1;
          }
          continue;
        }
        if (c === "(") { depth += 1; }
        else if (c === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      out = out.slice(0, at) + " ".repeat(i - at) + out.slice(i);
    }
  }

  const script = stripJsComments(rawScript);

  // Katlanmamış ana akış: yorumsuz betikten teknik katman çıkarılmış hâli.
  const mainFlow = blankTechBoxes(script)
    .replace(/teknik:\s*"(?:[^"\\]|\\.)*"/gu, " ")
    .replace(/"[^"\n]*Teknik adı:[^"\n]*"/gu, " ");

  function stringLiterals(src: string): string[] {
    return (src.match(/"(?:[^"\\\n]|\\.)*"/gu) ?? []).map((s) => s.slice(1, -1));
  }

  // Gövdedeki görünen metin: etiketler ve HTML yorumları atılır, görünen
  // nitelikler (title / aria-label / placeholder) geri eklenir.
  const bodyVisible = [
    rawBody.replace(/<!--[\s\S]*?-->/gu, " ").replace(/<[^>]*>/gu, " "),
    ...(rawBody.match(/(?:title|aria-label|placeholder)="[^"]*"/gu) ?? []),
  ].join("\n");

  const mainFlowLines = [...stringLiterals(mainFlow), ...bodyVisible.split("\n")];

  it("(1) katlanmamış ana akışta hiçbir mühendislik sözcüğü görünmez", () => {
    // Kanonik sözlük (W15-DEĞİŞMEZLER §3): sol sütun ASLA görünmez.
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ["Unicode", /unicode/iu],
      ["korpus", /korpus/iu],
      ["endpoint", /endpoint/iu],
      ["sentetik", /sentetik/iu],
      // Kısaltmalar BÜYÜK harfli biçimleriyle yasaktır; küçük harfli
      // "yedek.json" bir DOSYA ADIDIR, avukat onu klasöründe zaten görür.
      ["JSON", /\bJSON\b/u],
      ["MCP", /\bMCP\b/u],
    ];
    for (const [name, rx] of forbidden) {
      const hits = mainFlowLines.filter((line) => rx.test(line));
      expect(hits.slice(0, 3), `"${name}" katlanmamış ana akışta görünüyor`).toEqual([]);
    }

    // "SHA-256" bir CÜMLENİN içinde hiç geçmez. Çıplak dizge olarak yalnız
    // iki yerde kalır ve ikisi de ekranda değildir: tarayıcının kendi özet
    // çağrısı ve TERM_TR'nin katlanmış teknik adı.
    for (const line of mainFlowLines) {
      if (!/sha-?256/iu.test(line)) { continue; }
      expect(line.trim(), "SHA-256 bir cümlenin içinde görünüyor").toBe("SHA-256");
    }
    expect(script).toContain('window.crypto.subtle.digest("SHA-256"');
    expect(script).toContain('teknik: "SHA-256"');
    expect((script.match(/"SHA-256"/gu) ?? []).length).toBe(2);

    // Teknik ad SİLİNMEDİ: katlanmış katmanda hâlâ duruyor.
    expect(html).toContain('el("span", "hteknik", " (Teknik adı: SHA-256.)")');
    expect(html).toContain('teknik: "Unicode karakter sayımı"');
    expect(html).toContain('teknik: "JSON"');
  });

  it("(2) açıklama ve tanım cümleleri uyarı kanalından geçmez", () => {
    // W15-DEĞİŞMEZLER §2: uyarı bütçesi (4 blok / 8 cümle) korunur, ama
    // AÇIKLAMA UYARI DEĞİLDİR. Açıklama `.expl-def` ile çizilir; kırmızı
    // zemin, çerçeve ve ikon almaz, noticeLine()'dan geçmez, bütçeyi yemez.
    expect(html).toContain("function noticeLine(box, cls, text)");
    // Bütçe sayacı YALNIZ noticeLine içinde artar; ikinci bir yol yok.
    expect((html.match(/answerNotice\.sentences \+= 1/gu) ?? []).length).toBe(1);
    // Uyarı çizgisi sınıfını yalnız noticeLine yazar.
    expect((html.match(/"warnline" \+ \(cls \? " " \+ cls : ""\)/gu) ?? []).length).toBe(1);

    // Hiçbir noticeLine çağrısı açıklama sınıfı taşımaz.
    const noticeCalls = html.match(/noticeLine\(\s*[A-Za-z0-9_.]+\s*,\s*("[^"]*"|null)/gu) ?? [];
    expect(noticeCalls.length).toBeGreaterThan(5);
    for (const call of noticeCalls) {
      expect(call).not.toContain("expl-def");
    }
    // Ve hiçbir açıklama ögesi uyarı sınıfını da taşımaz.
    expect(html).not.toMatch(/"expl-def[^"]*warnline/u);
    expect(html).not.toMatch(/"warnline[^"]*expl-def/u);

    // Sınıfın kendisi uyarı süsü taşımaz — bu bir GÖRSEL sözdür.
    const at = html.indexOf("\n.expl-def {");
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, at + 260)).toContain("padding: 0; border: 0; background: none;");
  });

  it("(3) TERM_TR tek tanım kaynağıdır — Sözlük ekranı ikinci bir tanım yazmaz", () => {
    // Sözlük maddesi TERM_TR nesnesinden çizilir; hiçbir tanım ikinci kez
    // elle yazılmaz. Aynı terime iki farklı söz veren iki ekran yapısal
    // olarak imkânsız olsun.
    const at = html.indexOf("function glossItem(key) {");
    const body = html.slice(at, html.indexOf("\n  }", at));
    expect(body).toContain("var t = TERM_TR[key];");
    // Maddede yalnız TERM_TR alanları ve sabit ÖNEKLER geçer; hiçbir tanım yok.
    const literals = [...new Set(stringLiterals(stripJsComments(body)))].sort();
    expect(literals).toEqual([
      "(Teknik adı: ",
      ".)",
      "Neden önemli: ",
      "Nerede görürsünüz: ",
      "b",
      "div",
      "g",
      "gt",
      "p",
      "tech",
      "where",
      "why",
    ]);

    // Her tanım cümlesi dosyada BİR kez geçer: ikinci kopya = ikinci hakikat.
    const terms = html.slice(html.indexOf("var TERM_TR = {"));
    const tanimlar = (terms.match(/\n {6}tanim: "(?:[^"\\]|\\.)*"/gu) ?? [])
      .map((m) => m.slice(m.indexOf('"') + 1, -1));
    expect(tanimlar.length).toBeGreaterThan(20);
    for (const t of tanimlar) {
      expect(html.split(t).length - 1, `tanım ikinci kez yazılmış: ${t.slice(0, 48)}`).toBe(1);
    }
  });

  it("(4) #nasil ve #sozluk hash ile açılır, argüman istemez ve geri yolunu taşır", () => {
    // İkisi de GİZLİ görünümdür ve argümansız çalışır: "#nasil" tek başına yeter.
    expect(html).toContain('nasil: "ayarlar", sozluk: "ayarlar"');
    expect(html).toContain("nasil: true, sozluk: true");
    // parseHash argümansız gizli görünümü tanır; yoksa "dosyalarim"a düşerdi.
    expect(html).toContain(
      "if (HIDDEN_VIEWS[name] && (arg || ARGLESS_HIDDEN[name] === true)) { return { name: name, arg: arg }; }",
    );
    expect(html).toContain('if (name === "nasil") { openNasil(); }');
    expect(html).toContain('if (name === "sozluk") { openSozluk(); }');
    // Her ikisi de KENDİ geri bağlantısını taşır — çıkmaz sokak değildir.
    for (const id of ["nasil", "sozluk"]) {
      expect(html).toContain(`<section id="view-${id}" hidden`);
      expect(html).toContain(`<button type="button" class="ghost small" id="${id}-back">← Ayarlar</button>`);
      expect(html).toContain(`on("${id}-back", "click", function () { gotoView("ayarlar"); });`);
    }
    // TEK KAPI: hiçbiri kendiliğinden açılmaz; üst çubuktaki "?" menüsünden açılır.
    expect(html).toContain('["Nasıl çalışır?", function () { gotoView("nasil"); }],');
    expect(html).toContain('["Sözlük", function () { gotoView("sozluk"); }],');
  });

  it("(5) hiçbir görünen metin doğruluk iddiası taşımaz", () => {
    // W15-DEĞİŞMEZLER §2: ürün doğruluk yüzdesi iddia etmez. "%100" hiç
    // geçmez; "garanti" ve "hatasız" YALNIZ açık bir OLUMSUZLAMANIN içinde
    // geçebilir ("garanti vermez", "doğruluk garantisi değildir").
    for (const line of mainFlowLines) {
      expect(/%\s*100|yüzde\s*100/iu.test(line), `doğruluk yüzdesi iddiası: ${line.trim().slice(0, 90)}`)
        .toBe(false);
    }
    const negations = [/garanti vermez/u, /garantisi değildir/u, /hatasız” demez/u, /hatasız" demez/u];
    for (const line of mainFlowLines) {
      if (!/garanti|hatasız/iu.test(line)) { continue; }
      expect(
        negations.some((rx) => rx.test(line)),
        `"garanti"/"hatasız" olumsuzlama dışında geçiyor: ${line.trim().slice(0, 90)}`,
      ).toBe(true);
    }
    // Ve dürüstlük cümlesi gerçekten ekranda duruyor.
    expect(html).toContain("ColleX yüzde vermez, garanti vermez, ");
    expect(html).toContain("Bu bir doğruluk garantisi değildir");
  });

  it("(6) hiçbir yerde tek başına 'hazır' durumu yazılmaz", () => {
    // Kütüphane deneme belgesi taşıyor ya da boşken "hazır" üstü kapalı bir
    // doğruluk iddiasıdır. Bir sayaç ya da rozet ASLA yalnızca "hazır"
    // demez; ne olduğunu söyler.
    for (const raw of mainFlowLines) {
      const s = raw.trim().replace(/[.!]$/u, "");
      expect(/^(durum:\s*)?hazır$/iu.test(s), `tek başına "hazır" yazılmış: ${raw}`).toBe(false);
    }
    // Karşılama ekranının sistem satırı kütüphaneyi durumuyla anlatır.
    const at = html.indexOf("function welcomeSystemLine() {");
    const sys = html.slice(at, html.indexOf("\n  }", at));
    expect(sys).not.toMatch(/hazır/u);
    expect(sys).toContain("hukuk kütüphanesi — DENEME BELGELERİ (gerçek mevzuat değil)");
    expect(sys).toContain("hukuk kütüphanesi boş");
    // Izgara sayacı çalıştırılmadan önce ne olduğunu söyler.
    expect(html).toContain('<span class="chip mute" id="gridcount">henüz çalıştırılmadı</span>');
  });

  it("(7) uyarı taşıyan her etiket yanında '?' düğmesi taşır", () => {
    // W15-DEĞİŞMEZLER §4.6: uyarı taşıyan HER etiket "?" alır; kota konmaz.
    for (const key of ["durum etiketi", "KAYNAKSIZ", "yürürlük", "DOĞRULANMADI"]) {
      expect(html, `sözlükte tanımı yok: ${key}`).toContain(`"${key}": {`);
    }
    // 1) cevabın durum rozeti
    expect(html).toContain('defineTerm(chip("Durum: " + st[0], st[1] + " sentence")');
    expect(html).toContain('data.status === "ABSTAIN" ? "ÇEKİMSER" : "durum etiketi"');
    // 2) KAYNAKSIZ — hem taslak paragrafında hem taslak listesinde
    expect(html).toContain('defineTerm(el("span", "kaynaksiz", "⚠ KAYNAKSIZ — dayanağını siz eklemelisiniz"), "KAYNAKSIZ")');
    expect(html).toContain('defineTerm(el("span", "kaynaksiz", "⚠ KAYNAKSIZ"), "KAYNAKSIZ")');
    // 3) yürürlük rozetinin ALTI dalının hepsi
    const at = html.indexOf("function currentnessChip(cur) {");
    const cc = html.slice(at, html.indexOf("\n  }", at));
    expect((cc.match(/defineTerm\(/gu) ?? []).length).toBe(6);
    expect(cc).not.toMatch(/return chip\(/u);
    // 4) DOĞRULANMADI — üç ayrı yerde gösterilir (süre formu, süre sonucu,
    //    W22 "Tebligattan süreye" önerisi), üçü de "?" taşır
    expect(
      (html.match(/defineTerm\(chip\("DOĞRULANMADI — madde metniyle kontrol edin", "bad"\), "DOĞRULANMADI"\)/gu) ?? []).length,
    ).toBe(3);
    expect(html).not.toContain('appendChild(chip("DOĞRULANMADI');
    // "?" düğmesi gerçekten TERM_TR'den çizilir.
    expect(html).toContain("function qmarkButton(key)");
    expect(html).toContain('b.setAttribute("aria-label", "“" + t.ad + "” ne demek?");');
  });
});

/* =====================================================================
 * W15 ŞERİT F · GÖRSEL DEĞİŞMEZLER
 *
 * Görsel bulguların ölçülen kısmı burada kilitlenir. Her iddia dosyadan
 * HESAPLANIR (kontrast oranı, punto, kural varlığı); hiçbiri elle yazılmış
 * bir sayı değildir, böylece bir sonraki değişiklikte sessizce eskiyemez.
 * ===================================================================== */
describe("W15 şerit F · görsel değişmezler", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");
  const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

  const lightBlock = (() => {
    const m = html.match(/:root\s*\{([\s\S]*?)\n\}/);
    if (m === null) { throw new Error("light :root block not found"); }
    return m[1]!;
  })();
  const darkBlock = (() => {
    const m = html.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    if (m === null) { throw new Error("dark :root block not found"); }
    return m[1]!;
  })();
  const themes: ReadonlyArray<readonly [string, string]> = [["light", lightBlock], ["dark", darkBlock]];

  it("tek bir :root jeton bloğu vardır — aynı jeton iki yerde aranmaz", () => {
    // Ölçülen kusur: aralık ve punto jetonları dosyanın 1904. satırında
    // İKİNCİ bir :root'ta duruyordu; bir sayıyı değiştiren kişi ekranda
    // hiçbir şeyin değişmediğini görüyordu.
    expect((styleBlock.match(/^:root \{$/gmu) ?? []).length).toBe(1);
    for (const token of ["--sp-1:", "--fs-xs:", "--lh-body:", "--measure:", "--ui:"]) {
      expect(lightBlock).toContain(token);
    }
  });

  it.each(themes)("alıntı bloğu kart zemininden AYRIŞIR (%s tema)", (_name, block) => {
    // Eski değerler 1,06:1 (açık) ve 1,04:1 (koyu) idi — yani hiçbir fark yok.
    expect(contrast(tokenValue(block, "quote-bg"), tokenValue(block, "panel"))).toBeGreaterThan(1.1);
    // Ayrım yalnız zemine bırakılmaz: TAM OPAK 4 px mühür şerit + çerçeve.
    expect(html).toContain("box-shadow: inset 4px 0 0 var(--seal);");
    expect(html).toContain("border: 1px solid var(--line-strong);\n  border-radius: var(--r-sm);\n  padding: 16px 20px 16px 48px;");
  });

  it.each(themes)("kartın nerede başlayıp bittiği görünür (%s tema)", (_name, block) => {
    // Ölçülen kusur: koyu temada kart zemini/sayfa zemini 1,05:1, kartın
    // kenarı ise her iki temada 1,29:1 idi — kart bir kutu gibi okunmuyordu.
    // Kartın KENDİ kenarı artık --line-strong'dur ve her iki temada 1,5:1'in
    // üstündedir; koyu temada ayrıca yüzey rengi ayrımı kuruldu.
    expect(html).toContain("  border: 1px solid var(--line-strong);\n  border-radius: var(--r);");
    expect(contrast(tokenValue(block, "line-strong"), tokenValue(block, "panel"))).toBeGreaterThan(1.5);
  });

  it("koyu temada derinlik RENKLE kurulur, gölgeyle değil", () => {
    // Ölçülen kusur: koyu temada --panel ile --paper arası 1,05:1 idi ve
    // gölgeler neredeyse siyah bir zeminde hiçbir şey yapmıyordu; ekran tek
    // bir kahverengi-siyah leke gibi görünüyordu.
    expect(contrast(tokenValue(darkBlock, "panel"), tokenValue(darkBlock, "paper"))).toBeGreaterThan(1.2);
    expect(contrast(tokenValue(darkBlock, "line"), tokenValue(darkBlock, "panel"))).toBeGreaterThan(1.5);
  });

  it("tıklanabilir olanın kenarı --border, süslemenin --line'dır", () => {
    // --line panel üstünde 1,30:1: düğmenin nerede başlayıp bittiği görünmüyordu.
    for (const rule of [
      "border: 1px solid var(--border); /* W15 F: tıklanabilir sekme kabı — --border. */",
      "border: 1px solid var(--border); /* W15 F: seçilmemiş mod hapı da tıklanır — görünsün. */",
      "border: 1px solid var(--border); /* W15 F: açılıp kapanan kutu tıklanır. */",
      "border: 1px solid var(--border); /* W15 F: ikincil düğme kenarı görünür olmalı. */",
      "border: 1px solid var(--border); /* W15 F: satır silme düğmesi tıklanır. */",
    ]) {
      expect(html).toContain(rule);
    }
  });

  it("kalkıyorsa tıklanır, kalkmıyorsa tıklanmaz", () => {
    // Tıklanamayan kart fareye HİÇ tepki vermez.
    expect(html).toContain(".card:hover { transform: none; box-shadow: var(--shadow); }");
    expect(html).toContain("button.tpl:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }");
    expect(html).toContain("button.workcard:hover:not([disabled]) { transform: translateY(-2px); border-color: var(--seal); box-shadow: var(--shadow-lift); }");
    expect(html).toContain("button.workcard[disabled]:hover { transform: none; box-shadow: none; border-color: var(--line-strong); }");
  });

  it("seçim odak halkasıyla değil, renk + kalın kenar + Seçili yazısıyla anlatılır", () => {
    // Ölçülen kusur: seçili şablon ODAK HALKASINI seçim işareti olarak
    // kullanıyordu; sekmeyle gezen avukat her kartı "seçilmiş" görüyordu.
    expect(html).toContain("button.tpl.sel {\n  border: 2px solid var(--seal);");
    expect(html).toContain("background: color-mix(in srgb, var(--seal) 7%, var(--panel));");
    expect(html).not.toContain("box-shadow: var(--ring), var(--shadow);");
    expect(html).toContain('b.appendChild(el("span", "selmark", "Seçili"));');
    expect(html).toContain('b.setAttribute("aria-pressed", "false");');
    expect(html).toContain('buttonNode.classList.add("sel"); buttonNode.setAttribute("aria-pressed", "true");');
  });

  it("ekranda 13 px'in altında hiçbir yazı kalmaz", () => {
    // Kâğıt ayrı bir ortamdır: @media print blokları 12 puntoyla basar.
    const printSpans: Array<readonly [number, number]> = [];
    for (let at = styleBlock.indexOf("@media print"); at >= 0; at = styleBlock.indexOf("@media print", at + 1)) {
      let depth = 0;
      let i = at;
      for (; i < styleBlock.length; i += 1) {
        if (styleBlock[i] === "{") { depth += 1; }
        else if (styleBlock[i] === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      printSpans.push([at, i]);
    }
    const inPrint = (idx: number): boolean => printSpans.some(([a, b]) => idx >= a && idx < b);

    const tooSmall: string[] = [];
    for (const m of styleBlock.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(?:normal\s+)?(\d+(?:\.\d+)?)px/gu)) {
      const at = m.index ?? 0;
      if (inPrint(at)) { continue; }
      if (Number.parseFloat(m[1]!) < 13) {
        tooSmall.push(styleBlock.slice(Math.max(0, at - 60), at + 30).split("\n").pop() ?? m[0]);
      }
    }
    expect(tooSmall.slice(0, 5)).toEqual([]);
  });

  it("kâğıda basılan nüsha uyarısız çıkmaz", () => {
    // Ölçülen kusur: .strip, .stamp, #edissues ve footer.note yazdırmada
    // gizleniyordu; avukat çıktıyı dosyaya koyduğunda kendisini uyaran hiçbir
    // şey kalmıyordu ve taslak son hâli gibi görünüyordu.
    const printBlocks = styleBlock.split("@media print").slice(1).join("@media print");
    expect(printBlocks).not.toMatch(/\.strip,[^{]*\{\s*display: none/u);
    expect(printBlocks).toContain(".strip {\n    display: block; background: #fff; color: #000;");
    expect(printBlocks).toContain("footer.note {\n    display: block; color: #000;");
    expect(printBlocks).toContain("body.editing .stamp, body.editing .strip {\n    display: block !important;");
    expect(printBlocks).toContain("body.editing #edissues {\n    display: block !important;");
    expect(printBlocks).toContain('content: "KONTROL EDİLECEK NOKTALAR";');
    // Yalnız hiçbir uyarı taşımayan bilgi şeridi gizlenebilir.
    expect(printBlocks).toContain(".strip.mute { display: none; }");
  });

  it("görünürlük hiçbir animasyona bağlı değildir", () => {
    // Ölçülen kusur: rise karesi opacity:0'dan başlıyordu; animasyon
    // çalışmazsa içerik opacity:0'da kalıyor ve avukat BOŞ EKRAN görüyordu.
    expect(html).toContain("@keyframes rise { from { transform: translateY(12px); } }");
    expect(html).not.toContain("@keyframes rise { from { opacity: 0;");
  });

  it("kapalı yüzeyler okunur kalır (WCAG AA) ve gerekçe soluklaştırılmaz", () => {
    // 0,55 saydamlıkta gövde rengi zemine karşı ~2,4:1'e düşüyordu.
    expect(html).not.toMatch(/opacity: \.55; cursor: not-allowed/u);
    expect(html).toContain("label.rchip.disabled { cursor: not-allowed; opacity: .75; }");
    expect(html).toContain("button.ghost.disabled, button.ghost[disabled] { opacity: .75; cursor: not-allowed; }");
    // Kapalı iş kartının NE YAPTIĞINI anlatan satır tam opak ve gövde rengindedir.
    expect(html).toContain("button.workcard[disabled] > .wl { opacity: 1; color: var(--ink-soft); }");
    // Gerekçe her koşulda soluklaştırmanın dışındadır.
    expect(html).toContain("form.gateoff > *:not(.offreason) { opacity: .75; }");
    expect(html).toContain(".modeopt .offreason { color: var(--bad); opacity: 1; }");
  });

  it("Türkçe için bozuk olan küçük-büyük harf ve büyük harf dönüşümü kalmadı", () => {
    // Constantia'nın küçük büyük harf setinde Ş, Ğ, İ, Ç için gerçek glif yok.
    // Yorumlar kural değildir: "kaldırıldı" diyen yorum testi kırmamalı.
    const rules = styleBlock.replace(/\/\*[\s\S]*?\*\//gu, " ");
    expect(rules).not.toContain("all-small-caps");
    expect(rules).not.toContain("text-transform: uppercase");
    // Ve hiçbir harf aralığı 0,05em'i geçmez: sözcük harf yığınına dönmesin.
    const wide = (rules.match(/letter-spacing: (0?\.\d+)em/gu) ?? [])
      .filter((d) => Number.parseFloat(d.replace(/[^0-9.]/gu, "")) >= 0.05);
    expect(wide).toEqual([]);
  });

  it("hukuk metni serif, kabuk sans yazılır", () => {
    expect(lightBlock).toContain('--ui: "Segoe UI Variable Text"');
    expect(html).toContain("font: 15.5px/1.68 var(--ui);");
    expect(html).toContain(
      "blockquote.quote, .claim .text, .para .ptext, .edpara .ptext, .doctext,\n" +
      ".src h3, h1, h2, h3, .verdict .word, .verdict .expl, .duebig,\n" +
      ".welcome ol, .abstain-panel p, .note-p, .steps, .warnlist, .disclaimer,\n" +
      ".dsec .ptext, .gcell .gtext, .quote-label {\n  font-family: var(--serif);\n}",
    );
    // Daktilo yazısı yalnız GERÇEK makine dizgesinde kalır.
    expect(html).toContain(".hashline {\n  font-family: var(--mono);");
    expect(html).toContain(".rawcode {\n  font-family: var(--mono);");
    expect(html).not.toContain(".statusline { font-family: var(--mono);");
    expect(html).not.toContain(".timing { font: 13px/1.4 var(--mono);");
  });

  it("kendiliğinden hareket eden süs kalmadı", () => {
    // Bir kanıt sisteminde ekranda kendiliğinden hareket eden tek şey,
    // gerçekten bir şey OLURKEN olmalıdır.
    expect(html).not.toContain("@keyframes mgspin");
    expect(html).not.toContain("animation: mgspin");
    expect(html).not.toContain(".monomark:hover .mg-tick");
    // Birincil düğmedeki çapraz parıltı da kalktı.
    expect(html).not.toContain("button.seal::after, a.dl::after");
    expect(html).toContain("button.seal, a.dl { position: relative; }");
  });

  it("düz yazı okunur genişlikte kalır", () => {
    expect(lightBlock).toContain("--measure: 68ch;");
    expect(html).toContain(
      ".claim .text, .answermeta, .abstain-panel p, .note-p, .welcome ol,\n" +
      "blockquote.quote, .strip, .livebanner, .notyet, .empty, .stamp .notice-text,\n" +
      ".screenhead .sub, .hintline, .disclaimer, .duenote {\n  max-width: var(--measure);\n}",
    );
  });
});

/* =====================================================================
 * W16 · EKRANLAR (şerit B/C/D/E)
 *
 * Dört yeni yüzey: "olayı anlat -> ilgili kararlar", anlam benzerliğine
 * göre sıralama, karşı dilekçe analizi ve taslak ekranının iki yeni alanı.
 * Bu blok, sunucunun ALAN ADLARINI ve DEĞİŞMEZ CÜMLELERİNİ ekranla
 * karşılaştırır: iki yüzeyin aynı şeye iki farklı söz vermesi yapısal
 * olarak imkânsız olsun. Hiçbir cümle bu dosyaya elle KOPYALANMAMIŞTIR —
 * hepsi `src/**` içinden okunur ve `console.html` ile birebir eşitlenir.
 * ===================================================================== */
describe("W16 · ekranlar: ilgili karar, anlam sıralaması, dilekçe analizi", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  /** `var X = "a" + "b";` — birleştirilmiş dizgenin GERÇEK değeri. */
  function constValue(name: string): string {
    const at = html.indexOf(`var ${name} =`);
    expect(at, `console.html içinde ${name} yok`).toBeGreaterThan(0);
    const end = html.indexOf(";\n", at);
    const seg = html.slice(at, end);
    return (seg.match(/"(?:[^"\\]|\\.)*"/gu) ?? [])
      .map((s) => JSON.parse(s) as string)
      .join("");
  }

  /** `var OBJ = { KEY: "a" + "b", … };` — BÜYÜK_HARF anahtarlı dizge tablosu. */
  function objectStrings(objName: string): Record<string, string> {
    const at = html.indexOf(`var ${objName} = {`);
    expect(at, `console.html içinde ${objName} yok`).toBeGreaterThan(0);
    const end = html.indexOf("\n  };", at);
    const block = html.slice(at, end);
    const keys: { name: string; start: number }[] = [];
    for (const m of block.matchAll(/\n {4}([A-Z_]+):/gu)) {
      keys.push({ name: m[1] as string, start: (m.index ?? 0) + m[0].length });
    }
    const out: Record<string, string> = {};
    keys.forEach((k, i) => {
      const next = keys[i + 1];
      const stop = next === undefined ? block.length : block.indexOf(`\n    ${next.name}:`);
      const seg = block.slice(k.start, stop);
      out[k.name] = (seg.match(/"(?:[^"\\]|\\.)*"/gu) ?? [])
        .map((s) => JSON.parse(s) as string)
        .join("");
    });
    return out;
  }

  /** Bir üst düzey fonksiyonun gövdesi (iki boşluk girintili kapanışa kadar). */
  function fnBody(name: string): string {
    const at = html.indexOf(`function ${name}(`);
    expect(at, `console.html içinde ${name} yok`).toBeGreaterThan(0);
    const end = html.indexOf("\n  }", at);
    return html.slice(at, end);
  }

  /** W16'nın kendi betik bölgeleri (şerit B/C ve şerit D). */
  const w16Regions: readonly string[] = [
    html.slice(
      html.indexOf('/* ============ W16 şerit B/C · "olayı anlat'),
      html.indexOf("  /* ====================== B-13 · Atıf Denetim Raporu"),
    ),
    html.slice(
      html.indexOf("/* ================= W16 şerit D · karşı dilekçe analizi"),
      html.indexOf("  /* ========================= B-17 · Takvim ve duruşma"),
    ),
  ];

  it("(a) mutabakat sayısının YANINDA 'ilgililik puanı değildir' cümlesi durur", () => {
    // Sunucunun değişmez cümlesi ekranda BİREBİR duruyor. İkisi tek
    // kaynaktan gelmiyor (biri TypeScript sabiti, biri tarayıcı dizgesi),
    // bu yüzden EŞİTLİKLERİ burada ölçülür: biri değişirse test kırılır.
    expect(constValue("RELATED_RANKING_DISCLAIMER_TR")).toBe(RELATED_RANKING_DISCLAIMER);
    expect(RELATED_RANKING_DISCLAIMER).toContain("İLGİLİLİK PUANI DEĞİLDİR");

    // …ve cümle GERÇEKTEN çiziliyor: mutabakat listesinin kartında, katlanmadan.
    const render = fnBody("renderRelatedResult");
    expect(render).toContain('card.appendChild(el("p", "note-p", RELATED_RANKING_DISCLAIMER_TR));');

    // Satırın kendisinde de sayı yalnız bırakılmaz: rakamın hemen yanında
    // ne OLMADIĞINI söyleyen kısa cümle durur ve sözlük maddesine "?" açar.
    const row = fnBody("relatedRow");
    expect(row).toContain('chip((r.mutabakat || 0) + " ayrı arama buldu"');
    expect(row).toContain('defineTerm(mchip, "mutabakat sayısı")');
    expect(row).toContain('el("span", "mutwhy", "Bu bir ilgililik puanı değildir.")');
    // Sayı bir yüzdeye, orana ya da puana çevrilmez.
    expect(row).not.toMatch(/pct\(|puan[ıi]\s*:/u);
  });

  it("(b) anlam sıralaması kapalıyken NEDENİ yazılır ve hiçbir yerde yüzde çıkmaz", () => {
    expect(constValue("SEMANTIC_RERANK_DISCLAIMER_TR")).toBe(SEMANTIC_RERANK_DISCLAIMER);

    const sem = fnBody("relatedSemanticBlock");
    // Açık/kapalı durumu rozet olarak, nedeni CÜMLE olarak yazılır.
    expect(sem).toContain('chip(s.uygulandi === true ? "açık" : "kapalı"');
    expect(sem).toContain('box.appendChild(el("p", "note-p", s.mesaj || ""));');
    // TİPLİ neden silinmez: makine kodu katlanmış teknik kabında durur.
    expect(sem).toContain('techBox(box, [s.neden ? "Neden kodu: " + s.neden : null]);');
    // Kapalı olmak bir arıza değildir — listenin eksiksiz olduğu söylenir.
    expect(sem).toContain("Liste EKSİKSİZ geldi; yalnız sırası değişmedi.");
    // Değişmez cümle YALNIZ gerçekten uygulandığında yazılır.
    expect(sem).toContain('el("p", "expl-def", SEMANTIC_RERANK_DISCLAIMER_TR)');

    // Sözel kademe SÖZCÜKTÜR: üç etiketin hiçbirinde rakam yoktur…
    const bands = html.slice(html.indexOf("var SEMANTIC_BAND_TR = {"), html.indexOf("var kararMode ="));
    for (const band of ["yakın", "orta", "uzak"]) {
      expect(bands).toContain(`"${band}"`);
    }
    expect(bands).not.toMatch(/[0-9]/u);
    // …ve etiket ancak sıralama GERÇEKTEN çalıştıysa çizilir.
    expect(fnBody("relatedRow")).toContain("if (semanticOn === true && r.benzerlik");

    // W16'nın hiçbir ekranında yüzde yoktur: sunucu sayı vermiyor, ekran
    // da uydurmuyor. Ölçüm bölgenin tamamı üzerinde yapılır.
    // ("bu yüzden" bir bağlaçtır ve yasak değildir; ölçülen şey bir ORANIN
    //  ekrana yazılmasıdır — yüzde işareti, yüzde hesabı, "yüzdesi".)
    for (const region of w16Regions) {
      expect(region.length).toBeGreaterThan(1000);
      const code = region.replace(/\/\*[\s\S]*?\*\//gu, " ");
      expect(code.includes("%"), "W16 bölgesinde yüzde işareti var").toBe(false);
      expect(code.includes("pct("), "W16 bölgesinde yüzde hesabı var").toBe(false);
      expect(/yüzde(si|lik|\s+\d)/iu.test(code), "W16 bölgesinde bir oran yazılıyor").toBe(false);
    }
  });

  it("(c) üretilen aramaların listesi avukata GÖSTERİLİR, çalışmayan da dâhil", () => {
    const list = fnBody("relatedQueryList");
    expect(list).toContain('box.appendChild(el("h3", "fname", "Sizin adınıza şunları aradım"));');
    // Her sorgunun kendi metni, türü ve gerekçesi yazılır.
    expect(list).toContain('head.appendChild(el("b", null, q.text || ""));');
    expect(list).toContain('"Arama türü: " + q.kindLabel');
    expect(list).toContain('li.appendChild(el("div", "relqwhy", q.aciklama));');
    // Çalıştırılmayan arama SESSİZCE düşmez; ne olduğu ayrı cümleyle yazılır.
    expect(list).toContain('chip(q.calisti === false ? "çalıştırılmadı" : "çalıştırıldı"');
    expect(list).toContain("Bu arama YAPILMADI. Bulabileceği kararlar aşağıdaki listede yok.");

    // Liste HER iki yolda da çizilir: sonuç geldiğinde de, uç 502 verdiğinde de.
    const render = fnBody("renderRelatedResult");
    expect((render.match(/relatedQueryList\(/gu) ?? []).length).toBe(2);

    // Bütçe yüzünden koşmayan sorgular ADIYLA ve TİPLİ nedeniyle listelenir.
    const skipped = fnBody("relatedSkippedBlock");
    expect(skipped).toContain('"Çalıştırılmayan aramalar (" + skipped.length + ") — bu liste eksiktir"');
    expect(skipped).toContain('(s.text || "(arama)") + " — " + (s.message || "")');
    expect(skipped).toContain('if (s.reason) { codes.push((s.queryId || "arama") + " · " + s.reason); }');
    // Ve başarısız KAYNAK adıyla yazılır (aynı blok künye aramasıyla ortak).
    expect(render).toContain("card.appendChild(failedSourcesBlock(failed2));");

    // Kaynağın vermediği künye alanı ekranda da BOŞ kalır.
    const kunye = fnBody("relatedKunyeLine");
    expect(kunye).not.toMatch(/"-"|"—"|"\?"|bilinmiyor/u);
    expect(render).toContain("Kaynağın yazmadığı künye alanı burada da boş bırakılır");
  });

  it("(d0) W17/c: dilekçenin tarihi BUGÜNLE doldurulmaz, boş ve zorunlu kalır", () => {
    // MEASURED: the required "Dilekçenin tarihi" field was pre-filled with
    // today, so a report run without touching it printed today as the
    // petition's date and read every statute as of today.
    const open = fnBody("openDilekce");
    expect(open).not.toContain("todayIso");
    expect(open).not.toMatch(/dilekce-asof[\s\S]*\.value\s*=/u);
    expect(html).toContain(
      '<label class="lab" for="dilekce-asof">Dilekçenin tarihi (zorunlu)</label>',
    );
    // The run still refuses an empty date (the check this relies on).
    expect(fnBody("runDilekce")).toContain('toast("Dilekçenin tarihini girin');
  });

  it("(d) aleyhe kaynağın DÖRT durumu ekranda dört AYRI cümleyle karşılanır", () => {
    const meanings = objectStrings("CONTRARY_STATE_MEANING_TR");
    const labels = objectStrings("CONTRARY_STATE_LABEL_TR");
    // Dördü de var, dördü de sunucunun cümlesiyle birebir aynı.
    expect(Object.keys(meanings).sort()).toEqual([...CONTRARY_LANE_STATES].sort());
    for (const state of CONTRARY_LANE_STATES) {
      expect(meanings[state], `"${state}" ekran cümlesi sunucudan farklı`).toBe(
        CONTRARY_LANE_MEANING_TR[state],
      );
      expect(labels[state]).toBe(CONTRARY_LANE_LABEL_TR[state]);
    }
    // Dört cümle BİRBİRİNDEN farklıdır: biri öbürünün yerine geçemez.
    expect(new Set(Object.values(meanings)).size).toBe(4);

    // Her durum satırda kendi cümlesini alır — ve satır, durumu kod olarak
    // da saklar; "çalıştırılmadı" hiçbir yolda "bulunamadı"ya düşmez.
    const lane = fnBody("petitionLaneRow");
    expect(lane).toContain('box.appendChild(el("div", "dillanewhat", CONTRARY_STATE_MEANING_TR[state]));');
    expect(lane).toContain('CONTRARY_STATES.indexOf(lane.state) >= 0 ? lane.state : "ARAMA_BASARISIZ"');
    expect(lane).not.toMatch(/ARANDI_BULUNAMADI"\s*:\s*"CALISTIRILMADI/u);

    // Göz için de dört ayrı sınıf ve dört ayrı renk vardır: "arandı,
    // bulunamadı" ile "çalıştırılmadı" AYNI RENKTE çizilmez.
    const cls = html.slice(html.indexOf("var CONTRARY_STATE_CLASS = {"), html.indexOf("var CONTRARY_STATE_TONE = {"));
    const classNames = (cls.match(/"([a-z]+)"/gu) ?? []).map((s) => s.slice(1, -1));
    expect(new Set(classNames).size).toBe(4);
    for (const name of classNames) {
      expect(html).toContain(`.dillane.${name} { border-left-color:`);
    }
    const tones = objectStrings("CONTRARY_STATE_TONE");
    expect(tones["ARANDI_BULUNAMADI"]).not.toBe(tones["CALISTIRILMADI"]);
    // W17/c — a colour may not assert a DIRECTION nobody measured. The lane
    // counts rows; it never reads what a decision says. "sorgu sonuç
    // getirdi" used to be drawn red ("bad") and "arandı, bulunamadı" green
    // ("ok"): the screen said "there IS authority against you" / "you are
    // safe" in colour while the sentence beside it said ÖLÇÜLMEDİ.
    for (const ran of ["BULUNDU", "ARANDI_BULUNAMADI"]) {
      expect(["ok", "bad"], `${ran} bir yön rengiyle çiziliyor`).not.toContain(tones[ran]);
    }
    expect(html).not.toMatch(/\.dillane\.(bulundu|arandi) \{ border-left-color: var\(--(ok|bad)\)/u);
    // The two states that did NOT produce a result stay visually distinct
    // from the two that did, and from each other.
    for (const notRun of ["CALISTIRILMADI", "ARAMA_BASARISIZ"]) {
      expect(tones[notRun]).not.toBe(tones["BULUNDU"]);
      expect(tones[notRun]).not.toBe(tones["ARANDI_BULUNAMADI"]);
    }
    expect(tones["CALISTIRILMADI"]).not.toBe(tones["ARAMA_BASARISIZ"]);

    // Rapor sonundaki okuma kılavuzu da dördünü tek tek yazar.
    expect(fnBody("renderPetitionAnalysis")).toContain(
      "CONTRARY_STATE_LABEL_TR[state] + \": \" + CONTRARY_STATE_MEANING_TR[state]",
    );
    // Ve raporun sabit özet cümlesi BİREBİR ekranda durur.
    expect(constValue("PETITION_ANALYSIS_SUMMARY_TR")).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(fnBody("renderPetitionAnalysis")).toContain(
      'card.appendChild(el("p", "audsentence", PETITION_ANALYSIS_SUMMARY_TR));',
    );
  });

  it("(e) KAYNAKSIZ satır bir değerlendirme sözcüğü taşımaz ve görsel olarak ayrı durur", () => {
    const row = fnBody("petitionUnsourcedRow");
    // ColleX bu satıra KENDİ sıfatını eklemez: iki alan da sunucudan gelir.
    // W17/b: terim anahtarı bu ekrana ÖZEL. Taslak ekranlarının "KAYNAKSIZ"
    // tanımı ("dayanağını siz eklemelisiniz", "taslak dışa aktarılmaz") burada
    // yanlıştır — cümle karşı tarafındır, ortada taslak da dışa aktarma da
    // yoktur ve işaret bir kusur bildirimi değildir.
    expect(row).toContain(
      'defineTerm(el("span", "ul", f.line || ""), "KAYNAKSIZ (dilekçe incelemesi)")',
    );
    expect(row).toContain('el("span", "uq", "“" + (f.alinti || "") + "”")');
    // Fonksiyonun KENDİ dizgelerinde hiçbir değerlendirme sözcüğü yok.
    const literals = (row.match(/"(?:[^"\\\n]|\\.)*"/gu) ?? []).map((s) => s.slice(1, -1));
    const words = literals.join(" ").toLocaleLowerCase("tr-TR");
    for (const stem of EVALUATIVE_WORD_STEMS) {
      expect(words.includes(stem), `KAYNAKSIZ satırında değerlendirme sözcüğü: ${stem}`).toBe(false);
    }
    // Satır görsel olarak AYRI durur: kendi kesikli çerçevesi ve zemini var.
    expect(html).toContain(".dilunsourced { border: 1px dashed var(--warn);");
    expect(html).toContain('box = el("div", "dilunsourced");');
    // Ve kova içinde tek tek çizilir; sayısı da yazılır.
    const card = fnBody("petitionClaimCard");
    expect(card).toContain('"Dayanaksız ifade — " + (c.unsourced || []).length + " cümle"');
    expect(card).toContain("b3.appendChild(petitionUnsourcedRow(f));");
    // Üç kovanın üçü de vardır.
    expect(card).toContain('"Atıf denetimi — "');
    expect(card).toContain('defineTerm(el("b", "bt", "Aleyhe kaynak"), "aleyhe değerlendirme")');
  });

  it("(f) yeni terimler TERM_TR'de tanımlıdır ve W15 süpürmesi hâlâ geçer", () => {
    const block = html.match(/var TERM_TR = \{[\s\S]*?\n {2}\};/u)![0]!;
    for (const term of [
      "mutabakat sayısı",
      "anlam benzerliğine göre sıralama",
      "dayanak kapsamı",
      "aleyhe değerlendirme",
    ]) {
      const at = block.indexOf(`"${term}": {`);
      expect(at, `TERM_TR "${term}" maddesini taşımalı`).toBeGreaterThan(0);
      expect(block.slice(at, at + 900)).toContain("tanim:");
    }
    // Tanım TEK KAYNAKTAN gelir: Sözlük ekranı ikinci bir tanım yazmaz, bu
    // yüzden her tanım cümlesi dosyada bir kez geçer.
    const tanimlar = (block.match(/\n {6}tanim: "(?:[^"\\]|\\.)*"/gu) ?? [])
      .map((m) => m.slice(m.indexOf('"') + 1, -1));
    expect(tanimlar.length).toBeGreaterThanOrEqual(26);
    for (const t of tanimlar) {
      expect(html.split(t).length - 1, `tanım ikinci kez yazılmış: ${t.slice(0, 48)}`).toBe(1);
    }
    // "Dayanak kapsamı" sözlük maddesi ekrandaki alana bağlıdır; bağ, sunucunun
    // ALAN YOLU üzerinden kurulur, etiket metni üzerinden değil.
    // (`fieldDefs` `matter.` önekini düşürür; anahtar o sadeleşmiş yoldur.)
    expect(html).toContain('"ekBilgiler.kapsam": "dayanak kapsamı"');
    expect(html).toContain('return p.indexOf("matter.") === 0 ? p.slice(7) : p;');
    expect(html).toContain("if (TERM_BY_FIELD_PATH[def.path]) { defineTerm(lab, TERM_BY_FIELD_PATH[def.path]); }");

    // W15 yasak sözcük süpürmesi W16 bölgeleri üzerinde de geçer: katlanmamış
    // ana akışta hiçbir mühendislik sözcüğü yok. (Yorumlar avukata görünmez,
    // teknik kutu katlanmıştır — ikisi de ölçümün dışındadır.)
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ["Unicode", /unicode/iu],
      ["korpus", /korpus/iu],
      ["endpoint", /endpoint/iu],
      ["sentetik", /sentetik/iu],
      ["JSON", /\bJSON\b/u],
      ["MCP", /\bMCP\b/u],
      ["SHA-256", /sha-?256/iu],
    ];
    for (const region of w16Regions) {
      const visible = region
        .replace(/\/\*[\s\S]*?\*\//gu, " ")
        .replace(/techBox\([\s\S]*?\);/gu, " ");
      const literals = (visible.match(/"(?:[^"\\\n]|\\.)*"/gu) ?? []).map((s) => s.slice(1, -1));
      for (const [name, rx] of forbidden) {
        expect(
          literals.filter((line) => rx.test(line)).slice(0, 3),
          `"${name}" W16 ana akışında görünüyor`,
        ).toEqual([]);
      }
      // Ve hiçbir doğruluk iddiası yok.
      for (const line of literals) {
        expect(/%\s*100|garanti|hatasız/iu.test(line), `doğruluk iddiası: ${line.slice(0, 80)}`).toBe(false);
      }
    }
  });

  it("(g) taslak ekranı olay anlatısını ve dayanak kapsamını sunucunun alanlarından çizer", () => {
    // Bu iki alan `templates.ts` içinde tanımlıdır; ekran onları kendi
    // elleriyle YAZMAZ, `fields[]` üzerinden çizer. Ölçülen şey budur.
    const mutalaa = DRAFT_TEMPLATES.find((t) => t.id === "hukuki-mutalaa");
    expect(mutalaa, "14. şablon (Hukukî Mütalaa) listede olmalı").toBeDefined();
    expect(DRAFT_TEMPLATES.length).toBe(14);
    const olay = mutalaa!.fields.find((f) => f.path === "matter.ekBilgiler.olayAnlatisi");
    const kapsam = mutalaa!.fields.find((f) => f.path === "matter.ekBilgiler.kapsam");
    expect(olay?.multiline).toBe(true);
    expect(kapsam?.kind).toBe("select");
    expect(kapsam?.options).toEqual(["Kısa", "Geniş"]);
    // KAPSAM_ACIKLAMASI, KAPSAM_SABIT_CUMLE ile başlar ve alanın kendi
    // yardım metnidir — ekran onu `def.help` olarak çizer.
    expect(kapsam?.help).toBe(KAPSAM_ACIKLAMASI);
    expect(KAPSAM_ACIKLAMASI.startsWith(KAPSAM_SABIT_CUMLE)).toBe(true);
    expect(html).toContain('if (def.help) { fld.appendChild(el("div", "fhelp", def.help)); }');
    // select ve çok satırlı alan gerçekten doğru araçla çizilir.
    const build = fnBody("buildField");
    expect(build).toContain('if (def.kind === "list" || def.multiline) {');
    expect(build).toContain('input = document.createElement("textarea");');
    expect(build).toContain('} else if (def.kind === "select") {');
    expect(build).toContain('input = document.createElement("select");');
    expect(build).toContain("def.options.forEach(function (o) {");
    // Ve ekranda artık ölçülmemiş bir şablon sayısı yazmaz.
    expect(html).not.toContain("13 hazır dilekçe kalıbı");
  });

  it("(h) iki yeni yüzey de çalışan uçlara bağlıdır (vaporware kapısı)", () => {
    // "Olayı anlat" kipi YENİ BİR GÖRÜNÜM AÇMAZ: aynı ekranın ikinci kipidir,
    // aynı geçit denetiminden geçer.
    expect(html).toContain('sendJson("/v1/sources/related", "POST", body, busy.signal)');
    expect(html).toContain('id="karar-mode-olay"');
    expect(html).not.toContain('id="view-ilgili-karar"');
    expect(html).toContain("function runKararSubmit()");
    expect(html).toContain('if (kararMode === "olay") { runRelatedSearch(); return; }');
    // Karşı dilekçe analizi kendi görünümüdür: gizli, argümansız, geri yollu.
    expect(html).toContain('id="view-dilekce"');
    expect(html).toContain('id="dilekce-back"');
    expect(html).toContain("dilekce: true");
    expect(html).toContain('if (name === "dilekce") { openDilekce(); }');
    expect(html).toContain('sendJson("/v1/contracts/petition-analysis", "POST", body, busy.signal)');
    // Belge yolu (fileId) açık; belge yoksa seçenek KAPATILIR ve nedeni yazar.
    expect(html).toContain("body.fileId = fid;");
    expect(html).toContain("— bu bilgisayarda yüklü belge yok —");
    expect(html).toContain("Şu an kullanılamıyor — önce Belgeler görünümünden bir belge yükleyin.");
    // Uzun beklemenin ikisinde de vazgeçme düğmesi var, yüzde çubuğu yok.
    expect(html).toContain('title: "İlgili kararlar aranıyor"');
    expect(html).toContain('title: "Dilekçe inceleniyor"');
    // Ve her yeni ekran tek cümlelik "bu ekranda ne yapılır" satırını taşır.
    expect(html).toContain("Bu ekrana karşı tarafın dilekçesini yapıştırır ya da yüklediğiniz belgelerden seçersiniz");
  });
});

/* =====================================================================
 * W17 · HIZLI ARAMA, KISAYOLLAR, SON AÇILANLAR, DOSYA PAKETİ, KİŞİLER,
 * BULUT KAYIT DEFTERİ
 *
 * Her yüzey bu sunucuda cevap veren bir uca bağlıdır (vaporware kapısı):
 * GET /v1/search/all · POST /v1/matters/{id}/package · /v1/contacts ·
 * POST /v1/contacts/conflict-check · GET /v1/ai/status · GET /v1/ai/ledger
 * · PATCH /v1/matters/{id}/items/{itemId}. Kapalı uç DEVRE DIŞI çizilir ve
 * nedenini kendi satırında söyler.
 * ===================================================================== */
describe("W17 · hızlı arama, kısayollar, son açılanlar, dosya paketi, kişiler, kayıt defteri", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("keeps the console contract on the new surfaces (one style, one script, LF-only, no markup channel)", () => {
    expect(html.includes("\r")).toBe(false);
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
    for (const [, pattern] of FORBIDDEN_IN_PAGE) expect(html).not.toMatch(pattern);
    for (const [, pattern] of FORBIDDEN_REMOTE) expect(html).not.toMatch(pattern);
  });

  it("ships the command palette on GET /v1/search/all with Turkish groups and an honest document line", () => {
    expect(html).toContain('id="palette"');
    expect(html).toContain('id="palq"');
    expect(html).toContain('id="palbtn"');
    expect(html).toContain('"/v1/search/all?q=" + encodeURIComponent(query) + "&limit=8"');
    // the console prints the openapi sentence instead of drawing an empty group
    expect(html).toContain("Belge içeriği bu sunucuda aranamıyor.");
    expect(html).toContain("Kayıtlarınızda eşleşme yok.");
    for (const g of ['matters: "Dosya"', 'documents: "Belge"', 'answers: "Cevap"', 'drafts: "Taslak"', 'deadlines: "Süre"', 'hearings: "Duruşma"']) {
      expect(html).toContain(g);
    }
    // rows open through the EXISTING openers, never by assembling a hash by hand
    expect(html).toContain("gotoDocument(row.fileId, row.chunkId ? { focusChunk: row.chunkId } : {})");
    expect(html).toContain("openStoredAnswer(row.runId, {})");
    expect(html).toContain("openStoredDraft(row.draftId)");
    expect(html).toContain('gotoView("dosya", row.id)');
    // Escape closes, Tab is trapped, the previous focus comes back
    expect(html).toContain('if (ev.key === "Escape") { ev.preventDefault(); closePalette(); return; }');
    expect(html).toContain("function trapTabInside(ev, panel)");
    expect(html).toContain("if (back && back.focus) { back.focus(); }");
    // a 404 is a typed Turkish sentence, not a bare code
    expect(html).toContain("Kayıtlarda arama bu kurulumda henüz açılmadı; yalnız ekran ve iş adları listelenir.");
  });

  it("documents the shortcuts and never fires a single-key shortcut while typing", () => {
    expect(html).toContain('id="shortcuts"');
    expect(html).toContain('["Klavye kısayolları", function () { openShortcuts(); }],');
    expect(html).toContain("function isTypingTarget(t)");
    expect(html).toContain("if (isTypingTarget(ev.target)) { return; }");
    expect(html).toContain('G_CHORD_VIEWS = { d: "dosyalarim", a: "arastir", b: "belgeler", t: "taslak", s: "ayarlar" }');
    expect(html).toContain("gotoView(VIEW_NAMES[Number(ev.key) - 1])");
    expect(html).toContain('if (ev.key === "?") { ev.preventDefault(); openShortcuts(); return; }');
    // the list itself is written in lawyer Turkish
    for (const label of ["Hızlı arama", "Dosyalarım", "Araştır", "Belgeler", "Taslak", "Ayarlar", "Açık pencereyi kapat"]) {
      expect(html).toContain(`<dd>${label}</dd>`);
    }
  });

  it("remembers the last opened records locally, capped at twelve, and draws them under the guide bar", () => {
    expect(html).toContain('var RECENT_KEY = "collex.console.recent.v1";');
    expect(html).toContain("var RECENT_CAP = 12;");
    expect(html).toContain('id="recentcard"');
    expect(html.indexOf('<div id="welcome" hidden></div>')).toBeLessThan(html.indexOf('id="recentcard"'));
    for (const hook of [
      'rememberRecent("dosya", id,',
      'rememberRecent("belge", fileId,',
      'rememberRecent("cevap", body.runId || runId,',
      'rememberRecent("taslak", draft.draftId,',
    ]) {
      expect(html).toContain(hook);
    }
    expect(html).toContain("Nerede kalmıştım? — son açılanlar");
    // and the palette lists them when the box is empty
    expect(html).toContain('palItem("Son açılan", recentLabel(r)');
  });

  it("downloads the matter package through POST /v1/matters/{id}/package with no progress bar, disabled with its reason on 404", () => {
    expect(html).toContain('fetch("/v1/matters/" + enc(m.id) + "/package", { method: "POST" })');
    expect(html).toContain("Dosya paketini indir");
    expect(html).toContain('link.setAttribute("download", name);');
    expect(html).toContain('"Şu an kullanılamıyor — " + PKG_OFF_TR');
    expect(html).toContain("Dosya paketi hazırlanıyor — bitince indirilenler listenizde görünecek.");
    // the route probe distinguishes "route missing" from "matter missing"
    expect(html).toContain('res.body.error.kind === "MATTER_NOT_FOUND"');
    // failure notes from the packager are printed as a list, never swallowed
    expect(html).toContain("err.notes.forEach(function (n) { ul.appendChild(el(\"li\", null, String(n))); });");
  });

  it("draws contacts and the conflict scan on the endpoints that exist, with the server's sentence verbatim", () => {
    expect(html).toContain('<section id="view-kisiler" hidden');
    expect(html).toContain('<button type="button" class="ghost small" id="kisiler-back">← Ayarlar</button>');
    expect(html).toContain('kisiler: "ayarlar"');
    expect(html).toContain("kisiler: true");
    expect(html).toContain('if (name === "kisiler") { openKisiler(); }');
    expect(html).toContain('getJson("/v1/contacts"');
    expect(html).toContain('sendJson("/v1/contacts/" + enc(editing), "PATCH", payload)');
    expect(html).toContain('sendDelete("/v1/contacts/" + enc(c.id))');
    // the name is personal data: it travels in a POST body, never a query string
    expect(html).toContain('sendJson("/v1/contacts/conflict-check", "POST", { ad: ad, rol: rol })');
    expect(html).not.toContain("conflict-check?");
    expect(html).toContain('id="nm-conflict"');
    expect(html).toContain("Çıkar çatışması taraması");
    expect(html).toContain('showNotYet(list, "GET /v1/contacts", "Kişi kartları")');
    // the sentence comes from the server; the browser only prefixes who was scanned
    expect(html).toContain('String(res.body.message || "")');
    expect(html).toContain("Bu ekranda müvekkil, karşı taraf, vekil, tanık ve bilirkişi kartlarını tutarsınız");
    // the lawyer is told what the scan IS (lexical), not what it is not measured to be
    expect(html).toContain("harf harf karşılaştırır");
  });

  it("shows the cloud ledger as counts in Turkish sentences and names the lane correctly", () => {
    expect(html).toContain('getJson("/v1/ai/status"), getJson("/v1/ai/ledger?limit=200")');
    expect(html).toContain("Bulut yapay zekâ kayıt defteri");
    expect(html).toContain('"Son bir saatte " + t.callsLastHour + " bulut çağrısı yapıldı"');
    expect(html).toContain('showNotYet(host, "GET /v1/ai/ledger", "Bulut yapay zekâ kayıt defteri")');
    expect(html).toContain("Kayıt defteri tutulmuyor: bulut yapay zekâ bu bilgisayarda tanımlı değil.");
    // the note is the server's own sentence, printed verbatim
    expect(html).toContain('note = typeof lg.body.note === "string" ? lg.body.note : "";');
  });

  it("lets the deadline panel choose its window and complete a row through PATCH", () => {
    expect(html).toContain('id="deadwindow"');
    expect(html).toContain("var DEAD_WINDOWS = [7, 14, 30];");
    expect(html).toContain("var until = addDaysIso(todayIso(), deadWindowDays());");
    expect(html).toContain('patchMatterItem(r.matterId, r.itemId, { payload: { status: "tamam" } }, "Süre tamamlandı olarak işaretlendi.");');
    expect(html).not.toContain('"önümüzdeki 14 gün boş"');
  });
});

describe("W18 · hukuk kütüphanem kartı ve sıralama sinyalleri satırı", () => {
  const html = readFileSync(CONSOLE_HTML, "utf8");

  it("keeps the console contract (one style, one script, LF-only, no markup channel, no remote asset)", () => {
    expect(html.includes("\r")).toBe(false);
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
    for (const [, pattern] of FORBIDDEN_IN_PAGE) expect(html).not.toMatch(pattern);
    for (const [, pattern] of FORBIDDEN_REMOTE) expect(html).not.toMatch(pattern);
  });

  it("draws the library card on GET /v1/library/status and publishes through POST /v1/library/ingest, disabled with its reason on 404", () => {
    expect(html).toContain('id="librarycard"');
    expect(html).toContain('id="librarybody"');
    expect(html).toContain('id="libraryrefresh"');
    expect(html).toContain('getJson("/v1/library/status")');
    expect(html).toContain('sendJson("/v1/library/ingest", "POST", {})');
    expect(html).toContain('ghostBtn("Kütüphaneye al"');
    expect(html).toContain('"Şu an kullanılamıyor — " + LIBRARY_OFF_TR');
    expect(html).toContain('techBox(host, "GET /v1/library/status → 404")');
    // counts stand side by side and are never summed; an unmeasured count is a sentence, not a 0
    expect(html).toContain("Kuyrukta bekleyen belge: ");
    expect(html).toContain("yayımlanmış belge: ");
    expect(html).toContain("Veritabanındaki belge sayısı ölçülemedi: veritabanı bu okumada cevap vermedi.");
    // a partial run is said plainly; the publisher's own failure lines are printed as a list
    expect(html).toContain('r.complete === false ? "Yayım eksik bitti — " + msg');
    expect(html).toContain("fails.forEach(function (f) { ul.appendChild(el(\"li\", null, String(f.message || f.error || f.path || \"yayımlanamayan belge\"))); });");
    // no progress bar for a call that cannot report progress
    expect(html).not.toMatch(/libraryprogress|<progress[^>]*library/);
    // wired into the Ayarlar loader and the refresh button
    expect(html).toContain("function loadAyarlarExtras() { loadAiLedgerCard(); loadLibraryCard(); }");
    expect(html).toContain('on("libraryrefresh", "click", loadLibraryCard);');
  });

  it("shows 'neden bu sırada' from the additive relevance object only under ranking colleX-heuristic, as signal names, never as a score", () => {
    expect(html).toContain('if (ranking === "colleX-heuristic" && r.relevance) {');
    expect(html).toContain("relatedRow(r, queryText, body.olay, semanticOn, body.ranking)");
    expect(html).toContain('"Neden bu sırada: "');
    expect(html).toContain('"sıralama sinyalleri: " + names.join(", ")');
    expect(html).toContain('"eşleşen sözcükler: " + lex.join(", ")');
    for (const k of ["subjectAgreement", "queryAgreement", "snippetOverlap", "merciWeight", "recency"]) {
      expect(html).toMatch(new RegExp(`${k}: "[^"]+"`));
    }
    const start = html.indexOf("var RELEVANCE_SIGNAL_TR");
    const end = html.indexOf("function relatedRow(r, queryText, olay, semanticOn, ranking)");
    const block = html.slice(start, end);
    expect(block.length).toBeGreaterThan(0);
    // the line names signals; it never prints the score, a percent, or calls itself a relevance score
    expect(block).not.toContain("rel.score");
    expect(block).not.toContain("%");
    expect(block.toLocaleLowerCase("tr-TR")).not.toContain("ilgililik puanı");
  });

  it("reports collapsed queries as a block, never silently", () => {
    expect(html).toContain('if (body.ranking === "colleX-heuristic" && collapsed.length) { card.appendChild(relatedCollapsedBlock(collapsed)); }');
    expect(html).toContain("Aynı şeyi arayacağı için birleştirilen aramalar (");
    expect(html).toContain('(c.text || "(arama)") + " → " + (c.collapsedInto || "") + (c.message ? " — " + c.message : "")');
  });

  it("adds its CSS only at the end of the style block, at or above 13 px, without uppercase transforms", () => {
    const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const at = styleBlock.indexOf("/* ===== W18 ·");
    expect(at).toBeGreaterThan(0);
    const tail = styleBlock.slice(at);
    expect(tail).not.toMatch(/text-transform\s*:\s*uppercase/);
    expect(tail).not.toMatch(/font-size\s*:\s*(?:[0-9]|1[0-2])px/);
    for (const cls of [".libwrap", ".libwhy", ".relwhy", ".relcollapsed"]) expect(tail).toContain(cls);
  });
});

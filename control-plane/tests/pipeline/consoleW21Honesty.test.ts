/**
 * W21 lane E · console honesty (hostile-review findings #17, #18, #19, #26,
 * #28, #29).
 *
 * The console must never turn uncertainty into a confident sentence: a cell
 * whose answer run could not finish is not "not found", an abstention speaks
 * about the retrieved passages and not the whole document, a deleted file is
 * not "a newer version", a cloud key under a LOCAL_ONLY policy is not "açık",
 * local OCR that ran is not "this computer cannot OCR", a page local OCR
 * read is not "no text", and (R2-33) a page local OCR read only with low
 * confidence or barely at all is not "converted, searchable".
 *
 * These tests RUN the page's own functions (sliced out of console.html) in a
 * VM with a small fake DOM, so they pin behaviour rather than source strings.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  ABSTAIN_IN_PASSAGES_TR,
  ANSWER_INCOMPLETE_TR,
  NO_PASSAGES_TR,
  SEARCH_LANE_DEGRADED_TR,
  SUPPORT_NOT_CHECKED_TR,
  notInRetrievedPassagesTr,
} from "../../src/reviewTables/worker.js";
import { LEGACY_CENSUS_TR } from "../../src/reviewTables/store.js";
import { CENSUS_PARTIAL_TR } from "../../src/reviewTables/routes.js";
import { operatorHintsPayload } from "../../src/platform/operatorHints.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "..", "public", "console.html"), "utf8");
const routesSrc = readFileSync(resolve(HERE, "..", "..", "src", "reviewTables", "routes.ts"), "utf8");

/** A top-level `function name(...) { ... }` of the page's script. */
function fn(name: string): string {
  const start = html.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in console.html`);
  const end = html.indexOf("\n  }\n", start + 1);
  return html.slice(start + 1, end + 4);
}

/** A top-level `var NAME = ...;` (one line, or an object/array block). */
function decl(name: string): string {
  const start = html.indexOf(`\n  var ${name} = `);
  if (start < 0) throw new Error(`var ${name} not found in console.html`);
  const lineEnd = html.indexOf("\n", start + 1);
  const firstLine = html.slice(start + 1, lineEnd);
  if (/[{[]$/u.test(firstLine)) {
    const close = html.indexOf(firstLine.endsWith("{") ? "\n  };\n" : "\n  ];\n", start + 1);
    return html.slice(start + 1, close + 5);
  }
  return html.slice(start + 1, html.indexOf(";\n", start) + 1);
}

// ---------------------------------------------------------------- fake DOM

class FakeNode {
  children: FakeNode[] = [];
  own = "";
  className = "";
  attrs: Record<string, string> = {};
  disabled = false;
  checked = false;
  title = "";
  type = "";
  id = "";
  classes = new Set<string>();
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    toggle: (c: string, on?: boolean) => { if (on ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
  };
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(" "); }
  set textContent(v: string) { this.own = String(v); this.children = []; }
  appendChild(c: FakeNode): FakeNode { this.children.push(c); return c; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(): void {}
  all(): FakeNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}

function fakeDocument(byId: Record<string, FakeNode> = {}) {
  return {
    createElement: (tag: string) => new FakeNode(tag),
    getElementById: (id: string) => byId[id] ?? null,
  };
}

// Lazy: a function missing from the page fails only the tests that need it.
const domHelpers = (): string => [fn("el"), fn("chip"), fn("ghostBtn"), fn("cpTruncate")].join("\n");

const cloudHelpers = (): string => [
  decl("AI_OFF_TEXT"),
  fn("aiConfigured"),
  fn("cloudAiUsable"),
  fn("cloudAiRefusedByPolicy"),
  decl("AI_POLICY_OFF_TEXT"),
  fn("cloudAiOffText"),
].join("\n");

/** health under the MAC-MINI recommendation: a key set, COLLEX_AI_POLICY=LOCAL_ONLY. */
const HEALTH_LOCAL_ONLY = {
  ai: { configured: true, liveTested: false, model: "m" },
  dataBoundary: "LOCAL_ONLY",
  aiPolicy: { policy: "LOCAL_ONLY", configuredPolicy: "LOCAL_ONLY", effectiveBoundary: "LOCAL_ONLY", cloud: { configured: true, allowed: false, consent: "per-request" } },
};
const HEALTH_CLOUD_ALLOWED = {
  ai: { configured: true, liveTested: false, model: "m" },
  dataBoundary: "ALLOW_CLOUD",
  aiPolicy: { policy: "CLOUD_ALLOWED", configuredPolicy: "CLOUD_ALLOWED", effectiveBoundary: "ALLOW_CLOUD", cloud: { configured: true, allowed: true, consent: "per-request" } },
};
const HEALTH_NO_KEY = {
  ai: { configured: false },
  dataBoundary: "ALLOW_CLOUD",
  aiPolicy: { policy: "CLOUD_ALLOWED", configuredPolicy: "CLOUD_ALLOWED", effectiveBoundary: "ALLOW_CLOUD", cloud: { configured: false, allowed: false, consent: "per-request" } },
};

function load(src: string, ctx: Record<string, unknown>): Record<string, any> {
  runInNewContext(src, ctx);
  return ctx as Record<string, any>;
}

// ------------------------------------------------------------------- #26

describe("W21 #26 · a cloud key under a LOCAL_ONLY policy is never shown as usable", () => {
  it("cloudAiUsable follows aiPolicy.cloud.allowed, then the data boundary, and fails closed", () => {
    const cases: Array<[unknown, boolean, boolean]> = [
      [HEALTH_LOCAL_ONLY, false, true],
      [HEALTH_CLOUD_ALLOWED, true, false],
      [HEALTH_NO_KEY, false, false],
      // older server: no aiPolicy — the effective boundary decides
      [{ ai: { configured: true }, dataBoundary: "LOCAL_ONLY" }, false, true],
      [{ ai: { configured: true }, dataBoundary: "ALLOW_CLOUD" }, true, false],
      // boundary LOCAL_ONLY wins even over a (contradictory) allowed flag
      [{ ...HEALTH_CLOUD_ALLOWED, dataBoundary: "LOCAL_ONLY" }, false, true],
      // aiPolicy without a cloud verdict: fail closed
      [{ ai: { configured: true }, dataBoundary: "ALLOW_CLOUD", aiPolicy: { policy: "CLOUD_ALLOWED" } }, false, true],
      [null, false, false],
    ];
    for (const [health, usable, refused] of cases) {
      const page = load(cloudHelpers(), { health });
      expect(page.cloudAiUsable(), JSON.stringify(health)).toBe(usable);
      expect(page.cloudAiRefusedByPolicy(), JSON.stringify(health)).toBe(refused);
      expect(page.cloudAiOffText()).toBe(refused ? page.AI_POLICY_OFF_TEXT : page.AI_OFF_TEXT);
    }
    expect(html).toContain("anahtar tanımlı ama yapay zekâ ilkesi bulutu kapatıyor");
  });

  function sysStatusRows(health: unknown): Record<string, string> {
    const body = new FakeNode("div");
    // R2-36: the tech box's launcher lines come from operatorScriptLines.
    const page = load([domHelpers(), cloudHelpers(), fn("operatorHintsOf"), fn("operatorScriptLines"), fn("renderSysStatus")].join("\n"), {
      health,
      document: fakeDocument({ sysstatusbody: body }),
      DB_STATE_TR: {}, MCP_STATE_TR: {}, AI_POLICY_TR: { LOCAL_ONLY: "yalnız bu bilgisayar — dışarıya hiçbir metin gitmez" },
      deadlineRulesInfo: null, deadlineRulesInfoLoading: true,
      getJson: () => new Promise(() => {}),
      emptyLine: () => {}, techBox: () => {}, fmtDateTimeTR: () => "",
    });
    page.renderSysStatus();
    const kv = body.children[0]!;
    const rows: Record<string, string> = {};
    for (let i = 0; i + 1 < kv.children.length; i += 2) {
      rows[kv.children[i]!.textContent] = kv.children[i + 1]!.textContent;
    }
    return rows;
  }

  it("Ayarlar › Sistem durumu: LOCAL_ONLY with a key says the policy closes the cloud, never 'açık'", () => {
    const rows = sysStatusRows(HEALTH_LOCAL_ONLY);
    expect(rows["Bulut yapay zekâ"]).not.toMatch(/^açık/u);
    expect(rows["Bulut yapay zekâ"]).toContain("anahtar tanımlı ama yapay zekâ ilkesi bulutu kapatıyor");
    expect(rows["Taranmış belgeyi metne çevirme"]).not.toMatch(/^açık/u);
    expect(rows["Taranmış belgeyi metne çevirme"]).toContain("yapay zekâ ilkesi bulutu kapatıyor");

    const open = sysStatusRows(HEALTH_CLOUD_ALLOWED);
    expect(open["Bulut yapay zekâ"]).toMatch(/^açık/u);
    expect(open["Taranmış belgeyi metne çevirme"]).toMatch(/^açık — /u);

    const noKey = sysStatusRows(HEALTH_NO_KEY);
    expect(noKey["Bulut yapay zekâ"]).toBe("kapalı — bu bilgisayardan dışarı hiçbir metin gitmiyor");
    expect(noKey["Taranmış belgeyi metne çevirme"]).toBe("kapalı — önce bulut yapay zekâ açılmalı");
  });

  it("the cloud-AI chip is disabled under LOCAL_ONLY and names the policy as the reason", () => {
    const cb = new FakeNode("input");
    const lab = new FakeNode("label");
    const hint = new FakeNode("p");
    const page = load([cloudHelpers(), fn("applyCloudAiState"), fn("cloudAiOn")].join("\n"), {
      health: HEALTH_LOCAL_ONLY,
      document: fakeDocument({ cloudai: cb, cloudailabel: lab, cloudaihint: hint }),
      syncCloudAiText: () => {},
    });
    cb.checked = true;
    page.applyCloudAiState();
    expect(cb.disabled).toBe(true);
    expect(cb.checked).toBe(false);
    expect(lab.title).toBe(page.AI_POLICY_OFF_TEXT);
    expect(hint.textContent).toContain("yapay zekâ ilkesi bulutu kapatıyor");
    expect(page.cloudAiOn()).toBe(false);
  });

  it("the scanned-page cloud OCR buttons (upload error card, document page) are disabled under LOCAL_ONLY", () => {
    const host = new FakeNode("div");
    const src = [domHelpers(), cloudHelpers(), fn("aiDisabledButton"), fn("unreadEmptyPages"),
      fn("scannedPdfCause"), fn("scannedPdfTR"), fn("intakeErrTR"), fn("fileErrorCard"), fn("renderOcrHook")].join("\n");
    const page = load(src, {
      health: HEALTH_LOCAL_ONLY, document: fakeDocument(), ERROR_KIND_TR: {}, activeMatter: null,
      openOcrDialog: () => {},
    });
    const err = { kind: "EXTRACTION_FAILED", message: "PDF metin katmanı yok denecek kadar az; taranmış PDF — OCR bu modda devre dışı", warnings: ["SCANNED_PDF_NO_OCR"] };
    const card = page.fileErrorCard("tarama.pdf", err, 422, host) as FakeNode;
    const cardBtn = card.all().find((n) => n.tag === "button")!;
    expect(cardBtn.textContent).toContain("Taranmış belgeyi metne çevir");
    expect(cardBtn.disabled).toBe(true);
    expect(cardBtn.title).toBe(page.AI_POLICY_OFF_TEXT);

    const holder = new FakeNode("span");
    page.renderOcrHook({ name: "tarama.pdf", warnings: [] }, holder, { pageCount: 2, pagesWithText: 1, emptyPages: [2] });
    const hookBtn = holder.children[0]!;
    expect(hookBtn.disabled).toBe(true);
    expect(hookBtn.title).toBe(page.AI_POLICY_OFF_TEXT);
  });

  it("the OCR dialog says nothing was sent or finished before a 200, and a 403 has its own sentence", () => {
    const dialog = fn("openOcrDialog");
    expect(dialog).not.toContain("Anthropic'e gönderildi, sayfalar okunuyor");
    const refusal = dialog.indexOf("if (res.status !== 200 || !res.body) {");
    const done = dialog.indexOf('st.textContent = "Tamamlandı (');
    expect(refusal).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(refusal);
    expect(dialog).toContain("if (!cloudAiUsable()) { toast(cloudAiOffText(), \"bad\"); return; }");
    expect(decl("ERROR_KIND_TR")).toContain("DATA_BOUNDARY_LOCAL_ONLY: ");
  });

  /** Runs applyHealth (top-bar pills) and welcomeSystemLine against one health. */
  function topBar(health: unknown): { tone: string; pill: string; welcome: string } {
    const pills: Record<string, FakeNode> = {};
    for (const id of ["pill-db", "pill-mcp", "pill-ai"]) {
      const t = new FakeNode("span");
      pills[id] = Object.assign(new FakeNode("button"), { querySelector: () => t });
    }
    const page = load([
      domHelpers(), cloudHelpers(), fn("setPill"), fn("applyHealth"),
      decl("WELCOME_DB_TR"), fn("groupTR"), fn("welcomeSystemLine"),
    ].join("\n"), {
      health, healthKnown: true,
      // cloudHelpers() ends with cloudAiOffText, whose slice also carries applyCloudAiState: give it its nodes.
      document: fakeDocument({
        ...pills, wheredb: new FakeNode("span"), whereuploadsline: new FakeNode("p"),
        cloudai: new FakeNode("input"), cloudailabel: new FakeNode("label"), cloudaihint: new FakeNode("p"),
      }),
      syncCloudAiText: () => {},
      DB_STATE_TR: {}, MCP_STATE_TR: {}, stripState: {},
      demoCorpusText: () => "", applyDemoNotice: () => {}, applyStrips: () => {},
      setLiveAvailability: () => {}, probeLiveGateway: () => {}, applyCorpusState: () => {},
      applyCloudAiState: () => {}, renderSysStatus: () => {},
    });
    page.applyHealth();
    const ai = pills["pill-ai"]! as FakeNode & { querySelector: () => FakeNode };
    return { tone: ai.className, pill: ai.querySelector().textContent, welcome: page.welcomeSystemLine() as string };
  }

  it("the top-bar pill and the welcome line never say 'açık' when the policy closes the cloud (runs applyHealth / welcomeSystemLine)", () => {
    const closed = topBar(HEALTH_LOCAL_ONLY);
    expect(closed.tone).toBe("pill mute");
    expect(closed.pill).not.toContain("açık");
    expect(closed.pill).toBe("Bulut yapay zekâ: kapalı — yapay zekâ ilkesi kapatıyor");
    expect(closed.welcome).not.toContain("bulut yapay zekâ açık");
    expect(closed.welcome).toContain("bulut yapay zekâ kapalı (anahtar tanımlı ama yapay zekâ ilkesi bulutu kapatıyor).");

    // an older server without aiPolicy, judged by its LOCAL_ONLY boundary
    const olderClosed = topBar({ ai: { configured: true, model: "m" }, dataBoundary: "LOCAL_ONLY" });
    expect(olderClosed.pill).not.toContain("açık");
    expect(olderClosed.welcome).not.toContain("bulut yapay zekâ açık");

    const open = topBar(HEALTH_CLOUD_ALLOWED);
    expect(open.tone).toBe("pill ok");
    expect(open.pill).toBe("Bulut yapay zekâ: açık · m");
    expect(open.welcome).toContain("bulut yapay zekâ açık.");

    const noKey = topBar(HEALTH_NO_KEY);
    expect(noKey.tone).toBe("pill mute");
    expect(noKey.pill).toBe("Bulut yapay zekâ: kapalı");
    expect(noKey.welcome).toContain("bulut yapay zekâ kapalı.");
  });

  async function ledgerLines(health: unknown, status: unknown): Promise<string> {
    const host = new FakeNode("div");
    const page = load([domHelpers(), cloudHelpers(), fn("groupTR"), fn("loadAiLedgerCard")].join("\n"), {
      health,
      document: fakeDocument({ ailedgerbody: host }),
      getJson: (url: string) => Promise.resolve(url.startsWith("/v1/ai/status")
        ? { status: 200, body: status }
        : { status: 200, body: { today: {}, limits: {}, entries: [] } }),
      showNotYet: () => {}, errMessage: () => "", humanError: () => "",
    });
    page.loadAiLedgerCard();
    await new Promise((r) => setTimeout(r, 0));
    return host.textContent;
  }

  it("the AI ledger card does not suggest a cloud call is possible when the policy closes the cloud (runs loadAiLedgerCard)", async () => {
    const status = { configured: true, model: "m" };
    const closed = await ledgerLines(HEALTH_LOCAL_ONLY, status);
    expect(closed).toContain("yapay zekâ ilkesi bulutu kapatıyor; bu yüzden bulut çağrısı yapılamaz");
    expect(closed).not.toContain("her istekte ayrıca onayınız istenir");

    const open = await ledgerLines(HEALTH_CLOUD_ALLOWED, status);
    expect(open).toContain("Bulut yapay zekâ bu bilgisayarda tanımlı (model: m); yine de her istekte ayrıca onayınız istenir.");

    // health unread: the policy is unknown, so no call is suggested either
    const unknown = await ledgerLines(null, status);
    expect(unknown).toContain("okunamadı");
    expect(unknown).not.toContain("her istekte ayrıca onayınız istenir");

    const noKey = await ledgerLines(HEALTH_NO_KEY, { configured: false, model: null });
    expect(noKey).toContain("Bulut yapay zekâ bu bilgisayarda tanımlı değil; bu yüzden bulut çağrısı yapılamaz.");
  });
});

// ------------------------------------------------------------------- #28

describe("W21 #28 · the upload error names the scanned-PDF cause the intake reported", () => {
  const src = (): string => [cloudHelpers(), fn("scannedPdfCause"), fn("scannedPdfTR"), fn("intakeErrTR")].join("\n");
  const base = "PDF metin katmanı yok denecek kadar az (~0 karakter / 3 sayfa); ";

  function say(err: unknown, health: unknown = HEALTH_CLOUD_ALLOWED): string {
    return load(src(), { health, ERROR_KIND_TR: {} }).intakeErrTR(err) as string;
  }

  it("OCR ran and read nothing: never 'this computer cannot convert image text'", () => {
    const text = say({
      kind: "EXTRACTION_FAILED",
      message: base + "taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı",
      warnings: ["taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı", "SCANNED_PDF_OCR_FAILED", "OCR_FAILED_PAGES:3"],
    });
    expect(text).toContain("yerel OCR sayfaları okumayı denedi ama hiçbir sayfadan yazı çıkaramadı");
    expect(text).not.toContain("çeviremez");
  });

  it("OCR ran out of its time budget: says so with the page count", () => {
    const text = say({
      kind: "EXTRACTION_FAILED",
      message: base + "taranmış PDF — yerel OCR süre sınırı içinde hiçbir sayfayı okuyamadı",
      warnings: ["SCANNED_PDF_OCR_FAILED", "OCR_BUDGET_EXCEEDED:4"],
    });
    expect(text).toContain("süre sınırı doldu");
    expect(text).toContain("4 sayfaya süre yetmedi");
    expect(text).not.toContain("çeviremez");
  });

  it("OCR not applied (tiny text layer on every page): says OCR was not applied, not 'no selectable text'", () => {
    const text = say({
      kind: "EXTRACTION_FAILED",
      message: base + "taranmış PDF — sayfalarda çok az metin var; yerel OCR bu sayfalara uygulanmadı",
      warnings: ["SCANNED_PDF_OCR_NOT_APPLIED"],
    });
    expect(text).toContain("yerel OCR bu sayfalara uygulanmadı");
    expect(text).not.toContain("çeviremez");
    expect(text).not.toContain("seçilebilir yazı yok");
  });

  it("no local OCR: only this case keeps 'ColleX bu bilgisayarda … çeviremez'", () => {
    const err = { kind: "EXTRACTION_FAILED", message: base + "taranmış PDF — OCR bu modda devre dışı", warnings: ["SCANNED_PDF_NO_OCR"] };
    expect(say(err)).toContain("ColleX bu bilgisayarda görüntüdeki yazıyı metne çeviremez.");
    // ...unless health reports a usable local OCR: the card never contradicts Ayarlar.
    const ready = say(err, { ...HEALTH_CLOUD_ALLOWED, ocr: { state: "OCR_READY" } });
    expect(ready).not.toContain("çeviremez");
    expect(ready).toContain("Bu belge okunurken yerel OCR kullanılmadı");
  });

  it("the machine code decides; an older server's sentence is the fallback; an unknown cause is not 'cannot OCR'", () => {
    // Code present: the prose is not consulted.
    expect(say({ kind: "EXTRACTION_FAILED", message: "taranmış", warnings: ["SCANNED_PDF_OCR_FAILED"] }))
      .toContain("okumayı denedi");
    // Older server (no warnings): the sentence it sent.
    expect(say({ kind: "EXTRACTION_FAILED", message: base + "taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı" }))
      .toContain("okumayı denedi");
    expect(say({ kind: "EXTRACTION_FAILED", message: base + "taranmış PDF — OCR bu modda devre dışı" }))
      .toContain("çeviremez");
    const unknown = say({ kind: "EXTRACTION_FAILED", message: "taranmış PDF", warnings: [] });
    expect(unknown).toContain("taranmış bir görüntüden oluşuyor olabilir");
    expect(unknown).not.toContain("çeviremez");
    // Not a scanned PDF at all.
    expect(say({ kind: "EXTRACTION_FAILED", message: "bozuk dosya", warnings: [] }))
      .toBe("Belge okunamadı; bozuk görünüyor. Kaynağından yeniden indirip deneyin.");
  });

  it("under a closed AI policy the cloud is named as unavailable, not offered", () => {
    const text = say({ kind: "EXTRACTION_FAILED", message: "x", warnings: ["SCANNED_PDF_OCR_FAILED"] }, HEALTH_LOCAL_ONLY);
    expect(text).toContain("Bulut yapay zekâ ile metne çevirme bu kurulumda kullanılamaz: yapay zekâ ilkesi bulutu kapatıyor.");
    expect(text).not.toContain("(2) bulut yapay zekâ açıksa");
  });
});

// ------------------------------------------------------------------- #29

describe("W21 #29 · pages local OCR read are an OCR note, never 'no text'", () => {
  // R2-33: scannedText also needs the OCR-sparse helper.
  const src = (): string => [fn("scannedText"), fn("unreadEmptyPages"), fn("ocrSparsePages"), fn("isPageStatCode")].join("\n");

  it("scannedText: OCR-read pages get the OCR note; only pages nothing read are 'metin yok'", () => {
    const page = load(src(), {});
    const ocrOnly = page.scannedText({ pageCount: 3, pagesWithText: 3, emptyPages: [], ocrPages: [3] }) as string;
    expect(ocrOnly).toContain("görüntüden okundu");
    expect(ocrOnly).toContain("sayfa 3");
    expect(ocrOnly).not.toContain("metin yok");
    expect(ocrOnly).not.toContain("alıntı yapılamaz");

    // An older record listing the page in both: it was read.
    const both = page.scannedText({ pageCount: 3, pagesWithText: 2, emptyPages: [3], ocrPages: [3] }) as string;
    expect(both).not.toContain("metin yok");

    const mixed = page.scannedText({ pageCount: 4, pagesWithText: 3, emptyPages: [2], ocrPages: [3] }) as string;
    expect(mixed).toContain("4 sayfanın 1 tanesinde metin yok");
    expect(mixed).toContain("aramada çıkmaz ve bu sayfalardan alıntı yapılamaz (sayfa 2)");
    expect(mixed).toContain("yerel OCR; sayfa 3");

    expect(page.isPageStatCode("OCR_PAGES:1")).toBe(true);
    expect(page.isPageStatCode("1 sayfa yerel OCR ile okundu (sayfa 3)")).toBe(false);
  });

  it("the document page's cloud OCR hook appears only for pages still unread", () => {
    // R2-33: renderOcrHook also consults the OCR-sparse helper.
    const page = load([domHelpers(), cloudHelpers(), fn("aiDisabledButton"), fn("unreadEmptyPages"), fn("ocrSparsePages"), fn("renderOcrHook")].join("\n"), {
      health: HEALTH_CLOUD_ALLOWED, document: fakeDocument(), activeMatter: null, openOcrDialog: () => {},
    });
    const hook = (pages: unknown, warnings: string[] = []) => {
      const holder = new FakeNode("span");
      page.renderOcrHook({ name: "k.pdf", warnings }, holder, pages);
      return holder.children.length;
    };
    expect(hook({ pageCount: 3, pagesWithText: 3, emptyPages: [], ocrPages: [3] }, ["OCR_PAGES:1"])).toBe(0);
    expect(hook({ pageCount: 3, pagesWithText: 2, emptyPages: [3], ocrPages: [3] })).toBe(0);
    expect(hook({ pageCount: 3, pagesWithText: 2, emptyPages: [2], ocrPages: [3] })).toBe(1);
    // R2-33: a page local OCR read only in part is not a read page either.
    expect(hook({ pageCount: 3, pagesWithText: 3, emptyPages: [], sparsePages: [3], ocrPages: [3] }, ["OCR_PAGES:1"])).toBe(1);
    // A sparse TEXT-LAYER page is not an OCR case.
    expect(hook({ pageCount: 3, pagesWithText: 3, emptyPages: [], sparsePages: [2], ocrPages: [3] })).toBe(0);
    // No page statistics: the SCANNED_PAGES warning still offers the hook.
    expect(hook(undefined, ["SCANNED_PAGES:1"])).toBe(1);
  });

  it("the file card chip and the 'Okunabilirlik' line use the unread pages, and OCR never hides them", () => {
    const card = fn("fileRowCard");
    expect(card).toContain('if (unreadEmptyPages(pages).length) {\n      head.appendChild(chip("taranmış sayfa uyarısı", "bad"));');
    expect(card).toContain('" sayfa görüntüden okundu (yerel OCR)"');
    const docPage = fn("renderDocumentPage");
    // R2-33: the 'Okunabilirlik' sentence moved into readabilityText (run below).
    expect(docPage).toContain('metaRow(list, "Okunabilirlik", readabilityText(pages, ext));');
    const readability = fn("readabilityText");
    const unread = readability.indexOf("(unreadPages.length");
    const ocrOnly = readability.indexOf('"Sayfa görüntülerindeki yazı metne çevrildi; görüntüden okunan metin hata içerebilir');
    expect(unread).toBeGreaterThan(0);
    expect(ocrOnly).toBeGreaterThan(unread);
    expect(docPage).toContain("var otherWarnings = (f.warnings || []).filter(function (w) { return !isPageStatCode(w); });");
  });
});

describe("W21 R2-33 · pages local OCR barely read, or read with low confidence, are never 'converted'", () => {
  const src = (): string =>
    [fn("scannedText"), fn("unreadEmptyPages"), fn("ocrSparsePages"), fn("isPageStatCode"), fn("readabilityText")].join("\n");
  // What intake/extract.py now writes for a 3-page scan OCR read only a header of.
  const ALL_PARTIAL = { pageCount: 3, pagesWithText: 3, emptyPages: [], sparsePages: [1, 2, 3], ocrPages: [1, 2, 3] };

  it("scannedText: a page OCR read only in part is never 'aramada çıkar' and never a sparse text layer", () => {
    const page = load(src(), {});
    const partial = page.scannedText(ALL_PARTIAL) as string;
    // Before the fix: "3 sayfanın yazısı … görüntüden okundu …: bu sayfalar
    // aramada çıkar" next to "Metin katmanı çok seyrek" for the same pages.
    expect(partial).not.toContain("aramada çıkar,");
    expect(partial).not.toContain("Metin katmanı çok seyrek");
    // Round three: the pages list carries no cause, so the sentence names every
    // possible one (it used to say "low confidence or very little" even for a
    // page read at 0.9 whose near-copy lines were withheld, R2-32).
    expect(partial).toContain("görüntüden yalnız kısmen okunabildi (yerel OCR; sayfa 1, 2, 3)");
    expect(partial).toContain("tamamının okunduğu doğrulanmadı");
    expect(partial).toContain("aranan ifadenin orada geçmediğini göstermez");

    const mixed = page.scannedText({ pageCount: 4, pagesWithText: 4, emptyPages: [], sparsePages: [1, 3], ocrPages: [2, 3] }) as string;
    expect(mixed).toContain("Metin katmanı çok seyrek olan sayfalar ayrıca işaretlendi; bu sayfalardaki içerik eksik olabilir (sayfa 1)");
    expect(mixed).toContain("1 sayfanın yazısı bu bilgisayarda görüntüden okundu (yerel OCR; sayfa 2): bu sayfalar aramada çıkar");
    expect(mixed).toContain("(yerel OCR; sayfa 3): bu sayfaların tamamının okunduğu doğrulanmadı");

    expect(page.isPageStatCode("OCR_LOW_CONFIDENCE_PAGES:3")).toBe(true);
  });

  it("R2-32 round three: a page whose OCR lines were withheld is never given a false cause, and its code is hidden", () => {
    const page = load(src(), {});
    // What intake/extract.py writes for a page read at 0.92 with one lone
    // amount withheld: ocrPages AND sparsePages, plus OCR_WITHHELD_LINES_PAGES.
    const withheld = page.scannedText({ pageCount: 2, pagesWithText: 2, emptyPages: [], sparsePages: [2], ocrPages: [2] }) as string;
    expect(withheld).not.toContain("düşük güvenle ya da çok az okunabildi");
    expect(withheld).toContain("metin katmanına çok benzeyen bazı satırlar metne eklenmemiş olabilir");
    expect(withheld).toContain("nedeni belge sayfasındaki uyarıda");
    expect(withheld).toContain("tamamının okunduğu doğrulanmadı");
    expect(withheld).not.toContain("aramada çıkar,");
    const line = page.readabilityText({ pageCount: 2, pagesWithText: 2, emptyPages: [], sparsePages: [2], ocrPages: [2] }, { ocr: true }) as string;
    expect(line).not.toContain("düşük güvenle ya da yalnız çok az okunabildi");
    expect(line).toContain("nedeni aşağıdaki uyarıda");
    // The bare machine code never reaches the lawyer; its sentence does.
    expect(page.isPageStatCode("OCR_WITHHELD_LINES_PAGES:1")).toBe(true);
    expect(page.isPageStatCode("1 sayfada yerel OCR'ın okuduğu bazı satırlar metin katmanındaki bir ifadeye çok benzediği için metne eklenmedi")).toBe(false);
  });

  it("readabilityText: OCR pages that are also sparse never read 'bütün sayfalarının yazısı … çevrildi'", () => {
    const page = load(src(), {});
    const line = page.readabilityText(ALL_PARTIAL, { ocr: true, pages: 3 }) as string;
    expect(line).not.toContain("bütün sayfalarının yazısı görüntüden metne çevrildi");
    expect(line).not.toContain("Başka sayfaların yazısı görüntüden metne çevrildi");
    // Round three: cause-neutral (R2-32 withheld lines are a third cause).
    expect(line).toContain("yalnız kısmen ya da düşük güvenle okunabildi — bu sayfaların tamamı okunmuş sayılmaz");

    // One page read in full, one only in part.
    const mixed = page.readabilityText({ pageCount: 3, pagesWithText: 3, emptyPages: [], sparsePages: [3], ocrPages: [2, 3] }, { ocr: true }) as string;
    expect(mixed).toContain("tamamı okunmuş sayılmaz");
    expect(mixed).toContain("Başka sayfaların yazısı görüntüden metne çevrildi");

    // Unread pages first; the partial OCR pages are still named.
    const unread = page.readabilityText({ pageCount: 3, pagesWithText: 2, emptyPages: [1], sparsePages: [3], ocrPages: [3] }, { ocr: true }) as string;
    expect(unread).toContain("Bazı sayfalarda yazı yok");
    expect(unread).toContain("yalnız kısmen okunabildi");
    expect(unread).not.toContain("Başka sayfaların yazısı görüntüden metne çevrildi");

    // Every OCR page read in full: unchanged.
    const full = page.readabilityText({ pageCount: 2, pagesWithText: 2, emptyPages: [], ocrPages: [1, 2] }, { ocr: true }) as string;
    expect(full).toContain("Belgenin bütün sayfalarının yazısı görüntüden metne çevrildi");
    // A sparse text layer without OCR keeps its own sentence.
    expect(page.readabilityText({ pageCount: 2, pagesWithText: 2, emptyPages: [], sparsePages: [2] }, {}))
      .toContain("Bazı sayfalarda çok az yazı çıkarıldı — bu sayfaların tamamı okunmuş sayılmaz.");
  });

  it("the file card's OCR chip counts the pages read only in part", () => {
    const card = fn("fileRowCard");
    expect(card).toContain("var ocrPartialCount = ocrSparsePages(pages).length;");
    expect(card).toContain('" tanesi yalnız kısmen"');
    // The sparse chip still follows sparsePages, which now holds these pages.
    expect(card).toContain('} else if (pages && Array.isArray(pages.sparsePages) && pages.sparsePages.length) {\n      head.appendChild(chip("seyrek metin uyarısı", "warn"));');
  });
});

// --------------------------------------------------------- #17 and #18

describe("W21 #17 / #18 · grid cells: an incomplete run is an error, an abstention names the passages", () => {
  const src = (): string => [
    decl("GRID_SUPPORT_TR"), decl("GRID_INCOMPLETE_REASONS"), decl("GRID_INCOMPLETE_TR"),
    // W21 round two (R2-21, R2-23, R2-24): the incomplete-run rules moved into gridIncompleteText.
    decl("GRID_NO_CLAIM_REASONS"), decl("GRID_LANE_FAILED"), decl("GRID_PLAN_QUERY_FAILED"), decl("GRID_LANE_DEGRADED_TR"), decl("GRID_NOT_CHECKED_TR"),
    fn("gridIncompleteText"), fn("gridAnswerIncomplete"), fn("gridCellOf"), fn("gridCellOfStored"), fn("cpTruncate"),
  ].join("\n");
  const page = (): Record<string, any> => load(src(), {});
  const evidence = [{ evidenceId: "e1", chunkId: "c1", startChar: 0, endChar: 10, quoteSha256: "x" }];
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

  it("in-browser: a PARTIAL run without claims (time budget, failed retrieval) is an error cell, never 'not found'", () => {
    const budget = plain(page().gridCellOf({ status: "PARTIAL", reasons: ["TIME_BUDGET_EXCEEDED"], claims: [], evidence, coverage: { missing: ["depozito"] } }));
    expect(budget.error).toBe(true);
    expect(budget.covered).toBe(false);
    expect(budget.text).toContain("tamamlanamadı");
    expect(budget.text).not.toContain("bulunamadı");
    expect(budget.text).not.toContain("geçtiği bir yer yok");

    const retrieval = plain(page().gridCellOf({ status: "PARTIAL", reasons: ["RETRIEVAL_DEGRADED", "CORPUS_UNAVAILABLE"], claims: [], evidence: [] }));
    expect(retrieval.error).toBe(true);
    expect(retrieval.text).not.toContain("bulunamadı");

    // W21 re-check (mirrors worker.ts isIncompleteAnswer): a failed drafter whose rule-based
    // fallback still produced a claim is an ANSWER; a failed drafter without a claim is not.
    const fallback = plain(page().gridCellOf({ status: "PARTIAL", reasons: ["DRAFTER_DEGRADED:timeout"], claims: [{ text: "x", evidenceIds: ["e1"] }], evidence }));
    expect(fallback.error).toBeFalsy();
    const drafter = plain(page().gridCellOf({ status: "PARTIAL", reasons: ["DRAFTER_DEGRADED:timeout"], claims: [], evidence }));
    expect(drafter.error).toBe(true);
    // Unknown shape (no status, no claims) is not an abstention either.
    expect(plain(page().gridCellOf(null)).error).toBe(true);
  });

  it("in-browser: an ABSTAIN speaks about the retrieved passages with the CB3 sentences", () => {
    const missing = plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence, coverage: { missing: ["depozito", "kira"] } }));
    expect(missing.error).toBeUndefined();
    expect(missing.text).toBe(notInRetrievedPassagesTr(["depozito", "kira"]));
    expect(missing.text).not.toContain("Bu belgede");
    expect(missing.support).toBe("abstained");

    expect(plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence })).text).toBe(ABSTAIN_IN_PASSAGES_TR);
    const none = plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence: [] }));
    expect(none.text).toBe(NO_PASSAGES_TR);
    expect(none.support).toBe("no_evidence");
    // The absolute sentence is never composed in the browser: nothing here read the whole document.
    expect(fn("gridCellOf")).not.toContain("geçtiği bir yer yok");
  });

  it("stored: a cell failed with ANSWER_INCOMPLETE_TR shows that reason and its retry", () => {
    const failed = plain(page().gridCellOfStored({ state: "failed", rowNo: 2, columnNo: 3, error: ANSWER_INCOMPLETE_TR }));
    expect(failed).toMatchObject({ covered: false, error: true, retry: { rowNo: 2, columnNo: 3 }, text: ANSWER_INCOMPLETE_TR });
    const other = plain(page().gridCellOfStored({ state: "failed", rowNo: 1, columnNo: 1, error: "statement timeout" }));
    expect(other.text).toBe("Bu hücre hesaplanamadı — statement timeout");
  });

  it("stored: a legacy 'not found' cell whose run did not end in ABSTAIN is shown as incomplete, with retry", () => {
    const legacy = plain(page().gridCellOfStored({
      state: "done", rowNo: 1, columnNo: 1, answerStatus: "PARTIAL", supportState: "abstained",
      answerText: "Bu belgede bu soruya karşılık bulunamadı.", provenance: [],
    }));
    expect(legacy.error).toBe(true);
    expect(legacy.retry).toEqual({ rowNo: 1, columnNo: 1 });
    expect(legacy.text).not.toContain("bulunamadı");

    const abstained = plain(page().gridCellOfStored({
      state: "done", rowNo: 1, columnNo: 2, answerStatus: "ABSTAIN", supportState: "abstained",
      answerText: ABSTAIN_IN_PASSAGES_TR, provenance: [],
    }));
    expect(abstained.error).toBeUndefined();
    expect(abstained.covered).toBe(false);
    expect(abstained.text).toBe(ABSTAIN_IN_PASSAGES_TR);
  });

  it("stored: a pre-CB3 abstention sentence is shown passage-scoped, never as a whole-document 'not found'", () => {
    const legacy = (supportState: string) => plain(page().gridCellOfStored({
      state: "done", rowNo: 1, columnNo: 1, answerStatus: "ABSTAIN", supportState,
      answerText: "Bu belgede bu soruya karşılık bulunamadı.", provenance: [],
    }));
    expect(legacy("abstained").text).toBe(ABSTAIN_IN_PASSAGES_TR);
    expect(legacy("no_evidence").text).toBe(NO_PASSAGES_TR);
    expect(legacy("abstained").covered).toBe(false);
  });

  it("the grid summary never calls a table with failed cells 'tamam' (runs finishGrid)", () => {
    function summary(cells: Record<string, unknown>, done: number, total: number, cancelled = false): string {
      const timing = new FakeNode("span");
      const grid = load([fn("gridFailedCount"), fn("gridCancelledCount"), fn("finishGrid")].join("\n"), {
        gridState: { running: true, cancelled, cells },
        document: fakeDocument({
          gridstop: new FakeNode("button"), gridrun: new FakeNode("button"), gridtiming: timing,
          gridcsv: new FakeNode("a"), gridcopy: new FakeNode("button"),
        }),
        setBar: () => {}, renderGridTable: () => {}, gridCsv: () => "", todayIso: () => "2026-09-17",
      });
      grid.finishGrid(done, total);
      return timing.textContent;
    }
    const ok = plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence }));
    const failed = plain(page().gridCellOfStored({ state: "failed", rowNo: 1, columnNo: 2, error: ANSWER_INCOMPLETE_TR }));

    expect(summary({ "f1::0": ok, "f1::1": failed }, 2, 2)).toBe("2/2 hücre · 1 hücre hesaplanamadı");
    expect(summary({ "f1::0": ok, "f1::1": ok }, 2, 2)).toBe("2/2 hücre tamam");
    expect(summary({ "f1::0": failed }, 1, 2, true)).toBe("durduruldu — 1/2 hücre · 1 hücre hesaplanamadı");
    // a table that never started is not "0/4 tamam"
    expect(summary({}, 0, 4)).toBe("0/4 hücre");
    // W21 re-check: a cancelled table whose one cell was retried is "done" on
    // the server; its stopped cells are still not answers.
    const stopped = plain(page().gridCellOfStored({ state: "cancelled", rowNo: 1, columnNo: 2 }));
    expect(summary({ "f1::0": ok, "f1::1": stopped, "f1::2": stopped }, 3, 3)).toBe(
      "3/3 hücre · 2 hücre durduruldu, hesaplanmadı",
    );
  });

  it("the grid draws an error chip and the retry button for an incomplete cell", () => {
    const out = new FakeNode("div");
    const grid = load([domHelpers(), decl("GRID_SUPPORT_TR"), fn("gridKey"), fn("renderGridTable")].join("\n"), {
      document: fakeDocument({ gridout: out }),
      gridState: {
        files: [{ fileId: "f1", name: "Kira.pdf" }],
        questions: ["Depozito ne kadar?"],
        cells: { "f1::0": plain(page().gridCellOfStored({ state: "failed", rowNo: 1, columnNo: 1, error: ANSWER_INCOMPLETE_TR })) },
      },
      VERDICT_TR: {}, gotoDocument: () => {}, retryGridCell: () => {},
    });
    grid.renderGridTable();
    const td = out.all().find((n) => n.tag === "td")!;
    const labels = td.all().map((n) => n.own);
    expect(labels).toContain("hesaplanamadı");
    expect(labels).toContain("Bu hücreyi yeniden dene");
    expect(td.textContent).toContain(ANSWER_INCOMPLETE_TR);
  });

  it("the console CSV says what a cell is: passage-scoped abstention, error, cancelled", () => {
    const csv = load([decl("GRID_SUPPORT_TR"), decl("GRID_STALE_TR"), fn("gridKey"), fn("csvField"), fn("gridRowStatus"), fn("gridCsv")].join("\n"), {
      STATUS_TR: { COMPLETE: ["Tam", "ok"] },
      gridState: {
        files: [{ fileId: "f1", name: "Kira.pdf" }],
        questions: ["a", "b", "c", "d"],
        cells: {
          "f1::0": plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence })),
          "f1::1": plain(page().gridCellOf({ status: "ABSTAIN", reasons: [], claims: [], evidence: [] })),
          "f1::2": plain(page().gridCellOfStored({ state: "failed", rowNo: 1, columnNo: 3, error: ANSWER_INCOMPLETE_TR })),
          "f1::3": plain(page().gridCellOfStored({ state: "cancelled", rowNo: 1, columnNo: 4 })),
        },
      },
    }).gridCsv() as string;
    const status = csv.split("\r\n").slice(1).map((line) => line.split(";")[3]);
    expect(status).toEqual([
      '"getirilen pasajlarda karşılık bulunamadı"',
      '"bu soru için pasaj getirilemedi"',
      '"hesaplanamadı"',
      '"iptal edildi"',
    ]);
  });

  it("the console's abstention labels are the server export's (routes.ts SUPPORT_TR)", () => {
    const block = routesSrc.slice(routesSrc.indexOf("const SUPPORT_TR"), routesSrc.indexOf("};", routesSrc.indexOf("const SUPPORT_TR")));
    const grid = load(decl("GRID_SUPPORT_TR"), {}).GRID_SUPPORT_TR as Record<string, [string, string]>;
    for (const key of ["abstained", "no_evidence"]) {
      const server = block.match(new RegExp(`${key}: "([^"]+)"`, "u"))?.[1];
      expect(server, key).toBeTruthy();
      expect(grid[key]![0]).toBe(server);
    }
  });
});

// ------------------------------------------------- round two: R2-21..R2-24

describe("W21 round two · grid cells: unchecked support, a failed search lane, a late budget, a partial census", () => {
  const page = (): Record<string, any> =>
    load(
      [
        decl("GRID_SUPPORT_TR"), decl("GRID_INCOMPLETE_REASONS"), decl("GRID_NO_CLAIM_REASONS"), decl("GRID_INCOMPLETE_TR"),
        decl("GRID_LANE_FAILED"), decl("GRID_PLAN_QUERY_FAILED"), decl("GRID_LANE_DEGRADED_TR"), decl("GRID_NOT_CHECKED_TR"),
        fn("gridIncompleteText"), fn("gridAnswerIncomplete"), fn("gridCellOf"), fn("gridCellOfStored"), fn("cpTruncate"),
      ].join("\n"),
      {},
    );
  const evidence = [{ evidenceId: "e1", chunkId: "c1", startChar: 0, endChar: 10, quoteSha256: "x" }];
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

  it("R2-21 in-browser: a claim the judge never assessed is an error cell, never 'Kısmen destekleniyor'", () => {
    const own = plain(page().gridCellOf({
      status: "PARTIAL", reasons: ["NOT_FINALIZABLE"], evidence,
      claims: [{ claimId: "k1", text: "Model cümlesi", verdict: "QUALIFIED", evidenceIds: ["e1"], reasons: ["ENTAILMENT_NOT_CHECKED:k1"] }],
    }));
    expect(own.error).toBe(true);
    expect(own.covered).toBe(false);
    expect(own.verdict).toBeUndefined();
    expect(own.text).toContain("denetlenemedi");
    expect(own.text).not.toContain("Model cümlesi");
    const run = plain(page().gridCellOf({
      status: "PARTIAL", reasons: ["ENTAILMENT_NOT_CHECKED:k1"], evidence,
      claims: [{ claimId: "k1", text: "Model cümlesi", verdict: "QUALIFIED", evidenceIds: ["e1"] }],
    }));
    expect(run.error).toBe(true);
    // Another claim's unchecked support does not fail the shown claim.
    const other = plain(page().gridCellOf({
      status: "PARTIAL", reasons: ["ENTAILMENT_NOT_CHECKED:k2"], evidence,
      claims: [{ claimId: "k1", text: "Doğrulanmış cümle", verdict: "SUPPORTED", evidenceIds: ["e1"], reasons: [] }],
    }));
    expect(other.covered).toBe(true);
    expect(other.text).toBe("Doğrulanmış cümle");
  });

  it("R2-23 in-browser: an abstention from a search whose passage lane failed is an error cell; a relation lane is not", () => {
    const lane = plain(page().gridCellOf({
      status: "ABSTAIN", reasons: ["QUESTION_NOT_COVERED"], claims: [], evidence: [],
      warnings: ["RETRIEVAL_LANE_DEGRADED:primary:soru:lane trigram failed: budget exceeded"],
    }));
    expect(lane.error).toBe(true);
    expect(lane.text).toContain("arama şeritlerinden biri başarısız oldu");
    expect(lane.text).not.toContain("pasaj getirmedi");
    const relation = plain(page().gridCellOf({
      status: "ABSTAIN", reasons: [], claims: [], evidence: [],
      warnings: ["RETRIEVAL_LANE_DEGRADED:primary:lane relation failed: timeout"],
    }));
    expect(relation.error).toBeUndefined();
    expect(relation.text).toBe(NO_PASSAGES_TR);
  });

  it("R2-24 in-browser: a verified claim whose run crossed the time budget after drafting is an answer", () => {
    const late = plain(page().gridCellOf({
      status: "PARTIAL", reasons: ["NOT_FINALIZABLE", "TIME_BUDGET_EXCEEDED"], evidence,
      claims: [{ claimId: "k1", text: "Geç gelen cevap", verdict: "SUPPORTED", evidenceIds: ["e1"], reasons: [] }],
    }));
    expect(late.error).toBeUndefined();
    expect(late.covered).toBe(true);
    expect(late.text).toBe("Geç gelen cevap");
    expect(plain(page().gridCellOf({ status: "PARTIAL", reasons: ["TIME_BUDGET_EXCEEDED"], claims: [], evidence })).error).toBe(true);
  });

  it("the console's texts say what the server's do (worker SUPPORT_NOT_CHECKED_TR / SEARCH_LANE_DEGRADED_TR)", () => {
    const texts = load([decl("GRID_LANE_DEGRADED_TR"), decl("GRID_NOT_CHECKED_TR")].join("\n"), {});
    expect(SUPPORT_NOT_CHECKED_TR.startsWith(texts.GRID_NOT_CHECKED_TR)).toBe(true);
    expect(SEARCH_LANE_DEGRADED_TR.startsWith(texts.GRID_LANE_DEGRADED_TR)).toBe(true);
    // A stored cell failed with either shows that reason with its retry.
    for (const error of [SUPPORT_NOT_CHECKED_TR, SEARCH_LANE_DEGRADED_TR]) {
      expect(plain(page().gridCellOfStored({ state: "failed", rowNo: 1, columnNo: 1, error }))).toMatchObject({
        error: true, retry: { rowNo: 1, columnNo: 1 }, text: error,
      });
    }
  });

  it("R2-22 stored: a census that read every page but is PARTIAL gets the partial chip; a COMPLETE one the green one", () => {
    const census = (answerStatus: string, answerText: string, supportState = "exhaustive_complete") =>
      plain(page().gridCellOfStored({
        state: "done", rowNo: 1, columnNo: 2, answerStatus, supportState, answerText, generatorVersion: "grid-v4", provenance: [],
      }));
    const complete = census("COMPLETE", "2 ayrı tarih: 15.09.2023 (s. 1); 31.08.2025 (s. 1). Yalnız tanınan biçimlerde yazılmış tarihler listelendi (…).");
    expect(complete.support).toBe("exhaustive_complete");
    expect(complete.retry).toBeUndefined();
    const partial = census("PARTIAL", "Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tarih bulunmadı (…). Belgede bu biçimlere uymayan tarih ifadeleri de geçiyor (ör. “Eylül 2023”); …");
    expect(partial.support).toBe("exhaustive_partial");
    expect(partial.retry).toBeUndefined();
    expect(census("PARTIAL", "Belge tam okunamadı; …", "exhaustive_incomplete").support).toBe("exhaustive_incomplete");
    // The console's label is the server export's.
    const grid = load(decl("GRID_SUPPORT_TR"), {}).GRID_SUPPORT_TR as Record<string, [string, string]>;
    expect(grid.exhaustive_partial![0].toLocaleLowerCase("tr-TR")).toBe(CENSUS_PARTIAL_TR);
    expect(grid.exhaustive_partial![1]).toBe("warn");
  });

  it("R2-22 stored: an old census offers its retry, and an old whole-document negative is never shown", () => {
    const restated = plain(page().gridCellOfStored({
      state: "done", rowNo: 3, columnNo: 1, answerStatus: "PARTIAL", supportState: "exhaustive_complete",
      answerText: `${LEGACY_CENSUS_TR} Eski sayım tanıdığı biçimlerde bir tarih bulmamıştı; bu, belgede tarih olmadığı anlamına gelmez.`,
      generatorVersion: "grid-v3", provenance: [],
    }));
    expect(restated.support).toBe("exhaustive_partial");
    expect(restated.retry).toEqual({ rowNo: 3, columnNo: 1 });
    const raw = plain(page().gridCellOfStored({
      state: "done", rowNo: 2, columnNo: 1, answerStatus: "COMPLETE", supportState: "exhaustive_complete",
      answerText: "Belgenin tamamında tarih bulunmadı.", generatorVersion: "grid-v3", provenance: [],
    }));
    expect(raw.text).not.toContain("Belgenin tamamında");
    expect(raw.text.startsWith(LEGACY_CENSUS_TR)).toBe(true);
    expect(raw.support).toBe("exhaustive_partial");
    expect(raw.retry).toEqual({ rowNo: 2, columnNo: 1 });
  });

  it("R2-22 the grid draws the partial chip and the retry of an old census", () => {
    const out = new FakeNode("div");
    const cell = plain(page().gridCellOfStored({
      state: "done", rowNo: 1, columnNo: 1, answerStatus: "PARTIAL", supportState: "exhaustive_complete",
      answerText: LEGACY_CENSUS_TR, generatorVersion: "grid-v3", provenance: [],
    }));
    const grid = load([domHelpers(), decl("GRID_SUPPORT_TR"), fn("gridKey"), fn("renderGridTable")].join("\n"), {
      document: fakeDocument({ gridout: out }),
      gridState: { files: [{ fileId: "f1", name: "Kira.pdf" }], questions: ["Belgedeki bütün tarihler"], cells: { "f1::0": cell } },
      VERDICT_TR: {}, gotoDocument: () => {}, retryGridCell: () => {},
    });
    grid.renderGridTable();
    const td = out.all().find((n) => n.tag === "td")!;
    const labels = td.all().map((n) => n.own);
    expect(labels).toContain("Belgenin tamamı okundu; sayım eksik olabilir");
    expect(labels).not.toContain("Belgenin tamamı okundu");
    expect(labels).toContain("Bu hücreyi yeniden dene");
  });
});

// ------------------------------------------------------------------- #19

describe("W21 #19 · stale rows are grouped by why they are stale", () => {
  function staleNotes(rows: unknown[]): FakeNode[] {
    const box = new FakeNode("div");
    const page = load([domHelpers(), decl("GRID_STALE_TR"), decl("GRID_STALE_ORDER"), fn("renderGridStale")].join("\n"), {
      document: fakeDocument({ gridstale: box }),
    });
    page.renderGridStale({ rows });
    return box.children;
  }

  it("a deleted file is never 'a newer version was uploaded' and is not offered a new table", () => {
    const notes = staleNotes([
      { fileId: "f1", fileName: "Silinen.pdf", stale: true, staleReason: "file_deleted" },
      { fileId: "f2", fileName: "Yeni.pdf", stale: true, staleReason: "newer_version" },
      { fileId: "f3", fileName: "Guncel.pdf", stale: false, staleReason: null },
    ]);
    expect(notes).toHaveLength(2);
    const [newer, deleted] = notes.map((n) => n.textContent);
    expect(newer).toContain("daha yeni bir sürümü yüklendi");
    expect(newer).toContain("Güncel sürüm için yeni bir tablo oluşturun");
    expect(newer).toContain("Yeni.pdf");
    expect(newer).not.toContain("Silinen.pdf");
    expect(deleted).toContain("sistemden silindi");
    expect(deleted).toContain("Silinen.pdf");
    expect(deleted).not.toContain("daha yeni bir sürümü");
    expect(deleted).not.toContain("yeni bir tablo oluşturun");
    expect(deleted).not.toContain("Guncel.pdf");
  });

  it("pin_gone, no_readable_current and an unexplained stale row never claim a newer upload", () => {
    const notes = staleNotes([
      { fileId: "a", fileName: "A.pdf", stale: true, staleReason: "pin_gone" },
      { fileId: "b", fileName: "B.pdf", stale: true, staleReason: "no_readable_current" },
      { fileId: "c", fileName: "C.pdf", stale: true },
      // a reason this console does not know (or a prototype key) is named, never dropped
      { fileId: "d", fileName: "D.pdf", stale: true, staleReason: "constructor" },
    ]).map((n) => n.textContent);
    expect(notes).toHaveLength(3);
    for (const text of notes) {
      expect(text).not.toContain("daha yeni bir sürümü yüklendi");
      expect(text).not.toContain("yeni bir tablo oluşturun");
    }
    expect(notes[0]).toContain("okunabilir değil");
    expect(notes[0]).toContain("B.pdf");
    expect(notes[1]).toContain("sabitlenen sürümü artık okunamıyor");
    expect(notes[1]).toContain("A.pdf");
    expect(notes[2]).toContain("nedenini bu sunucu bildirmedi");
    expect(notes[2]).toContain("C.pdf, D.pdf");
  });

  it("each reason's 'Belge durumu' sentence is the server export's (routes.ts ROW_STATUS_TR)", () => {
    const start = routesSrc.indexOf("const ROW_STATUS_TR");
    const block = routesSrc.slice(start, routesSrc.indexOf("};", start));
    const grid = load(decl("GRID_STALE_TR"), {}).GRID_STALE_TR as Record<string, string[]>;
    for (const reason of ["newer_version", "file_deleted", "pin_gone", "no_readable_current"]) {
      const server = block.match(new RegExp(`${reason}: "([^"]+)"`, "u"))?.[1];
      expect(server, reason).toBeTruthy();
      expect(grid[reason]![1]).toBe(server);
    }
  });
});

describe("W21 re-check · console leftovers of the lane verifiers", () => {
  it("the grid CSV carries each row's pinned-version state in the server export's words", () => {
    const csv = load([decl("GRID_SUPPORT_TR"), decl("GRID_STALE_TR"), fn("gridKey"), fn("csvField"), fn("gridRowStatus"), fn("gridCsv")].join("\n"), {
      STATUS_TR: { COMPLETE: ["Tam", "ok"] },
      gridState: {
        files: [
          { fileId: "f1", name: "A.pdf", pinned: true, stale: false, staleReason: null },
          { fileId: "f2", name: "B.pdf", pinned: true, stale: true, staleReason: "file_deleted" },
          { fileId: "f3", name: "C.pdf" },
        ],
        questions: ["a"],
        cells: {},
      },
    }).gridCsv() as string;
    const lines = csv.split("\r\n");
    // the last quoted field (a status sentence may itself contain ";")
    const last = (line: string) => line.match(/;("(?:[^"]|"")*")$/u)?.[1];
    expect(last(lines[0]!)).toBe('"Belge durumu"');
    const status = lines.slice(1).map(last);
    const start = routesSrc.indexOf("const ROW_STATUS_TR");
    const block = routesSrc.slice(start, routesSrc.indexOf("};", start));
    const server = (key: string) => block.match(new RegExp(`${key}: "([^"]+)"`, "u"))?.[1];
    expect(status).toEqual([`"${server("current")}"`, `"${server("file_deleted")}"`, '""']);
  });

  it("a claim whose passage support nobody checked is never 'güçlü', never a percentage", () => {
    const ctx = load([decl("DIMENSIONS"), decl("ENTAILMENT_NA_TR"), fn("claimEntailmentNotChecked"), fn("confidenceSummary")].join("\n"), {
      pct: (v: number) => Math.round(v * 100),
    });
    const claim = { claimId: "c1", reasons: ["ENTAILMENT_NOT_CHECKED:c1"] };
    expect(ctx.claimEntailmentNotChecked(claim)).toBe(true);
    // part of it measured short: the measured value is the honest one
    expect(ctx.claimEntailmentNotChecked({ claimId: "c1", reasons: ["ENTAILMENT_NOT_CHECKED:c1", "ENTAILMENT_BELOW_THRESHOLD:c1"] })).toBe(false);
    expect(ctx.claimEntailmentNotChecked({ claimId: "c2", reasons: ["ENTAILMENT_NOT_CHECKED:c1"] })).toBe(false);
    const high = { retrieval: 1, entailment: 0, authority: 1, currentness: 1, coverage: 1 };
    const summary = ctx.confidenceSummary(high, { entailment: true });
    expect(summary[0]).toBe("weak");
    expect(summary[1]).toContain("denetlenemedi");
    // the currentness exemption alone still lets strong axes read strong
    expect(ctx.confidenceSummary({ ...high, entailment: 0.9 }, { currentness: true })[0]).toBe("strong");
    // the warning list names the code in Turkish, ahead of the below-threshold line
    const warnBlock = decl("WARN_PATTERNS");
    const notChecked = warnBlock.indexOf("[/^ENTAILMENT_NOT_CHECKED:/,");
    expect(notChecked).toBeGreaterThan(0);
    expect(notChecked).toBeLessThan(warnBlock.indexOf("[/^ENTAILMENT_BELOW_THRESHOLD:/,"));
    expect(warnBlock.slice(notChecked, warnBlock.indexOf("],", notChecked))).toContain("denetlenemedi");
  });

  it("the answer notice names a local model as local, never 'bulut'", () => {
    const notice = load(fn("aiUsedNoticeTr"), {}).aiUsedNoticeTr as (a: unknown) => string;
    expect(notice({ drafter: true, entailment: true, label: "Yerel model qwen (bu bilgisayar)" })).toBe(
      "Taslağı bu bilgisayardaki yerel model yazdı; yazdığı her cümlenin dayanağı bu bilgisayarda tek tek doğrulandı.",
    );
    expect(notice({ drafter: true, entailment: true, label: "Yerel model qwen (yerel ağ)" })).toContain("kendi ağınızdaki yerel model");
    expect(notice({ drafter: true, entailment: true, label: "Dışarıdaki model x (dışarıdaki bir serviste)" })).toContain("dışarıdaki bir servisteki model");
    expect(notice({ drafter: true, entailment: true, label: "Anthropic claude" })).toContain("Taslağı bulut yapay zekâ yazdı");
    expect(notice({ drafter: false, entailment: false, label: "Kural tabanlı — yerel" })).toBe(
      "Bu cevabı yapay zekâ yazmadı: cümleler kaynaklardan olduğu gibi alındı, sıralaması kurallarla yapıldı.",
    );
    expect(notice({ drafter: false, entailment: true, label: "Anthropic claude" })).toContain("bulut yapay zekâ denetledi");
    for (const label of ["Yerel model qwen (bu bilgisayar)", "Yerel model qwen (yerel ağ)"]) {
      expect(notice({ drafter: true, entailment: true, label })).not.toContain("bulut");
    }
  });

  it("the backup card never draws an incomplete or unverified backup green", () => {
    const body = new FakeNode("div");
    // R2-36: renderBackup words its folder and restore lines through these helpers.
    const ctx = load([domHelpers(), fn("operatorHintsOf"), fn("openFolderSentence"), fn("renderBackup")].join("\n"), {
      document: fakeDocument(),
      fmtDateTimeTR: () => "17.09.2026 10:00",
      fmtSizeTR: () => "1 MB",
      techBox: () => {},
    });
    ctx.renderBackup(body, {
      path: "C:/yedek/1", lastAt: "2026-09-17T10:00:00Z", files: 3, sizeBytes: 1, stale: false,
      originalsState: "INCOMPLETE", originalsWarning: "2 belge aslı yedekte yok.",
    });
    const nodes = body.all();
    const state = nodes.find((n) => String(n.className).startsWith("state"))!;
    expect(state.className).toBe("state stale");
    expect(body.textContent).toContain("yedek EKSİK");
    expect(body.textContent).toContain("2 belge aslı yedekte yok.");
    const ok = new FakeNode("div");
    ctx.renderBackup(ok, { path: "C:/yedek/2", lastAt: "2026-09-17T10:00:00Z", files: 3, sizeBytes: 1, stale: false });
    expect(ok.all().find((n) => String(n.className).startsWith("state"))!.className).toBe("state ok");
    expect(ok.textContent).not.toContain("EKSİK");
  });

  it("the page-count chip does not call OCR-read pages 'metin katmanlı', and the OCR caution is written once", () => {
    const card = fn("fileRowCard");
    expect(card).toContain("pages.pagesWithText - (Array.isArray(pages.ocrPages) ? pages.ocrPages.length : 0)");
    // R2-33: the 'Okunabilirlik' sentence now lives in readabilityText.
    expect(fn("readabilityText")).toContain("ayrıntı aşağıdaki uyarıda");
  });
});

describe("W21 round-two review · matter analysis on the console", () => {
  it("support found in an unfinished comparison is labelled unfinished, never 'Delille destekleniyor'", () => {
    const ctx = load([decl("SUPPORT_STATUS_TR"), fn("supportStatusLabel")].join("\n"), {});
    const label = ctx.supportStatusLabel as (it: unknown) => [string, string];
    expect(label({ supportStatus: "search_incomplete", attributes: { supportsFound: 2 } })[0]).toContain("karşılaştırma tamamlanmadı");
    expect(label({ supportStatus: "search_incomplete", attributes: { supportsFound: 2 } })[0]).not.toBe("Delille destekleniyor");
    expect(label({ supportStatus: "search_incomplete", attributes: { opposesFound: 1 } })[0]).toContain("Aleyhe delil bulundu");
    expect(label({ supportStatus: "supported", attributes: {} })).toEqual(["Delille destekleniyor", "ok"]);
  });

  it("a failed run shows its stored reason; a stale run is never listed 'tamamlandı'", () => {
    const failure = load(fn("analysisFailureTr"), {}).analysisFailureTr as (run: unknown) => string;
    expect(failure({ summary: { notes: ["İnceleme başka bir sürümle başlatılmış; yeni bir inceleme başlatın."] } })).toContain("yeni bir inceleme başlatın");
    expect(failure({ summary: {} })).toBe("");
    const list = fn("loadAnalysisRuns");
    expect(list.indexOf("if (!active && r.stale)")).toBeGreaterThan(0);
    expect(list.indexOf("if (!active && r.stale)")).toBeLessThan(list.indexOf('"dosyanın tamamı okundu"'));
    const coverage = fn("renderRunCoverage");
    expect(coverage).toContain("İncelemeden sonra dosyaya eklenen, bu incelemede okunmamış belgeler");
    const findings = fn("loadAnalysisFindings");
    expect(findings).toContain("f.summary.notes");
  });

  it("partial evaluations and clipped-quote contradictions carry their own warning chips", () => {
    const item = fn("renderIntelItem");
    expect(item).toContain('"Kısmi değerlendirme — "');
    expect(item).toContain("judgedOnClippedQuote");
    expect(item).toContain('it.attributes.judgedText === "quote"');
  });
});

// ------------------------------------------------------------------- R2-36

describe("W21 round two R2-36 · operator lines name the scripts of the platform the server runs on", () => {
  /**
   * The operator helpers, loaded leniently: these tests judge what the page
   * SAYS, so a page without them fails on its words, not on a missing name.
   */
  const operatorHelpers = (): string =>
    ["operatorHintsOf", "operatorScriptLines", "openFolderSentence"]
      .map((name) => (html.includes(`\n  function ${name}(`) ? fn(name) : ""))
      .join("\n");

  /** The health / GET /v1/backup fields exactly as the server builds them. */
  const MAC = operatorHintsPayload("darwin");
  const WINDOWS = operatorHintsPayload("win32");
  const WINDOWS_ONLY = /\.cmd\b|kısayol|Dosya Gezgini/u;

  function techLines(health: unknown): string[] {
    const body = new FakeNode("div");
    const lines: string[] = [];
    const page = load([domHelpers(), cloudHelpers(), operatorHelpers(), fn("renderSysStatus")].join("\n"), {
      health,
      document: fakeDocument({ sysstatusbody: body }),
      DB_STATE_TR: {}, MCP_STATE_TR: {}, AI_POLICY_TR: {},
      deadlineRulesInfo: null, deadlineRulesInfoLoading: true,
      getJson: () => new Promise(() => {}),
      emptyLine: () => {}, fmtDateTimeTR: () => "",
      techBox: (_parent: unknown, rows: unknown) => {
        for (const row of Array.isArray(rows) ? rows : [rows]) if (row !== null && row !== undefined) lines.push(String(row));
      },
    });
    page.renderSysStatus();
    return lines;
  }

  it("Ayarlar › Sistem durumu: the Mac server's tech box names deploy/macos scripts, Windows keeps its .cmd lines", () => {
    const mac = techLines({ ...HEALTH_NO_KEY, ...MAC });
    expect(mac).toContain("Başlatma: deploy/macos/collex-start.sh · Durdurma: deploy/macos/collex-stop.sh");
    expect(mac).toContain("Yedekleme: deploy/macos/collex-backup.sh · Geri yükleme: deploy/macos/collex-restore.sh");
    expect(mac.join("\n")).not.toMatch(/\.cmd\b/u);

    // Windows wording unchanged.
    const win = techLines({ ...HEALTH_NO_KEY, ...WINDOWS });
    expect(win).toContain("Başlatma: ColleX-Baslat.cmd · Durdurma: ColleX-Durdur.cmd");
    expect(win).toContain("Yedekleme: ColleX-Yedekle.cmd · Geri yükleme: ColleX-Geri-Yukle.cmd");

    // An older server that sends no names: a neutral line, never a guess.
    const unknown = techLines(HEALTH_NO_KEY);
    expect(unknown.join("\n")).not.toMatch(/\.cmd\b|collex-start\.sh/u);
    expect(unknown.join("\n")).toContain("kurulum belgesine bakın");
  });

  function backupCard(source: unknown, backup: unknown, health: unknown): { text: string; tech: string[] } {
    const body = new FakeNode("div");
    const tech: string[] = [];
    const ctx = load([domHelpers(), operatorHelpers(), fn("renderBackup")].join("\n"), {
      health,
      document: fakeDocument(),
      fmtDateTimeTR: () => "17.09.2026 10:00",
      fmtSizeTR: () => "1 MB",
      techBox: (_parent: unknown, rows: unknown) => {
        for (const row of Array.isArray(rows) ? rows : [rows]) tech.push(String(row));
      },
    });
    ctx.renderBackup(body, backup, source);
    return { text: body.textContent, tech };
  }

  const LAST = { path: "/Users/avukat/ColleX-Yedek/2026-09-17", lastAt: "2026-09-17T10:00:00Z", files: 3, sizeBytes: 1, stale: false };

  it("the backup card on the Mac: Finder, the restore script, and no Windows name", () => {
    const { text, tech } = backupCard({ backup: LAST, ...MAC }, LAST, null);
    expect(text).toContain("Finder");
    expect(text).not.toMatch(WINDOWS_ONLY);
    expect(tech).toContain("deploy/macos/collex-restore.sh");
    expect(tech.join("\n")).not.toMatch(/\.cmd\b/u);
  });

  it("the backup card on Windows keeps 'Dosya Gezgini' and ColleX-Geri-Yukle.cmd; runBackup's redraw uses health's names", () => {
    const { text, tech } = backupCard({ backup: LAST, ...WINDOWS }, LAST, null);
    expect(text).toContain("Dosya Gezgini'nin adres çubuğuna");
    expect(tech).toContain("ColleX-Geri-Yukle.cmd");

    // runBackup redraws without a GET body: the names come from health.
    const redraw = backupCard(undefined, LAST, { ...HEALTH_NO_KEY, ...MAC });
    expect(redraw.text).not.toMatch(WINDOWS_ONLY);
    expect(redraw.tech).toContain("deploy/macos/collex-restore.sh");

    // Nothing known: neutral sentences, no Windows name.
    const neutral = backupCard(undefined, LAST, null);
    expect(neutral.text).not.toMatch(WINDOWS_ONLY);
    expect(neutral.tech.join("\n")).not.toMatch(/\.cmd\b/u);
  });

  async function unmountedBackupCard(health: unknown): Promise<{ text: string; tech: string[] }> {
    const body = new FakeNode("div");
    const go = new FakeNode("button");
    const tech: string[] = [];
    const ctx = load([domHelpers(), operatorHelpers(), fn("renderBackup"), fn("loadBackup")].join("\n"), {
      health,
      document: fakeDocument({ backupbody: body, backupgo: go }),
      emptyLine: () => {},
      getJson: () => Promise.resolve({ status: 404, body: { error: { kind: "NOT_FOUND" } } }),
      errCard: () => {}, errMessage: () => "", errMessageTech: () => "", humanError: () => "",
      fmtDateTimeTR: () => "", fmtSizeTR: () => "",
      techBox: (_parent: unknown, rows: unknown) => {
        for (const row of Array.isArray(rows) ? rows : [rows]) tech.push(String(row));
      },
    });
    ctx.loadBackup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(go.disabled).toBe(true);
    return { text: body.textContent, tech };
  }

  it("backup not mounted on the Mac: no desktop shortcut, no .cmd — the platform's backup script", async () => {
    const mac = await unmountedBackupCard({ ...HEALTH_NO_KEY, ...MAC });
    expect(mac.text).toContain("Yedekleme bu ekrandan açılmamış.");
    expect(mac.text).not.toMatch(WINDOWS_ONLY);
    expect(mac.tech).toEqual(["deploy/macos/collex-backup.sh"]);

    const win = await unmountedBackupCard({ ...HEALTH_NO_KEY, ...WINDOWS });
    expect(win.text).toContain("“ColleX Yedekle” kısayolunu çift tıklayarak yedek alabilirsiniz");
    expect(win.tech).toEqual(["ColleX-Yedekle.cmd"]);

    const unknown = await unmountedBackupCard({ ...HEALTH_NO_KEY });
    expect(unknown.text).not.toMatch(WINDOWS_ONLY);
    expect(unknown.tech.join("\n")).not.toMatch(/\.cmd\b/u);
  });
});

// ------------------------------------------------------ R2-29 AI paragraph

describe("W21 R2-29 · the AI paragraph card never turns an unchecked or rejected binding into a measured one", () => {
  /** The server's R2-29 row for a binding the judge could not check. */
  const unchecked = (evidenceId: string) => ({
    evidenceId,
    score: 0,
    entails: false,
    kept: false,
    rationale: "denetlenemedi — hakemin yanıtı okunamadı ya da kendi içinde çelişkiliydi; bu kanıt bağı paragrafa yazılmadı",
    checked: false,
  });
  const measured = (evidenceId: string, score: number, kept: boolean) => ({
    evidenceId, score, entails: kept, kept, rationale: kept ? "uyuyor" : "uymuyor",
  });
  const response = (entailment: unknown[], kaynakli: boolean, supported: boolean) => ({
    entailment, kaynakli, threshold: 0.85, model: "m", warnings: [], issues: [],
    paragraph: { id: "p-hd-ai-1", supported },
  });

  function card(result: unknown): { head: string; expl: string; text: string; rows: string[][]; toast: string; toastOk: boolean } {
    const tables: string[][][] = [];
    const page = load([
      fn("el"), fn("pct"), fn("meterLevel"),
      fn("aiParagraphVerdict"), fn("aiParagraphHeadText"), fn("aiParagraphExplText"),
      fn("aiParagraphToastText"), fn("renderAiParagraphResult"),
    ].join("\n"), {
      document: fakeDocument(),
      METER_HEAD_TR: "Bunlar kaynak eşleşmesinin gücünü gösterir; cevabın doğruluk oranı DEĞİLDİR.",
      techBox: () => {},
      evidenceById: () => null,
      warnGroupList: () => new FakeNode("ul"),
      table: (_parent: unknown, _headers: unknown, rows: unknown) => { tables.push(JSON.parse(JSON.stringify(rows))); },
    });
    const node = page.renderAiParagraphResult(result) as FakeNode;
    return {
      head: node.children[1]!.textContent,
      expl: node.children[2]!.textContent,
      text: node.textContent,
      rows: tables[0] ?? [],
      toast: String(page.aiParagraphToastText(result)),
      toastOk: page.aiParagraphVerdict(result).sourced === true,
    };
  }

  it("every binding unchecked: 'denetlenemedi' everywhere, never 'zayıf', 'every basis was checked' or 'none passed'", () => {
    const c = card(response([unchecked("ev-1"), unchecked("ev-2")], false, false));
    expect(c.rows.map((row) => row.slice(0, 3))).toEqual([
      ["ev-1", "denetlenemedi", "paragrafa yazılmadı"],
      ["ev-2", "denetlenemedi", "paragrafa yazılmadı"],
    ]);
    expect(c.head).toBe("Bu paragrafın dayanakları denetlenemedi, bu yüzden hiçbiri paragrafa yazılmadı; paragraf KAYNAKSIZ kaldı ve dayanağını sizin eklemeniz gerekiyor.");
    expect(c.expl).toContain("2 dayanakta yapay zekâ hakeminin yanıtı okunamadı");
    expect(c.text).not.toContain("Program her dayanağı ayrıca denetledi");
    expect(c.text).not.toContain("denetimi geçemedi");
    expect(c.text).not.toContain("Denetlenip geçemeyen");
    expect(c.rows.flat()).not.toContain("zayıf");
    expect(c.toast).toBe("AI paragrafı KAYNAKSIZ kaldı — 2 dayanak denetlenemedi ve paragrafa yazılmadı.");
    expect(c.toast).not.toContain("eşiği geçmedi");
    expect(c.toastOk).toBe(false);
  });

  it("a kept binding beside an unchecked one: sourced, but the card does not say every basis was checked", () => {
    const c = card(response([measured("ev-1", 0.92, true), unchecked("ev-2")], true, true));
    expect(c.head).toBe("Bu paragrafın en az bir dayanağı denetimi geçti; paragraf kaynaklı sayıldı.");
    expect(c.expl).toMatch(/^Program her dayanağı ayrıca denetlemeye çalıştı; 1 dayanakta/u);
    expect(c.expl).not.toContain("Program her dayanağı ayrıca denetledi");
    expect(c.rows.map((row) => row.slice(0, 3))).toEqual([
      ["ev-1", "güçlü", "korundu"],
      ["ev-2", "denetlenemedi", "paragrafa yazılmadı"],
    ]);
    expect(c.toast).toBe("AI paragrafı kaynaklı olarak yazıldı; 1 dayanak denetlenemedi ve paragrafa yazılmadı.");
    expect(c.toastOk).toBe(true);
  });

  it("a measured shortfall beside an unchecked binding names both, and only the measured one is a meter", () => {
    const c = card(response([measured("ev-1", 0.3, false), unchecked("ev-2")], false, false));
    expect(c.head).toBe("Bu paragrafa hiçbir dayanak yazılmadı: 1 dayanak denetimi geçemedi, 1 dayanak denetlenemedi; paragraf KAYNAKSIZ kaldı ve dayanağını sizin eklemeniz gerekiyor.");
    expect(c.expl).toContain("Denetlenip geçemeyen dayanaklar da paragraftan çıkarıldı.");
    expect(c.rows.map((row) => row.slice(0, 3))).toEqual([
      ["ev-1", "zayıf", "atıldı"],
      ["ev-2", "denetlenemedi", "paragrafa yazılmadı"],
    ]);
    expect(c.toast).toBe("AI paragrafı KAYNAKSIZ kaldı — 1 dayanak denetlenemedi ve paragrafa yazılmadı, kalanlar eşiği geçmedi.");
  });

  it("a binding the judge kept but the reviser rejected is never 'kaynaklı' — also from an older server's kaynakli:true", () => {
    for (const kaynakli of [false, true]) {
      const c = card(response([measured("ev-1", 0.95, true)], kaynakli, false));
      expect(c.head).toBe("Bir dayanak anlam denetimini geçti, ancak taslağın dayanak kuralları onu kabul etmedi; paragraf KAYNAKSIZ kaldı ve dayanağını sizin eklemeniz gerekiyor.");
      expect(c.text).not.toContain("kaynaklı sayıldı");
      expect(c.text).not.toContain("hiçbir dayanağı denetimi geçemedi");
      expect(c.rows[0]!.slice(0, 3)).toEqual(["ev-1", "güçlü", "denetimi geçti; taslak kabul etmedi"]);
      expect(c.toast).toBe("AI paragrafı KAYNAKSIZ kaldı — denetimi geçen dayanağı taslağın dayanak kuralları kabul etmedi.");
      expect(c.toastOk).toBe(false);
    }
  });

  it("W21 partial rejection: a judge-kept binding missing from the SAVED paragraph is not 'korundu'", () => {
    // Server shape after the product reviser kept ev-1 and dropped the karşıt ev-2.
    const partial = {
      ...response([measured("ev-1", 0.95, true), measured("ev-2", 0.95, true)], true, true),
      paragraph: { id: "p-hukuki-sebepler-1", supported: true, evidenceIds: ["ev-1"] },
    };
    const c = card(partial);
    expect(c.head).toBe("Bu paragrafın en az bir dayanağı denetimi geçti; paragraf kaynaklı sayıldı.");
    expect(c.rows.map((row) => row.slice(0, 3))).toEqual([
      ["ev-1", "güçlü", "korundu"],
      ["ev-2", "güçlü", "denetimi geçti; taslak kabul etmedi"],
    ]);
    expect(c.expl).toContain("1 dayanak denetimi geçtiği hâlde taslağın dayanak kurallarınca kabul edilmedi ve paragrafa yazılmadı.");
    expect(c.toast).toBe("AI paragrafı kaynaklı olarak yazıldı; 1 dayanağı taslağın dayanak kuralları kabul etmedi.");
    expect(c.toastOk).toBe(true);

    // Beside an unchecked binding, both are named.
    const mixed = card({
      ...response([measured("ev-1", 0.95, true), measured("ev-2", 0.95, true), unchecked("ev-3")], true, true),
      paragraph: { id: "p-hukuki-sebepler-1", supported: true, evidenceIds: ["ev-1"] },
    });
    expect(mixed.rows.map((row) => row[2])).toEqual(["korundu", "denetimi geçti; taslak kabul etmedi", "paragrafa yazılmadı"]);
    expect(mixed.toast).toBe("AI paragrafı kaynaklı olarak yazıldı; 1 dayanak denetlenemedi ve paragrafa yazılmadı; 1 dayanağı taslağın dayanak kuralları kabul etmedi.");

    // Every judge-kept binding saved: nothing is called rejected.
    const whole = card({
      ...response([measured("ev-1", 0.95, true), measured("ev-2", 0.95, true)], true, true),
      paragraph: { id: "p-hukuki-sebepler-1", supported: true, evidenceIds: ["ev-1", "ev-2"] },
    });
    expect(whole.rows.map((row) => row[2])).toEqual(["korundu", "korundu"]);
    expect(whole.text).not.toContain("kabul edilmedi");
    expect(whole.toast).toBe("AI paragrafı kaynaklı olarak yazıldı.");
  });

  it("non-vacuity: fully measured results keep their sentences", () => {
    const sourced = card(response([measured("ev-1", 0.92, true), measured("ev-2", 0.4, false)], true, true));
    expect(sourced.head).toBe("Bu paragrafın en az bir dayanağı denetimi geçti; paragraf kaynaklı sayıldı.");
    expect(sourced.expl).toMatch(/^Program her dayanağı ayrıca denetledi; denetimi geçmeyen dayanaklar paragraftan çıkarıldı\. /u);
    expect(sourced.rows.map((row) => row.slice(0, 3))).toEqual([["ev-1", "güçlü", "korundu"], ["ev-2", "zayıf", "atıldı"]]);
    expect(sourced.toast).toBe("AI paragrafı kaynaklı olarak yazıldı.");

    const shortfall = card(response([measured("ev-1", 0.3, false), measured("ev-2", 0.84, false)], false, false));
    expect(shortfall.head).toBe("Bu paragrafın hiçbir dayanağı denetimi geçemedi; paragraf KAYNAKSIZ kaldı ve dayanağını sizin eklemeniz gerekiyor.");
    expect(shortfall.toast).toBe("AI paragrafı KAYNAKSIZ kaldı — hiçbir kanıt eşiği geçmedi.");
  });

  it("a paragraph the model cited nothing for is not 'no basis passed the check'", () => {
    const none = card(response([], false, false));
    expect(none.head).toBe("Yapay zekâ bu paragraf için hiçbir dayanak göstermedi; paragraf KAYNAKSIZ kaldı ve dayanağını sizin eklemeniz gerekiyor.");
    expect(none.expl).not.toContain("Program her dayanağı ayrıca denetledi");
    expect(none.toast).toBe("AI paragrafı KAYNAKSIZ kaldı — yapay zekâ bir dayanak göstermedi.");
  });

  it("the dialog's toast uses the same verdict as the card", () => {
    const dialog = fn("openAiParagraphDialog");
    expect(dialog).toContain('toast(aiParagraphToastText(result), aiParagraphVerdict(result).sourced ? "ok" : "bad");');
    expect(dialog).not.toContain("hiçbir kanıt eşiği geçmedi");
    expect(dialog).not.toMatch(/result\.kaynakli \?/u);
  });
});

describe("W21 closing re-check · console leftovers", () => {
  it("a budget exceeded AFTER the claims were written is not 'tespit yazımı eksik bırakıldı'", () => {
    const ctx = load([decl("WARN_PATTERNS").replace(/(?<!["\w])[A-Z][A-Z0-9_]*_(?:TEXT|TR)(?!["\w])/gu, '"x"'), decl("TIME_BUDGET_AFTER_DRAFT_TEXT"), fn("warnTR")].join("\n"), {});
    const after = ctx.warnTR("TIME_BUDGET_EXCEEDED:61234ms>60000ms", { claimsWritten: true }).text as string;
    expect(after).toContain("tespitler yazıldıktan sonra aştı");
    expect(after).not.toContain("eksik bırakıldı");
    // non-vacuity: before drafting (no claims) the old sentence stands
    expect(ctx.warnTR("TIME_BUDGET_EXCEEDED", { claimsWritten: false }).text).toContain("eksik bırakıldı");
    expect(ctx.warnTR("TIME_BUDGET_EXCEEDED").text).toContain("eksik bırakıldı");
    const card = html.slice(html.indexOf("warnGroupList(data.warnings"), html.indexOf("warnGroupList(data.reasons") + 120);
    expect(card.match(/claimsWritten: \(data\.claims \|\| \[\]\)\.length > 0/gu)).toHaveLength(2);
  });

  it("an in-browser abstention after a whole failed plan query is an incomplete cell, like on the server", () => {
    const ctx = load(
      [decl("GRID_INCOMPLETE_REASONS"), decl("GRID_NO_CLAIM_REASONS"), decl("GRID_INCOMPLETE_TR"), decl("GRID_LANE_FAILED"),
        decl("GRID_PLAN_QUERY_FAILED"), decl("GRID_LANE_DEGRADED_TR"), decl("GRID_NOT_CHECKED_TR"), fn("gridIncompleteText")].join("\n"),
      {},
    );
    for (const warning of ["RETRIEVAL_ERROR:contrary:i1:istisna:all retrieval lanes failed", "CORPUS_UNAVAILABLE:contrary:i1:istisna:db down"]) {
      expect(ctx.gridIncompleteText({ status: "ABSTAIN", reasons: [], claims: [], warnings: [warning] }), warning).toBe(ctx.GRID_LANE_DEGRADED_TR);
    }
    expect(ctx.gridIncompleteText({ status: "ABSTAIN", reasons: [], claims: [], warnings: [] })).toBe("");
  });

  it("the OCR gap label does not call every partly read OCR page a low-confidence scan", () => {
    const gap = decl("GAP_TR");
    expect(gap).not.toContain("taranmış sayfa düşük güvenle okundu");
    expect(gap).toContain("yalnız kısmen ya da düşük güvenle");
  });
});

describe("W21 closing re-check · the restart sentence follows the server's platform", () => {
  const load2 = (platform: string | null, start?: string) =>
    load([fn("operatorHintsOf"), decl("RESTART_WINDOWS_TR"), fn("restartSentenceTr"), fn("platformText"), fn("el")].join("\n"), {
      document: fakeDocument(),
      health: platform === null ? {} : { platform, operatorHints: start === undefined ? {} : { start, stop: "x", backup: "y", restore: "z" } },
    });

  it("names the Mac start script instead of the Windows desktop icon", () => {
    const mac = load2("darwin", "deploy/macos/collex-start.sh");
    const sentence = mac.platformText("Kendi kayıtlarınıza ulaşılamadı. ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın; sorun sürerse desteğe gösterin.") as string;
    expect(sentence).toContain("deploy/macos/collex-start.sh ile yeniden başlatın");
    expect(sentence).not.toContain("masaüstündeki ColleX simgesine");
    expect(sentence).toContain("sorun sürerse desteğe gösterin.");
    // every rendered text goes through el()
    expect((mac.el("p", null, "ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın.") as { textContent: string }).textContent)
      .toContain("collex-start.sh");
    // a server that names no start script still says something true
    expect(load2("linux").platformText("… ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın.")).toContain("kurulum belgesindeki başlatma adımıyla");
  });

  it("leaves the Windows wording untouched, and when the platform is unknown", () => {
    for (const ctx of [load2("win32", "ColleX-Baslat.cmd"), load2(null)]) {
      const text = "Bir sorun çıktı. ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın.";
      expect(ctx.platformText(text)).toBe(text);
    }
  });
});

describe("W21 closing re-check · the top bar fits the shell it is drawn in", () => {
  it("keeps both shells two rows, because one row never fit", () => {
    // Measured in the browser at 1280 px (compact shell): topbar tracks
    // 90 + 320 + 534 + 269 px plus 42 px of gaps = 1255 px inside a 1064 px
    // content area (`.wrap` is capped at 1120 px), so document.scrollWidth was
    // 1356 px against a 1265 px body and `.tools` / `.themebtn` sat outside it.
    expect(html).toContain('grid-template-areas: "brand . theme" "matter pills pills";');
    // and the compact shell no longer carries a template of its own, which used
    // to override the narrow-screen breakpoints declared above it (measured at
    // 820 px: 89 px of horizontal page scroll, the last status pill outside).
    expect(html).toContain("body.compact .topbar { padding: 6px 0 12px; }");
    expect(html).not.toContain("body.compact .topbar {\n  grid-template-columns");
    // no rule anywhere puts the four areas on one line again
    expect(html).not.toContain('"brand matter pills theme"');
  });
});

/**
 * Console lock: the "Mevzuat değişikliği kontrolü" card on the matter page
 * (Dosya incelemesi tab).
 *
 * The card's own block is executed in a VM against a tiny fake DOM, so these
 * tests pin BEHAVIOUR, not spelling:
 *   - without a source connection the button is drawn DISABLED with the
 *     server's reason (the vaporware gate);
 *   - every row prints the server's `stateLabel` and `message` — the page
 *     composes no verdict of its own;
 *   - a partial run says why, an unread record is listed;
 *   - the check goes through beginBusy with a real cancel, and a POST is the
 *     only way a check starts.
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
const START = "  /* ============ MEVZUAT DEĞİŞİKLİĞİ KONTROLÜ ============";
const END = "  /* ============ W20 · DOSYANIN TAMAMINI İNCELE ============";

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  children: FakeNode[];
  id: string;
  disabled: boolean;
  hidden: boolean;
  type: string;
  checked: boolean;
  listeners: Record<string, Array<() => void>>;
  appendChild(child: FakeNode): FakeNode;
  addEventListener(event: string, fn: () => void): void;
  setAttribute(name: string, value: string): void;
}

function node(tag: string): FakeNode {
  const n: FakeNode = {
    tag,
    className: "",
    textContent: "",
    children: [],
    id: "",
    disabled: false,
    hidden: false,
    type: "",
    checked: false,
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(event, fn) {
      (this.listeners[event] ??= []).push(fn);
    },
    setAttribute() {},
  };
  // textContent = "" clears children, like the DOM.
  let text = "";
  Object.defineProperty(n, "textContent", {
    get: () => text,
    set: (value: string) => {
      text = value;
      n.children = [];
    },
  });
  return n;
}

function textOf(n: FakeNode): string {
  return [n.textContent, ...n.children.map(textOf)].filter((s) => s !== "").join(" ");
}

function find(n: FakeNode, id: string): FakeNode | undefined {
  if (n.id === id) return n;
  for (const child of n.children) {
    const hit = find(child, id);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

interface Harness {
  panel: FakeNode;
  requests: Array<{ url: string; method: string; payload?: unknown }>;
  busy: Array<Record<string, unknown>>;
  settle: () => Promise<void>;
}

function harness(getBody: unknown, postBody?: unknown): Harness {
  const requests: Harness["requests"] = [];
  const busy: Harness["busy"] = [];
  const nodes: FakeNode[] = [];
  const context: Record<string, unknown> = {
    matterPageState: { data: { matter: { id: "11111111-1111-4111-8111-111111111111" } } },
    document: {
      createElement: (tag: string) => node(tag),
      getElementById: (id: string) => nodes.map((root) => find(root, id)).find((hit) => hit !== undefined),
    },
    el: (tag: string, cls?: string, text?: string) => {
      const n = node(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = String(text);
      return n;
    },
    chip: (label: string, tone: string) => {
      const n = node("span");
      n.className = `chip ${tone}`;
      n.textContent = label;
      return n;
    },
    ghostBtn: (label: string, onClick: () => void, cls?: string) => {
      const n = node("button");
      n.className = `ghost ${cls ?? ""}`;
      n.textContent = label;
      n.addEventListener("click", onClick);
      return n;
    },
    enc: (v: string) => encodeURIComponent(v),
    getJson: (url: string) => {
      requests.push({ url, method: "GET" });
      return Promise.resolve({ status: 200, body: getBody });
    },
    sendJson: (url: string, method: string, payload: unknown) => {
      requests.push({ url, method, payload });
      return Promise.resolve({ status: 200, body: postBody });
    },
    errCard: (parent: FakeNode, title: string, message: string) => {
      parent.textContent = "";
      parent.appendChild(Object.assign(node("section"), { className: "err" })).textContent = `${title} ${message}`;
    },
    errMessage: () => "hata",
    errMessageTech: () => [],
    humanError: () => "hata",
    isAbortError: () => false,
    fmtDateTimeTR: (iso: string) => `T(${iso})`,
    beginBusy: (opts: Record<string, unknown>) => {
      busy.push(opts);
      return { signal: undefined, cancelled: () => false, stop: () => undefined, phase: () => undefined };
    },
    busyCancelledCard: () => undefined,
  };
  runInNewContext(`${html.slice(html.indexOf(START), html.indexOf(END))}; this.renderLegislationWatch = renderLegislationWatch;`, context);
  const panel = node("div");
  nodes.push(panel);
  (context["renderLegislationWatch"] as (p: FakeNode) => void)(panel);
  return { panel, requests, busy, settle: () => new Promise((r) => setTimeout(r, 0)) };
}

const NOTICES = ["ColleX … neyin değiştiğini okumaz ve yorumlamaz.", "not 2", "not 3"];
const ROW = {
  key: "KANUN:6098|madde:475",
  label: "6098 sayılı Türk Borçlar Kanunu m. 475",
  state: "DEGISMIS_OLABILIR",
  stateLabel: "DEĞİŞMİŞ OLABİLİR",
  message: "Değişmiş olabilir: son değişiklik notu tarihi 05.03.2027, sizin dosyanızdaki ilk kontrol 01.10.2026.",
  sources: [{ kind: "draft", kindLabel: "Taslak", itemId: "i", refId: "d-1", title: "Cevap dilekçesi", spellings: [], count: 2 }],
  sourcesTotal: 1,
};

describe("Mevzuat değişikliği kontrolü card", () => {
  it("is drawn on the Dosya incelemesi tab, reads the GET and starts nothing by itself", async () => {
    expect(html).toContain('    if (tab === "inceleme") { renderLegislationWatch(panel); }');
    const h = harness({ available: true, citations: [ROW], notices: NOTICES, lastResult: null, unreadSources: [] });
    await h.settle();
    expect(h.requests).toEqual([
      { url: "/v1/matters/11111111-1111-4111-8111-111111111111/legislation-watch", method: "GET" },
    ]);
    const text = textOf(h.panel);
    expect(text).toContain("Mevzuat değişikliği kontrolü");
    expect(text).toContain(NOTICES[0]);
    expect(text).toContain("Bu dosya için kontrol yapılmadı.");
    expect(text).toContain("Atıf yapan: Taslak “Cevap dilekçesi” (2 kez)");
    expect(find(h.panel, "lw-go")?.disabled).toBe(false);
  });

  it("without a source connection the button is DISABLED and the server's reason is written", async () => {
    const reason = "Resmî mevzuat kaynağına bağlantı bu sunucuda kurulmadı; kontrol çalıştırılamaz.";
    const h = harness({ available: false, unavailableReason: reason, citations: [ROW], notices: NOTICES, lastResult: null });
    await h.settle();
    expect(find(h.panel, "lw-go")?.disabled).toBe(true);
    expect(textOf(h.panel)).toContain(reason);
  });

  it("prints each row's server verdict, the partial reason and the unread records", async () => {
    const lastResult = {
      checkedAt: "2026-11-15T09:00:00.000Z",
      complete: false,
      stopReason: "TIME_BUDGET",
      rows: [ROW],
      unreadSources: [{ kind: "draft", kindLabel: "Taslak", refId: "d-2", title: "Eski taslak", reason: "Kayıt depoda bulunamadı." }],
    };
    const h = harness({ available: true, citations: [ROW], notices: NOTICES, lastResult });
    await h.settle();
    const text = textOf(h.panel);
    expect(text).toContain("DEĞİŞMİŞ OLABİLİR");
    expect(text).toContain(ROW.message);
    expect(text).toContain("kısmi sonuç");
    expect(text).toContain("Kontrolün süre sınırı doldu");
    expect(text).toContain("Taslak “Eski taslak” — Kayıt depoda bulunamadı.");
    expect(text).not.toMatch(/%/u);
  });

  it("a check is ONE POST behind a cancellable progress card, then the result is drawn", async () => {
    const posted = { checkedAt: "2026-11-15T09:00:00.000Z", complete: true, stopReason: null, rows: [ROW], unreadSources: [] };
    const h = harness({ available: true, citations: [ROW], notices: NOTICES, lastResult: null, unreadSources: [] }, posted);
    await h.settle();
    const go = find(h.panel, "lw-go");
    go?.listeners["click"]?.[0]?.();
    await h.settle();
    expect(h.requests.at(-1)).toEqual({
      url: "/v1/matters/11111111-1111-4111-8111-111111111111/legislation-watch",
      method: "POST",
      payload: {},
    });
    expect(h.busy).toHaveLength(1);
    expect(typeof h.busy[0]?.["onCancel"]).toBe("function");
    expect(textOf(h.panel)).toContain("kontrol tamamlandı");
    expect(textOf(h.panel)).toContain(ROW.message);
  });
});

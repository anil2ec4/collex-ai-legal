/**
 * W18 — windowed embedding for the semantic rerank.
 *
 * Before: only the HEAD (`MAX_EMBED_CODE_POINTS`) of a full text was embedded,
 * so a decision whose relevant reasoning sat past the head compared as if it
 * were empty. Now every document longer than the window is embedded as up to
 * `MAX_EMBED_WINDOWS_PER_DOCUMENT` overlapping windows (the windowing helper
 * lives in `research/semanticPassages.ts`) and the document's similarity is
 * the MAXIMUM over its windows.
 *
 * All fail-closed rules stay: a single unmeasurable window cancels the whole
 * reorder, a vector-count mismatch cancels it, and the local E5 model still
 * shows no yakın/orta/uzak label. Deterministic fakes only; no network.
 */

import { describe, expect, it } from "vitest";

import { codePointWindows } from "../../src/research/semanticPassages.js";
import {
  EMBEDDING_ENV,
  resolveEmbeddingConfig,
  type EmbeddingConfig,
} from "../../src/retrieval/embeddingConfig.js";
import {
  EMBED_WINDOW_STRIDE,
  MAX_EMBED_CODE_POINTS,
  MAX_EMBED_WINDOWS_PER_DOCUMENT,
  semanticRerank,
  type EmbeddingPort,
  type RerankableDocument,
} from "../../src/retrieval/semanticRerank.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const SECRET = "sk-or-TEST-GIZLI-ANAHTAR-9f3a2b7c";
const AXES = ["tahliye", "kira", "trafik", "vergi"] as const;

function countVector(text: string): number[] {
  const lowered = text.toLocaleLowerCase("tr-TR");
  return AXES.map((axis) => {
    let n = 0;
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(axis, from);
      if (at === -1) break;
      n += 1;
      from = at + axis.length;
    }
    return n;
  });
}

function rawConfig(): EmbeddingConfig {
  const r = resolveEmbeddingConfig({
    [EMBEDDING_ENV.provider]: "local",
    [EMBEDDING_ENV.promptStyle]: "raw",
    [EMBEDDING_ENV.localApiKey]: SECRET,
  });
  if (!r.enabled) throw new Error("unreachable");
  return r.config;
}

function doc(externalId: string, fullText: string): RerankableDocument {
  return { sourceId: "yargitay", externalId, fullText, contentSha256: sha256HexUtf8(fullText) };
}

function capturing(): EmbeddingPort & { texts: string[] } {
  const texts: string[] = [];
  return {
    texts,
    async embed(input) {
      texts.push(...input);
      return input.map((t) => countVector(t));
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The windowing helper
// ---------------------------------------------------------------------------

describe("W18 — codePointWindows", () => {
  it("sığan metin tek parça döner", () => {
    expect(codePointWindows("kısa metin", 100, 50, 4)).toEqual(["kısa metin"]);
    expect(codePointWindows("", 100, 50, 4)).toEqual([""]);
  });

  it("her pencere tam boydadır ve sonuncusu metnin SONUNA dayanır", () => {
    const text = "ğ".repeat(8_500);
    const windows = codePointWindows(text, 8_000, 4_000, 4);
    expect(windows.length).toBe(2);
    for (const w of windows) expect([...w].length).toBe(8_000);
    expect(windows[0]).toBe(text.slice(0, 8_000));
    expect(windows[1]).toBe(text.slice(500));
  });

  it("kod noktası sayar, UTF-16 birimi değil", () => {
    const text = "😀".repeat(12);
    const windows = codePointWindows(text, 10, 5, 4);
    expect(windows.length).toBe(2);
    for (const w of windows) expect([...w].length).toBe(10);
  });

  it("tavanı aşınca eşit aralıklı pencereler seçilir; ilk ve son her zaman kalır", () => {
    const points = Array.from({ length: 30_000 }, (_, i) => String(i % 10));
    const text = points.join("");
    const windows = codePointWindows(text, 8_000, 4_000, 4);
    expect(windows.length).toBe(4);
    expect(windows[0]).toBe(text.slice(0, 8_000));
    expect(windows[3]).toBe(text.slice(30_000 - 8_000));
    expect(codePointWindows(text, 8_000, 4_000, 1)).toEqual([text.slice(0, 8_000)]);
  });

  it("aynı metin aynı pencereleri verir", () => {
    const text = "kira ".repeat(5_000);
    expect(codePointWindows(text, 8_000, 4_000, 4)).toEqual(codePointWindows(text, 8_000, 4_000, 4));
  });
});

// ---------------------------------------------------------------------------
// 2. The rerank sees past the head
// ---------------------------------------------------------------------------

describe("W18 — pencereli gömme", () => {
  const filler = "kira ".repeat(2_000); // 10 000 code points, past the head
  const TAIL_HIT = doc("kuyruk", `${filler}tahliye tahliye tahliye tahliye`);
  const NO_HIT = doc("bos", `${filler}vergi`);

  it("ilgili metin baştan sonra olsa da belge öne çıkar; pencere sayısı yazılır", async () => {
    const port = capturing();
    const outcome = await semanticRerank({
      query: "tahliye",
      items: [NO_HIT, TAIL_HIT],
      toDocument: (d) => d,
      config: rawConfig(),
      port,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.items.map((i) => i.item.externalId)).toEqual(["kuyruk", "bos"]);
    // 1 query + 2 windows per document.
    expect(port.texts.length).toBe(1 + 2 * 2);
    expect(outcome.karsilastirilanPencere).toBe(4);
    expect(outcome.karsilastirilanKarakter).toBe(MAX_EMBED_CODE_POINTS);
    for (const passage of port.texts.slice(1)) {
      expect([...passage].length).toBe(MAX_EMBED_CODE_POINTS);
    }
  });

  it("kısa belgeler tek pencere kalır — eski girdi sayısı değişmez", async () => {
    const port = capturing();
    const outcome = await semanticRerank({
      query: "tahliye",
      items: [doc("a", "tahliye kararı"), doc("b", "kira kararı")],
      toDocument: (d) => d,
      config: rawConfig(),
      port,
    });
    expect(port.texts.length).toBe(3);
    expect(outcome.karsilastirilanPencere).toBe(2);
  });

  it("pencere sayısı belge başına tavanı aşmaz", async () => {
    const port = capturing();
    const huge = doc("dev", "kira ".repeat(40_000));
    await semanticRerank({
      query: "kira",
      items: [huge, doc("b", "kira")],
      toDocument: (d) => d,
      config: rawConfig(),
      port,
    });
    expect(port.texts.length).toBe(1 + MAX_EMBED_WINDOWS_PER_DOCUMENT + 1);
    expect(EMBED_WINDOW_STRIDE).toBeLessThanOrEqual(MAX_EMBED_CODE_POINTS);
  });
});

// ---------------------------------------------------------------------------
// 3. Fail-closed rules survive the windows
// ---------------------------------------------------------------------------

describe("W18 — pencereyle de fail-closed", () => {
  const filler = "kira ".repeat(2_000);
  const items = [doc("a", `${filler}tahliye`), doc("b", `${filler}vergi`)];

  it("tek bir pencere ölçülemezse sıra DEĞİŞMEZ", async () => {
    const outcome = await semanticRerank({
      query: "tahliye",
      items,
      toDocument: (d) => d,
      config: rawConfig(),
      port: {
        async embed(texts) {
          // The third input is document "a"'s SECOND window: wrong dimension.
          return texts.map((t, i) => (i === 2 ? [1, 2] : countVector(t)));
        },
      },
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_SHAPE_MISMATCH");
    expect(outcome.items.map((i) => i.item.externalId)).toEqual(["a", "b"]);
    expect(outcome.items.every((i) => i.benzerlik === undefined)).toBe(true);
  });

  it("sağlayıcı pencere sayısı kadar vektör vermezse sıra DEĞİŞMEZ", async () => {
    const outcome = await semanticRerank({
      query: "tahliye",
      items,
      toDocument: (d) => d,
      config: rawConfig(),
      port: {
        async embed(texts) {
          // Answers as if only the heads had been sent.
          return texts.slice(0, 1 + items.length).map((t) => countVector(t));
        },
      },
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_SHAPE_MISMATCH");
  });

  it("yerel E5 modelinde etiketler yine gösterilmez, açıklama yine söyler", async () => {
    const r = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "local",
      [EMBEDDING_ENV.promptStyle]: "e5",
      [EMBEDDING_ENV.localApiKey]: SECRET,
      [EMBEDDING_ENV.localModel]: "intfloat/multilingual-e5-small:onnx-qint8",
      [EMBEDDING_ENV.localDimension]: "384",
    });
    if (!r.enabled) throw new Error("unreachable");
    const outcome = await semanticRerank({
      query: "tahliye",
      items,
      toDocument: (d) => d,
      config: r.config,
      port: { async embed(texts) { return texts.map((t) => countVector(t)); } },
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.items.every((i) => i.benzerlik === undefined)).toBe(true);
    expect(outcome.aciklama).toContain("doğrulanmadığından");
    expect(outcome.items.map((i) => i.item.externalId)).toEqual(["a", "b"]);
  });
});

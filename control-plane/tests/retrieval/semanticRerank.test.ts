/**
 * W16 Şerit C — anlam benzerliğine göre yeniden sıralamanın gerileme testleri.
 *
 * GERÇEK AĞ YOKTUR. Gömme çağrısı enjekte edilen bir port ile yapılır ve
 * portlar deterministiktir; hiçbir test bir uzak sunucuya, bir anahtara ya da
 * bu makinenin ortam değişkenlerine bağlı değildir.
 *
 * Kanıtlanan davranışlar:
 *
 *   1. ARAMA ÖZETİ GİRDİ OLAMAZ. Tam metnin parmak izini taşımayan bir belge
 *      reddedilir — kural bir yorum değil, çalışan bir kapıdır.
 *   2. FAIL-CLOSED. Zaman aşımı, ağ hatası, eksik vektör, yanlış boyut,
 *      NaN — hepsinde sıra DEĞİŞMEZ ve neden tipli döner. Yarım sıra yoktur.
 *   3. DETERMİNİSTİK. Aynı girdi + aynı gömme -> aynı sıra; eşitlik
 *      (kaynak, dış kimlik) ile bozulur, asla uuid ile.
 *   4. EKRANDA YÜZDE YOK. Dışarı yalnız üç kademeli sözel etiket çıkar ve
 *      yanında "bu bir doğruluk ölçüsü değildir" cümlesi durur.
 *   5. ANAHTAR SIZMAZ — ne hataya, ne sonuca, ne de bir metne.
 */

import { describe, expect, it } from "vitest";

import {
  EMBEDDING_ENV,
  resolveEmbeddingConfig,
  type EmbeddingConfig,
} from "../../src/retrieval/embeddingConfig.js";
import {
  cosineSimilarity,
  createEmbeddingPort,
  EmbeddingCallError,
  MAX_EMBED_CODE_POINTS,
  MAX_RERANK_DOCUMENTS,
  quantizeSimilarity,
  SEMANTIC_RERANK_DISCLAIMER,
  semanticRerank,
  similarityBand,
  SnippetNotRerankableError,
  assertRerankable,
  isRerankable,
  type EmbeddingPort,
  type RerankableDocument,
} from "../../src/retrieval/semanticRerank.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const SECRET = "sk-or-TEST-GIZLI-ANAHTAR-9f3a2b7c";

function openRouterConfig(): EmbeddingConfig {
  const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.apiKey]: SECRET });
  if (!resolution.enabled) throw new Error("unreachable");
  return resolution.config;
}

function localConfig(): EmbeddingConfig {
  const resolution = resolveEmbeddingConfig({
    [EMBEDDING_ENV.provider]: "local",
    [EMBEDDING_ENV.promptStyle]: "raw",
  });
  if (!resolution.enabled) throw new Error("unreachable");
  return resolution.config;
}

// ---------------------------------------------------------------------------
// Deterministik sahte gömme: dört eksende sözcük sayımı
// ---------------------------------------------------------------------------

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

/** Sayım tabanlı, tamamen deterministik port. */
const countingPort: EmbeddingPort = {
  async embed(texts) {
    return texts.map((t) => countVector(t));
  },
};

function doc(
  sourceId: string,
  externalId: string,
  fullText: string,
): RerankableDocument {
  return { sourceId, externalId, fullText, contentSha256: sha256HexUtf8(fullText) };
}

const OLAY = "tahliye ve kira uyuşmazlığı";

const D_KIRA = doc("yargitay", "k-1", "kira kira sözleşmesi hakkında karar");
const D_TAHLIYE = doc(
  "yargitay",
  "t-1",
  "tahliye tahliye tahliye ve kira ilişkisine dair karar",
);
const D_VERGI = doc("danistay", "v-1", "vergi vergi tarhiyatı hakkında karar");

it("ranks the local E5 model without inventing calibrated near/far labels", async () => {
  const resolution = resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "local",
    LOCAL_EMBEDDING_MODEL: "intfloat/multilingual-e5-small:onnx-qint8", LOCAL_EMBEDDING_DIMENSION: "384" });
  if (!resolution.enabled) throw new Error("disabled");
  const result = await semanticRerank({ query: OLAY, items: [D_VERGI, D_KIRA], toDocument: d => d,
    config: resolution.config, port: { async embed() {
      return [[1, 0], [0.83, Math.sqrt(1 - 0.83 ** 2)], [0.9, Math.sqrt(1 - 0.9 ** 2)]];
    } },
  });
  expect(result.applied).toBe(true);
  expect(result.items.map(e => e.item.externalId)).toEqual(["k-1", "v-1"]);
  expect(result.items.every(e => e.benzerlik === undefined)).toBe(true);
  expect(result.aciklama).toContain("yakın/orta/uzak etiketleri gösterilmez");
});

// ---------------------------------------------------------------------------
// 1. Arama özeti girdi olamaz
// ---------------------------------------------------------------------------

describe("Şerit C — arama özeti sıralama girdisi olamaz", () => {
  it("tam metnin parmak izini taşımayan belge REDDEDİLİR", () => {
    const full = "Bu kararın tam metni uzun uzun devam eder ve şöyle biter.";
    const snippet = full.slice(0, 20);
    const faked: RerankableDocument = {
      sourceId: "yargitay",
      externalId: "x-1",
      // Arama listesinden kopyalanmış ÖZET, tam metnin parmak iziyle birlikte.
      fullText: snippet,
      contentSha256: sha256HexUtf8(full),
    };
    expect(isRerankable(faked)).toBe(false);
    expect(() => assertRerankable(faked)).toThrow(SnippetNotRerankableError);
    try {
      assertRerankable(faked);
    } catch (error) {
      expect((error as SnippetNotRerankableError).problem).toBe("CONTENT_HASH_MISMATCH");
    }
  });

  it("boş metin REDDEDİLİR", () => {
    const empty: RerankableDocument = {
      sourceId: "yargitay",
      externalId: "x-2",
      fullText: "   ",
      contentSha256: sha256HexUtf8("   "),
    };
    expect(isRerankable(empty)).toBe(false);
    try {
      assertRerankable(empty);
    } catch (error) {
      expect((error as SnippetNotRerankableError).problem).toBe("EMPTY_TEXT");
    }
  });

  it("gerçekten getirilmiş tam metin geçer", () => {
    expect(isRerankable(D_KIRA)).toBe(true);
  });

  it("semanticRerank bir özet verilirse ATAR — sessizce sıralamaz", async () => {
    await expect(
      semanticRerank({
        query: OLAY,
        items: [D_KIRA, { ...D_TAHLIYE, contentSha256: sha256HexUtf8("başka metin") }],
        toDocument: (d) => d,
        config: localConfig(),
        port: countingPort,
      }),
    ).rejects.toBeInstanceOf(SnippetNotRerankableError);
  });
});

// ---------------------------------------------------------------------------
// 2. Sıralama gerçekten değişir ve etiketler sözeldir
// ---------------------------------------------------------------------------

describe("Şerit C — sıralama ve sözel etiket", () => {
  it("benzerliğe göre yeniden dizer ve üç kademeli etiket verir", async () => {
    const outcome = await semanticRerank({
      query: OLAY,
      items: [D_KIRA, D_TAHLIYE, D_VERGI],
      toDocument: (d) => d,
      config: localConfig(),
      port: countingPort,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.items.map((i) => i.item.externalId)).toEqual(["t-1", "k-1", "v-1"]);
    expect(outcome.items.map((i) => i.benzerlik)).toEqual(["yakın", "orta", "uzak"]);
    expect(outcome.aciklama).toBe(SEMANTIC_RERANK_DISCLAIMER);
    expect(outcome.karsilastirilanBelge).toBe(3);
    expect(outcome.karsilastirilanKarakter).toBe(MAX_EMBED_CODE_POINTS);
    expect(outcome.warning).toBeUndefined();
  });

  it("değişmez cümle harfi harfine sabittir ve doğru şeyi söyler", () => {
    expect(SEMANTIC_RERANK_DISCLAIMER).toBe(
      "Bu sıra, belgelerin tam metinlerinin olay anlatımınıza METİN OLARAK ne kadar" +
        " benzediğine göre dizilmiştir. Bu bir DOĞRULUK ÖLÇÜSÜ DEĞİLDİR, metin" +
        " benzerliğidir; hangi kararın olayınıza uyduğunu yalnız siz belirlersiniz.",
    );
    expect(SEMANTIC_RERANK_DISCLAIMER).toContain("DOĞRULUK ÖLÇÜSÜ DEĞİLDİR");
    expect(SEMANTIC_RERANK_DISCLAIMER).toContain("metin benzerliğidir");
  });

  it("sonuçta HİÇBİR sayısal benzerlik alanı yoktur (yüzdeye dönüşemez)", async () => {
    const outcome = await semanticRerank({
      query: OLAY,
      items: [D_KIRA, D_TAHLIYE, D_VERGI],
      toDocument: (d) => d,
      config: localConfig(),
      port: countingPort,
    });
    for (const entry of outcome.items) {
      expect(Object.keys(entry).sort()).toEqual(["benzerlik", "item"]);
      expect(typeof entry.benzerlik).toBe("string");
    }
    // Kademe adları; hiçbiri sayı ya da yüzde değil.
    expect(["yakın", "orta", "uzak"]).toContain(outcome.items[0]?.benzerlik);
    expect(JSON.stringify(outcome)).not.toMatch(/%/u);
  });

  it("kademe sınırları sözcüğe çevrilir", () => {
    expect(similarityBand(0.99)).toBe("yakın");
    expect(similarityBand(0.75)).toBe("yakın");
    expect(similarityBand(0.7499)).toBe("orta");
    expect(similarityBand(0.5)).toBe("orta");
    expect(similarityBand(0.4999)).toBe("uzak");
    expect(similarityBand(-1)).toBe("uzak");
  });
});

// ---------------------------------------------------------------------------
// 3. Determinizm
// ---------------------------------------------------------------------------

describe("Şerit C — determinizm", () => {
  it("aynı girdi + aynı gömme -> aynı sıra (beş koşu)", async () => {
    const items = [D_VERGI, D_TAHLIYE, D_KIRA];
    const orders: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      const outcome = await semanticRerank({
        query: OLAY,
        items,
        toDocument: (d) => d,
        config: localConfig(),
        port: countingPort,
      });
      orders.push(outcome.items.map((entry) => entry.item.externalId));
    }
    for (const order of orders) expect(order).toEqual(orders[0]);
  });

  it("eşit benzerlikte sıra (kaynak, dış kimlik) ile bozulur — uuid ile DEĞİL", async () => {
    const text = "kira sözleşmesine dair karar";
    // Aynı metin -> aynı vektör -> aynı kosinüs. Kimlik dışında hiçbir ayrım yok.
    const zz = doc("yargitay", "zz", text);
    const aa = doc("yargitay", "aa", text);
    const danistayAa = doc("danistay", "aa", text);

    for (const order of [
      [zz, aa, danistayAa],
      [danistayAa, zz, aa],
      [aa, danistayAa, zz],
    ]) {
      const outcome = await semanticRerank({
        query: OLAY,
        items: order,
        toDocument: (d) => d,
        config: localConfig(),
        port: countingPort,
      });
      expect(
        outcome.items.map((entry) => `${entry.item.sourceId}::${entry.item.externalId}`),
      ).toEqual(["danistay::aa", "yargitay::aa", "yargitay::zz"]);
    }
  });

  it("kosinüs karşılaştırması yuvarlanmış tam sayı üzerindendir (geçişli)", () => {
    expect(quantizeSimilarity(0.1234564)).toBe(quantizeSimilarity(0.1234564));
    expect(quantizeSimilarity(0.5)).toBe(500_000);
    expect(quantizeSimilarity(1)).toBe(1_000_000);
  });

  it("kosinüs hesaplanamayan durumlarda null döner, uydurma 0 değil", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
    expect(cosineSimilarity([], [])).toBeNull();
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull();
    expect(cosineSimilarity([Number.NaN, 1], [1, 1])).toBeNull();
    expect(cosineSimilarity([Number.POSITIVE_INFINITY, 1], [1, 1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Fail-closed
// ---------------------------------------------------------------------------

describe("Şerit C — ağ hatasında sıra DEĞİŞMEZ", () => {
  const items = [D_VERGI, D_TAHLIYE, D_KIRA];
  const inputOrder = items.map((d) => d.externalId);

  async function run(port: EmbeddingPort, timeoutMs?: number) {
    return semanticRerank({
      query: OLAY,
      items,
      toDocument: (d) => d,
      config: localConfig(),
      port,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }

  it("ağ hatası: sıra girdi sırasıdır, neden EMBEDDING_FAILED", async () => {
    const outcome = await run({
      embed: () => Promise.reject(new EmbeddingCallError("EMBEDDING_FAILED")),
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.items.map((e) => e.item.externalId)).toEqual(inputOrder);
    expect(outcome.items.every((e) => e.benzerlik === undefined)).toBe(true);
    expect(outcome.warning?.reason).toBe("EMBEDDING_FAILED");
    expect(outcome.warning?.message).toContain("Sıra değiştirilmedi");
    expect(outcome.aciklama).toBeUndefined();
    expect(outcome.karsilastirilanBelge).toBe(0);
  });

  it("gerçek zaman aşımı sinyali: neden EMBEDDING_TIMEOUT", async () => {
    const hanging: EmbeddingPort = {
      embed: (_texts, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            reject((opts.signal as AbortSignal).reason);
          });
        }),
    };
    const outcome = await run(hanging, 5);
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_TIMEOUT");
    expect(outcome.items.map((e) => e.item.externalId)).toEqual(inputOrder);
  });

  it("beklenmedik bir hata da fail-closed'dır", async () => {
    const outcome = await run({ embed: () => Promise.reject(new Error("boom")) });
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_FAILED");
    expect(outcome.items.map((e) => e.item.externalId)).toEqual(inputOrder);
  });

  it("eksik vektör: sıra değişmez, neden EMBEDDING_SHAPE_MISMATCH", async () => {
    const short: EmbeddingPort = {
      async embed(texts) {
        return texts.slice(1).map((t) => countVector(t));
      },
    };
    const outcome = await run(short);
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_SHAPE_MISMATCH");
    expect(outcome.items.map((e) => e.item.externalId)).toEqual(inputOrder);
  });

  it("tek bir belge ölçülemese bile TAMAMI iptal edilir — yarım sıra yoktur", async () => {
    const oneBad: EmbeddingPort = {
      async embed(texts) {
        return texts.map((t, i) => (i === 2 ? [Number.NaN, 0, 0, 0] : countVector(t)));
      },
    };
    const outcome = await run(oneBad);
    expect(outcome.applied).toBe(false);
    expect(outcome.warning?.reason).toBe("EMBEDDING_SHAPE_MISMATCH");
    expect(outcome.items.map((e) => e.item.externalId)).toEqual(inputOrder);
  });

  it("boş olay metni ve boş liste de fail-closed'dır", async () => {
    const emptyQuery = await semanticRerank({
      query: "   ",
      items,
      toDocument: (d) => d,
      config: localConfig(),
      port: countingPort,
    });
    expect(emptyQuery.applied).toBe(false);
    expect(emptyQuery.warning?.reason).toBe("EMPTY_QUERY");
    expect(emptyQuery.items.map((e) => e.item.externalId)).toEqual(inputOrder);

    const emptyList = await semanticRerank({
      query: OLAY,
      items: [] as RerankableDocument[],
      toDocument: (d) => d,
      config: localConfig(),
      port: countingPort,
    });
    expect(emptyList.applied).toBe(false);
    expect(emptyList.warning?.reason).toBe("NO_FULL_TEXT");
  });

  it("tavanı aşan aday kümesi bir çağıran hatasıdır", async () => {
    const many = Array.from({ length: MAX_RERANK_DOCUMENTS + 1 }, (_v, i) =>
      doc("yargitay", `m-${i}`, `kira karar ${i}`),
    );
    await expect(
      semanticRerank({
        query: OLAY,
        items: many,
        toDocument: (d) => d,
        config: localConfig(),
        port: countingPort,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 5. Anahtar sızmaz + metin biçimi ve kırpma
// ---------------------------------------------------------------------------

describe("Şerit C — ağ katmanı: anahtar yalnız başlıkta", () => {
  it("kimlik yalnız Authorization başlığına yazılır, gövdeye ve hataya girmez", async () => {
    const config = openRouterConfig();
    let seenHeaders: Record<string, string> = {};
    let seenBody = "";
    let seenUrl = "";
    const fetchImpl = (async (url: unknown, init: unknown) => {
      seenUrl = String(url);
      const request = init as { headers: Record<string, string>; body: string };
      seenHeaders = request.headers;
      seenBody = request.body;
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const port = createEmbeddingPort(config, fetchImpl);
    const vectors = await port.embed(["tahliye"]);
    expect(vectors).toEqual([[1, 0]]);
    expect(seenUrl).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(seenHeaders["authorization"]).toBe(`Bearer ${SECRET}`);
    expect(seenBody).not.toContain(SECRET);
    expect(JSON.stringify({ port })).not.toContain(SECRET);
  });

  it("kimliksiz yerel sunucuya Authorization başlığı GÖNDERİLMEZ", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: unknown, init: unknown) => {
      seenHeaders = (init as { headers: Record<string, string> }).headers;
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await createEmbeddingPort(localConfig(), fetchImpl).embed(["x"]);
    expect(seenHeaders["authorization"]).toBeUndefined();
  });

  it("sağlayıcının hata gövdesi hataya kopyalanmaz (kimliği yankılayabilir)", async () => {
    const config = openRouterConfig();
    const echoing = (async () =>
      new Response(`{"error":"bad key ${SECRET}"}`, { status: 401 })) as unknown as typeof fetch;
    const port = createEmbeddingPort(config, echoing);
    let caught: unknown;
    try {
      await port.embed(["x"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EmbeddingCallError);
    const err = caught as EmbeddingCallError;
    expect(err.reason).toBe("EMBEDDING_FAILED");
    expect(err.message).not.toContain(SECRET);
    expect(String(err.stack ?? "")).not.toContain(SECRET);
  });

  it("bozuk gövde de tipli hata verir", async () => {
    const broken = (async () =>
      new Response("değil json", { status: 200 })) as unknown as typeof fetch;
    await expect(
      createEmbeddingPort(openRouterConfig(), broken).embed(["x"]),
    ).rejects.toBeInstanceOf(EmbeddingCallError);

    const noData = (async () =>
      new Response(JSON.stringify({ nope: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(
      createEmbeddingPort(openRouterConfig(), noData).embed(["x"]),
    ).rejects.toBeInstanceOf(EmbeddingCallError);
  });

  it("metin biçimi uygulanır ve uzun belge KOD NOKTASI sayarak kırpılır", async () => {
    const config = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "local",
      [EMBEDDING_ENV.promptStyle]: "e5",
    });
    if (!config.enabled) throw new Error("unreachable");

    const long = "ğ".repeat(MAX_EMBED_CODE_POINTS + 500);
    const captured: string[] = [];
    const capturing: EmbeddingPort = {
      async embed(texts) {
        captured.push(...texts);
        return texts.map((t) => countVector(t));
      },
    };
    await semanticRerank({
      query: OLAY,
      items: [doc("yargitay", "a", long), doc("yargitay", "b", `${long}kira`)],
      toDocument: (d) => d,
      config: config.config,
      port: capturing,
    });
    expect(captured[0]).toBe(`query: ${OLAY}`);
    for (const passage of captured.slice(1)) {
      expect(passage.startsWith("passage: ")).toBe(true);
      expect([...passage.slice("passage: ".length)].length).toBe(MAX_EMBED_CODE_POINTS);
    }
  });
});

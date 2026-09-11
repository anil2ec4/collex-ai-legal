/**
 * W16 Şerit C — "Olayı anlat" listesine bağlanan İSTEĞE BAĞLI semantik aşama.
 *
 * Şerit B'nin ürettiği MUTABAKAT sırası bu aşamanın girdisidir ve aşama
 * kapalıyken hiçbir şeyi değiştirmez. Burada kanıtlananlar:
 *
 *   - `rerank` istenmediğinde sonuçta semantik alan HİÇ YOKTUR (varsayılan
 *     kapalı, davranış Şerit B'deki gibi);
 *   - `rerank:true` ama gömme kapalıyken liste EKSİKSİZ döner, sıra
 *     değişmez ve "semantik sıralama kapalı — nedeni: …" notu taşır;
 *   - açıkken sıralama YALNIZ tam metni getirilmiş kararların yerleri
 *     arasında yapılır; tam metni getirilemeyen karar YERİNDE kalır;
 *   - sıra ARAMA ÖZETİNE değil, GETİRİLEN TAM METNE göre kurulur;
 *   - ağ hatasında sıra değişmez ve nedeni tipli döner;
 *   - iki koşu aynı sırayı verir (kimlikler farklı üretilse bile);
 *   - kimlik hiçbir çıktıya sızmaz.
 *
 * Gerçek ağ yoktur: hem sağlayıcı geçidi hem gömme portu hem de tam metin
 * portu enjekte edilir.
 */

import { describe, expect, it } from "vitest";

import type { Outcome } from "../../src/capabilities/types.js";
import { FakeGateway } from "../../src/gateway/gateway.js";
import {
  EMBEDDING_ENV,
  resolveEmbeddingConfig,
  type EmbeddingResolution,
} from "../../src/retrieval/embeddingConfig.js";
import {
  SEMANTIC_RERANK_DISCLAIMER,
  type EmbeddingPort,
} from "../../src/retrieval/semanticRerank.js";
import {
  relatedSearch,
  type RelatedFullText,
  type RelatedFullTextPort,
  type RelatedSearchDeps,
  type RelatedSearchResult,
} from "../../src/sources/relatedSearch.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const T0 = "2026-09-04T09:00:00.000Z";
const SECRET = "sk-or-TEST-GIZLI-ANAHTAR-9f3a2b7c";

const OLAY =
  "Müvekkilim kiracı olarak oturduğu dairede kira sözleşmesi imzalandıktan sonra" +
  " ev sahibine tahliye taahhüdü verdi.";

/** Üç karar; tarihleri farklı, bu yüzden MUTABAKAT sırası belirlidir. */
const DECISIONS = [
  { id: "kar-eski", tarih: "2020-01-15T00:00:00Z" },
  { id: "kar-orta", tarih: "2021-01-15T00:00:00Z" },
  { id: "kar-yeni", tarih: "2022-01-15T00:00:00Z" },
];

function bedestenOk(): Outcome<unknown> {
  return {
    status: "ok",
    provider: "BEDESTEN",
    observedAt: T0,
    warnings: [],
    data: {
      decisions: DECISIONS.map((d) => ({
        documentId: d.id,
        itemType: { name: "YARGITAYKARARI" },
        kararTarihi: d.tarih,
      })),
      total_records: 3,
    },
  };
}

/**
 * Tam metinler. "kar-eski" olaya en yakın, "kar-yeni" en uzak: yani semantik
 * aşama çalışırsa sıra TERSİNE döner — testin ayırt ediciliği buradan gelir.
 */
const FULL_TEXTS: Readonly<Record<string, string>> = {
  "kar-eski": "tahliye tahliye tahliye ve kira ilişkisine dair Yargıtay kararı tam metni",
  "kar-orta": "kira kira sözleşmesinin feshine dair Yargıtay kararı tam metni",
  "kar-yeni": "vergi vergi tarhiyatına dair karar tam metni",
};

function fullTextPort(
  only?: readonly string[],
): RelatedFullTextPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async fetch(row): Promise<RelatedFullText | null> {
      asked.push(row.externalId);
      if (only !== undefined && !only.includes(row.externalId)) return null;
      const text = FULL_TEXTS[row.externalId];
      if (text === undefined) return null;
      return { fullText: text, contentSha256: sha256HexUtf8(text) };
    },
  };
}

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

const countingEmbedder: EmbeddingPort = {
  async embed(texts) {
    return texts.map((t) => countVector(t));
  },
};

function enabledEmbedding(): EmbeddingResolution {
  return resolveEmbeddingConfig({
    [EMBEDDING_ENV.provider]: "local",
    [EMBEDDING_ENV.promptStyle]: "raw",
    [EMBEDDING_ENV.localApiKey]: SECRET,
  });
}

function counterIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

async function run(
  overrides: Partial<RelatedSearchDeps> & { rerank?: boolean },
): Promise<RelatedSearchResult> {
  const { rerank, ...deps } = overrides;
  return relatedSearch(
    {
      olay: OLAY,
      sources: ["yargitay"],
      maxQueries: 1,
      ...(rerank !== undefined ? { rerank } : {}),
    },
    {
      gateway: new FakeGateway(() => bedestenOk()),
      now: () => T0,
      monotonic: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      newId: counterIds(),
      ...deps,
    },
  );
}

function ids(result: RelatedSearchResult): string[] {
  return result.results.map((row) => row.externalId);
}

/**
 * MUTABAKAT sırası: eşit konu + eşit sorgu + eşit merci -> KAYNAĞIN KENDİ
 * SIRASI (W17), sonra tarih. Fikstürde üç karar aynı aramadan, kaynağın
 * verdiği sırayla geliyor; bu yüzden beklenen dizi kaynağın listesidir.
 *
 * Neden değişti (05.09.2026 ölçümü): tarih ilk eşitlik bozucuyken bir kira
 * tahliye araması, kaynağın kendi listesinin başına koyduğu Yargıtay 3. HD
 * kararlarını aşağı itip ilgisiz dairelerin EN YENİ kararlarıyla başlıyordu.
 * Kaynak bir kararı bir nedenle başa koymuştur; onu atıp bütün eşitlik
 * grubunu tarihe göre dizmek, kaynağın yargısını takvimle değiştirmektir.
 */
const MUTABAKAT_ORDER = ["kar-eski", "kar-orta", "kar-yeni"];

describe("Şerit C — aşama varsayılan KAPALI", () => {
  it("rerank istenmezse sonuçta semantik alan hiç yoktur", async () => {
    const result = await run({});
    expect(ids(result)).toEqual(MUTABAKAT_ORDER);
    expect(result.semantikSiralama).toBeUndefined();
    expect(result.notes.map((n) => n.kind)).not.toContain("SEMANTIK_SIRALAMA");
    expect(result.notes.map((n) => n.kind)).not.toContain("SEMANTIK_SIRALAMA_KAPALI");
    expect(result.results.every((row) => row.benzerlik === undefined)).toBe(true);
  });

  it("rerank:false de aynıdır", async () => {
    const result = await run({ rerank: false });
    expect(result.semantikSiralama).toBeUndefined();
    expect(ids(result)).toEqual(MUTABAKAT_ORDER);
  });
});

describe("Şerit C — gömme kapalıyken liste EKSİKSİZ, sıra aynı, neden yazılı", () => {
  it("rerank:true ama sağlayıcı yoksa sonuç eksiksiz döner ve nedenini söyler", async () => {
    const result = await run({
      rerank: true,
      embedding: resolveEmbeddingConfig({}),
    });
    // Liste eksiksiz ve sırası MUTABAKAT sırası.
    expect(ids(result)).toEqual(MUTABAKAT_ORDER);
    expect(result.results.length).toBe(3);
    expect(result.results.every((row) => row.benzerlik === undefined)).toBe(true);

    expect(result.semantikSiralama?.uygulandi).toBe(false);
    expect(result.semantikSiralama?.neden).toBe("EMBEDDING_NOT_CONFIGURED");
    expect(result.semantikSiralama?.aciklama).toBeUndefined();
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(0);

    const note = result.notes.find((n) => n.kind === "SEMANTIK_SIRALAMA_KAPALI");
    expect(note).toBeDefined();
    expect(note?.message).toContain("sıralama kapalı — nedeni:");
    expect(note?.message).toContain("KAPALI");
    // Şerit B'nin kendi cümlesi yerinde kalır.
    expect(result.siralamaNotu).toContain("İLGİLİLİK PUANI DEĞİLDİR");
  });

  it("kapalıyken tam metin için TEK BİR çağrı bile yapılmaz", async () => {
    const port = fullTextPort();
    await run({ rerank: true, embedding: resolveEmbeddingConfig({}), fullText: port });
    expect(port.asked).toEqual([]);
  });
});

describe("Şerit C — açıkken sıralama tam metne göre kurulur", () => {
  it("tam metni getirilen kararlar kendi aralarında yeniden dizilir", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: fullTextPort(),
    });
    // MUTABAKAT sırası (yeni -> orta -> eski) tam metin karşılaştırmasıyla
    // tümüyle değişti: sırayı artık getirilen metinler belirliyor.
    expect(ids(result)).not.toEqual(MUTABAKAT_ORDER);
    expect(ids(result)).toEqual(["kar-orta", "kar-eski", "kar-yeni"]);
    expect(result.results.map((r) => r.benzerlik)).toEqual(["yakın", "orta", "uzak"]);
    expect(result.semantikSiralama?.uygulandi).toBe(true);
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(3);
    expect(result.semantikSiralama?.getirilemeyenBelge).toBe(0);
    expect(result.semantikSiralama?.aciklama).toBe(SEMANTIC_RERANK_DISCLAIMER);
    expect(result.notes.map((n) => n.message)).toContain(SEMANTIC_RERANK_DISCLAIMER);
    // Liste büyümez, küçülmez.
    expect(result.results.length).toBe(3);
  });

  it("tam metni getirilemeyen karar YERİNDE kalır", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      // Ortadaki karar (MUTABAKAT sırasında 1. dizin) getirilemiyor.
      fullText: fullTextPort(["kar-yeni", "kar-eski"]),
    });
    expect(ids(result)).toEqual(["kar-eski", "kar-orta", "kar-yeni"]);
    // Yeri korunan karar hiçbir etiket almaz: karşılaştırılmadı.
    expect(result.results[1]?.externalId).toBe("kar-orta");
    expect(result.results[1]?.benzerlik).toBeUndefined();
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(2);
    expect(result.semantikSiralama?.getirilemeyenBelge).toBe(1);
    expect(result.semantikSiralama?.mesaj).toContain("yerinde bırakıldı");
  });

  it("karşılaştırılabilir iki belge yoksa sıra değişmez ve neden NO_FULL_TEXT olur", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: fullTextPort(["kar-orta"]),
    });
    expect(ids(result)).toEqual(MUTABAKAT_ORDER);
    expect(result.semantikSiralama?.uygulandi).toBe(false);
    expect(result.semantikSiralama?.neden).toBe("NO_FULL_TEXT");
    expect(result.semantikSiralama?.getirilemeyenBelge).toBe(2);
    expect(result.results.every((row) => row.benzerlik === undefined)).toBe(true);
  });

  it("pencere daraltılırsa yalnız o kadar karar karşılaştırılır", async () => {
    const port = fullTextPort();
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: port,
      rerankDocuments: 2,
    });
    // W17: pencere, MUTABAKAT sırasının ilk ikisidir ve o sıra artık kaynağın
    // kendi sırasıdır (bkz. MUTABAKAT_ORDER).
    expect(port.asked).toEqual(["kar-eski", "kar-orta"]);
    // İlk iki yer kendi arasında dizildi; üçüncü karar dokunulmadan kaldı.
    expect(ids(result)).toEqual(["kar-orta", "kar-eski", "kar-yeni"]);
    expect(result.results[2]?.benzerlik).toBeUndefined();
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(2);
  });
});

describe("Şerit C — ağ hatasında sıra değişmez", () => {
  it("gömme çağrısı hata verirse liste MUTABAKAT sırasında kalır", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: { embed: () => Promise.reject(new Error("ağ yok")) },
      fullText: fullTextPort(),
    });
    expect(ids(result)).toEqual(MUTABAKAT_ORDER);
    expect(result.semantikSiralama?.uygulandi).toBe(false);
    expect(result.semantikSiralama?.neden).toBe("EMBEDDING_FAILED");
    expect(result.semantikSiralama?.mesaj).toContain("Sıra değiştirilmedi");
    expect(result.results.every((row) => row.benzerlik === undefined)).toBe(true);
  });

  it("tam metin portu patlarsa o karar karşılaştırılmaz, istek çökmez", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: {
        async fetch(row) {
          if (row.externalId === "kar-orta") throw new Error("kaynak sunucu düştü");
          const text = FULL_TEXTS[row.externalId] as string;
          return { fullText: text, contentSha256: sha256HexUtf8(text) };
        },
      },
    });
    expect(result.results.length).toBe(3);
    expect(result.semantikSiralama?.uygulandi).toBe(true);
    expect(result.semantikSiralama?.getirilemeyenBelge).toBe(1);
    expect(result.results[1]?.externalId).toBe("kar-orta");
  });
});

describe("Şerit C — determinizm ve gizlilik", () => {
  it("iki koşu, farklı kimlik üreteçleriyle bile aynı sırayı verir", async () => {
    const a = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: fullTextPort(),
      newId: counterIds("a"),
    });
    const b = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: fullTextPort(),
      newId: counterIds("z"),
    });
    expect(a.relatedId).not.toBe(b.relatedId);
    expect(ids(a)).toEqual(ids(b));
    expect(a.results.map((r) => r.benzerlik)).toEqual(b.results.map((r) => r.benzerlik));
  });

  it("kimlik sonuç nesnesinin hiçbir yerine sızmaz ve yüzde yazılmaz", async () => {
    const result = await run({
      rerank: true,
      embedding: enabledEmbedding(),
      embedder: countingEmbedder,
      fullText: fullTextPort(),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toMatch(/%/u);
    for (const row of result.results) {
      expect(typeof row.benzerlik === "string" || row.benzerlik === undefined).toBe(true);
    }
  });
});

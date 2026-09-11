/**
 * W18 — scored relevance model, query de-duplication and the caller-chosen
 * semantic window for "olayı anlat → ilgili kararlar".
 *
 * Everything here runs against INJECTED fakes (gateway, embedder, full-text
 * port). Nothing touches the network. What is proven:
 *
 *   - every row the service returns carries an ADDITIVE `relevance` object
 *     whose five signals a reader can re-derive from the response itself;
 *   - the score orders first, the W17 keys break ties, and a hand-built row
 *     without a score is ordered exactly as before;
 *   - the honesty contract holds: `ranking:"colleX-heuristic"` is on the
 *     response, the fixed disclaimer is verbatim, and no percentage, no
 *     "skor" and no bare "ilgililik puanı" reaches the JSON;
 *   - near-identical generated queries are folded and REPORTED, and the cap
 *     is spent only on distinct searches;
 *   - `rerankDocuments` widens the semantic window when asked and is clamped
 *     at the module ceiling, at the service and at the HTTP boundary.
 *
 * None of this measures relevance on real law; the model is a heuristic and
 * says so on every response.
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
  MAX_RERANK_DOCUMENTS,
  type EmbeddingPort,
} from "../../src/retrieval/semanticRerank.js";
import {
  buildRelatedQueries,
  compareRelatedRows,
  computeRelevance,
  NEAR_DUPLICATE_JACCARD,
  RELATED_RANKING,
  RELATED_RANKING_DISCLAIMER,
  relatedSearch,
  RELEVANCE_WEIGHTS,
  type OrderableRow,
  type RelatedFullText,
  type RelatedFullTextPort,
  type RelatedSearchResult,
  type RelevanceContext,
} from "../../src/sources/relatedSearch.js";
import { createSourcesRouter } from "../../src/sources/routes.js";
import { lexemeMatches, turkishLexemes } from "../../src/sources/searchService.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const T0 = "2026-09-04T09:00:00.000Z";
const SECRET = "sk-or-TEST-GIZLI-ANAHTAR-9f3a2b7c";

/** Fires two concept rows ("tahliye taahhüdü" and "kira"). */
const OLAY =
  "Müvekkilim kiracı olarak oturduğu dairede kira sözleşmesi imzalandıktan sonra" +
  " ev sahibine tahliye taahhüdü verdi. Ev sahibi şimdi bu taahhüde dayanarak" +
  " icra takibi başlattı; biz taahhüdün geçersiz olduğunu ileri sürüyoruz.";

interface FakeDecision {
  id: string;
  tarih?: string;
  daire?: string;
}

function bedestenOk(decisions: readonly FakeDecision[]): Outcome<unknown> {
  return {
    status: "ok",
    provider: "BEDESTEN",
    observedAt: T0,
    warnings: [],
    data: {
      decisions: decisions.map((d) => ({
        documentId: d.id,
        itemType: { name: "YARGITAYKARARI" },
        ...(d.daire !== undefined ? { birimAdi: d.daire } : {}),
        ...(d.tarih !== undefined ? { kararTarihi: d.tarih } : {}),
      })),
    },
  };
}

function counterIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs);
}

const baseRow = (over: Partial<OrderableRow>): OrderableRow => ({
  kararId: "yargitay::x",
  sourceId: "yargitay",
  merci: "Yargıtay",
  provider: "BEDESTEN",
  externalId: "x",
  title: "Yargıtay",
  bulanSorgular: ["s1"],
  mutabakat: 1,
  bulanKonular: ["i1"],
  konuMutabakati: 1,
  kaynakSirasi: 1,
  merciAgirligi: 0,
  siralamaTarihi: "2024-01-01",
  ...over,
});

const CTX: RelevanceContext = {
  subjectCount: 2,
  queryCount: 3,
  queryLexemes: ["tahliye", "taahhüdü", "kira", "tbk", "299"],
  currentYear: 2026,
};

// ---------------------------------------------------------------------------
// 1. Lexemes — Turkish lowercasing, separators, prefix rule
// ---------------------------------------------------------------------------

describe("W18 — Türkçe sözcük birimleri", () => {
  it("küçük harfe Türkçe kuralla indirir ve noktalama/tırnak/operatörü ayırıcı sayar", () => {
    expect(turkishLexemes('"Kira Alacağı" +TBK m.299')).toEqual(["kira", "alacağı", "tbk", "299"]);
    expect(turkishLexemes("İHTARNAME IŞIK")).toEqual(["ihtarname", "ışık"]);
  });

  it("tam ifade ile düz biçim AYNI sözcük kümesini verir", () => {
    expect(turkishLexemes('"tahliye taahhüdü"')).toEqual(turkishLexemes("tahliye taahhüdü"));
  });

  it("ön ek kuralı yalnız dört ve daha uzun birimlerde işler", () => {
    expect(lexemeMatches("tahliye", ["tahliyesi"])).toBe(true);
    expect(lexemeMatches("tahliyesi", ["tahliye"])).toBe(true);
    expect(lexemeMatches("kira", ["kiracı"])).toBe(true);
    expect(lexemeMatches("tbk", ["tbkx"])).toBe(false);
    expect(lexemeMatches("tbk", ["tbk"])).toBe(true);
    expect(lexemeMatches("vergi", ["kira", "tahliye"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The score — five signals, each re-derivable
// ---------------------------------------------------------------------------

describe("W18 — puanın beş sinyali", () => {
  it("ağırlıklar tam 1'e toplanır ve tam uyumlu satır 1 alır", () => {
    const sum = Object.values(RELEVANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    const full = computeRelevance(
      { konuMutabakati: 2, mutabakat: 3, merciAgirligi: 0, title: "tahliye taahhüdü kira TBK m.299" },
      "2025-01-01",
      CTX,
    );
    expect(full.score).toBe(1);
    expect(full.signals).toEqual({
      subjectAgreement: 1,
      queryAgreement: 1,
      snippetOverlap: 1,
      merciWeight: 1,
      recency: 1,
    });
    expect(full.matchedLexemes).toEqual(CTX.queryLexemes);
  });

  it("tarihi bilinmeyen karar yenilik sinyalinde 0 alır — tarih UYDURULMAZ", () => {
    const unknown = computeRelevance(
      { konuMutabakati: 1, mutabakat: 1, merciAgirligi: 0, title: "Yargıtay" },
      "",
      CTX,
    );
    expect(unknown.signals.recency).toBe(0);
    expect(unknown.signals.snippetOverlap).toBe(0);
    expect(unknown.matchedLexemes).toEqual([]);
  });

  it("yenilik BANTLIDIR: aynı on yıl içindeki iki tarih aynı sinyali alır", () => {
    const a = computeRelevance({ konuMutabakati: 1, mutabakat: 1, merciAgirligi: 0, title: "" }, "2020-01-15", CTX);
    const b = computeRelevance({ konuMutabakati: 1, mutabakat: 1, merciAgirligi: 0, title: "" }, "2022-01-15", CTX);
    const old = computeRelevance({ konuMutabakati: 1, mutabakat: 1, merciAgirligi: 0, title: "" }, "1995-01-15", CTX);
    expect(a.signals.recency).toBe(b.signals.recency);
    expect(old.signals.recency).toBeLessThan(a.signals.recency);
    expect(old.signals.recency).toBeGreaterThan(0);
  });

  it("iki konunun uyuşması, tek konunun üç söylenişini geçer (W17 korunur)", () => {
    const twoSubjects = computeRelevance(
      { konuMutabakati: 2, mutabakat: 2, merciAgirligi: 0, title: "Yargıtay" },
      "2024-01-01",
      CTX,
    );
    const threePhrasings = computeRelevance(
      { konuMutabakati: 1, mutabakat: 3, merciAgirligi: 0, title: "Yargıtay" },
      "2024-01-01",
      CTX,
    );
    expect(twoSubjects.score).toBeGreaterThan(threePhrasings.score);
  });

  it("başlık/özet örtüşmesi eşit uyuşmada farkı yaratır ve hangi sözcüklerin bulunduğunu yazar", () => {
    const withOverlap = computeRelevance(
      {
        konuMutabakati: 1,
        mutabakat: 1,
        merciAgirligi: 0,
        title: "Yargıtay 3. HD",
        snippet: "Kiracının verdiği tahliye taahhüdünün geçerliliği",
      },
      "2024-01-01",
      CTX,
    );
    const without = computeRelevance(
      { konuMutabakati: 1, mutabakat: 1, merciAgirligi: 0, title: "Yargıtay 3. HD" },
      "2024-01-01",
      CTX,
    );
    expect(withOverlap.score).toBeGreaterThan(without.score);
    expect(withOverlap.matchedLexemes).toEqual(["tahliye", "taahhüdü", "kira"]);
    expect(withOverlap.signals.snippetOverlap).toBe(3 / 5);
  });

  it("puan [0,1] içindedir ve aynı girdi aynı puanı verir", () => {
    const row = { konuMutabakati: 9, mutabakat: 9, merciAgirligi: 0, title: "x" };
    const once = computeRelevance(row, "2024-01-01", CTX);
    const twice = computeRelevance(row, "2024-01-01", CTX);
    expect(once).toEqual(twice);
    expect(once.score).toBeLessThanOrEqual(1);
    expect(once.score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Ordering — score first, the old keys as tie-break
// ---------------------------------------------------------------------------

describe("W18 — sıralama: önce puan, sonra eski anahtarlar", () => {
  const rel = (score: number) => ({
    score,
    signals: { subjectAgreement: 0, queryAgreement: 0, snippetOverlap: 0, merciWeight: 0, recency: 0 },
    matchedLexemes: [],
  });

  it("puanı yüksek satır, konu mutabakatı düşük olsa da öne geçer", () => {
    const high = baseRow({ kararId: "a", konuMutabakati: 1, relevance: rel(0.9) });
    const low = baseRow({ kararId: "b", konuMutabakati: 2, relevance: rel(0.5) });
    expect(compareRelatedRows(high, low)).toBeLessThan(0);
    expect(compareRelatedRows(low, high)).toBeGreaterThan(0);
  });

  it("puan eşitse W17 anahtarları (konu, sorgu, merci, kaynak sırası, tarih, kimlik) karar verir", () => {
    const first = baseRow({ kararId: "a", kaynakSirasi: 1, relevance: rel(0.5) });
    const fifth = baseRow({ kararId: "b", kaynakSirasi: 5, relevance: rel(0.5) });
    expect(compareRelatedRows(first, fifth)).toBeLessThan(0);
  });

  it("puanı olmayan (elle kurulmuş) satırlar eskisi gibi dizilir", () => {
    const scored = baseRow({ kararId: "a", konuMutabakati: 1, relevance: rel(0.99) });
    const plain = baseRow({ kararId: "b", konuMutabakati: 2 });
    expect(compareRelatedRows(plain, scored)).toBeLessThan(0);
  });

  it("toplam ve deterministik bir sıradır", () => {
    const rows = [
      baseRow({ kararId: "z", relevance: rel(0.4) }),
      baseRow({ kararId: "a", relevance: rel(0.4) }),
      baseRow({ kararId: "m", relevance: rel(0.7) }),
    ];
    const once = [...rows].sort(compareRelatedRows).map((r) => r.kararId);
    const twice = [...rows].reverse().sort(compareRelatedRows).map((r) => r.kararId);
    expect(once).toEqual(twice);
    expect(once[0]).toBe("m");
  });
});

// ---------------------------------------------------------------------------
// 4. The service — every row scored, the marker on, the honesty rule intact
// ---------------------------------------------------------------------------

describe("W18 — servis yanıtı", () => {
  async function run(): Promise<RelatedSearchResult> {
    return relatedSearch(
      { olay: OLAY, sources: ["yargitay"] },
      {
        gateway: new FakeGateway(() =>
          bedestenOk([
            { id: "d-1", tarih: "2024-05-11T00:00:00.000Z", daire: "Yargıtay 3. Hukuk Dairesi" },
            { id: "d-2", tarih: "2019-01-02T00:00:00.000Z" },
            { id: "d-3" },
          ]),
        ),
        now: () => T0,
        monotonic: fakeClock(5),
        newId: counterIds(),
      },
    );
  }

  it("her satır beş sinyalli bir relevance taşır ve liste puana göre azalan dizilidir", async () => {
    const result = await run();
    expect(result.results.length).toBe(3);
    for (const row of result.results) {
      expect(row.relevance).toBeDefined();
      expect(Object.keys(row.relevance?.signals ?? {}).sort()).toEqual(
        ["merciWeight", "queryAgreement", "recency", "snippetOverlap", "subjectAgreement"],
      );
    }
    const scores = result.results.map((r) => r.relevance?.score ?? -1);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i] as number);
    }
    // Every decision came from every query, so the score separates them by
    // date band and nothing else: the undated one is LAST, never promoted.
    expect(result.results[2]?.externalId).toBe("d-3");
    expect(result.results[2]?.relevance?.signals.recency).toBe(0);
  });

  it("ranking işareti yanıtta durur ve sabit cümle harfi harfine kalır", async () => {
    const result = await run();
    expect(result.ranking).toBe("colleX-heuristic");
    expect(RELATED_RANKING).toBe("colleX-heuristic");
    expect(result.siralamaNotu).toBe(RELATED_RANKING_DISCLAIMER);
    expect(result.notes[0]).toEqual({ kind: "SIRALAMA_ACIKLAMASI", message: RELATED_RANKING_DISCLAIMER });
    const model = result.notes.find((n) => n.kind === "ILGILILIK_MODELI");
    expect(model?.message).toContain("colleX-heuristic");
    expect(model?.message).toContain("ilgililik puanı DEĞİLDİR");
    expect(model?.message).toContain("ÖLÇÜLMEDİ");
  });

  it("puan hiçbir yerde yüzde, skor ya da isabet oranı olarak sunulmaz", async () => {
    const blob = JSON.stringify(await run());
    expect(blob).not.toMatch(/ilgililik puanı(?! DEĞİLDİR)/iu);
    expect(blob).not.toMatch(/%\s?\d/u);
    expect(blob).not.toMatch(/skor|isabet oranı|doğruluk oranı/iu);
  });
});

// ---------------------------------------------------------------------------
// 5. De-duplication and diversity of the generated queries
// ---------------------------------------------------------------------------

describe("W18 — sorgu birleştirme ve çeşitlilik", () => {
  it("aynı sözcükleri arayan ikinci aday ÜRETİLMEZ ve nereye katlandığı yazılır", () => {
    const built = buildRelatedQueries(OLAY, 8);
    // "kira" is one word; pass 1 ties it to its anchor and pass 2 builds the
    // same "kira TBK m.299" — the second one is folded, not silently dropped.
    const folded = built.collapsed.find((c) => c.reason === "AYNI_SOZCUKLER");
    expect(folded).toBeDefined();
    expect(folded?.collapsedInto).toBe(folded?.text);
    expect(folded?.message).toContain("ÜRETİLMEDİ");
    for (const c of built.collapsed) {
      expect(built.queries.some((q) => q.text === c.collapsedInto)).toBe(true);
    }
  });

  it("seçilen sorgular arasında iki tane aynı sözcük kümesi yoktur", () => {
    const built = buildRelatedQueries(OLAY, 8);
    const keys = built.queries.map((q) => [...turkishLexemes(q.text)].sort().join(" "));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("katlanan aday kotayı harcamaz", () => {
    const built = buildRelatedQueries(OLAY, 2);
    expect(built.queries.length).toBe(2);
    expect(built.queries.map((q) => q.text)).toEqual(["tahliye taahhüdü", "kira TBK m.299"]);
  });

  it("neredeyse-aynı eşiği yuvarlak ve yazılıdır", () => {
    expect(NEAR_DUPLICATE_JACCARD).toBe(0.8);
  });

  it("servis, katlanan sorguları eklemeli alanda ve bir notta bildirir", async () => {
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"] },
      {
        gateway: new FakeGateway(() => bedestenOk([{ id: "d-1" }])),
        now: () => T0,
        monotonic: fakeClock(5),
        newId: counterIds(),
      },
    );
    expect(result.collapsedQueries.length).toBeGreaterThan(0);
    const note = result.notes.find((n) => n.kind === "SORGU_BIRLESTIRILDI");
    expect(note?.message).toContain("ÜRETİLMEDİ");
    expect(note?.message).toContain(String(result.collapsedQueries.length));
    // A folded query never appears among the run ones.
    for (const c of result.collapsedQueries) {
      expect(result.queries.some((q) => q.text === c.text && q.kind === c.kind)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. rerankDocuments — the caller's window, clamped
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

function fullTextPort(): RelatedFullTextPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async fetch(row): Promise<RelatedFullText | null> {
      asked.push(row.externalId);
      const text = `kira tahliye kararı ${row.externalId}`;
      return { fullText: text, contentSha256: sha256HexUtf8(text) };
    },
  };
}

describe("W18 — rerankDocuments", () => {
  const decisions = Array.from({ length: 12 }, (_, i) => ({
    id: `d-${i + 1}`,
    tarih: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));

  async function run(rerankDocuments?: number, depsWindow?: number) {
    const port = fullTextPort();
    const result = await relatedSearch(
      {
        olay: OLAY,
        sources: ["yargitay"],
        maxQueries: 1,
        rerank: true,
        ...(rerankDocuments !== undefined ? { rerankDocuments } : {}),
      },
      {
        gateway: new FakeGateway(() => bedestenOk(decisions)),
        now: () => T0,
        monotonic: fakeClock(5),
        newId: counterIds(),
        embedding: enabledEmbedding(),
        embedder: countingEmbedder,
        fullText: port,
        ...(depsWindow !== undefined ? { rerankDocuments: depsWindow } : {}),
      },
    );
    return { result, port };
  }

  it("istenmezse varsayılan pencere (10) kullanılır", async () => {
    const { result, port } = await run();
    expect(port.asked.length).toBe(10);
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(10);
  });

  it("çağıran daha geniş bir pencere isteyebilir", async () => {
    const { result, port } = await run(12);
    expect(port.asked.length).toBe(12);
    expect(result.semantikSiralama?.karsilastirilanBelge).toBe(12);
    expect(result.results.length).toBe(12);
  });

  it("istek, modül tavanına ve liste boyuna kırpılır; sıfır ve altı 1 sayılır", async () => {
    const wide = await run(MAX_RERANK_DOCUMENTS + 500);
    expect(wide.port.asked.length).toBe(12);
    const narrow = await run(0);
    expect(narrow.port.asked.length).toBe(1);
    expect(narrow.result.semantikSiralama?.uygulandi).toBe(false);
    expect(narrow.result.semantikSiralama?.neden).toBe("NO_FULL_TEXT");
  });

  it("istekteki değer, bağımlılıktaki işletmeci değerini geçersiz kılar", async () => {
    const { port } = await run(3, 7);
    expect(port.asked.length).toBe(3);
  });

  it("HTTP sınırında tam sayı ve 1..MAX_RERANK_DOCUMENTS aralığı zorunludur", async () => {
    const app = createSourcesRouter({
      gateway: new FakeGateway(() => bedestenOk([{ id: "d-1" }, { id: "d-2" }])),
      embedding: { enabled: false, reason: "EMBEDDING_BASE_URL_INVALID", message: "Injected" },
      now: () => T0,
      monotonic: fakeClock(5),
      newId: counterIds(),
    });
    const post = (body: unknown) =>
      app.request("/v1/sources/related", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const okRes = await post({ olay: OLAY, sources: ["yargitay"], rerank: true, rerankDocuments: 2 });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as RelatedSearchResult;
    expect(body.ranking).toBe("colleX-heuristic");
    expect(body.results.every((r) => r.relevance !== undefined)).toBe(true);
    expect((await post({ olay: OLAY, rerankDocuments: 0 })).status).toBe(400);
    expect((await post({ olay: OLAY, rerankDocuments: MAX_RERANK_DOCUMENTS + 1 })).status).toBe(400);
    expect((await post({ olay: OLAY, rerankDocuments: 2.5 })).status).toBe(400);
  });
});

/**
 * W16 Şerit B — "Olayı anlat → ilgili kararlar" regression suite.
 *
 * The government endpoints are NOT reachable from this machine, so every test
 * here drives an INJECTED fake gateway with real payload shapes. What is
 * proven offline:
 *
 *   - the event text really goes through `analyzeIntake`, so several DIFFERENT
 *     queries come out of one paragraph and every one of them is reported;
 *   - MUTABAKAT counts DISTINCT queries, and the ordering it drives is TOTAL
 *     and DETERMINISTIC — the same input produces the same order twice;
 *   - the fixed disclaimer travels with the response, character for character;
 *   - a budget that refuses a query SAYS SO — the query is still listed, it is
 *     listed again in `skippedQueries[]`, and a note counts them;
 *   - a künye field the source did not publish is ABSENT, never invented;
 *   - a failing source is NAMED and an all-failed run is a typed 502.
 *
 * Live verification against the real upstreams is PENDING, exactly as it is
 * for `/v1/sources/search` (W14-L-SOURCES.md).
 */

import { describe, expect, it } from "vitest";

import { FakeGateway, type ToolCallRequest } from "../../src/gateway/gateway.js";
import type { Outcome } from "../../src/capabilities/types.js";
import { SOURCE_CATALOG } from "../../src/sources/catalog.js";
import {
  buildRelatedQueries,
  compareRelatedRows,
  DEFAULT_MERCI_WEIGHT,
  isQuotableTerm,
  MAX_RELATED_QUERIES,
  MERCI_WEIGHT,
  merciWeight,
  relatedSearch,
  RELATED_RANKING_DISCLAIMER,
  sortableDate,
  type OrderableRow,
  type RelatedSearchResult,
} from "../../src/sources/relatedSearch.js";
import { createSourcesRouter } from "../../src/sources/routes.js";

const T0 = "2026-09-04T09:00:00.000Z";

/**
 * A real litigator's paragraph. It fires TWO concept rows of the shared table
 * ("tahliye taahhüdü" and "kira"), which is the whole point: one event, several
 * searches.
 */
const OLAY =
  "Müvekkilim kiracı olarak oturduğu dairede kira sözleşmesi imzalandıktan sonra" +
  " ev sahibine tahliye taahhüdü verdi. Ev sahibi şimdi bu taahhüde dayanarak" +
  " icra takibi başlattı; biz taahhüdün geçersiz olduğunu ileri sürüyoruz.";

function ok(data: unknown): Outcome<unknown> {
  return { status: "ok", data, provider: "BEDESTEN", observedAt: T0, warnings: [] };
}

function err(kind: string): Outcome<unknown> {
  return {
    status: "error",
    provider: "BEDESTEN",
    observedAt: T0,
    error: {
      kind: kind as never,
      retryable: true,
      correlationId: "corr-1",
      safeMessage: `upstream failure (${kind})`,
    },
  };
}

interface FakeDecision {
  id: string;
  esas?: string;
  karar?: string;
  tarih?: string;
  daire?: string;
}

/** A Bedesten `search_bedesten_unified` payload, with only the fields given. */
function bedestenPayload(decisions: readonly FakeDecision[], total?: number): unknown {
  return {
    decisions: decisions.map((d) => ({
      documentId: d.id,
      itemType: { name: "YARGITAYKARARI" },
      ...(d.daire !== undefined ? { birimAdi: d.daire } : {}),
      ...(d.esas !== undefined ? { esasNo: d.esas } : {}),
      ...(d.karar !== undefined ? { kararNo: d.karar } : {}),
      ...(d.tarih !== undefined ? { kararTarihi: d.tarih } : {}),
    })),
    ...(total !== undefined ? { total_records: total } : {}),
  };
}

/** Deterministic id source; the ordering must not depend on it. */
function counterIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

/** Monotonic clock that advances a fixed step per read. */
function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs);
}

// ---------------------------------------------------------------------------
// 1. One event -> several DIFFERENT queries, all of them reported
// ---------------------------------------------------------------------------

describe("Şerit B — olaydan sorgu üretimi", () => {
  it("bir olay paragrafından birden çok FARKLI sorgu üretir", () => {
    const built = buildRelatedQueries(OLAY, MAX_RELATED_QUERIES);
    expect(built.fallback).toBe(false);
    expect(built.queries.length).toBeGreaterThanOrEqual(4);
    // Every generated query text is distinct.
    const texts = built.queries.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
    // The concept engine really ran: the specific institution is there.
    expect(texts).toContain("tahliye taahhüdü");
    expect(built.kavramlar).toContain("tahliye taahhüdü");
  });

  it("üç sorgu kotasını TEK meseleye harcamaz — meseleler arasında dolaşır", () => {
    const built = buildRelatedQueries(OLAY, 3);
    expect(built.queries).toHaveLength(3);
    // With two issues extracted, a round-robin must touch both before it
    // spends a second query on the first one.
    expect(new Set(built.queries.map((q) => q.issueId)).size).toBeGreaterThan(1);
  });

  it("kavram yakalanmazsa tek sorgu üretir, KAVRAM diye yutturmaz", () => {
    const built = buildRelatedQueries("qwe rty uio pas dfg hjk", MAX_RELATED_QUERIES);
    expect(built.fallback).toBe(true);
    expect(built.kavramlar).toEqual([]);
    // A whole sentence is never quoted: an exact-phrase search for a sentence
    // finds nothing and reads as "there is no case law".
    expect(built.queries.every((q) => q.exactPhrase === false)).toBe(true);
  });

  it("yalnız GERÇEK bir terim tırnak içine alınır", () => {
    expect(isQuotableTerm("tahliye taahhüdü")).toBe(true);
    expect(isQuotableTerm("kira")).toBe(false);
    expect(isQuotableTerm("bir iki üç dört beş altı")).toBe(false);
  });

  it("maxQueries tavanı yalnız AŞAĞI çeker", () => {
    const built = buildRelatedQueries(OLAY, MAX_RELATED_QUERIES + 50);
    expect(built.queries.length).toBeLessThanOrEqual(MAX_RELATED_QUERIES);
  });
});

// ---------------------------------------------------------------------------
// 2. Mutabakat is a count of agreeing searches
// ---------------------------------------------------------------------------

describe("Şerit B — mutabakat sayısı", () => {
  it("aynı kararı bulan FARKLI sorgu sayısını sayar ve hangileri olduğunu yazar", async () => {
    // "doc-ortak" comes back for every query; "doc-tek" only for the first.
    let call = 0;
    const gateway = new FakeGateway(() => {
      call += 1;
      return ok(
        bedestenPayload(
          call === 1
            ? [
                { id: "doc-ortak", tarih: "2024-05-11T00:00:00.000Z" },
                { id: "doc-tek", tarih: "2024-06-11T00:00:00.000Z" },
              ]
            : [{ id: "doc-ortak", tarih: "2024-05-11T00:00:00.000Z" }],
        ),
      );
    });

    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 4 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );

    const ortak = result.results.find((r) => r.externalId === "doc-ortak");
    const tek = result.results.find((r) => r.externalId === "doc-tek");
    expect(ortak?.mutabakat).toBe(4);
    expect(ortak?.bulanSorgular).toEqual(["s1", "s2", "s3", "s4"]);
    expect(tek?.mutabakat).toBe(1);
    expect(tek?.bulanSorgular).toEqual(["s1"]);
    // Consensus leads; it is the FIRST ordering key.
    expect(result.results[0]?.externalId).toBe("doc-ortak");
  });

  it("aynı sorgu içinde tekrarlanan satır mutabakatı ŞİŞİRMEZ", async () => {
    const gateway = new FakeGateway(() =>
      ok(
        bedestenPayload([
          { id: "doc-a", tarih: "2024-05-11T00:00:00.000Z" },
          { id: "doc-a", tarih: "2024-05-11T00:00:00.000Z" },
          { id: "doc-a", tarih: "2024-05-11T00:00:00.000Z" },
        ]),
      ),
    );
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.mutabakat).toBe(1);
    // The best position the source itself gave it is kept.
    expect(result.results[0]?.kaynakSirasi).toBe(1);
  });

  it("kaynağın kendi sırasını taşır ve onu yeniden puanlamaz", async () => {
    const gateway = new FakeGateway(() =>
      ok(
        bedestenPayload([
          { id: "doc-1", tarih: "2020-01-01T00:00:00.000Z" },
          { id: "doc-2", tarih: "2024-01-01T00:00:00.000Z" },
          { id: "doc-3", tarih: "2022-01-01T00:00:00.000Z" },
        ]),
      ),
    );
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    const ranks = new Map(result.results.map((r) => [r.externalId, r.kaynakSirasi]));
    expect(ranks.get("doc-1")).toBe(1);
    expect(ranks.get("doc-2")).toBe(2);
    expect(ranks.get("doc-3")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. The ordering is total and deterministic
// ---------------------------------------------------------------------------

describe("Şerit B — sıralama", () => {
  const row = (over: Partial<OrderableRow>): OrderableRow => ({
    kararId: "yargitay::x",
    sourceId: "yargitay",
    merci: "Yargıtay",
    provider: "BEDESTEN",
    externalId: "x",
    title: "x",
    bulanSorgular: ["s1"],
    mutabakat: 1,
    bulanKonular: ["i1"],
    konuMutabakati: 1,
    kaynakSirasi: 1,
    merciAgirligi: 0,
    siralamaTarihi: "2024-01-01",
    ...over,
  });

  it("önce mutabakat, sonra merci, sonra tarih, sonra kimlik", () => {
    const a = row({ kararId: "a", mutabakat: 2 });
    const b = row({ kararId: "b", mutabakat: 1 });
    expect(compareRelatedRows(a, b)).toBeLessThan(0);

    const yuksek = row({ kararId: "c", merciAgirligi: 0 });
    const yerel = row({ kararId: "d", merciAgirligi: 3 });
    expect(compareRelatedRows(yuksek, yerel)).toBeLessThan(0);

    const yeni = row({ kararId: "e", siralamaTarihi: "2025-01-01" });
    const eski = row({ kararId: "f", siralamaTarihi: "2019-01-01" });
    expect(compareRelatedRows(yeni, eski)).toBeLessThan(0);

    const ilk = row({ kararId: "aaa" });
    const son = row({ kararId: "zzz" });
    expect(compareRelatedRows(ilk, son)).toBeLessThan(0);
  });

  it("tarihi bilinmeyen karar EN SONA gider, uydurma tarihle öne çekilmez", () => {
    const bilinen = row({ kararId: "a", siralamaTarihi: "1990-01-01" });
    const bilinmeyen = row({ kararId: "b", siralamaTarihi: "" });
    expect(compareRelatedRows(bilinen, bilinmeyen)).toBeLessThan(0);
    expect(compareRelatedRows(bilinmeyen, bilinen)).toBeGreaterThan(0);
  });

  it("kaynağın verdiği her tarih biçimini sıralanabilir güne çevirir", () => {
    expect(sortableDate("2024-05-11T00:00:00.000Z")).toBe("2024-05-11");
    expect(sortableDate("11.05.2024")).toBe("2024-05-11");
    expect(sortableDate("1.5.2024")).toBe("2024-05-01");
    expect(sortableDate("mayıs 2024")).toBe("");
    expect(sortableDate(undefined)).toBe("");
  });

  it("AYNI girdi AYNI sırayı verir — rastgele kimlikler sırayı değiştirmez", async () => {
    const payload = ok(
      bedestenPayload([
        { id: "d-1", tarih: "2024-05-11T00:00:00.000Z" },
        { id: "d-2", tarih: "2025-01-02T00:00:00.000Z" },
        { id: "d-3" },
        { id: "d-4", tarih: "2023-03-03T00:00:00.000Z" },
      ]),
    );
    const run = async (): Promise<RelatedSearchResult> =>
      relatedSearch(
        { olay: OLAY, sources: ["yargitay", "istinaf_hukuk"], maxQueries: 3 },
        {
          gateway: new FakeGateway(() => payload),
          now: () => T0,
          monotonic: fakeClock(7),
          // Deliberately RANDOM ids: the order may not depend on them.
          newId: () => Math.random().toString(36).slice(2),
        },
      );
    const first = await run();
    const second = await run();
    expect(first.results.map((r) => r.kararId)).toEqual(
      second.results.map((r) => r.kararId),
    );
    // And the rule really bites: Yargıtay outranks BAM at equal consensus.
    expect(first.results[0]?.sourceId).toBe("yargitay");
  });

  it("merci ağırlık tablosu her içtihat kaynağını KAPSAR", () => {
    const missing = SOURCE_CATALOG.filter(
      (s) => s.family === "ictihat" && MERCI_WEIGHT[s.id] === undefined,
    ).map((s) => s.id);
    expect(missing).toEqual([]);
    expect(merciWeight("yargitay")).toBe(0);
    expect(merciWeight("istinaf_hukuk")).toBe(1);
    expect(merciWeight("yerel_hukuk")).toBe(3);
    expect(merciWeight("bilinmeyen_kaynak")).toBe(DEFAULT_MERCI_WEIGHT);
  });
});

// ---------------------------------------------------------------------------
// 4. The sentence that may never drift
// ---------------------------------------------------------------------------

describe("Şerit B — dürüstlük cümlesi", () => {
  it("sabit cümle harfi harfine budur", () => {
    expect(RELATED_RANKING_DISCLAIMER).toBe(
      "Bu sıra, kararları kaç ayrı aramanın birden bulduğuna göre dizer." +
        " Bu bir İLGİLİLİK PUANI DEĞİLDİR; hangi kararın sizin olayınıza uyduğunu" +
        " yalnız siz belirlersiniz.",
    );
  });

  it("her cevapta hem alan olarak hem de ilk not olarak döner", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    expect(result.siralamaNotu).toBe(RELATED_RANKING_DISCLAIMER);
    expect(result.notes[0]).toEqual({
      kind: "SIRALAMA_ACIKLAMASI",
      message: RELATED_RANKING_DISCLAIMER,
    });
  });

  it("mutabakat bir puan/yüzde olarak sunulmaz", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 2 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/ilgililik puanı(?! DEĞİLDİR)/iu);
    expect(blob).not.toMatch(/%\s?\d/u);
    expect(blob).not.toMatch(/skor|isabet oranı|doğruluk oranı/iu);
  });
});

// ---------------------------------------------------------------------------
// 5. Budget: a query that did not run SAYS SO
// ---------------------------------------------------------------------------

describe("Şerit B — bütçe", () => {
  it("işlem bütçesi dolunca kalan sorguları SESSİZCE kırpmaz", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay", "danistay"], maxQueries: 4 },
      {
        gateway,
        now: () => T0,
        monotonic: fakeClock(5),
        newId: counterIds(),
        // Two sources per query: room for exactly two queries.
        maxUpstreamCalls: 4,
      },
    );
    expect(result.queries).toHaveLength(4);
    expect(result.queries.filter((q) => q.calisti)).toHaveLength(2);
    expect(result.skippedQueries).toHaveLength(2);
    for (const skipped of result.skippedQueries) {
      expect(skipped.reason).toBe("CALL_BUDGET_EXCEEDED");
      expect(skipped.message).toContain("YAPILMADI");
    }
    // The skipped queries are still shown, with null instead of a fake 0.
    const notRun = result.queries.filter((q) => !q.calisti);
    expect(notRun.every((q) => q.bulunanSatir === null && q.totalRecords === null)).toBe(
      true,
    );
    expect(result.partial).toBe(true);
    const note = result.notes.find((n) => n.kind === "BUTCE_ASILDI");
    expect(note?.message).toContain("2 arama bütçe nedeniyle YAPILMADI");
  });

  it("süre bütçesi dolunca da aynısını yapar ve nedeni TİPLİDİR", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 4 },
      {
        gateway,
        now: () => T0,
        // Each read jumps 1 s, so the wall budget is spent almost at once.
        monotonic: fakeClock(1000),
        newId: counterIds(),
        timeBudgetMs: 1500,
      },
    );
    expect(result.queries.filter((q) => q.calisti).length).toBeGreaterThanOrEqual(1);
    expect(result.skippedQueries.length).toBeGreaterThanOrEqual(1);
    expect(
      result.skippedQueries.every((s) => s.reason === "TIME_BUDGET_EXCEEDED"),
    ).toBe(true);
  });

  it("bütçe sıfır bile olsa İLK sorgu her zaman koşar", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 3 },
      {
        gateway,
        now: () => T0,
        monotonic: fakeClock(5),
        newId: counterIds(),
        maxUpstreamCalls: 0,
      },
    );
    expect(result.queries.filter((q) => q.calisti)).toHaveLength(1);
    expect(result.results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Künye discipline and source failures
// ---------------------------------------------------------------------------

describe("Şerit B — künye ve kaynak hataları", () => {
  it("kaynağın vermediği künye alanını UYDURMAZ; alan hiç yoktur", async () => {
    const gateway = new FakeGateway(() =>
      // No esasNo, no kararNo, no kararTarihi, no birimAdi.
      ok(bedestenPayload([{ id: "cıplak-1" }])),
    );
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    const row = result.results[0];
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("esasNo");
    expect(row).not.toHaveProperty("kararNo");
    expect(row).not.toHaveProperty("kararTarihi");
    // The source published no chamber line either — only the court family,
    // which is what came back and is NOT invented here.
    expect(row?.mahkeme).toBe("Yargıtay");
    // And nothing was filled with a plausible blank either.
    expect(JSON.stringify(row)).not.toContain('""');
  });

  it("bir satır KANIT değildir: parmak izi ve metindeki yer taşımaz", async () => {
    const gateway = new FakeGateway(() =>
      ok(bedestenPayload([{ id: "d-1", tarih: "2024-05-11T00:00:00.000Z" }])),
    );
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    const row = result.results[0];
    expect(row).not.toHaveProperty("contentSha256");
    expect(row).not.toHaveProperty("startChar");
    expect(row).not.toHaveProperty("quoteSha256");
    // "Tam metni getir" is reachable from the row, and that is the only
    // thing that produces evidence.
    expect(row?.fetchKind).toBe("karar");
    expect(row?.externalId).toBe("d-1");
  });

  it("başarısız kaynağı ADIYLA bildirir, listeyi sessizce boşaltmaz", async () => {
    const gateway = new FakeGateway((request: ToolCallRequest) => {
      const courtTypes = (request.args as { court_types?: string[] }).court_types ?? [];
      return courtTypes[0] === "DANISTAYKARAR"
        ? err("RATE_LIMITED")
        : ok(bedestenPayload([{ id: "d-1" }]));
    });
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay", "danistay"], maxQueries: 2 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    expect(result.okSources).toEqual(["yargitay"]);
    expect(result.failedSources).toHaveLength(1);
    expect(result.failedSources[0]?.sourceLabel).toBe("Danıştay");
    expect(result.failedSources[0]?.message).toContain("Bu kaynağın sonuçları listede YOK.");
    expect(result.partial).toBe(true);
    expect(result.notes.some((n) => n.kind === "KAYNAK_HATASI")).toBe(true);
  });

  it("kayıt sayısı toplanmaz — örtüşen aramaların EN BÜYÜĞÜ alınır", async () => {
    let call = 0;
    const gateway = new FakeGateway(() => {
      call += 1;
      return ok(bedestenPayload([{ id: "d-1" }], call === 1 ? 758 : 116_090));
    });
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 2 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    expect(result.totalRecords).toBe(116_090);
    expect(result.notes.some((n) => n.message.includes("toplanmaz"))).toBe(true);
  });

  it("hiçbir kaynak sayı bildirmezse totalRecords NULL olur, 0 olmaz", async () => {
    const gateway = new FakeGateway(() => ok(bedestenPayload([{ id: "d-1" }])));
    const result = await relatedSearch(
      { olay: OLAY, sources: ["yargitay"], maxQueries: 1 },
      { gateway, now: () => T0, monotonic: fakeClock(5), newId: counterIds() },
    );
    expect(result.totalRecords).toBeNull();
    expect(
      result.notes.some((n) => n.kind === "KAYIT_SAYISI" && n.message.includes("sıfır değil")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. The HTTP route
// ---------------------------------------------------------------------------

async function post(app: ReturnType<typeof createSourcesRouter>, body: unknown) {
  return app.request("/v1/sources/related", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Şerit B — POST /v1/sources/related", () => {
  it("uses the injected embedding resolution at the HTTP boundary", async () => {
    const app = createSourcesRouter({
      gateway: new FakeGateway(() => ok(bedestenPayload([]))),
      embedding: { enabled: false, reason: "EMBEDDING_BASE_URL_INVALID", message: "Injected configuration" },
    });
    const res = await post(app, { olay: OLAY, sources: ["yargitay"], rerank: true });
    expect(res.status).toBe(200);
    expect((await res.json() as RelatedSearchResult).semantikSiralama).toMatchObject({
      uygulandi: false, neden: "EMBEDDING_BASE_URL_INVALID", mesaj: "Injected configuration",
    });
  });
  it("olayı alır, ürettiği TÜM sorguları ve sıralı listeyi döner", async () => {
    const app = createSourcesRouter({
      gateway: new FakeGateway(() =>
        ok(bedestenPayload([{ id: "d-1", tarih: "2024-05-11T00:00:00.000Z" }])),
      ),
      now: () => T0,
      monotonic: fakeClock(5),
      newId: counterIds(),
    });
    const res = await post(app, { olay: OLAY, sources: ["yargitay"], maxQueries: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RelatedSearchResult;
    expect(body.queries).toHaveLength(3);
    expect(body.queries.every((q) => q.text.length >= 2 && q.aciklama.length > 0)).toBe(
      true,
    );
    expect(body.results[0]?.mutabakat).toBe(3);
    expect(body.siralamaNotu).toBe(RELATED_RANKING_DISCLAIMER);
  });

  it("geçit yoksa TİPLİ 502 döner", async () => {
    const app = createSourcesRouter({});
    const res = await post(app, { olay: OLAY });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("fazladan alanı ADIYLA reddeder", async () => {
    const app = createSourcesRouter({ gateway: new FakeGateway(() => ok({})) });
    const res = await post(app, { olay: OLAY, bogusAlan: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { kind: string; issues: Array<{ path: string }> };
    };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.issues.map((i) => i.path)).toContain("bogusAlan");
    expect(body.error.issues.every((i) => i.path !== "")).toBe(true);
  });

  it("ters yıl aralığını alan adıyla reddeder", async () => {
    const app = createSourcesRouter({ gateway: new FakeGateway(() => ok({})) });
    const res = await post(app, {
      olay: OLAY,
      filters: { yearFrom: 2025, yearTo: 2020 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: Array<{ path: string }> } };
    expect(body.error.issues[0]?.path).toBe("filters.yearFrom");
  });

  it("süzgeçler her üretilen sorguya AYNEN iletilir", async () => {
    const calls: ToolCallRequest[] = [];
    const gateway = new FakeGateway((request) => {
      calls.push(request);
      return ok(bedestenPayload([{ id: "d-1" }]));
    });
    const app = createSourcesRouter({
      gateway,
      now: () => T0,
      monotonic: fakeClock(5),
      newId: counterIds(),
    });
    const res = await post(app, {
      olay: OLAY,
      sources: ["yargitay"],
      maxQueries: 2,
      filters: { chamber: "H3", yearFrom: 2023, yearTo: 2025 },
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const args = call.args as Record<string, unknown>;
      expect(args["birimAdi"]).toBe("H3");
      expect(args["kararTarihiStart"]).toBe("2023-01-01");
      expect(args["kararTarihiEnd"]).toBe("2025-12-31");
    }
    // Two different phrases really went out.
    const phrases = calls.map((c) => (c.args as { phrase?: string }).phrase);
    expect(new Set(phrases).size).toBe(2);
  });

  it("her kaynak her aramada düşerse BOŞ LİSTE değil, tipli 502 döner", async () => {
    const app = createSourcesRouter({
      gateway: new FakeGateway(() => err("UNAVAILABLE")),
      now: () => T0,
      monotonic: fakeClock(5),
      newId: counterIds(),
    });
    const res = await post(app, { olay: OLAY, sources: ["yargitay"], maxQueries: 2 });
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: { kind: string; failedSources: Array<{ sourceLabel: string }> };
      queries: unknown[];
    };
    expect(body.error.kind).toBe("ALL_SOURCES_FAILED");
    expect(body.error.failedSources[0]?.sourceLabel).toBe("Yargıtay");
    // Even a failed run tells the lawyer what was searched on their behalf.
    expect(body.queries).toHaveLength(2);
  });

  it("çok kısa olayı alan adıyla reddeder", async () => {
    const app = createSourcesRouter({ gateway: new FakeGateway(() => ok({})) });
    const res = await post(app, { olay: "kısa" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: Array<{ path: string }> } };
    expect(body.error.issues[0]?.path).toBe("olay");
  });
});

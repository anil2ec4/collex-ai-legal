/**
 * "Atıf yaptığım mevzuat değişti mi?" — the legislation-change watch.
 *
 * Everything here runs against a FakeGateway that answers exactly the way the
 * two real tools answer (mevzuat_mcp_server.py):
 *   search_mevzuat       → a text body, one row per law:
 *                          "- [6098] TÜRK BORÇLAR KANUNU (Kanunlar) | mevzuatId: … | RG: YYYY-MM-DD"
 *   get_mevzuat_content  → "Mevzuat <id> | page c/t | page_size s\n\n<slice>", the
 *                          slice cut by `_paginate_text` (code points, page CLAMPED)
 * both wrapped by FastMCP as {"result": "<text>"}; a failure is a typed error
 * Outcome (the tools RAISE since W22). No network.
 */

import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/capabilities/types.js";
import { createApp } from "../../src/api/server.js";
import { FakeGateway, type ToolCallRequest } from "../../src/gateway/gateway.js";
import {
  DEFAULT_WATCH_MAX_CALLS,
  WATCH_NOTICES,
  runLegislationWatch,
  type LawBaseline,
  type WatchRunOptions,
} from "../../src/legislationWatch/check.js";
import { collectMatterCitations, type CollectedCitations } from "../../src/legislationWatch/collect.js";
import { createLegislationWatchRouter } from "../../src/legislationWatch/routes.js";
import { InMemoryLegislationWatchStore, normalizeWatchDocument } from "../../src/legislationWatch/store.js";
import {
  canonicalWatchText,
  isoToTr,
  isolateArticles,
  latestAmendmentNoteDate,
  watchFingerprint,
} from "../../src/legislationWatch/textSignals.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { MatterItem } from "../../src/matters/types.js";

const T0 = "2026-10-01T09:00:00.000Z";
const T1 = "2026-11-15T09:00:00.000Z";

// ---------------------------------------------------------------------------
// A fake official archive
// ---------------------------------------------------------------------------

interface ArchiveLaw {
  no: string;
  tur: string;
  typeLabel: string;
  mevzuatId: string;
  title: string;
  rg: string;
  text: string;
}

const TBK_V1 = [
  "TÜRK BORÇLAR KANUNU",
  "Kanun Numarası : 6098",
  "MADDE 474- (1) Yüklenici, eseri teslim ettikten sonra iş sahibi, işlerin olağan akışına göre imkân bulur bulmaz eseri gözden geçirmek zorundadır.",
  "MADDE 475- (Değişik: 12/3/2020-7200/5 md.) (1) Eserin ayıplı olması hâlinde iş sahibi seçimlik haklara sahiptir.",
  "GEÇİCİ MADDE 1- (1) Bu Kanunun yürürlüğe girmesinden önceki fiillere eski hükümler uygulanır.",
].join("\n");

/** Article 475 amended again (new note), 474 untouched. */
const TBK_V2_NOTE = TBK_V1.replace(
  "MADDE 475- (Değişik: 12/3/2020-7200/5 md.) (1) Eserin ayıplı olması hâlinde iş sahibi seçimlik haklara sahiptir.",
  "MADDE 475- (Değişik: 5/3/2027-7400/2 md.) (1) Eserin ayıplı olması hâlinde iş sahibi, sözleşmeden dönme dahil seçimlik haklara sahiptir.",
);

/** Article 474's wording changed, no dated note written. */
const TBK_V3_SILENT = TBK_V1.replace("gözden geçirmek zorundadır", "gözden geçirmek ve ayıpları bildirmek zorundadır");

const HMK_V1 = [
  "HUKUK MUHAKEMELERİ KANUNU",
  "MADDE 119- (1) Dava dilekçesinde aşağıdaki hususlar bulunur.",
  "MADDE 129- (1) Cevap dilekçesinde aşağıdaki hususlar bulunur.",
].join("\n");

function tbk(text = TBK_V1): ArchiveLaw {
  return { no: "6098", tur: "KANUN", typeLabel: "Kanunlar", mevzuatId: "10098", title: "TÜRK BORÇLAR KANUNU", rg: "2011-02-04", text };
}
function hmk(text = HMK_V1): ArchiveLaw {
  return { no: "6100", tur: "KANUN", typeLabel: "Kanunlar", mevzuatId: "10100", title: "HUKUK MUHAKEMELERİ KANUNU", rg: "2011-02-04", text };
}

function ok(result: string): Outcome<unknown> {
  // FastMCP wraps a string tool result as {"result": …} (payloads.unwrapFastMcpResult).
  return { status: "ok", data: { result }, provider: "MEVZUAT", observedAt: T0, warnings: [] };
}

function fail(kind: "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" = "UNAVAILABLE"): Outcome<unknown> {
  return {
    status: "error",
    provider: "MEVZUAT",
    observedAt: T0,
    error: { kind, retryable: true, correlationId: "c-1", safeMessage: "tool reported an execution error (marker)" },
  };
}

/** `_paginate_text` in code points, with the page CLAMPED like Python. */
function page(text: string, pageNumber: number, pageSize: number): { chunk: string; current: number; total: number } {
  const points = Array.from(text);
  const total = Math.max(1, Math.ceil(points.length / pageSize));
  const current = Math.min(Math.max(1, pageNumber), total);
  return { chunk: points.slice((current - 1) * pageSize, current * pageSize).join(""), current, total };
}

interface ArchiveOptions {
  /** Force a small page so multi-page assembly is exercised. */
  pageSize?: number;
  /** Per-call override: return an Outcome to replace the normal answer. */
  override?: (req: ToolCallRequest, n: number) => Outcome<unknown> | undefined;
}

function archive(laws: ArchiveLaw[], options: ArchiveOptions = {}): FakeGateway {
  let n = 0;
  return new FakeGateway((req) => {
    n += 1;
    const forced = options.override?.(req, n);
    if (forced !== undefined) return forced;
    if (req.toolName === "search_mevzuat") {
      const no = String(req.args["mevzuat_no"] ?? "");
      const tur = String(req.args["mevzuat_tur"] ?? "");
      const rows = laws.filter((law) => law.no === no && (tur === "" || law.tur === tur));
      if (rows.length === 0) return ok(`No results found for browse (type: ${tur})`);
      const lines = rows.map(
        (law) => `- [${law.no}] ${law.title} (${law.typeLabel}) | mevzuatId: ${law.mevzuatId} | RG: ${law.rg}`,
      );
      return ok(["Browse | Type: " + tur, `Results: ${rows.length} total (page 1)`, "", ...lines].join("\n"));
    }
    if (req.toolName === "get_mevzuat_content") {
      const id = String(req.args["mevzuat_id"]);
      const law = laws.find((l) => l.mevzuatId === id);
      if (law === undefined) return fail("UNAVAILABLE");
      const size = options.pageSize ?? Number(req.args["page_size"] ?? 12000);
      const p = page(law.text, Number(req.args["page_number"] ?? 1), size);
      return ok(`Mevzuat ${id} | page ${p.current}/${p.total} | page_size ${size}\n\n${p.chunk}`);
    }
    return fail("UNAVAILABLE");
  });
}

// ---------------------------------------------------------------------------
// Matter material
// ---------------------------------------------------------------------------

function draftItem(refId: string, title = "Cevap dilekçesi"): MatterItem {
  return { itemId: `it-${refId}`, matterId: "m", kind: "draft", refId, payload: { title }, createdAt: T0, updatedAt: T0 };
}
function answerItem(refId: string): MatterItem {
  return { itemId: `it-${refId}`, matterId: "m", kind: "answer", refId, payload: { question: "ayıp ihbarı" }, createdAt: T0, updatedAt: T0 };
}
function fileItem(refId: string, fileName = "karsi-dilekce.pdf"): MatterItem {
  return { itemId: `it-${refId}`, matterId: "m", kind: "file", refId, payload: { fileName }, createdAt: T0, updatedAt: T0 };
}

const DRAFT = {
  draftId: "d-1",
  title: "Cevap dilekçesi",
  sections: [
    {
      id: "hukuki",
      title: "HUKUKÎ SEBEPLER",
      paragraphs: [
        { id: "p1", text: "TBK m. 474 ve 475. maddeleri uyarınca ayıp ihbarı süresinde yapılmamıştır." },
        { id: "p2", text: "Yargıtay 15. HD E. 2019/1234 K. 2020/567 sayılı kararı da bu yöndedir." },
      ],
    },
  ],
  evidence: [
    { evidenceId: "e1", source: "MEVZUAT", label: "6100 sayılı Hukuk Muhakemeleri Kanunu m. 119", title: "HMK", legislationNo: "6100", article: "119" },
    { evidenceId: "e2", source: "UPLOAD", label: "Ek-1", title: "sözleşme", legislationNo: "6098", article: "1" },
  ],
};

const ANSWER = {
  runId: "r-1",
  question: "HMK m. 129 uyarınca cevap süresi nedir?",
  result: {
    question: "HMK m. 129 uyarınca cevap süresi nedir?",
    claims: [{ claimId: "c1", text: "…", evidenceIds: ["a1"], verdict: "SUPPORTED" }],
    evidence: [
      { evidenceId: "a1", source: "MEVZUAT", title: "Hukuk Muhakemeleri Kanunu", legislationNo: "6100", article: "129" },
      // Not relied on by any claim: context only, never collected.
      { evidenceId: "a2", source: "MEVZUAT", title: "Türk Ticaret Kanunu", legislationNo: "6102", article: "23" },
    ],
  },
};

const FILE_DETAIL = {
  fileId: "f".repeat(16),
  name: "karsi-dilekce.pdf",
  analysis: {
    references: [
      { raw: "TBK m. 474", legislationNo: "6098", articleNo: "474", count: 2 },
      { raw: "Yargıtay 3. HD E. 2023/4521", court: "YARGITAY", docketNo: "2023/4521", legislationNo: "6098" },
      { raw: "375 sayılı KHK m. 5", legislationNo: "375", articleNo: "5", count: 1 },
    ],
  },
};

function ports(overrides: { draft?: unknown; answer?: unknown; file?: unknown } = {}) {
  return {
    drafts: { get: (id: string) => (id === "d-1" ? (overrides.draft ?? DRAFT) : undefined) },
    answers: { get: (id: string) => (id === "r-1" ? (overrides.answer ?? ANSWER) : undefined) },
    files: {
      showFile: async (id: string) => (id === "f".repeat(16) ? (overrides.file ?? FILE_DETAIL) : undefined),
    },
  };
}

/** A matter whose only citations are TBK m. 474 / 475 (the draft). */
async function tbkOnly(): Promise<CollectedCitations> {
  return collectMatterCitations([draftItem("d-1")], {
    drafts: {
      get: () => ({
        title: "Dilekçe",
        evidence: [],
        sections: [{ paragraphs: [{ text: "TBK m. 474 ve 475. maddeleri uyarınca ayıp ihbarı yapılmıştır." }] }],
      }),
    },
  });
}

async function tbkAndHmk(): Promise<CollectedCitations> {
  return collectMatterCitations([draftItem("d-1")], {
    drafts: {
      get: () => ({
        title: "Dilekçe",
        evidence: [],
        sections: [{ paragraphs: [{ text: "TBK m. 474 uyarınca; HMK m. 119 gereğince dava dilekçesi eksiksizdir." }] }],
      }),
    },
  });
}

function run(
  collected: CollectedCitations,
  gateway: FakeGateway,
  extra: Partial<WatchRunOptions> = {},
): ReturnType<typeof runLegislationWatch> {
  return runLegislationWatch({
    matterId: "11111111-1111-4111-8111-111111111111",
    collected,
    baselines: {},
    gateway,
    now: () => new Date(T0),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Text signals
// ---------------------------------------------------------------------------

describe("text signals: fingerprint, article isolation, amendment notes", () => {
  it("a fingerprint ignores whitespace, page cuts and invisible characters, and sees one letter", () => {
    const a = "MADDE 1- (1) Bu Kanunun\namacı   düzenlemektir.";
    const b = "MADDE 1- (1) Bu Ka\u00ADnunun amacı düzenlemektir.  ";
    expect(canonicalWatchText(b)).toBe("MADDE 1- (1) Bu Kanunun amacı düzenlemektir.");
    expect(watchFingerprint(a)).toBe(watchFingerprint(b));
    expect(watchFingerprint(a)).not.toBe(watchFingerprint(a.replace("amacı", "amaci")));
  });

  it("isolates each article by its heading and refuses a heading it cannot place once", () => {
    const text = [
      "MADDE 474- birinci",
      "Madde 61. - eski usul başlık",
      "EK MADDE 2- ek",
      "GEÇİCİ MADDE 1- geçici",
      "MADDE 68/A- harfli",
      "Bu fıkra Madde 5 hükmüne atıf yapar.",
      "MADDE 9- ilk",
      "MÜKERRER MADDE 9- mükerrer ayrı türdür",
      "MADDE 9- tekrar",
    ].join("\n");
    const articles = isolateArticles(text);
    expect(articles.get("madde:474")?.text).toContain("birinci");
    expect(articles.get("madde:474")?.text).not.toContain("eski usul");
    expect(articles.get("madde:61")?.text).toContain("eski usul");
    expect(articles.get("ek:2")?.text).toContain("ek");
    expect(articles.get("gecici:1")?.text).toContain("geçici");
    expect(articles.get("madde:68/A")?.text).toContain("harfli");
    expect(articles.get("mukerrer:9")?.text).toContain("mükerrer");
    // "Madde 5 hükmüne" has no dash: a cross-reference, not a heading.
    expect(articles.has("madde:5")).toBe(false);
    // Twice → ambiguous → no text (the caller compares the whole law).
    expect(articles.get("madde:9")).toEqual({ key: "madde:9", occurrences: 2 });
  });

  it("reads the newest dated amendment note and says null when none is written", () => {
    const text =
      "MADDE 5- (Değişik: 26/6/2012-6352/99 md.) (1) … (Ek fıkra: 12/7/2013-6495/95 md.) (2) … " +
      "(İptal: Anayasa Mahkemesinin 22/7/2020 tarihli ve E.: 2019/40, K.: 2020/40 sayılı Kararı ile.) " +
      "(Değişik: 31/2/2021-7300/1 md.)";
    expect(latestAmendmentNoteDate(text)).toBe("2020-07-22");
    expect(latestAmendmentNoteDate("MADDE 1- (1) Hiç değişmemiş hüküm; 5/5/2025 tarihli bir sözleşme.")).toBeNull();
  });

  it("a check's date is the Istanbul calendar day, a note's date is printed as written", () => {
    // 22:30 UTC on 1 October is 01:30 on 2 October in Istanbul.
    expect(isoToTr("2026-10-01T22:30:00.000Z")).toBe("02.10.2026");
    expect(isoToTr("2026-10-01T09:00:00.000Z")).toBe("01.10.2026");
    expect(isoToTr("2027-03-05")).toBe("05.03.2027");
    expect(isoToTr(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

describe("collecting the statute citations of one matter", () => {
  it("reads drafts, answers and uploads, keys on (type, law, article) and names every source", async () => {
    const collected = await collectMatterCitations(
      [draftItem("d-1"), answerItem("r-1"), fileItem("f".repeat(16)), draftItem("d-missing", "Silinen taslak")],
      ports(),
    );
    const keys = collected.citations.map((c) => c.key);
    expect(keys).toEqual([
      "KHK:375|madde:5",
      "KANUN:6098|madde:474",
      "KANUN:6098|madde:475",
      "KANUN:6100|madde:119",
      "KANUN:6100|madde:129",
    ]);
    const tbk474 = collected.citations.find((c) => c.key === "KANUN:6098|madde:474");
    expect(tbk474?.label).toBe("6098 sayılı Türk Borçlar Kanunu m. 474");
    expect(tbk474?.sources.map((s) => [s.kind, s.title, s.count])).toEqual([
      ["draft", "Cevap dilekçesi", 1],
      ["file", "karsi-dilekce.pdf", 2],
    ]);
    // The upload exhibit's legislationNo is not a statute citation; the
    // answer's context-only evidence (6102) is not either; case law is skipped.
    expect(keys.some((k) => k.startsWith("KANUN:6102"))).toBe(false);
    expect(keys).not.toContain("KANUN:6098|madde:1");
    expect(collected.citations.find((c) => c.key === "KANUN:6100|madde:129")?.sources.map((s) => s.kind)).toEqual([
      "answer",
    ]);
    expect(collected.citations.find((c) => c.key === "KHK:375|madde:5")?.label).toBe(
      "375 sayılı Kanun Hükmünde Kararname m. 5",
    );
    // A record that could not be read is listed, never dropped.
    expect(collected.unreadSources).toEqual([
      expect.objectContaining({ kind: "draft", refId: "d-missing", title: "Silinen taslak" }),
    ]);
    expect(collected.sourcesRead).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

describe("a check: baseline, unchanged, changed", () => {
  it("the first check records a baseline and compares nothing", async () => {
    const gateway = archive([tbk()]);
    const { result, baselines, lastAsked } = await run(await tbkOnly(), gateway);
    expect(result.rows.map((r) => [r.key, r.state, r.granularity])).toEqual([
      ["KANUN:6098|madde:474", "TEMEL_KAYDEDILDI", "madde"],
      ["KANUN:6098|madde:475", "TEMEL_KAYDEDILDI", "madde"],
    ]);
    expect(result.complete).toBe(true);
    expect(result.stopReason).toBeNull();
    expect(result.rows[1]?.message).toContain("Metindeki en yeni değişiklik notu: 12.03.2020.");
    const base = baselines["KANUN:6098"] as LawBaseline;
    expect(base.mevzuatId).toBe("10098");
    expect(base.rgDate).toBe("2011-02-04");
    expect(base.fingerprint).toBe(watchFingerprint(TBK_V1));
    expect(Object.keys(base.articles).sort()).toEqual(["madde:474", "madde:475"]);
    expect(lastAsked["KANUN:6098"]).toBe(T0);
    // Sequential: the search, then the text; legislation page_size stays 1..20.
    expect(gateway.calls.map((c) => c.toolName)).toEqual(["search_mevzuat", "get_mevzuat_content"]);
    expect(gateway.calls[0]?.args).toEqual({ mevzuat_no: "6098", mevzuat_tur: "KANUN", page_size: 10 });
    expect(result.notices).toEqual([...WATCH_NOTICES]);
  });

  it("an identical text is DEĞİŞMEDİ, dated from the first check", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const second = await run(await tbkOnly(), archive([tbk()]), {
      baselines: first.baselines,
      now: () => new Date(T1),
    });
    expect(second.result.rows.map((r) => r.state)).toEqual(["DEGISMEDI", "DEGISMEDI"]);
    expect(second.result.rows[0]?.message).toBe("Değişmedi: madde metni, bu dosyadaki ilk kontrolden (01.10.2026) bu yana aynı.");
    expect(second.result.laws[0]?.state).toBe("DEGISMEDI");
    // The baseline stays the FIRST check's.
    expect(second.baselines["KANUN:6098"]?.recordedAt).toBe(T0);
  });

  it("a changed article with a new dated note is DEĞİŞMİŞ OLABİLİR with both dates; its neighbour stays DEĞİŞMEDİ", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const second = await run(await tbkOnly(), archive([tbk(TBK_V2_NOTE)]), {
      baselines: first.baselines,
      now: () => new Date(T1),
    });
    const [r474, r475] = second.result.rows;
    expect(r474?.state).toBe("DEGISMEDI");
    expect(r474?.granularity).toBe("madde");
    expect(r475?.state).toBe("DEGISMIS_OLABILIR");
    expect(r475?.message).toBe(
      "Değişmiş olabilir: son değişiklik notu tarihi 05.03.2027, sizin dosyanızdaki ilk kontrol 01.10.2026.",
    );
    expect(r475?.latestNoteDate).toBe("2027-03-05");
    expect(second.result.laws[0]?.state).toBe("DEGISMIS_OLABILIR");
    expect(second.result.counts).toMatchObject({ DEGISMEDI: 1, DEGISMIS_OLABILIR: 1 });
  });

  it("a changed text with no newer dated note says so instead of inventing a date", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const second = await run(await tbkOnly(), archive([tbk(TBK_V3_SILENT)]), { baselines: first.baselines });
    expect(second.result.rows[0]?.state).toBe("DEGISMIS_OLABILIR");
    expect(second.result.rows[0]?.message).toContain("metinde bundan yeni tarihli bir değişiklik notu okunamadı");
    expect(second.result.rows[0]?.message).not.toMatch(/son değişiklik notu tarihi/u);
  });

  it("a newly cited article of a watched law is recorded, the others are compared", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const withGecici = await collectMatterCitations([draftItem("d-1")], {
      drafts: {
        get: () => ({
          sections: [{ paragraphs: [{ text: "TBK m. 474 ve 475. maddeleri ile TBK geçici madde 1 uyarınca." }] }],
        }),
      },
    });
    const second = await run(withGecici, archive([tbk()]), { baselines: first.baselines, now: () => new Date(T1) });
    expect(second.result.rows.map((r) => [r.key, r.state])).toEqual([
      ["KANUN:6098|gecici:1", "TEMEL_KAYDEDILDI"],
      ["KANUN:6098|madde:474", "DEGISMEDI"],
      ["KANUN:6098|madde:475", "DEGISMEDI"],
    ]);
    expect(Object.keys(second.baselines["KANUN:6098"]?.articles ?? {}).sort()).toEqual([
      "gecici:1",
      "madde:474",
      "madde:475",
    ]);
  });

  it("rebaseline reports the change once and then compares against today's text", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const acknowledged = await run(await tbkOnly(), archive([tbk(TBK_V2_NOTE)]), {
      baselines: first.baselines,
      rebaseline: true,
      now: () => new Date(T1),
    });
    expect(acknowledged.result.rows[1]?.state).toBe("DEGISMIS_OLABILIR");
    expect(acknowledged.result.rows[1]?.message).toContain("Karşılaştırma noktası bu kontrolle yenilendi");
    const after = await run(await tbkOnly(), archive([tbk(TBK_V2_NOTE)]), { baselines: acknowledged.baselines });
    expect(after.result.rows.map((r) => r.state)).toEqual(["DEGISMEDI", "DEGISMEDI"]);
    expect(after.result.rows[0]?.message).toContain("(15.11.2026)");
  });

  it("a text sealed from several pages is the same text as one page (whole or nothing)", async () => {
    const paged = archive([tbk()], { pageSize: 60 });
    const first = await run(await tbkOnly(), paged);
    const pages = paged.calls.filter((c) => c.toolName === "get_mevzuat_content").map((c) => c.args["page_number"]);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages).toEqual(pages.map((_, i) => i + 1));
    expect(first.baselines["KANUN:6098"]?.fingerprint).toBe(watchFingerprint(TBK_V1));
    const again = await run(await tbkOnly(), archive([tbk()]), { baselines: first.baselines });
    expect(again.result.rows.map((r) => r.state)).toEqual(["DEGISMEDI", "DEGISMEDI"]);
  });
});

describe("a failure is ULAŞILAMADI, an unresolvable law BELİRLENEMEDİ — never DEĞİŞMEDİ", () => {
  it("a failed text call is ULAŞILAMADI and leaves the baseline untouched", async () => {
    const first = await run(await tbkOnly(), archive([tbk()]));
    const down = archive([tbk(TBK_V2_NOTE)], {
      override: (req) => (req.toolName === "get_mevzuat_content" ? fail("TIMEOUT") : undefined),
    });
    const second = await run(await tbkOnly(), down, { baselines: first.baselines });
    expect(second.result.rows.map((r) => r.state)).toEqual(["ULASILAMADI", "ULASILAMADI"]);
    expect(second.result.laws[0]?.failureKind).toBe("TIMEOUT");
    for (const row of second.result.rows) {
      expect(row.message).toContain("Bu bir “değişmedi” sonucu değildir.");
      expect(row.message).not.toMatch(/^Değişmedi/u);
    }
    expect(second.baselines["KANUN:6098"]).toEqual(first.baselines["KANUN:6098"]);
  });

  it("a failed search, a throwing gateway and a legacy error body are ULAŞILAMADI too", async () => {
    const searchDown = await run(await tbkOnly(), archive([tbk()], { override: () => fail("UNAVAILABLE") }));
    expect(searchDown.result.laws[0]).toMatchObject({ state: "ULASILAMADI", reasonCode: "UPSTREAM_FAILED", failureKind: "UNAVAILABLE" });

    const throwing = new FakeGateway(() => {
      throw new Error("socket hang up");
    });
    const threw = await run(await tbkOnly(), throwing);
    expect(threw.result.laws[0]?.state).toBe("ULASILAMADI");

    const legacy = await run(
      await tbkOnly(),
      archive([tbk()], { override: (req) => (req.toolName === "search_mevzuat" ? ok("Search error: upstream 502") : undefined) }),
    );
    expect(legacy.result.laws[0]).toMatchObject({ state: "ULASILAMADI", reasonCode: "UNEXPECTED_PAYLOAD" });
    expect(Object.keys(legacy.baselines)).toEqual([]);
  });

  it("one missing page fails the whole law; a clamped (out-of-order) page is refused", async () => {
    const pageTwoDown = archive([tbk()], {
      pageSize: 60,
      override: (req) =>
        req.toolName === "get_mevzuat_content" && req.args["page_number"] === 2 ? fail("UNAVAILABLE") : undefined,
    });
    const broken = await run(await tbkOnly(), pageTwoDown);
    expect(broken.result.laws[0]).toMatchObject({ state: "ULASILAMADI", pages: 1 });
    expect(broken.baselines["KANUN:6098"]).toBeUndefined();

    const clamped = archive([tbk()], {
      pageSize: 60,
      override: (req) =>
        req.toolName === "get_mevzuat_content" && req.args["page_number"] === 3
          ? ok(`Mevzuat 10098 | page 2/${Math.ceil(Array.from(TBK_V1).length / 60)} | page_size 60\n\nx`)
          : undefined,
    });
    const refused = await run(await tbkOnly(), clamped);
    expect(refused.result.laws[0]).toMatchObject({ state: "ULASILAMADI", reasonCode: "UNEXPECTED_PAYLOAD" });

    const renamed = archive([tbk()], {
      override: (req) =>
        req.toolName === "get_mevzuat_content" ? ok("Mevzuat 99999 | page 1/1 | page_size 50000\n\nbaşka bir metin") : undefined,
    });
    expect((await run(await tbkOnly(), renamed)).result.laws[0]?.state).toBe("ULASILAMADI");
  });

  it("no match, two matches and a repealed law are BELİRLENEMEDİ", async () => {
    const none = await run(await tbkOnly(), archive([]));
    expect(none.result.laws[0]).toMatchObject({ state: "BELIRLENEMEDI", reasonCode: "NO_MATCH" });
    expect(none.result.rows[0]?.message).toContain("BELİRLENEMEDİ");

    const twin = { ...tbk(), mevzuatId: "20098", title: "ESKİ BİR KANUN" };
    const twinNamed = await run(await tbkOnly(), archive([tbk(), twin]));
    // The abbreviation table names 6098; exactly one title carries it.
    expect(twinNamed.result.laws[0]?.state).toBe("TEMEL_KAYDEDILDI");
    expect(twinNamed.result.laws[0]?.mevzuatId).toBe("10098");
    const unnamed = await run(
      await tbkOnly(),
      archive([{ ...tbk(), title: "BİRİNCİ KANUN" }, { ...twin, title: "İKİNCİ KANUN" }]),
    );
    expect(unnamed.result.laws[0]).toMatchObject({ state: "BELIRLENEMEDI", reasonCode: "AMBIGUOUS" });

    const repealed = await collectMatterCitations([draftItem("d-1")], {
      drafts: { get: () => ({ sections: [{ paragraphs: [{ text: "818 sayılı eBK m. 360 uyarınca." }] }] }) },
    });
    const gateway = archive([tbk()]);
    const mulga = await run(repealed, gateway);
    expect(mulga.result.laws[0]).toMatchObject({ state: "BELIRLENEMEDI", reasonCode: "MULGA", calls: 0 });
    expect(gateway.calls).toEqual([]);
  });
});

describe("bounds: a run that is cut says so (partial), and never guesses", () => {
  it("the time budget stops the run between calls; unasked laws are KONTROL EDİLMEDİ and keep no baseline", async () => {
    let clock = 0;
    const slow = archive([tbk(), hmk()], {
      override: () => {
        clock += 40_000;
        return undefined;
      },
    });
    const { result, baselines } = await run(await tbkAndHmk(), slow, { clock: () => clock, timeBudgetMs: 100_000 });
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBe("TIME_BUDGET");
    const states = Object.fromEntries(result.laws.map((l) => [l.lawKey, [l.state, l.reasonCode]]));
    // 6098 (cited first-ranked by number) was read in two calls (80 s); the
    // next law's search pushed the clock past 100 s before its text.
    expect(states["KANUN:6098"]).toEqual(["TEMEL_KAYDEDILDI", null]);
    expect(states["KANUN:6100"]).toEqual(["KONTROL_EDILMEDI", "TIME_BUDGET"]);
    expect(baselines["KANUN:6100"]).toBeUndefined();
    expect(result.rows.find((r) => r.lawNo === "6100")?.message).toContain("süre sınırı doldu");
    expect(result.counts.KONTROL_EDILMEDI).toBe(1);
  });

  it("the call budget and the law limit stop it too, and the next run asks the waiting law first", async () => {
    const calls = await run(await tbkAndHmk(), archive([tbk(), hmk()]), { maxCalls: 3 });
    expect(calls.result.stopReason).toBe("CALL_BUDGET");
    expect(calls.result.complete).toBe(false);
    expect(calls.result.budget.callsUsed).toBeLessThanOrEqual(3);
    expect(DEFAULT_WATCH_MAX_CALLS).toBeGreaterThan(3);

    const first = await run(await tbkAndHmk(), archive([tbk(), hmk()]), { maxLaws: 1 });
    expect(first.result.stopReason).toBe("LAW_LIMIT");
    expect(first.result.laws.map((l) => [l.lawNo, l.state])).toEqual([
      ["6098", "TEMEL_KAYDEDILDI"],
      ["6100", "KONTROL_EDILMEDI"],
    ]);
    const gateway = archive([tbk(), hmk()]);
    const next = await run(await tbkAndHmk(), gateway, {
      maxLaws: 1,
      baselines: first.baselines,
      lastAsked: first.lastAsked,
      now: () => new Date(T1),
    });
    expect(gateway.calls[0]?.args["mevzuat_no"]).toBe("6100");
    expect(next.result.laws.map((l) => [l.lawNo, l.state])).toEqual([
      ["6098", "KONTROL_EDILMEDI"],
      ["6100", "TEMEL_KAYDEDILDI"],
    ]);
  });

  it("a cancelled request stops between calls", async () => {
    const controller = new AbortController();
    const gateway = archive([tbk(), hmk()], {
      override: (_req, n) => {
        if (n === 2) controller.abort();
        return undefined;
      },
    });
    const { result } = await run(await tbkAndHmk(), gateway, { signal: controller.signal });
    expect(result.stopReason).toBe("CANCELLED");
    expect(result.complete).toBe(false);
    expect(gateway.calls.length).toBe(2);
  });

  it("an unread source keeps the result partial even when every law was checked", async () => {
    const collected = await collectMatterCitations([draftItem("d-1"), draftItem("d-gone")], ports());
    const { result } = await run(collected, archive([tbk(), hmk(), { ...hmk(), no: "375", tur: "KHK", mevzuatId: "375", title: "KHK" }]));
    expect(result.unreadSources.length).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function matterWithDraft(store: InMemoryMatterStore): Promise<string> {
  const matter = await store.create({ title: "Eser sözleşmesi davası" });
  await store.addItem(matter.id, { kind: "draft", refId: "d-1", payload: { title: "Cevap dilekçesi" } });
  return matter.id;
}

describe("HTTP: /v1/matters/{id}/legislation-watch", () => {
  it("GET lists the citations without calling the source; POST checks, persists, and GET returns it", async () => {
    const matters = new InMemoryMatterStore(() => new Date(T0));
    const id = await matterWithDraft(matters);
    const gateway = archive([tbk(), hmk()]);
    const app = createLegislationWatchRouter({
      matters,
      store: new InMemoryLegislationWatchStore(),
      gateway,
      drafts: ports().drafts,
      now: () => new Date(T0),
    });
    const before = await app.request(`/v1/matters/${id}/legislation-watch`);
    expect(before.status).toBe(200);
    const listed = (await before.json()) as Record<string, unknown>;
    expect(listed["available"]).toBe(true);
    expect((listed["citations"] as Array<{ key: string }>).map((c) => c.key)).toEqual([
      "KANUN:6098|madde:474",
      "KANUN:6098|madde:475",
      "KANUN:6100|madde:119",
    ]);
    expect(listed["lastResult"]).toBeNull();
    expect(gateway.calls).toEqual([]);

    const post = await app.request(`/v1/matters/${id}/legislation-watch`, { method: "POST" });
    expect(post.status).toBe(200);
    const result = (await post.json()) as Record<string, unknown>;
    expect(result["persisted"]).toBe(true);
    expect(result["complete"]).toBe(true);
    expect((result["counts"] as Record<string, number>)["TEMEL_KAYDEDILDI"]).toBe(3);

    const after = (await (await app.request(`/v1/matters/${id}/legislation-watch`)).json()) as Record<string, unknown>;
    expect((after["lastResult"] as Record<string, unknown>)["checkedAt"]).toBe(T0);
    expect(after["baselineLaws"]).toBe(2);

    const all = (await (await app.request("/v1/legislation-watch")).json()) as { matters: Array<Record<string, unknown>> };
    expect(all.matters).toEqual([
      expect.objectContaining({ matterId: id, title: "Eser sözleşmesi davası", checkedAt: T0, complete: true }),
    ]);
  });

  it("without a gateway GET says why and POST is a typed 503; bad input is a Turkish 400 naming the field", async () => {
    const matters = new InMemoryMatterStore(() => new Date(T0));
    const id = await matterWithDraft(matters);
    const closed = createLegislationWatchRouter({ matters, store: new InMemoryLegislationWatchStore(), drafts: ports().drafts });
    const info = (await (await closed.request(`/v1/matters/${id}/legislation-watch`)).json()) as Record<string, unknown>;
    expect(info["available"]).toBe(false);
    expect(String(info["unavailableReason"])).toContain("Resmî mevzuat kaynağına bağlantı");
    const refused = await closed.request(`/v1/matters/${id}/legislation-watch`, { method: "POST" });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { kind: string } }).error.kind).toBe("LEGISLATION_SOURCE_UNAVAILABLE");

    const open = createLegislationWatchRouter({ matters, store: new InMemoryLegislationWatchStore(), gateway: archive([]) });
    const extra = await open.request(`/v1/matters/${id}/legislation-watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxLaws: 2, bogus: true }),
    });
    expect(extra.status).toBe(400);
    const body = (await extra.json()) as { error: { issues: Array<{ path: string; message: string }> } };
    expect(body.error.issues).toEqual([expect.objectContaining({ path: "bogus", message: "Tanınmayan alan." })]);
    const tooMany = await open.request(`/v1/matters/${id}/legislation-watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxLaws: 99 }),
    });
    expect(tooMany.status).toBe(400);
    expect((await open.request("/v1/matters/not-a-uuid/legislation-watch")).status).toBe(404);
    expect(
      (await open.request("/v1/matters/22222222-2222-4222-8222-222222222222/legislation-watch", { method: "POST" })).status,
    ).toBe(404);
  });

  it("a store that fails to save still answers the check, and says the result was not kept", async () => {
    const matters = new InMemoryMatterStore(() => new Date(T0));
    const id = await matterWithDraft(matters);
    const store = new InMemoryLegislationWatchStore();
    store.save = async () => {
      throw new Error("disk full");
    };
    const app = createLegislationWatchRouter({
      matters,
      store,
      gateway: archive([tbk(), hmk()]),
      drafts: ports().drafts,
      log: () => undefined,
    });
    const res = await app.request(`/v1/matters/${id}/legislation-watch`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["persisted"]).toBe(false);
    expect(body["warnings"]).toEqual([expect.stringContaining("kaydedilemedi")]);
  });

  it("is mounted in the app behind localGuard: a foreign page cannot start a check", async () => {
    const matters = new InMemoryMatterStore(() => new Date(T0));
    const id = (await matters.create({ title: "Dosya" })).id;
    const gateway = archive([tbk()]);
    const app = createApp({ serveConsole: false, matterStore: matters, gateway });
    const ok200 = await app.request(`/v1/matters/${id}/legislation-watch`);
    expect(ok200.status).toBe(200);
    const foreign = await app.request(`/v1/matters/${id}/legislation-watch`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect(gateway.calls).toEqual([]);
    const empty = await app.request(`/v1/matters/${id}/legislation-watch`, { method: "POST" });
    expect(empty.status).toBe(200);
    const body = (await empty.json()) as { rows: unknown[]; notices: string[]; complete: boolean };
    expect(body.rows).toEqual([]);
    expect(body.notices[0]).toContain("kanun atfı bulunamadı");
  });
});

describe("stored documents are untrusted on the way back in", () => {
  it("a malformed baseline is dropped (re-recorded next time), a good one survives", () => {
    const good = {
      method: "lw-fp-1",
      mevzuatId: "10098",
      title: "TÜRK BORÇLAR KANUNU",
      rgDate: "2011-02-04",
      fingerprint: "a".repeat(64),
      latestNoteDate: null,
      recordedAt: T0,
      articles: { "madde:474": { fingerprint: "b".repeat(64), latestNoteDate: null, recordedAt: T0 }, bad: { fingerprint: 3 } },
    };
    const doc = normalizeWatchDocument("m", {
      baselines: { "KANUN:6098": good, "KANUN:6100": { fingerprint: "not-a-hash" } },
      lastAsked: { "KANUN:6098": T0, "KANUN:6100": 7 },
      lastResult: { schema: "something-else" },
    });
    expect(Object.keys(doc?.baselines ?? {})).toEqual(["KANUN:6098"]);
    expect(Object.keys(doc?.baselines["KANUN:6098"]?.articles ?? {})).toEqual(["madde:474"]);
    expect(doc?.lastAsked).toEqual({ "KANUN:6098": T0 });
    expect(doc?.lastResult).toBeNull();
  });
});

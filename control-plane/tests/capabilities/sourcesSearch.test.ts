/**
 * W14/B-16 — the "Karar ara" server side.
 *
 * The government endpoints are NOT reachable from this machine, so every test
 * here drives an INJECTED fake gateway. What is proven offline:
 *   - the filters a litigator needs reach the tools as their REAL arguments;
 *   - a künye list comes back, and a search summary never becomes evidence;
 *   - "tam metni getir" produces a card whose hashes and offsets re-verify;
 *   - a failing source is NAMED (partial results), and an all-failed search is
 *     a typed 502 rather than an empty list.
 * Live verification against the real upstreams is PENDING — see
 * docs/implementation/waves/W14-L-SOURCES.md.
 */

import { describe, expect, it } from "vitest";

import { FakeGateway, type ToolCallRequest } from "../../src/gateway/gateway.js";
import type { Outcome } from "../../src/capabilities/types.js";
import {
  buildBedestenPhrase,
  searchSources,
  yearRangeToDates,
  safeDisplayText,
} from "../../src/sources/searchService.js";
import { fetchSourceCard, verifySourceCard } from "../../src/sources/fetchService.js";
import { createSourcesRouter, libraryChipLabel } from "../../src/sources/routes.js";
import { InMemoryLocalLibrary } from "../../src/sources/localLibrary.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const T0 = "2026-09-02T10:00:00.000Z";

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

const DECISION_TEXT =
  "Taraflar arasındaki tahliye taahhüdüne dayalı icra takibine itirazın iptali davasında," +
  " mahkemece taahhüdün geçerli olduğu kabul edilmiştir.\n\n" +
  "Tahliye taahhüdünün kira sözleşmesinin kurulmasından sonra verilmiş olması gerekir;" +
  " aksi hâlde taahhüt geçersizdir ve tahliye kararı verilemez.";

function bedestenRows(count: number): unknown {
  return {
    decisions: Array.from({ length: count }, (_, i) => ({
      documentId: `doc-${i + 1}`,
      itemType: { name: "YARGITAYKARARI" },
      birimAdi: "3. Hukuk Dairesi",
      esasNo: `2023/${100 + i}`,
      kararNo: `2024/${200 + i}`,
      kararTarihi: "2024-05-11T00:00:00.000Z",
    })),
    total_records: count,
  };
}

// ---------------------------------------------------------------------------
// Query grammar
// ---------------------------------------------------------------------------

describe("B-16 query grammar", () => {
  it("builds the exact-phrase + exclusion form Bedesten documents", () => {
    expect(
      buildBedestenPhrase({
        query: "tahliye taahhüdü",
        exactPhrase: true,
        excludeTerms: ["kira tespiti", "  ", "kira tespiti"],
      }),
    ).toBe('"tahliye taahhüdü" -kira tespiti');
  });

  it("leaves a plain query untouched and drops empty exclusions", () => {
    expect(buildBedestenPhrase({ query: " tahliye " })).toBe("tahliye");
    expect(buildBedestenPhrase({ query: "kira", excludeTerms: ["", "   "] })).toBe("kira");
  });

  it("turns a year range into an inclusive ISO day range", () => {
    expect(yearRangeToDates(2023, 2025)).toEqual({
      dateFrom: "2023-01-01",
      dateTo: "2025-12-31",
    });
    expect(yearRangeToDates(undefined, undefined)).toEqual({});
  });

  it("truncates untrusted display text by CODE POINTS, never UTF-16 units", () => {
    // Four astral code points; a UTF-16 slice at 3 would split a surrogate pair.
    const astral = "\u{1F600}\u{1F601}\u{1F602}\u{1F603}";
    const cut = safeDisplayText(astral, 3);
    expect([...cut]).toHaveLength(4); // 3 emoji + the ellipsis
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.includes("�")).toBe(false);
  });

  it("strips control characters from provider text", () => {
    expect(safeDisplayText("a\u0000b\u001Bc", 50)).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// The litigator's filters reach the real tool arguments
// ---------------------------------------------------------------------------

describe("B-16 filters reach the tools as their real arguments", () => {
  it("sends merci, daire, yıl aralığı, tam ifade and hariç kelimeler to Bedesten", async () => {
    const calls: ToolCallRequest[] = [];
    const gateway = new FakeGateway((request) => {
      calls.push(request);
      return ok(bedestenRows(3));
    });

    const result = await searchSources(
      {
        query: "tahliye taahhüdü",
        sources: ["yargitay"],
        chamber: "H3",
        yearFrom: 2023,
        yearTo: 2025,
        exactPhrase: true,
        excludeTerms: ["kira tespiti"],
      },
      { gateway, now: () => T0 },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe("search_bedesten_unified");
    expect(calls[0]?.args).toMatchObject({
      phrase: '"tahliye taahhüdü" -kira tespiti',
      court_types: ["YARGITAYKARARI"],
      birimAdi: "H3",
      kararTarihiStart: "2023-01-01",
      kararTarihiEnd: "2025-12-31",
      pageNumber: 1,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.partial).toBe(false);
  });

  it("returns a künye row per hit with the fetch kind the next step needs", async () => {
    const gateway = new FakeGateway(() => ok(bedestenRows(2)));
    const result = await searchSources(
      { query: "tahliye", sources: ["istinaf_hukuk"] },
      { gateway, now: () => T0 },
    );
    const row = result.rows[0];
    expect(row?.sourceId).toBe("istinaf_hukuk");
    expect(row?.sourceLabel).toBe("İstinaf (BAM) hukuk daireleri");
    expect(row?.externalId).toBe("doc-1");
    expect(row?.docketNo).toBe("2023/100");
    expect(row?.decisionNo).toBe("2024/200");
    expect(row?.decisionDate).toBe("2024-05-11");
    expect(row?.fetchKind).toBe("karar");
    // A row is a künye, not evidence: it carries no hash and no offsets.
    expect(row).not.toHaveProperty("contentSha256");
    expect(row).not.toHaveProperty("startChar");
  });

  it("applies the exclusion client-side for sources whose grammar cannot", async () => {
    const gateway = new FakeGateway(() => ({
      status: "ok",
      data: {
        results: [
          { id: "a", title: "Kira tespiti hakkında karar" },
          { id: "b", title: "Tahliye taahhüdü hakkında karar" },
        ],
      },
      provider: "EMSAL",
      observedAt: T0,
      warnings: [],
    }));
    const result = await searchSources(
      { query: "tahliye", sources: ["emsal"], excludeTerms: ["kira tespiti"] },
      { gateway, now: () => T0 },
    );
    expect(result.rows.map((r) => r.externalId)).toEqual(["b"]);
  });

  it("honours the requested page and the row limit", async () => {
    const calls: ToolCallRequest[] = [];
    const gateway = new FakeGateway((request) => {
      calls.push(request);
      return ok(bedestenRows(10));
    });
    const result = await searchSources(
      { query: "kira", sources: ["yargitay"], page: 3, limit: 4 },
      { gateway, now: () => T0 },
    );
    expect(calls[0]?.args["pageNumber"]).toBe(3);
    expect(result.rows).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// A failing source is NAMED — never a silent empty list
// ---------------------------------------------------------------------------

describe("B-16 partial results name the source that failed", () => {
  it("keeps the rows of the sources that answered and names the one that did not", async () => {
    const gateway = new FakeGateway((request) => {
      const courts = request.args["court_types"];
      if (Array.isArray(courts) && courts[0] === "DANISTAYKARAR") return err("RATE_LIMITED");
      return ok(bedestenRows(2));
    });
    const result = await searchSources(
      { query: "kamulaştırma", sources: ["yargitay", "danistay"] },
      { gateway, now: () => T0 },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.okSources).toEqual(["yargitay"]);
    expect(result.partial).toBe(true);
    expect(result.failedSources).toHaveLength(1);
    const failure = result.failedSources[0];
    expect(failure?.sourceId).toBe("danistay");
    expect(failure?.kind).toBe("RATE_LIMITED");
    // Machine code, then Turkish, and it SAYS the list is missing this source.
    expect(failure?.message).toContain("RATE_LIMITED");
    expect(failure?.message).toContain("Danıştay");
    expect(failure?.message).toContain("Bu kaynağın sonuçları listede YOK.");
  });

  it("names the source when the gateway itself throws", async () => {
    const gateway = new FakeGateway(() => {
      throw new Error("socket hang up");
    });
    const result = await searchSources(
      { query: "kira", sources: ["yargitay"] },
      { gateway, now: () => T0 },
    );
    expect(result.rows).toEqual([]);
    expect(result.failedSources[0]?.kind).toBe("UNAVAILABLE");
    // The driver's own words never reach the body.
    expect(JSON.stringify(result)).not.toContain("socket hang up");
  });

  it("reports a partial payload (rows AND a provider error) as a named gap", async () => {
    const gateway = new FakeGateway(() => ok({ ...(bedestenRows(1) as object), error_code: "TIMEOUT" }));
    const result = await searchSources(
      { query: "kira", sources: ["yargitay"] },
      { gateway, now: () => T0 },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.failedSources[0]?.kind).toBe("TIMEOUT");
    expect(result.failedSources[0]?.message).toContain("eksik olabilir");
  });

  it("answers 502 ALL_SOURCES_FAILED rather than an empty list", async () => {
    const gateway = new FakeGateway(() => err("UNAVAILABLE"));
    const app = createSourcesRouter({ gateway, now: () => T0 });
    const response = await app.request("/v1/sources/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kira", sources: ["yargitay", "danistay"] }),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as {
      error: { kind: string; message: string; failedSources: Array<{ sourceId: string }> };
    };
    expect(body.error.kind).toBe("ALL_SOURCES_FAILED");
    expect(body.error.message).toContain("BOŞ DEĞİL, YOK");
    expect(body.error.failedSources.map((f) => f.sourceId).sort()).toEqual([
      "danistay",
      "yargitay",
    ]);
  });

  it("refuses an unknown source and a reversed year range with a typed 400", async () => {
    const gateway = new FakeGateway(() => ok(bedestenRows(1)));
    const app = createSourcesRouter({ gateway, now: () => T0 });
    const unknown = await app.request("/v1/sources/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kira", sources: ["hudoc"] }),
    });
    expect(unknown.status).toBe(400);

    const reversed = await app.request("/v1/sources/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kira", yearFrom: 2025, yearTo: 2023 }),
    });
    expect(reversed.status).toBe(400);
    const body = (await reversed.json()) as { error: { issues: Array<{ message: string }> } };
    expect(body.error.issues[0]?.message).toContain("büyük olamaz");
  });

  it("answers 502 with a Turkish sentence when no gateway is configured", async () => {
    const app = createSourcesRouter({ now: () => T0 });
    const response = await app.request("/v1/sources/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kira" }),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
    expect(body.error.message).toContain("--with-mcp");
  });
});

// ---------------------------------------------------------------------------
// "Tam metni getir" -> a card whose hashes and offsets re-verify
// ---------------------------------------------------------------------------

describe("B-16 the source card is hash-verified", () => {
  const fetchGateway = new FakeGateway((request) =>
    request.toolName === "fetch"
      ? ok({
          id: request.args["id"],
          title: "Yargıtay 3. HD kararı",
          text: DECISION_TEXT,
          url: "https://mevzuat.adalet.gov.tr/ictihat/doc-1",
        })
      : err("NOT_FOUND"),
  );

  it("hashes the canonical text and slices every quote back at its offsets", async () => {
    const outcome = await fetchSourceCard(
      { kind: "karar", externalId: "doc-1", query: "tahliye taahhüdü geçerli" },
      { gateway: fetchGateway, now: () => T0, newId: () => "card-1" },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const card = outcome.card;

    expect(card.contentSha256).toBe(sha256HexUtf8(card.text));
    expect(card.contentCodePoints).toBe([...card.text].length);
    expect(card.quotes.length).toBeGreaterThan(0);
    expect(card.documentVersionId).toBe(
      `live:BEDESTEN:doc-1@${card.contentSha256.slice(0, 16)}`,
    );
    expect(verifySourceCard(card)).toEqual({ ok: true, problems: [] });

    for (const quote of card.quotes) {
      expect([...card.text].slice(quote.startChar, quote.endChar).join("")).toBe(quote.quote);
      expect(quote.quoteSha256).toBe(sha256HexUtf8(quote.quote));
    }
  });

  it("fails verification when a single character of the text is changed", async () => {
    const outcome = await fetchSourceCard(
      { kind: "karar", externalId: "doc-1", query: "tahliye" },
      { gateway: fetchGateway, now: () => T0, newId: () => "card-2" },
    );
    if (!outcome.ok) throw new Error("fixture fetch failed");
    const tampered = { ...outcome.card, text: `${outcome.card.text}.` };
    const verdict = verifySourceCard(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("CONTENT_HASH_MISMATCH");
  });

  it("labels the card as an official source, never SENTETİK", async () => {
    const outcome = await fetchSourceCard(
      { kind: "karar", externalId: "doc-1" },
      { gateway: fetchGateway, now: () => T0, newId: () => "card-3" },
    );
    if (!outcome.ok) throw new Error("fixture fetch failed");
    expect(outcome.card.originLabel).toBe("resmî kaynak");
    expect(JSON.stringify(outcome.card)).not.toContain("SENTETİK");
    expect(libraryChipLabel(T0)).toBe("resmî kaynak · alınma 02.09.2026");
  });

  it("reports an upstream failure as a typed 502, never as an empty card", async () => {
    const app = createSourcesRouter({ gateway: fetchGateway, now: () => T0 });
    const response = await app.request("/v1/sources/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "emsal", externalId: "missing" }),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("NOT_FOUND");
    expect(body.error.message).toContain("NOT_FOUND");
  });

  it("never lets a caller overwrite the identity through `extra`", async () => {
    const seen: ToolCallRequest[] = [];
    const gateway = new FakeGateway((request) => {
      seen.push(request);
      return ok({ id: request.args["id"], title: "K", text: DECISION_TEXT, url: "https://x.invalid/1" });
    });
    await fetchSourceCard(
      { kind: "karar", externalId: "doc-1", extra: { id: "doc-999", page_number: 2 } },
      { gateway, now: () => T0 },
    );
    expect(seen[0]?.args["id"]).toBe("doc-1");
    expect(seen[0]?.args["page_number"]).toBe(2);
  });

  it("files the fetched document into the local library and dedupes a re-fetch", async () => {
    const library = new InMemoryLocalLibrary();
    const app = createSourcesRouter({ gateway: fetchGateway, library, now: () => T0 });
    const call = async (): Promise<Response> =>
      app.request("/v1/sources/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "karar", externalId: "doc-1" }),
      });

    const first = (await (await call()).json()) as {
      library: { action: string };
      kaynakEtiketi: string;
    };
    expect(first.library.action).toBe("written");
    expect(first.kaynakEtiketi).toBe("resmî kaynak · alınma 02.09.2026");

    const second = (await (await call()).json()) as { library: { action: string } };
    expect(second.library.action).toBe("duplicate");
    expect(await library.keys()).toHaveLength(1);
  });
});

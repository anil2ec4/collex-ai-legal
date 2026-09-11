/**
 * W14 M-SRV · IR-2 — the upstream's OWN record count travels with the search.
 *
 * WHY IT MATTERS. "Karar ara" hands the lawyer 20 künye rows. Measured on the
 * live upstreams (W14-C-FINAL §7): the same phrase answered `total_records`
 * 116 090 unquoted and 758 as an exact phrase — a four-order-of-magnitude
 * difference that never reached the screen. Without the count, 20 rows out of
 * 758 and 20 rows out of 116 090 look identical, and the lawyer cannot tell a
 * finished list from the tip of an iceberg.
 *
 * THE ONE RULE THIS PINS. A provider that publishes no count yields `null`,
 * NEVER 0. "The archive holds none" and "we could not find out" are different
 * sentences, and only one of them may be shown as a number. A genuine 0 from a
 * provider that DID publish a count survives as 0.
 *
 * Offline: parser-level over real payload shapes plus the search service over
 * a scripted FakeGateway. No network.
 */

import { describe, expect, it } from "vitest";
import { parseSearchPayload, readTotalRecords } from "../../src/research/payloads.js";
import { searchSources } from "../../src/sources/searchService.js";
import { FakeGateway } from "../../src/gateway/gateway.js";
import type { Outcome } from "../../src/capabilities/types.js";
import { bedestenDecision, bedestenSearchPayload, T0 } from "./helpers.js";

describe("readTotalRecords — the honest reader", () => {
  it("reads Bedesten's own field and keeps a real zero", () => {
    expect(readTotalRecords({ total_records: 116_090 })).toBe(116_090);
    expect(readTotalRecords({ total_records: 758 })).toBe(758);
    // A provider that answered "0 records" told us something; that is kept.
    expect(readTotalRecords({ total_records: 0 })).toBe(0);
  });

  it("accepts a digit STRING (some providers JSON-encode counts as text)", () => {
    expect(readTotalRecords({ total_records: "758" })).toBe(758);
    expect(readTotalRecords({ totalCount: " 12 " })).toBe(12);
  });

  it("says UNKNOWN — not zero — for everything it cannot trust", () => {
    for (const payload of [
      {},
      { total_records: null },
      { total_records: -1 },
      { total_records: 1.5 },
      { total_records: Number.NaN },
      { total_records: "çok" },
      { total_records: true },
      { total_records: [1, 2] },
    ]) {
      expect(readTotalRecords(payload as Record<string, unknown>)).toBeUndefined();
    }
  });
});

describe("parseSearchPayload carries the count when the payload has one", () => {
  it("Bedesten: the page is 2 rows, the archive says 116 090", () => {
    const payload = {
      ...(bedestenSearchPayload([bedestenDecision("d1"), bedestenDecision("d2")]) as Record<
        string,
        unknown
      >),
      total_records: 116_090,
    };
    const parsed = parseSearchPayload("search_bedesten_unified", payload);
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(2);
    expect(parsed.totalRecords).toBe(116_090);
  });

  it("a legislation TEXT report publishes no count, so the field is absent", () => {
    const parsed = parseSearchPayload("search_mevzuat", {
      result: "- [5237] TÜRK CEZA KANUNU (Kanunlar) | mevzuatId: 345097 | RG: 2004-10-12",
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.totalRecords).toBeUndefined();
  });

  it("a generic JSON search carries its count; a bare ARRAY payload cannot", () => {
    const withCount = parseSearchPayload("search_kvkk_decisions", {
      results: [{ decision_url: "/karar/1", title: "KVKK kararı" }],
      total_records: 42,
    });
    expect(withCount.kind).toBe("hits");
    if (withCount.kind !== "hits") return;
    expect(withCount.totalRecords).toBe(42);

    const bareArray = parseSearchPayload("search_kvkk_decisions", [
      { decision_url: "/karar/1", title: "KVKK kararı" },
    ]);
    expect(bareArray.kind).toBe("hits");
    if (bareArray.kind !== "hits") return;
    expect(bareArray.totalRecords).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// service level
// ---------------------------------------------------------------------------

function ok(data: unknown): Outcome<unknown> {
  return { status: "ok", data, provider: "BEDESTEN", observedAt: T0, warnings: [] };
}

const deps = (gateway: FakeGateway) => ({
  gateway,
  now: () => "2026-09-03T09:00:00.000Z",
  monotonic: (() => {
    let t = 0;
    return () => (t += 5);
  })(),
  newId: (() => {
    let n = 0;
    return () => `id-${(n += 1)}`;
  })(),
});

const MEVZUAT_LINE =
  "- [5237] TÜRK CEZA KANUNU (Kanunlar) | mevzuatId: 345097 | RG: 2004-10-12";

describe("searchSources reports the count per source and in total", () => {
  it("sums only the sources that published one", async () => {
    const gateway = new FakeGateway((request) =>
      request.toolName === "search_bedesten_unified"
        ? ok({
            ...(bedestenSearchPayload([bedestenDecision("d1")]) as Record<string, unknown>),
            total_records: 758,
          })
        : ok({ result: MEVZUAT_LINE }),
    );

    const result = await searchSources(
      { query: "tahliye taahhüdü", sources: ["yargitay", "kanun"] },
      deps(gateway),
    );

    // 758 from Bedesten, nothing from the legislation report -> 758, not 758+0.
    expect(result.totalRecords).toBe(758);
    const byId = new Map(result.trace.map((row) => [row.sourceId, row]));
    expect(byId.get("yargitay")?.totalRecords).toBe(758);
    expect(byId.get("kanun")?.totalRecords).toBeNull();
  });

  it("NULL, never 0, when no selected source publishes a count", async () => {
    const gateway = new FakeGateway(() => ok({ result: MEVZUAT_LINE }));

    const result = await searchSources(
      { query: "ceza", sources: ["kanun"] },
      deps(gateway),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.totalRecords).toBeNull();
    expect(result.totalRecords).not.toBe(0);
  });

  it("a failed source contributes nothing and is reported as unknown, not 0", async () => {
    const gateway = new FakeGateway(() => {
      throw new Error("transport down");
    });

    const result = await searchSources(
      { query: "tahliye", sources: ["yargitay"] },
      deps(gateway),
    );
    expect(result.failedSources).toHaveLength(1);
    expect(result.totalRecords).toBeNull();
    expect(result.trace[0]?.totalRecords).toBeNull();
  });

  it("keeps a provider's genuine ZERO — an empty archive is an answer", async () => {
    const gateway = new FakeGateway(() =>
      ok({
        decisions: [],
        total_records: 0,
        requested_page: 1,
        page_size: 10,
        searched_courts: ["YARGITAYKARARI"],
      }),
    );

    const result = await searchSources(
      { query: "bulunmayan ifade", sources: ["yargitay"] },
      deps(gateway),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.totalRecords).toBe(0);
    expect(result.trace[0]?.totalRecords).toBe(0);
  });
});

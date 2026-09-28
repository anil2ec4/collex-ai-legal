/**
 * Payload-parser regression tests, including the FastMCP structuredContent
 * envelope discovered on the REAL wire (2026-08-27 live smoke): every
 * non-object tool result arrives as {"result": <value>} — fastmcp
 * tools/tool.py wraps it, and HttpMcpGateway prefers structuredContent.
 */

import { describe, expect, it } from "vitest";
import {
  parseFetchPayload,
  parseSearchPayload,
  unwrapFastMcpResult,
} from "../../src/research/payloads.js";
import {
  bedestenDecision,
  bedestenFailurePayload,
  bedestenSearchPayload,
  mevzuatContentText,
  mevzuatNoResultsText,
  mevzuatSearchText,
} from "./helpers.js";

describe("unwrapFastMcpResult", () => {
  it("unwraps the one-key {result: ...} envelope", () => {
    expect(unwrapFastMcpResult({ result: "hello" })).toBe("hello");
    expect(unwrapFastMcpResult({ result: { deep: true } })).toEqual({ deep: true });
  });

  it("leaves real payloads untouched", () => {
    const bedesten = bedestenSearchPayload([bedestenDecision("1")]);
    expect(unwrapFastMcpResult(bedesten)).toBe(bedesten);
    expect(unwrapFastMcpResult({ results: [] })).toEqual({ results: [] });
    expect(unwrapFastMcpResult("plain")).toBe("plain");
    expect(unwrapFastMcpResult(null)).toBe(null);
  });
});

describe("parseSearchPayload", () => {
  it("parses bedesten decisions into typed hits with citation metadata", () => {
    const parsed = parseSearchPayload(
      "search_bedesten_unified",
      bedestenSearchPayload([bedestenDecision("730113500")]),
    );
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(1);
    const hit = parsed.hits[0]!;
    expect(hit.externalId).toBe("730113500");
    expect(hit.provider).toBe("BEDESTEN");
    expect(hit.court).toBe("Yargıtay 1. Hukuk Dairesi");
    expect(hit.decisionDate).toBe("2023-05-11");
    expect(hit.docketNo).toBe("2023/100");
    expect(hit.decisionNo).toBe("2024/50");
  });

  it("maps a bedesten failure body onto a typed failure, never empty hits", () => {
    const parsed = parseSearchPayload("search_bedesten_unified", bedestenFailurePayload());
    expect(parsed.kind).toBe("failure");
    if (parsed.kind !== "failure") return;
    expect(parsed.failure.kind).toBe("RATE_LIMITED");
    expect(parsed.failure.retryable).toBe(true);
  });

  it("parses the search_mevzuat text report THROUGH the FastMCP envelope", () => {
    const wire = {
      result: mevzuatSearchText([{ no: "5237", title: "TÜRK CEZA KANUNU", id: "345097" }]),
    };
    const parsed = parseSearchPayload("search_mevzuat", wire);
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.externalId).toBe("345097");
    expect(parsed.hits[0]!.provider).toBe("MEVZUAT");
    // W14/B-15: the trailing "(Kanunlar)" is the legislation TYPE the tool
    // prints, not part of the title. It is captured as its own typed field so
    // the planner can pick the matching `search_within_*` lane, and the
    // official number is carried too (the `mevzuat_no` argument of that lane).
    expect(parsed.hits[0]!.title).toBe("5237 sayılı TÜRK CEZA KANUNU");
    expect(parsed.hits[0]!.legislationKind).toBe("Kanunlar");
    expect(parsed.hits[0]!.legislationNo).toBe("5237");
  });

  it("keeps a legislation row usable when the tool prints no type label", () => {
    const parsed = parseSearchPayload("search_mevzuat", {
      result: "- [6098] TÜRK BORÇLAR KANUNU | mevzuatId: 999 | RG: 2011-02-04",
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits[0]!.title).toBe("6098 sayılı TÜRK BORÇLAR KANUNU");
    expect(parsed.hits[0]!.legislationKind).toBeUndefined();
    expect(parsed.hits[0]!.legislationNo).toBe("6098");
  });

  it("treats a wrapped no-results report as zero hits, not a failure", () => {
    const parsed = parseSearchPayload("search_mevzuat", {
      result: mevzuatNoResultsText("phrase='x'"),
    });
    expect(parsed).toEqual({ kind: "hits", hits: [], warnings: [] });
  });

  it("treats a wrapped error report as a typed failure", () => {
    const parsed = parseSearchPayload("search_mevzuat", {
      result: "Search error: Bedesten unavailable",
    });
    expect(parsed.kind).toBe("failure");
  });
});

describe("parseFetchPayload", () => {
  it("parses get_mevzuat_content THROUGH the FastMCP envelope and strips the header", () => {
    const body = "MADDE 1 - Bu Kanunun amacı ceza sorumluluğunun esaslarını düzenlemektir.";
    const parsed = parseFetchPayload(
      "get_mevzuat_content",
      { mevzuat_id: "345097", page_number: 1 },
      { result: mevzuatContentText("345097", body) },
    );
    expect(parsed.kind).toBe("doc");
    if (parsed.kind !== "doc") return;
    expect(parsed.doc.externalId).toBe("345097");
    expect(parsed.doc.text).toBe(body);
    expect(parsed.doc.title).toBe("Mevzuat 345097");
  });

  it("treats a wrapped error string as a typed failure", () => {
    const parsed = parseFetchPayload(
      "get_mevzuat_content",
      { mevzuat_id: "345097", page_number: 1 },
      { result: "Error fetching content for mevzuatId 345097: timeout" },
    );
    expect(parsed.kind).toBe("failure");
  });

  it("maps a Deep-Research fetch failure envelope onto a typed failure", () => {
    const parsed = parseFetchPayload(
      "fetch",
      { id: "1" },
      {
        id: "1",
        title: "Turkish Legal Document 1 (unavailable)",
        text: "RATE_LIMITED retry_after=30.0: upstream rate limit",
        url: "https://mevzuat.adalet.gov.tr/ictihat/1",
        metadata: { error_code: "RATE_LIMITED" },
      },
    );
    expect(parsed.kind).toBe("failure");
    if (parsed.kind !== "failure") return;
    expect(parsed.failure.kind).toBe("RATE_LIMITED");
  });
});

describe("provider rows the parser used to drop (29.09.2026, the lawyer's machine)", () => {
  // Each of these sources answered, and every row was dropped: the report
  // then read "no result" for an archive that had one.
  it("keeps Sayıştay rows whose id is an integer, and shows the FILTERED count", () => {
    const parsed = parseSearchPayload("search_sayistay_unified", {
      decision_type: "daire",
      decisions: [
        { id: 101, yargilama_dairesi: 3, karar_no: "45", ilam_no: "" },
        { id: 102, yargilama_dairesi: 4, karar_no: "46", ilam_no: "" },
      ],
      total_records: 727,
      total_filtered: 12,
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits.map((h) => h.externalId)).toEqual(["101", "102"]);
    expect(parsed.hits[0]?.title).toBe("45");
    // 727 is the whole archive (DataTables recordsTotal); 12 matched the query.
    expect(parsed.totalRecords).toBe(12);
  });

  it("reads GİB's `ozelgeler` list, its integer ids and `total_results`", () => {
    const parsed = parseSearchPayload("search_gib_ozelge", {
      ozelgeler: [{ id: 38849, ozelgeNo: "B.07.1.GİB.4.34.16.01-KDV-1", title: "İhracat istisnası" }],
      total_results: 204,
      total_pages: 21,
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({ externalId: "38849", title: "İhracat istisnası", provider: "GIB" });
    expect(parsed.totalRecords).toBe(204);
  });

  it("reads AYM's `decision_page_url` and `total_records_found`", () => {
    const url = "https://normkararlarbilgibankasi.anayasa.gov.tr/ND/2023/45";
    const parsed = parseSearchPayload("search_anayasa_unified", {
      decision_type: "norm_denetimi",
      decisions: [{ decision_reference_no: "E.2022/10, K.2023/45", decision_page_url: url }],
      total_records_found: 31,
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits[0]).toMatchObject({ externalId: url, title: "E.2022/10, K.2023/45" });
    expect(parsed.totalRecords).toBe(31);
  });

  it("reads Sigorta Tahkim's `document_id`", () => {
    const parsed = parseSearchPayload("search_sigorta_tahkim_decisions", {
      decisions: [{ title: "Hakem Kararları Dergisi Sayı 64", document_id: "64", content: "…", url: "" }],
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits[0]?.externalId).toBe("64");
  });

  it("still refuses an id that is not a safe non-negative integer or text", () => {
    const parsed = parseSearchPayload("search_sayistay_unified", {
      decisions: [{ id: -1 }, { id: 1.5 }, { id: null }, { id: true }],
      total_records: 4,
    });
    expect(parsed.kind === "hits" ? parsed.hits : null).toEqual([]);
  });
});

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

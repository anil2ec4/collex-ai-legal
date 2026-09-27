/**
 * The Python gateway's typed failure fields, read back (27.09.2026, W22 follow-up).
 *
 * The W22 open item: BTK/GİB document fetches carried raw TLS text in
 * `error_message`, and the conditional 55th tool answered `status: "error"`
 * with `str(e)`. The gateway now answers every failure with the typed shape —
 * `error_code` (a FailureKind), `retryable`, `retry_after`, `status_code`,
 * `error`, and `message` / `error_message` = "<KIND> retry_after=N.N: <safe>"
 * — and every tool that RAISES answers an MCP tool error whose text is only
 * that marker. The payloads below are the gateway's real output under
 * respx-mocked outages (tests/test_raw_failure_text.py drives the Python
 * half), copied verbatim.
 *
 * What must hold on this side: the typed kind wins over any wording, a
 * NOT_FOUND stays NOT_FOUND (never an outage), the unknown answer
 * (`retry_after=0.0`, UNAVAILABLE) is not retryable, and — the one defect
 * this round found here — KİK's "no error" code "0" on an honestly empty
 * search is NOT a failure.
 */

import { describe, expect, it } from "vitest";

import { classifyFailureCode, classifyFailureText } from "../../src/gateway/failureText.js";
import { parseFetchPayload, parseSearchPayload } from "../../src/research/payloads.js";

const BTK_DOC_SSL = {
  source_url: "https://www.btk.gov.tr/uploads/x.pdf",
  markdown_chunk: null,
  current_page: 1,
  total_pages: 0,
  is_paginated: false,
  error_message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
  error: "service_unavailable",
  error_code: "UNAVAILABLE",
  status_code: 503,
  retry_after: "30.0",
  retryable: true,
  message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
};

const GIB_DOC_NOT_FOUND = {
  ozelge_id: 5,
  ozelge_no: null,
  title: null,
  markdown_chunk: null,
  current_page: 1,
  total_pages: 0,
  is_paginated: false,
  error_message: "NOT_FOUND retry_after=0.0: Özelge 5 not found",
  error: "not_found",
  error_code: "NOT_FOUND",
  status_code: 404,
  retry_after: "0.0",
  retryable: false,
  message: "NOT_FOUND retry_after=0.0: Özelge 5 not found",
};

const GIB_DOC_GARBAGE = {
  ...GIB_DOC_NOT_FOUND,
  error_message: "PARSER_ERROR retry_after=0.0: Upstream response could not be parsed.",
  error: "upstream_parse_error",
  error_code: "PARSER_ERROR",
  status_code: 502,
  message: "PARSER_ERROR retry_after=0.0: Upstream response could not be parsed.",
};

const KIK_SEARCH_SSL = {
  decisions: [],
  total_records: 0,
  page: 1,
  error_code: "UNAVAILABLE",
  error_message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
  error: "service_unavailable",
  status_code: 503,
  retry_after: "30.0",
  retryable: true,
  message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
};

describe("document payloads with the typed fields", () => {
  it("BTK under a TLS outage is UNAVAILABLE and retryable, never a parse failure", () => {
    const parsed = parseFetchPayload(
      "get_btk_document_markdown",
      { pdf_url: BTK_DOC_SSL.source_url },
      BTK_DOC_SSL,
    );
    expect(parsed.kind).toBe("failure");
    if (parsed.kind !== "failure") return;
    expect(parsed.failure.kind).toBe("UNAVAILABLE");
    expect(parsed.failure.retryable).toBe(true);
    expect(parsed.failure.safeMessage).not.toMatch(/SSL|CERTIFICATE/u);
  });

  it("a GİB özelge that does not exist is NOT_FOUND, not an outage", () => {
    const parsed = parseFetchPayload("get_gib_ozelge_document_markdown", { ozelge_id: 5 }, GIB_DOC_NOT_FOUND);
    expect(parsed.kind === "failure" && parsed.failure.kind).toBe("NOT_FOUND");
    expect(parsed.kind === "failure" && parsed.failure.retryable).toBe(false);
  });

  it("a GİB body that is not the documented JSON is PARSER_ERROR", () => {
    const parsed = parseFetchPayload("get_gib_ozelge_document_markdown", { ozelge_id: 5 }, GIB_DOC_GARBAGE);
    expect(parsed.kind === "failure" && parsed.failure.kind).toBe("PARSER_ERROR");
  });
});

describe("search payloads with the typed fields", () => {
  it("a KİK outage is a failure of kind UNAVAILABLE", () => {
    const parsed = parseSearchPayload("search_kik_v2_decisions", KIK_SEARCH_SSL);
    expect(parsed.kind).toBe("failure");
    if (parsed.kind !== "failure") return;
    expect(parsed.failure.kind).toBe("UNAVAILABLE");
    expect(parsed.failure.retryable).toBe(true);
  });

  it("KİK's own 'no error' code on an honestly empty search is NOT a failure", () => {
    // The KİK facade answers success as error_code "0" + error_message "".
    // Read as a code, "0" used to become UNAVAILABLE — a dead archive drawn
    // for a query that simply matched nothing.
    const parsed = parseSearchPayload("search_kik_v2_decisions", {
      decisions: [],
      total_records: 0,
      page: 1,
      error_code: "0",
      error_message: "",
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toEqual([]);
    expect(parsed.degraded).toBeUndefined();
  });

  it("KİK's 'no error' code next to real rows does not mark them degraded", () => {
    const parsed = parseSearchPayload("search_kik_v2_decisions", {
      decisions: [{ gundemMaddesiId: "g-1", kararNo: "2026/UY.I-1" }],
      total_records: 1,
      page: 1,
      error_code: "0",
      error_message: "",
    });
    expect(parsed.kind === "hits" && parsed.hits.length).toBe(1);
    expect(parsed.kind === "hits" && parsed.degraded).toBeUndefined();
  });

  it("a code of '0' WITH a failure marker is still the failure the marker names", () => {
    const parsed = parseSearchPayload("search_kik_v2_decisions", {
      decisions: [],
      error_code: "0",
      error_message: "TIMEOUT retry_after=30.0: Upstream request timed out.",
    });
    expect(parsed.kind === "failure" && parsed.failure.kind).toBe("TIMEOUT");
  });
});

describe("marker texts the gateway now emits", () => {
  it.each([
    ["UNAVAILABLE retry_after=30.0: Could not reach the upstream service.", "UNAVAILABLE", true],
    ["UNAVAILABLE retry_after=0.0: Unexpected upstream failure.", "UNAVAILABLE", false],
    ["TIMEOUT retry_after=30.0: Upstream request timed out.", "TIMEOUT", true],
    ["RATE_LIMITED retry_after=7.0: Upstream rate limit exceeded.", "RATE_LIMITED", true],
    ["UNAUTHORIZED retry_after=0.0: Upstream rejected the request as unauthorized.", "UNAUTHORIZED", false],
    ["INVALID_REQUEST retry_after=0.0: Document ID required for Emsal.", "INVALID_REQUEST", false],
    ["NOT_FOUND retry_after=0.0: Upstream reported that the requested record does not exist.", "NOT_FOUND", false],
    ["PARSER_ERROR retry_after=0.0: Upstream did not return a PDF document.", "PARSER_ERROR", false],
  ] as const)("%s", (text, kind, retryable) => {
    const classified = classifyFailureText(text);
    expect(classified.kind).toBe(kind);
    expect(classified.retryable).toBe(retryable);
    expect(classified.basis).toBe("marker");
  });

  it("an exact FailureKind code wins over the free text next to it", () => {
    expect(classifyFailureCode("NOT_FOUND", "Could not reach the upstream service.").kind).toBe("NOT_FOUND");
    expect(classifyFailureCode("PARSER_ERROR", "connection refused").kind).toBe("PARSER_ERROR");
  });
});

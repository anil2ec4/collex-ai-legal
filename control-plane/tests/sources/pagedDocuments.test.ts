import { describe, expect, it } from "vitest";

import { FakeGateway, type ToolCallRequest } from "../../src/gateway/gateway.js";
import { MAX_DOCUMENT_PAGES } from "../../src/research/payloads.js";
import { fetchSourceCard, verifySourceCard } from "../../src/sources/fetchService.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

/**
 * 27.09.2026: KVKK, BTK, GİB, Rekabet and AYM return a document 5 000
 * characters at a time as `markdown_chunk`, which the parser did not read at
 * all — every full-text fetch failed as PARSER_ERROR even with the network
 * up. BDDK and Sigorta Tahkim return page 1 as `markdown_content`, which was
 * sealed as if it were the whole decision. A card now seals the WHOLE text
 * (all pages, in order) or nothing.
 */

const T0 = "2026-09-27T12:00:00.000Z";

const PAGE_SIZE = 5000;
const FULL = Array.from({ length: 3 * PAGE_SIZE - 1234 }, (_, i) =>
  i % 97 === 0 ? "\n" : "abcçdefgğhıijklmnoöprsştuüvyz "[i % 30],
).join("");

function pages(text: string): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += PAGE_SIZE) out.push(text.slice(at, at + PAGE_SIZE));
  return out;
}

function pagedGateway(
  shape: "chunk" | "content",
  opts: { failPage?: number; totalPages?: number } = {},
): FakeGateway {
  const parts = pages(FULL);
  const total = opts.totalPages ?? parts.length;
  return new FakeGateway((request: ToolCallRequest) => {
    const page = Number((request.args as Record<string, unknown>)["page_number"] ?? 1);
    if (page === opts.failPage) {
      return {
        status: "error",
        error: { kind: "UNAVAILABLE", retryable: true, safeMessage: "down" },
        provider: "KVKK",
        observedAt: T0,
      } as never;
    }
    const body =
      shape === "chunk"
        ? { markdown_chunk: parts[page - 1] ?? "", current_page: page, total_pages: total, is_paginated: total > 1 }
        : { markdown_content: parts[page - 1] ?? "", page_number: page, total_pages: total };
    return { status: "ok", data: body, provider: "KVKK", observedAt: T0, warnings: [] };
  });
}

describe("paged regulator documents are sealed whole or not at all", () => {
  it("assembles every markdown_chunk page (KVKK/BTK/GİB/Rekabet/AYM shape) into one sealed card", async () => {
    const gateway = pagedGateway("chunk");
    const result = await fetchSourceCard({ kind: "kvkk", externalId: "https://www.kvkk.gov.tr/Icerik/1" }, { gateway });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(gateway.calls.map((c) => (c.args as Record<string, unknown>)["page_number"] ?? 1)).toEqual([1, 2, 3]);
    expect(result.card.contentSha256).toBe(sha256HexUtf8(result.card.text));
    expect(result.card.text.replace(/\s+/gu, " ").trim()).toBe(FULL.replace(/\s+/gu, " ").trim());
    expect(verifySourceCard(result.card).ok).toBe(true);
  });

  it("does not seal page 1 of a BDDK / Sigorta Tahkim decision as the whole text", async () => {
    const gateway = pagedGateway("content");
    const result = await fetchSourceCard({ kind: "bddk", externalId: "310" }, { gateway });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(gateway.calls).toHaveLength(3);
    expect(result.card.contentCodePoints).toBeGreaterThan(2 * PAGE_SIZE);
  });

  it("fails the whole fetch, typed, when any later page fails", async () => {
    const result = await fetchSourceCard(
      { kind: "kvkk", externalId: "https://www.kvkk.gov.tr/Icerik/1" },
      { gateway: pagedGateway("chunk", { failPage: 2 }) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("UNAVAILABLE");
  });

  it("refuses a document longer than the page limit instead of sealing a part of it", async () => {
    const gateway = pagedGateway("chunk", { totalPages: MAX_DOCUMENT_PAGES + 1 });
    const result = await fetchSourceCard({ kind: "kvkk", externalId: "https://www.kvkk.gov.tr/Icerik/1" }, { gateway });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("DOCUMENT_TOO_LARGE");
    expect(result.failure.message).toContain("sayfadan uzun");
    expect(gateway.calls).toHaveLength(1);
  });

  it("leaves a single-page document alone (one call)", async () => {
    const gateway = new FakeGateway(() => ({
      status: "ok",
      data: { markdown_chunk: "Kurul kararı metni. Tek sayfa.", current_page: 1, total_pages: 1, is_paginated: false },
      provider: "KVKK",
      observedAt: T0,
      warnings: [],
    }));
    const result = await fetchSourceCard({ kind: "kvkk", externalId: "https://www.kvkk.gov.tr/Icerik/2" }, { gateway });
    expect(result.ok).toBe(true);
    expect(gateway.calls).toHaveLength(1);
  });
});

describe("Kapsam notes speak Turkish, not catalog codes", () => {
  it("names decision types in words", async () => {
    const { buildCoverageManifest } = await import("../../src/sources/manifest.js");
    const notes = JSON.stringify(buildCoverageManifest());
    expect(notes).not.toMatch(/norm_denetimi|bireysel_basvuru|genel_kurul|temyiz_kurulu/u);
    expect(notes).toContain("norm denetimi, bireysel başvuru");
  });
});

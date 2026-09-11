/**
 * W14 B-23 — masking, the audit ledger and the cost ceiling.
 *
 * Three obligations that are the LAWYER's, not ours, and that the cloud lane
 * could not meet until this wave:
 *
 *  - Ankara Barosu HUBİTEM v1.0 requires client-identifying data to be
 *    anonymised before it reaches an AI tool. Until now the document went out
 *    as written.
 *  - KVKK m.9 (law 7499) makes the lawyer the data controller for a transfer
 *    abroad, and TBB's 28.08.2026 guidance keeps final responsibility with
 *    them. Neither is possible without a record of what was sent.
 *  - ENGRISK E13: no cumulative call or token limit existed, so a page that
 *    got past the (now closed) CSRF hole could have looped requests and spent
 *    the lawyer's API budget without limit.
 *
 * ADR-018 is untouched: default OFF, per-request consent, no remembered
 * consent, `liveTested:false`. Masking sits in FRONT of that, never instead.
 */

import { describe, expect, it } from "vitest";
import { createAiRouter } from "../../src/ai/routes.js";
import {
  MASK_CLIENT,
  MASK_IBAN,
  MASK_OPPOSING,
  MASK_PHONE,
  MASK_TCKN,
  MASK_VKN,
  describeMask,
  maskDocumentText,
} from "../../src/ai/masking.js";
import {
  AI_MAX_CALLS_PER_HOUR,
  AI_MAX_INPUT_TOKENS_PER_DAY,
  InMemoryAiLedger,
  aiRateLimitedMessage,
  overCeiling,
} from "../../src/ai/ledger.js";

// ---------------------------------------------------------------------------
// Masking (pure)
// ---------------------------------------------------------------------------

const DOCUMENT = [
  "İHTARNAME",
  "İHTAR EDEN: Ali Yılmaz, T.C. 12345678901",
  "MUHATAP: Mehmet Demir, T.C. 98765432109",
  "Vergi kimlik no: 1234567890",
  "IBAN: TR33 0006 1005 1978 6457 8413 26",
  "Telefon: 0532 123 45 67",
  "Yılmaz, kira bedelini ödemediği için Demir'e ihtar göndermiştir.",
].join("\n");

describe("B-23 masking", () => {
  it("removes every 11-digit number: no TCKN survives", () => {
    const result = maskDocumentText(DOCUMENT);
    // The acceptance criterion, stated as the criterion: search the OUTPUT
    // for any eleven-digit run at all.
    expect(result.text).not.toMatch(/(?<!\d)\d{11}(?!\d)/u);
    expect(result.text).toContain(MASK_TCKN);
    expect(result.text).not.toContain("12345678901");
    expect(result.text).not.toContain("98765432109");
  });

  it("removes VKN, IBAN and phone numbers", () => {
    const result = maskDocumentText(DOCUMENT);
    expect(result.text).toContain(MASK_VKN);
    expect(result.text).not.toContain("1234567890");
    expect(result.text).toContain(MASK_IBAN);
    expect(result.text).not.toMatch(/TR\s?33/u);
    expect(result.text).toContain(MASK_PHONE);
    expect(result.text).not.toContain("0532");
  });

  it("replaces matter party names with role placeholders", () => {
    const result = maskDocumentText(DOCUMENT, {
      client: ["Ali Yılmaz"],
      opposing: ["Mehmet Demir"],
    });
    expect(result.text).toContain(MASK_CLIENT);
    expect(result.text).toContain(MASK_OPPOSING);
    expect(result.text).not.toContain("Ali Yılmaz");
    expect(result.text).not.toContain("Mehmet Demir");
    // A later bare surname is the same person and must go too.
    expect(result.text).not.toMatch(/\bYılmaz\b/u);
    expect(result.text).not.toMatch(/\bDemir'e\b/u);
    // The model still learns WHO IS WHO, just not their names.
    expect(result.text).toMatch(/\[MÜVEKKİL\][\s\S]*\[KARŞI TARAF\]/u);
  });

  it("reports what it replaced, with counts, for the preview", () => {
    const result = maskDocumentText(DOCUMENT, { client: ["Ali Yılmaz"] });
    const kinds = result.masked.map((m) => m.kind);
    expect(kinds).toContain("client");
    expect(kinds).toContain("tckn");
    expect(kinds).toContain("iban");
    expect(kinds).toContain("phone");
    expect(result.masked.every((m) => m.count > 0)).toBe(true);
    expect(result.clean).toBe(false);
    // The summary tells the lawyer the gate is bounded, not perfect.
    expect(describeMask(result)).toContain("eksik kalabilir");
  });

  it("says so honestly when there is nothing to mask", () => {
    const result = maskDocumentText("Kira sözleşmesinin feshi talep edilmektedir.");
    expect(result.clean).toBe(true);
    expect(result.masked).toEqual([]);
    expect(describeMask(result)).toContain("bulunamadı");
    expect(describeMask(result)).toContain("eksik kalabilir");
  });

  it("matches a name written in a different case (Turkish dotted/dotless I)", () => {
    const text = "ALİ YILMAZ ile Ali Yılmaz aynı kişidir.";
    const result = maskDocumentText(text, { client: ["Ali Yılmaz"] });
    expect(result.text).not.toMatch(/YILMAZ/iu);
    expect(result.masked.find((m) => m.kind === "client")?.count).toBeGreaterThanOrEqual(2);
  });

  it("does not shred the document over a two-letter name", () => {
    const text = "Bu bir kira sözleşmesidir ve bir çok maddesi vardır.";
    const result = maskDocumentText(text, { client: ["Ay"] });
    expect(result.text).toBe(text);
    expect(result.clean).toBe(true);
  });

  it("never throws on an empty or odd input", () => {
    expect(maskDocumentText("").text).toBe("");
    expect(maskDocumentText("   ", { client: [""] }).clean).toBe(true);
    // A name with regex metacharacters must not blow up the matcher.
    expect(maskDocumentText("A.B* Şirketi", { opposing: ["A.B*"] }).text).toContain(MASK_OPPOSING);
  });
});

// ---------------------------------------------------------------------------
// Ledger + ceiling (pure)
// ---------------------------------------------------------------------------

describe("B-23 audit ledger", () => {
  const entry = (at: string, inputTokens = 100) => ({
    at,
    route: "analyze-document",
    model: "claude-sonnet-5",
    chars: 4200,
    inputTokens,
    fileId: "0123456789abcdef",
    masked: true,
  });

  it("records the SHAPE of a call and never the document text", async () => {
    const ledger = new InMemoryAiLedger();
    await ledger.record(entry("2026-09-02T10:00:00.000Z"));
    const [row] = await ledger.list(10);
    const serialized = JSON.stringify(row);
    // The acceptance criterion, stated as the criterion: search the stored
    // row for the document's own words.
    for (const secret of [
      "Ali Yılmaz",
      "12345678901",
      "kira bedelini ödemediği için",
      "İHTARNAME",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // …while still answering "what did I send, when, about which file?".
    expect(row?.route).toBe("analyze-document");
    expect(row?.fileId).toBe("0123456789abcdef");
    expect(row?.chars).toBe(4200);
    expect(row?.masked).toBe(true);
  });

  it("counts a rolling hour and the current day", async () => {
    const ledger = new InMemoryAiLedger();
    const now = new Date("2026-09-02T12:00:00.000Z");
    await ledger.record(entry("2026-09-02T11:30:00.000Z", 1000)); // within the hour
    await ledger.record(entry("2026-09-02T09:00:00.000Z", 2000)); // same day, older
    await ledger.record(entry("2026-09-01T11:30:00.000Z", 9999)); // yesterday
    const usage = await ledger.usage(now);
    expect(usage.callsLastHour).toBe(1);
    // Day boundary is server-local; both of today's rows count, yesterday's
    // does not.
    expect(usage.inputTokensToday).toBeLessThanOrEqual(3000);
    expect(usage.inputTokensToday).toBeGreaterThanOrEqual(1000);
  });

  it("the ceiling refuses on calls/hour and on tokens/day", () => {
    expect(overCeiling({ callsLastHour: 0, inputTokensToday: 0 })).toBeUndefined();
    expect(overCeiling({ callsLastHour: AI_MAX_CALLS_PER_HOUR, inputTokensToday: 0 })).toBe("hourly");
    expect(overCeiling({ callsLastHour: 0, inputTokensToday: AI_MAX_INPUT_TOKENS_PER_DAY })).toBe("daily");
    for (const reason of ["hourly", "daily"] as const) {
      const message = aiRateLimitedMessage(reason);
      expect(message).toContain("Bulut yapay zekâ");
      expect(message).toContain("maliyeti önlemek");
    }
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const CONFIG = {
  model: "claude-sonnet-5",
  baseUrl: "https://example.invalid",
  toolChoice: "forced" as const,
  warnings: [] as string[],
};

function chunk(text: string, ordinal = 0) {
  return {
    chunkId: `chunk-${ordinal}`,
    ordinal,
    text,
    fileId: "file-1",
    fileName: "ihtarname.docx",
  };
}

function routerWith(options: { ledger?: InMemoryAiLedger; chunks?: ReturnType<typeof chunk>[] } = {}) {
  const ledger = options.ledger ?? new InMemoryAiLedger();
  const app = createAiRouter({
    config: CONFIG as never,
    files: {
      getChunks: async () => options.chunks ?? [chunk(DOCUMENT)],
    } as never,
    aiLedger: ledger,
    matterParties: async () => ({ client: ["Ali Yılmaz"], opposing: ["Mehmet Demir"] }),
    // No adapter is ever reached in these tests: preview returns early and
    // the ceiling refuses before the model.
    log: () => undefined,
  });
  return { app, ledger };
}

async function post(app: ReturnType<typeof createAiRouter>, path: string, body: unknown) {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("B-23 POST /v1/ai/analyze-document cannot be called without a masking choice", () => {
  it("a request with no maskMode is refused before any work", async () => {
    const { app } = routerWith();
    const response = await post(app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { kind: string; issues?: { path: string }[] } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.issues?.some((i) => i.path === "maskMode")).toBe(true);
  });

  it("maskMode:'preview' returns the masked text and SENDS NOTHING", async () => {
    const { app, ledger } = routerWith();
    const response = await post(app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "preview",
      matterId: "11111111-1111-1111-1111-111111111111",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sent: boolean;
      masked: { kind: string; count: number }[];
      preview: { text: string }[];
      summary: string;
    };
    expect(body.sent).toBe(false);
    // The lawyer sees exactly what would leave the machine.
    const shown = body.preview.map((p) => p.text).join("\n");
    expect(shown).not.toMatch(/(?<!\d)\d{11}(?!\d)/u);
    expect(shown).not.toContain("Ali Yılmaz");
    expect(shown).toContain(MASK_CLIENT);
    expect(body.masked.map((m) => m.kind)).toContain("client");
    expect(body.summary).toContain("eksik kalabilir");
    // Nothing was recorded, because nothing was sent.
    expect(await ledger.list(10)).toEqual([]);
  });

  it("the 61st call in an hour is refused with a typed 429", async () => {
    const ledger = new InMemoryAiLedger();
    const at = new Date().toISOString();
    for (let i = 0; i < AI_MAX_CALLS_PER_HOUR; i += 1) {
      await ledger.record({
        at, route: "analyze-document", model: CONFIG.model, chars: 10, inputTokens: 1, masked: true,
      });
    }
    const { app } = routerWith({ ledger });
    const response = await post(app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { kind: string; message: string; limits: { callsPerHour: number } };
    };
    expect(body.error.kind).toBe("AI_RATE_LIMITED");
    expect(body.error.message).toContain(String(AI_MAX_CALLS_PER_HOUR));
    expect(body.error.limits.callsPerHour).toBe(AI_MAX_CALLS_PER_HOUR);
  });

  it("the daily token ceiling refuses too", async () => {
    const ledger = new InMemoryAiLedger();
    await ledger.record({
      at: new Date().toISOString(),
      route: "ocr",
      model: CONFIG.model,
      chars: 1,
      inputTokens: AI_MAX_INPUT_TOKENS_PER_DAY,
      masked: false,
    });
    const { app } = routerWith({ ledger });
    const response = await post(app, "/v1/ai/analyze-document", {
      fileId: "file-1", useCloudAi: true, maskMode: "mask",
    });
    expect(response.status).toBe(429);
    expect((await response.json() as { error: { message: string } }).error.message).toContain("günlük");
  });
});

describe("B-23 /v1/ai/status and /v1/ai/ledger", () => {
  it("status reports the ceiling, today's consumption and the masking contract", async () => {
    const ledger = new InMemoryAiLedger();
    await ledger.record({
      at: new Date().toISOString(),
      route: "analyze-document", model: CONFIG.model, chars: 100, inputTokens: 250, masked: true,
    });
    const { app } = routerWith({ ledger });
    const body = (await (await app.request("/v1/ai/status")).json()) as {
      limits: { callsPerHour: number; inputTokensPerDay: number };
      today: { callsLastHour: number; inputTokensToday: number };
      masking: { required: boolean; modes: string[] };
      liveTested: boolean;
      consent: string;
    };
    expect(body.limits).toEqual({
      callsPerHour: AI_MAX_CALLS_PER_HOUR,
      inputTokensPerDay: AI_MAX_INPUT_TOKENS_PER_DAY,
    });
    expect(body.today.callsLastHour).toBe(1);
    expect(body.today.inputTokensToday).toBe(250);
    expect(body.masking.required).toBe(true);
    expect(body.masking.modes).toEqual(["preview", "mask", "as-is"]);
    // ADR-018 is NOT loosened by any of this.
    expect(body.consent).toBe("per-request");
    expect(body.liveTested).toBe(false);
  });

  it("the ledger endpoint returns rows with no document text and says so", async () => {
    const ledger = new InMemoryAiLedger();
    await ledger.record({
      at: "2026-09-02T10:00:00.000Z",
      route: "draft-paragraph",
      model: CONFIG.model,
      chars: 900,
      inputTokens: 300,
      draftId: "draft-1",
      sectionId: "vakia",
      masked: false,
    });
    const { app } = routerWith({ ledger });
    const response = await app.request("/v1/ai/ledger?limit=5");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { route: string; chars: number }[];
      note: string;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.route).toBe("draft-paragraph");
    expect(body.entries[0]?.chars).toBe(900);
    expect(JSON.stringify(body.entries)).not.toMatch(/text|prompt|quote/iu);
    expect(body.note).toContain("SAKLANMAZ");
  });
});

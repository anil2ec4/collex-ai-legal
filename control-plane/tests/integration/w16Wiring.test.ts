/**
 * W16 şerit G — the three ports that were WRITTEN but not WIRED.
 *
 * Every one of these is the difference between a feature and a screen that
 * lies. The engines shipped in şerit B/C/D already behave correctly when a
 * port is absent (they SAY it is absent). What was missing is the line in
 * `createApp` that hands them the port when the installation HAS one — so
 * these tests measure the mounted app, not the engines.
 *
 *  1. `rerank` reaches POST /v1/sources/related. The schema is `.strict()`,
 *     so before the fix the field was a typed 400 and the semantic stage was
 *     unreachable over HTTP.
 *  2. The karşı dilekçe analizi reads an uploaded petition through the SAME
 *     file port the drafting lane uses (`{fileId}` answered 503 before).
 *  3. The aleyhe (contrary) lanes actually RUN when a provider gateway
 *     exists — and stay ÇALIŞTIRILMADI, never "bulunamadı", when it does not.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../src/api/server.js";
import { FakeGateway } from "../../src/gateway/gateway.js";

const AS_OF = "2026-09-05";

const PETITION = [
  "İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "DAVALI : Sentetik A.Ş.",
  "",
  "AÇIKLAMALAR",
  // W17: these two lines used to read "bir sözleşme kurulmuştur" and
  // "TBK m. 112 uyarınca yerinde değildir". Neither names an institution, and
  // since the contrary base term stopped being the statute NUMBER (which
  // produced queries like `6098 sayılı m. 112 bozma` and matched five
  // unrelated decisions on a real petition) such a claim honestly builds NO
  // lane at all. This test is about the UNWIRED state, not about the base
  // term, so the fixture now names one — "kira sözleşmesi" — and the lanes it
  // builds are what the assertions below are allowed to inspect.
  "1. Müvekkil şirket ile davacı arasında 10.03.2025 tarihinde kira sözleşmesi kurulmuştur.",
  "2. Davacının kira bedelinin uyarlanmasına ilişkin talebi TBK m. 112 uyarınca yerinde değildir.",
  "",
  "SONUÇ VE İSTEM",
  "3. Davanın reddine karar verilmesini talep ederiz.",
].join("\n");

function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<Response> {
  // hono's `request` is typed `Response | Promise<Response>`; every caller here
  // awaits it, so the wrapper normalises the pair rather than widening its own
  // return type (`npx tsc --noEmit` must stay clean).
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("W16 · POST /v1/sources/related accepts `rerank` over HTTP", () => {
  it("passes the process-local embedding configuration through the mounted app", async () => {
    const app = createApp({
      gateway: new FakeGateway(() => ({ status: "ok", provider: "BEDESTEN", observedAt: AS_OF,
        warnings: [], data: { decisions: [] } })),
      sourcesEmbedding: { enabled: false, reason: "EMBEDDING_BASE_URL_INVALID", message: "Injected local setting" },
    });
    const res = await post(app, "/v1/sources/related", {
      olay: "Kiracı kira ödemedi ve tahliye istendi.", sources: ["yargitay"], rerank: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ semantikSiralama: {
      uygulandi: false, neden: "EMBEDDING_BASE_URL_INVALID", mesaj: "Injected local setting",
    } });
  });
  it("no longer rejects the field as unrecognized", async () => {
    // No gateway on this app, so the route answers a typed 502 — the point is
    // that it gets PAST the schema. A 400 here would mean `rerank` is still
    // unreachable and the whole semantic stage is dead code over HTTP.
    const app = createApp({});
    const res = await post(app, "/v1/sources/related", {
      olay: "Kiracı iki ay kira ödemedi, ihtarname gönderildi ve tahliye istendi.",
      rerank: true,
    });
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as { error?: { kind?: string } };
    expect(body.error?.kind).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("still names an actually unknown field", async () => {
    const app = createApp({});
    const res = await post(app, "/v1/sources/related", {
      olay: "Kiracı iki ay kira ödemedi, ihtarname gönderildi ve tahliye istendi.",
      bogusAlan: true,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues?: { path?: string }[] } };
    expect(body.error.issues?.some((i) => i.path === "bogusAlan")).toBe(true);
  });
});

describe("W16 · karşı dilekçe analizi through the mounted app", () => {
  it("analyses pasted text and keeps the fixed summary sentence", async () => {
    const app = createApp({});
    const res = await post(app, "/v1/contracts/petition-analysis", {
      text: PETITION,
      asOf: AS_OF,
      documentTitle: "Cevap dilekçesi (SENTETİK)",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: string;
      claims: { contrary?: { lanes?: { state: string }[] } }[];
    };
    expect(body.summary).toContain("hukuki değerini ölçmez");
    expect(body.claims.length).toBeGreaterThan(0);
  });

  it("keeps every contrary lane ÇALIŞTIRILMADI when no gateway is configured", async () => {
    // The honest state. A lane that never ran must never be drawn as
    // "aleyhe kaynak bulunamadı" — that is a claim about a search that did
    // not happen, and it is the single most dangerous thing this report
    // could say to a lawyer preparing a rebuttal.
    const app = createApp({});
    const res = await post(app, "/v1/contracts/petition-analysis", {
      text: PETITION,
      asOf: AS_OF,
    });
    const body = (await res.json()) as {
      claims: { contrary?: { lanes?: { state: string }[] } }[];
    };
    const states = body.claims.flatMap((c) => (c.contrary?.lanes ?? []).map((l) => l.state));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s === "CALISTIRILMADI")).toBe(true);
    expect(states).not.toContain("ARANDI_BULUNAMADI");
  });

  it("answers a typed refusal for {fileId} when no upload store is wired", async () => {
    const app = createApp({});
    const res = await post(app, "/v1/contracts/petition-analysis", {
      fileId: "0123456789abcdef",
      asOf: AS_OF,
    });
    // 503 with a reason, never a 404: the file may well exist; what is
    // missing is the connection between the two lanes.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("STORE_UNAVAILABLE");
    expect(body.error.message).toContain("dilekçe analizine bağlı değil");
  });
});

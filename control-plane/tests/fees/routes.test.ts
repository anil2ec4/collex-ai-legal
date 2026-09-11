/**
 * `/v1/fees/*` router contract (W14 B-35). Mounted at '/' by the API
 * integration; this file exercises it standalone, exactly like
 * tests/deadlines/routes.test.ts.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createFeesRouter } from "../../src/fees/routes.js";
import { FEE_DISCLAIMER } from "../../src/fees/tariffs.js";

function app(): Hono {
  const root = new Hono();
  root.route("/", createFeesRouter());
  return root;
}

async function post(body: unknown): Promise<Response> {
  return app().request("/v1/fees/compute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /v1/fees/tariffs", () => {
  it("returns the year's lines, the group vocabulary and the disclaimer", async () => {
    const response = await app().request("/v1/fees/tariffs");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      year: number;
      years: number[];
      groups: { id: string; label: string }[];
      lines: { id: string; amount: number | null; verified: { status: string } }[];
      disclaimer: string;
      note: string;
    };
    expect(body.year).toBe(2026);
    expect(body.years).toContain(2026);
    expect(body.groups.map((g) => g.id)).toEqual(["harc", "gider", "vekalet", "kesinlik"]);
    expect(body.lines.length).toBeGreaterThanOrEqual(10);
    expect(body.disclaimer).toBe(FEE_DISCLAIMER);
    expect(body.note).toContain("overrides");
    // KABUL: every unverified line says dogrulanmadi.
    const unverified = body.lines.filter((l) => l.verified.status === "dogrulanmadi");
    expect(unverified.length).toBeGreaterThan(0);
    for (const line of unverified) {
      if (line.id.endsWith("-kesinlik")) continue;
      expect(line.amount, `${line.id}`).toBeNull();
    }
  });

  it("accepts an explicit year and rejects a malformed or unknown one", async () => {
    expect((await app().request("/v1/fees/tariffs?year=2026")).status).toBe(200);

    const bad = await app().request("/v1/fees/tariffs?year=abc");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { kind: string } }).error.kind).toBe("INVALID_REQUEST");

    const missing = await app().request("/v1/fees/tariffs?year=1999");
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("TARIFF_YEAR_NOT_FOUND");
    expect(body.error.message).toContain("1999");
  });
});

describe("POST /v1/fees/compute", () => {
  it("returns a step-by-step computation with the disclaimer", async () => {
    const response = await post({ year: 2026, kind: "dava-harci", davaDegeri: 100000 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      steps: { id: string; amount: number | null }[];
      toplam: number | null;
      eksikKalemler: string[];
      disclaimer: string;
    };
    expect(body.disclaimer).toBe(FEE_DISCLAIMER);
    expect(body.steps.find((s) => s.id === "karar-ilam-harci")?.amount).toBe(6831);
    expect(body.toplam).toBeNull();
    expect(body.eksikKalemler.length).toBeGreaterThan(0);
  });

  it("accepts overrides and computes the total", async () => {
    const response = await post({
      year: 2026,
      kind: "dava-harci",
      davaDegeri: 100000,
      overrides: { "basvurma-harci-asliye": 1500, "gider-avansi": 4000, "karar-ilam-harci-nispi-asgari": 500 },
    });
    const body = (await response.json()) as { toplam: number | null };
    expect(body.toplam).toBe(7207.75);
  });

  it("answers the kesinlik question", async () => {
    const response = await post({
      year: 2026,
      kind: "kesinlik-siniri",
      davaDegeri: 500000,
      yol: "iik-istinaf",
      overrides: { "iik-istinaf-kesinlik": 400000 },
    });
    const body = (await response.json()) as { sinirSonucu: { kanunYoluAcik: boolean } };
    expect(body.sinirSonucu.kanunYoluAcik).toBe(true);
  });

  it("rejects a non-JSON body, an unknown field and a bad kind in Turkish", async () => {
    const notJson = await app().request("/v1/fees/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error: { message: string } }).error.message).toContain("JSON");

    const unknown = await post({ year: 2026, kind: "dava-harci", davaDegeri: 1, sacma: 1 });
    expect(unknown.status).toBe(400);
    const unknownBody = (await unknown.json()) as {
      error: { kind: string; issues: { path: string; message: string }[] };
    };
    expect(unknownBody.error.kind).toBe("INVALID_REQUEST");
    expect(unknownBody.error.issues.some((i) => i.message === "Tanınmayan alan.")).toBe(true);

    const badKind = await post({ year: 2026, kind: "harc", davaDegeri: 1 });
    expect(badKind.status).toBe(400);
  });

  it("turns a calculator input error into a typed 400", async () => {
    const noYol = await post({ year: 2026, kind: "kesinlik-siniri", davaDegeri: 1 });
    expect(noYol.status).toBe(400);
    const body = (await noYol.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("kanun yolunun");

    const badYear = await post({ year: 1999, kind: "dava-harci", davaDegeri: 1 });
    expect(badYear.status).toBe(400);
    expect(((await badYear.json()) as { error: { kind: string } }).error.kind).toBe(
      "TARIFF_YEAR_NOT_FOUND",
    );
  });

  it("never leaks an English message to the lawyer", async () => {
    const response = await post({ year: 2026 });
    const body = (await response.json()) as {
      error: { message: string; issues: { message: string }[] };
    };
    const text = `${body.error.message} ${body.error.issues.map((i) => i.message).join(" ")}`;
    for (const english of ["Required", "Invalid", "Expected", "Unrecognized"]) {
      expect(text, english).not.toContain(english);
    }
  });
});

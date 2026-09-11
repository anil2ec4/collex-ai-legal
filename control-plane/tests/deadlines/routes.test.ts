/**
 * Deadlines router contract (offline; hono app.request, no sockets):
 * GET rules / GET holidays / POST compute, typed 400s with Turkish messages,
 * verbatim disclaimer, injected rule registry.
 */

import { describe, expect, it } from "vitest";

import { createDeadlinesRouter } from "../../src/deadlines/routes.js";
import { DEADLINE_DISCLAIMER, DEADLINE_RULES, type DeadlineRule } from "../../src/deadlines/rules.js";

// W14: the VERBATIM wording is pinned by tests/deadlines/rules.test.ts
// (L-LEGAL owns the constant). What this file asserts is the invariant
// that every computation carries it UNCHANGED, so it compares against the
// exported constant instead of a second copy that can silently rot.
const DISCLAIMER = DEADLINE_DISCLAIMER;

type App = ReturnType<typeof createDeadlinesRouter>;

async function post(app: App, body: unknown): Promise<Response> {
  return app.request("/v1/deadlines/compute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface ErrorBody {
  error: { kind: string; message: string; issues?: { path: string; message: string }[] };
}

async function expect400(response: Response, kind: string, path?: string): Promise<ErrorBody> {
  expect(response.status).toBe(400);
  const body = (await response.json()) as ErrorBody;
  expect(body.error.kind).toBe(kind);
  expect(body.error.message.length).toBeGreaterThan(5);
  const text = JSON.stringify(body);
  expect(text).not.toContain("Required");
  expect(text).not.toContain("Invalid input");
  if (path !== undefined) {
    expect(body.error.issues?.map((issue) => issue.path)).toContain(path);
  }
  return body;
}

describe("GET /v1/deadlines/rules", () => {
  it("lists every rule with reference + verified blocks and the verbatim disclaimer", async () => {
    const app = createDeadlinesRouter();
    const response = await app.request("/v1/deadlines/rules");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rules: DeadlineRule[];
      disclaimer: string;
      adliTatil: { label: string };
    };
    expect(body.rules).toHaveLength(DEADLINE_RULES.length);
    expect(body.rules.length).toBeGreaterThanOrEqual(21);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.adliTatil.label).toBe("20 Temmuz–31 Ağustos");
    for (const rule of body.rules) {
      expect(rule.reference.label.length).toBeGreaterThan(0);
      expect(["dogrulandi", "dogrulanmadi"]).toContain(rule.verified.status);
      expect(rule.verified.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(typeof rule.computable).toBe("boolean");
    }
  });

  it("serves an injected registry subset", async () => {
    const one = DEADLINE_RULES.find((rule) => rule.id === "hmk-cevap") as DeadlineRule;
    const app = createDeadlinesRouter({ rules: [one] });
    const response = await app.request("/v1/deadlines/rules");
    const body = (await response.json()) as { rules: DeadlineRule[] };
    expect(body.rules.map((rule) => rule.id)).toEqual(["hmk-cevap"]);
    await expect400(await post(app, { ruleId: "hmk-istinaf", startDate: "2026-09-03" }), "INVALID_REQUEST", "ruleId");
  });
});

describe("GET /v1/deadlines/holidays", () => {
  it("returns the year's holiday markers and the adli tatil window", async () => {
    const app = createDeadlinesRouter();
    const response = await app.request("/v1/deadlines/holidays?year=2026");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      year: number;
      holidays: { date: string; kind: string; name: string }[];
      adliTatil: { start: string; end: string };
      religiousCalendarCovered: boolean;
      source: string;
      disclaimer: string;
    };
    expect(body.year).toBe(2026);
    expect(body.holidays.map((h) => h.date)).toContain("2026-07-15");
    expect(body.holidays.find((h) => h.date === "2026-03-20")?.kind).toBe("dini");
    expect(body.holidays.find((h) => h.date === "2026-03-19")?.kind).toBe("yarim");
    expect(body.adliTatil).toEqual({ start: "2026-07-20", end: "2026-08-31", label: "20 Temmuz–31 Ağustos" });
    expect(body.religiousCalendarCovered).toBe(true);
    expect(body.source).toContain("Diyanet takvimi — doğrulayın");
    expect(body.disclaimer).toBe(DISCLAIMER);
  });

  it("flags uncovered years and rejects garbage", async () => {
    const app = createDeadlinesRouter();
    const uncovered = (await (await app.request("/v1/deadlines/holidays?year=2031")).json()) as {
      religiousCalendarCovered: boolean;
      holidays: { kind: string }[];
    };
    expect(uncovered.religiousCalendarCovered).toBe(false);
    expect(uncovered.holidays.filter((h) => h.kind === "dini")).toHaveLength(0);
    await expect400(await app.request("/v1/deadlines/holidays?year=abc"), "INVALID_REQUEST", "year");
    await expect400(await app.request("/v1/deadlines/holidays"), "INVALID_REQUEST", "year");
  });
});

describe("POST /v1/deadlines/compute", () => {
  it("computes a rule-based deadline (HMK cevap, tebliğ 03.09.2026 -> 17.09.2026 Perşembe)", async () => {
    const app = createDeadlinesRouter();
    const response = await post(app, { ruleId: "hmk-cevap", startDate: "2026-09-03" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dueDate: string;
      dueWeekday: string;
      rule: { id: string; reference: { label: string } } | null;
      steps: string[];
      warnings: string[];
      disclaimer: string;
      dueDateTr: string;
    };
    expect(body.dueDate).toBe("2026-09-17");
    expect(body.dueWeekday).toBe("Perşembe");
    expect(body.rule?.id).toBe("hmk-cevap");
    expect(body.rule?.reference.label).toBe("HMK m.127/1");
    expect(body.steps.join("\n")).toContain("17.09.2026 (Perşembe)");
    expect(body.dueDateTr).toBe("17.09.2026");
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it("computes a custom period (rule: null) and honours applyAdliTatil", async () => {
    const app = createDeadlinesRouter();
    const plain = (await (await post(app, { custom: { value: 10, unit: "gun" }, startDate: "2026-07-15" })).json()) as {
      dueDate: string;
      rule: unknown;
      adliTatil: { applied: boolean };
    };
    expect(plain.rule).toBeNull();
    expect(plain.dueDate).toBe("2026-07-27"); // 25.07 Cumartesi -> Pazartesi, no extension by default
    expect(plain.adliTatil.applied).toBe(false);

    const extended = (await (
      await post(app, { custom: { value: 10, unit: "gun" }, startDate: "2026-07-15", applyAdliTatil: true })
    ).json()) as { dueDate: string; adliTatil: { applied: boolean } };
    expect(extended.dueDate).toBe("2026-09-07");
    expect(extended.adliTatil.applied).toBe(true);
  });

  it("returns typed 400s with Turkish messages", async () => {
    const app = createDeadlinesRouter();

    const notJson = await app.request("/v1/deadlines/compute", { method: "POST", body: "{{{" });
    await expect400(notJson, "INVALID_REQUEST");

    await expect400(await post(app, { ruleId: "hmk-cevap" }), "INVALID_REQUEST", "startDate");
    const missing = await expect400(await post(app, { ruleId: "hmk-cevap" }), "INVALID_REQUEST", "startDate");
    expect(missing.error.issues?.find((i) => i.path === "startDate")?.message).toBe("Bu alan zorunludur.");

    await expect400(await post(app, { ruleId: "hmk-cevap", startDate: "03.09.2026" }), "INVALID_REQUEST", "startDate");
    await expect400(await post(app, { ruleId: "hmk-cevap", startDate: "2026-02-30" }), "INVALID_REQUEST", "startDate");
    await expect400(await post(app, { ruleId: "yok", startDate: "2026-09-03" }), "INVALID_REQUEST", "ruleId");
    await expect400(await post(app, { startDate: "2026-09-03" }), "INVALID_REQUEST", "ruleId");
    await expect400(
      await post(app, { ruleId: "hmk-cevap", custom: { value: 3, unit: "gun" }, startDate: "2026-09-03" }),
      "INVALID_REQUEST",
      "ruleId",
    );
    await expect400(
      await post(app, { custom: { value: 0, unit: "gun" }, startDate: "2026-09-03" }),
      "INVALID_REQUEST",
      "custom.value",
    );
    await expect400(
      await post(app, { custom: { value: 3, unit: "saat" }, startDate: "2026-09-03" }),
      "INVALID_REQUEST",
      "custom.unit",
    );
    const unknownField = await expect400(
      await post(app, { ruleId: "hmk-cevap", startDate: "2026-09-03", foo: 1 }),
      "INVALID_REQUEST",
    );
    expect(JSON.stringify(unknownField)).toContain("Tanınmayan alan.");
    await expect400(
      await post(app, { ruleId: "hmk-cevap", startDate: "2026-09-03", applyAdliTatil: "evet" }),
      "INVALID_REQUEST",
      "applyAdliTatil",
    );
  });

  it("answers RULE_NOT_COMPUTABLE for note-only rules", async () => {
    const app = createDeadlinesRouter();
    const body = await expect400(await post(app, { ruleId: "hmk-islah", startDate: "2026-09-03" }), "RULE_NOT_COMPUTABLE", "ruleId");
    expect(body.error.message).toContain("hesaplanamaz");
  });
});

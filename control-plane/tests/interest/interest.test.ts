import { describe, expect, it } from "vitest";

import { computeInterest, InterestInputError } from "../../src/interest/calc.js";
import { INTEREST_DISCLAIMER, YASAL_FAIZ_PERIODS } from "../../src/interest/rates.js";
import { createInterestRouter } from "../../src/interest/routes.js";

describe("faiz hesabı — simple interest, day by day, never a guessed rate", () => {
  it("splits a year across the 01.06.2024 change of the kanunî faiz", () => {
    const r = computeInterest({ kind: "yasal", principal: 100_000, from: "2024-01-01", to: "2024-12-31" });
    expect(r.rows.map((x) => [x.from, x.to, x.days, x.annualPercent])).toEqual([
      ["2024-01-01", "2024-05-31", 152, 9],
      ["2024-06-01", "2024-12-30", 213, 24],
    ]);
    // 100 000 × 9 × 152 / 36 500 = 3 747,945… ; 100 000 × 24 × 213 / 36 500 = 14 005,479…
    expect(r.rows.map((x) => x.interest)).toEqual([3747.95, 14005.48]);
    expect(r.totalInterest).toBe(17753.42);
    expect(r.totalWithPrincipal).toBe(117753.42);
    expect(r.totalDays).toBe(365);
    expect(r.usesUnverifiedRate).toBe(true);
    expect(r.disclaimer).toBe(INTEREST_DISCLAIMER);
  });

  it("answers ORAN_GEREKLI and a null total when the avans faizi rate is unknown", () => {
    const r = computeInterest({ kind: "ticari-avans", principal: 50_000, from: "2025-03-01", to: "2025-09-01" });
    expect(r.totalInterest).toBeNull();
    expect(r.totalWithPrincipal).toBeNull();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ durum: "ORAN_GEREKLI", annualPercent: null, interest: null });
    expect(r.missing).toEqual([{ from: "2025-03-01", to: "2025-08-31" }]);
    expect(r.notes.join(" ")).toContain("ColleX bu oranları bilmez");
  });

  it("uses the lawyer's rate with its source, and still asks for the uncovered days", () => {
    const r = computeInterest({
      kind: "ticari-avans",
      principal: 10_000,
      from: "2025-01-01",
      to: "2025-03-01",
      periods: [{ from: "2025-01-01", to: "2025-01-31", annualPercent: 36.5, source: "TCMB duyurusu, 2024/2. dönem" }],
    });
    expect(r.rows[0]).toMatchObject({ days: 31, annualPercent: 36.5, status: "avukat-girdi", source: "TCMB duyurusu, 2024/2. dönem", interest: 310 });
    expect(r.rows[1]).toMatchObject({ from: "2025-02-01", to: "2025-02-28", durum: "ORAN_GEREKLI" });
    expect(r.totalInterest).toBeNull();
  });

  it("lets a lawyer's period override ColleX's own figure on the days it covers", () => {
    const r = computeInterest({
      kind: "yasal",
      principal: 1000,
      from: "2024-06-01",
      to: "2024-07-01",
      periods: [{ from: "2024-06-01", to: "2024-06-30", annualPercent: 24, source: "RG metni ile karşılaştırıldı" }],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.status).toBe("avukat-girdi");
    expect(r.usesUnverifiedRate).toBe(false);
  });

  it("does not know the kanunî faiz before 2006 and says so", () => {
    const r = computeInterest({ kind: "yasal", principal: 1000, from: "2005-12-01", to: "2006-02-01" });
    expect(r.rows[0]).toMatchObject({ from: "2005-12-01", to: "2005-12-31", durum: "ORAN_GEREKLI" });
    expect(r.rows[1]).toMatchObject({ from: "2006-01-01", annualPercent: 9 });
    expect(r.totalInterest).toBeNull();
    expect(r.notes.join(" ")).toContain("01.01.2006'dan önceki");
  });

  it("honours a 360-day year when the contract says so", () => {
    const r = computeInterest({
      kind: "sozlesmesel",
      principal: 36_000,
      from: "2025-01-01",
      to: "2025-01-11",
      dayBasis: 360,
      periods: [{ from: "2025-01-01", to: "2025-12-31", annualPercent: 10, source: "Sözleşme m. 7" }],
    });
    expect(r.totalInterest).toBe(100);
  });

  it("refuses overlapping periods, reversed dates and a missing source", () => {
    expect(() =>
      computeInterest({
        kind: "sozlesmesel",
        principal: 1,
        from: "2025-01-01",
        to: "2025-02-01",
        periods: [
          { from: "2025-01-01", to: "2025-01-20", annualPercent: 10, source: "a" },
          { from: "2025-01-15", to: "2025-01-31", annualPercent: 12, source: "b" },
        ],
      }),
    ).toThrow(InterestInputError);
    expect(() => computeInterest({ kind: "yasal", principal: 1, from: "2025-02-01", to: "2025-01-01" })).toThrow(/sonra olmalı/u);
    expect(() => computeInterest({ kind: "yasal", principal: 1, from: "2025-02-30", to: "2025-03-01" })).toThrow(/takvim günü/u);
    expect(() =>
      computeInterest({
        kind: "sozlesmesel",
        principal: 1,
        from: "2025-01-01",
        to: "2025-02-01",
        periods: [{ from: "2025-01-01", to: "2025-01-31", annualPercent: 10, source: "  " }],
      }),
    ).toThrow(/kaynağını/u);
  });

  it("keeps every built-in rate unverified until its Resmî Gazete text has been compared", () => {
    for (const p of YASAL_FAIZ_PERIODS) {
      expect(p.status).toBe("dogrulanmadi");
      expect(p.nasilDogrulanir).toMatch(/Resmî Gazete/u);
    }
  });
});

describe("/v1/interest routes", () => {
  const app = createInterestRouter();
  const post = (body: unknown) =>
    app.request("/v1/interest/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("lists the rates with the disclaimer", async () => {
    const res = await app.request("/v1/interest/rates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disclaimer: string; kinds: unknown[]; periods: unknown[] };
    expect(body.disclaimer).toBe(INTEREST_DISCLAIMER);
    expect(body.kinds).toHaveLength(3);
    expect(body.periods).toHaveLength(2);
  });

  it("computes, and names a rejected field in Turkish", async () => {
    const ok = await post({ kind: "yasal", principal: 100000, from: "2024-01-01", to: "2024-12-31" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { totalInterest: number }).totalInterest).toBe(17753.42);
    const bad = await post({ kind: "yasal", principal: 1, from: "2024-01-01", to: "2024-02-01", faiz: 3 });
    expect(bad.status).toBe(400);
    const issues = ((await bad.json()) as { error: { issues: Array<{ path: string }> } }).error.issues;
    expect(issues.map((i) => i.path)).toContain("faiz");
    const reversed = await post({ kind: "yasal", principal: 1, from: "2024-03-01", to: "2024-02-01" });
    expect(reversed.status).toBe(400);
    expect(JSON.stringify(await reversed.json())).toContain("sonra olmalı");
  });
});

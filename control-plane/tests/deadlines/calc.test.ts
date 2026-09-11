/**
 * computeDeadline — table-driven cases (start day excluded, week/month/year
 * arithmetic, weekend + holiday roll-forward, HMK m.104 / İYUK m.8/3 adli
 * tatil extension, CMK m.331 warning-only behaviour, custom periods) plus the
 * invariants every computation must satisfy (verbatim disclaimer, GG.AA.YYYY
 * dates in every user-facing string, due date is a working day).
 */

import { describe, expect, it } from "vitest";

import {
  computeDeadline,
  DeadlineInputError,
  type ComputeDeadlineInput,
} from "../../src/deadlines/calc.js";
import { parseIsoDate, weekdayName } from "../../src/deadlines/dates.js";
import { isWorkingDay } from "../../src/deadlines/holidays.js";
import { DEADLINE_DISCLAIMER, type DeadlineRule } from "../../src/deadlines/rules.js";

// W14: the VERBATIM wording is pinned by tests/deadlines/rules.test.ts
// (L-LEGAL owns the constant). What this file asserts is the invariant
// that every computation carries it UNCHANGED, so it compares against the
// exported constant instead of a second copy that can silently rot.
const DISCLAIMER = DEADLINE_DISCLAIMER;

interface Case {
  name: string;
  input: ComputeDeadlineInput;
  dueDate: string;
  dueWeekday?: string;
  baseDueDate?: string;
  applied?: boolean;
  stepsInclude?: string[];
  warningsInclude?: string[];
  warningsExclude?: string[];
}

const CASES: Case[] = [
  {
    name: "HMK cevap: tebliğ Perşembe 03.09.2026 -> 17.09.2026 Perşembe (2 hafta, tebliğ günü sayılmaz)",
    input: { ruleId: "hmk-cevap", startDate: "2026-09-03" },
    dueDate: "2026-09-17",
    dueWeekday: "Perşembe",
    baseDueDate: "2026-09-17",
    applied: false,
    stepsInclude: [
      "Tebliğ tarihi 03.09.2026 (Perşembe)",
      "ertesi gün 04.09.2026",
      "HMK m.92/1",
      "HMK m.127/1",
      "17.09.2026 (Perşembe)",
      "hafta sonu veya resmî tatile denk gelmiyor",
      "Son gün: 17.09.2026 (Perşembe)",
    ],
    warningsInclude: ["Tebligat Kanunu m.7/a"],
  },
  {
    name: "THH itiraz 15 gün: start Cuma 04.09.2026, ends Cumartesi 19.09 -> Pazartesi 21.09.2026 (HMK m.93)",
    input: { ruleId: "thh-itiraz", startDate: "2026-09-04" },
    dueDate: "2026-09-21",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-09-19",
    stepsInclude: ["19.09.2026 (Cumartesi)", "hafta sonu (Cumartesi)", "21.09.2026 (Pazartesi)", "HMK m.93"],
  },
  {
    name: "custom 8 gün: Cuma -> Cumartesi -> Pazartesi, rule null, özel süre warning",
    input: { custom: { value: 8, unit: "gun" }, startDate: "2026-09-04" },
    dueDate: "2026-09-14",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-09-12",
    applied: false,
    stepsInclude: ["8 gün (özel süre)"],
    warningsInclude: ["Özel süre"],
  },
  {
    name: "HMK istinaf ending 30 Ağustos 2026 (adli tatil) -> 07.09.2026 Pazartesi (HMK m.104)",
    input: { ruleId: "hmk-istinaf", startDate: "2026-08-16" },
    dueDate: "2026-09-07",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-08-30",
    applied: true,
    stepsInclude: ["30.08.2026", "HMK m.102", "HMK m.104", "07.09.2026 (Pazartesi)"],
    warningsInclude: ["HMK m.103", "31.08.2026"],
  },
  {
    name: "same with applyAdliTatil=false -> 30.08 is Pazar + Zafer Bayramı -> 31.08.2026, warning names 07.09.2026",
    input: { ruleId: "hmk-istinaf", startDate: "2026-08-16", applyAdliTatil: false },
    dueDate: "2026-08-31",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-08-30",
    applied: false,
    stepsInclude: ["Zafer Bayramı", "hafta sonu (Pazar)", "uzama uygulanmadı"],
    warningsInclude: ["applyAdliTatil=false", "07.09.2026"],
  },
  {
    name: "7 Eylül on a Sunday (2025) rolls to 08.09.2025",
    input: { ruleId: "hmk-cevap", startDate: "2025-08-16" },
    dueDate: "2025-09-08",
    dueWeekday: "Pazartesi",
    baseDueDate: "2025-08-30",
    applied: true,
    stepsInclude: ["07.09.2025 (Pazar)", "08.09.2025 (Pazartesi)"],
  },
  {
    name: "HMK cevap tebliğ 10.07.2026: last day 24.07 inside tatil -> 07.09.2026",
    input: { ruleId: "hmk-cevap", startDate: "2026-07-10" },
    dueDate: "2026-09-07",
    baseDueDate: "2026-07-24",
    applied: true,
  },
  {
    name: "weekend roll pushes 19.07.2026 (Pazar) into the tatil -> 20.07.2026, NO extension, dispute warning",
    input: { ruleId: "hmk-cevap", startDate: "2026-07-05" },
    dueDate: "2026-07-20",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-07-19",
    applied: false,
    warningsInclude: ["tartışmalıdır", "20.07.2026"],
  },
  {
    name: "İYUK idare 60 gün: 15.01.2026 -> 16.03.2026 Pazartesi",
    input: { ruleId: "iyuk-dava-idare", startDate: "2026-01-15" },
    dueDate: "2026-03-16",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-03-16",
    stepsInclude: ["60 gün", "İYUK m.7/1", "İYUK m.8/1", "60. gün 16.03.2026 (Pazartesi)"],
  },
  {
    name: "İYUK idare 60 gün ending on Ramazan Bayramı 20.03.2026 (Cuma) -> 23.03.2026 Pazartesi",
    input: { ruleId: "iyuk-dava-idare", startDate: "2026-01-19" },
    dueDate: "2026-03-23",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-03-20",
    stepsInclude: ["Ramazan Bayramı", "İYUK m.8/2", "23.03.2026 (Pazartesi)"],
    warningsInclude: ["idari izin"],
  },
  {
    name: "İYUK vergi 30 gün ending in çalışmaya ara verme -> 07.09.2026 with İYUK m.61 warning",
    input: { ruleId: "iyuk-dava-vergi", startDate: "2026-07-21" },
    dueDate: "2026-09-07",
    baseDueDate: "2026-08-20",
    applied: true,
    stepsInclude: ["İYUK m.8/3", "çalışmaya ara verme", "İYUK m.61"],
    warningsInclude: ["İYUK m.61/1", "20.08.2026 (Perşembe)"],
  },
  {
    name: "İİK m.62 7 gün: 03.09.2026 -> 10.09.2026 Perşembe, İİK m.19 cited",
    input: { ruleId: "iik-odeme-emri-itiraz", startDate: "2026-09-03" },
    dueDate: "2026-09-10",
    dueWeekday: "Perşembe",
    stepsInclude: ["İİK m.19/1", "7 gün (İİK m.62/1)", "7. gün 10.09.2026 (Perşembe)"],
  },
  {
    name: "İİK m.62 during adli tatil: rule has no extension -> 08.08 Cumartesi -> 10.08.2026 with warning",
    input: { ruleId: "iik-odeme-emri-itiraz", startDate: "2026-08-01" },
    dueDate: "2026-08-10",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-08-08",
    applied: false,
    warningsInclude: ["uzaması uygulanmadı", "İİK m.62/1"],
  },
  {
    name: "İİK m.62 forced applyAdliTatil=true -> 07.09.2026 with a 'zorlandı' warning",
    input: { ruleId: "iik-odeme-emri-itiraz", startDate: "2026-08-01", applyAdliTatil: true },
    dueDate: "2026-09-07",
    applied: true,
    warningsInclude: ["zorlandı", "10.08.2026"],
  },
  {
    name: "İİK m.168 kambiyo 5 gün: 03.09.2026 -> 08.09.2026 Salı",
    input: { ruleId: "iik-kambiyo-itiraz", startDate: "2026-09-03" },
    dueDate: "2026-09-08",
    dueWeekday: "Salı",
  },
  {
    name: "CMK itiraz 2 hafta from öğrenme 03.09.2026 -> 17.09.2026, CMK m.39 cited, öğrenme warning",
    input: { ruleId: "cmk-itiraz", startDate: "2026-09-03" },
    dueDate: "2026-09-17",
    dueWeekday: "Perşembe",
    stepsInclude: ["Öğrenme tarihi 03.09.2026", "CMK m.39/1", "CMK m.268/1", "CMK m.39/2-3"],
    warningsInclude: ["öğrenme tarihi ispat konusudur"],
    warningsExclude: ["CMK m.331/4"],
  },
  {
    name: "CMK istinaf during adli tatil: no extension, m.331 + tutuklu warning, Cumartesi -> Pazartesi",
    input: { ruleId: "cmk-istinaf", startDate: "2026-07-25" },
    dueDate: "2026-08-10",
    dueWeekday: "Pazartesi",
    baseDueDate: "2026-08-08",
    applied: false,
    stepsInclude: ["UYGULANMADI", "CMK m.39/4"],
    warningsInclude: ["CMK m.331/4", "tutuklu", "tefhimden"],
  },
  {
    name: "CMK temyiz with a pre-01.06.2024 start date warns about the 7499 transition",
    input: { ruleId: "cmk-temyiz", startDate: "2024-05-15" },
    dueDate: "2024-05-29",
    dueWeekday: "Çarşamba",
    warningsInclude: ["on beş gün", "7499", "01.06.2024", "2024 yılı için bayram çakışması"],
  },
  {
    name: "CMK with applyAdliTatil=true does NOT apply HMK m.104 (warned)",
    input: { ruleId: "cmk-istinaf", startDate: "2026-07-25", applyAdliTatil: true },
    dueDate: "2026-08-10",
    applied: false,
    warningsInclude: ["CMK m.331", "applyAdliTatil=true"],
  },
  {
    name: "custom 1 ay from 31.01.2028 -> 29.02.2028 Salı (no such day -> month's last day, leap year)",
    input: { custom: { value: 1, unit: "ay" }, startDate: "2028-01-31" },
    dueDate: "2028-02-29",
    dueWeekday: "Salı",
    stepsInclude: ["ayın son günü", "29.02.2028 (Salı)", "HMK m.92/2"],
  },
  {
    name: "İş K. m.20 1 ay from 31.01.2027 -> 28.02.2027 Pazar -> 01.03.2027 Pazartesi",
    input: { ruleId: "is-ise-iade-arabulucu-basvuru", startDate: "2027-01-31" },
    dueDate: "2027-03-01",
    dueWeekday: "Pazartesi",
    baseDueDate: "2027-02-28",
    stepsInclude: ["ayın son günü", "28.02.2027 (Pazar)", "01.03.2027 (Pazartesi)"],
  },
  {
    name: "İİK m.67 1 yıl from 28.02.2026 -> 28.02.2027 Pazar -> 01.03.2027",
    input: { ruleId: "iik-itirazin-iptali", startDate: "2026-02-28" },
    dueDate: "2027-03-01",
    baseDueDate: "2027-02-28",
    stepsInclude: ["1 yıl", "İİK m.19/2", "yıl ile belirlenen süre"],
  },
  {
    name: "İİK m.68 6 ay from 31.03.2026 -> 30.09.2026 Çarşamba (clamped)",
    input: { ruleId: "iik-itirazin-kaldirilmasi", startDate: "2026-03-31" },
    dueDate: "2026-09-30",
    dueWeekday: "Çarşamba",
    stepsInclude: ["ayın son günü", "Eylül 2026"],
  },
  {
    name: "custom 1 yıl clamps 29.02.2028 -> 28.02.2029 Çarşamba and flags the uncovered year",
    input: { custom: { value: 1, unit: "yil" }, startDate: "2028-02-29" },
    dueDate: "2029-02-28",
    dueWeekday: "Çarşamba",
    warningsInclude: ["2029 yılı için bayram çakışması"],
  },
  {
    name: "AYM 30 gün: tebliğ 01.07.2026 -> 31.07.2026 Cuma; inside tatil but the rule has no extension (warned)",
    input: { ruleId: "aym-bireysel-basvuru", startDate: "2026-07-01" },
    dueDate: "2026-07-31",
    dueWeekday: "Cuma",
    applied: false,
    warningsInclude: ["uzaması uygulanmadı"],
  },
  {
    // W14 (B-11, L-LEGAL): this rule was WRONG before this wave — it carried
    // the pre-01.06.2024 text (10 gün, tefhimden). 7499 s.K. m.37 made it two
    // weeks from TEBLİĞ, and the case now pins the corrected computation. The
    // legal content itself is asserted by tests/deadlines/rules.test.ts.
    name: "İİK m.363 (7499 s.K. sonrası, 2 hafta / tebliğ): 03.09.2026 -> 17.09.2026 Perşembe",
    input: { ruleId: "iik-icra-mahkemesi-istinaf", startDate: "2026-09-03" },
    dueDate: "2026-09-17",
    dueWeekday: "Perşembe",
    baseDueDate: "2026-09-17",
    applied: false,
    stepsInclude: ["03.09.2026 (Perşembe)", "17.09.2026 (Perşembe)"],
  },
  {
    name: "half-day arife: due on 26.05.2026 (Kurban Bayramı arifesi) stays a working day, warns 'öğleden önce'",
    input: { custom: { value: 4, unit: "gun" }, startDate: "2026-05-22" },
    dueDate: "2026-05-26",
    dueWeekday: "Salı",
    warningsInclude: ["öğleden önce", "arifesi"],
  },
  {
    name: "half-day 28 Ekim 2026 stays a working day with a warning",
    input: { custom: { value: 7, unit: "gun" }, startDate: "2026-10-21" },
    dueDate: "2026-10-28",
    dueWeekday: "Çarşamba",
    warningsInclude: ["28 Ekim"],
  },
  {
    name: "due on 15 Temmuz 2026 (Çarşamba, holiday) -> 16.07.2026 Perşembe; before the tatil so no extension",
    input: { custom: { value: 7, unit: "gun" }, startDate: "2026-07-08" },
    dueDate: "2026-07-16",
    dueWeekday: "Perşembe",
    baseDueDate: "2026-07-15",
    applied: false,
    stepsInclude: ["Demokrasi ve Millî Birlik Günü", "16.07.2026 (Perşembe)"],
  },
  {
    name: "custom 10 gün with applyAdliTatil=true ending 25.07.2026 -> 07.09.2026 (özel süre warned)",
    input: { custom: { value: 10, unit: "gun" }, startDate: "2026-07-15", applyAdliTatil: true },
    dueDate: "2026-09-07",
    baseDueDate: "2026-07-25",
    applied: true,
    warningsInclude: ["Özel süre için adli tatil uzaması", "27.07.2026"],
  },
];

const ISO_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b/u;

describe("computeDeadline — table", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const result = computeDeadline(testCase.input);
      expect(result.dueDate).toBe(testCase.dueDate);
      if (testCase.dueWeekday !== undefined) expect(result.dueWeekday).toBe(testCase.dueWeekday);
      if (testCase.baseDueDate !== undefined) expect(result.baseDueDate).toBe(testCase.baseDueDate);
      if (testCase.applied !== undefined) expect(result.adliTatil.applied).toBe(testCase.applied);
      const steps = result.steps.join("\n");
      const warnings = result.warnings.join("\n");
      for (const fragment of testCase.stepsInclude ?? []) {
        expect(steps, `steps should contain: ${fragment}`).toContain(fragment);
      }
      for (const fragment of testCase.warningsInclude ?? []) {
        expect(warnings, `warnings should contain: ${fragment}`).toContain(fragment);
      }
      for (const fragment of testCase.warningsExclude ?? []) {
        expect(warnings, `warnings must not contain: ${fragment}`).not.toContain(fragment);
      }

      // Invariants for every computation.
      expect(result.disclaimer).toBe(DISCLAIMER);
      expect(result.disclaimer).toBe(DEADLINE_DISCLAIMER);
      expect(result.steps.length).toBeGreaterThanOrEqual(4);
      expect(result.steps[result.steps.length - 1]).toContain("Son gün:");
      const due = parseIsoDate(result.dueDate);
      expect(due).toBeDefined();
      expect(isWorkingDay(due!)).toBe(true);
      expect(result.dueWeekday).toBe(weekdayName(due!));
      expect(result.dueDateTr).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
      expect(result.startDate).toBe(testCase.input.startDate);
      // No ISO dates leak into user-facing text (GG.AA.YYYY everywhere).
      for (const line of [...result.steps, ...result.warnings]) {
        expect(line, line).not.toMatch(ISO_IN_TEXT);
        expect(line).not.toContain("Required");
        expect(line).not.toContain("undefined");
      }
      if (testCase.input.ruleId !== undefined) {
        expect(result.rule?.id).toBe(testCase.input.ruleId);
        expect(result.procedure).toBe(result.rule?.procedure);
      } else {
        expect(result.rule).toBeNull();
        expect(result.procedure).toBe("ozel");
        expect(result.startKind).toBe("ozel");
      }
      if (result.adliTatil.applied) {
        expect(result.adliTatil.baseInAdliTatil).toBe(true);
        expect(result.adliTatil.dueDateWithoutExtension).not.toBeNull();
      } else {
        expect(result.adliTatil.dueDateWithoutExtension).toBeNull();
      }
    });
  }
});

describe("computeDeadline — determinism and extras", () => {
  it("is deterministic (same input, same output)", () => {
    const a = computeDeadline({ ruleId: "hmk-cevap", startDate: "2026-09-03" });
    const b = computeDeadline({ ruleId: "hmk-cevap", startDate: "2026-09-03" });
    expect(b).toEqual(a);
  });

  it("uses an injected rule registry", () => {
    const fake: DeadlineRule = {
      id: "fake-3-gun",
      title: "Sahte 3 gün",
      procedure: "Diğer",
      period: { value: 3, unit: "gun" },
      periodLabel: "3 gün",
      startKind: "teblig",
      reference: { legislationNo: "0", article: "1", label: "Sahte m.1" },
      notes: ["test"],
      adliTatilApplies: false,
      // W14: L-LEGAL added these two required fields to DeadlineRule in the
      // same wave; the injected fixture carries them so the registry
      // injection point stays typed.
      adliTatileTabi: false,
      nasilDogrulanir: "Sahte kural — doğrulama yolu yok (yalnız test).",
      computable: true,
      verified: { status: "dogrulanmadi", date: "2026-09-02", source: "test" },
    };
    const result = computeDeadline({ ruleId: "fake-3-gun", startDate: "2026-09-03" }, { rules: [fake] });
    expect(result.dueDate).toBe("2026-09-07"); // 06.09 Pazar -> 07.09 Pazartesi
    expect(() => computeDeadline({ ruleId: "hmk-cevap", startDate: "2026-09-03" }, { rules: [fake] })).toThrow(
      DeadlineInputError,
    );
  });

  it("echoes the period and label", () => {
    const result = computeDeadline({ ruleId: "iyuk-dava-idare", startDate: "2026-01-15" });
    expect(result.period).toEqual({ value: 60, unit: "gun" });
    expect(result.periodLabel).toBe("60 gün");
    expect(result.startKind).toBe("teblig");
    expect(result.holidayCalendarCovered).toBe(true);
  });
});

describe("computeDeadline — typed errors (Turkish messages, English codes)", () => {
  function expectError(input: ComputeDeadlineInput, kind: string, path: string): DeadlineInputError {
    let caught: unknown;
    try {
      computeDeadline(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DeadlineInputError);
    const error = caught as DeadlineInputError;
    expect(error.kind).toBe(kind);
    expect(error.path).toBe(path);
    expect(error.message).not.toContain("Required");
    expect(error.message.length).toBeGreaterThan(10);
    return error;
  }

  it("rejects an unknown rule id", () => {
    const error = expectError({ ruleId: "yok-boyle-kural", startDate: "2026-09-03" }, "INVALID_REQUEST", "ruleId");
    // W15: the sentence moved from "Süre kuralı bulunamadı ... GET
    // /v1/deadlines/rules ile listeleyin" to plain Turkish. The behaviour
    // pinned here is the same and now stricter: the message still names the
    // rejected id, and it no longer hands the lawyer an HTTP call to make.
    expect(error.message).toContain("listede yok");
    expect(error.message).toContain("yok-boyle-kural");
    expect(error.message).not.toMatch(/GET |\/v1\//);
  });

  it("rejects note-only rules with RULE_NOT_COMPUTABLE", () => {
    for (const id of ["hmk-islah", "hmk-karar-duzeltme", "is-arabuluculuk-dava-sarti"]) {
      const error = expectError({ ruleId: id, startDate: "2026-09-03" }, "RULE_NOT_COMPUTABLE", "ruleId");
      expect(error.message).toContain("hesaplanamaz");
    }
  });

  it("rejects both / neither of ruleId and custom", () => {
    expectError(
      { ruleId: "hmk-cevap", custom: { value: 3, unit: "gun" }, startDate: "2026-09-03" },
      "INVALID_REQUEST",
      "ruleId",
    );
    expectError({ startDate: "2026-09-03" }, "INVALID_REQUEST", "ruleId");
  });

  it("rejects impossible or malformed start dates", () => {
    expectError({ ruleId: "hmk-cevap", startDate: "2026-02-30" }, "INVALID_REQUEST", "startDate");
    expectError({ ruleId: "hmk-cevap", startDate: "03.09.2026" }, "INVALID_REQUEST", "startDate");
    expectError({ ruleId: "hmk-cevap", startDate: "" }, "INVALID_REQUEST", "startDate");
  });

  it("bounds custom periods per unit", () => {
    expectError({ custom: { value: 0, unit: "gun" }, startDate: "2026-09-03" }, "INVALID_REQUEST", "custom.value");
    expectError({ custom: { value: 1.5, unit: "gun" }, startDate: "2026-09-03" }, "INVALID_REQUEST", "custom.value");
    expectError({ custom: { value: 11, unit: "yil" }, startDate: "2026-09-03" }, "INVALID_REQUEST", "custom.value");
    expectError(
      { custom: { value: 1, unit: "saat" as unknown as "gun" }, startDate: "2026-09-03" },
      "INVALID_REQUEST",
      "custom.unit",
    );
  });
});

/**
 * Süre hesabı — deterministic procedural-deadline arithmetic (contract [S]).
 *
 * Mechanics (the same in HMK m.92-93, CMK m.39, İYUK m.8, İİK m.19):
 *   - the start day (tebliğ / tefhim / öğrenme) is never counted; a period of
 *     N days ends on start + N;
 *   - week/month/year periods end on the day of the last week/month/year that
 *     corresponds to the start day; a month without that day ends on its last
 *     day (HMK m.92/2);
 *   - a last day on a weekend or statutory holiday rolls forward to the first
 *     working day (HMK m.93);
 *   - HMK m.104 / İYUK m.8/3: a period whose last day falls in the adli tatil
 *     (20 Temmuz–31 Ağustos) is deemed extended by one week from the end of
 *     the tatil (= 7 Eylül), then the weekend/holiday roll applies again.
 *
 * Whenever the law's application is disputed (m.103 işler, İYUK m.61 tek
 * mahkemeli yerler, CMK m.331 tutuklu işler, tefhim vs. tebliğ, a last day
 * pushed into the tatil by a weekend) the calculator picks the EARLIER date
 * and says so in `warnings` — it never silently extends.
 *
 * Pure: no clock, no I/O, plain UTC date math. Every user-facing string is
 * Turkish with GG.AA.YYYY dates; machine codes stay English UPPER_SNAKE.
 */

import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysBetween,
  formatTrLong,
  isWeekend,
  monthNameTr,
  parseIsoDate,
  sameDate,
  toIsoDate,
  toTrDate,
  weekdayName,
  type CivilDate,
} from "./dates.js";
import {
  ADLI_TATIL_LABEL,
  adliTatilRange,
  firstWorkingDayOnOrAfter,
  halfDayInfo,
  holidaysForYear,
  isAdliTatil,
  isHoliday,
  periodTouchesAdliTatil,
  religiousCalendarCovers,
  RELIGIOUS_CALENDAR_YEARS,
} from "./holidays.js";
import {
  DEADLINE_DISCLAIMER,
  DEADLINE_RULES,
  DEADLINE_UNITS,
  findDeadlineRule,
  UNIT_LABELS_TR,
  type DeadlinePeriod,
  type DeadlineProcedure,
  type DeadlineRule,
  type DeadlineStartKind,
  type DeadlineUnit,
} from "./rules.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------


/** The console's own words for `applyAdliTatil` — a field name never reaches the lawyer. */
const ADLI_TATIL_SWITCH_TR = "“adli tatil uzatmasını uygula” seçeneği";
export interface ComputeDeadlineInput {
  ruleId?: string;
  custom?: DeadlinePeriod;
  /** YYYY-MM-DD — the tebliğ / tefhim / öğrenme date the rule starts from. */
  startDate: string;
  /** Override the rule's adliTatilApplies default. */
  applyAdliTatil?: boolean;
}

export interface AdliTatilOutcome {
  /** True when the HMK m.104 / İYUK m.8/3 one-week extension was applied. */
  applied: boolean;
  /** True when the m.92 last day itself fell inside the tatil window. */
  baseInAdliTatil: boolean;
  /** The (rolled) last day without the extension, when the extension changed the date. */
  dueDateWithoutExtension: string | null;
}

export interface DeadlineComputation {
  /** YYYY-MM-DD */
  dueDate: string;
  /** Pazartesi … Pazar */
  dueWeekday: string;
  rule: DeadlineRule | null;
  /** Turkish explanation, one line per step, dates as GG.AA.YYYY. */
  steps: string[];
  warnings: string[];
  disclaimer: string;
  // ---- additive (optional for consumers, always present here) ----
  startDate: string;
  startDateTr: string;
  dueDateTr: string;
  /** The m.92 last day before any tatil extension / weekend roll. */
  baseDueDate: string;
  baseDueDateTr: string;
  period: DeadlinePeriod;
  periodLabel: string;
  startKind: DeadlineStartKind | "ozel";
  procedure: DeadlineProcedure | "ozel";
  adliTatil: AdliTatilOutcome;
  /** False when a year touched by the computation has no religious-holiday data. */
  holidayCalendarCovered: boolean;
}

export type DeadlineErrorKind = "INVALID_REQUEST" | "RULE_NOT_COMPUTABLE";

export class DeadlineInputError extends Error {
  readonly kind: DeadlineErrorKind;
  readonly path: string | undefined;

  constructor(kind: DeadlineErrorKind, message: string, path?: string) {
    super(message);
    this.name = "DeadlineInputError";
    this.kind = kind;
    this.path = path;
  }
}

/** Upper bounds for custom periods, per unit. */
export const CUSTOM_PERIOD_MAX: Readonly<Record<DeadlineUnit, number>> = {
  gun: 3650,
  hafta: 520,
  ay: 120,
  yil: 10,
};

// ---------------------------------------------------------------------------
// Citations per procedure (what the steps quote)
// ---------------------------------------------------------------------------

interface Citations {
  start: string;
  units: string;
  holiday: string;
  adliTatil: string;
  adliTatilLaw: string;
  /** "adli tatil" or "çalışmaya ara verme". */
  tatilName: string;
}

const CITATIONS: Readonly<Record<DeadlineProcedure | "ozel", Citations>> = {
  HMK: {
    start: "HMK m.92/1",
    units: "HMK m.92/2",
    holiday: "HMK m.93",
    adliTatil: "HMK m.104",
    adliTatilLaw: "HMK m.102",
    tatilName: "adli tatil",
  },
  CMK: {
    start: "CMK m.39/1",
    units: "CMK m.39/2-3",
    holiday: "CMK m.39/4",
    adliTatil: "CMK m.331/4",
    adliTatilLaw: "CMK m.331/1",
    tatilName: "adli tatil",
  },
  İYUK: {
    start: "İYUK m.8/1",
    units: "İYUK m.8/1",
    holiday: "İYUK m.8/2",
    adliTatil: "İYUK m.8/3",
    adliTatilLaw: "İYUK m.61",
    tatilName: "çalışmaya ara verme",
  },
  İİK: {
    start: "İİK m.19/1",
    units: "İİK m.19/2",
    holiday: "İİK m.19/3",
    adliTatil: "HMK m.104",
    adliTatilLaw: "HMK m.102",
    tatilName: "adli tatil",
  },
  AYM: {
    start: "HMK m.92/1 (kıyasen)",
    units: "HMK m.92/2 (kıyasen)",
    holiday: "HMK m.93 (kıyasen)",
    adliTatil: "HMK m.104",
    adliTatilLaw: "HMK m.102",
    tatilName: "adli tatil",
  },
  Diğer: {
    start: "HMK m.92/1 (genel hüküm)",
    units: "HMK m.92/2 (genel hüküm)",
    holiday: "HMK m.93 (genel hüküm)",
    adliTatil: "HMK m.104",
    adliTatilLaw: "HMK m.102",
    tatilName: "adli tatil",
  },
  ozel: {
    start: "HMK m.92/1 (varsayılan)",
    units: "HMK m.92/2 (varsayılan)",
    holiday: "HMK m.93 (varsayılan)",
    adliTatil: "HMK m.104",
    adliTatilLaw: "HMK m.102",
    tatilName: "adli tatil",
  },
};

const START_LABELS: Readonly<Record<DeadlineStartKind | "ozel", string>> = {
  teblig: "Tebliğ tarihi",
  tefhim: "Tefhim tarihi (kararın yüze karşı açıklanması)",
  ogrenme: "Öğrenme tarihi",
  karar: "Başlangıç tarihi (karar / tutanak)",
  ozel: "Başlangıç tarihi",
};

const START_WARNINGS: Readonly<Partial<Record<DeadlineStartKind, string>>> = {
  teblig:
    "Tebliğ tarihi olarak tebliğ mazbatasındaki tarihi esas alın; elektronik tebligat, muhatabın elektronik adresine ulaştığı tarihi izleyen beşinci günün sonunda yapılmış sayılır (7201 sayılı Tebligat Kanunu m.7/a) — bu tarihi girin.",
  tefhim:
    "Süre tefhimden başlatıldı. Hüküm ilgilinin yokluğunda açıklanmışsa veya yalnız hüküm özeti tefhim edilip gerekçeli karar sonradan tebliğ edilmişse süre tebliğden başlar; bu durumda tebliğ tarihini girerek yeniden hesaplayın.",
  ogrenme:
    "Süre öğrenme tarihinden başlatıldı; öğrenme tarihi ispat konusudur. Tebliğ yapılmışsa tebliğ tarihini esas alın ve en erken tarihi tercih edin.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodLabelOf(period: DeadlinePeriod): string {
  return `${period.value} ${UNIT_LABELS_TR[period.unit]}`;
}

function validateCustomPeriod(custom: DeadlinePeriod): void {
  if (!DEADLINE_UNITS.includes(custom.unit)) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      "Özel süre birimi 'gun', 'hafta', 'ay' veya 'yil' olmalı.",
      "custom.unit",
    );
  }
  if (!Number.isInteger(custom.value) || custom.value < 1) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      "Özel süre değeri 1 veya daha büyük bir tam sayı olmalı.",
      "custom.value",
    );
  }
  const max = CUSTOM_PERIOD_MAX[custom.unit];
  if (custom.value > max) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      `Özel süre en fazla ${max} ${UNIT_LABELS_TR[custom.unit]} olabilir.`,
      "custom.value",
    );
  }
}

function endOfPeriod(start: CivilDate, period: DeadlinePeriod): { date: CivilDate; clamped: boolean } {
  switch (period.unit) {
    case "gun":
      return { date: addDays(start, period.value), clamped: false };
    case "hafta":
      return { date: addDays(start, period.value * 7), clamped: false };
    case "ay":
      return addMonths(start, period.value);
    case "yil":
      return addYears(start, period.value);
  }
}

function nonWorkingReasons(date: CivilDate): string[] {
  const reasons: string[] = [];
  if (isWeekend(date)) reasons.push(`hafta sonu (${weekdayName(date)})`);
  const holiday = isHoliday(date);
  if (holiday !== undefined) reasons.push(`resmî tatil (${holiday.name})`);
  return reasons;
}

function religiousHolidayNear(date: CivilDate, radiusDays: number): boolean {
  for (const year of new Set([date.year, addDays(date, -radiusDays).year, addDays(date, radiusDays).year])) {
    for (const holiday of holidaysForYear(year)) {
      if (holiday.kind !== "dini") continue;
      const day = parseIsoDate(holiday.date);
      if (day !== undefined && Math.abs(daysBetween(date, day)) <= radiusDays) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// computeDeadline
// ---------------------------------------------------------------------------

export interface ComputeDeadlineOptions {
  rules?: readonly DeadlineRule[];
}

export function computeDeadline(
  input: ComputeDeadlineInput,
  options: ComputeDeadlineOptions = {},
): DeadlineComputation {
  const rules = options.rules ?? DEADLINE_RULES;

  // ---- input validation (programmatic callers; the router also zod-checks) ----
  const start = parseIsoDate(typeof input.startDate === "string" ? input.startDate : "");
  if (start === undefined) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      "Başlangıç tarihi geçersiz; YYYY-AA-GG biçiminde gerçek bir takvim günü girin (ör. 2026-09-03).",
      "startDate",
    );
  }
  const hasRule = typeof input.ruleId === "string" && input.ruleId !== "";
  const hasCustom = input.custom !== undefined && input.custom !== null;
  if (hasRule && hasCustom) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      "ruleId ve custom birlikte verilemez; ya bir kural seçin ya da özel süre girin.",
      "ruleId",
    );
  }
  if (!hasRule && !hasCustom) {
    throw new DeadlineInputError(
      "INVALID_REQUEST",
      "ruleId (kural) veya custom (özel süre) alanlarından biri gerekli.",
      "ruleId",
    );
  }

  let rule: DeadlineRule | null = null;
  let period: DeadlinePeriod;
  if (hasRule) {
    const found = findDeadlineRule(input.ruleId as string, rules);
    if (found === undefined) {
      throw new DeadlineInputError(
        "INVALID_REQUEST",
        // W15: eski metin avukata "GET /v1/deadlines/rules" çalıştırmasını
        // söylüyordu; bunu yapabileceği bir yer yok. Yerine ekranda gerçekten
        // bulunan iki çıkış yolu yazıldı.
        `Bu süre kuralı listede yok: '${(input.ruleId as string).slice(0, 60)}'. Süre hesabı ekranındaki kural listesinden bir kural seçin, ya da listenin sonundaki “Özel süre” seçeneğiyle gün/hafta/ay/yıl sayısını kendiniz girin.`,
        "ruleId",
      );
    }
    if (!found.computable) {
      throw new DeadlineInputError(
        "RULE_NOT_COMPUTABLE",
        `'${found.title}' sabit bir süre içermez (${found.periodLabel}); hesaplanamaz. Kural notlarına bakın.`,
        "ruleId",
      );
    }
    rule = found;
    period = { ...found.period };
  } else {
    const custom = input.custom as DeadlinePeriod;
    validateCustomPeriod(custom);
    period = { value: custom.value, unit: custom.unit };
  }

  const procedure: DeadlineProcedure | "ozel" = rule?.procedure ?? "ozel";
  const startKind: DeadlineStartKind | "ozel" = rule?.startKind ?? "ozel";
  const cit = CITATIONS[procedure];
  const basis = rule !== null ? rule.reference.label : "özel süre";
  const steps: string[] = [];
  const warnings: string[] = [];

  // ---- 1. start day excluded ----
  steps.push(
    `${START_LABELS[startKind]} ${formatTrLong(start)}; süre ertesi gün ${toTrDate(addDays(start, 1))} işlemeye başlar — başlangıç günü sayılmaz (${cit.start}).`,
  );

  // ---- 2. m.92 end of period ----
  const { date: baseEnd, clamped } = endOfPeriod(start, period);
  const label = periodLabelOf(period);
  switch (period.unit) {
    case "gun":
      steps.push(`Süre: ${label} (${basis}); ${period.value}. gün ${formatTrLong(baseEnd)} — sürenin son günü.`);
      break;
    case "hafta":
      steps.push(
        `Süre: ${label} (${basis}); hafta ile belirlenen süre, başladığı güne son haftada karşılık gelen günde biter (${cit.units}): ${formatTrLong(baseEnd)}.`,
      );
      break;
    case "ay":
    case "yil":
      if (clamped) {
        steps.push(
          `Süre: ${label} (${basis}); ${monthNameTr(baseEnd.month)} ${baseEnd.year} ayında başlangıç gününe (${start.day}.) karşılık gelen gün bulunmadığından süre ayın son günü biter (${cit.units}): ${formatTrLong(baseEnd)}.`,
        );
      } else {
        steps.push(
          `Süre: ${label} (${basis}); ${UNIT_LABELS_TR[period.unit]} ile belirlenen süre, başladığı güne son ${UNIT_LABELS_TR[period.unit]}da karşılık gelen günde biter (${cit.units}): ${formatTrLong(baseEnd)}.`,
        );
      }
      break;
  }

  // ---- 3. adli tatil ----
  // A rule that says adli tatil does NOT apply (adliTatileTabi === false) is
  // never extended, whatever the switch says: the switch sits next to every
  // rule on screen, and "İİK m.62 itiraz from 25.07 → 07.09" is a lost
  // takip, not a cautious reading. The switch still decides for "belirsiz"
  // rules and for a custom period, where the lawyer's reading is the input.
  const ruleForbidsExtension = rule !== null && rule.adliTatileTabi === false;
  const apply =
    !ruleForbidsExtension && (input.applyAdliTatil ?? (rule !== null ? rule.adliTatilApplies : false));
  const baseInTatil = isAdliTatil(baseEnd);
  let candidate = baseEnd;
  let applied = false;
  let dueWithoutExtension: string | null = null;

  if (procedure === "CMK") {
    if (input.applyAdliTatil === true) {
      warnings.push(
        `${ADLI_TATIL_SWITCH_TR} CMK'da HMK m.104 uzamasını uygulamaz; ceza usulünde adli tatil etkisi CMK m.331'e tabidir (aşağıdaki uyarı).`,
      );
    }
    if (periodTouchesAdliTatil(start, baseEnd)) {
      steps.push(
        `Süre adli tatile (${ADLI_TATIL_LABEL}) rastlıyor; CMK m.331/4 uzatması UYGULANMADI — en erken tarih gösteriliyor, uyarıya bakın.`,
      );
      warnings.push(
        "CMK m.331/4: adli tatile rastlayan süreler işlemez ve tatilin bittiği günden itibaren üç gün uzatılmış sayılır; ancak tutuklu işlerde ve soruşturma evresinde süreler adli tatilde de işler (CMK m.331/2-3). Bu hesap uzatma uygulamadı ve en erken (ihtiyatlı) tarihi gösterir; tutuksuz işte gerçek son gün daha ileri olabilir — avukat kontrol etmelidir.",
      );
    } else {
      steps.push(`Süre adli tatile (${ADLI_TATIL_LABEL}) rastlamıyor.`);
    }
  } else if (baseInTatil) {
    const extended = addDays(adliTatilRange(baseEnd.year).end, 7);
    const rolledWithout = firstWorkingDayOnOrAfter(baseEnd);
    if (apply) {
      candidate = extended;
      applied = true;
      dueWithoutExtension = toIsoDate(rolledWithout);
      steps.push(
        `Son gün ${toTrDate(baseEnd)} ${cit.tatilName} dönemine (${ADLI_TATIL_LABEL}, ${cit.adliTatilLaw}) rastlıyor; süre, ${cit.tatilName === "adli tatil" ? "tatilin" : "ara vermenin"} bittiği günden itibaren bir hafta uzamış sayılır (${cit.adliTatil}): ${formatTrLong(extended)}.`,
      );
      if (procedure === "İYUK") {
        warnings.push(
          `Yargı çevresindeki bölge idare mahkemesinin bulunduğu il merkezi dışında kalan ve yalnız bir idare veya bir vergi mahkemesi bulunan yerlerdeki mahkemeler çalışmaya ara vermez (İYUK m.61/1); o hâlde uzama olmaz ve son gün ${formatTrLong(rolledWithout)} olur. İvedi yargılama usulünde (İYUK m.20/A) süreler de farklıdır.`,
        );
      } else {
        warnings.push(
          `HMK m.103'te sayılan, adli tatilde de görülen işlerde (ihtiyati tedbir/haciz ve delil tespiti, nafaka-soybağı-velayet-vesayet, işçi davaları, iflas-konkordato, çekişmesiz yargı, kanunen veya mahkemece ivedi sayılan işler vb.) süre uzamaz; bu durumda son gün ${formatTrLong(rolledWithout)} olur.`,
        );
      }
      if (rule !== null && rule.adliTatileTabi === "belirsiz") {
        warnings.push(
          `Bu kuralda ${cit.tatilName} uzamasının uygulanıp uygulanmayacağı tartışmalıdır (${rule.reference.label}); seçiminiz üzerine uzatılmış tarih gösteriliyor. Uzatılmamış (ihtiyatlı) son gün: ${formatTrLong(rolledWithout)} — dilekçeyi o güne kadar vermek bu riski ortadan kaldırır.`,
        );
      } else if (rule === null) {
        warnings.push(
          `Özel süre için adli tatil uzaması seçiminiz üzerine uygulandı; sürenin HMK'ya tabi bir dava/iş süresi olduğundan emin olun. Uzatılmamış son gün: ${formatTrLong(rolledWithout)}.`,
        );
      }
    } else {
      const rolledExtended = firstWorkingDayOnOrAfter(extended);
      steps.push(
        `Son gün ${toTrDate(baseEnd)} ${cit.tatilName} dönemine (${ADLI_TATIL_LABEL}) rastlıyor; uzama uygulanmadı.`,
      );
      if (rule !== null && rule.adliTatilApplies) {
        warnings.push(
          `${ADLI_TATIL_SWITCH_TR} kapatıldı: ${cit.adliTatil} uzaması uygulanmadı; uygulansaydı son gün ${formatTrLong(rolledExtended)} olurdu.`,
        );
      } else if (ruleForbidsExtension) {
        warnings.push(
          `Bu süre için ${cit.tatilName} uzaması uygulanmadı (${rule!.reference.label}: bu sürede uzama öngörülmüyor)${
            input.applyAdliTatil === true ? `; ${ADLI_TATIL_SWITCH_TR} bu sürenin son gününü değiştirmez` : ""
          }.`,
        );
      } else if (rule !== null) {
        warnings.push(
          `Bu kuralda ${cit.tatilName} uzamasının uygulanıp uygulanmayacağı tartışmalıdır (${rule.reference.label}); ihtiyatlı olan uzatılmamış tarih gösteriliyor. Uzama uygulanırsa son gün ${formatTrLong(rolledExtended)} olur.`,
        );
      } else {
        warnings.push(
          `Bu süre için ${cit.tatilName} uzaması uygulanmadı (özel süre; yasal dayanak belirtilmedi); süre HMK'ya tabi bir dava/iş süresiyse ${ADLI_TATIL_SWITCH_TR} işaretleyip yeniden hesaplayın — o hâlde son gün ${formatTrLong(rolledExtended)} olur.`,
        );
      }
    }
  } else {
    steps.push(`Son gün ${toTrDate(baseEnd)} ${cit.tatilName} dönemine (${ADLI_TATIL_LABEL}) rastlamıyor.`);
  }

  // ---- 4. weekend / holiday roll-forward ----
  const final = firstWorkingDayOnOrAfter(candidate);
  if (!sameDate(final, candidate)) {
    const reasons = nonWorkingReasons(candidate);
    steps.push(
      `Son gün ${formatTrLong(candidate)} ${reasons.join(" ve ")} gününe rastlıyor; süre, tatili izleyen ilk iş günü ${formatTrLong(final)} mesai bitiminde biter (${cit.holiday}).`,
    );
  } else {
    steps.push(`Son gün ${toTrDate(candidate)} hafta sonu veya resmî tatile denk gelmiyor.`);
  }
  if (procedure !== "CMK" && !baseInTatil && isAdliTatil(final) && apply) {
    warnings.push(
      `Son gün hafta sonu/tatil kayması ile ${cit.tatilName} dönemine (${toTrDate(final)}) girdi; ${cit.adliTatil} uzamasının bu hâlde uygulanıp uygulanmayacağı tartışmalıdır — ihtiyatlı (uzatılmamış) tarih ${formatTrLong(final)} esas alındı.`,
    );
  }

  // ---- 5. final ----
  steps.push(`Son gün: ${formatTrLong(final)} — mesai saati bitimine kadar.`);

  // ---- warnings that do not change the date ----
  if (startKind !== "ozel") {
    const startWarning = START_WARNINGS[startKind];
    if (startWarning !== undefined) warnings.push(startWarning);
  } else {
    warnings.push(
      "Özel süre: yasal dayanak girilmedi; hesapta HMK m.92–93 genel kuralları (başlangıç günü sayılmaz, hafta sonu/tatil kayması) varsayıldı.",
    );
  }
  if (rule?.transition !== undefined) {
    const effective = parseIsoDate(rule.transition.effectiveFrom);
    if (effective !== undefined && compareDates(start, effective) < 0) {
      warnings.push(
        `Başlangıç tarihi ${toTrDate(start)}, ${toTrDate(effective)} öncesi: ${rule.transition.law} öncesi süre (${rule.transition.before}) uygulanabilir; kararın tarihi ve geçiş hükümlerini kontrol edin.`,
      );
    }
  }
  const half = halfDayInfo(final);
  if (half !== undefined) {
    warnings.push(`Son gün ${toTrDate(final)} — ${half.name}: işlemi öğleden önce tamamlayın.`);
  }
  const yearsTouched = new Set([start.year, baseEnd.year, final.year]);
  let covered = true;
  for (const year of yearsTouched) {
    if (!religiousCalendarCovers(year)) {
      covered = false;
      warnings.push(
        `Dinî bayram tarihleri yalnız ${RELIGIOUS_CALENDAR_YEARS[0]}–${RELIGIOUS_CALENDAR_YEARS[RELIGIOUS_CALENDAR_YEARS.length - 1]} yılları için tanımlı; ${year} yılı için bayram çakışması kontrol edilmedi — Diyanet takvimiyle doğrulayın.`,
      );
    }
  }
  if (covered && religiousHolidayNear(final, 3)) {
    warnings.push(
      "Bayram çevresinde ilan edilebilecek idari izin günleri resmî tatil değildir; süreyi uzatmaz — son güne güvenmeyin, önce verin.",
    );
  }

  return {
    dueDate: toIsoDate(final),
    dueWeekday: weekdayName(final),
    rule,
    steps,
    warnings,
    disclaimer: DEADLINE_DISCLAIMER,
    startDate: toIsoDate(start),
    startDateTr: toTrDate(start),
    dueDateTr: toTrDate(final),
    baseDueDate: toIsoDate(baseEnd),
    baseDueDateTr: toTrDate(baseEnd),
    period,
    periodLabel: rule !== null ? rule.periodLabel : label,
    startKind,
    procedure,
    adliTatil: { applied, baseInAdliTatil: baseInTatil, dueDateWithoutExtension: dueWithoutExtension },
    holidayCalendarCovered: covered,
  };
}

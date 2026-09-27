/**
 * Faiz hesabı (W23) — pure, no I/O, no clock. Same shape and the same rules
 * as `src/fees/calc.ts`:
 *
 *  - SIMPLE interest, day by day: a day d in [from, to) accrues at the rate of
 *    the period that contains d; interest = anapara × oran/100 × gün / esas.
 *    (Bileşik faiz is not computed — TBK m.388/3 forbids it outside the narrow
 *    commercial exceptions, and those need facts ColleX cannot see.)
 *  - A day whose rate ColleX does not know is NOT guessed: its row carries
 *    `annualPercent: null`, `interest: null`, `durum: "ORAN_GEREKLI"`, and the
 *    total is `null` until the lawyer enters that period's rate.
 *  - A rate the lawyer enters wins over a known period on the days it covers
 *    and keeps the lawyer's own source text beside it (`status: "avukat-girdi"`).
 *  - Every result carries INTEREST_DISCLAIMER verbatim and says whether any
 *    rate used is still `dogrulanmadi`.
 */

import {
  INTEREST_DISCLAIMER,
  INTEREST_KIND_LABELS_TR,
  knownPeriods,
  type InterestKind,
  type RatePeriod,
  type RateStatus,
} from "./rates.js";

export class InterestInputError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "InterestInputError";
  }
}

export interface LawyerRatePeriod {
  from: string;
  to: string;
  annualPercent: number;
  /** Where the lawyer took the rate from (Resmî Gazete, TCMB duyurusu, sözleşme m. …). */
  source: string;
}

export interface InterestComputeInput {
  kind: InterestKind;
  /** Anapara, TL. */
  principal: number;
  /** Faiz başlangıç tarihi (temerrüt / takip / dava tarihi), YYYY-MM-DD. */
  from: string;
  /** Hesap tarihi, YYYY-MM-DD, after `from`. */
  to: string;
  periods?: readonly LawyerRatePeriod[];
  /** Days in a year; 365 unless the lawyer's contract says otherwise. */
  dayBasis?: 365 | 360;
}

export type InterestRowState = "HESAPLANDI" | "ORAN_GEREKLI";

export interface InterestRow {
  /** First accruing day (YYYY-MM-DD). */
  from: string;
  /** Last accruing day (YYYY-MM-DD). */
  to: string;
  days: number;
  annualPercent: number | null;
  status: RateStatus | null;
  source: string | null;
  interest: number | null;
  durum: InterestRowState;
}

export interface InterestComputation {
  kind: InterestKind;
  kindLabel: string;
  principal: number;
  from: string;
  to: string;
  dayBasis: 365 | 360;
  totalDays: number;
  rows: InterestRow[];
  totalInterest: number | null;
  totalWithPrincipal: number | null;
  /** Day ranges whose rate the lawyer must still enter. */
  missing: Array<{ from: string; to: string }>;
  /** True when any rate used is ColleX's own `dogrulanmadi` figure. */
  usesUnverifiedRate: boolean;
  notes: string[];
  disclaimer: string;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 100 * 366;

function parseIso(value: string, path: string): number {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (m === null) throw new InterestInputError("Tarih YYYY-AA-GG biçiminde olmalı.", path);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new InterestInputError("Böyle bir takvim günü yok.", path);
  }
  return t / DAY_MS;
}

function iso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function roundTl(value: number): number {
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

interface DayRate {
  annualPercent: number | null;
  status: RateStatus | null;
  source: string | null;
}

function sameRate(a: DayRate, b: DayRate): boolean {
  return a.annualPercent === b.annualPercent && a.status === b.status && a.source === b.source;
}

export function computeInterest(input: InterestComputeInput): InterestComputation {
  if (!(input.principal > 0) || !Number.isFinite(input.principal)) {
    throw new InterestInputError("Anapara sıfırdan büyük olmalı.", "principal");
  }
  const start = parseIso(input.from, "from");
  const end = parseIso(input.to, "to");
  if (end <= start) throw new InterestInputError("Hesap tarihi, faiz başlangıç tarihinden sonra olmalı.", "to");
  if (end - start > MAX_DAYS) throw new InterestInputError("Faiz dönemi 100 yıldan uzun olamaz.", "to");
  const dayBasis = input.dayBasis ?? 365;

  const lawyer = (input.periods ?? []).map((p, i) => {
    const a = parseIso(p.from, `periods.${i}.from`);
    const b = parseIso(p.to, `periods.${i}.to`);
    if (b < a) throw new InterestInputError("Dönemin bitişi başlangıcından önce olamaz.", `periods.${i}.to`);
    if (!(p.annualPercent >= 0) || !Number.isFinite(p.annualPercent) || p.annualPercent > 1000) {
      throw new InterestInputError("Oran 0 ile 1000 arasında bir yüzde olmalı.", `periods.${i}.annualPercent`);
    }
    if (p.source.trim() === "") {
      throw new InterestInputError("Oranın kaynağını yazın (ör. Resmî Gazete tarihi ve sayısı).", `periods.${i}.source`);
    }
    return { a, b, rate: { annualPercent: p.annualPercent, status: "avukat-girdi" as const, source: p.source.trim() } };
  });
  for (let i = 0; i < lawyer.length; i += 1) {
    for (let j = i + 1; j < lawyer.length; j += 1) {
      if (lawyer[i]!.a <= lawyer[j]!.b && lawyer[j]!.a <= lawyer[i]!.b) {
        throw new InterestInputError("Girdiğiniz iki dönem çakışıyor; her gün için tek oran olmalı.", `periods.${j}.from`);
      }
    }
  }
  const known = knownPeriods(input.kind).map((p: RatePeriod) => ({
    a: parseIso(p.from, "rates"),
    b: p.to === null ? Number.POSITIVE_INFINITY : parseIso(p.to, "rates"),
    rate: { annualPercent: p.annualPercent, status: p.status, source: p.source },
  }));

  const rateOn = (day: number): DayRate => {
    const own = lawyer.find((p) => p.a <= day && day <= p.b);
    if (own !== undefined) return own.rate;
    const k = known.find((p) => p.a <= day && day <= p.b);
    if (k !== undefined) return k.rate;
    return { annualPercent: null, status: null, source: null };
  };

  // Walk the boundaries only (not every day): a rate can change only where a
  // period starts or the day after one ends.
  const cuts = new Set<number>([start, end]);
  for (const p of [...lawyer, ...known]) {
    if (p.a > start && p.a < end) cuts.add(p.a);
    if (Number.isFinite(p.b) && p.b + 1 > start && p.b + 1 < end) cuts.add(p.b + 1);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const rows: InterestRow[] = [];
  let raw = 0;
  let allKnown = true;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const rate = rateOn(a);
    const days = b - a;
    const last = rows[rows.length - 1];
    if (last !== undefined && sameRate(
      { annualPercent: last.annualPercent, status: last.status, source: last.source },
      rate,
    )) {
      last.to = iso(b - 1);
      last.days += days;
    } else {
      rows.push({
        from: iso(a),
        to: iso(b - 1),
        days,
        annualPercent: rate.annualPercent,
        status: rate.status,
        source: rate.source,
        interest: null,
        durum: rate.annualPercent === null ? "ORAN_GEREKLI" : "HESAPLANDI",
      });
    }
  }
  for (const row of rows) {
    if (row.annualPercent === null) {
      allKnown = false;
      continue;
    }
    const value = (input.principal * row.annualPercent * row.days) / (100 * dayBasis);
    raw += value;
    row.interest = roundTl(value);
  }

  const notes: string[] = [];
  if (input.kind === "ticari-avans" && lawyer.length === 0) {
    notes.push(
      "Avans faizi oranlarını Merkez Bankası dönem dönem belirler ve ColleX bu oranları bilmez: her dönemin oranını " +
        "ve kaynağını girin.",
    );
  }
  if (input.kind === "sozlesmesel" && lawyer.length === 0) {
    notes.push("Sözleşmedeki faiz oranını ve sözleşmenin ilgili maddesini kaynak olarak girin.");
  }
  if (input.kind === "yasal" && start < parseIso("2006-01-01", "rates")) {
    notes.push("01.01.2006'dan önceki kanunî faiz oranları ColleX'te yok; o dönem için oranı ve kaynağını girin.");
  }
  const usesUnverifiedRate = rows.some((r) => r.status === "dogrulanmadi");
  if (usesUnverifiedRate) {
    notes.push(
      "Hesapta ColleX'in henüz Resmî Gazete metniyle karşılaştırılmamış (DOĞRULANMADI) bir oranı kullanıldı; " +
        "her satırın yanında nasıl doğrulanacağı yazar.",
    );
  }
  const missing = rows.filter((r) => r.durum === "ORAN_GEREKLI").map((r) => ({ from: r.from, to: r.to }));
  const totalInterest = allKnown ? roundTl(raw) : null;
  return {
    kind: input.kind,
    kindLabel: INTEREST_KIND_LABELS_TR[input.kind],
    principal: input.principal,
    from: input.from,
    to: input.to,
    dayBasis,
    totalDays: end - start,
    rows,
    totalInterest,
    totalWithPrincipal: totalInterest === null ? null : roundTl(input.principal + totalInterest),
    missing,
    usesUnverifiedRate,
    notes,
    disclaimer: INTEREST_DISCLAIMER,
  };
}

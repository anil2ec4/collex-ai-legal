/**
 * Faiz oranı dönemleri (W23) — pure data, no I/O.
 *
 * The same discipline as the fee tariffs and the deadline rules: a rate
 * ColleX does not know is `annualPercent: null` and the calculation answers
 * `ORAN_GEREKLI` with a null total rather than a guess. A rate that IS here
 * is `dogrulanmadi` until its Resmî Gazete text has been read and compared;
 * every period says how to check it (`nasilDogrulanir`).
 *
 * Only the kanunî (yasal) faiz has periods here. The ticarî işlerde avans
 * faizi (3095 s.K. m.2/2) is re-set by the Merkez Bankası and ColleX carries
 * none of its values: the lawyer enters the rate of each period with its
 * source, and the result keeps that source beside the number.
 */

export type InterestKind = "yasal" | "ticari-avans" | "sozlesmesel";

export const INTEREST_KINDS: readonly InterestKind[] = ["yasal", "ticari-avans", "sozlesmesel"];

export const INTEREST_KIND_LABELS_TR: Readonly<Record<InterestKind, string>> = {
  yasal: "Kanunî (yasal) faiz — 3095 s.K. m.1",
  "ticari-avans": "Ticarî işlerde avans faizi — 3095 s.K. m.2/2",
  sozlesmesel: "Sözleşmede kararlaştırılan faiz",
};

export type RateStatus = "dogrulandi" | "dogrulanmadi" | "avukat-girdi";

export interface RatePeriod {
  kind: InterestKind;
  /** First day the rate applies (YYYY-MM-DD). */
  from: string;
  /** Last day the rate applies (YYYY-MM-DD); null = still in force as far as ColleX knows. */
  to: string | null;
  /** Yearly percent; null = ColleX does not know it. */
  annualPercent: number | null;
  status: RateStatus;
  source: string;
  nasilDogrulanir: string;
}

/** Printed verbatim on every rates and compute response. */
export const INTEREST_DISCLAIMER =
  "Faiz hesabı bir yardımcı hesaptır: oranları ve dönemleri Resmî Gazete'den ve kararın/takibin kendisinden " +
  "mutlaka teyit edin. ColleX bilmediği bir oranı tahmin etmez, sizden ister; basit faiz uygular ve " +
  "bileşik faiz hesaplamaz.";

export const YASAL_FAIZ_PERIODS: readonly RatePeriod[] = Object.freeze([
  {
    kind: "yasal",
    from: "2006-01-01",
    to: "2024-05-31",
    annualPercent: 9,
    status: "dogrulanmadi",
    source:
      "3095 sayılı Kanunî Faiz ve Temerrüt Faizine İlişkin Kanun m.1 ve bu maddeye dayanan 2005 tarihli " +
      "Bakanlar Kurulu Kararı (yıllık %9, 01.01.2006'dan itibaren). ColleX kararın Resmî Gazete metnini görmedi.",
    nasilDogrulanir:
      "mevzuat.gov.tr'de 3095 sayılı Kanun m.1'i açın; 01.01.2006'dan itibaren uygulanan oranı belirleyen Bakanlar " +
      "Kurulu Kararının Resmî Gazete metnindeki oranı buradaki %9 ile karşılaştırın.",
  },
  {
    kind: "yasal",
    from: "2024-06-01",
    to: null,
    annualPercent: 24,
    status: "dogrulanmadi",
    source:
      "3095 sayılı Kanun m.1 ve bu maddeye dayanan 2024 tarihli Cumhurbaşkanı Kararı (yıllık %24, 01.06.2024'ten " +
      "itibaren). ColleX kararın Resmî Gazete metnini görmedi; sonraki bir değişikliği bilmez.",
    nasilDogrulanir:
      "Resmî Gazete'de 3095 sayılı Kanun m.1 uyarınca kanunî faiz oranını yıllık %24 olarak belirleyen 2024 tarihli " +
      "Cumhurbaşkanı Kararını açın; oranı ve yürürlük tarihini (01.06.2024) karşılaştırın, sonra bir değişiklik " +
      "yapılıp yapılmadığını kontrol edin.",
  },
]);

/** The periods ColleX knows for a kind (none for ticari-avans and sozlesmesel). */
export function knownPeriods(kind: InterestKind): readonly RatePeriod[] {
  return kind === "yasal" ? YASAL_FAIZ_PERIODS : [];
}

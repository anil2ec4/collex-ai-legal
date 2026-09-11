/**
 * Harç / vekâlet ücreti / kesinlik sınırı hesabı — pure, no I/O, no clock
 * (W14 B-35; same shape as `src/deadlines/calc.ts`).
 *
 * The calculator NEVER guesses a monetary amount. A step whose tariff line has
 * `amount: null` and no override comes back with `amount: null` and
 * `durum: "TUTAR_GIREKLI"`, the total is `null`, and the response says which
 * line ids the lawyer must fill in. Every result carries FEE_DISCLAIMER
 * verbatim and the list of line ids that are still `dogrulanmadi`.
 */

import {
  FEE_AMOUNT_UNKNOWN_TEXT,
  FEE_DISCLAIMER,
  findTariff,
  type FeeTariff,
  type FeeTariffLine,
} from "./tariffs.js";

export type FeeComputeKind = "dava-harci" | "vekalet-ucreti" | "kesinlik-siniri";

export const FEE_COMPUTE_KINDS: readonly FeeComputeKind[] = [
  "dava-harci",
  "vekalet-ucreti",
  "kesinlik-siniri",
];

export type FeeCourtKind = "sulh" | "asliye" | "kanun-yolu";

export type FeeLimitPath = "hmk-istinaf" | "hmk-temyiz" | "iik-istinaf" | "iyuk-istinaf";

export const FEE_LIMIT_PATHS: readonly FeeLimitPath[] = [
  "hmk-istinaf",
  "hmk-temyiz",
  "iik-istinaf",
  "iyuk-istinaf",
];

const LIMIT_LINE_BY_PATH: Readonly<Record<FeeLimitPath, string>> = {
  "hmk-istinaf": "hmk-istinaf-kesinlik",
  "hmk-temyiz": "hmk-temyiz-kesinlik",
  "iik-istinaf": "iik-istinaf-kesinlik",
  "iyuk-istinaf": "iyuk-istinaf-kesinlik",
};

const BASVURMA_LINE_BY_COURT: Readonly<Record<FeeCourtKind, string>> = {
  sulh: "basvurma-harci-sulh",
  asliye: "basvurma-harci-asliye",
  "kanun-yolu": "basvurma-harci-kanun-yolu",
};

export interface FeeComputeInput {
  year: number;
  kind: FeeComputeKind;
  /** TL. Required for "dava-harci", "vekalet-ucreti" and "kesinlik-siniri". */
  davaDegeri?: number;
  /** Which başvurma harcı row applies; defaults to "asliye". */
  mahkeme?: FeeCourtKind;
  /** Which parasal sınır to test against (kind === "kesinlik-siniri"). */
  yol?: FeeLimitPath;
  /**
   * Lawyer-supplied current amounts/rates, keyed by tariff line id. TL for
   * `maktu`/`sinir` lines, per-mille for `nispi`, fraction for `oran`.
   */
  overrides?: Readonly<Record<string, number>>;
}

export type FeeStepStatus = "hesaplandi" | "TUTAR_GEREKLI" | "BILGI";

export interface FeeStep {
  /** Stable machine id so a UI can attach an input to the step. */
  id: string;
  label: string;
  /** One Turkish sentence saying how this step was produced. */
  detail: string;
  amount: number | null;
  durum: FeeStepStatus;
  lineId?: string;
  /** True when the number used came from the request, not from the tariff. */
  kullaniciDegeri?: boolean;
  verified?: "dogrulandi" | "dogrulanmadi";
}

export interface FeeComputation {
  year: number;
  kind: FeeComputeKind;
  davaDegeri: number | null;
  steps: FeeStep[];
  /** null when at least one step is TUTAR_GEREKLI. */
  toplam: number | null;
  /** Tariff line ids the lawyer must supply before the total is meaningful. */
  eksikKalemler: string[];
  /** Tariff line ids used in this computation that are still dogrulanmadi. */
  dogrulanmamisKalemler: string[];
  warnings: string[];
  /** Verbatim, on every response (contract). */
  disclaimer: string;
  /** Only for kind === "kesinlik-siniri". */
  sinirSonucu?: {
    yol: FeeLimitPath;
    sinir: number | null;
    kullaniciDegeri: boolean;
    /** null when the applicable limit is unknown. */
    kanunYoluAcik: boolean | null;
    aciklama: string;
  };
}

export class FeeInputError extends Error {
  readonly kind: string;
  readonly path: string | undefined;

  constructor(kind: string, message: string, path?: string) {
    super(message);
    this.name = "FeeInputError";
    this.kind = kind;
    this.path = path;
  }
}

/** TL rounding: 2 decimals, half-up on the absolute value. */
export function roundTl(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatTl(value: number): string {
  return `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

interface Resolved {
  line: FeeTariffLine;
  /** amount for maktu/sinir, rate for nispi/oran; null when unknown. */
  value: number | null;
  fromUser: boolean;
}

function resolve(
  tariff: FeeTariff,
  lineId: string,
  overrides: Readonly<Record<string, number>>,
): Resolved {
  const line = tariff.lines.find((candidate) => candidate.id === lineId);
  if (line === undefined) {
    throw new FeeInputError(
      "TARIFF_LINE_NOT_FOUND",
      `Bu tarife kalemi bulunamadı: ${lineId}. Tarife listesinden bir kalem seçin.`,
      "overrides",
    );
  }
  const override = overrides[lineId];
  if (override !== undefined) return { line, value: override, fromUser: true };
  const own = line.kind === "nispi" || line.kind === "oran" ? line.rate : line.amount;
  return { line, value: own, fromUser: false };
}

function unknownStep(id: string, label: string, line: FeeTariffLine): FeeStep {
  return {
    id,
    label,
    detail: `${FEE_AMOUNT_UNKNOWN_TEXT} (${line.reference.label})`,
    amount: null,
    durum: "TUTAR_GEREKLI",
    lineId: line.id,
    verified: line.verified.status,
  };
}

function requirePositiveValue(value: number | undefined, path: string): number {
  if (value === undefined) {
    throw new FeeInputError("INVALID_REQUEST", "Dava değeri (TL) girilmelidir.", path);
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new FeeInputError(
      "INVALID_REQUEST",
      "Dava değeri sıfır veya sıfırdan büyük bir sayı olmalıdır.",
      path,
    );
  }
  return value;
}

export interface FeeComputeOptions {
  tariffs?: readonly FeeTariff[];
}

export function computeFees(input: FeeComputeInput, options: FeeComputeOptions = {}): FeeComputation {
  const tariff =
    options.tariffs === undefined
      ? findTariff(input.year)
      : options.tariffs.find((candidate) => candidate.year === input.year);
  if (tariff === undefined) {
    throw new FeeInputError(
      "TARIFF_YEAR_NOT_FOUND",
      `${input.year} yılı için tarife tanımlı değil. Tarife listesinden bir yıl seçin.`,
      "year",
    );
  }
  const overrides = input.overrides ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!tariff.lines.some((candidate) => candidate.id === key)) {
      throw new FeeInputError(
        "TARIFF_LINE_NOT_FOUND",
        `Bu tarife kalemi bulunamadı: ${key}. Tarife listesinden bir kalem seçin.`,
        `overrides.${key}`,
      );
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new FeeInputError(
        "INVALID_REQUEST",
        `'${key}' için girilen tutar sıfır veya sıfırdan büyük bir sayı olmalıdır.`,
        `overrides.${key}`,
      );
    }
  }

  const steps: FeeStep[] = [];
  const eksik: string[] = [];
  const dogrulanmamis = new Set<string>();
  const warnings: string[] = [];

  const track = (r: Resolved): void => {
    if (r.line.verified.status === "dogrulanmadi" && !r.fromUser) dogrulanmamis.add(r.line.id);
  };

  if (input.kind === "dava-harci") {
    const deger = requirePositiveValue(input.davaDegeri, "davaDegeri");
    const court: FeeCourtKind = input.mahkeme ?? "asliye";

    steps.push({
      id: "dava-degeri",
      label: "Dava değeri (harca esas değer)",
      detail: `Girilen değer: ${formatTl(deger)}. Nispi harç, HÜKÜM ALTINA ALINAN değer üzerinden hesaplanır; dava açılışında harca esas değer bu tutardır.`,
      amount: roundTl(deger),
      durum: "BILGI",
    });

    const basvurma = resolve(tariff, BASVURMA_LINE_BY_COURT[court], overrides);
    track(basvurma);
    if (basvurma.value === null) {
      steps.push(unknownStep("basvurma-harci", basvurma.line.title, basvurma.line));
      eksik.push(basvurma.line.id);
    } else {
      steps.push({
        id: "basvurma-harci",
        label: basvurma.line.title,
        detail: basvurma.fromUser
          ? `Girdiğiniz tutar kullanıldı: ${formatTl(basvurma.value)} (${basvurma.line.reference.label}).`
          : `Tarifedeki tutar: ${formatTl(basvurma.value)} (${basvurma.line.reference.label}).`,
        amount: roundTl(basvurma.value),
        durum: "hesaplandi",
        lineId: basvurma.line.id,
        kullaniciDegeri: basvurma.fromUser,
        verified: basvurma.line.verified.status,
      });
    }

    const nispi = resolve(tariff, "karar-ilam-harci-nispi-orani", overrides);
    track(nispi);
    let kararIlam: number | null = null;
    if (nispi.value === null) {
      steps.push(unknownStep("karar-ilam-harci", nispi.line.title, nispi.line));
      eksik.push(nispi.line.id);
    } else {
      kararIlam = roundTl((deger * nispi.value) / 1000);
      steps.push({
        id: "karar-ilam-harci",
        label: "Nispi karar ve ilam harcı",
        detail: `${formatTl(deger)} × binde ${nispi.value.toLocaleString("tr-TR")} = ${formatTl(kararIlam)} (${nispi.line.reference.label}).`,
        amount: kararIlam,
        durum: "hesaplandi",
        lineId: nispi.line.id,
        kullaniciDegeri: nispi.fromUser,
        verified: nispi.line.verified.status,
      });

      const asgari = resolve(tariff, "karar-ilam-harci-nispi-asgari", overrides);
      track(asgari);
      if (asgari.value === null) {
        steps.push({
          id: "karar-ilam-harci-asgari",
          label: "Nispi harcın alt sınırı",
          detail: `${FEE_AMOUNT_UNKNOWN_TEXT} Alt sınır bilinmediği için yukarıdaki tutara alt sınır uygulanmadı (${asgari.line.reference.label}).`,
          amount: null,
          durum: "TUTAR_GEREKLI",
          lineId: asgari.line.id,
          verified: asgari.line.verified.status,
        });
        eksik.push(asgari.line.id);
        warnings.push(
          "Nispi harcın tarifedeki alt sınırı bilinmiyor; küçük dava değerlerinde hesaplanan tutar gerçek harcın altında kalabilir.",
        );
      } else if (kararIlam < asgari.value) {
        kararIlam = roundTl(asgari.value);
        steps.push({
          id: "karar-ilam-harci-asgari",
          label: "Nispi harcın alt sınırı uygulandı",
          detail: `Hesaplanan nispi harç alt sınırın altında kaldığı için alt sınır uygulandı: ${formatTl(kararIlam)} (${asgari.line.reference.label}).`,
          amount: kararIlam,
          durum: "hesaplandi",
          lineId: asgari.line.id,
          kullaniciDegeri: asgari.fromUser,
          verified: asgari.line.verified.status,
        });
      } else {
        steps.push({
          id: "karar-ilam-harci-asgari",
          label: "Nispi harcın alt sınırı kontrol edildi",
          detail: `Hesaplanan ${formatTl(kararIlam)}, ${formatTl(asgari.value)} alt sınırından düşük değil; tutar değiştirilmedi (${asgari.line.reference.label}).`,
          amount: asgari.value,
          durum: "BILGI",
          lineId: asgari.line.id,
          kullaniciDegeri: asgari.fromUser,
          verified: asgari.line.verified.status,
        });
      }
    }

    const pesinOran = resolve(tariff, "pesin-harc-orani", overrides);
    track(pesinOran);
    let pesin: number | null = null;
    if (kararIlam === null || pesinOran.value === null) {
      steps.push({
        id: "pesin-harc",
        label: "Peşin harç",
        detail: `Peşin harç, karar ve ilam harcının bir bölümüdür (${pesinOran.line.reference.label}); yukarıdaki eksik kalemler girilmeden hesaplanamaz.`,
        amount: null,
        durum: "TUTAR_GEREKLI",
        lineId: pesinOran.line.id,
        verified: pesinOran.line.verified.status,
      });
      if (pesinOran.value === null) eksik.push(pesinOran.line.id);
    } else {
      pesin = roundTl(kararIlam * pesinOran.value);
      steps.push({
        id: "pesin-harc",
        label: "Peşin harç (dava açılışında yatırılan)",
        detail: `${formatTl(kararIlam)} × ${pesinOran.value.toLocaleString("tr-TR")} = ${formatTl(pesin)} (${pesinOran.line.reference.label}). Oranı madde metniyle doğrulayın.`,
        amount: pesin,
        durum: "hesaplandi",
        lineId: pesinOran.line.id,
        kullaniciDegeri: pesinOran.fromUser,
        verified: pesinOran.line.verified.status,
      });
    }

    const avans = resolve(tariff, "gider-avansi", overrides);
    track(avans);
    if (avans.value === null) {
      steps.push(unknownStep("gider-avansi", avans.line.title, avans.line));
      eksik.push(avans.line.id);
    } else {
      steps.push({
        id: "gider-avansi",
        label: avans.line.title,
        detail: `${avans.fromUser ? "Girdiğiniz tutar" : "Tarifedeki tutar"}: ${formatTl(avans.value)} (${avans.line.reference.label}). Gider avansı bir dava şartıdır (HMK m.114/1-g).`,
        amount: roundTl(avans.value),
        durum: "hesaplandi",
        lineId: avans.line.id,
        kullaniciDegeri: avans.fromUser,
        verified: avans.line.verified.status,
      });
    }

    const basvurmaAmount = steps.find((s) => s.id === "basvurma-harci")?.amount ?? null;
    const avansAmount = steps.find((s) => s.id === "gider-avansi")?.amount ?? null;
    const toplam =
      basvurmaAmount === null || pesin === null || avansAmount === null
        ? null
        : roundTl(basvurmaAmount + pesin + avansAmount);
    steps.push({
      id: "acilista-odenecek",
      label: "Dava açılışında ödenecek toplam",
      detail:
        toplam === null
          ? "Eksik kalemler girildiğinde toplam hesaplanır: başvurma harcı + peşin harç + gider avansı."
          : `Başvurma harcı + peşin harç + gider avansı = ${formatTl(toplam)}.`,
      amount: toplam,
      durum: toplam === null ? "TUTAR_GEREKLI" : "hesaplandi",
    });

    warnings.push(
      "Bazı dava türlerinde (aile, iş, tüketici ve maktu harca tabi işler) peşin harç alınmaz veya maktu harç uygulanır; dava türünü kontrol edin.",
    );

    return {
      year: tariff.year,
      kind: input.kind,
      davaDegeri: roundTl(deger),
      steps,
      toplam,
      eksikKalemler: [...new Set(eksik)],
      dogrulanmamisKalemler: [...dogrulanmamis],
      warnings,
      disclaimer: FEE_DISCLAIMER,
    };
  }

  if (input.kind === "vekalet-ucreti") {
    const deger = requirePositiveValue(input.davaDegeri, "davaDegeri");
    steps.push({
      id: "dava-degeri",
      label: "Dava değeri",
      detail: `Girilen değer: ${formatTl(deger)}.`,
      amount: roundTl(deger),
      durum: "BILGI",
    });

    const tavan = resolve(tariff, "avukatlik-nispi-ucret-tavani", overrides);
    track(tavan);
    if (tavan.value === null) {
      steps.push(unknownStep("nispi-ucret-tavani", tavan.line.title, tavan.line));
      eksik.push(tavan.line.id);
    } else {
      const tavanTutar = roundTl(deger * tavan.value);
      steps.push({
        id: "nispi-ucret-tavani",
        label: "Sözleşmeyle kararlaştırılabilecek NİSPİ ücretin tavanı",
        detail: `${formatTl(deger)} × %${(tavan.value * 100).toLocaleString("tr-TR")} = ${formatTl(tavanTutar)} (${tavan.line.reference.label}). Bu tavan yalnızca yüzde olarak kararlaştırılan ücret içindir; maktu ücret bu sınıra tabi değildir.`,
        amount: tavanTutar,
        durum: "hesaplandi",
        lineId: tavan.line.id,
        kullaniciDegeri: tavan.fromUser,
        verified: tavan.line.verified.status,
      });
    }

    const aaut = resolve(tariff, "aaut-nispi-kademeler", overrides);
    track(aaut);
    steps.push({
      id: "aaut-nispi",
      label: "AAÜT'ye göre karşı tarafa yükletilecek nispi vekâlet ücreti",
      detail: `${FEE_AMOUNT_UNKNOWN_TEXT} Tarifedeki kademeli oranlar her yıl değiştiği için ColleX bu tutarı hesaplamaz; yürürlükteki Avukatlık Asgari Ücret Tarifesi'nin Genel Hükümler bölümünü açıp hesaplayın (${aaut.line.reference.label}).`,
      amount: null,
      durum: "TUTAR_GEREKLI",
      lineId: aaut.line.id,
      verified: aaut.line.verified.status,
    });
    eksik.push(aaut.line.id);

    const maktu = resolve(tariff, "aaut-maktu-asliye", overrides);
    track(maktu);
    if (maktu.value === null) {
      steps.push(unknownStep("aaut-maktu", maktu.line.title, maktu.line));
      eksik.push(maktu.line.id);
    } else {
      steps.push({
        id: "aaut-maktu",
        label: "AAÜT maktu taban (sözleşmeyle bunun altına inilemez)",
        detail: `${formatTl(maktu.value)} (${maktu.line.reference.label}); Av.K. m.164/4 uyarınca ücret bu tutarın altında kararlaştırılamaz.`,
        amount: roundTl(maktu.value),
        durum: "hesaplandi",
        lineId: maktu.line.id,
        kullaniciDegeri: maktu.fromUser,
        verified: maktu.line.verified.status,
      });
    }

    warnings.push(
      "Ücret tavanını aşan avukatlık sözleşmesi, tavan miktarında geçerlidir (Av.K. m.163/2).",
    );

    return {
      year: tariff.year,
      kind: input.kind,
      davaDegeri: roundTl(deger),
      steps,
      toplam: null,
      eksikKalemler: [...new Set(eksik)],
      dogrulanmamisKalemler: [...dogrulanmamis],
      warnings,
      disclaimer: FEE_DISCLAIMER,
    };
  }

  // kind === "kesinlik-siniri"
  const deger = requirePositiveValue(input.davaDegeri, "davaDegeri");
  const yol = input.yol;
  if (yol === undefined) {
    throw new FeeInputError(
      "INVALID_REQUEST",
      "Hangi kanun yolunun parasal sınırına bakılacağını seçin.",
      "yol",
    );
  }
  const limit = resolve(tariff, LIMIT_LINE_BY_PATH[yol], overrides);
  track(limit);

  steps.push({
    id: "dava-degeri",
    label: "Karşılaştırılan miktar veya değer",
    detail: `Girilen değer: ${formatTl(deger)}. Sınırın uygulanmasında DAVANIN AÇILDIĞI tarihteki miktar esas alınır (HMK ek m.1/2); alacağın bir kısmı dava edilmişse sınır alacağın tamamına göre belirlenir.`,
    amount: roundTl(deger),
    durum: "BILGI",
  });

  if (limit.value === null) {
    steps.push({
      id: "kesinlik-siniri",
      label: limit.line.title,
      detail: `${FEE_AMOUNT_UNKNOWN_TEXT} (${limit.line.reference.label})`,
      amount: null,
      durum: "TUTAR_GEREKLI",
      lineId: limit.line.id,
      verified: limit.line.verified.status,
    });
    eksik.push(limit.line.id);
    return {
      year: tariff.year,
      kind: input.kind,
      davaDegeri: roundTl(deger),
      steps,
      toplam: null,
      eksikKalemler: [...new Set(eksik)],
      dogrulanmamisKalemler: [...dogrulanmamis],
      warnings,
      disclaimer: FEE_DISCLAIMER,
      sinirSonucu: {
        yol,
        sinir: null,
        kullaniciDegeri: false,
        kanunYoluAcik: null,
        aciklama:
          "Uygulanacak parasal sınır bilinmediği için kanun yolunun açık olup olmadığı belirlenemedi. Bu yılın sınırını girin.",
      },
    };
  }

  const sinir = roundTl(limit.value);
  const acik = deger > sinir;
  if (!limit.fromUser && limit.line.yenidenDegerlemeyeTabi) {
    warnings.push(
      `Kullanılan ${formatTl(sinir)} tutarı KANUNDAKİ TABAN tutardır, uygulanacak güncel sınır değildir; ${limit.line.reference.label} sınırı her takvim yılı başında yeniden değerleme oranında artar. Bu yılın rakamını girin.`,
    );
  }
  steps.push({
    id: "kesinlik-siniri",
    label: limit.line.title,
    detail: limit.fromUser
      ? `Girdiğiniz güncel sınır kullanıldı: ${formatTl(sinir)} (${limit.line.reference.label}).`
      : `Kanundaki taban tutar kullanıldı: ${formatTl(sinir)} (${limit.line.reference.label}).`,
    amount: sinir,
    durum: "hesaplandi",
    lineId: limit.line.id,
    kullaniciDegeri: limit.fromUser,
    verified: limit.line.verified.status,
  });
  steps.push({
    id: "kesinlik-sonucu",
    label: "Sonuç",
    detail: acik
      ? `${formatTl(deger)} > ${formatTl(sinir)} olduğundan parasal sınır aşılmıştır; kanun yolu bu yönden AÇIKTIR. Kanun yoluna kapalı sayılan diğer hâlleri ayrıca kontrol edin.`
      : `${formatTl(deger)} ≤ ${formatTl(sinir)} olduğundan parasal sınır aşılmamıştır; karar bu yönden KESİNDİR. Sınıra bakılmaksızın kanun yolu açık olan istisnaları (ör. manevi tazminat, HMK m.341/2) kontrol edin.`,
    amount: null,
    durum: "BILGI",
  });

  return {
    year: tariff.year,
    kind: input.kind,
    davaDegeri: roundTl(deger),
    steps,
    toplam: null,
    eksikKalemler: [...new Set(eksik)],
    dogrulanmamisKalemler: [...dogrulanmamis],
    warnings,
    disclaimer: FEE_DISCLAIMER,
    sinirSonucu: {
      yol,
      sinir,
      kullaniciDegeri: limit.fromUser,
      kanunYoluAcik: acik,
      aciklama: acik
        ? "Parasal sınır aşılmıştır; kanun yolu bu yönden açıktır."
        : "Parasal sınır aşılmamıştır; karar bu yönden kesindir.",
    },
  };
}

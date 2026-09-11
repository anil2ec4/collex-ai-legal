/**
 * Harç / parasal sınır / AAÜT tarife verisi (W14 B-35).
 *
 * Built exactly like `src/deadlines/`: pure data, no I/O, no clock. Every line
 * carries a statutory reference, a `verified` block and one Turkish sentence
 * saying how the lawyer checks it in a minute.
 *
 * THE RULE OF THIS FILE. A Turkish court fee has two halves:
 *
 *   1. the STATUTORY structure and rate — written in the Kanun itself and
 *      stable for years (e.g. nispi karar ve ilam harcı = binde 68,31,
 *      492 s.K. (1) sayılı tarife A/III-1-a). These are pulled from
 *      mevzuat.gov.tr and can be `dogrulandi`.
 *   2. the YEARLY MONETARY AMOUNT — maktu harçlar, the AAÜT ladder, the
 *      kesinlik sınırları as applied. These are re-published in the Resmî
 *      Gazete. Only amounts checked against that year's published table are
 *      populated. Seven 2026 fees were verified against GİB communiqué 98;
 *      other unverified yearly amounts remain null and accept overrides.
 *
 * A wrong fee is a rejected filing, so this module never invents a number.
 * `amount: null` is the honest answer, not a defect.
 */

import { PUBLISHED_2026_AMOUNTS, PUBLISHED_2026_SHA256, PUBLISHED_2026_SOURCE } from "./published2026.js";

export type FeeVerificationStatus = "dogrulandi" | "dogrulanmadi";

export interface FeeVerification {
  status: FeeVerificationStatus;
  /** YYYY-MM-DD */
  date: string;
  source: string;
  /** Additive: public source and archived-byte fingerprint, when available. */
  sourceUrl?: string;
  sourceSha256?: string;
}

export interface FeeReference {
  legislationNo: string;
  article: string;
  /** Human citation, e.g. "492 s.K. (1) sayılı tarife A/III-1-a". */
  label: string;
}

export type FeeLineGroup = "harc" | "gider" | "vekalet" | "kesinlik";

/**
 * - `maktu`  : a fixed TL amount (yearly).
 * - `nispi`  : a per-mille rate over a monetary base (binde N).
 * - `oran`   : a plain fraction of another line (0..1), e.g. peşin harç = 1/4.
 * - `sinir`  : a monetary threshold (kesinlik sınırı).
 */
export type FeeLineKind = "maktu" | "nispi" | "oran" | "sinir";

export interface FeeTariffLine {
  id: string;
  title: string;
  group: FeeLineGroup;
  kind: FeeLineKind;
  /** `nispi`: per-mille (binde). `oran`: fraction 0..1. Otherwise null. */
  rate: number | null;
  /** `maktu` / `sinir`: TL. `null` = ColleX does not know this year's figure. */
  amount: number | null;
  /**
   * True when `amount` is the BASE written in the statute, which is increased
   * every calendar year by the yeniden değerleme oranı — so the base is
   * verified but the APPLICABLE figure is not.
   */
  yenidenDegerlemeyeTabi: boolean;
  reference: FeeReference;
  verified: FeeVerification;
  /** One sentence: which text to open and what to compare. */
  nasilDogrulanir: string;
  notes: string[];
}

export interface FeeTariff {
  year: number;
  lines: readonly FeeTariffLine[];
}

/**
 * Mandatory disclaimer — verbatim on every screen, every response and every
 * export that shows a computed fee (same discipline as DEADLINE_DISCLAIMER).
 */
export const FEE_DISCLAIMER =
  "Harç, gider ve vekâlet ücreti hesabı bilgi amaçlıdır; tarifeler her yıl Resmî Gazete'de yenilenir ve tutarlar avukatça kontrol edilmelidir — eksik veya yanlış yatırılan harçtan ColleX sorumlu değildir.";

/** Shown wherever a line has no amount ColleX can stand behind. */
export const FEE_AMOUNT_UNKNOWN_TEXT =
  "Bu tutar her yıl Resmî Gazete'de yeniden belirlenir; ColleX bu yılın tutarını bilmiyor. Güncel tutarı girin, hesap o tutarla yapılsın.";

const VERIFICATION_DATE = "2026-09-02";
const ACCESS_DATE_TR = "02.09.2026";

const UNVERIFIED: FeeVerification = {
  status: "dogrulanmadi",
  date: VERIFICATION_DATE,
  source:
    "Bu kalemin güncel tutarı/oranı doğrulama turunda elde edilemedi. Resmî Gazete'de yayımlanan yürürlükteki tarife metnini açıp karşılaştırın ve tutarı hesaplayıcıya girin.",
};

function pulled(article: string): FeeVerification {
  return {
    status: "dogrulandi",
    date: VERIFICATION_DATE,
    source: `${article} — yürürlükteki madde/tarife metni mevzuat.gov.tr (Mevzuat Bilgi Sistemi) üzerinden ${ACCESS_DATE_TR} tarihinde çekilip bu kalemle karşılaştırıldı.`,
  };
}

type LineSpec = Omit<FeeTariffLine, "verified" | "yenidenDegerlemeyeTabi"> & {
  verified?: FeeVerification;
  yenidenDegerlemeyeTabi?: boolean;
};

function line(spec: LineSpec): FeeTariffLine {
  return {
    ...spec,
    yenidenDegerlemeyeTabi: spec.yenidenDegerlemeyeTabi ?? false,
    verified: spec.verified ?? UNVERIFIED,
  };
}

const YARGI_HARCLARI: readonly FeeTariffLine[] = [
  line({
    id: "basvurma-harci-sulh",
    title: "Başvurma harcı — sulh mahkemeleri ve icra mahkemeleri",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/I-1",
      label: "492 s.K. (1) sayılı tarife A/I-1",
    },
    nasilDogrulanir:
      "Yürürlükteki Harçlar Kanunu Genel Tebliği'nin (1) sayılı tarifesini açın: A/I-1 satırındaki sulh mahkemeleri başvurma harcı tutarını okuyun.",
    notes: [
      "Dilekçe veya tutanakla dava açma, davaya müdahale, tevdi mahallinin tayini, ihtiyati tedbir, ihtiyati haciz ve delil tespiti taleplerinde alınır (492 s.K. (1) sayılı tarife A/I).",
      "Tutar her yıl Harçlar Kanunu Genel Tebliği ile yeniden belirlenir.",
    ],
  }),
  line({
    id: "basvurma-harci-asliye",
    title: "Başvurma harcı — asliye mahkemeleri ve idare mahkemeleri",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/I-2",
      label: "492 s.K. (1) sayılı tarife A/I-2",
    },
    nasilDogrulanir:
      "Yürürlükteki Harçlar Kanunu Genel Tebliği'nin (1) sayılı tarifesini açın: A/I-2 satırındaki asliye ve idare mahkemeleri başvurma harcı tutarını okuyun.",
    notes: [
      "Aynı fıkra kapsamındaki bütün taleplerde bir kez alınır (492 s.K. (1) sayılı tarife A/I).",
      "Tutar her yıl Harçlar Kanunu Genel Tebliği ile yeniden belirlenir.",
    ],
  }),
  line({
    id: "basvurma-harci-kanun-yolu",
    title: "Başvurma harcı — bölge adliye/idare mahkemeleri, Yargıtay ve Danıştay",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/I-3",
      label: "492 s.K. (1) sayılı tarife A/I-3",
    },
    nasilDogrulanir:
      "Yürürlükteki Harçlar Kanunu Genel Tebliği'nin (1) sayılı tarifesini açın: A/I-3 satırındaki kanun yolu başvurma harcı tutarını okuyun.",
    notes: [
      "Bu satır A/I-3 başvurma harcıdır; A/IV'teki ayrı temyiz ve istinaf harçlarının yerine geçmez. Kanun yolunda ödenecek bütün harçların toplamı değildir.",
      "Mahkemenin yetkisizlik veya görevsizlik kararı vermesi sebebiyle yetkili/görevli mahkemeye yeniden başvurulması hâlinde bu harç alınmaz (aynı bent).",
    ],
  }),
  line({
    id: "basvurma-harci-aym",
    title: "Başvurma harcı — Anayasa Mahkemesine bireysel başvuru",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/I-4",
      label: "492 s.K. (1) sayılı tarife A/I-4",
    },
    nasilDogrulanir:
      "Yürürlükteki Harçlar Kanunu Genel Tebliği'nin (1) sayılı tarifesini açın: A/I-4 satırındaki Anayasa Mahkemesi başvurma harcı tutarını okuyun.",
    notes: [
      "6216 sayılı Kanunun 75 inci maddesiyle tarifeye eklenmiştir (492 s.K. (1) sayılı tarife A/I-4).",
    ],
  }),
  line({
    id: "karar-ilam-harci-nispi-orani",
    title: "Nispi karar ve ilam harcı oranı",
    group: "harc",
    kind: "nispi",
    rate: 68.31,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/III-1-a",
      label: "492 s.K. (1) sayılı tarife A/III-1-a",
    },
    verified: pulled("492 s.K. (1) sayılı tarife A/III-1-a"),
    nasilDogrulanir:
      "492 sayılı Harçlar Kanununun (1) sayılı tarifesinde A/III-1-a satırını açın: \"Konusu belli bir değerle ilgili bulunan davalarda esas hakkında karar verilmesi halinde hüküm altına alınan anlaşmazlık konusu değer üzerinden (Binde 68,31)\" ibaresini karşılaştırın.",
    notes: [
      "Konusu belli bir değerle ilgili davalarda, esas hakkında karar verilmesi hâlinde HÜKÜM ALTINA ALINAN anlaşmazlık konusu değer üzerinden binde 68,31 oranında alınır (492 s.K. (1) sayılı tarife A/III-1-a).",
      "Aynı nispetler bölge adliye/idare mahkemeleri, Danıştay ve Yargıtayın tasdik veya işin esasını hüküm altına aldığı kararları için de uygulanır (aynı tarife A/III-1-e).",
      "Cumhurbaşkanı bu nispeti binde 10'a kadar indirmeye yetkilidir; indirim yapılmış olabilir, güncel metni kontrol edin.",
      "Tahkim yargılamasında bu bende göre harç alınmaz (aynı bent).",
    ],
  }),
  line({
    id: "karar-ilam-harci-nispi-asgari",
    title: "Nispi karar ve ilam harcının alt sınırı",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/III-1",
      label: "492 s.K. (1) sayılı tarife A/III-1",
    },
    nasilDogrulanir:
      "Yürürlükteki tarifede A/III-1 bendinin sonundaki \"Nispi harçlar … liradan aşağı olamaz\" satırındaki tutarı okuyun.",
    notes: [
      "Nispi harçlar tarifede yazılı asgari tutarın altına inemez; bu tutar her yıl yeniden belirlenir.",
    ],
  }),
  line({
    id: "karar-ilam-harci-maktu",
    title: "Maktu karar ve ilam harcı (konusu değerle ölçülemeyen davalar)",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife A/III-2-a",
      label: "492 s.K. (1) sayılı tarife A/III-2-a",
    },
    nasilDogrulanir:
      "Yürürlükteki tarifede A/III-2-a maktu karar harcı tutarını okuyun; kanun yolu kararları ve diğer alt bentlerin farklı tutarları olabilir.",
    notes: [
      "Konusu belli bir değerle ilgili olmayan davalarda ve taraf teşkiline imkân bulunmayan davalarda alınır (492 s.K. (1) sayılı tarife A/III-2).",
    ],
  }),
  line({
    id: "pesin-harc-orani",
    title: "Peşin harç oranı (karar ve ilam harcının dörtte biri)",
    group: "harc",
    kind: "oran",
    rate: 0.25,
    amount: null,
    reference: { legislationNo: "492", article: "28", label: "492 s.K. m.28/1-a" },
    nasilDogrulanir:
      "492 sayılı Harçlar Kanunu m.28/1-a'yı açın: karar ve ilam harcının dörtte birinin dava açılırken peşin alınacağı kuralını ve bu kuralın istisnalarını karşılaştırın. ColleX bu maddeyi çekemedi; oranı teyit etmeden kullanmayın.",
    notes: [
      "Nispi karar ve ilam harcının bir bölümü dava açılırken peşin alınır; kalanı karardan sonra tahsil edilir (492 s.K. m.28).",
      "Bazı dava türlerinde (ör. bazı aile ve iş davaları) peşin harç alınmaz veya maktu harç uygulanır; dava türünü kontrol edin.",
    ],
  }),
  line({
    id: "vekalet-suret-harci",
    title: "Avukatın tasdik ettiği vekâletname suret harcı",
    group: "harc",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: {
      legislationNo: "492",
      article: "(1) sayılı tarife D/I-c",
      label: "492 s.K. (1) sayılı tarife D/I-c",
    },
    nasilDogrulanir:
      "Yürürlükteki (1) sayılı tarifede D/I-c satırını açın: avukatların tasdik ettiği vekâletname suretlerinden alınan tutarı okuyun. A/IV bölümü suret harcı değil, kanun yolu harçlarıdır.",
    notes: ["Dosyaya sunulan vekâletname örneği için alınır; tutar her yıl yenilenir."],
  }),
];

const GIDERLER: readonly FeeTariffLine[] = [
  line({
    id: "gider-avansi",
    title: "Gider avansı (HMK m.114/1-g, m.120)",
    group: "gider",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: { legislationNo: "6100", article: "120", label: "HMK m.120" },
    nasilDogrulanir:
      "Resmî Gazete'de yayımlanan yürürlükteki \"Hukuk Muhakemeleri Kanunu Gider Avansı Tarifesi\"ni açın: taraf sayısına göre tebligat gideri, tanık, bilirkişi ve keşif kalemleriyle birlikte toplam avansı okuyun.",
    notes: [
      "Gider avansı bir DAVA ŞARTIDIR (HMK m.114/1-g); yatırılmazsa dava usulden reddedilir.",
      "Tutar, her yıl yayımlanan HMK Gider Avansı Tarifesi'ne ve taraf sayısına göre değişir; ColleX taraf sayısını ve tarifeyi bilmez.",
      "Adli yardım talebi kabul edilirse avans aranmaz (HMK m.334 vd.).",
    ],
  }),
  line({
    id: "tebligat-gideri",
    title: "Tebligat gideri (taraf başına)",
    group: "gider",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: { legislationNo: "7201", article: "-", label: "7201 s.K.; PTT tebligat ücret tarifesi" },
    nasilDogrulanir:
      "Yürürlükteki HMK Gider Avansı Tarifesi'ndeki tebligat gideri kalemini veya PTT'nin güncel tebligat ücret tarifesini açıp taraf başına tutarı okuyun.",
    notes: ["Gider avansının içinde yer alır; ayrıca hesaplanacaksa taraf sayısıyla çarpın."],
  }),
];

const VEKALET_UCRETI: readonly FeeTariffLine[] = [
  line({
    id: "avukatlik-nispi-ucret-tavani",
    title: "Sözleşmeyle kararlaştırılan NİSPİ avukatlık ücretinin tavanı",
    group: "vekalet",
    kind: "oran",
    rate: 0.25,
    amount: null,
    reference: { legislationNo: "1136", article: "164", label: "Av.K. m.164/2" },
    verified: pulled("Av.K. m.164/2"),
    nasilDogrulanir:
      "1136 sayılı Avukatlık Kanunu m.164'ün ikinci fıkrasını açın: \"Yüzde yirmibeşi aşmamak üzere, dava veya hükmolunacak şeyin değeri yahut paranın belli bir yüzdesi avukatlık ücreti olarak kararlaştırılabilir\" ibaresini karşılaştırın.",
    notes: [
      "Bu tavan yalnızca NİSPİ (yüzde olarak kararlaştırılan) ücret için geçerlidir; maktu ücret bu sınıra tabi değildir (Av.K. m.164/2).",
      "İkinci fıkraya göre yapılan sözleşmeler, dava konusu para dışındaki mal ve haklardan bir kısmının aynen avukata ait olacağı hükmünü taşıyamaz (Av.K. m.164/3).",
      "Ücret tavanını aşan sözleşme, tavan miktarında geçerlidir (Av.K. m.163/2).",
    ],
  }),
  line({
    id: "aaut-nispi-kademeler",
    title: "AAÜT nispi vekâlet ücreti kademeleri (karşı tarafa yükletilecek ücret)",
    group: "vekalet",
    kind: "nispi",
    rate: null,
    amount: null,
    reference: { legislationNo: "AAÜT", article: "Genel Hükümler m.13", label: "Avukatlık Asgari Ücret Tarifesi" },
    nasilDogrulanir:
      "Resmî Gazete'de yayımlanan yürürlükteki Avukatlık Asgari Ücret Tarifesi'nin \"Genel Hükümler\" bölümündeki nispi ücret kademelerini (ilk dilim %..., sonraki dilimler ...) açıp okuyun; kademeler her yıl değişir.",
    notes: [
      "Konusu para veya para ile değerlendirilebilen davalarda karşı tarafa yükletilecek vekâlet ücreti, tarifedeki kademeli oranlara göre hesaplanır ve tarifedeki maktu ücretin altına inemez.",
      "Kademeler ve maktu taban her yıl yeniden yayımlanır; ColleX bu yılın tarifesini bilmez.",
    ],
  }),
  line({
    id: "aaut-maktu-asliye",
    title: "AAÜT maktu vekâlet ücreti — asliye mahkemeleri",
    group: "vekalet",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: { legislationNo: "AAÜT", article: "İkinci Kısım", label: "Avukatlık Asgari Ücret Tarifesi" },
    nasilDogrulanir:
      "Yürürlükteki AAÜT'nin İkinci Kısım İkinci Bölümündeki asliye mahkemelerinde takip edilen davalar için maktu ücreti okuyun.",
    notes: ["Avukatlık ücreti sözleşmede bu tutarın altında kararlaştırılamaz (Av.K. m.164/4)."],
  }),
  line({
    id: "aaut-maktu-sulh",
    title: "AAÜT maktu vekâlet ücreti — sulh hukuk mahkemeleri",
    group: "vekalet",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: { legislationNo: "AAÜT", article: "İkinci Kısım", label: "Avukatlık Asgari Ücret Tarifesi" },
    nasilDogrulanir:
      "Yürürlükteki AAÜT'nin İkinci Kısım İkinci Bölümündeki sulh hukuk mahkemeleri maktu ücretini okuyun.",
    notes: ["Avukatlık ücreti sözleşmede bu tutarın altında kararlaştırılamaz (Av.K. m.164/4)."],
  }),
  line({
    id: "aaut-maktu-icra",
    title: "AAÜT maktu vekâlet ücreti — icra dairelerinde takip",
    group: "vekalet",
    kind: "maktu",
    rate: null,
    amount: null,
    reference: { legislationNo: "AAÜT", article: "Üçüncü Kısım", label: "Avukatlık Asgari Ücret Tarifesi" },
    nasilDogrulanir:
      "Yürürlükteki AAÜT'nin Üçüncü Kısmındaki icra dairelerinde yapılan takipler için maktu ücreti okuyun.",
    notes: ["Konusu para olan takiplerde nispi hesap yapılır; tarifenin ilgili bölümünü kontrol edin."],
  }),
];

const KESINLIK_SINIRLARI: readonly FeeTariffLine[] = [
  line({
    id: "hmk-istinaf-kesinlik",
    title: "İstinaf kesinlik sınırı — hukuk mahkemeleri (HMK m.341/2)",
    group: "kesinlik",
    kind: "sinir",
    rate: null,
    amount: 3000,
    yenidenDegerlemeyeTabi: true,
    reference: { legislationNo: "6100", article: "341", label: "HMK m.341/2" },
    verified: pulled("HMK m.341/2 ve HMK ek m.1 (KANUNDAKİ TABAN TUTAR)"),
    nasilDogrulanir:
      "HMK m.341/2'yi açın: kanunda yazılı taban tutar \"üç bin Türk Lirası\"dır. Uygulanacak GÜNCEL sınır, HMK ek m.1 uyarınca her takvim yılı başından geçerli olmak üzere yeniden değerleme oranında artırılmış tutardır (bin lirayı aşmayan kısımlar dikkate alınmaz) — bu yılın rakamını Adalet Bakanlığı/baro duyurusundan doğrulayıp hesaplayıcıya girin.",
    notes: [
      "Miktar veya değeri kanunda yazılı sınırı geçmeyen malvarlığı davalarına ilişkin kararlar KESİNDİR (HMK m.341/2).",
      "Manevi tazminat davalarında verilen kararlara karşı, miktar veya değere bakılmaksızın istinaf yoluna başvurulabilir (HMK m.341/2, ek cümle).",
      "Alacağın bir kısmı dava edilmişse kesinlik sınırı alacağın TAMAMINA göre belirlenir (HMK m.341/3).",
      "Sınırın uygulanmasında DAVANIN AÇILDIĞI tarihteki miktar esas alınır (HMK ek m.1/2).",
      "3.000 TL kanundaki taban tutardır, uygulanacak tutar değildir; güncel sınırı girmeden karar vermeyin.",
    ],
  }),
  line({
    id: "hmk-temyiz-kesinlik",
    title: "Temyiz kesinlik sınırı — hukuk mahkemeleri (HMK m.362/1-a)",
    group: "kesinlik",
    kind: "sinir",
    rate: null,
    amount: 40000,
    yenidenDegerlemeyeTabi: true,
    reference: { legislationNo: "6100", article: "362", label: "HMK m.362/1-a" },
    verified: pulled("HMK m.362/1-a ve HMK ek m.1 (KANUNDAKİ TABAN TUTAR)"),
    nasilDogrulanir:
      "HMK m.362/1-a'yı açın: \"Miktar veya değeri kırk bin Türk Lirasını (bu tutar dâhil) geçmeyen davalara ilişkin kararlar\" temyiz edilemez. Uygulanacak GÜNCEL sınır HMK ek m.1 uyarınca yeniden değerleme oranında artırılmış tutardır; bu yılın rakamını doğrulayıp girin.",
    notes: [
      "Sınırı geçmeyen davalara ilişkin bölge adliye mahkemesi kararları temyiz edilemez (HMK m.362/1-a).",
      "Alacağın bir kısmı dava edilmişse kesinlik sınırı alacağın tamamına göre belirlenir; tamamı dava edilmişse asıl talebin kabul edilmeyen bölümü sınırı geçmeyen tarafın temyiz hakkı yoktur (HMK m.362/2).",
      "40.000 TL kanundaki taban tutardır, uygulanacak tutar değildir.",
    ],
  }),
  line({
    id: "iik-istinaf-kesinlik",
    title: "İstinaf parasal sınırı — icra mahkemesi kararları (İİK m.363/1)",
    group: "kesinlik",
    kind: "sinir",
    rate: null,
    amount: 7000,
    yenidenDegerlemeyeTabi: true,
    reference: { legislationNo: "2004", article: "363", label: "İİK m.363/1" },
    verified: pulled("İİK m.363/1 (KANUNDAKİ TABAN TUTAR)"),
    nasilDogrulanir:
      "İİK m.363/1'i açın: maddede sayılan kararlar DIŞINDAKİ icra mahkemesi kararlarına karşı, \"ait olduğu alacak, hak veya malın değer veya miktarının yedi bin Türk lirasını geçmesi şartıyla\" istinafa başvurulabilir. Uygulanacak GÜNCEL sınır, İİK ek m.1 uyarınca her yıl yeniden değerleme oranında artırılmış tutardır; bu yılın rakamını doğrulayıp girin.",
    notes: [
      "İİK m.363/1 istinafa KAPALI kararları sayar; sayılanların dışındaki kararlar parasal sınırı geçmek şartıyla istinaf edilebilir.",
      "7.000 TL kanundaki taban tutardır; İİK ek m.1 uyarınca her yıl yeniden değerleme oranında artar.",
    ],
  }),
  line({
    id: "iyuk-istinaf-kesinlik",
    title: "İstinaf kesinlik sınırı — idari yargı (İYUK m.45/1)",
    group: "kesinlik",
    kind: "sinir",
    rate: null,
    amount: null,
    yenidenDegerlemeyeTabi: true,
    reference: { legislationNo: "2577", article: "45", label: "İYUK m.45/1, ek m.1" },
    nasilDogrulanir:
      "İYUK m.45/1'i ve ek m.1'i açın: konusu parasal sınırı aşmayan davalarda idare/vergi mahkemesi kararının kesin olduğunu ve sınırın her yıl yeniden değerleme oranında güncellendiğini görün; bu yılın rakamını doğrulayıp girin.",
    notes: ["Sınır her yıl yeniden değerleme oranında güncellenir; ColleX bu yılın rakamını bilmez."],
  }),
];

/**
 * Year-scoped tariffs. Published 2026 amounts are attached only to that year.
 * Adding a year requires its own verified table, never recycling these values.
 */
export const FEE_TARIFFS: readonly FeeTariff[] = [
  {
    year: 2026,
    lines: [...YARGI_HARCLARI, ...GIDERLER, ...VEKALET_UCRETI, ...KESINLIK_SINIRLARI].map((entry) => {
      const amount = PUBLISHED_2026_AMOUNTS[entry.id];
      if (amount === undefined) return entry;
      return { ...entry, amount, verified: {
        status: "dogrulandi" as const, date: "2026-09-08",
        source: `${entry.reference.label} — 2026 tutarı, 98 Seri No.lu Harçlar Kanunu Genel Tebliği eki (1) sayılı tarife, PDF s.2–3; GİB kaynağı 08.09.2026 tarihinde metin ve tablo olarak karşılaştırıldı: ${PUBLISHED_2026_SOURCE}`,
        sourceUrl: PUBLISHED_2026_SOURCE, sourceSha256: PUBLISHED_2026_SHA256,
      } };
    }),
  },
];

export const FEE_YEARS: readonly number[] = FEE_TARIFFS.map((t) => t.year);

export const FEE_LINE_GROUPS: readonly FeeLineGroup[] = ["harc", "gider", "vekalet", "kesinlik"];

export const FEE_GROUP_LABELS_TR: Readonly<Record<FeeLineGroup, string>> = {
  harc: "Yargı harçları",
  gider: "Yargılama giderleri",
  vekalet: "Vekâlet ücreti",
  kesinlik: "Kesinlik (parasal) sınırları",
};

export function findTariff(year: number): FeeTariff | undefined {
  return FEE_TARIFFS.find((tariff) => tariff.year === year);
}

export function findTariffLine(year: number, id: string): FeeTariffLine | undefined {
  return findTariff(year)?.lines.find((candidate) => candidate.id === id);
}

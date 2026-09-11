/**
 * Procedural deadline rules (süre kuralları) — data, not law.
 *
 * Every rule cites its statutory basis and carries a `verified` block.
 *
 * W14 (B-11): on 02.09.2026 mevzuat.gov.tr WAS reachable through the
 * yargi-mevzuat MCP and the articles listed below were pulled and compared
 * word by word. A rule is `dogrulandi` ONLY when the article text was in
 * hand at that moment, and its `verified.source` names the article and the
 * access date. Everything else stays `dogrulanmadi` — that is the contract,
 * not a failure. Two rules were WRONG before this pass and are corrected
 * here (İİK m.363/1 period + start, HMK m.176/2 ıslah note).
 *
 * Every rule also carries `nasilDogrulanir`: one Turkish sentence telling the
 * lawyer which article to open and what to compare, so a `dogrulanmadi` rule
 * can be checked in under a minute.
 *
 * Rule texts are deliberately conservative: where practice diverges (tebliğ
 * vs. tefhim, adli tatil, tutuklu işler, özel kanun süreleri) the note says
 * so instead of the calculator guessing.
 */

export type DeadlineProcedure = "HMK" | "CMK" | "İYUK" | "İİK" | "AYM" | "Diğer";
export type DeadlineUnit = "gun" | "hafta" | "ay" | "yil";
export type DeadlineStartKind = "teblig" | "tefhim" | "ogrenme" | "karar";

/**
 * Additive (W14 B-11): three-state adli tatil applicability. HMK m.104
 * extends a period only when the case IS subject to adli tatil AND the last
 * day falls inside it; pre-marking every rule true/false errs on the unsafe
 * side, so a genuinely contested rule says "belirsiz" and the caller shows
 * both dates.
 */
export type AdliTatilStatus = boolean | "belirsiz";

export interface DeadlinePeriod {
  value: number;
  unit: DeadlineUnit;
}

export interface DeadlineReference {
  legislationNo: string;
  article: string;
  /** Human citation, e.g. "HMK m.127/1". */
  label: string;
}

export interface DeadlineVerification {
  status: "dogrulandi" | "dogrulanmadi";
  /** YYYY-MM-DD */
  date: string;
  source: string;
}

/** Additive: the pre-amendment period for rules changed by a recent law. */
export interface DeadlineTransition {
  /** YYYY-MM-DD the current period applies from. */
  effectiveFrom: string;
  /** Turkish description of the earlier period. */
  before: string;
  law: string;
}

export interface DeadlineRule {
  id: string;
  title: string;
  procedure: DeadlineProcedure;
  period: DeadlinePeriod;
  startKind: DeadlineStartKind;
  reference: DeadlineReference;
  notes: string[];
  /**
   * Conservative boolean kept for backwards compatibility: true only when the
   * HMK m.104 extension is applied by the calculator. A rule whose
   * `adliTatileTabi` is "belirsiz" keeps this false (the shorter, safer date).
   */
  adliTatilApplies: boolean;
  /** Additive (W14 B-11): true | false | "belirsiz". */
  adliTatileTabi: AdliTatilStatus;
  verified: DeadlineVerification;
  /**
   * Additive (W14 B-11): how the lawyer verifies this rule in one minute —
   * which article to open and what to compare.
   */
  nasilDogrulanir: string;
  /** Additive: false for note-only entries (no fixed period to compute). */
  computable: boolean;
  /** Additive: human period text ("2 hafta", "Tahkikat sonuna kadar"). */
  periodLabel: string;
  transition?: DeadlineTransition;
}

/**
 * Mandatory disclaimer — verbatim on every surface (contract [S]).
 *
 * W14 (B-11 / W13-COPY L31): "uygulama" replaced by "ColleX". In legal
 * Turkish "uygulama" means settled practice/case law, so the old sentence
 * read as "case law is not responsible".
 */
export const DEADLINE_DISCLAIMER =
  "Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler avukatça kontrol edilmelidir — kaçırılan süreden ColleX sorumlu değildir.";

const VERIFICATION_DATE = "2026-09-02";
const ACCESS_DATE_TR = "02.09.2026";

/**
 * A rule whose article text was NOT pulled. The wording never claims a
 * verification attempt failed for a network reason — it says what the text
 * rests on and what to compare.
 */
const UNVERIFIED: DeadlineVerification = {
  status: "dogrulanmadi",
  date: VERIFICATION_DATE,
  source:
    "Bu kuralın madde metni doğrulama turunda çekilmedi; süre, başlangıç ve notlar yürürlükteki kanun bilgisine dayanır. Madde metnini mevzuat.gov.tr'de açıp karşılaştırın.",
};

/**
 * A rule whose article text WAS in hand. `article` is the human citation and
 * `where` says where the pulled text is recorded, so the claim is traceable.
 */
function pulled(article: string, where = "mevzuat.gov.tr (Mevzuat Bilgi Sistemi)"): DeadlineVerification {
  return {
    status: "dogrulandi",
    date: VERIFICATION_DATE,
    source: `${article} — yürürlükteki madde metni ${where} üzerinden ${ACCESS_DATE_TR} tarihinde çekilip bu kuralla karşılaştırıldı.`,
  };
}

/** Text pulled during the W13-COPY audit and recorded verbatim in that report. */
function pulledByCopy(article: string): DeadlineVerification {
  return pulled(
    article,
    "mevzuat.gov.tr (Mevzuat Bilgi Sistemi); çekilen ibare W13-COPY §3'te birebir kayıtlıdır",
  );
}

const LAW_7499 = "7499 sayılı Kanun (RG 12.03.2024, yürürlük 01.06.2024)";

const NOT_FIXED: DeadlinePeriod = { value: 0, unit: "gun" };

type RuleSpec = Omit<
  DeadlineRule,
  "verified" | "computable" | "adliTatileTabi"
> & {
  computable?: boolean;
  adliTatileTabi?: AdliTatilStatus;
  verified?: DeadlineVerification;
};

function rule(spec: RuleSpec): DeadlineRule {
  return {
    ...spec,
    computable: spec.computable ?? true,
    adliTatileTabi: spec.adliTatileTabi ?? spec.adliTatilApplies,
    verified: spec.verified ?? UNVERIFIED,
  };
}

export const DEADLINE_RULES: readonly DeadlineRule[] = [
  // ------------------------------------------------------------------ HMK
  rule({
    id: "hmk-cevap",
    title: "Cevap dilekçesi süresi (HMK m.127)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "127", label: "HMK m.127/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.127/1'i açın: sürenin iki hafta olduğunu ve dava dilekçesinin tebliğinden başladığını; ek sürenin bir ayı geçemeyeceğini karşılaştırın. Basit yargılama için ayrıca m.317/2'ye bakın.",
    notes: [
      "Cevap dilekçesini verme süresi, dava dilekçesinin davalıya tebliğinden itibaren iki haftadır (HMK m.127/1). Tebliğ günü sayılmaz (HMK m.92/1).",
      "Bu süre içinde mahkemeye başvuran davalıya, cevap süresinin bitiminden itibaren işlemek, bir defaya mahsus ve bir ayı geçmemek üzere ek süre verilebilir (HMK m.127/1); ek süre talebi cevap süresi içinde yapılmalıdır.",
      "Basit yargılama usulünde de cevap süresi iki haftadır; ek süre iki haftayı geçemez (HMK m.317/2).",
      "Süresinde cevap vermeyen davalı, davacının dava dilekçesinde ileri sürdüğü vakıaların tamamını inkâr etmiş sayılır (HMK m.128).",
    ],
  }),
  rule({
    id: "hmk-cevaba-cevap",
    title: "Cevaba cevap ve ikinci cevap dilekçesi süresi (HMK m.136)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "136", label: "HMK m.136/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.136/1'i açın: iki haftalık sürenin karşı dilekçenin tebliğinden başladığını doğrulayın; basit yargılamada bu dilekçelerin verilemeyeceği için m.317/3'e de bakın.",
    notes: [
      "Davacı, cevap dilekçesinin kendisine tebliğinden itibaren iki hafta içinde cevaba cevap dilekçesi; davalı da davacının cevabının kendisine tebliğinden itibaren iki hafta içinde ikinci cevap dilekçesi verebilir (HMK m.136/1).",
      "Basit yargılama usulünde cevaba cevap ve ikinci cevap dilekçesi verilemez (HMK m.317/3).",
      "Ek süre (HMK m.127) hükmünün bu dilekçelere kıyasen uygulanıp uygulanmayacağı tartışmalıdır; ek süreye güvenmeyin.",
    ],
  }),
  rule({
    id: "hmk-istinaf",
    title: "İstinaf başvuru süresi (HMK m.345)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "345", label: "HMK m.345/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.345/1'i açın: sürenin iki hafta olduğunu ve ilamın tebliğiyle işlemeye başladığını doğrulayın. Kesinlik sınırı için m.341/2 ve HMK ek m.1'e (her takvim yılı başında yeniden değerleme oranında artar) bakın.",
    notes: [
      "İstinaf yoluna başvuru süresi iki haftadır; süre, ilamın usulen taraflardan her birine tebliğiyle işlemeye başlar (HMK m.345/1; 7251 sayılı Kanunla 28.07.2020 tarihinden itibaren).",
      "Hüküm yalnızca hüküm özeti tefhim edilerek verilmişse süre gerekçeli kararın tebliğiyle başlar (HMK m.321/2 ve m.345/1); tefhimden hesaplanan süreye güvenmeyin.",
      "Özel kanun süreleri saklıdır: icra mahkemesi kararlarına karşı istinaf süresi, kararın tebliğinden itibaren iki haftadır (İİK m.363/1; 7499 sayılı Kanunla 01.06.2024'ten itibaren — daha önce on gün ve tefhimden idi); iş mahkemesi kararlarında kanun yolu süresi ilamın tebliğinden itibaren iki haftadır (7036 sayılı Kanun m.7/3) — doğrulayın.",
      "Katılma yoluyla istinaf, istinaf dilekçesine cevap süresi içinde yapılır (HMK m.348/1).",
      "Kesinlik sınırı (HMK m.341/2; kanunda yazılı tutar HMK ek m.1 uyarınca her takvim yılı başından geçerli olmak üzere yeniden değerleme oranında artırılır) ve istinaf edilemeyen kararlar ayrıca kontrol edilmelidir.",
    ],
  }),
  rule({
    id: "hmk-istinafa-cevap",
    title: "İstinaf dilekçesine cevap süresi (HMK m.347)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "347", label: "HMK m.347/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.347/1'i açın: cevap süresinin istinaf dilekçesinin tebliğinden itibaren iki hafta olduğunu doğrulayın; katılma yolu için m.348/1'e bakın.",
    notes: [
      "İstinaf dilekçesi, kararı veren mahkemece karşı tarafa tebliğ olunur; karşı taraf, tebliğden itibaren iki hafta içinde cevap dilekçesi verebilir (HMK m.347/1).",
      "Katılma yoluyla istinaf başvurusu da bu süre içinde yapılmalıdır (HMK m.348/1).",
    ],
  }),
  rule({
    id: "hmk-temyiz",
    title: "Temyiz başvuru süresi (HMK m.361)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "361", label: "HMK m.361/1" },
    adliTatilApplies: true,
    verified: pulled("HMK m.361/1"),
    nasilDogrulanir:
      "HMK m.361/1'i açın: \"tebliğ tarihinden itibaren iki hafta içinde temyiz yoluna başvurulabilir\" ibaresini karşılaştırın. Parasal kesinlik sınırı için m.362 ve HMK ek m.1'e bakın.",
    notes: [
      "Bölge adliye mahkemesi hukuk dairelerinden verilen temyizi kabil nihai kararlar ile hakem kararlarının iptali talebi üzerine verilen kararlara karşı, tebliğ tarihinden itibaren iki hafta içinde temyiz yoluna başvurulabilir (HMK m.361/1; 7035 sayılı Kanunla bir aydan iki haftaya indirildi).",
      "Davada haklı çıkmış olan taraf da hukukî yararı bulunmak şartıyla temyiz yoluna başvurabilir (HMK m.361/2).",
      "Temyiz edilemeyen kararlar ve parasal kesinlik sınırı (HMK m.362; sınır HMK ek m.1 uyarınca her yıl yeniden değerleme oranında artar) ayrıca kontrol edilmelidir.",
      "Temyiz dilekçesine cevap süresi de tebliğden itibaren iki haftadır (HMK m.366 yollamasıyla m.347).",
    ],
  }),
  rule({
    id: "hmk-temyize-cevap",
    title: "Temyiz dilekçesine cevap süresi (HMK m.366 → m.347)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "366", label: "HMK m.366 (m.347 kıyasen)" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.366'nın m.347'ye yollamasını ve m.347/1'deki iki haftalık cevap süresini birlikte okuyun.",
    notes: [
      "Temyiz dilekçesi karşı tarafa tebliğ olunur; karşı taraf tebliğden itibaren iki hafta içinde cevap verebilir (HMK m.366 yollamasıyla m.347/1).",
      "Katılma yoluyla temyiz de bu süre içinde yapılır (HMK m.366 yollamasıyla m.348).",
    ],
  }),
  rule({
    id: "hmk-eski-hale-getirme",
    title: "Eski hâle getirme talebi (HMK m.96)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "ogrenme",
    reference: { legislationNo: "6100", article: "96", label: "HMK m.96/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "HMK m.96/1'i açın: iki haftalık sürenin engelin ortadan kalkmasından başladığını doğrulayın; m.97 ve m.98'deki şekil ve birlikte işlem yapma yükümünü okuyun.",
    notes: [
      "Eski hâle getirme, süreye uyulamamasına sebep olan engelin ortadan kalkmasından itibaren iki hafta içinde talep edilmelidir (HMK m.96/1). Başlangıç tarihi olarak engelin kalktığı günü girin.",
      "Talep, dayanağı olan sebepler ve deliller gösterilerek yapılır (HMK m.97); süreyi kaçıran taraf, talep süresi içinde yapması gereken usul işlemini de yerine getirmek zorundadır (HMK m.98).",
      "Engelin kalktığı tarih ispat konusudur; en erken tarihi esas alın.",
    ],
  }),
  rule({
    id: "hmk-kesin-sure",
    title: "Kesin süre (HMK m.94) — sabit süre değil, bilgi notu",
    procedure: "HMK",
    period: NOT_FIXED,
    periodLabel: "Hâkimin tayin ettiği süre (sabit süre yok)",
    startKind: "karar",
    reference: { legislationNo: "6100", article: "94", label: "HMK m.94" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    computable: false,
    verified: pulled("HMK m.94"),
    nasilDogrulanir:
      "HMK m.94'ü açın: kanunun belirlediği sürelerin kesin olduğunu, hâkimin tayin ettiği sürenin ancak açıkça kesin sayılabileceğini ve kesin olmayan süre için verilecek ikinci sürenin kesin olduğunu karşılaştırın.",
    notes: [
      "Kanunun belirlediği süreler kesindir (HMK m.94/1); süresi kanunda yazmayan işlemlerde süreyi hâkim tayin eder, bu yüzden burada hesaplanamaz.",
      "Hâkim, tayin ettiği sürenin kesin olduğuna karar verebilir; bu takdirde işlemi duraksamaya yer vermeyecek şekilde açıklar ve süreye uyulmamasının sonuçlarını tutanağa geçirerek ihtar eder (HMK m.94/2).",
      "Kesin olduğu belirtilmeyen süreyi geçiren taraf yeniden süre isteyebilir; bu şekilde verilecek ikinci süre kesindir ve yeniden süre verilemez (HMK m.94/2).",
      "Kesin süre içinde yapılmayan işlemi yapma hakkı ortadan kalkar (HMK m.94/3); duruşma tutanağındaki süreyi Özel süre seçeneğiyle ayrıca hesaplayın.",
      "Hâkimin tayin ettiği bir sürenin HMK m.104 adli tatil uzamasından yararlanıp yararlanmadığı tartışmalıdır (m.104 \"bu Kanunun tayin ettiği süreler\" der); hesap uzatma UYGULAMAZ, kısa ve güvenli tarihi verir.",
    ],
  }),
  rule({
    id: "hmk-on-inceleme-belge",
    title: "Ön inceleme davetiyesi — belge sunma kesin süresi (HMK m.139)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta (kesin süre)",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "139", label: "HMK m.139/1-ç" },
    adliTatilApplies: true,
    verified: pulled("HMK m.139/1-ç"),
    nasilDogrulanir:
      "HMK m.139/1-ç bendini açın: \"Davetiyenin tebliğinden itibaren iki haftalık kesin süre içinde … belgeleri mahkemeye sunmaları\" ibaresini ve m.140/5'teki sonucu karşılaştırın.",
    notes: [
      "Ön inceleme duruşması davetiyesinde, davetiyenin tebliğinden itibaren iki haftalık KESİN süre içinde tarafların dilekçelerinde gösterdikleri ancak sunmadıkları belgeleri mahkemeye sunmaları veya başka yerden getirtilecek belgeler için gereken açıklamayı yapmaları ihtar edilir (HMK m.139/1-ç).",
      "Bu süre içinde yerine getirilmezse taraf o delile dayanmaktan vazgeçmiş sayılır (HMK m.139/1-ç); ön inceleme duruşması sonunda bu yönde karar verilir (HMK m.140/5).",
      "Süre kesindir; HMK m.94/3 uyarınca geçmesiyle işlemi yapma hakkı ortadan kalkar. Başlangıç tarihi olarak ön inceleme davetiyesinin tebliğ tarihini girin.",
    ],
  }),
  rule({
    id: "hmk-bilirkisi-rapor-itiraz",
    title: "Bilirkişi raporuna itiraz süresi (HMK m.281)",
    procedure: "HMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "281", label: "HMK m.281/1" },
    adliTatilApplies: true,
    verified: pulled("HMK m.281/1"),
    nasilDogrulanir:
      "HMK m.281/1'i açın: \"raporun kendilerine tebliği tarihinden itibaren iki hafta içinde\" ibaresini ve ek süreye ilişkin son cümleyi (bir defaya mahsus, iki haftayı geçmemek üzere) karşılaştırın.",
    notes: [
      "Taraflar, bilirkişi raporunun kendilerine tebliği tarihinden itibaren iki hafta içinde raporda eksik gördükleri hususların bilirkişiye tamamlattırılmasını, belirsizliklerin açıklattırılmasını veya yeni bilirkişi atanmasını mahkemeden talep edebilirler (HMK m.281/1).",
      "İtirazın bu süre içinde hazırlanması çok zor veya imkânsızsa ya da özel/teknik bir çalışma gerektiriyorsa, yine bu süre içinde mahkemeye başvuran tarafa sürenin bitiminden itibaren işlemek, bir defaya mahsus olmak ve iki haftayı geçmemek üzere ek süre verilebilir (HMK m.281/1, 7251 sayılı Kanunla eklenen cümle).",
      "Başlangıç tarihi olarak raporun tarafınıza tebliğ edildiği günü girin; duruşmada elden tebliğ hâlinde tutanaktaki tarihi esas alın.",
    ],
  }),
  rule({
    id: "hmk-islah",
    title: "Islah (HMK m.177) — sabit süre değil, bilgi notu",
    procedure: "HMK",
    period: NOT_FIXED,
    periodLabel: "Tahkikat sona erinceye kadar (sabit süre yok)",
    startKind: "karar",
    reference: { legislationNo: "6100", article: "177", label: "HMK m.177" },
    adliTatilApplies: false,
    computable: false,
    nasilDogrulanir:
      "HMK m.176/2'yi ve m.177'yi açın: ıslahın \"aynı davada ancak bir kez\" yapılabildiğini ve tahkikatın sona ermesine kadar yapılabildiğini karşılaştırın; teminat için m.178'e bakın.",
    notes: [
      "Islah, tahkikatın sona ermesine kadar yapılabilir (HMK m.177/1); belirli bir gün sayısına bağlı değildir, bu yüzden hesaplanamaz.",
      "Yargıtayın bozma kararından veya bölge adliye mahkemesinin kaldırma kararından sonra dosya ilk derece mahkemesine gönderildiğinde, ilk derece mahkemesinin tahkikata ilişkin bir işlem yapması hâlinde tahkikat sona erinceye kadar ıslah yapılabilir; ancak bozma kararına uymakla ortaya çıkan hukukî durum kısmen veya tamamen ortadan kaldırılamaz (HMK m.177/2, 7251 sayılı Kanun).",
      "Aynı davada taraflar ancak bir kez ıslah yoluna başvurabilir (HMK m.176/2); madde metni birebir böyledir — \"her aşamada bir kez\" değildir.",
      "Islah eden taraf, hâkimin takdir edeceği teminatı bir hafta içinde yatırmak zorundadır; yatırmazsa ıslah yapılmamış sayılır (HMK m.178) — bu bir haftalık süre, hesaplayıcıda Özel süre seçeneğiyle ayrıca hesaplanabilir.",
    ],
  }),
  rule({
    id: "hmk-karar-duzeltme",
    title: "Karar düzeltme — HMK'da bu yol yok (bilgi notu)",
    procedure: "HMK",
    period: NOT_FIXED,
    periodLabel: "Yol yok",
    startKind: "teblig",
    reference: { legislationNo: "6100", article: "Geçici 3", label: "HMK geçici m.3; HUMK m.440 (mülga)" },
    adliTatilApplies: false,
    computable: false,
    nasilDogrulanir:
      "HMK geçici m.3'ü açın: HUMK hükümlerinin hangi eski dosyalarda uygulanmaya devam ettiğini kontrol edin; HMK'da karar düzeltme başlıklı bir madde bulunmadığını doğrulayın.",
    notes: [
      "6100 sayılı HMK karar düzeltme yolu öngörmez; Yargıtay hukuk dairesi kararına karşı karar düzeltme başvurusu yapılamaz.",
      "1086 sayılı HUMK m.440'taki karar düzeltme yolu yalnız HMK geçici m.3 kapsamında HUMK hükümlerinin uygulanmaya devam ettiği eski dosyalarda (bölge adliye mahkemeleri göreve başlamadan önce verilen kararlar) söz konusudur; o hâlde süre tebliğden itibaren on beş gündür — bu hesaplayıcıda modellenmemiştir.",
    ],
  }),

  // ------------------------------------------------------------------ CMK
  rule({
    id: "cmk-itiraz",
    title: "İtiraz süresi (CMK m.268)",
    procedure: "CMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "ogrenme",
    reference: { legislationNo: "5271", article: "268", label: "CMK m.268/1" },
    adliTatilApplies: false,
    verified: pulledByCopy("CMK m.268/1"),
    nasilDogrulanir:
      "CMK m.268/1'i açın: \"ilgililerin kararı öğrendiği günden itibaren iki hafta içinde\" ibaresini karşılaştırın; 01.06.2024 öncesi kararlar için 7499 sayılı Kanunun geçiş hükümlerine bakın.",
    transition: { effectiveFrom: "2024-06-01", before: "yedi gün", law: LAW_7499 },
    notes: [
      `Hâkim veya mahkeme kararlarına karşı itiraz, ilgililerin kararı öğrendiği günden itibaren iki hafta içinde kararı veren mercie verilecek dilekçe veya tutanağa geçirilmek koşulu ile zabıt kâtibine beyanda bulunmak suretiyle yapılır (CMK m.268/1; ${LAW_7499} ile "yedi gün" "iki hafta" oldu).`,
      "Öğrenme: yüze karşı verilen kararlarda tefhim, yoklukta verilen kararlarda tebliğ tarihidir. Tebliğ varsa tebliğ tarihini girin.",
      "01.06.2024 öncesi verilen kararlar için 7499 sayılı Kanunun geçiş hükümleri ve eski yedi günlük süre kontrol edilmelidir.",
      "Adli tatile rastlayan süreler işlemez ve tatilin bittiği günden itibaren üç gün uzatılmış sayılır (CMK m.331/4); tutuklu işlerde ve soruşturma evresinde bu uzatma uygulanmaz — hesap uzatma uygulamaz, uyarı verir.",
    ],
  }),
  rule({
    id: "cmk-istinaf",
    title: "İstinaf süresi (CMK m.273)",
    procedure: "CMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "tefhim",
    reference: { legislationNo: "5271", article: "273", label: "CMK m.273/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "CMK m.273/1 ve m.273/2'yi açın: sürenin hükmün açıklanmasından itibaren iki hafta olduğunu, yoklukta açıklanan hükümde tebliğden başladığını karşılaştırın.",
    transition: { effectiveFrom: "2024-06-01", before: "yedi gün", law: LAW_7499 },
    notes: [
      `İstinaf istemi, hükmün açıklanmasından itibaren iki hafta içinde hükmü veren mahkemeye bir dilekçe verilmesi veya zabıt kâtibine beyanda bulunulması suretiyle yapılır (CMK m.273/1; ${LAW_7499} ile "yedi gün" "iki hafta" oldu).`,
      "Hüküm, istinaf yoluna başvurma hakkı olanların yokluğunda açıklanmışsa süre tebliğ tarihinden başlar (CMK m.273/2); bu hâlde tebliğ tarihini girin.",
      "Süre sanık, katılan ve Cumhuriyet savcısı için ayrı ayrı işler. Tutuklu sanık, süre içinde tutukevi idaresine beyanda bulunarak da başvurabilir (CMK m.263).",
      "Adli tatile rastlayan süreler işlemez (CMK m.331/4); tutuklu işlerde ise adli tatilde de işler — hesap uzatma uygulamaz, uyarı verir.",
    ],
  }),
  rule({
    id: "cmk-temyiz",
    title: "Temyiz süresi (CMK m.291)",
    procedure: "CMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "tefhim",
    reference: { legislationNo: "5271", article: "291", label: "CMK m.291/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "CMK m.291/1-2'yi açın: iki haftalık süreyi ve yoklukta açıklanan hükümde tebliğden başlamasını karşılaştırın; gerekçeli ek dilekçe için m.295/1'e bakın.",
    transition: { effectiveFrom: "2024-06-01", before: "on beş gün", law: LAW_7499 },
    notes: [
      `Temyiz istemi, hükmün açıklanmasından itibaren iki hafta içinde hükmü veren mahkemeye bir dilekçe verilmesi veya zabıt kâtibine beyanda bulunulması suretiyle yapılır (CMK m.291/1; ${LAW_7499} ile "on beş gün" "iki hafta" oldu).`,
      "Hüküm, temyiz yoluna başvurma hakkı olanların yokluğunda açıklanmışsa süre tebliğ tarihinden başlar (CMK m.291/2); bu hâlde tebliğ tarihini girin.",
      "Temyiz nedenleri gösterilmemişse, temyiz süresinin bitmesinden veya gerekçeli kararın tebliğinden itibaren iki hafta içinde gerekçeli ek dilekçe verilir (CMK m.295/1).",
      "Temyiz edilemeyen bölge adliye mahkemesi kararları (CMK m.286/2) ayrıca kontrol edilmelidir.",
    ],
  }),
  rule({
    id: "cmk-kyok-itiraz",
    title: "Kovuşturmaya yer olmadığına dair karara itiraz (CMK m.173)",
    procedure: "CMK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "5271", article: "173", label: "CMK m.173/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "CMK m.173/1'i açın: iki haftalık sürenin kararın tebliğinden başladığını ve itirazın sulh ceza hâkimliğine yapıldığını karşılaştırın.",
    transition: { effectiveFrom: "2024-06-01", before: "on beş gün", law: LAW_7499 },
    notes: [
      `Suçtan zarar gören, kovuşturmaya yer olmadığına dair kararın kendisine tebliğ edildiği tarihten itibaren iki hafta içinde, kararı veren Cumhuriyet savcısının yargı çevresinde görev yaptığı ağır ceza mahkemesinin bulunduğu yerdeki sulh ceza hâkimliğine itiraz edebilir (CMK m.173/1; ${LAW_7499} ile "on beş gün" "iki hafta" oldu).`,
      "İtiraz dilekçesinde, kamu davasının açılmasını gerektirebilecek olaylar ve deliller belirtilir (CMK m.173/2).",
    ],
  }),

  // ----------------------------------------------------------------- İYUK
  rule({
    id: "iyuk-dava-idare",
    title: "İdari dava açma süresi — Danıştay ve idare mahkemeleri (İYUK m.7)",
    procedure: "İYUK",
    period: { value: 60, unit: "gun" },
    periodLabel: "60 gün",
    startKind: "teblig",
    reference: { legislationNo: "2577", article: "7", label: "İYUK m.7/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "İYUK m.7/1-2'yi açın: altmış günlük süreyi ve bildirimi izleyen günden başlamasını karşılaştırın; çalışmaya ara verme uzaması için m.61 ve m.8/3'e bakın.",
    notes: [
      "Dava açma süresi, özel kanunlarında ayrı süre gösterilmeyen hâllerde Danıştayda ve idare mahkemelerinde altmış gündür (İYUK m.7/1).",
      "Süre, idari uyuşmazlıklarda yazılı bildirimin yapıldığı günü izleyen günden başlar (İYUK m.7/2-a); ilanı gereken düzenleyici işlemlerde ilan tarihini izleyen günden (İYUK m.7/4).",
      "Özel kanunlardaki süreler (kamulaştırma, ihale, imar, disiplin vb.) ile idari başvurunun süreyi durdurması (İYUK m.10, m.11) ayrıca değerlendirilmelidir.",
      "Sürelerin bitmesi çalışmaya ara verme zamanına (20 Temmuz–31 Ağustos, İYUK m.61) rastlarsa, süre ara vermenin sona erdiği günü izleyen tarihten itibaren yedi gün uzamış sayılır (İYUK m.8/3).",
      "İvedi yargılama usulünde dava açma süresi otuz gündür (İYUK m.20/A/2-a).",
    ],
  }),
  rule({
    id: "iyuk-dava-vergi",
    title: "Vergi davası açma süresi — vergi mahkemeleri (İYUK m.7)",
    procedure: "İYUK",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün",
    startKind: "teblig",
    reference: { legislationNo: "2577", article: "7", label: "İYUK m.7/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "İYUK m.7/1'i ve m.7/2-b'yi açın: vergi mahkemelerinde otuz günlük süreyi ve sürenin hangi işlemi izleyen günden başladığını karşılaştırın.",
    notes: [
      "Dava açma süresi vergi mahkemelerinde otuz gündür (İYUK m.7/1).",
      "Vergi uyuşmazlıklarında süre; tahakkuku tahsile bağlı vergilerde tahsilatın, tebliğ yapılan veya tebliğ yerine geçen hâllerde tebliğin, tevkif yoluyla alınan vergilerde istihkak sahiplerine ödemenin, tescile bağlı vergilerde tescilin yapıldığı tarihi izleyen günden başlar (İYUK m.7/2-b).",
      "Ödeme emrine karşı dava süresi on beş gündür (6183 sayılı Kanun m.58) — bunun için 'Ödeme emrine karşı dava (6183 sayılı Kanun m.58)' kuralını seçin.",
      "Sürelerin bitmesi çalışmaya ara verme zamanına rastlarsa yedi gün uzamış sayılır (İYUK m.8/3).",
    ],
  }),
  rule({
    id: "amme-odeme-emri-dava",
    title: "Ödeme emrine karşı dava (6183 sayılı Kanun m.58)",
    procedure: "İYUK",
    period: { value: 15, unit: "gun" },
    periodLabel: "15 gün",
    startKind: "teblig",
    reference: { legislationNo: "6183", article: "58", label: "6183 sayılı Kanun m.58/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "6183 sayılı Kanun m.58/1'i açın: on beş günlük süreyi ve tebliğ tarihinden başlamasını karşılaştırın; haksız çıkma zammı için m.58/5'e bakın.",
    notes: [
      "Kendisine ödeme emri tebliğ olunan şahıs, böyle bir borcu olmadığı veya kısmen ödediği veya zamanaşımına uğradığı hakkında tebliğ tarihinden itibaren on beş gün içinde vergi mahkemesinde dava açabilir (6183 sayılı Kanun m.58/1; 7061 sayılı Kanunla 01.01.2018'den itibaren yedi günden on beş güne çıkarıldı).",
      "Süre İYUK m.8 uyarınca hesaplanır; bitişi çalışmaya ara verme zamanına rastlarsa yedi gün uzar (İYUK m.8/3).",
      "Haksız çıkma zammı (6183 sayılı Kanun m.58/5) riski nedeniyle dava açmadan önce değerlendirin.",
    ],
  }),
  rule({
    id: "iyuk-cevap",
    title: "Savunma / cevap süresi (İYUK m.16)",
    procedure: "İYUK",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün",
    startKind: "teblig",
    reference: { legislationNo: "2577", article: "16", label: "İYUK m.16/3" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "İYUK m.16/3'ü açın: otuz günlük cevap süresini ve bir defaya mahsus otuz günü geçmeyen uzatmayı karşılaştırın; ivedi yargılama için m.20/A/2-c'ye bakın.",
    notes: [
      "Taraflar, yapılacak tebliğlere karşı, tebliğ tarihinden itibaren otuz gün içinde cevap verebilirler (İYUK m.16/3).",
      "Bu süre, ancak haklı sebeplerin bulunması hâlinde, taraflardan birinin isteği üzerine görevli mahkeme kararı ile otuz günü geçmemek ve bir defaya mahsus olmak üzere uzatılabilir; uzatma talebi süre içinde yapılmalıdır (İYUK m.16/3).",
      "Sürenin geçmesinden sonra yapılan savunmalara veya ikinci dilekçelere dayanarak hak iddia edilemez (İYUK m.16/3).",
      "İvedi yargılama usulünde savunma süresi dava dilekçesinin tebliğinden itibaren on beş gündür; bir defaya mahsus en fazla on beş gün uzatılabilir (İYUK m.20/A/2-c).",
    ],
  }),
  rule({
    id: "iyuk-istinaf",
    title: "İstinaf süresi — idari yargı (İYUK m.45)",
    procedure: "İYUK",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün",
    startKind: "teblig",
    reference: { legislationNo: "2577", article: "45", label: "İYUK m.45/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "İYUK m.45/1'i açın: otuz günlük süreyi ve kesinlik sınırını karşılaştırın; sınır İYUK ek m.1 uyarınca her yıl yeniden değerleme oranında artar.",
    notes: [
      "İdare ve vergi mahkemelerinin kararlarına karşı, kararın tebliğinden itibaren otuz gün içinde mahkemenin bulunduğu yargı çevresindeki bölge idare mahkemesine istinaf yoluna başvurulabilir (İYUK m.45/1).",
      "Konusu, her yıl yeniden değerleme oranında güncellenen parasal sınırı aşmayan davalarda verilen kararlar kesindir; sınırı kontrol edin (İYUK m.45/1, ek m.1).",
      "İstinaf, temyizin şekil ve usullerine tabidir (İYUK m.45/2); istinaf dilekçesine cevap süresi de otuz gündür (İYUK m.48/3 kıyasen).",
      "İvedi yargılama usulünde istinaf yolu kapalıdır; temyiz süresi on beş gündür (İYUK m.20/A/2-g).",
    ],
  }),
  rule({
    id: "iyuk-temyiz",
    title: "Temyiz süresi — idari yargı (İYUK m.46)",
    procedure: "İYUK",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün",
    startKind: "teblig",
    reference: { legislationNo: "2577", article: "46", label: "İYUK m.46/1" },
    adliTatilApplies: true,
    nasilDogrulanir:
      "İYUK m.46/1'i açın: otuz günlük süreyi doğrulayın; temyize açık bölge idare mahkemesi kararlarının m.46/2'deki sayılı listeyle sınırlı olduğunu kontrol edin.",
    notes: [
      "Danıştay dava dairelerinin nihai kararları ile bölge idare mahkemelerinin temyize tabi kararları, kararın tebliğinden itibaren otuz gün içinde Danıştayda temyiz edilebilir (İYUK m.46/1).",
      "Temyiz dilekçesine cevap süresi tebliğ tarihinden itibaren otuz gündür (İYUK m.48/3).",
      "Temyiz edilebilen bölge idare mahkemesi kararları İYUK m.46/2'de sayılan konularla sınırlıdır; diğerleri kesindir — listeyi kontrol edin.",
    ],
  }),

  // ------------------------------------------------------------------ İİK
  rule({
    id: "iik-odeme-emri-itiraz",
    title: "Ödeme emrine itiraz — genel haciz yolu (İİK m.62)",
    procedure: "İİK",
    period: { value: 7, unit: "gun" },
    periodLabel: "7 gün",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "62", label: "İİK m.62/1" },
    adliTatilApplies: false,
    verified: pulledByCopy("İİK m.62/1"),
    nasilDogrulanir:
      "İİK m.62/1'i açın: \"ödeme emrinin tebliği tarihinden itibaren yedi gün içinde … icra dairesine bildirmeye mecburdur\" ibaresini karşılaştırın; kısmî itiraz m.62/4, imzanın reddi m.62/5.",
    notes: [
      "Borçlu, itirazını ödeme emrinin tebliği tarihinden itibaren yedi gün içinde dilekçe ile veya sözlü olarak icra dairesine bildirmek zorundadır (İİK m.62/1).",
      "İtiraz icra dairesine yapılır, icra mahkemesine değil. Süre İİK m.19 uyarınca hesaplanır: tebliğ günü sayılmaz, son gün resmî tatile rastlarsa izleyen ilk iş günü.",
      "Süresinde itiraz edilmezse takip kesinleşir; gecikmiş itiraz yalnız İİK m.65 koşullarında (engelin kalkmasından itibaren üç gün) mümkündür.",
      "İcra takip işlemleri adli tatile tabi değildir; HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-kambiyo-itiraz",
    title: "Kambiyo senetlerine özgü haciz yolunda itiraz (İİK m.168)",
    procedure: "İİK",
    period: { value: 5, unit: "gun" },
    periodLabel: "5 gün",
    startKind: "teblig",
    reference: {
      legislationNo: "2004",
      article: "168",
      label: "İİK m.168/1 (4) ve (5) numaralı bentler",
    },
    adliTatilApplies: false,
    verified: pulled("İİK m.168/1"),
    nasilDogrulanir:
      "İİK m.168/1'i açın: (2) numaralı bentte on günlük ödeme, (3) numaralı bentte beş günlük şikâyet, (4) numaralı bentte beş günlük imza itirazı, (5) numaralı bentte beş günlük borca itiraz sürelerini karşılaştırın.",
    notes: [
      "Borçlu, borcu olmadığını, borcun itfa veya imhal edildiğini, alacağın zamanaşımına uğradığını yahut yetki itirazını sebepleriyle birlikte beş gün içinde icra mahkemesine bir dilekçe ile bildirmelidir (İİK m.168/1'in (5) numaralı bendi).",
      "Senet altındaki imzanın kendisine ait olmadığı iddiası da aynı beş günlük süre içinde ve AYRICA, AÇIKÇA bir dilekçe ile icra mahkemesine bildirilmelidir (İİK m.168/1'in (4) numaralı bendi); imzanın haksız yere inkârı para cezası doğurur. İmzaya itirazın incelenmesi İİK m.170'e tabidir — madde metnini ayrıca kontrol edin.",
      "Takip dayanağı senet kambiyo senedi vasfını taşımıyorsa şikâyet süresi de beş gündür (İİK m.168/1'in (3) numaralı bendi); ödeme süresi on gündür ((2) numaralı bent).",
      "Süre İİK m.19 uyarınca hesaplanır; adli tatil uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-itirazin-iptali",
    title: "İtirazın iptali davası (İİK m.67)",
    procedure: "İİK",
    period: { value: 1, unit: "yil" },
    periodLabel: "1 yıl",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "67", label: "İİK m.67/1" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    nasilDogrulanir:
      "İİK m.67/1'i açın: bir yıllık sürenin itirazın tebliğinden başladığını karşılaştırın; yıl hesabı için m.19/2'ye, adli tatil için HMK m.103–104'e bakın.",
    notes: [
      "Alacaklı, itirazın kendisine tebliği tarihinden itibaren bir sene içinde mahkemeye başvurarak itirazın iptalini isteyebilir (İİK m.67/1).",
      "Bir yıllık süre hak düşürücüdür; süre geçtikten sonra genel hükümlere göre alacak davası açılabilir, ancak takibe devam ve icra inkâr tazminatı imkânı kalmaz.",
      "Yıl olarak belirlenen süre, başladığı güne son yılda karşılık gelen günde biter (İİK m.19/2).",
      "Dava şartı arabuluculuk kapsamındaki alacaklarda (TTK m.5/A, 7036 sayılı Kanun m.3, 6325 sayılı Kanun m.18/B) arabuluculuk başvurusuyla sürenin durması ayrıca değerlendirilmelidir.",
      "Bu bir dava açma süresidir ve adli tatile tabi olup olmadığı tartışmalıdır: hesap, HMK m.104 uzamasını UYGULAMAZ (kısa ve güvenli tarih). Uzamaya güvenmeden hareket edin.",
    ],
  }),
  rule({
    id: "iik-itirazin-kaldirilmasi",
    title: "İtirazın kaldırılması talebi (İİK m.68)",
    procedure: "İİK",
    period: { value: 6, unit: "ay" },
    periodLabel: "6 ay",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "68", label: "İİK m.68/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "İİK m.68/1'i açın: altı aylık sürenin itirazın tebliğinden başladığını karşılaştırın; ay hesabı için m.19/2'ye, icra mahkemesi işlerinin ivediliği için m.18/1'e bakın.",
    notes: [
      "Alacaklı, itirazın kendisine tebliği tarihinden itibaren altı ay içinde icra mahkemesinden itirazın kaldırılmasını isteyebilir (İİK m.68/1; m.68/a ve m.68/b için de aynı süre).",
      "Bu süre içinde itirazın kaldırılması istenmezse aynı takip için yeniden itirazın kaldırılması istenemez; itirazın iptali davası (bir yıl) açılabilir.",
      "Ay ile belirlenen süre, başladığı güne son ayda karşılık gelen günde biter; o gün yoksa ayın son günü (İİK m.19/2).",
      "İcra mahkemesi işleri ivedidir (İİK m.18/1) ve adli tatilde görülür; HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-sikayet",
    title: "İcra dairesi işlemine şikâyet (İİK m.16)",
    procedure: "İİK",
    period: { value: 7, unit: "gun" },
    periodLabel: "7 gün",
    startKind: "ogrenme",
    reference: { legislationNo: "2004", article: "16", label: "İİK m.16/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "İİK m.16/1'i açın: yedi günlük sürenin işlemin öğrenildiği tarihten başladığını karşılaştırın; süresiz şikâyet hâlleri için m.16/2'ye bakın.",
    notes: [
      "Kanunun zamanaşımına ilişkin hükümlerine aykırı olmayan işlemler hakkında şikâyet, işlemin öğrenildiği tarihten itibaren yedi gün içinde icra mahkemesine yapılır (İİK m.16/1).",
      "Bir hakkın yerine getirilmemesinden veya sebepsiz sürüncemede bırakılmasından dolayı ve kamu düzenine aykırılık hâllerinde şikâyet süreye bağlı değildir (İİK m.16/2).",
      "Öğrenme tarihi ispat konusudur; tebliğ varsa tebliğ tarihini esas alın.",
    ],
  }),
  rule({
    id: "iik-icra-mahkemesi-istinaf",
    title: "İcra mahkemesi kararına istinaf (İİK m.363)",
    procedure: "İİK",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "363", label: "İİK m.363/1" },
    adliTatilApplies: false,
    verified: pulled("İİK m.363/1"),
    transition: {
      effectiveFrom: "2024-06-01",
      before: "on gün (tefhim veya tebliğden)",
      law: LAW_7499,
    },
    nasilDogrulanir:
      "İİK m.363/1'i açın: \"İstinaf yoluna başvuru süresi … tebliğ tarihinden itibaren iki haftadır\" ibaresini ve 135 numaralı dipnotu (7499 sayılı Kanunun 37 nci maddesiyle \"tefhim veya\" ibaresi madde metninden çıkarılmış, \"on gündür.\" ibaresi \"iki haftadır.\" olmuştur) karşılaştırın. Parasal sınır için maddedeki tutarı ve İİK ek m.1'i kontrol edin.",
    notes: [
      "İcra mahkemesi kararlarına karşı istinaf yoluna başvuru süresi, kararın TEBLİĞİ tarihinden itibaren İKİ HAFTADIR (İİK m.363/1). 7499 sayılı Kanunun 37 nci maddesiyle 01.06.2024'ten itibaren \"tefhim veya\" ibaresi madde metninden çıkarılmış ve \"on gündür.\" ibaresi \"iki haftadır.\" şeklinde değiştirilmiştir; 01.06.2024 öncesi kararlarda eski süreyi kontrol edin.",
      "İİK m.363/1 istinafa KAPALI (kesin) kararları tek tek sayar; bunların DIŞINDAKİ icra mahkemesi kararlarına karşı, ait olduğu alacak, hak veya malın değer ya da miktarının kanunda yazılı parasal sınırı geçmesi şartıyla istinafa başvurulabilir. Güncel sınırı kontrol edin.",
      "Süre tefhimden değil tebliğden işler; duruşmada öğrenilmiş olsa dahi tebliğ tarihini girin.",
      "İcra mahkemesi işleri ivedidir (İİK m.18/1); adli tatilde görülür, HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-haciz-isteme",
    title: "Haciz isteme süresi (İİK m.78)",
    procedure: "İİK",
    period: { value: 1, unit: "yil" },
    periodLabel: "1 yıl",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "78", label: "İİK m.78/2" },
    adliTatilApplies: false,
    verified: pulled("İİK m.78/2"),
    nasilDogrulanir:
      "İİK m.78'in ikinci fıkrasını açın: \"Haciz istemek hakkı, ödeme emrinin tebliği tarihinden itibaren bir sene geçmekle düşer\" ibaresini ve duran süreleri (itiraz/dava, taksit sözleşmesi) karşılaştırın.",
    notes: [
      "Haciz istemek hakkı, ödeme emrinin tebliği tarihinden itibaren bir sene geçmekle düşer (İİK m.78/2). Başlangıç tarihi olarak ödeme emrinin tebliğ tarihini girin.",
      "İtiraz veya dava hâlinde bunların vukuundan hükmün kesinleşmesine kadar, taksit sözleşmesi hâlinde sözleşmenin ihlaline kadar geçen zaman bu süreye katılmaz (İİK m.78/2) — bu duraklamalar hesaba KATILMAZ, süreyi elle uzatın.",
      "Haciz talebi süresinde yapılmaz veya geri alındıktan sonra bu süre içinde yenilenmezse dosya muameleden kaldırılır (İİK m.78/4); yeniden haciz istemek yenileme talebinin borçluya tebliğine bağlıdır (m.78/5).",
      "İcra takip işlemleri adli tatile tabi değildir; HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-kiymet-takdiri-sikayet",
    title: "Kıymet takdirine şikâyet (İİK m.128/a)",
    procedure: "İİK",
    period: { value: 7, unit: "gun" },
    periodLabel: "7 gün",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "128/a", label: "İİK m.128/a-1" },
    adliTatilApplies: false,
    verified: pulled("İİK m.128/a birinci fıkra"),
    nasilDogrulanir:
      "İİK m.128/a'nın birinci fıkrasını açın: \"raporun tebliğinden itibaren yedi gün içinde … icra mahkemesinde şikâyette bulunabilirler\" ibaresini ve masrafın yatırılması için tanınan ikinci yedi günlük süreyi karşılaştırın.",
    notes: [
      "Kıymet takdirinin tebliğ edildiği ilgililer, raporun tebliğinden itibaren yedi gün içinde raporu düzenleten icra dairesinin bulunduğu yerdeki icra mahkemesinde şikâyette bulunabilirler (İİK m.128/a-1).",
      "Şikâyet tarihinden itibaren yedi gün içinde gerekli masraf ve ücret mahkeme veznesine yatırılmazsa şikâyet başka bir işleme gerek olmaksızın kesin olarak reddedilir (İİK m.128/a-1) — bu ikinci yedi günlük süreyi Özel süre seçeneğiyle ayrıca hesaplayın.",
      "Kesinleşen kıymet takdirinin yapıldığı tarihten itibaren iki yıl geçmedikçe yeniden kıymet takdiri istenemez (İİK m.128/a-2).",
      "İcra takip işlemleri adli tatile tabi değildir; HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "iik-ihalenin-feshi",
    title: "İhalenin feshi talebi (İİK m.134)",
    procedure: "İİK",
    period: { value: 7, unit: "gun" },
    periodLabel: "7 gün",
    startKind: "karar",
    reference: { legislationNo: "2004", article: "134", label: "İİK m.134/2" },
    adliTatilApplies: false,
    verified: pulled("İİK m.134/2"),
    nasilDogrulanir:
      "İİK m.134'ün ikinci fıkrasını açın: yedi günlük sürenin İHALE TARİHİNDEN itibaren işlediğini ve kimlerin talep edebileceğini karşılaştırın; sonradan öğrenilen fesat için maddenin \"şikayet müddeti ıttıla tarihinden başlar\" fıkrasına bakın.",
    notes: [
      "İhalenin feshi, sayılan ilgililer tarafından icra mahkemesinden şikâyet yolu ile İHALE TARİHİNDEN itibaren yedi gün içinde istenebilir (İİK m.134/2). Başlangıç tarihi olarak ihale gününü girin.",
      "İlgililerin ihale yapıldığı ana kadar cereyan eden muamelelerdeki yolsuzluklara en geç ihale günü ıttıla peyda ettiği kabul edilir (İİK m.134/2).",
      "Satış ilanı tebliğ edilmemiş veya satılanın esaslı vasıflarındaki hataya ya da ihaledeki fesada sonradan vakıf olunmuşsa şikâyet süresi ıttıla tarihinden başlar; bu süre, ihalenin yapıldığına ilişkin kararın elektronik satış portalında ilan edildiği tarihten itibaren BİR SENEYİ geçemez — bu hâlde öğrenme tarihini girin.",
      "Sayılan ilgililer dışındakilerin talebi nispi harca ve ihale bedelinin yüzde beşi oranında teminata tabidir (İİK m.134/3-4); talep reddedilirse para cezası riski vardır (m.134/5).",
    ],
  }),
  rule({
    id: "iik-kira-odeme-emri-itiraz",
    title: "Kira alacağı için ödeme emrine itiraz (İİK m.269)",
    procedure: "İİK",
    period: { value: 7, unit: "gun" },
    periodLabel: "7 gün",
    startKind: "teblig",
    reference: { legislationNo: "2004", article: "269", label: "İİK m.269/2" },
    adliTatilApplies: false,
    verified: pulled("İİK m.269"),
    nasilDogrulanir:
      "İİK m.269'un ikinci fıkrasını açın: \"borçlu, yedi gün içinde, itiraz sebeplerini 62 nci madde hükümleri dahilinde icra dairesine bildirmeye mecburdur\" ibaresini ve dördüncü fıkradaki üç günlük istisnayı karşılaştırın.",
    notes: [
      "Adi kira veya hasılat kirasına dayanan takipte borçlu, ödeme emrinin tebliğinden itibaren yedi gün içinde itiraz sebeplerini İİK m.62 hükümleri dâhilinde icra dairesine bildirmek zorundadır (İİK m.269/2).",
      "Borçlu, itirazında kira akdini ve varsa mukavelenamedeki imzasını AÇIK ve KESİN olarak reddetmezse akdi kabul etmiş sayılır (İİK m.269/2) — bu, sonradan telafi edilemeyen bir sonuçtur.",
      "İtiraz takibi durdurur; itirazın tebliğinden itibaren ALTI AY içinde itirazın kaldırılmasını istemeyen alacaklı, aynı alacak için bir daha ilamsız takip yapamaz (İİK m.269/3).",
      "TBK m.315'e (eski BK m.260) dayanan ve kiralayana altı günlük mühletin sonunda fesih imkânı veren hâllerde itiraz süresi ÜÇ gündür (İİK m.269/4) — bu hâlde Özel süre seçeneğini kullanın.",
      "İcra takip işlemleri adli tatile tabi değildir; HMK m.104 uzaması uygulanmaz.",
    ],
  }),

  // ------------------------------------------------------------------ AYM
  rule({
    id: "aym-bireysel-basvuru",
    title: "Anayasa Mahkemesine bireysel başvuru süresi (6216 sayılı Kanun m.47/5)",
    procedure: "AYM",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün",
    startKind: "teblig",
    reference: {
      legislationNo: "6216",
      article: "47",
      label: "6216 sayılı Kanun m.47/5",
    },
    adliTatilApplies: false,
    nasilDogrulanir:
      "6216 sayılı Kanun m.47/5'i açın: otuz günlük sürenin başvuru yollarının tüketildiği (yol öngörülmemişse ihlalin öğrenildiği) tarihten başladığını karşılaştırın; mazeret için AYM İçtüzüğü m.64/2'ye bakın.",
    notes: [
      "Bireysel başvurunun, başvuru yollarının tüketildiği tarihten; başvuru yolu öngörülmemişse ihlalin öğrenildiği tarihten itibaren otuz gün içinde yapılması gerekir (6216 sayılı Kanun m.47/5).",
      "Süre, nihai kararın tebliğinden veya öğrenilmesinden itibaren işler; hangi tarihin esas alınacağı AYM içtihadına göre belirlenir — en erken tarihi esas alın.",
      "Haklı mazeret hâlinde, mazeretin kalktığı tarihten itibaren on beş gün içinde başvurulabilir (AYM İçtüzüğü m.64/2).",
      "AYM içtihadına göre adli tatil bireysel başvuru süresini uzatmaz; harç veya belge eksikliği de süreyi durdurmaz.",
    ],
  }),

  // ---------------------------------------------------------------- Diğer
  rule({
    id: "thh-itiraz",
    title: "Tüketici hakem heyeti kararına itiraz (TKHK m.70)",
    procedure: "Diğer",
    period: { value: 15, unit: "gun" },
    periodLabel: "15 gün",
    startKind: "teblig",
    reference: { legislationNo: "6502", article: "70", label: "TKHK m.70/3" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    nasilDogrulanir:
      "TKHK m.70/3'ü açın: on beş günlük itiraz süresini ve itirazın tüketici mahkemesine yapıldığını karşılaştırın; itiraz üzerine verilen kararın kesinliği için m.70/5'e bakın.",
    notes: [
      "Taraflar, tüketici hakem heyetinin kararlarına karşı tebliğ tarihinden itibaren on beş gün içinde tüketici hakem heyetinin bulunduğu yerdeki tüketici mahkemesine itiraz edebilir (TKHK m.70/3).",
      "İtiraz, kararın icrasını durdurmaz; ancak talep hâlinde mahkeme tedbiren durdurabilir (TKHK m.70/3). İtiraz üzerine verilen karar kesindir (TKHK m.70/5).",
      "Süre TKHK ile belirlendiğinden HMK m.104 adli tatil uzamasının uygulanıp uygulanmayacağı tartışmalıdır; hesap uzatma UYGULAMAZ (kısa ve güvenli tarih).",
    ],
  }),
  rule({
    id: "is-arabuluculuk-dava-sarti",
    title: "İş uyuşmazlıklarında dava şartı arabuluculuk (7036 sayılı Kanun m.3) — bilgi notu",
    procedure: "Diğer",
    period: NOT_FIXED,
    periodLabel: "Dava şartı (sabit süre yok)",
    startKind: "karar",
    reference: { legislationNo: "7036", article: "3", label: "7036 sayılı Kanun m.3" },
    adliTatilApplies: false,
    computable: false,
    nasilDogrulanir:
      "7036 sayılı Kanun m.3'ü açın: arabulucuya başvurunun dava şartı olduğunu (m.3/1-2), üç haftalık sonuçlandırma süresini (m.3/10) ve zamanaşımının durmasını (m.3/17) karşılaştırın.",
    notes: [
      "Kanuna, bireysel veya toplu iş sözleşmesine dayanan işçi veya işveren alacağı ve tazminatı ile işe iade talebiyle açılan davalarda, arabulucuya başvurulmuş olması dava şartıdır (7036 sayılı Kanun m.3/1). Arabulucuya başvurulmadan açılan dava, dava şartı yokluğundan usulden reddedilir (m.3/2).",
      "Arabulucu, yapılan başvuruyu görevlendirildiği tarihten itibaren üç hafta içinde sonuçlandırır; zorunlu hâllerde en fazla bir hafta uzatılabilir (m.3/10).",
      "Arabuluculuk bürosuna başvurulmasından son tutanağın düzenlendiği tarihe kadar geçen sürede zamanaşımı durur ve hak düşürücü süre işlemez (m.3/17).",
      "İşe iade için: fesih bildiriminin tebliğinden itibaren bir ay içinde arabulucuya başvuru, anlaşmazlık son tutanağından itibaren iki hafta içinde dava — 'İşe iade — arabulucuya başvuru süresi' ve 'İşe iade davası açma süresi' kurallarını ayrı ayrı hesaplayın.",
    ],
  }),
  rule({
    id: "is-ise-iade-arabulucu-basvuru",
    title: "İşe iade — arabulucuya başvuru süresi (İş K. m.20)",
    procedure: "Diğer",
    period: { value: 1, unit: "ay" },
    periodLabel: "1 ay",
    startKind: "teblig",
    reference: { legislationNo: "4857", article: "20", label: "İş K. m.20/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "İş K. m.20/1'i açın: bir aylık sürenin fesih bildiriminin tebliğinden başladığını ve arabulucuya başvurunun zorunlu olduğunu karşılaştırın.",
    notes: [
      "İşçi, fesih bildiriminde sebep gösterilmediği veya gösterilen sebebin geçerli olmadığı iddiası ile fesih bildiriminin tebliği tarihinden itibaren bir ay içinde işe iade talebiyle arabulucuya başvurmak zorundadır (İş K. m.20/1).",
      "Bir aylık süre hak düşürücüdür; ay ile belirlenen süre başladığı güne son ayda karşılık gelen günde biter, o gün yoksa ayın son günü.",
      "Fesih bildirimi yazılı yapılmamışsa sürenin başlangıcı tartışmalıdır; en erken tarihi esas alın.",
    ],
  }),
  rule({
    id: "is-ise-iade-dava",
    title: "İşe iade davası açma süresi (İş K. m.20)",
    procedure: "Diğer",
    period: { value: 2, unit: "hafta" },
    periodLabel: "2 hafta",
    startKind: "karar",
    reference: { legislationNo: "4857", article: "20", label: "İş K. m.20/1" },
    adliTatilApplies: false,
    nasilDogrulanir:
      "İş K. m.20/1'i açın: anlaşmaya varılamaması hâlinde son tutanağın düzenlendiği tarihten itibaren iki hafta içinde iş mahkemesinde dava açılabileceğini karşılaştırın.",
    notes: [
      "Arabuluculuk faaliyeti sonunda anlaşmaya varılamaması hâlinde, son tutanağın düzenlendiği tarihten itibaren iki hafta içinde iş mahkemesinde dava açılabilir (İş K. m.20/1).",
      "Başlangıç tarihi olarak arabuluculuk son tutanağının düzenlendiği tarihi girin.",
      "İşçi davaları adli tatilde de görülür (HMK m.103/1-ç); HMK m.104 uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "tbk-kira-odeme-suresi",
    title: "Kira bedelinin ödenmemesi — verilecek süre (TBK m.315)",
    procedure: "Diğer",
    period: { value: 30, unit: "gun" },
    periodLabel: "30 gün (konut ve çatılı işyeri)",
    startKind: "teblig",
    reference: { legislationNo: "6098", article: "315", label: "TBK m.315/2" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    verified: pulled("TBK m.315"),
    nasilDogrulanir:
      "TBK m.315'in ikinci fıkrasını açın: \"Kiracıya verilecek süre en az on gün, konut ve çatılı işyeri kiralarında ise en az otuz gündür. Bu süre, kiracıya yazılı bildirimin yapıldığı tarihi izleyen günden itibaren işlemeye başlar\" ibaresini karşılaştırın.",
    notes: [
      "Kiracı muaccel kira bedelini veya yan gideri ödemezse, kiraya veren yazılı olarak bir süre verip bu sürede de ödenmemesi hâlinde sözleşmeyi feshedeceğini bildirebilir (TBK m.315/1).",
      "Kiracıya verilecek süre EN AZ on gün, konut ve çatılı işyeri kiralarında ise EN AZ otuz gündür (TBK m.315/2). Bu kural otuz günü hesaplar; konut/çatılı işyeri dışındaki kiralarda on günü Özel süre seçeneğiyle hesaplayın.",
      "Süre, kiracıya YAZILI BİLDİRİMİN YAPILDIĞI TARİHİ İZLEYEN GÜNDEN itibaren işler (TBK m.315/2). Başlangıç tarihi olarak ihtarnamenin tebliğ tarihini girin.",
      "Bu bir maddi hukuk süresidir; adli tatil uzaması uygulanmaz. Süre sonunda fesih için ayrıca İİK m.269 vd. veya tahliye davası yolu değerlendirilmelidir.",
    ],
  }),
  rule({
    id: "tbk-tahliye-taahhudu-dava",
    title: "Tahliye taahhüdüne dayalı icra/dava süresi (TBK m.352/1)",
    procedure: "Diğer",
    period: { value: 1, unit: "ay" },
    periodLabel: "1 ay",
    startKind: "karar",
    reference: { legislationNo: "6098", article: "352", label: "TBK m.352/1" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    verified: pulled("TBK m.352/1"),
    nasilDogrulanir:
      "TBK m.352'nin birinci fıkrasını açın: \"kiraya veren, kira sözleşmesini bu tarihten başlayarak bir ay içinde icraya başvurmak veya dava açmak suretiyle sona erdirebilir\" ibaresini karşılaştırın; taahhüdün YAZILI olması yeter, el yazısı aranmaz.",
    notes: [
      "Kiracı, kiralananın teslim edilmesinden SONRA kiralananı belli bir tarihte boşaltmayı YAZILI olarak üstlendiği hâlde boşaltmazsa, kiraya veren sözleşmeyi TAAHHÜT EDİLEN TAHLİYE TARİHİNDEN BAŞLAYARAK BİR AY içinde icraya başvurmak veya dava açmak suretiyle sona erdirebilir (TBK m.352/1).",
      "Başlangıç tarihi olarak taahhütte yazılı tahliye tarihini girin; bir aylık süre hak düşürücüdür ve kaçırılırsa taahhüde dayanılamaz.",
      "Kanun yalnızca YAZILI şekil arar; el yazısı bir geçerlilik şartı değildir. Taahhüdün kiralananın tesliminden sonra verilmiş olması ise geçerlilik şartıdır.",
      "Bu bir maddi hukuk (hak düşürücü) süresidir; adli tatil uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "tbk-iki-hakli-ihtar-dava",
    title: "İki haklı ihtara dayalı tahliye davası süresi (TBK m.352/2)",
    procedure: "Diğer",
    period: { value: 1, unit: "ay" },
    periodLabel: "1 ay",
    startKind: "karar",
    reference: { legislationNo: "6098", article: "352", label: "TBK m.352/2" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    verified: pulled("TBK m.352/2"),
    nasilDogrulanir:
      "TBK m.352'nin ikinci fıkrasını açın: iki haklı YAZILI ihtar şartını ve kiraya verenin \"kira süresinin ve bir yıldan uzun süreli kiralarda ihtarların yapıldığı kira yılının bitiminden başlayarak bir ay içinde\" dava açabileceğini karşılaştırın.",
    notes: [
      "Kiracı, bir yıldan kısa süreli kiralarda kira süresi içinde; bir yıl ve daha uzun süreli kiralarda bir kira yılı veya bir kira yılını aşan süre içinde kira bedelini ödemediği için kendisine YAZILI olarak iki haklı ihtarda bulunulmasına sebep olmuşsa, kiraya veren dava yoluyla sözleşmeyi sona erdirebilir (TBK m.352/2).",
      "Süre, kira süresinin ve bir yıldan uzun süreli kiralarda ihtarların yapıldığı KİRA YILININ BİTİMİNDEN başlayarak bir aydır. Başlangıç tarihi olarak o kira yılının bittiği günü girin.",
      "Yol yalnızca DAVA yoludur; bu fıkra için icra takibiyle tahliye öngörülmemiştir.",
      "Bu bir maddi hukuk (hak düşürücü) süresidir; adli tatil uzaması uygulanmaz.",
    ],
  }),
  rule({
    id: "tmk-mirasin-reddi",
    title: "Mirasın reddi süresi (TMK m.606)",
    procedure: "Diğer",
    period: { value: 3, unit: "ay" },
    periodLabel: "3 ay",
    startKind: "ogrenme",
    reference: { legislationNo: "4721", article: "606", label: "TMK m.606" },
    adliTatilApplies: false,
    adliTatileTabi: "belirsiz",
    verified: pulled("TMK m.606"),
    nasilDogrulanir:
      "TMK m.606'yı açın: \"Miras, üç ay içinde reddolunabilir\" ibaresini ve sürenin yasal mirasçılarda mirasbırakanın ölümünü öğrendikleri, atanmış mirasçılarda tasarrufun resmen bildirildiği tarihten işlediğini karşılaştırın; terekenin yazımı hâli için m.607'ye bakın.",
    notes: [
      "Miras, üç ay içinde reddolunabilir (TMK m.606/1).",
      "Bu süre, yasal mirasçılar için mirasçı olduklarını daha sonra öğrendikleri ispat edilmedikçe mirasbırakanın ölümünü öğrendikleri; vasiyetname ile atanmış mirasçılar için mirasbırakanın tasarrufunun kendilerine resmen bildirildiği tarihten işlemeye başlar (TMK m.606/2). En erken tarihi esas alın.",
      "Koruma önlemi olarak terekenin yazımı hâlinde süre, yazım işleminin sona erdiğinin sulh hâkimi tarafından bildirilmesiyle başlar (TMK m.607) — bu hâlde bildirim tarihini girin.",
      "Süre hak düşürücüdür ve geçmesiyle miras kayıtsız şartsız kazanılmış olur; adli tatil uzaması uygulanmaz.",
    ],
  }),
];

export function findDeadlineRule(
  id: string,
  rules: readonly DeadlineRule[] = DEADLINE_RULES,
): DeadlineRule | undefined {
  return rules.find((candidate) => candidate.id === id);
}

export const DEADLINE_PROCEDURES: readonly DeadlineProcedure[] = [
  "HMK",
  "CMK",
  "İYUK",
  "İİK",
  "AYM",
  "Diğer",
];

export const DEADLINE_UNITS: readonly DeadlineUnit[] = ["gun", "hafta", "ay", "yil"];

export const UNIT_LABELS_TR: Readonly<Record<DeadlineUnit, string>> = {
  gun: "gün",
  hafta: "hafta",
  ay: "ay",
  yil: "yıl",
};

/**
 * Research intake contract + deterministic issue extraction (Lane B4; Master
 * Build Brief 10.1 "intake + soru/alt mesele ayrıştırma" and 10.2 planner
 * rules: jurisdiction/as_of/source scope/data class are always explicit).
 *
 * Everything in this module is pure and deterministic: same question in, same
 * analysis out. The extraction runs the existing exact reference parser and
 * Turkish search normalizer; the concept/regulator/temporal tables below are
 * small, auditable, and additive-only.
 */

import { CAPABILITY_NAMES, type CapabilityName } from "../capabilities/registry.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences, type ParsedReference } from "../retrieval/referenceParser.js";
import { softenFinalConsonant, stemTurkish } from "../retrieval/turkishAnalyzer.js";
import { explicitResearchFocus } from "../retrieval/researchFocus.js";

// ---------------------------------------------------------------------------
// Intake contract
// ---------------------------------------------------------------------------

export interface ResearchIntake {
  question: string;
  /** v1 supports Turkish jurisdiction only. */
  jurisdiction: "TR";
  /** v1 supports public-authority data only (no client uploads). */
  dataClass: "L0";
  /** ISO date (YYYY-MM-DD); temporal anchor for amendment resolution. */
  asOf?: string;
  /** Optional restriction of the capabilities the plan may use. */
  sourceScope?: readonly CapabilityName[];
}

export type IntakeValidationResult =
  | { ok: true; intake: ResearchIntake }
  | { ok: false; errors: string[] };

export class IntakeValidationError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`invalid research intake: ${errors.join("; ")}`);
    this.name = "IntakeValidationError";
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map((p) => Number.parseInt(p, 10)) as [
    number,
    number,
    number,
  ];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through UTC to reject impossible dates such as 2026-02-31.
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

const CAPABILITY_NAME_SET: ReadonlySet<string> = new Set(CAPABILITY_NAMES);

/**
 * Validate an untrusted intake value. Unknown fields are stripped (they never
 * reach the planner); on success the returned intake is frozen.
 */
export function validateResearchIntake(value: unknown): IntakeValidationResult {
  const errors: string[] = [];
  if (value === null || typeof value !== "object") {
    return { ok: false, errors: ["intake must be an object"] };
  }
  const rec = value as Record<string, unknown>;

  const question = rec["question"];
  if (typeof question !== "string" || question.trim().length < 3) {
    errors.push("question must be a string of at least 3 characters");
  }
  if (rec["jurisdiction"] !== "TR") {
    errors.push('jurisdiction must be "TR"');
  }
  if (rec["dataClass"] !== "L0") {
    errors.push('dataClass must be "L0"');
  }
  const asOf = rec["asOf"];
  if (asOf !== undefined && (typeof asOf !== "string" || !isValidIsoDate(asOf))) {
    errors.push("asOf must be an ISO date (YYYY-MM-DD)");
  }
  const sourceScope = rec["sourceScope"];
  if (sourceScope !== undefined) {
    if (!Array.isArray(sourceScope) || sourceScope.length === 0) {
      errors.push("sourceScope must be a non-empty array of capability names");
    } else {
      for (const entry of sourceScope) {
        if (typeof entry !== "string" || !CAPABILITY_NAME_SET.has(entry)) {
          errors.push(`sourceScope contains an unknown capability: ${String(entry)}`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const intake: ResearchIntake = Object.freeze({
    question: (question as string).trim(),
    jurisdiction: "TR",
    dataClass: "L0",
    ...(asOf !== undefined ? { asOf: asOf as string } : {}),
    ...(sourceScope !== undefined
      ? { sourceScope: Object.freeze([...(sourceScope as CapabilityName[])]) }
      : {}),
  });
  return { ok: true, intake };
}

// ---------------------------------------------------------------------------
// Turkish legal concept expansion table (authored, additive-only)
// ---------------------------------------------------------------------------

/**
 * BU TABLO BİR HUKUK SÖZLÜĞÜ DEĞİLDİR, ARAMA GENİŞLETMESİDİR; BİR TERİMİN
 * BURADA OLMASI HUKUKİ BİR EŞİTLİK İDDİASI DEĞİLDİR.
 *
 * (In English, for the next reader: this is a *retrieval* table. Two terms
 * sitting in the same row are terms that tend to appear in the same body of
 * decisions — nothing more. It never asserts that two words mean the same
 * thing in law, that an expansion term is a synonym, or that a statutory
 * anchor decides the case. The only claim this table makes is: "if the lawyer
 * typed the key, these words are worth putting in front of a keyword engine
 * as well.")
 *
 * Keys are already in normalized (tr-TR lowercase) form; a concept fires when
 * the normalized question contains the key as a SUBSTRING. Two consequences
 * constrain what may be added here:
 *
 *  1. a key must be long/distinctive enough that it cannot fire INSIDE an
 *     unrelated word. "çek" would fire inside "gerçek" and "çekişmeli", so the
 *     key is "karşılıksız çek"; "bono" would fire inside "abonelik", so the
 *     key is "kambiyo senedi"; "yağma" would fire inside "yağmur", so the key
 *     is "yağma suçu";
 *  2. a generic key may be contained in a more specific one ("kira" ⊂ "kira
 *     bedelinin tespiti", "tazminat" ⊂ "manevi tazminat", "ihale" ⊂ "ihaleye
 *     fesat karıştırma", "nafaka" ⊂ "iştirak nafakası"). Both fire; the
 *     ORDERING rule at `compareConceptSpecificity` decides which one leads.
 *
 * CONTRACT of `terms` (relied on by templates.ts):
 *  - index 0 is the key itself: the canonical term a Turkish lawyer would
 *    actually type into Bedesten/UYAP first — it becomes the ROUND-1 query on
 *    its own, because a keyword engine ANDs the words it is given and a
 *    four-term query returns almost nothing;
 *  - the remaining entries are the statutory elements / near-synonyms of the
 *    same institution and are folded into the ROUND-2 gap query.
 *
 * Terminology is deliberately statutory rather than colloquial: TCK 157 speaks
 * of "hileli davranışlarla", not of "hile" (which in TBK 36 means a defect of
 * consent), and an "işe iade" claim is decided over "feshin geçersizliği" /
 * "geçerli neden", not over "kıdem" (a separate severance claim).
 *
 * CONTRACT of `anchors` (optional): the statutory hooks a practitioner would
 * open next, in citation form ("4857 s.K. m.18", "TBK m.350", "İİK m.67").
 * They are a QUERY AID for the legislation lane, not a legal conclusion, and
 * an article number is NEVER guessed: where the number was not certain, the
 * field is simply absent. An absent `anchors` means "not written down here",
 * never "this concept has no statutory basis".
 */
export interface ConceptEntry {
  /** Search expansion; index 0 is the key itself (round-1 query). */
  readonly terms: readonly string[];
  /** Optional statutory hooks in citation form; never guessed. */
  readonly anchors?: readonly string[];
}

/** Row constructor: freezes both arrays so the table cannot be mutated. */
function concept(
  terms: readonly string[],
  anchors?: readonly string[],
): ConceptEntry {
  return Object.freeze(
    anchors === undefined
      ? { terms: Object.freeze([...terms]) }
      : { terms: Object.freeze([...terms]), anchors: Object.freeze([...anchors]) },
  );
}

/**
 * The authored table, grouped by the area of practice a solo Turkish lawyer
 * actually meets. The grouping is a comment, not a field — nothing in the code
 * branches on it.
 */
export const CONCEPT_TABLE: Readonly<Record<string, ConceptEntry>> = Object.freeze({
  // --- İş hukuku ve sosyal güvenlik ------------------------------------------
  "işe iade": concept(
    ["işe iade", "feshin geçersizliği", "geçerli neden", "işe başlatmama tazminatı"],
    ["4857 s.K. m.18", "4857 s.K. m.20", "4857 s.K. m.21"],
  ),
  "işçilik alacakları": concept(
    ["işçilik alacakları", "fazla mesai ücreti", "yıllık izin ücreti", "ibraname"],
    ["4857 s.K. m.32", "TBK m.420"],
  ),
  "kıdem tazminatı": concept(
    ["kıdem tazminatı", "giydirilmiş ücret", "kıdem tazminatı tavanı", "hizmet süresi"],
    ["1475 s.K. m.14"],
  ),
  "ihbar tazminatı": concept(
    ["ihbar tazminatı", "bildirim süresi", "ihbar öneli", "usulsüz fesih"],
    ["4857 s.K. m.17"],
  ),
  "fazla mesai": concept(
    [
      "fazla mesai",
      "fazla çalışma ücreti",
      "haftalık kırk beş saat",
      "imzalı ücret bordrosu",
    ],
    ["4857 s.K. m.41", "4857 s.K. m.63"],
  ),
  "yıllık izin": concept(
    ["yıllık izin", "yıllık ücretli izin", "izin ücreti", "kullandırılmayan izin"],
    ["4857 s.K. m.53", "4857 s.K. m.59"],
  ),
  "haklı nedenle fesih": concept(
    [
      "haklı nedenle fesih",
      "derhal fesih hakkı",
      "altı iş günlük süre",
      "ahlak ve iyi niyet kurallarına aykırılık",
    ],
    ["4857 s.K. m.24", "4857 s.K. m.25", "4857 s.K. m.26"],
  ),
  "ücret alacağı": concept(
    ["ücret alacağı", "ödenmeyen ücret", "ücret bordrosu", "banka kanalıyla ödeme"],
    ["4857 s.K. m.32", "4857 s.K. m.34"],
  ),
  "işyeri devri": concept(
    [
      "işyeri devri",
      "devralan işveren",
      "müteselsil sorumluluk",
      "hizmet sürelerinin birleştirilmesi",
    ],
    ["4857 s.K. m.6"],
  ),
  "iş kazası": concept(
    ["iş kazası", "işverenin sorumluluğu", "destekten yoksun kalma", "kusur oranı"],
    ["5510 s.K. m.13", "6331 s.K. m.4", "TBK m.417"],
  ),
  "meslek hastalığı": concept(
    [
      "meslek hastalığı",
      "sürekli iş göremezlik",
      "maluliyet oranı",
      "kurumun rücu alacağı",
    ],
    ["5510 s.K. m.14"],
  ),
  "hizmet tespiti": concept(
    [
      "hizmet tespiti",
      "sigortalılığın tespiti",
      "kuruma bildirilmeyen çalışma",
      "hizmet süresinin tespiti",
    ],
    ["5510 s.K. m.86"],
  ),
  "sendikal tazminat": concept(
    [
      "sendikal tazminat",
      "sendika özgürlüğünün güvencesi",
      "sendikal nedenle fesih",
      "işyeri sendika temsilcisi",
    ],
    ["6356 s.K. m.25"],
  ),
  "rekabet yasağı": concept(
    [
      "rekabet yasağı",
      "rekabet yasağı sözleşmesi",
      "işverenin haklı menfaati",
      "cezai şart",
    ],
    ["TBK m.444", "TBK m.445"],
  ),
  "mobbing": concept([
    "mobbing",
    "psikolojik taciz",
    "kişilik haklarının ihlali",
    "yıldırma",
  ]),
  "arabuluculuk": concept(
    ["arabuluculuk", "dava şartı arabuluculuk", "son tutanak", "anlaşma belgesi"],
    ["7036 s.K. m.3", "TTK m.5/A"],
  ),

  // --- Kira ve tahliye --------------------------------------------------------
  "kira": concept(
    ["kira", "tahliye", "kira bedelinin tespiti", "uyarlama davası"],
    ["TBK m.299", "TBK m.315", "TBK m.344"],
  ),
  "kira bedelinin tespiti": concept(
    [
      "kira bedelinin tespiti",
      "kira tespit davası",
      "tüketici fiyat endeksi",
      "beş yıllık kira dönemi",
      "hakkaniyet indirimi",
    ],
    ["TBK m.344", "TBK m.345"],
  ),
  "tahliye taahhüdü": concept(
    ["tahliye taahhüdü", "yazılı tahliye taahhüdü", "taahhüt tarihi", "icra yoluyla tahliye"],
    ["TBK m.352"],
  ),
  "ihtiyaç nedeniyle tahliye": concept(
    [
      "ihtiyaç nedeniyle tahliye",
      "konut ihtiyacı",
      "samimi ve zorunlu ihtiyaç",
      "yeniden kiralama yasağı",
    ],
    ["TBK m.350", "TBK m.355"],
  ),
  "temerrüt nedeniyle tahliye": concept(
    ["temerrüt nedeniyle tahliye", "otuz günlük süre", "iki haklı ihtar", "kira alacağı"],
    ["TBK m.315", "İİK m.269"],
  ),
  "uyarlama davası": concept(
    [
      "uyarlama davası",
      "aşırı ifa güçlüğü",
      "öngörülemeyen durum",
      "işlem temelinin çökmesi",
    ],
    ["TBK m.138"],
  ),
  "depozito": concept(
    ["depozito", "güvence bedeli", "üç aylık kira bedeli", "güvencenin iadesi"],
    ["TBK m.342"],
  ),

  // --- Tapu, mülkiyet, eşya hukuku -------------------------------------------
  "tapu iptali ve tescil": concept(
    ["tapu iptali ve tescil", "yolsuz tescil", "iyiniyetli üçüncü kişi", "mülkiyet hakkı"],
    ["TMK m.705", "TMK m.1024", "TMK m.1025"],
  ),
  "muris muvazaası": concept(
    [
      "muris muvazaası",
      "mirastan mal kaçırma",
      "danışıklı işlem",
      "bedeller arasındaki fark",
    ],
    ["TBK m.19"],
  ),
  "önalım hakkı": concept(
    ["önalım hakkı", "şufa", "paylı mülkiyet", "önalım bedeli"],
    ["TMK m.732", "TMK m.733", "TMK m.734"],
  ),
  "ecrimisil": concept(
    ["ecrimisil", "haksız işgal tazminatı", "kötüniyetli zilyet", "intifadan men koşulu"],
    ["TMK m.995"],
  ),
  "ortaklığın giderilmesi": concept(
    ["ortaklığın giderilmesi", "izale-i şüyu", "aynen taksim", "satış suretiyle paylaştırma"],
    ["TMK m.698", "TMK m.699"],
  ),
  "kadastro tespitine itiraz": concept(
    [
      "kadastro tespitine itiraz",
      "zilyetlikle iktisap",
      "kazandırıcı zamanaşımı",
      "tespit tutanağı",
    ],
    ["3402 s.K. m.14", "TMK m.713"],
  ),
  "kat mülkiyeti": concept(
    ["kat mülkiyeti", "ortak yer", "yönetim planı", "ortak gider alacağı"],
    ["634 s.K. m.18", "634 s.K. m.20"],
  ),
  "geçit hakkı": concept(
    ["geçit hakkı", "zorunlu geçit", "taşınmazın genel yola bağlanması", "uygun bedel"],
    ["TMK m.747"],
  ),
  "el atmanın önlenmesi": concept(
    ["el atmanın önlenmesi", "müdahalenin meni", "haksız işgal", "taşınmaza el atma"],
    ["TMK m.683"],
  ),
  "komşuluk hukuku": concept(
    ["komşuluk hukuku", "taşkın kullanım", "katlanma yükümlülüğü", "zararın giderilmesi"],
    ["TMK m.737"],
  ),
  "ipoteğin paraya çevrilmesi": concept(
    ["ipoteğin paraya çevrilmesi", "ipotek akit tablosu", "taşınmaz rehni", "takip talebi"],
    ["İİK m.148", "İİK m.149"],
  ),

  // --- Miras ------------------------------------------------------------------
  "mirasçılık belgesi": concept(
    ["mirasçılık belgesi", "veraset ilamı", "yasal mirasçı", "mirasçılık sıfatı"],
    ["TMK m.598"],
  ),
  "tenkis davası": concept(
    ["tenkis davası", "saklı pay", "tasarruf edilebilir kısım", "denkleştirme"],
    ["TMK m.560", "TMK m.565"],
  ),
  "saklı pay": concept(
    ["saklı pay", "saklı paylı mirasçı", "tasarruf oranı", "mahfuz hisse"],
    ["TMK m.505", "TMK m.506"],
  ),
  "mirasın reddi": concept(
    [
      "mirasın reddi",
      "üç aylık ret süresi",
      "mirasın hükmen reddi",
      "terekenin borca batık olması",
    ],
    ["TMK m.605", "TMK m.606", "TMK m.610"],
  ),
  "vasiyetnamenin iptali": concept(
    [
      "vasiyetnamenin iptali",
      "şekle aykırılık",
      "ehliyetsizlik",
      "iradeyi sakatlayan sebep",
    ],
    ["TMK m.557", "TMK m.559"],
  ),
  "mirastan çıkarma": concept(
    ["mirastan çıkarma", "ıskat", "çıkarma sebebi", "çıkarmanın iptali"],
    ["TMK m.510", "TMK m.512"],
  ),

  // --- Aile -------------------------------------------------------------------
  "boşanma": concept(
    ["boşanma", "evlilik birliğinin temelinden sarsılması", "kusur", "anlaşmalı boşanma"],
    ["TMK m.161", "TMK m.164", "TMK m.166"],
  ),
  "velayet": concept(
    [
      "velayet",
      "çocuğun üstün yararı",
      "kişisel ilişki kurulması",
      "velayetin değiştirilmesi",
    ],
    ["TMK m.183", "TMK m.335", "TMK m.336"],
  ),
  "nafaka": concept(
    ["nafaka", "yoksulluk nafakası", "iştirak nafakası", "tedbir nafakası"],
    ["TMK m.169", "TMK m.175", "TMK m.182"],
  ),
  "yoksulluk nafakası": concept(
    ["yoksulluk nafakası", "süresiz nafaka", "yoksulluğa düşme", "kusur karşılaştırması"],
    ["TMK m.175", "TMK m.176"],
  ),
  "iştirak nafakası": concept(
    ["iştirak nafakası", "çocuğun bakım gideri", "nafakanın artırılması", "ekonomik güç"],
    ["TMK m.182", "TMK m.328", "TMK m.331"],
  ),
  "kişisel ilişki kurulması": concept(
    [
      "kişisel ilişki kurulması",
      "çocukla kişisel ilişki",
      "kişisel ilişkinin düzenlenmesi",
      "çocuğun üstün yararı",
    ],
    ["TMK m.323", "TMK m.324"],
  ),
  "mal rejiminin tasfiyesi": concept(
    [
      "mal rejiminin tasfiyesi",
      "edinilmiş mallara katılma",
      "katılma alacağı",
      "değer artış payı",
    ],
    ["TMK m.202", "TMK m.219", "TMK m.227", "TMK m.231"],
  ),
  "aile konutu": concept(
    [
      "aile konutu",
      "aile konutu şerhi",
      "diğer eşin rızası",
      "tasarruf yetkisinin sınırlanması",
    ],
    ["TMK m.194"],
  ),
  "babalık davası": concept(
    ["babalık davası", "soybağının kurulması", "dna incelemesi", "hak düşürücü süre"],
    ["TMK m.301", "TMK m.303"],
  ),
  "soybağının reddi": concept(
    ["soybağının reddi", "babalık karinesi", "bir yıllık süre", "hak düşürücü süre"],
    ["TMK m.286", "TMK m.289"],
  ),
  "evlat edinme": concept(
    [
      "evlat edinme",
      "küçüğün evlat edinilmesi",
      "bir yıllık bakım süresi",
      "evlat edinmenin iptali",
    ],
    ["TMK m.305", "TMK m.309"],
  ),
  "nişanın bozulması": concept(
    ["nişanın bozulması", "hediyelerin geri verilmesi", "maddi tazminat", "manevi tazminat"],
    ["TMK m.120", "TMK m.121", "TMK m.122"],
  ),
  "koruma kararı": concept(
    [
      "koruma kararı",
      "önleyici tedbir kararı",
      "uzaklaştırma kararı",
      "tedbir kararına aykırılık",
    ],
    ["6284 s.K. m.5", "6284 s.K. m.13"],
  ),
  "vesayet": concept(
    ["vesayet", "kısıtlama", "vasi atanması", "vesayet altına alınma"],
    ["TMK m.404", "TMK m.405", "TMK m.413"],
  ),

  // --- İcra ve iflas ----------------------------------------------------------
  "itirazın iptali": concept(
    ["itirazın iptali", "icra inkar tazminatı", "likit alacak", "takibe itiraz"],
    ["İİK m.67"],
  ),
  "itirazın kaldırılması": concept(
    [
      "itirazın kaldırılması",
      "borç ikrarını içeren belge",
      "itirazın kesin kaldırılması",
      "imzası ikrar edilmiş senet",
    ],
    ["İİK m.68", "İİK m.68/a"],
  ),
  "menfi tespit": concept(
    ["menfi tespit", "borçlu olmadığının tespiti", "istirdat davası", "takibin durdurulması"],
    ["İİK m.72"],
  ),
  "ihalenin feshi": concept(
    ["ihalenin feshi", "kıymet takdirine itiraz", "artırma hazırlığı", "ihale bedeli"],
    ["İİK m.134"],
  ),
  "haczedilemezlik": concept(
    ["haczedilemezlik", "meskeniyet iddiası", "haczi caiz olmayan mal", "şikayet süresi"],
    ["İİK m.16", "İİK m.82", "İİK m.83"],
  ),
  "istihkak davası": concept(
    [
      "istihkak davası",
      "üçüncü kişinin mülkiyet iddiası",
      "mülkiyet karinesi",
      "haczedilen mal",
    ],
    ["İİK m.96", "İİK m.97"],
  ),
  "kambiyo senetlerine mahsus takip": concept(
    ["kambiyo senetlerine mahsus takip", "imzaya itiraz", "borca itiraz", "takibin iptali"],
    ["İİK m.167", "İİK m.168", "İİK m.169/a", "İİK m.170"],
  ),
  "ihtiyati haciz": concept(
    ["ihtiyati haciz", "muaccel alacak", "ihtiyati haciz kararına itiraz", "teminat"],
    ["İİK m.257", "İİK m.265"],
  ),
  "tasarrufun iptali": concept(
    ["tasarrufun iptali", "aciz vesikası", "ivazsız tasarruf", "borçlunun mal kaçırması"],
    ["İİK m.277", "İİK m.278", "İİK m.280"],
  ),
  "konkordato": concept(
    ["konkordato", "geçici mühlet", "kesin mühlet", "konkordato komiseri"],
    ["İİK m.285", "İİK m.287", "İİK m.289"],
  ),
  "iflas": concept(["iflas", "iflas yoluyla takip", "depo kararı", "masaya kayıt"]),

  // --- Tüketici ---------------------------------------------------------------
  "ayıplı mal": concept(
    ["ayıplı mal", "seçimlik hak", "bedel iadesi", "ücretsiz onarım"],
    ["6502 s.K. m.8", "6502 s.K. m.11"],
  ),
  "ayıplı hizmet": concept(
    ["ayıplı hizmet", "hizmetin yeniden görülmesi", "bedelden indirim", "sözleşmeden dönme"],
    ["6502 s.K. m.13", "6502 s.K. m.15"],
  ),
  "tüketici hakem heyeti": concept(
    [
      "tüketici hakem heyeti",
      "parasal sınır",
      "hakem heyeti kararına itiraz",
      "tüketici mahkemesi",
    ],
    ["6502 s.K. m.66", "6502 s.K. m.68", "6502 s.K. m.70"],
  ),
  "mesafeli satış": concept(
    ["mesafeli satış", "cayma hakkı", "on dört günlük süre", "ön bilgilendirme"],
    ["6502 s.K. m.48"],
  ),
  "abonelik sözleşmesi": concept(
    ["abonelik sözleşmesi", "fesih bildirimi", "abonelik bedeli", "haksız şart"],
    ["6502 s.K. m.52"],
  ),
  "haksız şart": concept(
    [
      "haksız şart",
      "dürüstlük kuralına aykırılık",
      "tüketici aleyhine dengesizlik",
      "kesin hükümsüzlük",
    ],
    ["6502 s.K. m.5"],
  ),

  // --- Ticaret ve şirketler ---------------------------------------------------
  "haksız rekabet": concept(
    [
      "haksız rekabet",
      "dürüstlük kuralına aykırı davranış",
      "iltibas",
      "tespit ve men davası",
    ],
    ["TTK m.54", "TTK m.55", "TTK m.56"],
  ),
  "genel kurul kararının iptali": concept(
    [
      "genel kurul kararının iptali",
      "toplantı ve karar yeter sayısı",
      "muhalefet şerhi",
      "üç aylık hak düşürücü süre",
    ],
    ["TTK m.445", "TTK m.446"],
  ),
  "şirketin haklı sebeple feshi": concept(
    [
      "şirketin haklı sebeple feshi",
      "azınlık pay sahibi",
      "alternatif çözüm",
      "payların gerçek değeri",
    ],
    ["TTK m.531", "TTK m.636"],
  ),
  "yönetim kurulu sorumluluğu": concept(
    [
      "yönetim kurulu sorumluluğu",
      "özen ve bağlılık yükümlülüğü",
      "ibra",
      "farklılaştırılmış teselsül",
    ],
    ["TTK m.369", "TTK m.553", "TTK m.557"],
  ),
  "ticari defterler": concept(
    ["ticari defterler", "delil niteliği", "açılış ve kapanış tasdiki", "usulüne uygun tutulma"],
    ["TTK m.64", "HMK m.222"],
  ),
  "karşılıksız çek": concept(
    [
      "karşılıksız çek",
      "ibraz süresi",
      "çek düzenleme ve çek hesabı açma yasağı",
      "karşılıksızdır işlemi",
    ],
    ["TTK m.780", "5941 s.K. m.5"],
  ),
  "kambiyo senedi": concept(
    ["kambiyo senedi", "bono", "poliçe", "senet unsurları", "kambiyo vasfı"],
    ["TTK m.776", "TTK m.777", "TTK m.780"],
  ),
  "acentelik": concept(
    ["acentelik", "denkleştirme talebi", "portföy tazminatı", "sözleşmenin sona ermesi"],
    ["TTK m.102", "TTK m.122"],
  ),
  "marka hakkına tecavüz": concept(
    ["marka hakkına tecavüz", "iltibas tehlikesi", "tecavüzün önlenmesi", "markanın hükümsüzlüğü"],
    ["6769 s.K. m.7", "6769 s.K. m.29"],
  ),

  // --- Sigorta, trafik, tazminat ----------------------------------------------
  "trafik kazası": concept(
    [
      "trafik kazası",
      "işletenin sorumluluğu",
      "zorunlu mali sorumluluk sigortası",
      "kusur oranı",
    ],
    ["2918 s.K. m.85", "2918 s.K. m.91"],
  ),
  "değer kaybı": concept(
    [
      "değer kaybı",
      "onarım sonrası değer azalması",
      "ikinci el piyasa değeri",
      "sigortacıya başvuru",
    ],
    ["2918 s.K. m.97"],
  ),
  "destekten yoksun kalma tazminatı": concept(
    ["destekten yoksun kalma tazminatı", "bakiye ömür", "destek payı", "hakkaniyet indirimi"],
    ["TBK m.53"],
  ),
  "sigorta tahkim": concept(
    ["sigorta tahkim", "uyuşmazlık hakem heyeti", "sigortacıya başvuru", "itiraz hakem heyeti"],
    ["5684 s.K. m.30"],
  ),
  "rücu davası": concept(
    ["rücu davası", "halefiyet", "sigortacının rücu hakkı", "zarar görenin hakları"],
    ["TTK m.1472"],
  ),
  "tazminat": concept(["tazminat", "maddi tazminat", "manevi tazminat", "kusur oranı"]),
  "manevi tazminat": concept(
    [
      "manevi tazminat",
      "kişilik hakkının ihlali",
      "hakkaniyet",
      "zenginleşme aracı olmaması",
    ],
    ["TBK m.56", "TBK m.58", "TMK m.24", "TMK m.25"],
  ),
  "haksız fiil": concept(
    ["haksız fiil", "kusur", "illiyet bağı", "hukuka aykırılık"],
    ["TBK m.49", "TBK m.66", "TBK m.71"],
  ),
  "sebepsiz zenginleşme": concept(
    ["sebepsiz zenginleşme", "iade borcu", "haklı sebebin bulunmaması", "iki yıllık zamanaşımı"],
    ["TBK m.77", "TBK m.82"],
  ),
  "cezai şart": concept(
    ["cezai şart", "ifaya ekli ceza", "aşırı ceza koşulu", "indirim"],
    ["TBK m.179", "TBK m.182"],
  ),
  "temerrüt faizi": concept(
    ["temerrüt faizi", "yasal faiz", "avans faiz oranı", "ihtar"],
    ["TBK m.117", "TBK m.120", "3095 s.K. m.1"],
  ),
  "ayıba karşı tekeffül": concept(
    [
      "ayıba karşı tekeffül",
      "satıcının sorumluluğu",
      "gözden geçirme ve bildirim",
      "iki yıllık zamanaşımı",
    ],
    ["TBK m.219", "TBK m.223", "TBK m.231"],
  ),
  "eser sözleşmesi": concept(
    ["eser sözleşmesi", "ayıplı eser", "yüklenicinin sorumluluğu", "iş bedeli"],
    ["TBK m.470", "TBK m.474", "TBK m.475"],
  ),
  "vekalet sözleşmesi": concept(
    ["vekalet sözleşmesi", "özen borcu", "azil", "vekaletin sona ermesi"],
    ["TBK m.502", "TBK m.506", "TBK m.512"],
  ),
  "kefalet": concept(
    ["kefalet", "kefilin sorumluluğu", "eşin rızası", "müteselsil kefil"],
    ["TBK m.581", "TBK m.584", "TBK m.603"],
  ),
  "alacağın temliki": concept(
    ["alacağın temliki", "yazılı şekil şartı", "borçluya bildirim", "devralanın hakları"],
    ["TBK m.183", "TBK m.184"],
  ),
  "irade fesadı": concept(
    ["irade fesadı", "yanılma", "aldatma", "korkutma"],
    ["TBK m.30", "TBK m.36", "TBK m.37", "TBK m.39"],
  ),
  "zamanaşımı": concept(
    ["zamanaşımı", "hak düşürücü süre", "zamanaşımı defi", "zamanaşımının kesilmesi"],
    ["TBK m.72", "TBK m.146", "TBK m.147"],
  ),

  // --- Ceza -------------------------------------------------------------------
  "dolandırıcılık": concept(
    ["dolandırıcılık", "hileli davranış", "menfaat temini", "nitelikli dolandırıcılık"],
    ["TCK m.157", "TCK m.158"],
  ),
  "hakaret": concept(
    ["hakaret", "şerefe karşı suçlar", "sövme", "eleştiri sınırı"],
    ["TCK m.125", "TCK m.128", "TCK m.129"],
  ),
  "hırsızlık": concept(
    ["hırsızlık", "nitelikli hırsızlık", "zilyetliğin ihlali", "etkin pişmanlık"],
    ["TCK m.141", "TCK m.142", "TCK m.168"],
  ),
  "yağma suçu": concept(
    ["yağma suçu", "nitelikli yağma", "cebir veya tehdit", "daha az cezayı gerektiren hal"],
    ["TCK m.148", "TCK m.149", "TCK m.150"],
  ),
  "güveni kötüye kullanma": concept(
    ["güveni kötüye kullanma", "zilyetliğin devri", "nitelikli hal", "etkin pişmanlık"],
    ["TCK m.155", "TCK m.168"],
  ),
  "mala zarar verme": concept(
    ["mala zarar verme", "nitelikli hal", "şikayet", "uzlaştırma"],
    ["TCK m.151", "TCK m.152"],
  ),
  "kasten yaralama": concept(
    [
      "kasten yaralama",
      "basit tıbbi müdahale ile giderilebilecek nitelikte",
      "neticesi sebebiyle ağırlaşmış yaralama",
      "canavarca his sevkiyle",
    ],
    ["TCK m.86", "TCK m.87", "TCK m.88"],
  ),
  "kasten öldürme": concept(
    ["kasten öldürme", "nitelikli haller", "tasarlama", "olası kast"],
    ["TCK m.21", "TCK m.81", "TCK m.82"],
  ),
  "taksirle öldürme": concept(
    ["taksirle öldürme", "bilinçli taksir", "kusurun belirlenmesi", "öngörülebilirlik"],
    ["TCK m.22", "TCK m.85"],
  ),
  "tehdit": concept(
    ["tehdit", "silahla tehdit", "kişinin hürriyetine yönelik saldırı", "şikayete bağlı suç"],
    ["TCK m.106"],
  ),
  "cinsel saldırı": concept(
    ["cinsel saldırı", "vücut dokunulmazlığının ihlali", "sarkıntılık", "nitelikli hal"],
    ["TCK m.102"],
  ),
  "çocuğun cinsel istismarı": concept(
    ["çocuğun cinsel istismarı", "basit cinsel istismar", "nitelikli istismar", "yaş küçüklüğü"],
    ["TCK m.103"],
  ),
  "uyuşturucu ticareti": concept(
    [
      "uyuşturucu ticareti",
      "uyuşturucu madde ticareti yapma",
      "satmak amacıyla bulundurma",
      "etkin pişmanlık",
    ],
    ["TCK m.188", "TCK m.192"],
  ),
  "kullanmak için uyuşturucu bulundurma": concept(
    [
      "kullanmak için uyuşturucu bulundurma",
      "kişisel kullanım sınırı",
      "denetimli serbestlik tedbiri",
      "kamu davasının açılmasının ertelenmesi",
    ],
    ["TCK m.191"],
  ),
  "resmi belgede sahtecilik": concept(
    [
      "resmi belgede sahtecilik",
      "sahte belge düzenleme",
      "aldatma yeteneği",
      "bilirkişi incelemesi",
    ],
    ["TCK m.204"],
  ),
  "özel belgede sahtecilik": concept(
    ["özel belgede sahtecilik", "sahte özel belge", "kullanma", "belgenin aldatıcılığı"],
    ["TCK m.207"],
  ),
  "zimmet": concept(
    ["zimmet", "kamu görevlisi", "nitelikli zimmet", "etkin pişmanlık"],
    ["TCK m.247", "TCK m.248"],
  ),
  "rüşvet": concept(
    ["rüşvet", "kamu görevlisine menfaat sağlama", "anlaşma", "etkin pişmanlık"],
    ["TCK m.252", "TCK m.254"],
  ),
  "görevi kötüye kullanma": concept(
    ["görevi kötüye kullanma", "kamu görevlisi", "mağduriyet veya kamu zararı", "haksız kazanç"],
    ["TCK m.257"],
  ),
  "ihaleye fesat karıştırma": concept(
    [
      "ihaleye fesat karıştırma",
      "kamu ihalesi",
      "edimin ifasına fesat karıştırma",
      "zarar unsuru",
    ],
    ["TCK m.235", "TCK m.236"],
  ),
  "verilerin hukuka aykırı olarak ele geçirilmesi": concept(
    [
      "verilerin hukuka aykırı olarak ele geçirilmesi",
      "kişisel verilerin kaydedilmesi",
      "verileri yok etmeme",
      "hukuka aykırı olarak yayma",
    ],
    ["TCK m.135", "TCK m.136", "TCK m.138"],
  ),
  "haksız tahrik": concept(
    [
      "haksız tahrik",
      "tahrikin derecesi",
      "haksız fiilin meydana getirdiği öfke",
      "indirim oranı",
    ],
    ["TCK m.29"],
  ),
  "meşru savunma": concept(
    ["meşru savunma", "saldırının haksızlığı", "orantılılık", "sınırın aşılması"],
    ["TCK m.25", "TCK m.27"],
  ),
  "ceza zamanaşımı": concept(
    ["ceza zamanaşımı", "dava zamanaşımı", "zamanaşımının kesilmesi", "olağanüstü zamanaşımı"],
    ["TCK m.66", "TCK m.67", "TCK m.68"],
  ),
  "hükmün açıklanmasının geri bırakılması": concept(
    [
      "hükmün açıklanmasının geri bırakılması",
      "denetim süresi",
      "zararın giderilmesi",
      "sanığın kabulü",
    ],
    ["CMK m.231"],
  ),
  "uzlaştırma": concept(
    ["uzlaştırma", "uzlaştırmacı", "uzlaşma teklifi", "kovuşturmaya yer olmadığına dair karar"],
    ["CMK m.253", "CMK m.254"],
  ),
  "tutuklama": concept(
    ["tutuklama", "kuvvetli suç şüphesi", "kaçma şüphesi", "adli kontrol"],
    ["CMK m.100", "CMK m.101", "CMK m.109"],
  ),
  "arama ve el koyma": concept(
    [
      "arama ve el koyma",
      "hakim kararı",
      "gecikmesinde sakınca bulunan hal",
      "hukuka aykırı delil",
    ],
    ["CMK m.116", "CMK m.119", "CMK m.127"],
  ),
  "koşullu salıverilme": concept(
    ["koşullu salıverilme", "denetimli serbestlik", "iyi hal", "infaz oranı"],
    ["5275 s.K. m.105/A", "5275 s.K. m.107"],
  ),

  // --- İdare ve vergi ---------------------------------------------------------
  "iptal davası": concept(
    ["iptal davası", "kesin ve yürütülebilir işlem", "yetki unsuru", "sebep unsuru"],
    ["2577 s.K. m.2", "2577 s.K. m.7"],
  ),
  "tam yargı davası": concept(
    ["tam yargı davası", "idarenin sorumluluğu", "hizmet kusuru", "kusursuz sorumluluk"],
    ["2577 s.K. m.12", "2577 s.K. m.13"],
  ),
  "yürütmenin durdurulması": concept(
    ["yürütmenin durdurulması", "açıkça hukuka aykırılık", "telafisi güç zarar", "teminat"],
    ["2577 s.K. m.27"],
  ),
  "idari para cezası": concept(
    ["idari para cezası", "kabahat", "sulh ceza hakimliğine başvuru", "tutanak"],
    ["5326 s.K. m.27", "5326 s.K. m.28"],
  ),
  "disiplin cezası": concept(
    ["disiplin cezası", "savunma hakkı", "disiplin soruşturması", "uyarma ve kınama"],
    ["657 s.K. m.125", "657 s.K. m.130"],
  ),
  "kamulaştırma": concept(
    ["kamulaştırma", "kamulaştırmasız el atma", "bedel tespiti", "acele kamulaştırma"],
    ["2942 s.K. m.8", "2942 s.K. m.10", "2942 s.K. m.27"],
  ),
  "kamulaştırmasız el atma": concept(
    ["kamulaştırmasız el atma", "fiili el atma", "hukuki el atma", "bedel davası"],
    ["2942 s.K. Geçici m.6"],
  ),
  "imar planı": concept(
    ["imar planı", "plan değişikliği", "askı süresi", "şehircilik ilkeleri"],
    ["3194 s.K. m.8"],
  ),
  "ruhsatsız yapı": concept(
    ["ruhsatsız yapı", "yapı tatil tutanağı", "yıkım kararı", "imar para cezası"],
    ["3194 s.K. m.32", "3194 s.K. m.42"],
  ),
  "vergi ziyaı cezası": concept(
    ["vergi ziyaı cezası", "vergi aslı", "bir kat ceza", "uzlaşma"],
    ["VUK m.341", "VUK m.344"],
  ),
  "vergi kaçakçılığı": concept(
    [
      "vergi kaçakçılığı",
      "sahte belge düzenleme",
      "muhteviyatı itibarıyla yanıltıcı belge",
      "defter ve belgeleri ibraz etmeme",
    ],
    ["VUK m.359"],
  ),
  "ödeme emrine itiraz": concept(
    ["ödeme emrine itiraz", "böyle bir borcu olmadığı", "kısmen itiraz", "yedi günlük süre"],
    ["6183 s.K. m.58"],
  ),
  "özelge": concept(
    ["özelge", "mukteza", "gelir idaresi görüşü", "vergi hatası"],
    ["VUK m.413"],
  ),

  // --- Kişisel veri, rekabet, kamu ihale ---------------------------------------
  "kişisel veri": concept(
    [
      "kişisel veri",
      "açık rıza",
      "veri sorumlusu",
      "aydınlatma yükümlülüğü",
      "hukuka aykırı işleme",
    ],
    ["6698 s.K. m.5", "6698 s.K. m.6", "6698 s.K. m.10"],
  ),
  "açık rıza": concept(
    [
      "açık rıza",
      "özgür iradeyle açıklanan rıza",
      "bilgilendirmeye dayalı rıza",
      "rızanın geri alınması",
    ],
    ["6698 s.K. m.3", "6698 s.K. m.5"],
  ),
  "veri ihlali bildirimi": concept(
    [
      "veri ihlali bildirimi",
      "kurula bildirim",
      "ilgili kişiye bildirim",
      "veri güvenliği yükümlülüğü",
    ],
    ["6698 s.K. m.12"],
  ),
  "unutulma hakkı": concept(
    [
      "unutulma hakkı",
      "arama sonuçlarından çıkarılma",
      "indeksten çıkarılma",
      "ilgili kişi başvurusu",
    ],
    ["6698 s.K. m.11"],
  ),
  "rekabet ihlali": concept(
    ["rekabet ihlali", "hakim durumun kötüye kullanılması", "uyumlu eylem", "kartel"],
    ["4054 s.K. m.4", "4054 s.K. m.6", "4054 s.K. m.16"],
  ),
  "hakim durumun kötüye kullanılması": concept(
    ["hakim durumun kötüye kullanılması", "ilgili pazar", "dışlayıcı davranış", "ayrımcılık"],
    ["4054 s.K. m.6"],
  ),
  "ihale": concept(
    ["ihale", "itirazen şikayet", "yaklaşık maliyet", "aşırı düşük teklif"],
    ["4734 s.K. m.5", "4734 s.K. m.54"],
  ),
  "itirazen şikayet": concept(
    ["itirazen şikayet", "kuruma başvuru", "on günlük süre", "şikayet başvurusu"],
    ["4734 s.K. m.54", "4734 s.K. m.55", "4734 s.K. m.56"],
  ),
  "aşırı düşük teklif": concept(
    ["aşırı düşük teklif", "teklif açıklaması", "sınır değer", "açıklama istenmesi"],
    ["4734 s.K. m.38"],
  ),
  "yasaklama kararı": concept(
    [
      "yasaklama kararı",
      "ihalelere katılmaktan yasaklama",
      "yasak fiil veya davranış",
      "yasaklama süresi",
    ],
    ["4734 s.K. m.17", "4734 s.K. m.58"],
  ),

  // --- Sağlık -----------------------------------------------------------------
  "tıbbi malpraktis": concept(
    ["tıbbi malpraktis", "hekimin özen borcu", "aydınlatılmış onam", "komplikasyon"],
    ["TBK m.49", "TBK m.502"],
  ),
  "aydınlatılmış onam": concept([
    "aydınlatılmış onam",
    "hastanın rızası",
    "bilgilendirme yükümlülüğü",
    "hasta hakları",
  ]),

  // --- Yargılama usulü --------------------------------------------------------
  "ihtiyati tedbir": concept(
    ["ihtiyati tedbir", "yaklaşık ispat", "teminat", "tedbire itiraz"],
    ["HMK m.389", "HMK m.390", "HMK m.391"],
  ),
  "görev uyuşmazlığı": concept(
    ["görev uyuşmazlığı", "yargı yolu", "görevsizlik kararı", "olumsuz görev uyuşmazlığı"],
    ["HMK m.114", "2247 s.K. m.14"],
  ),
  "ıslah": concept(
    [
      "ıslah",
      "iddia ve savunmanın genişletilmesi yasağı",
      "tahkikat aşaması",
      "kısmi ıslah",
    ],
    ["HMK m.176", "HMK m.177"],
  ),
  "delil tespiti": concept(
    ["delil tespiti", "hukuki yarar", "bilirkişi incelemesi", "karşı tarafa tebliğ"],
    ["HMK m.400", "HMK m.402"],
  ),
  "bilirkişi raporuna itiraz": concept(
    ["bilirkişi raporuna itiraz", "ek rapor", "yeni bilirkişi heyeti", "iki haftalık süre"],
    ["HMK m.266", "HMK m.281"],
  ),
  "dava şartı": concept(
    ["dava şartı", "hukuki yarar", "taraf ehliyeti", "davanın usulden reddi"],
    ["HMK m.114", "HMK m.115"],
  ),
  "yetki itirazı": concept(
    ["yetki itirazı", "kesin yetki", "ilk itiraz", "yetkili mahkeme"],
    ["HMK m.19", "HMK m.116"],
  ),
  "istinaf": concept(
    ["istinaf", "iki haftalık istinaf süresi", "gerekçeli karar", "duruşmalı inceleme"],
    ["HMK m.341", "HMK m.345"],
  ),
  "temyiz": concept(
    ["temyiz", "kesinlik sınırı", "bozma", "onama"],
    ["HMK m.361", "HMK m.362"],
  ),
  "yargılamanın yenilenmesi": concept(
    ["yargılamanın yenilenmesi", "sahte belge", "hükmün ortadan kaldırılması", "üç aylık süre"],
    ["HMK m.375", "HMK m.377"],
  ),
  "adli yardım": concept(
    [
      "adli yardım",
      "yargılama giderlerinden geçici muafiyet",
      "yoksulluk",
      "adli yardım talebi",
    ],
    ["HMK m.334", "HMK m.336"],
  ),
  "vekalet ücreti": concept(
    [
      "vekalet ücreti",
      "karşı taraf vekalet ücreti",
      "avukatlık asgari ücret tarifesi",
      "nispi vekalet ücreti",
    ],
    ["1136 s.K. m.164", "HMK m.330"],
  ),
});

/**
 * The search-expansion projection of {@link CONCEPT_TABLE}. Kept as its own
 * `Record<string, readonly string[]>` because that is the shape `templates.ts`
 * and the round-1/round-2 query builders have always consumed.
 */
export const CONCEPT_EXPANSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CONCEPT_TABLE).map(([key, entry]) => [key, entry.terms]),
  ),
);

/**
 * The statutory-anchor projection. Only concepts whose article numbers were
 * known with certainty appear here; a missing key means "not written down",
 * never "no statutory basis". These strings are usable as legislation queries
 * in the live lane; they are never presented as the answer to the question.
 */
export const CONCEPT_ANCHORS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CONCEPT_TABLE)
      .filter(([, entry]) => entry.anchors !== undefined && entry.anchors.length > 0)
      .map(([key, entry]) => [key, entry.anchors as readonly string[]]),
  ),
);

// ---------------------------------------------------------------------------
// Concept matching (W16 follow-up, F1)
// ---------------------------------------------------------------------------

/**
 * HOW A CONCEPT FIRES. Read this before adding a row to the table.
 *
 * Until this change a concept fired only when the normalized question
 * CONTAINED ITS KEY as a raw substring. Measured on a real event paragraph
 * that was, word for word, a `temerrüt nedeniyle tahliye` case, exactly ONE
 * row of a 164-row table fired — the generic `kira` — because the lawyer wrote
 * "temerrüde düşmediğini", "otuz gün", "ihtarname", "tahliye davası" and never
 * the four-word key itself. A table nobody's sentence reaches is worth nothing.
 *
 * The rule now has three parts, and all three are deterministic — the same
 * text always produces the same set, with no scoring and no threshold:
 *
 *  1. WORDS, NOT SUBSTRINGS. Both the text and the table string are cut into
 *     words on every non-letter/non-digit character, and a table word is only
 *     ever compared against a WHOLE word of the text. This is what finally
 *     makes the old decoys structurally impossible rather than merely unlikely:
 *     "çek" cannot fire inside "gerçek", "bono" cannot fire inside "abonelik",
 *     "yağma" cannot fire inside "yağmur", because none of those texts has a
 *     word that BEGINS with the table word.
 *  2. TURKISH SUFFIX TOLERANCE, one rule, no morphology engine. A text word
 *     matches a table word when it starts with it; and a table word of at
 *     least {@link MIN_SUFFIX_TOLERANT_LENGTH} characters is also accepted
 *     with its LAST LETTER DROPPED, which is what carries the consonant
 *     softening Turkish applies before a suffix — "temerrüt" → "temerrü" so
 *     that "temerrüde" matches, "tehdit" → "tehdi" so that "tehdidi" matches.
 *     A table word shorter than {@link MIN_PREFIX_MATCH_LENGTH} must match
 *     EXACTLY: "el", "iki", "hal" and "çek" are too short to be a safe prefix
 *     ("el" would otherwise fire inside "elektronik").
 *  3. THE TERMS FIRE TOO, not only the key — but a term must carry at least
 *     TWO distinctive words. A single-word expansion term ("ihtar", "kusur",
 *     "tahliye", "bono", "şufa") is exactly the kind of word that appears in
 *     every third decision, and letting one of them fire a whole concept would
 *     re-create the noise this change exists to remove. A multi-word string
 *     fires when ALL of its distinctive words appear ANYWHERE in the text, not
 *     necessarily next to each other: a lawyer narrates "temerrüde düşmediğini
 *     … tahliye davası", never "temerrüt nedeniyle tahliye".
 *
 * "Distinctive" removes only {@link CONCEPT_CONNECTORS} — five words that glue
 * an institution's words together and carry no meaning of their own. The list
 * is deliberately tiny: every word removed makes a phrase EASIER to fire.
 */
export const CONCEPT_CONNECTORS: ReadonlySet<string> = Object.freeze(
  new Set(["ve", "veya", "ile", "nedeniyle", "nedenle"]),
);

/** Below this length a table word must match a text word EXACTLY. */
export const MIN_PREFIX_MATCH_LENGTH = 4;
/** At/above this length the table word's last letter may be dropped. */
export const MIN_SUFFIX_TOLERANT_LENGTH = 6;

const NON_WORD_RE = /[^\p{L}\p{N}]+/u;

/** Cut text into whole words. Same function for the table and the question. */
export function conceptTokens(text: string): string[] {
  return text.split(NON_WORD_RE).filter((w) => w !== "");
}

/** The words of a table string that carry meaning (connectors removed). */
export function distinctiveWords(entry: string): string[] {
  return conceptTokens(entry).filter((w) => !CONCEPT_CONNECTORS.has(w));
}

/** The form a text word must START with; see rule 2 above. */
export function tableWordStem(word: string): string {
  return word.length >= MIN_SUFFIX_TOLERANT_LENGTH ? word.slice(0, -1) : word;
}

/** Does any WHOLE word of `tokens` carry this table word? */
export function tableWordFires(word: string, tokens: readonly string[]): boolean {
  if (word.length < MIN_PREFIX_MATCH_LENGTH) return tokens.includes(word);
  const stem = tableWordStem(word);
  return tokens.some((token) => token.startsWith(stem));
}

/** Does the text contain this table string (key or expansion term)? */
export function tableEntryFires(entry: string, tokens: readonly string[]): boolean {
  const words = distinctiveWords(entry);
  if (words.length === 0) return false;
  return words.every((word) => tableWordFires(word, tokens));
}

/**
 * Which strings of ONE concept the text really contains, in table order: the
 * key first when it fired, then the expansion terms that carry two or more
 * distinctive words. The result is recorded on the issue
 * (`IntakeIssue.matchedTerms`) because query generation needs to know WHICH
 * words of the table the lawyer actually wrote.
 */
export function firedTableEntries(
  key: string,
  entry: ConceptEntry,
  tokens: readonly string[],
): string[] {
  const fired: string[] = [];
  if (tableEntryFires(key, tokens)) fired.push(key);
  for (const term of entry.terms) {
    if (term === key || fired.includes(term)) continue;
    // Rule 3: a one-word synonym may not fire a concept on its own.
    if (distinctiveWords(term).length < 2) continue;
    if (tableEntryFires(term, tokens)) fired.push(term);
  }
  return fired;
}

/**
 * Is this fired concept the GENERIC PARENT of another fired concept (F3)?
 *
 * The measured failure was a kira-tahliye event whose plan was led by the
 * one-word `kira`, whose expansion then spread the search to `kira bedelinin
 * tespiti` and `uyarlama davası` — two DIFFERENT kinds of case. A concept is
 * generic here when its key is ONE word and that word also stands inside
 * another fired concept's key or expansion terms ("kira" inside "kira
 * alacağı", "tazminat" inside "manevi tazminat", "ihale" inside "ihaleye fesat
 * karıştırma", "nafaka" inside "iştirak nafakası").
 *
 * Generic is NOT dropped — the wide search still runs, and the lawyer still
 * sees it. It only loses its place at the front, and with it the quota.
 */
export function isGenericParent(
  key: string,
  firedKeys: readonly string[],
): boolean {
  const words = distinctiveWords(key);
  if (words.length !== 1) return false;
  const word = words[0] as string;
  return firedKeys.some((other) => {
    if (other === key) return false;
    const entry = CONCEPT_TABLE[other];
    if (entry === undefined) return false;
    return [other, ...entry.terms].some((candidate) =>
      tableWordFires(word, conceptTokens(candidate)),
    );
  });
}

/**
 * Ordering rule for the conceptual issues a question produced (W16, Şerit A).
 *
 * BEHAVIOUR CHANGE, deliberate: the list used to be ordered by FIRST OCCURRENCE
 * in the question. With an 18-row table that was harmless, because two rows
 * almost never fired on the same sentence. With a table this size they do, and
 * first-occurrence produced the wrong leader in the one case that matters: the
 * generic word is written before the specific institution that contains it
 * ("kira artışı ve kira bedelinin tespiti", "tazminat isterken manevi
 * tazminat"), so the plan was led by "kira" / "tazminat" — the widest possible
 * query — while the specific institution was pushed toward the cap.
 *
 * Specificity is scored as (word count, character length), most specific first:
 *
 *  - WORD COUNT is the primary key, not raw length. A multi-word Turkish legal
 *    term names an institution ("iş kazası", "muris muvazaası", "kamulaştırmasız
 *    el atma"); a single word is far more often a generic remedy or defence
 *    ("tazminat", "zamanaşımı", "kira"). Scoring by raw length alone would let
 *    "zamanaşımı" (10 characters) lead a question that opens with "iş kazası".
 *  - CHARACTER LENGTH breaks ties inside the same word count, so a key that
 *    CONTAINS another matched key always outranks it.
 *  - FIRST OCCURRENCE then keeps the lawyer's own emphasis among equals, and a
 *    tr-TR comparison makes the order total (deterministic for the same input).
 *
 * The count limits are unchanged (MAX_CONCEPTUAL_ISSUES / MAX_ISSUES): this
 * changes WHICH issues survive the cap, never HOW MANY.
 */
/**
 * Shortest table string the suffix-tolerant rule may be applied to (W17).
 *
 * Below this a one-character trim starts matching unrelated words: "ihale"
 * trimmed to "ihal" would fire inside "ihalâl", and "çek" is already handled
 * by the key-selection rule (the table stores "karşılıksız çek"). Six is the
 * shortest length at which the trimmed form is still a distinctive stem
 * ("temerrüt" → "temerrü", "tahliye" → "tahliy", "ihtarname" → "ihtarnam").
 */
const SUFFIX_TOLERANT_MIN = 6;

/** Turkish letters + digits; anything else is a word boundary. */
const WORD_CHAR = /[0-9A-Za-zÇĞİIÖŞÜçğıioöşü]/u;

function boundedAt(text: string, term: string, at: number): boolean {
  const before = at === 0 ? "" : text[at - 1]!;
  const afterIndex = at + term.length;
  const after = afterIndex >= text.length ? "" : text[afterIndex]!;
  // A term may be FOLLOWED by a Turkish suffix ("tahliye" → "tahliyesi"),
  // but it may never START inside another word ("çek" inside "gerçek").
  return before === "" || !WORD_CHAR.test(before);
}

/** True when `term` occurs in `text` without starting inside another word. */
function occursAsWord(text: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at < 0) return false;
    if (boundedAt(text, term, at)) return true;
    from = at + 1;
  }
}

/**
 * The table string that made this concept fire, or undefined.
 *
 * W17 — MEASURED DEFECT. Until now a concept fired only when its KEY appeared
 * verbatim, and the account a lawyer actually writes almost never contains the
 * key. A real measurement on 05.09.2026: the narrative "kiracı … iki ay
 * ödemedi … noterden ihtarname … otuz gün … tahliye davası … temerrüde
 * düşmediğini" fired exactly ONE concept out of 164 — the generic "kira" —
 * while the table's own "temerrüt nedeniyle tahliye" entry (whose terms are
 * "otuz günlük süre", "iki haklı ihtar", "kira alacağı") never fired at all.
 * The searches then went out as "kira" and "tahliye" and brought back tax and
 * criminal decisions.
 *
 * Two rules, both deterministic and both narrow on purpose:
 *   1. the concept fires on ANY of its table strings (key or expansion term),
 *      not only on the key;
 *   2. a string of {@link SUFFIX_TOLERANT_MIN} characters or more also matches
 *      with its last character dropped, which is what carries Turkish
 *      inflection ("temerrüt" → "temerrüde", "ihtarname" → "ihtarnamenin").
 *
 * Neither rule ever matches INSIDE a word: the decoy questions ("yağmur suyu",
 * "gerçekten", "abonelik başvurusu") must keep firing nothing, and a test
 * pins exactly that.
 */
/**
 * Words that carry no identifying force inside a concept key: dropping them
 * is what lets "temerrüt nedeniyle tahliye" be recognised in an account that
 * says "temerrüde düşmediğini … tahliye davası açtı".
 */
const KEY_JOIN_WORDS: ReadonlySet<string> = new Set([
  "ile", "ve", "veya", "nedeniyle", "sebebiyle", "dolayı", "karşı", "göre",
  "için", "üzerine", "hakkında", "yoluyla", "suretiyle", "olan", "eden",
]);

/** Below this a token must match as a WHOLE word ("el", "iş", "çek"). */
const WHOLE_WORD_MAX = 4;
/** Alternative names of the institution itself, not merely related terms. */
const CONCEPT_INPUT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "fazla mesai": ["fazla çalışma"],
};

/**
 * The words of ONE normalized text, prepared once (W17/c).
 *
 * MEASURED: a 441 KB petition spent ~26 s of a single request in this file —
 * `tokenMatches` re-split the WHOLE text into words and re-stemmed every word
 * once per table token, for every one of the 164 concepts, and the petition
 * analysis runs this over every claim and over the whole document. The event
 * loop was blocked for the duration: `/v1/health` took 48.9 s to answer while
 * one petition was analysed. The answers are unchanged — "some word starts
 * with T", "some word has stem S" — only the work is done once per text:
 * the distinct words sorted (a prefix is then a binary search) and the set of
 * their stems.
 */
interface WordIndex {
  sorted: readonly string[];
  stems: ReadonlySet<string>;
}

function buildWordIndex(nq: string): WordIndex {
  const unique = [...new Set(conceptTokens(nq))];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { sorted: unique, stems: new Set(unique.map((word) => stemTurkish(word))) };
}

/** Does any word of the index START WITH `prefix`? */
function hasWordWithPrefix(index: WordIndex, prefix: string): boolean {
  const words = index.sorted;
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((words[mid] as string) < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo < words.length && (words[lo] as string).startsWith(prefix);
}

/** Table tokens are few and fixed: their stem forms are computed once. */
const TOKEN_FORMS = new Map<string, { stem: string; softened: string }>();
function tokenForms(token: string): { stem: string; softened: string } {
  let forms = TOKEN_FORMS.get(token);
  if (forms === undefined) {
    forms = { stem: stemTurkish(token), softened: softenFinalConsonant(token) };
    TOKEN_FORMS.set(token, forms);
  }
  return forms;
}

function tokenMatches(nq: string, token: string, index?: WordIndex): boolean {
  if (token.length <= WHOLE_WORD_MAX) {
    // Whole word only: "el" may not fire inside "elden", "iş" inside "işlem".
    const at = nq.indexOf(token);
    for (let from = at; from >= 0; from = nq.indexOf(token, from + 1)) {
      const before = from === 0 ? "" : nq[from - 1]!;
      const afterIndex = from + token.length;
      const after = afterIndex >= nq.length ? "" : nq[afterIndex]!;
      if ((before === "" || !WORD_CHAR.test(before)) && (after === "" || !WORD_CHAR.test(after))) {
        return true;
      }
    }
    return false;
  }
  // Arbitrarily dropping two letters makes kazası match kazandığını.
  // Compare inflectional stems or the complete word, with final consonant
  // softening only; unrelated words sharing a short prefix cannot fire.
  const { stem, softened } = tokenForms(token);
  const words = index ?? buildWordIndex(nq);
  return (
    hasWordWithPrefix(words, token) ||
    words.stems.has(stem) ||
    (softened !== token && hasWordWithPrefix(words, softened))
  );
}

/**
 * The table string that made this concept fire, or undefined.
 *
 * W17 — MEASURED DEFECT AND ITS FIX. Until now a concept fired only when its
 * key appeared VERBATIM, and the account a lawyer actually writes almost never
 * contains the key. Measured on 05.09.2026 against the live sources: the
 * narrative "kiracı … iki ay ödemedi … noterden ihtarname … otuz gün …
 * tahliye davası … temerrüde düşmediğini" fired exactly ONE concept out of
 * 164 — the generic "kira" — while the table's own "temerrüt nedeniyle
 * tahliye" entry never fired. The searches then went out as "kira" and
 * "tahliye" and the top results were Danıştay VERGİ and Yargıtay CEZA
 * decisions.
 *
 * The rule now matches the KEY'S OWN WORDS rather than the key as a string:
 * a concept fires when every identifying word of its key is present, with
 * Turkish inflection tolerated. That recognises "temerrüt … tahliye" as
 * "temerrüt nedeniyle tahliye" while REFUSING to read "ihtarname" as
 * "temerrüt faizi" (whose second word, "faizi", is absent) — a false positive
 * an earlier, term-based attempt produced and this rule kills.
 *
 * It never matches inside a word: the decoy questions ("yağmur suyu",
 * "gerçekten", "abonelik başvurusu") must keep firing nothing, and a test
 * pins exactly that.
 */
function conceptHit(nq: string, key: string, index?: WordIndex): string | undefined {
  if (occursAsWord(nq, key)) return key;
  for (const alias of CONCEPT_INPUT_ALIASES[key] ?? []) {
    if (alias.split(" ").every((token) => tokenMatches(nq, token, index))) return alias;
  }
  const tokens = key.split(" ").filter((w) => w !== "" && !KEY_JOIN_WORDS.has(w));
  if (tokens.length < 2) return undefined; // one-word keys keep the strict rule
  return tokens.every((token) => tokenMatches(nq, token, index)) ? key : undefined;
}

export function compareConceptSpecificity(
  normalizedQuestion: string,
): (a: string, b: string) => number {
  return (a, b) => {
    const aWords = a.split(" ").length;
    const bWords = b.split(" ").length;
    if (aWords !== bWords) return bWords - aWords;
    if (a.length !== b.length) return b.length - a.length;
    const ai = normalizedQuestion.indexOf(a);
    const bi = normalizedQuestion.indexOf(b);
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b, "tr-TR");
  };
}

// ---------------------------------------------------------------------------
// Regulator hint terms (KVKK / rekabet / ihale / ...)
// ---------------------------------------------------------------------------

export type RegulatorCode =
  | "KVKK"
  | "REKABET"
  | "KIK"
  | "BDDK"
  | "BTK"
  | "GIB"
  | "SIGORTA"
  | "SAYISTAY";

/** Fixed iteration order => deterministic hint ordering. */
export const REGULATOR_ORDER: readonly RegulatorCode[] = Object.freeze([
  "KVKK",
  "REKABET",
  "KIK",
  "BDDK",
  "BTK",
  "GIB",
  "SIGORTA",
  "SAYISTAY",
]);

export const REGULATOR_TERMS: Readonly<Record<RegulatorCode, readonly string[]>> =
  Object.freeze({
    KVKK: Object.freeze([
      "kvkk",
      "kişisel veri",
      "veri sorumlusu",
      "açık rıza",
      "aydınlatma yükümlülüğü",
      "verbis",
      "veri ihlali",
    ]),
    REKABET: Object.freeze([
      "rekabet kurumu",
      "rekabet ihlali",
      "hakim durum",
      "kartel",
      "birleşme ve devralma",
      "pişmanlık başvurusu",
    ]),
    KIK: Object.freeze([
      "ihale",
      "kamu ihale",
      "itirazen şikayet",
      "yaklaşık maliyet",
      "aşırı düşük teklif",
    ]),
    BDDK: Object.freeze(["bddk", "bankacılık düzenleme", "kredi riski"]),
    BTK: Object.freeze(["btk", "elektronik haberleşme", "bilgi teknolojileri kurumu"]),
    GIB: Object.freeze(["özelge", "gelir idaresi", "vergi ziyaı"]),
    SIGORTA: Object.freeze(["sigorta tahkim", "sigorta hakemi"]),
    SAYISTAY: Object.freeze(["sayıştay", "kamu zararı"]),
  });

// ---------------------------------------------------------------------------
// Temporal + template-selection marker tables
// ---------------------------------------------------------------------------

/** Matched against the normalized (lowercased) question via matchAll. */
const TEMPORAL_PATTERNS: readonly RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/gu,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/gu,
  /\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+\d{4}\b/gu,
  /\b(?:19|20)\d{2}\s+yılında\b/gu,
  /\bgüncel\b/gu,
  /\byürürlü[\p{L}]*/gu, // yürürlük / yürürlükte / yürürlüğe ...
  /\bson değişikli[\p{L}]*/gu,
  /\bmülga\b/gu,
  /\bdeğişiklikten (?:önce|sonra)\b/gu,
];

export const AYM_MARKERS: readonly string[] = Object.freeze([
  "norm denetimi",
  "anayasaya aykırı",
  "anayasa'ya aykırı",
  "anayasaya aykırılık",
  "iptal davası",
  "somut norm",
  "itiraz yoluyla",
  "bireysel başvuru",
  "anayasa mahkemesi",
]);

/**
 * Markers that a question is explicitly about a split of authority. These are
 * the phrases Turkish practitioners use for a divergence, not merely for a
 * losing outcome: an "içtihadı birleştirme" or a "direnme kararı" is the
 * procedural place where the opposing view is on the record.
 */
export const CONTRARY_MARKERS: readonly string[] = Object.freeze([
  "karşıt",
  "aksi yönde",
  "aykırı içtihat",
  "içtihat farklılığı",
  "içtihat aykırılığı",
  "içtihat değişikliği",
  "içtihadı birleştirme",
  "direnme",
  "karşı oy",
  "görüş ayrılığı",
  "yargıtay ve danıştay",
  "çelişkili karar",
]);

// ---------------------------------------------------------------------------
// Issue extraction
// ---------------------------------------------------------------------------

export interface IntakeIssue {
  issueId: string;
  kind: "exact_reference" | "conceptual";
  label: string;
  /** All extracted issues are material in v1; flag kept for future triage. */
  material: boolean;
  /** Present for exact_reference issues. */
  reference?: ParsedReference;
  /** Present for conceptual issues (the matched table key). */
  concept?: string;
  /** Index 0 is the round-1 query term; the rest feed the round-2 gap query. */
  expandedTerms: readonly string[];
  /**
   * Additive (W17): the table string that actually appeared in the question or
   * the account — the key itself, or one of the expansion terms. It is the
   * lawyer's OWN wording, so a query built from it searches what the file is
   * about rather than the concept's generic name.
   */
  matchedTerm?: string;
  /**
   * Statutory hooks for a conceptual issue, in citation form ("TBK m.350").
   * Present ONLY when the table wrote them down; absent means "not written
   * down here", never "no statutory basis". Never rendered as an answer.
   */
  anchors?: readonly string[];
}

/**
 * Bound on the number of issues a single question may spawn. A research run
 * has a hard step budget (brief 10.3); an unbounded issue list would spend it
 * on the first two issues and silently never reach the rest. Exact references
 * win over concepts because the user named them explicitly.
 *
 * W16 (Şerit A) reviewed these three numbers when the concept table grew from
 * 18 rows to well over a hundred and DELIBERATELY LEFT THEM UNCHANGED. The
 * budget they protect did not grow: a research run still has the same hard
 * step budget, and raising the cap would spend it on more issues rather than
 * on more evidence per issue. What the bigger table changed is not how many
 * issues a question may spawn but WHICH ones survive the cap — that is the
 * ordering rule in `compareConceptSpecificity`, and it is where the gain is.
 */
export const MAX_EXACT_REFERENCE_ISSUES = 3;
export const MAX_CONCEPTUAL_ISSUES = 3;
export const MAX_ISSUES = 4;

export interface RegulatorHint {
  regulator: RegulatorCode;
  matchedTerms: readonly string[];
}

export interface TemporalFlags {
  flagged: boolean;
  phrases: readonly string[];
  asOf?: string;
}

export interface IntakeAnalysis {
  intake: ResearchIntake;
  normalizedQuestion: string;
  references: readonly ParsedReference[];
  issues: readonly IntakeIssue[];
  temporal: TemporalFlags;
  regulatorHints: readonly RegulatorHint[];
  /** Markers steering template selection (see templates.ts). */
  aymMarkers: readonly string[];
  contraryMarkers: readonly string[];
}

function extractTemporalPhrases(nq: string): string[] {
  const phrases: string[] = [];
  for (const pattern of TEMPORAL_PATTERNS) {
    for (const m of nq.matchAll(pattern)) {
      const phrase = m[0];
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
}

function matchedMarkers(nq: string, markers: readonly string[]): string[] {
  return markers.filter((m) => nq.includes(m));
}

/**
 * Classify the intake question into typed issues:
 *  - exact-reference issues from parseReferences (legislation + attached
 *    article numbers, standalone E./K. court decisions);
 *  - conceptual issues from the concept expansion table;
 *  - a single fallback conceptual issue when nothing else matched, so a plan
 *    is never empty.
 */
export function analyzeIntake(intake: ResearchIntake): IntakeAnalysis {
  const nq = normalizeTurkishSearch(intake.question);
  const focus = normalizeTurkishSearch(explicitResearchFocus(intake.question) ?? "");
  const references = parseReferences(intake.question);

  const issues: IntakeIssue[] = [];
  let nextId = 1;
  const newIssueId = (): string => `issue-${nextId++}`;

  const legislationRefs = references.filter((r) => r.kind === "legislation");
  const articleRefs = references.filter((r) => r.kind === "article");
  const courtRefs = references.filter((r) => r.kind === "court_decision");

  const exactIssues: IntakeIssue[] = [];

  // Pair article references with legislation references positionally (v1
  // heuristic: i-th article belongs to i-th law); leftovers are kept in
  // `references` but do not form standalone issues.
  legislationRefs.forEach((ref, i) => {
    const article = articleRefs[i]?.articleNo;
    const merged: ParsedReference = {
      ...ref,
      ...(article !== undefined ? { articleNo: article } : {}),
    };
    const label =
      `${ref.legislationNo ?? ""} sayılı kanun` +
      (article !== undefined ? ` madde ${article}` : "");
    exactIssues.push({
      issueId: "",
      kind: "exact_reference",
      label: label.trim(),
      material: true,
      reference: merged,
      expandedTerms: Object.freeze([label.trim()]),
    });
  });

  for (const ref of courtRefs) {
    const label = `E. ${ref.docketNo ?? ""} K. ${ref.decisionNo ?? ""}`.trim();
    exactIssues.push({
      issueId: "",
      kind: "exact_reference",
      label,
      material: true,
      reference: ref,
      expandedTerms: Object.freeze([label]),
    });
  }

  // Conceptual issues, ordered MOST SPECIFIC FIRST (see
  // `compareConceptSpecificity` for why this is no longer first-occurrence).
  // W17/c — each text's words are prepared ONCE (see WordIndex), and whether a
  // concept is in the research focus is decided once per concept, not once
  // per comparison of the sort.
  const nqIndex = buildWordIndex(nq);
  const focusIndex = buildWordIndex(focus);
  const inFocus = new Map<string, boolean>();
  const focusHit = (key: string): boolean => {
    let hit = inFocus.get(key);
    if (hit === undefined) {
      hit = conceptHit(focus, key, focusIndex) !== undefined;
      inFocus.set(key, hit);
    }
    return hit;
  };
  const bySpecificity = compareConceptSpecificity(nq);
  const conceptMatches = Object.keys(CONCEPT_EXPANSIONS)
    .map((key) => ({ key, hit: conceptHit(nq, key, nqIndex) }))
    .filter((m): m is { key: string; hit: string } => m.hit !== undefined)
    .sort((a, b) => Number(focusHit(b.key)) - Number(focusHit(a.key))
      || bySpecificity(a.key, b.key));
  const conceptualIssues: IntakeIssue[] = conceptMatches.map(({ key: concept, hit }) => {
    const expanded = CONCEPT_EXPANSIONS[concept] ?? [concept];
    const anchors = CONCEPT_ANCHORS[concept];
    return {
      issueId: "",
      kind: "conceptual" as const,
      label: concept,
      material: true,
      concept,
      expandedTerms: Object.freeze([...expanded]),
      // W17: WHICH string of the table actually appeared in the account. The
      // query builder needs it: a concept that fired through "ihtarname"
      // must search "ihtarname", not only its own generic key.
      matchedTerm: hit,
      ...(anchors !== undefined ? { anchors: Object.freeze([...anchors]) } : {}),
    };
  });

  // Bounded, deterministic issue set: named references first, then concepts.
  for (const issue of [
    ...exactIssues.slice(0, MAX_EXACT_REFERENCE_ISSUES),
    ...conceptualIssues.slice(0, MAX_CONCEPTUAL_ISSUES),
  ].slice(0, MAX_ISSUES)) {
    issues.push({ ...issue, issueId: newIssueId() });
  }

  if (issues.length === 0) {
    issues.push({
      issueId: newIssueId(),
      kind: "conceptual",
      label: nq,
      material: true,
      concept: nq,
      expandedTerms: Object.freeze([nq]),
    });
  }

  const regulatorHints: RegulatorHint[] = [];
  for (const regulator of REGULATOR_ORDER) {
    const matched = REGULATOR_TERMS[regulator].filter((t) => nq.includes(t));
    if (matched.length > 0) {
      regulatorHints.push({ regulator, matchedTerms: Object.freeze(matched) });
    }
  }

  const temporalPhrases = extractTemporalPhrases(nq);
  const temporal: TemporalFlags = {
    flagged: temporalPhrases.length > 0 || intake.asOf !== undefined,
    phrases: Object.freeze(temporalPhrases),
    ...(intake.asOf !== undefined ? { asOf: intake.asOf } : {}),
  };

  return {
    intake,
    normalizedQuestion: nq,
    references: Object.freeze(references),
    issues: Object.freeze(issues),
    temporal,
    regulatorHints: Object.freeze(regulatorHints),
    aymMarkers: Object.freeze(matchedMarkers(nq, AYM_MARKERS)),
    contraryMarkers: Object.freeze(matchedMarkers(nq, CONTRARY_MARKERS)),
  };
}

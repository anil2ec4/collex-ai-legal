/**
 * Renderers for the citation-first AnswerDocument (brief 9.2 + 9.4):
 *
 *  - `renderAnswerMarkdown`: Turkish user-facing Markdown — sourced answer
 *    with numbered kaynak cards (mahkeme/daire, E./K., tarih, madde, exact
 *    quote block, hash kısaltması, source URL), per-claim confidence
 *    breakdown, an explicit CONFLICTING-authorities section, and honest
 *    abstention text when the evidence is insufficient.
 *  - `renderEvidenceBundle` / `renderEvidenceBundleJson`: structured export
 *    of the full evidence/claim contract for downstream audit.
 *
 * SECURITY: every dynamic string (titles, quotes, court names, URLs — all of
 * it retrieved, untrusted content) passes through `escapeInline`, which
 * neutralizes HTML tags and Markdown link/code syntax. Quotes are rendered
 * ONLY inside blockquote lines, so injection payloads like "SYSTEM: ..."
 * appear as visibly quoted text, never as top-level instructions.
 */

import type { ClaimDraft, EvidenceRef } from "../evidence/types.js";
import type { Verdict } from "../verification/finalize.js";
import type {
  AuthorityAssessment,
  CurrentnessAssessment,
  EvidenceItem,
  EvidenceOrigin,
  EvidenceStance,
} from "./evidencePack.js";
import { UPLOAD_ONLY_EVIDENCE, type AnswerDocument, type VerifiedClaim } from "./verifier.js";
import type { QuestionCoverageReport } from "./coverage.js";
import { CORPUS_UNAVAILABLE_MESSAGE_TR } from "../retrieval/corpusErrors.js";
import { ENTAILMENT_NOT_CHECKED } from "./verifier.js";

/**
 * Neutralize HTML and Markdown-active syntax in untrusted inline text.
 * HTML entities render as literal characters in Markdown viewers, so the
 * content stays readable while `<script>`, `[label](url)` links and backtick
 * code spans lose their meaning.
 */
export function escapeInline(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/`/g, "&#96;");
}

/** Render untrusted multi-line text as an escaped Markdown blockquote. */
function blockquote(text: string): string {
  return escapeInline(text)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function pct(value: number): string {
  return `%${Math.round(Math.min(1, Math.max(0, value)) * 100)}`;
}

/**
 * Turkish thousands separator ("1240" -> "1.240").
 *
 * Deliberately NOT `toLocaleString`: the ICU data available to the process
 * decides that, and the same answer must read identically on every machine.
 */
function trNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
}

/**
 * Shared terminology dictionary: the four states carry the SAME label and the
 * SAME sentence on EVERY surface (console, markdown, DOCX). The raw enum only
 * ever appears parenthesized as the machine code.
 *
 * W15: `detail` artık makine tanımı değil, avukatın okuyup ne yapacağını
 * bildiği tek Türkçe cümledir (W15-TASARIM, CEVAP EKRANI katman 1/b). ABSTAIN
 * damgası tek başına "ÇEKİMSER" olarak yazılmaz — "çekimser" oy için
 * kullanılan bir sözcüktür ve avukat neyin olmadığını anlamaz; kanonik
 * sözlükte damga "DAYANAK BULUNAMADI (ÇEKİMSER)"dir (W15-DEĞİŞMEZLER §3).
 * Anahtarlar (COMPLETE/QUALIFIED/PARTIAL/ABSTAIN) değişmez.
 */
const STATUS_TR: Record<AnswerDocument["status"], { label: string; detail: string }> = {
  COMPLETE: { label: "TAM", detail: "her tespit bir alıntıya bağlandı" },
  QUALIFIED: {
    label: "ŞERHLİ",
    detail: "tespitler alıntıya bağlandı; ancak bir çekince ya da aksi yönde bir kaynak var",
  },
  PARTIAL: { label: "KISMİ", detail: "bazı tespitler alıntıya bağlanamadı" },
  ABSTAIN: {
    label: "DAYANAK BULUNAMADI (ÇEKİMSER)",
    detail: "bu soruya cevap yazılmadı",
  },
};

/**
 * Tespit başlığındaki hüküm çipi.
 *
 * W15: eski değerler (DESTEKLENİYOR, ÇELİŞEN OTORİTELER, YETERSİZ KANIT …)
 * kendini açıklamayan büyük harfli damgalardı; avukat "yetersiz kanıt"ı
 * mahkemedeki delil yetersizliğiyle karıştırıyordu. Yerlerine, neyin
 * denetlendiğini söyleyen kısa Türkçe cümleler geldi (W15-TASARIM adım 25).
 * "Güncel olmayan kaynak" şüphe diline yumuşatılmadı: hüküm o tarihte
 * yürürlükte değilse cümle bunu düz söyler. Verdict ANAHTARLARI değişmez.
 */
const VERDICT_TR: Record<Verdict, string> = {
  SUPPORTED: "Kaynakla destekleniyor",
  QUALIFIED: "Kaynaklı, ancak çekince var",
  CONFLICTING_AUTHORITIES: "Kaynaklar çelişiyor",
  INSUFFICIENT_EVIDENCE: "Dayanak yetersiz",
  OUT_OF_DATE_SOURCE: "Kaynak o tarihte yürürlükte değil",
  PARTIAL_SOURCE_COVERAGE: "Kaynak soruyu kısmen karşılıyor",
};

/**
 * Currentness label of an uploaded document (W12-B2), identical on every
 * surface: the source card, the claim's Güncellik line, the console chip.
 */
export const CURRENTNESS_NOT_APPLICABLE_LABEL_TR = "yüklediğiniz belge — yürürlük değerlendirilemez";

const CURRENTNESS_TR: Record<CurrentnessAssessment["status"], string> = {
  IN_FORCE: "yürürlükte",
  OUT_OF_DATE: "güncel değil",
  REPEALED: "mülga",
  NOT_YET_IN_FORCE: "henüz yürürlükte değil",
  UNKNOWN: "bilinmiyor",
  NOT_APPLICABLE: CURRENTNESS_NOT_APPLICABLE_LABEL_TR,
};

/**
 * The finalizable line, from the shared terminology dictionary (the console
 * carries the same two sentences). It is a decision about TECHNICAL checks;
 * the legal assessment is the lawyer's, and the line says so.
 */
export const FINALIZE_TR = {
  yes: "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır.",
  // W15: eski metin "en az bir doğrulama başarısız" diyordu ve avukatta
  // "program çöktü" izlenimi bırakıyordu; oysa kastedilen, ColleX'in kendi
  // iç kontrollerinden birinin sonuç üretememesidir. Ayrıca gerekçelerin
  // NEREDE olduğu yazmıyordu (W15-TASARIM, CEVAP EKRANI katman 1/e).
  no: "KESİNLEŞTİRİLEMEZ — iç kontrollerden biri sonuç veremedi; aşağıdaki gerekçeleri okumadan kullanmayın.",
} as const;

/**
 * Appended to the finalizable line when every evidenced claim rests on the
 * reader's own uploaded documents (verifier reason UPLOAD_ONLY_EVIDENCE):
 * "finalizable" must never be read as "the law says so".
 */
export const UPLOAD_ONLY_EVIDENCE_TEXT =
  "Cevap yalnızca yüklediğiniz belgedeki pasajlara dayanır; belgenin doğruluğu ve " +
  "güncelliği denetlenmemiştir.";

/** Source-card "Kaynak türü" chip per origin (corpus is the default: no line). */
const ORIGIN_TR: Partial<Record<EvidenceOrigin, string>> = {
  upload: "yüklediğiniz belge",
  live: "canlı resmî kaynak",
};

/** `- Kesinleştirme: …` — one line, every surface. */
export function finalizeLine(doc: Pick<AnswerDocument, "finalizable" | "reasons">): string {
  const base = doc.finalizable ? FINALIZE_TR.yes : FINALIZE_TR.no;
  const uploadOnly = doc.reasons.includes(UPLOAD_ONLY_EVIDENCE);
  return `Kesinleştirme: ${base}${uploadOnly ? ` ${UPLOAD_ONLY_EVIDENCE_TEXT}` : ""}`;
}

/**
 * Cevap yazılmadığında avukatın gördüğü ANA metin.
 *
 * W15: eski metin üç anlaşılmaz öbek taşıyordu ("mevcut korpusta",
 * "doğrulanabilir kaynak", "makine gerekçeleri") ve en önemlisi, avukata
 * bundan sonra ne yapacağını söylemiyordu. Yeni metin, W15-TASARIM'ın
 * "DAYANAK BULUNAMADI — yol ayrımı kartı" bölümünün cümlelerini taşır ve
 * dört çıkış yolunu sayar; aynı cümleler konsolda da yazar.
 */
export const ABSTENTION_TEXT =
  "Dayanak bulunamadı — bu yüzden cevap yazılmadı. " +
  "Bu bir arıza değil, ürünün kuralıdır: ColleX bir tespiti belgeden alınmış bir alıntıya " +
  "bağlayamıyorsa o tespiti yazmaz; bunu gizlemez, size söyler. " +
  "Aşağıda hiçbir kaynak kartı ve hiçbir tespit yoktur. " +
  "Buradan sonra dört yol var: resmî kaynaklarda aratın; elinizdeki sözleşmeyi, kararı ya da " +
  "bilirkişi raporunu yükleyip yeniden sorun; soruyu daraltın — kanunun adını, madde " +
  "numarasını ya da kararın esas numarasını yazmak sonucu en çok değiştiren şeydir; ya da " +
  "değerlendirme tarihini değiştirin.";

/**
 * Shown when the coverage gate set retrieved passages aside (W12).
 *
 * W15: "kelime düzeyinde benzerlik" mühendis ifadesiydi ve avukata bu
 * metinlerle ne yapabileceğini söylemiyordu.
 */
export const COVERAGE_SET_ASIDE_TEXT =
  "Aşağıdaki belgeler aramada göründü, ancak sorunuzla yalnız sözcük düzeyinde benziyor. " +
  "Doğrulamadan geçmemiş metni alıntı gibi göstermiyoruz; künyelerini görebilir, kendiniz " +
  "açabilirsiniz.";

/**
 * The question-coverage line, identical on every surface.
 *
 * W15: "Soru kapsamı: %22" satırı avukata %22'nin iyi mi kötü mü olduğunu
 * söylemiyordu ve "kapsam" sözcüğü üründe üç ayrı anlamda geçiyordu. Yüzde
 * ana akıştan kalkar (sayının kendisi denetim kaydında durur) ve yerine
 * sayılabilir bir cümle gelir. Sayıya Türkçe ek getirmiyoruz ("2'si" eki
 * son rakama göre değişir ve yanlış ek, doğru cümleyi bozar): "2 tanesi"
 * her sayı için doğrudur.
 */
export function coverageLine(coverage: QuestionCoverageReport): string {
  const total = coverage.lexemes.length;
  if (total === 0) {
    return "Sorunuzda kaynaklarda aranabilecek bir anahtar sözcük bulunamadı";
  }
  return (
    `Sorunuzdaki ${total} anahtar sözcükten ${coverage.covered.length} tanesi ` +
    "kaynaklarda karşılık buldu"
  );
}

/**
 * Shown when an explicit reference bypassed the gate but the admitted text
 * still leaves most of the question unanswered (W12-FIX): the cited
 * provision is what the reader gets, and the sentence says the question
 * itself was not answered.
 */
export const COVERAGE_PARTIAL_TEXT =
  "Atıf yapılan hükmün metni gösterildi; sorunun geri kalan sözcükleri kaynaklarda karşılık " +
  "bulmadı — sorunun kendisi cevaplanmış sayılmaz.";

/**
 * W21: TIME_BUDGET_EXCEEDED is ONE reason code for two different runs, and the
 * code must stay as it is (the review-table worker reads it). Noted before
 * drafting, the drafter was skipped and the answer has no claim; noted after
 * drafting, the claims were written and the verification step still ran on
 * them (answerPipeline.ts), each with its own verdict. Only the first may say
 * that drafting and verification were left incomplete.
 */
export const TIME_BUDGET_BEFORE_DRAFT_TR =
  "Cevap süre bütçesini aştı; tespit yazımı ve doğrulama eksik bırakıldı";
export const TIME_BUDGET_AFTER_DRAFT_TR =
  "Cevap süre bütçesini tespitler yazıldıktan sonra aştı; doğrulama adımı yine de çalıştı ve her " +
  "tespitin sonucu kendi satırında yazıyor, ancak cevap KISMİ sayıldı ve kesinleştirilmedi";
const TIME_BUDGET_REASON = "TIME_BUDGET_EXCEEDED";

/** What the reason sentence may depend on besides the code itself. */
export interface ReasonContext {
  /** The answer carries at least one drafted claim (so drafting did run). */
  claimsWritten?: boolean;
}

/**
 * Machine reason codes, explained in Turkish FIRST with the code kept in
 * parentheses (shared dictionary rule: a lawyer reads the sentence, a script
 * greps the code). Unknown codes render as themselves.
 */
const REASON_TR: Readonly<Record<string, string>> = {
  // W15: "korpus" ekrandan kalkar; kanonik karşılığı "hukuk kütüphanesi"dir
  // (W15-DEĞİŞMEZLER §3). "Pasaj" kalır — sözlükte tanımlı, görünen sözcüktür.
  NO_EVIDENCE: "Bu soruya dayanak olabilecek bir pasaj hukuk kütüphanenizde bulunamadı",
  QUESTION_NOT_COVERED:
    "Getirilen pasajlar soru sözcüklerini yeterince karşılamıyor; dayanak sayılmadı",
  QUESTION_PARTIALLY_COVERED:
    "Soru, atıf yapılan hükmün metniyle yalnız kısmen karşılanıyor; sorunun kendisi cevaplanmış sayılmaz",
  NO_CLAIMS_DRAFTED: "Kanıt bulundu ancak hiçbir tespit üretilmedi",
  NO_VERIFIABLE_CLAIMS: "Hiçbir tespit doğrulama kontrollerinden geçemedi",
  NOT_FINALIZABLE: "Cevap kesinleştirilemez",
  ABSTENTION_NOT_FINALIZABLE: "Çekimser cevap kesinleştirilemez",
  RETRIEVAL_DEGRADED:
    "Hukuk kütüphanesi tam olarak taranamadı; cevap eksik olabilir, aramayı yineleyin",
  CORPUS_UNAVAILABLE: CORPUS_UNAVAILABLE_MESSAGE_TR.replace(/\.$/u, ""),
  // W15: "tespit üreticisi" diye bir şey avukatın dünyasında yok.
  DRAFTER_DEGRADED:
    "Cevap cümleleri yazılırken bir arıza oldu; aşağıda yalnız bulunan kaynaklar gösteriliyor",
  UPLOAD_ONLY_EVIDENCE: UPLOAD_ONLY_EVIDENCE_TEXT.replace(/\.$/u, ""),
  TIME_BUDGET_EXCEEDED: TIME_BUDGET_BEFORE_DRAFT_TR,
  TEMPORAL_COMPARISON_MISSING:
    "Sorulan tarih için hangi metnin uygulanacağı karşılaştırılmadı; cevapta hükmün tek bir sürümü var",
  // W15: eski cümle Türkçe olarak okunmuyordu ("hangi pasajın hangi kısmı
  // taşıdığı") ve avukata hiçbir sonuç bildirmiyordu.
  ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM:
    "Bu tespit birden çok pasaja dayandırıldı, ancak hangi pasajın tespitin hangi bölümünü desteklediği ayrılamadı; destek gücü yalnız en güçlü tek pasaja göre hesaplandı — pasajları tek tek açıp okuyun",
  // W21 (#22): the judge did not answer — never "fell below the threshold".
  ENTAILMENT_NOT_CHECKED:
    "Bu tespitin pasaj desteği denetlenemedi (doğrulama bileşeni yanıt vermedi); tespit kesinleştirilmedi",
  UNUSED_CITATION:
    "Bu atıf, tespide diğer atıfların taşımadığı hiçbir şey eklemiyor",
  // 27.09.2026: the live research reasons reached the markdown as bare codes
  // ("- RESEARCH_COVERAGE_INCOMPLETE", "- UPSTREAM_DEGRADED"). Same sentences
  // as the console's WARN_PATTERNS.
  RESEARCH_COVERAGE_INCOMPLETE: "Canlı araştırma planlanan tüm kaynakları tarayamadı",
  BUDGET_EXHAUSTED:
    "Araştırma için ayrılan arama sayısı ya da süre doldu; tarama erken bitirildi, sonuç eksik olabilir",
  UPSTREAM_DEGRADED: "Resmî kaynakların bazıları cevap vermedi; bu sonuç eksik olabilir",
  "UPSTREAM_DEGRADED:ALL":
    "Resmî kaynakların hiçbiri cevap vermedi; bu bir “bulunamadı” sonucu değildir, kaynaklara ulaşılamadı",
};

export function renderReason(reason: string, context: ReasonContext = {}): string {
  // A machine reason may carry a ":"-separated subject
  // (ENTAILMENT_BELOW_THRESHOLD:claim-7, UNUSED_CITATION:claim-7:ev-2); the
  // Turkish sentence is keyed on the CODE, and the whole reason is still
  // printed verbatim in parentheses so a script can grep it.
  const code = reason.split(":")[0] as string;
  // W21: a budget noted only after the claims were drafted is not "drafting
  // and verification left incomplete" (see TIME_BUDGET_AFTER_DRAFT_TR). A
  // claim can only exist if the drafter ran, so its presence decides.
  const explained =
    code === TIME_BUDGET_REASON && context.claimsWritten === true
      ? TIME_BUDGET_AFTER_DRAFT_TR
      : REASON_TR[reason] ?? REASON_TR[code];
  return explained === undefined
    ? escapeInline(reason)
    : `${explained} (${escapeInline(reason)})`;
}

function findItem(doc: AnswerDocument, evidenceId: string): EvidenceItem | undefined {
  return doc.pack.items.find((item) => item.ref.evidenceId === evidenceId);
}

/** Assign stable citation numbers to every validated evidence id in use. */
function numberEvidence(doc: AnswerDocument): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  const take = (id: string): void => {
    if (!numbers.has(id)) {
      numbers.set(id, next);
      next += 1;
    }
  };
  for (const claim of doc.claims) {
    for (const check of claim.citationChecks) if (check.ok) take(check.evidenceId);
    for (const id of claim.contraryEvidenceIds) take(id);
  }
  return numbers;
}

function renderSourceCard(n: number, item: EvidenceItem): string {
  const ref = item.ref;
  const lines: string[] = [`### [${n}] ${escapeInline(ref.title)}`];
  if (ref.court !== undefined && ref.court !== "") {
    lines.push(`- Mahkeme/Daire: ${escapeInline(ref.court)}`);
  }
  if (ref.docketNo !== undefined || ref.decisionNo !== undefined) {
    const ek: string[] = [];
    if (ref.docketNo !== undefined) ek.push(`E. ${escapeInline(ref.docketNo)}`);
    if (ref.decisionNo !== undefined) ek.push(`K. ${escapeInline(ref.decisionNo)}`);
    lines.push(`- Esas/Karar: ${ek.join(", ")}`);
  }
  if (ref.decisionDate !== undefined && ref.decisionDate !== "") {
    lines.push(`- Tarih: ${escapeInline(ref.decisionDate)}`);
  }
  if (ref.legislationNo !== undefined && ref.legislationNo !== "") {
    lines.push(`- Mevzuat No: ${escapeInline(ref.legislationNo)}`);
  }
  if (ref.locator.article !== undefined && ref.locator.article !== "") {
    lines.push(`- Madde: m. ${escapeInline(ref.locator.article)}`);
  }
  lines.push(
    `- Otorite: ${escapeInline(item.authority.label)} (kademe ${item.authority.tier})`,
    `- Güncellik: ${CURRENTNESS_TR[item.currentness.status]}`,
  );
  // An uploaded document is the reader's own file, not corpus authority, and
  // a live passage was fetched at run time; say so on the card (origin
  // "corpus" is the default and needs no line).
  const originLabel = item.origin === undefined ? undefined : ORIGIN_TR[item.origin];
  if (originLabel !== undefined) lines.push(`- Kaynak türü: ${originLabel}`);
  // W15: bu satır cevabın en çok okunan yeriydi ve dört tanımsız terimi yan
  // yana koyuyordu ("SHA-256", "Unicode", "code point", çıplak "konum").
  // Ürünün en değerli özelliği burada anlatılıyor ama anlaşılmıyordu. Kanonik
  // sözlük: SHA-256 -> "parmak izi", Unicode konumu -> "metindeki yeri";
  // teknik adlar SİLİNMEZ, cümlenin sonunda parantezde kalır
  // (W15-DEĞİŞMEZLER §2: teknik doğrulama bilgisi bir katman aşağı iner).
  lines.push(
    "- Alıntı:",
    blockquote(ref.quote),
    "- Bu alıntı nasıl doğrulandı? Aşağıdaki numaralar, metnin tek bir harfi değişse bile " +
      "bambaşka çıkar; alıntının belgeden koparılmadığını böyle gösteriyoruz. Bu bir noter " +
      "onayı değildir: numara, resmî yayımlanmış metinle değil, bu bilgisayarda kayıtlı " +
      "nüshayla eşleşmeyi gösterir.",
    `  - Alıntının parmak izi: ${ref.quoteSha256.slice(0, 12)}… (Teknik adı: SHA-256.)`,
    `  - Belgenin parmak izi: ${ref.contentSha256.slice(0, 12)}…`,
    `  - Alıntının belgedeki yeri: ${trNumber(ref.locator.startChar)}. harften ` +
      `${trNumber(ref.locator.endChar)}. harfe kadar (Teknik adı: Unicode karakter sayımı.)`,
  );
  const url = ref.sourceUrl;
  lines.push(
    /^https?:\/\//iu.test(url)
      ? `- Kaynak URL: ${escapeInline(url)}`
      : "- Kaynak URL: (güvenli olmayan URL gizlendi)",
  );
  return lines.join("\n");
}

/**
 * W21 (#22): the passage-support axis of one claim. A claim no judgement
 * reached reads "denetlenemedi", never a measured percentage; when part of
 * it WAS measured short (a segmented claim) the measured value stays, with
 * the gap named next to it.
 */
function entailmentAxis(claim: VerifiedClaim, docReasons: readonly string[], measured: string): string {
  const reasons = [...claim.reasons, ...docReasons];
  const id = claim.claim.claimId;
  if (!reasons.includes(`${ENTAILMENT_NOT_CHECKED}:${id}`)) return measured;
  return reasons.includes(`ENTAILMENT_BELOW_THRESHOLD:${id}`) ? `${measured} (bir kısmı denetlenemedi)` : "denetlenemedi";
}

function renderClaim(
  index: number,
  claim: VerifiedClaim,
  numbers: Map<string, number>,
  coverage: QuestionCoverageReport | undefined,
  docReasons: readonly string[] = [],
): string {
  const cites = claim.citationChecks
    .filter((c) => c.ok)
    .map((c) => `[${numbers.get(c.evidenceId)}]`)
    .join("");
  const contraryCites = claim.contraryEvidenceIds
    .map((id) => `[${numbers.get(id)}]`)
    .join("");
  const c = claim.claim.confidence;
  // Claim text may embed multi-line untrusted quotes: render it ONLY as a
  // blockquote so injected lines ("SYSTEM: ...") stay visibly quoted.
  const lines = [
    `### Tespit ${index}: ${VERDICT_TR[claim.verdict]}`,
    "",
    blockquote(claim.claim.text),
    "",
    `Atıflar: ${cites === "" ? "(doğrulanmış atıf yok)" : cites}`,
    "",
    // The five confidence axes carry the SAME names on every surface
    // (shared dictionary): Kaynak isabeti · Pasaj desteği · Otorite ·
    // Güncellik · Kapsam. English terms live only in technical-detail views.
    `- Kaynak isabeti: ${pct(c.retrieval)}`,
    `- Pasaj desteği: ${entailmentAxis(claim, docReasons, pct(c.entailment))}`,
    `- Otorite: ${pct(c.authority)}`,
    // A claim resting only on uploads carries the neutral score; a percentage
    // there would read as a yürürlük verdict nobody made.
    `- Güncellik: ${
      claim.currentnessApplicable ? pct(c.currentness) : CURRENTNESS_NOT_APPLICABLE_LABEL_TR
    }`,
    // W15: "karşıt otorite/karşıt kaynak" kanonik sözlükte "aleyhe kaynak"tır.
    `- Aleyhe kaynak: ${
      claim.contraryEvidenceIds.length > 0 ? `VAR ${contraryCites}` : "tespit edilmedi"
    }`,
    `- Kapsam: ${pct(c.coverage)}`,
  ];
  // Sixth axis (W12): how much of the QUESTION the sources cover. Question-
  // level, so it is the same figure on every claim; shown here because this
  // is where a reader looks for confidence.
  if (coverage !== undefined) {
    lines.push(`- ${coverageLine(coverage)}`);
    if (coverage.gate === "bypassed-by-reference") {
      lines.push(
        "- Sorunuzda bir madde ya da karar açıkça anıldığı için o hükmün metni doğrudan" +
          " alındı; öteki pasajlar tek tek soru sözcükleriyle sınandı (bypassed-by-reference)",
      );
    }
  }
  if (claim.verdict === "INSUFFICIENT_EVIDENCE") {
    lines.push(
      "",
      // W15: "karara dayanak yapılmamalıdır" edilgen ve muğlaktı — kimin
      // kararı? Cümle artık avukata doğrudan ne yapacağını söylüyor.
      "Bu tespitin dayandığı alıntı denetimden geçemedi; tespit KAYNAKSIZ sayılır. " +
        "Dilekçenize almayın; kaynağını kendiniz bulup okuyun.",
    );
  }
  return lines.join("\n");
}

/** Turkish user-facing Markdown rendering of a verified answer. */
export function renderAnswerMarkdown(doc: AnswerDocument): string {
  const out: string[] = [
    "# Hukukî Araştırma Cevabı",
    "",
    `- Soru: ${escapeInline(doc.question)}`,
    // W15: "(as-of)" İngilizce teknik bir ibareydi; yerine tarihin ne
    // anlama geldiğini söyleyen Türkçe açıklama geldi.
    `- Değerlendirme tarihi — cevap bu tarihte yürürlükte olan metne göre verildi: ${escapeInline(doc.asOf)}`,
    `- Durum: **${STATUS_TR[doc.status].label}** — ${STATUS_TR[doc.status].detail}` +
      ` (${doc.status})`,
    `- ${finalizeLine(doc)}`,
    `- Doğrulama zamanı: ${escapeInline(doc.verifiedAt)}`,
  ];

  if (doc.status === "ABSTAIN") {
    out.push("", ABSTENTION_TEXT);
    const coverage = doc.coverage;
    if (coverage !== undefined && coverage.gate === "failed" && coverage.setAside > 0) {
      // The gate refused passages that only share words with the question:
      // say how much was covered, that the listed passages are NOT authority,
      // and which words were never found — so the reader can re-ask.
      out.push("", `${coverageLine(coverage)}.`, COVERAGE_SET_ASIDE_TEXT);
      if (coverage.missing.length > 0) {
        out.push(
          `Karşılığı bulunamayan sözcükler: ${coverage.missing.map(escapeInline).join(", ")}.`,
        );
      }
    }
    if (doc.reasons.length > 0) {
      // W15: "makine gerekçeleri" avukata bir şey söylemiyordu; başlık artık
      // bölümün ne cevapladığını söylüyor. Makine kodları satırların
      // sonundaki parantezde AYNEN duruyor — silinmediler.
      out.push("", "Dayanağın neden bulunamadığı:");
      for (const reason of doc.reasons) {
        out.push(`- ${renderReason(reason, { claimsWritten: doc.claims.length > 0 })}`);
      }
    }
    // Honest abstention: NO source cards, no fabricated citations.
    return out.join("\n");
  }

  const numbers = numberEvidence(doc);

  // A partially covered bypass says so BEFORE the tespitler, with the words
  // that were never found, so the cited text is not read as the answer.
  const partial = doc.coverage;
  if (partial !== undefined && partial.partiallyCovered === true) {
    out.push("", `${coverageLine(partial)}.`, COVERAGE_PARTIAL_TEXT);
    if (partial.missing.length > 0) {
      out.push(`Karşılığı bulunamayan sözcükler: ${partial.missing.map(escapeInline).join(", ")}.`);
    }
  }

  out.push("", "## Tespitler");
  doc.claims.forEach((claim, i) => {
    out.push("", renderClaim(i + 1, claim, numbers, doc.coverage, doc.reasons));
  });

  const conflicted = doc.claims.filter((c) => c.verdict === "CONFLICTING_AUTHORITIES");
  if (conflicted.length > 0) {
    out.push(
      "",
      // W15: "Çelişen Otoriteler" başlığındaki "otorite", kanonik sözlükte
      // "kaynak"tır; aleyhe olan kaynağın gizlenmediği açıkça yazılır.
      "## Kaynakları çelişen tespitler",
      "",
      "Aşağıdaki tespitlerde kaynaklar birbiriyle çelişiyor. Aleyhinize olan kaynağı " +
        "gizlemiyoruz; iki tarafı da karşılaştırmadan dilekçeye taşımayın:",
    );
    for (const claim of conflicted) {
      const supporting = claim.citationChecks
        .filter((c) => c.ok)
        .map((c) => `[${numbers.get(c.evidenceId)}]`)
        .join("");
      const contrary = claim.contraryEvidenceIds
        .map((id) => `[${numbers.get(id)}]`)
        .join("");
      out.push(
        "",
        `- ${escapeInline(claim.claim.claimId)}: destekleyen ${supporting} — aleyhe ${contrary}`,
      );
    }
  }

  if (doc.reasons.length > 0) {
    // W15: makine kodları silinmez, bir katman aşağı iner; başlık artık
    // bölümün ne olduğunu söylüyor (W15-TASARIM, "denetim kaydı" çekmecesi).
    out.push("", "## Uyarılar ve doğrulama gerekçeleri");
    for (const reason of doc.reasons) {
      out.push(`- ${renderReason(reason, { claimsWritten: doc.claims.length > 0 })}`);
    }
  }

  out.push("", "## Kaynaklar");
  const ordered = [...numbers.entries()].sort((a, b) => a[1] - b[1]);
  for (const [evidenceId, n] of ordered) {
    const item = findItem(doc, evidenceId);
    if (item === undefined) continue;
    out.push("", renderSourceCard(n, item));
  }

  return out.join("\n");
}

/* ------------------------ evidence bundle export ---------------------- */

export interface EvidenceBundleClaim extends ClaimDraft {
  verdict: Verdict;
  contraryEvidenceIds: string[];
  reasons: string[];
}

export interface EvidenceBundleEvidence extends EvidenceRef {
  authority: AuthorityAssessment;
  currentness: CurrentnessAssessment;
  stance: EvidenceStance;
  retrievalScore: number;
  /**
   * Additive (W12-B2): "upload" / "corpus" / "live"; absent when the producer
   * did not know. The Python exporter ignores unknown keys, so an older
   * reader sees exactly the previous bundle.
   */
  origin?: EvidenceOrigin;
}

/** Structured evidence bundle per brief 9.2 (audit/export contract). */
export interface EvidenceBundle {
  schema: "collex.answer.evidence-bundle/v1";
  question: string;
  asOf: string;
  status: AnswerDocument["status"];
  finalizable: boolean;
  verifiedAt: string;
  reasons: string[];
  claims: EvidenceBundleClaim[];
  evidence: EvidenceBundleEvidence[];
}

export function renderEvidenceBundle(doc: AnswerDocument): EvidenceBundle {
  return {
    schema: "collex.answer.evidence-bundle/v1",
    question: doc.question,
    asOf: doc.asOf,
    status: doc.status,
    finalizable: doc.finalizable,
    verifiedAt: doc.verifiedAt,
    reasons: [...doc.reasons],
    claims: doc.claims.map((claim) => ({
      ...claim.claim,
      verdict: claim.verdict,
      contraryEvidenceIds: [...claim.contraryEvidenceIds],
      reasons: [...claim.reasons],
    })),
    evidence: doc.pack.items.map((item) => ({
      ...item.ref,
      authority: item.authority,
      currentness: item.currentness,
      stance: item.stance,
      retrievalScore: item.retrievalScore,
      ...(item.origin !== undefined ? { origin: item.origin } : {}),
    })),
  };
}

export function renderEvidenceBundleJson(doc: AnswerDocument): string {
  return JSON.stringify(renderEvidenceBundle(doc), null, 2);
}

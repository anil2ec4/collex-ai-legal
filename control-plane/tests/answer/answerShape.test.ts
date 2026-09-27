/**
 * W22 follow-up — the answer's SHAPE (answer/answerShape.ts), the rule-based
 * drafter's rule 4 (llm/ruleDrafter.ts), the quote window
 * (answer/evidencePack.ts bestQuoteWindow) and the answer-level flag
 * (`AnswerResult.answerShape`, warning ANSWER_SHAPE_NOT_FOUND).
 *
 * The defect, measured on a real iş davası file: "Davacı işe ne zaman
 * başladı?" was answered FIRST with the heading line "TANIK BEYAN TUTANAĞI —
 * Davacı … işe giriş" — it carries the question's words and scored higher —
 * instead of the testimony sentence stating the date. Every passage below is
 * written the way a Turkish dosya writes it.
 */

import { describe, expect, it } from "vitest";

import {
  ANSWER_SHAPE_NOT_CHECKED_TR,
  ANSWER_SHAPE_NOT_FOUND,
  ANSWER_SHAPE_VERSION,
  answerShapeFoundTr,
  answerShapeNotFoundTr,
  assessPassageShape,
  classifyWantedShape,
  isHeadingLike,
} from "../../src/answer/answerShape.js";
import { bestQuoteWindow, buildEvidencePack, type AnswerCandidate } from "../../src/answer/evidencePack.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import { classifyQuestionIntent } from "../../src/pipeline/questionIntent.js";
import type { AnswerResult } from "../../src/pipeline/types.js";
import { MapTextPort, makeCandidate, spanOf } from "./fixtures.js";
import {
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  makeHit,
  ok,
  standardTexts,
} from "../pipeline/fakes.js";

/* ------------------------------------------------------------------------ *
 * The file: a witness record whose first line is its heading.
 * ------------------------------------------------------------------------ */

const HEADING = "TANIK BEYAN TUTANAĞI — Davacı Ahmet Yılmaz'ın işe girişi";
const TESTIMONY =
  "Tanık Mehmet Kaya: \"Davacı ile aynı işyerinde çalıştım. Davacı 01.03.2018 tarihinde işe " +
  "başladı; ben o tarihte vardiya amiriydim.\"";
const WITNESS_LIST = "TANIKLAR: Mehmet Kaya, Ayşe Demir, Ali Can";
const DISMISSAL =
  "Tanık Mehmet Kaya, işverenin davacıyı 15.01.2024 tarihinde sözlü olarak işten çıkardığını, " +
  "fesih sebebinin kendisine bildirilmediğini beyan etti.";
const TUTANAK = [HEADING, TESTIMONY, WITNESS_LIST, DISMISSAL].join("\n");

const PAYROLL_HEADING = "ÜCRET BORDROSU — DAVACI AHMET YILMAZ";
const WAGE_CLAIM = "Davacı, dava dilekçesinde net ücretinin yüksek olduğunu ve fazla mesai yaptığını iddia etmiştir.";
const WAGE_REPORT = "Bilirkişi raporuna göre davacının son net ücreti 32.000,00 TL'dir.";
const REPORT = [PAYROLL_HEADING, WAGE_CLAIM, WAGE_REPORT].join("\n");

const VERSION_TUTANAK = "docv-tutanak";
const VERSION_REPORT = "docv-bilirkisi";

function uploadCandidate(version: string, text: string, quote: string, score: number): AnswerCandidate {
  return makeCandidate({
    documentId: `doc-${version}`,
    documentVersionId: version,
    source: "UPLOAD",
    sourceUrl: "",
    title: "is_davasi_dosyasi.pdf",
    origin: "upload",
    score,
    ...spanOf(text, quote),
  });
}

async function draftOrder(question: string, candidates: AnswerCandidate[]): Promise<string[]> {
  const pack = await buildEvidencePack(
    candidates,
    new MapTextPort(new Map([[VERSION_TUTANAK, TUTANAK], [VERSION_REPORT, REPORT]])),
    { asOf: "2026-09-27", now: () => "2026-09-27T00:00:00Z" },
  );
  const claims = await new RuleBasedDrafter().draftClaims({ question, pack });
  return claims.map((claim) => pack.items.find((item) => `claim-${item.ref.evidenceId}` === claim.claimId)!.ref.quote);
}

/* ------------------------------------------------------------------------ */

describe("the question says which shape of value answers it", () => {
  it.each([
    ["Davacı işe ne zaman başladı?", "DATE"],
    ["Davacının işe giriş tarihi nedir?", "DATE"],
    ["İhtarname hangi tarihte tebliğ edildi?", "DATE"],
    ["Davacının son net ücreti ne kadardı?", "AMOUNT"],
    ["Davalı kaç TL ödedi?", "AMOUNT"],
    ["İtiraz süresi kaç gündür?", "DURATION"],
    ["Davacı işyerinde ne kadar süre çalıştı?", "DURATION"],
    ["TCK m. 157 dolandırıcılık suçunun cezası nedir?", "QUANTITY"],
    ["Kusur oranı nedir?", "QUANTITY"],
    ["Davacı vekili kimdir?", "PERSON"],
    ["Hangi mahkeme görevlidir?", "COURT"],
  ])("%s → %s", (question, wanted) => {
    expect(classifyWantedShape(question).wanted).toBe(wanted);
  });

  it.each([
    "Kıdem tazminatı nedir?",
    "Kira sözleşmesi haklı nedenle feshedilebilir mi?",
    "Hileli davranışlarla bir kimseyi aldatmak dolandırıcılık suçunu oluşturur mu?",
    "Tanık fesih hakkında ne söyledi?",
  ])("%s → NONE (no shape is checked, nothing is claimed)", (question) => {
    expect(classifyWantedShape(question).wanted).toBe("NONE");
  });

  it("reads only the ASKED sentence of a fact pattern", () => {
    // The narrative mentions a date and a court; the question asks a person.
    const question =
      "Müvekkil 01.03.2018 tarihinde işe başladı ve İstanbul 7. İş Mahkemesinde dava açtı. " +
      "Davalı şirketin yetkilisi kimdir?";
    expect(classifyWantedShape(question).wanted).toBe("PERSON");
  });

  it("is carried on the question-intent assessment as a separate axis", () => {
    const intent = classifyQuestionIntent("Davacı işe ne zaman başladı?", []);
    expect(intent.intent).toBe("APPLICATION");
    expect(intent.answerShape).toEqual({ wanted: "DATE", marker: "ne zaman" });
  });
});

describe("heading, label-only line and list of names are recognised", () => {
  it.each([
    HEADING,
    PAYROLL_HEADING,
    WITNESS_LIST,
    "CELSE TARİHİ : 14.05.2024",
    "DAVACI : Ahmet Yılmaz\nDAVALI : Kaya İnşaat A.Ş.\nKONU : İşçilik alacakları",
    "YARGITAY 9. HUKUK DAİRESİ E. 2023/1187 K. 2024/2356",
  ])("heading-like: %s", (passage) => {
    expect(isHeadingLike(passage)).toBe(true);
  });

  it.each([
    TESTIMONY,
    DISMISSAL,
    WAGE_REPORT,
    "Hileli davranışlarla bir kimseyi aldatıp, onun veya başkasının zararına olarak, kendisine veya başkasına bir yarar sağlayan kişiye bir yıldan beş yıla kadar hapis ve beşbin güne kadar adlî para cezası verilir.",
    "Ahmet Yılmaz, 01.03.2018 tarihinde davalı işyerinde işe başlamıştır.",
  ])("prose: %s", (passage) => {
    expect(isHeadingLike(passage)).toBe(false);
  });
});

describe("a passage carries the wanted shape only in a sentence with the question's core words", () => {
  it("the testimony carries the date; the heading does not", () => {
    const testimony = assessPassageShape("Davacı işe ne zaman başladı?", TESTIMONY);
    expect(testimony).toMatchObject({ wanted: "DATE", found: true, headingLike: false, matched: "01.03.2018" });
    const sentence = Array.from(TESTIMONY)
      .slice(testimony.sentence!.start, testimony.sentence!.end)
      .join("");
    expect(sentence).toContain("01.03.2018 tarihinde işe");

    expect(assessPassageShape("Davacı işe ne zaman başladı?", HEADING)).toEqual({
      wanted: "DATE",
      found: false,
      headingLike: true,
    });
  });

  it("a date on a label line of another event is not the date asked for", () => {
    // The W22 grid defect: the hearing record's header answered "işe giriş".
    expect(assessPassageShape("Davacının işe giriş tarihi nedir?", "CELSE TARİHİ : 14.05.2024").found).toBe(false);
    // … while the label line of THAT event is.
    expect(assessPassageShape("Davacının işe giriş tarihi nedir?", "İŞE GİRİŞ TARİHİ : 01.03.2019")).toMatchObject({
      found: true,
      matched: "01.03.2019",
    });
  });

  it("a cited decision's date answers 'when was it decided', never 'when did he start'", () => {
    const passage =
      "Yargıtay 9. Hukuk Dairesi'nin 12.03.2020 tarihli, 2019/1234 E., 2020/5678 K. sayılı kararında " +
      "işe başlama tarihinin tanık beyanıyla ispatlanabileceği belirtilmiştir.";
    expect(assessPassageShape("Davacı işe ne zaman başladı?", passage).found).toBe(false);
    expect(assessPassageShape("Yargıtay kararı ne zaman verildi?", passage)).toMatchObject({
      found: true,
      matched: "12.03.2020",
    });
  });

  it("the date that names a law is not the date of its entry into force", () => {
    const amending =
      "MADDE 1 - (1) 26/9/2004 tarihli ve 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci " +
      "fıkrasında yer alan ibare değiştirilmiştir.";
    expect(assessPassageShape("Ceza artıran değişikliğin yürürlük tarihi nedir?", amending).found).toBe(false);
    expect(
      assessPassageShape(
        "Ceza artıran değişikliğin yürürlük tarihi nedir?",
        "Bu Kanunun ceza artıran hükümleri 15/1/2026 tarihinde yürürlüğe girer.",
      ),
    ).toMatchObject({ found: true, matched: "15/1/2026" });
  });

  it("a norm answers 'ne zaman' with a relative time", () => {
    const passage =
      "Ödeme emrine itiraz, ödeme emrinin tebliğinden itibaren yedi gün içinde icra dairesine yapılır.";
    expect(assessPassageShape("Ödeme emrine itiraz ne zaman yapılır?", passage)).toMatchObject({
      wanted: "DATE",
      found: true,
    });
  });

  it("an amount answers 'ne kadar'; a claim without a figure does not", () => {
    expect(assessPassageShape("Davacının son net ücreti ne kadardı?", WAGE_REPORT)).toMatchObject({
      wanted: "AMOUNT",
      found: true,
      matched: "32.000,00 TL",
    });
    expect(assessPassageShape("Davacının son net ücreti ne kadardı?", WAGE_CLAIM).found).toBe(false);
  });

  it("a year is not a duration", () => {
    expect(
      assessPassageShape("Davacı işyerinde ne kadar süre çalıştı?", "Davacı işyerinde 2018 yılında çalışmaya başladı.").found,
    ).toBe(false);
    expect(
      assessPassageShape("Davacı işyerinde ne kadar süre çalıştı?", "Davacı işyerinde yaklaşık altı yıl çalışmıştır."),
    ).toMatchObject({ found: true, matched: "altı yıl" });
  });

  it("a 'kim' question naming a role wants a NAME, not another role word", () => {
    expect(
      assessPassageShape("Davacı vekili kimdir?", "Duruşmaya davacı vekili Av. Zeynep Arslan katıldı, davalı vekili gelmedi."),
    ).toMatchObject({ wanted: "PERSON", found: true });
    // "tanık" is a role word, not the name of davacı vekili.
    expect(assessPassageShape("Davacı vekili kimdir?", TESTIMONY).found).toBe(false);
  });

  it("a court question wants a court's name", () => {
    expect(
      assessPassageShape(
        "İşçilik alacağı davasında hangi mahkeme görevlidir?",
        "İşçi ile işveren arasındaki iş ilişkisinden doğan davalarda iş mahkemeleri görevlidir.",
      ),
    ).toMatchObject({ wanted: "COURT", found: true, matched: "iş mahkemeleri" });
  });

  it("checks nothing when the question asks for no shape", () => {
    expect(assessPassageShape("Kıdem tazminatı nedir?", TESTIMONY)).toEqual({
      wanted: "NONE",
      found: false,
      headingLike: false,
    });
  });
});

describe("rule 4: the rule-based drafter leads with the passage that carries the answer's shape", () => {
  it("the testimony stating the date leads, not the higher-scored heading (the W22 defect)", async () => {
    const order = await draftOrder("Davacı işe ne zaman başladı?", [
      uploadCandidate(VERSION_TUTANAK, TUTANAK, HEADING, 0.9),
      uploadCandidate(VERSION_TUTANAK, TUTANAK, TESTIMONY, 0.6),
    ]);
    expect(order).toEqual([TESTIMONY, HEADING]);
  });

  it("the report's figure leads an amount question; the payroll heading sinks last", async () => {
    const order = await draftOrder("Davacının son net ücreti ne kadardı?", [
      uploadCandidate(VERSION_REPORT, REPORT, PAYROLL_HEADING, 0.9),
      uploadCandidate(VERSION_REPORT, REPORT, WAGE_CLAIM, 0.8),
      uploadCandidate(VERSION_REPORT, REPORT, WAGE_REPORT, 0.5),
    ]);
    expect(order).toEqual([WAGE_REPORT, WAGE_CLAIM, PAYROLL_HEADING]);
  });

  it("with no shape asked, a list of names still never leads over prose", async () => {
    const order = await draftOrder("Tanık Mehmet Kaya fesih hakkında ne söyledi?", [
      uploadCandidate(VERSION_TUTANAK, TUTANAK, WITNESS_LIST, 0.9),
      uploadCandidate(VERSION_TUTANAK, TUTANAK, DISMISSAL, 0.4),
    ]);
    expect(order).toEqual([DISMISSAL, WITNESS_LIST]);
  });

  it("prose keeps the retrieval order among itself", async () => {
    const order = await draftOrder("Tanık Mehmet Kaya fesih hakkında ne söyledi?", [
      uploadCandidate(VERSION_TUTANAK, TUTANAK, TESTIMONY, 0.3),
      uploadCandidate(VERSION_TUTANAK, TUTANAK, DISMISSAL, 0.7),
    ]);
    expect(order).toEqual([DISMISSAL, TESTIMONY]);
  });

  it("rule 1 still wins: the provision the reader cited leads even without the shape", async () => {
    const text =
      "5237 sayılı Türk Ceza Kanunu\n" +
      "MADDE 158 - (1) Nitelikli dolandırıcılık hâlinde ceza üç yıldan on yıla kadar hapistir.\n" +
      "MADDE 157 - (2) Bu suçun soruşturulması ve kovuşturulması şikâyete bağlı değildir.";
    const common = {
      documentId: "doc-tck",
      documentVersionId: "docv-tck",
      source: "MEVZUAT",
      sourceUrl: "https://mevzuat.gov.tr/tck",
      title: "Türk Ceza Kanunu",
      legislationNo: "5237",
      effectiveFrom: "2005-06-01",
    };
    const pack = await buildEvidencePack(
      [
        makeCandidate({ ...common, article: "158", score: 0.9, ...spanOf(text, "Nitelikli dolandırıcılık hâlinde ceza üç yıldan on yıla kadar hapistir.") }),
        makeCandidate({ ...common, article: "157", score: 0.4, ...spanOf(text, "Bu suçun soruşturulması ve kovuşturulması şikâyete bağlı değildir.") }),
      ],
      new MapTextPort(new Map([["docv-tck", text]])),
      { asOf: "2025-06-01", now: () => "2026-09-27T00:00:00Z" },
    );
    const claims = await new RuleBasedDrafter().draftClaims({
      question: "TCK m. 157 dolandırıcılık suçunun cezası ne kadar?",
      pack,
    });
    const lead = pack.items.find((item) => `claim-${item.ref.evidenceId}` === claims[0]!.claimId)!;
    expect(lead.ref.locator.article).toBe("157");
  });
});

describe("a long passage's quote window keeps the value the question asks for", () => {
  it("prefers the window holding the date over one that only repeats the question's words", () => {
    const filler = " ".padEnd(40, "x");
    const quote =
      "Davacı işe başladı mı diye soruldu, davacı başladığını söyledi." +
      filler.replace(/x/gu, " ") +
      "Kayıtlara göre davacı 01.03.2018 tarihinde işe girmiştir.";
    const max = 70;
    const window = bestQuoteWindow(quote, max, "Davacı işe ne zaman başladı?");
    const shown = Array.from(quote).slice(window.start, window.end).join("");
    expect(shown).toContain("01.03.2018");
    // A question that asks for no shape keeps the old choice: the densest window.
    const plain = bestQuoteWindow(quote, max, "Davacı işe başladı mı?");
    expect(Array.from(quote).slice(plain.start, plain.end).join("")).toContain("davacı başladığını");
  });
});

/* ------------------------------------------------------------------------ *
 * The answer-level flag, through the real pipeline.
 * ------------------------------------------------------------------------ */

const UPLOAD_FILE = "0f1e2d3c4b5a6978";

function tutanakHit(chunkId: string, passage: string, fusedScore: number) {
  return makeHit({
    chunkId,
    documentId: "doc-tutanak",
    documentVersionId: VERSION_TUTANAK,
    text: TUTANAK,
    passage,
    title: "tanik_tutanagi.pdf",
    source: "UPLOAD",
    documentType: "tutanak",
    scope: "tenant",
    fusedScore,
  });
}

async function answer(question: string, hits: ReturnType<typeof tutanakHit>[]): Promise<AnswerResult> {
  const pipeline = new AnswerPipeline({
    retrieval: new StubCorpus(() => ok(hits)),
    texts: standardTexts(new Map([[VERSION_TUTANAK, TUTANAK]])),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
  });
  const { result } = await pipeline.answer({
    question,
    asOf: "2026-09-27",
    filters: { fileIds: [UPLOAD_FILE] },
  });
  return result;
}

describe("AnswerResult.answerShape and ANSWER_SHAPE_NOT_FOUND", () => {
  it("found: the lead claim is the testimony and the flag names the value and its sentence", async () => {
    const result = await answer("Davacı işe ne zaman başladı?", [
      tutanakHit("c-heading", HEADING, 0.09),
      tutanakHit("c-testimony", TESTIMONY, 0.05),
    ]);
    expect(result.claims.length).toBe(2);
    const lead = result.claims[0]!;
    const leadEvidence = result.evidence.find((e) => e.evidenceId === lead.evidenceIds[0])!;
    expect(leadEvidence.quote).toBe(TESTIMONY);

    expect(result.answerShape).toMatchObject({
      method: ANSWER_SHAPE_VERSION,
      wanted: "DATE",
      checked: true,
      found: true,
      leadClaimId: lead.claimId,
      evidenceId: leadEvidence.evidenceId,
      matched: "01.03.2018",
      messageTr: answerShapeFoundTr("DATE", "01.03.2018"),
    });
    // The span is the sentence, in canonical code points.
    const sentence = Array.from(TUTANAK)
      .slice(result.answerShape!.startChar!, result.answerShape!.endChar!)
      .join("");
    expect(sentence).toContain("01.03.2018 tarihinde işe");
    expect(lead.answerShape).toMatchObject({ wanted: "DATE", found: true, matched: "01.03.2018" });
    expect(result.claims[1]!.answerShape).toEqual({ wanted: "DATE", found: false, headingLike: true });
    expect(result.warnings.some((w) => w.startsWith(ANSWER_SHAPE_NOT_FOUND))).toBe(false);
    expect(result.markdown).not.toContain("CEVAP BİÇİMİ BULUNAMADI");
  });

  it("not found: a warning with the kind, a Turkish banner before the tespitler, and the status untouched", async () => {
    const result = await answer("Davacı işe ne zaman başladı?", [tutanakHit("c-heading", HEADING, 0.09)]);
    expect(result.claims.length).toBe(1);
    expect(result.answerShape).toMatchObject({
      wanted: "DATE",
      checked: true,
      found: false,
      headingLike: true,
      messageTr: answerShapeNotFoundTr("DATE"),
    });
    expect(result.warnings).toContain(`${ANSWER_SHAPE_NOT_FOUND}:DATE`);
    // A warning, never a verifier reason: the check changes no status.
    expect(result.reasons.some((r) => r.startsWith(ANSWER_SHAPE_NOT_FOUND))).toBe(false);
    expect(result.markdown).toContain("CEVAP BİÇİMİ BULUNAMADI");
    expect(result.markdown).toContain(
      "Soru bir tarih soruyor; öne çıkan alıntıda bu biçimde bir değer bulunamadı — alıntının soruyu " +
        "karşıladığı denetlenmedi, alıntıyı kendiniz okuyun. (ANSWER_SHAPE_NOT_FOUND)",
    );
    expect(result.markdown.indexOf("CEVAP BİÇİMİ BULUNAMADI")).toBeLessThan(result.markdown.indexOf("## Tespitler"));
  });

  it("not checked: a question that asks for no shape gets no warning and says it was not checked", async () => {
    const result = await answer("Tanık Mehmet Kaya fesih hakkında ne söyledi?", [
      tutanakHit("c-dismissal", DISMISSAL, 0.05),
    ]);
    expect(result.claims.length).toBe(1);
    expect(result.answerShape).toEqual({
      method: ANSWER_SHAPE_VERSION,
      wanted: "NONE",
      checked: false,
      found: null,
      leadClaimId: result.claims[0]!.claimId,
      messageTr: ANSWER_SHAPE_NOT_CHECKED_TR,
    });
    expect(result.claims[0]!.answerShape).toBeUndefined();
    expect(result.warnings.some((w) => w.startsWith(ANSWER_SHAPE_NOT_FOUND))).toBe(false);
  });

  it("an abstention carries the flag unchecked and no sentence", async () => {
    const result = await answer("Davacı işe ne zaman başladı?", []);
    expect(result.status).toBe("ABSTAIN");
    expect(result.answerShape).toEqual({ method: ANSWER_SHAPE_VERSION, wanted: "DATE", checked: false, found: null });
    expect(result.warnings.some((w) => w.startsWith(ANSWER_SHAPE_NOT_FOUND))).toBe(false);
  });
});

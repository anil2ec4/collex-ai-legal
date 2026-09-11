/**
 * The question-coverage gate (answer/coverage.ts), pinned without a database.
 *
 * Three layers, each tested on its own so a regression is reported where it
 * happened: the conservative Turkish stemmer, the lexeme matcher, and the
 * gate decision — including the exact shape of the audited failure
 * ("Kira sözleşmesinde depozito iadesi ne zaman yapılır?" led by TCK m.157)
 * and the multi-part question that union coverage exists for.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_COVERAGE_FLOOR,
  admitUnderReferenceBypass,
  admitUploadOnlyPassages,
  assessQuestionCoverage,
  classifyReferenceBypass,
  contentLexemes,
  decideCoverageGate,
  derivationalAlternate,
  evaluateQuestionCoverage,
  lexemesMatch,
  referenceBypass,
  stemTurkish,
} from "../../src/answer/coverage.js";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";

// Synthetic passages shaped like the fixture corpus (see evals/fixtures/corpus).
const YARGITAY_GEREKCE_SOZLESME =
  "Dolandırıcılık suçunun oluşabilmesi için hilenin, sözleşmenin kurulması " +
  "aşamasında ve mağduru aldatmaya elverişli nitelikte bulunması gerekir.";
const YARGITAY_OLAY_IADE =
  "Sanık, maliki olduğu ve fiilen mevcut bulunan aracı katılana satmayı kabul " +
  "etmiş, kapora olarak 25.000 TL almış, ancak daha sonra aracı teslim etmemiş " +
  "ve kaporayı da iade etmemiştir.";
const TCK_157 =
  "MADDE 157 - (1) Hileli davranışlarla bir kimseyi aldatıp, onun veya " +
  "başkasının zararına olarak, kendisine veya başkasına bir yarar sağlayan " +
  "kişiye üç yıldan yedi yıla kadar hapis ve on bin güne kadar adli para " +
  "cezası verilir.";
const TCK_158 =
  "MADDE 158 - (1) Dolandırıcılık suçunun; bilişim sistemlerinin, banka veya " +
  "kredi kurumlarının araç olarak kullanılması suretiyle işlenmesi halinde, üç " +
  "yıldan on yıla kadar hapis ve beş bin güne kadar adli para cezasına hükmolunur.";
const TORBA_M1 =
  'MADDE 1 - (1) 26/9/2004 tarihli ve 5237 sayılı Türk Ceza Kanununun 157 nci ' +
  'maddesinin birinci fıkrasında yer alan "bir yıldan beş yıla kadar" ibaresi ' +
  '"üç yıldan yedi yıla kadar" şeklinde değiştirilmiştir.';
const TORBA_M3 = "MADDE 3 - (1) Bu Kanun yayımı tarihinde yürürlüğe girer.";
const TBK_50 =
  "Uğranılan zararın miktarı tam olarak ispat edilemiyorsa hakim, olayların " +
  "olağan akışını ve zarar görenin aldığı önlemleri göz önünde tutarak, zararın " +
  "miktarını hakkaniyete uygun olarak belirler.";

describe("stemTurkish — conservative inflectional stripping", () => {
  it.each([
    ["iadesi", "iade"],
    ["sözleşmesinde", "sözleşme"],
    ["sözleşmenin", "sözleşme"],
    ["cezası", "ceza"],
    ["suçun", "suç"],
    ["suçunun", "suç"],
    ["tazminatı", "tazminat"],
    ["maddesinin", "madde"],
    ["kazasında", "kaza"],
    ["satışında", "satış"],
  ])("%s -> %s", (token, stem) => {
    expect(stemTurkish(token)).toBe(stem);
  });

  it("never strips a bare vowel below four code points ('kira' stays 'kira')", () => {
    expect(stemTurkish("kira")).toBe("kira");
    expect(stemTurkish("depozito")).toBe("depozito");
  });

  it("undoes final-consonant softening so 'aracı' meets 'araç'", () => {
    expect(stemTurkish("aracı")).toBe("araç");
    expect(stemTurkish("dolandırıcılığın")).toBe("dolandırıcılık");
    expect(stemTurkish("yürürlüğe")).toBe("yürürlük");
  });
});

describe("lexemesMatch — equality or a long shared prefix", () => {
  it("accepts inflections the stemmer leaves behind", () => {
    expect(lexemesMatch(stemTurkish("belirlenir"), stemTurkish("belirler"))).toBe(true);
    expect(lexemesMatch(stemTurkish("oluşturur"), stemTurkish("oluşturduğu"))).toBe(true);
    expect(lexemesMatch(stemTurkish("kiracı"), stemTurkish("kira"))).toBe(true);
    expect(lexemesMatch(stemTurkish("dolandırıcılığın"), stemTurkish("dolandırıcılık"))).toBe(true);
  });

  it("keeps derivational forms readable and matches them through an alternate", () => {
    // Displayed stems are inflection-only: no "dolandır", no "yürür".
    expect(stemTurkish("dolandırıcılık")).toBe("dolandırıcılık");
    expect(stemTurkish("sorumluluğu")).toBe("sorumluluk");
    expect(stemTurkish("değişikliği")).toBe("değişiklik");
    expect(derivationalAlternate("değişiklik")).toBe("değişik");
    expect(derivationalAlternate("kira")).toBeUndefined();
    expect(lexemesMatch(derivationalAlternate("değişiklik") as string, stemTurkish("değiştirilmiştir"))).toBe(true);
  });

  it("rejects short or merely similar-looking words", () => {
    expect(lexemesMatch("kanun", "kanıt")).toBe(false);
    expect(lexemesMatch("vergi", "veri")).toBe(false);
    expect(lexemesMatch("söz", "sözleşme")).toBe(false);
    expect(lexemesMatch("mal", "mahkeme")).toBe(false);
  });
});

describe("contentLexemes — what a question is ABOUT (shown as written)", () => {
  it("drops question frames, function words, numbers, references and legal frame words", () => {
    expect(contentLexemes("Kira sözleşmesinde depozito iadesi ne zaman yapılır?")).toEqual([
      "kira", "sözleşmesinde", "depozito", "iadesi",
    ]);
    expect(contentLexemes("TCK m. 157'de öngörülen hapis cezasının alt ve üst sınırı nedir?")).not.toContain("157");
    expect(contentLexemes("5237 sayılı Türk Ceza Kanunu m. 157 uyarınca dolandırıcılık suçunun cezası nedir?")).toEqual(
      ["ceza", "dolandırıcılık", "suçunun"],
    );
    expect(contentLexemes("Bu hüküm hangi hâlde uygulanır?")).toEqual([]);
    // Frame words are dropped in ANY inflection ("hukukunda"), law names too.
    expect(contentLexemes("Uzay hukukunda Türk kanununa göre")).toEqual(["uzay"]);
  });

  it("keeps substantive legal nouns (suç, ceza, tazminat, sorumluluk, karar)", () => {
    expect(contentLexemes("Haksız fiil sorumluluğunda tazminat ve karar")).toEqual([
      "haksız", "fiil", "sorumluluğunda", "tazminat", "karar",
    ]);
  });

  it("deduplicates by stem, keeping the first surface form", () => {
    expect(contentLexemes("kira, kiranın, kiraya")).toEqual(["kira"]);
  });
});

describe("assessQuestionCoverage", () => {
  it("THE AUDIT CASE: two passages that each share ONE word do not anchor the question", () => {
    const coverage = assessQuestionCoverage(
      "Kira sözleşmesinde depozito iadesi ne zaman yapılır?",
      [YARGITAY_GEREKCE_SOZLESME, YARGITAY_OLAY_IADE, TCK_157],
    );
    expect(coverage.lexemes).toEqual(["kira", "sözleşmesinde", "depozito", "iadesi"]);
    expect(coverage.covered).toEqual(["sözleşmesinde", "iadesi"]);
    expect(coverage.missing).toEqual(["kira", "depozito"]);
    expect(coverage.ratio).toBeCloseTo(0.5, 6);
    // Union coverage alone would pass the 0.4 floor — this is exactly why the
    // gate also needs a single passage to carry at least two lexemes.
    expect(coverage.bestPassageCovered).toBe(1);
    expect(decideCoverageGate(coverage)).toBe("failed");
  });

  it("a passage that answers the question passes", () => {
    const coverage = evaluateQuestionCoverage("Dolandırıcılık suçunun cezası nedir?", [
      TCK_157,
      TCK_158,
    ]);
    expect(coverage.covered).toEqual(["dolandırıcılık", "suçunun", "cezası"]);
    expect(coverage.bestPassageCovered).toBe(3);
    expect(coverage.gate).toBe("passed");
  });

  it("a multi-part question is covered by the UNION, anchored by one passage", () => {
    const coverage = evaluateQuestionCoverage(
      "Dolandırıcılık suçunun temel cezasını artıran torba kanun değişikliği hangisidir ve yürürlük tarihi nedir?",
      [TORBA_M1, TORBA_M3, TCK_158],
    );
    expect(coverage.covered).toEqual(
      expect.arrayContaining(["dolandırıcılık", "cezasını", "değişikliği", "yürürlük", "tarihi"]),
    );
    expect(coverage.missing).toEqual(expect.arrayContaining(["torba", "artıran"]));
    expect(coverage.ratio).toBeGreaterThanOrEqual(DEFAULT_COVERAGE_FLOOR);
    expect(coverage.bestPassageCovered).toBeGreaterThanOrEqual(2);
    expect(coverage.gate).toBe("passed");
  });

  it("an off-topic question stays uncovered even when a frame verb matches", () => {
    const coverage = evaluateQuestionCoverage(
      "Uzay hukukunda uydu çarpışmasında sorumluluk nasıl belirlenir?",
      [TBK_50, TCK_157],
    );
    expect(coverage.lexemes).toEqual(["uzay", "uydu", "çarpışmasında", "sorumluluk", "belirlenir"]);
    expect(coverage.missing).toEqual(expect.arrayContaining(["uzay", "uydu", "çarpışmasında"]));
    // "belirlenir" meets TBK m.50's "belirler" — one frame-ish verb, no anchor.
    expect(coverage.covered).toEqual(["belirlenir"]);
    expect(coverage.ratio).toBeLessThan(DEFAULT_COVERAGE_FLOOR);
    expect(coverage.gate).toBe("failed");
  });

  it("a word every passage carries weighs half (it did not discriminate)", () => {
    const question = "İzinsiz drone uçuşunun cezası nedir?";
    const generic = [TCK_157, TCK_158, TCK_157 + " (2)", TCK_158 + " (2)"];
    const four = assessQuestionCoverage(question, generic);
    const two = assessQuestionCoverage(question, generic.slice(0, 2));
    expect(two.covered).toEqual(["cezası"]);
    expect(two.ratio).toBeCloseTo(1 / 4, 6);
    // Four passages, all containing "ceza": weight 0.5 -> 0.5 / 3.5.
    expect(four.ratio).toBeCloseTo(0.5 / 3.5, 6);
    expect(four.ratio).toBeLessThan(two.ratio);
    expect(decideCoverageGate(four)).toBe("failed");
  });

  it("a one-word question fully covered by one passage passes", () => {
    const coverage = evaluateQuestionCoverage("Dolandırıcılık nedir?", [TCK_158]);
    expect(coverage.lexemes).toEqual(["dolandırıcılık"]);
    expect(coverage.bestPassageCovered).toBe(1);
    expect(coverage.gate).toBe("passed");
  });

  it("a question with no content lexemes, or no passages, fails closed", () => {
    expect(evaluateQuestionCoverage("Bu nedir?", [TCK_157]).gate).toBe("failed");
    expect(evaluateQuestionCoverage("Bu nedir?", [TCK_157]).ratio).toBe(0);
    expect(evaluateQuestionCoverage("Dolandırıcılık nedir?", []).gate).toBe("failed");
  });

  it("the floor is a parameter", () => {
    const coverage = assessQuestionCoverage("Dolandırıcılık suçunun cezası nasıl hesaplanır?", [TCK_158]);
    // 3 of 4 content lexemes (hesapla is missing).
    expect(coverage.ratio).toBeCloseTo(0.75, 6);
    expect(decideCoverageGate(coverage, { floor: 0.5 })).toBe("passed");
    expect(decideCoverageGate(coverage, { floor: 0.9 })).toBe("failed");
  });

  it("is deterministic", () => {
    const a = evaluateQuestionCoverage("Kira sözleşmesinde depozito iadesi ne zaman yapılır?", [TCK_157, YARGITAY_OLAY_IADE]);
    const b = evaluateQuestionCoverage("Kira sözleşmesinde depozito iadesi ne zaman yapılır?", [TCK_157, YARGITAY_OLAY_IADE]);
    expect(b).toEqual(a);
  });
});

describe("per-passage admission (W12-FIX)", () => {
  const Q = "TCK m. 157 uyarınca kira sözleşmesinde depozito iadesi ne zaman yapılır?";
  const DEPOZITO = "Kiracı, kira sözleşmesi sona erdiğinde depozitonun iadesini talep edebilir.";
  const DOLANDIRICILIK =
    "Dolandırıcılık suçunun bir sözleşme ilişkisi içinde işlenmesi hâlinde ceza artırılır.";

  it("under a bypass the pinned text is admitted by right; a one-word lexical hit is set aside", () => {
    const admission = admitUnderReferenceBypass(Q, [
      { quote: TCK_157, pinned: true },
      { quote: DOLANDIRICILIK, pinned: false },
      { quote: DEPOZITO, pinned: false },
    ]);
    expect(admission.admitted).toEqual([0, 2]);
    expect(admission.setAside).toEqual([1]);
  });

  it("a question with no content lexemes admits only the pinned text", () => {
    const admission = admitUnderReferenceBypass("TCK m. 157 nedir?", [
      { quote: TCK_157, pinned: true },
      { quote: DEPOZITO, pinned: false },
    ]);
    expect(admission.admitted).toEqual([0]);
    expect(admission.setAside).toEqual([1]);
  });

  it("the floor applies per passage", () => {
    // Four content lexemes (kira, sözleşme, depozito, iade); two shared = 0.5.
    const HALF = "Depozito, kira bedelinin üç katını aşamaz.";
    expect(admitUnderReferenceBypass(Q, [{ quote: HALF, pinned: false }], { floor: 0.9 }).setAside).toEqual([0]);
    expect(admitUnderReferenceBypass(Q, [{ quote: HALF, pinned: false }], { floor: 0.4 }).admitted).toEqual([0]);
  });

  it("over uploads alone, a passage sharing no content word is set aside; an empty question keeps all", () => {
    const admission = admitUploadOnlyPassages("Depozito ne zaman iade edildi?", [
      "DOSYA NO: 2026/123 E.",
      DEPOZITO,
    ]);
    expect(admission.admitted).toEqual([1]);
    expect(admission.setAside).toEqual([0]);
    expect(admitUploadOnlyPassages("Bu nedir?", ["DOSYA NO: 2026/123 E.", DEPOZITO]).setAside).toEqual([]);
  });
});

describe("referenceBypass — the reader asked for that text by name", () => {
  const refs = (question: string) => parseReferences(normalizeTurkishSearch(question));

  it("bypasses only when the question cites a provision AND the exact lane pinned a hit", () => {
    expect(referenceBypass(refs("TCK m. 157 cezası nedir?"), [{ pinned: true }])).toBe(true);
    expect(referenceBypass(refs("TCK m. 157 cezası nedir?"), [{ pinned: false }])).toBe(false);
    expect(referenceBypass(refs("TCK m. 157 cezası nedir?"), [])).toBe(false);
  });

  it("a pinned hit without a citation in the question is not a bypass", () => {
    expect(referenceBypass(refs("Kira depozitosu ne zaman iade edilir?"), [{ pinned: true }])).toBe(false);
  });

  it("an E./K. reference bypasses too", () => {
    const question = "Yargıtay 15. Ceza Dairesi E. 2023/4521 K. 2024/1187 sayılı kararında ne hükmedilmiştir?";
    expect(referenceBypass(refs(question), [{ pinned: true }])).toBe(true);
    expect(
      decideCoverageGate(assessQuestionCoverage(question, ["bambaşka bir metin"]), {
        referenceMatched: true,
      }),
    ).toBe("bypassed-by-reference");
  });
});

describe("B-07 · classifyReferenceBypass — article level vs a bare law name", () => {
  const refs = (question: string) => parseReferences(normalizeTurkishSearch(question));
  const pinned = [{ pinned: true }];

  it("a legislation number PLUS an article is article level", () => {
    expect(classifyReferenceBypass(refs("TCK m. 157 cezası nedir?"), pinned)).toBe("article");
    expect(
      classifyReferenceBypass(
        refs("6098 sayılı Türk Borçlar Kanunu m. 49 nedir?"),
        pinned,
      ),
    ).toBe("article");
  });

  it("an E./K. decision is article level", () => {
    expect(
      classifyReferenceBypass(
        refs("Yargıtay 15. CD E. 2023/4521 K. 2024/1187 kararı ne diyor?"),
        pinned,
      ),
    ).toBe("article");
  });

  it("a BARE law name is bare-law — the phrasing that broke the gate", () => {
    // These two are DAILYFLOW's own measured questions.
    expect(
      classifyReferenceBypass(
        refs("kira sozlesmesinde depozito iadesi ne zaman yapilir tbk ya gore"),
        pinned,
      ),
    ).toBe("bare-law");
    expect(
      classifyReferenceBypass(refs("TCK bakımından işyerinde mobbing suç mudur?"), pinned),
    ).toBe("bare-law");
    expect(
      classifyReferenceBypass(
        refs("7999 sayılı Kanun ile 6098 sayılı Kanunda hangi değişiklik yapılmıştır?"),
        pinned,
      ),
    ).toBe("bare-law");
  });

  it("no citation, or nothing pinned, is none", () => {
    expect(classifyReferenceBypass(refs("Depozito ne zaman iade edilir?"), pinned)).toBe("none");
    expect(classifyReferenceBypass(refs("TCK m. 157 cezası nedir?"), [{ pinned: false }])).toBe(
      "none",
    );
    expect(classifyReferenceBypass(refs("TCK'ya göre"), [])).toBe("none");
  });

  it("under a bare law the pinned statute earns no exemption", () => {
    // What the pipeline does with a bare-law bypass: pass pinned:false, so
    // every passage must anchor the question on its own.
    const question = "kira sozlesmesinde depozito iadesi ne zaman yapilir tbk ya gore";
    const passages = [
      { quote: "Kusurlu ve hukuka aykırı bir fiille başkasına zarar veren, bu zararı gidermekle yükümlüdür.", pinned: false },
      { quote: "Hâkim, tazminatın kapsamını ve ödenme biçimini durumun gereğini göz önüne alarak belirler.", pinned: false },
    ];
    expect(admitUnderReferenceBypass(question, passages).admitted).toEqual([]);
    // ...while an article-level pin still admits the named text by right.
    expect(
      admitUnderReferenceBypass(question, [{ ...passages[0] as { quote: string; pinned: boolean }, pinned: true }])
        .admitted,
    ).toEqual([0]);
  });
});

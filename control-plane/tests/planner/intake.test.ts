import { describe, expect, it } from "vitest";
import {
  analyzeIntake,
  CONCEPT_EXPANSIONS,
  MAX_CONCEPTUAL_ISSUES,
  MAX_ISSUES,
  validateResearchIntake,
} from "../../src/planner/intake.js";
import { makeIntake } from "./helpers.js";

describe("validateResearchIntake", () => {
  it("accepts a minimal valid intake and strips unknown fields", () => {
    const result = validateResearchIntake({
      question: "işe iade davası şartları",
      jurisdiction: "TR",
      dataClass: "L0",
      extraField: "ignored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intake.question).toBe("işe iade davası şartları");
      expect("extraField" in result.intake).toBe(false);
    }
  });

  it("accepts asOf and sourceScope when well-formed", () => {
    const result = validateResearchIntake({
      question: "kira tespit davası",
      jurisdiction: "TR",
      dataClass: "L0",
      asOf: "2026-01-15",
      sourceScope: ["caseLaw.search", "document.fetch"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intake.asOf).toBe("2026-01-15");
      expect(result.intake.sourceScope).toEqual(["caseLaw.search", "document.fetch"]);
    }
  });

  it.each([
    [{ question: "x", jurisdiction: "TR", dataClass: "L0" }, "question"],
    [{ question: "geçerli soru", jurisdiction: "DE", dataClass: "L0" }, "jurisdiction"],
    [{ question: "geçerli soru", jurisdiction: "TR", dataClass: "L1" }, "dataClass"],
    [
      { question: "geçerli soru", jurisdiction: "TR", dataClass: "L0", asOf: "2026-02-31" },
      "asOf",
    ],
    [
      { question: "geçerli soru", jurisdiction: "TR", dataClass: "L0", asOf: "15.01.2026" },
      "asOf",
    ],
    [
      {
        question: "geçerli soru",
        jurisdiction: "TR",
        dataClass: "L0",
        sourceScope: ["not.a.capability"],
      },
      "sourceScope",
    ],
  ])("rejects invalid intake %#", (input, expectedField) => {
    const result = validateResearchIntake(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain(expectedField);
    }
  });

  it("rejects non-object values", () => {
    expect(validateResearchIntake(null).ok).toBe(false);
    expect(validateResearchIntake("soru").ok).toBe(false);
  });
});

describe("analyzeIntake: issue extraction", () => {
  it("extracts an exact-reference issue with merged article from '5237 sayılı TCK m.157'", () => {
    const analysis = analyzeIntake(
      makeIntake("5237 sayılı TCK m.157 dolandırıcılık suçu hakkında güncel içtihat"),
    );
    const exact = analysis.issues.filter((i) => i.kind === "exact_reference");
    expect(exact).toHaveLength(1);
    expect(exact[0]?.reference?.legislationNo).toBe("5237");
    expect(exact[0]?.reference?.articleNo).toBe("157");
    expect(exact[0]?.label).toBe("5237 sayılı kanun madde 157");
  });

  it("expands conceptual issues with the statutory wording, not colloquial synonyms", () => {
    const analysis = analyzeIntake(makeIntake("dolandırıcılık nedeniyle açılan dava"));
    const conceptual = analysis.issues.find((i) => i.concept === "dolandırıcılık");
    expect(conceptual).toBeDefined();
    // TCK 157 speaks of "hileli davranış"; plain "hile" is TBK 36 (irade fesadı).
    expect(conceptual?.expandedTerms).toEqual([
      "dolandırıcılık",
      "hileli davranış",
      "menfaat temini",
      "nitelikli dolandırıcılık",
    ]);
    expect(conceptual?.expandedTerms).not.toContain("hile");
  });

  it("expands 'işe iade' with the elements the claim is actually decided on", () => {
    // "kıdem" is a different claim (kıdem tazminatı) and must not be an
    // expansion of an işe iade issue.
    expect(CONCEPT_EXPANSIONS["işe iade"]).toEqual([
      "işe iade",
      "feshin geçersizliği",
      "geçerli neden",
      "işe başlatmama tazminatı",
    ]);
    const analysis = analyzeIntake(makeIntake("İşe iade davasında arabuluculuk şartı"));
    const issue = analysis.issues.find((i) => i.concept === "işe iade");
    expect(issue?.expandedTerms).toContain("feshin geçersizliği");
    expect(issue?.expandedTerms).not.toContain("kıdem");
  });

  it("every expansion leads with the canonical term (round-1 query contract)", () => {
    for (const [concept, terms] of Object.entries(CONCEPT_EXPANSIONS)) {
      expect(terms[0], concept).toBe(concept);
      expect(terms.length, concept).toBeGreaterThanOrEqual(3);
      expect(new Set(terms).size, concept).toBe(terms.length);
    }
  });

  it("extracts a court-decision issue from an E./K. reference in the question", () => {
    const analysis = analyzeIntake(
      makeIntake("Yargıtay E. 2023/45, K. 2024/12 sayılı kararının kapsamı"),
    );
    const courtIssue = analysis.issues.find(
      (i) => i.reference?.kind === "court_decision",
    );
    expect(courtIssue).toBeDefined();
    expect(courtIssue?.reference?.docketNo).toBe("2023/45");
    expect(courtIssue?.reference?.decisionNo).toBe("2024/12");
  });

  it("falls back to a single conceptual issue when nothing matches", () => {
    const analysis = analyzeIntake(makeIntake("komşu ağacın dallarının kesilmesi"));
    expect(analysis.issues).toHaveLength(1);
    expect(analysis.issues[0]?.kind).toBe("conceptual");
    expect(analysis.issues[0]?.issueId).toBe("issue-1");
  });

  it("assigns deterministic sequential issue ids", () => {
    const q = "5237 sayılı TCK m.157 dolandırıcılık suçu";
    const a = analyzeIntake(makeIntake(q));
    const b = analyzeIntake(makeIntake(q));
    expect(a.issues.map((i) => i.issueId)).toEqual(b.issues.map((i) => i.issueId));
    expect(a.issues[0]?.issueId).toBe("issue-1");
  });

  it("bounds the issue list so one question cannot eat the whole step budget", () => {
    const analysis = analyzeIntake(
      makeIntake(
        "iş kazası sonrası tazminat, mobbing, nafaka, kira, ihale, hakaret ve" +
          " zamanaşımı ile boşanma ve velayet konularında içtihat",
      ),
    );
    expect(analysis.issues.length).toBeLessThanOrEqual(MAX_ISSUES);
    expect(
      analysis.issues.filter((i) => i.kind === "conceptual").length,
    ).toBeLessThanOrEqual(MAX_CONCEPTUAL_ISSUES);
    // The bound is deterministic. Ordering is MOST SPECIFIC FIRST (W16,
    // Şerit A): "iş kazası" names an institution and beats the single-word
    // remedies/defences in the same sentence, even though "zamanaşımı" is the
    // longer string. See tests/planner/conceptTable.test.ts for the rule
    // itself; here it only has to stay deterministic.
    expect(analysis.issues[0]?.concept).toBe("iş kazası");
  });

  it("named references outrank concepts when the cap bites", () => {
    const analysis = analyzeIntake(
      makeIntake(
        "6098 sayılı kanun ve 4721 sayılı kanun kapsamında tazminat, nafaka," +
          " kira ve boşanma",
      ),
    );
    const kinds = analysis.issues.map((i) => i.kind);
    expect(kinds.slice(0, 2)).toEqual(["exact_reference", "exact_reference"]);
    expect(analysis.issues.length).toBe(MAX_ISSUES);
  });
});

describe("analyzeIntake: temporal flags", () => {
  it("flags explicit date phrases and yürürlük terms", () => {
    const analysis = analyzeIntake(
      makeIntake("01.01.2024 tarihinde yürürlüğe giren değişiklik sonrası kira tespiti"),
    );
    expect(analysis.temporal.flagged).toBe(true);
    expect(analysis.temporal.phrases).toContain("01.01.2024");
    expect(analysis.temporal.phrases.some((p) => p.startsWith("yürürlü"))).toBe(true);
  });

  it("flags 'güncel' and carries asOf through", () => {
    const analysis = analyzeIntake(
      makeIntake("güncel içtihat durumu nedir", { asOf: "2026-06-01" }),
    );
    expect(analysis.temporal.flagged).toBe(true);
    expect(analysis.temporal.phrases).toContain("güncel");
    expect(analysis.temporal.asOf).toBe("2026-06-01");
  });

  it("does not flag a question without temporal phrases", () => {
    const analysis = analyzeIntake(makeIntake("kira sözleşmesinde depozito iadesi"));
    expect(analysis.temporal.flagged).toBe(false);
    expect(analysis.temporal.phrases).toHaveLength(0);
  });
});

describe("analyzeIntake: regulator hints", () => {
  it("detects KVKK terms", () => {
    const analysis = analyzeIntake(
      makeIntake("Açık rıza olmadan kişisel veri işlenmesi halinde KVKK yaptırımı"),
    );
    const kvkk = analysis.regulatorHints.find((h) => h.regulator === "KVKK");
    expect(kvkk).toBeDefined();
    expect(kvkk?.matchedTerms).toContain("kvkk");
    expect(kvkk?.matchedTerms).toContain("açık rıza");
  });

  it("detects ihale terms as a KIK hint", () => {
    const analysis = analyzeIntake(
      makeIntake("Kamu ihalesinde itirazen şikayet başvurusu süresi"),
    );
    expect(analysis.regulatorHints.some((h) => h.regulator === "KIK")).toBe(true);
  });

  it("orders hints deterministically by the fixed regulator order", () => {
    const analysis = analyzeIntake(
      makeIntake("İhale sürecinde kişisel veri paylaşımı ve açık rıza"),
    );
    const regs = analysis.regulatorHints.map((h) => h.regulator);
    expect(regs).toEqual(["KVKK", "KIK"]);
  });
});

describe("analyzeIntake: template markers", () => {
  it("recognises the Turkish divergence vocabulary as contrary markers", () => {
    for (const question of [
      "Bu konuda içtihadı birleştirme kararı var mı",
      "Yerel mahkemenin direnme kararı",
      "Kararda karşı oy gerekçesi ne diyor",
      "İçtihat aykırılığı bulunuyor mu",
    ]) {
      const analysis = analyzeIntake(makeIntake(question));
      expect(analysis.contraryMarkers.length, question).toBeGreaterThan(0);
    }
  });

  it("recognises AYM markers including bireysel başvuru", () => {
    const analysis = analyzeIntake(
      makeIntake("Bireysel başvuru yolunda hak ihlali iddiası"),
    );
    expect(analysis.aymMarkers).toContain("bireysel başvuru");
  });
});

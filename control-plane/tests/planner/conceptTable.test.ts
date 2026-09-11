/**
 * W16, Şerit A — the concept expansion table and the specificity ordering.
 *
 * Three things are pinned here and nowhere else:
 *  1. the SHAPE of the authored table (keys normalized, `terms[0]` is the key,
 *     anchors in citation form, an unknown anchor absent rather than guessed);
 *  2. the ORDERING rule for conceptual issues — most specific first — which is
 *     a deliberate behaviour change from "first occurrence in the question";
 *  3. that realistic lawyer questions actually land on the intended concepts,
 *     because a table nobody's question reaches is worth nothing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyzeIntake,
  CONCEPT_ANCHORS,
  CONCEPT_EXPANSIONS,
  CONCEPT_TABLE,
  MAX_CONCEPTUAL_ISSUES,
} from "../../src/planner/intake.js";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";
import { makeIntake } from "./helpers.js";

/** The concept keys a question produced, in the order the planner kept them. */
function conceptsOf(question: string): string[] {
  return analyzeIntake(makeIntake(question))
    .issues.filter((i) => i.kind === "conceptual")
    .map((i) => i.concept ?? i.label);
}

const INTAKE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/planner/intake.ts", import.meta.url)),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. Table shape
// ---------------------------------------------------------------------------

describe("CONCEPT_TABLE: shape", () => {
  it("covers the main areas of Turkish practice, not a demo handful", () => {
    // The 18-row table was the reason most everyday questions went to the
    // sources as raw text. 120 is the floor this lane was built to clear.
    expect(Object.keys(CONCEPT_TABLE).length).toBeGreaterThanOrEqual(120);
  });

  it("keeps every concept the planner already relied on (additive-only)", () => {
    // Removing a row silently changes what an existing question retrieves.
    for (const key of [
      "dolandırıcılık",
      "işe iade",
      "işçilik alacakları",
      "kişisel veri",
      "rekabet ihlali",
      "kamulaştırma",
      "tazminat",
      "nafaka",
      "kira",
      "ihale",
      "mobbing",
      "hakaret",
      "iş kazası",
      "boşanma",
      "velayet",
      "zamanaşımı",
      "ihtiyati tedbir",
      "görev uyuşmazlığı",
    ]) {
      expect(CONCEPT_TABLE[key], key).toBeDefined();
    }
  });

  it("every key is already in normalized tr-TR form", () => {
    for (const key of Object.keys(CONCEPT_TABLE)) {
      // A key that is not normalized can never match: `analyzeIntake` tests
      // `normalizeTurkishSearch(question).includes(key)`.
      expect(normalizeTurkishSearch(key), key).toBe(key);
    }
  });

  it("every expansion leads with the key and carries 3-6 distinct terms", () => {
    for (const [key, entry] of Object.entries(CONCEPT_TABLE)) {
      expect(entry.terms[0], key).toBe(key);
      expect(entry.terms.length, key).toBeGreaterThanOrEqual(3);
      expect(entry.terms.length, key).toBeLessThanOrEqual(6);
      expect(new Set(entry.terms).size, key).toBe(entry.terms.length);
      for (const term of entry.terms) {
        expect(term.trim(), key).toBe(term);
        expect(term.length, key).toBeGreaterThan(0);
      }
    }
  });

  it("no key is short enough to fire inside an unrelated word", () => {
    // The matcher is a plain substring test, so "çek" would fire inside
    // "gerçek" and "bono" inside "abonelik". These decoys must reach the
    // single fallback issue, i.e. match NO concept at all.
    for (const decoy of [
      "yağmur suyu giderleri kime ait",
      "gerçekten böyle bir belge var mı",
      "abonelik başvurusu nasıl yapılır",
      "komşu ağacın dallarının kesilmesi",
    ]) {
      const analysis = analyzeIntake(makeIntake(decoy));
      expect(analysis.issues, decoy).toHaveLength(1);
      expect(analysis.issues[0]?.concept, decoy).toBe(normalizeTurkishSearch(decoy));
    }
  });

  it("CONCEPT_EXPANSIONS is exactly the projection of CONCEPT_TABLE", () => {
    expect(Object.keys(CONCEPT_EXPANSIONS)).toEqual(Object.keys(CONCEPT_TABLE));
    for (const [key, entry] of Object.entries(CONCEPT_TABLE)) {
      expect(CONCEPT_EXPANSIONS[key], key).toEqual(entry.terms);
    }
  });

  it("says on its own face that it is a search table, not a legal dictionary", () => {
    // The sentence is a contract with the reader of the file: a term standing
    // in a row here is not a claim of legal equivalence.
    expect(INTAKE_SOURCE).toContain(
      "BU TABLO BİR HUKUK SÖZLÜĞÜ DEĞİLDİR, ARAMA GENİŞLETMESİDİR",
    );
    expect(INTAKE_SOURCE).toContain("HUKUKİ BİR EŞİTLİK İDDİASI DEĞİLDİR");
  });
});

// ---------------------------------------------------------------------------
// 2. Statutory anchors — a query aid that is never guessed
// ---------------------------------------------------------------------------

describe("CONCEPT_ANCHORS: statutory hooks", () => {
  const ANCHOR_RE =
    /^(?:\d{3,4} s\.K\.|TMK|TBK|TCK|TTK|HMK|CMK|İİK|VUK) (?:Geçici )?m\.\d{1,4}(?:\/[A-Za-z]+)?$/u;

  it("every anchor is a citation, not prose", () => {
    for (const [key, anchors] of Object.entries(CONCEPT_ANCHORS)) {
      expect(anchors.length, key).toBeGreaterThan(0);
      expect(new Set(anchors).size, key).toBe(anchors.length);
      for (const anchor of anchors) {
        expect(anchor, `${key}: ${anchor}`).toMatch(ANCHOR_RE);
      }
    }
  });

  it("a concept whose article number was not certain has NO anchors field", () => {
    // The honest gap, not an invented number: the field is absent, never an
    // empty array and never a placeholder. Same rule as the fee tariffs
    // (amount: null) and the coverage manifest (null, never 0).
    const withoutAnchors = Object.entries(CONCEPT_TABLE).filter(
      ([, entry]) => entry.anchors === undefined,
    );
    expect(withoutAnchors.length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(CONCEPT_TABLE)) {
      expect(entry.anchors, key).not.toEqual([]);
      if (entry.anchors === undefined) {
        expect(CONCEPT_ANCHORS[key], key).toBeUndefined();
      }
    }
  });

  it("carries the anchors a lawyer would open next onto the issue", () => {
    const kira = conceptsOf("İhtiyaç nedeniyle tahliye davası açabilir miyim?");
    expect(kira[0]).toBe("ihtiyaç nedeniyle tahliye");
    const issue = analyzeIntake(
      makeIntake("İhtiyaç nedeniyle tahliye davası açabilir miyim?"),
    ).issues[0];
    expect(issue?.anchors).toContain("TBK m.350");

    // An issue whose concept has no anchors simply has no field.
    const noAnchor = analyzeIntake(makeIntake("mobbing nedeniyle istifa")).issues[0];
    expect(noAnchor?.concept).toBe("mobbing");
    expect(noAnchor?.anchors).toBeUndefined();
  });

  it("an exact-reference issue never borrows a concept's anchors", () => {
    const analysis = analyzeIntake(makeIntake("6098 sayılı kanun madde 350"));
    const exact = analysis.issues.find((i) => i.kind === "exact_reference");
    expect(exact).toBeDefined();
    expect(exact?.anchors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Ordering: most specific first (behaviour change)
// ---------------------------------------------------------------------------

describe("conceptual issue ordering: most specific first", () => {
  it("the specific institution outranks the generic word it contains", () => {
    // The generic word is written FIRST in each of these sentences, which is
    // exactly what the old first-occurrence ordering rewarded.
    expect(
      conceptsOf("kira artışı uyuşmazlığında kira bedelinin tespiti nasıl yapılır")[0],
    ).toBe("kira bedelinin tespiti");
    expect(conceptsOf("tazminat isteyeceğiz, manevi tazminat da talep edilecek")[0]).toBe(
      "manevi tazminat",
    );
    expect(conceptsOf("ihale sürecinde ihaleye fesat karıştırma iddiası")[0]).toBe(
      "ihaleye fesat karıştırma",
    );
    expect(conceptsOf("nafaka davasında iştirak nafakası nasıl artırılır")[0]).toBe(
      "iştirak nafakası",
    );
    expect(
      conceptsOf("kamulaştırma dosyasında kamulaştırmasız el atma iddiası")[0],
    ).toBe("kamulaştırmasız el atma");
  });

  it("the generic word is kept, only demoted", () => {
    // Demoting is not dropping: the wide query still runs, just not first.
    const concepts = conceptsOf(
      "kira artışı uyuşmazlığında kira bedelinin tespiti nasıl yapılır",
    );
    expect(concepts).toContain("kira");
    expect(concepts.indexOf("kira")).toBeGreaterThan(
      concepts.indexOf("kira bedelinin tespiti"),
    );
  });

  it("word count decides before raw character length", () => {
    // "zamanaşımı" is the LONGER string (10 > 9) and is written first, but a
    // multi-word term names an institution while a single word is usually a
    // generic remedy or defence, so "iş kazası" leads.
    expect(conceptsOf("zamanaşımı dolmuş mu, iş kazası 2019 yılında oldu")[0]).toBe(
      "iş kazası",
    );
  });

  it("among equally specific concepts the lawyer's own order still wins", () => {
    // "rüşvet" and "tehdit" are both one word and six characters: the tie
    // falls back to first occurrence, so the sentence decides.
    expect(conceptsOf("rüşvet ve tehdit suçlaması")[0]).toBe("rüşvet");
    expect(conceptsOf("tehdit ve rüşvet suçlaması")[0]).toBe("tehdit");
  });

  it("is deterministic and still respects the conceptual cap", () => {
    const question =
      "İş kazası sonrası tazminat, kıdem tazminatı, zamanaşımı ve manevi tazminat";
    const first = conceptsOf(question);
    const second = conceptsOf(question);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(MAX_CONCEPTUAL_ISSUES);
    // Both multi-word institutions beat the bare "tazminat" into the cap.
    expect(first).toContain("kıdem tazminatı");
    expect(first).toContain("manevi tazminat");
    expect(first).not.toContain("tazminat");
  });

  it("named references still outrank every concept", () => {
    const kinds = analyzeIntake(
      makeIntake(
        "6098 sayılı kanun ve 4721 sayılı kanun kapsamında kira bedelinin tespiti",
      ),
    ).issues.map((i) => i.kind);
    expect(kinds.slice(0, 2)).toEqual(["exact_reference", "exact_reference"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Real questions reach real concepts
// ---------------------------------------------------------------------------

describe("everyday lawyer questions land on the intended concepts", () => {
  const CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
    [
      "İşçim iki yıl çalıştı, kıdem tazminatı ve fazla mesai alacağı için ne yapmalıyım?",
      ["kıdem tazminatı", "fazla mesai"],
    ],
    [
      "Müvekkilim iş kazası geçirdi, işverenin sorumluluğu ne olur?",
      ["iş kazası"],
    ],
    [
      "Kiracı üç aydır ödemiyor, temerrüt nedeniyle tahliye mümkün mü?",
      ["temerrüt nedeniyle tahliye", "kira"],
    ],
    [
      "Ev sahibi ihtiyaç nedeniyle tahliye davası açtı, samimiyet nasıl ispatlanır?",
      ["ihtiyaç nedeniyle tahliye"],
    ],
    [
      "Babam evi kardeşime devretmiş; muris muvazaası nedeniyle tapu iptali ve tescil isteyebilir miyiz?",
      ["muris muvazaası", "tapu iptali ve tescil"],
    ],
    ["Mirasın reddi süresi geçtiyse hükmen ret mümkün mü?", ["mirasın reddi"]],
    [
      "Anlaşmalı boşanma protokolünde iştirak nafakası nasıl belirlenir?",
      ["boşanma", "iştirak nafakası"],
    ],
    [
      "Velayet bende; babanın kişisel ilişki kurulması talebine itiraz edebilir miyim?",
      ["velayet", "kişisel ilişki kurulması"],
    ],
    [
      "İtirazın iptali davasında icra inkar tazminatı şartları nelerdir?",
      ["itirazın iptali"],
    ],
    [
      "Haczedilen eşya üçüncü kişiye ait, istihkak davası nasıl açılır?",
      ["istihkak davası"],
    ],
    [
      "Ayıplı mal nedeniyle tüketici hakem heyetine başvurdum, karara itiraz edebilir miyim?",
      ["ayıplı mal", "tüketici hakem heyeti"],
    ],
    [
      "Şirketin genel kurul kararının iptali için süre ne kadar?",
      ["genel kurul kararının iptali"],
    ],
    [
      "Karşılıksız çek nedeniyle verilen yasak kararına itiraz edilebilir mi?",
      ["karşılıksız çek"],
    ],
    [
      "Trafik kazası sonrası değer kaybı için sigortacıya başvuru şart mı?",
      ["trafik kazası", "değer kaybı"],
    ],
    [
      "Müvekkilim hakkında görevi kötüye kullanma iddiasıyla soruşturma açıldı",
      ["görevi kötüye kullanma"],
    ],
    [
      "Hükmün açıklanmasının geri bırakılması kararına itiraz süresi nedir?",
      ["hükmün açıklanmasının geri bırakılması"],
    ],
    [
      "İdari işlemin iptali istemiyle açtığımız davada yürütmenin durdurulması talebi reddedildi",
      ["yürütmenin durdurulması"],
    ],
    [
      "Açık rıza olmadan kişisel veri işlendi; veri ihlali bildirimi yapılmalı mı?",
      ["veri ihlali bildirimi", "kişisel veri", "açık rıza"],
    ],
    [
      "İhalede aşırı düşük teklif açıklaması yeterli görülmedi, itirazen şikayet başvurusu yapacağız",
      ["aşırı düşük teklif", "itirazen şikayet"],
    ],
    [
      "Kamulaştırmasız el atma nedeniyle bedel davası açabilir miyiz?",
      ["kamulaştırmasız el atma", "kamulaştırma"],
    ],
    [
      "Vergi ziyaı cezası kesildi, ödeme emrine itiraz süresi kaç gün?",
      ["vergi ziyaı cezası", "ödeme emrine itiraz"],
    ],
    [
      "Tanık dinletmek için delil tespiti isteyebilir miyim; bilirkişi raporuna itiraz süresi nedir?",
      ["bilirkişi raporuna itiraz", "delil tespiti"],
    ],
  ];

  it("has at least fifteen realistic questions on the list", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CASES)("%s", (question, expected) => {
    const concepts = conceptsOf(question);
    for (const concept of expected) {
      expect(concepts, question).toContain(concept);
    }
    // Nothing here may fall back to the raw question: that is the failure the
    // 18-row table produced for almost every everyday question.
    expect(concepts, question).not.toContain(normalizeTurkishSearch(question));
  });
});

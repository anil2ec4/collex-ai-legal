/**
 * W14/B-38 — Turkish short-form (anaphoric) citations.
 *
 * The cross-language pin lives in `evals/fixtures/reference_parity.json` and is
 * asserted by `tests/parser-parity.test.ts` (TypeScript) and
 * `tests/contracts/test_parser_parity.py` (Python) — eight new `short_form`
 * cases, both runtimes, one fixture. THIS file asserts the behaviour that a
 * fixture cannot express: that an unresolved short form is a distinguishable
 * "belirsiz" bucket, and that recognizing short forms did not change what the
 * parser does with ordinary text.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isUnresolvedShortForm,
  parseReferences,
  SHORT_FORM_KIND,
  type ParsedReference,
} from "../../src/retrieval/referenceParser.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "evals",
  "fixtures",
  "reference_parity.json",
);

interface FixtureCase {
  name: string;
  group: string;
  text: string;
  expected: Array<{ kind: string }>;
}

const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  cases: FixtureCase[];
};

describe("B-38 short forms resolve from context", () => {
  it("resolves a repeated bare article number to the law named earlier", () => {
    const refs = parseReferences(
      "TBK m. 315 uyarınca ihtar çekilmiştir. Aynı Kanunun 352 nci maddesi de " +
        "uygulanır. Sonradan m. 352 tekrar tartışılmıştır.",
    );
    const shortForms = refs.filter((r) => r.kind === SHORT_FORM_KIND);
    expect(shortForms).toHaveLength(2);
    for (const ref of shortForms) {
      expect(ref.articleNo).toBe("352");
      expect(ref.legislationNo).toBe("6098");
      expect(ref.canonicalName).toBe("Türk Borçlar Kanunu");
      expect(isUnresolvedShortForm(ref)).toBe(false);
    }
    // The FIRST citation of an article stays a full article reference.
    const articles = refs.filter((r) => r.kind === "article");
    expect(articles.map((a) => a.articleNo)).toEqual(["315"]);
  });

  it("keeps 'yukarıda anılan TBK m. 315' a complete citation", () => {
    const refs = parseReferences("Yukarıda anılan TBK m. 315 hükmü uygulanır.");
    expect(refs.map((r) => r.kind)).toEqual(["legislation", "article"]);
    expect(refs[0]?.legislationNo).toBe("6098");
    expect(refs[1]?.articleNo).toBe("315");
  });

  it("carries the antecedent decision's identity onto 'anılan karar'", () => {
    const refs = parseReferences(
      "Yargıtay 3. HD E. 2021/123, K. 2022/456 kararı incelendi. " +
        "Anılan karar ile aynı yönde başka kararlar da vardır.",
    );
    const shortForms = refs.filter((r) => r.kind === SHORT_FORM_KIND);
    expect(shortForms).toHaveLength(2);
    expect(shortForms[0]?.docketNo).toBe("2021/123");
    expect(shortForms[0]?.decisionNo).toBe("2022/456");
    expect(shortForms[0]?.court).toBe("YARGITAY");
    expect(shortForms[0]?.chamber).toBe("3. HD");
    expect(shortForms.every((r) => !isUnresolvedShortForm(r))).toBe(true);
  });
});

describe("B-38 the 'belirsiz' bucket", () => {
  const unresolvable: Array<[string, string]> = [
    ["a bare back-reference", "Anılan kararda belirtildiği üzere zamanaşımı işlemez."],
    ["the agk. abbreviation", "agk. uyarınca istem reddedilmiştir."],
    ["an anaphoric article", "Mezkûr Yönetmeliğin 12 nci maddesi uygulanır."],
  ];

  for (const [label, text] of unresolvable) {
    it(`marks ${label} as unresolved instead of inventing a citation`, () => {
      const refs = parseReferences(text);
      expect(refs.length).toBeGreaterThan(0);
      const shortForms = refs.filter((r) => r.kind === SHORT_FORM_KIND);
      expect(shortForms.length).toBeGreaterThan(0);
      for (const ref of shortForms) {
        expect(isUnresolvedShortForm(ref)).toBe(true);
        expect(ref.legislationNo).toBeUndefined();
        expect(ref.docketNo).toBeUndefined();
        expect(ref.decisionNo).toBeUndefined();
        expect(ref.canonicalName).toBeUndefined();
      }
      // Nothing in the text was promoted to a full citation.
      expect(refs.some((r) => r.kind === "legislation")).toBe(false);
      expect(refs.some((r) => r.kind === "court_decision")).toBe(false);
    });
  }

  it("classifies a resolved short form as resolved, and nothing else as a short form", () => {
    const resolved: ParsedReference = {
      kind: SHORT_FORM_KIND,
      raw: "Anılan karar",
      docketNo: "2021/1",
      span: [0, 12],
    };
    expect(isUnresolvedShortForm(resolved)).toBe(false);
    expect(isUnresolvedShortForm({ kind: "article", raw: "m. 1" })).toBe(false);
  });
});

describe("B-38 a restated instrument is never an anaphor", () => {
  it("keeps every 'TCK m. 157' a full article citation, however often it repeats", () => {
    const refs = parseReferences("TCK m. 157 … TCK m. 157 … TCK'nın 157. maddesi");
    expect(refs.filter((r) => r.kind === SHORT_FORM_KIND)).toEqual([]);
    expect(refs.filter((r) => r.kind === "article")).toHaveLength(3);
    expect(refs.filter((r) => r.kind === "legislation")).toHaveLength(3);
  });

  it("is a LOCAL decision, so a per-block parse equals a whole-text parse", () => {
    // The invariant `intake/analysis.py::_parse_references_blockwise` relies
    // on: ownership depends only on the ~16 characters before the article, so
    // splitting the text between sentences cannot change a single kind.
    const sentence =
      "Sanık TCK m. 157 uyarınca Yargıtay 9. Hukuk Dairesi'nin E. 2021/123," +
      " K. 2022/456 sayılı kararı doğrultusunda cezalandırılmıştır. ";
    const whole = parseReferences(sentence.repeat(6));
    const perBlock = Array.from({ length: 6 }, () => parseReferences(sentence));
    expect(whole.map((r) => r.kind)).toEqual(
      perBlock.flatMap((refs) => refs.map((r) => r.kind)),
    );
    expect(whole.some((r) => r.kind === SHORT_FORM_KIND)).toBe(false);
  });
});

describe("B-38 does not disturb ordinary text", () => {
  it("finds nothing in prose that merely uses the marker WORDS", () => {
    expect(
      parseReferences("Taraflar aynı görüşte değildir; mahkeme karar verecektir."),
    ).toEqual([]);
  });

  it("leaves every pre-existing fixture group free of short forms", () => {
    for (const testCase of FIXTURE.cases.filter((c) => c.group !== "short_form")) {
      const kinds = parseReferences(testCase.text).map((r) => r.kind);
      expect(kinds, testCase.name).not.toContain(SHORT_FORM_KIND);
    }
  });

  it("pins the fixture's short-form corpus so it cannot be quietly dropped", () => {
    const shortFormCases = FIXTURE.cases.filter((c) => c.group === "short_form");
    expect(shortFormCases.length).toBeGreaterThanOrEqual(8);
    const withShortForms = shortFormCases.filter((c) =>
      c.expected.some((e) => e.kind === SHORT_FORM_KIND),
    );
    expect(withShortForms.length).toBeGreaterThanOrEqual(5);
  });
});

import { describe, expect, it } from "vitest";
import {
  LAW_ABBREVIATIONS,
  lookupAbbreviation,
  lookupByNumber,
  parseReferences,
} from "../src/retrieval/referenceParser.js";
import { normalizeTurkishSearch } from "../src/retrieval/normalize.js";

const kinds = (text: string, kind: string) =>
  parseReferences(text).filter((r) => r.kind === kind);

describe("parseReferences: legislation", () => {
  it("parses '6698 sayılı ... Kanunu'", () => {
    const refs = parseReferences(
      "6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca işlem yapılır.",
    );
    const law = refs.find((r) => r.kind === "legislation");
    expect(law).toBeDefined();
    expect(law?.legislationNo).toBe("6698");
  });

  it("keeps the WHOLE law name, Turkish letters included", () => {
    // Regression: the old `[^,.;]+?` capture with an ASCII-only `\b` stopped
    // at the first non-ASCII letter and produced "5237 sayılı T".
    const law = parseReferences("5237 sayılı Türk Ceza Kanunu uyarınca").find(
      (r) => r.kind === "legislation",
    );
    expect(law?.raw).toBe("5237 sayılı Türk Ceza Kanunu");
    expect(law?.name).toBe("Türk Ceza Kanunu");
  });

  it("parses law numbers of 1-5 digits when a law-type word follows", () => {
    expect(
      parseReferences("657 sayılı Kanun kapsamında").some(
        (r) => r.kind === "legislation" && r.legislationNo === "657",
      ),
    ).toBe(true);
    // "2 sayılı liste" is an annex, not a law.
    expect(
      parseReferences("Ekli 2 sayılı listede gösterilen kadrolar").some(
        (r) => r.kind === "legislation",
      ),
    ).toBe(false);
  });

  it("accepts 's.' as the short form of 'sayılı'", () => {
    const law = parseReferences("6098 s. TBK m. 49").find((r) => r.kind === "legislation");
    expect(law?.legislationNo).toBe("6098");
    expect(law?.abbreviation).toBe("TBK");
  });

  it("prefers the EXPLICIT number over the abbreviation and flags mülga", () => {
    const law = parseReferences("765 sayılı TCK'nın 480. maddesi").find(
      (r) => r.kind === "legislation",
    );
    expect(law?.legislationNo).toBe("765");
    expect(law?.mulga).toBe(true);
  });
});

describe("parseReferences: abbreviations", () => {
  it("resolves the abbreviations lawyers actually type", () => {
    const cases: Array<[string, string, string]> = [
      ["TCK m. 157", "5237", "157"],
      ["TBK 49", "6098", "49"],
      ["İİK 89", "2004", "89"],
      ["HMK 177", "6100", "177"],
      ["CMK 100", "5271", "100"],
      ["TMK 706", "4721", "706"],
      ["TTK 5/A", "6102", "5/A"],
      ["VUK 359", "213", "359"],
      ["KVKK m. 9", "6698", "9"],
    ];
    for (const [text, no, article] of cases) {
      const refs = parseReferences(text);
      expect(
        refs.find((r) => r.kind === "legislation")?.legislationNo,
        text,
      ).toBe(no);
      expect(refs.find((r) => r.kind === "article")?.articleNo, text).toBe(article);
    }
  });

  it("handles inflected and dotted/dotless spellings", () => {
    for (const text of [
      "TCK'nın 157. maddesi",
      "TCK'nin 157. maddesi",
      "TCK'nun 157. maddesi",
    ]) {
      expect(
        parseReferences(text).find((r) => r.kind === "legislation")?.legislationNo,
        text,
      ).toBe("5237");
    }
    for (const text of ["İİK'nun 89. maddesi", "IIK 89. maddesi", "İIK 89. maddesi"]) {
      expect(
        parseReferences(text).find((r) => r.kind === "legislation")?.legislationNo,
        text,
      ).toBe("2004");
    }
  });

  it("maps 'Anayasa' to 2709 but NEVER 'Anayasa Mahkemesi'", () => {
    expect(
      parseReferences("Anayasa'nın 36'ncı maddesi").find((r) => r.kind === "legislation")
        ?.legislationNo,
    ).toBe("2709");
    expect(kinds("Anayasa Mahkemesi kararı bağlayıcıdır.", "legislation")).toHaveLength(0);
  });

  it("does not read a year as an article number ('TCK 2005')", () => {
    expect(kinds("TCK 2005 yılında yürürlüğe girdi.", "article")).toHaveLength(0);
  });

  it("prefers the longer abbreviation (KVKK over KVK)", () => {
    const refs = kinds("KVKK ve KVK farklı kanunlardır.", "legislation");
    expect(refs.map((r) => r.legislationNo)).toEqual(["6698", "5520"]);
  });

  it("exposes a lookup API keyed by written form and by number", () => {
    expect(lookupAbbreviation("TCK'nın")?.legislationNo).toBe("5237");
    expect(lookupAbbreviation("iik")?.legislationNo).toBe("2004");
    expect(lookupAbbreviation("bilinmeyen")).toBeUndefined();
    expect(lookupByNumber("1086")?.mulga).toBe(true);
    expect(lookupByNumber(undefined)).toBeUndefined();
  });

  it("never maps 'bk.' (= bakınız) to the Borçlar Kanunu", () => {
    expect(LAW_ABBREVIATIONS.some((e) => e.variants.includes("BK"))).toBe(false);
    expect(kinds("bk. yukarıdaki açıklamalar", "legislation")).toHaveLength(0);
  });
});

describe("parseReferences: articles", () => {
  it("parses 'madde 5', 'md. 2' and 'm. 112'", () => {
    expect(parseReferences("TBK m. 112 uyarınca")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "112" }),
    );
    expect(parseReferences("TMK md. 2 dürüstlük kuralı")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "2" }),
    );
    expect(parseReferences("Anayasa madde 36")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "36" }),
    );
  });

  it("parses lettered article numbers like 6/A", () => {
    expect(parseReferences("5651 sayılı Kanun m. 8/A kapsamında")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "8/A" }),
    );
    expect(parseReferences("Kanunun 6/A maddesi uygulanır")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "6/A" }),
    );
  });

  it("reads 'madde 25/II' as madde 25 fıkra II (not article '25/I')", () => {
    // Regression: the old ARTICLE_RE `[A-ZÇĞİÖŞÜ]` class matched only the
    // first Roman letter and reported articleNo "25/I".
    expect(parseReferences("madde 25/II")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "25", paragraph: "II" }),
    );
  });

  it("splits fıkra and bent out of 'm.6/1-a'", () => {
    expect(parseReferences("m.6/1-a")).toContainEqual(
      expect.objectContaining({
        kind: "article",
        articleNo: "6",
        paragraph: "1",
        clause: "a",
      }),
    );
  });

  it("parses suffix forms including '91/1. maddesi' and ordinals", () => {
    expect(parseReferences("91/1. maddesi")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "91", paragraph: "1" }),
    );
    expect(parseReferences("157 nci maddesi")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "157" }),
    );
    expect(parseReferences("157'nci maddesinin birinci fıkrası")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "157", paragraph: "1" }),
    );
  });

  it("parses ek / geçici articles without double counting them", () => {
    expect(parseReferences("Kanuna ek madde 5 eklenmiştir.")).toEqual([
      expect.objectContaining({ kind: "article", articleNo: "5", articleKind: "ek" }),
    ]);
    expect(parseReferences("geçici 11 inci maddesi")).toEqual([
      expect.objectContaining({ kind: "article", articleNo: "11", articleKind: "geçici" }),
    ]);
  });

  it("does NOT treat metres as articles ('5 m. 20 cm')", () => {
    expect(kinds("duvar 5 m. 20 cm yüksekliğindeydi", "article")).toHaveLength(0);
  });

  it("does NOT match 'm.' glued to the end of another word ('adam. 3')", () => {
    expect(kinds("olay yerindeki adam. 3 gün sonra dinlendi", "article")).toHaveLength(0);
  });

  it("does NOT treat a bare count as a reference ('ek 3 madde')", () => {
    expect(parseReferences("Teklifle kanuna ek 3 madde eklenmesi önerildi.")).toEqual([]);
  });

  it("still matches 'madde' right after a number (enumerations)", () => {
    expect(parseReferences("kararın 2. sayfasında madde 5 tartışılmıştır")).toContainEqual(
      expect.objectContaining({ kind: "article", articleNo: "5" }),
    );
  });
});

describe("parseReferences: court decisions (E/K)", () => {
  it("parses 'E. 2023/45, K. 2024/12' with the deciding chamber", () => {
    expect(parseReferences("Yargıtay 1. HD E. 2023/45, K. 2024/12 sayılı kararı")).toContainEqual(
      expect.objectContaining({
        kind: "court_decision",
        docketNo: "2023/45",
        decisionNo: "2024/12",
        year: 2023,
        court: "YARGITAY",
        chamber: "1. HD",
      }),
    );
  });

  it("parses compact 'E.2021/100 K.2022/5' and the T. date", () => {
    expect(parseReferences("E.2021/100 K.2022/5 T.12.05.2022")).toContainEqual(
      expect.objectContaining({
        kind: "court_decision",
        docketNo: "2021/100",
        decisionNo: "2022/5",
        decisionDate: "12.05.2022",
      }),
    );
  });

  it("parses the suffix style '2021/123 E., 2022/456 K.'", () => {
    expect(parseReferences("2021/123 E., 2022/456 K.")).toContainEqual(
      expect.objectContaining({ docketNo: "2021/123", decisionNo: "2022/456" }),
    );
  });

  it("parses Yargıtay HGK/CGK hyphenated dockets", () => {
    expect(parseReferences("Yargıtay HGK 2017/9-1234 E., 2019/456 K.")).toContainEqual(
      expect.objectContaining({
        docketNo: "2017/9-1234",
        decisionNo: "2019/456",
        court: "YARGITAY",
        chamber: "HGK",
      }),
    );
  });

  it("parses AYM bireysel başvuru numbers", () => {
    expect(parseReferences("AYM Genel Kurulu B. No: 2019/12345")).toContainEqual(
      expect.objectContaining({
        docketNo: "2019/12345",
        court: "AYM",
        chamber: "GENEL KURUL",
        docketKind: "basvuru",
      }),
    );
  });

  it("disambiguates identical E./K. pairs by chamber", () => {
    const a = parseReferences("Yargıtay 9. HD E. 2020/1, K. 2021/2")[0];
    const b = parseReferences("Yargıtay 4. CD E. 2020/1, K. 2021/2")[0];
    expect(a?.docketNo).toBe(b?.docketNo);
    expect(a?.chamber).toBe("9. HD");
    expect(b?.chamber).toBe("4. CD");
  });

  it("does not match a docket without a decision number", () => {
    expect(kinds("E. 2023/45 sayılı dosya", "court_decision")).toHaveLength(0);
  });

  it("rejects implausible docket years", () => {
    expect(parseReferences("E. 9999/1, K. 8888/2")).toEqual([]);
  });

  it("never reads 'K. 2021/5678 sayılı kararı' as legislation 5678", () => {
    // Regression: the old LAW_RE happily produced legislationNo "5678" here.
    expect(parseReferences("K. 2021/5678 sayılı kararı incelendi.")).toEqual([]);
  });
});

describe("parseReferences: official gazette", () => {
  it("parses the RG date and issue number", () => {
    expect(
      parseReferences("26/9/2004 tarihli ve 25611 sayılı Resmî Gazete'de yayımlandı."),
    ).toEqual([
      expect.objectContaining({
        kind: "official_gazette",
        rgDate: "26/9/2004",
        rgNo: "25611",
        year: 2004,
      }),
    ]);
  });

  it("never reads an RG issue number as a law number", () => {
    // Regression: "25611 sayılı Resmî Gazete" used to yield legislation 25611.
    expect(parseReferences("25611 sayılı Resmî Gazete'de yayımlandı.")).toEqual([]);
  });
});

describe("parseReferences: robustness", () => {
  it("returns [] for empty and irrelevant text", () => {
    expect(parseReferences("")).toEqual([]);
    expect(parseReferences("bugün hava çok güzel")).toEqual([]);
  });

  it("ignores personal initials", () => {
    expect(parseReferences("M. Kemal 1923 yılında Cumhuriyeti kurdu.")).toEqual([]);
    expect(parseReferences("Raporu E. Yılmaz ve K. Demir hazırladı.")).toEqual([]);
  });

  it("is re-entrant (global regexes keep no state between calls)", () => {
    const text = "TBK m. 112 ve 6098 sayılı Kanun";
    expect(parseReferences(text)).toEqual(parseReferences(text));
  });

  it("returns references sorted by position with spans that slice back", () => {
    const text = "TCK m. 157 ve 6098 sayılı Türk Borçlar Kanununun 49 uncu maddesi";
    const refs = parseReferences(text);
    const starts = refs.map((r) => r.span?.[0] ?? 0);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (const ref of refs) {
      const span = ref.span ?? [0, 0];
      expect(text.slice(span[0], span[1])).toBe(ref.raw);
    }
  });

  it("works on the normalized (lowercased) query form used by hybrid search", () => {
    // hybrid.ts feeds parseReferences(normalizeTurkishSearch(query)).
    const refs = parseReferences(normalizeTurkishSearch("TCK'NIN 157. MADDESİ"));
    expect(refs.find((r) => r.kind === "legislation")?.legislationNo).toBe("5237");
    expect(refs.find((r) => r.kind === "article")?.articleNo).toBe("157");
  });
});

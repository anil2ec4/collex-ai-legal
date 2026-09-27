import { describe, expect, it } from "vitest";

import {
  TR_FILTER_FOLD_FROM,
  TR_FILTER_FOLD_TO,
  TR_FILTER_SQL_FROM,
  TR_FILTER_SQL_TO,
  foldTurkishForFilter,
} from "../../src/retrieval/normalize.js";
import { nameMatches } from "../../src/files/routes.js";
import { matterMatchesQuery } from "../../src/matters/types.js";

/**
 * 27.09.2026 — measured on a real server: "KIDEM", "TANIK" and "YILMAZ"
 * found nothing in files, matters and matter items, and "bilirkisi" typed
 * without Turkish letters never met "bilirkişi". The database folded case
 * with its own locale; the filters now share one Turkish fold.
 */
describe("foldTurkishForFilter", () => {
  it("meets upper case, lower case and ASCII typing of the same Turkish word", () => {
    const key = foldTurkishForFilter("kıdem");
    for (const typed of ["KIDEM", "Kıdem", "kidem", "KİDEM"]) {
      expect(foldTurkishForFilter(typed), typed).toBe(key);
    }
    expect(foldTurkishForFilter("BİLİRKİŞİ RAPORU")).toBe(foldTurkishForFilter("bilirkisi raporu"));
    expect(foldTurkishForFilter("Şükrü Çağlar Öğüt")).toBe("sukru caglar ogut");
    expect(foldTurkishForFilter("Hukukî")).toBe("hukuki");
  });

  it("keeps the translate() pairs aligned letter for letter, and the SQL pair agrees with the JS fold", () => {
    expect(Array.from(TR_FILTER_FOLD_FROM)).toHaveLength(Array.from(TR_FILTER_FOLD_TO).length);
    const from = Array.from(TR_FILTER_SQL_FROM);
    const to = Array.from(TR_FILTER_SQL_TO);
    expect(from).toHaveLength(to.length);
    from.forEach((ch, i) => expect(foldTurkishForFilter(ch), ch).toBe(to[i]));
  });

  it("drives the in-memory file-name and matter filters", () => {
    expect(nameMatches("Bilirkişi Raporu (Ek-3).pdf", "BILIRKISI")).toBe(true);
    expect(nameMatches("Bilirkişi Raporu (Ek-3).pdf", "tanık")).toBe(false);
    const matter = {
      title: "Yılmaz / işçilik alacakları",
      client: "Ayşe Yılmaz",
      opposing: "Örnek Lojistik",
      court: "İstanbul Anadolu 5. İş Mahkemesi",
      docketNo: "2026/123",
    } as Parameters<typeof matterMatchesQuery>[0];
    for (const q of ["YILMAZ", "yilmaz", "ISTANBUL ANADOLU", "is mahkemesi", "ORNEK"]) {
      expect(matterMatchesQuery(matter, q), q).toBe(true);
    }
  });
});

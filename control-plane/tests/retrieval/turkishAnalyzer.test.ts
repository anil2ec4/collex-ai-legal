/**
 * The shared Turkish analyzer (retrieval/turkishAnalyzer.ts, 2026-09-10).
 *
 * Two things are pinned: (1) the stemmer moved WITHOUT a behaviour change —
 * coverage.ts's re-export is the same function and the planner now imports
 * it from here; (2) the folding helpers both modules used to carry privately
 * agree with each other and with the search normalizer on letters.
 */

import { describe, expect, it } from "vitest";
import {
  cpLength,
  derivationalAlternate,
  foldFinalConsonant,
  foldTurkishCase,
  lexemesMatch,
  softenFinalConsonant,
  stemTurkish,
  STOP_STEMS,
} from "../../src/retrieval/turkishAnalyzer.js";
import * as coverage from "../../src/answer/coverage.js";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";

describe("turkishAnalyzer: one stemmer, re-exported unchanged", () => {
  it("coverage.ts re-exports the SAME functions (no second copy)", () => {
    expect(coverage.stemTurkish).toBe(stemTurkish);
    expect(coverage.derivationalAlternate).toBe(derivationalAlternate);
    expect(coverage.lexemesMatch).toBe(lexemesMatch);
  });

  it("keeps the documented stemming decisions", () => {
    expect(stemTurkish("sözleşmesinde")).toBe("sözleşme");
    expect(stemTurkish("maddesinin")).toBe("madde"); // stops at a frame stem
    expect(stemTurkish("aracı")).toBe("araç"); // bare vowel + softening undone
    expect(stemTurkish("kira")).toBe("kira"); // never below four for a bare vowel
    expect(stemTurkish("dolandırıcılık")).toBe("dolandırıcılık"); // derivation kept
    expect(STOP_STEMS.has("madde")).toBe(true);
  });

  it("derivationalAlternate and lexemesMatch are unchanged", () => {
    expect(derivationalAlternate("değişiklik")).toBe("değişik");
    expect(derivationalAlternate("kira")).toBeUndefined();
    expect(lexemesMatch("dolandırıcılık", "dolandırıcılığın")).toBe(true);
    expect(lexemesMatch("kira", "kişi")).toBe(false);
  });
});

describe("turkishAnalyzer: dotted/dotless-I folding", () => {
  it("maps İ -> i and I -> ı before lowercasing, one code point each", () => {
    expect(foldTurkishCase("İSTANBUL")).toBe("istanbul");
    expect(foldTurkishCase("ISPARTA")).toBe("ısparta");
    expect(cpLength(foldTurkishCase("İIİI"))).toBe(4);
    // A plain toLowerCase would produce "i̇" for İ; the fold must not.
    expect(foldTurkishCase("İ")).toBe("i");
    expect(foldTurkishCase("İ").includes("̇")).toBe(false);
  });

  it("agrees with normalizeTurkishSearch on letters", () => {
    for (const word of ["İdare", "IŞIK", "Çağrı", "ÖDEME", "Şüphe", "İİK"]) {
      expect(foldTurkishCase(word)).toBe(normalizeTurkishSearch(word));
    }
  });
});

describe("turkishAnalyzer: final-consonant softening, both directions", () => {
  it("softens p/ç/t/k and folds them back", () => {
    expect(softenFinalConsonant("temerrüt")).toBe("temerrüd");
    expect(softenFinalConsonant("araç")).toBe("arac");
    expect(softenFinalConsonant("kitap")).toBe("kitab");
    expect(softenFinalConsonant("hukuk")).toBe("hukuğ");
    expect(softenFinalConsonant("kira")).toBe("kira");
    expect(softenFinalConsonant("")).toBe("");
    expect(foldFinalConsonant("arac")).toBe("araç");
    expect(foldFinalConsonant("temerrüd")).toBe("temerrüt");
    expect(foldFinalConsonant("kira")).toBe("kira");
  });

  it("the two are inverses on the letters they touch", () => {
    for (const word of ["temerrüt", "araç", "kitap", "hukuk"]) {
      expect(foldFinalConsonant(softenFinalConsonant(word))).toBe(word);
    }
  });
});

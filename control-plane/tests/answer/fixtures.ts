/**
 * In-memory fixtures for the citation-first answer pipeline tests.
 * Small canonical Turkish legal texts + candidate builders + a Map-backed
 * CanonicalTextPort. Fully offline and deterministic.
 */

import { codePointLength } from "../../src/verification/validator.js";
import type {
  AnswerCandidate,
  CanonicalTextPort,
} from "../../src/answer/evidencePack.js";

/** Code point span of `quote` inside `text` (throws if absent). */
export function spanOf(text: string, quote: string): { startChar: number; endChar: number } {
  const nfc = text.normalize("NFC");
  const q = quote.normalize("NFC");
  const idx = nfc.indexOf(q);
  if (idx < 0) throw new Error(`fixture quote not found: ${quote}`);
  const startChar = codePointLength(nfc.slice(0, idx));
  return { startChar, endChar: startChar + codePointLength(q) };
}

export class MapTextPort implements CanonicalTextPort {
  constructor(private readonly texts: ReadonlyMap<string, string>) {}
  async getCanonicalText(documentVersionId: string): Promise<string | undefined> {
    return this.texts.get(documentVersionId);
  }
}

/* ------------------------------ documents ----------------------------- */

export const TEXT_TCK =
  "5237 sayılı Türk Ceza Kanunu\n" +
  "Madde 81 - (1) Bir insanı kasten öldüren kişi, müebbet hapis cezası ile cezalandırılır.";

export const QUOTE_TCK =
  "Bir insanı kasten öldüren kişi, müebbet hapis cezası ile cezalandırılır.";

export const TEXT_YARGITAY =
  "Yargıtay 1. Ceza Dairesi, E. 2023/45, K. 2024/12 sayılı kararı.\n" +
  "Kasten öldürme suçunda temel ceza müebbet hapis olarak belirlenir.";

export const QUOTE_YARGITAY =
  "Kasten öldürme suçunda temel ceza müebbet hapis olarak belirlenir.";

export const TEXT_CONTRARY =
  "Bölge Adliye Mahkemesi kararı.\n" +
  "Somut olayda 5237 sayılı Kanun m. 81 uygulanmaz; eylem taksirle öldürme kapsamındadır.";

export const QUOTE_CONTRARY =
  "Somut olayda 5237 sayılı Kanun m. 81 uygulanmaz; eylem taksirle öldürme kapsamındadır.";

export const AS_OF = "2025-01-15";

/* ----------------------------- candidates ----------------------------- */

let hitCounter = 0;

export function makeCandidate(
  overrides: Partial<AnswerCandidate> & Pick<AnswerCandidate, "documentVersionId">,
): AnswerCandidate {
  hitCounter += 1;
  return {
    hitId: `hit-${hitCounter}`,
    documentId: "doc-default",
    chunkId: `chunk-${hitCounter}`,
    source: "MEVZUAT",
    sourceUrl: "https://mevzuat.gov.tr/ornek",
    title: "Örnek Belge",
    startChar: 0,
    endChar: 1,
    score: 0.9,
    ...overrides,
  };
}

export function tckCandidate(overrides: Partial<AnswerCandidate> = {}): AnswerCandidate {
  const span = spanOf(TEXT_TCK, QUOTE_TCK);
  return makeCandidate({
    documentId: "doc-tck",
    documentVersionId: "docv-tck-1",
    source: "MEVZUAT",
    sourceUrl: "https://mevzuat.gov.tr/tck",
    title: "Türk Ceza Kanunu",
    legislationNo: "5237",
    article: "81",
    effectiveFrom: "2005-06-01",
    ...span,
    ...overrides,
  });
}

export function yargitayCandidate(overrides: Partial<AnswerCandidate> = {}): AnswerCandidate {
  const span = spanOf(TEXT_YARGITAY, QUOTE_YARGITAY);
  return makeCandidate({
    documentId: "doc-yarg",
    documentVersionId: "docv-yarg-1",
    source: "BEDESTEN",
    sourceUrl: "https://karararama.yargitay.gov.tr/ornek",
    title: "Yargıtay 1. CD Kararı",
    court: "Yargıtay 1. Ceza Dairesi",
    docketNo: "2023/45",
    decisionNo: "2024/12",
    decisionDate: "2024-03-12",
    stance: "supporting",
    ...span,
    ...overrides,
  });
}

export function contraryCandidate(overrides: Partial<AnswerCandidate> = {}): AnswerCandidate {
  const span = spanOf(TEXT_CONTRARY, QUOTE_CONTRARY);
  return makeCandidate({
    documentId: "doc-contra",
    documentVersionId: "docv-contra-1",
    source: "BEDESTEN",
    sourceUrl: "https://example.gov.tr/bam",
    title: "BAM Karşıt Kararı",
    court: "Ankara Bölge Adliye Mahkemesi 1. Ceza Dairesi",
    docketNo: "2024/7",
    decisionNo: "2024/9",
    decisionDate: "2024-05-01",
    stance: "contrary",
    ...span,
    ...overrides,
  });
}

export function standardTexts(): Map<string, string> {
  return new Map([
    ["docv-tck-1", TEXT_TCK],
    ["docv-yarg-1", TEXT_YARGITAY],
    ["docv-contra-1", TEXT_CONTRARY],
  ]);
}

/* --------------------------- deterministic PRNG ------------------------ */

/** mulberry32 — deterministic PRNG for property tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

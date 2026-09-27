/**
 * Persistence for the multi-document review grid (W20).
 *
 * The grid used to live in the browser: a loop over (document x question)
 * that called /v1/answer once per cell and kept every result in page memory.
 * Closing the tab lost it; a restart lost it; one failed cell could only be
 * retried by re-running everything. This store makes the SAME grid durable:
 * the definition, the pinned document versions, and one row per cell with a
 * lease and a retry budget — the pattern the exhaustive analysis ledger
 * uses — so cells are independently retryable and a restart resumes at the
 * next unfinished cell.
 *
 * W21: a row's pinned version is what EVERY cell of that row reads (answer
 * cells included), a pin that can no longer be read is refused rather than
 * replaced by the current version, and getTable reports per row whether a
 * newer upload of the file exists (stale).
 *
 * W21 (#19): `stale` alone lumped "a newer upload exists" together with "the
 * file was deleted" and "the pinned version is gone", and the grid told the
 * lawyer to build a new table for a file that no longer exists. Each stale
 * row now carries WHY it is stale (staleReason).
 *
 * W21 (#17, #18): answer cells now mean something different (contracts CB2,
 * CB3), so the generator version moved to grid-v3. A cell finished by the
 * W20 worker (grid-v2) is never repeated as it was stored: a "not found"
 * whose run did not end in ABSTAIN is reported as the failed, retryable cell
 * it was, and an old whole-document abstention sentence — never checked
 * against the whole text — is re-stated passage-scoped (presentStoredCell).
 *
 * W21 round two (grid-v4): an extract_* census counted before grid-v4 used an
 * extractor that could not read half the Turkish month names or most amount
 * spellings, and wrote "Belgenin tamamında tarih bulunmadı" when it found
 * none. Such a cell is never repeated as stored either: it is re-stated as
 * an old, possibly incomplete census (legacyCensusTr) and reported PARTIAL.
 *
 * W21 round two, third verifier round (grid-v5): the extractor's rules were
 * corrected twice more after grid-v4 (extract-v4 .. extract-v6), so a grid-v4
 * census may list a count as an amount ("TL 12 eşit taksit" as 12 TL), a page
 * number and the month on the next line as a date ("3" / "Eylül 2023" as
 * 03.09.2023), or say COMPLETE for a document whose only amount wraps across
 * a line. It is
 * re-stated too (supersededCensusTr), and a test ties the census generator
 * version to the extractor version from now on (CENSUS_EXTRACTOR_VERSION).
 */

import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID } from "../exhaustive/store.js";

/**
 * What a stored cell means. grid-v3 (W21): an answer cell is stored as done
 * only for a run the pipeline finished (CB2), and its abstention says a word
 * occurs nowhere in the document only after the whole pinned text was scanned
 * for it (CB3). grid-v2 (W20) cells did neither; see presentStoredCell.
 *
 * grid-v4 (W21 round two): an answer claim whose passage support was never
 * judged is not stored (R2-21), nor an abstention from a search with a failed
 * passage lane (R2-23); a claim drafted and verified before the time budget
 * ran out is (R2-24). An extract_* census reads with extract-v3 or later, says it
 * counts only the recognised formats, and is PARTIAL when it met value-like
 * text it could not read (R2-22).
 *
 * grid-v5 (W21 round two, third verifier round): answer cells as in grid-v4;
 * an extract_* census is counted with CENSUS_EXTRACTOR_VERSION.
 *
 * grid-v6 (W21 closing re-check): answer cells as in grid-v4; the census
 * extractor moved to extract-v7, which no longer reads an exchange rate
 * ("Kur EUR/TL 35,12") as an amount.
 *
 * grid-v7 (W22): an answer cell shows the claim whose passage carries the
 * most of the question's core words (worker.ts chooseAnsweringClaim), not
 * the first claim, and a verified claim whose passage still lacks one of
 * them is stored with answer status QUESTION_NOT_CHECKED_STATUS — "alıntı
 * doğrulandı; soruyu karşıladığı denetlenmedi", never "kaynağıyla
 * doğrulandı". A verified cell stored by an earlier version was never so
 * checked and is re-stated the same way (presentStoredCell). The census
 * extractor moved to extract-v8, which names a money-shaped number it did not
 * read ("204.962,34" under a "Brüt (TL)" header), so a grid-v6 amount census
 * is re-stated; its dates and ratios were read by the same rules.
 *
 * grid-v8 (W23): cells as in grid-v7; the census extractor moved to
 * extract-v9, which changed only WHICH EVENT a date is tagged with (a
 * witness's "sorumlu olarak geldi" is an işe giriş). The values a census
 * counts are read by the same rules as extract-v8, so a grid-v7 census is
 * still current (CURRENT_CENSUS_VERSIONS) and a grid-v7 answer cell was
 * checked the same way (QUESTION_CHECKED_VERSIONS).
 */
export const REVIEW_TABLE_GENERATOR_VERSION = "grid-v8";

/**
 * W22: the answer status of a cell whose claim is verified against its quote,
 * but whose passage lacks one of the question's core words — nobody checked
 * that it answers the question. Its "Destek" is QUOTE_ONLY_SUPPORT_TR.
 */
export const QUESTION_NOT_CHECKED_STATUS = "QUESTION_NOT_CHECKED";

/** W22: the "Destek" label of such a cell (routes.ts supportLabelTr; the console's GRID_SUPPORT_TR.quote_only). */
export const QUOTE_ONLY_SUPPORT_TR = "alıntı doğrulandı; soruyu karşıladığı denetlenmedi";

/**
 * The deterministic extractor (exhaustive/observations.ts EXTRACTOR_VERSION)
 * the census cells of REVIEW_TABLE_GENERATOR_VERSION are counted with. A test
 * pins the two together: when the extractor's rules change, the generator
 * version must move as well, or census cells counted under the old rules are
 * shown as current (the grid-v4 residual of the third verifier round).
 */
export const CENSUS_EXTRACTOR_VERSION = "extract-v9";

/**
 * Versions whose abstention sentences were checked against the whole pinned
 * text (CB3). When the version is bumped again, keep grid-v3, grid-v4 and
 * grid-v5 here: a version missing from this set only ever loses the absolute
 * sentence, never gains it.
 */
const WHOLE_TEXT_CHECKED_VERSIONS: ReadonlySet<string> = new Set([
  "grid-v3",
  "grid-v4",
  "grid-v5",
  "grid-v6",
  "grid-v7",
  REVIEW_TABLE_GENERATOR_VERSION,
]);

/**
 * W21 R2-22: versions whose census cells were counted with the CURRENT
 * extractor rules (CENSUS_EXTRACTOR_VERSION). When the generator version
 * moves for a reason that leaves the extractor as it is, add the old version
 * here; when the extractor changes, do not: its census cells are re-stated.
 */
const CURRENT_CENSUS_VERSIONS: ReadonlySet<string> = new Set([
  // grid-v7 counted with extract-v8, whose VALUES extract-v9 reads alike (W23).
  "grid-v7",
  REVIEW_TABLE_GENERATOR_VERSION,
]);

/**
 * W23: versions whose verified answer cells were chosen and checked as
 * grid-v7 does (the claim carrying the question's core words; a passage
 * lacking one is QUESTION_NOT_CHECKED). A version outside it is re-stated.
 */
const QUESTION_CHECKED_VERSIONS: ReadonlySet<string> = new Set(["grid-v7", REVIEW_TABLE_GENERATOR_VERSION]);

/**
 * W21 R2-22 (third verifier round): versions whose census cells were scoped
 * to the recognised formats, but counted under extractor rules corrected
 * since. grid-v4 counted with extract-v3, -v4 or -v5: depending on which, it
 * may list "TL 12 eşit taksit" as 12 TL or "45 000 540 000 TL" as one amount;
 * all of them joined a number ending one line with a month name starting the
 * next into one date, and none named a date or amount split across a line.
 * Ratios were read the same way by all of them, so a ratio census is kept.
 * grid-v5 counted with extract-v6, which read an exchange rate as an amount
 * ("Kur EUR/TL 35,12" as 35,12 TL), so its amount census is re-stated too.
 * grid-v6 counted with extract-v7, which did not name a money-shaped number
 * it could not read; only its AMOUNT census is re-stated (W22), with its own
 * sentence (SUPERSEDED_V6_AMOUNT_GAP_TR).
 */
const SUPERSEDED_CENSUS_VERSIONS: ReadonlySet<string> = new Set(["grid-v4", "grid-v5", "grid-v6"]);

/** Superseded versions whose DATE census is still read by the current rules. */
const DATES_STILL_CURRENT_VERSIONS: ReadonlySet<string> = new Set(["grid-v6"]);

/**
 * W21 (#17, contract CB2): the error of an answer cell whose run the pipeline
 * could not finish. The cell FAILS (retryable, with backoff) instead of being
 * stored as "not found": a run that could not look, or ran out of time, says
 * nothing about the document.
 */
export const ANSWER_INCOMPLETE_TR =
  "Bu hücre tamamlanamadı: arama başarısız oldu, cevap cümleleri yazılamadı ya da süre doldu; yeniden deneyin.";

/**
 * W21 R2-21: the error of an answer cell whose claim was written but whose
 * passage support was never judged (the judge failed: ENTAILMENT_NOT_CHECKED).
 * A check that did not happen is not "partially verified"; the cell fails,
 * retryably, and the model-written sentence is not shown as an answer.
 */
export const SUPPORT_NOT_CHECKED_TR =
  "Bu hücre tamamlanamadı: cevap cümlesi yazıldı, ama pasajın bu cümleyi destekleyip desteklemediği denetlenemedi (doğrulama bileşeni yanıt vermedi); bu, cümlenin doğru ya da yanlış olduğunu göstermez. Yeniden deneyin.";

/**
 * W21 R2-23: the error of an answer cell whose run abstained while one of the
 * lanes searching the document failed (e.g. cut by its time budget), or while
 * one query of the search plan failed with every lane of it. "No passage"
 * from a partly failed search says nothing about the document.
 */
export const SEARCH_LANE_DEGRADED_TR =
  "Bu hücre tamamlanamadı: arama şeritlerinden biri başarısız oldu (ör. süre sınırına takıldı); pasaj bulunamaması, belgede karşılık olmadığı anlamına gelmez. Yeniden deneyin.";

/** What an extract_* census counts (exhaustive/observations.ts PropositionKind). */
export type CensusKind = "date" | "amount" | "ratio";

const CENSUS_WORD_TR: Readonly<Record<CensusKind, string>> = { date: "tarih", amount: "tutar", ratio: "oran" };
const CENSUS_PLURAL_TR: Readonly<Record<CensusKind, string>> = {
  date: "tarihler",
  amount: "tutarlar",
  ratio: "oranlar",
};

/**
 * W21 R2-22: the spellings the deterministic extractor (extract-v3 and later) reads.
 * A census is a census of THESE, and every census sentence says so.
 */
export const CENSUS_FORMATS_TR: Readonly<Record<CensusKind, string>> = {
  date: "15.09.2023, 15/09/2023, 15-09-2023, 2023-09-15, 15 Eylül 2023",
  amount: "45.000,00 TL, 45.000.-TL, ₺45.000, 45.000 TRY, 1,5 milyon TL; EUR, USD, GBP, CHF, €, $, £ ile yazılmış tutarlar",
  ratio: "%80, 80 %, yüzde 80",
};

/** Examples of unread value-like text named in a census sentence. */
const MAX_UNPARSED_SHOWN = 3;

/**
 * W21 R2-22: the text of an extract_* census cell. It never says a value is
 * absent from the document: an empty census says no value IN A RECOGNISED
 * FORMAT was found and names the formats; a list says only those formats were
 * listed; value-like text the extractor could not read is named by example.
 */
export function censusTextTr(census: {
  readonly kind: CensusKind;
  /** The values listed (display form, with their page). */
  readonly shown: readonly string[];
  /** How many distinct values were found in all. */
  readonly total: number;
  /** The processing coverage: every page of the version was read. */
  readonly complete: boolean;
  /** Examples of value-like text that was not read (observations.ts unparsedValueMentions). */
  readonly unparsed: readonly string[];
}): string {
  const word = CENSUS_WORD_TR[census.kind];
  const plural = CENSUS_PLURAL_TR[census.kind];
  const formats = CENSUS_FORMATS_TR[census.kind];
  const parts: string[] = [];
  if (census.total === 0) {
    parts.push(
      census.complete
        ? `Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir ${word} bulunmadı (tanınan biçimler: ${formats}). Başka biçimde yazılmış ${plural} bu sayıma girmez.`
        : `Belge tam okunamadı; okunabilen kısımda tanınan biçimlerde yazılmış bir ${word} bulunmadı (tanınan biçimler: ${formats}).`,
    );
  } else {
    const more = census.total > census.shown.length ? ` ve ${census.total - census.shown.length} tane daha` : "";
    parts.push(`${census.total} ayrı ${word}: ${census.shown.join("; ")}${more}.`);
    if (!census.complete) parts.push("Belge tam okunamadığı için liste eksik olabilir.");
    parts.push(`Yalnız tanınan biçimlerde yazılmış ${plural} listelendi (${formats}).`);
  }
  if (census.unparsed.length > 0) {
    const examples = census.unparsed
      .slice(0, MAX_UNPARSED_SHOWN)
      .map((example) => `“${example}”`)
      .join("; ");
    parts.push(
      `Belgede bu biçimlere uymayan ${word} ifadeleri de geçiyor (ör. ${examples}); bunlar okunamadığı için sayım eksik olabilir, belgeden kontrol edin.`,
    );
  }
  return parts.join(" ");
}

/** W21 R2-22: the first sentence of a census cell counted before grid-v4. */
export const LEGACY_CENSUS_TR =
  "Bu hücre, bazı yazımları tanımayan eski bir sayımla hesaplandı; sonucu eksik olabilir, hücreyi yeniden deneyin.";

const LEGACY_CENSUS_GAP_TR: Readonly<Record<CensusKind, string>> = {
  date: " O sayım, örneğin Şubat, Mayıs, Ağustos, Eylül, Kasım ve Aralık diye yazılmış tarihleri okumuyordu.",
  amount: " O sayım, örneğin 45.000,00.-TL, ₺45.000, 45.000 TRY ve EUR ya da USD ile yazılmış tutarları okumuyordu.",
  ratio: "",
};

const CENSUS_KIND_OF_WORD: Readonly<Record<string, CensusKind>> = { tarih: "date", tutar: "amount", oran: "ratio" };

/** W21 R2-22 (third verifier round): what the rules behind a grid-v4 census could get wrong, per kind. */
const SUPERSEDED_CENSUS_GAP_TR: Readonly<Record<CensusKind, string>> = {
  date:
    " O sayımın kuralları sonradan düzeltildi: örneğin bir satırın sonundaki sayfa ya da madde numarasını alt satırdaki “Kasım 2023” ile birleştirip tarih sayabiliyor, satır sonunda bölünmüş bir tarih ifadesini (“Eylül” ve alt satırda “2023”) ise hiç anmadan atlayabiliyordu; listedeki bir tarih yanlış da olabilir.",
  amount:
    " O sayımın kuralları sonradan düzeltildi: örneğin “TL 12 eşit taksit” içindeki 12’yi tutar sayabiliyor, satır sonunda bölünmüş bir tutarı (“7500” ve alt satırda “TL”) ise hiç anmadan atlayabiliyordu; listedeki bir tutar yanlış da olabilir.",
  ratio: "",
};

/** W22: what a grid-v6 amount census could miss (extract-v7). */
const SUPERSEDED_V6_AMOUNT_GAP_TR =
  " O sayım, para birimi yalnız tablo başlığında yazılmış tutarları (ör. “Brüt (TL)” sütunundaki 204.962,34) hiç anmadan atlayabiliyor ve sayımı yine de tam gösterebiliyordu; listede olmayan tutarlar olabilir.";

/**
 * W21 R2-22 (third verifier round): a census cell counted by a superseded
 * version (SUPERSEDED_CENSUS_VERSIONS), as it may be reported, or undefined
 * when it is still current (a ratio census). It starts with LEGACY_CENSUS_TR
 * (the console offers the retry for that sentence), says what the old rules
 * could get wrong, and keeps an old list after the warning. An unrecognised
 * text is replaced by the warning alone.
 */
export function supersededCensusTr(text: string | null, generatorVersion?: string | null): string | undefined {
  const old = text ?? "";
  const list = old.match(/^\d+ ayrı (tarih|tutar|oran): /u);
  const whole = old.match(/^Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir (tarih|tutar|oran) bulunmadı/u);
  const readable = old.match(/^Belge tam okunamadı; okunabilen kısımda tanınan biçimlerde yazılmış bir (tarih|tutar|oran) bulunmadı/u);
  const word = (list ?? whole ?? readable)?.[1];
  const kind = word === undefined ? undefined : CENSUS_KIND_OF_WORD[word];
  if (word === undefined || kind === undefined) return LEGACY_CENSUS_TR;
  if (kind === "ratio") return undefined;
  const v6 = generatorVersion !== undefined && generatorVersion !== null && DATES_STILL_CURRENT_VERSIONS.has(generatorVersion);
  // W22: a grid-v6 date census was read by today's date rules; kept as it is.
  if (v6 && kind === "date") return undefined;
  const gap = v6 ? SUPERSEDED_V6_AMOUNT_GAP_TR : SUPERSEDED_CENSUS_GAP_TR[kind];
  if (whole !== null) {
    return `${LEGACY_CENSUS_TR}${gap} Eski sayım tanıdığı biçimlerde bir ${word} bulmamıştı; bu, belgede ${word} olmadığı anlamına gelmez.`;
  }
  if (readable !== null) {
    return `${LEGACY_CENSUS_TR}${gap} Belge tam okunamamıştı; eski sayım okunabilen kısımda tanıdığı biçimlerde bir ${word} bulmamıştı, bu da belgede ${word} olmadığı anlamına gelmez.`;
  }
  return `${LEGACY_CENSUS_TR}${gap} Eski sayımın listesi: ${old}`;
}

/**
 * W21 R2-22: a census cell stored before grid-v4, as it may be reported. The
 * old absolute sentences ("Belgenin tamamında tarih bulunmadı.") are never
 * repeated; an old list is kept, after the warning; anything unrecognised is
 * replaced by the warning alone.
 */
export function legacyCensusTr(text: string | null): string {
  const old = text ?? "";
  const whole = old.match(/^Belgenin tamamında (tarih|tutar|oran) bulunmadı\.$/u);
  const readable = old.match(/^Belgenin okunabilen kısmında (tarih|tutar|oran) bulunmadı; belge tam okunamadı\.$/u);
  const list = old.match(/^\d+ ayrı (tarih|tutar|oran): /u);
  const word = (whole ?? readable ?? list)?.[1];
  const kind = word === undefined ? undefined : CENSUS_KIND_OF_WORD[word];
  if (word === undefined || kind === undefined) return LEGACY_CENSUS_TR;
  const gap = LEGACY_CENSUS_GAP_TR[kind];
  if (whole !== null) {
    return `${LEGACY_CENSUS_TR}${gap} Eski sayım tanıdığı biçimlerde bir ${word} bulmamıştı; bu, belgede ${word} olmadığı anlamına gelmez.`;
  }
  if (readable !== null) {
    return `${LEGACY_CENSUS_TR}${gap} Belge tam okunamamıştı; eski sayım okunabilen kısımda tanıdığı biçimlerde bir ${word} bulmamıştı, bu da belgede ${word} olmadığı anlamına gelmez.`;
  }
  return `${LEGACY_CENSUS_TR}${gap} Eski sayımın listesi: ${old}`;
}

/** Words listed per sentence of an abstention. */
const MAX_WORDS_SHOWN = 4;

const PASSAGES_PREFIX_TR = "Bu soru için getirilen pasajlarda karşılığı bulunamadı — bu pasajlarda şu sözcükler geçmiyor: ";
const PASSAGES_SUFFIX_TR = "; belgenin tamamı taranmadı.";
const ABSENT_PREFIX_TR = "Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: ";

/**
 * W21 (#18, contract CB3): question words the RETRIEVED passages lack. The
 * sentence names what was examined; it never says the document lacks them.
 */
export function notInRetrievedPassagesTr(words: readonly string[]): string {
  return `${PASSAGES_PREFIX_TR}${words.slice(0, MAX_WORDS_SHOWN).join(", ")}${PASSAGES_SUFFIX_TR}`;
}

/**
 * W21 (#18, contract CB3): question words verified absent from the WHOLE text
 * of the pinned version (the version was fully read and scanned for them).
 */
export function absentFromDocumentTr(words: readonly string[]): string {
  return `${ABSENT_PREFIX_TR}${words.slice(0, MAX_WORDS_SHOWN).join(", ")}`;
}

/** W21 (#18): an abstention with no missing question word (passages were retrieved). */
export const ABSTAIN_IN_PASSAGES_TR = "Bu soru için getirilen pasajlarda karşılık bulunamadı; belgenin tamamı taranmadı.";

/** W21 (#18): an abstention for which retrieval returned no passage at all. */
export const NO_PASSAGES_TR = "Arama bu soru için belgeden pasaj getirmedi; belgenin tamamı taranmadı.";

function wordList(list: string): string[] {
  return list
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

/**
 * The question words an abstention sentence names — from the whole-document
 * sentence, the passage sentence, or both joined (`<absent>. <passages>`).
 */
function wordsNamedIn(text: string): string[] {
  const words: string[] = [];
  let rest = text;
  if (rest.startsWith(ABSENT_PREFIX_TR)) {
    rest = rest.slice(ABSENT_PREFIX_TR.length);
    const joint = rest.indexOf(`. ${PASSAGES_PREFIX_TR}`);
    words.push(...wordList(joint < 0 ? rest : rest.slice(0, joint)));
    rest = joint < 0 ? "" : rest.slice(joint + 2);
  }
  if (rest.startsWith(PASSAGES_PREFIX_TR) && rest.endsWith(PASSAGES_SUFFIX_TR)) {
    words.push(...wordList(rest.slice(PASSAGES_PREFIX_TR.length, rest.length - PASSAGES_SUFFIX_TR.length)));
  }
  return [...new Set(words)];
}

/**
 * W21 (#18): the abstention text of a cell stored by a version that never
 * checked the whole pinned text. Whatever it said, it may only speak about
 * the retrieved passages: the words it named are kept, the "nowhere in this
 * document" claim is not. An unrecognised sentence is replaced, never repeated.
 */
export function passageScopedAbstentionTr(text: string | null, supportState: "abstained" | "no_evidence"): string {
  const words = wordsNamedIn(text ?? "");
  if (words.length > 0) return notInRetrievedPassagesTr(words);
  return supportState === "no_evidence" ? NO_PASSAGES_TR : ABSTAIN_IN_PASSAGES_TR;
}

/** Shown when a row's pinned version can no longer be read (W21). */
export const PIN_UNREADABLE_TR =
  "Tablo oluşturulurken sabitlenen belge sürümü artık okunamıyor; bu hücre belgenin başka bir sürümünden cevaplanmaz. Güncel sürüm için yeni bir tablo oluşturun.";

/**
 * W21 (#19): shown instead of PIN_UNREADABLE_TR when the row's FILE was
 * deleted. There is no current version to build a new table from (POST
 * /v1/review-tables refuses the file), so no such advice is given.
 */
export const PIN_FILE_DELETED_TR =
  "Bu belge sistemden silindi; tablo oluşturulurken sabitlenen sürüm artık okunamıyor ve bu hücre yeniden hesaplanamaz.";

/**
 * W21 (#19): why a row is stale.
 *   newer_version        a newer PUBLISHED version of the file exists
 *   file_deleted         the file itself was deleted
 *   pin_gone             the file exists, but the pinned version was deleted
 *                        or can no longer be read exactly
 *   no_readable_current  the pin is readable, but the file has no readable
 *                        current version (a newer upload failed or is still
 *                        being processed)
 */
export type StaleReason = "newer_version" | "file_deleted" | "pin_gone" | "no_readable_current";

/**
 * The reason a row is stale, or null when it is not (exactly when `stale` is
 * false: the pin is the file's current published version).
 */
export function staleReasonOf(row: {
  readonly documentVersionId: string | null;
  readonly currentDocumentVersionId: string | null;
  readonly fileExists: boolean;
  readonly pinReadable: boolean;
}): StaleReason | null {
  if (row.documentVersionId !== null && row.currentDocumentVersionId === row.documentVersionId) return null;
  if (!row.fileExists) return "file_deleted";
  if (row.documentVersionId === null || !row.pinReadable) return "pin_gone";
  if (row.currentDocumentVersionId === null) return "no_readable_current";
  return "newer_version";
}

export type ColumnMode = "answer" | "extract_dates" | "extract_amounts" | "extract_ratios";
export type CellState = "pending" | "running" | "done" | "failed" | "cancelled";
export type SupportState =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "abstained"
  | "no_evidence"
  | "exhaustive_complete"
  | "exhaustive_incomplete";

export interface CellProvenance {
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly chunkId?: string | undefined;
  readonly startChar: number;
  readonly endChar: number;
  readonly quoteSha256: string;
  readonly locator?: string | undefined;
}

export interface NewReviewTable {
  readonly title: string;
  readonly matterId: string | null;
  readonly options: { asOf?: string; useLocalAi?: boolean };
  readonly columns: ReadonlyArray<{ question: string; mode: ColumnMode }>;
  readonly rows: ReadonlyArray<{ fileId: string; fileName: string; documentVersionId: string | null }>;
}

export interface ReviewTableRow {
  readonly tableId: string;
  readonly matterId: string | null;
  readonly title: string;
  readonly status: "queued" | "running" | "done" | "cancelled";
  readonly options: { asOf?: string; useLocalAi?: boolean };
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly cancelRequested: boolean;
}

export interface ReviewColumn {
  readonly columnNo: number;
  readonly question: string;
  readonly mode: ColumnMode;
}

export interface ReviewRowDoc {
  readonly rowNo: number;
  readonly fileId: string;
  readonly fileName: string | null;
  /** The version this row's cells are computed from (pinned at creation). */
  readonly documentVersionId: string | null;
  /** W21: the file's current version now; null when the file is gone. */
  readonly currentDocumentVersionId: string | null;
  /**
   * W21: the pinned version is no longer the file's current version, or the
   * pin itself is gone. The row's cells still read only the pinned version.
   * WHY is in staleReason — never assume a newer upload exists.
   */
  readonly stale: boolean;
  /** W21 (#19): why the row is stale; null exactly when `stale` is false. */
  readonly staleReason: StaleReason | null;
}

export interface ReviewCell {
  readonly rowNo: number;
  readonly columnNo: number;
  readonly state: CellState;
  readonly attempts: number;
  readonly answerStatus: string | null;
  readonly answerText: string | null;
  readonly supportState: SupportState | null;
  readonly provenance: CellProvenance[];
  readonly processingCoverage: unknown;
  readonly answerRunId: string | null;
  readonly generatorVersion: string | null;
  readonly error: string | null;
}

/**
 * W21 (#17, #18): a stored cell as the API (GET and export.csv) reports it.
 *
 *   - A done "abstention" whose run did not end in ABSTAIN was a run the
 *     pipeline could not finish (the W20 worker stored those as "not found").
 *     It is reported as the failed, retryable cell it is, with
 *     ANSWER_INCOMPLETE_TR (CB2). No grid-v3 worker stores such a cell, so
 *     this is safe for every version.
 *   - An abstention from a version that did not check the whole pinned text
 *     is re-stated passage-scoped (CB3); only a checked version may say a
 *     word occurs nowhere in the document.
 *
 *   - W21 R2-22: a census (extract_*) cell counted before grid-v4 is
 *     reported PARTIAL with legacyCensusTr: its extractor could not read
 *     many month names and amount spellings, and its "nothing found" was
 *     an absolute sentence. A date or amount census counted by grid-v4 is
 *     reported PARTIAL with supersededCensusTr (third verifier round): its
 *     rules have been corrected since.
 *
 * Read-time only: the stored row is left as it is, and retrying the cell
 * recomputes it under the current version.
 */
export function presentStoredCell(cell: ReviewCell): ReviewCell {
  if (cell.state !== "done") return cell;
  if (cell.supportState === "exhaustive_complete" || cell.supportState === "exhaustive_incomplete") {
    if (cell.generatorVersion !== null && CURRENT_CENSUS_VERSIONS.has(cell.generatorVersion)) return cell;
    if (cell.generatorVersion !== null && SUPERSEDED_CENSUS_VERSIONS.has(cell.generatorVersion)) {
      const restated = supersededCensusTr(cell.answerText, cell.generatorVersion);
      return restated === undefined ? cell : { ...cell, answerStatus: "PARTIAL", answerText: restated };
    }
    return { ...cell, answerStatus: "PARTIAL", answerText: legacyCensusTr(cell.answerText) };
  }
  // W22: a verified answer stored before grid-v7 showed the FIRST claim and
  // never checked that its passage carries the question's words (a hearing
  // header answered "işe giriş tarihi"). Its quote was verified; that it
  // answers the question was not.
  if (
    cell.supportState === "verified" &&
    (cell.generatorVersion === null || !QUESTION_CHECKED_VERSIONS.has(cell.generatorVersion)) &&
    cell.answerStatus !== QUESTION_NOT_CHECKED_STATUS
  ) {
    return { ...cell, answerStatus: QUESTION_NOT_CHECKED_STATUS };
  }
  if (cell.supportState !== "abstained" && cell.supportState !== "no_evidence") return cell;
  if (cell.answerStatus !== "ABSTAIN") {
    return {
      ...cell,
      state: "failed",
      answerStatus: null,
      answerText: null,
      supportState: null,
      provenance: [],
      processingCoverage: null,
      error: ANSWER_INCOMPLETE_TR,
    };
  }
  if (cell.generatorVersion !== null && WHOLE_TEXT_CHECKED_VERSIONS.has(cell.generatorVersion)) return cell;
  return { ...cell, answerText: passageScopedAbstentionTr(cell.answerText, cell.supportState) };
}

export interface CellClaim {
  readonly tableId: string;
  readonly rowNo: number;
  readonly columnNo: number;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface CellResult {
  readonly answerStatus: string;
  readonly answerText: string;
  readonly supportState: SupportState;
  readonly provenance: readonly CellProvenance[];
  readonly processingCoverage?: unknown;
  readonly answerRunId?: string | undefined;
}

export interface ReviewProgress {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
}

function json(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as never);
}

function text(row: SqlRow, column: string): string {
  return String(row[column] ?? "");
}

function textOrNull(row: SqlRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

export class PgReviewTableStore {
  constructor(
    private readonly sql: Sql,
    readonly tenantId: string = LOCAL_TENANT_ID,
  ) {}

  /**
   * W21: SQL test that row `r`'s pinned version still exists, is published
   * and belongs to that row's file in this tenant — i.e. a cell can be
   * computed from EXACTLY that version. False for a cleared pin (the version
   * was deleted: the column is ON DELETE SET NULL).
   */
  private pinReadable() {
    return this.sql`exists (
      select 1 from legal.document_versions v
      join legal.documents d on d.id = v.document_id
      where v.id = r.document_version_id
        and v.status = 'published'
        and d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = r.file_id)`;
  }

  /**
   * W21 (#19): SQL test that row `r`'s FILE still exists in this tenant (any
   * version status). Tells "the file was deleted" apart from "the pinned
   * version is gone" and "a newer upload exists".
   */
  private fileExists() {
    return this.sql`exists (
      select 1 from legal.documents d
      where d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = r.file_id)`;
  }

  /** Current version of each upload, tenant-scoped (the rows' pins). */
  async currentUploads(fileIds: readonly string[]): Promise<Map<string, { versionId: string; title: string }>> {
    const out = new Map<string, { versionId: string; title: string }>();
    const ids = [...new Set(fileIds)];
    if (ids.length === 0) return out;
    const rows = await this.sql`
      select d.external_id as file_id, v.id::text as version_id,
             coalesce(d.title, d.external_id) as title
      from legal.documents d
      join legal.document_versions v on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant' and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = any(${ids}::text[])`;
    for (const row of rows) {
      out.set(text(row, "file_id"), { versionId: text(row, "version_id"), title: text(row, "title") });
    }
    return out;
  }

  /** Definition, rows, columns and every cell — one transaction. */
  async create(input: NewReviewTable): Promise<string> {
    return (await this.sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const rows = await t`
        insert into app_private.review_tables
          (tenant_id, matter_id, title, status, generator_version, scope, options)
        values (${this.tenantId}::uuid, ${input.matterId}::uuid, ${input.title}, 'queued',
                ${REVIEW_TABLE_GENERATOR_VERSION},
                ${json(t, { fileIds: input.rows.map((row) => row.fileId) })},
                ${json(t, input.options)})
        returning table_id::text as table_id`;
      const tableId = text(rows[0] as SqlRow, "table_id");
      for (let index = 0; index < input.columns.length; index += 1) {
        const column = input.columns[index]!;
        await t`
          insert into app_private.review_table_columns (table_id, column_no, tenant_id, question, mode)
          values (${tableId}::uuid, ${index + 1}, ${this.tenantId}::uuid, ${column.question}, ${column.mode})`;
      }
      for (let index = 0; index < input.rows.length; index += 1) {
        const row = input.rows[index]!;
        await t`
          insert into app_private.review_table_rows
            (table_id, row_no, tenant_id, file_id, file_name, document_version_id)
          values (${tableId}::uuid, ${index + 1}, ${this.tenantId}::uuid, ${row.fileId},
                  ${row.fileName}, ${row.documentVersionId}::uuid)`;
      }
      await t`
        insert into app_private.review_table_cells (table_id, row_no, column_no, tenant_id)
        select ${tableId}::uuid, r.row_no, c.column_no, ${this.tenantId}::uuid
        from app_private.review_table_rows r
        cross join app_private.review_table_columns c
        where r.table_id = ${tableId}::uuid and c.table_id = ${tableId}::uuid`;
      return tableId;
    })) as unknown as string;
  }

  async recoverStale(): Promise<number> {
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = case when attempts >= max_attempts then 'failed' else 'pending' end,
          error = case when attempts >= max_attempts
                       then 'Hücreyi hesaplayan süreç durdu ve deneme hakkı bitti.'
                       else error end,
          lease_owner = null, lease_expires_at = null, available_at = now(), updated_at = now()
      where tenant_id = ${this.tenantId}::uuid and state = 'running' and lease_expires_at < now()
      returning table_id`;
    return rows.length;
  }

  /** Apply cancellations: pending cells of a cancelled table never run. */
  async applyCancellations(): Promise<number> {
    const tables = await this.sql`
      update app_private.review_tables
      set status = 'cancelled', finished_at = now(), updated_at = now()
      where tenant_id = ${this.tenantId}::uuid and cancel_requested_at is not null
        and status in ('queued', 'running')
      returning table_id::text as table_id`;
    for (const row of tables) {
      await this.sql`
        update app_private.review_table_cells
        set state = 'cancelled', updated_at = now()
        where table_id = ${text(row, "table_id")}::uuid and state = 'pending'`;
    }
    return tables.length;
  }

  async claimCells(workerId: string, batch: number, leaseMs: number): Promise<CellClaim[]> {
    const rows = await this.sql`
      with candidate as (
        select c.table_id, c.row_no, c.column_no
        from app_private.review_table_cells c
        join app_private.review_tables t on t.table_id = c.table_id
        where c.tenant_id = ${this.tenantId}::uuid and t.tenant_id = ${this.tenantId}::uuid
          and c.state = 'pending' and c.available_at <= now()
          and t.status in ('queued', 'running') and t.cancel_requested_at is null
        order by t.created_at, c.row_no, c.column_no
        for update of c skip locked
        limit ${Math.max(1, Math.floor(batch))}
      )
      update app_private.review_table_cells c
      set state = 'running', attempts = c.attempts + 1, lease_owner = ${workerId},
          lease_expires_at = now() + (${Math.max(1, Math.floor(leaseMs))}::int * interval '1 millisecond'),
          started_at = now(), updated_at = now(), error = null
      from candidate k
      where c.table_id = k.table_id and c.row_no = k.row_no and c.column_no = k.column_no
      returning c.table_id::text as table_id, c.row_no, c.column_no, c.attempts, c.max_attempts`;
    const claims = rows.map((row) => ({
      tableId: text(row, "table_id"),
      rowNo: Number(row["row_no"]),
      columnNo: Number(row["column_no"]),
      attempts: Number(row["attempts"]),
      maxAttempts: Number(row["max_attempts"]),
    }));
    const tables = [...new Set(claims.map((claim) => claim.tableId))];
    if (tables.length > 0) {
      await this.sql`
        update app_private.review_tables set status = 'running', updated_at = now()
        where table_id = any(${tables}::uuid[]) and status = 'queued'`;
    }
    return claims;
  }

  /** Everything one cell needs to be computed. */
  async cellContext(claim: CellClaim): Promise<
    | {
        question: string;
        mode: ColumnMode;
        fileId: string;
        fileName: string | null;
        documentVersionId: string | null;
        /** W21: the pinned version can be read exactly (see pinReadable). */
        pinReadable: boolean;
        /** W21 (#19): the row's file still exists (see fileExists). */
        fileExists: boolean;
        matterId: string | null;
        options: { asOf?: string; useLocalAi?: boolean };
      }
    | undefined
  > {
    const rows = await this.sql`
      select c.question, c.mode, r.file_id, r.file_name,
             r.document_version_id::text as document_version_id,
             ${this.pinReadable()} as pin_readable,
             ${this.fileExists()} as file_exists,
             t.matter_id::text as matter_id, t.options
      from app_private.review_tables t
      join app_private.review_table_columns c on c.table_id = t.table_id and c.column_no = ${claim.columnNo}
      join app_private.review_table_rows r on r.table_id = t.table_id and r.row_no = ${claim.rowNo}
      where t.table_id = ${claim.tableId}::uuid and t.tenant_id = ${this.tenantId}::uuid`;
    const row = rows[0];
    if (row === undefined) return undefined;
    const options = row["options"];
    return {
      question: text(row, "question"),
      mode: text(row, "mode") as ColumnMode,
      fileId: text(row, "file_id"),
      fileName: textOrNull(row, "file_name"),
      documentVersionId: textOrNull(row, "document_version_id"),
      pinReadable: row["pin_readable"] === true,
      fileExists: row["file_exists"] === true,
      matterId: textOrNull(row, "matter_id"),
      options: options !== null && typeof options === "object" ? (options as { asOf?: string; useLocalAi?: boolean }) : {},
    };
  }

  async completeCell(claim: CellClaim, workerId: string, result: CellResult): Promise<boolean> {
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = 'done', lease_owner = null, lease_expires_at = null,
          answer_status = ${result.answerStatus},
          answer_text = ${result.answerText.slice(0, 8000)},
          support_state = ${result.supportState},
          provenance = ${json(this.sql, result.provenance)},
          processing_coverage = ${result.processingCoverage === undefined ? null : json(this.sql, result.processingCoverage)},
          answer_run_id = ${result.answerRunId ?? null},
          generator_version = ${REVIEW_TABLE_GENERATOR_VERSION},
          error = null, finished_at = now(), updated_at = now()
      where table_id = ${claim.tableId}::uuid and row_no = ${claim.rowNo}
        and column_no = ${claim.columnNo} and tenant_id = ${this.tenantId}::uuid
        and state = 'running' and lease_owner = ${workerId}
      returning row_no`;
    return rows.length > 0;
  }

  /**
   * `terminal` (W21) fails the cell now, without spending the retry budget:
   * used for a refusal that no retry can change (the pinned version cannot
   * be read, or the answer came from another version).
   */
  async failCell(
    claim: CellClaim,
    workerId: string,
    message: string,
    backoffMs: number,
    terminal = false,
  ): Promise<void> {
    await this.sql`
      update app_private.review_table_cells
      set state = case when ${terminal}::boolean or attempts >= max_attempts then 'failed' else 'pending' end,
          available_at = case when ${terminal}::boolean or attempts >= max_attempts then available_at
                              else now() + (${Math.max(0, Math.floor(backoffMs))}::int * interval '1 millisecond') end,
          error = ${message.slice(0, 500)}, lease_owner = null, lease_expires_at = null,
          finished_at = case when ${terminal}::boolean or attempts >= max_attempts then now() else finished_at end,
          updated_at = now()
      where table_id = ${claim.tableId}::uuid and row_no = ${claim.rowNo}
        and column_no = ${claim.columnNo} and tenant_id = ${this.tenantId}::uuid
        and state = 'running' and lease_owner = ${workerId}`;
  }

  /** Close tables with nothing pending or running. */
  async finishIdleTables(): Promise<number> {
    const rows = await this.sql`
      update app_private.review_tables t
      set status = 'done', finished_at = now(), updated_at = now()
      where t.tenant_id = ${this.tenantId}::uuid and t.status in ('queued', 'running')
        and t.cancel_requested_at is null
        and not exists (select 1 from app_private.review_table_cells c
                        where c.table_id = t.table_id and c.state in ('pending', 'running'))
      returning t.table_id`;
    return rows.length;
  }

  /**
   * Put ONE cell back in the queue (its own retry; nothing else reruns).
   *
   * W21: a cell is only ever recomputed from its row's PINNED version. When
   * that version can no longer be read the retry is refused
   * ("version_unavailable") instead of quietly answering from a newer one;
   * "file_deleted" (W21 #19) when the row's file itself was deleted.
   *
   * A re-queued cell drops its previous result (text, support, provenance):
   * a recompute that then fails must show why it failed, never the text of
   * the run it replaced as if it were current.
   */
  async retryCell(
    tableId: string,
    rowNo: number,
    columnNo: number,
  ): Promise<"queued" | "not_found" | "busy" | "version_unavailable" | "file_deleted"> {
    const pin = await this.sql`
      select c.state, ${this.pinReadable()} as pin_readable, ${this.fileExists()} as file_exists
      from app_private.review_table_cells c
      join app_private.review_table_rows r on r.table_id = c.table_id and r.row_no = c.row_no
      where c.table_id = ${tableId}::uuid and c.row_no = ${rowNo} and c.column_no = ${columnNo}
        and c.tenant_id = ${this.tenantId}::uuid and r.tenant_id = ${this.tenantId}::uuid`;
    if (pin[0] === undefined) return "not_found";
    // A cell being computed right now is BUSY whatever its pin; only a cell
    // that may be retried at all is refused for an unreadable pin.
    if (pin[0]["state"] === "pending" || pin[0]["state"] === "running") return "busy";
    if (pin[0]["pin_readable"] !== true) {
      return pin[0]["file_exists"] === true ? "version_unavailable" : "file_deleted";
    }
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = 'pending', attempts = 0, available_at = now(), error = null,
          answer_status = null, answer_text = null, support_state = null,
          provenance = '[]'::jsonb, processing_coverage = null, answer_run_id = null,
          generator_version = null, finished_at = null,
          lease_owner = null, lease_expires_at = null, updated_at = now()
      where table_id = ${tableId}::uuid and row_no = ${rowNo} and column_no = ${columnNo}
        and tenant_id = ${this.tenantId}::uuid and state in ('done', 'failed', 'cancelled')
      returning row_no`;
    if (rows.length === 0) {
      const exists = await this.sql`
        select state from app_private.review_table_cells
        where table_id = ${tableId}::uuid and row_no = ${rowNo} and column_no = ${columnNo}
          and tenant_id = ${this.tenantId}::uuid`;
      return exists.length === 0 ? "not_found" : "busy";
    }
    await this.sql`
      update app_private.review_tables
      set status = 'running', finished_at = null, cancel_requested_at = null, updated_at = now()
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    return "queued";
  }

  async requestCancel(tableId: string): Promise<boolean> {
    const rows = await this.sql`
      update app_private.review_tables
      set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid
        and status in ('queued', 'running')
      returning table_id`;
    return rows.length > 0;
  }

  async getTable(tableId: string): Promise<
    | { table: ReviewTableRow; columns: ReviewColumn[]; rows: ReviewRowDoc[]; cells: ReviewCell[] }
    | undefined
  > {
    const tables = await this.sql`
      select table_id::text as table_id, matter_id::text as matter_id, title, status,
             options, created_at, finished_at, cancel_requested_at
      from app_private.review_tables
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    const row = tables[0];
    if (row === undefined) return undefined;
    const columns = await this.sql`
      select column_no, question, mode from app_private.review_table_columns
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid order by column_no`;
    // W21: each row's pin next to the file's CURRENT version, so a newer
    // upload is reported (stale) instead of silently changing the grid —
    // and (#19) whether the file and the pin still exist, so a deleted file
    // is never reported as a newer upload.
    const docs = await this.sql`
      select r.row_no, r.file_id, r.file_name, r.document_version_id::text as document_version_id,
             ${this.pinReadable()} as pin_readable,
             ${this.fileExists()} as file_exists,
             (select v.id::text
                from legal.documents d
                -- Only a PUBLISHED version is "current": a newer upload that
                -- failed or is still processing does not mark the row stale.
                join legal.document_versions v
                  on v.document_id = d.id and upper_inf(v.system_period) and v.status = 'published'
               where d.scope = 'tenant' and d.tenant_id = ${this.tenantId}::uuid
                 and d.external_id = r.file_id
               order by v.id
               limit 1) as current_version_id
      from app_private.review_table_rows r
      where r.table_id = ${tableId}::uuid and r.tenant_id = ${this.tenantId}::uuid order by r.row_no`;
    const cells = await this.sql`
      select row_no, column_no, state, attempts, answer_status, answer_text, support_state,
             provenance, processing_coverage, answer_run_id, generator_version, error
      from app_private.review_table_cells
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by row_no, column_no`;
    return {
      table: mapTable(row),
      columns: columns.map((column) => ({
        columnNo: Number(column["column_no"]),
        question: text(column, "question"),
        mode: text(column, "mode") as ColumnMode,
      })),
      rows: docs.map((doc) => {
        const documentVersionId = textOrNull(doc, "document_version_id");
        const currentDocumentVersionId = textOrNull(doc, "current_version_id");
        return {
          rowNo: Number(doc["row_no"]),
          fileId: text(doc, "file_id"),
          fileName: textOrNull(doc, "file_name"),
          documentVersionId,
          currentDocumentVersionId,
          stale: documentVersionId === null || currentDocumentVersionId !== documentVersionId,
          staleReason: staleReasonOf({
            documentVersionId,
            currentDocumentVersionId,
            fileExists: doc["file_exists"] === true,
            pinReadable: doc["pin_readable"] === true,
          }),
        };
      }),
      // W21 (#17, #18): cells finished before grid-v3 are reported as what
      // they are, never repeated as stored (presentStoredCell).
      cells: cells.map((cell) =>
        presentStoredCell({
          rowNo: Number(cell["row_no"]),
          columnNo: Number(cell["column_no"]),
          state: text(cell, "state") as CellState,
          attempts: Number(cell["attempts"]),
          answerStatus: textOrNull(cell, "answer_status"),
          answerText: textOrNull(cell, "answer_text"),
          supportState: textOrNull(cell, "support_state") as SupportState | null,
          provenance: Array.isArray(cell["provenance"]) ? (cell["provenance"] as CellProvenance[]) : [],
          processingCoverage: cell["processing_coverage"] ?? null,
          answerRunId: textOrNull(cell, "answer_run_id"),
          generatorVersion: textOrNull(cell, "generator_version"),
          error: textOrNull(cell, "error"),
        }),
      ),
    };
  }

  async listTables(matterId: string | null, limit = 20): Promise<ReviewTableRow[]> {
    const rows =
      matterId === null
        ? await this.sql`
            select table_id::text as table_id, matter_id::text as matter_id, title, status,
                   options, created_at, finished_at, cancel_requested_at
            from app_private.review_tables where tenant_id = ${this.tenantId}::uuid
            order by created_at desc limit ${Math.max(1, Math.min(100, limit))}`
        : await this.sql`
            select table_id::text as table_id, matter_id::text as matter_id, title, status,
                   options, created_at, finished_at, cancel_requested_at
            from app_private.review_tables
            where tenant_id = ${this.tenantId}::uuid and matter_id = ${matterId}::uuid
            order by created_at desc limit ${Math.max(1, Math.min(100, limit))}`;
    return rows.map(mapTable);
  }

  /**
   * W21 (#17): counted the way presentStoredCell reports the cells — a done
   * "abstention" whose run did not end in ABSTAIN counts as failed, not done.
   */
  async progress(tableId: string): Promise<ReviewProgress> {
    const rows = await this.sql`
      select case when state = 'done' and support_state in ('abstained', 'no_evidence')
                       and answer_status is distinct from 'ABSTAIN'
                  then 'failed' else state end as state,
             count(*)::int as n
      from app_private.review_table_cells
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid group by 1`;
    const counts = new Map(rows.map((row) => [text(row, "state"), Number(row["n"])]));
    const get = (state: string): number => counts.get(state) ?? 0;
    return {
      total: [...counts.values()].reduce((sum, n) => sum + n, 0),
      pending: get("pending"),
      running: get("running"),
      done: get("done"),
      failed: get("failed"),
      cancelled: get("cancelled"),
    };
  }
}

function mapTable(row: SqlRow): ReviewTableRow {
  const options = row["options"];
  return {
    tableId: text(row, "table_id"),
    matterId: textOrNull(row, "matter_id"),
    title: text(row, "title"),
    status: text(row, "status") as ReviewTableRow["status"],
    options: options !== null && typeof options === "object" ? (options as ReviewTableRow["options"]) : {},
    createdAt: new Date(String(row["created_at"])).toISOString(),
    finishedAt:
      row["finished_at"] === null || row["finished_at"] === undefined
        ? null
        : new Date(String(row["finished_at"])).toISOString(),
    cancelRequested: row["cancel_requested_at"] !== null && row["cancel_requested_at"] !== undefined,
  };
}

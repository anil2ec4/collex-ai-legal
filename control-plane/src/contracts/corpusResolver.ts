/**
 * Corpus-backed citation resolver for B-13 (W14 L-FIX).
 *
 * `createContractsRouter` shipped in phase A with `UNWIRED_RESOLVER`, which
 * answers UNCERTAIN for every citation. That is the right default for a
 * deployment with nothing behind it, but it made the whole Atıf Denetim
 * Raporu a coverage statement: every row said "belirsiz" and the report could
 * not tell a real künye from an invented one, which is the only thing it
 * exists to do. This module is the resolver the audit was designed around.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HARD QUESTION: when may this resolver say "bulunamadı"?
 *
 * The three buckets are NOT symmetric (citationAudit.ts BUCKET_MEANING_TR):
 *
 *   FOUND      we resolved it.
 *   NOT_FOUND  a POSITIVE finding — the authority is not there. This is the
 *              hallucination signal, and it accuses the drafter.
 *   UNCERTAIN  a statement about OUR coverage. Says nothing about the source.
 *
 * A local corpus is a fragment of Turkish law. "I did not find it" is
 * therefore almost never evidence of absence, and a resolver that returned
 * NOT_FOUND on every miss would accuse a lawyer of inventing a citation
 * because we happen not to hold that court's decisions.
 *
 * THIS RESOLVER NEVER RETURNS `absent: true`, and the reason is measured.
 * The design began with one exception: "the law's in-force version IS in the
 * corpus and none of its chunks carries that article number" looked like a
 * real positive, on the premise that ingestion stores a whole instrument as
 * one document version. Checked against the demo corpus on 02.09.2026, the
 * premise does not hold: `kanun-6098` there carries articles
 * {1, 2, 12, 49, 50, 51} — a SENTETIK excerpt, not the law. "6098 m. 5"
 * would therefore have been reported "bulunamadı", i.e. this report would
 * have told a lawyer that a real provision looked invented.
 *
 * Nothing in the schema distinguishes a whole instrument from an excerpt, so
 * the premise is not checkable at runtime, so the conclusion may not be
 * drawn. The case still produces the most useful sentence available — which
 * law was read, as of which date, and which article was not in it — but in
 * the UNCERTAIN bucket, where a statement about OUR coverage belongs.
 * `absent: true` stays in the CitationResolution contract for a resolver
 * that CAN attest completeness (an official full-text source); this one
 * cannot, and does not pretend to.
 *
 * So every miss here is UNCERTAIN, with the reason spelled out:
 *   - a court decision we do not hold (holding SOME decisions of a chamber
 *     is not holding all of them — never a positive absence);
 *   - a law we do not hold at all, or do not hold as of that date;
 *   - a reference the parser could not pin down;
 *   - an unresolved short form ("anılan karar"), which by construction names
 *     nothing this resolver could look up (B-38);
 *   - a corpus that is unreachable, which must never read as "bulunamadı".
 *
 * CURRENCY. `exactPinLookup` applies the as-of temporal projection, so a hit
 * IS the version in force on the petition's date and the verdict is
 * IN_FORCE. A miss is never reported as REPEALED: this resolver cannot see a
 * version it did not retrieve, and "mülga" is a legal claim.
 * ---------------------------------------------------------------------------
 */

import { exactPinLookup, type ChunkProvenance } from "../store/chunkStore.js";
import type { ParsedReference } from "../retrieval/referenceParser.js";
import type { Sql } from "../store/db.js";
import { canonicalQuoteText } from "../drafting/quoteIntegrity.js";
import { sha256HexUtf8 } from "../verification/validator.js";
import type {
  AuditCitation,
  CitationResolution,
  CitationResolver,
} from "./citationAudit.js";

/** How many pinned chunks to pull per probe. */
const PIN_LIMIT = 8;
/** How many chunks of a law we read to decide "this article is not here". */
const LAW_PRESENCE_LIMIT = 400;

export const REASON_UNPARSED =
  "Bu atıf çözümlenemedi: kanun numarası, madde veya E./K. bilgisi eksik.";
export const REASON_SHORT_FORM =
  "Kısa biçim atıf (“anılan karar” gibi) bir künyeye bağlanamadı;" +
  " hangi kaynağı işaret ettiğini yazınız.";
// W15: bu üç cümle Atıf Denetim Raporunda avukatın gözüne çıplak çıkıyor.
// "Yerel korpus" kanonik sözlükte "bu bilgisayardaki hukuk kütüphanesi"dir;
// söylenen şeyin kendisi (bulunamamak ≠ yok olmak) değişmedi, yalnız
// anlaşılır hâle getirildi ve her cümlenin sonuna ne yapılacağı kondu.
export const REASON_COURT_DECISION =
  "Bu bilgisayardaki hukuk kütüphanesinde mahkeme kararlarının tamamı yoktur:" +
  " kararın burada bulunmaması, böyle bir kararın olmadığı anlamına GELMEZ." +
  " Künyeyi kararın kendisinden teyit edin.";
export const REASON_LAW_OUT_OF_SCOPE =
  "Bu mevzuatın dilekçe tarihindeki metni bu bilgisayardaki hukuk kütüphanesinde" +
  " yok; bu yüzden denetlenemedi. Maddeyi kaynağından teyit edin.";
/**
 * W17/c — a decision whose COURT the text does not name cannot be checked:
 * its E./K. numbers are reused by every chamber of every court. MEASURED: such
 * a citation came back "bulundu" on the strength of ANY court's decision that
 * shared the two numbers.
 */
export const REASON_COURT_UNKNOWN =
  "Bu kararın hangi mahkemeye ait olduğu metinden okunamadı. E./K. numaraları" +
  " her mahkemede ve her dairede yeniden kullanıldığı için mahkeme bilinmeden" +
  " karar denetlenemez; bu, kararın olmadığı anlamına GELMEZ. Künyeyi kararın" +
  " kendisinden teyit edin.";

/**
 * W17/c — an Anayasa Mahkemesi bireysel başvuru decision is cited by its
 * başvuru number and has no E./K. pair. MEASURED: "AYM, B. No: 2014/1234"
 * was answered with "E./K. bilgisi eksik", which reads as if the petition
 * had cited it wrongly.
 */
export const REASON_AYM_BASVURU =
  "Anayasa Mahkemesi bireysel başvuru kararları başvuru numarasıyla (B. No)" +
  " anılır; bu bilgisayardaki hukuk kütüphanesi bu kararları başvuru" +
  " numarasıyla denetleyemiyor. Bu, kararın olmadığı ya da atfın eksik olduğu" +
  " anlamına GELMEZ. Kararı başvuru numarasıyla kaynağından teyit edin.";

export const REASON_STORE_UNAVAILABLE =
  "Bu bilgisayardaki hukuk kütüphanesi açılamadığı için bu atıf denetlenemedi." +
  " Bu, atfın hatalı olduğu anlamına GELMEZ. ColleX'i kapatıp masaüstündeki" +
  " ColleX simgesine yeniden çift tıklayın, sonra raporu yeniden alın.";

/**
 * What the report prints when the law is in the local library and the article
 * is not in what we hold. Deliberately says "bulunamadı", never "yoktur": the
 * library may hold an excerpt (see the header). W15: "yerel korpus" wording
 * replaced by the canonical "bu bilgisayardaki hukuk kütüphanesi".
 */
export function absentArticleNote(legislationNo: string, articleNo: string): string {
  return (
    `${legislationNo} sayılı Kanunun dilekçe tarihinde yürürlükte olan metni bu` +
    ` bilgisayardaki hukuk kütüphanesinde var, ancak ${articleNo}. madde bu metinde` +
    ` bulunamadı. Kütüphane bir kanunun yalnız bölümlerini taşıyor olabilir —` +
    ` maddeyi kaynağından teyit edin.`
  );
}

/** "6098 sayılı Türk Borçlar Kanunu m. 299" from a resolved chunk. */
export function kunyeFor(provenance: ChunkProvenance, articleNo: string | undefined): string {
  const parts: string[] = [];
  if (provenance.legislationNo !== null && provenance.legislationNo !== "") {
    parts.push(`${provenance.legislationNo} sayılı`);
  }
  if (provenance.title !== null && provenance.title !== "") parts.push(provenance.title);
  if (parts.length === 0) parts.push(provenance.externalId);

  const decision: string[] = [];
  if (provenance.docketNo !== null && provenance.docketNo !== "") {
    decision.push(`E. ${provenance.docketNo}`);
  }
  if (provenance.decisionNo !== null && provenance.decisionNo !== "") {
    decision.push(`K. ${provenance.decisionNo}`);
  }
  if (decision.length > 0) parts.push(decision.join(", "));

  const article = articleNo ?? provenance.articleNo ?? undefined;
  if (article !== undefined && article !== null && article !== "") parts.push(`m. ${article}`);
  return parts.join(" ");
}

/**
 * Does the document attribute a quote to this citation, and does the resolved
 * passage carry it? The audit renders `quoteVerified`; the hash it compares
 * is produced here so the report's DOGRULANDI means the same thing the
 * evidence pipeline means by it (ADR-003 canonical text, sha256 over UTF-8).
 */
function quoteHashIfPresent(
  citation: AuditCitation,
  provenance: ChunkProvenance,
): string | undefined {
  if (citation.claimedQuote === undefined || citation.claimedQuote.trim() === "") return undefined;
  const claimed = canonicalQuoteText(citation.claimedQuote);
  if (claimed === "") return undefined;
  const passage = canonicalQuoteText(provenance.originalText);
  if (!passage.includes(claimed)) return undefined;
  return sha256HexUtf8(claimed);
}

/** The one corpus call this resolver makes; `exactPinLookup` in production. */
export type PinLookup = (
  references: readonly ParsedReference[],
  options: { asOf: string; limit: number; requireCourtMatch?: boolean },
) => Promise<Array<{ provenance: ChunkProvenance }>>;

export interface CorpusResolverOptions {
  sql?: Sql;
  /**
   * Test seam. Production passes `sql` and gets `exactPinLookup`; a unit
   * test passes this instead, because a fake `Sql` cannot emulate
   * postgres.js fragment composition (`visibilityFilter` calls the tag to
   * BUILD part of the query, so a queue of canned results is consumed by
   * fragments and the test measures the fake, not the resolver).
   */
  lookup?: PinLookup;
  pinLimit?: number;
}

/**
 * Build the resolver. Every failure inside is caught and becomes UNCERTAIN
 * with {@link REASON_STORE_UNAVAILABLE}: a broken database must degrade the
 * report's confidence, never its honesty, and must never look like a finding
 * against the citation.
 */
export function createCorpusCitationResolver(options: CorpusResolverOptions): CitationResolver {
  const { sql } = options;
  const pinLimit = options.pinLimit ?? PIN_LIMIT;
  const lookup: PinLookup =
    options.lookup ??
    ((references, opts) => {
      if (sql === undefined) throw new Error("corpus resolver needs sql or lookup");
      return exactPinLookup(sql, references, opts);
    });

  return async (citation: AuditCitation, asOf: string): Promise<CitationResolution | undefined> => {
    const parsed = citation.parsed;
    if (parsed === undefined) return { uncertainReason: REASON_UNPARSED };

    const hasLegislation = parsed.legislationNo !== undefined && parsed.legislationNo !== "";
    const hasDecision =
      parsed.docketNo !== undefined &&
      parsed.docketNo !== "" &&
      parsed.decisionNo !== undefined &&
      parsed.decisionNo !== "";

    if (parsed.kind === "short_form" && !hasLegislation && !hasDecision) {
      return { uncertainReason: REASON_SHORT_FORM };
    }
    if (parsed.docketKind === "basvuru" && !hasLegislation) {
      return { uncertainReason: REASON_AYM_BASVURU };
    }
    if (!hasLegislation && !hasDecision) return { uncertainReason: REASON_UNPARSED };
    // A decision is looked up only together with its court: "found" must
    // mean THIS court's decision (W17/c).
    if (hasDecision && !hasLegislation && (parsed.court === undefined || parsed.court === "")) {
      return { uncertainReason: REASON_COURT_UNKNOWN };
    }

    // `exactPinLookup` reads a LIST of references and pins on
    // legislation_no AND article_no only when it is given BOTH a
    // `legislation` reference and an `article` one — a lone article is
    // deliberately skipped there, because "madde 5" corpus-wide is
    // ambiguous. `pairArticlesWithTheirLaw` hands us one reference carrying
    // both facts, so the pair has to be rebuilt for the lane. Measured
    // 02.09.2026 against the demo corpus: without this, "5237 sayılı Kanun
    // m. 157" resolved to nothing and the row was reported NOT_FOUND —
    // accusing a real, present article of being invented, which is the worst
    // thing this report can do.
    const pinRefs: ParsedReference[] =
      parsed.kind === "article" && hasLegislation
        ? [
            {
              kind: "legislation",
              raw: parsed.raw,
              legislationNo: parsed.legislationNo as string,
            },
            parsed,
          ]
        : [parsed];

    try {
      const hits = await lookup(pinRefs, { asOf, limit: pinLimit, requireCourtMatch: true });
      const first = hits[0];
      if (first !== undefined) {
        const provenance = first.provenance;
        const quoteSha256 = quoteHashIfPresent(citation, provenance);
        return {
          kunye: kunyeFor(provenance, parsed.articleNo),
          documentVersionId: provenance.documentVersionId,
          // A pinned hit passed the as-of visibility filter by construction,
          // so it IS the version in force on the petition's date.
          currency: "IN_FORCE",
          ...(quoteSha256 !== undefined ? { quoteSha256 } : {}),
        };
      }

      // ---- a miss. Which kind of miss? ----------------------------------
      if (hasDecision) {
        // Never a positive absence: we hold a sample of case law, not all.
        return { uncertainReason: REASON_COURT_DECISION };
      }

      const articleNo = parsed.articleNo;
      if (articleNo === undefined || articleNo === "") {
        // A bare law reference that did not resolve: the law is not here.
        return { uncertainReason: REASON_LAW_OUT_OF_SCOPE };
      }

      // The ONE case that can be a positive finding: is the LAW here, in
      // force on this date, without that article?
      const lawChunks = await lookup(
        [{ kind: "legislation", raw: parsed.raw, legislationNo: parsed.legislationNo as string }],
        { asOf, limit: LAW_PRESENCE_LIMIT },
      );
      if (lawChunks.length === 0) return { uncertainReason: REASON_LAW_OUT_OF_SCOPE };

      // NOT the `absent: true` bucket — see absentArticleNote. The law is
      // here and the article is not in what we hold, which is worth saying
      // precisely, but it is not proof the article does not exist.
      return { uncertainReason: absentArticleNote(parsed.legislationNo as string, articleNo) };
    } catch {
      // Connection-class failure: our coverage is unknown, full stop.
      return { uncertainReason: REASON_STORE_UNAVAILABLE };
    }
  };
}

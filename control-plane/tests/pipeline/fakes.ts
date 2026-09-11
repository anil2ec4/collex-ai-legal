/**
 * Offline fakes for the answer-pipeline suite: a tiny synthetic Turkish corpus
 * plus port doubles. No database, no network, no clock.
 *
 * The texts here mirror the SHAPE of `evals/fixtures/corpus` (a statute with
 * two effective versions, two decisions that disagree, an injection-bearing
 * passage) without duplicating it, so these tests fail for pipeline reasons
 * rather than for corpus reasons.
 *
 * Not a `*.test.ts` file, so vitest does not collect it; `tsconfig.json`
 * covers `tests/**` so `npx tsc --noEmit` still typechecks it.
 */

import type { CanonicalTextPort } from "../../src/answer/evidencePack.js";
import type { RankedHit, RelationProvenance } from "../../src/retrieval/hybrid.js";
import type { ChunkProvenance } from "../../src/store/chunkStore.js";
import type {
  CorpusRetrievalPort,
  CorpusSearchRequest,
  CorpusSearchResult,
  VersionFacts,
  VersionFactsPort,
} from "../../src/pipeline/ports.js";
import { codePointLength, sha256HexUtf8 } from "../../src/verification/validator.js";

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** 5237 as in force before the (synthetic) amendment. */
export const TEXT_TCK_V1 =
  "MADDE 156 - (1) Bir hukuki ilişkiye dayanan alacağını tahsil amacıyla tehdit eden kişi cezalandırılır.\n" +
  "MADDE 157 - (1) Hileli davranışlarla bir kimseyi aldatıp, onun veya başkasının zararına olarak, " +
  "kendisine veya başkasına bir yarar sağlayan kişiye bir yıldan beş yıla kadar hapis ve beş bin güne " +
  "kadar adli para cezası verilir.\n";

/** 5237 as in force after the (synthetic) amendment: the penalty changed. */
export const TEXT_TCK_V2 =
  "MADDE 156 - (1) Bir hukuki ilişkiye dayanan alacağını tahsil amacıyla tehdit eden kişi cezalandırılır.\n" +
  "MADDE 157 - (1) Hileli davranışlarla bir kimseyi aldatıp, onun veya başkasının zararına olarak, " +
  "kendisine veya başkasına bir yarar sağlayan kişiye üç yıldan yedi yıla kadar hapis ve on bin güne " +
  "kadar adli para cezası verilir.\n";

/** A decision holding the offence made out. */
export const TEXT_DECISION_FOR =
  "T.C. YARGITAY 15. Ceza Dairesi Esas No: 2023/4521 Karar No: 2024/1187\n" +
  "GEREKÇE: Somut olayda hilenin sözleşmenin kurulması aşamasında bulunduğu, eylemin " +
  "5237 sayılı Kanun'un 157 nci maddesindeki dolandırıcılık suçunu oluşturduğu kabul edilmelidir.\n";

/** A decision on the same issue holding the opposite. */
export const TEXT_DECISION_AGAINST =
  "T.C. YARGITAY 15. Ceza Dairesi Esas No: 2023/7810 Karar No: 2024/2356\n" +
  "GEREKÇE: Somut olayda satışa konu araç gerçekte mevcut olup, uyuşmazlık hukuki nitelikte olduğundan " +
  "5237 sayılı Kanun'un 157 nci maddesindeki dolandırıcılık suçunun unsurları oluşmamıştır.\n";

export const VERSION_TCK_V1 = "docv-tck-v1";
export const VERSION_TCK_V2 = "docv-tck-v2";
export const VERSION_FOR = "docv-decision-for";
export const VERSION_AGAINST = "docv-decision-against";
export const VERSION_INJECTED = "docv-injected";

/** Code point span of `needle` inside `haystack` (throws when absent). */
export function spanOf(haystack: string, needle: string): { startChar: number; endChar: number } {
  const text = haystack.normalize("NFC");
  const target = needle.normalize("NFC");
  const index = text.indexOf(target);
  if (index < 0) throw new Error(`fixture passage not found: ${target.slice(0, 40)}`);
  const startChar = codePointLength(text.slice(0, index));
  return { startChar, endChar: startChar + codePointLength(target) };
}

export function quoteOf(text: string, marker: string): string {
  const line = text.split("\n").find((l) => l.includes(marker));
  if (line === undefined) throw new Error(`fixture line not found: ${marker}`);
  return line;
}

// ---------------------------------------------------------------------------
// Hit construction
// ---------------------------------------------------------------------------

export interface HitSpec {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  text: string;
  /** Passage to cite; must occur verbatim in `text`. */
  passage: string;
  title: string;
  source: string;
  documentType: string;
  legislationNo?: string;
  articleNo?: string;
  docketNo?: string;
  decisionNo?: string;
  decisionDate?: string;
  canonicalSourceUrl?: string;
  pinned?: boolean;
  fusedScore?: number;
  /** legal.documents.scope; "tenant" marks an uploaded document. */
  scope?: "public" | "tenant";
  /** Present when the hit is a citation-expansion product (unpinned, own lane). */
  citation?: { citedByChunkId: string; reference: string };
  /** Present when the hit arrived through the citator (relation) lane. */
  relation?: RelationProvenance;
}

export function makeHit(spec: HitSpec): RankedHit {
  const nfc = spec.text.normalize("NFC");
  const { startChar, endChar } = spanOf(nfc, spec.passage);
  const provenance: ChunkProvenance = {
    ...(spec.scope !== undefined ? { scope: spec.scope } : {}),
    chunkId: spec.chunkId,
    documentVersionId: spec.documentVersionId,
    documentId: spec.documentId,
    ordinal: 0,
    articleNo: spec.articleNo ?? null,
    paragraphNo: null,
    structuralPath: [],
    startChar,
    endChar,
    originalText: spec.passage,
    chunkSha256: sha256HexUtf8(spec.passage),
    versionSha256: sha256HexUtf8(nfc),
    normalizerVersion: "tr-normalize-v1",
    title: spec.title,
    source: spec.source,
    externalId: spec.documentId,
    canonicalSourceUrl: spec.canonicalSourceUrl ?? null,
    documentType: spec.documentType,
    legislationNo: spec.legislationNo ?? null,
    docketNo: spec.docketNo ?? null,
    decisionNo: spec.decisionNo ?? null,
    decisionDate: spec.decisionDate ?? null,
    publicationDate: null,
    tokenCount: null,
  };
  const fusedScore = spec.fusedScore ?? 0.05;
  return {
    chunkId: spec.chunkId,
    documentId: spec.documentId,
    documentVersionId: spec.documentVersionId,
    pinned: spec.pinned ?? false,
    ...(spec.pinned === true ? { pinReason: "exact-reference" } : {}),
    fusedScore,
    lanes:
      spec.citation !== undefined
        ? [{ lane: "citation", rank: 1, score: fusedScore }]
        : [{ lane: spec.pinned === true ? "exact" : "lexical", rank: 1, score: 1 }],
    provenance,
    ...(spec.citation !== undefined ? { citation: spec.citation } : {}),
    ...(spec.relation !== undefined ? { relation: spec.relation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Canonical hits used across the suite
// ---------------------------------------------------------------------------

export const QUOTE_157_V1 = quoteOf(TEXT_TCK_V1, "bir yıldan beş yıla");
export const QUOTE_157_V2 = quoteOf(TEXT_TCK_V2, "üç yıldan yedi yıla");
export const QUOTE_FOR = quoteOf(TEXT_DECISION_FOR, "oluşturduğu kabul edilmelidir");
export const QUOTE_AGAINST = quoteOf(TEXT_DECISION_AGAINST, "unsurları oluşmamıştır");

export function hitTck(version: "v1" | "v2"): RankedHit {
  const isV1 = version === "v1";
  return makeHit({
    chunkId: `chunk-tck-157-${version}`,
    documentId: "doc-tck",
    documentVersionId: isV1 ? VERSION_TCK_V1 : VERSION_TCK_V2,
    text: isV1 ? TEXT_TCK_V1 : TEXT_TCK_V2,
    passage: isV1 ? QUOTE_157_V1 : QUOTE_157_V2,
    title: "Türk Ceza Kanunu (sentetik)",
    source: "MEVZUAT",
    documentType: "kanun",
    legislationNo: "5237",
    articleNo: "157",
    canonicalSourceUrl: "https://www.mevzuat.gov.tr/sentetik/5237",
    pinned: true,
    fusedScore: 0,
  });
}

export function hitDecisionFor(): RankedHit {
  return makeHit({
    chunkId: "chunk-decision-for",
    documentId: "doc-decision-for",
    documentVersionId: VERSION_FOR,
    text: TEXT_DECISION_FOR,
    passage: QUOTE_FOR,
    title: "Yargıtay 15. CD E. 2023/4521 K. 2024/1187 (sentetik)",
    source: "BEDESTEN",
    documentType: "yargitay_karari",
    docketNo: "2023/4521",
    decisionNo: "2024/1187",
    decisionDate: "2024-03-12",
    fusedScore: 0.04,
  });
}

export function hitDecisionAgainst(): RankedHit {
  return makeHit({
    chunkId: "chunk-decision-against",
    documentId: "doc-decision-against",
    documentVersionId: VERSION_AGAINST,
    text: TEXT_DECISION_AGAINST,
    passage: QUOTE_AGAINST,
    title: "Yargıtay 15. CD E. 2023/7810 K. 2024/2356 (sentetik)",
    source: "BEDESTEN",
    documentType: "yargitay_karari",
    docketNo: "2023/7810",
    decisionNo: "2024/2356",
    decisionDate: "2024-06-24",
    fusedScore: 0.03,
  });
}

/**
 * A decision body carrying an instruction-shaped payload inside its text.
 *
 * The quoted passage ADDRESSES Q_APPLICATION (the same words a real decision
 * on that fact pattern uses) and then carries the payload, so the injection
 * suite exercises what it always did — the payload is byte-exact evidence,
 * rendered only inside a quotation — and not the coverage gate: a passage
 * that were ONLY the payload shares no content word with the question and
 * would now be set aside as QUESTION_NOT_COVERED before it was ever quoted.
 */
export function injectedDocument(payload: string): { text: string; hit: RankedHit } {
  const passage =
    "GEREKÇE: Araç satışında kapora alındıktan sonra aracın teslim edilmemesi " +
    `dolandırıcılık suçunu oluşturur. ${payload}`;
  const text =
    "T.C. YARGITAY 4. Hukuk Dairesi Esas No: 2023/1234 Karar No: 2023/5678\n" +
    `${passage}\n` +
    "Bu nedenle temyiz istemi incelenmiştir.\n";
  return {
    text,
    hit: makeHit({
      chunkId: "chunk-injected",
      documentId: "doc-injected",
      documentVersionId: VERSION_INJECTED,
      text,
      passage,
      title: "Yargıtay 4. HD (sentetik, enjeksiyon taşıyan)",
      source: "BEDESTEN",
      documentType: "yargitay_karari",
      docketNo: "2023/1234",
      decisionNo: "2023/5678",
      decisionDate: "2023-09-01",
      fusedScore: 0.04,
    }),
  };
}

// ---------------------------------------------------------------------------
// Uploaded document (file scope, W12) — the lawyer's own text, not law
// ---------------------------------------------------------------------------

/** intake fileId shape (sha256[:16]); what `filters.fileIds` carries. */
export const UPLOAD_FILE_ID = "a1b2c3d4e5f60718";
export const VERSION_UPLOAD = "docv-upload-kira";
export const TEXT_UPLOAD =
  "KİRA SÖZLEŞMESİ (taslak)\n" +
  "Madde 7 - Depozito iadesi: kiracı, kira sözleşmesi sona erdiğinde ve anahtar teslim " +
  "edildiğinde depozitonun on beş gün içinde iadesini talep edebilir.\n";
export const QUOTE_UPLOAD = quoteOf(TEXT_UPLOAD, "Depozito iadesi");

/** The question the corpus cannot answer and the upload can. */
export const Q_UPLOAD = "Kira sözleşmesinde depozito iadesi ne zaman yapılır?";

/** A tenant-scoped (uploaded) passage as the store returns it under file scope. */
export function hitUpload(): RankedHit {
  return makeHit({
    chunkId: "chunk-upload-7",
    documentId: "doc-upload",
    documentVersionId: VERSION_UPLOAD,
    text: TEXT_UPLOAD,
    passage: QUOTE_UPLOAD,
    title: "kira_sozlesmesi_taslak.docx",
    source: "UPLOAD",
    documentType: "sozlesme",
    scope: "tenant",
    fusedScore: 0.05,
  });
}

/** The standard texts plus the upload's canonical text. */
export function uploadTexts(): MapTextPort {
  return standardTexts(new Map([[VERSION_UPLOAD, TEXT_UPLOAD]]));
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type CorpusHandler = (request: CorpusSearchRequest) => CorpusSearchResult;

/** Records every request; returns whatever the handler decides. Never throws. */
export class StubCorpus implements CorpusRetrievalPort {
  readonly name = "stub-corpus";
  readonly calls: CorpusSearchRequest[] = [];

  constructor(private readonly handler: CorpusHandler) {}

  async search(request: CorpusSearchRequest): Promise<CorpusSearchResult> {
    this.calls.push(request);
    return this.handler(request);
  }
}

/** A port that violates the no-throw contract, to prove the pipeline survives. */
export class BrokenCorpus implements CorpusRetrievalPort {
  readonly name = "broken-corpus";
  async search(): Promise<CorpusSearchResult> {
    throw new Error("connection pool is closed");
  }
}

export function ok(hits: RankedHit[]): CorpusSearchResult {
  return { status: "ok", hits, warnings: [] };
}

export function laneError(message: string): CorpusSearchResult {
  return { status: "error", hits: [], warnings: [], error: message };
}

export class MapTextPort implements CanonicalTextPort {
  constructor(private readonly texts: ReadonlyMap<string, string>) {}
  async getCanonicalText(documentVersionId: string): Promise<string | undefined> {
    return this.texts.get(documentVersionId);
  }
}

export function standardTexts(extra: ReadonlyMap<string, string> = new Map()): MapTextPort {
  return new MapTextPort(
    new Map<string, string>([
      [VERSION_TCK_V1, TEXT_TCK_V1],
      [VERSION_TCK_V2, TEXT_TCK_V2],
      [VERSION_FOR, TEXT_DECISION_FOR],
      [VERSION_AGAINST, TEXT_DECISION_AGAINST],
      ...extra,
    ]),
  );
}

export function factsPort(entries: readonly VersionFacts[]): VersionFactsPort {
  const byId = new Map(entries.map((e) => [e.documentVersionId, e]));
  return {
    async fetch(ids: readonly string[]): Promise<Map<string, VersionFacts>> {
      const out = new Map<string, VersionFacts>();
      for (const id of ids) {
        const facts = byId.get(id);
        if (facts !== undefined) out.set(id, facts);
      }
      return out;
    },
  };
}

export const STANDARD_FACTS: readonly VersionFacts[] = Object.freeze([
  { documentVersionId: VERSION_TCK_V1, effectiveFrom: "2005-06-01", effectiveTo: "2026-01-15" },
  { documentVersionId: VERSION_TCK_V2, effectiveFrom: "2026-01-15" },
  { documentVersionId: VERSION_FOR, court: "Yargıtay 15. Ceza Dairesi" },
  { documentVersionId: VERSION_AGAINST, court: "Yargıtay 15. Ceza Dairesi" },
  { documentVersionId: VERSION_INJECTED, court: "Yargıtay 4. Hukuk Dairesi" },
]);

/** Deterministic clock/id set so a whole run is byte-reproducible. */
export function deterministicOptions(): {
  now: () => string;
  monotonic: () => number;
  newRunId: () => string;
  today: () => string;
} {
  let tick = 0;
  let runs = 0;
  return {
    now: () => "2026-06-01T00:00:00.000Z",
    monotonic: () => (tick += 1),
    newRunId: () => `run-${(runs += 1)}`,
    today: () => "2026-06-01",
  };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const Q_NORM_CONTENT = "5237 sayılı Kanun m. 157 dolandırıcılık suçunun cezası nedir?";
export const Q_APPLICATION =
  "Araç satışında kapora alındıktan sonra teslim edilmemesi 5237 sayılı Kanun m. 157 " +
  "dolandırıcılık suçunu oluşturur mu?";
export const Q_UNANSWERABLE =
  "Uzay hukukunda yörünge çarpışma sigortası için hangi tahkim usulü uygulanır?";

// ---------------------------------------------------------------------------
// W14 B-07 — a BARE law reference pins the whole statute
//
// Reproduces DAILYFLOW §2 (02.09.2026): "kira sozlesmesinde depozito iadesi
// ne zaman yapilir" abstained correctly; the same question plus the three
// words a Turkish lawyer writes in every sentence — "tbk ya gore" — came back
// KISMİ with eight pinned haksız fiil / tazminat passages and `ratio 0`.
// ---------------------------------------------------------------------------

/** 6098, two articles that have nothing to do with a rental deposit. */
export const TEXT_TBK =
  "6098 sayılı Türk Borçlar Kanunu (SENTETİK ALINTI)\n" +
  "MADDE 49 - (1) Kusurlu ve hukuka aykırı bir fiille başkasına zarar veren, bu zararı " +
  "gidermekle yükümlüdür.\n" +
  "MADDE 51 - (1) Hâkim, tazminatın kapsamını ve ödenme biçimini, durumun gereğini ve " +
  "özellikle kusurun ağırlığını göz önüne alarak belirler.\n";

export const VERSION_TBK = "docv-tbk-v1";
export const QUOTE_TBK_49 = quoteOf(TEXT_TBK, "gidermekle yükümlüdür");
export const QUOTE_TBK_51 = quoteOf(TEXT_TBK, "kusurun ağırlığını");

function hitTbk(article: "49" | "51", pinned: boolean): RankedHit {
  return makeHit({
    chunkId: `chunk-tbk-${article}`,
    documentId: "doc-tbk",
    documentVersionId: VERSION_TBK,
    text: TEXT_TBK,
    passage: article === "49" ? QUOTE_TBK_49 : QUOTE_TBK_51,
    title: "Türk Borçlar Kanunu (sentetik)",
    source: "MEVZUAT",
    documentType: "kanun",
    legislationNo: "6098",
    articleNo: article,
    canonicalSourceUrl: "https://www.mevzuat.gov.tr/sentetik/6098",
    pinned,
    fusedScore: 0,
  });
}

/** What `exactPinLookup` returns for a BARE "TBK": every chunk of the law. */
export function tbkWholeLawPinned(): RankedHit[] {
  return [hitTbk("49", true), hitTbk("51", true)];
}

/** What it returns for "TBK m. 49": only that article is pinned. */
export function tbkArticle49Pinned(): RankedHit[] {
  return [hitTbk("49", true), hitTbk("51", false)];
}

export function tbkTexts(): ReadonlyMap<string, string> {
  return new Map([[VERSION_TBK, TEXT_TBK]]);
}

/** The audited phrasing, verbatim: no diacritics, bare law abbreviation. */
export const Q_BARE_LAW =
  "kira sozlesmesinde depozito iadesi ne zaman yapilir tbk ya gore";

/** The same law, ARTICLE level — the behaviour that must not change. */
export const Q_ARTICLE_LEVEL =
  "TBK m. 49 uyarınca haksız fiil sorumluluğunun genel kuralı nedir?";

// ---------------------------------------------------------------------------
// W14 B-09 — the amending instrument, as the citator (relation) lane hands it
// ---------------------------------------------------------------------------

export const TEXT_TORBA_7999 =
  "7999 sayılı Kanun (SENTETİK ALINTI)\n" +
  'MADDE 1 - (1) 5237 sayılı Türk Ceza Kanununun 157 nci maddesinin birinci fıkrasında ' +
  'yer alan "bir yıldan beş yıla kadar" ibaresi "üç yıldan yedi yıla kadar" şeklinde ' +
  "değiştirilmiştir.\n";

export const VERSION_TORBA = "docv-torba-7999";
export const QUOTE_TORBA = quoteOf(TEXT_TORBA_7999, "değiştirilmiştir");

/** The amending law, reached from the amended provision by a stored AMENDS edge. */
export function hitAmendingLaw(viaChunkId: string): RankedHit {
  const relation: RelationProvenance = {
    direction: "inbound",
    kind: "AMENDS",
    role: "amending",
    relationId: "rel-7999-5237-157",
    resolutionStatus: "resolved",
    confidence: 1,
    resolverVersion: "fixture-resolver-1",
    viaChunkId,
    targetLegislationNo: "5237",
    targetArticleNo: "157",
  };
  return makeHit({
    chunkId: "chunk-torba-7999-1",
    documentId: "doc-torba",
    documentVersionId: VERSION_TORBA,
    text: TEXT_TORBA_7999,
    passage: QUOTE_TORBA,
    title: "7999 sayılı Kanun (sentetik)",
    source: "MEVZUAT",
    documentType: "kanun",
    legislationNo: "7999",
    articleNo: "1",
    canonicalSourceUrl: "https://www.mevzuat.gov.tr/sentetik/7999",
    fusedScore: 0.02,
    relation,
  });
}

export function torbaTexts(): ReadonlyMap<string, string> {
  return new Map([[VERSION_TORBA, TEXT_TORBA_7999]]);
}

/**
 * DAILYFLOW §2 question 3, verbatim in shape: an as-of date AND a "which text
 * applies" phrasing. Measured 02.09.2026: it came back TAM and finalizable
 * with the v1 text alone.
 */
export const Q_TEMPORAL =
  "TCK m. 157 bakımından 2024 yılında işlenen bir suçta değişiklik öncesi mi " +
  "sonrası mı uygulanır?";

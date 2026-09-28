/**
 * Collect every statute citation the lawyer's OWN material in one matter
 * carries: the drafts filed under it, the stored answers linked to it and the
 * uploaded documents' parsed references.
 *
 * Every parse goes through a parser the product already trusts:
 *   - draft paragraphs and answer questions → `extractAuditCitations`
 *     (citationAudit.ts: prose-collapsed `parseReferences` +
 *     `pairArticlesWithTheirLaw`, the same reader the Atıf Denetimi uses);
 *   - draft/answer evidence → the `legislationNo` / `article` fields the
 *     evidence record already carries (no re-parse of a quote);
 *   - uploads → `analysis.references` written at intake by the Python
 *     `legal_reference` parser (intake/analysis.py), read, never re-derived.
 *
 * A citation is keyed on (instrument type, law number, article). Case-law
 * citations are not legislation and are skipped. A record that could not be
 * read is LISTED in `unreadSources`, never silently dropped: a watch list that
 * quietly omits a draft would read as "nothing of yours cites this".
 */

import { extractAuditCitations } from "../contracts/citationAudit.js";
import { lookupByNumber } from "../retrieval/referenceParser.js";
import type { MatterItem } from "../matters/types.js";
import { articleKey, type ArticleKind } from "./textSignals.js";

/** Legislation types the watch can resolve through `search_mevzuat`. */
export type WatchInstrument = "KANUN" | "KHK" | "CB_KARARNAME";

export const INSTRUMENT_LABEL_TR: Readonly<Record<WatchInstrument, string>> = Object.freeze({
  KANUN: "Kanun",
  KHK: "Kanun Hükmünde Kararname",
  CB_KARARNAME: "Cumhurbaşkanlığı Kararnamesi",
});

export type WatchSourceKind = "draft" | "answer" | "file";

export const SOURCE_KIND_LABEL_TR: Readonly<Record<WatchSourceKind, string>> = Object.freeze({
  draft: "Taslak",
  answer: "Araştırma",
  file: "Belge",
});

/** Where one citation was found. */
export interface WatchCitationSource {
  kind: WatchSourceKind;
  kindLabel: string;
  itemId: string;
  refId: string;
  title: string;
  /** Distinct spellings this record used (at most MAX_SPELLINGS). */
  spellings: string[];
  count: number;
}

export interface WatchCitation {
  /** `${instrument}:${lawNo}|${articleKey or "-"}` */
  key: string;
  /** `${instrument}:${lawNo}` — the unit a check resolves. */
  lawKey: string;
  instrument: WatchInstrument;
  lawNo: string;
  /** null = the law is cited without an article. */
  article: string | null;
  articleKind: ArticleKind;
  /** Human label: "6098 sayılı Türk Borçlar Kanunu m. 474". */
  label: string;
  /** From the abbreviation table; true = the instrument is repealed. */
  mulga: boolean;
  sources: WatchCitationSource[];
  /** Total records citing it (sources may be capped). */
  sourcesTotal: number;
}

export interface UnreadSource {
  kind: WatchSourceKind;
  kindLabel: string;
  itemId: string;
  refId: string;
  title: string;
  reason: string;
}

export interface CollectedCitations {
  citations: WatchCitation[];
  unreadSources: UnreadSource[];
  /** How many draft/answer/file records were read. */
  sourcesRead: number;
  /** True when more citations existed than MAX_WATCH_CITATIONS. */
  truncated: boolean;
}

/** Ports (structural; the API's shared stores satisfy them). */
export interface WatchDraftPort {
  get(draftId: string): unknown;
  warm?(draftId: string): Promise<void>;
}
export interface WatchAnswerPort {
  get(runId: string): unknown;
  warm?(runId: string): Promise<void>;
}
export interface WatchFilePort {
  showFile(
    fileId: string,
    tenantId?: string,
    window?: { offset: number; limit: number },
  ): Promise<unknown>;
}

export interface CollectDeps {
  drafts?: WatchDraftPort;
  answers?: WatchAnswerPort;
  files?: WatchFilePort;
}

/** Ceilings: a matter is a few dozen records; these only stop a runaway. */
export const MAX_WATCH_SOURCES = 200;
export const MAX_WATCH_CITATIONS = 300;
export const MAX_SOURCES_PER_CITATION = 20;
const MAX_SPELLINGS = 5;

export const UNREAD_REASON_TR = {
  STORE_ABSENT: "Bu kayıt türünün deposu bu sunucuda bağlı değil; atıfları okunamadı.",
  NOT_FOUND: "Kayıt depoda bulunamadı (silinmiş olabilir); atıfları okunamadı.",
  READ_FAILED: "Kayıt okunurken hata oluştu; atıfları okunamadı.",
  LIMIT: `Bir kontrolde en çok ${MAX_WATCH_SOURCES} kayıt okunur; bu kayıt okunmadı.`,
} as const;

// ---------------------------------------------------------------------------
// Narrowing helpers (every stored record is untrusted data)
// ---------------------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const LAW_NO_RE = /^[0-9]{1,5}$/u;

/**
 * The instrument type a citation's own words name. "375 sayılı KHK m. 5" is a
 * KHK; "1 sayılı Cumhurbaşkanlığı Kararnamesi" a CBK; anything else a Kanun.
 * Numbers are reused across instrument types, so the type is part of the key.
 */
export function instrumentOf(raw: string): WatchInstrument {
  if (/\bKHK\b|kanun\s+hükmünde\s+kararname/iu.test(raw)) return "KHK";
  if (/\bCBK\b|cumhurbaşkanlığı\s+kararname/iu.test(raw)) return "CB_KARARNAME";
  return "KANUN";
}

/**
 * Normalise an article as written ("474", "m. 474", "68/a", "Geçici 3") into
 * (kind, number); undefined when it is not an article number at all.
 */
export function normaliseArticle(
  raw: string | undefined,
  kindHint?: string,
): { kind: ArticleKind; number: string } | undefined {
  if (raw === undefined) return undefined;
  const text = raw.normalize("NFC").trim();
  const match =
    /^(?:(ek|geçici|gecici|mükerrer|mukerrer)\s+)?(?:(?:m|md|madde)\.?\s*)?(\d{1,4}(?:\/[a-zçğıöşü])?)\b/iu.exec(
      text,
    );
  if (match === null || match[2] === undefined) return undefined;
  const written = (match[1] ?? kindHint ?? "").toLocaleLowerCase("tr-TR");
  const kind: ArticleKind = written.startsWith("ek")
    ? "ek"
    : written.startsWith("ge")
      ? "gecici"
      : written.startsWith("mü") || written.startsWith("mu")
        ? "mukerrer"
        : "madde";
  return { kind, number: match[2].toLocaleUpperCase("tr-TR") };
}

const ARTICLE_KIND_LABEL: Readonly<Record<ArticleKind, string>> = Object.freeze({
  madde: "m.",
  ek: "ek m.",
  gecici: "geçici m.",
  mukerrer: "mükerrer m.",
});

function lawName(instrument: WatchInstrument, lawNo: string): string {
  const known = instrument === "KANUN" ? lookupByNumber(lawNo) : undefined;
  if (known !== undefined) return `${lawNo} sayılı ${known.canonicalName}`;
  return `${lawNo} sayılı ${INSTRUMENT_LABEL_TR[instrument]}`;
}

export function citationLabel(
  instrument: WatchInstrument,
  lawNo: string,
  article: { kind: ArticleKind; number: string } | undefined,
): string {
  const base = lawName(instrument, lawNo);
  return article === undefined ? base : `${base} ${ARTICLE_KIND_LABEL[article.kind]} ${article.number}`;
}

interface Found {
  instrument: WatchInstrument;
  lawNo: string;
  article?: { kind: ArticleKind; number: string };
  spelling: string;
}

class Accumulator {
  readonly byKey = new Map<string, WatchCitation>();
  truncated = false;

  add(source: Omit<WatchCitationSource, "spellings" | "count">, found: readonly Found[]): void {
    // One record's citations are grouped first, so a draft that cites
    // "TBK m. 474" five times is one source with count 5.
    const local = new Map<string, { found: Found; spellings: string[]; count: number }>();
    for (const item of found) {
      if (!LAW_NO_RE.test(item.lawNo)) continue;
      const key = citationKeyOf(item);
      const entry = local.get(key);
      if (entry === undefined) {
        local.set(key, { found: item, spellings: [item.spelling], count: 1 });
      } else {
        entry.count += 1;
        if (!entry.spellings.includes(item.spelling) && entry.spellings.length < MAX_SPELLINGS) {
          entry.spellings.push(item.spelling);
        }
      }
    }
    for (const [key, entry] of local) {
      let citation = this.byKey.get(key);
      if (citation === undefined) {
        if (this.byKey.size >= MAX_WATCH_CITATIONS) {
          this.truncated = true;
          continue;
        }
        const { instrument, lawNo, article } = entry.found;
        citation = {
          key,
          lawKey: `${instrument}:${lawNo}`,
          instrument,
          lawNo,
          article: article === undefined ? null : article.number,
          articleKind: article?.kind ?? "madde",
          label: citationLabel(instrument, lawNo, article),
          mulga: instrument === "KANUN" && lookupByNumber(lawNo)?.mulga === true,
          sources: [],
          sourcesTotal: 0,
        };
        this.byKey.set(key, citation);
      }
      citation.sourcesTotal += 1;
      if (citation.sources.length < MAX_SOURCES_PER_CITATION) {
        citation.sources.push({ ...source, spellings: entry.spellings, count: entry.count });
      }
    }
  }
}

function citationKeyOf(found: Found): string {
  const art = found.article === undefined ? "-" : articleKey(found.article.kind, found.article.number);
  return `${found.instrument}:${found.lawNo}|${art}`;
}

/** Statute citations in free prose (a draft paragraph, a question). */
export function citationsInProse(text: string): Found[] {
  const out: Found[] = [];
  if (text.trim() === "") return out;
  for (const citation of extractAuditCitations(text)) {
    const parsed = citation.parsed;
    if (parsed === undefined) continue;
    if (parsed.kind !== "legislation" && parsed.kind !== "article" && parsed.kind !== "short_form") {
      continue;
    }
    const lawNo = parsed.legislationNo ?? "";
    if (lawNo === "") continue;
    const article =
      parsed.kind === "legislation" ? undefined : normaliseArticle(parsed.articleNo, parsed.articleKind);
    if (parsed.kind !== "legislation" && article === undefined) continue;
    const forms = citation.rawForms ?? [citation.raw];
    for (let i = 0; i < citation.count; i += 1) {
      const spelling = forms[Math.min(i, forms.length - 1)] ?? citation.raw;
      out.push({ instrument: instrumentOf(spelling), lawNo, ...(article !== undefined ? { article } : {}), spelling });
    }
  }
  return out;
}

/** Legislation fields an evidence record already carries. */
function citationFromEvidence(entry: Record<string, unknown>): Found | undefined {
  const lawNo = str(entry["legislationNo"])?.trim() ?? "";
  if (!LAW_NO_RE.test(lawNo)) return undefined;
  const source = str(entry["source"]) ?? "";
  if (source === "UPLOAD") return undefined;
  const articleRaw = str(entry["article"]);
  const article = articleRaw !== undefined && articleRaw.trim() !== "" ? normaliseArticle(articleRaw) : undefined;
  const label = str(entry["label"]) ?? str(entry["title"]) ?? lawNo;
  return {
    instrument: instrumentOf(`${label} ${str(entry["title"]) ?? ""}`),
    lawNo,
    ...(article !== undefined ? { article } : {}),
    spelling: label,
  };
}

// ---------------------------------------------------------------------------
// Per-record readers
// ---------------------------------------------------------------------------

function draftCitations(draft: Record<string, unknown>): Found[] {
  const found: Found[] = [];
  for (const entry of arr(draft["evidence"])) {
    const record = rec(entry);
    if (record === undefined) continue;
    const citation = citationFromEvidence(record);
    if (citation !== undefined) found.push(citation);
  }
  // The lawyer's own paragraphs: what the petition actually cites. Joined as
  // separate paragraphs so a citation never spans two of them.
  const paragraphs: string[] = [];
  for (const section of arr(draft["sections"])) {
    for (const paragraph of arr(rec(section)?.["paragraphs"])) {
      const text = str(rec(paragraph)?.["text"]);
      if (text !== undefined) paragraphs.push(text);
    }
  }
  for (const text of paragraphs) found.push(...citationsInProse(text));
  return found;
}

function answerCitations(stored: Record<string, unknown>): Found[] {
  const result = rec(stored["result"]) ?? stored;
  const found: Found[] = [];
  // Only the evidence the answer's claims actually rest on.
  const used = new Set<string>();
  for (const claim of arr(result["claims"])) {
    for (const id of arr(rec(claim)?.["evidenceIds"])) {
      if (typeof id === "string") used.add(id);
    }
  }
  for (const entry of arr(result["evidence"])) {
    const record = rec(entry);
    if (record === undefined) continue;
    const id = str(record["evidenceId"]);
    if (id === undefined || !used.has(id)) continue;
    const citation = citationFromEvidence(record);
    if (citation !== undefined) found.push(citation);
  }
  const question = str(stored["question"]) ?? str(result["question"]) ?? "";
  found.push(...citationsInProse(question));
  return found;
}

function fileCitations(detail: Record<string, unknown>): Found[] {
  const analysis = rec(detail["analysis"]);
  const found: Found[] = [];
  for (const entry of arr(analysis?.["references"])) {
    const record = rec(entry);
    if (record === undefined) continue;
    const lawNo = str(record["legislationNo"])?.trim() ?? "";
    if (!LAW_NO_RE.test(lawNo)) continue;
    // A case citation that happens to name a law is not a statute citation.
    if (str(record["docketNo"]) !== undefined || str(record["decisionNo"]) !== undefined) continue;
    const raw = str(record["raw"]) ?? lawNo;
    const articleRaw = str(record["articleNo"]);
    const article = articleRaw !== undefined ? normaliseArticle(articleRaw) : undefined;
    if (articleRaw !== undefined && article === undefined) continue;
    const count = typeof record["count"] === "number" && record["count"] > 0 ? Math.min(record["count"], 1000) : 1;
    for (let i = 0; i < count; i += 1) {
      found.push({ instrument: instrumentOf(raw), lawNo, ...(article !== undefined ? { article } : {}), spelling: raw });
    }
  }
  return found;
}

function itemTitle(item: MatterItem): string {
  const payload = item.payload;
  const pick = (key: string): string => (typeof payload[key] === "string" ? String(payload[key]) : "");
  switch (item.kind) {
    case "file":
      return pick("fileName") || pick("name") || item.refId || "";
    case "answer":
      return pick("question") || item.refId || "";
    case "draft":
      return pick("title") || item.refId || "";
    default:
      return "";
  }
}

/**
 * Read the citations of every draft/answer/file item of one matter. Items
 * are visited in the matter store's order; the result's citations are
 * ordered by law number, then article, so two reads of the same matter
 * produce the same list.
 */
export async function collectMatterCitations(
  items: readonly MatterItem[],
  deps: CollectDeps,
): Promise<CollectedCitations> {
  const acc = new Accumulator();
  const unreadSources: UnreadSource[] = [];
  let sourcesRead = 0;
  let visited = 0;

  for (const item of items) {
    if (item.kind !== "draft" && item.kind !== "answer" && item.kind !== "file") continue;
    const kind: WatchSourceKind = item.kind;
    const refId = item.refId ?? "";
    const base = {
      kind,
      kindLabel: SOURCE_KIND_LABEL_TR[kind],
      itemId: item.itemId,
      refId,
      title: itemTitle(item),
    };
    const unread = (reason: string): void => {
      unreadSources.push({ ...base, reason });
    };
    if (refId === "") {
      unread(UNREAD_REASON_TR.NOT_FOUND);
      continue;
    }
    visited += 1;
    if (visited > MAX_WATCH_SOURCES) {
      unread(UNREAD_REASON_TR.LIMIT);
      continue;
    }
    try {
      if (kind === "draft") {
        if (deps.drafts === undefined) {
          unread(UNREAD_REASON_TR.STORE_ABSENT);
          continue;
        }
        await deps.drafts.warm?.(refId);
        const draft = rec(deps.drafts.get(refId));
        if (draft === undefined) {
          unread(UNREAD_REASON_TR.NOT_FOUND);
          continue;
        }
        const title = str(draft["title"]);
        acc.add(title !== undefined && base.title === refId ? { ...base, title } : base, draftCitations(draft));
      } else if (kind === "answer") {
        if (deps.answers === undefined) {
          unread(UNREAD_REASON_TR.STORE_ABSENT);
          continue;
        }
        await deps.answers.warm?.(refId);
        const stored = rec(deps.answers.get(refId));
        if (stored === undefined) {
          unread(UNREAD_REASON_TR.NOT_FOUND);
          continue;
        }
        acc.add(base, answerCitations(stored));
      } else {
        if (deps.files === undefined) {
          unread(UNREAD_REASON_TR.STORE_ABSENT);
          continue;
        }
        const detail = rec(await deps.files.showFile(refId, undefined, { offset: 0, limit: 1 }));
        if (detail === undefined) {
          unread(UNREAD_REASON_TR.NOT_FOUND);
          continue;
        }
        const name = str(detail["name"]);
        acc.add(name !== undefined && name !== "" && base.title === refId ? { ...base, title: name } : base, fileCitations(detail));
      }
      sourcesRead += 1;
    } catch {
      unread(UNREAD_REASON_TR.READ_FAILED);
    }
  }

  const citations = [...acc.byKey.values()].sort(compareCitations);
  return { citations, unreadSources, sourcesRead, truncated: acc.truncated };
}

/** Numeric law order, then article order; stable across reads. */
export function compareCitations(a: WatchCitation, b: WatchCitation): number {
  const law = Number(a.lawNo) - Number(b.lawNo);
  if (law !== 0) return law;
  if (a.instrument !== b.instrument) return a.instrument < b.instrument ? -1 : 1;
  if (a.article === null || b.article === null) {
    if (a.article === b.article) return 0;
    return a.article === null ? -1 : 1;
  }
  const na = Number.parseInt(a.article, 10);
  const nb = Number.parseInt(b.article, 10);
  if (na !== nb) return na - nb;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

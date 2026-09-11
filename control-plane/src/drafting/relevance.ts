/**
 * Relevance gate for draft evidence (W12-FIX2, review P1-1b).
 *
 * Reviewer R1's walkthrough: a kira tazminat CEVAP DİLEKÇESİ drafted from a
 * TCK m.157 research came out arguing TCK m.155/156/158/159/168. W12-FIX
 * removed the non-pinned neighbours (CONTEXT_ONLY); the PINNED criminal
 * provision still seeded a hukuk davası dilekçesi because nothing compared
 * the evidence with the MATTER. This module does, deterministically:
 *
 *   1. DOMAIN — every template carries a `domain` (templates.ts); every
 *      evidence entry gets one from its legislation number, court, title or
 *      source family (`evidenceDomain`). A criminal provision (5237/5271,
 *      ceza daireleri) is a DOMAIN_MISMATCH for a hukuk davası template.
 *   2. LEXICAL OVERLAP — the entry's quote + title are measured against the
 *      matter text (talepler + olaylar + konu + instructions) with the SAME
 *      tokenizer/stemmer the answer coverage gate uses (answer/coverage.ts,
 *      `mapPassageCoverage`). No shared content word = NOT_RELEVANT.
 *   3. EXPLICIT REFERENCE — an entry the matter text itself cites by
 *      (kanun no, madde) or esas no is ALWAYS used (the composer's existing
 *      `matterReferences` pin). Nothing the lawyer named is ever dropped.
 *
 * Verdict per entry: "referenced" | "relevant" | "DOMAIN_MISMATCH" |
 * "NOT_RELEVANT". The two negative verdicts send the entry to
 * `draft.unusedEvidence` (with `unusedReason`) and a machine warning
 * `<CODE>:<evidenceId>`; the console lists them under "Kullanılmayan
 * kaynaklar (alakasız görünüyor)" with the force-use toggle (`evidenceUse`).
 * Uploaded exhibits are never gated: they are DELİLLER, not dayanak.
 *
 * Everything here is a heuristic over metadata and words; it is a filter
 * against the wrong law, not a judgement about the right one, and the
 * lawyer can override it entry by entry.
 */

import { mapPassageCoverage } from "../answer/coverage.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { DraftEvidence } from "./types.js";

/** Field of law a template belongs to, or a domain an evidence entry names. */
export type LegalDomain = "ozel-hukuk" | "ceza" | "idare" | "icra" | "genel";

export const LEGAL_DOMAINS: readonly LegalDomain[] = ["ozel-hukuk", "ceza", "idare", "icra", "genel"];

/** Lawyer-facing names (console chips, warnings). */
export const LEGAL_DOMAIN_TR: Readonly<Record<LegalDomain, string>> = Object.freeze({
  "ozel-hukuk": "özel hukuk",
  ceza: "ceza hukuku",
  idare: "idare hukuku",
  icra: "icra ve iflas hukuku",
  genel: "genel",
});

/** Legislation numbers by domain (well-known codes; unknown numbers are "genel"). */
const CEZA_LAWS: ReadonlySet<string> = new Set(["5237", "5271", "5275", "5326", "3713", "5607", "765", "1412"]);
const ICRA_LAWS: ReadonlySet<string> = new Set(["2004"]);
const IDARE_LAWS: ReadonlySet<string> = new Set(["2577", "2575", "2576", "213", "6183", "5018", "4734", "4735", "6698", "4054"]);
const OZEL_HUKUK_LAWS: ReadonlySet<string> = new Set([
  "6098", "818", "6100", "1086", "4721", "743", "6102", "6762", "4857", "1475", "6570", "6325", "6502",
  "4077", "7036", "5521", "1136", "5846", "6769", "634",
]);

/** Which evidence domains a template domain accepts as a dayanak. */
const ACCEPTS: Readonly<Record<LegalDomain, ReadonlySet<LegalDomain>>> = Object.freeze({
  "ozel-hukuk": new Set<LegalDomain>(["ozel-hukuk", "genel"]),
  ceza: new Set<LegalDomain>(["ceza", "genel"]),
  idare: new Set<LegalDomain>(["idare", "genel"]),
  // An icra itirazı rests on İİK and on the underlying private-law relation.
  icra: new Set<LegalDomain>(["icra", "ozel-hukuk", "genel"]),
  genel: new Set<LegalDomain>(LEGAL_DOMAINS),
});

const KURUL_IDARE_SOURCES: ReadonlySet<string> = new Set([
  "KVKK", "REKABET", "BDDK", "BTK", "KIK", "SAYISTAY", "GIB", "DANISTAY",
]);

function domainOfCourt(court: string): LegalDomain | undefined {
  const c = normalizeTurkishSearch(court);
  if (c === "") return undefined;
  if (c.includes("anayasa") || c.includes("uyuşmazlık")) return "genel";
  if (c.includes("icra")) return "icra";
  if (c.includes("ceza")) return "ceza";
  if (c.includes("danıştay") || c.includes("idare mahkemesi") || c.includes("vergi mahkemesi") || c.includes("bölge idare")) {
    return "idare";
  }
  if (
    c.includes("hukuk") || c.includes("ticaret") || c.includes("iş mahkemesi") || c.includes("tüketici") ||
    c.includes("sulh") || c.includes("kadastro") || c.includes("fikri") || c.includes("aile mahkemesi")
  ) {
    return "ozel-hukuk";
  }
  return undefined;
}

function domainOfLaw(legislationNo: string): LegalDomain | undefined {
  const no = legislationNo.replace(/\s+/gu, "").replace(/^0+/u, "");
  if (CEZA_LAWS.has(no)) return "ceza";
  if (ICRA_LAWS.has(no)) return "icra";
  if (IDARE_LAWS.has(no)) return "idare";
  if (OZEL_HUKUK_LAWS.has(no)) return "ozel-hukuk";
  return undefined;
}

function domainOfTitle(title: string): LegalDomain | undefined {
  const t = normalizeTurkishSearch(title);
  if (t === "") return undefined;
  if (t.includes("ceza kanunu") || t.includes("ceza muhakemesi") || t.includes("kabahatler")) return "ceza";
  if (t.includes("icra ve iflas") || t.includes("icra iflas")) return "icra";
  if (t.includes("idari yargılama") || t.includes("idare mahkemeleri") || t.includes("vergi usul")) return "idare";
  if (
    t.includes("borçlar kanunu") || t.includes("medeni kanun") || t.includes("hukuk muhakemeleri") ||
    t.includes("ticaret kanunu") || t.includes("iş kanunu") || t.includes("tüketicinin korunması") ||
    t.includes("arabuluculuk") || t.includes("kira")
  ) {
    return "ozel-hukuk";
  }
  return undefined;
}

/** The field of law an evidence entry belongs to (metadata only; "genel" when unknown). */
export function evidenceDomain(entry: {
  source?: string;
  court?: string;
  legislationNo?: string;
  title?: string;
}): LegalDomain {
  if (entry.court !== undefined && entry.court !== "") {
    const byCourt = domainOfCourt(entry.court);
    if (byCourt !== undefined) return byCourt;
  }
  if (entry.legislationNo !== undefined && entry.legislationNo !== "") {
    const byLaw = domainOfLaw(entry.legislationNo);
    if (byLaw !== undefined) return byLaw;
  }
  const byTitle = domainOfTitle(entry.title ?? "");
  if (byTitle !== undefined) return byTitle;
  const source = (entry.source ?? "").toUpperCase();
  if (KURUL_IDARE_SOURCES.has(source)) return "idare";
  if (source === "SIGORTA") return "ozel-hukuk";
  return "genel";
}

/** True when a template of `templateDomain` may rest on evidence of `domain`. */
export function domainsCompatible(templateDomain: LegalDomain, domain: LegalDomain): boolean {
  return ACCEPTS[templateDomain].has(domain);
}

export type RelevanceVerdict = "referenced" | "relevant" | "DOMAIN_MISMATCH" | "NOT_RELEVANT";

export interface RelevanceAssessment {
  verdict: RelevanceVerdict;
  domain: LegalDomain;
  /** Matter content words the entry's text carries (surface form). */
  overlap: string[];
}

export interface RelevanceInput {
  templateDomain: LegalDomain;
  /** talepler + olaylar + konu + instructions, joined. */
  matterText: string;
  entries: readonly DraftEvidence[];
  /** The composer's explicit-reference pin (kanun no + madde / esas no). */
  referenced: (entry: DraftEvidence) => boolean;
}

/**
 * Assess every non-upload entry. Deterministic; the same input always yields
 * the same verdicts. Upload entries are omitted from the result (never gated).
 *
 * Supporting entries (direction ≠ "karşıt") take all three rules. A CONTRARY
 * entry is judged by domain only — it opposes a claim, so its wording need
 * not echo the matter — and its domain is acceptable when the template
 * accepts it OR when a supporting entry of the same domain was kept: a
 * contrary criminal decision belongs in the karşı içtihat section exactly
 * when the document relies on a criminal provision the lawyer named.
 */
export function assessEvidenceRelevance(input: RelevanceInput): Map<string, RelevanceAssessment> {
  const out = new Map<string, RelevanceAssessment>();
  const candidates = input.entries.filter((entry) => entry.source !== "UPLOAD");
  if (candidates.length === 0) return out;
  const supporting = candidates.filter((entry) => entry.direction !== "karşıt");
  const contrary = candidates.filter((entry) => entry.direction === "karşıt");
  const coverage = mapPassageCoverage(
    input.matterText,
    supporting.map((entry) => `${entry.quote}\n${entry.title}\n${entry.label}`),
  );
  const keptDomains = new Set<LegalDomain>();
  // A matter with no content words at all (a bare form) cannot discriminate
  // lexically; only the domain rule applies then.
  const lexical = coverage.lexemes.length > 0;
  supporting.forEach((entry, index) => {
    if (out.has(entry.evidenceId)) return;
    const domain = evidenceDomain(entry);
    const overlap = (coverage.covered[index] ?? []).map((i) => coverage.lexemes[i] as string);
    let verdict: RelevanceVerdict;
    if (input.referenced(entry)) verdict = "referenced";
    else if (!domainsCompatible(input.templateDomain, domain)) verdict = "DOMAIN_MISMATCH";
    else if (lexical && overlap.length === 0) verdict = "NOT_RELEVANT";
    else verdict = "relevant";
    if (!isIrrelevant(verdict)) keptDomains.add(domain);
    out.set(entry.evidenceId, { verdict, domain, overlap });
  });
  for (const entry of contrary) {
    if (out.has(entry.evidenceId)) continue;
    const domain = evidenceDomain(entry);
    let verdict: RelevanceVerdict;
    if (input.referenced(entry)) verdict = "referenced";
    else if (domainsCompatible(input.templateDomain, domain) || keptDomains.has(domain)) verdict = "relevant";
    else verdict = "DOMAIN_MISMATCH";
    out.set(entry.evidenceId, { verdict, domain, overlap: [] });
  }
  return out;
}

/** True for the two verdicts that keep an entry out of the document. */
export function isIrrelevant(verdict: RelevanceVerdict | undefined): verdict is "DOMAIN_MISMATCH" | "NOT_RELEVANT" {
  return verdict === "DOMAIN_MISMATCH" || verdict === "NOT_RELEVANT";
}

/** ONE human sentence for the gated entries (Turkish; no ids, no enums). */
export function relevanceWarning(
  templateDomain: LegalDomain,
  mismatched: number,
  unrelated: number,
): string {
  const parts: string[] = [];
  if (mismatched > 0) {
    parts.push(
      `${mismatched} kaynak bu belgenin hukuk alanıyla (${LEGAL_DOMAIN_TR[templateDomain]}) örtüşmediği için`,
    );
  }
  if (unrelated > 0) {
    parts.push(`${unrelated} kaynak talep/olay metniyle hiçbir ortak sözcük taşımadığı için`);
  }
  return (
    `${parts.join("; ")} hukukî değerlendirmeye ve HUKUKÎ SEBEPLER'e yazılmadı (alakasız görünüyor).` +
    " Talep veya olay metninde açıkça andığınız kaynak her zaman kullanılır; diğerleri Kanıtlar panelinden" +
    " bilerek eklenebilir."
  );
}

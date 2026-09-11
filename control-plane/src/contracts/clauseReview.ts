/**
 * Sözleşme / kontrol listesi inceleme motoru — RULE BASED (W14 · B-24).
 *
 * WHAT THIS IS. A contract is split into clauses; a checklist the lawyer
 * wrote (kira: depozito · artış oranı · tahliye taahhüdü · damga vergisi) is
 * run over them; each checklist item comes back VAR / YOK / BELİRSİZ with the
 * clause that satisfied it. That is the whole mechanism.
 *
 * WHAT THIS IS NOT, and must never be sold as. There is no model here, no
 * judgement, no "AI review". W13-DEJURE's `/sozlesme` claims to analyse a
 * contract "for risk, gaps and non-compliance" and to "offer improvements per
 * clause"; W13-GLOBAL notes Spellbook's Custom Playbooks and CoCounsel's
 * Contract Policy Compliance do the same job — and that the same job is
 * buildable with zero hallucination risk if it stays rule-based. It stays
 * rule-based.
 *
 * THE HARD LINE ON THE WORD "RİSK". A line may call something a risk ONLY
 * when it is bound to a hash-verified quote from a legal source. Everything
 * else is an OBSERVATION, is prefixed `⚠ KAYNAKSIZ`, and is forbidden from
 * using the word "risk" at all — the test suite asserts this. An unsourced
 * "this clause is risky" is exactly the sentence this product exists not to
 * write.
 *
 * WHAT AN ABSENCE MEANS. `YOK` says the checklist term was not FOUND in the
 * text we were given. It never says the contract is defective, and it never
 * says a term is legally required — that is the lawyer's call, and the
 * report says so in those words.
 */

import { sanitizeMarkdown } from "../security/renderGuard.js";
import { canonicalQuoteText } from "../drafting/quoteIntegrity.js";
import { sha256HexUtf8 } from "../verification/validator.js";

export const CONTRACT_REVIEW_SCHEMA = "collex.contract-review/v1";

export const CLAUSE_STATES = ["VAR", "YOK", "BELIRSIZ"] as const;
export type ClauseState = (typeof CLAUSE_STATES)[number];

export const CLAUSE_STATE_LABEL_TR: Readonly<Record<ClauseState, string>> = Object.freeze({
  VAR: "var",
  YOK: "yok",
  BELIRSIZ: "belirsiz",
});

export const CLAUSE_STATE_MEANING_TR: Readonly<Record<ClauseState, string>> = Object.freeze({
  VAR: "Bu başlığı karşılayan bir madde bulundu (madde numarası yanında).",
  YOK:
    "Bu başlık, incelenen metinde BULUNAMADI. Bu, maddenin hukuken zorunlu olduğu" +
    " ya da sözleşmenin sakat olduğu anlamına gelmez — değerlendirme avukatındır.",
  BELIRSIZ:
    "Bir madde bu başlıkla ilişkili görünüyor ancak karşılayıp karşılamadığına" +
    " karar verilemedi; maddeyi okuyun.",
});

/** The unsupported marker, identical to the drafting surface. */
export const KAYNAKSIZ_PREFIX = "⚠ KAYNAKSIZ";

/** Verbatim notices the report always carries. */
export const REVIEW_NOTICES: readonly string[] = Object.freeze([
  "Bu inceleme, sözleşme metnini sizin kontrol listenizle satır satır" +
    " karşılaştırmaktan ibarettir. Hukukî değerlendirme yapmaz, yorum üretmez" +
    " ve yapay zekâ kullanmaz.",
  '"yok" satırı, aranan başlığın metinde bulunamadığını söyler; maddenin gerekli' +
    " olup olmadığına avukat karar verir.",
  "Kaynağa bağlanamayan hiçbir gözlem 'risk' olarak adlandırılmaz;" +
    ` ${KAYNAKSIZ_PREFIX} etiketiyle ve gözlem olarak yazılır.`,
]);

/** One clause of the reviewed document. */
export interface ReviewClause {
  /** "5" / "5.2" as the document numbers it; "" when unnumbered. */
  number: string;
  /** The clause text, verbatim. */
  text: string;
  /** 0-based order in the document. */
  index: number;
}

/** One item of the lawyer's own checklist. */
export interface ChecklistItem {
  id: string;
  /** What the lawyer calls it ("Depozito"). */
  label: string;
  /**
   * Words/phrases whose presence satisfies the item. Matching is on the
   * canonical form (NFC, whitespace-collapsed) and Turkish-lowercased —
   * nothing cleverer, on purpose.
   */
  terms: string[];
  /**
   * Terms that make the item BELİRSİZ rather than VAR when they are the only
   * thing found (e.g. "depozito" appears only inside a cross-reference).
   */
  weakTerms?: string[];
  /** The lawyer's own note, printed with the row. */
  note?: string;
}

/** A saved checklist ("Kira sözleşmesi kontrol listesi"). */
export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

/** A hash-bound legal source a risk line may lean on. */
export interface ReviewEvidence {
  evidenceId: string;
  label: string;
  quote: string;
  quoteSha256: string;
}

export interface ChecklistFinding {
  itemId: string;
  label: string;
  state: ClauseState;
  stateLabel: string;
  /** Clause numbers that matched; empty for YOK. */
  clauseNumbers: string[];
  /** The matched term, so the lawyer can see WHY it matched. */
  matchedTerm: string;
  note: string;
}

export interface ClauseObservation {
  text: string;
  sourced: boolean;
  evidenceId: string;
  evidenceLabel: string;
}

/** A per-clause line of the report. */
export interface ClauseLine {
  clauseNumber: string;
  index: number;
  /** Checklist items this clause satisfied. */
  itemIds: string[];
  observations: ClauseObservation[];
}

export interface ContractReviewReport {
  schema: typeof CONTRACT_REVIEW_SCHEMA;
  documentTitle: string;
  checklistId: string;
  checklistTitle: string;
  generatedAt: string;
  clauseCount: number;
  findings: ChecklistFinding[];
  clauses: ClauseLine[];
  totals: Record<ClauseState, number>;
  notices: string[];
}

export class ContractReviewError extends Error {}

/** The word an unsourced line may not use, in any Turkish inflection. */
const RISK_WORD = /\b[Rr][İiIı][Ss][Kk][\p{L}]*\b/gu;

/**
 * Split a contract into clauses. Deliberately simple and explainable: a new
 * clause starts at a line that opens with a clause marker ("MADDE 5", "5.",
 * "5.2.", "Madde 5 -"). Text before the first marker becomes an unnumbered
 * leading clause, so nothing is silently dropped.
 */
export function splitClauses(text: string): ReviewClause[] {
  const marker = /^\s*(?:(?:MADDE|Madde|Md\.?)\s*)?(\d+(?:\.\d+)*)\s*[.)\-–—:]?\s+(?=\S)/u;
  const lines = sanitizeMarkdown(text).split("\n");
  const clauses: ReviewClause[] = [];
  let current: { number: string; parts: string[] } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const body = current.parts.join("\n").trim();
    if (body !== "") {
      clauses.push({ number: current.number, text: body, index: clauses.length });
    }
    current = undefined;
  };
  for (const line of lines) {
    const hit = line.match(marker);
    if (hit !== null) {
      flush();
      current = { number: hit[1] as string, parts: [line.trim()] };
      continue;
    }
    if (current === undefined) current = { number: "", parts: [] };
    current.parts.push(line);
  }
  flush();
  return clauses;
}

/** Canonical, Turkish-lowercased comparison form for term matching. */
function foldTr(value: string): string {
  return canonicalQuoteText(value).toLocaleLowerCase("tr-TR");
}

/** Run one checklist over a set of clauses. Pure, deterministic, no I/O. */
export function runChecklist(
  clauses: readonly ReviewClause[],
  checklist: Checklist,
): ChecklistFinding[] {
  const folded = clauses.map((clause) => ({ clause, text: foldTr(clause.text) }));
  return checklist.items.map((item) => {
    const strong = matchTerms(folded, item.terms);
    if (strong.numbers.length > 0) return finding(item, "VAR", strong.numbers, strong.term);
    const weak = matchTerms(folded, item.weakTerms ?? []);
    if (weak.numbers.length > 0) return finding(item, "BELIRSIZ", weak.numbers, weak.term);
    return finding(item, "YOK", [], "");
  });
}

/** Display number of a clause: its own, or a positional "#n". */
export function clauseLabel(clause: ReviewClause): string {
  return clause.number === "" ? `#${clause.index + 1}` : clause.number;
}

function matchTerms(
  folded: readonly { clause: ReviewClause; text: string }[],
  terms: readonly string[],
): { numbers: string[]; term: string } {
  for (const term of terms) {
    const needle = foldTr(term);
    if (needle === "") continue;
    const hits = folded.filter((entry) => entry.text.includes(needle));
    if (hits.length > 0) {
      return { numbers: hits.map((h) => clauseLabel(h.clause)), term };
    }
  }
  return { numbers: [], term: "" };
}

function finding(
  item: ChecklistItem,
  state: ClauseState,
  clauseNumbers: string[],
  matchedTerm: string,
): ChecklistFinding {
  return {
    itemId: item.id,
    label: item.label,
    state,
    stateLabel: CLAUSE_STATE_LABEL_TR[state],
    clauseNumbers,
    matchedTerm,
    note: item.note ?? "",
  };
}

export interface ContractReviewRequest {
  text: string;
  checklist: Checklist;
  documentTitle?: string;
  /** Hash-bound legal sources any "risk" line must point at. */
  evidence?: ReviewEvidence[];
  /**
   * Observations to print against a clause. Each one is classified here — an
   * observation whose `evidenceId` does not resolve to a HASH-VERIFIED entry
   * is demoted to KAYNAKSIZ and stripped of the word "risk". Callers cannot
   * opt out of this.
   */
  observations?: { clauseIndex: number; text: string; evidenceId?: string }[];
}

export function reviewContract(
  request: ContractReviewRequest,
  options: { now?: () => Date } = {},
): ContractReviewReport {
  if (request.text.trim() === "") {
    throw new ContractReviewError("İncelenecek sözleşme metni boş.");
  }
  if (request.checklist.items.length === 0) {
    throw new ContractReviewError(
      "Kontrol listesi boş: en az bir başlık ekleyin (ör. depozito, artış oranı).",
    );
  }
  const clauses = splitClauses(request.text);
  if (clauses.length === 0) {
    throw new ContractReviewError("Metinde madde bulunamadı; sözleşme metnini kontrol edin.");
  }
  const findings = runChecklist(clauses, request.checklist);

  // Verify every offered source ONCE: a quote whose sha256 does not match its
  // own recorded digest cannot support anything (same rule as the exporter).
  const verified = new Map<string, ReviewEvidence>();
  for (const entry of request.evidence ?? []) {
    if (sha256HexUtf8(entry.quote) === entry.quoteSha256) verified.set(entry.evidenceId, entry);
  }

  const byClause = new Map<number, ClauseObservation[]>();
  for (const observation of request.observations ?? []) {
    const source =
      observation.evidenceId === undefined ? undefined : verified.get(observation.evidenceId);
    const clean = sanitizeMarkdown(observation.text).replace(/\s+/gu, " ").trim();
    if (clean === "") continue;
    const list = byClause.get(observation.clauseIndex) ?? [];
    if (source === undefined) {
      // The word "risk" is REMOVED, not merely flagged: an unsourced line must
      // not read as a risk assessment even when quoted out of context.
      list.push({
        text: `${KAYNAKSIZ_PREFIX} — ${stripRiskWords(clean)}`,
        sourced: false,
        evidenceId: "",
        evidenceLabel: "",
      });
    } else {
      list.push({
        text: clean,
        sourced: true,
        evidenceId: source.evidenceId,
        evidenceLabel: source.label,
      });
    }
    byClause.set(observation.clauseIndex, list);
  }

  const itemsByClause = new Map<string, string[]>();
  for (const found of findings) {
    for (const number of found.clauseNumbers) {
      itemsByClause.set(number, [...(itemsByClause.get(number) ?? []), found.itemId]);
    }
  }

  const totals: Record<ClauseState, number> = { VAR: 0, YOK: 0, BELIRSIZ: 0 };
  for (const found of findings) totals[found.state] += 1;

  const now = (options.now ?? (() => new Date()))();
  return {
    schema: CONTRACT_REVIEW_SCHEMA,
    documentTitle: request.documentTitle ?? "",
    checklistId: request.checklist.id,
    checklistTitle: request.checklist.title,
    generatedAt: now.toISOString(),
    clauseCount: clauses.length,
    findings,
    clauses: clauses.map((clause) => ({
      clauseNumber: clauseLabel(clause),
      index: clause.index,
      itemIds: itemsByClause.get(clauseLabel(clause)) ?? [],
      observations: byClause.get(clause.index) ?? [],
    })),
    totals,
    notices: [...REVIEW_NOTICES],
  };
}

/**
 * Remove every inflected form of "risk" from an unsourced observation and say
 * what the line actually is. Turkish attaches suffixes, so the whole word
 * (with its suffix) goes.
 */
export function stripRiskWords(text: string): string {
  return text.replace(RISK_WORD, "gözlem").replace(/\s{2,}/gu, " ").trim();
}

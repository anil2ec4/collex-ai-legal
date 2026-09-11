/**
 * Deterministic rule-based drafter — offline tests + degraded (LLM-free) mode.
 *
 * Guarantees (enforced by construction, property-tested in tests/answer):
 *  - every emitted claim carries at least one evidenceId, and every id exists
 *    in the input pack;
 *  - claim text is derived EXCLUSIVELY from the evidence quotes plus their
 *    citation label; the drafter never invents content beyond the quotes;
 *  - output order and ids are deterministic for a given pack.
 *
 * Contrary-stance evidence is deliberately NOT drafted into affirmative
 * claims; it stays in the pack for the verifier's conflict detection.
 *
 * ---------------------------------------------------------------------------
 * ORDER AND GROUPING, corrected 2026-08-27.
 *
 * The previous version emitted ONE claim per evidence item, ordered by
 * authority tier and then by the evidence id — which is a SHA-256 prefix.
 * Every claim was still correctly cited, so nothing was unsound; the answer
 * simply read as though it had been shuffled. Measured on the flagship
 * question "TCK m. 157 dolandırıcılık suçunun cezası nedir?": all eight
 * passages are mevzuat, so the tier never separated them and a hash decided
 * the order — Tespit 1 was m.155 or m.158 and the article the reader asked
 * about landed third.
 *
 * Two rules replace it, and neither of them is a hash.
 *
 *  1. RESPONSIVENESS FIRST. The question is re-parsed with the SAME reference
 *     parser retrieval uses. A passage carrying an article the reader
 *     explicitly cited answers the question that was asked, and leads. Then
 *     retrieval score (a pinned exact-reference hit scores 1 by construction),
 *     then authority tier as the tiebreak the old code used first, and finally
 *     the passage's position in the pack — the retrieval rank — so the order
 *     is total and reproducible without ever consulting an identifier's bytes.
 *
 *  2. ONE CLAIM PER PROVISION. A statute article split across fıkra chunks
 *     produced one "Tespit" per fıkra, which reads like a machine reciting a
 *     table. Passages of the SAME article of the SAME document version are
 *     drafted as one claim citing each of them. Nothing is merged across
 *     provisions: the grouping key is (documentVersionId, article) and a
 *     passage with no article number is never grouped with anything, so two
 *     different articles — or the same article in two versions — can never
 *     end up sharing one claim's evidence.
 *
 *  3. ENRICHMENT NEVER LEADS (added 2026-09-02, W12 lane B). A passage that
 *     arrived by following a citation OUT of another passage, or a stored
 *     amendment edge, is context for the passage that carried it — not an
 *     answer to the question. The audit reproduced the failure: a rental-
 *     deposit question retrieved one decision on "sözleşme", the decision
 *     cited TCK m.157, and m.157 led the answer. Such a passage now sorts in a
 *     tier BELOW every directly retrieved one, unless the reader's question
 *     itself cited that provision or instrument (rule 1 already puts it first
 *     in that case, and rule 1 wins).
 *
 * A consolidated claim cites several passages, which changes what its
 * `coverage` axis measures: if one of those citations later fails validation
 * the claim is not destroyed, it is reported at partial coverage
 * (verification/finalize.ts :: claimVerdict -> PARTIAL_SOURCE_COVERAGE) and
 * is no longer SUPPORTED. That is the honest report for "three of the four
 * passages behind this statement still verify" — and because `canFinalize`
 * applies the same COVERAGE_THRESHOLD, the answer carrying it is reported
 * NOT finalizable rather than QUALIFIED-but-finalizable.
 * ---------------------------------------------------------------------------
 */

import type { ClaimDraft } from "../evidence/types.js";
import { citeLabel, type EvidenceItem } from "../answer/evidencePack.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import type { DrafterInput, DrafterPort } from "./ports.js";

/** What the reader explicitly cited, as retrieval's parser reads it. */
interface AskedReferences {
  legislationNos: ReadonlySet<string>;
  articleNos: ReadonlySet<string>;
  /** `${docketNo}|${decisionNo}` pairs. */
  decisions: ReadonlySet<string>;
}

/**
 * How directly a passage answers the question AS ASKED. Lower is better; the
 * scale is deliberately coarse, because it only has to separate "this is the
 * provision you named" from "this came up alongside it".
 */
const RESPONSIVENESS = {
  /** The exact (law, article) pair the reader cited. */
  CITED_PROVISION: 0,
  /** A decision the reader cited by E./K. */
  CITED_DECISION: 1,
  /** The law the reader cited, when they named no article. */
  CITED_INSTRUMENT: 2,
  /** Retrieved alongside; ranked by the retrieval signal alone. */
  RETRIEVED: 3,
  /**
   * Reached by citation expansion or the citator lane and NOT cited by the
   * question: context for another passage, never the lead.
   */
  ENRICHMENT: 4,
} as const;

interface Draftable {
  item: EvidenceItem;
  /** Position in the pack — i.e. the retrieval rank the pipeline produced. */
  packIndex: number;
  responsiveness: number;
}

export class RuleBasedDrafter implements DrafterPort {
  async draftClaims({ question, pack }: DrafterInput): Promise<ClaimDraft[]> {
    const asked = parseAsked(question);

    const draftable: Draftable[] = [];
    pack.items.forEach((item, packIndex) => {
      if (item.stance === "contrary") return;
      draftable.push({
        item,
        packIndex,
        responsiveness: responsivenessOf(item, asked),
      });
    });

    return groupByProvision(draftable)
      .sort(compareGroups)
      .map((group) => claimFromGroup(group));
  }
}

/**
 * The references the question itself carries. Parsed off the normalized form
 * so "TCK m. 157", "tck m.157" and "5237 sayılı Türk Ceza Kanunu m. 157" all
 * arrive as the same (5237, 157) pair — the parser's abbreviation table does
 * that resolution, exactly as it does for the exact-pin retrieval lane.
 */
function parseAsked(question: string): AskedReferences {
  const legislationNos = new Set<string>();
  const articleNos = new Set<string>();
  const decisions = new Set<string>();
  for (const reference of parseReferences(normalizeTurkishSearch(question))) {
    if (reference.legislationNo !== undefined) legislationNos.add(reference.legislationNo);
    if (reference.kind === "article" && reference.articleNo !== undefined) {
      articleNos.add(reference.articleNo);
    }
    if (
      reference.kind === "court_decision" &&
      reference.docketNo !== undefined &&
      reference.decisionNo !== undefined
    ) {
      decisions.add(`${reference.docketNo}|${reference.decisionNo}`);
    }
  }
  return { legislationNos, articleNos, decisions };
}

function responsivenessOf(item: EvidenceItem, asked: AskedReferences): number {
  const ref = item.ref;
  const legislationNo = ref.legislationNo ?? "";
  const article = ref.locator.article ?? "";

  if (
    asked.articleNos.size > 0 &&
    article !== "" &&
    asked.articleNos.has(article) &&
    (asked.legislationNos.size === 0 || asked.legislationNos.has(legislationNo))
  ) {
    return RESPONSIVENESS.CITED_PROVISION;
  }
  if (
    ref.docketNo !== undefined &&
    ref.decisionNo !== undefined &&
    asked.decisions.has(`${ref.docketNo}|${ref.decisionNo}`)
  ) {
    return RESPONSIVENESS.CITED_DECISION;
  }
  // Naming the law without an article asks about the instrument as a whole;
  // naming an article makes every OTHER article of that law incidental, which
  // is why this branch is closed once an article was asked for.
  if (
    asked.articleNos.size === 0 &&
    legislationNo !== "" &&
    asked.legislationNos.has(legislationNo)
  ) {
    return RESPONSIVENESS.CITED_INSTRUMENT;
  }
  if (item.arrival === "citation" || item.arrival === "relation") {
    return RESPONSIVENESS.ENRICHMENT;
  }
  return RESPONSIVENESS.RETRIEVED;
}

interface ProvisionGroup {
  /** Passages of one provision, in retrieval order. */
  members: Draftable[];
  /** The best (lowest) responsiveness among the members. */
  responsiveness: number;
  /** The strongest retrieval score among the members. */
  retrievalScore: number;
  /** The most authoritative (lowest) tier among the members. */
  authorityTier: number;
  /** The earliest retrieval rank among the members — the group's position. */
  packIndex: number;
}

/**
 * Group passages that restate the SAME provision.
 *
 * The key is (documentVersionId, article): the same article of the same
 * version, i.e. exactly one provision as it stood on one date. A passage with
 * no article number gets a key that cannot collide with any other passage, so
 * decisions and unstructured documents keep one claim per passage — different
 * sections of a judgment say different things and must not be welded into one
 * statement.
 */
function groupByProvision(draftable: readonly Draftable[]): ProvisionGroup[] {
  const groups = new Map<string, Draftable[]>();
  const order: string[] = [];
  draftable.forEach((entry, index) => {
    const article = entry.item.ref.locator.article ?? "";
    const key =
      article === ""
        ? `ungrouped:${index}`
        : `provision:${entry.item.ref.documentVersionId}\u0000${article}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [entry]);
      order.push(key);
    } else {
      existing.push(entry);
    }
  });

  return order.map((key) => {
    const members = (groups.get(key) as Draftable[])
      .slice()
      .sort((a, b) => a.packIndex - b.packIndex);
    return {
      members,
      responsiveness: Math.min(...members.map((m) => m.responsiveness)),
      retrievalScore: Math.max(...members.map((m) => m.item.retrievalScore)),
      authorityTier: Math.min(...members.map((m) => m.item.authority.tier)),
      packIndex: Math.min(...members.map((m) => m.packIndex)),
    };
  });
}

/**
 * Responsiveness, then the retrieval signal, then authority tier, then the
 * retrieval rank. The last key is unique per group, so the order is total —
 * and no key is derived from an identifier's bytes.
 */
function compareGroups(a: ProvisionGroup, b: ProvisionGroup): number {
  if (a.responsiveness !== b.responsiveness) return a.responsiveness - b.responsiveness;
  if (a.retrievalScore !== b.retrievalScore) return b.retrievalScore - a.retrievalScore;
  if (a.authorityTier !== b.authorityTier) return a.authorityTier - b.authorityTier;
  return a.packIndex - b.packIndex;
}

function claimFromGroup(group: ProvisionGroup): ClaimDraft {
  const primary = (group.members[0] as Draftable).item;
  const label = citeLabel(primary.ref);
  // Every member of a group is the same article of the same version, so they
  // share one citation label; the passages follow it in document order, one
  // per line, and nothing but the quotes and that label is ever written.
  const quotes = group.members.map((m) => `"${m.item.ref.quote}"`).join("\n");
  // ATTRIBUTION (W14 B-31). The claim text is the concatenation of the
  // group's quotes, so which passage carries which part is known exactly:
  // one segment per quote, citing that quote's own passage. Without this the
  // verifier had to ask each passage to entail the OTHER passages' words too
  // and a two-fıkra provision could never pass the 0.85 threshold. A
  // single-member group gets one segment identical to the claim text, so its
  // score is unchanged.
  const segments = group.members.map((member) => ({
    text: `${label}: "${member.item.ref.quote}"`,
    evidenceIds: [member.item.ref.evidenceId],
  }));
  return {
    // Identity stays anchored to the group's FIRST passage in retrieval order,
    // which is the same passage callers find by scanning the evidence list.
    claimId: `claim-${primary.ref.evidenceId}`,
    text: `${label}: ${quotes}`,
    material: true,
    evidenceIds: group.members.map((m) => m.item.ref.evidenceId),
    segments,
    treatment: "supported",
    confidence: {
      retrieval: group.retrievalScore,
      // Entailment is decided by the verifier's entailment port, not here.
      entailment: 0,
      authority: Math.max(...group.members.map((m) => m.item.authority.score)),
      currentness: Math.max(...group.members.map((m) => m.item.currentness.score)),
      coverage: 1,
    },
  };
}

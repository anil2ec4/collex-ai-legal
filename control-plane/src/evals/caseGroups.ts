/**
 * Where an eval case's gold comes from (shared by the model bake-off and the
 * embedding eval).
 *
 * Synthetic, agreed, pending and disputed cases are summarised SEPARATELY:
 * a pooled mean dominated by synthetic cases, or by labels no second lawyer
 * has confirmed, must never read as a lawyer-gold measurement.
 */

export const CASE_GROUPS = ["synthetic", "lawyer_agreed", "lawyer_pending", "lawyer_disputed"] as const;
export type CaseGroup = (typeof CASE_GROUPS)[number];

export function caseGroup(testCase: {
  readonly source: "synthetic" | "lawyer_annotated";
  readonly adjudication?: "pending" | "agreed" | "disputed" | null | undefined;
}): CaseGroup {
  if (testCase.source === "synthetic") return "synthetic";
  if (testCase.adjudication === "agreed") return "lawyer_agreed";
  if (testCase.adjudication === "disputed") return "lawyer_disputed";
  return "lawyer_pending";
}

export const CASE_GROUP_TR: Readonly<Record<CaseGroup, string>> = {
  synthetic: "sentetik vakalar",
  lawyer_agreed: "avukat onaylı vakalar (agreed)",
  lawyer_pending: "avukat vakaları — henüz karara bağlanmamış (pending)",
  lawyer_disputed: "avukat vakaları — avukatlar birleşmedi (disputed)",
};

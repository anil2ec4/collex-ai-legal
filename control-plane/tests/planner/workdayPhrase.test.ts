import { describe, expect, it } from "vitest";
import { analyzeIntake } from "../../src/planner/intake.js";
import { RESEARCH_TEMPLATES } from "../../src/planner/templates.js";
import { parsePlannerNote } from "../../src/planner/outcomes.js";

const calls = (question: string) => RESEARCH_TEMPLATES.mevzuat_amendment_ictihat.buildStaticCalls(
  analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" }),
);

describe("observed Bedesten compound-term precision", () => {
  it("searches the legal phrase actually used in the question before a synonym", () => {
    const primary = calls("Fazla çalışmanın tanıkla ispatı").filter((c) =>
      c.toolName === "search_bedesten_unified" && parsePlannerNote(c.note)?.role === "primary");
    expect(primary.some((c) => c.input.phrase === '"fazla çalışma"')).toBe(true);
  });

  it("keeps the multiword employment concept together in the primary decision search", () => {
    const primary = calls("Kıdem tazminatı koşulları nelerdir?").filter((c) =>
      c.toolName === "search_bedesten_unified" && parsePlannerNote(c.note)?.role === "primary");
    expect(primary.some((c) => c.input.phrase === '"kıdem tazminatı"')).toBe(true);
    expect(primary.some((c) => c.input.phrase === "kıdem tazminatı")).toBe(false);
  });
  it("preserves broader Emsal and contrary lanes instead of quoting a whole mixed query", () => {
    const planned = calls("Kıdem tazminatı koşulları nelerdir?");
    expect(planned.some((c) => c.toolName === "search_emsal_detailed_decisions" && c.input.keyword === "kıdem tazminatı")).toBe(true);
    expect(planned.some((c) => parsePlannerNote(c.note)?.role === "contrary" &&
      c.input.phrase === 'kıdem tazminatı "tazminat talebinin reddi"')).toBe(true);
  });
  it("does not wrap an already structured statute reference in nested quotes", () => {
    const primary = calls("6098 sayılı Kanun madde 344").filter((c) =>
      c.toolName === "search_bedesten_unified" && parsePlannerNote(c.note)?.role === "primary");
    expect(primary.some((c) => c.input.phrase === '"6098 sayılı" 344')).toBe(true);
  });
});

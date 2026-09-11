import { describe, expect, it } from "vitest";
import {
  assertContraryCoverage,
  buildContraryLanes,
  buildContraryQuery,
  buildCoverageReport,
  ContraryCoverageError,
  CONTRARY_VOCABULARY,
  oppositeTermFor,
} from "../../src/planner/contrary.js";
import { encodePlannerNote, type StepRole } from "../../src/planner/outcomes.js";
import type { RecordedStep } from "../../src/orchestration/executor.js";
import type { CapabilityName } from "../../src/capabilities/registry.js";
import { errorOutcome, hitsOutcome, makeIntake, okOutcome } from "./helpers.js";

function step(
  issueId: string,
  role: StepRole,
  outcome: RecordedStep["outcome"],
  options?: { capability?: CapabilityName; toolName?: string },
): RecordedStep {
  const capability = options?.capability ?? "caseLaw.search";
  const toolName = options?.toolName ?? "search_bedesten_unified";
  return {
    idempotencyKey: `key-${issueId}-${role}-${Math.abs(JSON.stringify(outcome).length)}-${toolName}`,
    decision: {
      kind: "step",
      capability,
      toolName,
      input: { phrase: `${issueId} ${role}` },
      note: encodePlannerNote({
        template: "mevzuat_amendment_ictihat",
        issueId,
        role,
        round: role === "gap" ? 2 : 1,
      }),
    },
    outcome,
    recordedAt: "2026-08-27T00:00:00Z",
  };
}

describe("contrary lanes", () => {
  it("general flavor: an outcome flip plus the dissent lane", () => {
    const lanes = buildContraryLanes("dolandırıcılık");
    expect(lanes.map((l) => l.kind)).toEqual(["outcome_flip", "dissent"]);
    expect(lanes[0]?.query).toBe("dolandırıcılık beraat");
    expect(lanes[1]?.query).toBe('dolandırıcılık "karşı oy"');
  });

  it("divergence flavor: direnme and içtihadı birleştirme lanes", () => {
    const lanes = buildContraryLanes("işe iade", "divergence");
    expect(lanes.map((l) => l.kind)).toEqual([
      "outcome_flip",
      "insistence",
      "unification",
    ]);
    expect(lanes[1]?.query).toBe("işe iade direnme");
    expect(lanes[2]?.query).toBe('işe iade "içtihadı birleştirme"');
  });

  it("aym flavor: upheld norm + inadmissible individual application", () => {
    const lanes = buildContraryLanes('"5651 sayılı"', "aym");
    expect(lanes.map((l) => l.kind)).toEqual(["upheld", "inadmissible"]);
    expect(lanes[0]?.query).toContain("iptal isteminin reddi");
    expect(lanes[1]?.query).toContain("kabul edilemez");
    // Structured terms stay unquoted for tools that take a keyword array.
    expect(lanes[0]?.terms).toContain("iptal isteminin reddi");
  });

  it("the lanes together cover the Turkish contrary-authority vocabulary", () => {
    const everyQuery = [
      ...buildContraryLanes("dolandırıcılık"),
      ...buildContraryLanes('"5237 sayılı" 157'),
      ...buildContraryLanes("işe iade", "divergence"),
      ...buildContraryLanes("kişisel veri"),
      ...buildContraryLanes("komşuluk hukuku"),
      ...buildContraryLanes("iptal davası", "aym"),
    ]
      .map((l) => l.query)
      .join(" | ");
    for (const term of [
      "aksi yönde",
      "bozma",
      "reddi",
      "karşı oy",
      "kabul edilemez",
      "direnme",
      "içtihadı birleştirme",
    ]) {
      expect(everyQuery, term).toContain(term);
    }
    // Every documented vocabulary entry is a real Turkish phrase, not a label.
    expect(CONTRARY_VOCABULARY.length).toBeGreaterThanOrEqual(8);
  });

  it("a bare statute citation flips to bozma, a concept to its authored opposite", () => {
    expect(buildContraryQuery('"5237 sayılı" 157')).toBe('"5237 sayılı" 157 bozma');
    expect(buildContraryQuery("işe iade")).toBe('işe iade "işe iade talebinin reddi"');
    expect(oppositeTermFor("manevi tazminat")).toBe("tazminat talebinin reddi");
    expect(oppositeTermFor("komşuluk hukuku")).toBeUndefined();
  });

  it("the specific institution wins over the generic remedy it contains", () => {
    // "iş kazası tazminatı" must flip on the accident, not on "tazminat".
    expect(oppositeTermFor("iş kazası tazminatı")).toBe("işverenin kusuru bulunmadığı");
    expect(oppositeTermFor("itirazen şikayet üzerine iptal")).toBe(
      "itirazen şikayet başvurusunun reddi",
    );
  });

  it("falls back to an explicit divergence marker for an unmapped concept", () => {
    expect(buildContraryQuery("komşuluk hukuku")).toBe('komşuluk hukuku "aksi yönde"');
  });

  it("regulator concepts flip to the authority's own negative wording", () => {
    expect(buildContraryQuery("kişisel veri")).toContain("ihlal bulunmadığı");
    expect(buildContraryQuery("rekabet ihlali")).toContain("ihlal bulunmadığı");
    expect(buildContraryQuery("itirazen şikayet")).toContain(
      "itirazen şikayet başvurusunun reddi",
    );
  });

  it("is deterministic and normalizes the base term", () => {
    expect(buildContraryQuery("  İŞE İADE  ")).toBe(buildContraryQuery("işe iade"));
    expect(buildContraryLanes("işe iade")).toEqual(buildContraryLanes("işe iade"));
  });

  it("every lane keeps the base term, so it still retrieves the issue", () => {
    for (const flavor of ["general", "divergence", "aym"] as const) {
      for (const laneItem of buildContraryLanes("kamulaştırma", flavor)) {
        expect(laneItem.query.startsWith("kamulaştırma")).toBe(true);
        // Exactly ONE flip phrase per lane: a keyword engine ANDs the rest away.
        expect(laneItem.terms).toHaveLength(2);
      }
    }
  });
});

describe("buildCoverageReport", () => {
  const intake = makeIntake("dolandırıcılık nedeniyle açılan dava"); // 1 material issue

  it("reports a fully covered issue as covered", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("BEDESTEN", [{ externalId: "d-1" }])),
        step("issue-1", "contrary", hitsOutcome("BEDESTEN", [{ externalId: "d-2" }])),
      ],
    });
    expect(report.allMaterialIssuesCovered).toBe(true);
    expect(report.uncoveredIssueIds).toHaveLength(0);
    expect(report.uncoveredIssues).toHaveLength(0);
    expect(report.issues[0]).toMatchObject({
      issueId: "issue-1",
      evidenceCount: 2,
      judicialEvidenceCount: 2,
      contraryExecuted: true,
      contraryUsable: true,
      contraryLaneCount: 1,
      contraryEvidenceCount: 1,
      contraryOutcomeStatus: "ok",
      covered: true,
    });
    expect(report.issues[0]?.uncoveredReason).toBeUndefined();
    expect(() => assertContraryCoverage(report)).not.toThrow();
  });

  it("marks an issue uncovered when no contrary search was recorded", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("BEDESTEN", [{ externalId: "d-1" }])),
      ],
    });
    expect(report.allMaterialIssuesCovered).toBe(false);
    expect(report.uncoveredIssueIds).toEqual(["issue-1"]);
    expect(report.uncoveredIssues[0]).toMatchObject({
      issueId: "issue-1",
      reason: "CONTRARY_NOT_EXECUTED",
    });
    expect(() => assertContraryCoverage(report)).toThrow(ContraryCoverageError);
  });

  it("marks an issue uncovered when it has zero evidence, even with contrary recorded", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("BEDESTEN", [])),
        step("issue-1", "contrary", hitsOutcome("BEDESTEN", [])),
      ],
    });
    expect(report.issues[0]?.evidenceCount).toBe(0);
    expect(report.issues[0]?.contraryExecuted).toBe(true);
    expect(report.issues[0]?.uncoveredReason).toBe("NO_EVIDENCE");
    expect(report.allMaterialIssuesCovered).toBe(false);
  });

  it("a FAILED contrary lane is not coverage (provider outage != no authority)", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("BEDESTEN", [{ externalId: "d-1" }])),
        step("issue-1", "contrary", errorOutcome("BEDESTEN", "RATE_LIMITED")),
      ],
    });
    expect(report.issues[0]?.evidenceCount).toBe(1);
    expect(report.issues[0]?.contraryExecuted).toBe(true);
    expect(report.issues[0]?.contraryUsable).toBe(false);
    expect(report.issues[0]?.uncoveredReason).toBe("CONTRARY_FAILED");
    expect(report.allMaterialIssuesCovered).toBe(false);
  });

  it("one usable contrary lane out of several is enough", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("BEDESTEN", [{ externalId: "d-1" }])),
        step("issue-1", "contrary", errorOutcome("BEDESTEN", "TIMEOUT")),
        step("issue-1", "contrary", hitsOutcome("BEDESTEN", [{ externalId: "d-9" }])),
      ],
    });
    expect(report.issues[0]?.contraryLaneCount).toBe(2);
    expect(report.issues[0]?.contraryOutcomeStatus).toBe("ok"); // best status wins
    expect(report.issues[0]?.covered).toBe(true);
    expect(report.failedLanes).toHaveLength(1);
  });

  it("lists failed lanes for error outcomes (no silent empty)", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", errorOutcome("BEDESTEN", "UNAVAILABLE")),
        step("issue-1", "contrary", errorOutcome("BEDESTEN", "RATE_LIMITED")),
      ],
    });
    expect(report.failedLanes).toHaveLength(2);
    expect(report.failedLanes[0]).toMatchObject({
      issueId: "issue-1",
      capability: "caseLaw.search",
      toolName: "search_bedesten_unified",
      role: "primary",
      failureKind: "UNAVAILABLE",
    });
    expect(report.issues[0]?.contraryOutcomeStatus).toBe("error");
    expect(report.allMaterialIssuesCovered).toBe(false);
  });

  it("a statute hit is evidence but not judicial evidence", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "legislation", hitsOutcome("MEVZUAT", [{ externalId: "m-1" }]), {
          capability: "legislation.search",
          toolName: "search_mevzuat",
        }),
        step("issue-1", "contrary", hitsOutcome("BEDESTEN", [])),
      ],
    });
    expect(report.issues[0]?.evidenceCount).toBe(1);
    expect(report.issues[0]?.judicialEvidenceCount).toBe(0);
    expect(report.issues[0]?.covered).toBe(true); // evidence + a usable contrary look
  });

  it("counts regulator hits as judicial evidence", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", hitsOutcome("KVKK", [{ externalId: "k-1" }]), {
          capability: "regulator.search",
          toolName: "search_kvkk_decisions",
        }),
        step("issue-1", "contrary", hitsOutcome("KVKK", [{ externalId: "k-2" }]), {
          capability: "regulator.search",
          toolName: "search_kvkk_decisions",
        }),
      ],
    });
    expect(report.issues[0]?.judicialEvidenceCount).toBe(2);
    expect(report.issues[0]?.covered).toBe(true);
  });

  it("ignores steps without a planner note", () => {
    const foreign: RecordedStep = {
      idempotencyKey: "foreign-1",
      decision: {
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: { phrase: "x" },
      },
      outcome: hitsOutcome("BEDESTEN", [{ externalId: "zzz" }]),
      recordedAt: "2026-08-27T00:00:00Z",
    };
    const report = buildCoverageReport(intake, { steps: [foreign] });
    expect(report.issues[0]?.evidenceCount).toBe(0);
    expect(report.failedLanes).toHaveLength(0);
  });

  it("ignores non-hit-shaped outcomes instead of counting them as evidence", () => {
    const report = buildCoverageReport(intake, {
      steps: [
        step("issue-1", "primary", okOutcome("BEDESTEN", { note: "not a hit array" })),
        step("issue-1", "contrary", okOutcome("BEDESTEN", "plain text")),
      ],
    });
    expect(report.issues[0]?.evidenceCount).toBe(0);
    expect(report.issues[0]?.uncoveredReason).toBe("NO_EVIDENCE");
  });
});

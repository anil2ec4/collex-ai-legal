/**
 * POLICY.md must describe the code that actually exists.
 *
 * These tests are the reason POLICY.md cannot rot: the delegation table is
 * parsed and checked against the filesystem, the non-goals are asserted
 * verbatim enough to survive a careless edit, and the paths POLICY.md names
 * (including its own acceptance-corpus path) must resolve.
 */

import { describe, expect, it } from "vitest";

import {
  DELEGATION_ROWS as ROWS,
  FIXTURES,
  KNOWN_GAPS,
  POLICY_MD,
  repoPathExists,
} from "./corpus.js";
import { ALLOWED_SOURCE_HOSTS } from "../../src/security/urlPolicy.js";
import * as securityIndex from "../../src/security/index.js";

describe("POLICY.md delegation table", () => {
  it("parses into well-formed rows", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(8);
    for (const row of ROWS) {
      expect(["enforced", "planned"], JSON.stringify(row)).toContain(row.status);
      expect(row.threat.length).toBeGreaterThan(3);
      expect(row.component.length).toBeGreaterThan(3);
    }
  });

  it("only names fixtures that exist in the corpus", () => {
    const corpusIds = FIXTURES.map((f) => f.id);
    for (const row of ROWS) {
      expect(corpusIds, `POLICY.md names unknown fixture ${row.fixtureId}`).toContain(
        row.fixtureId,
      );
    }
  });

  it("every `enforced` row names a component that exists on disk", () => {
    const enforced = ROWS.filter((row) => row.status === "enforced");
    expect(enforced.length).toBeGreaterThan(0);
    for (const row of enforced) {
      const path = row.component.replace(/`/g, "").trim();
      expect(path).toMatch(/^[\w./-]+$/);
      expect(repoPathExists(path), `${row.fixtureId} -> missing ${path}`).toBe(true);
    }
  });

  it("every `planned` row is an acknowledged gap, described in prose", () => {
    const planned = ROWS.filter((row) => row.status === "planned");
    for (const row of planned) {
      expect(
        KNOWN_GAPS,
        `${row.fixtureId} is a NEW planned gap; acknowledge it in KNOWN_GAPS before shipping`,
      ).toContain(row.fixtureId);
      // A gap row must explain itself, not just point at a file that is absent.
      expect(row.component).not.toMatch(/^`/);
      expect(row.component.length).toBeGreaterThan(20);
    }
    // Every acknowledged gap must still be present — remove it from KNOWN_GAPS
    // when the component lands, so the list never grows stale in the other
    // direction either.
    for (const gap of KNOWN_GAPS) {
      expect(
        planned.map((row) => row.fixtureId),
        `${gap} is in KNOWN_GAPS but POLICY.md no longer lists it as planned`,
      ).toContain(gap);
    }
  });

  it("documents the concrete gaps (archive limits, XXE, scoped cache)", () => {
    expect(POLICY_MD).toMatch(/decompression/i);
    expect(POLICY_MD).toMatch(/external\s+entity resolution/i);
    expect(POLICY_MD).toMatch(/authorization\s+epoch/i);
  });
});

describe("POLICY.md non-goals", () => {
  it("states that heuristic injection scanning is telemetry, not the boundary", () => {
    expect(POLICY_MD).toMatch(/DEFENSE-IN-DEPTH TELEMETRY/);
    expect(POLICY_MD).toMatch(/NO regex-only defense claim/);
    expect(POLICY_MD).toMatch(/clean `scanForInjection` result is NOT a\s+safety proof/);
    expect(POLICY_MD).toMatch(/may be gated on `flagged`/);
  });

  it("states that the primary boundary is the typed data flow", () => {
    expect(POLICY_MD).toMatch(/## The primary boundary/);
    expect(POLICY_MD).toMatch(/typed data flow, not any filter in this\s+directory/);
    expect(POLICY_MD).toMatch(/never treats\s+raw source text as an instruction/);
    expect(POLICY_MD).toContain("src/planner/rulePlanner.ts");
    expect(POLICY_MD).toContain("src/retrieval/referenceParser.ts");
  });

  it("keeps the remaining non-goals: no DNS, no DOM, no guard model, no secrets", () => {
    expect(POLICY_MD).toMatch(/No DNS resolution/);
    expect(POLICY_MD).toMatch(/No HTML rendering or DOM parsing/);
    expect(POLICY_MD).toMatch(/No guard model/);
    expect(POLICY_MD).toMatch(/No secret handling/);
  });
});

describe("POLICY.md matches the implementation", () => {
  it("points at the real test directory", () => {
    expect(POLICY_MD).toContain("control-plane/tests/security/");
    expect(POLICY_MD).not.toContain("control-plane/test/security/");
  });

  it("names paths that exist", () => {
    const referenced = [
      "control-plane/src/security/renderGuard.ts",
      "control-plane/src/security/untrusted.ts",
      "control-plane/src/security/urlPolicy.ts",
      "control-plane/src/planner/rulePlanner.ts",
      "control-plane/src/retrieval/referenceParser.ts",
      "control-plane/src/capabilities/registry.ts",
      "control-plane/src/verification/validator.ts",
      "control-plane/src/evidence/types.ts",
      "evals/datasets/adversarial_v1.jsonl",
      "scripts/smoke_check.py",
    ];
    for (const path of referenced) {
      expect(repoPathExists(path), `${path} does not exist`).toBe(true);
      // The document refers to these without the `control-plane/` prefix in
      // some places, so match on the tail.
      const tail = path.replace(/^control-plane\//, "");
      expect(POLICY_MD, `POLICY.md never mentions ${tail}`).toContain(tail);
    }
  });

  it("lists exactly the reason codes the implementation can return", () => {
    const documented = new Set(
      [...POLICY_MD.matchAll(/`(UNPARSEABLE_URL|NON_[A-Z_]+|HAS_USERINFO|IP_LITERAL_HOST|LOOPBACK_OR_LOCAL_HOST|PRIVATE_OR_LINK_LOCAL_ADDRESS|METADATA_ENDPOINT|HOST_NOT_IN_ALLOWLIST|UNKNOWN_SOURCE_FAMILY|INVALID_EXTERNAL_ID)`/g)].map(
        (m) => m[1] as string,
      ),
    );
    const expected = [
      "UNPARSEABLE_URL",
      "NON_HTTPS_SCHEME",
      "HAS_USERINFO",
      "NON_DEFAULT_PORT",
      "NON_ASCII_OR_PUNYCODE_HOST",
      "IP_LITERAL_HOST",
      "LOOPBACK_OR_LOCAL_HOST",
      "PRIVATE_OR_LINK_LOCAL_ADDRESS",
      "METADATA_ENDPOINT",
      "HOST_NOT_IN_ALLOWLIST",
      "UNKNOWN_SOURCE_FAMILY",
      "INVALID_EXTERNAL_ID",
    ];
    for (const reason of expected) {
      expect(documented, `POLICY.md does not document ${reason}`).toContain(reason);
    }
  });

  it("describes the render guard guarantees it actually provides", () => {
    expect(POLICY_MD).toMatch(/IDEMPOTENT/);
    expect(POLICY_MD).toMatch(/fixed point/);
    expect(POLICY_MD).toMatch(/output contains no `<` character at all/);
    expect(POLICY_MD).toMatch(/Reference link definitions/);
    expect(POLICY_MD).toMatch(/www\./);
  });

  it("describes the wrapper guarantees it actually provides", () => {
    expect(POLICY_MD).toMatch(/delimiter collision/);
    expect(POLICY_MD).toMatch(/look-alikes/);
    expect(POLICY_MD).toMatch(/U\+061C/);
    expect(POLICY_MD).toMatch(/NOT idempotent by design/);
  });
});

describe("public surface", () => {
  it("re-exports every guard entry point the policy describes", () => {
    for (const name of [
      "markUntrusted",
      "scanForInjection",
      "wrapEvidenceForModel",
      "sanitizeMarkdown",
      // The render guard has TWO entry points. A barrel that exports only one
      // of them silently pushes every answer-side caller onto the wrong guard:
      // sanitizeMarkdown escapes the renderer's structural "> " marker, which
      // is exactly the framing that makes an injected "SYSTEM: ..." line read
      // as a quotation.
      "sanitizeAnswerMarkdown",
      "assertSafeFetchUrl",
      "checkFetchUrl",
      "isAllowedSourceHost",
      "resolveSourceUrl",
      "UrlPolicyError",
      "ALLOWED_SOURCE_HOSTS",
      "KNOWN_SOURCE_FAMILIES",
      "UNTRUSTED_BLOCK_OPEN",
      "UNTRUSTED_BLOCK_CLOSE",
      "UNTRUSTED_PREAMBLE",
    ]) {
      expect(securityIndex, `index.ts does not export ${name}`).toHaveProperty(name);
    }
  });

  it("re-exports the same frozen allowlist object", () => {
    expect(securityIndex.ALLOWED_SOURCE_HOSTS).toBe(ALLOWED_SOURCE_HOSTS);
  });
});

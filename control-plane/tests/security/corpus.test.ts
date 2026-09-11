/**
 * Acceptance: every fixture in `evals/datasets/adversarial_v1.jsonl` is
 * asserted against the guard that is actually responsible for it.
 *
 * Fixtures whose defense lives outside `src/security/` are NOT skipped: they
 * assert that POLICY.md documents the delegation and that the delegated
 * component exists on disk (or is a `planned` row this test already knows
 * about — see `KNOWN_GAPS`).
 */

import { describe, expect, it } from "vitest";

import {
  DELEGATION_ROWS,
  FIXTURES,
  KNOWN_GAPS,
  liveOffAllowlistTargets,
  payloadText,
  repoPathExists,
  urlsInPayload,
  type AdversarialFixture,
} from "./corpus.js";
import {
  UNTRUSTED_BLOCK_CLOSE,
  UNTRUSTED_BLOCK_OPEN,
  UNTRUSTED_PREAMBLE,
  scanForInjection,
  wrapEvidenceForModel,
} from "../../src/security/untrusted.js";
import { sanitizeMarkdown } from "../../src/security/renderGuard.js";
import { checkFetchUrl } from "../../src/security/urlPolicy.js";

type LocalGuard = "scan" | "wrap" | "render" | "url";

interface FixturePlan {
  /** Guards in this directory that must demonstrably handle the fixture. */
  readonly guards: readonly LocalGuard[];
  /** Heuristic ids `scanForInjection` must report (telemetry expectation). */
  readonly expectSignals?: readonly string[];
  /** True when the fixture must NOT be flagged (legitimate-looking question). */
  readonly expectClean?: boolean;
  /** Extra URLs to feed the fetch policy beyond the ones found in the payload. */
  readonly extraUrls?: readonly string[];
  /** True when the primary defense lives outside `src/security/`. */
  readonly delegated: boolean;
}

/**
 * Responsibility map. Every corpus id must appear here — a coverage test below
 * fails if the corpus grows and this map does not.
 */
const PLAN: Readonly<Record<string, FixturePlan>> = {
  "adv-inject-001": {
    guards: ["scan", "wrap"],
    expectSignals: [
      "role_marker",
      "ignore_previous_instructions",
      "role_play_jailbreak",
      "secret_exfiltration_bait",
    ],
    delegated: false,
  },
  "adv-inject-002": {
    guards: ["scan", "wrap", "render"],
    expectSignals: ["markdown_link_dangerous_scheme", "secret_exfiltration_bait", "role_marker"],
    delegated: false,
  },
  "adv-exfil-001": {
    guards: ["scan", "wrap", "render"],
    expectSignals: ["html_active_content", "html_remote_image", "secret_exfiltration_bait"],
    delegated: false,
  },
  "adv-resource-001": { guards: [], delegated: true },
  "adv-xxe-001": {
    guards: ["scan", "wrap", "url"],
    expectSignals: ["secret_exfiltration_bait"],
    // The https twins prove the refusal is not merely "scheme is not https".
    extraUrls: ["https://169.254.169.254/latest/meta-data/", "https://127.0.0.1/etc/passwd"],
    delegated: true,
  },
  "adv-ssrf-001": {
    guards: ["url"],
    // https twins of the payload's http targets: the refusal must rest on the
    // HOST, not merely on the scheme being http.
    extraUrls: [
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/iam/",
      "https://[::1]/",
      "https://10.0.0.5/internal",
    ],
    delegated: false,
  },
  "adv-tenant-001": { guards: [], delegated: true },
  "adv-tenant-002": { guards: [], delegated: true },
  "adv-fabricate-001": { guards: ["scan", "wrap"], expectClean: true, delegated: true },
  "adv-fabricate-002": { guards: ["scan", "wrap"], expectClean: true, delegated: true },
  "adv-tool-001": {
    guards: ["scan", "wrap"],
    expectSignals: ["tool_registration_directive"],
    delegated: true,
  },
  "adv-cite-tamper-001": { guards: [], delegated: true },
};

function planFor(fixture: AdversarialFixture): FixturePlan {
  const plan = PLAN[fixture.id];
  if (plan === undefined) {
    throw new Error(`no plan for corpus fixture ${fixture.id}`);
  }
  return plan;
}

/** Longest "meaty" word in the payload — used to prove verbatim preservation. */
function witnessWord(text: string): string | undefined {
  const words = text.match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9_]{5,}/g) ?? [];
  return words.sort((a, b) => b.length - a.length)[0];
}

describe("adversarial_v1 corpus coverage", () => {
  it("plans every fixture in the corpus, and nothing else", () => {
    const corpusIds = FIXTURES.map((f) => f.id).sort();
    expect(corpusIds.length).toBe(12);
    expect(Object.keys(PLAN).sort()).toEqual(corpusIds);
  });

  it("assigns every fixture to a local guard or an explicit delegation", () => {
    for (const fixture of FIXTURES) {
      const plan = planFor(fixture);
      expect(
        plan.guards.length > 0 || plan.delegated,
        `${fixture.id} is neither guarded locally nor delegated`,
      ).toBe(true);
    }
  });
});

for (const fixture of FIXTURES) {
  const plan = planFor(fixture);
  const text = payloadText(fixture);

  describe(`${fixture.id} (${fixture.threat}/${fixture.vector})`, () => {
    if (plan.guards.includes("scan")) {
      if (plan.expectClean === true) {
        it("scanForInjection does NOT flag a legitimate-looking question", () => {
          const result = scanForInjection(text);
          expect(result.signals.map((s) => s.id)).toEqual([]);
          expect(result.flagged).toBe(false);
        });
      } else {
        it("scanForInjection flags the payload with the expected signals", () => {
          const result = scanForInjection(text);
          expect(result.flagged).toBe(true);
          for (const expected of plan.expectSignals ?? []) {
            expect(
              result.signals.map((s) => s.id),
              `${fixture.id} missing signal ${expected}`,
            ).toContain(expected);
          }
          for (const signal of result.signals) {
            expect(signal.excerpt.length).toBeLessThanOrEqual(120);
          }
        });
      }
    }

    if (plan.guards.includes("wrap")) {
      it("wrapEvidenceForModel keeps the payload inert as fenced data", () => {
        const wrapped = wrapEvidenceForModel(text);

        expect(wrapped.startsWith(UNTRUSTED_PREAMBLE)).toBe(true);
        expect(wrapped.split(UNTRUSTED_BLOCK_OPEN).length - 1).toBe(1);
        expect(wrapped.split(UNTRUSTED_BLOCK_CLOSE).length - 1).toBe(1);
        expect(wrapped.endsWith(`\n${UNTRUSTED_BLOCK_CLOSE}`)).toBe(true);

        const start = wrapped.indexOf(UNTRUSTED_BLOCK_OPEN) + UNTRUSTED_BLOCK_OPEN.length;
        const body = wrapped.slice(start, wrapped.lastIndexOf(UNTRUSTED_BLOCK_CLOSE));

        // The payload became inert text: no markup character survives, so it
        // cannot close the fence, forge a role turn, or introduce a tag.
        expect(body).not.toContain("<");
        expect(body).not.toContain(">");

        // ...but it is escaped, not censored: the words are still there to be
        // read, summarized and cited.
        const witness = witnessWord(text);
        expect(witness, `no witness word in ${fixture.id}`).toBeDefined();
        expect(body).toContain(witness as string);
      });
    }

    if (plan.guards.includes("render")) {
      it("renderGuard leaves no live link or image on a non-allowlisted host", () => {
        const sanitized = sanitizeMarkdown(text);
        expect(liveOffAllowlistTargets(sanitized)).toEqual([]);
        // No raw markup at all, so <img>/<script>/onerror cannot become DOM.
        expect(sanitized).not.toContain("<");
        expect(sanitized).not.toContain(">");
        expect(sanitized).toBe(sanitizeMarkdown(sanitized));
      });

      it("renderGuard drops link titles carrying instruction payloads", () => {
        const sanitized = sanitizeMarkdown(text);
        expect(sanitized.toUpperCase()).not.toContain("ASSISTANT INSTRUCTION");
        expect(sanitized).not.toContain("/etc/passwd");
      });
    }

    if (plan.guards.includes("url")) {
      it("assertSafeFetchUrl rejects every URL the payload names", () => {
        const urls = [...urlsInPayload(fixture), ...(plan.extraUrls ?? [])];
        expect(urls.length, `${fixture.id} names no URL`).toBeGreaterThan(0);
        for (const url of urls) {
          const result = checkFetchUrl(url);
          expect(result.ok, `${url} was NOT rejected`).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBeTruthy();
          }
        }
      });
    }

    if (plan.delegated) {
      it("POLICY.md documents the delegation and the delegated component exists", () => {
        const rows = DELEGATION_ROWS.filter((row) => row.fixtureId === fixture.id);
        expect(rows.length, `POLICY.md has no delegation row for ${fixture.id}`).toBeGreaterThan(0);

        for (const row of rows) {
          expect(["enforced", "planned"]).toContain(row.status);

          if (row.status === "enforced") {
            const path = row.component.replace(/`/g, "").trim();
            expect(path.length, `${fixture.id} enforced row names no path`).toBeGreaterThan(0);
            expect(
              repoPathExists(path),
              `${fixture.id} delegates to ${path}, which does not exist`,
            ).toBe(true);
          } else {
            expect(
              KNOWN_GAPS,
              `${fixture.id} is a NEW planned gap — acknowledge it in KNOWN_GAPS`,
            ).toContain(fixture.id);
            expect(row.component.length).toBeGreaterThan(20);
          }
        }
      });
    }
  });
}

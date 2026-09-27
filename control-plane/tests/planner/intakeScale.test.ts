/**
 * W17/c — the concept pass must not freeze the server on a long document.
 *
 * MEASURED: one 441 KB petition took 53.9 s through POST
 * /v1/contracts/petition-analysis and `/v1/health` needed 48.9 s to answer in
 * the meantime — the event loop was blocked. Nearly all of it was here:
 * `tokenMatches` re-split the WHOLE text into words and re-stemmed every word
 * once per table token, for each of the 164 concepts. The words of one text
 * are now prepared once. On a ~180 KB narrative this measured 4 658 ms before
 * and 59 ms after (same machine, same input as below); the bound below sits
 * far from both, so it trips only on the quadratic behaviour coming back.
 */

import { describe, expect, it } from "vitest";
import { analyzeIntake } from "../../src/planner/intake.js";

function longNarrative(entries: number): string {
  const words: string[] = [];
  for (let i = 0; i < entries; i += 1) words.push(`kelime${i} olgusal anlatım ${i % 97}. satır`);
  return words.join(" ");
}

describe("W17/c · analyzeIntake scales with the text, not with text × table", () => {
  it("reads a ~180 KB account without re-stemming it per concept", () => {
    const question = longNarrative(5000);
    expect(question.length).toBeGreaterThan(150_000);
    const started = performance.now();
    const out = analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" });
    const elapsed = performance.now() - started;
    expect(out.issues.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("NON-VACUITY: the same answers as before on inflected, scattered words", () => {
    // "temerrüt … tahliye" in inflected form, far apart: the per-word stem and
    // prefix tests must still fire the concept exactly as before.
    const question =
      longNarrative(300) +
      " kiracı iki ay kirayı ödemedi, temerrüde düştü; noterden ihtarname gönderildi" +
      " ve tahliye davası açıldı.";
    const labels = analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" }).issues.map(
      (issue) => issue.label,
    );
    expect(labels).toContain("temerrüt nedeniyle tahliye");
  });
});

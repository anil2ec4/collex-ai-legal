/**
 * No source file may carry an invisible C0 control character (W17).
 *
 * MEASURED DEFECT, 05.09.2026. A regular expression written into
 * `relatedSearch.ts` through a generator lost its word-boundary escape and
 * kept the BACKSPACE byte (code 8) in its place. The file compiled, `tsc` was
 * clean, every test passed — and the pattern silently matched nothing, so the
 * court-family narrowing it guarded never fired. Nothing on screen could have
 * revealed it: the character is invisible in every editor and in every diff.
 *
 * That is the whole argument for this guard. A control character inside source
 * is never intentional here, it cannot be seen while reviewing, and it changes
 * behaviour without changing anything a reader can read.
 *
 * The check is written with CHARACTER CODES rather than a regular expression
 * on purpose: a guard against escaping accidents must not itself depend on an
 * escape sequence surviving whatever wrote this file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "tests", "scripts"];

/** TAB, LF and CR are the only control characters a source file may carry. */
const ALLOWED_CONTROLS: ReadonlySet<number> = new Set([9, 10, 13]);

/** Index of the first forbidden control character, or -1. */
function findControl(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 && !ALLOWED_CONTROLS.has(code)) return i;
  }
  return -1;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|mjs|js|json|yaml|yml)$/u.test(entry)) out.push(full);
  }
  return out;
}

describe("source hygiene: no invisible control characters", () => {
  it("finds none anywhere under src/, tests/ and scripts/", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((root) => walk(root))) {
      const text = readFileSync(file, "utf8");
      const at = findControl(text);
      if (at < 0) continue;
      const code = text.charCodeAt(at).toString(16).padStart(4, "0").toUpperCase();
      const line = text.slice(0, at).split("\n").length;
      offenders.push(`${file}:${line} U+${code}`);
    }
    expect(offenders, "görünmez kontrol karakteri taşıyan dosyalar").toEqual([]);
  });

  it("actually detects one when it is there (the guard is not vacuous)", () => {
    // The exact byte that caused the defect, built from its code so this file
    // does not have to contain it.
    const backspace = String.fromCharCode(8);
    expect(findControl(`abc${backspace}def`)).toBe(3);
    expect(findControl("abc\tdef\nghi\r\n")).toBe(-1);
  });
});

/**
 * The upload cap is ONE value in two runtimes: intake/quarantine.py
 * (`UPLOAD_CAP_MIB`, the source of truth and the place that explains the
 * number) and src/files/routes.ts (`UPLOAD_CAP_MIB`, the HTTP pre-check).
 * This test parses the Python constant so the two cannot drift.
 */

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_UPLOAD_BYTES, UPLOAD_CAP_MIB } from "../../src/files/routes.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const QUARANTINE_PY = path.join(REPO_ROOT, "intake", "quarantine.py");

describe("upload cap parity (quarantine.py <-> routes.ts)", () => {
  it("the Python UPLOAD_CAP_MIB equals the TypeScript one", async () => {
    const source = await readFile(QUARANTINE_PY, "utf8");
    const mib = source.match(/^UPLOAD_CAP_MIB\s*=\s*(\d+)\s*$/mu);
    expect(mib, "intake/quarantine.py must define UPLOAD_CAP_MIB = <int>").not.toBeNull();
    expect(Number(mib?.[1])).toBe(UPLOAD_CAP_MIB);
    // And MAX_FILE_BYTES derives from it (no second hard-coded number).
    expect(source).toMatch(/^MAX_FILE_BYTES\s*=\s*UPLOAD_CAP_MIB\s*\*\s*1024\s*\*\s*1024\s*$/mu);
  });

  it("the cap is 25 MiB by decision (documented in quarantine.py)", async () => {
    expect(UPLOAD_CAP_MIB).toBe(25);
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    const source = await readFile(QUARANTINE_PY, "utf8");
    expect(source).toContain("Why 25 and not 100");
  });
});

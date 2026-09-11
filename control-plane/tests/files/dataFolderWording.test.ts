/**
 * W14 phase C · N-2 — "where is my original?" names the DATA FOLDER.
 *
 * MEASURED (W14-F-VERIFY §6, N-2; first reported by W14-F-API §7.4): with
 * `COLLEX_DATA_DIR` set — exactly what the backup card advises — an uploaded
 * original is written to `<COLLEX_DATA_DIR>/uploads/<sha256><ext>` and the
 * repository's own `var/uploads` stays EMPTY. Three surfaces nevertheless
 * told the lawyer the file was missing from `var/uploads`, which on that
 * installation is a folder the document was never in:
 *
 *   src/files/routes.ts            ORIGINAL_NOT_FOUND
 *   src/matters/packageRoutes.ts   the package note for a missing original
 *   src/api/openapi.yaml           the 404 description quoting the sentence
 *
 * The wording now names the data folder and gives the default in parentheses,
 * which is true on every installation. The three carry the SAME words, so
 * this test reads all three sources — a fix in one of them cannot silently
 * leave the other two behind, which is how this survived a whole wave.
 */

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGINAL_MISSING_MESSAGE_TR } from "../../src/files/routes.js";

const CONTROL_PLANE = fileURLToPath(new URL("../../", import.meta.url));
const PACKAGE_ROUTES = path.join(CONTROL_PLANE, "src", "matters", "packageRoutes.ts");
const OPENAPI = path.join(CONTROL_PLANE, "src", "api", "openapi.yaml");

/** The phrase every surface must use, and the shape it must NOT go back to. */
const DATA_FOLDER_PHRASE = "veri klasörünüzdeki uploads klasöründe yok";
const DEFAULT_NOTE = "(varsayılan: var/uploads)";
const STALE_PHRASE = "(var/uploads klasöründe yok)";

describe("N-2 · the originals folder is named as the DATA folder", () => {
  it("ORIGINAL_NOT_FOUND names the data folder, with the default in parentheses", () => {
    expect(ORIGINAL_MISSING_MESSAGE_TR).toContain(DATA_FOLDER_PHRASE);
    expect(ORIGINAL_MISSING_MESSAGE_TR).toContain(DEFAULT_NOTE);
    // The old sentence asserted `var/uploads` as THE location.
    expect(ORIGINAL_MISSING_MESSAGE_TR).not.toContain(STALE_PHRASE);
    // Still tells the lawyer what they DO have.
    expect(ORIGINAL_MISSING_MESSAGE_TR).toContain("yalnız çıkarılan metin ve alıntılar");
  });

  it("the matter package note says the same thing", async () => {
    const source = await readFile(PACKAGE_ROUTES, "utf8");
    expect(source).toContain(DATA_FOLDER_PHRASE);
    expect(source).toContain(DEFAULT_NOTE);
    expect(source).not.toContain(STALE_PHRASE);
  });

  it("openapi.yaml quotes the sentence the route actually sends", async () => {
    // The YAML folds the description across lines, so both the phrase and
    // the whole quoted sentence are compared with whitespace collapsed.
    const flattened = (await readFile(OPENAPI, "utf8")).replace(/\s+/gu, " ");
    expect(flattened).toContain(DATA_FOLDER_PHRASE);
    expect(flattened).toContain(ORIGINAL_MISSING_MESSAGE_TR.replace(/\s+/gu, " "));
    expect(flattened).not.toContain(STALE_PHRASE);
  });
});

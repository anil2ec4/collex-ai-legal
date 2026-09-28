/**
 * W22 — the console card "UYAP'tan indirdiğim klasörü dosyalarıma dağıt".
 *
 * The card only ever PROPOSES: an ambiguous or unreadable row starts on
 * "Atla", the lawyer's choice is what is sent, and the import (which runs on
 * the server) offers no cancel button that would pretend to stop it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "console.html"), "utf8");
const START = HTML.indexOf("  /* ============ W22 · UYAP'tan indirilen klasörü dosyalara dağıt");
const END = HTML.indexOf("  /* ===================== Belge sayfası — yeni eylemler", START);
const BLOCK = HTML.slice(START, END);

function load(extra: Record<string, unknown> = {}): Record<string, any> {
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => null },
    mattersCache: [
      { id: "m1", title: "Yılmaz / Örnek" },
      { id: "m3", title: "Kara / Deniz" },
      { id: "m4", title: "SGK tespit" },
    ],
    ...extra,
  };
  runInNewContext(
    `${BLOCK}; this.api = { uyapProposedChoice, uyapChoiceOptions, uyapCollectRows, uyapState, UYAP_STATUS_TR };`,
    sandbox,
  );
  return (sandbox as { api: Record<string, any> }).api;
}

const row = (over: Record<string, unknown>) => ({
  path: "x.pdf",
  proposedAction: "skip",
  importable: true,
  match: { status: "ambiguous", matterId: null, candidates: [], reason: "", newMatter: null },
  ...over,
});

describe("UYAP card (console)", () => {
  it("is one block inside the page script, and it parses", () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
    const script = HTML.slice(HTML.indexOf("<script>") + 8, HTML.indexOf("</script>"));
    expect(() => new Script(script)).not.toThrow();
  });

  it("starts every row on the server's proposal and an ambiguous row on Atla", () => {
    const api = load();
    expect(api.uyapProposedChoice(row({ proposedAction: "assign", match: { status: "matched", matterId: "m1" } }))).toBe("m:m1");
    expect(api.uyapProposedChoice(row({ proposedAction: "new", match: { status: "unmatched", matterId: null } }))).toBe("new");
    expect(api.uyapProposedChoice(row({}))).toBe("skip");
  });

  it("lists the candidates first, then every other matter, and a new-matter option when proposed", () => {
    const api = load();
    const options = api.uyapChoiceOptions(
      row({
        match: {
          status: "ambiguous",
          matterId: null,
          candidates: [
            { matterId: "m3", title: "Kara / Deniz", docketNo: "2024/500 E.", reason: "" },
            { matterId: "m4", title: "SGK tespit", docketNo: "E. 2024/500", reason: "" },
          ],
          newMatter: { title: "İzmir 7. Asliye Hukuk Mahkemesi 2024/500 E.", court: "", docketNo: "2024/500 E." },
          reason: "",
        },
      }),
    ) as Array<[string, string]>;
    expect(options.map((o) => o[0])).toEqual(["skip", "new", "m:m3", "m:m4", "m:m1"]);
    expect(options[0]![1]).toBe("Atla — hiçbir dosyaya ekleme");
  });

  it("sends exactly the lawyer's choice, with the edited title for a new matter", () => {
    const api = load();
    api.uyapState.preview = {
      previewId: "p",
      rows: [
        row({ path: "a.udf", match: { status: "matched", matterId: "m1", candidates: [], newMatter: null } }),
        row({ path: "b.udf", match: { status: "unmatched", matterId: null, candidates: [], newMatter: { title: "Önerilen", court: "Ankara 3. İş Mahkemesi", docketNo: "2025/77 E." } } }),
        row({ path: "c.txt" }),
      ],
    };
    api.uyapState.choices = {
      "a.udf": { pick: { value: "m:m1" }, title: { value: "" } },
      "b.udf": { pick: { value: "new" }, title: { value: "  Delta Gıda cevap  " } },
      "c.txt": { pick: { value: "skip" }, title: { value: "" } },
    };
    expect(api.uyapCollectRows()).toEqual([
      { path: "a.udf", action: "assign", matterId: "m1" },
      { path: "b.udf", action: "new", newMatter: { title: "Delta Gıda cevap", court: "Ankara 3. İş Mahkemesi", docketNo: "2025/77 E." } },
      { path: "c.txt", action: "skip" },
    ]);
  });

  it("never offers a cancel that would not stop the server, and draws no percentage", () => {
    const importFn = BLOCK.slice(BLOCK.indexOf("function runUyapImport"), BLOCK.indexOf("function renderUyapResult"));
    expect(importFn).toContain("noCancelReason");
    expect(importFn).not.toContain("onCancel");
    expect(BLOCK).not.toMatch(/%\s*"|"\s*%/u);
    expect(BLOCK).toContain("Siz onaylamadan hiçbir belge yüklenmez.");
  });
});

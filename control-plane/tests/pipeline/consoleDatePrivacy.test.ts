import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");

describe("dates and outbound-data explanations in the shipped console", () => {
  it("shows an Istanbul midnight creation on the local day, leaving legal date-only values unchanged", () => {
    const start = html.indexOf("  function fmtDateTR(iso)");
    const end = html.indexOf("  function fmtDateTimeTR(iso)", start);
    const fn = runInNewContext(html.slice(start, end) + "; fmtDateTR", {
      Date: class extends Date {
        // Model the browser's Istanbul clock independently of the test worker's timezone.
        override getDate() { return new Date(this.getTime() + 10800000).getUTCDate(); }
        override getMonth() { return new Date(this.getTime() + 10800000).getUTCMonth(); }
        override getFullYear() { return new Date(this.getTime() + 10800000).getUTCFullYear(); }
      },
      pad2: (n: number) => String(n).padStart(2, "0"),
    }) as (value: string) => string;
    expect(fn("2026-09-06T21:18:00.000Z")).toBe("07.09.2026");
    expect(fn("2026-09-06")).toBe("06.09.2026");
    expect(fn("2026-09-06T21:18:00")).toBe("06.09.2026");
  });

  it("does not promise offline-only processing merely because cloud AI is off", () => {
    const explanation = html.match(/<p class="expl-def">([^<]*Açarsanız yalnız o sorunun[^<]*)<\/p>/)?.[1];
    expect(explanation).toBeDefined();
    expect(explanation).toMatch(/Resmî kaynaklarda/);
    expect(explanation).toMatch(/arama.*gönderilir/);
    expect(explanation).not.toMatch(/Kapalıyken her şey bu bilgisayarda kalır/);
    const off = html.slice(html.indexOf("  function applyCloudAiState()"), html.indexOf("  function syncCloudAiText()"));
    expect(off).not.toMatch(/her şey yerel çalışıyor/);
    expect(off).toMatch(/Resmî kaynaklarda/);
  });
});

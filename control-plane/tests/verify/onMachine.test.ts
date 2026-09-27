import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { type FetchLike, VERIFY_QUERIES, renderReportTr, runVerification } from "../../src/verify/onMachine.js";

/**
 * The on-machine verification drives a running ColleX over HTTP. Here the
 * HTTP layer is a fake (no network in tests); the rules under test are the
 * ones the report must never break: a failed source is ULAŞILAMADI with its
 * kind, never "no result"; a full text is re-hashed independently; nothing is
 * saved to the library; a count the source did not publish stays unknown.
 */
const CATALOG = {
  kaynaklar: [
    { id: "yargitay", ad: "Yargıtay" },
    { id: "kvkk", ad: "KVKK" },
    { id: "btk", ad: "BTK" },
  ],
};

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fakeServer(opts: { brokenSeal?: boolean; down?: boolean } = {}) {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init?.body !== undefined ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, ...(body !== undefined ? { body } : {}) });
    if (opts.down === true) throw new Error("ECONNREFUSED");
    const reply = (status: number, json: unknown) => ({ status, json: async () => json });
    if (url.endsWith("/v1/health")) {
      return reply(200, { version: "1.0.0", platform: "darwin", db: "ok", mcp: "ok", ocr: { state: "OCR_READY" }, localAi: { state: "not_configured" }, ai: { configured: false } });
    }
    if (url.endsWith("/v1/sources/catalog")) return reply(200, CATALOG);
    if (url.endsWith("/v1/sources/search")) {
      const source = (body?.["sources"] as string[])[0];
      if (source === "yargitay") {
        return reply(200, {
          rows: [{ fetchKind: "karar", externalId: "123", title: "Yargıtay 3. HD" }],
          failedSources: [],
          trace: [{ sourceId: "yargitay", totalRecords: 758 }],
        });
      }
      if (source === "kvkk") {
        return reply(200, { rows: [], failedSources: [], trace: [{ sourceId: "kvkk", totalRecords: null }] });
      }
      return reply(502, {
        error: {
          kind: "ALL_SOURCES_FAILED",
          failedSources: [{ sourceId: "btk", kind: "UNAVAILABLE", message: "BTK: kaynak sunucuya ulaşılamadı (UNAVAILABLE)." }],
        },
        trace: [{ sourceId: "btk", totalRecords: null }],
      });
    }
    if (url.endsWith("/v1/sources/fetch")) {
      const text = "Karar metni — tam.";
      return reply(200, { card: { contentSha256: opts.brokenSeal === true ? sha("başka") : sha(text), title: "Karar" }, text });
    }
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

describe("on-machine verification", () => {
  it("separates reached / reached-without-rows / unreachable, and re-hashes the full text", async () => {
    const server = fakeServer();
    const report = await runVerification({ fetchImpl: server.fetchImpl, pauseMs: 0 });
    const byId = Object.fromEntries(report.sources.map((s) => [s.sourceId, s]));
    expect(byId["yargitay"]?.state).toBe("ULASILDI");
    expect(byId["yargitay"]?.totalRecords).toBe(758);
    expect(byId["yargitay"]?.fetch?.state).toBe("MUHURLENDI");
    expect(byId["kvkk"]?.state).toBe("ULASILDI_SONUC_YOK");
    expect(byId["kvkk"]?.totalRecords).toBeNull();
    expect(byId["btk"]?.state).toBe("ULASILAMADI");
    expect(byId["btk"]?.errorKind).toBe("UNAVAILABLE");
    expect(report.summary).toMatchObject({ reached: 1, reachedNoRows: 1, unreachable: 1, fetchedSealed: 1 });
    // One request at a time, and nothing is filed into the library.
    const fetches = server.calls.filter((c) => c.url.endsWith("/v1/sources/fetch"));
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.body?.["saveToLibrary"]).toBe(false);
    for (const c of server.calls.filter((x) => x.url.endsWith("/v1/sources/search"))) {
      expect(VERIFY_QUERIES[(c.body?.["sources"] as string[])[0]!]).toBe(c.body?.["query"]);
    }
  });

  it("reports a broken seal instead of accepting the server's hash", async () => {
    const report = await runVerification({ fetchImpl: fakeServer({ brokenSeal: true }).fetchImpl, pauseMs: 0, only: ["yargitay"] });
    expect(report.sources[0]?.fetch?.state).toBe("MUHUR_TUTMADI");
    expect(report.summary.fetchSealBroken).toBe(1);
  });

  it("says ColleX is not running instead of reporting every source as failed", async () => {
    const report = await runVerification({ fetchImpl: fakeServer({ down: true }).fetchImpl, pauseMs: 0 });
    expect(report.health.reachable).toBe(false);
    expect(report.sources).toEqual([]);
    expect(renderReportTr(report)).toContain("ColleX çalışmıyor.");
  });

  it("writes a Turkish report that names each state and never turns an unknown count into 0", async () => {
    const report = await runVerification({ fetchImpl: fakeServer().fetchImpl, pauseMs: 0 });
    const md = renderReportTr(report, ["## Yerel yapay zekâ modeli\n\ndenenmedi"]);
    expect(md).toContain("| Yargıtay | kira tespiti | ulaşıldı, sonuç geldi | 1 | 758 |");
    expect(md).toContain("| KVKK | kişisel veri | ulaşıldı, bu sorguya sonuç yok | 0 | bildirmedi |");
    expect(md).toContain("ULAŞILAMADI (UNAVAILABLE)");
    expect(md).toContain("isabetini ölçmez");
    expect(md).toContain("## Yerel yapay zekâ modeli");
  });

  it("has a query for every one of the 26 catalog sources", async () => {
    const { SOURCE_CATALOG } = await import("../../src/sources/catalog.js");
    for (const source of SOURCE_CATALOG) {
      expect(VERIFY_QUERIES[source.id], source.id).toBeTruthy();
    }
    expect(Object.keys(VERIFY_QUERIES)).toHaveLength(26);
  });
});

describe("the double-click launchers", () => {
  it("ColleX-Dogrula.cmd and collex-verify.sh only run the verification script against loopback", async () => {
    const { readFileSync } = await import("node:fs");
    const cmd = readFileSync(new URL("../../../ColleX-Dogrula.cmd", import.meta.url), "utf8");
    const sh = readFileSync(new URL("../../../deploy/macos/collex-verify.sh", import.meta.url), "utf8");
    expect(cmd).toContain("node control-plane\\scripts\\verify-on-machine.mjs --base http://127.0.0.1:8787 %*");
    expect(sh).toContain('control-plane/scripts/verify-on-machine.mjs --base "http://127.0.0.1:${COLLEX_PORT:-8787}" "$@"');
    for (const text of [cmd, sh]) {
      // Verification never stops, kills or rewrites anything.
      expect(text).not.toMatch(/taskkill|netstat|pkill|dropdb|DROP DATABASE|rm -rf/iu);
    }
  });
});

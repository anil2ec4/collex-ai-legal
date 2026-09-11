/**
 * Turkish progress labels + the tracker that folds executor events into
 * the /v1/research/runs/{id} progress block (W12-F).
 */

import { describe, expect, it } from "vitest";
import { ALL_TOOL_NAMES } from "../../src/capabilities/registry.js";
import { lookupCapability } from "../../src/capabilities/registry.js";
import { ProgressTracker, progressLabelForTool } from "../../src/research/progress.js";

describe("progressLabelForTool", () => {
  it("names the tool families in lawyer Turkish", () => {
    expect(progressLabelForTool("search_bedesten_unified", "caseLaw.search")).toBe(
      "Yargıtay/Danıştay kararları aranıyor",
    );
    expect(progressLabelForTool("search", "caseLaw.search")).toBe(
      "Yargıtay/Danıştay kararları aranıyor",
    );
    expect(progressLabelForTool("search_mevzuat", "legislation.search")).toBe("Mevzuat aranıyor");
    expect(progressLabelForTool("search_within_kanun", "document.searchWithin")).toBe(
      "Mevzuat metni içinde aranıyor",
    );
    expect(progressLabelForTool("check_government_servers_health", "source.health")).toBe(
      "Kaynak sunucular kontrol ediliyor",
    );
    expect(progressLabelForTool("fetch", "document.fetch", { index: 2, total: 6 })).toBe(
      "Belge çekiliyor 2/6",
    );
    expect(
      progressLabelForTool("get_bedesten_document_markdown", "document.fetch", { index: 1, total: 1 }),
    ).toBe("Belge çekiliyor 1/1");
    expect(progressLabelForTool("get_mevzuat_content", "document.fetch")).toBe(
      "Mevzuat metni çekiliyor",
    );
    expect(progressLabelForTool("search_kvkk_decisions", "regulator.search")).toBe(
      "KVKK kararları aranıyor",
    );
  });

  it("gives EVERY registered tool a Turkish label (no raw tool name leaks)", () => {
    for (const tool of ALL_TOOL_NAMES) {
      const capability = lookupCapability(tool) ?? "";
      const label = progressLabelForTool(tool, capability);
      expect(label, tool).not.toBe("");
      expect(label, tool).not.toContain("_");
      expect(label, tool).toMatch(/aranıyor|çekiliyor|kontrol ediliyor|sorgulanıyor/u);
    }
  });

  it("falls back to the capability when the tool is unknown or native", () => {
    expect(progressLabelForTool(undefined, "legislation.search")).toBe("Mevzuat aranıyor");
    expect(progressLabelForTool("search_unknown_thing", "regulator.search")).toBe("Kaynak aranıyor");
    expect(progressLabelForTool(undefined, "nope")).toBe("Kaynak sorgulanıyor");
  });
});

describe("ProgressTracker", () => {
  it("folds start/end pairs into steps and counts tool calls and fetches", () => {
    const tracker = new ProgressTracker();
    tracker.listener({
      phase: "start",
      at: "t1",
      tool: "search_bedesten_unified",
      capability: "caseLaw.search",
      label: "Yargıtay/Danıştay kararları aranıyor",
      status: "running",
    });
    expect(tracker.snapshot().steps[0]).toEqual({
      at: "t1",
      label: "Yargıtay/Danıştay kararları aranıyor",
      tool: "search_bedesten_unified",
      status: "running",
    });
    tracker.listener({
      phase: "end",
      at: "t2",
      tool: "search_bedesten_unified",
      capability: "caseLaw.search",
      label: "Yargıtay/Danıştay kararları aranıyor",
      status: "ok",
      count: 3,
      ms: 120,
    });
    tracker.listener({
      phase: "start",
      at: "t3",
      tool: "fetch",
      capability: "document.fetch",
      label: "Belge çekiliyor 1/6",
      status: "running",
    });
    tracker.listener({
      phase: "end",
      at: "t4",
      tool: "fetch",
      capability: "document.fetch",
      label: "Belge çekiliyor 1/6",
      status: "timeout",
      ms: 80_000,
      errorKind: "TIMEOUT",
    });
    const snapshot = tracker.snapshot();
    expect(snapshot.toolCalls).toBe(2);
    expect(snapshot.fetches).toBe(1);
    expect(snapshot.steps).toEqual([
      {
        at: "t2",
        label: "Yargıtay/Danıştay kararları aranıyor",
        tool: "search_bedesten_unified",
        status: "ok",
        count: 3,
        ms: 120,
      },
      { at: "t4", label: "Belge çekiliyor 1/6", tool: "fetch", status: "timeout", ms: 80_000, errorKind: "TIMEOUT" },
    ]);
    // Snapshots are copies: mutating one does not touch the tracker.
    snapshot.steps[0]!.status = "failed";
    expect(tracker.snapshot().steps[0]?.status).toBe("ok");
  });

  it("records an end without a start rather than dropping it", () => {
    const tracker = new ProgressTracker();
    tracker.listener({
      phase: "end",
      at: "t",
      tool: "search_mevzuat",
      capability: "legislation.search",
      label: "Mevzuat aranıyor",
      status: "failed",
      errorKind: "UNAVAILABLE",
    });
    expect(tracker.snapshot().steps).toHaveLength(1);
    expect(tracker.snapshot().toolCalls).toBe(0);
  });
});

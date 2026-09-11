/**
 * W14 · B-02 (server side) and B-36 (record side).
 *
 * B-02: `GET /v1/drafts/{id}/export` gains two ADDITIVE query parameters,
 * `annex=full|none` and `marks=all|none`. Defaults are today's behaviour, so
 * nothing an existing client asks for changes. `annex=none&marks=none` is the
 * clean filing copy: no künye, no Uyarılar, no EK — DOĞRULAMA, no DAYANAK
 * KAYNAKLARI, no `[K-n]`, no `⚠ KAYNAKSIZ`, no SHA-256 — and the file name
 * says NİHAİ so it can never be confused with the audit copy.
 *
 * B-36: the three pre-filing boxes ride on the draft VERSION. While any box
 * is open the exported document carries the "doğrulama tamamlanmadı" line.
 *
 * Neither switch touches the gate: the quote-integrity refusal (B-01) runs
 * before the mode is even looked at, and is asserted here for `marks=none`.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { composeDraft } from "../../src/drafting/composer.js";
import {
  DEFAULT_EXPORT_MODE,
  REVIEW_CHECKLIST_ITEMS,
  VERIFICATION_INCOMPLETE_LINE,
  isReviewComplete,
  modeLabel,
  parseExportMode,
} from "../../src/drafting/exportMode.js";
import { renderDraftMarkdown } from "../../src/drafting/markdown.js";
import { reviseDraft } from "../../src/drafting/revise.js";
import { createDraftingRouter, exportFileName } from "../../src/drafting/routes.js";
import type { Draft } from "../../src/drafting/types.js";
import { davaRequest, tckPack, tckEvidence } from "./fixtures.js";

const NOW = () => new Date("2026-09-02T11:00:00.000Z");
const OPTS = { trustEntailment: false, now: NOW };
const FINAL = { annex: "none", marks: "none" } as const;

function baseDraft(): Draft {
  return composeDraft(
    davaRequest(),
    tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }] }),
    { now: NOW },
  );
}

function routerFor(draft: Draft, onExec?: (args: string[]) => void): Hono {
  const app = new Hono();
  app.route(
    "/",
    createDraftingRouter({
      store: { get: (id: string) => (id === draft.draftId ? draft : undefined) } as never,
      log: () => {},
      exec: async ({ args }) => {
        onExec?.(args);
        const out = args[args.indexOf("--out") + 1] as string;
        const { writeFile } = await import("node:fs/promises");
        await writeFile(out, "PK sentetik");
        return { code: 0, stderr: "" };
      },
    }),
  );
  return app;
}

describe("export mode parsing", () => {
  it("defaults to today's behaviour and accepts both switches", () => {
    expect(parseExportMode(undefined, undefined)).toEqual({ ok: true, mode: DEFAULT_EXPORT_MODE });
    expect(parseExportMode("none", "none")).toEqual({ ok: true, mode: FINAL });
    expect(parseExportMode("full", undefined)).toEqual({
      ok: true,
      mode: { annex: "full", marks: "all" },
    });
  });

  it("refuses an unknown value with a Turkish explanation", () => {
    const bad = parseExportMode("temiz", undefined);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("'full' veya 'none'");
    const badMarks = parseExportMode(undefined, "yok");
    expect(badMarks.ok).toBe(false);
    if (!badMarks.ok) expect(badMarks.message).toContain("'all' veya 'none'");
  });

  it("labels only the fully clean copy NİHAİ", () => {
    expect(modeLabel(DEFAULT_EXPORT_MODE)).toBe("TASLAK");
    expect(modeLabel({ annex: "none", marks: "all" })).toBe("TASLAK");
    expect(modeLabel({ annex: "full", marks: "none" })).toBe("TASLAK");
    expect(modeLabel(FINAL)).toBe("NİHAİ");
  });
});

describe("B-02 markdown: annex=none & marks=none", () => {
  it("drops the apparatus and every machine token, keeps the body", () => {
    const draft = baseDraft();
    const full = renderDraftMarkdown(draft);
    const final = renderDraftMarkdown(draft, { mode: FINAL });

    // Regression: the default is unchanged.
    expect(full).toContain("## DAYANAK KAYNAKLARI");
    expect(full).toContain("Dayanak [K-1]");
    expect(full).toContain(`Alıntının parmak izi: ${draft.evidence[0]!.quoteSha256}`);

    for (const forbidden of [
      "DAYANAK KAYNAKLARI",
      "[K-1]",
      "⚠ KAYNAKSIZ",
      "Alıntının parmak izi",
      "Kanıt kimliği",
      "Taslak kimliği",
      "## Uyarılar",
      draft.evidence[0]!.quoteSha256,
      draft.template,
    ]) {
      expect(final, forbidden).not.toContain(forbidden);
    }
    expect(final).not.toMatch(/\b[0-9a-f]{64}\b/u);
    expect(final).toContain("# Dava Dilekçesi (NİHAİ)");
    expect(final).toContain("> Dayanak: ");
    // Every body paragraph survives.
    for (const section of draft.sections) {
      if (section.id === "ek-dogrulama") continue;
      for (const paragraph of section.paragraphs) {
        expect(final).toContain(paragraph.text.split("\n")[0] as string);
      }
    }
  });

  it("keeps the mandatory review banner in the clean copy", () => {
    const final = renderDraftMarkdown(baseDraft(), { mode: FINAL });
    expect(final.startsWith("Bu taslak makine üretimidir")).toBe(true);
  });
});

describe("B-02 route: the two switches and the file name", () => {
  it("serves the clean copy and names it NİHAİ", async () => {
    const draft = baseDraft();
    const app = routerFor(draft);
    const response = await app.request(
      `/v1/drafts/${draft.draftId}/export?format=md&annex=none&marks=none`,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("(NİHAİ)");
    expect(body).not.toContain("[K-1]");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("NIHAI");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? "")).toContain("NİHAİ");
  });

  it("passes the switches through to the exporter process", async () => {
    const draft = baseDraft();
    let seen: string[] = [];
    const app = routerFor(draft, (args) => {
      seen = args;
    });
    await app.request(`/v1/drafts/${draft.draftId}/export?format=docx&annex=none&marks=none`);
    expect(seen).toContain("--annex");
    expect(seen[seen.indexOf("--annex") + 1]).toBe("none");
    expect(seen[seen.indexOf("--marks") + 1]).toBe("none");
    await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(seen[seen.indexOf("--annex") + 1]).toBe("full");
    expect(seen[seen.indexOf("--marks") + 1]).toBe("all");
  });

  it("answers a typed 400 for an unknown switch value", async () => {
    const draft = baseDraft();
    const app = routerFor(draft);
    const response = await app.request(
      `/v1/drafts/${draft.draftId}/export?format=md&annex=temiz`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("annex");
  });

  it("leaves the default file name exactly as it was", () => {
    const draft = baseDraft();
    expect(exportFileName(draft, "md").utf8).toBe(`${draft.title} - v1.md`);
    expect(exportFileName(draft, "md", undefined, DEFAULT_EXPORT_MODE).utf8).toBe(
      `${draft.title} - v1.md`,
    );
    expect(exportFileName(draft, "docx", "Yılmaz Kira", FINAL).utf8).toBe(
      `${draft.title} - Yılmaz Kira - v1 - NİHAİ.docx`,
    );
  });
});

describe("B-36: the pre-filing review record", () => {
  const sections = (draft: Draft) =>
    draft.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({
        id: s.id,
        paragraphs: s.paragraphs.map((p) => ({
          id: p.id,
          text: p.text,
          evidenceIds: [...p.evidenceIds],
          role: p.role,
        })),
      }));

  it("records who ticked what, when — with the SERVER's clock", () => {
    const draft = baseDraft();
    expect(isReviewComplete(draft.reviewChecklist)).toBe(false);
    const { draft: v2 } = reviseDraft(
      draft,
      {
        sections: sections(draft),
        reviewChecklist: {
          citationsOpened: { checked: true, by: "Av. Ayşe Yılmaz" },
          unsupportedReviewed: { checked: true },
          contraryRead: { checked: true, note: "Aleyhe karar yok." },
        },
      },
      OPTS,
    );
    expect(isReviewComplete(v2.reviewChecklist)).toBe(true);
    expect(v2.reviewChecklist?.citationsOpened?.at).toBe("2026-09-02T11:00:00.000Z");
    expect(v2.reviewChecklist?.citationsOpened?.by).toBe("Av. Ayşe Yılmaz");
    expect(v2.reviewChecklist?.contraryRead?.note).toBe("Aleyhe karar yok.");
  });

  it("carries the record into the next version and lets a box be untitcked", () => {
    const draft = baseDraft();
    const { draft: v2 } = reviseDraft(
      draft,
      {
        sections: sections(draft),
        reviewChecklist: Object.fromEntries(
          REVIEW_CHECKLIST_ITEMS.map((item) => [item.id, { checked: true }]),
        ),
      },
      OPTS,
    );
    // A save that says nothing about the record keeps it.
    const { draft: v3 } = reviseDraft(v2, { sections: sections(v2) }, OPTS);
    expect(isReviewComplete(v3.reviewChecklist)).toBe(true);
    // Unticking one box reopens the document.
    const { draft: v4 } = reviseDraft(
      v3,
      { sections: sections(v3), reviewChecklist: { contraryRead: { checked: false } } },
      OPTS,
    );
    expect(isReviewComplete(v4.reviewChecklist)).toBe(false);
    expect(renderDraftMarkdown(v4)).toContain(VERIFICATION_INCOMPLETE_LINE);
    expect(renderDraftMarkdown(v3)).not.toContain(VERIFICATION_INCOMPLETE_LINE);
  });

  it("ignores an unknown box and says so, never invents one", () => {
    const draft = baseDraft();
    const { draft: v2, issues } = reviseDraft(
      draft,
      { sections: sections(draft), reviewChecklist: { uydurmaKutu: { checked: true } } },
      OPTS,
    );
    expect(v2.reviewChecklist).toBeUndefined();
    expect(issues.some((i) => i.path === "reviewChecklist.uydurmaKutu")).toBe(true);
  });

  it("records a per-evidence review only for evidence the draft knows", () => {
    const draft = baseDraft();
    const { draft: v2, issues } = reviseDraft(
      draft,
      {
        sections: sections(draft),
        evidenceReview: {
          "ev-tck157": { checked: true, by: "Av. Ayşe Yılmaz", note: "Resmî metinle karşılaştırıldı." },
          "ev-yok": { checked: true },
        },
      },
      OPTS,
    );
    expect(v2.evidenceReview?.["ev-tck157"]?.note).toBe("Resmî metinle karşılaştırıldı.");
    expect(v2.evidenceReview?.["ev-yok"]).toBeUndefined();
    expect(issues.some((i) => i.path === "evidenceReview.ev-yok")).toBe(true);
  });

  it("survives the PUT wire contract", async () => {
    const draft = baseDraft();
    const store = new Map<string, Draft>([[draft.draftId, draft]]);
    const app = new Hono();
    app.route(
      "/",
      createDraftingRouter({
        store: {
          get: (id: string) => store.get(id),
          put: (d: Draft) => store.set(d.draftId, d),
        } as never,
        log: () => {},
        now: NOW,
      }),
    );
    const response = await app.request(`/v1/drafts/${draft.draftId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: sections(draft),
        reviewChecklist: {
          citationsOpened: { checked: true, by: "Av. Ayşe Yılmaz" },
          unsupportedReviewed: { checked: true },
          contraryRead: { checked: true },
        },
      }),
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as Draft;
    expect(isReviewComplete(saved.reviewChecklist)).toBe(true);
    expect(renderDraftMarkdown(saved)).not.toContain(VERIFICATION_INCOMPLETE_LINE);
  });
});

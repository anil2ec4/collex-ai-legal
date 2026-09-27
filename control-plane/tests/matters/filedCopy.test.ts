/**
 * Filed-copy defects in the matter lane (drafting audit, 27.09.2026): the
 * matter package's archive names, the postponed hearing in the calendar and
 * the `.ics` feed, and the civil day. Every test here failed on the tree
 * before the fix it pins.
 *
 * All content is SENTETİK — authored for these tests.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMatterPackageRouter, uniqueArchiveName } from "../../src/matters/packageRoutes.js";
import { createMattersRouter } from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import { todayIso, type MatterItem, type MatterSummary } from "../../src/matters/types.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

describe("#5 the matter package never loses or misnames an entry", () => {
  it("uniqueArchiveName suffixes deterministically, case-insensitively", () => {
    const taken = new Set<string>();
    expect(uniqueArchiveName("dilekce.pdf", taken)).toBe("dilekce.pdf");
    expect(uniqueArchiveName("Dilekce.pdf", taken)).toBe("Dilekce (2).pdf");
    expect(uniqueArchiveName("dilekce.pdf", taken)).toBe("dilekce (3).pdf");
    expect(uniqueArchiveName("Dava Dilekçesi - v1.docx", taken)).toBe("Dava Dilekçesi - v1.docx");
  });

  it("plans two same-named uploads and two same-titled drafts under distinct names", async () => {
    const uploads = await mkdtemp(join(tmpdir(), "collex-pkg-test-"));
    try {
      await writeFile(join(uploads, `${SHA_A}.pdf`), "A");
      await writeFile(join(uploads, `${SHA_B}.pdf`), "B");
      const store = new InMemoryMatterStore();
      const matter = await store.create({ title: "Kira — Şahin" });
      await store.addItem?.(matter.id, { kind: "file", refId: "aaaaaaaaaaaaaaaa", payload: {} });
      await store.addItem?.(matter.id, { kind: "file", refId: "bbbbbbbbbbbbbbbb", payload: {} });
      await store.addItem?.(matter.id, { kind: "draft", refId: "d-1", payload: {} });
      await store.addItem?.(matter.id, { kind: "draft", refId: "d-2", payload: {} });
      const drafts: Record<string, unknown> = {
        "d-1": { draftId: "d-1", title: "Dava Dilekçesi", version: 1 },
        "d-2": { draftId: "d-2", title: "Dava Dilekçesi", version: 1 },
      };
      let plan: {
        documents: { fileName: string; sha256: string }[];
        drafts: { fileName: string; draftPath: string }[];
      } = { documents: [], drafts: [] };
      const app = createMatterPackageRouter({
        store,
        uploadsDir: uploads,
        files: {
          originalRef: async (fileId: string) => ({
            sha256: fileId.startsWith("a") ? SHA_A : SHA_B,
            kind: "pdf",
            name: "dilekce.pdf",
            mime: "application/pdf",
          }),
        },
        drafts: { get: (id: string) => drafts[id] },
        exec: async ({ args }) => {
          plan = JSON.parse(await readFile(args[args.indexOf("--package") + 1] as string, "utf8"));
          await writeFile(args[args.indexOf("--out") + 1] as string, "PK");
          return { code: 0, stderr: "" };
        },
        log: () => undefined,
      });
      const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(plan.documents.map((d) => d.fileName)).toEqual(["dilekce.pdf", "dilekce (2).pdf"]);
      expect(plan.drafts.map((d) => d.fileName)).toEqual([
        "Dava Dilekçesi - v1.docx",
        "Dava Dilekçesi - v1 (2).docx",
      ]);
      expect(new Set(plan.drafts.map((d) => d.draftPath)).size).toBe(2);
    } finally {
      await rm(uploads, { recursive: true, force: true });
    }
  });

  it("a refusal does not claim tampering it did not detect", async () => {
    const store = new InMemoryMatterStore();
    const matter = await store.create({ title: "Kira — Şahin" });
    await store.addItem?.(matter.id, { kind: "draft", refId: "d-1", payload: {} });
    const app = createMatterPackageRouter({
      store,
      drafts: { get: () => ({ draftId: "d-1", title: "Dava Dilekçesi", version: 1 }) },
      exec: async () => ({ code: 2, stderr: "QUOTE_ALTERED" }),
      log: () => undefined,
    });
    const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("EXPORT_REFUSED");
    expect(body.error.message).not.toContain("kayıtlı özetiyle uyuşmuyor;");
    expect(body.error.message).toContain("doğrulanamadı");
  });
});

function clock(start = "2026-09-02T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

function harness() {
  const now = clock();
  const store = new InMemoryMatterStore(now);
  const app = createMattersRouter({ store, now });
  const send = async (path: string, method: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    const text = await res.text();
    return { status: res.status, text, body: text === "" || !text.startsWith("{") ? undefined : (JSON.parse(text) as unknown) };
  };
  return { app, store, send };
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/gu, "").split("\r\n");
}

describe("#10 a postponed hearing is not next, and the calendar says so", () => {
  it("drops out of nextHearing and is CANCELLED + 'ERTELENDİ — ' in the .ics, titled", async () => {
    const h = harness();
    const matter = (await h.send("/v1/matters", "POST", { title: "Yılmaz / Kira", client: "Ayşe Yılmaz" })).body as {
      id: string;
    };
    const created = (
      await h.send(`/v1/matters/${matter.id}/items`, "POST", {
        kind: "hearing",
        payload: {
          date: "2026-09-16",
          time: "09:30",
          court: "İzmir 3. Sulh Hukuk",
          title: "Bilirkişi raporuna itiraz",
        },
      })
    ).body as MatterItem;
    const before = (await h.send("/v1/matters", "GET")).body as { matters: MatterSummary[] };
    expect(before.matters[0]?.nextHearing?.itemId).toBe(created.itemId);

    const patched = await h.send(`/v1/matters/${matter.id}/items/${created.itemId}`, "PATCH", {
      payload: { status: "ertelendi" },
    });
    expect(patched.status).toBe(200);

    const after = (await h.send("/v1/matters", "GET")).body as { matters: MatterSummary[] };
    expect(after.matters[0]?.nextHearing).toBeNull();

    const ics = await h.send("/v1/matters/calendar.ics", "GET");
    expect(ics.status).toBe(200);
    const lines = unfold(ics.text);
    const summary = lines.find((l) => l.startsWith("SUMMARY:Duruşma") || l.startsWith("SUMMARY:ERTELENDİ"));
    expect(summary).toBeDefined();
    expect(summary!.startsWith("SUMMARY:ERTELENDİ — ")).toBe(true);
    expect(summary).toContain("Bilirkişi raporuna itiraz");
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines).not.toContain("STATUS:CONFIRMED");
    // A cancelled entry carries no reminder.
    expect(lines).not.toContain("BEGIN:VALARM");
  });

  it("a planned hearing keeps STATUS:CONFIRMED and its title in the SUMMARY", async () => {
    const h = harness();
    const matter = (await h.send("/v1/matters", "POST", { title: "Yılmaz / Kira", client: "Ayşe Yılmaz" })).body as {
      id: string;
    };
    await h.send(`/v1/matters/${matter.id}/items`, "POST", {
      kind: "hearing",
      payload: { date: "2026-09-16", time: "09:30", court: "İzmir 3. Sulh Hukuk", title: "Tanık dinlenmesi" },
    });
    const lines = unfold((await h.send("/v1/matters/calendar.ics", "GET")).text);
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).toContain("Tanık dinlenmesi");
  });
});

describe("#11 the civil day is Türkiye's, not UTC's", () => {
  it("01:30 in İstanbul on 27.09 is 27.09", () => {
    expect(todayIso(new Date("2026-09-26T22:30:00.000Z"))).toBe("2026-09-27");
    expect(todayIso(new Date("2026-09-27T20:59:00.000Z"))).toBe("2026-09-27");
  });
});

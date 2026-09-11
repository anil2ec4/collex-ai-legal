import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
async function exercise(status: number, current = "abc") {
  const opened: string[] = [], messages: string[] = [], requests: string[] = [];
  const button = { disabled: false, textContent: "Analizi yenile" };
  const context = {
    button, filesLoaded: true, uploadResults: { abc: { old: true } }, docPage: { fileId: current },
    enc: encodeURIComponent, postJson: async (url: string) => { requests.push(url); return { status }; },
    openDocument: (id: string) => opened.push(id), toast: (text: string) => messages.push(text),
    errMessage: () => "bütünlük kontrolü başarısız", humanError: (error: Error) => error.message,
  };
  const start = html.indexOf("  function reanalyzeDocument(");
  const end = html.indexOf("  function openDocument(", start);
  await runInNewContext(html.slice(start, end) + '; reanalyzeDocument("abc", button)', context);
  return { ...context, opened, messages, requests };
}
it("refreshes saved detail and invalidates stale upload caches after success", async () => {
  const result = await exercise(200);
  expect(result.requests).toEqual(["/v1/files/abc/reanalyze"]);
  expect(result.opened).toEqual(["abc"]);
  expect(result.filesLoaded).toBe(false);
  expect(result.uploadResults).toEqual({});
  expect(result.button.disabled).toBe(false);
  expect(html).toContain('reanalyzeDocument(f.fileId, refreshAnalysis)');
});
it("keeps the old detail when reanalysis fails and permits retry", async () => {
  const result = await exercise(422);
  expect(result.opened).toEqual([]);
  expect(result.filesLoaded).toBe(true);
  expect(result.messages[0]).toContain("yenilenemedi");
  expect(result.button.disabled).toBe(false);
});
it("does not pull the user back after they navigate away", async () => {
  expect((await exercise(200, "other")).opened).toEqual([]);
});

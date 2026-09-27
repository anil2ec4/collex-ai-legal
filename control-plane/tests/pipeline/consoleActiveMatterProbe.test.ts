import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

/**
 * 27.09.2026, measured in a real browser: after "+ Yeni dosya › Dosyayı aç"
 * the new matter's page showed the "aktif dosya" chip while the picker said
 * "Dosyasız çalışma", and the next upload from Belgeler went unlinked.
 *
 * Cause: the package-route probe POSTs to the NIL matter id on purpose and
 * EXPECTS `MATTER_NOT_FOUND`; it went through `parseJson`, whose global
 * dead-active-matter notice read that expected answer as "your active matter
 * was deleted" and cleared it. These tests run the page's own functions.
 */
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");

function slice(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

async function probeWith(body: unknown, status = 404) {
  const forgotten: string[] = [];
  const context: Record<string, unknown> = {
    Promise,
    Array,
    String,
    fetch: async () => ({ status, json: async () => body }),
    forgetActiveMatter: () => forgotten.push("forgot"),
    result: undefined,
  };
  const source =
    slice("  function parseJson(response) {", "  /* W14 B-10 (UXAUDIT P1-3)") +
    slice("  function noticeMatterNotFound(body) {", "  /* Aktif dosya artık yok") +
    slice("  var pkgState = ", "  function markPackageOff(") +
    "; probePackageRoute().then(function (m) { result = m; });";
  runInNewContext(source, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { mounted: context["result"], forgotten };
}

it("the package-route probe's expected MATTER_NOT_FOUND never clears the active matter", async () => {
  const out = await probeWith({ error: { kind: "MATTER_NOT_FOUND", message: "Dava dosyası bulunamadı." } });
  expect(out.mounted).toBe(true);
  expect(out.forgotten).toEqual([]);
});

it("the probe still reads an unmounted route as unmounted", async () => {
  const out = await probeWith({ error: { kind: "NOT_FOUND" } });
  expect(out.mounted).toBe(false);
  expect(out.forgotten).toEqual([]);
});

it("an ordinary response carrying MATTER_NOT_FOUND still clears a dead active matter", async () => {
  const forgotten: string[] = [];
  const context: Record<string, unknown> = {
    Array,
    String,
    forgetActiveMatter: () => forgotten.push("forgot"),
  };
  runInNewContext(
    slice("  function parseJson(response) {", "  /* W14 B-10 (UXAUDIT P1-3)") +
      slice("  function noticeMatterNotFound(body) {", "  /* Aktif dosya artık yok") +
      "; parseJson({ status: 404, json: function () { return Promise.resolve({ error: { kind: 'MATTER_NOT_FOUND' } }); } });",
    context,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(forgotten).toEqual(["forgot"]);
});

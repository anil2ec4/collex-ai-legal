import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
it.each([
  ["q", "Neyi öğrenmek istiyorsunuz?"],
  ["asof", "Hangi tarihteki hukuka göre?"],
  ["f-datefrom", "Tarih — başlangıç"],
  ["f-dateto", "Tarih — bitiş"],
  ["gridq", "Sorular"],
  ["d-instructions", "Ek bilgiler / talimatlar"],
])("associates the visible label with %s", (id, text) => {
  const labels = [...html.matchAll(/<label\b([^>]*)>([^<]*)<\/label>/gu)];
  expect(labels.some((m) => m[1]?.includes(`for="${id}"`) && m[2] === text)).toBe(true);
});

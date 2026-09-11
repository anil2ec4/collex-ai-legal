import { expect, it } from "vitest";
import { parseSearchPayload } from "../../src/research/payloads.js";
import { bedestenDecision, bedestenSearchPayload } from "./helpers.js";

it.each([
  ["2026-05-10T21:00:00.000+00:00", "11.05.2026", "2026-05-11"],
  ["2026-06-30T21:00:00.000+00:00", "01.07.2026", "2026-07-01"],
  ["2026-05-10T21:00:00.000Z", undefined, "2026-05-11"],
  ["2015-01-10T22:00:00.000Z", undefined, "2015-01-11"],
  ["2026-05-11", undefined, "2026-05-11"],
  [undefined, "11.05.2026", "2026-05-11"],
  [undefined, "31.02.2026", undefined],
  ["2026-02-31", undefined, undefined],
  [undefined, undefined, undefined],
])("keeps the official Turkish decision day (%s, %s)", (timestamp, display, expected) => {
  const result = parseSearchPayload("search_bedesten_unified", bedestenSearchPayload([
    bedestenDecision("1224717400", { kararTarihi: timestamp, kararTarihiStr: display }),
  ]));
  expect(result.kind).toBe("hits");
  if (result.kind !== "hits") throw new Error("No typed result");
  expect(result.hits[0]?.decisionDate).toBe(expected);
});

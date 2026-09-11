/**
 * Input normalization (W12): list-kind strings, GG.AA.YYYY dates, party and
 * event line forms, the pre-zod body normalizer.
 */

import { describe, expect, it } from "vitest";

import {
  dateSortKey,
  datifSuffix,
  formatDateTr,
  formatTimestampTr,
  normalizeDraftRequestInput,
  parseEventLine,
  parsePartyLine,
  splitLines,
} from "../../src/drafting/input.js";

describe("splitLines", () => {
  it("splits strings on newlines, trims, strips bullets, drops empties; passes arrays through", () => {
    expect(splitLines("a\r\n  b \n\n- c\n3) d\n• e\n")).toEqual(["a", "b", "c", "d", "e"]);
    expect(splitLines(["x", " ", "y "])).toEqual(["x", "y"]);
    expect(splitLines(42)).toEqual([]);
    expect(splitLines(undefined)).toEqual([]);
  });
});

describe("dates", () => {
  it("renders ISO, GG.AA.YYYY and GG/AA/YYYY as GG.AA.YYYY; leaves the rest alone", () => {
    expect(formatDateTr("2025-01-05")).toBe("05.01.2025");
    expect(formatDateTr("2025-01-05T10:00:00Z")).toBe("05.01.2025");
    expect(formatDateTr("5.1.2025")).toBe("05.01.2025");
    expect(formatDateTr("05/01/2025")).toBe("05.01.2025");
    expect(formatDateTr("sonbahar 2025")).toBe("sonbahar 2025");
    expect(dateSortKey("05.01.2025")).toBe("2025-01-05");
    expect(dateSortKey("yok")).toBeUndefined();
    // W12-FIX2 (P2-5): LOCAL time, no zone tag — what the lawyer's wall clock says.
    const at = new Date("2026-09-02T09:30:00.000Z");
    const pad = (n: number): string => String(n).padStart(2, "0");
    const local = `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    expect(formatTimestampTr("2026-09-02T09:30:00.000Z")).toBe(local);
    expect(formatTimestampTr("2026-09-02T09:30:00.000Z")).not.toContain("UTC");
    expect(formatTimestampTr("bozuk")).toBe("bozuk");
  });

  it("datifSuffix follows vowel harmony", () => {
    expect(datifSuffix("ASLİYE HUKUK MAHKEMESİ")).toBe("'NE");
    expect(datifSuffix("BAŞKANLIĞI")).toBe("'NA");
    expect(datifSuffix("MÜDÜRLÜĞÜ")).toBe("'NE");
  });
});

describe("line forms", () => {
  it("parses party and event lines", () => {
    expect(parsePartyLine("Davacı : Ayşe Yılmaz")).toEqual({ rol: "Davacı", ad: "Ayşe Yılmaz" });
    expect(parsePartyLine("Ayşe Yılmaz (Davacı)")).toEqual({ rol: "Davacı", ad: "Ayşe Yılmaz" });
    expect(parsePartyLine("sadece ad")).toBeUndefined();
    expect(parseEventLine("2025-01-05 Olay bir")).toEqual({ tarih: "2025-01-05", metin: "Olay bir" });
    expect(parseEventLine("05.01.2025 — Olay bir")).toEqual({ tarih: "05.01.2025", metin: "Olay bir" });
    expect(parseEventLine("Tarihsiz olay")).toEqual({ metin: "Tarihsiz olay" });
  });

  it("normalizeDraftRequestInput turns console strings into arrays and evet/hayır into booleans", () => {
    const out = normalizeDraftRequestInput({
      kind: "dilekce",
      template: "dava-dilekcesi",
      matter: {
        taraflar: "Davacı : A\nDavalı : B",
        olaylar: "05.01.2025 — x\ny",
        talepler: "t1\nt2",
        arabuluculuk: { yapildi: "evet" },
      },
    }) as { matter: Record<string, unknown> };
    expect(out.matter["taraflar"]).toEqual([
      { rol: "Davacı", ad: "A" },
      { rol: "Davalı", ad: "B" },
    ]);
    expect(out.matter["olaylar"]).toEqual([{ tarih: "05.01.2025", metin: "x" }, { metin: "y" }]);
    expect(out.matter["talepler"]).toEqual(["t1", "t2"]);
    expect(out.matter["arabuluculuk"]).toEqual({ yapildi: true });
    // An unparseable party line is left for zod to reject.
    const bad = normalizeDraftRequestInput({ matter: { taraflar: "sadece ad" } }) as { matter: Record<string, unknown> };
    expect(bad.matter["taraflar"]).toBe("sadece ad");
    expect(normalizeDraftRequestInput("garbage")).toBe("garbage");
  });
});

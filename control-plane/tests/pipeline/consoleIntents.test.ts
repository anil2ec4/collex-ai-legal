import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * W23 — "Önerilen iş" in the quick search. The lawyer writes what they want
 * in their own words; a rule table proposes the screen. These tests run the
 * page's own functions (sliced out of console.html) in a VM.
 */
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
const start = html.indexOf("  function palFold(s) {");
const end = html.indexOf("  /* ====== /W23 önerilen iş ====== */");
const block = html.slice(start, end);

function run(q: string) {
  const calls: Array<{ fn: string; arg: unknown }> = [];
  const ctx: Record<string, unknown> = {
    String,
    palItem: (kind: string, title: string, sub: string, fn: () => void) => ({ kind, title, sub, fn }),
    openDeadlineModal: (opts: unknown) => calls.push({ fn: "deadline", arg: opts }),
    openNoticeModal: (opts: unknown) => calls.push({ fn: "notice", arg: opts }),
    gotoView: (v: string) => calls.push({ fn: "goto", arg: v }),
    document: { getElementById: () => null },
    out: null,
  };
  runInNewContext(`${block}\nout = paletteIntentItems(${JSON.stringify(q)});`, ctx);
  const items = ctx["out"] as Array<{ kind: string; title: string; fn: () => void }>;
  return { items, calls, press: (i: number) => items[i]!.fn() };
}

describe("W23 önerilen iş", () => {
  it("found the markers", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it.each([
    ["ödeme emrine itiraz süresi", "iik-odeme-emri-itiraz"],
    ["ÖDEME EMRİNE İTİRAZ ne zaman biter", "iik-odeme-emri-itiraz"],
    ["istinaf süresi kaç gün", "hmk-istinaf"],
    ["ceza davasında istinaf süresi", "cmk-istinaf"],
    ["idare mahkemesi kararına istinaf son gün", "iyuk-istinaf"],
    ["temyiz süresi", "hmk-temyiz"],
    ["cevap dilekçesi süresi", "hmk-cevap"],
    ["bilirkişi raporuna itiraz", "hmk-bilirkisi-rapor-itiraz"],
    ["işe iade başvurusu", "is-ise-iade-arabulucu-basvuru"],
    ["mirasın reddi", "tmk-mirasin-reddi"],
  ])("“%s” proposes the deadline rule %s, and only opens the window", (q, rule) => {
    const r = run(q);
    expect(r.items[0]?.kind).toBe("Önerilen iş");
    r.press(0);
    expect(r.calls).toEqual([{ fn: "deadline", arg: { ruleId: rule } }]);
  });

  it.each([
    ["istinaf harcı ne kadar", "harc"],
    ["yasal faiz hesapla", "faiz"],
    ["karşı tarafın dilekçesini incele", "dilekce"],
    ["dilekçemdeki atıfları denetle", "denetim"],
    ["kira sözleşmesini incele", "sozlesme"],
    ["ihtarname hazırla", "taslak"],
    ["yargıtay kararı ara kira tespiti", "karar-ara"],
    ["duruşma takvimi", "takvim"],
  ])("“%s” proposes the %s screen", (q, view) => {
    const r = run(q);
    r.press(0);
    expect(r.calls[0]).toEqual({ fn: "goto", arg: view });
  });

  it("“e-tebligat geldi, süre ne zaman bitiyor” opens the tebligat reader first", () => {
    const r = run("e-tebligat geldi, süre ne zaman bitiyor");
    expect(r.items[0]?.title).toBe("Tebligattan süre çıkar");
    r.press(0);
    expect(r.calls).toEqual([{ fn: "notice", arg: {} }]);
  });

  it("proposes nothing it cannot justify, but always offers to research a sentence", () => {
    const r = run("kiracının tahliyesi için ne gerekir");
    expect(r.items.map((i) => i.title)).toEqual(["Bu soruyu araştır: “kiracının tahliyesi için ne gerekir”"]);
    r.press(0);
    expect(r.calls).toEqual([{ fn: "goto", arg: "arastir" }]);
    expect(run("abc").items).toEqual([]);
  });

  it("never starts work by itself: building the list calls nothing", () => {
    const r = run("ödeme emrine itiraz süresi");
    expect(r.calls).toEqual([]);
  });
});

describe("the deadline window honours a proposed rule", () => {
  it("the first-computable default no longer overwrites a preselected rule (measured: it opened on hmk-cevap)", () => {
    expect(html).toContain(
      "if (opts.ruleId && byId[opts.ruleId] && byId[opts.ruleId].computable !== false) { ruleSel.value = opts.ruleId; }",
    );
    expect(html).toContain(
      "if (firstComputable && !(opts.ruleId && ruleSel.value === opts.ruleId)) { ruleSel.value = firstComputable.id; }",
    );
  });
});

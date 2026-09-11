/**
 * Rule registry contract: every rule carries a statutory reference and a
 * verification block, ids are unique, the required coverage is present, the
 * periods match the statute text the notes cite, and the disclaimer is the
 * verbatim contract string.
 *
 * W14 (B-11) adds: >= 40 rules; a `dogrulandi` rule must name its article AND
 * an access date in `verified.source` (a sourceless "dogrulandi" is rejected);
 * the two rules that carried repealed law are corrected; the three-state
 * `adliTatileTabi`; `nasilDogrulanir` on every rule; and the new disclaimer.
 */

import { describe, expect, it } from "vitest";

import {
  DEADLINE_DISCLAIMER,
  DEADLINE_PROCEDURES,
  DEADLINE_RULES,
  DEADLINE_UNITS,
  findDeadlineRule,
} from "../../src/deadlines/rules.js";

const VERBATIM_DISCLAIMER =
  "Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler avukatça kontrol edilmelidir — kaçırılan süreden ColleX sorumlu değildir.";

const REQUIRED_IDS = [
  "hmk-cevap",
  "hmk-cevaba-cevap",
  "hmk-istinaf",
  "hmk-istinafa-cevap",
  "hmk-temyiz",
  "hmk-karar-duzeltme",
  "hmk-islah",
  "hmk-kesin-sure",
  "hmk-on-inceleme-belge",
  "hmk-bilirkisi-rapor-itiraz",
  "cmk-itiraz",
  "cmk-istinaf",
  "cmk-temyiz",
  "iyuk-dava-idare",
  "iyuk-dava-vergi",
  "iyuk-cevap",
  "iyuk-istinaf",
  "iyuk-temyiz",
  "iik-odeme-emri-itiraz",
  "iik-kambiyo-itiraz",
  "iik-itirazin-iptali",
  "iik-icra-mahkemesi-istinaf",
  "iik-haciz-isteme",
  "iik-kiymet-takdiri-sikayet",
  "iik-ihalenin-feshi",
  "iik-kira-odeme-emri-itiraz",
  "aym-bireysel-basvuru",
  "thh-itiraz",
  "is-arabuluculuk-dava-sarti",
  "tbk-kira-odeme-suresi",
  "tbk-tahliye-taahhudu-dava",
  "tbk-iki-hakli-ihtar-dava",
  "tmk-mirasin-reddi",
];

describe("DEADLINE_RULES registry", () => {
  it("has the mandatory disclaimer verbatim and names ColleX, not 'uygulama'", () => {
    expect(DEADLINE_DISCLAIMER).toBe(VERBATIM_DISCLAIMER);
    // W13-COPY L31: in legal Turkish "uygulama" reads as settled case law.
    expect(DEADLINE_DISCLAIMER).not.toContain("uygulama sorumlu");
  });

  it("covers every required rule id and carries at least 40 rules (B-11)", () => {
    const ids = DEADLINE_RULES.map((rule) => rule.id);
    for (const id of REQUIRED_IDS) expect(ids, id).toContain(id);
    expect(DEADLINE_RULES.length).toBeGreaterThanOrEqual(40);
  });

  it("every rule has a reference, a verified block, notes and a well-formed shape", () => {
    const ids = new Set<string>();
    for (const rule of DEADLINE_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
      expect(ids.has(rule.id), `duplicate id ${rule.id}`).toBe(false);
      ids.add(rule.id);
      expect(rule.title.length).toBeGreaterThan(5);
      expect(DEADLINE_PROCEDURES).toContain(rule.procedure);
      expect(["teblig", "tefhim", "ogrenme", "karar"]).toContain(rule.startKind);

      expect(rule.reference.legislationNo.length).toBeGreaterThan(0);
      expect(rule.reference.article.length).toBeGreaterThan(0);
      expect(rule.reference.label.length).toBeGreaterThan(0);

      expect(["dogrulandi", "dogrulanmadi"]).toContain(rule.verified.status);
      expect(rule.verified.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(rule.verified.source.length).toBeGreaterThan(10);
      if (rule.verified.status === "dogrulandi") {
        // A verified rule must not carry the "no network" attempt text.
        expect(rule.verified.source).not.toContain("ağ erişimi yoktu");
      }

      expect(rule.notes.length).toBeGreaterThanOrEqual(1);
      for (const note of rule.notes) {
        expect(note.length).toBeGreaterThan(20);
        expect(note).not.toContain("TODO");
      }
      expect(rule.periodLabel.length).toBeGreaterThan(0);
      expect(typeof rule.adliTatilApplies).toBe("boolean");
      expect([true, false, "belirsiz"]).toContain(rule.adliTatileTabi);
      expect(DEADLINE_UNITS).toContain(rule.period.unit);
      if (rule.computable) {
        expect(Number.isInteger(rule.period.value)).toBe(true);
        expect(rule.period.value).toBeGreaterThanOrEqual(1);
      } else {
        expect(rule.period.value).toBe(0);
        expect(rule.notes.join(" ")).toMatch(/hesaplanamaz|modellenmemiştir|dava şartı/u);
      }
    }
  });

  it("REJECTS a sourceless 'dogrulandi': a verified rule names its article and access date", () => {
    const verified = DEADLINE_RULES.filter((rule) => rule.verified.status === "dogrulandi");
    expect(verified.length).toBeGreaterThan(0);
    for (const rule of verified) {
      const source = rule.verified.source;
      // Article citation (e.g. "m.363/1") — never a bare "doğrulandı".
      expect(source, rule.id).toMatch(/m\.\s?\d+/u);
      // Access date in GG.AA.YYYY.
      expect(source, rule.id).toMatch(/\d{2}\.\d{2}\.\d{4}/u);
      // Where the text came from.
      expect(source, rule.id).toContain("mevzuat.gov.tr");
      // The text must have been in hand — never a "rests on knowledge" claim.
      expect(source, rule.id).not.toContain("bilgisine dayanır");
      expect(source, rule.id).not.toContain("çekilmedi");
    }
  });

  it("every rule tells the lawyer how to verify it in one minute (B-11)", () => {
    for (const rule of DEADLINE_RULES) {
      expect(rule.nasilDogrulanir.length, rule.id).toBeGreaterThan(40);
      // It must name an article, so the lawyer knows what to open.
      expect(rule.nasilDogrulanir, rule.id).toMatch(/m\.\s?\d+|ek m\.|Ek m\.|geçici m\./u);
      expect(rule.nasilDogrulanir, rule.id).not.toContain("TODO");
    }
  });

  it("carries the periods the cited articles state", () => {
    const period = (id: string) => findDeadlineRule(id)?.period;
    expect(period("hmk-cevap")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-cevaba-cevap")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-istinaf")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-istinafa-cevap")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-temyiz")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-bilirkisi-rapor-itiraz")).toEqual({ value: 2, unit: "hafta" });
    expect(period("hmk-on-inceleme-belge")).toEqual({ value: 2, unit: "hafta" });
    expect(period("cmk-itiraz")).toEqual({ value: 2, unit: "hafta" });
    expect(period("cmk-istinaf")).toEqual({ value: 2, unit: "hafta" });
    expect(period("cmk-temyiz")).toEqual({ value: 2, unit: "hafta" });
    expect(period("iyuk-dava-idare")).toEqual({ value: 60, unit: "gun" });
    expect(period("iyuk-dava-vergi")).toEqual({ value: 30, unit: "gun" });
    expect(period("iyuk-cevap")).toEqual({ value: 30, unit: "gun" });
    expect(period("iyuk-istinaf")).toEqual({ value: 30, unit: "gun" });
    expect(period("iyuk-temyiz")).toEqual({ value: 30, unit: "gun" });
    expect(period("iik-odeme-emri-itiraz")).toEqual({ value: 7, unit: "gun" });
    expect(period("iik-kambiyo-itiraz")).toEqual({ value: 5, unit: "gun" });
    expect(period("iik-itirazin-iptali")).toEqual({ value: 1, unit: "yil" });
    expect(period("iik-haciz-isteme")).toEqual({ value: 1, unit: "yil" });
    expect(period("iik-kiymet-takdiri-sikayet")).toEqual({ value: 7, unit: "gun" });
    expect(period("iik-ihalenin-feshi")).toEqual({ value: 7, unit: "gun" });
    expect(period("iik-kira-odeme-emri-itiraz")).toEqual({ value: 7, unit: "gun" });
    expect(period("aym-bireysel-basvuru")).toEqual({ value: 30, unit: "gun" });
    expect(period("thh-itiraz")).toEqual({ value: 15, unit: "gun" });
    expect(period("tbk-kira-odeme-suresi")).toEqual({ value: 30, unit: "gun" });
    expect(period("tbk-tahliye-taahhudu-dava")).toEqual({ value: 1, unit: "ay" });
    expect(period("tbk-iki-hakli-ihtar-dava")).toEqual({ value: 1, unit: "ay" });
    expect(period("tmk-mirasin-reddi")).toEqual({ value: 3, unit: "ay" });
  });

  // ---------------------------------------------------------------- B-11 P0
  it("İİK m.363/1: two weeks FROM TEBLİĞ — the repealed 'on gün / tefhim' is gone", () => {
    const rule = findDeadlineRule("iik-icra-mahkemesi-istinaf")!;
    expect(rule.period).toEqual({ value: 2, unit: "hafta" });
    expect(rule.periodLabel).toBe("2 hafta");
    expect(rule.startKind).toBe("teblig");
    expect(rule.transition?.effectiveFrom).toBe("2024-06-01");
    expect(rule.transition?.law).toContain("7499");
    expect(rule.transition?.before).toContain("on gün");
    const notes = rule.notes.join(" ");
    expect(notes).toContain("İKİ HAFTADIR");
    expect(notes).toContain("7499");
    // The reversed reading of the scope is corrected: the article lists the
    // decisions that are CLOSED to istinaf, and the monetary limit is named.
    expect(notes).toContain("DIŞINDAKİ");
    expect(notes).toContain("parasal sınır");
    expect(rule.verified.status).toBe("dogrulandi");
    // Ten days may appear ONLY as the quoted repealed wording inside the
    // amendment sentence — never as this rule's own period.
    expect(notes).not.toMatch(/başvuru süresi[^.]*on gün/u);
    expect(notes).not.toContain("tefhim veya tebliği tarihinden itibaren on gündür");
    expect(notes).toContain('"on gündür." ibaresi "iki haftadır."');
  });

  it("no rule still repeats the repealed ten-day İİK m.363 period", () => {
    for (const rule of DEADLINE_RULES) {
      const text = `${rule.title} ${rule.notes.join(" ")}`;
      expect(text, rule.id).not.toMatch(/istinaf süresi on gündür/u);
    }
    // hmk-istinaf carried the same wrong number in its "özel kanun" note.
    const hmk = findDeadlineRule("hmk-istinaf")!.notes.join(" ");
    expect(hmk).toContain("iki haftadır (İİK m.363/1");
  });

  it("HMK m.176/2: ıslah is 'ancak bir kez', not 'her aşamada bir kez'", () => {
    const notes = findDeadlineRule("hmk-islah")!.notes.join(" ");
    expect(notes).toContain("Aynı davada taraflar ancak bir kez");
    expect(notes).not.toContain("davanın her aşamasında sadece bir kez");
    expect(notes).not.toContain("her aşamasında sadece bir kez");
  });

  it("no raw rule id or diacritic-less machine value is shown to the lawyer (L32, L33)", () => {
    const ids = new Set(DEADLINE_RULES.map((rule) => rule.id));
    for (const rule of DEADLINE_RULES) {
      const text = `${rule.title} ${rule.periodLabel} ${rule.notes.join(" ")} ${rule.nasilDogrulanir}`;
      for (const quoted of text.matchAll(/'([^']{3,60})'/gu)) {
        expect(ids.has(quoted[1]!), `${rule.id} shows raw rule id ${quoted[1]}`).toBe(false);
      }
      expect(text, rule.id).not.toContain("'ozel'");
    }
  });

  it("marks the note-only rules as not computable", () => {
    for (const id of [
      "hmk-islah",
      "hmk-karar-duzeltme",
      "hmk-kesin-sure",
      "is-arabuluculuk-dava-sarti",
    ]) {
      expect(findDeadlineRule(id)?.computable, id).toBe(false);
    }
    expect(findDeadlineRule("hmk-islah")?.notes.join(" ")).toContain("tahkikat");
    expect(findDeadlineRule("hmk-karar-duzeltme")?.notes.join(" ")).toContain("karar düzeltme yolu öngörmez");
  });

  it("CMK rules record the 7499 transition and never apply HMK m.104", () => {
    for (const rule of DEADLINE_RULES.filter((candidate) => candidate.procedure === "CMK")) {
      expect(rule.adliTatilApplies, rule.id).toBe(false);
      expect(rule.transition?.effectiveFrom, rule.id).toBe("2024-06-01");
      expect(rule.transition?.law).toContain("7499");
      expect(rule.notes.join(" ")).toContain("7499");
    }
  });

  it("HMK computable rules use the adli tatil extension; İİK, AYM rules do not", () => {
    for (const rule of DEADLINE_RULES) {
      if (rule.procedure === "HMK" && rule.computable) expect(rule.adliTatilApplies, rule.id).toBe(true);
      if (rule.procedure === "İİK" || rule.procedure === "AYM") expect(rule.adliTatilApplies, rule.id).toBe(false);
      if (rule.procedure === "İYUK") expect(rule.adliTatilApplies, rule.id).toBe(true);
    }
  });

  it("a 'belirsiz' adli tatil rule keeps the SHORT boolean and says so in its notes", () => {
    const belirsiz = DEADLINE_RULES.filter((rule) => rule.adliTatileTabi === "belirsiz");
    expect(belirsiz.length).toBeGreaterThan(0);
    for (const rule of belirsiz) {
      // The computed date must stay on the safe (shorter) side.
      expect(rule.adliTatilApplies, rule.id).toBe(false);
      expect(rule.notes.join(" "), rule.id).toMatch(/tartışmalı|uygulanmaz|UYGULAMAZ|belirsiz/u);
    }
    expect(findDeadlineRule("iik-itirazin-iptali")?.adliTatileTabi).toBe("belirsiz");
    expect(findDeadlineRule("thh-itiraz")?.adliTatileTabi).toBe("belirsiz");
  });

  it("adliTatileTabi agrees with adliTatilApplies whenever it is a boolean", () => {
    for (const rule of DEADLINE_RULES) {
      if (typeof rule.adliTatileTabi === "boolean") {
        expect(rule.adliTatileTabi, rule.id).toBe(rule.adliTatilApplies);
      }
    }
  });

  it("every rule explains practice divergences in its notes (conservative texts)", () => {
    const text = (id: string) => findDeadlineRule(id)?.notes.join(" ") ?? "";
    expect(text("hmk-cevap")).toContain("Tebliğ günü sayılmaz");
    expect(text("hmk-istinaf")).toContain("tefhim");
    expect(text("cmk-istinaf")).toContain("tutuklu");
    expect(text("cmk-itiraz")).toContain("CMK m.331/4");
    expect(text("iyuk-dava-idare")).toContain("İYUK m.8/3");
    expect(text("iik-odeme-emri-itiraz")).toContain("İİK m.19");
    expect(text("aym-bireysel-basvuru")).toContain("adli tatil");
    expect(text("is-arabuluculuk-dava-sarti")).toContain("dava şartı");
    expect(text("tbk-tahliye-taahhudu-dava")).toContain("BİR AY");
    expect(text("tbk-kira-odeme-suresi")).toContain("otuz gündür");
    expect(text("tmk-mirasin-reddi")).toContain("üç ay");
  });

  it("the AYM rule title carries its article citation like every other rule (L30)", () => {
    for (const rule of DEADLINE_RULES) {
      expect(rule.title, rule.id).toMatch(/m\.\s?\d+|Kanun|HMK|CMK|İYUK|İİK|TBK|TMK/u);
    }
    expect(findDeadlineRule("aym-bireysel-basvuru")?.title).toContain("6216 sayılı Kanun m.47/5");
  });

  it("findDeadlineRule returns undefined for unknown ids", () => {
    expect(findDeadlineRule("yok")).toBeUndefined();
    expect(findDeadlineRule("hmk-cevap")?.title).toContain("HMK m.127");
  });
});

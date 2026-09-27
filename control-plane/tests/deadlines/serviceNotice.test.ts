/**
 * "Tebligattan süreye" — the rule-based reader (src/deadlines/serviceNotice.ts).
 *
 * Every sample is realistic Turkish written for this file
 * (tests/deadlines/noticeSamples.ts). The tests pin the three promises the
 * feature makes: every fact is an exact quote at code-point offsets; a date
 * that is not a tebliğ date is never taken as one (karar tarihi, kesinleşme
 * şerhi, okunma tarihi, a tebliğ narrated inside the served document); and
 * the deadline itself is whatever `computeDeadline` says — byte for byte.
 */

import { describe, expect, it } from "vitest";
import { computeDeadline } from "../../src/deadlines/calc.js";
import { DEADLINE_DISCLAIMER, findDeadlineRule } from "../../src/deadlines/rules.js";
import {
  E_TEBLIGAT_DEEMED_DAYS,
  NOTICE_READER_VERSION,
  NOTICE_RULE_IDS,
  NoticeInputError,
  readServiceNotice,
  textFromChunks,
  type NoticeReading,
  type QuotedSpan,
} from "../../src/deadlines/serviceNotice.js";
import {
  DAVA_DILEKCESI,
  GEREKCELI_KARAR,
  KESINLESME_SERHI,
  ODEME_EMRI_KAMBIYO,
  ODEME_EMRI_ORNEK7,
  PTT_MAZBATA,
  PTT_MAZBATA_SENTENCE,
  PTT_MAZBATA_TK21,
  UETS_RECEIPT,
  UETS_RECEIPT_AGREEING,
  UETS_RECEIPT_CONFLICTING,
  UETS_RECEIPT_HOLIDAY,
} from "./noticeSamples.js";

const read = (text: string, choice = {}): NoticeReading => readServiceNotice(text, { source: "text" }, choice);

/** The one offset rule: quote === text[start, end) in CODE POINTS over NFC. */
function expectExactSpan(text: string, span: QuotedSpan): void {
  const cps = Array.from(text.normalize("NFC"));
  expect(cps.slice(span.start, span.end).join("")).toBe(span.quote);
}

function everySpan(r: NoticeReading): QuotedSpan[] {
  return [
    ...r.dateCandidates.flatMap((c) => c.evidence),
    ...r.ignoredDates,
    ...r.facts.courts,
    ...r.facts.references,
    ...r.facts.documentTypes.flatMap((d) => d.evidence),
    ...r.facts.statedPeriods,
    ...r.facts.notes.flatMap((n) => (n.evidence === null ? [] : [n.evidence])),
    ...r.proposals.flatMap((p) => p.why),
  ];
}

describe("serviceNotice — e-tebligat (UETS) receipts and the fifth-day rule", () => {
  it("reads the ulaşma date, adds five calendar days across the month end, and does not roll a Sunday", () => {
    const r = read(UETS_RECEIPT);
    expect(r.reader).toBe(NOTICE_READER_VERSION);
    expect(r.facts.eTebligat).toBe(true);
    expect(r.dateStatus).toBe("OKUNDU");
    expect(r.dateCandidates).toHaveLength(1);
    const c = r.dateCandidates[0]!;
    expect(c.kind).toBe("ETEBLIGAT_ULASMA");
    expect(c.printedDate).toBe("2026-10-27");
    expect(E_TEBLIGAT_DEEMED_DAYS).toBe(5);
    // 27.10 + 5 = 01.11.2026 — a Sunday, and the karine is NOT moved to Monday.
    expect(c.tebligDate).toBe("2026-11-01");
    expect(r.tebligDate).toBe("2026-11-01");
    expect(c.evidence[0]!.quote).toBe("Muhataba Ulaştırıldığı Tarih : 27.10.2026");
    expect(c.basisStatus).toBe("dogrulanmadi");
    expect(c.basis).toContain("beşinci günün sonunda");
    expect(c.warnings.join(" ")).toContain("hafta sonu");
    expect(c.warnings.join(" ")).toContain("ay sonunu");
    expect(c.warnings.join(" ")).toContain("madde metniyle doğrulanmadı");
    for (const span of everySpan(r)) expectExactSpan(UETS_RECEIPT, span);
  });

  it("never takes the gönderim or okunma date as the tebliğ date", () => {
    const r = read(UETS_RECEIPT);
    const reasons = Object.fromEntries(r.ignoredDates.map((d) => [d.date, d.reason]));
    expect(reasons["2026-10-26"]).toBe("GONDERIM_TARIHI");
    expect(reasons["2026-10-28"]).toBe("OKUNMA_TARIHI");
    expect(r.ignoredDates.every((d) => d.reasonTr.length > 0)).toBe(true);
  });

  it("reads court, file number and what was served, and proposes HMK istinaf computed by computeDeadline verbatim", () => {
    const r = read(UETS_RECEIPT);
    const primary = r.facts.courts.find((c) => c.primary)!;
    expect(primary.quote).toBe("İstanbul 12. Asliye Hukuk Mahkemesi");
    expect(primary.courtClass).toBe("HUKUK_ILK");
    expect(r.facts.references.map((x) => `${x.kind} ${x.value}`)).toContain("ESAS 2025/345");
    expect(r.facts.documentTypes.map((d) => d.type)).toEqual(["GEREKCELI_KARAR"]);
    expect(r.facts.documentTypes[0]!.foundIn).toBe("EVRAK_ALANI");

    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-istinaf"]);
    const p = r.proposals[0]!;
    expect(p.origin).toBe("BELGE");
    expect(p.why.map((w) => w.quote)).toEqual(
      expect.arrayContaining(["Evrak Türü           : Gerekçeli Karar", "İstanbul 12. Asliye Hukuk Mahkemesi"]),
    );
    // Byte-for-byte the engine: adli tatil flags, verification status, disclaimer.
    expect(p.computation).toEqual(computeDeadline({ ruleId: "hmk-istinaf", startDate: "2026-11-01" }));
    expect(p.computation!.dueDate).toBe("2026-11-16"); // 15.11 is a Sunday → Monday
    expect(p.computation!.disclaimer).toBe(DEADLINE_DISCLAIMER);
    expect(p.rule).toEqual(findDeadlineRule("hmk-istinaf"));
    expect(r.disclaimer).toBe(DEADLINE_DISCLAIMER);
    expect(r.readyToConfirm).toBe(true);
  });

  it("keeps the fifth day on a statutory holiday and says so (29 Ekim)", () => {
    const r = read(UETS_RECEIPT_HOLIDAY);
    const c = r.dateCandidates[0]!;
    expect(c.printedDate).toBe("2026-10-24");
    expect(c.tebligDate).toBe("2026-10-29");
    expect(c.warnings.join(" ")).toContain("Cumhuriyet Bayramı");
    expect(c.warnings.join(" ")).toContain("ertelenmedi");
    expect(r.proposals[0]!.computation!.dueDate).toBe("2026-11-12");
    expect(r.proposals[0]!.computation).toEqual(computeDeadline({ ruleId: "hmk-istinaf", startDate: "2026-10-29" }));
  });

  it("merges a printed deemed date that agrees with ulaşma + 5 into ONE candidate with both quotes", () => {
    const r = read(UETS_RECEIPT_AGREEING);
    expect(r.dateStatus).toBe("OKUNDU");
    expect(r.dateCandidates).toHaveLength(1);
    const c = r.dateCandidates[0]!;
    expect(c.kind).toBe("ETEBLIGAT_ULASMA");
    expect(c.evidence.map((e) => e.quote)).toEqual([
      "Muhataba Ulaştırıldığı Tarih : 27.10.2026",
      "Tebliğ Edilmiş Sayıldığı Tarih : 01.11.2026",
    ]);
  });

  it("shows two different dates side by side and computes NOTHING until the lawyer chooses", () => {
    const r = read(UETS_RECEIPT_CONFLICTING);
    expect(r.dateStatus).toBe("SECIM_GEREKLI");
    expect(r.tebligDate).toBeNull();
    expect(r.readyToConfirm).toBe(false);
    expect(r.dateCandidates.map((c) => [c.id, c.kind, c.tebligDate])).toEqual([
      ["t1", "ETEBLIGAT_ULASMA", "2026-11-01"],
      ["t2", "ETEBLIGAT_TEBLIG", "2026-10-30"],
    ]);
    expect(r.dateCandidates[1]!.evidence[0]!.quote).toBe("Tebliğ Tarihi : 30.10.2026");
    expect(r.proposals.every((p) => p.computation === null && p.matterItem === null)).toBe(true);
    expect(r.messages.join(" ")).toContain("seçin");

    const chosen = read(UETS_RECEIPT_CONFLICTING, { candidateId: "t2" });
    expect(chosen.dateStatus).toBe("AVUKAT_SECTI");
    expect(chosen.tebligDate).toBe("2026-10-30");
    expect(chosen.proposals[0]!.computation).toEqual(computeDeadline({ ruleId: "hmk-istinaf", startDate: "2026-10-30" }));
    expect(chosen.proposals[0]!.matterItem!.payload.teblig.candidateId).toBe("t2");
  });

  it("refuses an unknown candidate and a candidate + typed date together", () => {
    expect(() => read(UETS_RECEIPT_CONFLICTING, { candidateId: "t9" })).toThrow(NoticeInputError);
    expect(() => read(UETS_RECEIPT_CONFLICTING, { candidateId: "t1", tebligDate: "2026-10-30" })).toThrow(NoticeInputError);
  });

  it("does not apply the fifth-day rule to an 'ulaşma' date without any e-tebligat wording", () => {
    const text = ["TEBLİĞ MAZBATASI", "Evrak: Bilirkişi raporu", "Evrakın muhataba ulaştığı tarih: 03.11.2026"].join("\n");
    const r = read(text);
    expect(r.facts.eTebligat).toBe(false);
    expect(r.dateCandidates).toHaveLength(0);
    expect(r.ignoredDates.map((d) => d.reason)).toEqual(["ULASMA_E_IBARESI_YOK"]);
    expect(r.dateStatus).toBe("OKUNAMADI");
  });
});

describe("serviceNotice — physical tebligat mazbatası", () => {
  it("reads the labelled tebliğ date and the delivery sentence as ONE candidate and proposes the cevap süresi", () => {
    const r = read(PTT_MAZBATA);
    expect(r.facts.eTebligat).toBe(false);
    expect(r.dateCandidates).toHaveLength(1);
    const c = r.dateCandidates[0]!;
    expect(c.kind).toBe("FIZIKI_TEBLIG");
    expect(c.tebligDate).toBe("2026-10-14");
    expect(c.evidence.map((e) => e.quote)).toEqual([
      "Tebliğ Tarihi: 14.10.2026",
      "Tebliğ olunacak evrak muhatap şirket adına daimi çalışan Ahmet Yılmaz'a 14.10.2026 tarihinde imzası alınarak tebliğ edildi.",
    ]);
    expect(r.facts.courts.find((x) => x.primary)!.quote).toBe("Ankara 3. İş Mahkemesi");
    expect(r.facts.documentTypes.map((d) => d.type)).toEqual(["DAVA_DILEKCESI"]);
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-cevap"]);
    expect(r.proposals[0]!.computation).toEqual(computeDeadline({ ruleId: "hmk-cevap", startDate: "2026-10-14" }));
    for (const span of everySpan(r)) expectExactSpan(PTT_MAZBATA, span);
  });

  it("reads a mazbata that states the delivery only as a sentence ('bizzat imzasına tebliğ edildi')", () => {
    const r = read(PTT_MAZBATA_SENTENCE);
    expect(r.dateCandidates.map((c) => c.tebligDate)).toEqual(["2026-11-05"]);
    expect(r.dateCandidates[0]!.evidence[0]!.quote).toBe(
      "Tebligat evrakı 05/11/2026 tarihinde muhatabın bizzat kendisine imzasına tebliğ edildi.",
    );
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-bilirkisi-rapor-itiraz"]);
  });

  it("flags a TK m.21 delivery (kapıya yapıştırma) as a note to check, without changing the date", () => {
    const r = read(PTT_MAZBATA_TK21);
    expect(r.facts.notes.map((n) => n.code)).toContain("TK_21");
    expect(r.dateCandidates.map((c) => c.tebligDate)).toEqual(["2026-12-09"]);
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-istinaf"]);
  });
});

describe("serviceNotice — the served document itself: decision dates are never tebliğ dates", () => {
  it("a gerekçeli karar first page: no date guessed, every date explained, the istinaf rule proposed without a computation", () => {
    const r = read(GEREKCELI_KARAR);
    expect(r.dateStatus).toBe("OKUNAMADI");
    expect(r.dateCandidates).toHaveLength(0);
    expect(r.tebligDate).toBeNull();
    const reasonOf = (date: string) => r.ignoredDates.filter((d) => d.date === date).map((d) => d.reason);
    expect(reasonOf("2026-05-12")).toContain("KARAR_TARIHI");
    expect(reasonOf("2026-06-02")).toEqual(["YAZIM_TARIHI"]);
    expect(reasonOf("2025-02-03")).toEqual(["DAVA_TARIHI"]);
    // The karar narrates when the PETITION was served — that is not our tebliğ.
    expect(reasonOf("2025-02-20")).toEqual(["ANLATILAN_TEBLIG"]);
    expect(reasonOf("2023-03-14")).toEqual(["KARAR_KUNYESI"]);
    expect(reasonOf("2024-03-01")).toEqual(["BELGE_TARIHI"]);

    expect(r.facts.documentTypes.map((d) => d.type)).toEqual(["GEREKCELI_KARAR"]);
    expect(r.facts.documentTypes[0]!.foundIn).toBe("BASLIK");
    expect(r.facts.courts.find((c) => c.primary)!.courtClass).toBe("HUKUK_ILK");
    expect(r.facts.notes.map((n) => n.code)).toContain("TEFHIM");
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-istinaf"]);
    expect(r.proposals[0]!.computation).toBeNull();
    expect(r.proposals[0]!.why.some((w) => w.quote === "2 hafta içinde")).toBe(true);
    expect(r.messages.join(" ")).toContain("tahmin etmez");
    expect(r.readyToConfirm).toBe(false);
    for (const span of everySpan(r)) expectExactSpan(GEREKCELI_KARAR, span);
  });

  it("computes once the lawyer types the tebliğ date, and records that the date came from the lawyer", () => {
    const r = read(GEREKCELI_KARAR, { tebligDate: "2026-06-15" });
    expect(r.dateStatus).toBe("AVUKAT_GIRDI");
    const p = r.proposals[0]!;
    expect(p.computation).toEqual(computeDeadline({ ruleId: "hmk-istinaf", startDate: "2026-06-15" }));
    expect(p.matterItem!.payload.teblig.dateSource).toBe("AVUKAT");
    expect(p.matterItem!.payload.teblig.quote).toBeNull();
    expect(() => read(GEREKCELI_KARAR, { tebligDate: "2026-02-30" })).toThrow(NoticeInputError);
  });

  it("a kesinleşme şerhi: the tebliğ dates to other parties and the kesinleşme date are all refused", () => {
    const r = read(KESINLESME_SERHI);
    expect(r.dateCandidates).toHaveLength(0);
    expect(r.ignoredDates.map((d) => [d.date, d.reason])).toEqual([
      ["2026-06-20", "KESINLESME"],
      ["2026-06-23", "KESINLESME"],
      ["2026-07-08", "KESINLESME"],
    ]);
    expect(r.proposals).toHaveLength(0);
  });

  it("a kesinleşme şerhi stapled under a mazbata does not add candidates; the mazbata's own date survives", () => {
    const r = read(`${PTT_MAZBATA}\n\n${KESINLESME_SERHI}`);
    expect(r.dateCandidates.map((c) => c.tebligDate)).toEqual(["2026-10-14"]);
    expect(r.ignoredDates.filter((d) => d.reason === "KESINLESME")).toHaveLength(3);
  });

  it("an inline 'tarihinde kesinleşmiştir' sentence in a tebligat is not a start date", () => {
    const text = [
      "TEBLİĞ MAZBATASI",
      "Tebliğ Olunacak Evrak: Gerekçeli Karar",
      "Karar 08.07.2026 tarihinde kesinleşmiştir.",
    ].join("\n");
    const r = read(text);
    expect(r.dateCandidates).toHaveLength(0);
    expect(r.ignoredDates.map((d) => d.reason)).toEqual(["KESINLESME"]);
  });

  it("a ceza judgment warns that the rule starts from tefhim", () => {
    const text = UETS_RECEIPT.replace("İstanbul 12. Asliye Hukuk Mahkemesi", "Ankara 5. Asliye Ceza Mahkemesi");
    const r = read(text);
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["cmk-istinaf"]);
    expect(r.proposals[0]!.warnings.join(" ")).toContain("tefhim");
  });

  it("a gerekçeli karar whose court cannot be read proposes nothing and says why", () => {
    const text = ["ELEKTRONİK TEBLİGAT", "Evrak Türü: Gerekçeli Karar", "Muhataba Ulaştırıldığı Tarih: 02.11.2026"].join("\n");
    const r = read(text);
    expect(r.proposals).toHaveLength(0);
    expect(r.dateCandidates.map((c) => c.tebligDate)).toEqual(["2026-11-07"]);
    expect(r.messages.join(" ")).toContain("mahkeme okunamadığı");
  });
});

describe("serviceNotice — payment orders, petitions, idari yargı", () => {
  it("an Örnek 7 ödeme emri → İİK m.62 itiraz; the stated '7 gün içinde' agrees", () => {
    const r = read(ODEME_EMRI_ORNEK7);
    expect(r.facts.documentTypes[0]!.odemeEmriKind).toBe("GENEL");
    expect(r.facts.courts.find((c) => c.primary)!.quote).toBe("İSTANBUL ANADOLU 7. İCRA DAİRESİ");
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["iik-odeme-emri-itiraz"]);
    expect(r.proposals[0]!.why.some((w) => w.quote === "7 gün içinde")).toBe(true);
    expect(r.proposals[0]!.warnings).toEqual([]);
    expect(r.ignoredDates.map((d) => d.reason)).toEqual(["DUZENLEME_TARIHI"]);
  });

  it("a kambiyo ödeme emri (Örnek 10) → the five-day itiraz", () => {
    const r = read(ODEME_EMRI_KAMBIYO);
    expect(r.facts.documentTypes[0]!.odemeEmriKind).toBe("KAMBIYO");
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["iik-kambiyo-itiraz"]);
  });

  it("an ödeme emri whose form cannot be read offers BOTH itiraz rules for the lawyer to choose", () => {
    const text = ODEME_EMRI_ORNEK7.replace("(İlamsız takiplerde — Örnek No: 7)", "");
    const r = read(text);
    expect(r.facts.documentTypes[0]!.odemeEmriKind).toBeNull();
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["iik-odeme-emri-itiraz", "iik-kambiyo-itiraz"]);
  });

  it("warns when the period written in the document differs from the proposed rule", () => {
    const text = ODEME_EMRI_ORNEK7.replace("10 gün içinde ödemeniz", "ödemeniz").replace("7 gün içinde", "3 gün içinde");
    const r = read(text);
    expect(r.proposals[0]!.warnings.join(" ")).toContain("“3 gün içinde”");
  });

  it("a dava dilekçesi served by itself → cevap süresi; a mention of 'ödeme emri' in KONU does not make it one", () => {
    const r = read(DAVA_DILEKCESI);
    expect(r.facts.documentTypes.map((d) => d.type)).toEqual(["DAVA_DILEKCESI"]);
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["hmk-cevap"]);
    expect(r.ignoredDates.map((d) => d.reason)).toEqual(["BELGE_TARIHI"]);
  });

  it("a dava dilekçesi of an idare mahkemesi → İYUK savunma süresi", () => {
    const text = PTT_MAZBATA.replace("Ankara 3. İş Mahkemesi", "Ankara 2. İdare Mahkemesi");
    const r = read(text);
    expect(r.proposals.map((p) => p.ruleId)).toEqual(["iyuk-cevap"]);
  });

  it("an unreadable text answers OKUNAMADI twice and proposes nothing", () => {
    const r = read("Sayın ilgili, bilgilerinize sunarız.");
    expect(r.dateStatus).toBe("OKUNAMADI");
    expect(r.documentStatus).toBe("OKUNAMADI");
    expect(r.proposals).toHaveLength(0);
    expect(r.messages).toHaveLength(2);
    expect(r.readyToConfirm).toBe(false);
  });
});

describe("serviceNotice — the lawyer's rule choice and the rule table", () => {
  it("a chosen rule replaces the proposals; a note-only or unknown rule is refused", () => {
    const r = read(PTT_MAZBATA, { ruleId: "hmk-on-inceleme-belge" });
    expect(r.documentStatus).toBe("AVUKAT_SECTI");
    expect(r.proposals.map((p) => [p.ruleId, p.origin])).toEqual([["hmk-on-inceleme-belge", "AVUKAT"]]);
    expect(r.proposals[0]!.computation).toEqual(computeDeadline({ ruleId: "hmk-on-inceleme-belge", startDate: "2026-10-14" }));
    try {
      read(PTT_MAZBATA, { ruleId: "hmk-kesin-sure" });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(NoticeInputError);
      expect((error as NoticeInputError).kind).toBe("RULE_NOT_COMPUTABLE");
    }
    expect(() => read(PTT_MAZBATA, { ruleId: "yok-boyle-kural" })).toThrow(NoticeInputError);
  });

  it("every rule the reader can suggest exists and is computable", () => {
    expect(NOTICE_RULE_IDS.length).toBeGreaterThanOrEqual(15);
    for (const id of NOTICE_RULE_IDS) {
      const rule = findDeadlineRule(id);
      expect(rule, id).toBeDefined();
      expect(rule!.computable, id).toBe(true);
    }
  });
});

describe("serviceNotice — offsets and the matter item", () => {
  it("offsets are code points: an astral character before the date does not shift the quote", () => {
    const text = `𝐓𝐄𝐁𝐋İĞ MAZBATASI 😀\nTebliğ Tarihi: 14.10.2026\nTebliğ olunan evrak: Bilirkişi raporu`;
    const r = read(text);
    const e = r.dateCandidates[0]!.evidence[0]!;
    expect(e.quote).toBe("Tebliğ Tarihi: 14.10.2026");
    expectExactSpan(text, e);
    expect(e.start).toBe(Array.from("𝐓𝐄𝐁𝐋İĞ MAZBATASI 😀\n").length);
  });

  it("NFD input is read as NFC and quoted in NFC", () => {
    const nfd = PTT_MAZBATA.normalize("NFD");
    const r = read(nfd);
    expect(r.dateCandidates[0]!.evidence[0]!.quote).toBe("Tebliğ Tarihi: 14.10.2026");
    expect(r.text.sha256).toBe(read(PTT_MAZBATA).text.sha256);
  });

  it("the ready matter item carries the engine's result, the quote and a stable title", () => {
    const r = read(UETS_RECEIPT);
    const item = r.proposals[0]!.matterItem!;
    expect(item.kind).toBe("deadline");
    expect(item.payload.dueDate).toBe(r.proposals[0]!.computation!.dueDate);
    expect(item.payload.startDate).toBe("2026-11-01");
    expect(item.payload.ruleId).toBe("hmk-istinaf");
    expect(item.payload.source).toBe("hesap");
    expect(item.payload.status).toBe("acik");
    expect(item.payload.computed.disclaimer).toBe(DEADLINE_DISCLAIMER);
    expect(item.payload.title).toBe("İstinaf başvuru süresi (HMK m.345) — tebliğ 01.11.2026");
    expect(item.payload.teblig).toMatchObject({
      reader: NOTICE_READER_VERSION,
      dateSource: "BELGE",
      kind: "ETEBLIGAT_ULASMA",
      candidateId: "t1",
      printedDate: "2026-10-27",
      quote: "Muhataba Ulaştırıldığı Tarih : 27.10.2026",
      documentType: "GEREKCELI_KARAR",
    });
    // Reading twice gives the identical item (the dedupe key is stable).
    expect(read(UETS_RECEIPT).proposals[0]!.matterItem).toEqual(item);
  });

  it("textFromChunks keeps every chunk at its own offsets and fills gaps with line breaks", () => {
    const rebuilt = textFromChunks([
      { text: "Tebliğ Tarihi: 14.10.2026", startChar: 20, endChar: 45, ordinal: 1 },
      { text: "TEBLİĞ MAZBATASI", startChar: 0, endChar: 16, ordinal: 0 },
    ]);
    expect(rebuilt.gapCodePoints).toBe(4);
    expect(Array.from(rebuilt.text).slice(20, 45).join("")).toBe("Tebliğ Tarihi: 14.10.2026");
    const r = readServiceNotice(rebuilt.text, { source: "file", fileId: "0123456789abcdef", gapCodePoints: rebuilt.gapCodePoints });
    expect(r.dateCandidates[0]!.evidence[0]!.start).toBe(20);
    expect(r.text.gapCodePoints).toBe(4);
  });
});

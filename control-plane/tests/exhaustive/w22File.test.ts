/**
 * W22: the deterministic Matter analysis met a realistic iş davası file.
 *
 * The file (trimmed excerpts below): a dava and a cevap dilekçesi, a
 * bilirkişi report extracted from a PDF (its line wraps kept, a calculation
 * table whose currency sits only in the column header), two witness records
 * that contradict each other on the işe giriş date (01.03.2018 / 01.03.2019)
 * and the net salary (45.000 / 32.000 TL), an ihtarname and an OCR'd SGK
 * hizmet dökümü. On the unchanged W21 code the contradictions task found 0
 * of the 12 cross-document işe giriş pairs, missed the tebliğ date conflict,
 * found 2 of 8 salary pairs, reported two precedents' decision dates as
 * "İkisi birden doğru olamaz", compared a "şimdilik 5.000 TL" partial claim
 * with the expert's figure (twice), and still said the comparison was
 * complete. Every block below fails on that code.
 *
 * The documents are authored test data modelled on a real file; the numbers
 * pinned here measure this file, not Turkish case files in general.
 */

import { describe, expect, it } from "vitest";
import {
  compareValueObservations,
  detectRelations,
  formatMinorUnits,
  type ComparableObservation,
} from "../../src/exhaustive/contradictions.js";
import {
  BARE_DATE_TITLE_TR,
  buildDeterministicIntel,
  type StoredObservation,
} from "../../src/exhaustive/intelligence.js";
import {
  extractPropositions,
  parsePredicate,
  topicStem,
  unparsedValueMentions,
  type PropositionDraft,
} from "../../src/exhaustive/observations.js";

export const DAVA =
  "İSTANBUL ANADOLU ( ) İŞ MAHKEMESİ HAKİMLİĞİ'NE\n\n" +
  "DAVACI : Mehmet YILMAZ (T.C. Kimlik No: 12345678901)\n\n" +
  "VEKİLİ : Av. Zeynep ARSLAN, İstanbul Barosu\n\n" +
  "1- Müvekkil davacı, davalı şirkette 01.03.2018 tarihinde depo sorumlusu olarak işe başlamış ve iş sözleşmesi" +
  " davalı işveren tarafından haksız olarak 15.01.2024 tarihinde feshedilene kadar kesintisiz çalışmıştır.\n\n" +
  "2- Müvekkilin son aylık net ücreti 45.000 TL olup ücretinin bir kısmı banka hesabına, kalan kısmı elden" +
  " ödenmiştir. Bu durum tanık beyanlarıyla ispat edilecektir.\n\n" +
  "3- Müvekkil haftada ortalama 60 saat çalışmış, fazla çalışma ücretleri hiçbir zaman ödenmemiştir. Müvekkil," +
  " 20.12.2023 tarihli ihtarname ile ödenmeyen alacaklarını talep etmiş, ihtarname davalıya 22.12.2023 tarihinde" +
  " tebliğ edilmiş, ancak herhangi bir ödeme yapılmamıştır.\n\n" +
  "5- Yargıtay 9. Hukuk Dairesi'nin 12.03.2020 tarihli, 2019/1234 E., 2020/5678 K. sayılı kararında da" +
  " belirtildiği üzere, ücretin bir kısmının elden ödendiği tanık beyanlarıyla ispat edilebilir.\n\n" +
  "SONUÇ VE İSTEM : Fazlaya ilişkin haklarımız saklı kalmak kaydıyla şimdilik 10.000 TL kıdem tazminatı," +
  " 5.000 TL ihbar tazminatı ve 5.000 TL fazla çalışma ücreti alacağının fesih tarihinden itibaren işleyecek" +
  " en yüksek banka mevduat faizi ile birlikte davalıdan tahsiline karar verilmesini saygıyla arz ve talep ederiz. 05.02.2024";

export const CEVAP =
  "DAVALI : ANKA LOJİSTİK TAŞIMACILIK A.Ş.\n\n" +
  "1- Davacı, müvekkil şirkette 01.03.2019 tarihinde işe başlamıştır. Davacının 2018 yılında müvekkil şirkette" +
  " çalıştığı iddiası gerçeği yansıtmamaktadır; SGK kayıtları da bunu doğrulamaktadır.\n\n" +
  "2- Davacının son aylık net ücreti 32.000 TL olup tamamı banka aracılığıyla ödenmiştir.\n\n" +
  "3- Davacı 15.01.2024 tarihinde kendi isteğiyle işten ayrılmış olup iş sözleşmesi müvekkil tarafından" +
  " feshedilmemiştir.\n\n" +
  "4- Davacının 20.12.2023 tarihli ihtarnamesi müvekkile 26.12.2023 tarihinde tebliğ edilmiş olup ihtarnamede" +
  " ileri sürülen alacakların hiçbiri mevcut değildir.\n\n" +
  "5- Yargıtay 9. Hukuk Dairesi'nin 05.10.2021 tarihli, 2021/7788 E., 2021/12345 K. sayılı kararında" +
  " belirtildiği üzere, banka kayıtlarının aksini ispat için yazılı delil gerekir.";

/** As pypdf extracts it: every visual line wrap is a line break. */
export const BILIRKISI =
  "BİLİRKİŞİ RAPORU\n" +
  "II. HİZMET SÜRESİ : Davacı tanıklarının beyanları esas alınarak\n" +
  "davacının 01.03.2018 - 15.01.2024 tarihleri arasında 5 yıl 10 ay 14 gün\n" +
  "çalıştığı kabul edilmiştir. Davalı tanığının beyanı ve SGK kaydı esas\n" +
  "alınırsa hizmet süresi 01.03.2019 - 15.01.2024 arasıdır (alternatif\n" +
  "hesap Ek-1).\n" +
  "III. ÜCRET : Davacı tanıklarının beyanına göre net ücret 45.000 TL\n" +
  "olarak kabul edilmiş, brüt ücret 61.842,11 TL olarak hesaplanmıştır.\n\n" +
  "IV. HESAPLAMA :\n" +
  "Kalem Dönem Brüt (TL) Kesinti (TL) Net (TL)\n" +
  "Kıdem tazminatı 01.03.2018 - 15.01.2024 204.962,34 1.549,67 203.412,67\n" +
  "İhbar tazminatı 8 hafta 115.428,00 16.143,50 99.284,50\n" +
  "VI. SONUÇ : Davacının net kıdem tazminatı alacağı 203.412,67 TL, net\n" +
  "ihbar tazminatı alacağı 99.284,50 TL olarak hesaplanmıştır. Takdir Sayın Mahkemeye aittir.\n" +
  "20.06.2024\n" +
  "Bilirkişi Mali Müşavir Hasan ÇELİK";

export const TANIK_ALI =
  "DURUŞMA TUTANAĞI\nESAS NO : 2024/128\nCELSE TARİHİ : 14.05.2024\n\n" +
  'Tanık Ali KAYA beyanında: "Ben davalı şirkette 2016 yılından 2023 yılı sonuna kadar forklift operatörü olarak' +
  " çalıştım. Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi, o gün ben de oradaydım. Mehmet'in" +
  ' aylık net maaşı 45.000 TL idi, bunun bir kısmını bankadan bir kısmını elden alırdı."';

export const TANIK_AYSE =
  "DURUŞMA TUTANAĞI\nESAS NO : 2024/128\nCELSE TARİHİ : 14.05.2024\n\n" +
  'Tanık Ayşe DEMİR beyanında: "Ben davalı şirketin insan kaynakları biriminde çalışıyorum. Davacı Mehmet YILMAZ' +
  " 01.03.2019 tarihinde işe girdi, işe giriş evrakını ben hazırladım. Davacının aylık net maaşı 32.000 TL idi," +
  ' maaşların tamamı bankaya yatırılırdı, elden ödeme yapılmazdı. Davacı 15.01.2024 tarihinde istifa dilekçesi' +
  ' vererek ayrıldı."';

export const IHTARNAME =
  "BEYOĞLU 12. NOTERLİĞİ\nYevmiye No: 34567   Tarih: 20.12.2023\n\nİHTARNAME\n\n" +
  "Müvekkilim 01.03.2018 tarihinden bu yana şirketinizde depo sorumlusu olarak çalışmakta olup son aylık net" +
  " ücreti 45.000 TL'dir.";

export const SGK =
  "SİGORTALI HİZMET DÖKÜMÜ\nSigortalı Adı Soyadı : Mehmet YILMAZ\n" +
  "İşyeri Unvanı : ANKA LOJİSTİK TAŞIMACILIK A.Ş.\nİşe Giriş Tarihi : 01.03.2019\n" +
  "İşten Çıkış Tarihi : 15.01.2024\nİşten Çıkış Nedeni : 03 - İstifa\n" +
  "Belgenin düzenlendiği tarih : 02.02.2024";

export const FILE: ReadonlyArray<readonly [string, string]> = [
  ["01-dava", DAVA],
  ["02-cevap", CEVAP],
  ["03-bilirkisi", BILIRKISI],
  ["04-tanik-ali", TANIK_ALI],
  ["05-tanik-ayse", TANIK_AYSE],
  ["06-ihtarname", IHTARNAME],
  ["07-sgk", SGK],
];

interface Located extends PropositionDraft {
  readonly observationId: string;
  readonly fileId: string;
  readonly unitNo: number;
}

function census(): Located[] {
  const out: Located[] = [];
  for (const [fileId, text] of FILE) {
    extractPropositions(text).forEach((draft, index) =>
      out.push({ ...draft, observationId: `${fileId}#${String(index).padStart(3, "0")}`, fileId, unitNo: 1 }),
    );
  }
  return out;
}

const key = (a: string, b: string): string => [a, b].sort().join("|");

function crossPairs(left: readonly Located[], right: readonly Located[]): string[] {
  const out = new Set<string>();
  for (const a of left) for (const b of right) if (a.fileId !== b.fileId) out.add(key(a.observationId, b.observationId));
  return [...out];
}

function reported(observations: readonly Located[]): Set<string> {
  return new Set(
    detectRelations(observations as unknown as ComparableObservation[])
      .filter((relation) => relation.relation === "CONTRADICTION" || relation.relation === "TENSION")
      .map((relation) => key(relation.left.observationId, relation.right.observationId)),
  );
}

const withValue = (observations: readonly Located[], value: string, files?: readonly string[]): Located[] =>
  observations.filter(
    (observation) =>
      observation.normalizedValue === value && (files === undefined || files.some((file) => observation.fileId === file)),
  );

describe("W22 · the decisive contradictions of the file are compared", () => {
  const observations = census();
  const found = reported(observations);
  const count = (pairs: readonly string[]): number => pairs.filter((pair) => found.has(pair)).length;

  it("işe giriş 01.03.2018 vs 01.03.2019: all 12 of the investigator's cross-document pairs (0 in W21, 9 in W22)", () => {
    // The investigator's 12: {dava, tanık Ali, ihtarname, bilirkişi §II} × {cevap, tanık Ayşe, SGK}.
    const bilirkisiII = withValue(observations, "2018-03-01", ["03-bilirkisi"]).filter((o) =>
      o.statement.includes("tanıklarının beyanları"),
    );
    const left = [...withValue(observations, "2018-03-01", ["01-dava", "04-tanik-ali", "06-ihtarname"]), ...bilirkisiII];
    const right = withValue(observations, "2019-03-01", ["02-cevap", "05-tanik-ayse", "07-sgk"]);
    const pairs = crossPairs(left, right);
    expect(pairs).toHaveLength(12);
    // W22 (extract-v8) compared 9: the three pairs of the witness who says
    // "depoya sorumlu olarak geldi" (no event word, no shared topic word)
    // were missed. extract-v9 reads a job title + "olarak geldi" as an işe
    // giriş (tests/exhaustive/w23EventAnchors.test.ts).
    expect(count(pairs)).toBe(12);
  });

  it("the tebliğ dates 22.12.2023 / 26.12.2023 are a CONTRADICTION of one event, not a same-month TENSION", () => {
    const relation = detectRelations(observations as unknown as ComparableObservation[]).find(
      (candidate) =>
        new Set([candidate.left.normalizedValue, candidate.right.normalizedValue]).has("2023-12-22") &&
        new Set([candidate.left.normalizedValue, candidate.right.normalizedValue]).has("2023-12-26"),
    );
    expect(relation?.relation).toBe("CONTRADICTION");
    expect(relation?.pairedBy).toBe("event");
    expect(relation?.rationale).toContain("“tebliğ” için iki farklı tarih var");
  });

  it("net ücret 45.000 vs 32.000: all 8 cross-document pairs (2 before)", () => {
    const pairs = crossPairs(withValue(observations, "4500000"), withValue(observations, "3200000"));
    expect(pairs).toHaveLength(8);
    expect(count(pairs)).toBe(8);
  });

  it("no contradiction is reported that the file does not contain", () => {
    const shown = detectRelations(observations as unknown as ComparableObservation[]).filter(
      (relation) => relation.relation === "CONTRADICTION" || relation.relation === "TENSION",
    );
    const values = (relation: (typeof shown)[number]) =>
      [relation.left.normalizedValue, relation.right.normalizedValue].sort().join("/");
    for (const relation of shown) {
      expect(["2018-03-01/2019-03-01", "2023-12-22/2023-12-26", "3200000/4500000"]).toContain(values(relation));
    }
  });

  it("says how many pairs it compared, out of how many it could have", () => {
    const { stats } = compareValueObservations(observations as unknown as ComparableObservation[]);
    expect(stats.pairsComparedByEvent).toBeGreaterThan(0);
    expect(stats.pairsComparedByEvent + stats.pairsComparedByTopic).toBeLessThan(stats.candidatePairs);
    // Two decision dates and three partial-claim amounts are never compared.
    expect(stats.valuesNeverCompared).toBe(5);
  });
});

describe("W22 · what is never compared", () => {
  it("a cited decision's date is a decision date: never compared, never an event", () => {
    const [dava] = extractPropositions(DAVA).filter((draft) => draft.normalizedValue === "2020-03-12");
    const [cevap] = extractPropositions(CEVAP).filter((draft) => draft.normalizedValue === "2021-10-05");
    expect(parsePredicate(dava!.predicate)).toMatchObject({ neverCompared: true, tag: "karar" });
    expect(parsePredicate(cevap!.predicate)).toMatchObject({ neverCompared: true, tag: "karar" });
    // "9." and "K." do not end the sentence; the apostrophe suffix is not a word.
    expect(dava!.statement.startsWith("5- Yargıtay 9. Hukuk Dairesi'nin 12.03.2020")).toBe(true);
    expect(dava!.statement).toContain("sayılı kararında");
    expect(dava!.subject.split(" ")).not.toContain("nin");
    const relations = detectRelations(
      [
        { ...dava!, observationId: "a", fileId: "01-dava", unitNo: 1 },
        { ...cevap!, observationId: "b", fileId: "02-cevap", unitNo: 1 },
      ] as unknown as ComparableObservation[],
    );
    expect(relations).toEqual([]);
  });

  it("a decision date needs a court or a decision number, not merely 'tarihli'", () => {
    const [interim] = extractPropositions("Sayın Mahkemenin 14.05.2024 tarihli ara kararı uyarınca hesaplanmıştır.");
    expect(parsePredicate(interim!.predicate).neverCompared).toBe(false);
    const [kunye] = extractPropositions("Yargıtay 9. HD, E. 2019/1234, K. 2020/5678, T. 12.03.2020 kararı emsaldir.");
    expect(parsePredicate(kunye!.predicate).tag).toBe("karar");
  });

  it("an amount claimed 'şimdilik' is a partial claim, compared with nothing — and a duplicate item is gone", () => {
    const partial = extractPropositions(DAVA).filter((draft) => draft.kind === "amount" && draft.statement.includes("SONUÇ"));
    expect(partial.map((draft) => draft.normalizedValue)).toEqual(["1000000", "500000", "500000"]);
    for (const draft of partial) expect(parsePredicate(draft.predicate).tag).toBe("kismi_talep");
    const shown = detectRelations(census() as unknown as ComparableObservation[]).filter(
      (relation) =>
        relation.relation !== "CORROBORATION" &&
        [relation.left, relation.right].some((side) => side.statement.includes("şimdilik")),
    );
    expect(shown).toEqual([]);
  });
});

describe("W22 · topic keys: one word, one key", () => {
  it("every inflection of a word gives the same topic word", () => {
    for (const forms of [
      ["ihtarname", "ihtarnamesi", "ihtarnamenin", "İHTARNAME", "ihtarı"],
      ["tebliğ", "tebliği", "tebliğinden", "teblig"],
      ["ücret", "ücreti", "ücretinin", "maaşı", "maaş"],
      ["sözleşme", "sözleşmesi", "sözleşmesinin"],
    ]) {
      const keys = new Set(forms.map((form) => topicStem(form)));
      expect(keys.size, forms.join(", ")).toBe(1);
      expect([...keys][0]).toBeDefined();
    }
  });

  it("party roles, date words and connectives are not topic words", () => {
    for (const word of ["davacı", "davacının", "davalı", "davalıya", "müvekkil", "müvekkile", "müvekkilim", "tarihli", "tarihinde", "olup", "idi"]) {
      expect(topicStem(word), word).toBeUndefined();
    }
  });
});

describe("W22 · sentences, line wraps and the census", () => {
  it("a single PDF line wrap does not end a sentence: the conditional stays conditional", () => {
    const alternative = extractPropositions(BILIRKISI).find(
      (draft) => draft.normalizedValue === "2019-03-01",
    );
    expect(alternative!.statement.startsWith("Davalı tanığının beyanı ve SGK kaydı esas\nalınırsa hizmet süresi")).toBe(true);
    expect(alternative!.statement).toContain("(alternatif\nhesap Ek-1).");
  });

  it("a table whose currency is in its header is not a complete amount census", () => {
    const mentions = unparsedValueMentions(BILIRKISI, "amount");
    expect(mentions.some((mention) => mention.includes("204.962,34"))).toBe(true);
    expect(mentions.some((mention) => mention.includes("115.428,00"))).toBe(true);
    // A figure that WAS read (203.412,67 TL in the conclusion) is not named.
    expect(mentions.some((mention) => mention.startsWith("net kıdem"))).toBe(false);
  });

  it("money is printed with its kuruş: 99.284,50 TL, never 99.284,5 TL", () => {
    expect(formatMinorUnits(9928450)).toBe("99.284,50");
    expect(formatMinorUnits(4500000)).toBe("45.000");
    const [relation] = detectRelations([
      { observationId: "a", kind: "amount", subject: "ihbar tazmi", predicate: "tutar", normalizedValue: "9928450", fileId: "x", unitNo: 1, statement: "" },
      { observationId: "b", kind: "amount", subject: "ihbar tazmi", predicate: "tutar", normalizedValue: "8000000", fileId: "y", unitNo: 1, statement: "" },
    ]);
    expect(relation!.rationale).toContain("99.284,50 TL");
    expect(relation!.rationale).not.toContain("99.284,5 TL");
  });
});

function stored(observations: readonly Located[]): StoredObservation[] {
  return observations.map((observation, index) => ({
    observationId: `obs-${String(index).padStart(3, "0")}`,
    observationKey: `key-${observation.observationId}`,
    unitNo: observation.unitNo,
    fileId: observation.fileId,
    documentVersionId: `v-${observation.fileId}`,
    kind: "proposition",
    origin: "deterministic",
    statement: observation.statement,
    subject: observation.subject,
    predicate: observation.predicate,
    normalizedValue: observation.normalizedValue,
    valueKind: observation.kind,
    occurredOn: observation.occurredOn,
    datePrecision: observation.datePrecision,
    startChar: observation.startChar,
    endChar: observation.endChar,
    quote: observation.quote,
    quoteSha256: "0".repeat(64),
    extractorVersion: "extract-v8",
  }));
}

describe("W22 · the chronology: one fact, one event", () => {
  const rows = stored(census());
  const { items } = buildDeterministicIntel("chronology", rows, []);
  const events = items.filter((item) => item.kind === "event");

  it("the işe giriş date told by three documents is one event, and a decision date is none", () => {
    const giris2018 = events.filter((event) => event.occurredOn === "2018-03-01");
    // dava + ihtarname + bilirkişi §II (işe giriş), tanık Ali (same topic as
    // the dava), and the calculation table row on its own.
    expect(giris2018).toHaveLength(2);
    expect(Math.max(...giris2018.map((event) => event.sources.length))).toBe(4);
    const cikis = events.filter((event) => event.occurredOn === "2024-01-15");
    expect(cikis.length).toBeLessThanOrEqual(2);
    expect(events.some((event) => event.occurredOn === "2020-03-12" || event.occurredOn === "2021-10-05")).toBe(false);
    // 31 events on the unchanged code over the full file; far fewer now.
    expect(events.length).toBeLessThan(rows.filter((row) => row.valueKind === "date").length - 8);
  });

  it("a date written alone is titled as such, never 'date — date'", () => {
    const signature = events.find((event) => event.occurredOn === "2024-02-05");
    expect(signature!.title).toBe(`05.02.2024 — ${BARE_DATE_TITLE_TR}`);
  });
});

describe("W22 · one contradiction item per (values, documents)", () => {
  it("two observations of one value in one document against one figure elsewhere give ONE item", () => {
    const a = extractPropositions("Kira bedeli 45.000 TL olarak ödenmiştir. Aylık kira bedeli 45.000 TL olarak kaydedilmiştir.");
    const b = extractPropositions("Kira bedeli 32.000 TL olarak ödenmiştir.");
    const observations: Located[] = [
      ...a.map((draft, index) => ({ ...draft, observationId: `a${index}`, fileId: "a", unitNo: 1 })),
      ...b.map((draft, index) => ({ ...draft, observationId: `b${index}`, fileId: "b", unitNo: 1 })),
    ];
    const rows = stored(observations);
    const relations = detectRelations(rows.map((row) => ({ ...row, kind: row.valueKind! })) as ComparableObservation[]);
    expect(relations.filter((relation) => relation.relation === "CONTRADICTION")).toHaveLength(2);
    const { items } = buildDeterministicIntel("contradictions", rows, relations);
    const contradictions = items.filter((item) => item.kind === "contradiction");
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]!.sources).toHaveLength(3);
  });
});

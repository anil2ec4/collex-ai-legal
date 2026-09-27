/**
 * W23: the işe giriş pairs "Çelişkileri bul" still missed, and the rule lane
 * of full_review / red_team that was not marked LIMITED.
 *
 * Part one feeds the investigator's WHOLE file — the nine documents as
 * intake extracted them (fixtures/w22-is-davasi-file.json), each one
 * analysis unit as in the measured run — through the observation extractor
 * and the contradiction detector. On extract-v8 the işe giriş conflict
 * (01.03.2018 / 01.03.2019) was compared in 9 of the investigator's 12
 * cross-document pairs; the three it missed were all one witness sentence,
 * "Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi". The
 * generalising blocks below state the rule in other words, and the negative
 * blocks what must NOT become an employment start.
 *
 * The documents are authored test data modelled on a real file; the counts
 * pinned here measure this file, not Turkish case files in general.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveAnalysisCompleteness,
  deriveExtractionCoverage,
  deriveIntelligenceCoverage,
} from "../../src/exhaustive/analysisCoverage.js";
import {
  compareValueObservations,
  detectRelations,
  type ComparableObservation,
} from "../../src/exhaustive/contradictions.js";
import { extractPropositions, parsePredicate, type PropositionDraft } from "../../src/exhaustive/observations.js";
import { deriveCoverage, emptyTally } from "../../src/exhaustive/processingCoverage.js";
import { analysisLabelTr } from "../../src/exhaustive/routes.js";
import type { StageTaskRow } from "../../src/exhaustive/stageTypes.js";
import { MATCHED_VALUE_PAIRS_LIMIT_TR, TASK_SPECS, type AnalysisTask } from "../../src/exhaustive/tasks.js";

interface FixtureDocument {
  readonly name: string;
  readonly text: string;
}

const FILE: readonly FixtureDocument[] = (
  JSON.parse(readFileSync(new URL("./fixtures/w22-is-davasi-file.json", import.meta.url), "utf8")) as {
    documents: FixtureDocument[];
  }
).documents;

interface Located extends PropositionDraft {
  readonly observationId: string;
  readonly fileId: string;
  readonly unitNo: number;
}

/** File id = the two-digit prefix of the document's name ("04" = tanık Ali). */
function census(documents: readonly FixtureDocument[] = FILE): Located[] {
  const out: Located[] = [];
  for (const document of documents) {
    const fileId = document.name.slice(0, 2);
    extractPropositions(document.text).forEach((draft, index) =>
      out.push({ ...draft, observationId: `${fileId}#${String(index).padStart(3, "0")}`, fileId, unitNo: 1 }),
    );
  }
  return out;
}

const pairKey = (a: string, b: string): string => [a, b].sort().join("|");

function crossPairs(left: readonly Located[], right: readonly Located[]): string[] {
  const out = new Set<string>();
  for (const a of left) for (const b of right) if (a.fileId !== b.fileId) out.add(pairKey(a.observationId, b.observationId));
  return [...out];
}

const shownRelations = (observations: readonly Located[]) =>
  detectRelations(observations as unknown as ComparableObservation[]).filter(
    (relation) => relation.relation === "CONTRADICTION" || relation.relation === "TENSION",
  );

const withValue = (observations: readonly Located[], value: string, files: readonly string[]): Located[] =>
  observations.filter((observation) => observation.normalizedValue === value && files.includes(observation.fileId));

/** The one date observation of `value` in `text` (fails loudly if there is not exactly one). */
function dateOf(text: string, value: string): PropositionDraft {
  const found = extractPropositions(text).filter((draft) => draft.kind === "date" && draft.normalizedValue === value);
  expect(found, `${value} in: ${text}`).toHaveLength(1);
  return found[0]!;
}

const eventOf = (text: string, value: string) => parsePredicate(dateOf(text, value).predicate).event;

describe("W23 · the investigator's whole file: every işe giriş pair is compared", () => {
  const observations = census();
  const found = new Set(shownRelations(observations).map((relation) => pairKey(relation.left.observationId, relation.right.observationId)));
  const countFound = (pairs: readonly string[]): number => pairs.filter((pair) => found.has(pair)).length;

  it("the file is the nine documents the investigator uploaded", () => {
    expect(FILE.map((document) => document.name.slice(0, 2))).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
  });

  it("işe giriş 01.03.2018 / 01.03.2019: 12 of the investigator's 12 pairs (9 on extract-v8), 16 of 16 with the ek beyan", () => {
    // {dava, bilirkişi §II, tanık Ali, ihtarname} × {cevap, tanık Ayşe, SGK} (+ tanık Ayşe's ek beyan, 08).
    const left = withValue(observations, "2018-03-01", ["01", "03", "04", "06"]).filter(
      (observation) => observation.fileId !== "03" || observation.statement.includes("tanıklarının beyanları"),
    );
    const investigators = crossPairs(left, withValue(observations, "2019-03-01", ["02", "05", "07"]));
    expect(investigators).toHaveLength(12);
    expect(countFound(investigators)).toBe(12);
    const withEk = crossPairs(left, withValue(observations, "2019-03-01", ["02", "05", "07", "08"]));
    expect(withEk).toHaveLength(16);
    expect(countFound(withEk)).toBe(16);
  });

  it("the witness sentence v8 missed is now the date of the işe giriş, and pairs by that event", () => {
    const [ali] = withValue(observations, "2018-03-01", ["04"]);
    expect(ali!.statement).toBe("Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi, o gün ben de oradaydım.");
    expect(parsePredicate(ali!.predicate).event).toBe("ise_giris");
    const [sgk] = withValue(observations, "2019-03-01", ["07"]);
    const relation = shownRelations(observations).find(
      (candidate) => pairKey(candidate.left.observationId, candidate.right.observationId) === pairKey(ali!.observationId, sgk!.observationId),
    );
    expect(relation?.relation).toBe("CONTRADICTION");
    expect(relation?.pairedBy).toBe("event");
    expect(relation?.rationale).toContain("“işe giriş” için iki farklı tarih var: 01.03.2018 ve 01.03.2019");
  });

  it("the other W22-16 results hold: tebliğ 1/1, net ücret 8/8", () => {
    expect(countFound(crossPairs(withValue(observations, "2023-12-22", ["01"]), withValue(observations, "2023-12-26", ["02"])))).toBe(1);
    // W22-16's 8: 45.000 {dava, bilirkişi, tanık Ali, ihtarname} × 32.000 {cevap, tanık Ayşe}.
    const salary = crossPairs(
      withValue(observations, "4500000", ["01", "03", "04", "06"]),
      withValue(observations, "3200000", ["02", "05"]),
    );
    expect(salary).toHaveLength(8);
    expect(countFound(salary)).toBe(8);
  });

  it("no false contradiction: every reported pair is one of the file's real conflicts", () => {
    // işe giriş, tebliğ, and the net salary said as 45.000 / 32.000 / 33.500 (the ek beyan contradicts
    // the same witness's first statement). Never a decision date, a partial claim, the SGK
    // "prime esas kazanç" (a gross figure) or the bilirkişi's own two alternatives against each other.
    const genuine = new Set([
      "2018-03-01/2019-03-01",
      "2023-12-22/2023-12-26",
      "3200000/4500000",
      "3350000/4500000",
      "3200000/3350000",
    ]);
    const shown = shownRelations(observations);
    expect(shown.length).toBeGreaterThan(0);
    for (const relation of shown) {
      expect(genuine, relation.rationale).toContain([relation.left.normalizedValue, relation.right.normalizedValue].sort().join("/"));
      expect(relation.left.fileId).not.toBe(relation.right.fileId);
    }
    // Two decision dates and three "şimdilik" amounts are never compared.
    expect(compareValueObservations(observations as unknown as ComparableObservation[]).stats.valuesNeverCompared).toBe(5);
    expect(observations.filter((observation) => parsePredicate(observation.predicate).tag === "karar").map((o) => o.normalizedValue).sort()).toEqual([
      "2020-03-12",
      "2021-10-05",
    ]);
  });

  it("the bilirkişi table row and the SGK issue date stay untagged: a date is an event only when its words say so", () => {
    const table = observations.find((observation) => observation.fileId === "03" && observation.statement.startsWith("Kıdem tazminatı 01.03.2018"));
    expect(parsePredicate(table!.predicate).event).toBeUndefined();
    const issued = observations.find((observation) => observation.normalizedValue === "2024-02-02");
    expect(parsePredicate(issued!.predicate).event).toBeUndefined();
  });
});

describe("W23 · a start of work told without 'işe' (generalising)", () => {
  it.each([
    ["job title + 'olarak geldi'", "Davacı, 05.06.2017 tarihinde mağazaya kasiyer olarak geldi.", "2017-06-05"],
    ["two-word title + 'olarak başladı'", "Müşteki 12.09.2016 günü satış temsilcisi olarak başladı.", "2016-09-12"],
    ["long-form date, apostrophe, 'olarak alındı'", "İşçi 3 Nisan 2019'da forklift operatörü olarak alındı.", "2019-04-03"],
    ["'olarak işe girdi' with a title", "Davacı 01.02.2020 tarihinde şoför olarak işe girdi.", "2020-02-01"],
    ["'göreve başladı' after a title", "Davacı 10.10.2015 tarihinde güvenlik görevlisi olarak göreve başladı.", "2015-10-10"],
    ["'D'den beri orada'", "Davacı 01.03.2018'den beri oradaydı.", "2018-03-01"],
    ["'tarihinden bu yana şirketteydi'", "Davacı 01.03.2018 tarihinden bu yana şirketteydi.", "2018-03-01"],
    ["'D'den beri … çalışıyor'", "Davacı 01.03.2018'den beri bizim depoda çalışıyor.", "2018-03-01"],
    ["'istihdam edildi'", "Davacı 07.01.2021 tarihinde istihdam edildi.", "2021-01-07"],
    ["'kadroya alındı'", "Davacı 15.08.2019 tarihinde kadroya alındı.", "2019-08-15"],
    ["'sigorta girişi'", "Davacının 01.03.2019 tarihinde sigorta girişi yapılmıştır.", "2019-03-01"],
    ["a party's own first-person statement is the case's", "Davacı asil beyanında: \"01.03.2018 tarihinde işe başladım.\"", "2018-03-01"],
  ])("%s → işe giriş", (_label, text, value) => {
    expect(eventOf(text, value)).toBe("ise_giris");
  });

  it("two documents telling the start in different words are compared, and the conflict is found", () => {
    const observations = census([
      { name: "01-tanik", text: "Tanık beyanında: \"Davacı 05.06.2017 tarihinde mağazaya kasiyer olarak geldi.\"" },
      { name: "02-sgk", text: "İşe Giriş Tarihi : 05.06.2018" },
    ]);
    const [relation] = shownRelations(observations);
    expect(relation?.relation).toBe("CONTRADICTION");
    expect(relation?.pairedBy).toBe("event");
    expect(relation?.event).toBe("ise_giris");
  });
});

describe("W23 · what must NOT become an employment start (negative)", () => {
  it.each([
    ["a statute entering into force", "7036 sayılı Kanun 01.01.2019 tarihinde yürürlüğe giren düzenlemeyle değişti.", "2019-01-01"],
    ["a law 'yürürlüğe giren' with 'işe' nowhere", "01.01.2019 tarihinde yürürlüğe giren kanun uyarınca hesaplanmıştır.", "2019-01-01"],
    ["a witness arriving at a hearing", "Davacı tanığı 14.05.2024 tarihinde tanık olarak geldi.", "2024-05-14"],
    ["a customer", "Davalı 20.12.2023 tarihinde müşteri olarak geldi.", "2023-12-20"],
    ["an expert appointed", "Mali müşavir 20.05.2024 tarihinde bilirkişi olarak atandı.", "2024-05-20"],
    ["'worked as' is not 'started as'", "Davacı 01.03.2018 tarihinde depo sorumlusu olarak çalışıyordu.", "2018-03-01"],
    ["a locative that is not the predicate", "01.02.2024 tarihinden beri şirkette hiçbir denetim yapılmadı.", "2024-02-01"],
    ["'since' without being at work", "Davacı 01.03.2018'den beri evdeydi.", "2018-03-01"],
    ["a job title that does not start anything", "Davalı 12.12.2023 tarihinde kasiyer olarak görevli personelin tutanağını düzenledi.", "2023-12-12"],
  ])("%s → no event", (_label, text, value) => {
    expect(eventOf(text, value)).toBeUndefined();
  });

  it("a year alone ('2019 yılında yürürlüğe giren kanun', '2018'den beri orada') is not read as a date at all", () => {
    for (const text of [
      "2019 yılında yürürlüğe giren kanun uyarınca hesaplanmıştır.",
      "Davacı 2018'den beri orada çalışıyordu.",
      "2019 yılının başında çalışmaya başladığını biliyorum.",
    ]) {
      expect(extractPropositions(text).filter((draft) => draft.kind === "date"), text).toEqual([]);
    }
  });

  it("a witness's own first-person start is the witness's, never the case's işe giriş", () => {
    const own = 'Tanık Ali KAYA beyanında: "Ben 01.05.2016 tarihinde forklift operatörü olarak işe başladım. Davacı 01.03.2018 tarihinde depoya sorumlu olarak geldi."';
    expect(eventOf(own, "2016-05-01")).toBeUndefined();
    expect(eventOf(own, "2018-03-01")).toBe("ise_giris");
    expect(eventOf('Davalı tanığı beyanında: "Ben 01.02.2023 tarihinde işten ayrıldım."', "2023-02-01")).toBeUndefined();
    // A witness who RECEIVED the tebliğ still tells the case's tebliğ.
    expect(eventOf('Tanık Ayşe DEMİR beyanında: "İhtarnameyi 26.12.2023 tarihinde ben tebellüğ ettim."', "2023-12-26")).toBe("teblig");
    // And the witness's own start is not set against the claimant's date.
    const observations = census([
      { name: "01-dava", text: "Müvekkil davacı 01.03.2018 tarihinde işe başlamıştır." },
      { name: "02-tanik", text: own.replace(" Davacı 01.03.2018 tarihinde depoya sorumlu olarak geldi.", "\"") },
    ]);
    expect(shownRelations(observations)).toEqual([]);
  });

  it("a decision date next to a court citation stays a decision date, whatever it says about employment", () => {
    const text =
      "Yargıtay 9. Hukuk Dairesi'nin 01.03.2018 tarihli, 2017/1 E., 2018/2 K. sayılı kararında işçinin işe başladığı tarih tartışılmıştır.";
    expect(parsePredicate(dateOf(text, "2018-03-01").predicate)).toMatchObject({ neverCompared: true, tag: "karar" });
  });

  it("a partial claim is still never compared", () => {
    const [amount] = extractPropositions("Fazlaya ilişkin haklarımız saklı kalmak kaydıyla şimdilik 5.000 TL kıdem tazminatı talep ederiz.");
    expect(parsePredicate(amount!.predicate)).toMatchObject({ neverCompared: true, tag: "kismi_talep" });
  });
});

// ---------------------------------------------------------------------------
// Part two: the rule lane of full_review and red_team is LIMITED too.
// ---------------------------------------------------------------------------

const extraction = deriveExtractionCoverage(
  [
    {
      unitNo: 1,
      fileId: "f1",
      state: "done" as const,
      extractionState: "succeeded" as const,
      generatedItems: 1,
      acceptedItems: 1,
      invalidItems: 0,
      rejectedQuotes: 0,
      ambiguousQuotes: 0,
      truncatedResponses: 0,
      continuationPasses: 0,
      repairPasses: 0,
    },
  ],
  true,
);
const source = deriveCoverage({ ...emptyTally(), filesTotal: 1, filesProcessed: 1, pagesTotal: 1, pagesTextLayer: 1, analysisUnitsTotal: 1, analysisUnitsProcessed: 1 });

/** A done plan marker: the planner ran the step (and, for synthesis, found nothing to summarize). */
function planDone(taskKey: string, seq: number, details?: Record<string, unknown>): StageTaskRow {
  return {
    taskId: `plan-${seq}`,
    runId: "run-w23",
    stage: "plan",
    taskKey,
    level: 0,
    seq,
    state: "done",
    attempts: 1,
    maxAttempts: 3,
    input: {},
    result: details === undefined ? {} : { details },
    error: null,
    exclusionReason: null,
    modelId: null,
    schemaVersion: null,
  };
}

/** Every stage a model task requires, planned and finished with nothing left to do. */
const PLANNED: readonly StageTaskRow[] = [
  planDone("weigh", 1),
  planDone("contradictions", 2),
  planDone("synthesis:1", 3, { empty: true }),
];

function finished(task: AnalysisTask, finalized = true) {
  return deriveIntelligenceCoverage({
    task,
    tasks: PLANNED,
    claimsTotal: 0,
    defensesTotal: 0,
    evidenceItemsTotal: 0,
    modelAvailable: true,
    finalized,
    valueComparison: { values: 51, valuesNeverCompared: 5, candidatePairs: 567, pairsComparedByEvent: 58, pairsComparedByTopic: 27 },
  });
}

describe("W23 · full_review and red_team say what their rule lane compared", () => {
  for (const task of ["full_review", "red_team"] as const) {
    it(`${task}: every layer finished → LIMITED, never COMPLETE, with the 'N of M' sentence`, () => {
      const intelligence = finished(task);
      expect(intelligence.complete).toBe(true);
      const overall = deriveAnalysisCompleteness({ task, source, extraction, intelligence, active: false });
      expect(source.complete && extraction.complete).toBe(true);
      expect(overall.state).toBe("LIMITED");
      expect(overall.complete).toBe(false);
      expect(overall.analysisLimited).toBe(true);
      expect(overall.sourceComplete && overall.extractionComplete && overall.intelligenceComplete).toBe(true);
      const sentence =
        "Kurallı tarih, tutar ve oran karşılaştırmasında aynı türden 567 değer çiftinden yalnız aynı olayı anan" +
        " ya da konu anahtarı örtüşen 85 çift karşılaştırıldı; farklı kelimelerle anlatılan aynı olay kaçabilir.";
      expect(overall.comparisonLimitTr).toBe(sentence);
      expect(overall.sectionsTr.analysis.endsWith(sentence)).toBe(true);
      expect(overall.refusedBecause).toBe(`"Tüm çelişkiler" söylenemez: ${sentence}`);
      expect(overall.headlineTr).toContain(`"${TASK_SPECS[task].titleTr}" bitti`);
      expect(overall.headlineTr).toContain("çıkarım ve analiz aşamalarının hepsi bitti");
      expect(overall.headlineTr).toContain("\"tüm çelişkiler\" olarak okunamaz");
      expect(TASK_SPECS[task].limitsTr).toContain(MATCHED_VALUE_PAIRS_LIMIT_TR);
      expect(analysisLabelTr(overall, task)).toBe("inceleme bitti; tarih, tutar ve oranlarda yalnız eşleşen değer çiftleri karşılaştırıldı");
    });

    it(`${task}: an unfinished run stays INCOMPLETE / IN_PROGRESS and names no comparison yet`, () => {
      const running = deriveAnalysisCompleteness({ task, source, extraction, intelligence: finished(task, false), active: true });
      expect(running.state).toBe("IN_PROGRESS");
      expect(running.comparisonLimitTr).toBeNull();
      const stopped = deriveAnalysisCompleteness({ task, source, extraction, intelligence: finished(task, false), active: false });
      expect(stopped.state).toBe("INCOMPLETE");
      expect(stopped.complete).toBe(false);
    });
  }

  it("the contradictions task's sentence and chip are unchanged; claim_evidence and chronology can still be COMPLETE", () => {
    const contradictions = deriveAnalysisCompleteness({ task: "contradictions", source, extraction, intelligence: finished("contradictions"), active: false });
    expect(contradictions.state).toBe("LIMITED");
    expect(contradictions.comparisonLimitTr).toBe(
      "Aynı türden 567 değer çiftinden yalnız aynı olayı anan ya da konu anahtarı örtüşen 85 çift karşılaştırıldı;" +
        " farklı kelimelerle anlatılan aynı olay kaçabilir.",
    );
    expect(analysisLabelTr(contradictions, "contradictions")).toBe("inceleme bitti; yalnız eşleşen değer çiftleri karşılaştırıldı");
    for (const task of ["claim_evidence", "chronology"] as const) {
      const overall = deriveAnalysisCompleteness({ task, source, extraction, intelligence: finished(task), active: false });
      expect(overall.state, task).toBe("COMPLETE");
      expect(overall.complete).toBe(true);
      expect(overall.comparisonLimitTr).toBeNull();
    }
  });

  it("every task whose result reads the rule lane's contradictions, except chronology, is matched-pairs-only", () => {
    // buildDeterministicIntel adds rule-lane contradiction items for every task but claim_evidence.
    const flagged = (Object.keys(TASK_SPECS) as AnalysisTask[]).filter((task) => TASK_SPECS[task].matchedPairsOnly === true).sort();
    expect(flagged).toEqual(["contradictions", "full_review", "red_team"]);
  });
});

import { expect, it } from "vitest";
import { buildLiveCandidates, type StoredLiveDocument } from "../../src/research/liveEvidence.js";
import { codePointSlice } from "../../src/verification/validator.js";
import { runResearch } from "../../src/research/researchService.js";
import { QUESTION, ScriptedGateway, happyScripts, fixedClocks } from "./helpers.js";

function stored(text: string): StoredLiveDocument {
  return { documentId: "d", documentVersionId: "v", injection: {} as StoredLiveDocument["injection"],
    doc: { text, source: "BEDESTEN", title: "Yargıtay kararı", externalId: "1", sourceUrl: "", contentSha256: "",
      retrievedAt: "2026-09-09", toolName: "fetch", mediaType: "text/markdown" } };
}

const affirmance = "B. Değerlendirme ve Gerekçe\n" +
  "Uyuşmazlık, fazla çalışma ücretinin ispatına ilişkindir.\n" +
  "Bölge adliye mahkemelerinin nihai kararlarının bozulması 6100 sayılı Kanun'un 371. maddesinde yer alan sebeplerden birinin varlığı hâlinde mümkündür.\n" +
  "Temyizen incelenen karar, tarafların karşılıklı iddia ve savunmalarına, dayandıkları belgelere, uyuşmazlığa uygulanması gereken hukuk kuralları ile hukuki ilişkinin nitelendirilmesine, dava şartlarına, yargılama ve ispat kuralları ile kararda belirtilen gerekçelere göre usul ve kanuna uygun olup davacı vekili tarafından temyiz dilekçesinde ileri sürülen nedenler kararın bozulmasını gerektirecek nitelikte görülmemiştir.";

it("does not treat topic plus stock affirmance as a substantive proof answer", () => {
  expect(buildLiveCandidates(stored(affirmance), { queryText: "fazla çalışma ücretinin tanıkla ispatı", stance: "neutral", preferReasoning: true })).toEqual([]);
});

it("retains concrete reasoning added to the standard affirmance", () => {
  const text = affirmance + "\nTanık davacıyla aynı dönemde çalışmadığından fazla çalışma saatlerini bilemez; işyeri kayıtları incelenmelidir.";
  const candidates = buildLiveCandidates(stored(text), { queryText: "tanık aynı dönemde çalışma işyeri kayıtları", stance: "neutral", preferReasoning: true });
  expect(candidates.some(c => codePointSlice(text, c.startChar, c.endChar).includes("Tanık davacıyla aynı dönemde"))).toBe(true);
});

it("uses the actual question rather than generated reversal search terms", () => {
  expect(buildLiveCandidates(stored(affirmance), { queryText: "fazla çalışma bozma temyiz", questionText: "tanıkla fazla çalışma ispatı", stance: "neutral", preferReasoning: true })).toEqual([]);
});

it("recognizes the full-law-name and defendant-appellant variant observed in the second real decision", () => {
  const text = affirmance.replace("6100 sayılı Kanun'un", "6100 sayılı Hukuk Muhakemeleri Kanunu'nun (6100 sayılı Kanun)")
    .replace("davacı vekili tarafından", "davalı vekili tarafından");
  expect(buildLiveCandidates(stored(text), { queryText: "tanıkla fazla çalışma ispatı", stance: "neutral", preferReasoning: true })).toEqual([]);
});

it("retains the same passage for a question about grounds of reversal", () => {
  expect(buildLiveCandidates(stored(affirmance), { queryText: "HMK 371 temyizde bozma sebepleri", stance: "neutral", preferReasoning: true }).length).toBeGreaterThan(0);
});

it("records excluded documents through the actual research pipeline without turning them into evidence", async () => {
  const run = await runResearch({ question: QUESTION, ...fixedClocks(),
    gateway: new ScriptedGateway(happyScripts({ textFor: () => affirmance })),
  });
  const counts = run.result.trace.find(stage => stage.name === "evidence")!.counts;
  expect(counts["stockAffirmanceDocumentsExcluded"]).toBeGreaterThan(0);
  expect(run.result.evidence).toHaveLength(0);
});

it("does not cite a party or lower court summary as the judgment's reasoning", () => {
  const text = "😀\nI. DAVA\nFazla çalışma tanık beyanı işveren kayıtları bakımından tüm iddialar burada tekrar edilmiştir.\n" +
    "B. Değerlendirme ve Gerekçe\nKararda ücret alacağı konusunda yalnız usul kuralları ve temyiz şartları değerlendirilmiştir.\n" +
    "VI. KARAR\nFazla çalışma tanık beyanı işveren kayıtları hakkında başvuru sonucu burada açıklanmıştır.";
  const selected = buildLiveCandidates(stored(text), { queryText: "fazla çalışma tanık işveren kayıtları", stance: "neutral", preferReasoning: true });
  expect(selected.length).toBeGreaterThan(0);
  for (const c of selected) {
    const quote = codePointSlice(text, c.startChar, c.endChar);
    expect(quote).toContain("yalnız usul kuralları");
    expect(quote).not.toContain("iddialar");
    expect(quote).not.toContain("başvuru sonucu");
  }
});

it("keeps unstructured judgments and non-judgment callers unchanged", () => {
  for (const text of ["Tanık beyanları ve işveren kayıtları fazla çalışma alacağını kanıtlamak için incelenmiştir.",
    "I. DAVA\nTanık beyanları ve işveren kayıtları fazla çalışma alacağını kanıtlamak için incelenmiştir."]) {
    const options = { queryText: "tanık işveren", stance: "neutral" as const };
    expect(buildLiveCandidates(stored(text), { ...options, preferReasoning: true }))
      .toEqual(buildLiveCandidates(stored(text), options));
  }
});

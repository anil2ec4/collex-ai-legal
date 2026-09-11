import { describe, expect, it } from "vitest";
import { runResearch } from "../../src/research/researchService.js";
import { ScriptedGateway, bedestenDecision, bedestenSearchPayload, deepFetchPayload, fixedClocks, happyScripts, primaryDecisionText, QUESTION } from "./helpers.js";

const question = "İzmir'de çalışan bir işçinin iş sözleşmesi işveren tarafından bildirim yapılmadan feshedildi. İşçi fazla çalışma ücretlerinin ödenmediğini ve kıdem tazminatına hak kazandığını ileri sürüyor. Fazla çalışmanın tanıkla ispatı ve işveren kayıtları yönünden Yargıtay kararlarını araştır.";

describe("live workday regressions from 07 September audit", () => {
  it("rejects a provider's future-dated decision even without an optional date filter", async () => {
    const scripts = happyScripts();
    scripts.search_bedesten_unified = () => ({ ok: bedestenSearchPayload([
      bedestenDecision("7001", { kararTarihi: "6006-09-20T21:00:00Z", kararTarihiStr: "21.09.6006" }),
    ]) });
    const run = await runResearch({ question: QUESTION, asOf: "2026-09-07",
      gateway: new ScriptedGateway(scripts), ...fixedClocks(),
    });
    expect(run.fetched.length).toBeGreaterThan(0);
    expect(run.result.evidence).toEqual([]);
    expect(run.result.claims).toEqual([]);
    expect(run.result.warnings.some((w) => w.startsWith("EVIDENCE_FILTERED:"))).toBe(true);
  });

  it("still reaches COMPLETE when relevant primary evidence has no returned contrary candidate", async () => {
    const scripts = happyScripts();
    scripts.search_bedesten_unified = (args) => ({ ok: bedestenSearchPayload(
      /bozma|karşı oy|beraat/u.test(String(args.phrase)) ? [] : [bedestenDecision("7001")],
    ) });
    const run = await runResearch({ question: QUESTION, gateway: new ScriptedGateway(scripts), ...fixedClocks() });
    expect(run.result.status).toBe("COMPLETE");
    expect(run.result.finalizable).toBe(true);
    expect(run.result.claims.length).toBeGreaterThan(0);
    expect(run.result.contraryCoverage.executed).toBe(true);
    expect(run.result.contraryCoverage.contraryEvidenceIds).toEqual([]);
  });

  it("does not infer topical contrary authority from a generic acquittal returned by a contrary query", async () => {
    const generic = "Yüklenen eylemin sabit olmadığı ve atılı fiilin unsurlarının gerçekleşmediği gerekçesiyle yerel mahkemece verilen beraat hükmünün onanmasına oy birliğiyle hükmedilmiştir.";
    const run = await runResearch({ question: QUESTION,
      gateway: new ScriptedGateway(happyScripts({ textFor: (id) => id.startsWith("71") ? generic : primaryDecisionText(id) })),
      ...fixedClocks(),
    });
    expect(run.result.contraryCoverage.executed).toBe(true);
    expect(run.fetched.some((d) => d.text.includes(generic))).toBe(true);
    expect(run.result.claims.length).toBeGreaterThan(0);
    expect(run.result.evidence.some((e) => e.quote.includes(generic))).toBe(false);
  });

  it("does not let a relevant decision admit an unrelated law in the same answer", async () => {
    const gateway = new ScriptedGateway({
      search_mevzuat: () => ({ ok: "- [7528] ÖĞRETMENLİK MESLEĞİ KANUNU (Kanunlar) | mevzuatId: 332571" }),
      search_bedesten_unified: () => ({ ok: bedestenSearchPayload([bedestenDecision("9000")]) }),
      search_emsal_detailed_decisions: () => ({ ok: { decisions: [] } }),
      get_mevzuat_content: () => ({ ok: "Mevzuat 332571 | page 1/1 | page_size 12000\n\nBu Kanunun amacı eğitim öğretim hizmetlerini yürüten öğretmenlerin seçilmelerini, yetiştirilmelerini, atanmalarını ve Millî Eğitim Akademisinin kurulmasını düzenlemektir." }),
      fetch: () => ({ ok: deepFetchPayload("9000", "İzmir'de çalışan işçinin iş sözleşmesi işveren tarafından bildirim yapılmadan feshedildi. Fazla çalışma ücretlerinin ödenmediğini ve kıdem tazminatına hak kazandığını ileri sürüyor. Fazla çalışmanın tanıkla ispatı ve işveren kayıtları araştırılmalıdır.", "İşçilik alacakları") }),
    });
    const run = await runResearch({ question, gateway, ...fixedClocks() });
    expect(run.fetched.some((d) => d.source === "MEVZUAT")).toBe(true);
    expect(run.result.evidence.some((e) => e.quote.includes("işveren"))).toBe(true);
    expect(run.result.evidence.some((e) => e.quote.includes("Akademisinin"))).toBe(false);
    expect(run.result.coverage?.setAside).toBeGreaterThan(0);
  });

  it("reserves full-text work for primary and contrary searches under the default budget", async () => {
    let id = 1000;
    const gateway = new ScriptedGateway({
      search_mevzuat: () => ({ ok: "- [4857] İŞ KANUNU (Kanunlar) | mevzuatId: 100" }),
      search_bedesten_unified: () => ({ ok: bedestenSearchPayload([bedestenDecision(String(++id))]) }),
      search_emsal_detailed_decisions: () => ({ ok: { decisions: [] } }),
      get_mevzuat_content: () => ({ ok: "Mevzuat 100 | page 1/1 | page_size 12000\n\nİş sözleşmesi, işçi ve işveren arasında çalışma şartlarını belirler." }),
      fetch: (args) => ({ ok: deepFetchPayload(String(args["id"]), "İşçinin fazla çalışma ücretlerinin ödenmediği, işveren kayıtları ve tanıkla ispatı araştırılarak kıdem tazminatına hak kazanıp kazanmadığı değerlendirilmelidir.", "Yargıtay işçilik kararı") }),
    });
    const run = await runResearch({ question, gateway, ...fixedClocks() });
    expect(run.result.research.budgetSpent.toolCalls).toBeLessThanOrEqual(16);
    expect(run.fetched.filter((d) => d.source === "BEDESTEN").length).toBeGreaterThanOrEqual(2);
    const roles = run.result.evidence.flatMap((e) => e.retrieval.queries);
    expect(roles).toContain("contrary");
  });

  it("does not turn an unrelated official full text into an answer to an employment question", async () => {
    const gateway = new ScriptedGateway({
      search_mevzuat: () => ({ ok: "- [7528] ÖĞRETMENLİK MESLEĞİ KANUNU (Kanunlar) | mevzuatId: 332571" }),
      search_bedesten_unified: () => ({ ok: bedestenSearchPayload([]) }),
      search_emsal_detailed_decisions: () => ({ ok: { decisions: [] } }),
      get_mevzuat_content: () => ({ ok: "Mevzuat 332571 | page 1/1 | page_size 12000\n\nBu Kanunun amacı eğitim öğretim hizmetlerini yürüten öğretmenlerin seçilmelerini, yetiştirilmelerini, atanmalarını ve Millî Eğitim Akademisinin kurulmasını düzenlemektir." }),
    });
    const run = await runResearch({ question, gateway, ...fixedClocks() });
    expect(run.fetched.length).toBeGreaterThan(0);
    expect(run.result.claims).toEqual([]);
    expect(run.result.evidence).toEqual([]);
    expect(run.result.coverage?.gate).toBe("failed");
    expect(run.result.coverage?.setAside).toBeGreaterThan(0);
  });
});

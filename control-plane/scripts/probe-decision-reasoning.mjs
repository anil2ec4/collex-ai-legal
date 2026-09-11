import { readFileSync, writeFileSync } from "node:fs";
import { importControlPlane } from "./ts-loader.mjs";
const { buildLiveCandidates } = await importControlPlane("src/research/liveEvidence.ts");
const { codePointSlice } = await importControlPlane("src/verification/validator.ts");
const { evaluateQuestionCoverage } = await importControlPlane("src/answer/coverage.ts");
const audit = new URL("../../var/audit-20260907/", import.meta.url);
const bundle = JSON.parse(readFileSync(new URL("live-semantic-passages-bundle.json", audit), "utf8"));
const entry = Object.entries(bundle.texts).find(([key]) => key.includes(":1224717400@"));
if (!entry) throw new Error("Missing inspected real decision");
const [documentVersionId, text] = entry;
const query = "Fazla çalışmanın tanıkla ispatı ve işveren kayıtları yönünden Yargıtay kararlarını araştır.";
const stored = { documentId: "live:BEDESTEN:1224717400", documentVersionId,
  doc: { text, source: "BEDESTEN", title: "Yargıtay 9. HD 2026/2266 E. 2026/4307 K.", sourceUrl: "https://mevzuat.adalet.gov.tr/ictihat/1224717400" } };
const result = {};
for (const preferReasoning of [false, true]) {
  result[preferReasoning ? "after" : "before"] = buildLiveCandidates(stored, { queryText: query, stance: "neutral", preferReasoning })
    .map(c => { const quote = codePointSlice(text, c.startChar, c.endChar); return { startChar: c.startChar, endChar: c.endChar, quote,
      coverage: evaluateQuestionCoverage(query, [quote]) }; });
}
if (result.after.some(c => c.quote.includes("İLK DERECE MAHKEMESİ KARARI") || c.quote.includes("II. CEVAP"))) throw new Error("Summary still selected");
const samples = JSON.parse(readFileSync(new URL("query-precision-fulltexts.json", audit), "utf8"));
const second = samples.find(s => s.row.externalId === "1224719800");
if (!second) throw new Error("Second inspected decision missing");
result.secondDecisionRemaining = buildLiveCandidates({ ...stored, doc: { ...stored.doc, text: second.card.text } },
  { queryText: query, stance: "neutral", preferReasoning: true }).length;
if (result.after.length !== 0 || result.secondDecisionRemaining !== 0) throw new Error("Stock affirmance still selected");
writeFileSync(new URL("decision-reasoning-comparison.json", audit), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

import { readFileSync, writeFileSync } from "node:fs";
import { importControlPlane } from "./ts-loader.mjs";
const { selectQuoteSpans } = await importControlPlane("src/research/liveEvidence.ts");
const { evaluateQuestionCoverage } = await importControlPlane("src/answer/coverage.ts");
const { analyzeIntake } = await importControlPlane("src/planner/intake.ts");
const question = "İzmir'de çalışan bir işçinin iş sözleşmesi işveren tarafından bildirim yapılmadan feshedildi. İşçi fazla çalışma ücretlerinin ödenmediğini ve kıdem tazminatına hak kazandığını ileri sürüyor. Fazla çalışmanın tanıkla ispatı ve işveren kayıtları yönünden Yargıtay kararlarını araştır.";
const focus = "Fazla çalışmanın tanıkla ispatı ve işveren kayıtları yönünden Yargıtay kararlarını araştır.";
const analysis = analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" });
const query = [question, ...analysis.issues.flatMap((i) => i.expandedTerms)].join(" ");
const input = new URL("../../var/audit-20260907/query-precision-fulltexts.json", import.meta.url);
const rows = JSON.parse(readFileSync(input, "utf8"));
const result = rows.filter((r) => r.row.externalId === "1224717400").map((r) => ({
  externalId: r.row.externalId,
  passages: selectQuoteSpans(r.card.text, query).map((span) => {
    const quote = Array.from(r.card.text).slice(span.startChar, span.endChar).join("");
    return { ...span, quote, coverage: evaluateQuestionCoverage(focus, [quote]) };
  }),
}));
if (!result.length) throw new Error("Observed decision absent");
writeFileSync(new URL("../../var/audit-20260907/quote-window-probe.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

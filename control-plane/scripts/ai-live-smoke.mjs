/**
 * MANUAL live smoke for the cloud-AI lane (W12-E). NOT part of any test
 * suite or CI, and NOT run in the environment this lane was built in — no
 * ANTHROPIC_API_KEY exists here. Until someone runs it with a key and records
 * the output in docs/implementation/AI.md, every AI surface honestly reports
 * "canlı sınanmadı".
 *
 *   node control-plane/scripts/ai-live-smoke.mjs            # needs ANTHROPIC_API_KEY
 *   node control-plane/scripts/ai-live-smoke.mjs --dry-run  # prints the plan, no network
 *
 * What it does (three REAL, billable Messages API calls, sequential):
 *   1. assess_entailment  — a SENTETİK claim vs. a SENTETİK passage
 *                           (expects a structured {entails, score, rationale});
 *   2. write_paragraph    — one paragraph from one SENTETİK evidence record
 *                           (expects text + evidenceIds ⊆ the offered ids);
 *   3. analyze_document   — one SENTETİK chunk (expects at least one finding
 *                           whose quote verifies as an exact substring).
 * It prints the model, the status of each call, token usage, and PASS/FAIL.
 * It never prints the key, never reads .env, and sends ONLY the synthetic
 * strings below — no client document ever leaves this script.
 *
 * EXIT CODE: 0 when all three calls return a well-formed tool result; 2 when
 * the key is absent (nothing attempted); 1 on any transport/shape failure.
 */

import { importControlPlane } from "./ts-loader.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const SYNTHETIC_QUOTE =
  "Dolandırıcılık suçunun sentetik temel hâlinde faile bir yıldan beş yıla kadar" +
  " hapis ve beşbin güne kadar adlî para cezası verilir.";
const SYNTHETIC_CLAIM =
  "5237 sayılı Kanun m. 157 (SENTETİK) uyarınca dolandırıcılığın temel hâli bir yıldan" +
  " beş yıla kadar hapis cezasını gerektirir.";
const SYNTHETIC_CHUNK =
  "DAVACI: Ayşe Yılmaz (SENTETİK)\nDAVALI: Veli Kaya (SENTETİK)\n" +
  "KONU: 50.000 TL sentetik alacağın tahsili talebi.\n" +
  "OLAYLAR: 05.01.2025 tarihinde davalı sentetik bir yatırım vaadinde bulunmuştur.";

function line(label, value) {
  console.log(`${label.padEnd(22)} ${value}`);
}

async function main() {
  const { resolveAiConfig, createAiAdapter, HIGHER_QUALITY_AI_MODEL } = await importControlPlane(
    "src/ai/config.ts",
  );
  const { verifyQuote } = await importControlPlane("src/ai/analysis.ts");

  const config = resolveAiConfig(process.env);
  if (config === null) {
    console.error(
      "[ai-smoke] ANTHROPIC_API_KEY tanımlı değil — hiçbir çağrı yapılmadı. " +
        "Anahtarı 'ColleX Sunucu' penceresinin ortamına veya kullanıcı düzeyi bir ortam " +
        "değişkenine koyun (bu deponun .env dosyasına DEĞİL).",
    );
    process.exit(2);
  }
  line("model", config.model);
  line("alternative", `${HIGHER_QUALITY_AI_MODEL} (COLLEX_AI_MODEL ile)`);
  line("base url", config.baseUrl ?? "https://api.anthropic.com (varsayılan)");
  line("tool choice", config.toolChoice);
  line("key", "[gizli] — asla yazdırılmaz");
  for (const warning of config.warnings) line("warning", warning);
  console.log(
    "\n[ai-smoke] UYARI: aşağıdaki üç çağrı ÜCRETLİDİR ve yalnızca SENTETİK metin gönderir.",
  );
  if (DRY_RUN) {
    console.log("[ai-smoke] --dry-run: plan yazdırıldı, ağ çağrısı yapılmadı.");
    return;
  }

  const adapter = createAiAdapter(config);
  let failures = 0;

  // 1. entailment
  try {
    const judgement = await adapter.assess(SYNTHETIC_CLAIM, {
      evidenceId: "ev-sentetik-1",
      documentId: "",
      documentVersionId: "",
      chunkId: "",
      source: "MEVZUAT",
      sourceUrl: "",
      title: "Türk Ceza Kanunu (SENTETİK)",
      locator: { article: "157", startChar: 0, endChar: 0 },
      quote: SYNTHETIC_QUOTE,
      quoteSha256: "",
      contentSha256: "",
      retrievedAt: new Date().toISOString(),
    });
    line("assess_entailment", `OK entails=${judgement.entails} score=${judgement.score}`);
    line("  rationale", judgement.rationale.slice(0, 160));
  } catch (error) {
    failures += 1;
    line("assess_entailment", `FAIL ${describeError(error)}`);
  }

  // 2. write_paragraph
  try {
    const { value } = await adapter.writeParagraph({
      instructions: "Dolandırıcılığın temel hâlinin cezasını tek paragrafta açıkla (SENTETİK).",
      draftTitle: "Dava Dilekçesi (SENTETİK)",
      sectionTitle: "HUKUKÎ DEĞERLENDİRME",
      kind: "dilekce",
      length: "normal",
      evidence: [
        {
          evidenceId: "ev-sentetik-1",
          label: "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 157",
          quote: SYNTHETIC_QUOTE,
        },
      ],
    });
    const idsOk = value.evidenceIds.every((id) => id === "ev-sentetik-1");
    line("write_paragraph", `${idsOk ? "OK" : "FAIL"} evidenceIds=${JSON.stringify(value.evidenceIds)}`);
    line("  text", value.text.slice(0, 200).replace(/\s+/g, " "));
    if (!idsOk) failures += 1;
  } catch (error) {
    failures += 1;
    line("write_paragraph", `FAIL ${describeError(error)}`);
  }

  // 3. analyze_document
  try {
    const { value } = await adapter.analyzeDocument({
      fileName: "sentetik-dilekce.txt",
      focus: "dilekce",
      chunks: [{ chunkId: "c1", ordinal: 0, text: SYNTHETIC_CHUNK }],
    });
    const items = [
      ...value.taraflar,
      ...value.talepler,
      ...value.dayanaklar,
      ...value.tarihler,
      ...value.riskler,
      ...value.eksikler,
      ...value.karsiArgumanlar,
    ];
    let verified = 0;
    let pointers = 0;
    for (const item of items) {
      for (const pointer of item.evidence) {
        pointers += 1;
        if (pointer.chunkId === "c1" && verifyQuote(SYNTHETIC_CHUNK, pointer.quote).verified) verified += 1;
      }
    }
    const ok = items.length > 0 && verified > 0;
    line("analyze_document", `${ok ? "OK" : "FAIL"} findings=${items.length} quotes=${pointers} verified=${verified}`);
    line("  özet", value.ozet.slice(0, 200).replace(/\s+/g, " "));
    if (!ok) failures += 1;
  } catch (error) {
    failures += 1;
    line("analyze_document", `FAIL ${describeError(error)}`);
  }

  const usage = adapter.usage;
  line("usage", `input=${usage.inputTokens} output=${usage.outputTokens} cacheRead=${usage.cacheReadInputTokens} calls=${adapter.calls}`);
  console.log(`\n[ai-smoke] ${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  console.log(
    "[ai-smoke] Bu çıktıyı docs/implementation/AI.md 'Canlı sınama kaydı' bölümüne tarih ve modelle ekleyin.",
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Typed adapter failures carry a code + status; never a body, never the key. */
function describeError(error) {
  if (error !== null && typeof error === "object" && "code" in error) {
    return `${error.code}${error.status !== undefined ? ` status=${error.status}` : ""}`;
  }
  return error?.name ?? "unknown";
}

main().catch((error) => {
  console.error(`[ai-smoke] RAW FAILURE: ${error?.name ?? "unknown"}`);
  process.exit(1);
});

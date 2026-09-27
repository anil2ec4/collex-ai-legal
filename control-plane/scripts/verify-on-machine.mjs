#!/usr/bin/env node
/**
 * ColleX — on-machine verification (W23). Run ON the lawyer's machine while
 * ColleX is running; double-click `ColleX-Dogrula.cmd` (Windows) or run
 * `deploy/macos/collex-verify.sh` (Mac).
 *
 *   node control-plane/scripts/verify-on-machine.mjs [--base http://127.0.0.1:8787]
 *        [--only yargitay,mevzuat] [--no-fulltext] [--out <folder>] [--bulut]
 *
 * It measures the three things the development environment cannot:
 *   1. every official source through ColleX's own HTTP API (search, then one
 *      full text per source, re-hashed here) — sequential, one request at a
 *      time, 1,5 s apart (court and legislation share one Bedesten quota);
 *   2. the local language model, if one is configured
 *      (COLLEX_LOCAL_LLM_BASE_URL + COLLEX_LOCAL_LLM_MODEL): runs
 *      probe_local_generation.mjs with SYNTHETIC sentences only;
 *   3. on a Mac: the macOS version, the chip, the memory and whether the
 *      launchd agents are loaded.
 * With --bulut AND ANTHROPIC_API_KEY in the environment it also runs
 * ai-live-smoke.mjs (three billable calls, synthetic strings only). Without
 * --bulut nothing leaves the machine except the official-source requests.
 *
 * It writes nothing into the lawyer's matters, drafts or answers (every fetch
 * is `saveToLibrary:false`). The report goes to <out>/dogrulama-<zaman>.md and
 * .json; <out> defaults to <COLLEX_DATA_DIR>/dogrulama, else <repo>/var/dogrulama.
 *
 * EXIT CODE: 0 when ColleX answered (whatever the sources did — the report is
 * the result); 2 when ColleX itself could not be reached.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { argv, env, exit, platform, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { importControlPlane } from "./ts-loader.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

function arg(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
}

const base = String(arg("base", "http://127.0.0.1:8787"));
const only = arg("only", undefined);
const fetchFullText = !argv.includes("--no-fulltext");
const wantCloud = argv.includes("--bulut");
const dataDir = (env.COLLEX_DATA_DIR ?? "").trim();
const outDir = path.resolve(String(arg("out", dataDir !== "" ? path.join(dataDir, "dogrulama") : path.join(REPO_ROOT, "var", "dogrulama"))));

const { runVerification, renderReportTr } = await importControlPlane("src/verify/onMachine.ts");

stdout.write(`ColleX doğrulaması başlıyor (${base}). Resmî kaynaklar sırayla denenecek; birkaç dakika sürebilir.\n`);
const report = await runVerification({
  base,
  fetchFullText,
  ...(only !== undefined ? { only: String(only).split(",").map((s) => s.trim()).filter(Boolean) } : {}),
  onProgress: (line) => stdout.write(`  ${line}\n`),
});

const extras = [];

// 2. Local model — synthetic sentences only, never a client document.
const llmBase = (env.COLLEX_LOCAL_LLM_BASE_URL ?? "").trim();
const llmModel = (env.COLLEX_LOCAL_LLM_MODEL ?? "").trim();
if (llmBase !== "" && llmModel !== "") {
  stdout.write("  Yerel yapay zekâ modeli deneniyor (yalnız örnek cümlelerle)…\n");
  const probe = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "probe_local_generation.mjs"), "--base-url", llmBase, "--model", llmModel, "--runs", "6"],
    { encoding: "utf8", timeout: 15 * 60_000, env },
  );
  extras.push(
    "## Yerel yapay zekâ modeli\n\n" +
      `Model: ${llmModel} · çıkış kodu: ${probe.status === null ? "süre doldu" : probe.status}\n\n` +
      "Bu ölçüm hızı ve cevabın biçimini ölçer; hukukî isabeti ÖLÇMEZ.\n\n```\n" +
      String(probe.stdout ?? "").trim() +
      "\n```",
  );
} else {
  extras.push(
    "## Yerel yapay zekâ modeli\n\nAyarlı bir yerel model yok (COLLEX_LOCAL_LLM_BASE_URL ve COLLEX_LOCAL_LLM_MODEL boş); " +
      "denenmedi. Model isteyen dosya incelemeleri bu bilgisayarda çalışmaz ve ekran bunu söyler.",
  );
}

// Cloud lane — only on explicit request.
if (wantCloud) {
  if ((env.ANTHROPIC_API_KEY ?? "").trim() === "") {
    extras.push("## Bulut yapay zekâ\n\n--bulut istendi ama ANTHROPIC_API_KEY bu pencerenin ortamında yok; denenmedi.");
  } else {
    stdout.write("  Bulut yapay zekâ deneniyor (üç örnek çağrı, müvekkil verisi gönderilmez)…\n");
    const smoke = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "ai-live-smoke.mjs")], {
      encoding: "utf8",
      timeout: 5 * 60_000,
      env,
    });
    extras.push(
      "## Bulut yapay zekâ\n\n" +
        `Çıkış kodu: ${smoke.status === null ? "süre doldu" : smoke.status} (0 = üç çağrı da doğru biçimde cevaplandı)\n\n` +
        "```\n" +
        String(smoke.stdout ?? "").trim() +
        "\n```",
    );
  }
}

// 3. The Mac itself.
if (platform === "darwin") {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
    return String(r.stdout ?? "").trim();
  };
  const agents = run("launchctl", ["list"])
    .split("\n")
    .filter((l) => /collex/iu.test(l))
    .join("\n");
  const memBytes = Number(run("sysctl", ["-n", "hw.memsize"]));
  extras.push(
    "## Bu Mac\n\n" +
      `- macOS: ${run("sw_vers", ["-productVersion"]) || "okunamadı"}\n` +
      `- İşlemci: ${run("sysctl", ["-n", "machdep.cpu.brand_string"]) || "okunamadı"}\n` +
      `- Bellek: ${Number.isFinite(memBytes) && memBytes > 0 ? `${Math.round(memBytes / 1024 ** 3)} GB` : "okunamadı"}\n` +
      `- launchd ile yüklü ColleX servisleri:\n\n\`\`\`\n${agents || "(yok)"}\n\`\`\``,
  );
}

mkdirSync(outDir, { recursive: true });
const stamp = report.startedAt.replace(/[:.]/gu, "-");
const mdPath = path.join(outDir, `dogrulama-${stamp}.md`);
const jsonPath = path.join(outDir, `dogrulama-${stamp}.json`);
writeFileSync(mdPath, renderReportTr(report, extras), "utf8");
writeFileSync(jsonPath, JSON.stringify({ ...report, extras }, null, 2), "utf8");

if (!report.health.reachable) {
  stdout.write(`\n${report.health.message ?? "ColleX'e bağlanılamadı."}\nRapor: ${mdPath}\n`);
  exit(2);
}
const s = report.summary;
stdout.write(
  `\nBitti. ${report.sources.length} kaynak: ${s.reached} ulaşıldı · ${s.reachedNoRows} ulaşıldı ama sonuç yok · ` +
    `${s.unreachable} ULAŞILAMADI. Tam metin: ${s.fetchedSealed} doğrulandı · ${s.fetchSealBroken} tutmadı · ` +
    `${s.fetchFailed} getirilemedi.\nRapor: ${mdPath}\n`,
);
exit(0);

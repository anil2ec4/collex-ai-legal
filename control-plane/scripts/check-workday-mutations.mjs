import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mutations = [
  ["reanalysis cache invalidation", "public/console.html", "tests/pipeline/consoleReanalysis.test.ts",
    '      delete uploadResults[fileId];', '      /* stale cache retained */'],
  ["reanalysis failure handling", "public/console.html", "tests/pipeline/consoleReanalysis.test.ts",
    '      if (res.status !== 200) { throw new Error(errMessage(res)); }', '      if (false) { throw new Error(errMessage(res)); }'],
  ["reanalysis navigation guard", "public/console.html", "tests/pipeline/consoleReanalysis.test.ts",
    '      if (docPage.fileId === fileId) { openDocument(fileId); }', '      openDocument(fileId);'],
  ["reanalysis route dispatch", "src/files/routes.ts", "tests/files/routes.test.ts",
    '        "--reanalyze", fileId, "--store-dir", uploadsDir],', '        "--show", fileId, "--store-dir", uploadsDir],'],
  ["distinct document count", "public/console.html", "tests/pipeline/consoleSourceCount.test.ts",
    'documents.size + " belge · "', 'evidence.length + " belge · "'],
  ["unidentified document count", "public/console.html", "tests/pipeline/consoleSourceCount.test.ts",
    'return unidentified\n', 'return false\n'],
  ["partial status explanation", "public/console.html", "tests/pipeline/consolePartialReason.test.ts",
    'if (data.status !== "PARTIAL") { return parts; }', 'if (true) { return parts; }'],
  ["quote window traversal", "src/research/liveEvidence.ts", "tests/research/quoteWindow.test.ts",
    'offset += stride', 'offset = block.endChar'],
  ["quote window morphology", "src/research/liveEvidence.ts", "tests/research/quoteWindow.test.ts",
    'assessQuestionCoverage(queryText, [quote]).ratio', '0'],
  ["quote window overlap", "src/research/liveEvidence.ts", "tests/research/quoteWindow.test.ts",
    'positive.some((chosen) => span.startChar < chosen.endChar && chosen.startChar < span.endChar)', 'false'],
  ["research preferred candidates", "src/research/livePlanner.ts", "tests/research/fetchCandidates.test.ts",
    'Number(b.preferred) - Number(a.preferred)', '0'],
  ["research focus ordering", "src/planner/intake.ts", "tests/planner/workdayIntake.test.ts",
    'explicitResearchFocus(intake.question) ?? ""', '""'],
  ["research focus coverage", "src/pipeline/questionIntent.ts", "tests/pipeline/researchFocus.test.ts",
    'focus !== undefined && references.length === 0', 'false'],
  ["research secondary candidates", "src/research/livePlanner.ts", "tests/research/fetchCandidates.test.ts",
    'extractHits(step.outcome).map((top, rank)', 'extractHits(step.outcome).slice(0, 1).map((top, rank)'],
  ...[
    ["basvurma-harci-sulh", "335.2"], ["basvurma-harci-asliye", "732"],
    ["basvurma-harci-kanun-yolu", "1124.5"], ["basvurma-harci-aym", "6024.1"],
    ["karar-ilam-harci-nispi-asgari", "732"], ["karar-ilam-harci-maktu", "732"],
    ["vekalet-suret-harci", "104"],
  ].map(([id, amount]) => ["fee amount " + id, "src/fees/published2026.ts", "tests/fees/official2026.test.ts",
    `"${id}": ${amount},`, `"${id}": 1,`]),
  ["fee copy reference", "src/fees/tariffs.ts", "tests/fees/official2026.test.ts",
    'article: "(1) sayılı tarife D/I-c",', 'article: "(1) sayılı tarife A/IV",'],
  ["fee year binding", "src/fees/tariffs.ts", "tests/fees/official2026.test.ts",
    'year: 2026,', 'year: 2027,'],
  ["fee minimum explanation", "src/fees/calc.ts", "tests/fees/calc.test.ts",
    'label: "Nispi harcın alt sınırı kontrol edildi",', 'label: "",'],
  ["fee source identity", "src/fees/published2026.ts", "tests/fees/tariffs.test.ts",
    'https://cdn.gib.gov.tr/', 'https://example.com/'],
  ["observed question phrase", "src/planner/templates.ts", "tests/planner/workdayPhrase.test.ts",
    'return issue.matchedTerm ?? issue.expandedTerms[0] ?? issue.label;', 'return issue.expandedTerms[0] ?? issue.label;'],
  ["as-of decision boundary", "src/research/researchService.ts", "tests/research/liveWorkday.test.ts",
    '        futureDecision ||', '        false ||'],
  ["official decision day", "src/research/payloads.ts", "tests/research/workdayDecisionDate.test.ts",
    'const decisionDate = bedestenDecisionDay(row);', 'const decisionDate = isoDay(asString(row["kararTarihi"]));'],
  ["timestamp timezone", "src/research/payloads.ts", "tests/research/workdayDecisionDate.test.ts",
    'timeZone: "Europe/Istanbul", year:', 'timeZone: "UTC", year:'],
  ["impossible calendar day", "src/research/payloads.ts", "tests/research/workdayDecisionDate.test.ts",
    'date.toISOString().slice(0, 10) === day ? day : undefined;', 'true ? day : undefined;'],
  ...["q", "asof", "f-datefrom", "f-dateto", "gridq", "d-instructions"].map((id) => [
    "field label " + id, "public/console.html", "tests/pipeline/consoleFieldLabels.test.ts",
    `<label class="fieldlabel" for="${id}">`, '<label class="fieldlabel">',
  ]),
  ["compound primary phrase", "src/planner/templates.ts", "tests/planner/workdayPhrase.test.ts",
    'bedestenInput(exactConcept ? `"${phrase}"` : phrase, options),', 'bedestenInput(phrase, options),'],
  ["local calendar day", "public/console.html", "tests/pipeline/consoleDatePrivacy.test.ts",
    'return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear();',
    'return iso.slice(0, 10).split("-").reverse().join(".");'],
  ["cloud-off hint", "public/console.html", "tests/pipeline/consoleDatePrivacy.test.ts",
    'Resmî kaynaklarda arama seçilirse arama sözcükleri yine ilgili kaynaklara gönderilir.',
    'her şey yerel çalışıyor.'],
  ["cloud-off explanation", "public/console.html", "tests/pipeline/consoleDatePrivacy.test.ts",
    'Bulut yapay zekâ kapalıyken yapay zekâ servisine metin gönderilmez. “Resmî kaynaklarda” aramayı seçerseniz arama sözcükleri ilgili kaynaklara gönderilir.',
    'Kapalıyken her şey bu bilgisayarda kalır.'],
  ["full-text reservation", "src/research/livePlanner.ts", "tests/research/liveWorkday.test.ts",
    'return headroom + Math.min(budget - state.spent.fetches, remaining);', 'return headroom + 1;'],
  ["live coverage admission", "src/research/researchService.ts", "tests/research/liveWorkday.test.ts",
    'const pack: EvidencePack = { ...retrievedPack, items: accepted };', 'const pack: EvidencePack = retrievedPack;'],
  ["mixed-pack admission", "src/research/researchService.ts", "tests/research/liveWorkday.test.ts",
    ').gate !== "failed");', ').gate !== "never-fail");'],
  ["word-root collision", "src/planner/intake.ts", "tests/planner/workdayIntake.test.ts",
    'word.startsWith(token) || stemTurkish(word) === stem ||', 'word.startsWith(token.slice(0, Math.max(4, token.length - 2))) || stemTurkish(word) === stem ||'],
  ["overtime alias", "src/planner/intake.ts", "tests/planner/workdayIntake.test.ts",
    '"fazla mesai": ["fazla çalışma"],', '"fazla mesai": [],'],
];
const run = (test) => spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", test, "--reporter=json"], {
  cwd: root, encoding: "utf8", timeout: 60000,
});
const match = process.argv[2];
const selected = match === undefined ? mutations : mutations.filter((m) => m[0].includes(match));
if (selected.length === 0) throw new Error("No matching mutations: " + match);
for (const test of new Set(selected.map((m) => m[2]))) {
  const baseline = run(test);
  if (baseline.status !== 0) throw new Error("Baseline failed: " + baseline.stdout + baseline.stderr);
}
let survivors = 0;
for (const [name, file, test, from, to] of selected) {
  const target = new URL("../" + file, import.meta.url);
  const original = readFileSync(target, "utf8");
  if (original.split(from).length !== 2) throw new Error("Non-unique mutation anchor: " + name);
  const changed = original.replace(from, to);
  try {
    writeFileSync(target, changed);
    const result = run(test);
    let report;
    try { report = JSON.parse(result.stdout); } catch { throw new Error("No test report: " + result.stderr); }
    const killed = result.status !== 0 && report.numFailedTests > 0;
    console.log(JSON.stringify({ mutation: name, killed, failedTests: report.numFailedTests }));
    if (!killed) survivors++;
  } finally {
    if (readFileSync(target, "utf8") !== changed) throw new Error("Concurrent edit; refusing to overwrite " + file);
    writeFileSync(target, original);
  }
}
process.exitCode = survivors === 0 ? 0 : 1;

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ledger = process.argv[2] === "ledger";
const sparse = process.argv[2] === "sparse";
const refresh = process.argv[2] === "refresh";
const reanalysis = process.argv[2] === "reanalysis";
const target = new URL(ledger ? "../../ingestion/cli.py" : sparse ? "../../intake/extract.py" : refresh || reanalysis ? "../../intake/ingest.py" : "../../intake/analysis.py", import.meta.url);
const run = () => spawnSync(root + ".venv/Scripts/python.exe", ["-m", "pytest",
  ...(ledger ? ["tests/ingestion/test_migrations_ledger.py", "-k", "ingestion_cli_can_prepare"] :
    refresh ? ["tests/intake/test_process.py", "-k", "refreshes"] :
    reanalysis ? ["tests/intake/test_reanalysis.py"] :
    [sparse ? "tests/intake/test_sparse_pdf.py" : "tests/intake/test_official_document_context.py"]), "-q", "-p", "no:cacheprovider"],
  { cwd: root, encoding: "utf8", timeout: 30000 });
if (run().status !== 0) throw new Error("Baseline failed");
let survivors = 0;
for (const [name, from, to] of (ledger ? [
  ["migration ledger use", "        return apply_missing_migrations(conn).applied",
    "        from ingestion.migrations import runnable_migrations\n        for path in runnable_migrations():\n            conn.execute(path.read_text(encoding='utf-8'))\n        return [path.name for path in runnable_migrations()]"],
] : reanalysis ? [
  ["original hash verification", ' or hashlib.sha256(data).hexdigest() != digest', ''],
  ["reanalysis tenant scope", '    detail = show_file(dsn, file_id, tenant_id)', '    detail = show_file(dsn, file_id, LOCAL_TENANT_ID)'],
  ["reanalysis actual processing", '        process_file(path, dsn, tenant_id, store_dir=root)', '        pass'],
] : refresh ? [
  ["persist refreshed analysis", '                    "analysis": analysis,', '                    "analysis": {},'],
  ["preserve upload annotations", '                " (v.metadata #> \'{fixture_meta,upload}\') || %s::jsonb)"', '                " %s::jsonb)"'],
] : sparse ? [
  ["sparse page detection", "PDF_SPARSE_CHARS_PER_PAGE = 50", "PDF_SPARSE_CHARS_PER_PAGE = 10"],
  ["sparse page warning", "    if stats.sparse_pages:", "    if False:"],
] : [
  ["heading admission", "if heading is not None and span[0] < heading.end():", "if False:"],
  ["heading context reset", "                last_law = None\n                context_laws.clear()", "                pass"],
  ["multiple law ambiguity", "if len(context_laws) != 1:", "if False:"],
  ["short form revalidation", ' and not (ref.kind == "short_form" and ref.article_no)', ""],
])) {
  const original = readFileSync(target, "utf8");
  const needle = original.includes(from) ? from : from.replaceAll("\n", "\r\n");
  if (original.split(needle).length !== 2) throw new Error("Non-unique anchor: " + name);
  const changed = original.replace(needle, to);
  try {
    writeFileSync(target, changed);
    const result = run();
    const failed = result.stdout.match(/(\d+) failed/);
    const killed = result.status === 1 && failed !== null;
    console.log(JSON.stringify({ name, killed, failedTests: failed ? Number(failed[1]) : null }));
    if (!killed) survivors++;
  } finally {
    if (readFileSync(target, "utf8") !== changed) throw new Error("Concurrent edit; refusing overwrite");
    writeFileSync(target, original);
  }
}
process.exitCode = survivors === 0 ? 0 : 1;

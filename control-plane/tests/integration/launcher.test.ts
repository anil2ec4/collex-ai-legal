/**
 * The lawyer's launcher/stopper (`ColleX-Baslat.cmd`, `ColleX-Durdur.cmd`,
 * repo root) are Windows batch files no test can execute here; what a test
 * CAN hold is their contract (W12-FIX2, review P2-16):
 *
 *   - the stopper kills only processes whose COMMAND LINE names serve.mjs /
 *     serve-mcp.mjs / "uvicorn asgi_app" / managed "local_embedding_server" — never "whatever listens on
 *     8787/8898", which may be somebody else's program;
 *   - a pid from var/collex*.pid is killed only after the same command-line
 *     check (a stale pid can belong to a new process);
 *   - the launcher checks `intake.cli --ensure-db`'s exit code and explains a
 *     STORE_UNAVAILABLE (or any other) failure in Turkish, then STOPS instead
 *     of starting the server without a schema.
 *
 * The same rule as the console tests: the batch text is parsed, so a later
 * edit that reintroduces the port-based kill fails loudly.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = (name: string): string => readFileSync(resolve(REPO_ROOT, name), "utf8");

describe("every double-click script is plain ASCII", () => {
  // The scripts run under `chcp 65001`, where cmd.exe is known to misread
  // batch files that carry multi-byte UTF-8 characters. This was first
  // suspected for the 28.09.2026 stop on the lawyer's machine; that stop had
  // a different, deterministic cause (see "the cmd.exe parsing traps" below),
  // but the only multi-byte characters were "—" in rem/echo lines and the
  // scripts stay plain ASCII as a precaution.
  const scripts = readdirSync(REPO_ROOT).filter((name) => name.toLowerCase().endsWith(".cmd"));

  it("covers the five launchers", () => {
    expect(scripts.sort()).toEqual([
      "ColleX-Baslat.cmd",
      "ColleX-Dogrula.cmd",
      "ColleX-Durdur.cmd",
      "ColleX-Geri-Yukle.cmd",
      "ColleX-Yedekle.cmd",
    ]);
  });

  it.each(scripts)("%s has no byte above 0x7F", (name) => {
    const bytes = readFileSync(resolve(REPO_ROOT, name));
    const offending = [...bytes.entries()].filter(([, b]) => b > 0x7f).map(([i]) => i);
    expect(offending, `${name}: non-ASCII bytes at offsets ${offending.slice(0, 5).join(", ")}`).toEqual([]);
  });
});

describe("ColleX-Durdur.cmd kills by command line, never by port", () => {
  const stopper = read("ColleX-Durdur.cmd");

  it("names the ColleX command lines and matches on CommandLine", () => {
    expect(stopper).toContain("serve\\.mjs|serve-mcp\\.mjs|uvicorn asgi_app|local_embedding_server.*--collex-managed");
    expect(stopper).toMatch(/Get-CimInstance Win32_Process/u);
    expect(stopper).toMatch(/CommandLine -match/u);
    expect(stopper).toContain("Stop-Process");
  });

  it("no longer kills whatever listens on the ports", () => {
    expect(stopper).not.toMatch(/netstat/iu);
    expect(stopper).not.toMatch(/LISTENING/u);
    expect(stopper).not.toMatch(/taskkill[^\n]*\/PID %%p/u);
  });

  it("checks a pid file's process against the same command-line rule before killing it", () => {
    // W14 B-34: the pid paths now go through the data-directory variable so
    // COLLEX_DATA_DIR moves them together with the uploads.
    expect(stopper).toContain("%COLLEX_VARDIR%\\collex-mcp.pid");
    expect(stopper).toContain("%COLLEX_VARDIR%\\collex.pid");
    expect(stopper).toContain('if not "%COLLEX_DATA_DIR%"=="" set "COLLEX_VARDIR=%COLLEX_DATA_DIR%"');
    expect(stopper).toMatch(/:killpid[\s\S]*ProcessId = %1[\s\S]*CommandLine -match[\s\S]*Stop-Process -Id %1/u);
    expect(stopper).toContain("call :killpid %%p");
  });
});

describe("ColleX-Baslat.cmd stops on an ensure-db failure with a Turkish explanation", () => {
  const launcher = read("ColleX-Baslat.cmd");
  it("defines paths before cmd expands the Python conditional block", () => {
    const block = launcher.indexOf('if exist ".venv\\Scripts\\python.exe" (');
    for (const name of ["ENSURELOG", "LIBLOG", "LIBDIR"]) {
      expect(launcher.indexOf(`set "${name}=`)).toBeLessThan(block);
    }
    expect(launcher).toContain('set "COLLEX_NO_DOTENV=1"');
  });

  it("captures the ensure-db output, tests errorlevel and names STORE_UNAVAILABLE", () => {
    expect(launcher).toContain("-m intake.cli --dsn postgres://postgres@127.0.0.1:%PGPORT%/collex_local --ensure-db");
    const block = launcher.slice(launcher.indexOf("--ensure-db"), launcher.indexOf("rem --- 4)"));
    expect(block).toMatch(/if errorlevel 1 \(/u);
    expect(block).toContain('findstr /c:"STORE_UNAVAILABLE"');
    expect(block).toContain("Yerel veritabanina ulasilamadi");
    expect(block).toContain("Veritabani semasi hazirlanamadi");
    expect(block).toContain("Sunucu baslatilmadi");
    expect(block).toMatch(/exit \/b 1/u);
    // The success path is announced too, and ensure-db's own output is kept
    // in a log the messages point at instead of being thrown away.
    expect(block).toContain("Veritabani semasi hazir.");
    const ensureLine = launcher.split(/\r?\n/).find((line) => line.includes("--ensure-db --list")) ?? "";
    expect(ensureLine).toContain('>"%ENSURELOG%" 2>&1');
    expect(ensureLine).not.toContain(">nul");
  });

  it("still never drops anything: ensure-db is the only database command it runs", () => {
    expect(launcher).not.toMatch(/drop database/iu);
    expect(launcher).not.toMatch(/dropdb/iu);
  });
});

describe("local semantic service follows the product lifecycle", () => {
  const launcher = read("ColleX-Baslat.cmd");
  const stopper = read("ColleX-Durdur.cmd");
  const serve = read("control-plane/scripts/serve.mjs");

  it("starts E5 on its own port from the double-click launcher", () => {
    expect(launcher).toContain("--with-local-embeddings --local-embeddings-port 8899");
    expect(serve).toContain('argv[i] === "--with-local-embeddings"');
    expect(serve).toContain("semantic_search.local_embedding_server");
  });

  it("stops only the named local model child during cleanup", () => {
    expect(stopper).toContain("local_embedding_server");
    expect(serve).toContain("killLocalEmbeddings");
  });
});

describe("serve-mcp.mjs takes the token from the environment only (P2-15)", () => {
  const serveMcp = read("control-plane/scripts/serve-mcp.mjs");
  const serve = read("control-plane/scripts/serve.mjs");

  it("refuses --token and reads MCP_API_TOKEN", () => {
    expect(serveMcp).toContain('process.env["MCP_API_TOKEN"]');
    expect(serveMcp).toMatch(/--token[\s\S]*throw new Error\("--token is not accepted/u);
  });

  it("serve.mjs spawns the child with the token in env, not in argv", () => {
    const spawnBlock = serve.slice(serve.indexOf("function startMcp"), serve.indexOf("child.stderr.on"));
    expect(spawnBlock).toContain('"--parent-stdin"]');
    expect(spawnBlock).not.toContain('"--token"');
    expect(spawnBlock).toContain("MCP_API_TOKEN: token");
  });
});

// ---------------------------------------------------------------------------
// W14 B-34 — graceful stop, single instance, one data directory, one VERSION
// ---------------------------------------------------------------------------

describe("B-34 graceful stop (ENGRISK E10)", () => {
  const stopper = read("ColleX-Durdur.cmd");
  const serve = read("control-plane/scripts/serve.mjs");

  it("the stopper asks nicely BEFORE it kills, and waits", () => {
    // The whole point: `taskkill /F` uses TerminateProcess, so Node's
    // SIGINT/SIGTERM/exit hooks never run and the documented flush() path had
    // never executed in production.
    const graceful = stopper.slice(0, stopper.indexOf("taskkill /FI"));
    expect(graceful).toContain("collex.stop");
    expect(graceful).toContain("call :gracefulstop");
    expect(stopper).toMatch(/:gracefulstop[\s\S]*collex\.stop[\s\S]*:waitloop/u);
    // It waits for the PID FILE to disappear — serve.mjs removes it only
    // after flush() and sql.end(), so its absence means "records written".
    expect(stopper).toMatch(/:waitloop[\s\S]*if not exist "%COLLEX_VARDIR%\\collex\.pid"/u);
    // …and still falls back to the hard kill if the server does not go.
    expect(stopper).toContain("sert kapatmaya geciliyor");
  });

  it("serve.mjs really watches the stop file and routes it into shutdown()", () => {
    expect(serve).toContain('const STOP_FILE = path.join(VAR_DIR, "collex.stop")');
    const watcher = serve.slice(
      serve.indexOf("stopWatcher = setInterval"),
      serve.indexOf("// 3. HTTP binds FIRST"),
    );
    expect(watcher).toContain("existsSync(STOP_FILE)");
    expect(watcher).toContain("shutdown()");
    // shutdown() is what performs the flush; that link is the whole item.
    const shutdown = serve.slice(
      serve.indexOf("const shutdown = ()"),
      serve.indexOf('process.on("SIGINT"'),
    );
    expect(shutdown).toContain("answerStore?.flush?.()");
    expect(shutdown).toContain("draftStore?.flush?.()");
    expect(shutdown).toContain("removePid(PID_FILE)");
    expect(shutdown).toContain("sql.end(");
  });

  it("pg_ctl still stops with -m fast, never -m immediate", () => {
    expect(stopper).toContain("-m fast -w stop");
    expect(stopper).not.toContain("-m immediate");
  });
});

describe("B-34 single instance per database", () => {
  const serve = read("control-plane/scripts/serve.mjs");

  it("takes a DSN-scoped advisory lock and exits 1 in Turkish when it is held", () => {
    expect(serve).toContain("pg_try_advisory_lock");
    expect(serve).toContain("instanceLockKey(dbNameOf(args.dsn))");
    const block = serve.slice(serve.indexOf("// 1b."), serve.indexOf("// 2. MCP coordinates"));
    expect(block).toContain("başka bir ColleX sunucusu zaten bağlı");
    expect(block).toContain("process.exit(1)");
    // A crashed instance must never leave the product unstartable: a
    // SESSION-level lock disappears with the connection.
    expect(serve).not.toContain("pg_advisory_lock_shared");
  });

  it("a stale lock does not make the product unstartable", () => {
    // The failure mode this guards is worse than the one the lock prevents:
    // "stop, then start again" must work, and a lock held by something that
    // is not ColleX at all must not brick the launcher.
    const block = serve.slice(serve.indexOf("// 1b."), serve.indexOf("// 2. MCP coordinates"));
    expect(block).toContain("anotherServerConnected");
    expect(block).toContain("application_name = ");
    expect(block).toContain("pid <> pg_backend_pid()");
    // …and it retries before refusing, because a hard-killed process can
    // leave its backend for a moment.
    expect(block).toMatch(/attempt < \d+/u);
    expect(block).toContain("açılışa devam ediliyor");
  });

  it("the lock key is derived from the database NAME, never the DSN", () => {
    const start = serve.indexOf("function instanceLockKey");
    const fn = serve.slice(start, serve.indexOf("\n}", start));
    expect(fn).toContain("collex.serve:${dbName}");
    expect(fn).not.toContain("args.dsn");
  });
});

describe("B-34 one data directory, one version", () => {
  const serve = read("control-plane/scripts/serve.mjs");
  const launcher = read("ColleX-Baslat.cmd");
  const stopper = read("ColleX-Durdur.cmd");
  const ingest = read("intake/ingest.py");

  it("both runtimes and both .cmd files read the SAME COLLEX_DATA_DIR", () => {
    expect(serve).toContain('env["COLLEX_DATA_DIR"]');
    expect(serve).toContain("const VAR_DIR = resolveDataDir()");
    expect(ingest).toContain('source.get("COLLEX_DATA_DIR")');
    expect(ingest).toContain('DEFAULT_STORE_DIR = resolve_data_dir() / "uploads"');
    expect(launcher).toContain("COLLEX_DATA_DIR");
    expect(stopper).toContain("COLLEX_DATA_DIR");
  });

  it("VERSION is the single source and matches pyproject.toml", () => {
    const version = read("VERSION").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+/u);
    const declared = read("pyproject.toml").match(/^version\s*=\s*"([^"]+)"/mu)?.[1];
    expect(declared, "pyproject.toml has no version").toBeDefined();
    expect(version).toBe(declared);
    // …and the API reports it rather than a hand-edited literal.
    const server = read("control-plane/src/api/server.ts");
    expect(server).toContain("readRepoVersion()");
    expect(server).not.toContain('API_VERSION = "1.0.0-w12"');
  });
});

describe("B-34/B-45 launcher: never kill a starting server, never trust a foreign cluster", () => {
  const launcher = read("ColleX-Baslat.cmd");

  it("an impatient second double-click waits instead of killing (E12b)", () => {
    const head = launcher.slice(launcher.indexOf("rem --- 1)"), launcher.indexOf("where node"));
    expect(head).toContain("call :checkalive");
    expect(head).toContain("goto waitready");
    // The kill is now BEHIND the liveness check, not before it.
    expect(head.indexOf("call :checkalive")).toBeLessThan(head.indexOf("taskkill /FI"));
    expect(launcher).toMatch(/:checkalive[\s\S]*serve\\\.mjs/u);
    expect(launcher).toContain(":waitready");
  });

  it("verifies the cluster on 55432 is ColleX's own data directory (E18)", () => {
    expect(launcher).toContain("call :checkcluster");
    expect(launcher).toMatch(/:checkcluster[\s\S]*show data_directory/u);
    expect(launcher).toContain("butun dosyalarim gitti");
    // One line, no parenthesized block: the message lives under a label.
    expect(launcher).toContain('if "%CLUSTER_OK%"=="0" goto clusterbad');
    const bad = launcher.slice(launcher.indexOf("\n:clusterbad"));
    expect(bad.indexOf("\n:clusterbad")).toBe(0);
    const badBody = bad.slice(0, bad.indexOf("exit /b 1") + "exit /b 1".length);
    expect(badBody).toContain("Bulunan veri dizini : %CLUSTER_DIR%");
    expect(badBody).toContain("Dosyalariniz duruyor");
    expect(badBody).toContain("pause");
  });

  it("reads the data directory with psql outside for /f, without a password prompt (28.09.2026)", () => {
    const check = launcher.slice(launcher.indexOf("\n:checkcluster"), launcher.indexOf("\n:health"));
    const psqlLine = check.split(/\r?\n/u).find((line) => line.includes("show data_directory")) ?? "";
    expect(psqlLine.trimStart().startsWith('"%PGBIN%\\psql.exe"')).toBe(true);
    expect(psqlLine).toContain(" -w ");
    expect(psqlLine).toContain('>"%CLUSTERTXT%"');
    expect(check).toContain('set /p CLUSTER_DIR=<"%CLUSTERTXT%"');
    // The paths reach PowerShell through the environment, never spliced into its source.
    expect(check).toContain("$env:CLUSTER_DIR");
    expect(check).toContain("$env:PGDATA_DIR");
    expect(check).not.toContain("'%CLUSTER_DIR%'");
    // PowerShell failing is "could not compare" (2), never "a foreign cluster" (1).
    expect(check).toContain("catch { exit 2 }");
    expect(check.indexOf("if errorlevel 2 goto clusterunknown")).toBeGreaterThan(-1);
    expect(check.indexOf("if errorlevel 2 goto clusterunknown")).toBeLessThan(check.indexOf('if errorlevel 1 set "CLUSTER_OK=0"'));
    // An unreadable directory is said out loud and does not stop the start.
    expect(check).toContain(":clusterunknown");
    expect(check).toContain("bu denetim atlandi");
    const executable = launcher.split(/\r?\n/u).filter((line) => !/^\s*rem\b/iu.test(line));
    expect(executable.join("\n")).not.toContain("(okunamadi)");
  });
});

describe("the cmd.exe parsing traps (28.09.2026, ColleX-Baslat.cmd on the lawyer's machine)", () => {
  // What happened: `for /f` ran `"%PGBIN%\psql.exe" ... "show data_directory"`
  // through `cmd /c`, which strips the FIRST and LAST quote of a command that
  // starts with a quote and holds more quotes, so psql never ran and the
  // directory stayed "(okunamadi)". That placeholder was then expanded INSIDE
  // `if "%CLUSTER_OK%"=="0" ( ... )`, where its ")" closed the block early:
  // the last two warning lines, `pause` and `exit /b 1` ran unconditionally
  // and ColleX refused to start on every double-click.
  const scripts = readdirSync(REPO_ROOT)
    .filter((name) => name.toLowerCase().endsWith(".cmd"))
    .map((name) => ({ name, lines: read(name).split(/\r?\n/u) }));

  it.each(scripts.map((s) => [s.name, s.lines] as const))(
    "%s: no for /f runs a command that starts with a quote",
    (_name, lines) => {
      for (const line of lines) {
        expect(line, line).not.toMatch(/for \/f\b[^`]*\(`\s*"/iu);
      }
    },
  );

  // Values that come from outside the script — the database, a folder the
  // lawyer typed, a manifest — may carry ")" and are never echoed inside a
  // parenthesized block.
  const OUTSIDE_VALUES = ["%CLUSTER_DIR%", "%PGDATA_DIR%", "%SRC%", "%DUMPNAME%"];

  it.each(scripts.map((s) => [s.name, s.lines] as const))(
    "%s: no outside value is expanded inside a parenthesized block",
    (_name, lines) => {
      let depth = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (/^rem\b/iu.test(line) || line.startsWith("::")) continue;
        if (line.startsWith(")")) depth = Math.max(0, depth - 1);
        if (depth > 0) {
          // Inside double quotes a ")" is literal; only an unquoted expansion closes the block.
          const unquoted = line.replace(/"[^"]*"/gu, '""');
          for (const value of OUTSIDE_VALUES) {
            expect(unquoted.includes(value), `inside a block: ${line}`).toBe(false);
          }
        }
        // ") else (" closes one block above and opens the next one here.
        if (/\($/u.test(line) && !/\^\($/u.test(line)) depth += 1;
      }
      expect(depth).toBe(0);
    },
  );

  it.each(scripts.map((s) => [s.name, s.lines] as const))("%s: no echo writes an unescaped '->'", (_name, lines) => {
    for (const line of lines) {
      if (/^\s*echo\b/iu.test(line)) expect(line, line).not.toContain("->");
    }
  });
});

describe("B-03 backup scripts", () => {
  const backupCmd = read("ColleX-Yedekle.cmd");
  const restoreCmd = read("ColleX-Geri-Yukle.cmd");

  it("the backup script captures the database AND the originals AND a manifest", () => {
    expect(backupCmd).toContain("backup.mjs");
    expect(backupCmd).toContain("--database %DBNAME%");
    expect(backupCmd).toContain('set "DBNAME=collex_local"');
    // The lawyer is told, every single time, that the folder is client data.
    expect(backupCmd).toContain("MUVEKKIL VERISI");
    expect(backupCmd).toContain("sifreli bir diske");
  });

  it("the restore VERIFIES before it writes and never drops first", () => {
    // Verification comes before the confirmation prompt, which comes before
    // anything is touched.
    const verifyAt = restoreCmd.indexOf("--verify");
    const promptAt = restoreCmd.indexOf("set /p ONAY=");
    const renameAt = restoreCmd.indexOf("alter database %DBNAME% rename to");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(promptAt);
    expect(promptAt).toBeLessThan(renameAt);
    // RENAME, never DROP, as the first move.
    expect(renameAt).toBeGreaterThan(-1);
    expect(restoreCmd.indexOf("drop database %DBNAME%;")).toBeGreaterThan(renameAt);
    expect(restoreCmd).toContain("--exit-on-error");
    // robocopy merges originals; it must never mirror/purge them.
    expect(restoreCmd).toContain("robocopy");
    expect(restoreCmd).not.toMatch(/\/MIR|\/PURGE/u);
    // The verification line prints the policy count — the safety net for B-05.
    expect(restoreCmd).toContain("pg_policies");
  });

  it("V-14: the restore reads the archive NAME from the manifest", () => {
    // The old script tested `if not exist "%SRC%\collex_local.dump"` and then
    // restored from that same literal — an existence check on the constant it
    // was about to use, which cannot detect a mismatch. It passed by accident
    // only because every backup was written under that one name.
    const executable = restoreCmd
      .split(/\r?\n/u)
      .filter((line) => !/^\s*rem\b/iu.test(line))
      .join("\n");
    expect(executable).not.toContain("collex_local.dump");
    expect(restoreCmd).toContain("backup.mjs --dump-name");
    // The name is read BEFORE it is checked, and BEFORE pg_restore opens it.
    const readAt = restoreCmd.indexOf("--dump-name");
    const archiveRef = 'if not exist "%SRC%\\%DUMPNAME%"';
    const checkAt = restoreCmd.indexOf(archiveRef);
    const restoreAt = restoreCmd.indexOf("pg_restore.exe");
    expect(readAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(readAt);
    expect(restoreCmd.lastIndexOf('"%SRC%\\%DUMPNAME%"')).toBeGreaterThan(restoreAt);
    // An unreadable manifest stops the script instead of guessing a name.
    expect(restoreCmd).toContain('if "%DUMPNAME%"==""');
  });

  it("a failed restore leaves the old database in place and says so", () => {
    const failure = restoreCmd.slice(restoreCmd.indexOf("GERI YUKLEME BASARISIZ"));
    expect(failure).toContain("adiyla DURUYOR");
    expect(failure).toContain("veri kaybi yok");
  });
});

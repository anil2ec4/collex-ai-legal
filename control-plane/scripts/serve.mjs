/**
 * Run the control-plane HTTP API and the operator console, with no build step.
 *
 *   node control-plane/scripts/serve.mjs
 *   node control-plane/scripts/serve.mjs --port 8788 --dsn postgres://...
 *   node control-plane/scripts/serve.mjs --with-mcp [--mcp-port 8898]
 *   node control-plane/scripts/serve.mjs --with-mcp --with-local-embeddings
 *
 * It binds 127.0.0.1 only. Surfaces:
 *
 *   http://127.0.0.1:8787/            the lawyer's daily desk (W12-UI1): five
 *                                     tabs — Dosyalarım (matters + deadlines)
 *                                     / Araştır / Belgeler / Taslak / Ayarlar —
 *                                     plus the matter page (#dosya/<id>) and
 *                                     the document page (#belge/<fileId>)
 *   http://127.0.0.1:8787/v1/health   liveness + capability inventory
 *   http://127.0.0.1:8787/v1/answer   POST {question, asOf?} -> AnswerResult
 *   http://127.0.0.1:8787/v1/files    tenant uploads (intake CLI + local PG)
 *   http://127.0.0.1:8787/v1/drafts   evidence-bound drafting + DOCX/MD/UDF export
 *   http://127.0.0.1:8787/v1/research live deep research (ONLY with --with-mcp)
 *   http://127.0.0.1:8787/v1/matters  dava dosyaları (W12); /v1/settings, /v1/deadlines,
 *                                     /v1/ai (cloud AI, OFF unless ANTHROPIC_API_KEY)
 *
 * Persistence (W12): when the database is reachable AND carries the schema,
 * answers, drafts, matters and settings live in app_private.* (PgAnswerStore,
 * PgDraftStore, PgMatterStore, PgSettingsStore). When the schema is MISSING
 * the server still starts with in-memory stores and says so in Turkish —
 * records then vanish on restart. Shutdown flushes the background persists
 * before the pool is closed.
 *
 * Startup order (W12-F):
 *   1. database check (3 s): `select 1` + to_regclass('legal.documents').
 *      DOWN  -> Turkish diagnosis, exit 1.  MISSING (no db / no schema) ->
 *      Turkish hint, keep going (the API answers typed 503s).
 *   2. HTTP binds FIRST. EADDRINUSE -> Turkish message, exit 1.
 *   3. --with-mcp: the MCP gateway child (scripts/serve-mcp.mjs, REAL uvicorn
 *      on loopback, clean env, token generated HERE and handed to the child
 *      through its environment — never on its command line, W12-FIX2)
 *      starts in the BACKGROUND. Its state is exposed to the app through
 *      `mcpState()`: 'starting' -> 'ok' (ready line) -> 'down' (exit). While
 *      it starts, /v1/research answers the typed 502; nothing waits 8+ s.
 *      A stale uvicorn holding the MCP port is reported in Turkish and the
 *      next free port is used instead.
 *   4. collex.pid and collex-mcp.pid are written into the DATA DIRECTORY
 *      for the launcher scripts and removed on shutdown.
 *   5. W14 B-34, three lifecycle properties the product was missing:
 *      - ONE data-directory resolver (`COLLEX_DATA_DIR`, default `<repo>/var`)
 *        shared by the pid files, the stop sentinel and the upload originals,
 *        so the lawyer's data can live outside the code;
 *      - a DSN-scoped `pg_try_advisory_lock`: a second serve.mjs on the same
 *        database refuses to start (the single-worker invariant the rate
 *        limiter assumes was enforced by nothing at all);
 *      - a GRACEFUL STOP path: `<data>/collex.stop` is polled every 500 ms.
 *        `ColleX-Durdur.cmd` used `taskkill /F` exclusively, so `shutdown()`
 *        — flush(), pid cleanup, sql.end() — had literally never run in
 *        production (ENGRISK E10, and the cause of the stale pid file in
 *        RISKS #22).
 *
 * The default DSN is the persistent local product database `collex_local`
 * (created by `intake.cli --ensure-db`). Nothing reads `.env`; the only
 * configuration is the DSN and the flags above.
 */

import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importControlPlane, CONTROL_PLANE_ROOT } from "./ts-loader.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(CONTROL_PLANE_ROOT), "..");
const DEFAULT_DSN = "postgres://postgres@127.0.0.1:55432/collex_local";
/** Same single-user tenant every local lane writes under (intake/ingest.py). */
const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";
/**
 * THE data-directory resolver (W14 B-34). Everything the lawyer owns and
 * nothing the developer owns lives under it: pid files, the stop sentinel
 * and `var/uploads` originals.
 *
 * `COLLEX_DATA_DIR` overrides it. The DEFAULT stays `<repo>/var` in this
 * wave: flipping it to `%LOCALAPPDATA%\ColleX\data` needs a migration of an
 * existing installation's uploads, and moving a lawyer's only copy of their
 * originals is not something to do as a side effect of another change. The
 * resolver is the prerequisite and it is here; the default flip and the
 * migration are one deliberate step of their own.
 *
 * `intake/quarantine.py` reads the SAME variable, so the two runtimes agree
 * about where the originals are (tests/intake/test_quarantine.py pins it).
 */
export function resolveDataDir(env = process.env, repoRoot = REPO_ROOT) {
  const configured = (env["COLLEX_DATA_DIR"] ?? "").trim();
  return configured !== "" ? path.resolve(configured) : path.join(repoRoot, "var");
}

const VAR_DIR = resolveDataDir();
const PID_FILE = path.join(VAR_DIR, "collex.pid");
const MCP_PID_FILE = path.join(VAR_DIR, "collex-mcp.pid");
/** Touched by ColleX-Durdur.cmd to ask for a graceful stop (B-34). */
const STOP_FILE = path.join(VAR_DIR, "collex.stop");
const STOP_POLL_MS = 500;
const DB_CHECK_TIMEOUT_MS = 3_000;
const MCP_PORT_SEARCH_SPAN = 20;

/**
 * Advisory-lock key for "one serve.mjs per database". Derived from the
 * database NAME (never the DSN, which can carry credentials) so two
 * processes pointed at the same product store collide and two pointed at
 * different scratch databases do not.
 */
function instanceLockKey(dbName) {
  let hash = 5381;
  for (const ch of `collex.serve:${dbName}`) {
    hash = ((hash * 33) ^ ch.codePointAt(0)) | 0;
  }
  return hash;
}

function parseArgs(argv) {
  const args = {
    port: Number(process.env["PORT"] ?? 8787),
    dsn: process.env["COLLEX_DB_URL"] ?? DEFAULT_DSN,
    withMcp: false,
    withLocalEmbeddings: false,
    mcpPort: 8898,
    localEmbeddingsPort: null,
    // W14 B-20 (L-SOURCES IR-4): where "tam metni getir" files the documents
    // it fetched. Default `<repo>/var/library`; the directory is created on
    // the first write, so an unused install leaves nothing behind.
    libraryDir: process.env["COLLEX_LIBRARY_DIR"] ?? path.join(VAR_DIR, "library"),
    // B-20 second half: publish the queued envelopes into the database once,
    // right after the HTTP server binds (same as POST /v1/library/ingest).
    ingestLibrary: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") { args.port = Number(argv[++i]); }
    else if (argv[i] === "--dsn") { args.dsn = argv[++i]; }
    else if (argv[i] === "--with-mcp") { args.withMcp = true; }
    else if (argv[i] === "--with-local-embeddings") { args.withLocalEmbeddings = true; }
    else if (argv[i] === "--mcp-port") { args.mcpPort = Number(argv[++i]); }
    else if (argv[i] === "--local-embeddings-port") { args.localEmbeddingsPort = Number(argv[++i]); }
    else if (argv[i] === "--library-dir") { args.libraryDir = argv[++i]; }
    else if (argv[i] === "--ingest-library") { args.ingestLibrary = true; }
    else { throw new Error(`unknown flag: ${argv[i]}`); }
  }
  if (typeof args.libraryDir !== "string" || args.libraryDir === "") {
    throw new Error("invalid --library-dir");
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`invalid port: ${args.port}`);
  }
  if (!Number.isInteger(args.mcpPort) || args.mcpPort < 1 || args.mcpPort > 65535) {
    throw new Error(`invalid mcp port: ${args.mcpPort}`);
  }
  if (args.withLocalEmbeddings && args.localEmbeddingsPort === null) {
    args.localEmbeddingsPort = 8899;
  }
  if (args.localEmbeddingsPort !== null &&
      (!Number.isInteger(args.localEmbeddingsPort) || args.localEmbeddingsPort < 1 ||
       args.localEmbeddingsPort > 65535 || args.localEmbeddingsPort === args.port ||
       (args.withMcp && args.localEmbeddingsPort === args.mcpPort))) {
    throw new Error("invalid or conflicting --local-embeddings-port");
  }
  return args;
}

/** Database name only — a DSN can carry credentials and is never printed. */
function dbNameOf(dsn) {
  const match = dsn.replace(/^[a-z]+:\/\//i, "").match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(bilinmiyor)";
}

/** The repo venv interpreter — never a bare `python` (CLAUDE.md). */
function venvPython() {
  const candidates = [
    path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"),
    path.join(REPO_ROOT, ".venv", "bin", "python"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`repo venv python not found under ${path.join(REPO_ROOT, ".venv")}`);
}

const log = (line) => console.log(`[collex] ${line}`);
const warn = (line) => process.stderr.write(`[collex] ${line}\n`);

// ---------------------------------------------------------------------------
// Database check (bounded)
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(label), { code: "DB_TIMEOUT" })), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 'ok'      -> reachable and legal.documents exists
 * 'missing' -> reachable but the database or its schema is absent
 * 'down'    -> no answer within DB_CHECK_TIMEOUT_MS / connection refused
 */
async function checkDatabase(sql) {
  try {
    await withTimeout(sql`select 1 as one`, DB_CHECK_TIMEOUT_MS, "select 1 timed out");
  } catch (error) {
    if (error?.code === "3D000") return { state: "missing", reason: "database" };
    return { state: "down" };
  }
  try {
    const rows = await withTimeout(
      sql`select to_regclass('legal.documents') as t`,
      DB_CHECK_TIMEOUT_MS,
      "to_regclass timed out",
    );
    return rows[0]?.t ? { state: "ok" } : { state: "missing", reason: "schema" };
  } catch {
    return { state: "down" };
  }
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Preferred MCP port, or the next free one when something stale holds it. */
async function pickMcpPort(preferred, excluded = []) {
  for (let port = preferred; port <= 65535 && port < preferred + MCP_PORT_SEARCH_SPAN; port += 1) {
    if (excluded.includes(port)) continue;
    if (!(await isPortListening(port))) return { port, stale: port !== preferred };
  }
  throw new Error(`no free MCP port in ${preferred}..${preferred + MCP_PORT_SEARCH_SPAN - 1}`);
}

// ---------------------------------------------------------------------------
// MCP child (background)
// ---------------------------------------------------------------------------

/**
 * Spawn scripts/serve-mcp.mjs with a token generated here (the port/token pair
 * is therefore known BEFORE the child is ready, so the app can be built and
 * the HTTP port bound first). `onReady` fires on the child's single ready
 * line `{"port","token","pid"}`; `onExit` when it dies.
 */
function startMcp(mcpPort, token, { onReady, onExit }) {
  const serveMcpPath = path.join(SCRIPT_DIR, "serve-mcp.mjs");
  // stdin is a PIPE we hold open on purpose: if this process is killed (on
  // Windows no exit hook runs), the pipe closes and serve-mcp.mjs shuts its
  // uvicorn child down instead of leaving it on the port (--parent-stdin).
  // The token travels in the child's ENVIRONMENT, never in argv (W12-FIX2,
  // P2-15): a command line is readable by every process on the machine.
  const child = spawn(
    process.execPath,
    [serveMcpPath, "--port", String(mcpPort), "--parent-stdin"],
    { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MCP_API_TOKEN: token } },
  );
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let buffer = "";
  let announced = false;
  child.stdout.on("data", (chunk) => {
    if (announced) return;
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    announced = true;
    try {
      const ready = JSON.parse(buffer.slice(0, newline));
      if (!Number.isInteger(ready.port) || typeof ready.token !== "string") {
        throw new Error("serve-mcp ready line missing port/token");
      }
      onReady(ready);
    } catch (error) {
      warn(`MCP geçidi hazır satırı okunamadı: ${error?.message ?? error}`);
      child.kill("SIGTERM");
    }
  });
  child.on("exit", (code) => onExit(code));
  return child;
}

async function localEmbeddingHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.local === true && body?.dimension === 384 &&
      body?.model === "intfloat/multilingual-e5-small:onnx-qint8";
  } catch {
    return false;
  }
}

async function nextLocalEmbeddingPort(preferred, excluded = []) {
  for (let port = preferred + 1; port <= 65535 && port < preferred + 20; port += 1) {
    if (excluded.includes(port)) continue;
    if (!(await isPortListening(port))) return port;
  }
  return null;
}

/**
 * Start the optional loopback E5 service without forwarding cloud secrets.
 * The app can come up while ONNX loads; retrieval falls back honestly until
 * the child is ready. The returned child is owned by serve.mjs and is killed
 * on both graceful and signal-based shutdown.
 */
function localEmbeddingEnv() {
  const passthrough = [
    "PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR",
    "TEMP", "TMP", "TMPDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "HOME", "LANG", "LC_ALL", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ];
  const env = {};
  for (const name of passthrough) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    COLLEX_NO_DOTENV: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

function startLocalEmbeddings(port, { onExit } = {}) {
  const python = venvPython();
  const child = spawn(
    python,
    ["-m", "semantic_search.local_embedding_server", "--port", String(port), "--parent-stdin", "--collex-managed"],
    { cwd: REPO_ROOT, env: localEmbeddingEnv(), stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => warn(`yerel semantik servis başlatılamadı: ${error?.message ?? error}`));
  child.on("exit", (code) => onExit?.(code));
  return child;
}

// ---------------------------------------------------------------------------
// PID files
// ---------------------------------------------------------------------------

function writePid(file, pid) {
  try {
    mkdirSync(VAR_DIR, { recursive: true });
    writeFileSync(file, `${pid}\n`, "utf8");
  } catch (error) {
    warn(`pid dosyası yazılamadı (${path.basename(file)}): ${error?.message ?? error}`);
  }
}

function removePid(file) {
  try { rmSync(file, { force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const { createDb } = await importControlPlane("src/store/db.ts");
/** Identifies OUR backends in pg_stat_activity (used by the instance lock). */
const APPLICATION_NAME = "collex-serve";
const sql = createDb({ url: args.dsn, connectTimeoutS: 3, applicationName: APPLICATION_NAME });

// W21: every launcher, stop script and interpreter path an operator line
// names is the RUNNING platform's (Mac: deploy/macos/*.sh, .venv/bin/python).
// Round two (R2-36): the database-down line and the stop hints too.
const { ensureDbCommandTr, databaseDownStartupTr, operatorHints } =
  await importControlPlane("src/platform/operatorHints.ts");
const hints = operatorHints();

// 1. Database first: a dead database is a launcher problem, say so and stop.
const db = await checkDatabase(sql);
const dbName = dbNameOf(args.dsn);
if (db.state === "down") {
  warn(databaseDownStartupTr(dbName));
  await sql.end({ timeout: 2 }).catch(() => undefined);
  process.exit(1);
}
if (db.state === "missing") {
  warn(
    db.reason === "database"
      ? `veritabanı: ${dbName} yok: ${ensureDbCommandTr()} ile oluşturun (sunucu yine de açılıyor; dosya ve cevap uçları tipli 503 döner)`
      : `veritabanı: ${dbName} var ama şema eksik (legal.documents yok): intake.cli --ensure-db ile tamamlayın (sunucu yine de açılıyor)`,
  );
}

// 1b. Single instance per database (B-34). Nothing prevented a second
// serve.mjs from attaching to the same collex_local, yet the whole rate
// limiter assumes ONE worker, and two processes writing the same answer
// store is a data-integrity question, not a performance one. A session-level
// advisory lock is exactly the right tool: it disappears when the process
// dies, so a crashed instance never leaves the product unstartable.
if (db.state !== "down") {
  const lockKey = instanceLockKey(dbNameOf(args.dsn));
  /** True when THIS session now holds the instance lock. */
  const tryLock = async () => {
    try {
      const rows = await withTimeout(
        sql`select pg_try_advisory_lock(${lockKey}::int) as ok`,
        DB_CHECK_TIMEOUT_MS,
        "advisory lock timed out",
      );
      return rows[0]?.ok === true;
    } catch {
      // A database that cannot answer this is already reported above; do not
      // turn a lock probe into a second failure mode.
      return true;
    }
  };
  /** Is another live ColleX server actually connected to this database? */
  const anotherServerConnected = async () => {
    try {
      const rows = await withTimeout(
        sql`select count(*)::int as n
            from pg_stat_activity
            where datname = current_database()
              and application_name = ${APPLICATION_NAME}
              and pid <> pg_backend_pid()`,
        DB_CHECK_TIMEOUT_MS,
        "activity probe timed out",
      );
      return Number(rows[0]?.n ?? 0) > 0;
    } catch {
      return false;
    }
  };

  // A stopped server's backend is reaped within milliseconds on a clean exit,
  // but a hard-killed process can leave it for a moment. Retrying for ~2 s
  // means "stop, then start again" works, while a genuinely running second
  // instance is still refused.
  let held = await tryLock();
  for (let attempt = 0; !held && attempt < 5; attempt += 1) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 400);
      timer.unref?.();
    });
    held = await tryLock();
  }
  // Last check before refusing: the lock could be held by something that is
  // not a ColleX server at all. Refusing to start over a foreign lock would
  // make the product unstartable for a reason the lawyer cannot act on.
  if (!held && (await anotherServerConnected())) {
    warn(
      `HATA: ${dbNameOf(args.dsn)} veritabanına başka bir ColleX sunucusu zaten bağlı.` +
        ` Aynı anda tek bir ColleX çalışabilir — önce ${hints.stop} ile kapatın.`,
    );
    await sql.end({ timeout: 2 }).catch(() => undefined);
    process.exit(1);
  }
  if (!held) {
    warn(
      "uyarı: tek-örnek kilidi alınamadı ama bağlı başka bir ColleX sunucusu görünmüyor;" +
        " açılışa devam ediliyor.",
    );
  }
}

// 2. Optional local semantic service. An already-running service is reused;
// otherwise this process owns the child and its lifecycle. The app still
// starts if the model is unavailable because the research lane has a typed
// lexical fallback.
let localEmbeddingChild = null;
let localEmbeddingState = "off";
if (args.withLocalEmbeddings) {
  localEmbeddingState = "starting";
  const portBusy = await isPortListening(args.localEmbeddingsPort);
  if (portBusy && await localEmbeddingHealthy(args.localEmbeddingsPort)) {
    localEmbeddingState = "external";
    log(`yerel model: mevcut servis kullanılıyor (127.0.0.1:${args.localEmbeddingsPort})`);
  } else if (portBusy) {
    const alternate = await nextLocalEmbeddingPort(args.localEmbeddingsPort, [args.port, args.mcpPort]);
    if (alternate === null) {
      localEmbeddingState = "down";
      warn(`yerel model portu ${args.localEmbeddingsPort} başka bir servis tarafından kullanılıyor; boş port bulunamadı, lexical fallback kullanılacak.`);
    } else {
      warn(`yerel model portu ${args.localEmbeddingsPort} dolu; bu oturum için ${alternate} kullanılacak.`);
      args.localEmbeddingsPort = alternate;
      try {
        localEmbeddingChild = startLocalEmbeddings(args.localEmbeddingsPort, {
          onExit: (code) => {
            if (localEmbeddingState !== "stopped") {
              localEmbeddingState = "down";
              warn(`yerel semantik servis kapandı (çıkış kodu ${code}); lexical fallback kullanılacak.`);
            }
          },
        });
        log(`yerel model: başlatılıyor (127.0.0.1:${args.localEmbeddingsPort})`);
      } catch (error) {
        localEmbeddingState = "down";
        warn(`yerel semantik servis başlatılamadı; lexical fallback kullanılacak (${error?.message ?? error})`);
      }
    }
  } else {
    try {
      localEmbeddingChild = startLocalEmbeddings(args.localEmbeddingsPort, {
        onExit: (code) => {
          if (localEmbeddingState !== "stopped") {
            localEmbeddingState = "down";
            warn(`yerel semantik servis kapandı (çıkış kodu ${code}); lexical fallback kullanılacak.`);
          }
        },
      });
      log(`yerel model: başlatılıyor (127.0.0.1:${args.localEmbeddingsPort})`);
    } catch (error) {
      localEmbeddingState = "down";
      warn(`yerel semantik servis başlatılamadı; lexical fallback kullanılacak (${error?.message ?? error})`);
    }
  }
}

// 2. MCP coordinates are decided BEFORE the app is built; the child starts later.
let mcp = null;
let mcpChild = null;
let mcpState = "off";
let mcpToken = null;
let mcpPort = null;
if (args.withMcp) {
  const picked = await pickMcpPort(args.mcpPort, [args.port, args.localEmbeddingsPort]);
  if (picked.stale) {
    warn(
      `uyarı: ${args.mcpPort} portunda eski bir MCP süreci (uvicorn) dinliyor —` +
        ` ${hints.stop} ile temizleyin; bu oturum için ${picked.port} portu kullanılıyor`,
    );
  }
  mcpPort = picked.port;
  mcpToken = randomBytes(24).toString("hex"); // 48 chars (>= 40 required)
  mcp = { baseUrl: `http://127.0.0.1:${mcpPort}`, token: mcpToken };
  mcpState = "starting";
}

/**
 * W14 B-45 (ENGRISK E22-adjacent): `mcpState` used to sit at 'starting'
 * forever when the child never became ready, so the console showed a
 * hopeful spinner indefinitely and the lawyer had no idea live research was
 * not coming back. After MCP_START_DEADLINE_MS the state falls to 'down',
 * which the console already renders with an actionable line.
 */
const MCP_START_DEADLINE_MS = 60_000;

const { createStoreRetrievalPort, createStoreTextPort, createStoreVersionFactsPort } =
  await importControlPlane("src/pipeline/storeAdapters.ts");
const { AnswerPipeline } = await importControlPlane("src/pipeline/answerPipeline.ts");
const { createApp } = await importControlPlane("src/api/server.ts");
const { localEmbeddingResolution } = await importControlPlane("src/retrieval/localEmbeddingConfig.ts");
const { checkDatabase: describeDatabase, describeDatabaseHealth, checkAnalysisSchema } =
  await importControlPlane("src/store/health.ts");
const { PgAnswerStore } = await importControlPlane("src/store/answerStore.ts");
const { PgDraftStore } = await importControlPlane("src/store/draftStore.ts");
const { PgMatterStore } = await importControlPlane("src/matters/store.ts");
const { PgSettingsStore } = await importControlPlane("src/settings/store.ts");
const { resolveAiConfig, createAiPorts } = await importControlPlane("src/ai/config.ts");
const backupRunner = await importControlPlane("src/backup/runner.ts");
const { PgAiLedger } = await importControlPlane("src/ai/ledger.ts");
const { FileLocalLibrary } = await importControlPlane("src/sources/localLibrary.ts");
const { resolveModelRoutes, localModelLabel } = await importControlPlane("src/llm/providerFactory.ts");
const { resolveEffectiveAiPolicy, policyAllowsModelTasks } = await importControlPlane("src/llm/aiPolicy.ts");
const { createOcrStatusProbe } = await importControlPlane("src/ocr/ocrStatus.ts");
const { resolveStageConfig } = await importControlPlane("src/exhaustive/stageTypes.ts");
const { PgDurableAnalysisStore } = await importControlPlane("src/exhaustive/durableStore.ts");
const { AnalysisWorker } = await importControlPlane("src/exhaustive/worker.ts");
const { createEmbeddingPort } = await importControlPlane("src/retrieval/semanticRerank.ts");
const { PgChunkVectorStore, LOCAL_E5_PROFILE } = await importControlPlane("src/embeddings/chunkVectorStore.ts");
const { EmbeddingWorker } = await importControlPlane("src/embeddings/embeddingWorker.ts");
const { ExactCosineDenseLane } = await importControlPlane("src/embeddings/denseLane.ts");
const { PgReviewTableStore } = await importControlPlane("src/reviewTables/store.ts");
const { ReviewTableWorker } = await importControlPlane("src/reviewTables/worker.ts");
const { serve } = await import("@hono/node-server");

/** Launcher-side view of the MCP child, for /v1/health + /v1/research/health. */
const getMcpState = () => mcpState;

// W12: durable stores only when the schema is there; otherwise in-memory and
// an honest line. `describeDatabase` (lane A) adds the migration ledger view.
const persistent = db.state === "ok";
const answerStore = persistent ? new PgAnswerStore({ sql }) : null;
const draftStore = persistent ? new PgDraftStore({ sql }) : null;
const matterStore = persistent ? new PgMatterStore({ sql }) : null;
const settingsStore = persistent ? new PgSettingsStore({ sql }) : null;
const dbHealthLine = persistent
  ? describeDatabaseHealth(await describeDatabase(sql, { timeoutMs: DB_CHECK_TIMEOUT_MS }))
  : "şema eksik — cevap, taslak, dosya ve ayar kayıtları BELLEK İÇİ tutuluyor (yeniden başlatmada silinir)";

// W12: cloud AI is OFF unless ANTHROPIC_API_KEY is set; the key itself is
// never logged (AiConfig keeps it out of every serialization path).
const aiConfig = resolveAiConfig(process.env);
// W21: ONE application AI policy (COLLEX_AI_POLICY = LOCAL_ONLY |
// LOCAL_PREFERRED (default; AUTO is the same) | CLOUD_ALLOWED |
// DETERMINISTIC_ONLY), resolved ONCE here and combined with
// COLLEX_DATA_BOUNDARY — the stricter wins. The same object reaches every
// consumer below: the answer pipeline (who drafts), the model route table
// (which endpoint may fill which role), the analysis worker (model tasks)
// and createApp (health, /v1/ai/*, embeddings).
const aiPolicy = resolveEffectiveAiPolicy(process.env);
// W20: the data boundary is read ONCE here and handed to every consumer.
// Under LOCAL_ONLY the answer pipeline refuses `useCloudAi` before any
// cloud port is touched and /v1/ai/* refuses every POST. W21: this is the
// EFFECTIVE boundary (the policy can only narrow it).
const dataBoundary = aiPolicy.boundary;
const cloud = aiConfig !== null
  ? (({ drafter, entailment, label }) => ({ drafter, entailment, label }))(createAiPorts(aiConfig))
  : undefined;

/**
 * B-03: the console's "Yedek al" button. The root is `~/ColleX-Yedek`, the
 * same place `ColleX-Yedekle.cmd` writes, so a backup taken from the UI and
 * one taken by double-clicking the script land in the same list and
 * `/v1/health.backup` reports whichever is newest.
 *
 * Only mounted for the real product database: a backup button on a demo or
 * probe database would produce a folder the lawyer might later restore over
 * their actual data.
 */
const backupRoot = path.join(
  process.env["COLLEX_BACKUP_DIR"]?.trim() ||
    path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? REPO_ROOT, "ColleX-Yedek"),
);
const backupPort = {
  run: () =>
    backupRunner.runBackup({
      database: dbName,
      port: Number(new URL(args.dsn.replace(/^postgres(ql)?:/, "http:")).port || 55432),
      uploadsDir: path.join(VAR_DIR, "uploads"),
      backupRoot,
      ...(process.env["COLLEX_PGBIN"] ? { pgBin: process.env["COLLEX_PGBIN"] } : {}),
    }),
  last: () => backupRunner.readLastBackup(backupRoot),
};

// W20: ONE place resolves the local model roles (answer, verifier, matter
// extraction, matter synthesis). A refused or absent endpoint leaves every
// role empty; nothing falls back to the cloud.
const modelRoutes = resolveModelRoutes(process.env, { policy: aiPolicy });
const localPorts =
  modelRoutes.roles.answer !== undefined && modelRoutes.roles.verifier !== undefined
    ? {
        drafter: modelRoutes.roles.answer,
        entailment: modelRoutes.roles.verifier,
        label: localModelLabel(modelRoutes.roles.answer),
        trust: modelRoutes.trust,
      }
    : undefined;
// W21: a configured endpoint the table REFUSED builds no port, but a
// `useLocalAi` answer must still say WHY no local model wrote it ("outside
// this computer, the policy refused it" / "the address failed the trust
// rules") — the same reason health and the matter capabilities give — and
// never "no local model is configured". Only the facts travel, never an
// adapter, so nothing becomes callable.
const localRefusal =
  localPorts === undefined && modelRoutes.status === "refused" && modelRoutes.policy !== "DETERMINISTIC_ONLY"
    ? { trust: modelRoutes.trust }
    : undefined;

// W20: the durable exhaustive-analysis worker. Only on the real schema: a
// census that could not survive a restart would be the W19 bug again. A
// hard kill (taskkill /F) needs no cleanup here — the next start recovers
// the expired leases and continues at the next unfinished unit.
// The W20 tables must exist before a worker polls them: ColleX-Baslat.cmd
// runs `intake.cli --ensure-db` first, but a server started by hand against
// an older schema must not spin on missing relations every second. Health
// already names the missing migrations; the workers simply stay off.
const w20Schema = persistent
  ? await sql`select to_regclass('app_private.matter_intel_items') is not null
                 and to_regclass('app_private.chunk_vectors') is not null
                 and to_regclass('app_private.review_table_cells') is not null as ok`
      .then((rows) => rows[0]?.ok === true)
      .catch(() => false)
  : false;
if (persistent && !w20Schema) {
  console.log("uyarı: dosya incelemesi ve inceleme tablosu için veritabanı şeması eksik —"
    + " intake.cli --ensure-db ile tamamlayın; arka plan işleri kapalı.");
}
// W21 round two (R2-20): the gate above is the W20 one, and the W21 worker
// needs MORE — matter_analysis_tasks, the run coverage columns and the unit
// extraction accounting (20260913090000_analysis_stages.sql). On a W20-only
// schema it used to start anyway, fail every tick on a missing relation and
// leave every run queued while POST /analysis answered 500. This gate probes
// every object the worker uses (health.ts ANALYSIS_WORKER_MIGRATIONS); when
// any is missing, the analysis worker and its routes stay off and say why.
const analysisSchema = w20Schema
  ? await checkAnalysisSchema(sql).catch(() => ({ ready: false, missing: ["(şema denetlenemedi)"] }))
  : { ready: false, missing: [] };
const analysisSchemaReady = analysisSchema.ready;
if (w20Schema && !analysisSchemaReady) {
  console.log("uyarı: dosya incelemesi (analiz aşamaları) için veritabanı şeması eksik —"
    + ` ${ensureDbCommandTr()} ile tamamlayın; dosya incelemesi işi kapalı`
    + ` (eksik: ${analysisSchema.missing.join(", ")}).`);
}
// The review grid reads document versions through the same store class; it
// needs only the W20 tables, so it keeps its own (W20) gate.
const documentStore = w20Schema ? new PgDurableAnalysisStore(sql) : null;
const analysisStore = analysisSchemaReady ? documentStore : null;
const analysisWorker =
  analysisStore !== null
    ? new AnalysisWorker({
        store: analysisStore,
        // W21: batch sizes and hierarchical limits (COLLEX_ANALYSIS_*).
        stageConfig: resolveStageConfig(process.env),
        // W21: the local E5 embedder, when --with-local-embeddings runs, adds
        // the cosine signal to claim/evidence candidate discovery. Read
        // lazily: it is resolved further down this file.
        embedder: () => denseEmbedder ?? undefined,
        // W21: matter analysis has no per-request consent; the policy (and
        // the on-machine rule) decides whether model tasks may run at all.
        models: () => {
          const routes = {
            extraction: modelRoutes.roles.matterExtraction,
            synthesis: modelRoutes.roles.matterSynthesis,
          };
          return policyAllowsModelTasks(aiPolicy.policy, routes) ? routes : {};
        },
        // Structured events only; never document text.
        log: (event) => {
          if (event.event !== "unit-done") console.log(`analiz: ${JSON.stringify(event)}`);
        },
      })
    : null;

// W20 phase E: a REAL dense lane for private uploads when the local
// embedding server runs (--with-local-embeddings) on the real schema. It
// embeds through the SAME local E5 server the related-search reranker
// uses; the worker consumes the `embedding` jobs ingestion has always
// queued and backfills anything missing. Without the flag the lane stays
// the NoopDenseLane and health says DISABLED.
const denseEmbedding =
  persistent && args.localEmbeddingsPort !== null
    ? localEmbeddingResolution(args.localEmbeddingsPort)
    : null;
const denseEmbedder =
  denseEmbedding !== null && denseEmbedding.enabled ? createEmbeddingPort(denseEmbedding.config) : null;
const vectorStore = denseEmbedder !== null && w20Schema ? new PgChunkVectorStore(sql) : null;
const denseLane =
  vectorStore !== null
    ? new ExactCosineDenseLane({ store: vectorStore, embedder: denseEmbedder, profile: LOCAL_E5_PROFILE })
    : null;
const embeddingWorker =
  vectorStore !== null
    ? new EmbeddingWorker({ store: vectorStore, embedder: denseEmbedder, profile: LOCAL_E5_PROFILE })
    : null;

// The ONE answer pipeline: served by /v1/answer and used by the review
// grid's worker, so a grid cell is answered exactly as a question is.
const answerPipeline = new AnswerPipeline({
    retrieval: createStoreRetrievalPort(sql, denseLane !== null ? { denseLane } : {}),
    texts: createStoreTextPort(sql),
    versionFacts: createStoreVersionFactsPort(sql),
    producer: "collex control-plane (scripts/serve.mjs)",
    ...(cloud !== undefined ? { cloud } : {}),
    ...(localPorts !== undefined ? { local: localPorts } : {}),
    ...(localRefusal !== undefined ? { localRefusal } : {}),
    dataBoundary: () => dataBoundary,
    // W21: with the policy wired, a configured local model drafts by
    // default (no browser flag); useCloudAi stays per-request consent.
    aiPolicy: () => aiPolicy,
});

// W20: the persisted review grid's worker (real schema only).
const reviewStore = w20Schema ? new PgReviewTableStore(sql) : null;
const reviewWorker =
  reviewStore !== null && documentStore !== null
    ? new ReviewTableWorker({ store: reviewStore, answer: answerPipeline, documents: documentStore })
    : null;

// W21: the local OCR capability, probed ONCE per process (Python start-up +
// tesseract --list-langs) and started now so the first health poll has it.
const ocrProbe = createOcrStatusProbe({ repoRoot: REPO_ROOT });
void ocrProbe.get();

const app = createApp({
  answerPipeline,
  filesDsn: args.dsn,
  python: { path: venvPython(), repoRoot: REPO_ROOT },
  // W14 L-VERIFY V-4: the ONE originals directory. `VAR_DIR` is already the
  // COLLEX_DATA_DIR-aware value that intake writes to and `backupPort` reads
  // from; before this line the files router and the matter packager fell back
  // to `<repo>/var/uploads`, so "Aslını indir" answered 404 for every lawyer
  // who moved their data (which the backup card tells them to do).
  uploadsDir: path.join(VAR_DIR, "uploads"),
  ...(mcp !== null ? { mcp } : {}),
  mcpState: getMcpState,
  sql,
  dbName,
  modelRoutes,
  aiPolicy: () => aiPolicy,
  ocrStatus: () => ocrProbe.get(),
  ...(reviewStore !== null && reviewWorker !== null
    ? { reviewTables: { store: reviewStore, worker: reviewWorker } }
    : {}),
  ...(denseLane !== null ? { denseHealth: async () => ({ ...(await denseLane.health()), worker: embeddingWorker?.status() ?? null }) } : {}),
  ...(analysisStore !== null && analysisWorker !== null
    ? { exhaustive: { store: analysisStore, worker: analysisWorker } }
    : {}),
  demoCorpus: dbName === "collex_demo",
  ai: aiConfig,
  ...(answerStore !== null ? { answerStore } : {}),
  ...(draftStore !== null ? { draftStore } : {}),
  ...(matterStore !== null ? { matterStore } : {}),
  ...(settingsStore !== null ? { settingsStore } : {}),
  ...(persistent ? { backup: backupPort } : {}),
  // B-23: the cloud-AI audit ledger + ceiling. Durable when the schema is
  // there; the router falls back to a bounded in-memory ledger otherwise, so
  // the ceiling applies either way.
  ...(persistent ? { aiLedger: new PgAiLedger({ sql, tenantId: LOCAL_TENANT_ID }) } : {}),
  // B-20 (L-SOURCES IR-4): the local library behind "tam metni getir".
  // Passed unconditionally — the store creates its directory on the first
  // successful fetch, and a write failure is reported in the card's
  // `library.action`, never as a failed research run.
  sourcesLibrary: new FileLocalLibrary(args.libraryDir),
  // B-20 second half: /v1/library/status + POST /v1/library/ingest, which
  // spawns `python -m ingestion.library --dsn <dsn> --dir <libraryDir> --json`.
  libraryDir: args.libraryDir,
  ...(args.localEmbeddingsPort !== null
    ? { sourcesEmbedding: localEmbeddingResolution(args.localEmbeddingsPort) }
    : {}),
});

analysisWorker?.start();
embeddingWorker?.start();
reviewWorker?.start();

let shuttingDown = false;
let server = null;
/** Graceful-stop watcher handle; assigned below, cleared by shutdown(). */
let stopWatcher = null;

const killMcp = () => {
  if (mcpChild !== null && mcpChild.exitCode === null) {
    mcpChild.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (mcpChild.exitCode === null) mcpChild.kill("SIGKILL");
    }, 5000);
    killTimer.unref?.();
  }
};

const killLocalEmbeddings = () => {
  if (localEmbeddingChild !== null && localEmbeddingChild.exitCode === null) {
    localEmbeddingState = "stopped";
    localEmbeddingChild.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (localEmbeddingChild.exitCode === null) localEmbeddingChild.kill("SIGKILL");
    }, 5000);
    killTimer.unref?.();
  }
};

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (stopWatcher !== null) clearInterval(stopWatcher);
  killMcp();
  killLocalEmbeddings();
  removePid(PID_FILE);
  removePid(MCP_PID_FILE);
  // Background persists (PgAnswerStore/PgDraftStore put) land before the
  // pool closes; a hard kill cannot run this — see W12-A §7.
  const finish = async () => {
    try {
      await analysisWorker?.stop();
      await embeddingWorker?.stop();
      await reviewWorker?.stop();
      await answerStore?.flush?.();
      await draftStore?.flush?.();
    } catch {
      // flush never rejects; belt and braces.
    }
    sql.end({ timeout: 5 }).finally(() => process.exit(0));
  };
  if (server !== null) server.close(() => { void finish(); });
  else void finish();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// B-34 / ENGRISK E10: Windows has no SIGTERM. `taskkill /F` terminates the
// process outright, so none of the code above had ever run in production —
// the documented flush() path was unreachable and `var/collex.pid` survived
// every stop (RISKS #22 observed the symptom without the cause). A file the
// stopper can touch is the simplest channel that works on Windows: no port,
// no second listener, nothing a foreign page can reach.
try { rmSync(STOP_FILE, { force: true }); } catch { /* best effort */ }
stopWatcher = setInterval(() => {
  if (shuttingDown) return;
  if (!existsSync(STOP_FILE)) return;
  try { rmSync(STOP_FILE, { force: true }); } catch { /* best effort */ }
  log("durdurma isteği alındı (collex.stop) — kayıtlar yazılıyor ve kapanılıyor…");
  shutdown();
}, STOP_POLL_MS);
stopWatcher.unref?.();
process.on("exit", () => {
  if (mcpChild !== null && mcpChild.exitCode === null) mcpChild.kill("SIGKILL");
  if (localEmbeddingChild !== null && localEmbeddingChild.exitCode === null) localEmbeddingChild.kill("SIGKILL");
  removePid(PID_FILE);
  removePid(MCP_PID_FILE);
});

// 3. HTTP binds FIRST; the MCP child follows in the background.
server = serve(
  { fetch: app.fetch, port: args.port, hostname: "127.0.0.1" },
  (info) => {
    writePid(PID_FILE, process.pid);
    log(`konsol : http://127.0.0.1:${info.port}/`);
    log(`health : http://127.0.0.1:${info.port}/v1/health`);
    log(`korpus : ${dbName} (yerel Postgres, durum: ${db.state === "ok" ? "hazır" : "ŞEMA EKSİK"})`);
    log(`db     : ${dbHealthLine}`);
    log(`kayıt  : ${persistent ? "kalıcı (app_private.answers/drafts/matters/settings)" : "bellek içi"}`);
    log(
      aiConfig !== null
        ? aiPolicy.policy === "DETERMINISTIC_ONLY" || aiPolicy.boundary === "LOCAL_ONLY"
          ? `ai     : anahtar tanımlı ama yapay zekâ ilkesi bulutu kapatıyor (${aiPolicy.policy}, veri sınırı ${aiPolicy.boundary}); dışarıya metin gitmez`
          : `ai     : açık (${aiConfig.model}; istek başına onay gerekir, canlı sınanmadı)`
        : "ai     : kapalı (ANTHROPIC_API_KEY yok)",
    );
    log(
      `ilke   : ${aiPolicy.policy}` +
        (aiPolicy.policy !== aiPolicy.configuredPolicy ? ` (ayar: ${aiPolicy.configuredPolicy})` : "") +
        ` · veri sınırı ${aiPolicy.boundary} · yerel model: ` +
        (modelRoutes.status === "configured"
          ? modelRoutes.models.answer
          : modelRoutes.status === "refused"
            ? "reddedildi"
            : "yok"),
    );
    for (const note of aiPolicy.warnings) log(`ilke   : ${note}`);
    log(
      mcp !== null
        ? `mcp    : başlatılıyor (${mcp.baseUrl}); hazır olana kadar /v1/research tipli 502 döner`
        : "mcp    : kapalı (/v1/research tipli 502 döner; --with-mcp ile açılır)",
    );
    log(
      args.withLocalEmbeddings
        ? `model  : ${localEmbeddingState} (yerel E5; hazır değilse lexical fallback)`
        : "model  : kapalı (yerel E5 için --with-local-embeddings)",
    );
    log(`repo   : ${REPO_ROOT}`);
    log(`veri   : ${VAR_DIR}${process.env["COLLEX_DATA_DIR"] ? " (COLLEX_DATA_DIR)" : ""}`);
    log(`pid    : ${process.pid} (${PID_FILE})`);

    if (args.ingestLibrary) {
      // Goes through the mounted route (loopback Host, no Origin, so the
      // B-04 guard admits it) rather than a second code path.
      fetch(`http://127.0.0.1:${info.port}/v1/library/ingest`, { method: "POST" })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (res.ok && body !== null) {
            log(`kütüphane: yayımlanan=${body.published} atlanan=${body.skipped} hatalı=${body.failed} (kuyruk: ${args.libraryDir})`);
          } else {
            warn(`kütüphane: yayım yapılamadı (${body?.error?.kind ?? res.status}); kuyruk yerinde duruyor`);
          }
        })
        .catch((error) => warn(`kütüphane: yayım isteği gönderilemedi (${error?.name ?? "hata"})`));
    }

    if (args.withMcp) {
      const startDeadline = setTimeout(() => {
        if (mcpState === "starting" && !shuttingDown) {
          mcpState = "down";
          warn(
            `MCP geçidi ${MCP_START_DEADLINE_MS / 1000} saniyede hazır olmadı;` +
              " canlı araştırma kapalı (/v1/research tipli 502 döner)." +
              " Canlı araştırma için sunucuyu yeniden başlatın.",
          );
        }
      }, MCP_START_DEADLINE_MS);
      startDeadline.unref?.();
      mcpChild = startMcp(mcpPort, mcpToken, {
        onReady: (ready) => {
          clearTimeout(startDeadline);
          mcpState = "ok";
          writePid(MCP_PID_FILE, Number.isInteger(ready.pid) ? ready.pid : mcpChild.pid);
          log(`mcp    : açık (${mcp.baseUrl}, canlı /v1/research; uvicorn pid ${ready.pid ?? "?"})`);
        },
        onExit: (code) => {
          clearTimeout(startDeadline);
          if (shuttingDown) return;
          mcpState = "down";
          removePid(MCP_PID_FILE);
          warn(
            `MCP geçidi kapandı (çıkış kodu ${code}); /v1/research tipli 502 döner.` +
              " Dosya, cevap ve taslak uçları çalışmaya devam ediyor; canlı araştırma için sunucuyu yeniden başlatın.",
          );
        },
      });
    }
  },
);

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    warn(
      `HATA: ${args.port} portu kullanımda — ColleX zaten çalışıyor olabilir` +
        ` (http://127.0.0.1:${args.port}/) ya da ${hints.stop} ile eski süreci kapatın.`,
    );
  } else {
    warn(`HATA: HTTP sunucusu açılamadı (${error?.code ?? error?.message ?? error})`);
  }
  shuttingDown = true;
  killMcp();
  killLocalEmbeddings();
  removePid(PID_FILE);
  sql.end({ timeout: 2 }).finally(() => process.exit(1));
});

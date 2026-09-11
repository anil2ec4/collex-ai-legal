"""Local scratch-Postgres verification for supabase/ migrations and seed.

Fully local/offline: connects ONLY to the local scratch PostgreSQL
(127.0.0.1:55432, user postgres, no password), never to any remote or
Supabase-hosted database, and never uses any Supabase MCP tooling.

What it does:
  a) drop + recreate scratch database ``collex_mig_test``;
  b) apply every migration that does NOT carry the "[REQUIRES PGVECTOR]"
     header marker, in filename order, via psql with ON_ERROR_STOP=1;
  c) run invariant checks (Unicode code-point offsets with Turkish I/i
     variants, snapshot dedupe, version uniqueness, CHECK rejections,
     job claim + FOR UPDATE SKIP LOCKED concurrency smoke, RLS tenant
     isolation via a non-superuser probe role including the
     document_versions / chunks / document_relations content tables,
     system_period upper_inf semantics + one-open-version, effective_period
     overlap rejection, job attempt cap / fail_job backoff / lease reaper,
     the non-overlapping-chunk decision, and — W12-A — the matters /
     answers / drafts / settings persistence tables with their RLS, the
     migration's idempotent re-apply and the migration-ledger bootstrap);
  d) apply supabase/seed.sql and verify chunk/version hash + offset
     invariants inside Postgres;
  e) syntax-validate the [REQUIRES PGVECTOR] migrations offline with
     pglast (parse only -- they are NEVER executed locally);
  f) print a PASS/FAIL summary and exit nonzero on any failure.

Migration classification is by the pgvector marker that opens each
dependent file's header comment, NOT by a filename-timestamp boundary. The
old boundary rule silently demoted every migration sorting after
20260826080000 -- including 20260826100000_version_transitions.sql and
20260826110000_turkish_fts.sql, which need no pgvector at all -- to
parse-only validation, so the close-on-append trigger they define was
never actually executed by this script.

Dependencies (installed into the repo venv with
``uv pip install --python .venv/Scripts/python.exe "psycopg[binary]" pglast``):
psycopg 3 is used for programmatic checks; migration files themselves are
applied through the real ``psql`` binary (piped via stdin so Windows psql
never has to open a path containing non-ASCII characters).

Run:
    .venv/Scripts/python.exe scripts/db_local_check.py
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import traceback
import uuid
from pathlib import Path

import psycopg
from psycopg import errors

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.migrations import (  # noqa: E402 - after sys.path bootstrap
    LEDGER_TABLE,
    apply_missing_migrations,
    ledger_state,
    pgvector_migrations,
    runnable_migrations,
)

HOST = os.environ.get("COLLEX_DB_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLEX_DB_PORT", "55432"))
USER = os.environ.get("COLLEX_DB_USER", "postgres")
DBNAME = "collex_mig_test"
RLS_ROLE = "collex_rls_probe"

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"
# Classification (runnable vs. pgvector-only) lives in ingestion.migrations
# so this script, ingestion.cli and tests/ingestion cannot drift apart.

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    line = f"[{status}] {name}"
    if detail:
        line += f" -- {detail}"
    print(line)


def run_check(name: str, fn) -> None:
    try:
        detail = fn()
        record(name, True, detail or "")
    except Exception as exc:  # noqa: BLE001 - report, do not crash the suite
        record(name, False, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()


def connect(dbname: str, autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(
        host=HOST, port=PORT, user=USER, dbname=dbname, autocommit=autocommit
    )


def psql_apply(sql_path: Path) -> None:
    """Apply a SQL file through psql (stdin pipe, ON_ERROR_STOP)."""
    cmd = [
        "psql",
        "-h", HOST,
        "-p", str(PORT),
        "-U", USER,
        "-d", DBNAME,
        "-v", "ON_ERROR_STOP=1",
        "-X", "-q",
        "-f", "-",
    ]
    env = dict(os.environ)
    env["PGCLIENTENCODING"] = "UTF8"
    proc = subprocess.run(
        cmd, input=sql_path.read_bytes(), capture_output=True, env=env,
        timeout=120,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"psql failed for {sql_path.name}: {stderr}")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# (a) drop + recreate scratch database and probe role
# --------------------------------------------------------------------------

def recreate_database() -> str:
    with connect("postgres", autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")
        # Role dependencies lived in the dropped DB, so drop succeeds now.
        admin.execute(f"drop role if exists {RLS_ROLE}")
        admin.execute(f"create role {RLS_ROLE} nologin")
        # template0 + UTF8 + C locale: deterministic character semantics for
        # the code-point offset invariants regardless of cluster defaults.
        admin.execute(
            f"create database {DBNAME} template template0 "
            "encoding 'UTF8' locale 'C'"
        )
    return f"database {DBNAME} recreated (UTF8/C), role {RLS_ROLE} reset"


# --------------------------------------------------------------------------
# (b) migrations
# --------------------------------------------------------------------------

def apply_migrations() -> str:
    applied = []
    for path in runnable_migrations():
        psql_apply(path)
        applied.append(path.name)
    return f"applied {len(applied)}: {', '.join(applied)}"


# --------------------------------------------------------------------------
# (c) invariants
# --------------------------------------------------------------------------

# Turkish text with dotted/dotless I variants and an astral (non-BMP) char:
# every one of these is a single Unicode code point (= one PostgreSQL
# character under UTF-8, = one Python str index), but 2-4 UTF-8 bytes.
TR_TEXT = (
    "İdari Yargılama Usulü Kanunu uyarınca İDARİ işlemler; ılık bir ırmağın "
    "kıyısındaki İstanbul'da 𝔘nicode sınırları İNCELENİR. Ek: ĞÜŞİÖÇı sonu."
)


def _insert_doc_version(conn, *, source: str, external_id: str,
                        canonical: str, scope: str = "public",
                        tenant_id=None) -> tuple[str, str, str]:
    doc_id = str(uuid.uuid4())
    snap_id = str(uuid.uuid4())
    ver_id = str(uuid.uuid4())
    conn.execute(
        "insert into legal.documents"
        " (id, scope, tenant_id, source, external_id, document_type)"
        " values (%s, %s, %s, %s, %s, 'kanun')",
        (doc_id, scope, tenant_id, source, external_id),
    )
    conn.execute(
        "insert into legal.source_snapshots"
        " (id, source, external_id, retrieved_at, raw_sha256)"
        " values (%s, %s, %s, now(), %s)",
        (snap_id, source, external_id, sha256_hex(canonical)),
    )
    conn.execute(
        "insert into legal.document_versions"
        " (id, document_id, source_snapshot_id, status, canonical_text,"
        "  normalized_text, content_sha256)"
        " values (%s, %s, %s, 'published', %s, %s, %s)",
        (ver_id, doc_id, snap_id, canonical, canonical.lower(),
         sha256_hex(canonical)),
    )
    return doc_id, snap_id, ver_id


def check_offset_invariant() -> str:
    """original_text == substring(canonical, start+1, len) == Python slice."""
    with connect(DBNAME) as conn:
        _doc, _snap, ver_id = _insert_doc_version(
            conn, source="invariant-test", external_id="offsets-1",
            canonical=TR_TEXT,
        )
        # Slice deliberately positioned AFTER multi-byte chars so that a
        # byte-offset implementation would produce a different result.
        start = TR_TEXT.index("İDARİ")
        end = TR_TEXT.index("𝔘nicode") + len("𝔘nicode")
        chunk_text = TR_TEXT[start:end]
        chunk_id = str(uuid.uuid4())
        conn.execute(
            "insert into legal.chunks"
            " (id, document_version_id, ordinal, start_char, end_char,"
            "  original_text, search_text, content_sha256)"
            " values (%s, %s, 0, %s, %s, %s, %s, %s)",
            (chunk_id, ver_id, start, end, chunk_text, chunk_text.lower(),
             sha256_hex(chunk_text)),
        )
        row = conn.execute(
            "select"
            "  substring(v.canonical_text from c.start_char + 1"
            "            for c.end_char - c.start_char) as sub,"
            "  c.original_text = substring(v.canonical_text"
            "            from c.start_char + 1"
            "            for c.end_char - c.start_char) as offsets_ok,"
            "  char_length(v.canonical_text) as n_chars,"
            "  octet_length(v.canonical_text) as n_bytes,"
            "  encode(sha256(convert_to(c.original_text, 'UTF8')), 'hex')"
            "    = c.content_sha256 as hash_ok"
            " from legal.chunks c"
            " join legal.document_versions v on v.id = c.document_version_id"
            " where c.id = %s",
            (chunk_id,),
        ).fetchone()
        sub, offsets_ok, n_chars, n_bytes, hash_ok = row
        assert sub == chunk_text, "PG substring != Python slice"
        assert offsets_ok, "original_text != substring(canonical_text ...)"
        # PostgreSQL characters == Unicode code points == Python str length.
        assert n_chars == len(TR_TEXT), (
            f"char_length {n_chars} != Python len {len(TR_TEXT)}"
        )
        assert n_bytes > n_chars, "expected multi-byte UTF-8 content"
        assert hash_ok, "sha256(original_text) mismatch inside PG"
        conn.commit()
        return (
            f"code-point offsets verified (chars={n_chars}, bytes={n_bytes},"
            f" slice [{start}:{end}] across dotted-I and astral chars)"
        )


def check_snapshot_dedupe() -> str:
    with connect(DBNAME) as conn:
        raw_hash = sha256_hex("same raw payload")
        conn.execute(
            "insert into legal.source_snapshots"
            " (source, external_id, retrieved_at, raw_sha256)"
            " values ('dedupe-test', 'snap-1', now(), %s)",
            (raw_hash,),
        )
        conn.commit()
        try:
            conn.execute(
                "insert into legal.source_snapshots"
                " (source, external_id, retrieved_at, raw_sha256)"
                " values ('dedupe-test', 'snap-1', now(), %s)",
                (raw_hash,),
            )
        except errors.UniqueViolation:
            conn.rollback()
            return "duplicate (source, external_id, raw_sha256) rejected"
        raise AssertionError("duplicate snapshot was NOT rejected")


def check_version_unique() -> str:
    with connect(DBNAME) as conn:
        doc_id, snap_id, _ver = _insert_doc_version(
            conn, source="invariant-test", external_id="version-uq-1",
            canonical="Aynı içerik.",
        )
        conn.commit()
        try:
            conn.execute(
                "insert into legal.document_versions"
                " (document_id, source_snapshot_id, status, canonical_text,"
                "  normalized_text, content_sha256)"
                " values (%s, %s, 'parsed', %s, %s, %s)",
                (doc_id, snap_id, "Aynı içerik.", "aynı içerik.",
                 sha256_hex("Aynı içerik.")),
            )
        except errors.UniqueViolation:
            conn.rollback()
            return "duplicate (document_id, content_sha256) rejected"
        raise AssertionError("duplicate document version was NOT rejected")


def _expect_check_violation(conn, label: str, sql: str, params) -> None:
    try:
        conn.execute(sql, params)
    except errors.CheckViolation:
        conn.rollback()
        return
    raise AssertionError(f"{label}: CHECK constraint did NOT reject the row")


def check_constraint_rejections() -> str:
    with connect(DBNAME) as conn:
        _expect_check_violation(
            conn, "public doc with tenant_id",
            "insert into legal.documents"
            " (scope, tenant_id, source, external_id, document_type)"
            " values ('public', %s, 'check-test', 'c1', 'kanun')",
            (str(uuid.uuid4()),),
        )
        _expect_check_violation(
            conn, "tenant doc without tenant_id",
            "insert into legal.documents"
            " (scope, tenant_id, source, external_id, document_type)"
            " values ('tenant', null, 'check-test', 'c2', 'kanun')",
            (),
        )
        _expect_check_violation(
            conn, "bad raw_sha256 length",
            "insert into legal.source_snapshots"
            " (source, external_id, retrieved_at, raw_sha256)"
            " values ('check-test', 'c3', now(), 'abc123')",
            (),
        )
        # end_char <= start_char must be impossible.
        _doc, _snap, ver_id = _insert_doc_version(
            conn, source="invariant-test", external_id="check-chunk-1",
            canonical="kısa metin",
        )
        _expect_check_violation(
            conn, "chunk with end_char <= start_char",
            "insert into legal.chunks"
            " (document_version_id, ordinal, start_char, end_char,"
            "  original_text, search_text, content_sha256)"
            " values (%s, 0, 5, 5, 'x', 'x', %s)",
            (ver_id, sha256_hex("x")),
        )
        return "4 CHECK-constraint rejections verified"


def check_fts_and_trgm() -> str:
    with connect(DBNAME) as conn:
        idx = conn.execute(
            "select count(*) from pg_indexes"
            " where schemaname = 'legal'"
            "   and indexname in ('chunks_fts_gin', 'chunks_search_trgm')"
        ).fetchone()[0]
        assert idx == 2, f"expected 2 chunk indexes, found {idx}"
        row = conn.execute(
            "select"
            "  bool_or(search_tsv @@"
            "          websearch_to_tsquery('simple', 'işlemler')),"
            "  max(extensions.similarity(search_text, 'işlemler'))"
            " from legal.chunks"
        ).fetchone()
        assert row[0] is True, "generated search_tsv did not match FTS query"
        assert row[1] and row[1] > 0, "extensions.similarity returned nothing"
        return (
            "generated tsvector matches FTS; schema-qualified pg_trgm works"
            f" (similarity={row[1]:.2f})"
        )


def check_job_claim() -> str:
    with connect(DBNAME) as conn:
        for key in ("k1", "k2", "k3"):
            conn.execute(
                "insert into app_private.jobs (queue, idempotency_key, payload)"
                " values ('q_claim', %s, '{}'::jsonb)",
                (key,),
            )
        conn.commit()

        first = conn.execute(
            "select id, status, attempts, locked_by"
            " from app_private.claim_jobs('q_claim', 2, 'worker-a')"
        ).fetchall()
        conn.commit()
        assert len(first) == 2, f"expected 2 claimed jobs, got {len(first)}"
        assert all(r[1] == "running" and r[2] == 1 and r[3] == "worker-a"
                   for r in first), f"bad claimed rows: {first}"

        second = conn.execute(
            "select id from app_private.claim_jobs('q_claim', 2, 'worker-b')"
        ).fetchall()
        conn.commit()
        assert len(second) == 1, f"expected 1 remaining job, got {len(second)}"
        claimed_first = {r[0] for r in first}
        claimed_second = {r[0] for r in second}
        assert not (claimed_first & claimed_second), "job double-claimed"

        third = conn.execute(
            "select id from app_private.claim_jobs('q_claim', 2, 'worker-c')"
        ).fetchall()
        conn.commit()
        assert len(third) == 0, "claim on an empty queue returned rows"

        running = conn.execute(
            "select count(*) from app_private.jobs"
            " where queue = 'q_claim' and status = 'running'"
        ).fetchone()[0]
        assert running == 3, f"expected 3 running jobs, got {running}"

        # Idempotent enqueue: same (queue, idempotency_key) is rejected.
        try:
            conn.execute(
                "insert into app_private.jobs (queue, idempotency_key, payload)"
                " values ('q_claim', 'k1', '{}'::jsonb)"
            )
        except errors.UniqueViolation:
            conn.rollback()
        else:
            raise AssertionError("duplicate idempotency_key was NOT rejected")
        return "claim batches disjoint; statuses/attempts/locks correct"


def check_claim_concurrency() -> str:
    """FOR UPDATE SKIP LOCKED: an uncommitted claim is invisible to a
    second worker, which must neither block nor double-claim."""
    conn_a = connect(DBNAME)
    conn_b = connect(DBNAME)
    try:
        for key in ("c1", "c2", "c3"):
            conn_a.execute(
                "insert into app_private.jobs (queue, idempotency_key, payload)"
                " values ('q_conc', %s, '{}'::jsonb)",
                (key,),
            )
        conn_a.commit()

        held = conn_a.execute(
            "select id from app_private.claim_jobs('q_conc', 2, 'worker-a')"
        ).fetchall()
        # conn_a's transaction stays OPEN: rows are locked, not committed.
        assert len(held) == 2

        conn_b.execute("set lock_timeout = '2s'")
        other = conn_b.execute(
            "select id from app_private.claim_jobs('q_conc', 3, 'worker-b')"
        ).fetchall()
        conn_b.commit()
        assert len(other) == 1, (
            f"second worker got {len(other)} rows; expected exactly the"
            " single unlocked job"
        )
        assert not ({r[0] for r in held} & {r[0] for r in other}), (
            "locked job was double-claimed"
        )
        conn_a.commit()
        return "concurrent claim skipped locked rows without blocking"
    finally:
        conn_a.close()
        conn_b.close()


def check_rls() -> str:
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    budgets = '{"max_steps": 10}'
    config = '{"model": "seed"}'

    # Superuser setup: grants for the probe role + rows for both tenants
    # (superuser bypasses RLS, so both inserts succeed).
    with connect(DBNAME) as su:
        su.execute(f"grant usage on schema legal to {RLS_ROLE}")
        su.execute(f"grant usage on schema app_private to {RLS_ROLE}")
        su.execute(f"grant select, insert on legal.documents to {RLS_ROLE}")
        su.execute(
            f"grant select, insert on app_private.research_runs to {RLS_ROLE}"
        )
        su.execute(f"grant select on app_private.research_steps to {RLS_ROLE}")
        su.execute(
            "grant execute on function app_private.current_tenant_id()"
            f" to {RLS_ROLE}"
        )
        run_ids = {}
        for label, tenant in (("A", tenant_a), ("B", tenant_b)):
            su.execute(
                "insert into legal.documents"
                " (scope, tenant_id, source, external_id, document_type)"
                " values ('tenant', %s, 'rls-test', %s, 'sozlesme')",
                (tenant, f"doc-{label}"),
            )
            run_id = str(uuid.uuid4())
            run_ids[label] = run_id
            su.execute(
                "insert into app_private.research_runs"
                " (id, tenant_id, user_id, question, budgets, config_snapshot)"
                " values (%s, %s, %s, %s, %s::jsonb, %s::jsonb)",
                (run_id, tenant, str(uuid.uuid4()),
                 f"tenant {label} question", budgets, config),
            )
            su.execute(
                "insert into app_private.research_steps"
                " (run_id, ordinal, capability, idempotency_key, input, status)"
                " values (%s, 0, 'search', %s, '{}'::jsonb, 'done')",
                (run_id, f"step-{label}"),
            )
        su.commit()

    # Probe session with tenant A context. autocommit so an expected
    # RLS failure cannot roll back the SET ROLE state.
    probe = connect(DBNAME, autocommit=True)
    try:
        probe.execute(f"set app.tenant_id = '{tenant_a}'")
        probe.execute(f"set role {RLS_ROLE}")
        resolved = probe.execute(
            "select app_private.current_tenant_id()"
        ).fetchone()[0]
        assert str(resolved) == tenant_a, "current_tenant_id() != app.tenant_id"

        runs = probe.execute(
            "select tenant_id from app_private.research_runs"
        ).fetchall()
        assert len(runs) == 1 and str(runs[0][0]) == tenant_a, (
            f"tenant A must see exactly its own run, saw {len(runs)}"
        )
        steps = probe.execute(
            "select count(*) from app_private.research_steps"
        ).fetchone()[0]
        assert steps == 1, f"tenant A must see 1 step, saw {steps}"

        tenant_docs = probe.execute(
            "select tenant_id from legal.documents where scope = 'tenant'"
        ).fetchall()
        assert len(tenant_docs) == 1 and str(tenant_docs[0][0]) == tenant_a, (
            "tenant A must see only its own tenant document"
        )
        public_docs = probe.execute(
            "select count(*) from legal.documents where scope = 'public'"
        ).fetchone()[0]
        assert public_docs >= 1, "public documents must stay readable"

        # Positive write inside own tenant.
        probe.execute(
            "insert into app_private.research_runs"
            " (tenant_id, user_id, question, budgets, config_snapshot)"
            " values (%s, %s, 'own tenant insert', %s::jsonb, %s::jsonb)",
            (tenant_a, str(uuid.uuid4()), budgets, config),
        )

        # Negative write into tenant B must be rejected by RLS WITH CHECK.
        try:
            probe.execute(
                "insert into app_private.research_runs"
                " (tenant_id, user_id, question, budgets, config_snapshot)"
                " values (%s, %s, 'cross-tenant insert', %s::jsonb, %s::jsonb)",
                (tenant_b, str(uuid.uuid4()), budgets, config),
            )
        except psycopg.Error as exc:
            assert exc.sqlstate == "42501", (
                f"expected RLS 42501, got {exc.sqlstate}"
            )
        else:
            raise AssertionError("cross-tenant insert was NOT rejected")
        probe.execute("reset role")
    finally:
        probe.close()

    # No tenant context at all: tenant rows invisible, public still visible.
    blank = connect(DBNAME, autocommit=True)
    try:
        blank.execute(f"set role {RLS_ROLE}")
        assert blank.execute(
            "select app_private.current_tenant_id() is null"
        ).fetchone()[0], "current_tenant_id() must be NULL without context"
        assert blank.execute(
            "select count(*) from app_private.research_runs"
        ).fetchone()[0] == 0, "runs leaked without tenant context"
        assert blank.execute(
            "select count(*) from legal.documents where scope = 'tenant'"
        ).fetchone()[0] == 0, "tenant docs leaked without tenant context"
        assert blank.execute(
            "select count(*) from legal.documents where scope = 'public'"
        ).fetchone()[0] >= 1, "public docs must stay readable"
        blank.execute("reset role")
    finally:
        blank.close()
    return "tenant A/B isolation + no-context invisibility + write checks"


def check_rls_content_tables() -> str:
    """P0-1 regression: the content-bearing child tables must not leak.

    Before the 2026-08-27 correction of 20260826060000, RLS was enabled on
    legal.documents ONLY while "authenticated" held a plain SELECT on
    legal.document_versions / legal.chunks / legal.document_relations. Any
    tenant could therefore read another tenant's canonical_text and
    original_text by querying the child table directly. This check gives a
    non-superuser probe role EXACTLY the grants the migration hands to
    "authenticated" and proves the leak is closed.
    """
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    role = RLS_ROLE + "_content"
    secret = {"A": "GİZLİ-A canonical metin", "B": "GİZLİ-B canonical metin"}
    ids: dict[str, dict[str, str]] = {}

    with connect("postgres", autocommit=True) as admin:
        admin.execute(f"drop role if exists {role}")
        admin.execute(f"create role {role} nologin")

    with connect(DBNAME) as su:
        # Exactly the grants from the migration's "authenticated" block.
        su.execute(f"grant usage on schema legal to {role}")
        su.execute(f"grant usage on schema app_private to {role}")
        su.execute(f"grant select on legal.documents to {role}")
        su.execute(f"grant select on legal.document_versions to {role}")
        su.execute(f"grant select on legal.chunks to {role}")
        su.execute(f"grant select on legal.document_relations to {role}")
        su.execute(
            "grant execute on function app_private.current_tenant_id()"
            f" to {role}"
        )
        for label, tenant in (("A", tenant_a), ("B", tenant_b)):
            doc, _snap, ver = _insert_doc_version(
                su, source="rls-content", external_id=f"leak-{label}",
                canonical=secret[label], scope="tenant", tenant_id=tenant,
            )
            chunk = str(uuid.uuid4())
            su.execute(
                "insert into legal.chunks"
                " (id, document_version_id, ordinal, start_char, end_char,"
                "  original_text, search_text, content_sha256)"
                " values (%s, %s, 0, 0, %s, %s, %s, %s)",
                (chunk, ver, len(secret[label]), secret[label],
                 secret[label].lower(), sha256_hex(secret[label])),
            )
            ids[label] = {"doc": doc, "ver": ver, "chunk": chunk}
        pub_doc, _s, pub_ver = _insert_doc_version(
            su, source="rls-content", external_id="leak-public",
            canonical="Kamuya açık metin",
        )
        ids["P"] = {"doc": pub_doc, "ver": pub_ver}
        # Relations: A->A (both endpoints tenant A) and A->B (cross-tenant).
        rel_same = str(uuid.uuid4())
        rel_cross = str(uuid.uuid4())
        for rel_id, to_doc in ((rel_same, ids["A"]["doc"]),
                               (rel_cross, ids["B"]["doc"])):
            su.execute(
                "insert into legal.document_relations"
                " (id, from_document_version_id, to_document_id, kind,"
                "  resolution_status, resolver_version)"
                " values (%s, %s, %s, 'CITES', 'resolved', 'v1')",
                (rel_id, ids["A"]["ver"], to_doc),
            )
        su.commit()

    # Catalog-level assertion: row security actually enabled.
    with connect(DBNAME) as conn:
        rows = conn.execute(
            "select c.relname, c.relrowsecurity"
            " from pg_class c join pg_namespace n on n.oid = c.relnamespace"
            " where n.nspname = 'legal'"
            "   and c.relname in ('document_versions', 'chunks',"
            "                     'document_relations')"
            " order by c.relname"
        ).fetchall()
        assert len(rows) == 3, f"expected 3 tables, found {rows}"
        unprotected = [r[0] for r in rows if not r[1]]
        assert not unprotected, f"RLS disabled on {unprotected}"

    probe = connect(DBNAME, autocommit=True)
    try:
        probe.execute(f"set app.tenant_id = '{tenant_a}'")
        probe.execute(f"set role {role}")

        # Direct read of tenant B's canonical text: must return NOTHING.
        leaked = probe.execute(
            "select canonical_text from legal.document_versions"
            " where id = %s",
            (ids["B"]["ver"],),
        ).fetchall()
        assert leaked == [], (
            f"CROSS-TENANT LEAK: tenant A read {leaked!r} from tenant B's"
            " document_versions"
        )
        leaked_chunk = probe.execute(
            "select original_text from legal.chunks where id = %s",
            (ids["B"]["chunk"],),
        ).fetchall()
        assert leaked_chunk == [], (
            f"CROSS-TENANT LEAK: tenant A read {leaked_chunk!r} from tenant"
            " B's chunks"
        )
        # Unfiltered scans must not contain B's text either.
        all_texts = [
            r[0] for r in probe.execute(
                "select canonical_text from legal.document_versions"
            ).fetchall()
        ]
        assert secret["B"] not in all_texts, "tenant B text leaked in scan"
        assert secret["A"] in all_texts, "tenant A lost access to own text"
        assert "Kamuya açık metin" in all_texts, "public version unreadable"

        all_chunks = [
            r[0] for r in probe.execute(
                "select original_text from legal.chunks"
            ).fetchall()
        ]
        assert secret["B"] not in all_chunks, "tenant B chunk leaked in scan"
        assert secret["A"] in all_chunks, "tenant A lost access to own chunk"

        # Relations: same-tenant visible, cross-tenant endpoint hidden.
        visible_rels = {
            str(r[0]) for r in probe.execute(
                "select id from legal.document_relations"
            ).fetchall()
        }
        assert rel_same in visible_rels, "own-tenant relation hidden"
        assert rel_cross not in visible_rels, (
            "CROSS-TENANT LEAK: relation pointing at another tenant's"
            " document is visible"
        )
        probe.execute("reset role")
    finally:
        probe.close()

    # No tenant context: only public rows.
    blank = connect(DBNAME, autocommit=True)
    try:
        blank.execute(f"set role {role}")
        texts = [
            r[0] for r in blank.execute(
                "select canonical_text from legal.document_versions"
            ).fetchall()
        ]
        assert secret["A"] not in texts and secret["B"] not in texts, (
            "tenant text visible without any tenant context"
        )
        assert "Kamuya açık metin" in texts, "public version unreadable"
        assert blank.execute(
            "select count(*) from legal.document_relations"
        ).fetchone()[0] == 0, "tenant relations visible without context"
        blank.execute("reset role")
    finally:
        blank.close()
    return (
        "document_versions/chunks/document_relations RLS enabled; tenant B"
        " canonical_text + original_text unreadable by tenant A; public rows"
        " still readable; cross-tenant relation hidden"
    )


def check_system_period_semantics() -> str:
    """P0-2 regression: upper_inf() must actually select the current row."""
    with connect(DBNAME) as conn:
        # Negative control: the OLD default was semantically broken.
        old_style, new_style = conn.execute(
            "select upper_inf(tstzrange(now(), 'infinity', '[)')),"
            "       upper_inf(tstzrange(now(), null, '[)'))"
        ).fetchone()
        assert old_style is False, (
            "tstzrange(now(), 'infinity') unexpectedly reports upper_inf"
        )
        assert new_style is True, "tstzrange(now(), null) must be upper_inf"

        # Column default must be the unbounded form.
        default_expr = conn.execute(
            "select pg_get_expr(d.adbin, d.adrelid)"
            " from pg_attrdef d"
            " join pg_attribute a on a.attrelid = d.adrelid"
            "   and a.attnum = d.adnum"
            " where d.adrelid = 'legal.document_versions'::regclass"
            "   and a.attname = 'system_period'"
        ).fetchone()[0]
        assert "infinity" not in default_expr.lower(), (
            f"system_period default still uses a finite endpoint:"
            f" {default_expr}"
        )

        doc_id, snap_id, v1 = _insert_doc_version(
            conn, source="temporal-test", external_id="sysper-1",
            canonical="Birinci metin.",
        )
        conn.commit()
        open_now = conn.execute(
            "select count(*) from legal.document_versions"
            " where document_id = %s and upper_inf(system_period)",
            (doc_id,),
        ).fetchone()[0]
        assert open_now == 1, f"expected 1 open version, got {open_now}"

        # Append v2: the trigger must close v1 inside this transaction.
        v2 = conn.execute(
            "insert into legal.document_versions"
            " (document_id, source_snapshot_id, status, canonical_text,"
            "  normalized_text, content_sha256)"
            " values (%s, %s, 'published', %s, %s, %s) returning id",
            (doc_id, snap_id, "İkinci metin.", "ikinci metin.",
             sha256_hex("İkinci metin.")),
        ).fetchone()[0]
        conn.commit()

        state = dict(conn.execute(
            "select id, upper_inf(system_period)"
            " from legal.document_versions where document_id = %s",
            (doc_id,),
        ).fetchall())
        assert state[uuid.UUID(v1)] is False, "previous version stayed open"
        assert state[v2] is True, "new version is not the open one"
        assert sum(1 for v in state.values() if v) == 1, (
            f"expected exactly one open version, got {state}"
        )
        # The previous row must remain retrievable as history.
        closed_upper = conn.execute(
            "select upper(system_period) is not null"
            " from legal.document_versions where id = %s",
            (v1,),
        ).fetchone()[0]
        assert closed_upper, "closed version has no upper bound"

        # Declarative backstop: a second open row must be impossible.
        try:
            conn.execute(
                "update legal.document_versions"
                " set system_period = tstzrange(lower(system_period),"
                "                               null, '[)')"
                " where id = %s",
                (v1,),
            )
        except errors.UniqueViolation:
            conn.rollback()
        else:
            raise AssertionError(
                "document_versions_one_current_uq did NOT reject a second"
                " open system_period"
            )
        return (
            "upper_inf live (old 'infinity' default proven false); trigger"
            " closes the previous version; exactly one open row enforced"
        )


def check_effective_period_overlap() -> str:
    """P1 regression: two published texts may not cover the same day."""
    with connect(DBNAME) as conn:
        doc_id, snap_id, v1 = _insert_doc_version(
            conn, source="temporal-test", external_id="effper-1",
            canonical="Yürürlük v1.",
        )
        conn.execute(
            "update legal.document_versions"
            " set effective_period = daterange('2005-06-01', null, '[)')"
            " where id = %s",
            (v1,),
        )
        conn.commit()

        # Appending a later-commencing version closes the open one.
        v2 = conn.execute(
            "insert into legal.document_versions"
            " (document_id, source_snapshot_id, status, effective_period,"
            "  canonical_text, normalized_text, content_sha256)"
            " values (%s, %s, 'published',"
            "         daterange('2026-01-15', null, '[)'), %s, %s, %s)"
            " returning id",
            (doc_id, snap_id, "Yürürlük v2.", "yürürlük v2.",
             sha256_hex("Yürürlük v2.")),
        ).fetchone()[0]
        conn.commit()
        periods = dict(conn.execute(
            "select id, effective_period::text"
            " from legal.document_versions where document_id = %s",
            (doc_id,),
        ).fetchall())
        v1_period = periods[uuid.UUID(v1)]
        v2_period = periods[v2]
        assert v1_period == "[2005-06-01,2026-01-15)", (
            f"previous effective_period not closed: {v1_period}"
        )
        assert v2_period == "[2026-01-15,)", f"bad new period {v2_period}"

        # A hand-written overlapping published version must be rejected.
        try:
            conn.execute(
                "insert into legal.document_versions"
                " (document_id, source_snapshot_id, status, effective_period,"
                "  canonical_text, normalized_text, content_sha256)"
                " values (%s, %s, 'published',"
                "         daterange('2010-01-01', '2015-01-01', '[)'),"
                "         %s, %s, %s)",
                (doc_id, snap_id, "Çakışan metin.", "çakışan metin.",
                 sha256_hex("Çakışan metin.")),
            )
        except errors.ExclusionViolation:
            conn.rollback()
        else:
            raise AssertionError(
                "overlapping published effective_period was NOT rejected"
            )

        # A non-published row with the same span is allowed (drafts).
        conn.execute(
            "insert into legal.document_versions"
            " (document_id, source_snapshot_id, status, effective_period,"
            "  canonical_text, normalized_text, content_sha256)"
            " values (%s, %s, 'parsed',"
            "         daterange('2010-01-01', '2015-01-01', '[)'),"
            "         %s, %s, %s)",
            (doc_id, snap_id, "Taslak metin.", "taslak metin.",
             sha256_hex("Taslak metin.")),
        )
        conn.commit()
        return (
            "append closed [2005-06-01,2026-01-15); overlapping published"
            " span rejected; non-published span allowed"
        )


def check_chunk_overlap() -> str:
    """P2 DECISION: chunk spans within a version must not overlap."""
    with connect(DBNAME) as conn:
        _doc, _snap, ver = _insert_doc_version(
            conn, source="chunk-overlap-test", external_id="co-1",
            canonical="x" * 400,
        )

        def add(ordinal: int, start: int, end: int) -> None:
            text = "x" * (end - start)
            conn.execute(
                "insert into legal.chunks"
                " (document_version_id, ordinal, start_char, end_char,"
                "  original_text, search_text, content_sha256)"
                " values (%s, %s, %s, %s, %s, %s, %s)",
                (ver, ordinal, start, end, text, text, sha256_hex(text)),
            )

        add(0, 0, 100)
        add(1, 100, 200)  # adjacent half-open spans are fine
        conn.commit()
        try:
            add(2, 50, 150)
        except errors.ExclusionViolation:
            conn.rollback()
        else:
            raise AssertionError("overlapping chunk span was NOT rejected")
        # Same span in a DIFFERENT version is unaffected.
        _d2, _s2, ver2 = _insert_doc_version(
            conn, source="chunk-overlap-test", external_id="co-2",
            canonical="y" * 400,
        )
        conn.execute(
            "insert into legal.chunks"
            " (document_version_id, ordinal, start_char, end_char,"
            "  original_text, search_text, content_sha256)"
            " values (%s, 0, 50, 150, %s, %s, %s)",
            (ver2, "y" * 100, "y" * 100, sha256_hex("y" * 100)),
        )
        conn.commit()

        # P3: normalizer identity is recorded on every chunk.
        versions = conn.execute(
            "select distinct normalizer_version from legal.chunks"
        ).fetchall()
        assert versions == [("trnorm-v1",)], (
            f"unexpected normalizer_version values: {versions}"
        )
        return (
            "adjacent spans accepted, overlapping span rejected, other"
            " versions unaffected; normalizer_version defaults to trnorm-v1"
        )


def check_job_failure_lifecycle() -> str:
    """P2: attempt cap, fail_job backoff/dead, reaper, partial idempotency."""
    with connect(DBNAME) as conn:
        job_id = conn.execute(
            "insert into app_private.jobs"
            " (queue, idempotency_key, payload, max_attempts)"
            " values ('q_fail', 'f1', '{}'::jsonb, 2) returning id"
        ).fetchone()[0]
        conn.commit()

        seen_attempts = []
        for _ in range(4):  # more rounds than max_attempts on purpose
            claimed = conn.execute(
                "select id, attempts from app_private.claim_jobs("
                "  'q_fail', 5, 'worker-f')"
            ).fetchall()
            conn.commit()
            if not claimed:
                break
            seen_attempts.append(claimed[0][1])
            conn.execute(
                "select app_private.fail_job(%s, %s::jsonb, interval '0')",
                (job_id, '{"msg": "boom"}'),
            )
            conn.commit()
        status, attempts, max_attempts, last_error, locked_by = conn.execute(
            "select status, attempts, max_attempts, last_error, locked_by"
            " from app_private.jobs where id = %s",
            (job_id,),
        ).fetchone()
        assert seen_attempts == [1, 2], (
            f"attempt cap not honoured; claims saw attempts {seen_attempts}"
        )
        assert attempts <= max_attempts, (
            f"attempts {attempts} exceeded max_attempts {max_attempts}"
        )
        assert status == "dead", f"exhausted job ended as {status!r}"
        assert last_error == {"msg": "boom"}, f"last_error lost: {last_error}"
        assert locked_by is None, "dead job still holds a lease"

        # Backoff actually defers the retry.
        b_id = conn.execute(
            "insert into app_private.jobs (queue, idempotency_key, payload)"
            " values ('q_fail', 'f2', '{}'::jsonb) returning id"
        ).fetchone()[0]
        conn.commit()
        conn.execute(
            "select id from app_private.claim_jobs('q_fail', 5, 'worker-f')"
        ).fetchall()
        conn.commit()
        conn.execute(
            "select app_private.fail_job(%s, '{}'::jsonb, interval '1 hour')",
            (b_id,),
        )
        conn.commit()
        deferred = conn.execute(
            "select status, available_at > now() + interval '55 minutes'"
            " from app_private.jobs where id = %s",
            (b_id,),
        ).fetchone()
        assert deferred == ("queued", True), (
            f"backoff not applied: {deferred}"
        )
        assert conn.execute(
            "select count(*) from app_private.claim_jobs("
            "  'q_fail', 5, 'worker-f')"
        ).fetchone()[0] == 0, "backed-off job was claimable immediately"
        conn.commit()

        # Reaper: a crashed lease is requeued; an exhausted one is killed.
        r_ok = conn.execute(
            "insert into app_private.jobs (queue, idempotency_key, payload)"
            " values ('q_reap', 'r1', '{}'::jsonb) returning id"
        ).fetchone()[0]
        r_dead = conn.execute(
            "insert into app_private.jobs"
            " (queue, idempotency_key, payload, max_attempts)"
            " values ('q_reap', 'r2', '{}'::jsonb, 1) returning id"
        ).fetchone()[0]
        conn.commit()
        conn.execute(
            "select id from app_private.claim_jobs('q_reap', 5, 'crashed')"
        ).fetchall()
        conn.commit()
        # Simulate a worker that died 10 minutes ago.
        conn.execute(
            "update app_private.jobs set locked_at = now() - interval"
            " '10 minutes' where queue = 'q_reap'"
        )
        conn.commit()
        reaped = conn.execute(
            "select id, status from app_private.reap_stuck_jobs("
            "  interval '5 minutes')"
        ).fetchall()
        conn.commit()
        reaped_map = {r[0]: r[1] for r in reaped}
        assert reaped_map.get(r_ok) == "queued", (
            f"crashed lease not requeued: {reaped_map}"
        )
        assert reaped_map.get(r_dead) == "dead", (
            f"exhausted crashed lease not killed: {reaped_map}"
        )
        reap_note = conn.execute(
            "select last_error ->> 'reason', locked_by"
            " from app_private.jobs where id = %s",
            (r_ok,),
        ).fetchone()
        assert reap_note == ("lease_expired", None), (
            f"reap not recorded/lease not released: {reap_note}"
        )
        assert conn.execute(
            "select count(*) from app_private.reap_stuck_jobs("
            "  interval '5 minutes')"
        ).fetchone()[0] == 0, "reaper is not idempotent"
        conn.commit()

        # P3 DECISION: idempotency keys are unique only while in flight.
        conn.execute(
            "insert into app_private.jobs (queue, idempotency_key, payload)"
            " values ('q_idem', 'i1', '{}'::jsonb)"
        )
        conn.commit()
        try:
            conn.execute(
                "insert into app_private.jobs"
                " (queue, idempotency_key, payload)"
                " values ('q_idem', 'i1', '{}'::jsonb)"
            )
        except errors.UniqueViolation:
            conn.rollback()
        else:
            raise AssertionError("in-flight duplicate key was NOT rejected")
        conn.execute(
            "update app_private.jobs set status = 'succeeded'"
            " where queue = 'q_idem'"
        )
        conn.execute(
            "insert into app_private.jobs (queue, idempotency_key, payload)"
            " values ('q_idem', 'i1', '{}'::jsonb)"
        )
        conn.commit()
        reused = conn.execute(
            "select count(*) from app_private.jobs where queue = 'q_idem'"
        ).fetchone()[0]
        assert reused == 2, (
            f"key reuse after a terminal state failed ({reused} rows)"
        )
        return (
            "attempts capped at max_attempts then 'dead'; backoff defers"
            " retry; reaper requeues/kills stale leases idempotently; key"
            " unique in flight and reusable after a terminal state"
        )


MATTERS_MIGRATION_PREFIX = "20260902120000"
MATTERS_TABLES = ("matters", "matter_items", "answers", "drafts", "settings")


def check_matters_persistence() -> str:
    """W12-A (02.09.2026): matters/answers/drafts/settings persistence.

    Diagnosis: answers and drafts lived only in bounded in-memory maps
    (32/64) and vanished on restart; there was no matter concept, no lawyer
    profile and no migration ledger, so an existing collex_local could never
    receive a later migration. This check proves, on the scratch database:

      1. the migration parses with pglast exactly like the CI sql-syntax job
         (statements + the DO block's plpgsql body);
      2. the five tables exist with RLS ENABLED and a policy each (ADR-011:
         never a table with a plain grant and no policy);
      3. the migration is IDEMPOTENT — applied a second time through psql it
         succeeds and leaves table/policy/index counts unchanged;
      4. the ledger bootstraps on a psql-loaded database: with no
         app_private.schema_migrations at all, apply_missing_migrations
         records every runnable migration (boundary rule + sentinel) and
         APPLIES NOTHING; a second call is a no-op;
      5. RLS: tenant A's matter and items are invisible to tenant B and to a
         session without tenant context; a cross-tenant item insert is
         rejected with 42501.
    """
    import pglast
    from pglast import ast as pgast

    path = next(
        p for p in runnable_migrations()
        if p.name.startswith(MATTERS_MIGRATION_PREFIX)
    )
    sql = path.read_text(encoding="utf-8")
    statements = pglast.parse_sql(sql)
    plpgsql_bodies = 0
    for raw in statements:
        if isinstance(raw.stmt, pgast.DoStmt):
            pglast.parse_plpgsql(
                sql[raw.stmt_location:raw.stmt_location + raw.stmt_len]
            )
            plpgsql_bodies += 1
    assert plpgsql_bodies == 1, f"expected 1 DO block, found {plpgsql_bodies}"

    def catalog_counts(conn) -> tuple[int, int, int]:
        tables = conn.execute(
            "select count(*) from pg_class c"
            " join pg_namespace n on n.oid = c.relnamespace"
            " where n.nspname = 'app_private' and c.relkind = 'r'"
            "   and c.relname = any(%s)",
            (list(MATTERS_TABLES),),
        ).fetchone()[0]
        policies = conn.execute(
            "select count(*) from pg_policies"
            " where schemaname = 'app_private' and tablename = any(%s)",
            (list(MATTERS_TABLES),),
        ).fetchone()[0]
        indexes = conn.execute(
            "select count(*) from pg_indexes"
            " where schemaname = 'app_private' and tablename = any(%s)",
            (list(MATTERS_TABLES),),
        ).fetchone()[0]
        return int(tables), int(policies), int(indexes)

    with connect(DBNAME) as conn:
        rows = conn.execute(
            "select c.relname, c.relrowsecurity"
            " from pg_class c join pg_namespace n on n.oid = c.relnamespace"
            " where n.nspname = 'app_private' and c.relname = any(%s)"
            " order by c.relname",
            (list(MATTERS_TABLES),),
        ).fetchall()
        assert len(rows) == len(MATTERS_TABLES), (
            f"expected {len(MATTERS_TABLES)} tables, found {rows}"
        )
        unprotected = [r[0] for r in rows if not r[1]]
        assert not unprotected, f"RLS disabled on {unprotected}"
        before = catalog_counts(conn)
        assert before[1] == len(MATTERS_TABLES), (
            f"expected one policy per table, found {before[1]}"
        )

    # (3) idempotent re-apply through psql.
    psql_apply(path)
    with connect(DBNAME) as conn:
        after = catalog_counts(conn)
        assert after == before, f"re-apply changed catalog counts {before}->{after}"

    # (4) ledger bootstrap on a psql-loaded database (no ledger yet).
    with connect(DBNAME, autocommit=True) as conn:
        state = ledger_state(conn)
        assert state.exists is False, "ledger must not exist before bootstrap"
        assert state.has_documents is True
        first = apply_missing_migrations(conn)
        runnable_names = [p.name for p in runnable_migrations()]
        assert first.applied == [], (
            f"bootstrap must not re-run anything, applied {first.applied}"
        )
        assert first.bootstrapped == runnable_names, (
            f"bootstrap recorded {first.bootstrapped}, expected {runnable_names}"
        )
        recorded = conn.execute(
            f"select count(*) from {LEDGER_TABLE}"
        ).fetchone()[0]
        assert recorded == len(runnable_names), (
            f"ledger holds {recorded} rows, expected {len(runnable_names)}"
        )
        second = apply_missing_migrations(conn)
        assert second.applied == [] and second.bootstrapped == [], (
            f"second call was not a no-op: {second.to_json_dict()}"
        )
        assert len(second.already_applied) == len(runnable_names)

    # (5) RLS through a probe role holding the migration's grants.
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    with connect(DBNAME) as su:
        su.execute(f"grant usage on schema app_private to {RLS_ROLE}")
        for table in MATTERS_TABLES:
            su.execute(
                f"grant select, insert, update, delete"
                f" on app_private.{table} to {RLS_ROLE}"
            )
        su.commit()

    probe = connect(DBNAME, autocommit=True)
    try:
        probe.execute(f"set app.tenant_id = '{tenant_a}'")
        probe.execute(f"set role {RLS_ROLE}")
        matter_id = probe.execute(
            "insert into app_private.matters (tenant_id, title, client)"
            " values (%s, 'Yılmaz / Kira tahliye', 'Ayşe Yılmaz')"
            " returning id",
            (tenant_a,),
        ).fetchone()[0]
        probe.execute(
            "insert into app_private.matter_items"
            " (matter_id, tenant_id, kind, payload)"
            " values (%s, %s, 'deadline',"
            " '{\"title\":\"Cevap süresi\",\"dueDate\":\"2026-09-16\","
            "   \"status\":\"acik\",\"source\":\"manual\"}'::jsonb)",
            (matter_id, tenant_a),
        )
        probe.execute(
            "insert into app_private.settings (tenant_id, key, value)"
            " values (%s, 'profile', '{\"ad\":\"Av. Test\"}'::jsonb)",
            (tenant_a,),
        )
        # Cross-tenant write: an item under A's matter carrying B's tenant.
        try:
            probe.execute(
                "insert into app_private.matter_items"
                " (matter_id, tenant_id, kind, payload)"
                " values (%s, %s, 'note', '{\"text\":\"x\"}'::jsonb)",
                (matter_id, tenant_b),
            )
        except psycopg.Error as exc:
            assert exc.sqlstate == "42501", (
                f"expected RLS 42501, got {exc.sqlstate}"
            )
        else:
            raise AssertionError("cross-tenant item insert was NOT rejected")
        probe.execute("reset role")

        # Tenant B sees nothing of A's.
        probe.execute(f"set app.tenant_id = '{tenant_b}'")
        probe.execute(f"set role {RLS_ROLE}")
        for table in ("matters", "matter_items", "settings"):
            seen = probe.execute(
                f"select count(*) from app_private.{table}"
            ).fetchone()[0]
            assert seen == 0, f"tenant B sees {seen} rows of {table}"
        probe.execute("reset role")
    finally:
        probe.close()

    blank = connect(DBNAME, autocommit=True)
    try:
        blank.execute(f"set role {RLS_ROLE}")
        for table in MATTERS_TABLES:
            seen = blank.execute(
                f"select count(*) from app_private.{table}"
            ).fetchone()[0]
            assert seen == 0, f"{table} leaked {seen} rows without context"
        blank.execute("reset role")
    finally:
        blank.close()

    with connect(DBNAME) as su:
        own = su.execute(
            "select count(*) from app_private.matter_items where matter_id = %s",
            (matter_id,),
        ).fetchone()[0]
        assert own == 1, f"tenant A's item count {own}"
    return (
        f"{path.name}: {len(statements)} statements parsed (+1 plpgsql body);"
        f" {len(MATTERS_TABLES)} tables RLS-enabled with policies; idempotent"
        f" re-apply; ledger bootstrapped {len(runnable_names)} rows then no-op;"
        " tenant A rows invisible to tenant B / no context; cross-tenant item"
        " insert rejected (42501)"
    )


HEARING_MIGRATION_PREFIX = "20260904090000"


def check_hearing_kind_and_indexes() -> str:
    """W14 L-FIX (02.09.2026): matter_items.kind accepts 'hearing'.

    Diagnosis. B-17 shipped the calendar, the hearing item kind, the .ics feed
    and MATTER_ITEM_KINDS carrying 'hearing' (control-plane/src/matters/
    types.ts). The DATABASE did not: the inline CHECK created by the matters
    migration listed six kinds, so every hearing INSERT failed with SQLSTATE
    23514, PgMatterStore turned that into a typed 503, and in Pg mode — which
    is every real install — no hearing could be saved. The whole suite was
    green because the in-memory store has no CHECK. This check proves on the
    scratch database that the widened constraint is real, that it still
    REFUSES an unknown kind (a CHECK that accepts everything is not a CHECK),
    that the three search indexes exist, and that the file is idempotent.
    """
    import pglast

    path = next(
        p for p in runnable_migrations()
        if p.name.startswith(HEARING_MIGRATION_PREFIX)
    )
    sql = path.read_text(encoding="utf-8")
    statements = pglast.parse_sql(sql)

    tenant = "00000000-0000-0000-0000-0000000000a1"
    with connect(DBNAME, autocommit=True) as conn:
        definition = conn.execute(
            "select pg_get_constraintdef(oid) from pg_constraint"
            " where conname = 'matter_items_kind_check'"
            "   and conrelid = 'app_private.matter_items'::regclass"
        ).fetchone()
        assert definition is not None, "matter_items_kind_check is missing"
        assert "'hearing'" in definition[0], (
            f"CHECK does not accept 'hearing': {definition[0]}"
        )

        indexes = {
            row[0] for row in conn.execute(
                "select indexname from pg_indexes where schemaname = 'app_private'"
                " and indexname = any(%s)",
                (["answers_question_trgm", "drafts_title_trgm",
                  "matter_items_hearing_date_idx"],),
            ).fetchall()
        }
        assert len(indexes) == 3, f"missing search indexes: {indexes}"

        matter_id = conn.execute(
            "insert into app_private.matters (tenant_id, title)"
            " values (%s, %s) returning id",
            (tenant, "hearing kind probe"),
        ).fetchone()[0]

        # The insert the product performs (PgMatterStore.addItems).
        item = conn.execute(
            "insert into app_private.matter_items"
            " (matter_id, tenant_id, kind, payload)"
            " values (%s, %s, 'hearing', %s::jsonb)"
            " returning kind, payload ->> 'date'",
            (matter_id, tenant,
             '{"date": "2026-10-14", "kind": "durusma", "status": "planlandi"}'),
        ).fetchone()
        assert item == ("hearing", "2026-10-14"), f"hearing not stored: {item}"

        # Non-vacuity: an unimplemented kind is still refused.
        try:
            conn.execute(
                "insert into app_private.matter_items (matter_id, tenant_id, kind)"
                " values (%s, %s, 'expense')",
                (matter_id, tenant),
            )
            raise AssertionError("CHECK accepted an unimplemented kind")
        except psycopg.errors.CheckViolation:
            pass

        conn.execute(
            "delete from app_private.matters where id = %s", (matter_id,)
        )

    # Idempotent: applying the file again changes nothing and does not fail.
    psql_apply(path)
    with connect(DBNAME, autocommit=True) as conn:
        again = conn.execute(
            "select count(*) from pg_constraint"
            " where conname = 'matter_items_kind_check'"
            "   and conrelid = 'app_private.matter_items'::regclass"
        ).fetchone()[0]
        assert again == 1, f"re-apply left {again} kind constraints"

    return (
        f"{path.name}: {len(statements)} statements parsed; kind CHECK accepts"
        " 'hearing' and still refuses 'expense'; 3 search indexes present;"
        " a hearing row round-trips; re-apply idempotent"
    )


# --------------------------------------------------------------------------
# (d) seed + in-database invariant verification
# --------------------------------------------------------------------------

def apply_and_verify_seed() -> str:
    psql_apply(SEED_FILE)
    with connect(DBNAME) as conn:
        # The exact set, not a count: the two seed profiles plus the local
        # E5 profile that 20260912100000_private_dense_vectors.sql adds (W20,
        # 384 dimensions, allowed by the new 1..8192 range check).
        profiles = dict(conn.execute(
            "select profile_key, dimensions from legal.embedding_profiles"
        ).fetchall())
        expected_profiles = {
            "bge-m3-1024-v1": 1024,
            "voyage-4-1024-v1": 1024,
            "e5-small-384-v1": 384,
        }
        assert profiles == expected_profiles, (
            f"expected embedding profiles {expected_profiles}, got {profiles}"
        )

        total = conn.execute(
            "select count(*)"
            " from legal.chunks c"
            " join legal.document_versions v on v.id = c.document_version_id"
            " join legal.documents d on d.id = v.document_id"
            " where d.source = 'seed-mevzuat'"
        ).fetchone()[0]
        assert total == 6, f"expected 6 seeded chunks, got {total}"

        bad = conn.execute(
            "select count(*)"
            " from legal.chunks c"
            " join legal.document_versions v on v.id = c.document_version_id"
            " join legal.documents d on d.id = v.document_id"
            " where d.source = 'seed-mevzuat'"
            "   and (c.original_text <> substring(v.canonical_text"
            "          from c.start_char + 1 for c.end_char - c.start_char)"
            "        or encode(sha256(convert_to(c.original_text, 'UTF8')),"
            "                  'hex') <> c.content_sha256)"
        ).fetchone()[0]
        assert bad == 0, f"{bad} seeded chunks violate offset/hash invariants"

        bad_versions = conn.execute(
            "select count(*)"
            " from legal.document_versions v"
            " join legal.documents d on d.id = v.document_id"
            " where d.source = 'seed-mevzuat'"
            "   and encode(sha256(convert_to(v.canonical_text, 'UTF8')),"
            "              'hex') <> v.content_sha256"
        ).fetchone()[0]
        assert bad_versions == 0, (
            f"{bad_versions} seeded versions violate content hash invariant"
        )
        # Idempotency: applying the seed twice must not duplicate anything.
        psql_apply(SEED_FILE)
        total2 = conn.execute(
            "select count(*) from legal.chunks c"
            " join legal.document_versions v on v.id = c.document_version_id"
            " join legal.documents d on d.id = v.document_id"
            " where d.source = 'seed-mevzuat'"
        ).fetchone()[0]
        assert total2 == 6, "seed re-application duplicated rows"
        return "6 chunks / 3 versions verified in-database; seed idempotent"


# --------------------------------------------------------------------------
# (e) offline syntax validation of pgvector migrations (never executed)
# --------------------------------------------------------------------------

def validate_pgvector_syntax() -> str:
    import pglast
    from pglast import ast as pgast

    details = []
    for path in pgvector_migrations():
        sql = path.read_text(encoding="utf-8")
        statements = pglast.parse_sql(sql)
        sql_bodies = 0
        plpgsql_bodies = 0
        for raw in statements:
            stmt = raw.stmt
            if isinstance(stmt, pgast.CreateFunctionStmt):
                # Dollar-quoted SQL function bodies are opaque strings to
                # the outer parser; parse them separately so the RRF query
                # text is genuinely syntax-checked too.
                lang = None
                body = None
                for opt in stmt.options or ():
                    if opt.defname == "language":
                        lang = getattr(opt.arg, "sval", None)
                    elif opt.defname == "as":
                        # arg is a tuple of String nodes (pglast 8).
                        parts = opt.arg if isinstance(opt.arg, tuple) \
                            else (opt.arg,)
                        body = getattr(parts[0], "sval", None)
                if lang == "sql":
                    if not body:
                        raise AssertionError(
                            f"{path.name}: could not extract sql function"
                            " body for validation"
                        )
                    sql_bodies += len(pglast.parse_sql(body))
            elif isinstance(stmt, pgast.DoStmt):
                # DO blocks are plpgsql: validate with the plpgsql parser.
                text = sql[raw.stmt_location:raw.stmt_location + raw.stmt_len]
                pglast.parse_plpgsql(text)
                plpgsql_bodies += 1
        details.append(
            f"{path.name}: {len(statements)} statements"
            f" (+{sql_bodies} sql-body, +{plpgsql_bodies} plpgsql-body)"
        )
    if not details:
        raise AssertionError("no [REQUIRES PGVECTOR] migrations found")
    return "; ".join(details)


# --------------------------------------------------------------------------

def main() -> int:
    print(f"scratch DB: {USER}@{HOST}:{PORT}/{DBNAME}")
    print(f"migrations: {MIGRATIONS_DIR}")

    run_check("a. recreate scratch database", recreate_database)
    run_check("b. apply non-pgvector migrations (psql ON_ERROR_STOP)",
              apply_migrations)

    # Only meaningful if migrations applied; checks fail fast otherwise.
    run_check("c1. Unicode code-point offset invariant (Turkish I/i, astral)",
              check_offset_invariant)
    run_check("c2. snapshot dedupe unique violation", check_snapshot_dedupe)
    run_check("c3. document_version (document_id, content_sha256) unique",
              check_version_unique)
    run_check("c4. CHECK constraint rejections", check_constraint_rejections)
    run_check("c5. generated tsvector + schema-qualified pg_trgm",
              check_fts_and_trgm)
    run_check("c6. job claim batches (claim_jobs)", check_job_claim)
    run_check("c7. FOR UPDATE SKIP LOCKED concurrency smoke",
              check_claim_concurrency)
    run_check("c8. RLS tenant isolation (probe role)", check_rls)
    run_check("c9. RLS on versions/chunks/relations (P0 leak regression)",
              check_rls_content_tables)
    run_check("c10. system_period upper_inf + one open version (P0)",
              check_system_period_semantics)
    run_check("c11. effective_period overlap rejection (P1)",
              check_effective_period_overlap)
    run_check("c12. chunk non-overlap decision + normalizer_version (P2/P3)",
              check_chunk_overlap)
    run_check("c13. job attempt cap, fail_job, reaper, key reuse (P2/P3)",
              check_job_failure_lifecycle)
    run_check("c14. matters/answers/drafts/settings persistence + ledger"
              " (W12-A)", check_matters_persistence)
    run_check("c15. matter_items 'hearing' kind + search indexes (W14 L-FIX)",
              check_hearing_kind_and_indexes)
    run_check("d. seed.sql apply + in-database hash/offset verification",
              apply_and_verify_seed)
    run_check("e. pglast syntax validation of pgvector migrations (not run)",
              validate_pgvector_syntax)

    failed = [name for name, ok, _ in RESULTS if not ok]
    print()
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(failed))
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

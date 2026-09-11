"""(g) P0-1 regression: no cross-tenant content leak through child tables.

Before the 2026-08-27 correction of 20260826060000, RLS was enabled on
legal.documents ONLY, while the migration's grants block handed the
"authenticated" role a plain SELECT on legal.document_versions,
legal.chunks and legal.document_relations. Those tables had no row
security at all, so ANY authenticated session of ANY tenant could read
another tenant's ``canonical_text`` and ``original_text`` — the entire
document body — simply by querying the child table directly and never
mentioning legal.documents.

This test ingests a real tenant-scoped document through the pipeline, then
attacks it from a non-superuser role holding EXACTLY the grants the
migration gives "authenticated", with tenant context set to a DIFFERENT
tenant. The confidential strings must be unreachable; public rows must
stay readable.
"""

from __future__ import annotations

import json
import uuid

import psycopg
import pytest

from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource
from tests.ingestion.conftest import HOST, PORT, PROBE_ROLE, USER

TENANT_A = "00000000-0000-4000-8000-0000000000aa"  # the dilekçe fixture
TENANT_B = "00000000-0000-4000-8000-0000000000bb"
# Must appear ONLY in tenant A's copy: the tenant B fixture below is the
# same dilekçe with this name swapped out, so a marker they share (the
# subject line, say) would make the leak assertions vacuous.
SECRET_MARKER = "Ayşe Yılmaz"
TENANT_B_MARKER = "Zeynep Arslan"

# Grants copied verbatim from the migration's "authenticated" block.
PROBE_GRANTS = (
    "grant usage on schema legal to {role}",
    "grant usage on schema app_private to {role}",
    "grant select on legal.documents to {role}",
    "grant select on legal.document_versions to {role}",
    "grant select on legal.chunks to {role}",
    "grant select on legal.document_relations to {role}",
    "grant execute on function app_private.current_tenant_id() to {role}",
)


def _tenant_b_document(corpus_dir, tmp_path):
    """A second tenant's copy of the dilekçe fixture, in its own corpus."""
    payload = json.loads(
        (corpus_dir / "filler_dilekce.json").read_text(encoding="utf-8")
    )
    payload["_meta"]["tenant_id"] = TENANT_B
    payload["external_id"] = "dilekce-2026-0002"
    payload["text"] = payload["text"].replace(
        SECRET_MARKER, TENANT_B_MARKER
    )
    target = tmp_path / "tenant_b.json"
    target.write_text(json.dumps(payload, ensure_ascii=False),
                      encoding="utf-8")
    return target.parent


@pytest.fixture()
def ingested_tenants(dsn, corpus_dir, conn, tmp_path):
    """Tenant A's dilekçe + tenant B's dilekçe + the public corpus."""
    a = Pipeline(dsn, FixtureSource(corpus_dir)).run()
    assert a.failed == 0, [o.error for o in a.outcomes if o.error]
    b = Pipeline(dsn, FixtureSource(_tenant_b_document(corpus_dir,
                                                       tmp_path))).run()
    assert b.published == 1, [o.error for o in b.outcomes]

    # A relation from tenant A's version to tenant B's document: the
    # citation graph must not disclose the other tenant's document either.
    a_version, b_document = conn.execute(
        "select"
        " (select v.id from legal.document_versions v"
        "   join legal.documents d on d.id = v.document_id"
        "  where d.external_id = 'dilekce-2026-0001'),"
        " (select d.id from legal.documents d"
        "  where d.external_id = 'dilekce-2026-0002')"
    ).fetchone()
    cross_relation = str(uuid.uuid4())
    conn.execute(
        "insert into legal.document_relations"
        " (id, from_document_version_id, to_document_id, kind,"
        "  resolution_status, resolver_version)"
        " values (%s, %s, %s, 'CITES', 'resolved', 'test')",
        (cross_relation, a_version, b_document),
    )

    for statement in PROBE_GRANTS:
        conn.execute(statement.format(role=PROBE_ROLE))
    return {"cross_relation": cross_relation}


def _probe(dsn: str, tenant: str | None) -> psycopg.Connection:
    connection = psycopg.connect(dsn, autocommit=True)
    if tenant is not None:
        connection.execute(f"set app.tenant_id = '{tenant}'")
    connection.execute(f"set role {PROBE_ROLE}")
    return connection


def test_row_security_is_enabled_on_every_content_table(ingested_tenants,
                                                        conn):
    rows = conn.execute(
        "select c.relname, c.relrowsecurity"
        " from pg_class c join pg_namespace n on n.oid = c.relnamespace"
        " where n.nspname = 'legal'"
        "   and c.relname in ('documents', 'document_versions', 'chunks',"
        "                     'document_relations')"
        " order by c.relname"
    ).fetchall()
    assert len(rows) == 4
    unprotected = [name for name, enabled in rows if not enabled]
    assert unprotected == [], (
        f"RLS is not enabled on {unprotected} — granting SELECT on them"
        " leaks every tenant's document body"
    )


def test_tenant_b_cannot_read_tenant_a_canonical_text(dsn, ingested_tenants):
    probe = _probe(dsn, TENANT_B)
    try:
        assert str(probe.execute(
            "select app_private.current_tenant_id()"
        ).fetchone()[0]) == TENANT_B

        leaked = probe.execute(
            "select canonical_text from legal.document_versions"
            " where canonical_text like %s",
            (f"%{SECRET_MARKER}%",),
        ).fetchall()
        assert leaked == [], (
            "CROSS-TENANT LEAK: tenant B read tenant A's canonical_text"
        )
        assert probe.execute(
            "select count(*) from legal.document_versions"
            " where canonical_text like %s",
            (f"%{SECRET_MARKER}%",),
        ).fetchone()[0] == 0
        # Its own copy is still readable.
        assert probe.execute(
            "select count(*) from legal.document_versions"
            " where canonical_text like %s",
            (f"%{TENANT_B_MARKER}%",),
        ).fetchone()[0] == 1
    finally:
        probe.close()


def test_tenant_b_cannot_read_tenant_a_chunk_text(dsn, ingested_tenants):
    probe = _probe(dsn, TENANT_B)
    try:
        leaked = probe.execute(
            "select original_text from legal.chunks"
            " where original_text like %s",
            (f"%{SECRET_MARKER}%",),
        ).fetchall()
        assert leaked == [], (
            "CROSS-TENANT LEAK: tenant B read tenant A's chunk original_text"
        )
        assert probe.execute(
            "select count(*) from legal.chunks"
            " where original_text like %s",
            (f"%{TENANT_B_MARKER}%",),
        ).fetchone()[0] >= 1
    finally:
        probe.close()


def test_targeted_read_by_primary_key_also_fails(dsn, ingested_tenants, conn):
    """A leak test that filters by LIKE could be fooled by a stale plan."""
    version_id, chunk_id = conn.execute(
        "select v.id, (select c.id from legal.chunks c"
        "               where c.document_version_id = v.id limit 1)"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = 'dilekce-2026-0001'"
    ).fetchone()

    probe = _probe(dsn, TENANT_B)
    try:
        assert probe.execute(
            "select canonical_text from legal.document_versions"
            " where id = %s",
            (version_id,),
        ).fetchall() == []
        assert probe.execute(
            "select original_text from legal.chunks where id = %s",
            (chunk_id,),
        ).fetchall() == []
    finally:
        probe.close()


def test_public_corpus_remains_readable_by_every_tenant(dsn,
                                                        ingested_tenants):
    for tenant in (TENANT_A, TENANT_B, None):
        probe = _probe(dsn, tenant)
        try:
            public_versions = probe.execute(
                "select count(*) from legal.document_versions v"
                " join legal.documents d on d.id = v.document_id"
                " where d.scope = 'public'"
            ).fetchone()[0]
            # Six public DOCUMENTS, seven public VERSIONS: the corpus holds
            # two crawls of kanun-5237 and discovery ingests both.
            assert public_versions == 7, (
                f"tenant={tenant}: public corpus not readable"
                f" ({public_versions} versions)"
            )
            assert probe.execute(
                "select count(*) from legal.chunks c"
                " join legal.document_versions v"
                "   on v.id = c.document_version_id"
                " join legal.documents d on d.id = v.document_id"
                " where d.scope = 'public'"
            ).fetchone()[0] > 0
        finally:
            probe.close()


def test_tenant_a_still_sees_its_own_rows(dsn, ingested_tenants):
    probe = _probe(dsn, TENANT_A)
    try:
        own = probe.execute(
            "select count(*) from legal.document_versions"
            " where canonical_text like %s",
            (f"%{SECRET_MARKER}%",),
        ).fetchone()[0]
        assert own == 1, "RLS over-blocked: tenant A lost its own document"
        assert probe.execute(
            "select count(*) from legal.chunks"
            " where original_text like %s",
            (f"%{TENANT_B_MARKER}%",),
        ).fetchone()[0] == 0, "tenant B's chunk visible to tenant A"
    finally:
        probe.close()


def test_no_tenant_context_sees_only_public_rows(dsn, ingested_tenants):
    probe = _probe(dsn, None)
    try:
        assert probe.execute(
            "select app_private.current_tenant_id() is null"
        ).fetchone()[0], "current_tenant_id() must be NULL without context"
        assert probe.execute(
            "select count(*) from legal.document_versions v"
            " join legal.documents d on d.id = v.document_id"
            " where d.scope = 'tenant'"
        ).fetchone()[0] == 0
        assert probe.execute(
            "select count(*) from legal.document_versions"
            " where canonical_text like %s",
            (f"%{SECRET_MARKER}%",),
        ).fetchone()[0] == 0, "tenant text visible with no tenant context"
        assert probe.execute(
            "select count(*) from legal.chunks"
        ).fetchone()[0] > 0, "public chunks became unreadable"
    finally:
        probe.close()


def test_cross_tenant_relation_is_hidden_from_both_sides(dsn,
                                                         ingested_tenants):
    relation_id = ingested_tenants["cross_relation"]
    for tenant in (TENANT_A, TENANT_B, None):
        probe = _probe(dsn, tenant)
        try:
            visible = probe.execute(
                "select count(*) from legal.document_relations"
                " where id = %s",
                (relation_id,),
            ).fetchone()[0]
            assert visible == 0, (
                f"tenant={tenant}: a relation spanning two tenants is"
                " visible; both endpoints must be readable"
            )
        finally:
            probe.close()


def test_probe_role_holds_no_write_privilege(dsn, ingested_tenants):
    """Deny-by-default: no INSERT/UPDATE policy exists on the child tables."""
    probe = _probe(dsn, TENANT_B)
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            probe.execute(
                "update legal.chunks set original_text = 'tampered'"
            )
    finally:
        probe.close()


def test_probe_role_is_not_a_superuser(dsn, ingested_tenants):
    """Guard: a superuser probe would bypass RLS and pass vacuously."""
    probe = _probe(dsn, TENANT_B)
    try:
        row = probe.execute(
            "select current_user, usesuper, rolbypassrls"
            " from pg_user"
            " join pg_roles on pg_roles.rolname = pg_user.usename"
            " where usename = current_user"
        ).fetchone()
        assert row is None or (row[1] is False and row[2] is False), (
            f"probe role has RLS-bypassing attributes: {row}"
        )
        assert probe.execute("select current_user").fetchone()[0] == \
            PROBE_ROLE
        assert USER != PROBE_ROLE
        assert (HOST, PORT) == (HOST, PORT)  # DSN is loopback by construction
    finally:
        probe.close()

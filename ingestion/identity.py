"""Logical document identity resolution (legal.documents).

Identity key:
    public scope: (source, external_id)            with tenant_id IS NULL
    tenant scope: (tenant_id, source, external_id) with tenant_id NOT NULL

matching the two partial unique indexes created by migration
20260826020000. Scope rules are validated here BEFORE touching the
database so a bad fixture fails with a clear error rather than a CHECK
violation. The pipeline runs as the ingestion role (owner/service level,
RLS bypass) — end-user writes never go through this module.

Concurrency note: resolution is SELECT-then-INSERT. The pipeline is a
single-process, per-document-transaction worker (see CLAUDE.md's
single-worker constraint), so the benign race between two concurrent
inserts of the same identity is out of scope; the partial unique indexes
would still reject the loser loudly.
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class DocumentIdentity:
    document_id: str
    created: bool


def resolve_document(
    conn: psycopg.Connection,
    *,
    source: str,
    external_id: str,
    document_type: str,
    scope: str = "public",
    tenant_id: str | None = None,
    title: str | None = None,
    canonical_source_url: str | None = None,
    jurisdiction: str = "TR",
) -> DocumentIdentity:
    """Return the logical document id for the identity, creating it once."""
    if scope not in ("public", "tenant"):
        raise ValueError(f"invalid scope {scope!r}")
    if scope == "public" and tenant_id is not None:
        raise ValueError("public documents must not carry a tenant_id")
    if scope == "tenant" and not tenant_id:
        raise ValueError("tenant documents require a tenant_id")

    if scope == "public":
        row = conn.execute(
            "select id from legal.documents"
            " where source = %s and external_id = %s and tenant_id is null",
            (source, external_id),
        ).fetchone()
    else:
        row = conn.execute(
            "select id from legal.documents"
            " where source = %s and external_id = %s and tenant_id = %s",
            (source, external_id, tenant_id),
        ).fetchone()
    if row is not None:
        return DocumentIdentity(str(row[0]), False)

    created = conn.execute(
        "insert into legal.documents"
        " (scope, tenant_id, source, external_id, document_type,"
        "  jurisdiction, title, canonical_source_url)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s)"
        " returning id",
        (scope, tenant_id, source, external_id, document_type,
         jurisdiction, title, canonical_source_url),
    ).fetchone()
    return DocumentIdentity(str(created[0]), True)

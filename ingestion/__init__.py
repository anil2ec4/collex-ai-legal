"""ColleX ingestion pipeline (brief section 6.9, Faz 2).

Package layout (each stage is a separately testable unit):

    ports.py       source adapters (SourcePort protocol, FixtureSource,
                   BedestenSource skeleton)
    snapshot.py    immutable legal.source_snapshots insert with raw sha256
                   dedupe
    identity.py    logical document resolution ((source, external_id) +
                   scope/tenant rules)
    versioning.py  content hashing + append-only legal.document_versions
    chunking.py    structural chunking (madde/fikra, decision sections,
                   generic paragraphs) with code-point offsets
    indexer.py     idempotent chunk insertion per version
    jobs.py        idempotent embedding-job enqueue into app_private.jobs
    locators.py    source locators: canonical code-point ranges mapped to a
                   place in the ORIGINAL file (PDF page / DOCX paragraph)
    segments.py    idempotent source-locator insertion per version
    pipeline.py    orchestration with per-document transactions and atomic
                   publish
    cli.py         python -m ingestion.cli entry point

Everything talks to PostgreSQL through psycopg 3 and never to any remote
Supabase instance; tests run against the local scratch database
``collex_ingest_test`` (127.0.0.1:55432).
"""

__all__ = [
    "chunking",
    "identity",
    "indexer",
    "jobs",
    "locators",
    "pipeline",
    "segments",
    "ports",
    "snapshot",
    "versioning",
]

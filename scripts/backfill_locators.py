"""Backfill source locators for documents ingested before the page map existed.

Why this is needed
------------------
`ingestion/pipeline.py` writes segments in the publish transaction of a NEW
version. Every document ingested before W19 therefore has chunks and canonical
text but NO row in `legal.document_version_segments`.

That is not silently ignorable. An exhaustive review counts pages from the
segment ledger, so a document with no ledger contributes `pagesTotal: 0` and
would otherwise sail through the page test — "0 of 0 pages unreadable" — and
let a review of un-mapped files look complete. The runner now reports such a
document as a `NO_SOURCE_MAP` gap, which makes the state VISIBLE; this script
is how the state gets FIXED.

What it can and cannot do
-------------------------
The original bytes are stored (`var/uploads/<sha256><ext>`), so a PDF can be
re-read and its page map rebuilt EXACTLY as intake would have built it — and
the rebuilt canonical text is compared against the stored one before anything
is written. If they differ, the document is SKIPPED and reported: a page map
that does not match the text it claims to describe would produce wrong page
citations, which is worse than no map at all.

A document whose original bytes are missing cannot be mapped and is reported
as such. Nothing is guessed.

Usage:
    .venv/Scripts/python.exe -m scripts.backfill_locators --dsn <dsn> [--apply]

Without ``--apply`` it only reports what it would do.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import psycopg

from ingestion import segments as segments_mod
from intake import extract as extract_mod
from intake import quarantine
from intake.ingest import UPLOAD_SOURCE, resolve_data_dir


def _iter_unmapped(conn: psycopg.Connection, tenant_id: str | None) -> list[dict]:
    tenant_clause = "" if tenant_id is None else " and d.tenant_id = %(tenant)s::uuid"
    rows = conn.execute(
        "select d.external_id, v.id::text as version_id, v.canonical_text,"
        "       v.metadata"
        "  from legal.documents d"
        "  join legal.document_versions v"
        "    on v.document_id = d.id and upper_inf(v.system_period)"
        " where d.scope = 'tenant' and d.source = %(source)s" + tenant_clause +
        "   and not exists ("
        "         select 1 from legal.document_version_segments s"
        "          where s.document_version_id = v.id)"
        " order by d.external_id",
        {"source": UPLOAD_SOURCE, "tenant": tenant_id},
    ).fetchall()
    return [
        {
            "file_id": r[0],
            "version_id": r[1],
            "canonical_text": r[2],
            "metadata": r[3] or {},
        }
        for r in rows
    ]


def _original_path(meta: dict, store_dir: Path) -> Path | None:
    upload = (meta.get("fixture_meta") or {}).get("upload") or meta.get("upload") or {}
    sha256 = upload.get("sha256")
    kind = upload.get("kind")
    if not sha256 or not kind:
        return None
    candidate = store_dir / f"{sha256}.{kind}"
    return candidate if candidate.is_file() else None


def backfill(dsn: str, *, apply: bool, tenant_id: str | None, store_dir: Path) -> dict:
    report = {"examined": 0, "mapped": 0, "skipped": [], "missingOriginal": []}
    with psycopg.connect(dsn) as conn:
        pending = _iter_unmapped(conn, tenant_id)
        report["examined"] = len(pending)
        for row in pending:
            original = _original_path(row["metadata"], store_dir)
            if original is None:
                report["missingOriginal"].append(row["file_id"])
                continue
            data = original.read_bytes()
            try:
                verified = quarantine.verify_upload(original.name, data)
                outcome = extract_mod.extract_text(verified.kind, data)
            except Exception as exc:  # noqa: BLE001 - per-document isolation
                report["skipped"].append(
                    {"fileId": row["file_id"], "reason": f"{type(exc).__name__}"}
                )
                continue

            rebuilt = unicodedata.normalize("NFC", outcome.text)
            if not outcome.segments:
                report["skipped"].append(
                    {"fileId": row["file_id"], "reason": "NO_MAP_PRODUCED"}
                )
                continue
            # THE GUARD. A map is only written when the text it describes is
            # the text that is actually stored; otherwise every page number
            # it produced would be a wrong citation.
            if rebuilt != row["canonical_text"]:
                report["skipped"].append(
                    {"fileId": row["file_id"], "reason": "TEXT_DIFFERS"}
                )
                continue

            if apply:
                segments_mod.insert_segments(conn, row["version_id"], outcome.segments)
                conn.commit()
            report["mapped"] += 1
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", required=True)
    parser.add_argument("--tenant", default=None)
    parser.add_argument("--store-dir", default=None)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the segments; without it the run only reports",
    )
    args = parser.parse_args(argv)
    store_dir = (
        Path(args.store_dir) if args.store_dir else resolve_data_dir() / "uploads"
    )
    report = backfill(
        args.dsn, apply=args.apply, tenant_id=args.tenant, store_dir=store_dir
    )
    report["applied"] = bool(args.apply)
    print(json.dumps({"backfillLocators": report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

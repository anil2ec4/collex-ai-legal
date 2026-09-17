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

Re-judging page statuses (R2-34, ``--reclassify``)
-------------------------------------------------
A document ingested before W21 #25 HAS a page map, but an older extractor
wrote it: a scanned page carrying only an e-signature footer is stored
EXTRACTED, so the exhaustive review still counts it as read. Re-uploading or
"Analizi yenile" re-judges it only when the text did not change (the fix in
``intake/ingest.py``); nothing re-judged documents nobody touches.
``--reclassify`` does, for EVERY current upload version:

* the stored original is re-extracted — with the local OCR this machine has
  (unless ``--no-ocr``), and when that text differs, once more without OCR
  (a document ingested on a machine without OCR);
* only when a re-extraction yields the STORED canonical text byte for byte are
  the page statuses (``extraction_method`` / ``extraction_status`` /
  ``confidence``) and the derived metadata (``page_stats``, warnings,
  analysis) re-derived in place — no new version, no text change;
* a document whose text no re-extraction reproduces is listed under
  ``needsReanalysis`` (its pages can only be re-judged by a NEW version: press
  "Analizi yenile" on it, or add ``--reanalyze`` to do that here).

Usage:
    .venv/Scripts/python.exe -m scripts.backfill_locators --dsn <dsn> [--apply]
    .venv/Scripts/python.exe -m scripts.backfill_locators --dsn <dsn> --reclassify [--apply] [--no-ocr] [--reanalyze]

Without ``--apply`` it only reports what it would do (a ``--reclassify`` dry
run performs the re-derivation inside a transaction and rolls it back).
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import psycopg

from ingestion import segments as segments_mod
from intake import analysis as analysis_mod
from intake import extract as extract_mod
from intake import ingest as ingest_mod
from intake import quarantine
from intake.ingest import UPLOAD_SOURCE, resolve_data_dir
from intake.ocr import resolve_ocr_provider


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
                # ocr=None: a pre-W19 document was never OCR'd, so its map
                # must be rebuilt exactly as it was ingested.
                outcome = extract_mod.extract_text(verified.kind, data, ocr=None)
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


def _iter_current(conn: psycopg.Connection, tenant_id: str | None) -> list[dict]:
    """Every CURRENT upload version, mapped or not (R2-34 reclassify)."""
    tenant_clause = "" if tenant_id is None else " and d.tenant_id = %(tenant)s::uuid"
    rows = conn.execute(
        "select d.external_id, d.tenant_id::text, v.id::text, v.canonical_text,"
        "       v.metadata"
        "  from legal.documents d"
        "  join legal.document_versions v"
        "    on v.document_id = d.id and upper_inf(v.system_period)"
        " where d.scope = 'tenant' and d.source = %(source)s" + tenant_clause +
        " order by d.external_id",
        {"source": UPLOAD_SOURCE, "tenant": tenant_id},
    ).fetchall()
    return [
        {
            "file_id": r[0],
            "tenant_id": r[1],
            "version_id": r[2],
            "canonical_text": r[3],
            "metadata": r[4] or {},
        }
        for r in rows
    ]


def reclassify(
    dsn: str,
    *,
    apply: bool,
    tenant_id: str | None,
    store_dir: Path,
    use_ocr: bool = True,
    reanalyze: bool = False,
    ocr_provider: object = None,
) -> dict:
    """Re-judge the page statuses of every current upload version (R2-34).

    See the module docstring. ``ocr_provider`` is injectable for tests; by
    default the machine's local OCR is detected exactly as intake detects it.
    """
    report: dict = {
        "examined": 0,
        "resynced": 0,
        "pagesUpdated": 0,
        "pagesDowngraded": 0,
        "mapsInserted": 0,
        "refused": [],
        "needsReanalysis": [],
        "reanalyzed": [],
        "missingOriginal": [],
        "skipped": [],
    }
    provider = (ocr_provider if ocr_provider is not None else resolve_ocr_provider()) if use_ocr else None
    with psycopg.connect(dsn) as conn:
        pending = _iter_current(conn, tenant_id)
        report["examined"] = len(pending)
        for row in pending:
            original = _original_path(row["metadata"], store_dir)
            if original is None:
                report["missingOriginal"].append(row["file_id"])
                continue
            data = original.read_bytes()
            try:
                verified = quarantine.verify_upload(original.name, data)
            except Exception as exc:  # noqa: BLE001 - per-document isolation
                report["skipped"].append({"fileId": row["file_id"], "reason": type(exc).__name__})
                continue
            outcome = None
            errors: list[str] = []
            # The machine's OCR first (what "Analizi yenile" would read), then
            # without OCR: a text ingested without OCR is judged as such.
            for ocr in ([provider, None] if provider is not None else [None]):
                try:
                    candidate = extract_mod.extract_text(verified.kind, data, ocr=ocr)
                except Exception as exc:  # noqa: BLE001 - per-document isolation
                    errors.append(type(exc).__name__)
                    continue
                if unicodedata.normalize("NFC", candidate.text) == row["canonical_text"]:
                    outcome = candidate
                    break
            if outcome is None:
                if errors and len(errors) == (2 if provider is not None else 1):
                    report["skipped"].append({"fileId": row["file_id"], "reason": errors[-1]})
                    continue
                # THE GUARD: statuses are only re-judged for the text that is
                # stored; a different text means a new version.
                report["needsReanalysis"].append(row["file_id"])
                if apply and reanalyze:
                    try:
                        ingest_mod.reanalyze_file(
                            dsn, row["file_id"], row["tenant_id"], store_dir=store_dir
                        )
                        report["reanalyzed"].append(row["file_id"])
                    except Exception as exc:  # noqa: BLE001 - per-document isolation
                        report["skipped"].append(
                            {"fileId": row["file_id"], "reason": f"REANALYSIS_{type(exc).__name__}"}
                        )
                continue

            # Exactly what process_file derives for an unchanged version.
            canonical = unicodedata.normalize("NFC", outcome.text)
            segments = outcome.segments if canonical == outcome.text else ()
            analysis, analysis_warnings = analysis_mod.analyze(canonical)
            warnings = list(outcome.warnings) + list(analysis_warnings)
            page_stats_json = (
                outcome.page_stats.to_json_dict() if outcome.page_stats is not None else None
            )
            result = ingest_mod.refresh_derived_fields(
                conn,
                version_id=row["version_id"],
                tenant_id=row["tenant_id"],
                file_id=row["file_id"],
                canonical=canonical,
                segments=segments,
                analysis=analysis,
                warnings=warnings,
                page_stats_json=page_stats_json,
            )
            if apply:
                conn.commit()
            else:
                conn.rollback()
            if result.refused:
                report["refused"].append(row["file_id"])
                continue
            if result.updated or result.inserted:
                report["resynced"] += 1
            report["pagesUpdated"] += result.updated
            report["pagesDowngraded"] += result.downgraded
            report["mapsInserted"] += 1 if result.inserted else 0
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
    parser.add_argument(
        "--reclassify",
        action="store_true",
        help="re-judge the page statuses of EVERY current upload (R2-34)",
    )
    parser.add_argument(
        "--no-ocr",
        action="store_true",
        help="with --reclassify: re-extract without local OCR",
    )
    parser.add_argument(
        "--reanalyze",
        action="store_true",
        help="with --reclassify --apply: publish a new version for documents"
        " whose stored text no re-extraction reproduces",
    )
    args = parser.parse_args(argv)
    store_dir = (
        Path(args.store_dir) if args.store_dir else resolve_data_dir() / "uploads"
    )
    if args.reclassify:
        report = reclassify(
            args.dsn,
            apply=args.apply,
            tenant_id=args.tenant,
            store_dir=store_dir,
            use_ocr=not args.no_ocr,
            reanalyze=args.reanalyze,
        )
        report["applied"] = bool(args.apply)
        print(json.dumps({"reclassifyPages": report}, ensure_ascii=False, indent=2))
        return 0
    report = backfill(
        args.dsn, apply=args.apply, tenant_id=args.tenant, store_dir=store_dir
    )
    report["applied"] = bool(args.apply)
    print(json.dumps({"backfillLocators": report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

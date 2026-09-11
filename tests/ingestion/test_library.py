"""Yerel kütüphane yayımı — regression suite for ``ingestion/library.py``.

These are REAL integration tests against the local scratch PostgreSQL
(``collex_ingest_test``, see ``conftest.py``); when the server or the driver
is missing the whole package leaves the INVERSE "environment unavailable"
marker the repo's other guarded suites use, so a skip is visible evidence
that the environment was absent rather than a green run.

What is pinned here is the set of promises a lawyer's growing library
depends on:

* an envelope this reader does not understand is REJECTED BY NAME, never
  silently skipped;
* running twice publishes nothing the second time (idempotence);
* the same document with CHANGED text is a new VERSION and the previous one
  is closed by the database trigger (ADR-012), not by code here;
* a broken or failed envelope is NEVER deleted — the lawyer's fetched text
  is the whole point of the lane;
* the counts are true, including on a partially successful run;
* a published document carries the "resmî kaynak" mark and is
  distinguishable from the SENTETİK fixture corpus in one query.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path

import pytest

from ingestion import chunking, library
from ingestion.library import (
    DatabaseNameRefused,
    LibraryRecordError,
    parse_library_record,
    publish_library,
    read_spool,
)

DECISION_TEXT = (
    "T.C. YARGITAY 11. Hukuk Dairesi\nE. 2025/1234 K. 2025/5678\n\n"
    "ÖZET: Taraflar arasındaki sözleşmenin geçerliliği tartışmalıdır.\n\n"
    "OLAY: Davacı, 12.03.2024 tarihli sözleşmenin feshini talep etmiştir.\n\n"
    "GEREKÇE: 6098 sayılı Türk Borçlar Kanunu m. 27 uyarınca yapılan"
    " değerlendirmede, sözleşmenin konusu hukuka aykırı bulunmamıştır.\n\n"
    "HÜKÜM: Temyiz isteminin REDDİNE oybirliğiyle karar verildi.\n"
)

LEGISLATION_TEXT = (
    "MADDE 1 - Bu Kanunun amacı, borç ilişkilerini düzenlemektir.\n\n"
    "MADDE 2 - Bu Kanun, 6098 sayılı Kanuna dayanılarak hazırlanmıştır.\n"
)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _envelope(
    *,
    source: str = "BEDESTEN",
    external_id: str = "yargitay-2025-5678",
    text: str = DECISION_TEXT,
    fetched_at: str = "2026-09-04T09:15:00.000Z",
    **overrides,
) -> dict:
    body = {
        "schema": library.LIBRARY_RECORD_SCHEMA,
        "source": source,
        "externalId": external_id,
        "title": "Yargıtay 11. HD 2025/1234 E., 2025/5678 K.",
        "sourceUrl": "https://bedesten.adalet.gov.tr/karar/5678",
        "toolName": "get_bedesten_document_markdown",
        "fetchedAt": fetched_at,
        "originLabel": library.LIBRARY_ORIGIN_LABEL,
        "scope": library.LIBRARY_SCOPE,
        "mediaType": library.LIBRARY_MEDIA_TYPE,
        "text": text,
        "contentSha256": _sha256(text),
        "contentCodePoints": len(text),
        "runId": "run-0001",
    }
    body.update(overrides)
    return body


def _write(spool: Path, body: dict, name: str | None = None) -> Path:
    spool.mkdir(parents=True, exist_ok=True)
    if name is None:
        digest = str(body.get("contentSha256", "0" * 64))[:16]
        name = f"{body.get('source')}__{body.get('externalId')}__{digest}.json"
    path = spool / name
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    return path


@pytest.fixture()
def spool(tmp_path: Path) -> Path:
    directory = tmp_path / "library"
    directory.mkdir()
    return directory


# ---------------------------------------------------------------------------
# (1) Envelope validation — an unknown schema is REFUSED, never skipped
# ---------------------------------------------------------------------------


def test_unknown_schema_is_rejected_with_its_own_code(spool: Path):
    path = _write(spool, _envelope(schema="collex.library.document/v2"),
                  name="future.json")

    records, rejected = read_spool(spool)

    assert records == []
    assert len(rejected) == 1
    assert rejected[0].code == "UNKNOWN_SCHEMA"
    # Named, so an operator can find the file. A silent skip is the failure
    # mode this test exists to prevent.
    assert Path(rejected[0].path) == path
    assert "collex.library.document/v2" in rejected[0].message


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        ({"contentSha256": "0" * 64}, "CONTENT_HASH_MISMATCH"),
        ({"contentCodePoints": 3}, "CODEPOINT_MISMATCH"),
        ({"originLabel": "(SENTETİK)"}, "WRONG_ORIGIN_LABEL"),
        ({"scope": "tenant"}, "WRONG_SCOPE"),
        ({"mediaType": "application/pdf"}, "UNKNOWN_MEDIA_TYPE"),
        ({"source": "fixture-yargitay"}, "SYNTHETIC_SOURCE"),
        ({"text": "   "}, "EMPTY_TEXT"),
        ({"externalId": ""}, "EMPTY_EXTERNAL_ID"),
    ],
)
def test_each_broken_field_has_its_own_rejection_code(
    spool: Path, mutate: dict, code: str
):
    body = _envelope(**mutate)
    # Keep the declared hash/length honest for the mutations that are not
    # ABOUT the hash, so each case tests exactly one rule.
    if "text" in mutate and "contentSha256" not in mutate:
        body["contentSha256"] = _sha256(body["text"])
        body["contentCodePoints"] = len(body["text"])
    path = _write(spool, body, name="broken.json")

    with pytest.raises(LibraryRecordError) as excinfo:
        parse_library_record(path.read_bytes(), path)

    assert excinfo.value.code == code


def test_non_canonical_text_is_rejected_so_the_two_hashes_can_never_diverge(
    spool: Path,
):
    """The envelope's hash IS the version's hash — that is the bond.

    A citation is later verified against ``contentSha256``. If this reader
    NFC-normalized the text itself, the published version would carry a
    different hash than the envelope and the citation would verify against a
    hash of text nobody holds. So a non-canonical envelope is refused rather
    than repaired.
    """
    decomposed = unicodedata.normalize("NFD", "İstanbul Bölge Adliye Mahkemesi")
    assert unicodedata.normalize("NFC", decomposed) != decomposed
    body = _envelope(text=decomposed + "\n\nKarar metni.\n")
    body["contentSha256"] = _sha256(body["text"])
    body["contentCodePoints"] = len(body["text"])
    path = _write(spool, body, name="nfd.json")

    with pytest.raises(LibraryRecordError) as excinfo:
        parse_library_record(path.read_bytes(), path)
    assert excinfo.value.code == "TEXT_NOT_CANONICAL"

    crlf = _envelope(text="Bir satır.\r\n\r\nİkinci satır.\r\n")
    crlf["contentSha256"] = _sha256(crlf["text"])
    crlf["contentCodePoints"] = len(crlf["text"])
    crlf_path = _write(spool, crlf, name="crlf.json")
    with pytest.raises(LibraryRecordError) as excinfo:
        parse_library_record(crlf_path.read_bytes(), crlf_path)
    assert excinfo.value.code == "TEXT_NOT_CANONICAL"


def test_invalid_json_is_reported_not_crashed(spool: Path):
    (spool / "garbage.json").write_text("{not json at all", encoding="utf-8")

    records, rejected = read_spool(spool)

    assert records == []
    assert [entry.code for entry in rejected] == ["INVALID_JSON"]


# ---------------------------------------------------------------------------
# (2) Database-name discipline
# ---------------------------------------------------------------------------


def test_publisher_refuses_every_other_database_name(spool: Path):
    _write(spool, _envelope())

    with pytest.raises(DatabaseNameRefused) as excinfo:
        publish_library(
            spool, "postgres://postgres@127.0.0.1:55432/collex_demo"
        )

    assert "collex_demo" in str(excinfo.value)
    assert "collex_local" in str(excinfo.value)
    # Refused BEFORE any work: the envelope is untouched.
    assert len(list(spool.glob("*.json"))) == 1


def test_the_two_owned_names_are_accepted(dsn: str, spool: Path):
    assert library.LIBRARY_DATABASES == ("collex_local", "collex_ingest_test")
    assert library.assert_library_database(dsn) == "collex_ingest_test"


# ---------------------------------------------------------------------------
# (3) Publication + idempotence
# ---------------------------------------------------------------------------


def _library_versions(conn, source: str, external_id: str) -> list[tuple]:
    return conn.execute(
        "select v.id, v.content_sha256, upper_inf(v.system_period),"
        "       v.status::text"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s and d.external_id = %s"
        " order by lower(v.system_period), v.id",
        (source, external_id),
    ).fetchall()


def test_publishes_through_the_existing_pipeline_with_real_chunks(
    dsn: str, spool: Path, conn
):
    _write(spool, _envelope())

    report = publish_library(spool, dsn)

    assert report.scanned == 1
    assert report.published == 1
    assert report.skipped == 0
    assert report.failed == 0
    assert report.chunks > 0

    document = conn.execute(
        "select scope::text, tenant_id, document_type, title,"
        "       canonical_source_url"
        " from legal.documents where source = %s and external_id = %s",
        ("BEDESTEN", "yargitay-2025-5678"),
    ).fetchone()
    scope, tenant_id, document_type, title, url = document
    assert scope == "public"
    # Never mixed with a tenant upload.
    assert tenant_id is None
    assert document_type == "karar"
    assert title.startswith("Yargıtay 11. HD")
    assert url == "https://bedesten.adalet.gov.tr/karar/5678"

    versions = _library_versions(conn, "BEDESTEN", "yargitay-2025-5678")
    assert len(versions) == 1
    # The version's content hash IS the envelope's contentSha256.
    assert versions[0][1] == _sha256(DECISION_TEXT)
    assert versions[0][2] is True
    assert versions[0][3] == "published"

    # Chunk offsets still index into the canonical text (ADR-003/ADR-013):
    # the existing chunker did this, and nothing here re-derived it.
    bad_offsets = conn.execute(
        "select count(*) from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " where substring(v.canonical_text from c.start_char + 1"
        "                 for c.end_char - c.start_char)"
        "       is distinct from c.original_text"
    ).fetchone()[0]
    assert bad_offsets == 0


def test_published_envelope_is_marked_and_never_processed_again(
    dsn: str, spool: Path, conn
):
    path = _write(spool, _envelope())

    first = publish_library(spool, dsn)
    assert first.published == 1
    assert first.moved == 1

    # Moved, NOT deleted: the lawyer's copy of what they fetched survives.
    assert not path.exists()
    moved = spool / library.PUBLISHED_SUBDIR / path.name
    assert moved.is_file()
    assert json.loads(moved.read_text(encoding="utf-8"))["text"] == DECISION_TEXT

    second = publish_library(spool, dsn)
    assert second.scanned == 0
    assert second.published == 0
    assert second.failed == 0

    assert conn.execute(
        "select count(*) from legal.document_versions"
    ).fetchone()[0] == 1


def test_re_presenting_the_same_envelope_publishes_no_second_document(
    dsn: str, spool: Path, conn
):
    """Idempotence at the CONTENT level, not just the file level.

    Moving the file away is a convenience. The real guarantee is that the
    same identity + the same content hash is 'unchanged' and writes nothing,
    which is what makes a re-run of a partially completed spool safe.
    """
    _write(spool, _envelope())
    first = publish_library(spool, dsn)
    assert first.published == 1

    before = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.chunks),"
        " (select count(*) from app_private.jobs)"
    ).fetchone()

    # Same envelope again, as if the spool had not been marked.
    _write(spool, _envelope())
    second = publish_library(spool, dsn)

    assert second.scanned == 1
    assert second.published == 0
    assert second.skipped == 1
    assert second.unchanged == 1
    assert second.failed == 0
    assert second.chunks == 0

    after = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.chunks),"
        " (select count(*) from app_private.jobs)"
    ).fetchone()
    assert after == before


# ---------------------------------------------------------------------------
# (4) Same identity, changed text -> a new VERSION, the old one closed
# ---------------------------------------------------------------------------


def test_changed_text_appends_a_version_and_closes_the_previous_one(
    dsn: str, spool: Path, conn
):
    amended = DECISION_TEXT.replace(
        "Temyiz isteminin REDDİNE", "Hükmün BOZULMASINA"
    )
    assert amended != DECISION_TEXT

    _write(spool, _envelope(fetched_at="2026-09-01T08:00:00.000Z"))
    assert publish_library(spool, dsn).published == 1

    _write(spool, _envelope(text=amended,
                            fetched_at="2026-09-04T08:00:00.000Z"))
    second = publish_library(spool, dsn)
    assert second.published == 1
    assert second.failed == 0

    documents = conn.execute(
        "select count(*) from legal.documents"
        " where source = %s and external_id = %s",
        ("BEDESTEN", "yargitay-2025-5678"),
    ).fetchone()[0]
    # ONE logical document: identity did not change, only its text.
    assert documents == 1

    versions = _library_versions(conn, "BEDESTEN", "yargitay-2025-5678")
    assert len(versions) == 2
    hashes = [row[1] for row in versions]
    assert hashes == [_sha256(DECISION_TEXT), _sha256(amended)]
    # Temporal close-on-append is the DATABASE's job (ADR-012); this asserts
    # it happened, and that nothing here reimplemented it.
    assert [row[2] for row in versions] == [False, True]

    open_versions = conn.execute(
        "select count(*) from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s and upper_inf(v.system_period)",
        ("BEDESTEN",),
    ).fetchone()[0]
    assert open_versions == 1


def test_two_versions_in_one_run_are_appended_oldest_first(
    dsn: str, spool: Path, conn
):
    """Both envelopes present at once: fetch order decides the history."""
    amended = DECISION_TEXT.replace("REDDİNE", "KABULÜNE")
    _write(spool, _envelope(text=amended,
                            fetched_at="2026-09-04T08:00:00.000Z"))
    _write(spool, _envelope(fetched_at="2026-09-01T08:00:00.000Z"))

    report = publish_library(spool, dsn)

    assert report.published == 2
    versions = _library_versions(conn, "BEDESTEN", "yargitay-2025-5678")
    assert [row[1] for row in versions] == [
        _sha256(DECISION_TEXT), _sha256(amended),
    ]
    assert [row[2] for row in versions] == [False, True]


# ---------------------------------------------------------------------------
# (5) Nothing that failed is ever deleted, and the counts stay true
# ---------------------------------------------------------------------------


def test_a_broken_envelope_is_left_on_disk_and_counted_as_failed(
    dsn: str, spool: Path, conn
):
    good = _write(spool, _envelope())
    broken = _write(spool, _envelope(schema="something.else/v9"),
                    name="bozuk.json")
    truncated = spool / "yarim.json"
    truncated.write_text('{"schema": "collex.library.', encoding="utf-8")

    report = publish_library(spool, dsn)

    assert report.scanned == 3
    assert report.published == 1
    assert report.skipped == 0
    assert report.failed == 2
    assert len(report.rejected) == 2
    assert len(report.failures) == 0
    assert sorted(entry.code for entry in report.rejected) == [
        "INVALID_JSON", "UNKNOWN_SCHEMA",
    ]

    # The good one moved; NEITHER broken file was deleted or moved.
    assert not good.exists()
    assert broken.is_file()
    assert truncated.is_file()
    assert not (spool / library.PUBLISHED_SUBDIR / broken.name).exists()
    assert not (spool / library.PUBLISHED_SUBDIR / truncated.name).exists()

    assert conn.execute(
        "select count(*) from legal.documents"
    ).fetchone()[0] == 1


def test_a_pipeline_failure_keeps_its_envelope_and_does_not_lose_the_batch(
    dsn: str, spool: Path, conn, monkeypatch
):
    """One document failing must not cost the others, nor its own file."""
    doomed_text = LEGISLATION_TEXT + "\nBOZUK PARÇALAYICI\n"
    real_iter_chunks = chunking.iter_chunks

    def exploding(parsed):
        if "BOZUK PARÇALAYICI" in parsed.canonical_text:
            raise RuntimeError("chunker patladı (enjekte edilmiş hata)")
        return real_iter_chunks(parsed)

    monkeypatch.setattr(chunking, "iter_chunks", exploding)

    ok = _write(spool, _envelope())
    doomed_body = _envelope(source="MEVZUAT", external_id="kanun-6098",
                            text=doomed_text,
                            fetched_at="2026-09-04T10:00:00.000Z")
    doomed_body["contentSha256"] = _sha256(doomed_text)
    doomed_body["contentCodePoints"] = len(doomed_text)
    doomed = _write(spool, doomed_body, name="doomed.json")

    report = publish_library(spool, dsn)

    assert report.scanned == 2
    assert report.published == 1
    assert report.failed == 1
    assert len(report.rejected) == 0
    assert len(report.failures) == 1
    failure = report.failures[0]
    assert failure.external_id == "kanun-6098"
    assert "BOZUK PARÇALAYICI" not in failure.error  # the text is not echoed
    assert failure.error_type == "RuntimeError"

    assert not ok.exists()          # published -> moved
    assert doomed.is_file()         # failed -> stays, nothing is lost
    assert not (spool / library.PUBLISHED_SUBDIR / doomed.name).exists()

    # The failed document left NOTHING half-published (publish atomicity).
    assert conn.execute(
        "select count(*) from legal.documents where external_id = %s",
        ("kanun-6098",),
    ).fetchone()[0] == 0

    # And a re-run after the fix lands it, with the file still there to try.
    monkeypatch.setattr(chunking, "iter_chunks", real_iter_chunks)
    retry = publish_library(spool, dsn)
    assert retry.published == 1
    assert retry.failed == 0
    assert not doomed.exists()


def test_report_json_states_all_three_numbers(dsn: str, spool: Path):
    _write(spool, _envelope())
    _write(spool, _envelope(schema="unknown/v1"), name="bozuk.json")

    body = publish_library(spool, dsn).to_json_dict()

    assert body["scanned"] == 2
    assert body["published"] == 1
    assert body["skipped"] == 0
    assert body["failed"] == 1
    # The sub-counts stay apart: a malformed file and a dead database are
    # different problems with different fixes.
    assert body["rejected"] == 1
    assert body["pipelineFailed"] == 0
    assert body["dryRun"] is False
    assert body["rejectedEnvelopes"][0]["code"] == "UNKNOWN_SCHEMA"


# ---------------------------------------------------------------------------
# (6) --dry-run writes nothing
# ---------------------------------------------------------------------------


def test_dry_run_reports_and_writes_nothing(dsn: str, spool: Path, conn):
    path = _write(spool, _envelope())

    report = publish_library(spool, dsn, dry_run=True)

    assert report.dry_run is True
    assert report.published == 1
    assert report.moved == 0
    assert report.chunks == 0
    # Nothing written, nothing moved, nothing created.
    assert path.is_file()
    assert not (spool / library.PUBLISHED_SUBDIR).exists()
    assert conn.execute(
        "select count(*) from legal.documents"
    ).fetchone()[0] == 0


def test_dry_run_after_publication_says_already_present(
    dsn: str, spool: Path
):
    _write(spool, _envelope())
    assert publish_library(spool, dsn).published == 1

    _write(spool, _envelope())
    report = publish_library(spool, dsn, dry_run=True)

    assert report.published == 0
    assert report.unchanged == 1
    assert report.skipped == 1


# ---------------------------------------------------------------------------
# (7) The "resmî kaynak" mark survives, and synthetic stays separable
# ---------------------------------------------------------------------------


def test_published_rows_carry_the_official_mark_and_are_not_synthetic(
    dsn: str, spool: Path, conn, corpus_dir
):
    from ingestion.pipeline import Pipeline
    from ingestion.ports import FixtureSource

    # The SENTETİK fixture corpus and the real library in ONE database.
    Pipeline(dsn, FixtureSource(corpus_dir)).run()
    _write(spool, _envelope())
    assert publish_library(spool, dsn).published == 1

    metadata = conn.execute(
        "select v.metadata -> 'fixture_meta'"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s and d.external_id = %s",
        ("BEDESTEN", "yargitay-2025-5678"),
    ).fetchone()[0]
    assert metadata["synthetic"] is False
    assert metadata["origin_label"] == library.LIBRARY_ORIGIN_LABEL
    assert metadata["library"]["schema"] == library.LIBRARY_RECORD_SCHEMA
    assert metadata["library"]["tool_name"] == "get_bedesten_document_markdown"
    assert metadata["library"]["fetched_at"] == "2026-09-04T09:15:00.000Z"
    assert metadata["library"]["source_url"].startswith("https://bedesten")

    # One query separates them, in both directions, with no ambiguity.
    official = conn.execute(
        "select count(*) from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where v.metadata -> 'fixture_meta' ->> 'origin_label' = %s",
        (library.LIBRARY_ORIGIN_LABEL,),
    ).fetchone()[0]
    synthetic = conn.execute(
        "select count(*) from legal.document_versions v"
        " where v.metadata -> 'fixture_meta' ->> 'synthetic' = 'true'"
    ).fetchone()[0]
    assert official == 1
    assert synthetic > 0


def test_provider_family_picks_the_existing_chunker(dsn: str, spool: Path, conn):
    """Legislation gets madde chunks, a decision gets bölüm chunks.

    Nothing new is implemented for either: the family only names which of
    ``ingestion/chunking.py``'s existing chunkers applies.
    """
    _write(spool, _envelope(source="MEVZUAT", external_id="kanun-6098",
                            text=LEGISLATION_TEXT,
                            contentSha256=_sha256(LEGISLATION_TEXT),
                            contentCodePoints=len(LEGISLATION_TEXT)))
    _write(spool, _envelope())

    report = publish_library(spool, dsn)
    assert report.published == 2

    articles = conn.execute(
        "select count(*) from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s and c.article_no is not null",
        ("MEVZUAT",),
    ).fetchone()[0]
    assert articles == 2

    sections = conn.execute(
        "select array_agg(c.structural_path[1] order by c.ordinal)"
        " from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s",
        ("BEDESTEN",),
    ).fetchone()[0]
    assert "bolum-gerekce" in sections

    types = dict(conn.execute(
        "select source, document_type from legal.documents"
    ).fetchall())
    assert types["MEVZUAT"] == "mevzuat"
    assert types["BEDESTEN"] == "karar"


def test_unknown_provider_falls_back_to_the_generic_chunker(
    dsn: str, spool: Path, conn
):
    """A provider this table does not know is still published, not dropped."""
    _write(spool, _envelope(source="YENI_KURUM", external_id="x-1"))

    report = publish_library(spool, dsn)

    assert report.published == 1
    assert conn.execute(
        "select document_type from legal.documents where source = %s",
        ("YENI_KURUM",),
    ).fetchone()[0] == "belge"


# ---------------------------------------------------------------------------
# (8) CLI surface
# ---------------------------------------------------------------------------


def test_cli_publish_library_json_round_trip(dsn: str, spool: Path, capsys):
    from ingestion import cli

    _write(spool, _envelope())

    code = cli.main(["--dsn", dsn, "--publish-library", str(spool), "--json"])

    assert code == 0
    body = json.loads(capsys.readouterr().out)["library"]
    assert body["published"] == 1
    assert body["failed"] == 0
    assert body["documents"][0]["movedTo"].endswith(".json")


def test_cli_dry_run_writes_nothing_and_exits_zero(
    dsn: str, spool: Path, conn, capsys
):
    from ingestion import cli

    _write(spool, _envelope())

    code = cli.main([
        "--dsn", dsn, "--publish-library", str(spool), "--dry-run", "--json",
    ])

    assert code == 0
    body = json.loads(capsys.readouterr().out)["library"]
    assert body["dryRun"] is True
    assert body["published"] == 1
    assert body["moved"] == 0
    assert conn.execute(
        "select count(*) from legal.documents"
    ).fetchone()[0] == 0


def test_cli_exits_two_when_an_envelope_failed(dsn: str, spool: Path, capsys):
    from ingestion import cli

    _write(spool, _envelope())
    _write(spool, _envelope(schema="unknown/v1"), name="bozuk.json")

    code = cli.main(["--dsn", dsn, "--publish-library", str(spool)])

    assert code == 2
    out = capsys.readouterr().out
    # A partial success does not read as a success.
    assert "yayımlanan=1" in out
    assert "hatalı=1" in out
    assert "REDDEDİLDİ" in out
    assert "bozuk.json" in out


def test_cli_refuses_a_foreign_database_name(spool: Path, capsys):
    from ingestion import cli

    _write(spool, _envelope())

    code = cli.main([
        "--dsn", "postgres://postgres@127.0.0.1:55432/collex_demo",
        "--publish-library", str(spool), "--json",
    ])

    assert code == 2
    body = json.loads(capsys.readouterr().out)["error"]
    assert body["kind"] == "INVALID_REQUEST"
    assert "collex_demo" in body["message"]


def test_cli_refuses_to_mix_the_library_with_the_fixture_corpus(
    dsn: str, spool: Path
):
    from ingestion import cli

    with pytest.raises(SystemExit):
        cli.main([
            "--dsn", dsn, "--publish-library", str(spool), "--recreate-db",
        ])
    with pytest.raises(SystemExit):
        cli.main([
            "--dsn", dsn, "--publish-library", str(spool),
            "--apply-migrations",
        ])


def test_cli_store_unavailable_is_typed(spool: Path, capsys):
    from ingestion import cli

    _write(spool, _envelope())
    # An allowed NAME on a port nothing listens on: the DSN guard passes and
    # the connection is what fails, which is the case contract [X] covers.
    code = cli.main([
        "--dsn", "postgres://postgres@127.0.0.1:1/collex_local",
        "--publish-library", str(spool), "--json",
    ])

    assert code == 2
    body = json.loads(capsys.readouterr().out)["error"]
    assert body["kind"] == "STORE_UNAVAILABLE"
    assert body["message"] == "Yerel veritabanına ulaşılamadı."
    # The driver text can carry the DSN; it never reaches the caller.
    assert "127.0.0.1" not in body["message"]


def test_spool_discovery_ignores_the_published_subdirectory(spool: Path):
    _write(spool, _envelope())
    publisheddir = spool / library.PUBLISHED_SUBDIR
    publisheddir.mkdir()
    _write(publisheddir, _envelope(external_id="already-done"))

    assert [path.parent for path in library.spool_files(spool)] == [spool]
    records, rejected = read_spool(spool)
    assert rejected == []
    assert [record.external_id for record in records] == [
        "yargitay-2025-5678",
    ]

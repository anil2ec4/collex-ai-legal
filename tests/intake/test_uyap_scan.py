# -*- coding: utf-8 -*-
"""W22 — "UYAP'tan indirdiğim klasörü dosyalarıma dağıt": the READ-ONLY scan.

What is pinned here:

* every value is read from the document with its quoted span, and the span
  really is that text in the canonical text ``process_file`` would store
  (or in the file NAME when the source says so);
* the content wins over the file name, and a disagreement is reported, never
  resolved silently;
* numbers that belong to OTHER files — a cited Yargıtay decision, "dava
  tarihi" — are never read as this document's esas, karar or date;
* a .zip download is opened one level deep through the SAME quarantine ZIP
  gates, and nothing about those gates is relaxed for it;
* the scan never touches the database (it runs against an unreachable DSN).

The fixtures are SENTETİK (tests/intake/uyap_fixtures.py). These tests need
no database.
"""

from __future__ import annotations

import hashlib
import io
import json
import unicodedata
import zipfile
from pathlib import Path

import pytest

from intake import cli, extract, quarantine, uyap
from intake.errors import InvalidRequestError, NotFoundError, UnsupportedTypeError
from tests.intake.uyap_fixtures import documents, write_download, zip_download

UNREACHABLE_DSN = "postgresql://postgres@127.0.0.1:1/collex_nowhere"


@pytest.fixture()
def download(tmp_path: Path) -> Path:
    folder = tmp_path / "UYAP-indirilen"
    write_download(folder)
    return folder


def _rows(result: dict) -> dict[str, dict]:
    return {row["path"]: row for row in result["documents"]}


def _canonical(path: Path) -> str:
    data = path.read_bytes()
    verified = quarantine.verify_upload(path.name, data)
    return unicodedata.normalize("NFC", extract.extract_text(verified.kind, data, None).text)


def _value(field: dict | None) -> str | None:
    if field is None:
        return None
    return field.get("value", field.get("code"))


def test_the_whole_download_is_read_document_by_document(download: Path) -> None:
    result = uyap.scan(download)
    rows = _rows(result)
    assert result["container"] == "dir"
    assert result["readerVersion"] == uyap.READER_VERSION
    assert result["skipped"] == ["index.html"]
    assert result["total"] == 11 == len(rows)

    expected = {
        # path: (court, esas, esas source, karar, type, date)
        "Tensip Zaptı.udf": ("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "content", None, "tensip_zapti", "2024-02-14"),
        "2024-123 E. Tebligat.pdf": ("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "filename", None, "tebligat", "2024-02-21"),
        "2024-124 Esas Duruşma Tutanağı.udf": ("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "content", None, "durusma_tutanagi", "2024-06-12"),
        "Bilirkişi Raporu.pdf": ("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "content", None, "bilirkisi_raporu", "2024-09-03"),
        "ekler/Bilirkişi Raporu (kopya).pdf": ("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "content", None, "bilirkisi_raporu", "2024-09-03"),
        "Gerekçeli Karar.udf": ("İSTANBUL 12. ASLİYE TİCARET MAHKEMESİ", "2023/456", "content", "2025/88", "gerekceli_karar", "2025-10-15"),
        "Cevap Dilekçesi.udf": ("ANKARA 3. İŞ MAHKEMESİ", "2025/77", "content", None, "dilekce", "2025-03-15"),
        "Müzekkere Cevabı.pdf": ("İZMİR 4. ASLİYE HUKUK MAHKEMESİ", "2024/500", "content", None, "muzekkere_cevabi", "2024-05-20"),
        "2024-500 E. ek belge.txt": (None, "2024/500", "filename", None, None, None),
        "2024-123 E. taranmış evrak.pdf": (None, "2024/123", "filename", None, None, None),
        "Vekaletname.pdf": (None, None, None, None, "vekaletname", None),
    }
    for path, (court, esas, esas_source, karar, doc_type, doc_date) in expected.items():
        reading = rows[path]["reading"]
        assert _value(reading["court"]) == court, path
        assert _value(reading["esas"]) == esas, path
        if esas is not None:
            assert reading["esas"]["source"] == esas_source, path
        assert _value(reading["karar"]) == karar, path
        assert _value(reading["documentType"]) == doc_type, path
        assert _value(reading["documentDate"]) == doc_date, path


def test_every_content_span_is_the_quote_in_the_text_process_file_stores(download: Path) -> None:
    rows = _rows(uyap.scan(download))
    checked = 0
    for path, row in rows.items():
        reading = row["reading"]
        text = _canonical(download / path) if reading["textRead"] else None
        for key in ("court", "esas", "karar", "documentType", "documentDate"):
            field = reading[key]
            if field is None:
                continue
            haystack = text if field["source"] == "content" else row["name"]
            assert haystack is not None
            assert haystack[field["start"]:field["end"]] == field["quote"], (path, key)
            checked += 1
        name_esas = reading["filename"]["esas"]
        if name_esas is not None:
            assert row["name"][name_esas["start"]:name_esas["end"]] == name_esas["quote"]
    assert checked == 36  # every non-null field of the 11 documents


def test_esas_only_in_the_file_name_is_read_from_the_name(download: Path) -> None:
    row = _rows(uyap.scan(download))["2024-123 E. Tebligat.pdf"]
    esas = row["reading"]["esas"]
    assert esas == {
        "value": "2024/123", "quote": "2024-123 E", "start": 0, "end": 10, "source": "filename",
    }
    assert row["reading"]["esasConflict"] is False


def test_content_wins_over_a_conflicting_file_name_and_both_are_shown(download: Path) -> None:
    reading = _rows(uyap.scan(download))["2024-124 Esas Duruşma Tutanağı.udf"]["reading"]
    assert reading["esas"]["value"] == "2024/123"
    assert reading["esas"]["source"] == "content"
    assert reading["filename"]["esas"]["value"] == "2024/124"
    assert reading["filename"]["esas"]["quote"] == "2024-124 Esas"
    assert reading["esasConflict"] is True


def test_a_cited_decision_is_never_read_as_this_files_number(download: Path) -> None:
    rows = _rows(uyap.scan(download))
    # "Yargıtay 9. Hukuk Dairesi'nin 2019/1234 E. 2020/567 K. sayılı kararı"
    assert rows["2024-124 Esas Duruşma Tutanağı.udf"]["reading"]["karar"] is None
    # "Yargıtay 9. HD'nin 2021/100 E. 2021/200 K." in the petition body
    cevap = rows["Cevap Dilekçesi.udf"]["reading"]
    assert cevap["esas"]["value"] == "2025/77"
    assert cevap["karar"] is None


def test_dava_tarihi_is_not_the_document_date_and_karar_tarihi_wins(download: Path) -> None:
    rows = _rows(uyap.scan(download))
    tensip = rows["Tensip Zaptı.udf"]["reading"]["documentDate"]
    assert tensip["value"] == "2024-02-14"  # TARİH, never DAVA TARİHİ 05/02/2024
    karar = rows["Gerekçeli Karar.udf"]["reading"]["documentDate"]
    assert karar["value"] == "2025-10-15"   # KARAR TARİHİ over YAZIM and DAVA
    assert karar["quote"] == "15/10/2025"


def test_a_page_without_text_is_read_by_its_name_only_and_says_so(download: Path) -> None:
    row = _rows(uyap.scan(download))["2024-123 E. taranmış evrak.pdf"]
    assert row["error"]["kind"] == "EXTRACTION_FAILED"
    assert row["reading"]["textRead"] is False
    assert row["reading"]["court"] is None
    assert row["reading"]["esas"]["source"] == "filename"


def test_sha256_is_the_digest_process_file_records(download: Path) -> None:
    rows = _rows(uyap.scan(download))
    for path, row in rows.items():
        data = (download / path).read_bytes()
        assert row["sha256"] == hashlib.sha256(data).hexdigest()
        if row["error"] is None:
            assert row["sha256"] == quarantine.verify_upload(row["name"], data).sha256
    assert rows["Bilirkişi Raporu.pdf"]["sha256"] == rows["ekler/Bilirkişi Raporu (kopya).pdf"]["sha256"]


# --- readers on single lines -------------------------------------------------


def test_court_reader_edge_cases() -> None:
    assert uyap.read_court("T.C.\nİSTANBUL BÖLGE ADLİYE MAHKEMESİ 9. HUKUK DAİRESİ\nDOSYA NO : 2024/1500")["value"] == (
        "İSTANBUL BÖLGE ADLİYE MAHKEMESİ 9. HUKUK DAİRESİ"
    )
    assert uyap.read_court("İSTANBUL 12. İCRA DAİRESİ'NE\nDOSYA NO : 2024/4567")["value"] == "İSTANBUL 12. İCRA DAİRESİ"
    # A label names the court in its VALUE; "mahkemesinin" is not a court word.
    assert uyap.read_court("Gönderen : İZMİR 2. ASLİYE HUKUK MAHKEMESİ")["value"] == "İZMİR 2. ASLİYE HUKUK MAHKEMESİ"
    assert uyap.read_court("Yukarıda esası yazılı mahkemesinin kararıdır.") is None
    # The first-instance court of an appellate decision is ANOTHER file.
    assert uyap.read_court("İLK DERECE MAHKEMESİ : Bakırköy 3. İş Mahkemesi") is None
    # A cited decision is not the court of this document.
    assert uyap.read_court("Yargıtay 9. Hukuk Dairesi 2019/1234 E.") is None


def test_number_reader_prefers_a_label_and_skips_other_files() -> None:
    text = "BİRLEŞEN DOSYA : 2024/200 E.\nESAS NO : 2024/123\nKARAR NO : 2025/9"
    assert uyap.read_esas(text)["value"] == "2024/123"
    assert uyap.read_karar(text)["value"] == "2025/9"
    assert uyap.read_esas("E. 2024/0123 sayılı dosya")["value"] == "2024/123"
    assert uyap.read_esas("İlk derece mahkemesinin 2023/10 E. sayılı dosyası") is None


def test_file_name_reader() -> None:
    assert uyap.read_filename("2024_123_E_tensip.udf")["esas"]["value"] == "2024/123"
    assert uyap.read_filename("2024_123_E_tensip.udf")["documentType"]["code"] == "tensip_zapti"
    assert uyap.read_filename("E.2024-77 bilirkişi raporu.pdf")["esas"]["value"] == "2024/77"
    assert uyap.read_filename("2024-123 Bilirkişi Raporu.pdf")["esas"]["value"] == "2024/123"
    # A date in a name is not an esas number.
    assert uyap.read_filename("2024-03-15 duruşma tutanağı.pdf")["esas"] is None
    assert uyap.read_filename("evrak.pdf") == {"esas": None, "documentType": None}


def test_fold_is_length_preserving() -> None:
    text = "İSTANBUL ŞİŞLİ ĞÜÇÖ ıi Iİ ǅ ß"
    assert len(uyap.fold(text)) == len(text)


# --- the .zip download -------------------------------------------------------


def test_a_zip_download_is_scanned_like_the_folder(tmp_path: Path, download: Path) -> None:
    archive = tmp_path / "UYAP.zip"
    archive.write_bytes(zip_download())
    stage = tmp_path / "stage"
    result = uyap.scan(archive, stage_dir=stage)
    assert result["container"] == "zip"
    assert result["skipped"] == ["index.html"]
    zipped = _rows(result)
    folder = _rows(uyap.scan(download))
    assert set(zipped) == set(folder)
    for path in folder:
        assert zipped[path]["sha256"] == folder[path]["sha256"]
        assert zipped[path]["reading"] == folder[path]["reading"]


def test_turkish_windows_zip_names_are_decoded(tmp_path: Path) -> None:
    archive = tmp_path / "evrak.zip"
    archive.write_bytes(zip_download({"Bilirkişi Raporu.pdf": documents()["Bilirkişi Raporu.pdf"]}, utf8_names=False))
    with zipfile.ZipFile(archive) as zf:
        assert zf.infolist()[0].flag_bits & 0x800 == 0  # really no UTF-8 flag
    result = uyap.scan(archive, stage_dir=tmp_path / "stage")
    assert [row["name"] for row in result["documents"]] == ["Bilirkişi Raporu.pdf"]


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buffer.getvalue()


def test_container_gates_are_the_quarantine_gates() -> None:
    pdf = documents()["Bilirkişi Raporu.pdf"]
    # nested archive: the whole container is refused
    with pytest.raises(InvalidRequestError, match="iç içe arşiv"):
        quarantine.open_document_container("a.zip", _zip([("a.pdf", pdf), ("ic.zip", _zip([("b.pdf", pdf)]))]))
    # path traversal
    with pytest.raises(InvalidRequestError, match="traversal"):
        quarantine.open_document_container("a.zip", _zip([("../../disari.pdf", pdf)]))
    # compression-ratio bomb
    with pytest.raises(InvalidRequestError, match="arşiv bombası"):
        quarantine.open_document_container("a.zip", _zip([("bomba.txt", b"0" * (2 * 1024 * 1024))]))
    # a document is not a container
    with pytest.raises(UnsupportedTypeError, match="belge arşivi değil"):
        quarantine.open_document_container("x.zip", documents()["Tensip Zaptı.udf"])
    # wrong suffix / not a zip
    with pytest.raises(UnsupportedTypeError):
        quarantine.open_document_container("x.rar", _zip([("a.pdf", pdf)]))
    with pytest.raises(UnsupportedTypeError):
        quarantine.open_document_container("x.zip", pdf)


def test_container_over_the_upload_cap_is_refused_with_the_remedy(monkeypatch: pytest.MonkeyPatch) -> None:
    data = zip_download()
    monkeypatch.setattr(quarantine, "MAX_FILE_BYTES", len(data) - 1)
    with pytest.raises(InvalidRequestError, match="klasörü verin"):
        quarantine.open_document_container("UYAP.zip", data)


def test_each_container_document_still_meets_verify_upload(tmp_path: Path) -> None:
    """A .pdf entry that is really text is refused as that ONE document."""
    archive = tmp_path / "a.zip"
    archive.write_bytes(_zip([("sahte.pdf", b"bu bir PDF degil"), ("Vekaletname.pdf", documents()["Vekaletname.pdf"])]))
    rows = _rows(uyap.scan(archive, stage_dir=tmp_path / "s"))
    assert rows["sahte.pdf"]["error"]["kind"] == "UNSUPPORTED_TYPE"
    assert rows["Vekaletname.pdf"]["error"] is None


def test_stage_dir_must_be_empty_and_zip_needs_one(tmp_path: Path) -> None:
    archive = tmp_path / "a.zip"
    archive.write_bytes(zip_download())
    with pytest.raises(InvalidRequestError):
        uyap.scan(archive)
    stage = tmp_path / "dolu"
    stage.mkdir()
    (stage / "x.txt").write_text("x", encoding="utf-8")
    with pytest.raises(InvalidRequestError):
        uyap.scan(archive, stage_dir=stage)


def test_folder_cap_and_missing_folder(tmp_path: Path, download: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "BATCH_MAX_FILES", 3)
    with pytest.raises(InvalidRequestError, match="en fazla 3"):
        uyap.scan(download)
    with pytest.raises(NotFoundError):
        uyap.scan(tmp_path / "yok")


def test_cli_scan_prints_json_and_never_opens_the_database(download: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = cli.main(["--dsn", UNREACHABLE_DSN, "--uyap-scan", str(download), "--json"])
    body = json.loads(capsys.readouterr().out)
    assert code == 0
    assert body["uyapScan"]["total"] == 11


def test_cli_scan_typed_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = cli.main(["--dsn", UNREACHABLE_DSN, "--uyap-scan", str(tmp_path / "yok"), "--json"])
    assert code == 2
    assert json.loads(capsys.readouterr().out)["error"]["kind"] == "NOT_FOUND"

"""A realistic UYAP Avukat Portal download, built on demand (W22).

SENTETİK TEST VERİSİ: every name, number and party below is invented for the
tests; none of it is a real file, person or court record.

The documents imitate what a lawyer actually downloads from UYAP for an iş
davası and its neighbours — the first-page layout ("T.C." / city / court on
separate lines, "ESAS NO :" labels), the petition layout ("…MAHKEMESİ'NE",
role labels, the date alone above the signature), an institution's reply
("İlgi : … müzekkereniz"), a tebliğ mazbatası without any esas number, file
names that carry the esas number ("2024-123 E. Tebligat.pdf") or a WRONG one,
a copy of the same bytes, a page without a text layer, a side-car .html —
because the reader was written for the real layout, not for a tidy fixture
(W17/b: the code that passed every synthetic test failed on the first real
petition).

The matters the tests register (see ``MATTERS``) make each case decidable:

  Tensip Zaptı.udf                       esas in CONTENT only       -> M1
  2024-123 E. Tebligat.pdf               esas in FILE NAME only     -> M1
  2024-124 Esas Duruşma Tutanağı.udf     name 2024/124, content
                                         2024/123: content wins     -> M1
  Bilirkişi Raporu.pdf                   addressed report           -> M1
  ekler/Bilirkişi Raporu (kopya).pdf     same bytes: duplicate
  Gerekçeli Karar.udf                    ANOTHER matter             -> M2
  Cevap Dilekçesi.udf                    no such matter: unmatched
  Müzekkere Cevabı.pdf                   esas 2024/500 exists in two
                                         courts; the reply names one -> M4
  2024-500 E. ek belge.txt               same esas, no court: ambiguous
  2024-123 E. taranmış evrak.pdf         no text layer: name only
  Vekaletname.pdf                        no esas anywhere: no_esas
  index.html                             not a document: skipped

Run as a script to write the folder (used by the control-plane's real
integration test):

    .venv/bin/python -m tests.intake.uyap_fixtures <empty folder>

prints ``{"files": {"<relative path>": "<sha256>", ...}}``.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

if __package__ in (None, ""):  # pragma: no cover - script mode
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.intake.pdf_fixtures import build_multipage_pdf  # noqa: E402

#: The lawyer's matters the fixtures are matched against.
MATTERS = [
    {"key": "M1", "title": "Yılmaz / Örnek Lojistik — işçilik alacağı",
     "court": "İstanbul Anadolu 5. İş Mahkemesi", "docketNo": "2024/123 E."},
    {"key": "M2", "title": "Beta Yapı / Gama İnşaat — alacak",
     "court": "İstanbul 12. Asliye Ticaret Mahkemesi", "docketNo": "2023/456 Esas"},
    {"key": "M3", "title": "Kara / Deniz — tapu iptali",
     "court": "İzmir 2. Asliye Hukuk Mahkemesi", "docketNo": "2024/500 E."},
    {"key": "M4", "title": "SGK tespit davası",
     "court": "İzmir 4. Asliye Hukuk Mahkemesi", "docketNo": "E. 2024/500"},
]

TENSIP = """T.C.
İSTANBUL ANADOLU
5. İŞ MAHKEMESİ

TENSİP ZAPTI

ESAS NO : 2024/123
TARİH : 14/02/2024

HAKİM : Ayşe Demir 104512
KATİP : Mehmet Kaya 208877

DAVACI : Ali Yılmaz
VEKİLİ : Av. Zeynep Arslan
DAVALI : Örnek Lojistik A.Ş.

DAVA : İşçilik Alacağı
DAVA TARİHİ : 05/02/2024

Mahkememizin yukarıda esas numarası yazılı dava dosyasının incelenmesinde;
1- Dava dilekçesinin ve tensip zaptının davalı tarafa tebliğine,
2- Davacının SGK hizmet dökümünün celbi için müzekkere yazılmasına,
3- Ön inceleme duruşmasının 12/06/2024 günü saat 10:30'da yapılmasına karar verildi.
"""

TEBLIGAT_LINES = [
    "TEBLİĞ MAZBATASI",
    "Gönderen : İSTANBUL ANADOLU 5. İŞ MAHKEMESİ",
    "Muhatap : Örnek Lojistik A.Ş.",
    "Tebliğ Tarihi : 21.02.2024",
    "Tebliğ edilen evrak: Dava dilekçesi ve tensip zaptı",
    "Muhataba bizzat imzası alınarak tebliğ edildi.",
]

DURUSMA = """T.C.
İSTANBUL ANADOLU
5. İŞ MAHKEMESİ

ÖN İNCELEME DURUŞMA TUTANAĞI

ESAS NO : 2024/123
CELSE : 1   TARİH : 12/06/2024

HAKİM : Ayşe Demir 104512
KATİP : Mehmet Kaya 208877

Belirli günde açık yargılamaya başlandı. Davacı vekili ile davalı vekili geldi.
Taraflar sulh olmadıklarını beyan ettiler.
Davacı vekili, Yargıtay 9. Hukuk Dairesi'nin 2019/1234 E. 2020/567 K. sayılı kararına atıf yaptı.
GEREĞİ DÜŞÜNÜLDÜ: Dosyanın bilirkişiye tevdiine karar verildi.
"""

BILIRKISI_LINES = [
    "İSTANBUL ANADOLU 5. İŞ MAHKEMESİ SAYIN HAKİMLİĞİ'NE",
    "DOSYA NO : 2024/123 Esas",
    "BİLİRKİŞİ RAPORU",
    "DAVACI : Ali Yılmaz",
    "DAVALI : Örnek Lojistik A.Ş.",
    "Rapor Tarihi : 03.09.2024",
    "Davacının kıdem tazminatı alacağı hesaplanmıştır.",
    "Bilirkişi Dr. Selim Uçar",
]

GEREKCELI = """T.C.
İSTANBUL
12. ASLİYE TİCARET MAHKEMESİ

GEREKÇELİ KARAR

ESAS NO : 2023/456
KARAR NO : 2025/88

HAKİM : Burak Er 99812
KATİP : Selin Ak 77120

DAVACI : Beta Yapı Ltd. Şti.
DAVALI : Gama İnşaat A.Ş.
DAVA : Alacak
DAVA TARİHİ : 10/03/2023
KARAR TARİHİ : 15/10/2025
YAZIM TARİHİ : 20/10/2025

Mahkememizde görülen dava sonunda, Yargıtay 11. HD 2018/77 E. 2019/88 K. içtihadı gözetilerek;
HÜKÜM : Davanın kısmen kabulüne karar verildi.
"""

CEVAP = """ANKARA 3. İŞ MAHKEMESİ'NE

DOSYA NO : 2025/77 E.

CEVAP VEREN (DAVALI) : Delta Gıda A.Ş.
VEKİLİ : Av. Deniz Şahin
DAVACI : Can Öztürk
KONU : Dava dilekçesine karşı cevaplarımızın sunulmasıdır.

AÇIKLAMALAR :
1- Davacının iddiaları yerinde değildir. Yargıtay 9. HD'nin 2021/100 E. 2021/200 K. sayılı kararı da bu yöndedir.
2- Fazla mesai iddiası 14.03.2024 tarihli bordro ile çelişmektedir.

SONUÇ VE İSTEM : Davanın reddine karar verilmesini saygıyla arz ederiz.

15.03.2025
Davalı Vekili
Av. Deniz Şahin
"""

MUZEKKERE_LINES = [
    "T.C.",
    "SOSYAL GÜVENLİK KURUMU BAŞKANLIĞI",
    "İzmir Sosyal Güvenlik İl Müdürlüğü",
    "Sayı : 12345678-000-99",
    "Konu : Sigortalılık kayıtları",
    "İZMİR 4. ASLİYE HUKUK MAHKEMESİ'NE",
    "İlgi : 2024/500 Esas sayılı dosyanız için yazılan 02.05.2024 tarihli müzekkereniz.",
    "İlgi yazınız gereği sigortalılık kayıtları ekte gönderilmiştir.",
    "Tarih : 20.05.2024",
]

EK_BELGE = """Ekte sunulan fatura dökümü

Fatura No 2024-000781, tutar 12.500,00 TL, vade 30 gün.
Fatura No 2024-000782, tutar 8.250,00 TL, vade 30 gün.
"""

VEKALETNAME_LINES = [
    "VEKALETNAME",
    "Ben, Ali Yılmaz, Av. Zeynep Arslan'ı vekil tayin ettim.",
    "İşbu vekaletname ile her türlü dava ve takibi yürütmeye yetkilidir.",
]


def udf_bytes(text: str) -> bytes:
    """A UDF as UYAP writes it: a ZIP whose content.xml carries the text in
    one CDATA block (the shape ``export/udf.py`` and ``extract_udf`` share)."""
    body = text.replace("]]>", "]]]]><![CDATA[>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<template format_id="1.8">\n'
        f"<content><![CDATA[{body}]]></content>\n"
        '<properties><pageFormat mediaSizeName="1" leftMargin="70.87" '
        'rightMargin="70.87" topMargin="56.69" bottomMargin="56.69"/></properties>\n'
        '<elements resolver="hvl-default"><paragraph>'
        f'<content startOffset="0" length="{len(text)}"/></paragraph></elements>\n'
        "</template>\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo("content.xml", date_time=(2024, 1, 1, 0, 0, 0))
        zf.writestr(info, xml.encode("utf-8"))
    return buffer.getvalue()


def documents() -> dict[str, bytes]:
    """Relative path -> bytes of the whole download."""
    bilirkisi = build_multipage_pdf([BILIRKISI_LINES])
    return {
        "Tensip Zaptı.udf": udf_bytes(TENSIP),
        "2024-123 E. Tebligat.pdf": build_multipage_pdf([TEBLIGAT_LINES]),
        "2024-124 Esas Duruşma Tutanağı.udf": udf_bytes(DURUSMA),
        "Bilirkişi Raporu.pdf": bilirkisi,
        "ekler/Bilirkişi Raporu (kopya).pdf": bilirkisi,
        "Gerekçeli Karar.udf": udf_bytes(GEREKCELI),
        "Cevap Dilekçesi.udf": udf_bytes(CEVAP),
        "Müzekkere Cevabı.pdf": build_multipage_pdf([MUZEKKERE_LINES]),
        "2024-500 E. ek belge.txt": EK_BELGE.encode("utf-8"),
        "2024-123 E. taranmış evrak.pdf": build_multipage_pdf([[]]),
        "Vekaletname.pdf": build_multipage_pdf([VEKALETNAME_LINES]),
        "index.html": b"<html><body>UYAP evrak listesi</body></html>",
    }


def write_download(folder: Path) -> dict[str, str]:
    """Write the download under ``folder``; returns path -> sha256."""
    manifest: dict[str, str] = {}
    for rel, data in documents().items():
        target = folder / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        manifest[rel] = hashlib.sha256(data).hexdigest()
    return manifest


class _OemZipInfo(zipfile.ZipInfo):
    """An entry whose name is stored in the OEM code page WITHOUT the UTF-8
    flag — what a Turkish Windows "Sıkıştırılmış klasör" writes."""

    def _encodeFilenameFlags(self):  # noqa: N802 - zipfile's own name
        return self.filename.encode("cp437"), self.flag_bits & ~0x800


def zip_download(entries: dict[str, bytes] | None = None, *, utf8_names: bool = True) -> bytes:
    """The same download as ONE .zip (what "Tümünü indir" gives)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in (entries if entries is not None else documents()).items():
            if utf8_names:
                info = zipfile.ZipInfo(rel, date_time=(2024, 1, 1, 0, 0, 0))
            else:
                # cp857 bytes, carried through zipfile as their cp437 reading.
                info = _OemZipInfo(rel.encode("cp857").decode("cp437"),
                                   date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)
    return buffer.getvalue()


if __name__ == "__main__":  # pragma: no cover - used by the TS real test
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"files": write_download(out)}, ensure_ascii=False))

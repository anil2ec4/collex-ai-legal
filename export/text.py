"""Turkish strings shared by every export format.

Keeping the wording in one place means the DOCX and the Markdown deliverable
make the SAME promises to the reader — including the two non-negotiable ones:
the document is machine-generated and needs a lawyer's review (brief 11.5),
and synthetic corpus data is labelled ``SENTETİK`` wherever a human can see
it (repo honesty rule).
"""

from __future__ import annotations

import re

from export.bundle import EvidenceBundle

# --------------------------------------------------------------------------
# Mandatory notices
# --------------------------------------------------------------------------

#: Footer printed on EVERY page of every exported document (brief 11.5).
LAWYER_REVIEW_FOOTER = (
    "MAKİNE ÜRETİMİ BELGE — AVUKAT İNCELEMESİ ZORUNLUDUR. "
    "Bu metin hukukî mütalaa değildir ve olduğu gibi kullanılamaz."
)

#: Longer version of the same warning, shown once near the top of the body.
LAWYER_REVIEW_NOTICE = (
    "Bu belge, kaynakları ve alıntılarıyla birlikte makine tarafından"
    " üretilmiştir. Hukukî mütalaa yerine geçmez; her tespit, her atıf ve her alıntı dosyadan"
    " sorumlu avukat tarafından incelenmeden kullanılamaz. Sistem kullanıcı"
    " adına imza atmaz, UYAP'a evrak göndermez, e-imza şifrenizi veya"
    " kartınızı işlemez ve imzalı UDF üretmez."
)

#: Shown, prominently, whenever the bundle declares itself synthetic.
SYNTHETIC_BANNER = (
    "DENEME VERİSİ — Bu belgedeki kaynaklar gerçek Türk mevzuatı veya gerçek"
    " mahkeme kararları DEĞİLDİR; yalnızca programı denemek için üretilmiş"
    " örnek metinlerdir. Hiçbir hukukî işlemde dayanak yapılamaz."
)

SYNTHETIC_FOOTER_TAG = "DENEME VERİSİ"

ABSTENTION_TEXT = (
    "Bu soru için elimizdeki kaynaklarda doğrulanabilir bir dayanak bulunamadı."
    " Doğrulayamadığımız bir içeriği yazmak yerine cevap vermiyoruz; aşağıda"
    " hangi kaynakların neden kullanılamadığı yazılıdır."
)

# --------------------------------------------------------------------------
# Section titles — the export layout contract
# --------------------------------------------------------------------------

TITLE = "Hukukî Araştırma Cevabı — Kanıt Paketi"
H_META = "Belge Künyesi"
H_TECH_META = "Teknik künye"
H_BODY = "Cevap Gövdesi"
H_CONFIDENCE = "Her Sonucun Ne Kadar Sağlam Dayandığı"
H_CONFLICT = "Çelişen Otoriteler"
H_ABSTAIN = "Dayanak Bulunamayan Sonuçlar"
CONFIDENCE_NOTE = (
    "Bu yüzdeler programın kendi ölçümüdür, doğruluk garantisi değildir;"
    " düşük değerli satırlardaki kaynağı mutlaka kendiniz okuyun."
)

H_REASONS = "Hangi Kaynak Neden Kullanılamadı"
H_SOURCES = "KAYNAKLAR"
H_VERIFY = "DOĞRULAMA"

# --------------------------------------------------------------------------
# Enum translations (mirrors control-plane/src/answer/renderer.ts)
# --------------------------------------------------------------------------

STATUS_TR = {
    "COMPLETE": "TAM — her sonuç bir kaynağa bağlandı",
    "QUALIFIED": (
        "KAYNAKLI, ANCAK ÇEKİNCELİ — her sonuç bir kaynağa dayanıyor, ancak"
        " kaynaklar arasında çelişki veya çekince var"
    ),
    "PARTIAL": "KISMİ — bazı sonuçların kaynağı doğrulanamadı",
    "ABSTAIN": (
        "DAYANAK BULUNAMADI (ÇEKİMSER) — dayanak bulunamadığı için cevap"
        " yazılmadı"
    ),
}

#: Shared finalizability wording (terim sözlüğü — her yüzeyde aynen).
FINALIZE_OK = (
    "Teknik kontroller tamamlandı — nihai hukukî değerlendirme avukatındır"
)
FINALIZE_BLOCKED = (
    "KULLANIMA HAZIR DEĞİL — en az bir kaynak denetimi tutmadı; aşağıdaki"
    " gerekçeleri okumadan kullanmayın"
)

VERDICT_TR = {
    "SUPPORTED": "DESTEKLENİYOR",
    "QUALIFIED": "ŞERHLİ",
    "CONFLICTING_AUTHORITIES": "ÇELİŞEN OTORİTELER",
    "INSUFFICIENT_EVIDENCE": "YETERSİZ KANIT",
    "OUT_OF_DATE_SOURCE": "GÜNCEL OLMAYAN KAYNAK",
    "PARTIAL_SOURCE_COVERAGE": "KISMİ KAYNAK KAPSAMI",
}

TREATMENT_TR = {
    "supported": "destekleniyor",
    "qualified": "şerhli",
    "conflicted": "çelişkili",
    "unsupported": "kaynaksız",
}

CURRENTNESS_TR = {
    "IN_FORCE": "yürürlükte",
    "OUT_OF_DATE": "güncel değil",
    "REPEALED": "mülga",
    "NOT_YET_IN_FORCE": "henüz yürürlükte değil",
    "UNKNOWN": "bilinmiyor",
    # W12-B2: an UPLOADED document (evidence origin "upload") is not
    # legislation or case law, so the yürürlük question does not apply. Same
    # label as CURRENTNESS_NOT_APPLICABLE_LABEL_TR in renderer.ts and the
    # console chip — one wording on every surface.
    "NOT_APPLICABLE": "yüklediğiniz belge — yürürlük değerlendirilemez",
}

#: Turkish name of an evidence source code (W15 · belge-ciktilari P1/157).
#: The appendix used to print the raw machine code ("YARGITAY_BEDESTEN",
#: "MEVZUAT_GOV") straight into the petition. Mirrors SOURCE_LABEL_TR in
#: control-plane/src/drafting/appendix.ts — the two change together.
SOURCE_LABEL_TR = {
    "UPLOAD": "Dosyaya eklediğiniz belge",
    "MEVZUAT": "Resmî mevzuat metni (mevzuat.gov.tr)",
    "MEVZUAT_GOV": "Resmî mevzuat metni (mevzuat.gov.tr)",
    "YARGITAY": "Yargıtay karar bankası",
    "YARGITAY_BEDESTEN": "Yargıtay karar bankası",
    "DANISTAY": "Danıştay karar bankası",
    "DANISTAY_BEDESTEN": "Danıştay karar bankası",
    "ISTINAF_HUKUK": "Bölge adliye mahkemesi (istinaf) kararları",
    "YEREL_HUKUK": "Yerel hukuk mahkemesi kararları",
    "KYB": "Kanun yararına bozma kararları",
    "EMSAL": "UYAP emsal karar arama",
    "UYUSMAZLIK": "Uyuşmazlık Mahkemesi kararları",
    "AYM": "Anayasa Mahkemesi kararları",
    "KIK": "Kamu İhale Kurulu kararları",
    "KVKK": "Kişisel Verileri Koruma Kurulu kararları",
    "REKABET": "Rekabet Kurumu kararları",
    "SAYISTAY": "Sayıştay kararları",
    "BDDK": "BDDK kararları",
    "BTK": "BTK kararları",
    "GIB": "Gelir İdaresi Başkanlığı özelgeleri",
    "SIGORTA": "Sigorta Tahkim Komisyonu kararları",
}


def source_label_tr(source: str) -> str:
    """Turkish name of a source code; an unknown code is returned unchanged.

    A source name is never invented — only translated when we know it.
    """
    return SOURCE_LABEL_TR.get(source, source)


#: "Sonuç yönü" wording (terim sözlüğü): raw enum values are never shown to
#: the reader; an unknown value falls through unchanged (sözlükte olmayan kod
#: olduğu gibi kalır).
SONUC_YONU_TR = {
    "supporting": "talebi destekliyor",
    "contrary": "talebin aksine",
    "neutral": "yön belirtmez (norm metni)",
}

# --------------------------------------------------------------------------
# The verification recipe — the differentiator, stated for a human reader
# --------------------------------------------------------------------------

VERIFY_INTRO = (
    "Bu belgedeki her alıntı, kaynağına makine ile geri bağlanabilir. Bir"
    " alıntıyı bağımsız olarak doğrulamak için aşağıdaki adımları izleyin;"
    " hiçbir adımda bu sisteme güvenmeniz gerekmez."
)

VERIFY_STEPS = (
    "KAYNAKLAR bölümündeki girişte, alıntının hangi kaynağın hangi tarihli"
    " metninden alındığı yazılıdır. Kaynağı kendi resmî sitesinden aynı"
    " tarihli metinle açın.",
    "Kaynaktan aldığınız metnin, bu belgedeki alıntının alındığı metin olup"
    " olmadığını program otomatik denetler; denetim tutmazsa belge hiç"
    " üretilmez. Elle bakmak isterseniz kaynaktaki paragrafı bu belgedeki"
    " alıntı kutusuyla karşılaştırın: harfi harfine aynı olmalıdır.",
    "Alıntının kaynak metnin neresinden alındığı, KAYNAKLAR bölümündeki"
    " girişte yazılıdır. O yeri açın ve alıntıyı gözünüzle karşılaştırın.",
    "Karşılaştırma tutmuyorsa o alıntıyı kullanmayın ve durumu bildirin."
    " Doğrulanamayan bir alıntı, hiç alıntı olmamasından daha tehlikelidir.",
)

VERIFY_SELF_CHECK = (
    "Bu dosya yazılmadan önce her alıntı, alındığı kaynak metinle otomatik"
    " olarak karşılaştırıldı: alıntının bozulmadığı, her atfın belgedeki bir"
    " kaynağa karşılık geldiği ve yazılan atıf numaralarıyla KAYNAKLAR"
    " girişlerinin birebir örtüştüğü denetlendi. Bu denetimlerden biri bile"
    " tutmasaydı dosya hiç oluşturulmazdı."
)

UDF_NOTICE = (
    "Bu belge Word dosyası olarak üretilir. Son düzenleme ve imzalama, güncel"
    " resmî UYAP Doküman Editörü'nde yapılmalıdır. Program imzalı UDF üretmez,"
    " imzalanmış bir evrakı yeniden üretmez ve e-imza şifrenizi veya kartınızı"
    " talep etmez."
)

#: The same limit, worded for the INSIDE of a .udf file (W12-FIX): a UDF
#: that says "this document is produced as DOCX" contradicts itself.
UDF_FILE_NOTICE = (
    "Bu UDF dosyası deneyseldir ve imzasızdır; son düzenleme ve imzalama,"
    " güncel resmî UYAP Doküman Editörü'nde yapılmalıdır. Program imzalı UDF"
    " üretmez, imzalanmış bir evrakı yeniden üretmez ve e-imza şifrenizi veya"
    " kartınızı talep etmez."
)

NO_CITATION_IN_ABSTENTION = (
    "Dayanak bulunamadığında KAYNAKLAR bölümü bilerek BOŞ bırakılır:"
    " denetimden geçmemiş kaynakları numaralandırıp alıntılamak, olmayan bir"
    " dayanağı varmış gibi gösterirdi."
)

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

_ISO_DATE = re.compile(r"\A(\d{4})-(\d{2})-(\d{2})\Z")


def human_date(value: str) -> str:
    """``2024-05-12`` -> ``12.05.2024`` (Türk teamülü GG.AA.YYYY).

    Full ISO timestamps are delegated to :func:`human_timestamp`; anything
    unparseable is returned unchanged — a date must never be silently
    invented or dropped just because it did not match a pattern.
    """
    match = _ISO_DATE.match(value.strip())
    if match:
        year, month, day = match.groups()
        return f"{day}.{month}.{year}"
    return human_timestamp(value)


def human_timestamp(value: str) -> str:
    """ISO timestamp -> ``GG.AA.YYYY HH:MM`` in the reader's LOCAL time.

    W12-FIX2 (P2-5): a zone-carrying stamp (``Z`` / ``+03:00``) is converted
    to the machine's local time — ``02.09.2026 14:02`` on the lawyer's wall
    clock, no zone tag; a naive stamp is printed as is. ISO stays available
    in the Teknik künye; this is the human line. Values that do not parse
    are returned unchanged. The TS side (``drafting/input.ts``
    ``formatTimestampTr``) renders the same shape.
    """
    from datetime import datetime

    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return value
    if parsed.utcoffset() is not None:
        parsed = parsed.astimezone()
    return f"{parsed.day:02d}.{parsed.month:02d}.{parsed.year:04d} {parsed.hour:02d}:{parsed.minute:02d}"


_SAFE_URL = re.compile(r"\Ahttps?://", re.IGNORECASE)
UNSAFE_URL_PLACEHOLDER = "(güvenli olmayan URL gizlendi)"


def safe_url(url: str) -> str:
    """Only http(s) URLs are shown; anything else is replaced.

    Mirrors ``renderSourceCard`` in the TypeScript renderer: retrieved URLs
    are untrusted content and must never become a ``javascript:``/``data:``
    target in a document a lawyer clicks through.
    """
    return url if _SAFE_URL.match(url) else UNSAFE_URL_PLACEHOLDER


def pct(value: float) -> str:
    """Render a [0,1] confidence as a Turkish percentage string."""
    clamped = min(1.0, max(0.0, value))
    return f"%{round(clamped * 100)}"


def short_hash(digest: str, size: int = 12) -> str:
    return digest[:size] + "…" if len(digest) > size else digest


def synthetic_notice(bundle: EvidenceBundle) -> str | None:
    """The banner to show for a synthetic bundle, or ``None``."""
    if not bundle.synthetic:
        return None
    if bundle.synthetic_notice:
        return f"{SYNTHETIC_BANNER} Paket notu: {bundle.synthetic_notice}"
    return SYNTHETIC_BANNER

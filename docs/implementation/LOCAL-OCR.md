# Yerel OCR (W20)

Taranmış bir PDF sayfasının metin katmanı yoktur. W19'a kadar böyle bir sayfa
dürüstçe **OKUNAMADI** (`UNREADABLE_NO_TEXT`) olarak işaretlenir ve "dosyanın
tamamı okundu" iddiasını engellerdi. W20 bu davranışı korur ve yanına **yerel**
bir OCR sınırı ekler (`intake/ocr.py`).

## Ne değişti, ne değişmedi

| Durum | Sonuç |
|---|---|
| Makinede yerel OCR yok (varsayılan) | Aynen W19: sayfa `UNREADABLE`, kapsam eksik, tamamen taranmış PDF kapalı başarısız olur ("taranmış PDF — OCR bu modda devre dışı"). |
| Yerel OCR var ve sayfayı okudu | Metin sayfanın **kendi yuvasına** yazılır (aynı sayfa numarası, `extraction_method = 'ocr'`, motorun güven puanı). Alıntılar yine "s. N" olarak o fiziksel sayfayı gösterir; ayrı bir "OCR kopyası" belge oluşmaz. |
| Güven puanı düşük (< 0,60) | Sayfa `SPARSE` kaydedilir: okunmuş sayılır ama doğrulanmış sayılmaz; dosya incelemesi `OCR_LOW_CONFIDENCE` boşluğu yazar ve "tamamı okundu" demez. |
| OCR sayfayı okuyamadı | Sayfa `UNREADABLE` kalır; uyarıda sayfa numarasıyla yazar. |

Bulut OCR (POST `/v1/ai/ocr`) ayrı, açık rıza isteyen bir özelliktir ve
`COLLEX_DATA_BOUNDARY=LOCAL_ONLY` altında reddedilir. Yerel OCR hiçbir ağ
çağrısı yapmaz.

## Kurulum (Windows, isteğe bağlı)

Bu depo hiçbir şeyi kendiliğinden kurmaz veya indirmez. Yerel OCR için iki
program gerekir:

1. **Tesseract** (Türkçe dil verisiyle): `scoop install tesseract` ve
   `tesseract-languages` ya da UB Mannheim yükleyicisi; kurulumdan sonra
   `tesseract --list-langs` çıktısında `tur` görünmelidir.
2. **Poppler** (`pdftoppm`): `scoop install poppler`.

İkisi `PATH` üzerindeyse ColleX onları kendiliğinden bulur
(`COLLEX_OCR=auto`, varsayılan). Kapatmak için `COLLEX_OCR=off`.

Denetim:

```bash
.venv/Scripts/python.exe -c "from intake.ocr import detect_ocr_capability; print(detect_ocr_capability())"
```

## Bu makinedeki durum (11.09.2026)

`tesseract` ve `pdftoppm` kurulu değil → yerel OCR **kapalı**. Sahte bir
sağlayıcıyla yapılan testler (`tests/intake/test_ocr.py`) sınırın ve sayfa
eşlemesinin doğru çalıştığını kanıtlar; gerçek bir tek sayfa OCR sınaması bu
makinede **çalıştırılamadı** (ortam engeli) ve test raporunda "skipped" olarak
görünür, geçti olarak değil.

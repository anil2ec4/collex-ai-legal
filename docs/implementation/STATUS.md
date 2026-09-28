# Current status

## 28.09.2026 — W23: rakiplerin sattığı iş akışları, açık listenin kapanışı, yeni kabuk

W22'nin açık bıraktığı kod maddelerinin hepsi kapandı; Apilex ve De Jure'nin
sattığı ama ColleX'te olmayan iş akışları eklendi; konsol modern bir
uygulama kabuğuna geçti. Beş özellik ve dört düzeltme işçisi yalıtılmış
çalışma kopyalarında çalıştı, her iş bu oturumda birleştirilip yeniden
ölçüldü; her düzeltmenin düzeltmeden ÖNCE düşen bir testi var. Ortam:
Linux, PostgreSQL 16, Node 22, Python 3.11.

Araç yüzeyi aynı (54 / anahtarla 55), migrasyon eklenmedi (19), RLS aynı
(32). Yeni kalıcı durum (mevzuat izleme karşılaştırma noktaları) mevcut
`app_private.settings` jsonb'sinde durur. Sözleşme değişiklikleri eklemeli.

**Rakip araştırması, dürüst sınırıyla:** Apilex ve De Jure sitelerine bu
ortamdan erişilemedi (ağ politikası, 403); bulgular arama motoru özetlerine
dayanır ve biri uydurma çıktı (`scratchpad/competitors-2026-09.md` oturuma
özeldir). Özetlere göre Apilex artık kendi sunucunuza kurulum (on-premise),
Word eklentisi ve UYAP'ı eşitleyen bir tarayıcı eklentisi satıyor; bu yüzden
"tek yerel ürün" iddiası tek başına artık yazılmaz. ColleX'in farkı: kanıttan
tebliğe, tebliğden süreye, süreden takvime, dilekçeye, atıf denetimine ve
NİHAİ kopyaya giden zincirin her halkası kaynağına bağlı; kimlik bilgisi,
kota, uzaktan kurulum yok.

### Ölçüldü (28.09.2026, W23 kapanışı — makine boştayken, sırayla)

| # | Ne | Sonuç | Başarısız |
|---|---|---|---|
| W23-1 | `npx tsc --noEmit` | temiz | 0 |
| W23-2 | `npx vitest run` | 223 dosya · **4149 geçti** · 9 atlandı (8 ters işaretleyici — gerçek takımlar koştu — + yerel E5 model dosyaları yok) | 0 |
| W23-3 | `pytest tests evals/tests` | **1905 geçti · 0 atlandı** | 0 |
| W23-4 | `db_local_check.py` | 19/19 PASS | 0 |
| W23-5 | `smoke_check.py` · `http_e2e_check.py` · `live_local_gateway_check.py` | 54 araç · 54 araç HTTP'de · PASSED | 0 |
| W23-6 | `run_evals.py --repeats 4` (SENTETİK) | RESULT: PASS · bant genişliği sıfır (4 tekrar / 4 ingest aynı) · Recall@5 0,9429 · ABSTAIN 14 · COMPLETE 11 · PARTIAL 3 · QUALIFIED 6 · yanlış cevap 0 · kesinleştirilebilir %81,0 — W22-6 ile aynı; cevap biçimi sıralaması (aşağıda C) cevap katmanını değiştirmedi, yalnız `fx-amend-003`'e doğru bir `ANSWER_SHAPE_NOT_FOUND:DATE` uyarısı ekledi | 0 |
| W23-7 | `demo.mjs` | 6/6 senaryo | 0 |
| W23-8 | OpenAPI | **90 yol · 108 işlem · 195 şema** · CR baytı 0 (W22-8: 82 · 99 · 164) | — |
| W23-9 | Konsol, gerçek Chromium: 17 görünüm × 1440/1100/1024/820/390/360 px açık + 1440/390 koyu; ayrıca dosya sayfası (Dosya incelemesi) ve Belgeler kartları | 136 ölçümde yatay taşma **0**, sayfa hatası (JS) **0** | 0 |
| W23-10 | Şablon formu, aynı satırdaki girişlerin dikey kayması, 14 şablon × 1440/1280/1024/820 px | **22–23 px → 0 px** | 0 |
| W23-11 | "Çelişkileri bul", incelemecinin 9 belgelik iş davası dosyası (W22-16'nın dosyası) | işe giriş 2018↔2019 çiftleri **9/12 → 12/12** (ek beyanla 16/16) · net ücret, bordro dahil **9/12 → 12/12** · tebliğ 1/1 · yanlış çelişki **0 → 0** · karşılaştırılmayan değer (karar tarihi, "şimdilik") 5 → 5 | — |
| W23-12 | MCP hata yanıtlarında sürücü/TLS/üst kaynak metni (her araç × SSL, bağlantı, zaman aşımı, 5xx, bozuk gövde) | sızıntı **104 (+14 anahtarlı) → 0**; hata sayfasının belge metni olarak dönmesi 7 → 3 (işaretsiz, başlıksız çıplak `<html>` sayfası: KİK, Sayıştay, BDDK-html — ayırt edilemez, modül bunu yazar); sertifika doğrulaması kapalı istemci **7 → 0** (boş liste bir testle sabit) | — |
| W23-13 | `serve-mcp.mjs` SIGKILL ile öldürülünce uvicorn çocuğu | önce 10 sn sonra hâlâ yaşıyor, portu tutuyor (iki sahipsiz süreç bulundu) → sonra kapanıyor | 0 |
| W23-14 | `ColleX-Dogrula` bu ortamda, deneme sunucusuna karşı | 26/26 kaynak **ULAŞILAMADI**, her biri hata türüyle (ağ politikası); hiçbiri "sonuç yok" diye yazılmadı | — |
| W23-15 | Tebligattan süre, tarayıcıda, UETS alındı belgesi (ulaşma 27.10.2026) | tebliğ 01.11.2026 (Pazar ve ay sonu uyarılarıyla), gönderim ve okunma tarihleri gerekçeyle reddedildi, öneri `hmk-istinaf` → son gün 16.11.2026; 1440/390 px taşma 0 | — |
| W23-16 | Word'den geri yükleme, tarayıcıda (dışa aktar → düzelt → yükle → onayla) | önizleme 3 değişen paragraf, karşı içtihat bölümündeki düzenleme uygulanmadı ve bunu yazdı, onayla sürüm 1 → 2; kopyalanan paragrafın ayrı paragraf okunması (aşağıda D) | — |
| W23-17 | Sayfalı mevzuat metni (`get_mevzuat_content`) | 1. sayfa "tam metin" diye mühürleniyordu → bütün sayfalar birleştirilip birebir mühürleniyor; gerekçe başlığı metne girmiyor | — |
| W23-18 | Konsol sayfası Windows `git` çıkışında (CRLF satır sonu), Chromium | önce iç `<style>` ve `<script>` CSP tarafından **2/2 reddedildi** (boş, biçimsiz sayfa: tarayıcı CRLF'yi LF'ye çevirip özetliyor, sunucu CRLF ile özetliyordu) → yükleyici LF'ye çeviriyor: **0 ret**; `autocrlf=true` çıkışında `console.html` 0 CR satırı, iki metin sanılan PDF bayt bayt aynı, `.cmd` CRLF, macOS betikleri LF | 0 |
| W23-19 | `ColleX-Baslat.cmd`, avukatın Windows makinesi (iki ekran görüntüsü, ölçüm değil) | her çift tıklamada küme uyarısının 6 satırından yalnız son 2'si yazıldı ve başlatma "yanlış kümeye bağlanmamak için" durdu. Sebep iki cmd tuzağı: `for /f` içindeki tırnakla başlayan psql komutunu `cmd /c` ilk ve son tırnağı silerek bozuyordu (psql hiç çalışmadı, dizin "(okunamadi)" kaldı); bu yer tutucu `if (...)` bloğunun İÇİNDE açılınca `)` bloğu erken kapattı ve son iki satır, `pause`, `exit /b 1` koşulsuz çalıştı. İlk tahmin ("—" karakterleri) YANLIŞTI; dosyalar yine de ASCII kalıyor. psql artık `for /f` dışında, `-w` ile, çıktısı dosyadan okunuyor; uyarı bir etikette; dışarıdan gelen değer (`CLUSTER_DIR`, `PGDATA_DIR`, `SRC`, `DUMPNAME`) hiçbir bloğun içinde tırnaksız açılmıyor (`ColleX-Geri-Yukle.cmd` dahil); `:failed` yolundaki iki `->` satırı ekrana değil `PostgreSQL`/`eski` adlı dosyalara yazıyordu, kaçışlandı. Yeni testler eski betiklerde 6 kez kırmızı, yenilerde yeşil. **Düzeltme o makinede henüz yeniden çalıştırılmadı** | — |
| W23-20 | Avukatın makinesinde ilk tam açılış ve `ColleX-Dogrula` raporu (ölçüm: rapor dosyası) | başlatıcı, veritabanı, şema, sunucu ve arayüz AÇILDI; resmî kaynak bileşeni (MCP) 60 sn'de hazır olmadı ve doğrulama o sırada koştuğu için 26/26 kaynak 2–12 ms'de ULAŞILAMADI yazdı (kaynakların değil bileşenin durumu). Düzeltme: Windows'ta W23 bekçisi (`uvicorn_watchdog`, stdin okuması) kaldırıldı, W23 öncesi başlatma geri geldi; bekleme 60/90 → 180 sn; `ColleX-Dogrula` bileşen "starting" iken en fazla 3 dk bekliyor ve bileşen açık değilse raporun başında bunu söylüyor. OCR: `OCR_EXECUTABLE_MISSING` (Tesseract kurulu değil). **Düzeltme o makinede henüz yeniden çalıştırılmadı** | — |
| W23-21 | Avukatın makinesinde ikinci tam açılış + `ColleX-Dogrula` (rapor + sunucu penceresi) | kaynak bileşeni AÇILDI (W23-20 düzeltmesi); 26 kaynak: **19 ulaşıldı · 2 ulaşıldı sonuç yok · 5 ULAŞILAMADI**; tam metin **18 mühür doğrulandı · 0 tutmadı · 1 getirilemedi**. Ulaşılamayanlar: KVKK/BDDK/Sigorta (Brave/Tavily anahtarı bilerek boş), KİK (kaynak `428 Precondition Required` döndü — kaynak tarafı değişiklik, bu ortamdan denenemez), Sayıştay (Daire satırında `ILAMNO: null` bütün aramayı düşürüyordu → null metin sütunu boş dize, test eklendi). Aynı pencerede veritabanı açılıştan saniyeler sonra "recovery mode" ve ECONNREFUSED: `pg_ctl` başlatıcının konsolunda başlıyordu ve pencere kendini kapatınca PostgreSQL de kapandı → artık kendi gizli konsolunda başlıyor. **İki düzeltme de o makinede henüz yeniden çalıştırılmadı** | — |

### Neler yapıldı

**(A) Rakiplerin sattığı iş akışları, yerel ve kaynağına bağlı.**
- **Tebligattan süreye** (`deadlines/serviceNotice.ts`, `POST
  /v1/deadlines/from-notice`): e-tebligat alındı belgesi, mazbata ya da
  tebliğ edilen belgenin kendisi okunur; tebliğ tarihi (e-tebligatta ulaşma
  + 5 gün, 7201 s.K. m.7/a — DOĞRULANMADI işaretli), ne tebliğ edildiği ve
  başlayan süre, her biri belgedeki alıntıyla. İki aday tarih varsa seçim
  avukatındır; tarih okunamazsa tahmin yok. Onaylanana kadar hiçbir şey
  yazılmaz; ikinci onay yinelenmiş kayıt açmaz.
- **UYAP indirme klasörünü dosyalara dağıtma** (`intake/uyap.py`, `POST
  /v1/files/uyap-preview|uyap-import`): klasör ya da .zip (aynı karantina ve
  ZIP-bombası denetimleri); mahkeme, esas, karar, belge türü ve tarih
  alıntısıyla okunur; esas numarası birebir, mahkeme Türkçe katlamayla
  eşleşir; belirsiz eşleşme asla kendiliğinden atanmaz; tek alım yolu
  (`POST /v1/files` ile aynı argv); yinelenen belge sha256 ile atlanır.
  Gerçek bir UYAP indirmesi görülmedi — belgeler gerçeğe benzetilerek yazıldı.
- **Word'de düzelttim, geri yükle** (`export/draft_identity.py`, `POST
  /v1/drafts/{id}/import-docx`): her DOCX'te gizli, kurcalanınca belli olan
  kimlik; geri yüklenen dosya önce paragraf paragraf önizlenir; onay
  `reviseDraft` yolundan geçer, yani alıntı bütünlüğü, KAYNAKSIZ işareti,
  kilitli bölümler ve NİHAİ yer tutucu kapısı aynen çalışır.
- **Mevzuat değişikliği kontrolü** (`legislationWatch/`, `GET|POST
  /v1/matters/{id}/legislation-watch`, `GET /v1/legislation-watch`): dosyanın
  taslak, cevap ve belgelerinde atıf yapılan kanunlar; araçlar sürüm tarihi
  vermediği için karşılaştırılan şey kaynak metninin parmak izidir, yanında
  metindeki en yeni değişiklik notunun tarihi. ULAŞILAMADI hiçbir zaman
  "değişmedi" değildir. Canlı kaynakla ölçülmedi.
- **Faiz hesabı** (`interest/`, `GET /v1/interest/rates`, `POST
  /v1/interest/compute`): basit faiz, gün gün, oran değişince bölünür.
  Kanunî faizin iki dönemi (%9 01.01.2006'dan, %24 01.06.2024'ten)
  `dogrulanmadi`; avans faizi hiç yok — oran bilinmeyen gün `ORAN_GEREKLI`,
  toplam `null`.
- **Önerilen iş** (hızlı arama, Ctrl K): avukatın cümlesi kurallı bir
  tabloyla doğru ekrana ya da süre kuralına eşlenir; hiçbir şey kendiliğinden
  çalışmaz.
- **Duruşma özeti** tek sayfa yazdır / PDF (mobil uygulamanın yerine).
- **ColleX-Dogrula** (`ColleX-Dogrula.cmd`, `deploy/macos/collex-verify.sh`,
  `verify/onMachine.ts`): avukatın kendi bilgisayarında 26 kaynağı sırayla
  dener, tam metnin parmak izini bağımsız hesaplar, ayarlıysa yerel modeli
  örnek cümlelerle dener, Mac'te makineyi yazar; hiçbir kayda yazmaz.

**(B) W22'nin açık listesi.** "Çelişkileri bul" 12/12 (W23-11), full_review /
red_team / chronology artık `LIMITED` ve "N çiftten M'si" cümlesini söyler;
22 px form kayması 0 (W23-10); BTK/GİB ham TLS metni ve koşullu 55. aracın
ham hatası tipli (W23-12); cevap ekranı artık "öne çıkan alıntıda sorunun
beklediği biçimde bir değer bulunamadı" der (C).

**(C) Cevap biçimi** (`answer/answerShape.ts`, `shape-v1`): soru bir tarih,
tutar, süre, sayı, kişi ya da mahkeme soruyorsa, o biçimde değer taşıyan
pasaj öne alınır, başlık/etiket satırı sona itilir; bulunamazsa uyarı
(`ANSWER_SHAPE_NOT_FOUND:<TÜR>`) ve ekranda sunucunun cümlesi. Bu bir biçim
denetimidir; alıntının soruyu cevapladığını denetlemez ve ekran böyle der.

**(D) Bulunup düzeltilen kusurlar.** Uzun bir kanunun 1. sayfası tam metin
diye mühürleniyordu ve gerekçe başlığı metne giriyordu (W23-17); hata
sayfaları belge metni olarak dönüyordu (W23-12); KİK "başarılı" aramaları
`error_code:"0"` yüzünden ölü arşiv sayılıyordu; tek belgelik vektör deposu
çöküyordu; öldürülen `serve-mcp` portu tutan sahipsiz uvicorn bırakıyordu
(W23-13, `uvicorn_watchdog.py`); Uyuşmazlık belge aracı kendisine verilen her
adrese gidiyordu (artık yalnız https + uyusmazlik.gov.tr); süre penceresi
önceden seçilen kuralı ilk kuralla eziyordu; kopyalanan bir paragraf
Word'den geri yüklemede özgün paragrafın kimliğini alıyordu; `bakeoff` CLI
testleri kendi süreçlerinin sınırından kısa bir test sınırıyla yarışıyordu.

**(E) Kabuk.** Geniş ekranda (≥ 1100 px) sol kenar çubuğu; nötr palet; 8 px
köşeli denetimler; ekrandaki "üst çubuk" cümleleri "Aktif dosya seçicisi"
oldu.

### W23'ün AÇIK bıraktıkları — kapatılmış gibi yazma

Kodla kapatılabilecek açık madde kalmadı. Kalanlar bu ortamda
ÖLÇÜLEMEYENLER ve her biri avukatın bilgisayarında tek çift tıkla
ölçülür (`ColleX-Dogrula`):
- **Canlı resmî kaynaklar**: ağ politikası `*.gov.tr`'yi engelliyor. Tam
  metin birleştirme, mevzuat izleme ve açılan TLS doğrulaması gerçek
  kaynakla ÖLÇÜLMEDİ. Bir kaynak eksik sertifika zinciri sunarsa artık tipli
  "sertifika doğrulanamadı" hatası verir; çözüm o sunucunun ara
  sertifikasını eklemektir, doğrulamayı kapatmak değil.
- **Gerçek dil modeli** hiç çağrılmadı; model isteyen üç inceleme görevi bu
  ortamda `409 MODEL_REQUIRED`.
- **Fiziksel Mac**'te hiçbir şey çalıştırılmadı.
- Sekiz doğrulanmamış yüzey (CLAUDE.md) aynen geçerli; buna ek olarak
  e-tebligatın beşinci gün kuralı ve kanunî faizin iki oranı `dogrulanmadi`.

## 27.09.2026 — W22: gerçek belgelerle sınama — altı bağımsız inceleme, beş düzeltme işçisi

W21'e kadar her kapı sentetik belgelerle yeşildi. W22 ürünü **gerçek bir
avukatın kullanacağı biçimde** sınadı: gerçekçi Türkçe dilekçeler
(iş, kira, itirazın iptali, ceza istinaf, idari iptal, cevap), sözleşmeler
(kira, iş, lisans), bir iş davası dosyası (dava/cevap, bilirkişi raporu,
çelişen tanık tutanakları, taranmış SGK dökümü) ve konsolun her ekranı
1440–360 px arasında, açık/koyu temada, klavyeyle. Altı bağımsız inceleme
bulguları ürettikten sonra beş yalıtılmış düzeltme işçisi ve bu oturum
düzeltmeleri yaptı; her düzeltmenin, düzeltmeden ÖNCE düşen bir regresyon
testi var. Ortam: Linux, PostgreSQL 16, Node 22, Python 3.11 — **bu
ürünün Linux'ta ilk tam ölçümü**; Mac mini hedefinin taşınabilir yolu da
ilk kez çalıştırıldı (fiziksel Mac'te DEĞİL).

Araç yüzeyi aynı (54), migrasyon eklenmedi (19), RLS aynı (32).
Sözleşme değişiklikleri eklemeli; tek bilinçli kırılmalar aşağıda (E).

### Ölçüldü (27.09.2026, W22 kapanışı)

| # | Ne | Sonuç | Başarısız |
|---|---|---|---|
| W22-1 | `npx tsc --noEmit` | temiz | 0 |
| W22-2 | `npx vitest run` | 202 dosya · **3852 geçti** · 8 atlandı (7 ters işaretleyici + yerel E5 model dosyaları yok). W21: 190 dosya · 3623 | 0 |
| W22-3 | `pytest tests evals/tests` | **1759 geçti · 0 atlandı** (W21: 1609 + 1 atlandı). Gerçek OCR testi bu ortamda Tesseract (Türkçe) + Poppler kurulu olduğu için ilk kez KOŞTU ve geçti | 0 |
| W22-4 | `db_local_check.py` | 19/19 PASS | 0 |
| W22-5 | `smoke_check.py` · `http_e2e_check.py` · `live_local_gateway_check.py` | 54 araç · 54 araç HTTP'de · PASSED | 0 |
| W22-6 | `run_evals.py --repeats 4` (SENTETİK) | RESULT: PASS · bant genişliği sıfır (4 tekrar / 4 ingest aynı) · Recall@5 0,9429 · ABSTAIN 14 · COMPLETE 11 · PARTIAL 3 · QUALIFIED 6 · yanlış cevap 0. **Linux'ta ilk koşu:** `run_evals.py` esbuild'i `node bin/esbuild` diye çağırıyordu; Linux/macOS'ta o dosya yerel ikilidir ve kapı hiç çalışamıyordu (düzeltildi) | 0 |
| W22-7 | `demo.mjs` | 6/6 senaryo | 0 |
| W22-8 | OpenAPI | 82 yol · 99 işlem · 164 şema · CR baytı 0 | — |
| W22-9 | Konsol, gerçek Chromium, 16 görünüm × 1440/1280/1024/820/390/360 px × açık/koyu | 192 ölçümde yatay taşma **0**, sayfa hatası (JS) **0**. Uzun dosya başlığıyla üst çubuk 14 genişlikte ölçüldü: dosya seçicinin "⌕ Ara"yı örtmesi **0** (önce 1024→641 px arası her genişlikte örtüyordu) | 0 |
| W22-10 | Gerçek OCR, uçtan uca (sunucu, taranmış 1 sayfalık Türkçe dilekçe) | 3,0 sn; taraflar, 4857/1475 atıfları ve 3 tarih doğru okundu | — |
| W22-11 | `deploy/macos/collex-start.sh` / `collex-stop.sh`, **Linux'ta**, ayrı bir geçici PostgreSQL kümesiyle | başlatma 4,6 sn (19/19 migrasyon, 32/32 RLS, MCP açık, yerel model yoksa kelime aramasına Türkçe açıklamayla düşüyor) · nazik durdurma 4,2 sn. **Fiziksel Mac'te DEĞİL** — launchd sınanmadı | 0 |
| W22-12 | Harç tarifesi (`GET /v1/fees/tariffs?year=2026`, çalışan sunucudan sayıldı) | 20 kalem · **12 `dogrulandi`** · **10 kalemde `amount: null`** (3'ü oran kalemi). S11'in "5 / 17"si eskidi | — |
| W22-13 | Süre kuralları (`GET /v1/deadlines/rules`) | 41 kural · 16 `dogrulandi` · 7 `belirsiz` (S10 ile aynı) | — |
| W22-14 | 441 KB'lık bir dilekçe, `POST /v1/contracts/petition-analysis` | 31,4 sn → **2,75 sn**; `analyzeIntake` (183 KB anlatı) 4658 ms → 59 ms. Önce istek süresince `/v1/health` 48,9 sn cevapsız kalıyordu | — |
| W22-15 | Dokuz gerçekçi dilekçe, önce → sonra | KAYNAKSIZ işaretli cümle 81 → 40 · iddiaya bağlanan atıf 68 → 88 · iddia sayısı 87 → 74 (önsöz/imza/ek listesi artık iddia değil) | — |
| W22-16 | Dosya incelemesi, "Çelişkileri bul", incelemecinin iş davası dosyası | işe giriş 2018↔2019 çiftleri **0/12 → 9/12** · tebliğ 22.12↔26.12 0/1 → 1/1 · net ücret 45.000↔32.000 2/8 → 8/8 · yanlış çelişki (karar tarihleri, kısmi talep) 3 → 0 · kronoloji olayı 31 → 16 | — |
| W22-17 | 30 000 paragraflık TXT yükleme (`test_ingest_performance`) | 13,7 sn (düzeltilmiş cümle bölücünün açtığı O(n²) tekrar denetimi kapatıldıktan sonra; ara ölçüm 119 sn) | 0 |
| W22-18 | Yedek + doğrulama (`backup.mjs`, geçici veritabanı, Linux) | 1,0 sn; manifest yeniden doğrulandı | 0 |

### Neler düzeltildi — avukatı en çok yanıltabilecek olandan başlayarak

**(A) Yanlış hukukî sonuç veren hesaplar.**
- Kesinlik sınırı: güncel sınır girilmeden kanundaki TABAN tutarla (HMK
  m.341: 3.000 TL) karşılaştırıp 20.000 TL için "kanun yolu AÇIKTIR"
  yazıyordu. Artık tabanın üstünde hüküm yok ("BELİRLENEMEDİ"); tabanın
  altında "KESİN" (hiçbir yılın sınırı tabandan düşük olamaz).
- Adli tatil anahtarı `adliTatileTabi: false` kuralları da uzatıyordu (İİK
  m.62 itirazı 25.07'den 07.09'a); motorun kendi uyarısı buna davet
  ediyordu. Artık uzamaz; konsolda anahtar kapalı çizilir.
- Peşin harç, asgari harcın dörtte birine (183 TL) düşüyordu; asgari (732 TL)
  alınır. Kuruş yuvarlaması 1–5.000.000 TL arasında 344 değerde 1 kuruş
  eksikti. "Kanun yolu" dava harcı anlamsız bir toplam veriyordu; tipli 400.
- İcra itirazı taslağı, süre geçmişken "İİK m.62/1'deki yedi günlük süre
  içinde" yazıyordu; artık süre motoruna soruluyor, geçmişse cümle düşüyor
  ve uyarı `DEADLINE_DISCLAIMER` ile basılıyor.

**(B) Dosyaya giren belgedeki hatalar.** "Yılmaz & Kaya" NİHAİ DOCX/UDF/MD'de
"Yılmaz &amp; Kaya" basılıyordu; doldurulmamış "[… doldurun]" yer tutucuları
NİHAİ kopyaya giriyordu (artık `409 PLACEHOLDER_UNFILLED`, iki katmanda);
tek harfi değişen alıntı bildiriliyor ama işaretlenmiyordu; "YARGITAY'NA",
"MAHKEMESİ'NE'NE"; Ek numaraları avukatın sırasını izlemiyordu; aynı adlı
iki taslak dosya paketinde birbirini eziyordu.

**(C) "Arandı, bulunamadı" ile "ulaşılamadı"nın karışması.** Rekabet/BTK/GİB
araçları her hatayı boş sonuca çeviriyordu ve konsol "sonuç gerçekten boş"
yazıyordu; ağ kesintisi "isteğiniz geçersiz" görünüyordu; bütün aramaları
düşen canlı araştırma 200 KISMİ + "arşivde bulunamadı" dönüyordu; kısmi
kesinti dilekçe analizinde "arandı, bulunamadı" çiziliyordu. Hepsi tipli
ulaşılamadı durumuna döndü. KVKK/BTK/GİB/Rekabet/AYM tam metinleri hiç
getirilemiyordu, BDDK/Sigorta Tahkim'de 1. sayfa "tam metin" diye
mühürleniyordu; artık bütün sayfalar birleştirilip mühürleniyor ya da hiç
mühürlenmiyor.

**(D) Okuma ve eşleştirme.** DOCX'te izlenen değişiklikler, içerik
denetimleri, dipnotlar ve üst/alt bilgi okunmuyor, birleştirilmiş hücre iki
kez okunuyordu; UTF‑16 TXT reddediliyordu. "KIDEM", "YILMAZ", "bilirkisi"
aramaları hiçbir şey bulmuyordu. Talep cümleleri "m. 14" noktasından
kesilip taslağa kesik aktarılıyordu. Sözleşme incelemesi var olan maddeyi
"YOK" (IBAN, cezaî şart, temerrüde…) ve olumsuz cümleyi "VAR" sayıyordu;
şimdi her bulguda sözleşmeden birebir alıntı var. Dilekçe analizinde en
yaygın atıf biçimi ("… TBK'nın 315. maddesi") iddiadan kopuyordu; karar
künyesi mahkemesiz eşleşip "bulundu" olabiliyordu.

**(E) Bilinçli sözleşme kırılmaları (hepsi tipli ve Türkçe):** `dava-harci`
+ `mahkeme: "kanun-yolu"` → 400; bilinmeyen `ekBilgiler` anahtarı ve
seçenek dışı seçim değeri → 400; NİHAİ dışa aktarmada doldurulmamış yer
tutucu → 409; `/v1/files/{bilinmeyen}/usage` → 404; bütün aramaları düşen
`/v1/research` → 502 `UPSTREAM_UNAVAILABLE`; kesinlik sınırında tabanın
üstündeki değer için `kanunYoluAcik: null`.

**(F) Ekran.** Yeni dosyanın ilk sayfası aktif dosyayı sessizce siliyordu
(sonraki yükleme dosyasız gidiyordu); duruşma formu anlatılıyor ama yoktu
(eklendi); telefon başlığı 2 px taşıyordu; beş ana sekme 390 px'e
sığmıyordu; cevabın kaynak notu her ekrana yapışıyordu; "aleyhe 0 kaynak"
hiç taranmamış bir şeyi sayıyordu; üç denetimde odak halkası görünmüyordu;
aynı ekranda Windows ve Mac yeniden başlatma cümlesi yan yanaydı.

### W22'nin AÇIK bıraktıkları — kapatılmış gibi yazma

- **Canlı resmî kaynaklar bu ortamdan sınanamadı:** ağ politikası
  bedesten.adalet.gov.tr, mevzuat.gov.tr, karararama.yargitay.gov.tr vb.
  alanları engelliyor. Kesinti yolu ölçüldü; başarılı canlı arama, sayfalı
  tam metin birleştirme dahil, gerçek kaynakla ÖLÇÜLMEDİ.
- **Gerçek dil modeli yine çağrılmadı**; model isteyen üç inceleme görevi
  bu ortamda `409 MODEL_REQUIRED`.
- **Fiziksel Mac'te hiçbir şey çalıştırılmadı** (W22-11 Linux'tur).
- "Çelişkileri bul" artık `LIMITED` durumundadır: işe giriş çiftlerinin
  3/12'si hâlâ kaçıyor (olay sözcüğü olmayan tanık anlatımı); ekran bunu
  söyler. `full_review`/`red_team`'in kural şeridi aynı sınırla çalışır ama
  `LIMITED` işaretli değildir.
- Şablon formunun "Mahkeme ve dosya" satırında tek satırlık etiketli alan
  komşularından 22 px yukarıda duruyor (salt görsel; denenen CSS çözümü
  başka satırları bozduğu için geri alındı).
- Cevap motoru modelsiz çalışırken alıntı sıralaması sözcükseldir: tutanak
  başlığı gibi soru sözcüğünü içeren ama soruyu cevaplamayan bir pasaj
  hâlâ öne çıkabilir (inceleme tablosunda artık "soruyu karşıladığı
  denetlenmedi" yazar; cevap ekranında yazmaz).
- BTK/GİB istemcilerinin belge hata yolunda ham TLS metni hâlâ MCP
  yanıtında taşınıyor (sınıflandırılıyor, ekrana çıkmıyor); koşullu 55.
  araç hâlâ `status: "error"` + ham metin döndürüyor.


## 11.09.2026 — W20: "beyin gerçek oldu" — kalıcı dosya incelemesi, yerel model hattı, özel anlamsal şerit

W19 dosya incelemesini **sayım** yaptı ama senkron, modelsiz ve yalnız
API'de bıraktı. W20 onu **kalıcı bir iş sistemine** çevirdi, yerel model
sağlayıcısını ürüne bağladı, yüklenen belgeler için gerçek bir anlamsal şerit
kurdu ve bunları mevcut ekranlara taşıdı. Kararlar: **ADR-034..039**.
Eklemeli: üç yeni migrasyon (eski dosyaların hiçbiri değişmedi), araç yüzeyi
aynı (54). Tek sözleşme kırılması bilinçlidir: `POST /v1/matters/{id}/analysis`
artık **202** ve koşu kimliği döner (iş arka planda yürür).

**(A) Kalıcı inceleme (ADR-034).** `20260912090000_durable_matter_analysis.sql`
+ `exhaustive/{durableStore,worker,identity}.ts`. Birimler kira ile
(`for update skip locked`) alınır; gözlemler ve "bitti" işareti **kira
denetimiyle tek işlemde** yazılır; süresi dolan kira geri alınır, 3 denemede
kalıcı başarısızlık; değerlendirme (reduce) ayrı ve kiralı bir aşamadır ve
**yalnız kalıcı gözlemlerden** okur; gözlem kimliği içerik adreslidir (tekrar
yazılamaz); iptal ve ilerleme var. Koşu kimliği (kiracı, dosya, görev, dosya
ve **sürüm** kimlikleri, üretici sürümleri, model) dondurulur; aynı kimlikle
ikinci istek mevcut koşuya katılır. Belge değişirse koşu `stale` görünür;
eski koşu yeni metinle sessizce yeniden yazılmaz.

**(B) Model önerir, uygulama yerini bulur (ADR-035).** Model alıntısı yalnız
bölümde **tam bir kez, birebir** (yalnız NFC) geçiyorsa saklanır; ofseti
uygulama hesaplar, SHA-256 ile doğrular; model kimliği, sağlayıcı, şema
sürümü ve güven puanı kayda geçer. Dosya zekâsı (kişi/kurum, olay, önerme,
iddia, savunma, delil, hukukî sorun, çelişki, açık soru, karşı taraf
okumaları) **ilişkisel** tablolardadır; **kaynaksız kayıt veritabanına
giremez** (ertelenmiş kısıt tetikleyicisi).

**(C) Görev dürüstlüğü.** Çelişkiler ve kronoloji modelsiz. "Dosyanın
tamamını incele", "İddia ve delilleri eşleştir", "Karşı tarafın gözüyle
incele" model ister: model yoksa `409 MODEL_REQUIRED`, konsolda düğme değil
açıklama. Çelişki gerekçesi koşulludur ("aynı olaya ilişkinse … bağlamı
kaynaktan doğrulayın"). Konu anahtarı v2: değerin **kendi cümleciği**
içindeki en yakın dört kök.

**(D) Özel anlamsal şerit (ADR-036).** `20260912100000_private_dense_vectors.sql`
boyut kısıtını (eski dosyaya dokunmadan) 1..8192 aralığına çevirdi ve yerel
E5 profilini (`e5-small-384-v1`) ekledi. Vektörler `app_private.chunk_vectors`
içinde (kiracı → sürüm → parça → profil, parça sha'sıyla bayatlık), işçi
mevcut `app_private.jobs` kuyruğunu tüketir. Arama **dosya kapsamında tam
kosinüs**tür: **pgvector gerekmez, kamu külliyatında ANN araması değildir.**

**(E) Sağlayıcı fabrikası ve `LOCAL_ONLY` (ADR-037).** Tek rota tablosu, dört
rol, uç başına tek istek kuyruğu, kodda model adı yok. Yerel taslakçı
**mevcut** cevap hattına bağlı; `LOCAL_ONLY` her yapay zekâ girişinde
zorlanır; **yerelden buluta geri düşüş yok**.

**(F) Yerel OCR sınırı (ADR-038)**, **(G) kalıcı inceleme tablosu (ADR-039)**,
**(H) konsol**: dosya sayfasında "Dosya incelemesi" sekmesi (ilerleme,
kapsam, okunamayan yerler, çelişkiler, kronoloji, kaynağa giden atıflar);
mevcut tablo ekranı sunucuya yazar, hücre bazında yeniden dener. **(I)**
model karşılaştırma düzeneği (`scripts/bakeoff.mjs`, `evals/bakeoff/`) ve
**(J)** Mac mini rehberi (`MAC-MINI-INFERENCE.md`).

### Ölçüldü (11.09.2026, W20 kapanışı)

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| W20-1 | `control-plane> npx tsc --noEmit` | **temiz** | 0 |
| W20-2 | `control-plane> npx vitest run` | **160 dosya · 2 883 geçti · 0 DÜŞTÜ · 6 atlandı (2 889)** · 38,8 sn. W19 kapanışı: 149 dosya · 2 798 geçti · 6 atlandı → **+11 dosya / +85 test**. Altı atlama W19'dakiyle aynı ters işaretleyicilerdir | 0 |
| W20-3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 477 geçti · 1 atlandı** · 171,9 sn (W19: 1 469). Atlanan tek test gerçek OCR sınamasıdır: bu makinede `tesseract`/`pdftoppm` yok — **ortam engeli, geçti sayılmaz** | 0 |
| W20-4 | `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS**, **18 migrasyon** (15 → +`20260912090000_durable_matter_analysis.sql` +`20260912100000_private_dense_vectors.sql` +`20260912110000_review_tables.sql`) | 0 |
| W20-5 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: **54 tools** …` — araç yüzeyi değişmedi | 0 |
| W20-6 | `openapi.yaml` (pyyaml + `$ref` yürüyüşü) | **82 yol / 99 işlem / 157 şema** (W19: 73/89/149). Çözülmeyen `$ref` **0**, referans verilmeyen şema **0**, tekrar eden `operationId` **0**, CR baytı **0** | — |
| W20-7 | RLS politika sayısı | **23 → 31** (+3 kalıcı inceleme/dosya zekâsı, +1 vektör, +4 inceleme tablosu); `EXPECTED_RLS_POLICIES` ve Python testleri aynı sayıyı taşır | — |
| W20-8 | **Kabul A — gerçek süreç öldürme** (`tests/exhaustive/durableProcess.test.ts`) | İşçi **ayrı bir süreçte** çalışırken `SIGKILL` ile öldürüldü; ikinci işçi süreci koşuyu bitirdi; bitmiş birimler yeniden işlenmedi, bulgular kesintisiz koşuyla **aynı** | 0 |
| W20-9 | **Kabul F — gerçek yerel E5** (`tests/embeddings/realE5.test.ts`) | multilingual-e5-small (ONNX int8, CPU) gerçek bir yüklemenin parçalarını gömdü; soruyla **hiç ortak sözcüğü olmayan** pasaj yalnız anlamsal şeritten geldi, sağlık `ACTIVE`. Ölçülen kosinüs: soru ↔ hedef pasaj **0,8930**, en yakın ilgisiz pasaj **0,8242** | 0 |
| W20-10 | Konu anahtarı v2 (`tests/exhaustive/topicKey.test.ts`, sentetik çiftler) | Doğru eşleşen çift **6/11 → 10/11**; kalan bilinen kaçırma `it.fails` ile sabit | 0 |
| W20-11 | **Gerçek sunucu, uçtan uca** (`collex_w20_verify`, port 8978; kullanıcının 8787'deki süreci ve `collex_local` hiç kullanılmadı) | `/v1/health` → **migrations 18/18**, **RLS 31/31**, **54 araç**, `localAi.state:"not_configured"`, anlamsal şerit **`ACTIVE`** (canlı yoklama **7–29 ms**, 6 vektör, eksik 0). Üç sentetik PDF (biri taranmış sayfalı) yüklendi. `full_review` → **409 `MODEL_REQUIRED`**. `contradictions` ve `chronology` → **202**, işçi bitirdi, **`complete:false`** ve boşluk kalem kalem: `taranmis_ek.pdf — s. 2: UNREADABLE_NO_TEXT`. Bulunan çelişkiler: "Benzer bağlamda iki farklı tarih var: **01.05.2023 ve 01.02.2023** …" ve "… iki farklı tutar var: **32.000 TL ve 45.000 TL** …", her biri iki belgeye `s. N` atıflı. İnceleme tablosu `extract_dates`: iki belge **`exhaustive_complete`**, taranmış belge **`exhaustive_incomplete`** | 0 |
| W20-12 | **Konsol, gerçek sunucuda** (1280/1024/820/640/390 px × açık/koyu) | "Dosya incelemesi" sekmesi ve tablo ekranı: yeni bileşenlerde taşan öğe **0**, metin taşması **0**, en düşük metin karşıtlığı **7,21:1** (koyu) / **7,54:1** (açık). Tarayıcı paneli gizli olduğu için ölçüm ekran görüntüsüyle değil **DOM ölçümüyle** yapıldı. Sayfa düzeyinde 1280 ve 820 px'te üst çubuktaki marka logosundan gelen 35–43 px'lik yatay taşma **W20 öncesi işaretlemeyle birebir aynıdır** (W20 dokunmadı) | — |

### Kendi çekişmeli denetimimde bulunan ve kapatılanlar

- **İki kez geçen model alıntısı ilk yere iğneleniyordu** (yalnız sayısı
  kaydediliyordu). Tek metin, iki konum: tahmin edilmiş bir sayfa
  doğrulanmış atıf gibi görünürdü. Artık reddediliyor; çıkarıcı `mx-v2`.
- **Gömme işi alma kiracıya bağlı değildi.** Paylaşılan `app_private.jobs`
  tablosunda kiracı sütunu yok; bir kiracının işçisi başkasının işini alıp,
  gömecek bir şey bulamadan "başarılı" kapatabilirdi. Tek kiracılı kurulumda
  ulaşılamaz, yine de kapatıldı (sürümün sahibi belgeye bağlanarak).
- **`openapi.yaml` bir düzenleme betiğiyle CRLF'e çevrilmişti** (W19 0 CR
  ölçmüştü) ve W19'un senkron yanıt şeması sahipsiz kalmıştı. İkisi de
  düzeltildi; ilişki şeması artık bulgular yanıtında gerçekten kullanılıyor.
- **Ölçüm betiği parolalı sunucuya bağlanamıyordu** — artık parolayı
  yalnız ortam değişkeninden okuyor ve hiçbir yere yazmıyor.
- İki kapı beklentisi eskimişti (ürün değil): defter testinin uygulanan
  migrasyon listesi ve `db_local_check`'in profil sayısı — artık **tam
  anahtar kümesi** denetleniyor.
- Denetlenip sağlam bulunanlar: kira kaybında yazma engeli, bayat kira geri
  alımı, gözlem tekrarı, sürüm anlık görüntüsü, kiracı süzgeçleri (inceleme,
  vektör, tablo), `LOCAL_ONLY` girişleri, taslakçının uydurduğu kanıt
  kimliğinin doğrulayıcıya `CITATION_INVALID` olarak ulaşması, model
  çıktısındaki gözlem kimliklerinin bilinen kaynaklarla sınanması, OCR
  alt süreçlerinin kabuksuz ve zaman aşımlı çağrılması, CSV formül koruması,
  günlüklerde belge metni ve parola bulunmaması.

### Gerçek ve sahte — hangi çağrı neydi

| Yüzey | Bu dalgada |
|---|---|
| Yerel dil modeli (cevap, çıkarım, değerlendirme, karşılaştırma) | **Hiç gerçek çağrı yok.** Hepsi betikli test çiftleri; bake-off yalnız `--dry-run` ile koştu ve rapor kendini "ölçüm değil" diye etiketledi |
| Yerel E5 gömme | **Gerçek** (ONNX, CPU): W20-9 ve W20-11 |
| OCR | **Sahte sağlayıcı**; gerçek sınama ortam engeliyle atlandı |
| PostgreSQL, işçi süreçleri, HTTP sunucusu | **Gerçek** (geçici veritabanları, port 8978) |
| Bulut yapay zekâ | Çağrılmadı; `LOCAL_ONLY` testlerinde çağrılırsa testi düşüren sahte taşıyıcı kullanıldı, çağrı sayısı **0** |

### W20'nin AÇIK bıraktıkları — kapatılmış gibi yazma

- **Hiçbir gerçek model ölçülmedi**; M2 Mac mini bu ortamdan ölçülemez.
  Komutlar `MAC-MINI-INFERENCE.md` 6. adımda; çalıştırılana kadar hız,
  bellek ya da kalite sayısı yazılamaz.
- **Yerel OCR çalışma zamanı yok** (tesseract/pdftoppm kurulu değil):
  taranmış sayfa bugün de `UNREADABLE` ve kapsam eksik.
- **Avukat etiketli bake-off vakası yok**; 20 sentetik vaka yalnız düzeneği
  sınar, hukukî kaliteyi değil.
- **Konu anahtarı hâlâ sezgisel**; gerçek Türk dosyalarında ölçülmedi.
- **Model gerektiren üç görev** bu makinede kullanılamaz (model yok) — bu
  bir eksik değil, dürüst bir ret; ama avukat açısından o görevler yok.
- **W20 migrasyonları `collex_local`'a uygulanmadı.** `ColleX-Baslat.cmd`
  bir sonraki açılışta `intake.cli --ensure-db` ile üçünü ekler (eklemeli,
  defter korumalı); `/v1/health` o zaman **18/18** ve **31/31** göstermelidir.
- Konsolda üst çubuk logosunun 1280/820 px'teki küçük yatay taşması W20
  öncesinden kalmadır ve bu dalgada ele alınmadı.

## 11.09.2026 — W19: kanıt düzeyinde dosya zekâsı (sayfa izi, dosya kapsamı, sayım)

Bu dalga ürünün temel iddiasını değiştirdi: artık yalnız **akıcı bir cevap**
değil, **ne okundu ve ne okunamadı** da kanıtlanabiliyor. Beş bağımsız yüzey
indi; hepsi eklemeli, hiçbir araç sözleşmesi ya da kapı eşiği gevşetilmedi.

**(A) Fiziksel kaynak izi.** `ingestion/locators.py` + `ingestion/segments.py`
+ `20260911100000_source_locators.sql` (`legal.document_version_segments`).
Kanonik kod noktası aralığı artık **fiziksel PDF sayfasına** (ya da DOCX'te
paragrafa) çözülüyor. NFC her blok için **aralıklar ölçülmeden önce**
uygulanıyor; bu yüzden Türkçe birleşik karakterlerde kayma imkânsız ve
oluşturucu her yüklemede NFC değişmezliğini + sınır/sıra kontrolünü
**çalışma anında doğruluyor**, doğrulayamazsa **hiç harita üretmiyor**
(eksik harita görünür bir boşluk, yanlış harita sahte bir atıftır).
**Okunamayan sayfa satır olarak duruyor** (boş aralık), böylece kapsam
"12 sayfanın 7'si okunamadı" diyebiliyor. DOCX'e sayfa numarası YAZILMIYOR —
uydurma atıf sınıfına girer.

**(B) Dosya (matter) arama kapsamı.** `control-plane/src/matters/scope.ts` +
cevap isteğinde eklemeli `scope` alanı. `matterId` eskiden yalnız "cevabı bu
dosyaya işle" demekti; retrieval'a hiç ulaşmıyordu. Artık üyelik **sunucuda**
çözülüyor (tarayıcı 150 belge kimliğini gönderemez ve bilmez).
**Kapsam asla genişlemiyor:** hem dosya hem belge kimliği verilirse kimlikler
üyeliğe karşı DOĞRULANIYOR, dışarıdakiler **adıyla** reddediliyor.
İki tavan var: istek gövdesi için 50 (eski), sunucu genişletmesi için
`MATTER_SCOPE_MAX_FILES` **500**.

**(C) Anlamsal şerit artık aday üretebiliyor.** `chunkProvenanceByIds`
(`chunkStore.ts`) yalnız anlamsal şeridin bulduğu parça kimliklerini
hidrate ediyor; öncesinde bunlar puanlanıp sıralanıp **sessizce
düşürülüyordu** (provenance satırı yoktu), yani anlamsal arama ancak
sözlüğün zaten bulduğunu yeniden sıralayabiliyordu. Hidrasyon **bir güvenlik
sınırıdır**: aynı görünürlük filtresi yeniden uygulanıyor, çünkü bir vektör
indeksi kiracılığı, yayım durumunu ya da dosya kapsamını bilmez —
**indeks güvenilmez girdidir**. Şerit durumu dürüst: `ACTIVE/DEGRADED/
DISABLED/FAILED`, ayrıca `denseOnly` (sözlüğün bulamadığı kaç pasaj geldi).

**(D) Kapsamlı dosya incelemesi — sayım, sıralama değil.**
`control-plane/src/exhaustive/` + `20260911110000_matter_analysis.sql`
(4 tablo). `POST /v1/matters/{id}/analysis` seçilen kapsamın **her analiz
biriminden** geçiyor, normalleştirilmiş önermeler çıkarıyor ve bunları
**dosyanın tamamında** karşılaştırıyor. `/v1/answer` hiç değişmedi ve hızlı
kaldı. **`processingCoverage.complete` TÜRETİLİR**, hiçbir model onu
etkileyemez: 1 birim düşerse ya da 1 sayfa okunamazsa `false` ve boşluk
kalem kalem listeleniyor. Boş kapsam da `complete` değildir.
**Fark otomatik olarak çelişki değildir:** `CONTRADICTION / TENSION /
CORROBORATION / INDEPENDENT / INSUFFICIENT_EVIDENCE`.

**(E) Yerel üretim sağlayıcısı ve `LOCAL_ONLY` sınırı.**
`control-plane/src/llm/{endpointTrust,localGenerationConfig,localGenerationAdapter}.ts`.
Üç güven düzeyi: `LOCAL_PROCESS` (loopback), `TRUSTED_LOCAL_NETWORK`
(operatörün **açıkça listelediği** `host:port`), `CLOUD`. Listelenmemiş özel
adres **reddedilir** — aksi hâlde bir ayar alanı istek sahteciliği aracına
dönerdi. `LOCAL_ONLY` bulutu yasaklar ve **geri düşüş yoktur**: yerel model
çalışmıyorsa bu bir arızadır, dosyayı dışarı göndermek için gerekçe değil.
Sınır **her çağrıda** yeniden denetlenir. Model adı koda gömülmedi.

### Ölçüldü (11.09.2026, W19 kapanışı)

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| W19-1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| W19-2 | `control-plane> npx vitest run` | **149 dosya · 2 798 geçti · 0 DÜŞTÜ · 6 atlandı (2 804)** · 31,0 sn. Başlangıç ölçümü (bu dalgadan önce, bu makinede): **144 dosya · 2 677 geçti · 6 atlandı** — yani **+5 dosya / +121 test**, düşen yok. Altı atlamanın altısı da W18'dekiyle aynı ters işaretleyicidir | 0 |
| W19-3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 469 geçti** · 179,17 sn (başlangıç: **1 426 geçti**; +43 = `tests/intake/test_locators.py` 32 + `tests/intake/test_locators_db.py` 6 + `tests/intake/test_backfill_locators.py` 5) | 0 |
| W19-4 | `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS**, artık **15 migrasyon** koşuyor (13 → +`20260911100000_source_locators.sql` +`20260911110000_matter_analysis.sql`) · `RESULT: PASS` | 0 |
| W19-5 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: **54 tools**, court inventory, shared limiter, disabled-key errors, HTTP auth` — **araç yüzeyi değişmedi** | 0 |
| W19-6 | `openapi.yaml` (pyyaml ayrıştırması + `$ref` yürüyüşü) | **73 yol / 89 işlem / 149 şema** (W16: 67/82/140). **Çözülmeyen `$ref` 0**, referans verilmeyen şema **0**, tekrar eden `operationId` **0**, CR baytı **0**. Delta **tamamen eklemeli**: 3 yeni işlem + 8 yeni şema + `AnswerRequest.scope` (isteğe bağlı) | — |
| W19-7 | RLS politika sayısı (gerçek küme) | **18 → 23** (+1 kaynak izi, +4 dosya incelemesi). `EXPECTED_RLS_POLICIES` ve iki Python testi aynı sayıyı taşıyor | — |
| W19-8 | **Senaryo A** — 200 sayfalık PDF | 200 sayfanın **200'ü** provenance'ta; 137. sayfaya ekilen ifade **`s. 137`**'ye çözülüyor; aralık kanonik metnin **birebir dilimi** ve PostgreSQL'in `substring` sonucu Python dilimiyle **aynı** | 0 |
| W19-9 | **Senaryo G** — uzak belgelerdeki çelişkiler | 4 belgeye (her biri ~40 paragraf) ekilen **tutar** ve **tarih** çelişkileri bulunuyor; iki yarı **ayrı belgelerde** ve ortak sözcükleri yok — sıralamaya dayalı bir küme ikisini aynı anda getiremez | 0 |
| W19-10 | **Senaryo H** — kesinti ve devam | Yarıda kesilen koşu **asla** `complete` demiyor; devam ettiğinde yalnız **değişmemiş olmayan** birimler yeniden okunuyor; belge değişirse hash değiştiği için **yeniden** okunuyor | 0 |
| W19-11 | **Senaryo I** — `LOCAL_ONLY` | Çağrıldığında **testi düşüren** sahte bir bulut taşıyıcısı kuruldu; bulut çağrısı sayısı **0**. Yerel model ölüyken de **0** (geri düşüş yok) | 0 |
| W19-12 | Gerçek `processingCoverage` (uçtan uca, gerçek veritabanı) | Aşağıdaki iki örnek, `collex_exhaustive_test` üzerinde çalışan gerçek koşulardan **birebir** alınmıştır | 0 |

| W19-13 | **Gerçek sunucu, gerçek yükleme, uçtan uca** (`collex_w19_verify`, port 8977, kullanıcının 8787'deki kendi süreci hiç kapatılmadı) | `/v1/health` → **`migrations 15/15, missing 0`**, **`rls {expected:23, present:23}`**, `registeredToolCount` **54**, `dataBoundary:"ALLOW_CLOUD"`, `localAi.state:"not_configured"` (`liveTested:false`). İki gerçek PDF `/v1/files` üzerinden yüklendi (her biri 3 sayfa) → sayfa dilimleri **gerçek intake yolundan** yazıldı: `[0,131) [133,328) [330,461)` — bitişik, örtüşmeyen, ayırıcı boşluklarıyla. Dosyaya bağlanıp `POST /v1/matters/{id}/analysis` çağrıldı: **`complete:true`**, 2 belge / **6 sayfa** / 6'sı da metin katmanı / 2 birim / 0 boşluk; ekran cümlesi "Seçtiğiniz 2 belgenin tamamı okundu (6 sayfa)."; ekilen **belgeler arası çelişki bulundu**: `CONTRADICTION — "Aynı konuda iki farklı tutar var: 32.000 TL ve 45.000 TL. İkisi birden doğru olamaz."` | 0 |
| W19-14 | **Dürüstlük kapısı, gerçek sunucuda** | Dosyaya karşılığı olmayan iki belge kimliği bağlandı. Sonuç **temiz bir inceleme değil**: `complete:false`, `filesFailed:2`, iki belge de `FILE_EXTRACTION_FAILED` olarak **adıyla** listelendi ve `exhaustiveClaimRefusedBecause` doldu — yani "dosyanın tamamı" cümlesi yazılamaz | 0 |

**W19-12, ölçülen iki gerçek çıktı.** Tamamlanan koşu:

```json
{"filesTotal":2,"filesProcessed":2,"filesFailed":0,
 "pagesTotal":2,"pagesProcessed":2,"pagesTextLayer":2,"pagesOcr":0,
 "pagesUnreadable":0,
 "analysisUnitsTotal":2,"analysisUnitsProcessed":2,"analysisUnitsFailed":0,
 "complete":true,"gaps":[]}
```

Taranmış bir sayfa içeren koşu — **aynı kod, `complete:false`**:

```json
{"filesTotal":2,"filesProcessed":2,"filesFailed":0,
 "pagesTotal":3,"pagesProcessed":2,"pagesTextLayer":2,"pagesOcr":0,
 "pagesUnreadable":1,
 "analysisUnitsTotal":2,"analysisUnitsProcessed":2,"analysisUnitsFailed":0,
 "complete":false,
 "gaps":[{"fileId":"cccc3333","fileName":"Taranmış ek",
          "locator":"s. 2","reason":"UNREADABLE_NO_TEXT"}]}
```

İkinci koşuda ekranda **"tamamı okundu" cümlesi üretilmiyor** ve
`exhaustiveClaimRefusedBecause` dolu: "tüm çelişkiler" gibi bir cümle
yazmak yasaklanıyor.

### Çekişmeli denetim turu (aynı oturumda, kapanıştan önce)

Yamanın kendisi **altı ayrı saldırı hattıyla** denetlendi (offset/sayfa,
kapsam/kiracı, anlamsal şerit, sayım/kapsam, `LOCAL_ONLY`/dışa trafik,
sözleşme gerilemesi) ve her iddia **ayrıca çürütülmeye çalışıldı**:
**49 aday bulgu → 42 hüküm → 29 gerçek** (11 major, 15 minor, 3 not;
**doğrulanmış blocker yok**), **13 çürütüldü**, ve saldırıların
**60 tanesi tutmadı** (kod dayandı). Gerçek çıkanların tamamı bu turda
kapatıldı ya da açıkça kayda geçti. Kapatılanlardan bazıları:

- **Gözlemler, birimler "okundu" işaretlenmeden ÖNCE yazılıyor.** Tersi
  sırada, aradaki bir hata birimleri "okundu" bırakıp gösterecek hiçbir şey
  bırakmıyordu — ve okundu sayılan birim devam turunda atlandığı için o
  kanıt bir daha hiç üretilmeyecekti.
- **Yönlendirme (redirect) reddediliyor.** `fetch` varsayılanı yönlendirmeyi
  izler; sınır denetimi geçtikten SONRA gelen bir 307, ayrıcalıklı metni
  yanıtın gösterdiği sunucuya taşırdı.
- **Eşzamanlılık > 1 olay döngüsünü kilitliyordu** (yerleşmiş bir söz
  üzerinde dönen bekleme). Sınırlı kuyruğa çevrildi.
- **Alıntı ofsetleri alıntıyı tam sınırlamıyordu**: başlangıç `trim()`
  öncesi, uzunluk sonrası ölçülüyordu; kendi metnini yeniden üretmeyen bir
  atıf, atıf değildir.
- **Sayfa haritası olmayan belge** artık `NO_SOURCE_MAP` boşluğu üretiyor;
  önce `pagesTotal: 0` ile sayfa testinden sessizce geçiyordu.
- **1–9 karakterlik sayfa** artık `SPARSE` (metni kanonik metinde ve
  alıntılanabilir); önce `UNREADABLE` deniyordu, yani aynı koşu hem "bu
  sayfa okunamadı" diyor hem o sayfayı alıntılıyordu.
- **`codePointSlice` O(n²)** idi (her çağrıda öneki yeniden kuruyordu);
  doğrusal hâle getirildi.
- **Temel adresteki parola** `baseUrl` üzerinden sağlık çıktısına
  sızabiliyordu; artık ayıklanıyor.
- **`MATTER_TOO_LARGE`** artık gerçekten TARANACAK kümeye uygulanıyor;
  önce hata iletisinin istediği daraltmayı reddediyordu.
- **Bildirmeyen bir anlamsal şerit hiç çağrılmıyordu** (varsayılan
  `DISABLED`); varsayılan `ACTIVE` oldu, `NoopDenseLane` açıkça
  `DISABLED` ilan ediyor.
- Ayrıca: eski belgeler için `scripts/backfill_locators.py` eklendi —
  **metin eşleşmiyorsa harita YAZMIYOR**, çünkü metnine uymayan bir sayfa
  haritası, haritasızlıktan kötüdür.

### W19'da bir kusur ölçülerek bulundu ve kapatıldı

Devam (resumption) anahtarı önce **yalnız metin hash'iydi**. Uzun bir dosyada
iki birimin metni birebir aynı olabilir (tekrarlayan matbu paragraf); bu
durumda ikinci birim **hiç okunmadan** `done` işaretleniyor, gözlemleri
üretilmiyor ama kapsam onu **okunmuş sayıyordu** — yani sessiz kapsam
şişmesi. Anahtar `unitNo + sourceSha256` yapıldı: **konum** ve **içerik**
birlikte eşleşmeden yeniden kullanım yok. Kusuru Senaryo H testi yakaladı.

### W19'un AÇIK bıraktıkları — kapatılmış gibi yazma

- **OCR indirilmedi.** Sayfa modeli `extraction_method='ocr'` ve
  `pagesOcr` taşıyor, ama **OCR sağlayıcısı yok**. Bu makinede yerel OCR
  çalışma zamanı da yok (`pytesseract`/`PIL` kurulu değil). Taranmış sayfa
  bugün **UNREADABLE** kalır ve kapsamı `complete` olmaktan çıkarır —
  bu doğru davranıştır, ama **Senaryo C ölçülemedi**.
- **Anlamsal şerit hâlâ varsayılan olarak KAPALI.** Hidrasyon kusuru
  düzeltildi ve gerçek bir şerit artık aday üretebilir, ama üretimde
  bağlı bir şerit **yok**: `NoopDenseLane` varsayılan. Gömme işçisi,
  yerel vektör indeksi ve profil/boyut migrasyonu **bu dalgada yapılmadı**
  (`legal.embedding_profiles` hâlâ `check (dimensions = 1024)` taşıyor ve
  yerel E5 **384** boyut üretir — bu çelişki **açık**).
- **Yerel üretim sağlayıcısı ölçülmedi.** Sınır, yapılandırma, bağdaştırıcı
  ve `LOCAL_ONLY` testli; ama **hiçbir gerçek model çağrılmadı** ve M2 Mac
  mini bu ortamdan ölçülemez. `control-plane/scripts/probe_local_generation.mjs`
  ölçümü yapan betiktir; **çalıştırılana kadar hiçbir hız sayısı yazılamaz**.
- **Önerme çıkarımı üç değer türüyle sınırlı** (tarih, tutar, oran) ve
  konu anahtarı bir **sezgiseldir** (`DEFAULT_SUBJECT_OVERLAP = 0,4`).
  Gerçek Türk dosyaları üzerinde **ölçülmedi**; neyin KARŞILAŞTIRILACAĞINI
  belirler, neyin İDDİA EDİLECEĞİNİ değil.
- **Konsol yüzeyi eklenmedi.** Dosya incelemesi bugün yalnız API'dedir;
  avukat ekranından erişilemez.
- **Kapsamlı inceleme senkron koşar.** Determinist çıkarıcı hızlıdır ve
  sayım kalıcıdır; ama uzun bir model destekli koşu için arka plan işçisi
  ve ilerleme akışı **yok**.
- Önceki dalgaların açık sınırlarının hiçbiri kapanmadı; `RISKS.md` ve
  aşağıdaki eski bölümler aynen geçerlidir.

## 10.09.2026 — W18: arama kalitesi, konsol iş akışları, kütüphane, kaynak uyarısı

Dört paket tek oturumda kapatıldı; hepsi additive, hiçbir araç sözleşmesi ya
da eşik gevşetilmedi. (A) Yerel korpus: `lexicalSearch` IDF ağırlıklı skor ve
IDF ağırlıklı asgari eşleşme (eski 0,25 kuralının kabul ettiği hiçbir pasajı
düşürmez; özellik testi SQL ile karşılaştırır), `rrf.ts` şerit ağırlıkları,
`retrieval/queryExpansion.ts` kavram genişletmesi (`expansion` alanı),
`retrieval/turkishAnalyzer.ts` ortak Türkçe çözümleyici. (B) Canlı karar
arama: `compareRelatedRows` puanlı ve açıklanabilir sıralama (`relevance`,
`ranking:"colleX-heuristic"`), anlam benzerliği pencereli gömme (belgenin
başıyla sınırlı değil), yinelenen sorgu birleştirme (`collapsedQueries`).
(C) Konsol: Ctrl+K komut paleti (`/v1/search/all`), klavye kısayolları,
"Nerede kalmıştım", dosya paketi indirme, Kişiler + çıkar çatışması taraması,
bulut yapay zekâ defteri kartı, süre paneli 7/14/30 gün + tamamlandı,
"Hukuk kütüphanem" kartı ve "Kütüphaneye al", karar satırında "sıralama
sinyalleri". (D) Yerel kütüphane uçtan uca ölçüldü (S92). (E) Kaynak uyarısı
artık cevaba aittir: kabul edilen her belge gerçek kaynaktan yayımlanmışsa
"deneme belgeleri" uyarısı yerine kütüphane notu yazılır; bir tane bile
bilinmeyen/sentetik belge varsa uyarı kalır (`corpusProvenance`, additive).
Ölçüm: `npx tsc --noEmit` temiz; `npx vitest run` 144 dosya, 2677 geçti,
6 atlandı; `pytest tests/ingestion` 119 geçti; `smoke_check.py` 54 araç.
Sıralama ağırlıkları (0,7 trigram; 0,5 genişletme; 0,40/0,20/0,25/0,10/0,05
ilgililik) seçilmiş değerlerdir, gerçek hukuk üzerinde ölçülmemiştir; her
yüzey bunu söyler.

## 10.09.2026 — konsol arayüzü yeniden tasarımı ("Sessiz Danışman")

`control-plane/public/console.html` içindeki tek `<style>` bloğu baştan
yazıldı; HTML'de yalnız iki sarmalayıcı eklendi (`.tools`: yardım + tema,
`.brandline`: ilk açılış marka satırı). JavaScript'e dokunulmadı. Jeton adları
ve testlerin birebir kilitlediği kurallar (odak halkası, `--border` değerleri,
kart kenarı, yazdırma kuralları, 481/640/1200 px kırılımları, serif/ölçü
blokları) korundu; görünüm jeton değerleri ve bileşen kurallarıyla değişti:
sıcak-nötr açık tema, grafit koyu tema, tek vurgu (mühür bordosu), parçalı
sekme denetimi, beyaz zeminli girdiler, tek satırlık durum şeridi.
Ölçüm: `npx vitest run` → 138 dosya, 2572 geçti, 6 atlandı (10.09.2026);
konsol testleri 269/269. Tarayıcı doğrulaması yapıldı: 1280, 1024, 820, 640 ve
390 px genişliklerde açık/koyu tema, ilk açılış ve kompakt kabuk, Araştır /
Belgeler / Taslak / Ayarlar / Takvim / Karar ara / Nasıl çalışır ekranları,
süre modali ve yardım menüsü; 390 px'te `scrollWidth === 390` (yatay taşma yok).
Cevap/tespit kartları canlı veri olmadan görsel olarak doğrulanamadı; CSS'i
yalnız jeton düzeyinde değişti. Değişiklik öncesi kopya:
`%TEMP%\collex-backup\console.before-premium.html`.

## 10.09.2026 kullanım teslimi

Kullanıcı rehberi ilk açılıştan kapatmaya kadar hızlı başlangıç adımları,
DOCX sözleşme inceleme raporu, dosya yükleme akışı ve eksik kurulum günlükleri
ile güncellendi. Tip kontrolü geçti; offline smoke 54 araçla ve yerel veritabanı
19/19 kontrolle geçti. Tam tarayıcı görsel doğrulaması bu oturumda kullanım
limiti nedeniyle yapılamadı; HTTP sağlık ve API kontrolleri kullanıldı.

## 10.09.2026 devamı — seyrek PDF sayfalarının kaybolmaması

Python intake zaten `sparsePages` üretiyordu; TypeScript dosya deposu bu
alanı düşürdüğü için belge ekranı yalnız tamamen boş sayfaları uyarabiliyordu.
`FilePageStats` artık bu alanı güvenli metadata daraltmasıyla koruyor, dosya
listesi/detay yanıtları ve OpenAPI şeması aynı sözleşmeyi taşıyor. Konsol,
seyrek metin katmanını boş/taranmış sayfadan ayırıyor ve bu sayfaların tam
okunmuş sayılamayacağını söylüyor. Geçersiz sayaçlar ve sayfa numaraları
aktarılmıyor. Intake'in sakladığı özgün dosya boyutu da liste/detay
yanıtlarına taşınıyor; indirme açıklaması artık sıfır yerine gerçek boyutu
gösterebiliyor. Python intake'in list/show yardımcıları da aynı `sizeBytes` ve
sayfa istatistiklerini taşıyor. `tsc --noEmit` ve `git diff --check` temiz. Dosya rotası
Vitest/mutasyon koşusu Windows esbuild alt süreç kısıtı ile bu oturumun
kullanım limiti yüzünden yeniden çalıştırılamadı; yaşam döngüsü statik mutasyon
koşusu üç bozulmayı da yakaladı.

Başlatıcı da yerel E5 yaşam döngüsünü yönetiyor: `ColleX-Baslat.cmd` MCP'den
ayrı 8899 portunu açmayı ister, `serve.mjs` yalnız beklenen loopback sağlık
yanıtına sahip servisi yeniden kullanır ve kendi model çocuğunu kapanışta
sonlandırır. Model yoksa uygulama açılışı durmaz; araştırma lexical fallback'i
hazırmış gibi göstermeden kullanır.
Başlatıcı/servis/stopper sözleşmesinin üç kasıtlı bozulması da statik mutasyon
kontrolünde yakalandı (`check-local-lifecycle-mutations.mjs`).

Sözleşme incelemesinin son eksik halkası da kapatıldı: `POST
/v1/contracts/review/export` aynı kural tabanlı raporu yeniden üretip
`export.cli --review --format inceleme-docx` ile öz-denetimli DOCX döndürüyor.
Konsoldaki inceleme sonucu artık "DOCX raporu indir" düğmesini gösteriyor;
rapor üretilemezse kısmi dosya yerine korelasyon numaralı tipli hata dönüyor.

Last updated: **2026-09-10** (W13 istihbarat + tasarım dalgası → **W14**: Faz A
yedi paralel hat (`waves/W14-L-{EVID,ANSWER,SAFE,MATTER,LEGAL,SOURCES,CONSOLE}.md`)
→ Faz B1 entegrasyon (`waves/W14-L-FIX.md`) → Faz B2 konsol
(`waves/W14-L-CONSOLE-B.md`) ve belge uzlaştırması (`waves/W14-L-DOCS.md`)
→ **bağımsız doğrulama** (`waves/W14-L-VERIFY.md`, V-1..V-22)
→ **Faz F düzeltme hatları**: `waves/W14-F-PERF.md` (V-1, V-2),
`waves/W14-F-API.md` (V-3, V-4, V-6), `waves/W14-F-UI.md` (on beş arayüz
kalemi), `waves/W14-F-DOCS.md` (belgeler)
→ **bağımsız son doğrulama** (`waves/W14-F-VERIFY.md`, hüküm **16 kapandı /
3 iyileşti / 3 açık**, artı **altı yeni kusur N-1..N-6**)
→ **Faz C cila hatları**: `waves/W14-C-SRV.md` (V-14, V-19, V-21, N-1, N-2,
N-3) ve `waves/W14-C-UI.md` (N-4, N-5, N-6, V-10 ve V-22 kalıntıları)
→ `C-FINAL` (`waves/W14-C-FINAL.md`, ölçüm + belge; **N-7 ve N-8**'i buldu)
→ **Faz M hatları**: `waves/W14-M-SRV.md` (IR-1, IR-2, **N-8 kapandı**, N-7'nin
bandı ve kök nedeni) ve `waves/W14-M-UI.md` (uzun beklemede ilerleme + "Vazgeç",
iki yeni alanın ekranı)
→ `M-CLOSE` (`waves/W14-M-CLOSE.md`) son ölçümü alıp belgeleri o ölçüme
oturttu
→ bu tur (`N7`, `waves/W14-N7.md`) N-7'nin kalan kök nedenini buldu, düzeltti
ve ölçtü: `AnswerPipeline`'ın sıralama eşitliği bir ingest UUID'siyle
çözülüyordu; artık korpus kimliğiyle çözülüyor ve cevap katmanı altı ardışık
koşuda birebir aynı (**N-7 KAPANDI**, S41))
→ **W17 — canlı deneme ve kalite onarımı (05.09.2026)**: W16'nın "olayı anlat →
ilgili kararlar" akışı GERÇEK resmî kaynaklarla çalıştırıldı ve sonuç kalitesi
ölçülerek kötü bulundu. Bir kira tahliye olayında 46 saniyede 63 satır döndü ve
listenin başında **Danıştay Vergi Dava Daireleri Kurulu** ile **Yargıtay 8. Ceza
Dairesi** vardı. Dört kök neden ölçüldü ve düzeltildi: (1) kavram yalnız
ANAHTARI birebir geçtiğinde ateşliyordu, bu yüzden 164 kavramdan yalnız jenerik
"kira" yakalandı — artık anahtarın KENDİ SÖZCÜKLERİ Türkçe ek toleransıyla
aranıyor ve "temerrüt nedeniyle tahliye" yakalanıyor; (2) tek sözcüklü sorgu
("kira", "tahliye") arşivin tamamını getiriyordu — artık tek sözcük ya kanunî
çapasıyla ya da hiç gitmiyor; (3) MUTABAKAT sorguları sayıyordu, yani tek
kavramın üç söylenişi üç mutabakat gibi görünüyordu — birincil ölçüt artık
**kaç ayrı hukukî konu**; (4) özel hukuk olayında idarî arşiv de taranıyordu —
kanunî çapa adlî/idarî aileyi belirliyor ve dışarıda bırakılan merci **adıyla,
nedeniyle ve geri alınabilir biçimde** yazılıyor. Aynı olayla ölçülen sonuç:
6 sorgunun 6'sı koştu (önce 4/6), süre **46 sn → 33 sn**, Yargıtay'ın kira
daireleri (3. ve 6. HD) ilk yediye girdi. Ayrıca iki gerileme kapatıldı:
araştırma hattında arama aşaması getirme bütçesini tüketebiliyordu (artık en az
bir tam metin için bütçe ayrılıyor — getirilmemiş bir künye kanıt değildir), ve
kaynak dosyalara **görünmez kontrol karakteri** sızabiliyordu (bir regex'in
ters-bölü-b kaçışı BACKSPACE baytına dönüşmüş, derleyici ve testler temiz kalmış ama
desen hiç eşleşmemişti) — `tests/security/sourceHygiene.test.ts` bunu kapatır.
→ **W17/b — dilekçe analizi gerçek bir dilekçeyle denendi (06.09.2026)**:
kullanıcının isteğiyle **gerçek bir Türk cevap dilekçesi** (eser sözleşmesi /
ayıp uyuşmazlığı; TBK m. 474-475, TTK m. 23/1-c, HMK m. 119/129 ve bir Yargıtay
15. HD kararı atıflı) çalışan bir sunucuya POST edildi. **Sentetik fixture'ın
geçtiği her testi geçen kod, gerçek belgede on kusur verdi** — çünkü fixture
her başlığı kendi satırına yazıyor, gerçek dilekçe yazmıyor. Ölçülen başlangıç:
**2 dk 04 sn · 12 iddia · 1 yanlış "bulundu" · 10 atıf satırı · 50 alâkasız
aleyhe kayıt**. Bulunan ve düzeltilen kusurlar:
(1) **`KONU : …` bir iddia oluyordu** — `isPreambleLine`'ın 90 karakterlik
şekil sınırı, yalnız iki nokta öncesini okuyan etiket testinden ÖNCE
çalışıyordu; gerçek KONU satırı 97 karakter;
(2) **imza bloğu** ("Davalı Vekili" / "Av. Selin Aydın") iddia-12 oluyordu;
(3) **satır içi başlıklar görülmüyordu** — `HUKUKÎ SEBEPLER : …`, `DELİLLER : …`
ve `SONUÇ VE İSTEM : …` üç bölüm önce bırakılmış "AÇIKLAMALAR" başlığı altında
duruyordu;
(4) **her iddia "vakıa" etiketliydi** — jenerik başlık altında paragrafın kendi
ATFI karar veriyor artık (etiket süs değil: "vakıa"nın açıklaması avukata atfın
olmamasının olağan olduğunu söyler, yani yanlış etiket eksik atfı MAZUR
gösterir);
(5) **çıplak "TBK" ikinci bir atıf olarak yaşıyordu** ve çözümleyici onu kanunun
İLK maddesiyle yanıtlayıp "bulundu — … m. 1" yazıyordu — belgede m. 475 yazan
bir atıf için;
(6) **aleyhe sorgular kanun NUMARASINDAN kuruluyordu** (`6098 sayılı m. 475
bozma`) — hiçbir karar öyle yazılmaz, arşiv gevşek eşleşip beş alâkasız kararı
"aleyhe kaynak BULUNDU" diye döndürüyordu;
(7) **aleyhe aşamasının saati yoktu** — yalnız şerit SAYISI vardı;
(8) **künye üç kez basılıyordu** ("Yargıtay 11. Hukuk Dairesi · Yargıtay 11.
Hukuk Dairesi E. 2026/5892 K. 2026/4208 · 2026/5892 · 2026/4208") ve bir satırın
karar tarihi **"6006-09-20"** olarak olduğu gibi yazılıyordu;
(9) **hiçbir kaydın bağlantısı yoktu** — rapor "tam metni açıp alıntıyı
doğrulayın" diyor, açılacak bir şey yoktu;
(10) **10 iddianın 8'i hiç sorgu üretmiyordu**; belge bütününden ödünç alınan
kavramın ilk denemesi ise **"ihbar tazminatı"** çıktı (bir iş hukuku kurumu, bu
dosyada geçmiyor) ve 16 şeridin 13'ü süre bütçesine takıldı.
Aynı dilekçeyle ölçülen sonuç: **33,2 sn · 10 iddia · yanlış "bulundu" 0 ·
6 atıf satırı (hepsi kanunuyla birlikte: `TBK m. 475`, `HMK m. 129` …) ·
16 şeridin 15'i koştu · her kayıt tek satırlık künye + `Karar tarihi: 13.07.2026`
+ çalışan `mevzuat.adalet.gov.tr` bağlantısı**; okunamayan tarih artık tarih
gibi basılmıyor. Belge konusu artık **iddiaların kendi tanıdığı** kavramlardan
seçiliyor ("eser sözleşmesi") ve ödünç alındığı ekranda YAZIYOR; aynı sorgu bir
raporda **bir kez** gönderiliyor (13 şerit önbellekten yanıtlandı, süre
artmadı). Aleyhe bağlantı sağlayıcı metnidir ve konsol onu doğrudan bir
`href`'e yazdığı için **getirme katmanının izin listesinden** (`checkFetchUrl`)
geçiriliyor; reddedilen bağlantı yerine bağlantı YOK.
Ardından aynı yüzeye **altı bağımsız mercek** salındı ve her bulgu **iki ayrı
şüpheciye** çürütülmek üzere verildi: **35 bulgu yargılandı, 14'ü ayakta kaldı,
21'i çürütüldü** — ve on dördü de düzeltildi. En pahalı üçü: (a) `searchSources`
her hatayı yakalayıp `rows: []` ile döndüğü ve port `failedSources`'ı hiç
okumadığı için **ölü bir kaynak "arandı, bulunamadı" diye çiziliyordu** ve
**ARAMA_BASARISIZ üründe hiç erişilemiyordu**; (b) **"aleyhe kaynak bulundu"
ölçülmemiş bir yön iddia ediyordu** — hiçbir şey dönen kararın iddianın AKSİ
yönde olup olmadığına bakmıyor, ve bir eser sözleşmesi dosyasında rozet beş
Yargıtay 11. HD (ticaret) kararının üzerinde duruyordu; yönü doğrulamak denendi
ve `ContraryHit`'in yalnız künye taşıması + Bedesten'in hiç snippet
yayınlamaması yüzünden **durumu erişilemez yapacağı** görüldü, bu yüzden etiket
ve açıklama artık yalnız ölçüleni söylüyor (**"sorgu sonuç getirdi"** +
"…AKSİ yönünde olup olmadığı ÖLÇÜLMEDİ"); (c) W17'nin kendi liste testi
`kind === "DIGER"` idi, oysa `DIGER` aynı zamanda "sınıflandıramadım"
değeridir — sıradan bir **ceza savunma dilekçesinde beş iddianın dördü** bir
delil listesi sayılıp hiç aranmıyordu. Ayrıca: `1-)` ve `(1)` numaralandırması
ile `I. AÇIKLAMALAR` başlığı görünmezdi (bir icra itirazının üç sebebi TEK
iddiaya çöküyordu); `İCRA MÜDÜRLÜĞÜ'NE` ve `MÜDAFİ : …` iddia oluyordu;
"sözleşmenin 5. maddesi" bir mevzuat atfı sayılıyordu; satır sonuyla bölünen
"2004 sayılı İcra ve İflas Kanunu m. 269" hiç kanun üretmiyordu (belge artık
DÜZYAZI olarak ayrıştırılıyor); karşı tarafın cümlesinin yanındaki "?" TASLAK
ekranının tanımını açıyordu; bir bildirim avukatı ekranda olmayan bir "alan"a
yolluyordu; ekranın giriş cümlesinde "kova" duruyordu; ve tarayıcıda ölçülen
iki kusur — "Tam metne git" bağlantısının `target`'ı yoktu (bir tık 33 saniyelik
raporu götürüyordu) ve ödünç kavram iki kez yazılıyordu. Bu turun tek sayı
değişikliği: HUKUKÎ SEBEPLER bloğunun atıf sayısı **4 → 5**.
Yeni gerileme testleri: `tests/contracts/petitionRealPetition.test.ts` (28),
`tests/contracts/petitionShapes.test.ts` (15),
`tests/integration/contraryOutage.test.ts` (4),
`tests/sources/kunyeFormat.test.ts` (10),
`tests/security/contraryHref.test.ts` (7). Ayrıntı: `waves/W17-DILEKCE.md`.
→ **W16 rakip farkı dalgası (05.09.2026)**: kullanıcının sorusu üzerine
(*"Apilex ve De Jure'ye göre eksik yönlerimiz var mı?"*) üç eksende ölçülen
gerçek boşluklar kapatıldı — **semantik/ilgili karar arama**, **dilekçe
yazımı**, **dilekçe analizi** — artı ikisinin yapısal olarak kopyalayamayacağı
bir üstünlük açıldı. Ölçülen çıkış noktası dürüsttü: `hybrid.ts`'in yoğun
(dense) şeridi STUB, kavram tablosu 18 madde, `search_bedesten_semantic` ise
12M kararda semantik arama değil, anahtar kelimeyle çekilen **en çok 10 adayı**
yeniden sıralayan bir araç. Yapılanlar: kavram tablosu **18 → 164** (kanunî
çapalarla, en spesifik önce); **POST /v1/sources/related** — olay anlatısından
en çok 8 sorgu üretip 26 resmî kaynakta koşan, karar kimliğine göre
tekilleştiren ve **MUTABAKAT** (kaç ayrı aramanın bulduğu) ile sıralayan hat —
bu bir ilgililik puanı DEĞİLDİR ve ekranda öyle yazar; **semantik yeniden
sıralama** (varsayılan KAPALI, tipli neden, yalnız tam metni getirilmiş
belgede, yüzde YOK, üç sözel kademe); **POST /v1/contracts/petition-analysis**
— karşı dilekçe analizi, kural tabanlı, iddia başına üç kova ve aleyhe
kaynağın **dört ayrı durumu** (çalıştırılmamış şerit asla "bulunamadı" diye
çizilmez); taslakta **olay anlatısı** alanı (her paragraf beyan, ADR-021) ve
**Kısa/Geniş dayanak kapsamı** (yalnız ilgililik süzgecini açar; alan
uyuşmazlığı iki kipte de kapalı, doğrulama aynı); **14. şablon hukukî
mütalaa** (aleyhe bölümü boş bırakılamaz). Ve `ingestion/library.py` +
`--publish-library`: canlı araştırmanın getirdiği her tam metin artık
`collex_local`'a kalıcı yayımlanıyor ve `ColleX-Baslat.cmd` bunu her açılışta
çağırıyor — **arşiv kiralanmıyor, avukatın kendi diskinde birikiyor.**
→ **W15 anlaşılırlık dalgası (04.09.2026)**: kullanıcının tek cümlelik
şikâyeti üzerine (*"Normal bir avukat girdiğinde her şeyi anlayabilmeli.
SHA-256, Korpus falan … kimse anlamaz"*) 23 şeritlik bir denetim (820 bulgu,
`waves/W15-BULGULAR/`), on iki bağımsız tasarım önerisi + jürili sentez
(`waves/W15-TASARIM.md`), bağlayıcı değişmezler ve kanonik sözlük
(`waves/W15-DEGISMEZLER.md`, `waves/W15-SOZLUK.md`) ve yedi yapım şeridi.
Sonuç: ekranda görünen metinlerde **"SHA-256 · korpus · Unicode · endpoint ·
JSON · MCP · sentetik" geçişleri 49 → 0** (kalan beş geçiş yalnız katlanmış
"Teknik adı: …" katmanında); iki yeni ekran (**#nasil**, **#sozluk**), satır
içi **`?`** açıklama bileşeni ve TERM_TR'nin **tek tanım kaynağı** olması;
üç işleyiş kusuru kapandı (kapalı formun gerçekten kapanmaması, onaysız silme,
"Kayıtlı taslaklar" kartının arama yazılınca kaybolması); yazdırmada
uyarıların silinmesi ve içeriğin bir animasyona bağlı görünmesi düzeltildi.
Current phase: Faz 0–1 kabul; Faz 2–5 dikey dilimi yerelde uçtan uca; Faz 6
(yükleme/özel korpus), Faz 7 (dava dosyası belleği) ve Faz 8 (taslak editörü)
yerelde teslim edildi (UDF **deneysel**); W14 bunların üzerine alıntı bütünlüğü
kapısı, dosyalanabilir çıktı, atıf denetimi, takvim/`.ics`, kapsam manifestosu,
karar arama ucu, yedekleme, harç hesabı ve kişi kartlarını ekledi ve Faz B2'de
bunların ekranlarını çizdi.
Current gate: MVP kapısı — gerçek korpus, pgvector'lı hedef, hukukçu
doğrulamalı gold set, canlı sınanmış bulut AI, doğrulanmış süre kuralları ve
**isabeti hiç ölçülmemiş karar arama** bekliyor (uç artık çalışıyor ve gerçek
künye döndürüyor; ilgililiği ölçülmedi — S34).
Overall status: **PARTIAL** (gerekçe aşağıda).

> **Bu depoda ölçülen her sayı SENTETİK korpus üzerindedir.**
> `evals/fixtures/corpus/` sekiz dosyanın tamamı bu proje tarafından yazılmış
> test verisidir — gerçek Türk mevzuatı veya içtihadı değildir. Hiçbir sayı
> hukukî kalite ölçüsü olarak sunulamaz. W14'ün ölçek probe'ları
> (`collex_answer_test`, `collex_fix_test`, `collex_matter_test`,
> `collex_verify_test`, `collex_perf_test`, `collex_api_test`,
> `collex_final_test`, `collex_srv_test`) **üretilmiş** korpuslardır; sözcük
> dağarcıkları 200 sözcüklüktür ve trigram çeşitlilikleri gerçek Türk hukuk
> metninin çeşitliliği **değildir**. Doymuş uçta ölçülen her sayı bir **üst
> sınır** senaryosudur, "üründe böyle olacak" iddiası değildir. **Üç ayrı
> probe üç ayrı trigram tablosu verdi (S26⁗)** — bu, o sayıların korpusa ne
> kadar bağlı olduğunun ölçülmüş kanıtıdır.
>
> **Hiçbir şey canlı bir Supabase projesine uygulanmadı; hiçbir Supabase veya
> Resend MCP aracı hiçbir aşamada kullanılmadı.** Bütün veritabanı işi yerel
> PostgreSQL 18 (`127.0.0.1:55432`) üzerindedir; ürün deposu `collex_local`,
> demo/probe deposu `collex_demo`.
>
> **Tek istisna, kayda geçmiş:** W14'te L-LEGAL, `yargi-mevzuat` MCP araçları
> üzerinden mevzuat.gov.tr'ye erişebildi ve 38 madde metnini çekti. Bu, 16 süre
> kuralının ve 5 tarife kaleminin `dogrulandi` olmasının tek dayanağıdır.
> Aynı oturumda Yargıtay/Bedesten uçlarına **erişilemedi**; W14-F-API'nin
> §1.3'te kaydettiği `search_bedesten_unified` çağrısı da **ulaşamadı**.
>
> **İkinci istisna, Faz F/C'de eklendi:** F-VERIFY (2 arama + 1 tam metin) ve
> C-UI (5 arama + 2 tam metin) `POST /v1/sources/search` üzerinden **gerçek
> Bedesten/UYAP yanıtları aldı**. S34'ün künye sayıları ve C-UI §1.3'ün
> `total_records` değerleri (116 090 ↔ 758) **gerçek kaynaktan gelir**,
> sentetik korpustan değil — ve bunlar bir **ilgililik** ölçümü değildir.

## 10.09.2026 — yerel kütüphane (B-20 ikinci yarı) uçtan uca ölçüldü

Soru şuydu: çalışan sunucunun `/v1/health`'i kütüphaneden söz etmiyor ve
`corpus.publicDocuments` sıfır — `serve.mjs` kütüphane yollarını gerçekten
bağlıyor mu? Bağlıyor: `serve.mjs`, `createApp`'e `libraryDir` (`--library-dir`,
varsayılan `<veri>/library`) ve `filesDsn` (`--dsn`) değerlerini koşulsuz
geçiriyor; `GET /v1/library/status` ve `POST /v1/library/ingest` bu ikisi
varken monte ediliyor (ADR-027). `/v1/health`'te `library` diye bir alan
**yoktur ve hiç olmadı** — kütüphanenin sayıları `/v1/library/status`'ta
durur ve `publicDocuments` orada da sağlık sayfasıyla AYNI `countCorpus`
ifadesinden okunur. Bu makinede `collex_demo`'ya bağlı 8991 portundaki
sunucunun `/v1/library/status`'a **404** vermesinin sebebi kablolama değil,
o sürecin yollar yazılmadan ÖNCE başlatılmış olmasıdır (süreç listesi:
11:34'te bir codex oturumu başlatmış); `collex_local`'a bağlı 8787 sunucusu
aynı anda yolu cevaplıyordu. Kablolama artık
`control-plane/tests/integration/serveLibraryWiring.test.ts` ile
sabitlenmiştir (kaynak metni ayrıştırır, `launcher.test.ts` gibi).

Uçtan uca kanıt bu hattın kendi karalama veritabanında (`collex_ingest_test`;
yayımlayıcı `LIBRARY_DATABASES` gereği `collex_demo`'yu **reddeder**, bu
kasıtlıdır ve değiştirilmedi) ve ayrı bir veri dizinine bağlı geçici bir
`serve.mjs` örneğiyle alındı: zarf, gerçek yazıcı `FileLocalLibrary` ile
yazıldı; `python -m ingestion.library --json` iki kez koştu; aynı zarf
`yayimlandi/`'den kuyruğa geri kopyalanıp üçüncü kez koştu; ikinci zarf
`POST /v1/library/ingest` üzerinden yayımlandı; `/v1/answer` belgeyi
alıntısıyla buldu. Sayılar **S92**'dedir. İki tespit: (a) kuyruktan gelen
belge `effective_period` taşımadığı için (`ingestion/library.py` bunu
bilerek boş bırakır — alınma zamanı yürürlük tarihi değildir) cevap
`OUT_OF_DATE_SOURCE` / `currentness.status: UNKNOWN` ile PARTIAL ve
`finalizable:false` kalır; (b) `corpusNotice` bandı kütüphane belgesi için de
"DENEME BELGELERİ" diyor, oysa sürüm meta verisi `synthetic:false` /
`origin_label:"resmî kaynak"` taşıyor — ikisi de cevap hattının (başka
ekibin) alanıdır ve açık bırakıldı. Bu makinedeki gerçek kütüphane
(`collex_local`) ölçüm günü hâlâ sıfır belgeydi: kuyruk boştu, hiçbir belge
getirilip alınmamıştı.

## Ölçülen sayılar (03.09.2026, W14 Faz M kapanışı)

**Bu tablo bütün belge setinin TEK sayı kaynağıdır.** `TRACEABILITY.md`,
`DEMO.md`, `RUNBOOK.md`, `README.md`, `COMPETITIVE.md`, `RISKS.md`,
`FINAL_REPORT.md` ve `KULLANIM-ColleX.md` sayıları buradan alır; bir sayı
değişirse yalnız bu tablo güncellenir. Hiçbir belge bu tabloda satırı olmayan
bir sayı yazmaz (W13-BACKLOG §C.1 tuzağı).

"Kaynak" sütunu sayının **en son nerede ölçüldüğünü ve ne zaman** söyler.
**`M-CLOSE (bu tur)` = 03.09.2026 02:38–03:05 arasında, Faz M'in iki hattı
(`W14-M-SRV`, `W14-M-UI`) da indikten sonra, bu makinede, sıralı ve tek başına
koşuldu.** On komutun onu da exit 0 verdi ve **düşen tek bir test yok**;
`vitest` o turda **üç kez** koşuldu (N-8 düzeltmesinin denetimi) ve `run_evals`
**altı kez** (N-7'nin denetimi). **`N7 (bu tur)` = 03.09.2026 03:20–04:10;**
S2, S3, S5, S6, S7 ve S41 o turda yeniden ölçüldü — `run_evals` yine
**altı kez** artı bir `--repeats 4` koşusu, bu kez düzeltmenin denetimi için. Bir Faz A/B/F/C sayısı sonradan yeniden
ölçüldüyse buraya **yeni ölçüm** yazıldı, eski değeri değil; eski değer satırın
içinde "önce" olarak duruyor ki gerileme görünsün.

| # | Komut / yüzey | Ölçülen çıktı (03.09.2026) | Exit | Kaynak |
|---|---|---|---:|---|
| S1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) — **W17/b'de yeniden ölçüldü (06.09.2026), yine temiz** | 0 | **M-CLOSE (bu tur, 02:38)**; **W17/b (06.09.2026)** |
| S2 | `control-plane> npx vitest run` | **106 dosya · 2 145 geçti · 0 DÜŞTÜ · 6 atlandı (2 151)** · 25,3 sn (N7 turu; M-CLOSE'da 105 dosya / 2 143 geçti, 23,5 / 22,6 / 22,8 sn). **6 atlamanın altısı da ters işaretleyicidir** ("environment unavailable"): altı gerçek süitin (real-export, store/persistence, matters/pg, integration/{serve,real-exec,backup}) altısı da KOŞTU. Seyir: Faz B1 2 028 → L-VERIFY 2 047 → F-UI 2 081 → F-DOCS/F-VERIFY 2 086 → Faz C 2 114 → M-CLOSE 2 143 → **N7 turu 2 145** (+2: `tests/pipeline/rankDeterminism.test.ts`, N-7'nin gerileme testi). `console.test.ts` **179** test. **W15 (04.09.2026): 106 dosya · 2 200 geçti · 0 DÜŞTÜ · 6 atlandı (2 206)**; **W16 (05.09.2026): 114 dosya · 2 383 geçti**; **W17 (06.09.2026): 116 dosya · 2 398 geçti · 0 DÜŞTÜ · 6 atlandı (2 404)**; **W17/b (06.09.2026): 121 dosya · 2 465 geçti · 0 DÜŞTÜ · 6 atlandı (2 471)** · 24,9 sn (+5 dosya / +67 test: `contracts/petitionRealPetition` 28, `contracts/petitionShapes` 15, `sources/kunyeFormat` 10, `security/contraryHref` 7, `integration/contraryOutage` 4 — her biri gerçek bir dilekçede ya da çekişmeli denetimde ÖLÇÜLMÜŞ bir kusurdan); `console.test.ts` **179 → 234** (+55 anlaşılırlık kilidi: yasak sözcük süpürmesi, TERM_TR tek kaynak, `?` bileşeni, iki yeni ekranın yolları, görsel değişmezler) | 0 | **N7 (03.09, 03:27)** — bir tam koşu, yeşil; ondan önce **M-CLOSE (02:39–02:41), üç ardışık tam koşu, üçü de birebir aynı ve üçü de yeşil.** **N-8 çekincesi KALKTI:** `tests/store/retrieval.test.ts` üç koşuda da **47/47** (9,9 / 10,3 / 10,5 sn); M-SRV bloğu (l)'nin duvar saati yarışını enjekte edilen bir yavaş ifadeyle değiştirdi (S39). "Süit yeşil" cümlesi artık üç koşuya dayanıyor |
| S3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 385 passed** · 134,59 sn (W16, 05.09.2026; **W17/b 06.09.2026'da yeniden ölçüldü: 1 385 passed · 139,99 sn, exit 0** — W17/b yalnız TypeScript tarafını değiştirdiği için sayı değişmedi; W15'te 1 352 / 137,31 sn — +33 = `tests/ingestion/test_library.py`) (önce 1 347; +5 = M-SRV'nin `evals/tests/test_gates.py` bant testleri) | 0 | **M-CLOSE (bu tur, 02:41)** |
| S4 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, court inventory, shared limiter, disabled-key errors, HTTP auth` (değişmez yüzey; 55 yalnız `OPENROUTER_API_KEY` ile) | 0 | **M-CLOSE (bu tur, 02:43)** |
| S5 | `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS** (`collex_mig_test`, 13 migrasyon; c15 = `hearing` kabulü + `expense` reddi + üç indeks + idempotans) · `RESULT: PASS` | 0 | **M-CLOSE (bu tur, 02:45)** |
| S6 | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS — YEDİ ayrı koşuda da** (altı sert kapı + M-SRV'nin yeni **bant kapısı**; §"N-7" bant kapısını anlatır). **Koşudan koşuya DEĞİŞMEYENLER (6 koşu):** Recall@5 **0,9429** · @10/@20 **1,0000** · nDCG@10 **0,9156** · MRR **0,9024** · karşıt otorite recall **1,0000** (n=3) · çekimserlik recall **%92,3** · atıf çözülebilirliği **%100** (128 aday pasaj) · alıntı/hash **35/35** · uydurma kimlik **0** · kiracı sızıntısı **0** · beklenen gold birimi atıfta **%95,2** · cevap katmanı çekimserlik kesinlik/recall **%100 / %100** ve **TRIPWIRE yanlış çekimserlik 0** · şerit dağılımı `exact=36 · lexical=67 · trigram=5 · dense=0 · relation=17 · citation=12`. **CEVAP KATMANI DA ARTIK DEĞİŞMİYOR (N7 turu, S41):** ABSTAIN **14** · COMPLETE **13** · PARTIAL **3** · QUALIFIED **4** · cevap düzeyi yanlış çekimserlik **1** (`fx-amend-002`, altı koşunun altısında da) · yanlış cevap **0** (kapı) · kesinleştirilebilir **%81,0 (17/21)** · beklenen birim atıfta **%95,2** — **arka arkaya ALTI tam koşuda birebir aynı**, ve `--repeats 4` bandının **her satırında `stable: true`, min = max**, rapor "**identical across them**" yazıyor. Altı raporun ölçülen her bölümü de birbirinin aynı (aşağıdaki tek istisna dışında). Önce (M-CLOSE, altı koşu): ABSTAIN 13–14 · COMPLETE 11–14 · QUALIFIED 4–6 · kesinleştirilebilir %81,0 ↔ %85,7 · yanlış çekimserlik 1·1·0·0·0·1 — **N-7 KAPANDI** (kök neden S41). **Kalan tek ingest-bağımlı ayrıntı bir SAYI değil, bir ETİKET:** üç gold satırının (`fx-fact-001`, `fx-contrary-001`, `fx-contrary-002`) `reasons` metnindeki `ev-<16 hex>` kimlikleri ingest'ten ingest'e değişir, çünkü `deterministicEvidenceId` `documentVersionId`'yi (ingest UUID'si) özetler; sıra, sayı, oran, durum ve kapı etkilenmez. Duvar saati doğal olarak oynar ve bir determinizm iddiası değildir: retrieval p50/p95 bu turda **7,7 / 19,8 ms** (son koşu) | 0 | **N7 (bu tur, 03:31–04:05, 6 tam koşu + 1 `--repeats 4` koşusu)**, `evals/reports/fixture_baseline_2026-09-02.{json,md}` (dosya `--repeats 4` koşusuna aittir) |
| S7 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** (**W17/b 06.09.2026'da yeniden ölçüldü: 6/6, exit 0**) (S1 8/8 · S2 8/8 · S3 7/7 · S4 7/7 · S5 7/7 · S6 10/10); `collex_demo` düşürülüp 13 migrasyonla yeniden kuruldu, 8 belge / 55 parça / 2 ilişki (2 çözüldü) | 0 | **M-CLOSE (bu tur, 03:00)** |
| S8 | `control-plane/src/api/openapi.yaml` | **W16 (05.09.2026): 67 yol / 82 işlem, 140 şema** (W14'te 65 yol / 80 işlem / 126 şema; +2 yol = `/v1/sources/related`, `/v1/contracts/petition-analysis`), `info.version` **`1.0.0`**, **çözülmeyen `$ref` 0**, referans verilmeyen şema 0, **80 `operationId`, tekrar eden 0**, CR baytı 0. **Faz M deltası da alan düzeyinde ve eklemelidir**: yeni yol/işlem/şema **yok** — `/v1/health.uploadsDir` (S37) ve `SourceSearchResult.totalRecords` + `trace[].totalRecords` (S38) **isteğe bağlı** eklendi. Faz C deltası: `BackupResult.dumpFile`, `ContraryCoverage.skipped` (ikisi de `required` DEĞİL) + açıklama düzeltmeleri (W12 sonu: 35 yol / 44 işlem) | — | **M-CLOSE (bu tur)**, pyyaml ayrıştırması + `$ref` yürüyüşü; Faz C ve Faz M sonrası sayılar **birebir aynı** |
| S9 | `GET /v1/draft-templates` (modülden okundu) | **W16: 14 şablon** (8 `dilekce` + 6 `sozlesme`; 14.'sü hukukî mütalaa, `domain: genel`), **14/14'ü `domain` taşıyor**; `FIELD_GROUPS` **8** grup (`mahkeme, belge, taraflar, vekil, olaylar, talepler, deliller, ek`). Kart amaç cümlesi **13/13 tam ifade** (F-UI, V-11) | — | **C-FINAL (bu tur)**, `ts-loader` ile `src/drafting/templates.ts`; amaç cümlesi `W14-F-UI` §5 |
| S10 | `GET /v1/deadlines/rules` | **41 kural** (W12: 30). **16 `dogrulandi`** (madde metni mevzuat.gov.tr'den çekildi), **25 `dogrulanmadi`**; **7'si `adliTatileTabi: "belirsiz"`**; 4'ü `computable:false` | — | **C-FINAL (bu tur)**, çalışan sunucudan (port 8977, `collex_demo`) çekilip sayıldı |
| S11 | `GET /v1/fees/tariffs?year=2026` | **20 tarife kalemi**; **5 `dogrulandi`** / 15 `dogrulanmadi`; **17 kalemin `amount`'u `null`** (ColleX bu yılın Resmî Gazete rakamını bilmez ve uydurmaz); `disclaimer` dolu | — | **C-FINAL (bu tur)**, aynı sunucudan çekilip sayıldı |
| S12 | `supabase/migrations/` | **15 dosya**; **13'ü yerelde koşar** ve 13'ünün tamamı `-- [LEDGER SENTINEL] <kind>:<name>` probe'u taşır; 2 dosya pgvector ister, **asla koşulmadı**. Faz F'te `20260903100000_ai_audit_and_scale_indexes.sql`'in **yalnız yorumu** düzeltildi (V-2); çalıştırılabilir SQL, sentinel'ler ve sayım değişmedi | — | `W14-L-DOCS`; yorum düzeltmesi `W14-F-PERF` §5.2 |
| S13 | `GET /v1/health` | `registeredToolCount: 54` · `templates: 13` · `deadlineRules: 41` · `migrations` **13/13, missing 0, unknown 0** · **`rls: {expected: 18, present: 18}`** · `backup: null` (hiç yedek yoksa) · `mcp: "starting" → "ok"` (`--with-mcp` ile, ~8 sn) · `ai.configured:false` · `ai.model:null` · `ai.liveTested: false` · `corpus {publicDocuments:6, uploads:0}` · **`version: "1.0.0"`** (depo kökündeki `VERSION` dosyasından). `GET /v1/research/health` → `{"gateway":"ok","toolCount":54,"state":"ok"}` | — | **C-FINAL (bu tur)**, gerçek sunucu (8977 + MCP 8987, `collex_demo`); önce `W14-L-VERIFY` §4, `W14-F-API` §1.1 |
| S14 | MCP araç yüzeyi ve erişilebilirlik | **54 kayıtlı araç · 54 `REACHABLE` · 0 `NOT_YET_WIRED`**. **Dört** bağımsız kapı: `smoke_check` 54 (S4), `http_e2e_check` 54, `live_local_gateway_check` **tools/list tam 54**, ve çalışan geçitte `/v1/research/health.toolCount` **54** (S13). **26 seçilebilir kaynak · 19 tam-metin türü · 2 "içinde ara" hattı · manifest 8 bilinen boşluk** | 0 | **C-FINAL (bu tur)** (ilk üç kapı + geçit); kaynak sayıları `W14-L-SOURCES` §1/§3 |
| S15 | `evals/fixtures/reference_parity.json` | **108 vaka / 160 referans**, iki runtime da geçiyor | — | `W14-L-SOURCES` §5; `W14-L-FIX` §3e |
| S16 | B-06 · trigram şeridi, **seçici** probe korpusu (`collex_answer_test`, 20 006 parça, ort. 5 633 kod noktası) | Predikat `word_similarity(...) >= t` → `<%`: `Seq Scan` **19 702 ms** → `Bitmap Index Scan on chunks_search_trgm` **40 ms** (≈490×), sonuç kümesi **birebir aynı** (14 satır). **TARİHSEL** — güncel şerit ölçümü S26⁗ | — | `W14-L-ANSWER` §1.3 |
| S17 | B-06 · aynı şerit, **doymuş** probe korpusu (`collex_fix_test`, 20 000 parça) | `enable_seqscan` ayarı **maddi fark yaratmıyor** (16,9 s ↔ 17,9 s), çünkü GIN aday kümesi **20 000/20 000**. Maliyet modeli doğrusal. **TARİHSEL** — üç bağımsız korpusta üç kez doğrulandı (S26⁗), ve şeridi sınırlayan artık `createDb`'nin 15 s'si değil, şeridin **kendi 2 500 ms bütçesi** | — | `W14-L-FIX` §6; yeniden ölçüm `W14-L-VERIFY` §2.2 ve `W14-F-PERF` §2 |
| S18 | B-29 · genel arama (`collex_matter_test`, 400 dosya × 12 kayıt = 4 800 satır) | soğuk **6 ms** / sıcak 6 ms (bütçe 500 ms). 20 000 parçalı probe'ta uçtan: `GET /v1/search/all?q=kira` **p50 16,9 ms · 14 479 B**. **Yalnız dosya/kayıt/cevap/taslak yarısı** ölçüldü; belge gövdesi yarısı için 2 000 belgelik probe kurulmadı | — | `W14-L-MATTER` §4; uç ölçümü `W14-L-VERIFY` §2.3 |
| S19 | B-03 · felaket tatbikatı (süit içi, `collex_safe_test`) | `tests/integration/backup.test.ts` 10 geçti / 1 atlandı. **TARİHSEL** — uçtan uca tatbikat S28‴ | 0 | `W14-L-SAFE` §B-03 |
| S20 | B-27 · uyarı bütçesi (Faz A tarayıcı ölçümü, dört senaryo) | Tavan 4 blok / 8 cümle; ölçülen en yüksek 4 blok / 6 cümle. **TARİHSEL** — gerçek cevap ekranı ölçümü S29″ | — | `W14-L-CONSOLE` §4.6 |
| S21 | B-28 · erişilebilirlik (Faz A, dosyadan ayrıştırılıp WCAG bağıl parlaklığıyla hesaplandı) | Odak halkası / `--panel` **8,94** açık · **5,46** koyu (eşik ≥ 3). `GECİKMİŞ` çipi **13,89** / **14,48**. **TARİHSEL** — tarayıcıda hesaplanan güncel değerler S30″ | — | `W14-L-CONSOLE` §5.2–5.3 |
| S22 | Cevap bütçesi ve sınır sabitleri | `DEFAULT_ANSWER_TIME_BUDGET_MS` 60 000 → PARTIAL + `TIME_BUDGET_EXCEEDED`; `DEFAULT_MAX_QUOTE_CODE_POINTS` 4 000 → `QUOTE_TRUNCATED`; `MAX_STORED_TEXT_BYTES` 5 MiB → `STORED_WITHOUT_TEXTS`; `JSON_BODY_LIMIT_BYTES` 1 MiB / `MULTIPART_BODY_LIMIT_BYTES` 40 MiB / `MAX_ITEM_PAYLOAD_BYTES` 64 KiB → 413; `PDF_MAX_PAGES` 600; `BATCH_MAX_FILES` 200; `UPLOAD_CAP_MIB` 25; `AI_MAX_CALLS_PER_HOUR` 60; `AI_MAX_INPUT_TOKENS_PER_DAY` 400 000; `LONG_QUESTION_CODE_POINTS` 400; `MAX_CONTACTS` 2 000; batch ≤ 50. **Faz F'te eklenen üç sabit:** `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS` **8**, `DEFAULT_TRIGRAM_BUDGET_MS` **2 500**, `MAX_ANSWER_QUERY_CODE_POINTS` **200** | — | `W14-L-SAFE`; `W14-L-ANSWER` §3.2; **Faz F:** `W14-F-PERF` §3, `W14-F-API` §3.2 |
| S23 | Ledger kuralı (ADR-020, W14 B-05 ile genişletildi) | Bir dosya **birden çok** sentinel ilan edebilir; bootstrap dosyayı ancak **bütün** probe'ları çözülürse kaydeder. Kind kümesi: `regclass` · `regprocedure` · `extension` · `type` · `column` · `trigger` · `policy` · `constraint`. Aynı CASE iki runtime'da; `apply_missing_migrations` oturum düzeyinde `pg_advisory_lock` alır | — | `W14-L-SAFE` §B-05; `W14-L-FIX` §2 |
| S24 | Kapı sabitleri — **hiçbiri W14'te, Faz F'te ya da Faz C'de gevşetilmedi** | `DEFAULT_COVERAGE_FLOOR` **0,4** · `ENTAILMENT_THRESHOLD` **0,85** · `DEFAULT_LEXICAL_MIN_COVERAGE` **0,25** · `QUOTE_OVERLAP_FLOOR` **0,7** · `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS` **8** · `DEFAULT_TRIGRAM_BUDGET_MS` **2 500** · ADR-022 alaka kapısı · `EXPORT_REFUSED`. L-VERIFY dördünü, F-VERIFY altısını da kaynakta yerinde buldu. **Faz C'de bir eşik denendi ve GERİ ALINDI:** `DEFAULT_ANSWER_LIMITS.trigramMinSimilarity` 0,35 → 0,5 yapıldı, ölçüldü, **0,35'te bırakıldı** (C-SRV §6.3: zaman kazancı ölçülemedi, buna karşılık bir `CONFLICTING_AUTHORITIES` şerhi kayboluyordu). **Dürüstlük çekincesi:** trigram fallback kapısı bir **recall değişikliğidir**, saf optimizasyon değil (§"Açık ve dürüst" 2) | — | `W14-L-VERIFY` §6.2; `W14-F-VERIFY` §5.2; `W14-C-SRV` §6.3 |
| **S25‴** | **B-06 · `/v1/answer`, 20 000 parçalık probe (`collex_final_test`, ort. 4 976 kod noktası), gerçek HTTP, n=5** | **Yalnız kiracı korpus** (L-VERIFY'ın şekli): yaygın sözcük **p50 9 483 / p95 9 597 ms**, ABSTAIN (L-VERIFY 47 068 ms; F-PERF kendi probe'unda 15 756 ms ölçmüştü). **Gerçekçi korpus** (1 900 `public` + 100 kiracı): yaygın sözcük **p50 3 844 ms, PARTIAL, 8 kanıt, 0 bozuk şerit**; uzun soru **4 072 ms**. **Seçici sorgu (korpusta hiç geçmeyen ifade) 7 536 ms, ABSTAIN, üç şerit de bütçeyle kesildi** — artık **en yavaş korpus sorusu odur**. **Avukatın günlük yolu (belge kapsamlı soru): 71–73 ms, COMPLETE.** Uyarılarda sürücünün "canceling statement…" metni **yok**, yerinde tipli `TRIGRAM_BUDGET_EXCEEDED` | — | `W14-F-VERIFY` §2.1 (bağımsız yeniden ölçüm); önceki değerler `W14-L-VERIFY` §2.1, `W14-F-PERF` §1 |
| **S26⁗** | **B-06 · trigram şeridinin planı — ÜÇ korpusta üç farklı sonuç** | **F-VERIFY (`collex_final_test`), ürünün gerçek eşiği 0,35:** doymuş **32 620 ms** (`enable_seqscan` açık 32 852 — fark yok), **seçici de `rows=20000` ve 18 069 ms** (açık 17 982 — fark yok). Aynı korpus **eşik 0,5'te**: doymuş 33 647 ms, seçici **2,06 ms** (`enable_seqscan` açık 18 115 ms → 8 800×). **C-SRV (`collex_srv_test`), sekiz hücrenin sekizi:** doymuş **38 343–38 483 ms** her iki eşikte, **seçici her iki eşikte de `rows=0` ve 1–8 ms**; `enable_seqscan` **hiçbir hücrede** fark yaratmadı. **Bunun anlamı:** L-VERIFY'ın ≈9 700×'i ve F-PERF'in 0,329 ms'i **yalnız 0,5 eşiğinde ve yalnız o korpusta** doğrudur; `/v1/answer` **0,35 ile koşar** ve `TRIGRAM_SEQSCAN_SETTING` çekicinin o yolda ölçülen faydası yoktur. Bu rakamlar korpus ve sorgu özelliğidir — eşiğin ya da ayarın değil — ve **hiçbiri ürün sayısı olarak alıntılanamaz**. Maliyet modeli (0,5): `left 250` 1 021 ms · `left 500` 1 885 ms · `left 1000` 3 667 ms · `left 2000` 7 112 ms · tam metin **16 867 ms** — doğrusal, dördüncü kez | — | `W14-F-VERIFY` §2.2/§2.3; `W14-C-SRV` §6.2. Eşik çekincesi `W14-L-VERIFY` §2.2 ve `W14-F-PERF` §2 başlarına **sonradan not olarak** eklendi |
| **S27″** | **B-32 · `GET /v1/answers?fileId=` ve liste uçları (2 000 belge / 2 000+ cevap / 200 dosya), n=5, p50** | Ürünün **kendi** sorgusu (left join dâhil): **`Bitmap Index Scan on answers_filescope_gin`, `Index Searches: 1`, 1,63 ms**; eski şekil `Seq Scan`, `Rows Removed: 2 058`, **12,37 ms**. `pg_stat_user_indexes.idx_scan` sıfırlandı → **ürünün 3 HTTP çağrısı → 3**, planlayıcı ayarı zorlanmadan. Uçta: `?fileId=` **1,5 ms** · `/v1/files` **7,2 ms · 12 692 B** · `?limit=200` 8,6 ms · `/v1/matters` (200 dosya) 10,6 ms · 120 813 B · `/v1/matters/deadlines` 3,8 ms · `/v1/answers?limit=20` 3,0 ms · `/v1/search/all?q=kira` 15,6 ms · `GET /` (konsol) 5,7 ms · 598 042 B. **B-32'nin iki kabul ölçütü de karşılandı** (süre + planda indeks) | — | `W14-F-VERIFY` §2.4/§3 (V-2); önce `W14-L-VERIFY` §2.3, `W14-F-PERF` §5 |
| **S28‴** | **B-03 · yedek, doğrulama ve arşiv adı** | Uçtan uca felaket tatbikatı (`collex_verify_test`): veri yaz → yedek → `--verify` exit 0 → 1 bayt bozulan kopya **exit 1** → veritabanı düşürüldü → `pg_restore --exit-on-error` exit 0 → **2/2 asıl bayt bayt aynı, 9/9 tablo md5 aynı, RLS 18 → 18**. Ölçek probe'unda yedek **92,2 MB · 2 asıl · `collex.backup.manifest/v1`**. **Faz C (V-14) — bu turda yeniden ölçüldü:** `backup.mjs --database collex_demo` → arşiv **`collex_demo.dump`** (önce her zaman `collex_local.dump`), `yedek.json` `dump.path` **`collex_demo.dump`**, `--dump-name` bunu çıplak basıyor (exit 0), `--verify` "1 dosyanın tamamı eksiksiz" + `arşiv dosyası: collex_demo.dump` (exit 0). `collex_local` için ad **değişmedi**, yani mevcut yedek klasörleri çalışmaya devam ediyor | 0/1 | Tatbikat `W14-L-VERIFY` §3; ölçek `W14-F-VERIFY` §4.6; **arşiv adı C-FINAL (bu tur)**, düzeltme `W14-C-SRV` §1 |
| **S29″** | **B-27 · uyarı bütçesi, gerçek cevap ekranları (tarayıcı)** | Belge sorusu (TAM, 1 kanıt) **3 blok / 7 cümle**; korpus sorusu (ŞERHLİ, karşıt otorite) **3 blok / 5 cümle**; her ikisinde **0 birebir tekrar**, ana akışta **0 makine kodu**, **0 UUID**. Tavan 4 blok / 8 cümle. İki bağımsız turda birebir aynı ölçüldü | — | `W14-F-VERIFY` §5.3; önce `W14-L-VERIFY` §6.3 |
| **S30″** | **B-28 · erişilebilirlik ve responsive, tarayıcıda hesaplandı** | Koyu temada `--ink-faint` (`#9a9078`) **5,40 / 4,98 / 5,74 : 1** (panel / panel-2 / paper; AA eşiği 4,5). Punto **12,5 px** (WCAG AA asgari punto şartı koymaz). Odak halkası koyu temada **5,46:1** (eşik 3). Yatay taşma **yok**: 1440 px 12/12, **960 px 13/13**, **390 px açık 13/13 ve koyu 13/13** (F-VERIFY); C-UI kapanış turunda 960 px 13/13 ve 390 px 12/12. Yakalanmamış JS istisnası **0**, promise reddi **0** | — | `W14-F-VERIFY` §4.1/§5; `W14-C-UI` §5 |
| **S31″** | **Sunucu dikişleri ve girdi doğrulaması, gerçek sunucuda** | `POST /v1/sources/search` `--with-mcp` açıkken geçide **ulaşıyor** (F-API: 502 `UPSTREAM_UNAVAILABLE` → 502 `ALL_SOURCES_FAILED` + `failedSources[]`). `GET /v1/files/{id}/original` `COLLEX_DATA_DIR` ayarlıyken **404 → 200**, sha256 aslıyla birebir aynı. `GET /v1/answers`: `?q=zzzzunlikely` **0 satır**, `?status=COMPLETE` **8 satır hepsi COMPLETE**, `?bogus=1` **tipli 400**, `?status=TAMAMLANDI` **400**. **Faz C (V-19) — bu turda yeniden ölçüldü:** `POST /v1/drafts` fazladan alanla → `{"path":"bogusAlan","label":"Fazladan alan (bogusAlan)","message":"Tanınmayan alan."}`; yanıttaki **hiçbir** satırın `path`'i boş değil (önce `{"path":"","label":""}`). **Faz C (V-21):** konu dışı soru → `contraryCoverage {executed:false, skipped:true}` ve Türkçe "…tarama gerekmedi ve yapılmadı" cümlesi; dayanağı **olan** bir korpus sorusunda **`executed:true, skipped:false, 2 şerit`** — güvence daralmadı | — | `W14-F-API` §1–§3; `W14-F-VERIFY` §3; **V-19/V-21 C-FINAL (bu tur)**, düzeltme `W14-C-SRV` §2/§3 |
| **S32″** | **Konsol, gerçek tarayıcı** | Yakalanmamış JavaScript istisnası **0**; ağ günlüğündeki tek hata satırı "Karar ara" ekranının **bilerek geçersiz** geçit yoklamasıdır. `console.test.ts` **165 test** (L-VERIFY 129 → F-UI 152 → **C-UI 165**), C-FINAL turunda 165/165 geçti. **Faz C'de ölçülen (C-UI, tarayıcı):** ilk kaydetmede yerleşim sıçraması **224 → 0 px** (V-10 kalıntısı) · ilk içerik kartı **336 px (%37,3) → 220 px (%24,4)**, künye **235 → 129 px** (V-22 kalıntısı) · korpus cevap kartı **6 108 → 5 051 px** (6,79 → **5,61 ekran**), tespit kartı 365 → 179 px (N-5) · yeni açılan dosya **aktif oluyor** ve sonraki yükleme ona bağlanıyor (N-6) · "Karar ara" satırının ikinci satırı **0/10 → 13/13, 20/20, 10/10 dolu** (N-4) | — | `W14-C-UI` §0–§5; `console.test.ts` sayısı **C-FINAL (bu tur, S2)** |
| **S33** | **`.ics` akışı** | `GET /v1/matters/calendar.ics` → **200** · `text/calendar; charset=utf-8` · 991 B · **37 CRLF / 0 çıplak LF** · en uzun satır **75 oktet** · `VTIMEZONE` + `TZID:Europe/Istanbul` · tüm-gün `DTSTART;VALUE=DATE` · `VALARM TRIGGER:-P7D` · `DEADLINE_DISCLAIMER` birebir, RFC 5545 kaçışlarıyla. **Gerçek bir takvim istemcisinde açılmadı** | — | `W14-F-VERIFY` §4.5 |
| **S34** | **B-16 · gerçek kaynak araması (`--with-mcp`, tarayıcı) — beş sorgu** | F-VERIFY: iki sorgu, **20'şer künye / 0 başarısız kaynak / 6 605 ve 6 643 ms**; "Tam metni getir" → SHA-256'lı kaynak kartı, 1 151 karakter, sağlayıcı BEDESTEN. **C-UI, tam ifade AÇIK:** `tahliye taahhüdü` **13 künye / 8 merci / 29.09.2021–20.05.2026** · `kamulaştırmasız el atma` **20 / 7 merci** · `işçilik alacaklarında zamanaşımı` **10 / 2 merci** · bir cümle sorgusu **0 künye**; **tam ifade KAPALI** aynı sorgu **20 künye, 10'u tek daire tek gün** — F-VERIFY'ın gördüğü yığılmanın sebebi budur. İki tam metin çekildi ve sorgu ifadesi metinde **bulundu** (3 023. ve 4 692. konumda). **İlgililik ölçülmedi**; sıralamayı **kaynak sunucu** belirliyor | — | `W14-F-VERIFY` §4.2; `W14-C-UI` §1.3 |
| **S35** | **B-02 · nihai DOCX (python-docx ile açıldı)** | **A4 21,0 × 29,7 cm**, kenar 3,0/2,5/2,5/2,5 cm, **30 paragraf / 0 tablo / 8 bold / 23 hizalı**; `[K-n]` · SHA-256 · `collex.` · `hmk-` · UUID · UPPER_SNAKE makine kodu · çıplak `ev-…` kimliği **hepsi 0**; zorunlu inceleme bandı **duruyor**. TASLAK kopyada F-VERIFY 2 makine dizesi ölçmüştü (N-3); **Faz C bunu kapattı** — `presentable_warning` kimliği parantezin içine alıyor, TASLAK gövdesinde parantez dışı UPPER_SNAKE **0** | — | `W14-F-VERIFY` §4.4; N-3 düzeltmesi `W14-C-SRV` §4 |
| **S36** | **Doğrulanmamış yüzeylerin etiketleri (uçtan okundu)** | `GET /v1/deadlines/rules` 41 kural · **25 `dogrulanmadi`**, her birinin `source` alanı "…madde metni doğrulama turunda çekilmedi… mevzuat.gov.tr'de açıp karşılaştırın" diyor. `GET /v1/fees/tariffs?year=2026` 20 kalem · **17 `amount: null`** · `disclaimer` dolu. `/v1/health` `ai.liveTested:false`. Konsolda `deneysel` **6** kez, `canlı sınanmadı` **5** kez geçiyor; UDF her yüzeyde `deneysel` etiketli | — | `W14-F-VERIFY` §5.5; kural/tarife sayımı **C-FINAL (bu tur)** |

| **S37** | **IR-1 · `/v1/health.uploadsDir` (Faz M'in birinci eklemeli alanı)** | Alan **indi**: `resolveUploadsDir({uploadsDir, repoRoot})` mutlak yol döndürür — `COLLEX_DATA_DIR` verilmişse `<veri>/uploads`, verilmemişse `<depo>/var/uploads`. `createApp` onu **bir kez** çözüp `/v1/health`'e, `createFilesRouter`'a ve `createMatterPackageRouter`'a **aynı dizeyi** verir; yani "asıllar dizininin TEK çözücüsü vardır" değişmezi artık gerçekten tek çözücüyle sağlanıyor (V-4 tam da iki ayrı hesaptan doğmuştu). M-SRV gerçek sunucuda ölçtü: db **`down`** iken de doğru yolu yazıyor. `tests/integration/healthUploadsDir.test.ts` **5 test**, alanın varlığını değil **bağını** pinliyor (health'in yazdığı klasör = `GET /v1/files/{id}/original`'ın okuduğu klasör); `server.ts`'ten `uploadsDir,` satırı silinince **5'in 4'ü düşüyor**. Ekranda: Ayarlar › "Verilerim nerede?" satırının **altına** klasörün yeri yazılıyor, alan gelmezse satır **hiç çizilmiyor** (konsol hiçbir yolu tahmin etmez) | — | Alan ve sunucu ölçümü `W14-M-SRV` §1; ekran `W14-M-UI` §3.1; `openapi.yaml`'daki varlığı **M-CLOSE (bu tur)** |
| **S38** | **IR-2 · kaynak başına `totalRecords` (Faz M'in ikinci eklemeli alanı)** | Alan **indi**: `research/payloads.ts::readTotalRecords` Bedesten'in `total_records`'unu okuyor, `sources/searchService.ts` onu `SourceSearchResult.totalRecords` (toplam) ve `trace[].totalRecords` (kaynak başına) olarak yayımlıyor. **Tek kural, iki yönüyle: sağlayıcı sayı yayımlamıyorsa `null`, ASLA 0**; sağlayıcının gerçekten "0" dediği hâl 0 olarak korunur; başarısız bir kaynak her zaman `null`. Toplam yalnız sayı yayımlayanların toplamıdır (758 + bilinmeyen = **758**). `tests/research/totalRecords.test.ts` **10 test**; `null`→0 düşürülünce **2**, bilinmeyen `0` döndürülünce **1** test düşüyor. Ekranda (gerçek arama, `tahliye taahhüdü`): "**Kaynakta 761 kayıt var** — burada ilk **13** tanesi listeleniyor" + katlanmış "Kaynak kaynak sayılar" (Yargıtay 758 · Danıştay 3); `null` ise "**Kaynak, bu sorgu için kaç kayıt tuttuğunu bildirmedi**". **Canlı upstream'den bu alana ulaştığı M-SRV tarafından ölçülmedi** (ayrıştırma çevrimdışı doğrulandı); ekran ölçümü M-UI'nin gerçek aramasındandır | — | Alan `W14-M-SRV` §2; ekran ve gerçek arama `W14-M-UI` §3.2; `openapi.yaml`'daki varlığı **M-CLOSE (bu tur)** |
| **S39** | **N-8 düzeltmesi · `retrieval.test.ts` bloğu (l) artık duvar saatiyle yarışmıyor** | `withCutLaneBudget(sql)`: şeridin kendi `set_config('statement_timeout', <budgetMs>, true)` çağrısını **ayar adından** tanıyan ince bir Proxy, **aynı bağlantıda ve aynı transaction içinde** `select pg_sleep(0.05)` çalıştırıyor — 1 ms'lik bütçenin **elli katı**, yani PostgreSQL onu her seferinde iptal ediyor (SQLSTATE 57014) ve iptal üretimin tam yolunu izliyor (`isQueryCanceled` → `TrigramBudgetExceededError` → `BUDGET_EXCEEDED`). İki vakumsuzluk kanıtı testin **içinde**: `budgetMs: 0` ile sarmalayıcı hiçbir şeyi iptal etmiyor (gerçek satırlar dönüyor) ve sarılmış/sarılmamış istemcinin `chunkId` listesi **birebir aynı**. **Ölçüm: M-SRV 6 tam koşu (6/6 yeşil) + M-CLOSE 3 tam koşu (3/3 yeşil, 47/47) = arka arkaya 9 yeşil koşu.** Zayıflatılan iddia yok: bütçe > 0, kesilince **tipli** `TRIGRAM_BUDGET_EXCEEDED`, sürücünün "canceling statement" metni okuyucuya hiç ulaşmıyor, bütçe tel üzerinden ayarlanamıyor | 0 | Düzeltme `W14-M-SRV` §3; **3 koşuluk bağımsız denetim M-CLOSE (bu tur, S2)** |
| **S40** | **N-7 · `run_evals.py` bant kipi (bant kaldı, oynaklık S41'de KAPANDI)** | `evals/retrieval/gates.py::answer_level_band(runs, ingests)` + `_answer_band_gate(band)`; `scripts/run_evals.py --repeats N` (varsayılan 1) ingest + cevap sürücüsünü N kez koşturuyor, retrieval ölçümü **son ingest** üzerinde bir kez alınıyor. **Gate'e bağlanan tek satır:** `acceptable_abstention` işaretli bir gold satırı **hiçbir tekrarda** cevaplanmamalı — kapı bandın **en kötü tekrarına** bakar ve düşerse kusurlu gold kimliklerini adıyla yazar. Geri kalan her satır **aralık + oynayan satırların adı** olarak basılır ve `--repeats 1` bile bant basar (genişliği 1), ki tek koşu kararlı sanılmasın. **M-CLOSE ölçümü (6 tam koşu, düzeltmeden ÖNCE):** yanlış cevap **6/6'da 0** (kapı), yanlış çekimserlik **1·1·0·0·0·1**, kesinleştirilebilir **%81,0 ↔ %85,7**, COMPLETE **11–14**. **N7 turu (6 tam koşu, düzeltmeden SONRA):** bandın **her satırında `stable: true`, min = max**; rapor `identical across them` yazıyor (S6, S41). **Bant kipi kalıyor** — sıfır genişlikli bir bant kararlılığın tek KANITIDIR ve tek koşu hiçbir zaman kanıt değildir | 0 | Bant ve kök neden `W14-M-SRV` §4; **6 koşuluk bağımsız denetim M-CLOSE (bu tur, S6)** |
| **S41** | **N-7 KAPANDI · cevap katmanının sıralama eşitliği artık korpus kimliğiyle çözülüyor** | `control-plane/src/pipeline/answerPipeline.ts` `rank` aşaması bir skor eşitliğini `hit.chunkId` ile — **ingest'te `gen_random_uuid()` ile üretilen bir UUID** ile — çözüyordu. Citation / citator (relation) / contrary şeritlerinden gelen her pasaj `fusedScore: 0` taşır (bu şeritler eklenir, füzyona girmez), yani eşitlik kümesi aday listesinin çoğudur ve sırayı tek başına UUID belirliyordu; **kapsam-farkında üst sınır** (`coverageAwareCap`, 8) sonra her ingest'te FARKLI bir sekizli tutuyordu. Yerine `stablePassageKey` geldi: `(source, external_id, ordinal)` + son çare `chunkId` — `chunkStore.stableTieBreak` ve `hybrid.stableKey` ile **aynı anahtar**. **Ölçüm (03.09.2026):** aynı korpusun iki ingest'i içerik olarak birebir aynı (`legal.documents` 7, `document_versions` 8, `chunks` 55, `document_relations` 2 satır — kararlı anahtarlarda **hiçbir fark yok**), yalnız UUID'ler farklı; `fx-amend-002` izi düzeltmeden önce iki ingest'te iki farklı `EVIDENCE_CAP_APPLIED` kümesi veriyordu (biri `kanun-7999#madde-3` + `kanun-6098#madde-12`'yi, öteki `kanun-7999#madde-4` + `kanun-6098#madde-51`'i düşürüyordu) — her şerit ikisinde de AYNI sıralı listeyi döndürdüğü hâlde. Düzeltmeden sonra **beş ayrı ingest** üzerinde 34 gold satırının durum / kesinleştirilebilirlik / delil / kapsam / gerekçe alanları (kararlı kimliklere çevrilmiş hâliyle) **birebir aynı**. Gerileme testi: `control-plane/tests/pipeline/rankDeterminism.test.ts` (2 test) — vakumsuzluk kusur bir kez geri konarak kanıtlandı (ikisi de düştü: azalan UUID'li ingest 12..05'i, artan olan 01..08'i tutuyordu) | 0 | **N7 (bu tur)**, `waves/W14-N7.md` §1–§5; bant S40, koşular S6 |

| **S42** | **W17/b · dilekçe analizi GERÇEK bir cevap dilekçesiyle ölçüldü** | Çalışan sunucu (`serve.mjs --port 8991 --with-mcp --dsn …/collex_demo`, gerçek MCP geçidi, 54 araç), `POST /v1/contracts/petition-analysis`, gerçek bir eser sözleşmesi/ayıp cevap dilekçesi. **ÖNCE:** 2 dk 04 sn · 12 iddia (biri `KONU :` alanı, biri imza bloğu) · yanlış BULUNDU **1** (`6098 sayılı Türk Borçlar Kanunu … m. 1`, belge m. 475 diyor) · 10 atıf satırı (çıplak `TBK`/`TTK`/`HMK` + çıplak `m. 475`) · 4 aleyhe şerit / 4 koştu · 12 iddianın 5'inde `6098 sayılı m. 475 bozma` sorgusu **50 alâkasız kaydı** "aleyhe kaynak BULUNDU" diye döndürdü · her künye üç kez basılı · bir satırın karar tarihi `6006-09-20` · hiçbir kaydın bağlantısı yok · 12 KAYNAKSIZ cümle. **SONRA (aynı dilekçe, aynı sunucu):** **33,2 sn** · **10 iddia** · türler **5 hukuki sebep / 3 vakıa / 1 talep / 1 diğer** · başlıklar **AÇIKLAMALAR · HUKUKÎ SEBEPLER · DELİLLER · SONUÇ VE İSTEM** · yanlış BULUNDU **0** · **6 atıf satırı, hepsi kanunuyla** · **16 şerit kuruldu, 15 koştu** (13'ü önbellekten — rapor başına ayrı sorgu başına bir yukarı çağrı) · sorgusuz iddia **2/10** (yalnız TALEP ve DELİLLER) · sorgular `eser sözleşmesi "aksi yönde"` / `manevi tazminat "tazminat talebinin reddi"` · her kayıt **tek satırlık künye + `Karar tarihi: 13.07.2026` + çalışan `mevzuat.adalet.gov.tr` bağlantısı** · okunamayan tarih artık tarih gibi basılmıyor · **10 KAYNAKSIZ cümle**. **BU SAYILARIN NE OLMADIĞI:** süre, satır sayısı ve şerit durumları ölçüldü; **İSABET ÖLÇÜLMEDİ** — dönen kararların bu uyuşmazlıkla gerçekten ilgili olup olmadığı bir hukukçu değerlendirmesidir ve yapılmadı (B-16 etiketi geçerli: *"erişim ölçüldü, isabet ölçülmedi"*). Ölçüm `collex_demo` üzerindedir; altı atıf satırının altısı da "belirsiz"dir çünkü demo korpusu gerçek TBK/TTK/HMK metnini taşımaz — bu doğru davranıştır (bulunamadı DEĞİL), ama gerçek kütüphanede ne olacağı **ölçülmedi**. Ayrıntı: `waves/W17-DILEKCE.md` | **W17/b (06.09.2026)**, `scratchpad/opus2/dil-sonuc.json` (önce) ve `dil-sonuc6.json` (sonra) |

Tabloda olmayan hiçbir sayı bu belge setinde "ölçülmüş" sayılmaz.

### Bu turda ölçülmeyenler — açık kayıt

Bu tur (**M-CLOSE**) **on komutu da** yeniden koştu: S1, S2 (×3), S3, S4,
`http_e2e_check`, `live_local_gateway_check`, S5, S6 (×6 + bir `--repeats 4`),
S7, artı `openapi.yaml` ayrıştırması (S8). Yeniden ÖLÇÜLMEYEN ve başka bir
hattın ölçümünü aktaran satırlar: **S25‴, S26⁗, S27″, S29″, S30″, S32″, S33,
S34, S35, S36** ve S28‴ — hepsi 20 000 parçalık bir probe korpusu, bir
Playwright oturumu, bir gerçek sunucu turu ya da bir devlet upstream'i
gerektiriyor ve hiçbiri bu hattın işi değildi (bu hat **hiçbir koda ve hiçbir
teste dokunmadı ve hiçbir sunucu açmadı**). Her satır kaynağını adıyla
söylüyor.

**Faz M'in kendi ölçümleri de bu hattın ölçümü değildir ve bu ayrım
korunuyor:** S37'nin gerçek-sunucu yarısı ve S39'un altı koşusu **M-SRV**'nin,
S38'in ekran yarısı ile M-UI'nin bütün piksel ve tarayıcı sayıları
(§"Faz M'de ekranda değişenler") **M-UI**'nin ölçümüdür. Bu hattın kendi
katkısı, o iki hattın indirdiği her şeyin **arkasından** koşan tam ölçüm
turudur (S1–S8) ve **N-7/N-8'in bağımsız denetimi** (S2 üç koşu, S6 altı
koşu) — ve o denetim ikisinden **yalnız birini** kapattı. **N-7'yi bir sonraki
tur (`N7`) kapattı** (S41).

**Bu turda ölçülmemiş bir sayıyı açıkça reddediyorum:** C-UI'nin ve M-UI'nin
tarayıcıda ölçtüğü piksel değerleri (S32″ ve M-UI raporu) benim ölçümüm
değildir; onları kendi turumda yeniden üretmedim, yalnız o düzeltmeleri
pinleyen `console.test.ts` süitinin **179/179 geçtiğini** ölçtüm (S2).

### 07.09.2026 çalışma denetimi — yeni ölçümler

Bu satırlar devam eden denetimin ölçümleridir; kapanış anlamına gelmez. Sonraki kod değişikliklerinden sonra tam paket yeniden koşulacaktır.

| # | Komut / yüzey | Ölçülen çıktı | Exit | Kaynak |
|---|---|---|---:|---|
| S43 | `npx vitest run` | 122 dosya; 2472 geçti, 6 ters ortam işaretleyicisi atlandı; 23,74 sn. Gerçek kalıcılık, yedek, dışa aktarma ve başlatıcı süitleri çalıştı. Bu koşu taslak düzeltmelerinden sonra, konsol/canlı araştırma değişikliklerinden öncedir | 0 | 07.09.2026 00:22, bu denetim |
| S44 | `draftOrdering.test.ts` ve `node scripts/check-draft-mutations.mjs` | İlk 3 test düzeltmesiz kodda düştü: eski kayıt son kaydı ezdi; hatalı kayıt `true` döndü; kapasite 2 iken 5 taslak bellekte kaldı. Sonra 5 test geçti; 5 mutasyonun 5'i ayrı davranış hatasıyla yakalandı. Sonuç: son düzenleme korunuyor; hata `false`; 5 arşiv açılışından sonra bellek 2 | 0 | 07.09.2026 00:20–00:22 |
| S45 | `consoleDatePrivacy.test.ts` | Önce 2 test düştü; sonra 2 geçti. Gece yarısı İstanbul kaydı önce 06.09, sonra 07.09; gün alanı 06.09 olarak korunuyor. Yanlış yerellik vaadi taşıyan 2 açıklama düzeltildi. Gerçek ekranda tarih ve metin doğrulandı. Mutasyon henüz çalışmadı | 0 | 07.09.2026, konsol |
| S46 | Canlı işçilik araştırması — önce | 79,8 sn; 14 araç çağrısı; 1 tam metin, 0 karar tam metni; Öğretmenlik Mesleği Kanunu'ndan 1 ilgisiz tespit. Kaynaklar cevap verdi, sonuç KISMİ/kesinleştirilemez. Çıktı `var/audit-20260907/live-workday-before.json` | — | 07.09.2026 00:24, gerçek tarayıcı |
| S47 | `liveWorkday.test.ts` | Tam metin rezervi testinde karar sayısı önce 0, sonra en az 2; karşıt arama rolünden metin de getirildi. İlgisiz metin testinde önce 1 tespit, sonra 0 tespit/0 kanıt; ayrılan pasaj sayısı raporlandı. Mevcut 20 canlı araştırma testi de geçti. Canlı tekrar ve mutasyon sürüyor | 0 | 07.09.2026 15:28 |
| S48 | Zorunlu Python / DB / eval kontrolleri | `pytest`: 1385 geçti, 136,55 sn. `smoke_check`: exit 0, 54 araç sözleşmesi. `db_local_check`: 19/19. `run_evals --repeats 4`: PASS; 4 ingest boyunca sonuçlar aynı; 17/21 kesinleştirilebilir, yanlış cevap 0, 35/35 alıntı/hash, 0 kiracı sızıntısı. Veri sentetiktir | 0 | 07.09.2026; `evals/reports/fixture_baseline_2026-09-07.*` |

| S49 | Gerçek işçilik araştırması, ilk düzeltme sonrası | 72,7 sn; 14 çağrı; 6 tam metin (2 mevzuat, 3 Bedesten, 1 Emsal); 0 tespit, 8 pasaj kapsam dışında. Önce 79,8 sn / 1 tam metin / 0 karar / 1 ilgisiz tespit. Kanıt okuma arttı; yararlı cevap henüz oluşmadı | — | `var/audit-20260907/live-workday-after-1.json`; kavram ve tırnak düzeltmelerinden önce |
| S50 | Olaydan kavram çıkarma | Hak kazandığını → iş kazası yanlış eşleşmesi giderildi; fazla çalışma → fazla mesai tanındı. Önce 2 hata, sonra 5/5 davranış testi; iki mutasyon öldürüldü | 0 | `workdayIntake.test.ts` |
| S51 | Gerçek karar isabeti, dar sorgu örneklemi | 4 sorgu × ilk 3 tam metin. Tırnaksız kıdem: 0 doğrudan / 1 dolaylı / 2 ilgisiz; tırnaklı: 0 / 3 / 0. Tırnaksız fazla çalışma: 0 / 0 / 3; tırnaklı: 2 / 1 / 0. Ajan etiketlemesi, bağımsız avukat doğrulaması yok; genel başarı oranı değildir | — | `report-workday-precision.mjs`, `var/audit-20260907/query-precision-labelled.json`, metin SHA-256'ları kayıtlı |
| S52 | Birleşik kavram sorgusu | Birincil Bedesten sorgusunda kavram tırnaklı; karşıt, Emsal ve ikinci tur yolları korundu. Önce 1/3 hata, sonra 3/3 geçti; mutasyon öldürüldü. Mevcut 256 planlayıcı/araştırma testi geçti | 0 | `workdayPhrase.test.ts` |
| S53 | Form etiketleri ve dar ekran | Gerçek 390×844 araştırma ekranında belge genişliği 375 px, yatay taşma yok. Altı alanın görünen başlığı programatik olarak bağlı değildi; label/for eklendi. Önce 6/6 hata; sonra 6/6 geçti; altı ayrı mutasyon öldürüldü. Diğer ekran/boyutlar açık | 0 | `consoleFieldLabels.test.ts`, CUA DOM ve erişilebilirlik ağacı |
| S54 | Güncel TypeScript tam paket | `tsc --noEmit`: exit 0. Vitest 127 dosya, 2490 geçti, 6 ters koşul atlandı, 26,06 sn. Karar tarihi düzeltmesinden önce | 0 | 07.09.2026 yerel koşu |
| S55 | Altı demo senaryosu | `--keep` mevcut şemada DuplicateObject ile durdu: yeniden migrasyon kusuru açık. `--skip-ingest` ile hazır sentetik korpus üzerinde 6/6 senaryo, 47/47 kontrol geçti; veri silinmedi | 0 (senaryolar) | `var/audit-20260907/demo/report.md` |
| S56 | Resmî karar gününün UTC kesilmesi | Canlı Bedesten: 11.05.2026 açık günü / 10.05.2026 21:00 UTC; tam metin de 11 Mayıs. Açık gün öncelikli, yalnız zaman damgasında Europe/Istanbul takvimi; geçersiz gün kabul edilmez. Önce 6/9 hata, sonra 9/9 geçti; kaynak/araştırma 147/147 | — | `workdayDecisionDate.test.ts`; mutasyon ve canlı tekrar sürüyor |

| S57 | Karar tarihi sonrası tam paket | `tsc`: exit 0. Vitest 128 dosya, 2499 geçti, 6 ters koşul atlandı, 24,31 sn. Karar günü için üç mutasyon öldürüldü. Sonraki pasaj kabulü değişikliklerini içermez | 0 | 07.09.2026 |
| S58 | İkinci canlı tekrar: kapsam sızıntısı | 80,9 sn arayüz / 80,5 sn araştırma; 14 çağrı, 6 tam metin, 9 pasaj, 8 tespit. Toplam kapsam 11/26 olunca ilgisiz öğretmenlik ve boşanma kaynakları da kabul edildi. Başarı sayılmadı | — | `var/audit-20260907/live-workday-after-2-answer.json` ve tam metinli bundle |
| S59 | Pasaj başına kapsam | İlgili karar + ilgisiz kanun testinde önce ilgisiz alıntı kabul edildi, sonra dışlandı; ilgili kanıt kaldı. Eşik 0,4 aynı. Konusuz beraat kararı, karşıt sorguda dönse de konuya karşıt kanıt sayılmıyor. Kabulü geri bozan iki mutasyon testleri düşürdü | 0 | 08.09.2026; `liveWorkday.test.ts` |
| S60 | Karşıt örneklerin test niteliği | Eski genel beraat metninin suçla bağlantısı yoktu. Aynı maddeye ilişkin ayrı örneğe açık atıf eklendi; servis/HTTP testleri artık tam yerine açık çelişki gerekçeli şerhli sonuç arıyor. Konusuz beraatin dışlanması ve karşıt sonuç dönmeyince tam cevap için ek testler eklendi; hiçbir test silinmedi/atlanmadı | 0 | 08.09.2026; `helpers.ts`, `researchService.test.ts`, `routes.test.ts`, `liveWorkday.test.ts` |
| S61 | Sorulan tarihten sonraki karar | Sağlayıcının 6006 tarihli kararı ek tarih filtresi yokken kabul ediliyordu. Önce regresyon hatası, sonra dışlama + sayılı uyarı. Künye tahminle 2006'ya çevrilmedi | — | 08.09.2026; mutasyon ve canlı tekrar sürüyor |
| S62 | Sorudaki hukukî ifade | Eşleşen fazla çalışma yerine ilk sorguda fazla mesai aranıyordu. İlk sorgu matchedTerm'i kullanıyor; eş anlamlılar sonraki yollarda korunuyor. Önce yeni test hatası, sonra 4/4 ifade testi. Toplam planlayıcı/araştırma 270/270 | 0 | 08.09.2026; `workdayPhrase.test.ts` |

| S63 | Pasaj ve ifade değişiklikleri sonrası tam paket | `tsc`: exit 0. Vitest 128 dosya, 2504 geçti, 6 ters koşul atlandı, 28,58 sn. 20 çalışma günü mutasyonu öldürüldü; ayrıca önceki 5 taslak mutasyonu doğrulanmıştı. Harç değişikliklerinden önce | 0 | 08.09.2026 |
| S64 | Üçüncü canlı tekrar | 79,362 sn araştırma; 14 çağrı, 6 tam metin, 8 pasaj kapsam dışında, 0 kaynak/tespit. İlgisiz cevap engellendi; yararlı cevap hâlâ yok. İlk sonuçlarla sınırlı tam metin seçimi ve uzun olay kapsamı araştırılacak | — | `var/audit-20260907/live-workday-after-3-answer.json` |
| S65 | 2026 resmî harç tutarları | Önce 12 maktu satırdan hiçbirinin yıllık tutarı hazır değildi; sonra 7'sinin yayımlanmış tutarı girildi. Toplam 20 satırın 12'si doğrulanmış; kalan 8: peşin oran, gider avansı, tebligat, AAÜT kademeleri ve üç maktu AAÜT satırı, İYUK istinaf sınırı. Kanun tabanları güncel kesinlik sınırı sayılmadı | 0 | GİB 98 Seri No.lu Tebliğ, PDF s.2–3; 08.09.2026 görsel karşılaştırma; `published2026.ts` kaynak URL/SHA-256 |
| S66 | Harç regresyonu ve mutasyon | Yeni 9 test önce hatalı, sonra geçti; tüm harç testleri 40/40. 11 mutasyon öldürüldü: 7 tutar, suret atfı, yıl bağı, alt sınır açıklaması, resmî kaynak. Eski bilinmeyen tutar testleri enjekte edilen eksik tarife ile tüm beklentilerini koruyor | 0 | `official2026.test.ts`; hesaplayıcı artık bilinen alt sınırın uygulandığını veya kontrol edildiğini her zaman gösterir |

| S67 | Harç sonrası tam paket ve gerçek ekran | `tsc` exit 0; Vitest 129 dosya, 2513 geçti, 6 ters koşul atlandı, 25,86 sn. Tarayıcıda Hazır işler → Harç → Hesapla: 3 eylem tıklaması (alan doldurma hariç). 2026/1.000 TL/asliye: başvurma 732, alt sınır 732, peşin 183; eksik tutar 3'ten 1'e, toplam null. Peşin oranı hâlâ doğrulanmadı | 0 | `var/audit-20260907/fees-{before,after}.json`; 08.09.2026 |
| S68 | Resmî PDF yükleme ve madde başlığı bağlamı | GİB 98 sayılı Tebliğ PDF'si API üzerinden yüklendi, tarayıcı dosya seçicisiyle değil. Metinsiz sayfa 2 için açık uyarı verildi; OCR yapılmadı. Başlıkların önceki kanuna bağlanması: yeni testler önce 4 hata/1 geçiş, sonra mevcut analiz testleriyle 22 geçti. İki mutasyon öldürüldü. Aynı PDF'nin yeniden analizinde kendi MADDE 1–5 başlıkları belirsiz; birden fazla kanun ve karar içeren cümlelerde 9 ve 3 numaralı atıfların yanlış bağlanması hâlâ açık | 0 | `test_official_document_context.py`, `check-intake-heading-mutations.mjs`; mevcut yüklemenin saklı analizi geriye dönük değiştirilmedi |

| S69 | Python başlık düzeltmesi sonrası tam paket | 1390 geçti, 145,02 sn; migrasyon düzeltmesinden önce | 0 | 08.09.2026 |
| S70 | `demo --keep` migrasyon tekrar hatası | Yeni gerçek DB regresyonu önce `DuplicateObject: document_scope` ile başarısız. CLI ortak migrasyon defterine bağlandı; tüm 18 migrasyon testi geçti, eski döngüyü geri getiren mutasyon öldürüldü. Gerçek `demo --keep`: 0 migrasyon tekrar uygulandı, 6/6 senaryo ve 47/47 kontrol geçti. PDF aynı fileId/SHA256 ile sonrasında hâlâ erişilebilir; veritabanı düşürülmedi | 0 | `var/audit-20260907/demo-keep/report.md`; genel denetim hâlâ devam ediyor |

| S71 | Başlık ve migrasyon düzeltmeleri sonrası doğrulama | Python 1391 geçti, 136,44 sn. MCP smoke exit 0, yüzey 54. DB 19/19; yasak iki pgvector migrasyonu yalnız sözdizimi kontrolü, çalıştırılmadı. Eval dört ayrı kurulumda PASS: 17/21 finalizable aynı, yanlış cevap 0, uydurma kimlik 0, sızıntı 0, alıntı/hash 35/35. TS kaynakları S67'den beri değişmedi | 0 | `evals/reports/fixture_baseline_2026-09-08.{json,md}`; 08.09.2026 |

| S72 | Az metinli PDF sayfaları | Yeni 3 test önce 2 hata, sonra mevcut çıkarım testleriyle 29 geçti; tüm intake 111 geçti. İki mutasyon öldürüldü. GİB PDF yeniden çıkarımı: sayfa 2 metinsiz, sayfa 3–12 az metinli uyarısı; kısa metin korunuyor. `pagesWithText` bir metin katmanı sayısıdır, tam okuma garantisi değildir | 0 | `pdf-readability-after.json`, `test_sparse_pdf.py`; OCR açığı devam ediyor |
| S73 | Açık araştırma isteği ve aday çeşitliliği | Açık son araştırma cümlesi kavram sırasına öncelik veriyor; diğer konular korunuyor. Kısa ve açık atıfsız istekte kapsam o cümlede ölçülüyor, açık atıf varsa bağlam korunuyor. Sonraki sonuçlar dönüşümlü aday; açık konunun her birincil aramasında ilk iki aday öncelikli, aleyhe aday için yer korunuyor. Yeni testler önce başarısız; 4 araştırma mutasyonu öldürüldü | 0 | `researchFocus.test.ts`, `fetchCandidates.test.ts`, `workdayIntake.test.ts` |
| S74 | Canlı tekrarlar 4 ve 5 | Tekrar 4: 80,964 sn, 14 çağrı/6 belge, 0 kanıt. Tekrar 5: UI 66,9 sn; servis 65,825 sn, 14 çağrı/6 belge, 0 kanıt. İkinci koşu ilgili 9. HD 2026/2266 E. 4307 K. kararını getirdi; fakat alıntı seçimi ilgili bölümü kaçırdı. Başarı olarak raporlanmıyor | 0 | `live-workday-after-4-answer.json`, `live-workday-after-5-answer.json`; son runId `7a2e33c9-d79e-49e7-b21b-514e0e98ab73` |
| S75 | Alıntı penceresi ve Türkçe çekim | Uzun paragrafın tamamına puan verip yalnız başını kesme hatası: Unicode konumlu örtüşen arama pencereleri, seçilen alıntılar örtüşmüyor; puan gerçek alıntıdan ve mevcut Türkçe kapsam eşleştiricisinden. İki ayrı yeni regresyon önce başarısız, 3 test sonra geçti; 3 mutasyon öldürüldü. Gerçek indirilen kararın tekrarında tanık ve kayıt bölümleri bulundu. 0,4/0,85 ve hash kontrolleri değiştirilmedi | 0 | `quoteWindow.test.ts`, `quote-window-probe.json`; canlı sonrasının denetimi sürüyor |
| S76 | S73 sonrası tam TS paket | `tsc` exit 0; Vitest 131 dosya, 2520 geçti, 6 ters koşul atlandı, 30,77 sn. Bu ölçüm alıntı penceresi değişikliğinden önce | 0 | 08.09.2026 21:16 |

| S77 | Alıntı sonrası canlı tekrar 6 | UI 66,9 sn; 14 çağrı/6 belge, 3 alıntı ve 3 kaynakla desteklenen tespit. İki alıntı 9. HD 2026/2266 E. 4307 K. kararından; üçüncü HGK alıntısının konu uygunluğu zayıf. Sonuç hâlâ PARTIAL (maxFetches); genel ve koşulsuz hukuk kuralı üretildiği iddia edilmiyor. Kapsam 6/9, aynı eşik | 0 | `live-workday-after-6-answer.json`, runId `21abce7a-de18-4af5-ae78-cf57ea7587c1` |
| S78 | Alıntı sonrası tam TS paket ve kısmi durum açıklaması | `tsc` exit 0. Vitest 132 dosya/2523 geçti/6 ters koşul atlandı, 41,77 sn. Sonraki UI düzeltmesinde 3 test önce 2 hata, sonra konsol paketiyle 245 geçti; mutasyon öldürüldü. Gerçek kayıt tekrar açılınca “Tespitler alıntıya bağlandı; araştırma sınırına ulaşıldı” görülüyor. Sıfır tespitte “bazı tespitler bağlanamadı” iddiası kaldırıldı | 0 | `consolePartialReason.test.ts`; tam paket sayısı bu son UI değişikliğinden önce |

| S79 | PDF aidiyet bağlamı | İki yeni davranış testi önce başarısız: çok kanunlu cümlede çıplak madde son kanuna atanıyordu; ortak ayrıştırıcının tekrar-madde çıkarımı başlık sınırını aşıyordu. Birden çok kanun varsa çıkarım belirsiz bırakılıyor, kısa biçimler yükleme bağlamında yeniden denetleniyor. Açık bitişik kanun/madde çiftleri korunuyor. Analiz/çıkarım testleri 51 geçti; dört mutasyon öldürüldü | 0 | `pdf-analysis-after-context.json`: 492 m.138 ve 7566 m.7 korunuyor; yanlış 492 m.9/m.3 kalktı. Saklı eski yükleme analizi otomatik yenilenmedi |
| S80 | PDF okunabilirlik sonrası tam Python | 1394 geçti, 186,05 sn; bu ölçüm son S79 aidiyet değişikliğinden önce | 0 | 08.09.2026 |

| S81 | Aidiyet düzeltmeleri sonrası tam Python | 1397 geçti, 142,10 sn; `tests evals/tests` | 0 | 09.09.2026 |
| S82 | Belge / alıntı ayrımı sonrası tam TS | 134 dosya, 2529 geçti, 6 koşullu işaret testi atlandı; tsc temiz | 0 | 09.09.2026 |
| S83 | Kaynak sayacı gerçek ekran + mutasyon | Canlı kayıt `21abce7a` artık 2 belge / 3 alıntı / 3 tespit gösteriyor; 3 yeni test, 2 mutasyon yakalandı. Kimliksiz kayıtta belge sayısı tahmin edilmiyor. Bellekteki eski HTML için yalnız denetim sunucusu yeniden başlatıldı | 0 | 09.09.2026 |
| S84 | Dört tekrarlı sentetik değerlendirme | 4 tekrar / 4 içe aktarma, aynı dağılım; 17/21 kesinleştirilebilir, 0 yanlış cevap, 1 yanlış çekimser (`fx-amend-002`); 35/35 alıntı bütünlüğü, 0 uydurma kimlik / tenant sızıntısı | 0 | 09.09.2026 |
| S85 | Güncel kapanış kontrolleri | MCP smoke 54 araç, veritabanı 19/19, demo `--keep` 6/6 senaryo ve 47/47 kontrol; yasak pgvector migrasyonları uygulanmadı, mevcut yüklemeler silinmedi | 0 | 09.09.2026 |

| S86 | Tekrar yüklemede kalıcı analiz yenileme | Gerçek DB regresyonu önce başarısız, düzeltmeden sonra işlem testleri 13/13; 2 mutasyon yakalandı. Metin / sürüm / parça kimlikleri ve kullanıcı notları korunuyor. Resmî PDF aynı kimlik ve hash ile yeniden işlendi; GET artık düzeltilmiş atıfları ve seyrek metin uyarılarını döndürüyor | 0 | 09.09.2026 |

| S87 | Kalıcı analiz yenilemesi sonrası tam Python | 1398 geçti, 141,75 sn; `tests evals/tests` | 0 | 09.09.2026 |
| S88 | Analizi yenile: CLI, HTTP ve belge ekranı | Orijinal dosyanın kimliği/hash'i korunarak aynı PDF tarayıcıdan yenilendi; 7 davranış mutasyonu yakalandı. O aşamada Python 1402, TypeScript 2535 geçti / 6 mevcut atlama | 0 | 09.09.2026 |
| S89 | Yerel ONNX çıkarım | Hash doğrulamalı E5-small, localhost HTTP, 18 Python testi / 7 mutasyon; tek sorguluk gerçek 12 karar örneği genel hukukî isabet kanıtı değil | 0 | 09.09.2026 |
| S90 | Yerel modelin kaynak arama bağlantısı | Gerçek HTTP yolunda 10 kararın tam metni getirildi ve sıralandı; uygulama/rota aktarımı, boyut ve ortam izolasyonunda 4 mutasyon yakalandı. MCP smoke 54; tsc temiz; tam TS 2547 geçti / 6 mevcut atlama. Ana araştırmaya entegrasyon açık | 0 | 09.09.2026 |
| S91 | Yerel model: tarayıcı ve tam regresyon | Gerçek tarayıcıda 3 arama → 27 karar, ilk 10 semantik karşılaştırma, 81,6 sn. Python 1420 geçti; DB 19/19; demo --keep 6/6 ve 47/47. Dört eval tekrarı aynı: 17/21 kesinleştirilebilir, 0 yanlış cevap / 1 yanlış çekimser. Modelin benzerlik eşikleri kalibre edilmiş değil | 0 | 09.09.2026 |
| S92 | Yerel kütüphane uçtan uca (B-20 ikinci yarı) | `collex_ingest_test` (bu hattın karalama DB'si, 13/13 migrasyon, ledger 13), gerçek yazıcıyla 1 zarf (BEDESTEN, 5 parça). `python -m ingestion.library --json` 1. koşu: scanned 1 / published 1 / chunks 5 / moved 1; 2. koşu: scanned 0; aynı zarf yeniden kuyruğa: scanned 1 / skipped 1 / unchanged 1 / chunks 0, sürüm sayısı 1'de kaldı. Geçici `serve.mjs` (8993): `/v1/health.corpus.publicDocuments` 1; `POST /v1/library/ingest` ile ikinci zarf → published 1 / chunks 5 / complete true; ardından health 2, `/v1/library/status` ingested 2 / queued 0 / lastIngest dolu; bilinmeyen gövde alanı 400 (`bogus` adıyla), `dryRun:true` moved 0. `POST /v1/answer` (soru işaretli ifadeyle): evidence 2 (ikisi de yayımlanan belge, lane lexical+trigram), coverage 0,8 / gate passed, status PARTIAL, `OUT_OF_DATE_SOURCE` ×2, `finalizable:false`, `currentness.status UNKNOWN`. `pytest tests/ingestion -q` 119 passed (44,1 sn); `tsc --noEmit` exit 0; `smoke_check` exit 0 (54 araç); yeni `serveLibraryWiring.test.ts` 4/4; `npx vitest run` (COLLEX_NO_DOTENV=1) 144 dosya, 2676 geçti, 6 ters ortam işaretleyicisi atlandı, 26,2 sn, exit 0. Aynı gün `collex_local` (8787): publicDocuments 0, queued 0 | 0 | 10.09.2026, karalama dizini `answer.json` / `serve.log` |

## Statü gerekçesi — neden `PARTIAL`, `DEPLOYMENT_READY` değil

10.09 devam: tanınan iki genel onama biçiminin özel ispat sorusuna dayanak seçilmesi engellendi; ek somut gerekçe ve usul soruları korunuyor. İki sabit gerçek karar karşılaştırması geçti. Önceki iki olumlu kalite etiketi geri çekildi; 12 karar örneği artık özel soruya doğrulanmış olumlu örnek içermiyor. Canlı tekrar kaynak hatalarıyla hiç belge getirmedi; kalite kanıtı sayılmadı. Tam TS raporu 2565 geçti / 6 mevcut atlama (`vitest-stock-affirmance-final.json`); ayrıntı ve son ek bileşim testi `SEMANTIC-PASSAGES.md` içinde.

10.09.2026 ek doğrulama: ana araştırma yerel E5 pasaj seçimine bağlandı. Gerçek `43cca49a` koşusunda seçim uygulandı (kanıt aşaması 855 ms), fakat ilk derece özeti seçilmesi kalite kusuru olarak bulundu. Açık gerekçe başlığı olan kararlarda bölüm sınırı düzeltildi ve aynı gerçek metinle karşılaştırıldı. Genel onama cümlesinin özel ispat sorusuna yeterli sayılması hâlâ açık. Yerel E5 için doğrulanmamış yakın/orta/uzak etiketleri kaldırıldı. Tam TypeScript **2560 geçti / 6 mevcut atlama**, tsc temiz; pasaj seçiminde 4, gerekçe/karakter aralığı/etiketlerde 3 mutasyon yakalandı. Ayrıntılar `SEMANTIC-PASSAGES.md`, rapor `var/audit-20260907/vitest-calibration-20260910.json`. Bunlar iki bulgusuz tur veya rakibe üstünlük kanıtı değildir.

Brief §16.8 dört statü tanımlar. Karar ve gerekçesi (03.09.2026, Faz C
sonrası). **Statü sözcüğü değişmedi ve bu turda da yükseltilmedi.**

| Statü | Uygulanır mı | Neden |
|---|---|---|
| `COMPLETE` | **hayır** | Production credential yok, production deploy yetkisi verilmedi; açık P0 güvenlik olayı (SEC-2026-08-26-001, gömülü Brave/Tavily anahtarları) kullanıcının rotasyonunu bekliyor. |
| `DEPLOYMENT_READY` | **hayır** | **Sekiz doğrulanmamış yüzey + iki ölçülmüş tavan**, aşağıda tek tek. Faz C hiçbirini kapatmadı; kapatamazdı da — sekizinin yedisi bu makinenin dışındaki bir eylemi bekliyor. |
| `PARTIAL` | **evet** | "Çalışan ürün var ama zorunlu kapsamın bir bölümü bitmedi." Ürün çekirdeği, W12+W14 yüzeyleri ve Faz B2'nin ekranları yerelde çalışıyor ve **Ölçülen sayılar** tablosundaki komutlarla kanıtlanıyor; canlı runtime, gerçek korpus ve doğrulama adımları bitmedi. |
| `BLOCKED` | **hayır** | Bağımsız son doğrulama (F-VERIFY) L-VERIFY'ın 22 bulgusunda **16 kapandı / 3 iyileşti / 3 açık** hükmü verdi; Faz C'nin iki hattı kalan üç açığı ve iyileşen ikisini kapattı, geriye **V-1** kaldı (aşağıda ve `TRACEABILITY.md` V-satırları). Kalan işler dış bağımlılıktır (Blockers) ya da ölçülmüş bir sınırdır (Known risks). |

> **Bir sayı düzeltmesi, kayda geçsin.** Faz F hatları kendi raporlarında
> "19 kapandı, 1 kısmî, 3 açık" demişti. **Bağımsız denetim bu sayımı
> onaylamadı:** F-VERIFY her kalemi kendi yöntemiyle yeniden üretmeye çalıştı
> ve **16 KAPANDI · 3 İYİLEŞTİ (V-1, V-10, V-22) · 3 AÇIK (V-14, V-19,
> V-21)** buldu — yani V-1'in "kapandı"sını, V-10'un "0 px"ini ve V-22'nin
> "%41"ini kapanmış saymadı ve üçünü de sayıyla gerekçelendirdi. Ayrıca
> **altı yeni kusur** (N-1..N-6) kaydetti. Bu belge setinde bundan sonra
> geçerli sayım **16/3/3 + 6**'dır; "19 kapandı" cümlesi nerede kaldıysa
> yanlıştır.

### `DEPLOYMENT_READY` önündeki sekiz doğrulanmamış yüzey

**Bu liste 03.09.2026 itibarıyla kesindir ve Faz C'de hiçbir satırı
kapanmadı.** Sekizin **yedisi** bu makinenin dışındaki bir eylemi bekliyor
(bir anahtar, bir UYAP editörü, bir takvim istemcisi, ağ erişimi, bir hukukçu
turu, bu yılın Resmî Gazete rakamları, pgvector'lı bir hedef); yalnız **#7
(yerel kütüphane)** saf mühendislik işidir. Hepsi **etiketlidir**: kod ve
arayüz doğrulanmamış olduğunu söyler (S36). Hiçbiri gizlenmiş bir eksik
değildir.

| # | Yüzey | Etiket | Ne yapılmadı |
|---|---|---|---|
| 1 | **Bulut AI** | `ai.configured:false`, `ai.liveTested: false` | Canlı Anthropic API'sine **tek bir istek bile** gitmedi. Maskeleme, kayıt defteri ve tavan çalışması dâhil her şey sahte `fetch` ile sınandı. L-VERIFY bütün P0/P1 yüzeylerini `ai.configured:false` ile yürüdü — yani ürün AI olmadan çalışıyor, ama AI hattı hiç denenmedi. |
| 2 | **UDF dışa aktarımı** | `X-ColleX-Experimental: udf`, "deneysel" | Dosya **UYAP Doküman Editörü'nde hiç açılmadı** (bu makinede yok). Biçim sadakati düzeltildi, açılış doğrulanmadı. |
| 3 | **Süre kuralları** | `verified.status: 'dogrulanmadi'` + `DEADLINE_DISCLAIMER` | **41 kuralın 25'i hâlâ `dogrulanmadi`** (S10); 7'sinin `adliTatileTabi` değeri `"belirsiz"` ve hesap KISA (güvenli) tarihi kullanıp ikisini de gösteriyor. 16'sı madde metniyle doğrulandı. Bir kaçırılan süre geri alınamaz: bu, belge setinin **en yüksek etkili riskidir**. |
| 4 | **Harç tarifesi** | `dogrulanmadi` + `amount: null` + `FEE_DISCLAIMER` | **20 kalemin 17'sinde `amount: null`** (S11): yıllık Resmî Gazete rakamı elde yok, hesap `TUTAR_GEREKLI` der ve **toplam `null` kalır**. AAÜT nispi kademeleri hiç hesaplanmıyor; 492 s.K. m.28 çekilemedi. |
| 5 | **B-16 canlı karar arama** | ekran geçit kapalıyken **devre dışı**; listenin başında "tam ifade" çipi ve "Sıralamayı kaynak sunucu belirler… bu bir ilgililik sıralaması değildir" cümlesi | **Bu satır Faz F/C'de yarı yarıya değişti ve dürüst hâli şudur:** upstream'e **gerçekten ulaşıldı** ve **gerçek künyeler döndü** — F-VERIFY iki sorguda 20'şer künye, C-UI beş sorguda 13/20/10/0/20 künye ölçtü (S34) ve iki tam metinde sorgu ifadesini metnin içinde buldu. Yani kabul ölçütünün "≥ 10 künye" yarısı **karşılandı**. Karşılanmayan: **ilgililik hiç ölçülmedi** (iki tam metin bir ilgililik denetimi değildir), sıralamayı **kaynak sunucu** belirliyor, ColleX yalnız gelen 20 satırlık sayfayı yeniden dizebiliyor. **Faz M'de bir yarısı kapandı:** ekran artık kaynağın kendi kayıt sayısını yazıyor ("Kaynakta 761 kayıt var — burada ilk 13 tanesi listeleniyor"), kaynak bildirmezse **`null` asla 0 diye yazılmıyor** (S38), ve bekleme sırasında ilerleme + "Vazgeç" var. Kapanmayan yarı aynen duruyor: **ilgililik hiç ölçülmedi** ve sıralama sunucu işidir. Bu yüzden yüzey **doğrulanmamış** kalıyor: ölçülen şey erişim, ölçülmeyen şey isabettir. |
| 6 | **`.ics` takvim akışı** | — | Üretilen dosya **gerçek bir Outlook / Google Takvim istemcisinde hiç açılmadı**. RFC 5545 zorunlu alanları, yalnız-CRLF satır sonları, `VTIMEZONE Europe/Istanbul`, `VALARM TRIGGER:-P7D`, §3.3.11 kaçışlaması ve 75-oktetlik UTF-8 farkındalı katlama gövdeden **doğrulandı** (L-VERIFY §4.4); istemci round-trip'i ölçülmedi. |
| 7 | **B-20 yerel kütüphane** | manifest `yerelKutuphaneAcik` | Canlı araştırmanın getirdiği belgeler bir kuyruğa **yazılıyor**, ama `collex_local`'a **ingest edilmiyor**; o iş `ingestion/**` içinde bir `SourcePort` gerektiriyor ve inmedi. `corpus.publicDocuments` artmıyor ve **artıyormuş gibi de yapılmıyor**. **(10.09.2026 notu: ikinci yarı indi ve ölçüldü — `ingestion/library.py` + `POST /v1/library/ingest`, S92. Etiket şimdilik kalıyor: bu makinedeki `collex_local` ölçüm günü hâlâ 0 belgeydi, ve kuyruktan gelen belge yürürlük dönemi taşımadığı için cevap `OUT_OF_DATE_SOURCE` ile PARTIAL kalıyor.)** |
| 8 | **B-13 atıf denetimi** | rapor ekranda "kapsam beyanı" diyor | Bağlı korpus çözümleyicisi **asla `NOT_FOUND` diyemiyor**: şema bir mevzuatın tam mı parça mı saklandığını söylemiyor. Her çözülemeyen atıf **`UNCERTAIN`**, künye hücresi **BOŞ** (L-VERIFY §6.4: 5 belirsiz satırın 5'inde boş). Rapor bugün bir **kapsam beyanı**dır, tam bir atıf doğrulaması değildir. Belge yolunda denetim ayrıca **240 kod noktalık bölüm önizlemeleri** üzerinde çalışıyor ve bunu ekranda sayıyla söylüyor. |

### Ve iki ölçülmüş tavan (doğrulanmamış değil — **ölçülmüş ve kapatılamamış**)

**1 · Korpus sorusu ölçekte saniyeler sürüyor ve en kötü hâli boş dönüyor**
(S25‴). 20 000 parçalık gerçekçi bir korpusta yaygın bir sözcük **3,8 sn**
(PARTIAL, 8 kanıt, 0 bozuk şerit) — L-VERIFY'ın 47 sn'sinden ve F-PERF'in
15–17 sn'sinden iyidir ve bu bir kazançtır. Ama aynı ölçümün ikinci yarısı
şudur: **korpusta hiç geçmeyen bir ifade artık en yavaş sorudur — 7,5 saniye
bekletip ABSTAIN döner**, üç şerit de 2 500 ms bütçesiyle kesilerek. Yani
avukatın en sık yaşayacağı olumsuz durum (aradığı şey korpusta yok) en pahalı
durumdur. Kalan maliyetin kapatılması aday kümesini daraltan bir indeks ya da
**bu makinede kurulamayan pgvector'e bağlı dense şerit** gerektiriyor.
Avukatın günlük yolu (yüklediği belgeye soru) **71–73 ms** ile etkilenmiyor.

> **Faz M bu tavanın ARAYÜZ yarısını kapattı, ölçüm yarısını değil.** Artık
> beklerken ekranda bir **ilerleme kartı** duruyor (evre cümlesi + tarayıcının
> kendi saatiyle ölçtüğü geçen süre + tek bir "Vazgeç"), ve 3 saniyeden sonra
> beliren cümle avukata tam bu tavanı **nitel olarak** söylüyor: "En uzun
> bekleme, aradığınız ifadenin arşivde hiç geçmediği durumdur." **Kartta
> yüzde yoktur** — sunucu ilerleme bildirmiyor, uydurulmuş bir yüzde bu
> projenin yasakladığı türden ölçülmemiş bir sayı olurdu. "Vazgeç" gerçek:
> `AbortSignal` `fetch`'e geçiyor, tetikleniyor ve iptal edilen istek bir hata
> kartı olarak **çizilmiyor** (M-UI §1.2, iki bağımsız ölçümle). **7,5 saniye
> kısalmadı** — görünür ve durdurulabilir oldu. Bir aracın yavaş olması ile ne
> yaptığını söylememesi aynı şey değildir; kapanan ikincisidir.

**2 · Trigram şeridinin plan davranışı korpustan korpusa değişiyor ve
öngörülemiyor** (S26⁗). Üç bağımsız probe üç farklı tablo verdi; "seçici
sorgu ucuzdur" cümlesi bir korpusta doğru, diğerinde yanlış çıktı. Bu, bir
performans hatası değil ama bir **bilgi eksikliğidir**: ürünün gerçek
eşiğinde (0,35) şeridin maliyetini gerçek Türk hukuk metninde kimse ölçmedi
ve bu belge setindeki hiçbir hızlanma sayısı `/v1/answer` için
alıntılanamaz.

Bunların yanında: pgvector'lı hedef yok (dense şerit atıl, hibrit retrieval
hiç ölçülmedi), staging yok, hukukçu etiketli `legal_gold_v1.jsonl` yok ve
kapsam kapısı **sözcükseldir** — gerçek hukuk metninde hiç ölçülmedi.

### İki ölçüm aracı çekincesinin ikisi de kapandı (N-8, N-7)

**N-8 · KAPANDI (Faz M).** Faz C'de süit yedi koşunun birinde kırmızıya
dönmüştü: `tests/store/retrieval.test.ts` bloğu (l) `trigramBudgetMs: 1`
verip şeridin kesilmesini bekliyor, sıcak önbellekte sorgu 1 ms'nin altında
bitiyor ve şerit dürüstçe `EXECUTED_FOUND` diyordu — **ürün doğruydu, test
duvar saatine yaslanıyordu**. M-SRV yarışı kaldırdı (S39: aynı transaction'a
enjekte edilen, bütçenin elli katı süren bir ifade; iptal üretimin tam
yolunu izliyor) ve **hiçbir iddiayı zayıflatmadı** — iki vakumsuzluk kanıtı
testin içinde duruyor. **Bu turda süit üç kez koşuldu ve üçünde de
`retrieval.test.ts` 47/47 yeşil bitti** (S2); M-SRV'nin altı koşusuyla
birlikte **arka arkaya dokuz yeşil tam koşu**. "Süit yeşil" cümlesi artık
bir koşuya değil, üç koşuya dayanıyor.

### N-7 — eval kapısının cevap katmanı (KAPANDI, 03.09.2026)

**Faz M raporu düzeltti ve kök nedeni ölçtü; bu tur kalan kök nedeni buldu ve
düzeltti.**

1. **Rapor yalan söylemiyor (Faz M).** `run_evals.py --repeats N` bant basıyor,
   `--repeats 1` bile genişliği 1 olan bir bant basıyor, ve bandın **tek**
   gate'e bağlanan satırı doğru seçilmiş: `acceptable_abstention` işaretli bir
   gold satırı **hiçbir tekrarda** cevaplanmamalı — kapı bandın **en kötü**
   tekrarına bakar (S40). Dayanağı olmayan bir soruya cevap vermek bu ürünün
   var olma sebebi olan kusurdur; "dört koşunun yalnız birinde oldu" bir
   savunma değildir.
2. **Nedenin INGEST tarafında olduğu ölçüldü (Faz M).** Aynı ingest edilmiş
   veritabanı üzerinde arka arkaya koşan cevap sürücüsü rakam rakam aynı;
   oynayan, **her koşuda yeniden ingest eden** koşular.
3. **Üç ayrı UUID bağımlılığı kapatıldı (03.09.2026).** Önce citator şeridinin
   iki sorgusu (`chunkStore.ts`, `stableRelationTieBreak`), sabitlenmiş
   mevzuat penceresinin `partition/order` anahtarı (`chunkStore.ts`) ve
   `ingestion/relations.py`'nin `ORDER BY`'sız aday-kanun sorgusu. **Üçü de
   gerçek kusurdu ve üçü de oynaklığı kapatmadı.**
4. **Kalan kök neden bulundu ve düzeltildi (bu tur, S41).** `AnswerPipeline`'ın
   `rank` aşaması bir skor eşitliğini `hit.chunkId` ile çözüyordu — bu bir
   ingest UUID'sidir. Citation / citator / contrary şeritlerinden gelen her
   pasaj `fusedScore: 0` taşıdığı için eşitlik kümesi aday listesinin çoğudur;
   kapsam-farkında üst sınır sonra **her ingest'te farklı bir sekizli**
   tutuyordu. Yerine korpus kimliği geldi.

**Bunun bir yöntem dersi var ve yazılı kalması gerekiyor:** birinci ölçüm
(iki ingest'in içeriğini kararlı anahtarlarla diff'lemek) **içerikte hiçbir
fark bulamadı** — yalnız kimlikler değişiyordu. Yani hata "ingest farklı veri
üretiyor" değil, "okuma yolu bir kimliğe bakıyor" idi, ve onu ancak bir gold
satırının izini iki ingest boyunca çıkarıp ilk ayrışmayı geriye yürüterek
bulmak mümkündü. Şeritlerin döndürdüğü sıralı listeler iki ingest'te de
aynıydı; ayrışan, üst sınırın tuttuğu kümeydi.

**Bu turun ölçümü (N7, altı tam koşu + bir `--repeats 4`):** ABSTAIN **14** ·
COMPLETE **13** · PARTIAL **3** · QUALIFIED **4** · yanlış çekimserlik **1**
(`fx-amend-002`, altısında da) · yanlış cevap **0** (kapı) ·
kesinleştirilebilir **%81,0** — **altı koşunun altısında da birebir aynı**, ve
bandın her satırında `stable: true` (S6, S41).

**Bant kipi kalıyor.** Sıfır genişlikli bir bant, kararlılığın önünüzdeki ağaç
üzerinde tek KANITIDIR; tek koşu hiçbir zaman kanıt değildir. C-SRV §6.3'ün
eşik kararını gerekçelendiren "bir satır kayıyor" gözlemi, artık bandın
oynamayan bölgesindedir — kararın kendisi (eşiği değiştirmemek) değişmiyor.

**Kalan tek ingest bağımlılığı bir sayı değil, bir etikettir ve bilerek
düzeltilmedi.** `deterministicEvidenceId` `documentVersionId`'yi (ingest
UUID'si) özetler, bu yüzden üç gold satırının `reasons` metnindeki
`ev-<16 hex>` dizgileri ingest'ten ingest'e değişir. Hiçbir sayıyı, sırayı,
durumu veya kapıyı etkilemez — kararlı kimliklere çevrildiğinde bu üç satırın
gerekçe listeleri de beş ingest'te birebir aynı çıktı. Onu korpus kimliğinden
türetmek **ürün davranışını değiştirirdi**: `evidenceId` saklanan cevap ve
taslak kayıtlarında, delil paketlerinde ve dışa aktarımlarda duran kalıcı bir
kimliktir; türetimini değiştirmek eldeki her kaydın kimliğini geçersiz kılar.
Bu, N-7'nin değil, ayrı bir kararın konusudur.

**`DEPLOYMENT_READY`'ye en küçük yol:** (a) pgvector'lı bir hedef; (b) Brave +
Tavily rotasyonu; (c) migration zinciri o hedefte sıfırdan uygulanır ve
`run_evals` eşdeğeri orada koşar; (d) `ai-live-smoke.mjs` bir anahtarla
koşulup `AI.md`'ye kaydedilir; (e) kalan 25 süre kuralı madde metniyle
doğrulanır; (f) bir UDF UYAP editöründe açılır; (g) ağı olan bir makinede
`POST /v1/sources/search` gerçek Bedesten'e karşı koşar ve künye sayısı
kaydedilir; (h) bir `.ics` gerçek bir takvim istemcisinde açılır; (i) bu yılın
harç tarifesi girilir. **`COMPLETE` için** ek olarak production deploy yetkisi
ve `legal_gold_v1` (iki bağımsız hukukçu + adjudication).

## V-1..V-22 ve N-1..N-8 — bugünkü hesap

Satır satır iz `TRACEABILITY.md`'dedir. **Bağımsız denetimin (F-VERIFY)
hükmü 16 kapandı / 3 iyileşti / 3 açık idi; Faz C'nin iki hattı beşini daha
kapattı.** Bugünkü durum:

| Blok | Bugünkü sayım | Kalan |
|---|---|---|
| **V-1..V-22** | **21 KAPANDI · 1 İYİLEŞTİ, KAPANMADI** | **V-1** (ölçek tavanı — yukarıdaki "ölçülmüş tavan 1") |
| **N-1..N-6** (F-VERIFY'ın yeni kusurları) | **4 KAPANDI** (N-2, N-3, N-5, N-6) · **1 KISMÎ, Faz M'de DARALDI** (N-4) · **1 BELGELENDİ, KAPANMADI** (N-1) | **N-1** (ürünün kendi eşiğinde — 0,35 — plan gerileme testi hâlâ yok; süitteki plan testleri şeridin varsayılanı olan **0,5** ile koşuyor, `chunkStore.ts:881/938`) · **N-4'ün sıralama yarısı** (aşağıda) |
| **N-7 ve N-8** (Faz C'de bulundu) | **N-8 KAPANDI** (Faz M, S39; M-CLOSE'da üç koşuluk bağımsız denetim) · **N-7 KAPANDI** (N7 turu, S41; altı tam koşu + `--repeats 4` bandı, hepsi birebir aynı) | N-7'den geriye **bir sayı değil, bir etiket** kaldı: `deterministicEvidenceId` ingest UUID'sini özetlediği için üç gold satırının `reasons` metnindeki `ev-<hex>` dizgileri ingest'ten ingest'e değişir; hiçbir sayıyı, sırayı, durumu veya kapıyı etkilemez ve düzeltilmesi kalıcı `evidenceId`'leri geçersiz kılardı (§N-7) |

| Hat | Kapattığı | Ölçüm |
|---|---|---|
| **F-PERF** | V-2 (`answers_filescope_gin` artık ürünün kendi sorgusuyla kullanılıyor); V-1'i **iyileştirdi** | S26⁗, S27″ |
| **F-API** | V-3 (sunucu yarısı: geçit "Karar ara"ya da bağlı), V-4 (`COLLEX_DATA_DIR` ile "Aslını indir"), V-6 (`/v1/answers` `q`/`status` + tanınmayan parametreye 400) | S31″ |
| **F-UI** | V-5, V-7, V-8, V-9, V-11, V-12, V-13, V-15, V-16, V-17, V-18, V-20 ve V-3'ün arayüz yarısı; V-10 ve V-22'yi **iyileştirdi** | S30″, S32″ |
| **C-SRV** (Faz C) | **V-14** (arşiv adı veritabanından türüyor, geri yükleyici manifestten okuyor), **V-19** (her `.strict()` reddi alanı adıyla söylüyor), **V-21** (dayanağı olmayan soruda karşıt tarama koşmuyor), **N-2**'nin sunucu yarısı, **N-3**; **N-1**'i ölçtü ve yorumu düzeltti, eşiği **bilerek değiştirmedi** | S28‴, S31″, S35, S26⁗ |
| **C-UI** (Faz C) | **N-4**'ün liste yarısı (her satırda eşleşen cümle ya da "sağlanmadı"; tam ifade varsayılan açık; sayfanın şekli sayıyla), **N-5** (tespit kartları katlanıyor), **N-6** (yeni dosya aktif oluyor), **V-10 ve V-22 kalıntıları** | S32″, S34 |
| **M-SRV** (Faz M) | **N-8** (blok (l) artık enjekte edilen bir yavaş ifadeyle iddia ediliyor); **N-7'yi daralttı** (bant + kapı) ve **nedenin ingest tarafında olduğunu ölçerek gösterdi**; IR-1 (`/v1/health.uploadsDir`) ve IR-2 (`totalRecords`) alanlarını indirdi | S39, S40, S37, S38 |
| **N7** (kapanış) | **N-7** — `AnswerPipeline`'ın sıralama eşitliği artık korpus kimliğiyle çözülüyor; iki ingest'in içerik diff'i, `fx-amend-002`'nin izi ve bir gerileme testi | S41, S6, S2 |
| **M-UI** (Faz M) | **V-1'in arayüz yarısı** (uzun beklemede ilerleme kartı + çalışan "Vazgeç"; beş uzun işte daha, altıncısında gerekçeli istisna); **N-4'ü daralttı** (kaynağın kendi kayıt sayısı artık ekranda ve `null` asla 0 diye yazılmıyor); S37/S38'i ekrana bağladı; ilk-açılış künyesi 162 → 129 px; cevap kartı 5 198 → 5 005 px (**kapanmadı**) | `W14-M-UI` §1–§4; S37, S38 |
| **kalan** | **V-1'in ÖLÇÜM yarısı** (7,5 sn hâlâ 7,5 sn; görünür oldu, kısalmadı) · **N-1** ürünün eşiğinde (0,35) ölçülmüş plan gerileme testi yok · **N-4** gerçek ilgililik sıralaması sunucu işidir ve yapılmadı (sayı geldi, **sıralama gelmedi**) · (**N-7 bu turda kapandı**, S41) | S25‴, S26⁗, S34, S6/S40/S41 |

## W14'te yerelde teslim edilen — yüzey yüzey

Her satır: iş → dosya → kanıt. Kalem bazlı iz `TRACEABILITY.md`'de (B-01..B-46).

| Yüzey | Dosya(lar) | Kanıt |
|---|---|---|
| **Alıntı bütünlüğü kapısı (B-01)** — paragraf, atıf yaptığı alıntıyı NFC-kanonik biçimde **birebir** içermek zorunda; içermiyorsa PUT `QUOTE_ALTERED` der, paragraf KAYNAKSIZ'a düşer, `md/docx/udf` dışa aktarımı **409 ile reddedilir** ve hiçbir dosya yazılmaz. Kapı **iki bağımsız katmanda** | `control-plane/src/drafting/quoteIntegrity.ts`, `src/drafting/{composer,revise,routes}.ts`, `export/draft.py` | S2, S3; **tarayıcıda tahrifat üretilerek doğrulandı** (`W14-L-VERIFY` §4.1 P0-1). `409 EXPORT_REFUSED` yolu uçtan uca üretilemedi — yalnız testle kanıtlı |
| **Dosyalanabilir çıktı (B-02)** — `annex=full\|none` + `marks=all\|none`; nihai kopya **A4 21×29,7 cm**, ortalanmış mahkeme hitabı, sağa yaslı imza, iki yana yaslı gövde, gerçek `bold`. **Doğrulama her modda aynı koşar** | `export/{petition,udf,draft,cli}.py`, `control-plane/src/drafting/{exportMode,markdown,appendix}.ts` | S3; nihai DOCX python-docx ile açıldı: **30 paragraf, 9 bold, 23 hizalı, `[K-n]`/SHA-256/`collex.`/`hmk-` 0 kez** (`W14-L-VERIFY` §4.3) |
| **Atıf Denetim Raporu (B-13)** + ekranı | `control-plane/src/contracts/*`, `export/audit.py`, `console.html` `#denetim` | S2, S3; ekranda üç kova, **boş künye hücresi** ve dürüstlük satırı (`W14-L-VERIFY` §4.4) |
| **Sözleşme incelemesi (B-24)** + `#sozlesme` ekranı | `control-plane/src/contracts/*`, `export/review.py`, `console.html` | S2, S3; `GET /v1/contracts/checklists` 200 |
| **Doğrulama kontrol listesi (B-36)** | `control-plane/src/drafting/{revise,types}.ts`, `export/draft.py` | S2, S3. **Ekranı hâlâ inmedi** (L-CONSOLE-B §9.6) |
| **Dosya paketi (B-30)** — ZIP + `MANIFEST.json`, `verify_package(path)`; "Aslını indir" | `export/package.py`, `control-plane/src/matters/packageRoutes.ts`, `src/files/routes.ts` | S3, S31″ (asıl bayt bayt; paket ZIP'i aslı taşıyor). **Konsolda "Dosya paketini indir" düğmesi yok** (L-CONSOLE-B §9.5) |
| **Cevap dürüstlüğü (B-07/B-08/B-09/B-31)** | `control-plane/src/answer/*`, `src/pipeline/*`, `src/llm/*` | S2, S6; "tbk ya gore" **ABSTAIN** (`W14-L-VERIFY` §4.2). B-08 ve B-09 **KISMEN**: uzun soru hâlâ 0 kanıt getiriyor, zamansal soruda iki metnin yan yana gösterimi görülmedi |
| **Takvim, duruşma ve `.ics` (B-17)** + `#takvim` ekranı | `control-plane/src/matters/*`, `supabase/migrations/20260904090000_*.sql`, `console.html` | S2, S5; `.ics` gövdesi doğrulandı (yukarıda #6) |
| **Kronoloji, arama, silme, aktivite (B-18/B-26/B-29/B-43)** | `control-plane/src/matters/*`, `src/files/*`, `src/drafting/*` | S2, S18, S31″ (`/v1/answers` süzgeçleri **artık gerçekten süzüyor**) |
| **Kaynak hattı (B-14/B-15/B-16/B-20/B-38)** + `#karar-ara` ve `#kapsam` ekranları | `control-plane/src/sources/*`, `src/capabilities/inventory.ts`, `src/planner/*`, `console.html` | S14, S15, S31″, S34. **Canlı upstream'e ulaşıyor ve gerçek künye getiriyor; ilgililik ölçülmedi** (yukarıda #5) |
| **Platform ve dayanıklılık (B-03/B-04/B-05/B-12/B-19/B-23/B-33/B-34/B-44/B-45)** | `control-plane/src/{backup,ai}/*`, `src/api/localGuard.ts`, `ingestion/migrations.py`, `intake/*`, iki `.cmd`, `ci.yml` | S28‴ (uçtan uca tatbikat + arşiv adı), S2, S3, S13 |
| **Süre kuralları, şablon içeriği, harç (B-11/B-25/B-35)** + `#harc` ekranı | `control-plane/src/deadlines/rules.ts`, `src/drafting/templates.ts`, `src/fees/*`, `console.html` | S9, S10, S11 |
| **Konsol (B-10/B-21/B-22/B-27/B-28 + Faz B2'nin altı yeni ekranı + Faz F'in on beş düzeltmesi + Faz C'nin altı cilası + Faz M'in ilerleme/iptal katmanı)** | `control-plane/public/console.html` | S29″, S30″, S32″; `console.test.ts` **179 geçti** (S2) |

### Faz M'de ekranda değişenler (M-UI'nin ölçümü, bu hattın değil)

**Tek bir paylaşılan bileşen** (`beginBusy` / `busyCancelledCard` /
`isAbortError`) ve onu kullanan yedi çağrı yeri:

| İş | Önce | Şimdi |
|---|---|---|
| Korpus/cevap sorusu, belge sorusu | ekranda **0 karakter**, iptal **yok** | ilerleme kartı (evre + ölçülen saniye) + **Vazgeç**; iptal 2,0 sn'de gerçekleşti ve istek ağa **hiç çıkmadı** |
| Karar arama | kaynak adları, iptal yok | aynı kart + Vazgeç; gerçek aramalarda 6 610 ms ve 23 157 ms boyunca dolu |
| Belge yükleme | soluk `n/N` satırı | kart + `n/N gönderiliyor` + Vazgeç; iptal **kuyruğu da durduruyor** ve bildirim **warn** tonunda |
| Atıf denetimi | düğme yazısı | kart + Vazgeç |
| Yedekleme | düğme yazısı | kart, **Vazgeç YOK ve sebebi ekranda**: "eksik kopyalanmış bir klasör yedek sayılmaz" |
| Canlı araştırma | panel, iptal yok | panelde Vazgeç; **"koşu durduruldu" DEMİYOR** — sunucuda durduracak bir uç yok, kart bunu yazıp "Kayıtlı cevaplar"a yönlendiriyor |
| Dışa aktarma (`<a download>`) | sessiz | **bilerek dönüştürülmedi**; tek satırlık dürüst uyarı (bitişini sayfa göremez) |

Kartın üç kuralı: **yüzde yoktur** (sunucu ilerleme bildirmiyor), **evre satırı
yalnız gerçekten bilinen durumu söyler**, ve uzun-bekleme cümlesi 3 sn'den
önce çizilmez ve **içinde sayı yoktur**.

### Kalıcılık sözü ve çekinceleri

- `serve.mjs` DSN varsayılanı `collex_local`; `/v1/health.db === 'ok'` iken
  cevaplar, taslaklar (sürüm başına satır), dosyalar, ayarlar, kişiler ve
  kontrol listeleri PostgreSQL'e yazılır ve yeniden başlatmada geri gelir.
  L-VERIFY bunu ölçtü: sunucu `Stop-Process` ile öldürülüp yeniden açıldı,
  öncesi/sonrası birebir aynı (`W14-L-VERIFY` §4.4).
- Çekince 1: `PgAnswerStore.put` / `PgDraftStore.put` **arka planda** yazar.
  `<veri>/collex.stop` ile **nazik** duruş bunu kapatır — pid dosyası ancak
  `flush()` + `sql.end()` sonrası silinir, yani **pid'in gitmesi "kayıtlar
  yazıldı" demektir**. Sert `taskkill /F` hâlâ son kaydı kaybettirebilir.
  **Yeni (F-PERF §10.1):** `PgDraftStore.put` arka plan yazımlarını **anahtar
  başına sıraya koymuyor**; aynı `(draftId, version)` için ardışık iki `put`
  havuz zamanlaması değişince ters sırada commit olabiliyor ve son çağrının
  gövdesi kaybolabiliyor. Bir testte **deterministik olarak** üretildi;
  düzeltilmedi.
- Çekince 2: `db: 'down'` iken sunucu bellek içi depolarla kalkar, bunu
  başlangıç satırında ve Sistem durumu'nda söyler; o oturumun kayıtları gider.
- Çekince 3: canlı araştırmanın **sonucu** kalıcıdır, ilerleme akışı bellek
  içidir (16 koşu, 30 dk TTL).
- Çekince 4: yedekleme **elle** tetiklenir; **zamanlanmış görev yoktur**.
  `/v1/health.backup` hiç yedek alınmamışsa `null` döner ve konsol bunu
  kırmızı gösterir.
- Çekince 5: 5 MiB'ı aşan kanonik metinler cevap kaydına yazılmaz
  (`STORED_WITHOUT_TEXTS`); alıntılar ve sağlama değerleri kayıttadır.

## Açık ve dürüst — Faz C'nin de kapatmadıkları

1. **Ölçekte korpus sorusu saniyeler sürüyor, ve en kötü hâli boş dönüyor**
   (S25‴). Gerçekçi korpusta yaygın sözcük 3,8 sn; **korpusta hiç geçmeyen
   ifade 7,5 sn sonunda ABSTAIN**. Üç seçenek denendi, biri
   (`left(search_text,250)`, 866 ms) **sessiz recall kaybı** olduğu için
   gönderilmedi. Arayüzde bir ilerleme satırı ya da iptal düğmesi **hâlâ yok**
   (L-VERIFY §11.7 ve F-VERIFY §9.1'in önerisi uygulanmadı).
2. **Trigram fallback kapısı bir recall değişikliğidir.** Birincil şeritler
   sekiz veya daha fazla ayrık pasaj döndürdüğünde ve dokuzuncuya ancak
   bulanık eşleşmeyle ulaşılabildiğinde o pasaj **artık gelmiyor**. Gold
   küme üzerinde bütün retrieval metrikleri ve şerit dağılımı **birebir aynı**
   kaldı (S6). Cevap katmanında kımıldayan satırlar için Faz F'in yazdığı
   yorum (`fx-amend-003` QUALIFIED → COMPLETE, üç `CONFLICTING_AUTHORITIES`
   kaybı) **o gün tek başına güvenilir değildi**: aynı komut dört kez
   koşulduğunda o katman kendiliğinden oynuyordu (N-7). N-7 bu turda kapandı
   (S41), yani bu ölçüm artık **yeniden alınabilir** — ve alınmadı. Kapının
   recall değişikliği olduğu tespiti **duruyor**; hangi gold satırının hangi
   yöne kaydığı hâlâ ölçülmedi.
3. **`SearchPipelineResult.trigram` hiçbir yüzeye çizilmiyor.** Kapı artık
   ölçülebilir ("bulamadı" ≠ "hiç koşmadı"), ama ne HTTP cevabında ne
   konsolda görünüyor.
4. **Faz C'nin kapatamadığı üç kalem:** **N-1** (ürünün kendi eşiğinde —
   0,35 — şeridin maliyetini ölçen bir plan gerileme testi yok; üç korpus üç
   farklı tablo verdi), **N-4'ün sıralama yarısı** (gerçek ilgililik
   sıralaması birden çok sayfa çekip yeniden puanlamayı gerektirir, bu sunucu
   işidir ve yapılmadı; konsol yalnız gelen 20 satırı dizer ve bunu ekranda
   söyler). **N-7 artık bu listede değil** (S41). Ayrıca C-UI'nin kendi
   kaydettiği küçük bir kalem: **ilk-koşu kabuğu doğrudan `#ayarlar` ile
   açıldığında bazen kompakt çiziliyor** (`maybeWelcome()` ayarlar gelmeden
   koşarsa); ölçüldü, düzeltilmedi.
5. **Konsolda bağlanmayan sözleşmeler** (L-CONSOLE-B §9.6): B-36 üç doğrulama
   kutusu, B-02 "Nihai kopya indir", B-01'in `409` ekran davranışı, B-18 toplu
   tarih aktarımı, B-26 silme onayları, B-29 genel arama, B-42 kişi kartları,
   B-43 "Nerede kalmıştım", B-23 maskeleme önizlemesi ve Bulut AI kayıt
   defteri, B-09'un iki metin bloğu, B-08'in `coverage.measuredOn` satırı,
   B-31'in `entailmentMeasured` ekseni. **Uçları hazır; ekranları yok** — ve
   bu belgeler onları var gibi anlatmıyor.
6. **B-21'in DOCX yarısı ve B-18'in kronoloji DOCX'i inmedi.** Izgara CSV
   olarak iniyor; CSV Word'de açılır ama **bir DOCX değildir ve öyle
   sunulmuyor**. `inceleme-docx` HTTP ucu bu turda kapatıldı.
7. **`prefers-reduced-motion` tarayıcıda hiç ölçülmedi** (medya emülasyonu bu
   yüzeyde yok); kural statik olarak doğrulandı.
8. **B-03'ün "küme sıfırdan kurulur" adımı yapılmadı.** Tatbikat
   **veritabanı** düzeyinde koştu (S28‴); kümeyi yeniden kurmak bütün hatların
   paylaştığı PostgreSQL'i yok etmek olurdu.
9. **Bu ekranların hiçbiri gerçek bir avukat tarafından kullanılmadı.** Bütün
   yürüyüşler ölçen hatların kendi yürüyüşleridir ve **SENTETİK** demo
   korpusundadır.
10. **Faz A/B rapor dosyaları düzeltilmedi.** Lane raporları bağlayıcı
    **tarihsel** kayıttır; bir sayı yanlışsa düzeltme bu tabloda yapılır
    (örn. `W14-L-LEGAL` §3.2'nin "15 kalem `amount: null`" hatası → S11'de
    **17**).

## Doğrulama komutları

Hepsi `yargi-mcp-independent` kökünden; beklenen çıktılar **Ölçülen sayılar**
tablosunda. Sıra ve DB sahipliği için `RUNBOOK.md` §3–4.

```
cd control-plane && npx tsc --noEmit && npx vitest run          # S1, S2
.venv/Scripts/python.exe -m pytest tests evals/tests -q         # S3
.venv/Scripts/python.exe scripts/smoke_check.py                 # S4
.venv/Scripts/python.exe scripts/http_e2e_check.py              # S14 (54 tool over HTTP)
.venv/Scripts/python.exe scripts/live_local_gateway_check.py    # S14 (54 over MCP transport, loopback)
.venv/Scripts/python.exe scripts/db_local_check.py              # S5 (scratch PG)
.venv/Scripts/python.exe scripts/run_evals.py                   # S6 (scratch PG + npm ci)
                                                                #    sert kapılar da cevap katmanı da artık
                                                                #    deterministik (S41); yine de tek koşu
                                                                #    kararlılığın KANITI değildir (N-7)
.venv/Scripts/python.exe scripts/run_evals.py --repeats 4       # S40/S41: cevap katmanını BANT olarak basar
                                                                #    (bugün genişliği SIFIR: "identical across
                                                                #    them") ve yanlış cevap kapısını her
                                                                #    tekrarda uygular
node control-plane/scripts/demo.mjs                             # S7 (collex_demo)
node control-plane/scripts/backup.mjs --database collex_local --out <klasör>   # S28‴
node control-plane/scripts/backup.mjs --verify <klasör>                        # manifest doğrulaması
node control-plane/scripts/backup.mjs --dump-name <klasör>                     # arşiv adını manifestten okur (V-14)
```

Uçtan uca (avukat yolu): `ColleX-Baslat.cmd` → PG → `intake.cli --ensure-db`
→ `serve.mjs --port 8787 --with-mcp` ayrı pencerede → `/v1/health` 200'e kadar
60 s → tarayıcı. `ColleX-Durdur.cmd` **önce** `<veri>/collex.stop` sentinel'ini
bırakır ve pid dosyasının kaybolmasını 6 s bekler (nazik kapanış), sonra sert
kapatmaya geçer. **8787/8898'i dinleyen yabancı bir süreç kapatılmaz.**
Yedekleme/geri yükleme için `ColleX-Yedekle.cmd` / `ColleX-Geri-Yukle.cmd`.

## In progress

Faz M kapandı. Sırada, bu belgelerin dışında:

- **N-7 kapandı (S41), ama iki iş ondan miras kaldı.** (a) Faz F'in
  "`fx-amend-003` QUALIFIED → COMPLETE" yorumu oynak bir katmanda ölçülmüştü;
  katman artık kararlı, **yeniden ölçülebilir ve ölçülmedi**. (b)
  `deterministicEvidenceId` hâlâ ingest UUID'sini özetliyor: bir sayıyı
  etkilemez, ama iki ingest'in raporu metin olarak birebir aynı değildir.
  Korpus kimliğinden türetmek saklanan her `evidenceId`'yi geçersiz kılar —
  ayrı bir karar, ayrı bir dalga.
- **Ölçek tavanının ÖLÇÜM yarısı** (S25‴, V-1) — aday kümesini daraltan bir
  lexical indeks ya da dense şerit (ikincisi pgvector'a bağlı). *Arayüz yarısı
  Faz M'de kapandı: ilerleme kartı + "Vazgeç".*
- **N-1** — trigram şeridinin maliyetini ürünün **kendi eşiğinde** (0,35)
  ölçen bir plan gerileme testi. Bugünkü plan testleri şeridin varsayılanı olan
  0,5 ile koşuyor.
- **N-4'ün sıralama yarısı** — sunucu tarafında birden çok sayfa çekip
  yeniden puanlayan bir ilgililik katmanı. *Kaynak başına `totalRecords` Faz
  M'de indi (S38); kalan, sıralamanın kendisidir.*
- **Dışa aktarmanın gerçek ilerlemesi** — `<a download>` bitişini bildirmiyor;
  gerçek çözüm sunucu tarafındadır (önce hazırla → 202 + iş numarası → indir).
  M-UI istemciden dürüstçe yapılabileni yaptı: tek satırlık uyarı.
- **Canlı araştırmayı sunucuda durduracak bir uç yok** — bugünkü "Vazgeç"
  dürüstçe yalnız beklemeyi bırakıyor ve bunu ekranda söylüyor.
- **Konsolda bağlanmayan on iki sözleşme** ("Açık ve dürüst" 5).

## Next actions — kullanıcının yapması gerekenler

1. **Brave + Tavily anahtar rotasyonu** (SEC-2026-08-26-001 hâlâ AÇIK).
2. **İlk yedeği alın**: `ColleX-Yedekle.cmd`. Yedek klasörü müvekkil verisi
   içerir — **şifreli bir diske** koyun (Windows'ta BitLocker, Mac'te FileVault).
   Yedeği aldıktan sonra `--verify` ile bir kez doğrulayın (S28‴ bozuk
   yedeğin yakalandığını gösteriyor). **Not:** arşiv dosyasının adı artık
   yedeklediği veritabanının adıdır (`collex_local.dump` — sizde ad
   değişmedi), ve `ColleX-Geri-Yukle.cmd` bu adı `yedek.json`'dan okuyor.
3. **Bulut AI istiyorsanız** `ANTHROPIC_API_KEY`'i sunucu penceresinin
   ortamına koyun (asla `.env`'e), `ai-live-smoke.mjs` koşup çıktısını
   `AI.md`'ye ekleyin. İstemiyorsanız hiçbir şey yapmayın.
4. **Kalan 25 süre kuralını madde metniyle doğrulayın** (`W14-L-LEGAL` §8.1
   madde listesini veriyor); test kaynaksız bir `dogrulandi`'yı reddeder.
5. **Bu yılın harç tutarlarını girin** (Harç ekranı → "Eksik tutarları girin"):
   17 kalem `amount: null` ile geliyor ve toplam onlarsız hesaplanmıyor.
6. **Bir UDF'yi UYAP Doküman Editörü'nde bir kez açın**; bir `.ics`'i
   Outlook/Google Takvim'de bir kez açın.
7. **"Karar ara" ekranında kendi alanınızdan beş arama yapın ve dönen
   künyelerin işinize yarayıp yaramadığına siz karar verin.** Uç artık
   çalışıyor ve gerçek künye döndürüyor (S34), ama **ilgililiği ölçen tek
   kişi sizsiniz**: sıralamayı kaynak sunucu yapıyor. "Tam ifade" kutusunu
   açık bırakın — kapattığınızda liste yüz binlerce karara açılıyor ve
   karar tarihine göre sıralanıyor.
8. pgvector'lı bir hedef (`SUPABASE-SETUP.md`); hukukçu etiketli gold set.

## Blockers

| Eksik | Neden dış bağımlılık | En küçük kullanıcı eylemi |
|---|---|---|
| Brave + Tavily rotasyonu | Sağlayıcı panelinde hesap sahibi işlemi | Eski anahtarı iptal et, yenisini ortam/secret manager'a koy |
| pgvector hedefi | Windows SDK / Docker yok | pgvector'lı Postgres sağla |
| Canlı Supabase projesi | Kullanıcı yasağı (MCP kullanılmaz) | Proje aç → `SUPABASE-SETUP.md` |
| Bulut AI canlı sınama | Anahtar kullanıcıda | Ortama koy → `ai-live-smoke.mjs` |
| Süre kuralı doğrulaması (25) | Hukukçu işi, madde metni | Maddeleri aç, `verified`'ı çevir |
| Harç tutarları (17 kalem) | Yıllık Resmî Gazete metni | Harç ekranından bu yılın rakamlarını gir |
| UDF UYAP doğrulaması | UYAP editörü bu makinede yok | Bir `.udf` aç, sonucu kaydet |
| `.ics` takvim doğrulaması | Takvim istemcisi denemesi | Bir `.ics` aç, sonucu kaydet |
| Canlı karar aramanın **isabeti** (B-16) | İlgililik hukukî bir yargıdır; ölçmek için bir hukukçunun etiketlemesi gerekir | Kendi alanınızdan beş arama yapın, dönen künyelerin işinize yarayıp yaramadığını kaydedin (erişim ve künye dönüşü artık ölçülü — S34) |
| Hukukçu gold set | İki bağımsız etiketleyici + adjudication | Etiketleme oturumu |
| Canlı upstream regression | Kota; sıralı | `live_regression_check.py`'ı tek başına koş |
| Production deploy | Yetki dışarıda | Karar + hedef ortam |

## Known risks

Tam kayıt: `RISKS.md`. Başlıcaları:

- Rotasyon bekleyen açık secret'lar (git history'de, public upstream'de).
- **41 süre kuralının 25'i doğrulanmadı** ve bir kaçırılan süre geri
  alınamaz — bu belge setinin en yüksek etkili riskidir.
- **20 harç kaleminin 17'sinde tutar yok**; yanlış harç reddedilen dosyadır.
- Dense şerit bu ortamda atıl — hibrit retrieval hiç ölçülmedi.
- Fixture ve probe korpusu metrikleri hukukî benchmark değildir.
- `0,25` lexical coverage, `0,4` soru-kapsam ve `0,85` entailment tabanları
  **sentetik korpusta** ölçüldü; hiçbiri gerçek hukuk metninde doğrulanmadı.
- **Ölçekte korpus sorusu saniyeler sürüyor ve korpusta hiç geçmeyen bir
  ifade 7,5 sn sonunda boş dönüyor** (S25‴). Faz M'den beri arayüzde
  **ilerleme kartı ve çalışan bir "Vazgeç" var** — bekleme görünür ve
  durdurulabilir, ama **kısalmadı**. Trigram fallback kapısı ölçülmüş bir
  **recall değişikliğidir** ve şeridin plan davranışı korpustan korpusa
  değişiyor (S26⁗).
- **`run_evals.py`'nin cevap katmanı artık koşudan koşuya oynamıyor**
  (N-7 KAPANDI, S41): N7 turunun altı koşusunda kesinleştirilebilir oran
  **%81,0**, yanlış çekimserlik **1** (`fx-amend-002`, altısında da), yanlış
  cevap **0**, ve `--repeats 4` bandının her satırı `stable: true`. **Bant
  kipi kalıyor ve tek koşu hâlâ ölçüm sayılmaz:** kararlılığı önünüzdeki ağaç
  üzerinde gösteren tek şey sıfır genişlikli bir banttır. Kalan tek ingest
  bağımlılığı `reasons` metnindeki `ev-<hex>` etiketleridir (§N-7).
- Tek worker zorunlu; konsol yalnız `127.0.0.1`. `localGuard` DNS rebinding ve
  CSRF deliklerini kapattı, ama **kimlik doğrulaması hâlâ yok**.
- Bedesten kullanım şartları belirsiz; `source-register.yaml` 17 kaynak
  `legal_review: blocked`.
- Cevap süre bütçesi (60 s) **aşamalar arasında** denetlenir; tek bir yavaş
  port çağrısını kesemez.
- `PgDraftStore.put` arka plan yazımları anahtar başına sıralanmıyor
  (Kalıcılık çekince 1).

## Last successful verification

**03.09.2026 03:20–04:10, bu makine, sıralı ve tek başına (N7).** Beş komut —
`tsc`, `vitest`, `run_evals --run-date 2026-09-02` **×6** (+ bir `--repeats 4`
koşusu), `pytest`, `db_local_check`, `demo.mjs` — **hepsi exit 0 ve düşen tek
bir test yok**: S1 temiz, S2 **106 dosya / 2 145 geçti / 6 atlandı**, S6 altı
koşuda da `RESULT: PASS` ve cevap katmanı altısında da **birebir aynı**
(S41), S3 **1 352 passed**, S5 **19/19 PASS**, S7 **6/6 senaryo PASS**. Altı
tekrar tek bir bulguyu denetlemek içindi: **N-7 kapandı**.

Ondan önce: **03.09.2026 02:38–03:05 (M-CLOSE).** On komut — `tsc`,
`vitest` **×3**, `pytest`, `smoke_check`, `http_e2e_check`,
`live_local_gateway_check`, `db_local_check`, `run_evals --run-date 2026-09-02`
**×6** (+ bir `--repeats 4` koşusu), `demo.mjs` — hepsi exit 0. O turun
tekrarları da iki bulguyu denetliyordu: `vitest` üç koşuda da birebir aynı ve
yeşil (**N-8 kapandı**), `run_evals`'in cevap katmanı altı koşuda **hâlâ
oynuyordu** (N-7 o gün açıktı). S4, S8 ve canlı olmayan geçit kontrolleri o
turun ölçümüdür; kalan satırlar M-SRV / M-UI (03.09 02:0x–02:3x), C-FINAL
(03.09 00:50–01:00), F-VERIFY (02.09 23:48) ve Faz F / Faz A-B raporlarında
ölçülmüştür; her satır kaynağını söyler.

**N7 turu hiçbir sunucu başlatmadı** (`demo.mjs` ve vitest'in `serve` süiti
süreç içi koşar ve kendi süreçlerini kapatır). Koşu sonunda `netstat`:
**8787, 8898 ve 8000'de dinleyici yok**; 8787/8898'e **hiç dokunulmadı**.
Kendi sondası olarak **yalnız `collex_n7_test`** yaratıldı ve **düşürüldü**;
`collex_demo` `demo.mjs` tarafından yeniden kuruldu; `collex_eval_test`,
`collex_mig_test` ve vitest süitlerinin veritabanlarını kendi betikleri
yönetti; **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi**.
Hiçbir dış ağ isteği yapılmadı, hiçbir git işlemi yapılmadı, `.env`
okunmadı, Supabase/Resend'e dokunulmadı, MCP yüzeyi (54) değişmedi, API
değişikliği yapılmadı. Değiştirdiği dosyalar: `control-plane/src/pipeline/answerPipeline.ts`
(bir sıralama anahtarı), `control-plane/tests/pipeline/rankDeterminism.test.ts`
(yeni), `scripts/run_evals.py` ve `evals/retrieval/gates.py` (yalnız artık
yanlış olan açıklama metinleri), `docs/**` ve `CLAUDE.md`.

**Dürüstlük notu.** Sayılar bu zaman damgasına aittir. Bir daha okunacaksa
komutlar yeniden koşulmalıdır; ölçülen retrieval/cevap metriklerinin kaynağı
her zaman `evals/reports/fixture_baseline_<tarih>.{json,md}` dosyasıdır — ve
o dosyanın **cevap katmanı** satırları tek bir koşuya aittir, bandı S6
yazar.

## 17.09.2026 — W21: okumak incelemek değildir — üç kapsam, eksiksiz aşamalar, yapay zekâ ilkesi, Mac mini üretim tasarımı

W20 "dosyanın bütün sayfaları okundu" cümlesini kanıtlanabilir yaptı. Ama
okumadan sonraki aşamalar ilk 25 iddiayı, iddia başına 8 adayı ve özete ilk 40
bulguyu alıyordu. W21 bu kesmeleri kaldırdı ve "inceleme tamamlandı" cümlesini
tek, türetilmiş bir sözleşmeye bağladı. Kararlar ADR-040..050'de.

Eklemeli bir migrasyon var (`20260913090000_analysis_stages.sql`); eski
dosyaların hiçbiri değişmedi. Araç yüzeyi aynı kaldı (54).

**(A) Üç kapsam (ADR-040).**
- KAYNAK (`processingCoverage`): sayfalar ve birimler okundu mu.
- ÇIKARIM (`extractionCoverage`): her birimin çıkarımı tamam mı.
- ANALİZ (`intelligenceCoverage`): her iddia ve savunma tartıldı mı; her
  çelişki ve özet grubu işlendi mi.

"İnceleme tamamlandı" yalnız `analysisCompleteness.complete` iken yazılır.
Konsol bu cümleyi kendisi kurmaz.

**(B) Kesme yok (ADR-041, ADR-044, ADR-045).**
- Çağrı başına sınırlar ayardır (`COLLEX_ANALYSIS_*`).
- Fazlası partilere bölünür; hiçbir öğe atılmaz.
- Aşamalar kalıcı, kiralı görevlerdir.
- Özet hiyerarşiktir.
- Çıkarımda kesilen yanıt bölünerek yeniden istenir ya da "kesildi" diye sayılır.

**(C) Aday bulma ve "destek yok" (ADR-042).**
- Sinyaller: atıf ve sayı eşleşmesi, Türkçe kök, yerel E5, kişi, tarih,
  taraf, yapı.
- "Destek bulunamadı" yalnız tam aramadan sonra söylenir. Tam arama şu
  koşulların hepsini ister: dosyanın tamamı okunmuş, çıkarım tamam, dosyadan
  çıkarılan bütün delil, olgu ve olaylarla karşılaştırılmış ve her
  karşılaştırma cevaplanmış. Aksi hâlde sonuç "adaylar arasında destek yok",
  "arama eksik" ya da "tartılmadı" olur.

**(D) Anlamsal çelişki şeridi (ADR-043).** Değer şeridinin yanında çalışır.
Kalitesi gerçek modelle ÖLÇÜLMEDİ.

**(E) İnceleme tablosu sürüm sabitleme (ADR-046).** Satır yalnız sabitlendiği
sürümden cevaplanır ya da reddedilir.

**(F) Yapay zekâ ilkesi (ADR-047).** `COLLEX_AI_POLICY` dört değerlidir;
yerelden buluta sessiz geçiş yoktur.

**(G) OCR durumu, geri yükleme, taşınabilirlik (ADR-048).**

**(H) Değerlendirme düzenekleri (ADR-049).**

**(I) Mac mini üretim tasarımı (ADR-050).** FİZİKSEL MAC'TE DOĞRULANMADI.

**(J) Konsol:**
- Dosya incelemesi sekmesinde KAYNAK / ÇIKARIM / ANALİZ katmanları.
- Ayarlar › Sistem durumu'nda ilke, yerel model ve OCR satırları.

### Ölçüldü (17.09.2026, W21 kapanışı)

| # | Ne | Sonuç | Başarısız |
|---|---|---|---|
| W21-1 | `npx tsc --noEmit` | temiz | 0 |
| W21-2 | `npx vitest run` | 190 dosya · 3623 geçti · 7 atlandı | 0 |
| W21-3 | `pytest tests evals/tests` | 1609 geçti · 1 atlandı (1530 `tests` + 79 `evals/tests`) | 0 |
| W21-4 | `db_local_check.py` | 19/19 PASS | 0 |
| W21-5 | `smoke_check.py` | 54 araç | 0 |
| W21-6 | OpenAPI | 82 yol · 99 işlem · 164 şema · 0 boşta başvuru | 0 |
| W21-7 | RLS ilkeleri | 32/32 | 0 |
| W21-8 | Yerel E5, 22 sentetik vaka | R@1 0,379 · R@3 0,864 · MRR 0,890 · nDCG@10 0,703 · yalnız-anlam R@1 0,136 / R@3 0,795 · çağrı p50 19,3 ms / p95 36,4 ms · açılış 2662 ms · bellek 477,4 → 484,2 MiB | 0 |
| W21-9 | Gerçek geri yükleme uçtan uca | 2591 ms, asılların tamamı yerinde doğrulandı | 0 |
| W21-10 | Yapay zekâ ilkesi (betikli uçlar) | eşzamanlılık 1'de en fazla 1 çağrı; `LOCAL_ONLY` altında 7 yolda bulut çağrısı 0 | 0 |
| W21-11 | Gerçek sunucu (`collex_w21_verify`, port 8979) | 19/19 migrasyon, 32/32 RLS ilkesi, 54 araç, platform win32, OCR `OCR_EXECUTABLE_MISSING`, yerel model yok, anlamsal arama ACTIVE (3 vektör) | 0 |
| W21-12 | Konsol, gerçek sunucuda (1280/1024/820/640/390 px × açık/koyu) | on ölçümün onunda sayfa yatay kaymıyor (`scrollWidth` = gövde genişliği); 390 px'te yalnız rozet şeridi kendi içinde kayıyor — tasarım böyle; tarayıcı konsolunda hata yok | — |
| W21-13 | Çekişmeli denetim | 7 boyut, bulgu başına 3 şüpheci: 46 aday, 45 doğrulandı, 1 çürütüldü; 45'i de kapatıldı ve şeritlerin bıraktığı artıklar bu oturumda elle kapatıldı. Kapanışta ÜÇÜNCÜ bir çekişmeli tur KOŞULMADI (kullanıcı isteği) | — |

### Gerçek ve sahte — hangi çağrı neydi

| Bileşen | Durum |
|---|---|
| PostgreSQL, işçi süreçleri, HTTP sunucusu, yerel E5 | Gerçek |
| Dil modeli (çıkarım, tartma, sınıflama, özet) | **Betikli test çiftleri** — hiçbir gerçek model çağrılmadı |
| OCR | Bu makinede yok (`OCR_EXECUTABLE_MISSING`) |
| Mac mini | Hiç çalıştırılmadı |

### W21'in AÇIK bıraktıkları — kapatılmış gibi yazma

- **Gerçek dil modeli çağrılmadı** (REAL_MODEL_MEASUREMENT_PENDING).
  Anlamsal çelişki, iddia-delil ve özet kalitesi ölçülmedi.
- **Mac mini fiziksel olarak doğrulanmadı.** 8 GB bütçesi tahmindir.
- **Yerel OCR bu makinede yok.** Taranmış sayfa hâlâ "okunamadı" sayılır.
- **Avukat etiketli altın vaka yok.** Bütün değerlendirmeler sentetik.
- **W21 migrasyonu `collex_local`'a uygulanmadı.** `ColleX-Baslat.cmd` sonraki
  açılışta `--ensure-db` ile ekler.
- ~~Üst çubukta sayfa düzeyinde yatay taşma.~~ **17.09.2026'da kapatıldı.**
  Ölçüm: 1280 px'te üst çubuk 1064 px'lik içerik alanında 1255 px istiyordu
  (`scrollWidth` 1356 / gövde 1265; tema düğmesi ekran dışında), 820 px'te 89 px.
  Sebep: kabuk `.wrap` en çok 1120 px olduğu hâlde üst çubuğun TEK satırlık
  şablonu iki yerde (biri kompakt kabuğun koşulsuz kuralı, kendisinden önceki
  dar ekran kırılmalarını da eziyordu) dayatılıyordu. Üst çubuk artık her
  genişlikte iki satır; kompakt kabuk kendi şablonunu taşımıyor.
- **Üçüncü bir çekişmeli denetim turu koşulmadı.** İkinci turun 45 bulgusu
  kapatıldı, ama kapanış değişiklikleri (üst çubuk yerleşimi, taşıma
  cümlesi, OCR kopya kuralı, kur/tutar ayrımı) düşman gözüyle yeniden
  taranmadı; kapıların tamamı yeşil ve her değişikliğin kendi testi var.

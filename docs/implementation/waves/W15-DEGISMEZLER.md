# W15 — anlaşılırlık dalgası: değişmezler ve ortak sözlük

Bu dosya, W15 dalgasında `console.html` ve kullanıcıya görünen metinleri
değiştiren **her** şeridin uymak zorunda olduğu kuralları taşır. Tasarımın
kendisi [W15-TASARIM.md](W15-TASARIM.md), denetim bulguları
[W15-BULGULAR/](W15-BULGULAR/README.md) altındadır.

Dalganın tek cümlelik amacı: **normal bir avukat ekrandaki hiçbir sözcüğü
sormak zorunda kalmasın.**

---

## 1. Dosya değişmezleri (`control-plane/public/console.html`)

Bunlar CSP ve güvenlik değişmezleridir; hiçbir gerekçeyle esnetilmez.

1. Dosya **yalnız LF** satır sonu içerir. Tek bir CR bile sayfayı bozar.
2. **Tam olarak bir** `<style>` ve **tam olarak bir** `<script>` bloğu vardır.
3. `innerHTML`, `insertAdjacentHTML`, `DOMParser`, `eval` ve belgeye doğrudan
   biçimlenmiş metin basan eski API'ler **yasaktır**. DOM yalnız
   `createElement` + `textContent` + `appendChild` ile kurulur.
4. Satır içi olay işleyici (`onclick="…"`) ve satır içi `style="…"` niteliği
   **yasaktır**. Olaylar `addEventListener`, biçim `class` ile verilir.
5. Dış kaynak (yazı tipi, görsel, CDN, betik) **yasaktır**. `https?://` yalnız
   `127.0.0.1` için geçebilir.
6. CSP özetleri elle güncellenmez: `src/api/consolePage.ts` içindeki
   `buildConsoleCsp`, blokları yükleme anında karma alır.

**Her düzenlemeden sonra çalıştır:**

```bash
node "C:/Users/anile/AppData/Local/Temp/claude/C--Users-anile-Desktop-yarg--an-l/943291bf-cbea-4418-8d95-02d6d54c38c9/scratchpad/opus2/check_console.mjs"
```

```bash
npx vitest run tests/pipeline/console.test.ts
```

`serve.mjs` sayfayı bellekte tuttuğu için, tarayıcıda bakacaksan sunucuyu
yeniden başlat.

---

## 2. Dürüstlük sözleşmesi (bozulamaz)

Anlaşılır yazmak, **daha az doğru** yazmak değildir. Aşağıdakiler dalganın
sonunda da geçerli olacaktır:

- Ürün **doğruluk yüzdesi iddia etmez**, "garanti", "hatasız", "%100" demez.
- Ürün **mutlak kip kurmaz**. "Dayanağı olmayan cümleyi hiç kurmaz" **yanlıştır**:
  taslakta kurar ve **KAYNAKSIZ** diye işaretler. Doğru kalıp:
  *"bulamazsa cevap vermez; bulamadığı yeri işaretler; son kontrol sizindir."*
- Kütüphane sentetik ya da boşken hiçbir yerde **"hazır"** sözcüğü geçmez.
- Teknik doğrulama bilgisi **silinmez**, bir katman aşağı iner ve
  yanında her zaman tek cümlelik karşılığı durur.
- Ölçülmemiş bir şey için **"0" yazılmaz**, "ölçülmedi" yazılır.
- Uyarı bütçesi korunur: bir cevapta en çok 4 uyarı bloğu / 8 uyarı cümlesi.
  **Açıklama ve tanım cümleleri uyarı değildir** ve bütçeye girmez; bunun için
  ayrı sınıf kullanılır (`.expl-def`), `noticeLine()`'dan geçirilmez.

---

## 3. Kanonik sözlük

Ekranda **sol sütun asla** görünmez; **sağ sütun** görünür. Teknik ad
silinmez, "Teknik adı: …" biçiminde katlanmış katmanda kalır.

| Görünmeyecek | Görünecek |
|---|---|
| korpus, yerel korpus | **hukuk kütüphanesi** (bu bilgisayardaki mevzuat ve karar metinleri) |
| DENEME KORPUSU, sentetik | **deneme belgeleri** — "bu kurulumda gerçek mevzuat yok" |
| chunk, parça | **pasaj** (bir belgenin, alıntının alındığı bölümü) |
| SHA-256, hash, özet değeri | **parmak izi** (Teknik adı: SHA-256) |
| Unicode konumu, offset | **metindeki yeri** (Teknik adı: Unicode karakter sayımı) |
| ABSTAIN, ÇEKİMSER (tek başına) | **dayanak bulunamadı** — damga "DAYANAK BULUNAMADI (ÇEKİMSER)" |
| karşıt otorite | **aleyhe kaynak** |
| kanıt paketi, JSON dosyası | **denetim dosyası** (Teknik adı: JSON) |
| veritabanı (rozet/başlık) | **kendi kayıtlarım** |
| migrasyon 13/13 | **veri yapısı güncel** |
| Bulut AI | **bulut yapay zekâ** |
| MCP, geçit, gateway, uç, endpoint, istek | **resmî kaynak bağlantısı** / **işlem** |
| sunucu (avukata hitapta) | **program** |
| özyinelemeli | **alt klasörler de** |
| CSV | **tablo dosyası (Excel'de açılır)** |
| .ics | **takvim dosyası (Outlook / Google Takvim)** |
| ColleX-Baslat.cmd ile başlatın | **ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın** |
| POST /v1/answer, /v1/… | (ekrandan tümüyle kalkar) |

Değişmeyenler: istek/yanıt alan adları, `STATUS_TR` anahtarları
(`COMPLETE/QUALIFIED/PARTIAL/ABSTAIN`), çapa kimlikleri (`#kaynak-n`,
`#parca-<id>`), `manifest.ts` içindeki `yerel-korpus` **kimliği**. Yalnız
**görünen etiket** değişir.

---

## 4. Açıklama katmanının kuralı — "tek kapı"

1. Hiçbir açıklama **kendiliğinden açılmaz**. Kapatıldığı yerde kapalı kalır.
2. Geri dönüş **tek** yerden olur: üst çubuktaki `?` düğmesi.
3. `TERM_TR` **tek kaynaktır**: satır içi `?` kartı da, Sözlük ekranı da aynı
   nesneden çizilir. Hiçbir tanım ikinci kez elle yazılmaz.
4. Satır içi `?` kartı **yüzen katman değildir**; aynı kartın içinde, o satırın
   altında açılır (satır içi `style` yasağı yüzünden konumlandırılmış balon dar
   ekranda ve `overflow:auto` kaplarda taşar).
5. Açılıp kapanma `preserveFocusPosition(fn, düğme)` sarmalayıcısından geçer;
   yoksa açılan kutu, basılan düğmeyi ekrandan kaydırır.
6. Uyarı taşıyan **her** etiket `?` alır. "Bir ekranda en çok üç `?`" gibi bir
   kota konmaz.

---

## 5. Şerit sahipliği

`console.html` ve `tests/pipeline/console.test.ts` üzerinde **aynı anda tek
şerit** çalışır; şeritler sırayla koşar. Kendi şeridinin dışındaki bölgeye
dokunma. Sunucu tarafı (`src/**`), dışa aktarma (`export/**`) ve belgeler
(`docs/**`) ayrı şeritlerdedir ve paralel koşar.

Bir şerit kendi değişikliğinin kırdığı test sabitini **kendi adımında**
günceller; sonraki şeride bırakmaz.

# W13 — LANE DESIGN

Görsel tasarım ve tasarım-sistemi denetimi. Tarih: **02.09.2026**.
Kaynak: `control-plane/public/console.html` (satır 8–1654 `<style>`, satır
1656–1968 gövde işaretlemesi, satır 1970–8631 render fonksiyonları) ve diskteki
ekran görüntüsü arşivleri (`scratchpad/ui1/`, `ui2/`, `r1-root-0826/`,
`final-walk/`, `FIX-2/`).

Bu bir **denetim raporudur**; hiçbir depo dosyası değiştirilmedi (bu rapor
hariç), hiçbir sunucu başlatılmadı, tarayıcı kullanılmadı.

**Kanıt etiketleri:** `[kod]` = `console.html`'de okunan satır (satır no
verilir) · `[ekran]` = ekran görüntüsü arşivinden görülen (dosya adı verilir) ·
`[hesap]` = bu raporda hesaplanan sayı (betik:
`scratchpad/w13-DESIGN/contrast.py`, `.venv/Scripts/python.exe` ile
çalıştırıldı) · `[çıkarım]` = yorum.

---

## 0. Uygulayıcı için üç sert kısıt (önce bunu okuyun)

Bu üçü tasarım kararlarının çoğunu belirler ve ihlal edilirse sayfa çalışmaz:

1. **Servis edilen CSP `font-src 'none'` ve `img-src 'none'`'dur.**
   `control-plane/src/api/consolePage.ts:66-67` `[kod]`. Yani:
   **hiçbir webfont yüklenemez** (yerel dosya, `data:` URI, Google Fonts —
   hepsi bloke), **hiçbir görsel/PNG/SVG-dosyası/`background-image: url(...)`
   kullanılamaz**. Satır içi `<svg>` elemanı serbesttir (img-src kapsamında
   değildir). ⇒ Tipografi **yalnız sistem yazı tipi yığınıyla** yapılır; doku
   ve arka plan efektleri yalnız CSS gradyanıyla yapılır.
2. **CSP karması dosyadan otomatik üretilir** (`consolePage.ts:59-74`) `[kod]`
   — CSS'i değiştirmek karma güncellemesi gerektirmez. Ama `console.html`
   **LF-only, tam olarak bir `<style>` ve bir `<script>`** olmalıdır
   (CLAUDE.md invaryantı; `control-plane/tests/pipeline/console.test.ts`).
   Yeni bir `<style>` bloğu **eklemeyin**; mevcut bloğun içinde çalışın.
3. **Metin yalnız `textContent` ile atanır.** Yeni bileşenlerin işaretlemesi
   `document.createElement` + sınıf atamasıyla kurulmalı; hiçbir öneri
   `innerHTML` gerektirmez.

---

## 1. Mevcut token envanteri

### 1.1 Renk tokenları (`:root`, satır 17–132) `[kod]`

Toplam **26 özel renk değişkeni** × 2 tema = 52 değer. Aşağıdaki tabloda
"Kullanım" sütunu stil sayfasında bulunan gerçek kullanımdır.

| Token | Açık | Koyu | Kullanım | Not |
|---|---|---|---|---|
| `--paper-deep` | `#ede7d8` | `#14110d` | `html` gradyan üst durağı | |
| `--paper` | `#f6f2e8` | `#191511` | sayfa zemini, `.toast` metni | |
| `--panel` | `#fcfaf4` | `#201b15` | kart/panel zemini | |
| `--panel-2` | `#f2ede0` | `#282219` | girdi dolgusu, ölçer rayı, `.mchip` | |
| `--ink` | `#2a2318` | `#ede5d3` | gövde metni | |
| `--ink-soft` | `#675e4c` | `#b6ab92` | ikincil metin | |
| `--ink-faint` | `#6e6552` | `#8a8069` | üst-veri, mono satırlar | koyuda AA'yı kaçırıyor |
| `--line` | `#e5ddcb` | `#352e20` | kart kenarı, bölücü | 1.29:1 — görünmez |
| `--line-strong` | `#cfc4aa` | `#4d4429` | noktalı bölücüler | 1.66:1 |
| `--seal` | `#7d2a33` | `#cd7a83` | marka bordo / bağlantı | koyuda pembeye kaçıyor |
| `--seal-deep` | `#611f26` | `#a95560` | **stil sayfasında hiç kullanılmıyor** | ölü token |
| `--seal-ink` | `#faf6ec` | `#1c0e10` | `.viewtab.active` metni, `::selection` | **koyuda P0 hata** (§2.2) |
| `--band` | `#7d2a33` | `#8d2f39` | `body` üst şeridi | tek kullanım |
| `--btn` | `#82323b` | `#91333d` | dolu buton gradyan üstü | `--seal` ile neredeyse aynı |
| `--btn-deep` | `#64222a` | `#641f27` | gradyan altı + gölge rengi | |
| `--btn-ink` | `#faf6ec` | `#f4e9da` | dolu buton metni | |
| `--bronze` | `#a08a55` | `#bda468` | çizgi/ikon bronzu | açıkta metin olarak 3.21:1 |
| `--bronze-soft` | `#cdbd92` | `#7d6c44` | **hiç kullanılmıyor** | ölü token |
| `--bronze-text` | `#7d6a3b` | `#bda468` | etiketler | `--bronze`'un ikinci sürümü |
| `--ok` | `#34694a` | `#74c496` | olumlu | |
| `--warn` | `#90691a` | `#dcb054` | uyarı | açıkta 3 yerde AA altı |
| `--bad` | `#a03830` | `#e38074` | hata/kritik | |
| `--abstain` | `#5d5776` | `#aca3d3` | çekimserlik | |
| `--quote-bg` | `#f7f3e7` | `#1b1712` | alıntı zemini | `--panel-2`'den 1.02:1 farklı |
| `--shadow` | 3 katman | 3 katman | kart | |
| `--shadow-lift` | 3 katman | 3 katman | hover/modal | |
| `--ring` | `seal 18%` | `seal 26%` | odak halkası | 1.36:1 — görünmez |

**Bulgular**

- **2 ölü token**: `--seal-deep`, `--bronze-soft` hiçbir kuralda geçmiyor
  `[kod]` (grep ile doğrulandı).
- **Neredeyse-kopya çiftleri**: `--seal #7d2a33` ↔ `--band #7d2a33`
  (birebir aynı) ve `--btn #82323b` (ΔE ≈ 2, gözle ayırt edilemez) → üç token
  aynı bordoyu üç ayrı isimle taşıyor.
- `--bronze` / `--bronze-text` ayrımı bir "metin için koyulaştırılmış varyant"
  hilesidir (satır 44 yorumu bunu itiraf ediyor) ama `.pre .glyph`,
  `.dropzone .mark`, `.stage .sfill` hâlâ metin/anlam taşıyıcı yerlerde
  `--bronze` kullanıyor.
- `--quote-bg` ile `--panel-2` arasında ölçülebilir fark yok (açıkta
  `#f7f3e7` vs `#f2ede0`); iki farklı token'ın var oluşu bir yüzey
  hiyerarşisi vaat ediyor ama gözle görünmüyor.
- **Sabit kodlanmış (token dışı) renkler**: `rgba(255,255,255,.16)` (5 yerde,
  buton iç parlaması — koyu temada cam-jel görünümü üretiyor),
  `rgba(42,35,24,.03)` (2 yerde, koyu temada görünmez),
  `#fff` (3 yerde: `.toast.ok`, `.toast.bad`, `.days.late` — **koyu temada
  AA'yı kırıyor**, §2.2), `#7d2a33` ve `#000`/`#fff` yazdırma bloğunda `[kod]`.

### 1.2 Tipografi tokenları

| Token | Değer |
|---|---|
| `--serif` | `Constantia, "Iowan Old Style", "Palatino Linotype", Palatino, Cambria, Georgia, "Times New Roman", serif` |
| `--mono` | `"Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace` |

Gövde: `font: 15.5px/1.68 var(--serif)` (satır 147) `[kod]`.

**Kullanımdaki punto değerleri — 29 ayrı değer** `[hesap]`:

```
10 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 · 13.5 · 14 · 14.5 · 15 · 15.5 · 16
16.5 · 17 · 18 · 19 · 21 · 22 · 23 · 26 · 27 · 28 · 30 · 32 · 34 · 40 · 42 · 62
```

En sık üç değer: `14px` (45 bildirim), `13px` (29), `12.5px` (27). Yani ölçek
değil, bir **0.5px çözünürlüklü sürekli spektrum**: `13 / 13.5 / 14 / 14.5 /
15 / 15.5` altı komşu değer, hiçbiri birbirinden algısal olarak ayrılmıyor.
`16.5`, `27`, `23`, `21`, `19` tek kullanımlık tek-seferlik değerler.

**Satır yüksekliği** değerleri: `1` (buton `font:` kısayollarında), `1.2`,
`1.3`, `1.35`, `1.4`, `1.45`, `1.5`, `1.55`, `1.6`, `1.68` (gövde), `1.7`,
`1.72`, `1.75`, `1.8`, `1.15` — 15 ayrı değer, token yok.

**Harf aralığı (letter-spacing)** değerleri: `0`, `.01em`, `.02em`, `.04em`,
`.05em`, `.06em`, `.07em`, `.08em`, `.09em`, `.1em`, `.12em`, `.14em`,
`.16em`, `.18em`, `.2em`, `.22em`, `.3em`, `.34em` — **18 ayrı değer**.

### 1.3 Boşluk

`padding`/`margin`/`gap` içinde **34 ayrı px değeri** `[hesap]`:

```
1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 20 22 24 26 28 30 32 34 36 38 40
48 50 54 58 60 64 72 88 120
```

4'ün katı olmayanlar: `1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 22, 26,
30, 34, 38, 50, 54, 58` — yani değerlerin **%60'ı** hiçbir tabana oturmuyor.
Boşluk için **hiçbir token tanımlı değil**.

### 1.4 Yarıçap · gölge · geçiş · kırılım

- **Yarıçap**: `--r-sm: 10px`, `--r: 16px`, `--r-lg: 22px`, artı token dışı
  `999px` (hap), `50%` (daire), `6px` (`kbd.hint`), `3px` (`mark`).
  ⇒ 3 token + 4 kaçak değer.
- **Gölge**: 2 token (`--shadow`, `--shadow-lift`), her biri 3 katman; artı
  **10 satır içi token dışı `box-shadow`** `[hesap]` (buton gradyan gölgeleri
  `-8px`/`-10px` yayılmayla 4 ayrı varyantta, `inset 3px 0 0` şerit 2 varyantta).
- **Geçiş**: bir easing token'ı `--ease: cubic-bezier(.22,.61,.36,1)`; süreler
  `.2s` (8), `.25s` (48), `.3s` (8), `.35s` (1), `.45s` (1), `.7s` (1) —
  6 süre, süre token'ı yok `[hesap]`.
- **Keyframe**: `sweep`, `grow`, `mgspin`, `viewIn`, `medalIn`, `rise` (6).
- **Kırılım noktaları**: `1100px`, `900px` (×2), `800px`, `640px` (×3),
  `480px` — **5 kırılım**, hiçbiri paylaşılan bir ölçekten türemiyor;
  `.docgrid` 900'de, `.edgrid` 1100 ve 800'de kırılıyor, `.rrow` 640'ta,
  editör araç çubuğu 480'de. Aynı sayfada üç ayrı "dar ekran" tanımı var.
- **Kap genişliği**: `.wrap` 920px → `body.compact .wrap` 1120px →
  `body.editing .wrap` 1380px. Üç farklı ölçü, birbirinden türemiyor.

---

## 2. Kontrast denetimi (WCAG 2.1)

Betik: `scratchpad/w13-DESIGN/contrast.py`. `color-mix(in srgb, X n%,
transparent)` üst üste bindirmeleri, ebeveyn zemine göre premultiply edilerek
çözüldü. 61 çift, iki tema. Eşik: gövde metni **4.5:1**, ≥24px veya ≥19px-bold
metin ve arayüz sınırları **3:1**.

### 2.1 AÇIK TEMA — 14 başarısız `[hesap]`

| Oran | Eşik | Çift | Nerede |
|---|---|---|---|
| **3.21** | 4.5 | `--bronze #a08a55` / `--panel` | `button.pre .glyph` (13px, satır 428) |
| **4.30** | 4.5 | `--warn` / `warn@8%+panel` | `.chip.warn` (14px, satır 509–513) |
| **4.30** | 4.5 | `--warn` / `warn@8%+panel` | `.notyet .k` (14px, satır 399) |
| **4.15** | 4.5 | `--warn` / `warn@11%+panel` | `.strip.yellow b` (satır 1194) |
| **1.36** | 3.0 | `--ring` (`seal 18%`) / `--panel` | **odak halkası — tüm sayfa** (satır 58) |
| **1.29** | 3.0 | `--line` / `--panel` | kart kenarı, `.subtabs` alt çizgisi |
| **1.21** | 3.0 | `--line` / `--paper` | |
| **1.66** | 3.0 | `--line-strong` / `--panel` | noktalı bölücüler |
| **1.12** | 3.0 | `--panel-2` / `--panel` | **girdi alanı sınırı** (`textarea#q`, `.tin`, `input#asof` hepsi `border: 1px solid transparent`) |
| **1.12** | 3.0 | `.meters .track` / `--panel` | ölçer rayı |
| **1.29** | 3.0 | `.subtab` pasif alt kenar | sekme durumu yalnız renkle |
| **1.74** | 3.0 | monogram `mg-outer` (`bronze 55%`) / `--paper` | logo halkası |
| **2.30** | 3.0 | monogram `mg-inner` (`seal 45%`) / `--paper` | logo halkası |
| **2.14** | 3.0 | modal perdesi (`ink 36%`) / `--paper` | `.docmodal` (satır 1078) |

### 2.2 KOYU TEMA — 16 başarısız `[hesap]`

| Oran | Eşik | Çift | Nerede | Ciddiyet |
|---|---|---|---|---|
| **2.45** | 4.5 | `--seal-ink #1c0e10` / `--btn #91333d` | **`.viewtab.active` — aktif gezinme sekmesi metni** (satır 228). Gradyanın altında (`--btn-deep #641f27`) daha da kötüleşiyor (≈1.85:1). | **P0** |
| **2.08** | 4.5 | `#fff` / `--ok #74c496` | `.toast.ok` — "Ayarlar kaydedildi." `[ekran ui1/07-ayarlar-dark-1440.png]` | **P0** |
| **2.76** | 4.5 | `#fff` / `--bad #e38074` | `.toast.bad` — hata bildirimi | **P0** |
| **2.76** | 4.5 | `#fff` / `--bad` | `.days.late` — "süre geçti" rozeti | **P0** |
| **4.37** | 4.5 | `--ink-faint` / `--panel` | tüm mono üst-veri (11–12.5px): hash satırları, `.chunkline`, `.ledger`, `.itemrow .when` | P1 |
| **4.03** | 4.5 | `--ink-faint` / `--panel-2` | `.mchip` (11px) | P1 |
| **3.99** | 4.5 | `.chip.mute` | "yükleniyor…" sayaç rozeti | P1 |
| 1.27–1.77 | 3.0 | `--line`, `--line-strong` / yüzeyler | kenarlar (açıkla aynı sorun) | P1 |
| **1.08** | 3.0 | `--panel-2` / `--panel` | **girdi sınırı** — koyu temada form alanları gözle bulunamıyor `[ekran ui1/07-ayarlar-dark-1440.png]` | P1 |
| **1.51** | 3.0 | `--ring` / `--panel` | odak halkası | **P0** |
| 2.14 | 3.0 | monogram iç halka | | P2 |
| 2.91 | 3.0 | modal perdesi | | P2 |

**En kritik iki tanesi kod okunarak kesinleşti, ekran görüntüsüyle değil:**
`.viewtab.active { color: var(--seal-ink) }` (satır 228) + koyu temada
`--seal-ink: #1c0e10` (satır 74 ve 110) `[kod]`. Bu, koyu temada **birincil
gezinmenin aktif sekmesinin siyaha yakın metinle bordo dolgu üzerinde**
yazılması demektir. Aynı token `::selection`'da da kullanılıyor (satır 151);
orada koyu metin açık pembe seçim üzerinde olduğu için doğrudur — yani token
tek bir isim altında iki karşıt işi yapıyor. Çözüm token'ı ikiye ayırmaktır
(`--on-seal-fill` her zaman açık; `--on-seal-tint` her zaman koyu).

### 2.3 Renk tek başına anlam taşıyan yerler (WCAG 1.4.1)

- `.edoutline .dot.green/.red/.amber` — 9px nokta. Yanında bir açıklama
  listesi var (`.olegend`, satır 1553) ama listenin kendisi de renk adıyla
  yazılmış: "● yeşil: KAYNAKSIZ yok · ● kırmızı: KAYNAKSIZ var"
  `[ekran ui2/05-editor-1440.png]` — renk körü kullanıcı için hiçbir şey
  eklemiyor. Şekil/ikon farkı yok.
- `button.pill .dot` (8px) — Veritabanı/Canlı araştırma/Bulut AI durumu.
  Metin "bağlı"/"kapalı" yazdığı için bu tamam.
- `.days.orange/.red/.late/.done` — sayı metni var, tamam.
- `.subtab.active` — yalnız `--seal` rengi + 2px alt kenar; kenar `--seal`
  olduğu için 3:1'i geçer, tamam.

---

## 3. Tipografi denetimi

### 3.1 Serif yığını Windows'ta ne yapıyor

`Constantia` Windows 10'da kurulu bir sistem yazı tipidir; yığının ilk sırası
odur, dolayısıyla hedef makinede **fiilen tek gerçek yazı tipi Constantia**dır
`[çıkarım]`. Ekran görüntüleri bunu doğruluyor (Constantia'nın karakteristik
"a"/"g" biçimleri ve orta-yüksek x-yüksekliği görünüyor).

**P0 tipografi hatası — eski usul rakamlar.** Constantia varsayılan olarak
**old-style (metin) rakamları** kullanır: `3 4 5 7 9` taban çizgisinin altına
iner, `0 1 2` x-yüksekliğindedir. Ekran görüntüsünde birebir görülüyor:
`[ekran ui1/16-ayarlar-status-390.png]` — "**54 araç**"ta 5, "**13 şablon**"da
3, "**30 kural**"da 3 taban altına düşüyor.

Bunun hukuk uygulamasında bedeli:

- Esas numarası `2026/123`, madde `m. 157`, tebliğ tarihi `15.07.2026`,
  tazminat `45.000 TL` — hepsi **kimliktir**, sıralı metin değil. Eski usul
  rakam bunları paragraf akışına gömer, gözle taranamaz hale getirir.
- Tablolarda (`table.matters`, `table.grid`, `.deadpanel .deadrow`) rakamlar
  orantılıdır (tabular değil) — sütunlar hizasız `[ekran
  r1-root-0826/04-document-page.png]`.
- Stil sayfasında `font-variant-numeric` yalnız **4 yerde** ayarlanmış:
  `.claim .index`, `.para .pno` (`lining-nums`), `.meters .val`,
  `.stage .sms` (`tabular-nums`) `[kod]`. Diğer her yer varsayılana bırakılmış.

**Düzeltme (tek satır, geri dönüşü yok):**

```css
body { font-variant-numeric: lining-nums proportional-nums; }
/* Kimlik/sayı taşıyan her yüzey: */
table.matters td, table.matters th, table.grid td, table.grid th,
.deadrow .due, .duebig, .ledger, .meta dd, .kv dd, .itemrow .when,
.answermeta, .headrow, .verdict .word, .src .courtline, .evcard .meta dd,
.hashline, .chunkline, .rawcode, .timing, .budgethint {
  font-variant-numeric: lining-nums tabular-nums;
  font-feature-settings: "lnum" 1, "tnum" 1;   /* Constantia için yedek */
}
```

### 3.2 Türkçe aksan ve büyük harf

**İyi haber: `text-transform: uppercase` stil sayfasında hiç yok, JS'te
`toUpperCase()`/`toLocaleUpperCase()` hiç yok** `[hesap]` — grep ile doğrulandı.
Dolayısıyla klasik `i → I` (İ yerine) hatası bu sayfada **üretilemez**.
Ekrandaki büyük harfli metinler (`DESTEKLENİYOR`, `KAYNAKSIZ`, `DENEME
KORPUSU`, `TARAFLAR`) ya kaynakta elle doğru yazılmıştır ya da
`font-variant-caps` ile üretilmiştir — ikincisi **casing değil glif seçimidir**,
İ/ı ayrımını bozmaz. `[ekran ui2/05-editor-1440.png]`'de "HUKUKÎ SEBEPLER",
"İZMİR 3. SULH HUKUK MAHKEMESİ'NE" doğru görünüyor.

**Yine de iki risk var, uygulayıcı için kural olarak yazın:**

1. Gelecekte hiçbir CSS kuralına `text-transform: uppercase` **eklenmemelidir**.
   Türkçe'de tarayıcı `lang="tr"` ile doğru davranmayı dener ama Chromium'da
   `i → İ` dönüşümü yalnız `lang` doğru mirasla geldiğinde çalışır ve
   `İ`'nin küçük hali (`i̇`, birleşik nokta) geri dönüşte bozulur. Sayfada
   `<html lang="tr">` var (satır 2) `[kod]`, ama bu güvenceye dayanmayın.
2. `font-variant-caps: all-small-caps` **noktalı İ'yi küçük büyük harfe
   çevirirken üstteki noktayı korur**, fakat Constantia'nın small-caps
   setinde `Ğ ğ` ve `Ş ş` glifleri **sentetiktir** (gerçek small-cap gliﬁ
   yoktur) — bu yüzden "DEĞERLENDİRME" gibi kelimelerde Ğ diğer harflerden
   optik olarak farklı ağırlıkta çıkar. `[ekran ui1/14-arastir-verdict-390.png]`
   "NİHAİ HUKUKÎ DEĞERLENDİRME" satırında Ğ ve İ komşularından ince görünüyor.
   ⇒ **Türkçe metin için small-caps kullanmayın.** (Öneri §8.3'te.)

### 3.3 Small-caps + harf aralığı kötüye kullanımı

W12-UI2 dalgası doğru bir müdahale yaptı: satır 1467–1503 `[kod]` bir
"sıfırlama listesi" ile 40'a yakın seçicide `font-variant-caps: normal;
letter-spacing: 0` yapıyor ve small-caps'i **yalnız** `.viewtab`,
`.fieldlabel`, `.panelhead`, `h2.section`, `nav.toc`'a bırakıyor. UI-1
ekranlarıyla (ui1/06-dosyalarim-1440.png — her şey aralıklı büyük harf) UI-2
sonrası (ui2/01-compact-header-matter-1440.png) karşılaştırılınca kazanç net
`[ekran]`.

**Kalan sorunlar:**

- `.viewtab { letter-spacing: .2em; font-size: 15px }` (satır 1477) — 15px
  small-caps'in x-yüksekliği ≈ 8px, üstüne 3px harf arası. Ekranda "DOSYALARIM
  ARAŞTIR BELGELER TASLAK AYARLAR" birbirinden ayrışmıyor, bir şerit gibi
  okunuyor `[ekran ui2/00-welcome-hero-1440.png]`.
- `h2.section { letter-spacing: .16em; font-size: 17px }` — "§ 1 TESPİTLER"
  başlığı 17px small-caps: **gövde metninden (15.5px) küçük görünüyor**
  `[ekran final-walk/final-02-answer.png]`. Bölüm başlığı gövdeden küçük
  olmamalı.
- `.masthead .brand { letter-spacing: .34em; text-indent: .34em }` — 40px'de
  "C O L L E X". Marka adı 6 harfli; %34 aralık onu bir kelime olmaktan
  çıkarıyor `[ekran ui1/06-dosyalarim-1440.png]`.
- `.dueday`, `.olegend`, `.notyet .k`, `.strip.demo` gibi **uyarı** metinleri
  hâlâ dekoratif tipografiyle sunuluyor.

### 3.4 Monospace'in prozaya uygulanması — en çok tekrar eden hata

`--mono` (Consolas) **prose için** kullanılıyor:

| Seçici | Satır | İçerik | Punto |
|---|---|---|---|
| `ul.reasons` | 677 | süre kuralının **madde metni açıklamaları** — tam cümleler | 12.5px |
| `button.tpl .req` | 790 | "Zorunlu: Taraflar (ad ve rol: Davalı / Davacı), Olaylar (kronolojik; her satır bir olay)…" | 10.5px |
| `.stage .scounts` | 675 | aşama sayaçları | 10.5px |
| `.abstain-panel .counts` | 537 | çekimserlik sayıları | 12.5px |
| `.mchip` | 759 | madde rozetleri | 11px |
| `.evchip` | 848 | `K-1`, `Ek-2` kanıt rozetleri | 12.5px |
| `.statusline` | 727 | Türkçe durum cümleleri | 12px |
| `.itemrow .when`, `.deadrow .due` | 1297, 1234 | tarihler | 12.5–13px |
| `.chunkline`, `.hashline`, `.rawcode` | | UUID + hash + offset | 10.5–12px |

Ekran kanıtı: `[ekran ui2/03-taslak-templates-1440.png]` — her şablon kartının
altında 10.5px Consolas'ta 4 satırlık Türkçe cümle. `[ekran
ui1/05-deadline-modal-1440.png]` — HMK m.345 kuralının açıklaması, "İstinaf
yoluna başvuru süresi iki haftadır; süre, ilamın usulen taraflardan her birine
tebliğiyle işlemeye başlar (HMK m.345/1; 7251 sayılı Kanunla 28.07.2020
tarihinden itibaren)." tamamı monospace.

Monospace **yalnız üç şey için** meşrudur: hash/UUID (kopyalanacak, karakter
karakter karşılaştırılacak), makine kimlikleri (`collex_demo`,
`ANTHROPIC_API_KEY`), ve hizalanması gereken sayı sütunları. Türkçe hukuk
metni asla.

### 3.5 Satır uzunluğu (measure)

| Bağlam | Kap | Fiili ölçü | Değerlendirme |
|---|---|---|---|
| `.wrap` varsayılan | 920px − 52px dolgu = 868px | 15.5px serif ≈ **95–105 karakter** | uzun |
| `body.compact .wrap` | 1120px − 52px = 1068px | ≈ **115–125 karakter** | **çok uzun** |
| `body.editing .wrap` | 1380px, orta sütun `minmax(0,1fr)` ≈ 760px | ≈ 85 karakter | kabul edilebilir |
| `blockquote.quote` | kart içi ≈ 760px | ≈ 85 karakter | sınırda |
| `button.tpl p` | 240px sütun | ≈ **32 karakter** | **çok kısa** |
| `.docgrid` sağ sütun | ≈ 500px | ≈ 58 karakter | iyi |

Optimum 60–75 karakterdir. `body.compact` — yani **günlük kullanımdaki
varsayılan durum** — bunun neredeyse iki katı. `[ekran
final-walk/final-02-answer.png]`'de "Soru kapsamı: %100 — soru sözcüklerinin
kaynaklarda karşılığı · atıf yapılan hüküm doğrudan alındı; öteki pasajlar tek
tek soru sözcükleriyle sınandı" tek satırda 1000px boyunca uzanıyor.

---

## 4. Yerleşim denetimi

### 4.1 Izgara ve ritim

Sayfada **paylaşılan bir ızgara yok**. Her bileşen kendi
`grid-template-columns`'ını sabit px ile tanımlıyor `[kod]`:

```
.verdict       auto 1fr auto
.meters        168px 1fr 46px
.meta          158px 1fr
.stage         150px 1fr 76px
.kv            200px 1fr
.rrow          1fr 1fr auto        .rrow.olay 150px 1fr auto   .rrow.talep 1fr auto
.rrow.taraf    1.3fr 1fr 1fr auto  .rrow.vekil 1.4fr 1fr .8fr
.inlineform    170px 1fr auto
.deadrow       104px 1fr auto
.docgrid       minmax(0,1.05fr) minmax(0,1fr)
.edgrid        220px minmax(0,1fr) 340px
.evcard .meta  110px 1fr
.tplgrid       repeat(auto-fill, minmax(240px,1fr))
.formgrid      repeat(auto-fit, minmax(210px,1fr))
```

Etiket sütunu genişlikleri: **104, 110, 150, 158, 168, 170, 200, 220** — sekiz
farklı değer, aynı sayfada, çoğu birbirine 10px uzaklıkta. Bir kullanıcı
sayfayı aşağı kaydırırken sol kenar sekiz kez kayıyor.

### 4.2 Beş görünüm + belge sayfası + editör

**Dosyalarım** (`ui2/01-compact-header-matter-1440.png`, `ui1/06-…`)
- İçerikten önce **üç yığılmış banner**: `.stamp` (veri kaynağı) +
  `.strip.demo` + `.strip.yellow` (dosyasız çalışma). 390px'de bunlar
  **≈ 330px dikey alan** kaplıyor `[ekran FIX-2/fix2-02-390px-editor.png]`
  — yani ilk ekranın yarısı uyarıdır, içerik değil.
- Dosya sayfasında 6 aksiyon butonu (`Belge yükle · Bu dosyada araştır ·
  Taslak oluştur · Not ekle · Süre ekle · **Dosyayı sil**`) hepsi aynı
  `button.ghost`. **Yıkıcı eylem, "Not ekle" ile görsel olarak eşit.**
  `.ghost.danger` sınıfı var ama yalnız `:hover`'da renk değiştiriyor
  (satır 744) `[kod]` — durağan halde hiçbir uyarı yok.
- 1440px'de `body.compact .wrap` 1120px ⇒ her iki yanda 160px boş. Ne geniş
  ne dar; ekranın %78'i kullanılıyor ama tablo yine 14px'de sıkışık.

**Araştır** (`final-walk/final-02-answer.png`)
- Verdict kartı iyi kurgulanmış (madalya + kelime + açıklama + defter). Ama
  `.ledger` sağa yaslı, mono, `--ink-faint`: sayfadaki **en önemli sayaçlar**
  (`kaynak 4`, `tespit 4`, değerlendirme tarihi) en zayıf tipografiyle.
- `.stamp` + `.answermeta` + `nav.toc` + `h2.section` = cevaptan önce dört
  ayrı yatay şerit.
- Tespit kartındaki üçüncü rozet bir **tam cümle**: "Sorunun doğrudan
  dayanağı — madde numarasıyla birebir eşleşme", 700px genişliğinde bir hap.
  Rozet bileşeni cümle taşıyamaz.

**Belgeler / Belge sayfası** (`r1-root-0826/04-document-page.png`)
- **En ciddi yerleşim sorunu burada.** Sayfa 1440px genişlikte **4321px
  yüksekliğinde** `[ekran]`. Sol pane (`.docpane`, sticky) ≈ 570px'de bitiyor;
  sağ sütun 3700px daha akıyor ⇒ ekranın **sol yarısı 3700px boyunca boş**.
- Sağ sütun düz bir yığın: `BELGEYE SOR` → `TARAFLAR` (5) → `ATIFLAR` (**17
  satır**, her biri özdeş "Kopyala doğrula" butonuyla, `HMK m.127` ve
  `TCK m.157` iki kez tekrarlıyor) → `TARİHLER` (**11 satır**, her biri iki
  butonlu) → `TALEPLER` → `AI ANALİZİ` → `SORULAN SORULAR`. Katlama yok,
  sayaç yok, önceliklendirme yok.
- Her alıntının altında `Bölüm 1/14 · konum 0-49 (Unicode karakter sayısı) ·
  65a20bf3-13e8-4343-a8fa-692ff152d375` — bir **UUID**, avukatın ekranında,
  her blokta `[ekran]`. Bu mühendislik sızıntısıdır.

**Taslak — şablon seçimi** (`ui2/03-taslak-templates-1440.png`)
- `repeat(auto-fill, minmax(240px,1fr))` 1440px'de 4 sütun. Kartlarda satır
  kırpma yok ⇒ açıklamalar 8–12 satır, kart yükseklikleri eşitsiz, ikinci
  satırın ilk kartının rozeti komşularından 60px aşağıda `[ekran]`.
- 240px sütunda 13px metin = **32 karakter/satır**; hukuk cümlesi için
  okunamaz derecede dar.

**Taslak — editör** (`ui2/05-editor-1440.png`, `10-editor-dark-1440.png`)
- `220px | 1fr | 340px`. Sağ kanıt sütunu `position: sticky` +
  `overflow: auto` + içindeki `blockquote.quote { max-height: 180px;
  overflow: auto }` ⇒ **üç iç içe kaydırma çubuğu** ekran görüntüsünde
  aynı anda görünüyor `[ekran ui2/05-editor-1440.png]`.
- **Her paragrafın altında 6 buton**: `Alıntı ekle · KAYNAKSIZ olarak bırak ·
  Bu paragrafı yaz (Bulut AI) · Yukarı · Aşağı · Sil` — hepsi aynı ghost hap,
  iki satıra sarıyor. 40 paragraflık bir dilekçede bu **240 özdeş buton**
  demektir. Editörün gerçek gürültü kaynağı budur.
- Birincil eylem tersine dönmüş: `Kaydet` ghost, **`DOCX` dolu bordo**
  (`a.dl`). Sayfadaki tek dolu buton, kaydetmek değil dışa aktarmak.

### 4.3 Duyarlılık

- 480px altı için (`W12-FIX2`, satır 1622–1653) `[kod]` gerçekten çalışılmış:
  başlık ızgarası yeniden tanımlanmış, dışa aktarma 3 sütunlu ızgaraya inmiş.
  `[ekran FIX-2/fix2-02-390px-editor.png]` başlık (marka+seçici+çipler+
  sekmeler) ≈ 200px — hedefe uyuyor.
- **Ama** sekmeler ikinci satıra sarıp `AYARLAR`'ı ortada tek başına bırakıyor
  `[ekran]` — 5 sekme 2+3 değil 4+1 kırılıyor.
- Yatay taşma koruması: `.scroll`, `.scrollx` iki ayrı sınıf, aynı iş
  (`overflow-x: auto`) `[kod]` — biri `border-radius` da veriyor.
- `.docgrid` 900px'de tek sütuna iniyor ama `.docpane .doctext` `max-height:
  50vh` kalıyor ⇒ telefonda belge metni ekranın yarısında kendi kaydırmasıyla
  hapsoluyor.

### 4.4 Yazdırma

- İki ayrı `@media print` bloğu (satır 1425 ve 1603) `[kod]`; ikincisi
  `body.editing` için. Aynı kaygı iki yerde.
- **`@page` kuralı yok** ⇒ kenar boşluğu, sayfa numarası, üstbilgi kontrolü
  yok. Editör baskısında `body.editing .wrap { max-width: none; padding: 0 }`
  (satır 1607) metni kâğıdın kenarına dayıyor; yalnız yazıcının kendi
  boşluğuna güveniliyor.
- Birim karışıyor: `body.editing .edpara .ptext { font-size: 12pt }` ama
  `.dsec h3` 18px'de kalıyor `[kod]`.
- Varsayılan (editör dışı) baskıda `.wrap` 920px + 120px alt dolgu korunuyor
  ⇒ A4'te dar bir sütun ve her sayfanın altında boş bant.
- `.para` arası boşluk baskıda 10px marj + 14px dolgu ⇒ dilekçe paragrafları
  arasında ≈ 24px `[ekran ui2/11-editor-print-1440.png]` — matbu dilekçe
  ritmi değil.

---

## 5. Bileşen denetimi

### 5.1 Butonlar — **17 ayrı tıklanabilir görsel muamele** `[kod]`

| # | Seçici | Biçim | Punto | Dolgu | Yarıçap |
|---|---|---|---|---|---|
| 1 | `button.seal` | dolu bordo gradyan | 15px | `14 32 15` | `--r-sm` |
| 2 | `a.dl` | dolu bordo gradyan | 14px | `12 26 13` | `--r-sm` |
| 3 | `a.dl.alt` | bordo çerçeve | 14px | `12 26 13` | `--r-sm` |
| 4 | `button.ghost` | nötr hap | 14px | `8 16 9` | `999px` |
| 5 | `button.ghost.small` | nötr hap | 14px | `6 12 7` | `999px` |
| 6 | `button.ghost.primary` | bordo metinli hap | 14px | `8 16 9` | `999px` |
| 7 | `button.ghost.danger` | **yalnız hover'da kırmızı** | 14px | | |
| 8 | `button.pill` | noktalı durum hapı | 14px | `7 12 8` | `999px` |
| 9 | `button.pre` | altı gradyan-çizgili metin | 13px | `1 0 3` | — |
| 10 | `button.rowdel` | çerçeveli daire-hap | 13px | `8 13` | `999px` |
| 11 | `button.viewtab` | segment | 15px | `9 20 10` | `999px` |
| 12 | `button.subtab` | alt-çizgili sekme | 14.5px | `11 15 12` | 0 |
| 13 | `button.tpl` | kart-buton | miras | `20 22` | `--r` |
| 14 | `.themebtn` | hap | 14px | `8 16` | `999px` |
| 15 | `button.h` | çıplak kopyala | miras | 0 | — |
| 16 | `.edoutline .olink` | liste satırı | 14px | `7 8` | `--r-sm` |
| 17 | `label.rchip span` / `label.fchk span` | radyo/onay hapı | 14/12.5px | `9 20 10` / `6 14 7` | `999px` |

**İki birincil buton var** (`button.seal` ve `a.dl`) — aynı görsel ağırlıkta,
farklı punto ve dolguyla. `<button>` mi `<a>` mi olduğuna göre boy değişiyor;
bu bir sistem değil, bir kaza.

**Yıkıcı eylem varyantı fiilen yok**: `.ghost.danger` durağan halde
`.ghost` ile birebir aynı (satır 744) `[kod]`.

**Devre dışı hali dört ayrı opaklık**: `.seal[disabled]` `.6`,
`.ghost[disabled]` `.55`, `.rchip.disabled` `.55`, `.checkline.disabled` `.6`,
`.evcard.unused` `.85`. Opaklık tabanlı devre dışı bırakma metni AA'nın
altına düşürür (`--ink-soft` 6.13 × 0.55 ≈ **3.4:1**) `[hesap]`.

**Odak halkası** tek biçimlidir (satır 1514'te toplu kural — iyi) ama görünmez
(§2). Ayrıca `:focus-visible { border-radius: var(--r-sm) }` (satır 153) —
hap biçimli butonlarda kare köşeli bir halka çiziyor `[kod]`.

### 5.2 Rozet/çip — **10 ayrı bileşen, 3 ayrı ölçü sistemi**

| Seçici | Punto | Dolgu | Dolgu rengi | Kenar |
|---|---|---|---|---|
| `.chip` (+ok/warn/bad/abstain/mute) | 14px | `4 12 5` | `currentColor 8%` | `currentColor 32%` |
| `.fchip` | 12.5px | `5 10 5 14` | `seal 7%` | `seal 30%` |
| `.mchip` | 11px | `3 10` | `--panel-2` | `--line` |
| `.evchip` | 12.5px | `2 9` | `bronze 6%` | `bronze 55%` |
| `.autochip` | 12.5px | `1 9 2` | `warn 9%` | `warn 45%` |
| `.kaynaksiz` | 14px | `3 12 4` | `seal 8%` | `seal 35%` |
| `.days` (+4 varyant) | 14px | `3 11 4` | `currentColor 8%` | `currentColor 32%` |
| `.pill` | 14px | `7 12 8` | `--panel` | `--line` |
| `label.rchip span` | 14px | `9 20 10` | `--panel-2` | `--line` |
| `label.fchk span` | 12.5px | `6 14 7` | `--panel-2` | `--line` |

Beş farklı dikey dolgu (`1/2/3/4/5/6/7/9`), dört farklı punto, üç farklı
dolgu-rengi stratejisi. `[ekran ui2/05-editor-1440.png]`'de aynı satırda
`Dilekçe` (nötr), `KAYNAKSIZ: 0` (yeşil), `SENTETİK kanıt` (mor) yan yana —
üçü de farklı yükseklikte.

Ayrıca **büyük/küçük harf tutarsız**: `Dilekçe` (cümle), `KAYNAKSIZ: 0`
(büyük), `UDF deneysel` (karma), `aktif dosya` (küçük)
`[ekran ui2/01-compact-header-matter-1440.png]`.

### 5.3 Kartlar

Tek bir `.card` var (satır 491) ve **her şey karttır**: uyarı paneli, tablo
sarmalayıcı, boş durum, kanıt kartı, kenar sütunu, sistem durumu. Sonuç:
**sıfır hiyerarşi** — hepsi aynı `--shadow`, aynı `--r: 16px`, aynı
`--panel`. `[ekran final-walk/final-02-answer.png]` — verdict, meta, TOC,
tespit: dört ardışık özdeş beyaz dikdörtgen.

`.card:hover { transform: translateY(-2px) }` **her** kartta aktif; 20 kartlı
bir sayfada fare gezdikçe düzen titriyor. Kanıt kartında bu bilinçli olarak
kapatılmış (`.edside .card:hover { transform: none }`, satır 1581) — yani
sorun zaten fark edilmiş ama nokta atışı çözülmüş `[kod]`.

### 5.4 Tablolar

İki tablo bileşeni: `table.grid` (kenar-çerçeveli, 14px) ve `table.matters`
(alt-çizgili, 14px, tıklanabilir satır). Farklı dolgu (`8 12` / `11 12`),
farklı başlık rengi (`--ink-soft` / `--bronze-text`). Hiçbirinde
`tabular-nums`, sıralama göstergesi, sabit başlık veya zebra yok.

### 5.5 Formlar

`.tin` tek girdi sınıfı — iyi. Ama `border: 1px solid transparent` +
`background: var(--panel-2)` ⇒ **alan sınırı 1.12:1** (§2). Koyu temada
form neredeyse görünmez `[ekran ui1/07-ayarlar-dark-1440.png]`.
`select.tin { appearance: auto }` (satır 1208) ⇒ yerel ok; ama
`select.matterpick { appearance: none }` + `::after "▾"` (satır 1143) ⇒ özel
ok. Aynı sayfada iki farklı açılır menü dili.
`.fielderr` var ve `:empty` gizleniyor (satır 1033–1034) — iyi. Ama hata
durumunda alanın kendisi renk değiştirmiyor (`aria-invalid` stili yok).

### 5.6 Modallar

Tek bileşen `.docmodal`/`.docpanel` (satır 1071–1090). Perde
`ink 36%` = **2.14:1** ⇒ arkadaki sayfa tam okunur kalıyor
`[ekran ui1/05-deadline-modal-1440.png]`. Kapatma düğmesi CSS'te yok
(başlık satırında JS ile ekleniyor). `max-height: 88vh` + iç `overflow:auto`
⇒ modal içinde ikinci kaydırma çubuğu.

### 5.7 Toast

Tek bileşen (satır 1215–1225). `position: fixed; bottom: 26px`. Üç varyant
(nötr/ok/bad). `role="status" aria-live="polite"` var (satır 1968) — doğru.
Ama otomatik kapanma süresi CSS'te yok, iki toast üst üste binebilir (tek
`#toast` elemanı olduğu için ikinci birinciyi eziyor), ve **koyu temada iki
varyant da AA'yı kırıyor** (§2.2).

### 5.8 Sekmeler / ilerleme / boş durum / iskelet

- Sekme: `nav.views` (segment hap) + `.subtabs` (alt çizgi) — iki paradigma.
  `role="tablist"`/`role="tab"` var (satır 1697–1702) `[kod]`, `aria-selected`
  güncelleniyor; klavye ok tuşu gezinmesi ise yok.
- İlerleme: `.runbar .sweep` (belirsiz), `.meters .fill` (belirli),
  `.stage .sfill` (belirli), `.progresspanel ol` (adım listesi) — dört ayrı
  ilerleme dili, ortak token yok.
- Boş durum: `.placeholder` (büyük glif + small-caps satır) ve `.empty`
  (yalnız soluk metin) — iki desen, artı `.filepick .none` gibi tek seferlikler.
- **Yükleme iskeleti yok.** `skeleton` sınıfı yok, `aria-busy` hiç
  kullanılmıyor `[hesap]`. Yükleme yalnız `.runbar` ve `.statusline` metniyle
  anlatılıyor; liste/tablo yenilenirken alan boş kalıyor ve düzen sıçrıyor.

### 5.9 Koyu tema pariteliği

Yapısal olarak doğru kurulmuş (`:root` → `@media prefers-color-scheme` →
`:root[data-theme]` üçlüsü, satır 61–132) `[kod]`. Sorunlar:

1. `--seal-ink` ters çevrilmiş (§2.2) — **P0**.
2. `#fff` sabitleri (`.toast.ok/.bad`, `.days.late`) — **P0**.
3. `inset 0 1px 0 rgba(255,255,255,.16)` — koyu temada butonlara jel parlaklığı
   veriyor `[ekran ui2/10-editor-dark-1440.png]`.
4. `body { border-top: 4px solid var(--band) }` — koyu temada `#8d2f39`'luk
   4px'lik kırmızı şerit ekranın en üstünde bir **hata çubuğu** gibi okunuyor
   `[ekran ui2/10-editor-dark-1440.png]`.
5. `--seal` koyuda `#cd7a83` — bordo değil **gül pembesi**. Marka kimliği koyu
   temada kayboluyor.
6. `--paper-deep → --paper` gradyanı (satır 137–140) koyuda 380px'lik bir
   parlaklık geçişi bırakıyor; sticky `nav.toc` bunun üzerinden geçerken zemin
   uyuşmazlığı görünüyor.

---

## 6. Hareket denetimi

| Ne | Süre | Döngü | `prefers-reduced-motion`'da |
|---|---|---|---|
| `@keyframes sweep` (`.runbar .sweep`) | 1.3s | **sonsuz** | **kapatılmıyor** ❌ |
| `@keyframes mgspin` (monogram halkası) | **96s** (hover'da 14s) | **sonsuz** | kapatılıyor ✔ |
| `@keyframes rise` (`.anim`, `.toast`, `.copyfb`, `.stage`) | .25–.6s | tek | `.anim` ve `.stage` ✔, **`.toast` ve `.copyfb` ❌** |
| `@keyframes grow` (`.meters .fill`) | .7s | tek | ✔ |
| `@keyframes viewIn` (`.view-enter`) | .45s | tek | ✔ |
| `@keyframes medalIn` | .7s | tek | ✔ |
| Buton parlaması (`::after` translateX) | .7s | hover | ✔ (`display:none`) |
| `.card:hover` translateY | .3s | hover | ✔ (transform:none) |
| `html { scroll-behavior: smooth }` | — | — | **kapatılmıyor** ❌ |
| Tüm `transition` bildirimleri (48 × .25s) | — | — | **kapatılmıyor** ❌ |

**Bulgular**

- `prefers-reduced-motion` bloğu (satır 1389–1394) yalnız 8 seçici sayıyor;
  **sonsuz döngülü `.runbar .sweep` listede yok** — vestibüler duyarlılığı
  olan kullanıcı için en rahatsız edici öğe tam da o.
- `scroll-behavior: smooth` (satır 136) `:has` içinde değil, medya sorgusunda
  sıfırlanmıyor.
- Hiçbir `transition` `prefers-reduced-motion`'da kapatılmıyor.
- 96 saniyelik sonsuz monogram dönüşü: hiçbir bilgi taşımıyor, sayfanın
  ömrü boyunca kompozitör katmanı canlı tutuyor.
- Etkileşimi engelleyen bir animasyon **yok** (iyi): `viewIn`/`rise` sırasında
  `pointer-events` kapatılmıyor, `.runbar` `aria-hidden` (satır 1851) `[kod]`.

---

## 7. Kimlik denetimi

### 7.1 Monogram

```html
<svg class="monogram" viewBox="0 0 96 96">
  <circle class="mg-outer" cx="48" cy="48" r="45"/>      <!-- bronze 55%, 1px -->
  <circle class="mg-tick"  cx="48" cy="48" r="40.5"/>    <!-- kesikli, 96s döner -->
  <circle class="mg-inner" cx="48" cy="48" r="33.5"/>    <!-- seal 45%, 1px -->
  <text class="mg-c" x="34" y="63">C</text>              <!-- 40px, --ink -->
  <text class="mg-x" x="53" y="67">X</text>              <!-- 30px, --seal -->
</svg>
```
(satır 1684–1692) `[kod]`

**Sorunlar:**

- **Küçük boyda dağılıyor.** Üst çubukta `34px` render ediliyor (satır 1139).
  96 birimlik viewBox 34px'ye inince: dış halka 0.35px, iç halka 0.35px,
  kesikli halka 0.9px kalınlığa iner — **fiziksel piksel altı**, tarayıcı
  bunları gri bir bulanıklığa dönüştürür. `[ekran ui2/00-welcome-hero-1440.png]`
  üst soldaki marka işareti okunaksız bir leke.
- **Harfler çakışıyor.** `C` 40px, sol kenar x=34; `X` 30px, sol kenar x=53.
  Constantia'da 40px'lik `C`'nin genişliği ≈ 28px ⇒ sağ kenarı x≈62.
  `X` x=53'te başlıyor ⇒ **9px örtüşme**, üstelik farklı taban çizgilerinde
  (y=63 / y=67). 64px'de "Cx" ligatür gibi görünüyor, 34px'de tek bir işarete
  dönüşüyor `[ekran]`.
- **Kontrast**: dış halka 1.74:1, iç halka 2.30:1 açık temada `[hesap]` —
  logo çizgileri fiilen görünmüyor.
- **Favicon yok.** `<head>`'de hiçbir `<link rel="icon">` yok (satır 3–8)
  `[kod]`. Tarayıcı sekmesinde varsayılan boş kâğıt ikonu çıkıyor — UYAP
  sekmesinin yanında duracak bir üründe bu, kimliğin en görünür yerinin boş
  olması demektir. **CSP `img-src 'none'` favicon'u engellemez** (favicon
  belge kaynağı değildir), ama `data:` URI'li bir SVG favicon en temizi.

### 7.2 "İçtihat Külliyatı" konsepti

Stil sayfasının başlığı bunu şöyle tanımlıyor (satır 9–16): *"Basılı hukuk
külliyatı estetiği, sessiz lüks yorumuyla: fildişi kâğıt, mürekkep, tozlu
bordo mühür, bronz iz."* `[kod]`

**Konsept doğru ve savunulabilir.** Türk hukuk kültüründe bordo/vişne cilt,
altın yaldız sırt yazısı ve fildişi kâğıt gerçekten "külliyat" göstergesidir;
UYAP'ın soğuk mavi-gri kurumsal arayüzünün yanında bu bir farklılaştırıcıdır.

**Ama bugün konsept dekoratif kalıyor, yapısal değil:**

| Külliyat dilinin gerçek unsuru | Bugün ne var | Ne olmalı |
|---|---|---|
| **Sayfa** — kenar boşluğu, kolon, ritim | 920/1120/1380 arası üç kap, ızgara yok | tek ölçü sistemi, 62–72 karakter ölçü |
| **Cilt/sırt** — dikey kimlik | `body` üst kenarında 4px kırmızı şerit | sol kenarda ince bordo cilt sırtı ya da hiç |
| **Bölüm işareti** — `§`, numaralı fasıl | `h2.section .no` var (`§ 1`) — **iyi** | koru, güçlendir |
| **Yaldız** — tek, ölçülü vurgu | bronz her yerde (etiket, çizgi, glif, çip, ölçer) | yalnız bölüm çizgisi + `§` numarası |
| **Mühür** — nadir, ağır | bordo her yerde (buton, sekme, link, çip, rozet, dolgu) | yalnız birincil eylem + doğrulanmış atıf |
| **Filigran / damga** | `.stamp` bir kutu | gerçek damga: dosya sayfasında tek, ince |

Şu an **iki aksan rengi de her yerde**. Bordo hem gezinme, hem bağlantı, hem
buton, hem rozet, hem seçim rengi, hem alıntı şeridi. Bronz hem etiket, hem
çizgi, hem ikon, hem ilerleme dolgusu. Lüks, kıtlıktan gelir: bir sayfada
bordo **birden fazla anlamda** göründüğü an mühür olmaktan çıkıp tema rengine
dönüşür.

### 7.3 "UYAP'ın yanında açık dururken gurur duyulacak" testi

Bugün eksik olan üç şey:

1. **Bir sayı bloğu yok.** Avukatın ekranında dosya numarası, süre ve tarih
   *veri* olarak öne çıkmıyor (eski usul rakam + mono + `--ink-faint`, §3.1).
   Külliyat estetiği tam da burada işe yarar: **numaralar mühürlü kimliktir.**
2. **Sessizlik yok.** İçerikten önce üç banner, verdict'ten önce dört şerit,
   her paragrafın altında altı buton. Lüks yazılım az söyler.
3. **Dokunuş anı yok.** İyi tasarlanmış tek bir "an" — süre hesabındaki büyük
   bordo tarih (`.duebig`, 34px) — doğru içgüdü
   `[ekran ui1/05-deadline-modal-1440.png]`. O anı çoğaltmak gerekiyor:
   verdict kelimesi, esas numarası, kanıt sayısı.

---

## 8. ÖNERİLEN TASARIM SİSTEMİ

Kimlik korunuyor (fildişi · bordo · bronz), disiplin geliyor. Aşağıdaki
değerlerin **tümü** `scratchpad/w13-DESIGN/proposed.py` ile WCAG'a karşı
doğrulandı; her renk çiftinin hesaplanmış oranı verilmiştir `[hesap]`.

### 8.1 Renk tokenları (kopyala-yapıştır)

```css
:root {
  color-scheme: light dark;

  /* — yüzeyler — */
  --bg:            #F2EEE2;  /* sayfa zemini (fildişi) */
  --bg-sunk:       #E7E1D1;  /* çekilmiş alan, ray, tablo başlığı */
  --surface:       #FFFCF6;  /* kart */
  --surface-2:     #F4EFE2;  /* girdi dolgusu, alıntı zemini */

  /* — mürekkep — */
  --ink:           #221F19;  /* gövde        · surface 16.60:1 */
  --ink-2:         #57503F;  /* ikincil      · surface  7.55:1 */
  --ink-3:         #6B6353;  /* üst-veri     · surface  5.55:1 · bg 5.12:1 */

  /* — çizgiler — */
  --hair:          #E0D8C4;  /* DEKORATİF ayraç (kontrast şartı yok) */
  --line:          #C6BBA0;  /* yapısal bölücü */
  --border:        #8E836A;  /* ZORUNLU denetim sınırı · surface 3.66:1 */

  /* — mühür (bordo) — */
  --seal:          #7A2830;  /* metin/bağlantı · surface 9.43:1 */
  --seal-solid:    #7A2830;  /* dolu yüzey */
  --seal-solid-2:  #5C1D24;  /* dolu yüzey, basılı/hover */
  --seal-tint:     #F3E6E4;  /* yumuşak dolgu · seal 7.94:1 */
  --on-seal:       #FDF9F0;  /* dolu bordo ÜSTÜNDEKİ metin · 9.19:1 */

  /* — yaldız (bronz) — */
  --bronze:        #7E6935;  /* METİN olarak · surface 5.18:1 · bg 4.57:1 */
  --bronze-line:   #B79E63;  /* yalnız çizgi/kural */
  --bronze-tint:   #F7F1E2;  /* · bronze 4.71:1 */

  /* — anlam — */
  --ok:       #2F6446;  --ok-tint:       #E4EFE6;  /* 6.76 · 5.87 */
  --warn:     #7C5710;  --warn-tint:     #F6EDD8;  /* 6.35 · 5.58 */
  --bad:      #94302A;  --bad-tint:      #F7E7E3;  /* 7.55 · 6.44 */
  --abstain:  #54507B;  --abstain-tint:  #EAE8F1;  /* 7.30 · 6.16 */

  /* — perde — */
  --scrim: rgba(34, 31, 25, .55);   /* örtülen yüzeye karşı 3.74:1 */
}

:root[data-theme="dark"],
:root:not([data-theme="light"]) { /* @media (prefers-color-scheme: dark) içinde */
  --bg:            #15120E;
  --bg-sunk:       #100E0B;
  --surface:       #1F1B15;
  --surface-2:     #2A241B;

  --ink:           #F0E9D9;  /* surface 14.16:1 */
  --ink-2:         #C0B69D;  /* surface  8.50:1 */
  --ink-3:         #9C917A;  /* surface  5.50:1 · surface-2 4.94:1 */

  --hair:          #3A3225;
  --line:          #544A33;
  --border:        #7F7150;  /* surface 3.57:1 · surface-2 3.21:1 */

  --seal:          #E39BA0;  /* METİN · surface 7.72:1 */
  --seal-solid:    #8E2F39;  /* DOLU yüzey */
  --seal-solid-2:  #6E222B;
  --seal-tint:     #2C1A1B;
  --on-seal:       #FDF3EE;  /* DOLU bordo üstünde · 7.35:1 — ARTIK KOYU DEĞİL */

  --bronze:        #CBAF72;  /* surface 8.09:1 */
  --bronze-line:   #8A7647;
  --bronze-tint:   #2A2418;

  --ok:       #7FD0A1;  --ok-tint:      #17241C;
  --warn:     #E2B85C;  --warn-tint:    #261E10;
  --bad:      #EE8E82;  --bad-tint:     #2A1714;
  --abstain:  #B6ADDD;  --abstain-tint: #1D1B26;

  --scrim: rgba(6, 5, 4, .70);
}
```

**Silinecek tokenlar**: `--seal-deep`, `--bronze-soft` (ölü),
`--band` (→ `--seal-solid`), `--btn` / `--btn-deep` / `--btn-ink`
(→ `--seal-solid` / `--seal-solid-2` / `--on-seal`),
`--panel` / `--panel-2` / `--paper` / `--paper-deep`
(→ `--surface` / `--surface-2` / `--bg` / `--bg-sunk`),
`--ink-soft` / `--ink-faint` (→ `--ink-2` / `--ink-3`),
`--quote-bg` (→ `--surface-2`), `--seal-ink` (→ `--on-seal`),
`--bronze-text` (→ `--bronze`), `--line-strong` (→ `--line`).
Net: **26 → 21 token**, hiçbiri çift anlamlı değil.

**Kural (bir cümlelik sözleşme):** `--seal-solid` yalnız *dolgu* olarak,
`--seal` yalnız *metin/çizgi* olarak; ikisi asla yer değiştirmez. Koyu temadaki
P0 hatanın kökü bu ayrımın olmamasıydı.

### 8.2 İki yazı tipi — bugünkü en büyük prim kaldıracı

Bugün **her şey serif**: 10.5px'lik teknik satırlar da, tablo başlıkları da,
buton etiketleri de. Bu, arayüzü bir *broşür* gibi gösteriyor; bir *alet*
gibi değil. CSP `font-src 'none'` olduğu için çözüm sistem yığınlarıdır:

```css
:root {
  /* Hukuk metni: alıntı, taslak paragrafı, cevap prozası, başlıklar */
  --serif: Constantia, "Palatino Linotype", Palatino, Cambria, Georgia, serif;
  /* Arayüz kabuğu: etiket, buton, çip, tablo, üst-veri, form */
  --ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system,
        "Inter", "Helvetica Neue", Arial, sans-serif;
  /* Yalnız hash / UUID / makine kimliği / hizalanan sayı sütunu */
  --mono: "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace;
}

body { font-family: var(--ui); }          /* varsayılan artık UI */

/* Serif'i hukuk metnine GERİ ver — bilinçli, sayılı liste */
blockquote.quote, .claim .text, .para .ptext, .edpara .ptext, .doctext,
.src h3, h1, h2, h3, .verdict .word, .verdict .expl, .duebig,
.welcome ol, .abstain-panel p, .note-p, .steps, ul.reasons {
  font-family: var(--serif);
}
```

Kazanç: hukuk metni ciddi ve "basılı" kalır; etiketler, sayaçlar ve butonlar
Segoe UI'nin daha yüksek x-yüksekliği ve gerçek lining rakamlarıyla küçük
puntoda net okunur; UYAP'ın yanında duran pencere bir *program* gibi görünür.
Ek maliyet sıfırdır (sistem yazı tipi, ağ isteği yok, CSP uyumlu).

### 8.3 Tipografi ölçeği (29 → 9 basamak)

```css
:root {
  --fs-100: 12px;  --lh-100: 1.45;  /* mono üst-veri, hash */
  --fs-200: 13px;  --lh-200: 1.5;   /* ince yazı, yardım metni */
  --fs-300: 14px;  --lh-300: 1.5;   /* arayüz etiketi, buton, çip, tablo */
  --fs-400: 15px;  --lh-400: 1.55;  /* yoğun gövde: tablo hücresi, liste satırı */
  --fs-500: 16px;  --lh-500: 1.62;  /* GÖVDE — hukuk metni, alıntı, paragraf */
  --fs-600: 18px;  --lh-600: 1.45;  /* kart başlığı, bölüm alt başlığı */
  --fs-700: 21px;  --lh-700: 1.3;   /* bölüm başlığı (h2.section) */
  --fs-800: 26px;  --lh-800: 1.2;   /* sayfa başlığı (dosya adı, dilekçe adı) */
  --fs-900: 34px;  --lh-900: 1.15;  /* tek gösterim: verdict kelimesi, son gün */

  --tracking-tight: -0.01em;   /* ≥26px */
  --tracking-flat:   0;        /* varsayılan — HER YER */
  --tracking-label:  0.06em;   /* YALNIZ .fieldlabel ve h2.section */
}
body { font-size: var(--fs-500); line-height: var(--lh-500); }
```

**Kurallar:**

- `10px`, `10.5px`, `11px`, `11.5px` **yasak** — hukuk metninin yanında
  okunamaz ve hepsi kontrast sınırında.
- `12.5 / 13.5 / 14.5 / 15.5 / 16.5` gibi yarım değerler yasak.
- `letter-spacing` yalnız iki yerde: `.fieldlabel` ve `h2.section`, `0.06em`.
  Diğer 16 değer **sıfırlanır**.
- `font-variant-caps: all-small-caps` **tamamen kaldırılır** (Türkçe Ğ/Ş
  small-cap gliﬁ yok — §3.2). Yerine: `--fs-300` + `--bronze` + `0.06em`
  aralık + normal büyük/küçük harf. Aynı "külliyat etiketi" hissi, sıfır
  okunabilirlik kaybı.
- `font-variant-numeric` §3.1'deki blok aynen uygulanır.

### 8.4 Boşluk ölçeği (34 → 10 basamak, 4px tabanı)

```css
:root {
  --s-1:  4px;   --s-2:  8px;   --s-3: 12px;  --s-4: 16px;  --s-5: 20px;
  --s-6: 24px;   --s-7: 32px;   --s-8: 40px;  --s-9: 56px;  --s-10: 72px;
}
```

Eşleme kılavuzu (uygulayıcı için): `1,2,3 → --s-1` · `5,6,7 → --s-2` ·
`9,10,11 → --s-3` · `13,14,15 → --s-4` · `18,20,22 → --s-5` ·
`24,26,28 → --s-6` · `30,32,34,36,38 → --s-7` · `40,48,50 → --s-8` ·
`54,58,60,64 → --s-9` · `72,88,120 → --s-10`.

**Dikey ritim**: kart içi bloklar arası `--s-4`; kart–kart `--s-4`;
bölüm–bölüm `--s-9`; sayfa alt boşluğu `--s-10`.

### 8.5 Yarıçap · yükselti · geçiş

```css
:root {
  --r-1:  6px;   /* çip, rozet, kbd */
  --r-2: 10px;   /* buton, girdi, küçük yüzey */
  --r-3: 14px;   /* kart */
  --r-4: 20px;   /* panel, modal */
  --r-pill: 999px;  /* YALNIZ durum hapları ve segment sekmesi */

  /* Yükselti — yalnız üç kademe, üçü de tek katmanlı ve YUMUŞAK */
  --e-0: none;                                        /* akış içi: yalnız kenar */
  --e-1: 0 1px 2px rgba(34,31,25,.05),
         0 2px 8px -2px rgba(34,31,25,.06);           /* kart */
  --e-2: 0 2px 4px rgba(34,31,25,.06),
         0 12px 28px -8px rgba(34,31,25,.16);         /* açılır menü, sticky çubuk */
  --e-3: 0 8px 16px rgba(34,31,25,.10),
         0 32px 64px -16px rgba(34,31,25,.32);        /* modal */

  --t-fast:  120ms;   /* renk, opaklık */
  --t-base:  180ms;   /* denetim durumu */
  --t-slow:  240ms;   /* giriş/çıkış */
  --ease: cubic-bezier(.22,.61,.36,1);
}
:root[data-theme="dark"] {
  --e-1: 0 1px 2px rgba(0,0,0,.35), 0 2px 8px -2px rgba(0,0,0,.30);
  --e-2: 0 2px 4px rgba(0,0,0,.40), 0 12px 28px -8px rgba(0,0,0,.50);
  --e-3: 0 8px 16px rgba(0,0,0,.45), 0 32px 64px -16px rgba(0,0,0,.65);
}
```

Mevcut `--shadow`'un üçüncü katmanı (`0 28px 56px -24px rgba(...,.22)`)
fildişi zeminde kartların altına gri bir sis bırakıyor `[ekran
ui2/00-welcome-hero-1440.png]`. `--e-1` bunu bir dörtte birine indirir; kartlar
kâğıt gibi durur, bulut gibi değil.

### 8.6 Ölçü ve kap

```css
:root {
  --measure: 68ch;        /* hukuk prozası için hedef ölçü */
  --w-page: 1152px;       /* TEK kap genişliği (920/1120/1380 yerine) */
  --w-reading: 760px;     /* tek sütunlu okuma bloğu */
  --gutter: var(--s-6);
}
.wrap { max-width: var(--w-page); padding-inline: var(--gutter); }
/* Prozayı kabın tamamına yaymayın: */
.claim .text, .answermeta, .abstain-panel p, .note-p, .welcome ol,
blockquote.quote, .strip, .stamp, .livebanner, .notyet {
  max-width: var(--measure);
}
```

`body.editing .wrap` 1380px yalnız editörde kalır (üç sütun gerçekten gerekli).
`body.compact` ile normal arasındaki kap farkı kaldırılır.

### 8.7 Bileşen sözleşmeleri

**Buton — 4 varyant, tek geometri.**

```css
.btn {
  font: var(--fs-300)/1 var(--ui);
  letter-spacing: 0;
  border-radius: var(--r-2);
  padding: 10px 18px;              /* min yükseklik 38px */
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: var(--s-2);
  transition: background var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease),
              color var(--t-fast) var(--ease);
}
.btn--primary   { background: var(--seal-solid); color: var(--on-seal); }
.btn--primary:hover  { background: var(--seal-solid-2); }
.btn--secondary { background: var(--surface); color: var(--ink);
                  border-color: var(--border); }
.btn--secondary:hover { border-color: var(--seal); color: var(--seal); }
.btn--quiet     { background: transparent; color: var(--ink-2); }
.btn--quiet:hover { color: var(--seal); background: var(--seal-tint); }
.btn--danger    { background: transparent; color: var(--bad);
                  border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
.btn--danger:hover { background: var(--bad-tint); }
.btn--sm { padding: 6px 12px; font-size: var(--fs-200); }
.btn[disabled] { background: var(--bg-sunk); color: var(--ink-3);
                 border-color: var(--hair); cursor: not-allowed; opacity: 1; }
```

Kritik: **devre dışı hali opaklıkla değil, token'la** yapılır — böylece
`--ink-3` üzerinde 4.5:1 korunur (bugün `.55` opaklık 3.4:1'e düşürüyor).

Eşleme: `button.seal` + `a.dl` → `.btn.btn--primary` (tek geometri, `<a>`/
`<button>` farkı kalmaz) · `a.dl.alt` + `button.ghost.primary` →
`.btn--secondary` · `button.ghost` → `.btn--secondary` · `button.pre` +
`.olink` → `.btn--quiet` · `button.ghost.danger` + `button.rowdel` →
`.btn--danger` · `.themebtn` + `.pill` → ayrı `.statuspill` bileşeni
(§ aşağıda) · `button.tpl` → `.card--selectable`.

**Rozet — tek bileşen, tek geometri.**

```css
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font: var(--fs-200)/1.3 var(--ui);
  padding: 3px 9px;
  border-radius: var(--r-1);
  border: 1px solid transparent;
  background: var(--bg-sunk);
  color: var(--ink-2);
  white-space: nowrap;
}
.badge--ok      { background: var(--ok-tint);      color: var(--ok);
                  border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
.badge--warn    { background: var(--warn-tint);    color: var(--warn);    /* … */ }
.badge--bad     { background: var(--bad-tint);     color: var(--bad);     /* … */ }
.badge--abstain { background: var(--abstain-tint); color: var(--abstain); /* … */ }
.badge--seal    { background: var(--seal-tint);    color: var(--seal);    /* … */ }
.badge--num     { font-family: var(--mono); font-variant-numeric: tabular-nums; }
```

`.chip`, `.fchip`, `.mchip`, `.evchip`, `.autochip`, `.kaynaksiz`, `.days` →
hepsi `.badge` + bir varyant. `--r-1: 6px` (hap değil) — dikdörtgen rozet
külliyat estetiğine hap'tan daha yakın ve metin uzunluğu değiştiğinde daha az
gürültü yapar.

**Metin biçimi:** rozet içeriği **cümle düzeni** (`Destekleniyor`,
`Kaynaksız: 2`, `Sentetik kanıt`, `Aktif dosya`) — bugünkü BÜYÜK/küçük/karma
karışıklığı biter.

**Cümle uzunluğundaki "rozet"ler rozet değildir**: `Sorunun doğrudan
dayanağı — madde numarasıyla birebir eşleşme` bir `.reason` satırı olur:

```css
.reason { font: var(--fs-200)/1.5 var(--ui); color: var(--ink-2);
          padding-left: 14px; border-left: 2px solid var(--bronze-line); }
```

**Girdi.**

```css
.field {
  font: var(--fs-400)/1.5 var(--ui);
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--border);        /* 3.66:1 — artık görünür */
  border-radius: var(--r-2);
  padding: 9px 12px;
  min-height: 38px;
  transition: border-color var(--t-base) var(--ease),
              box-shadow var(--t-base) var(--ease);
}
.field:hover  { border-color: color-mix(in srgb, var(--seal) 45%, var(--border)); }
.field:focus-visible { outline: none; border-color: var(--seal);
                       box-shadow: 0 0 0 3px var(--seal-tint); }
.field[aria-invalid="true"] { border-color: var(--bad); background: var(--bad-tint); }
textarea.field { font-family: var(--serif); font-size: var(--fs-500); }
```

**Odak halkası — sayfa geneli (P0 düzeltme).**

```css
:root { --ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--seal); }
:root[data-theme="dark"] { --ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--seal); }

:where(button, a, [tabindex], select, input, textarea,
       [contenteditable]):focus-visible {
  outline: none;
  box-shadow: var(--ring);
  border-radius: inherit;      /* hap butonda hap halka */
}
```

Açık temada `--seal` / `--surface` = **9.43:1**, koyuda **7.72:1** `[hesap]` —
bugünkü 1.36:1'in yerine.

**Yükleme iskeleti (bugün hiç yok).**

```css
.skel { background: linear-gradient(90deg,
          var(--bg-sunk) 0%, var(--surface-2) 50%, var(--bg-sunk) 100%);
        background-size: 200% 100%;
        border-radius: var(--r-1);
        animation: skel 1.4s var(--ease) infinite; }
.skel--line { height: 1em; margin-bottom: var(--s-2); }
.skel--line:nth-child(3n) { width: 72%; }
@keyframes skel { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; background: var(--bg-sunk); }
}
```

Kullanılacağı yerler: `#matterlist`, `#filelist`, `#deadlist`, `#templates`,
`#out` — hepsi bugün boş kalıp sonra sıçrıyor. Sarmalayıcıya `aria-busy="true"`.

### 8.8 Hareket sözleşmesi

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Tek blok, kaçak bırakmaz (bugünkü 8 seçicilik liste `.runbar .sweep`'i ve tüm
`transition`'ları atlıyor). `.mg-tick` dönüşü **tamamen kaldırılır** (§8.9).

### 8.9 Kimlik — yeni monogram

Üç düzeltme, aynı fikir:

1. **Harfleri ayır, tek taban çizgisi.** `C` ve `X` yerine tek bir **`CX`
   ligatür-benzeri kompozisyon** ya da tek harf `C` + bordo `§`. Önerilen:
   dış bordo halka + içinde tek `§` işareti — hukuk kimliği evrensel, tek
   glif, her boyda okunur, Türkçe aksan sorunu yok.
2. **Kalınlıkları boya bağla.** `stroke-width: 1` yerine
   `vector-effect: non-scaling-stroke` + `stroke-width: 2` (96'lık viewBox'ta),
   ve 34px altında halkayı hiç çizme (`.brandmini .monogram .mg-outer { display:none }`).
3. **Dönüşü kaldır.** `mg-tick` ve `@keyframes mgspin` silinir.

Kontrast: halka `--seal` (`--bronze-line` değil) → açık 8.33:1, koyu 8.41:1
`[hesap]`.

**Favicon ekleyin** (CSP'yi ihlal etmez, `<head>`'e tek satır):

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%237A2830'/%3E%3Ctext x='16' y='23' font-family='Georgia,serif' font-size='20' fill='%23FDF9F0' text-anchor='middle'%3E%C2%A7%3C/text%3E%3C/svg%3E">
```

---

## 9. Ekran ekran yeniden tasarım notları

### 9.1 Kabuk (her ekran)

| Değişiklik | Neden |
|---|---|
| Üç banner'ı **tek** duruma indirin: `.stamp` (veri kaynağı) kalıcı ve **tek satır**; `.strip.demo` `.stamp` içine bir `.badge--abstain` olarak girer; `.strip.yellow` (dosyasız çalışma) **üst çubuktaki dosya seçicinin yanına** `.badge--warn` olur. | Bugün mobilde içerikten önce ≈330px uyarı var `[ekran FIX-2/fix2-02-390px-editor.png]`. Uyarı her yerde olduğunda hiçbir yerde değildir. |
| `body { border-top: 4px solid }` → `1px solid var(--seal-solid)` veya tamamen kaldırın. | Koyu temada 4px kırmızı şerit hata çubuğu gibi okunuyor. |
| `body.compact` ile normal başlık ayrımını **kaldırın**; hep kompakt olun, hoş geldiniz kartını içerik alanına taşıyın. | İki başlık modu iki bakım yükü; büyük başlık yalnız ilk açılışta görülüyor. |
| `nav.views`: `letter-spacing: 0`, `font-variant-caps: normal`, `--fs-300`, aktif sekme `background: var(--seal-solid); color: var(--on-seal)`. | P0 koyu tema kontrast hatası + okunabilirlik. |
| 480px'de sekmeleri 5→ tek satırda yatay kaydırılabilir şeride çevirin (`overflow-x:auto; scroll-snap-type:x`). | Bugün 4+1 kırılıp `AYARLAR` ortada yalnız kalıyor `[ekran]`. |

### 9.2 Dosyalarım

- **Yaklaşan süreler** paneli sayfanın en üstüne, tam genişlikte, `--e-2` ile.
  Tarih `--fs-800` + `tabular-nums` + `--seal`; kalan gün `.badge`.
  Bugün bu panel diğer kartlarla aynı ağırlıkta `[ekran ui2/00-welcome-hero]`.
- Dosya tablosu: `tabular-nums`, zebra yok ama satır yüksekliği 44px, esas no
  sütunu `--mono` + sağa yaslı, hover'da `--seal-tint`.
- Dosya sayfası aksiyonları **üçe** iner: `Belge yükle` (`--primary`),
  `Bu dosyada araştır` (`--secondary`), `Taslak oluştur` (`--secondary`);
  `Not ekle`/`Süre ekle` ilgili sekmenin içine; **`Dosyayı sil`** sayfanın
  en altında ayrı bir "Tehlikeli bölge" bloğunda `.btn--danger`.

### 9.3 Araştır

- Verdict kartı: madalya 76px → 56px, kelime `--fs-900`, açıklama
  `--fs-500` serif, `.ledger` **sağdan sola değil, kelimenin altına** üç
  `.stat` bloğu olarak (`kaynak 4` / `tespit 4` / `02.09.2026`), her biri
  `--fs-700` sayı + `--fs-200` etiket, `tabular-nums`.
  Bugün en önemli sayaçlar en zayıf tipografide `[ekran final-walk/final-02]`.
- `.answermeta` prozası `--measure` ile sınırlanır.
- `nav.toc` sticky hap → sticky **ince çubuk** (`--r-2`, `--e-2`,
  `--fs-300`), 640px altında gizli kalır.
- Tespit kartı: rozetler `.badge`, cümle-rozet `.reason` satırı olur, alıntı
  `blockquote` serif `--fs-500`, hash satırı **varsayılan kapalı**
  `<details>` içine.

### 9.4 Belgeler + Belge sayfası (en büyük kazanç burada)

Bugünkü hâl: 1440×**4321px** tek yığın, sol yarı 3700px boş
`[ekran r1-root-0826/04-document-page.png]`.

- Sağ sütunu **sekmelere** ayırın: `Sor · Künye · Atıflar (17) · Tarihler (11)
  · Talepler (3) · Bulut AI`. `.subtabs` bileşeni zaten var.
- `ATIFLAR`: yinelenenleri birleştirin (`HMK m.127 ×2`), her satırda tek
  `.btn--quiet.btn--sm` ("Doğrula"), madde no `.badge--num`.
- `TARİHLER`: iki buton yerine tek satır + hover'da beliren aksiyonlar.
- **UUID/offset satırını ekrandan kaldırın**; `<details>`'e ("Teknik künye")
  ya da yalnız kopyala düğmesine bağlayın. Avukatın ekranında UUID olmamalı.
- Sol pane: `position: sticky` + `align-self: start` + `max-height:
  calc(100vh - 24px)`; sağ sütun bittiğinde sol pane hizada kalsın.
- 900px altında `.docpane .doctext { max-height: none }` — telefonda iç
  kaydırma hapsi kalksın.

### 9.5 Taslak — şablon seçimi

- `minmax(240px,1fr)` → `minmax(300px,1fr)`; 1152px kapta 3 sütun.
- Kart içeriği: rozet + başlık (`--fs-600`) + **2 satıra kırpılmış** açıklama
  (`-webkit-line-clamp: 2`) + "Zorunlu alanlar" **`<details>` içinde**, ve o
  liste `--ui` ile (monospace değil).
- `align-items: start` + eşit yükseklik: `grid-auto-rows: 1fr` ile hizalı
  taban. Bugün kart tabanları rastgele `[ekran ui2/03-taslak-templates-1440]`.

### 9.6 Editör

En yüksek etkili tek değişiklik: **paragraf başına 6 butonu kaldırın.**

- Varsayılan: paragraf yalnız metin + numara + (varsa) `Kaynaksız` rozeti.
- Aksiyonlar `:hover`/`:focus-within`'de sağ üstte beliren **tek satırlık
  araç çubuğu**: `⋯` menüsü (`Sil`, `Yukarı`, `Aşağı`) + iki birincil
  (`Alıntı ekle`, `Bulut AI`). 6 buton → 3 görünür öğe.
- Sağ kanıt sütununda `blockquote { max-height: 180px; overflow:auto }`
  kaldırılır; yerine 4 satır `line-clamp` + "Tamamını göster".
  Üç iç içe kaydırma çubuğu → bir.
- Birincil eylemi düzeltin: **`Kaydet` = `.btn--primary`**, `DOCX`/`Markdown`/
  `UDF` bir "Dışa aktar" açılır menüsünde `.btn--secondary`.
  Bugün tek dolu buton `DOCX` `[ekran ui2/05-editor-1440.png]`.
- `.edoutline` noktalarına şekil ekleyin (● dolu = temiz, ▲ = karşı içtihat,
  ■ = kaynaksız) ve `title`/`aria-label` verin; `.olegend`'i renk adlarıyla
  değil durum adlarıyla yazın.

### 9.7 Yazdırma

```css
@page { size: A4; margin: 25mm 20mm 22mm 25mm; }   /* dilekçe kenar boşluğu */
@media print {
  :root { --surface:#fff; --bg:#fff; --ink:#000; --ink-2:#333; --ink-3:#555; }
  body { font: 11.5pt/1.5 var(--serif); border-top: 0; }
  .card, .verdict, details.trace { box-shadow:none; border:0; break-inside: avoid; }
  h2.section, .dsec h3 { font-size: 12pt; break-after: avoid; }
  .edpara { padding: 0 0 6pt 26pt; }
  .edpara .pno { font-size: 10pt; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; }
}
```

İki `@media print` bloğunu birleştirin; `body.editing` farkı yalnız
"kabuk gizle" satırlarıdır.

---

## 10. Erişilebilirlik düzeltme listesi

Ciddiyete göre. Her satır uygulanabilir.

| # | Ciddiyet | Bulgu | Düzeltme |
|---|---|---|---|
| A1 | **P0** | Odak halkası 1.36:1 (açık) / 1.51:1 (koyu) — klavye kullanıcısı nerede olduğunu göremiyor. WCAG 2.4.11/1.4.11. | §8.7 `--ring` bloğu. Yeni oran 9.43 / 7.72. |
| A2 | **P0** | `.viewtab.active` koyu temada 2.45:1 (`--seal-ink #1c0e10` bordo üstünde). WCAG 1.4.3. | `--on-seal` her iki temada açık; `.viewtab.active { color: var(--on-seal) }`. |
| A3 | **P0** | `.toast.ok` 2.08:1, `.toast.bad` 2.76:1, `.days.late` 2.76:1 (koyu, sabit `#fff`). | `#fff` sabitlerini kaldırın: toast `background: var(--ink); color: var(--surface)`, renk yalnız 4px sol kenar. `.days.late` → `.badge--bad`. |
| A4 | **P0** | Girdi sınırı 1.12:1 / 1.08:1 — alanlar görünmüyor. WCAG 1.4.11. | `.field { border: 1px solid var(--border) }` (3.66 / 3.57). |
| A5 | P1 | Koyu temada `--ink-faint` 4.37:1 (11–12.5px mono üst-veri, hash, tarih). | `--ink-3: #9C917A` (5.50) + minimum punto 12px. |
| A6 | P1 | Açık temada `--warn` üzerine `--warn` rozetleri 4.15–4.30:1 (`.chip.warn`, `.notyet .k`, `.strip.yellow b`). | `--warn: #7C5710`, `--warn-tint: #F6EDD8` → 5.58:1. |
| A7 | P1 | `--bronze` metin olarak 3.21:1 (`button.pre .glyph`). | `--bronze: #7E6935` (5.18); dekoratif çizgi için ayrı `--bronze-line`. |
| A8 | P1 | Devre dışı buton `opacity: .55` ⇒ 3.4:1. | Opaklık yerine token (`--bg-sunk` + `--ink-3`). |
| A9 | P1 | `prefers-reduced-motion` `.runbar .sweep` (sonsuz), `.toast`, `.copyfb`, `scroll-behavior` ve tüm `transition`'ları atlıyor. | §8.8 tek bloklu evrensel sıfırlama. |
| A10 | P1 | Modal perdesi 2.14:1 / 2.91:1 — arkadaki içerik okunur kalıyor, odak belirsiz. | `--scrim: rgba(34,31,25,.55)` (3.74:1) + `backdrop-filter: blur(2px)`. |
| A11 | P1 | Modalda odak tuzağı ve `Esc` CSS'te garanti değil; `.docmodal`'da `role="dialog" aria-modal="true"` yok (işaretlemede kontrol edilmeli). | Modal açılınca odak paneline, kapanınca tetikleyiciye; `aria-modal`, `aria-labelledby`. |
| A12 | P1 | Liste/tablo yenilenirken içerik boş kalıyor, `aria-busy` yok, iskelet yok. | §8.7 `.skel` + sarmalayıcıya `aria-busy`. |
| A13 | P2 | `role="tablist"` var ama ok tuşu gezinmesi yok. | `ArrowLeft/Right` + `roving tabindex`. |
| A14 | P2 | `.edoutline` noktaları rengi tek gösterge; efsane de renk adıyla yazılmış. WCAG 1.4.1. | Şekil + metin etiketi. |
| A15 | P2 | `:focus-visible { border-radius: var(--r-sm) }` hap butonlarda kare halka. | `border-radius: inherit`. |
| A16 | P2 | 10–11.5px metin (7 seçici). WCAG 1.4.4 zoom'la karşılanıyor ama pratikte okunmuyor. | Minimum `--fs-100: 12px`. |
| A17 | P2 | `px` tabanlı tipografi tarayıcı yazı-tipi ayarını yok sayıyor. | `html { font-size: 100% }` + ölçeği `rem`'e çevirin (`--fs-500: 1rem`). |
| A18 | P2 | Favicon yok; sekme kimliksiz. | §8.9 `data:` SVG favicon. |
| A19 | P2 | `.hashline .h { user-select: all; cursor: copy }` bir `<button>`; ekran okuyucuda amacı belirsiz. | `aria-label="Özeti kopyala"` + kopyalandı bildirimi `aria-live`. |

---

## 11. En yüksek etkili 10 görsel değişiklik (sıralı)

| # | Değişiklik | Etki | Maliyet | Kanıt |
|---|---|---|---|---|
| **1** | **Rakamları düzeltin** — `font-variant-numeric: lining-nums (tabular-nums)`. Esas no, madde no, tarih, tutar, sayaç anında "veri" gibi görünür. | Çok yüksek — hukuk yazılımında en görünür detay | 1 CSS bloğu (§3.1) | `[ekran ui1/16-ayarlar-status-390.png]` "54", "13", "30" taban altında |
| **2** | **İki yazı tipi**: kabuk `--ui` (Segoe UI), hukuk metni `--serif`. | Çok yüksek — broşürden alete geçiş | ~15 satır (§8.2) | tüm ekranlar: 10.5px serif teknik satırlar |
| **3** | **Odak halkasını görünür yapın** + girdi sınırı verin. | Yüksek (P0 a11y + "sağlam" hissi) | 2 kural (§8.7) | 1.36:1 ve 1.12:1 `[hesap]` |
| **4** | **Koyu tema P0 üçlüsü**: `--on-seal` açık; `#fff` toast/rozet sabitlerini kaldırın; üstteki 4px kırmızı şeridi 1px'e indirin. | Yüksek — koyu tema bugün kırık | ~8 satır | 2.45 / 2.08 / 2.76:1 `[hesap]` |
| **5** | **Editörde paragraf başına 6 butonu 3'e indirin** (hover araç çubuğu + `⋯`). | Yüksek — editörün gürültüsünün kaynağı | orta (JS + CSS) | `[ekran ui2/05-editor-1440.png]` |
| **6** | **Banner vergisini kaldırın**: 3 şerit → 1 satır. Birincil eylemi düzeltin (`Kaydet` dolu, `DOCX` ikincil). | Yüksek — ilk ekranın yarısı geri gelir | küçük | `[ekran FIX-2/fix2-02-390px-editor.png]` |
| **7** | **Gölgeyi hafifletin, yarıçapı düşürün** (`--e-1`, `--r-3: 14px`) ve `.card:hover` kaldırımını kaldırın. | Yüksek — "bulut" görünümü gider, kâğıt gelir | küçük (§8.5) | `[ekran ui2/00-welcome-hero-1440.png]` |
| **8** | **Ölçek disiplini**: 29 punto → 9, 34 boşluk → 10, 18 harf-aralığı → 2, small-caps'i kaldırın. | Yüksek — sayfa "tasarlanmış" görünür | büyük ama mekanik (§8.3–8.4) | `[hesap]` |
| **9** | **Belge sayfasını sekmeleyin** ve UUID/offset satırlarını `<details>`'e alın. | Yüksek — 4321px → ~1400px | orta | `[ekran r1-root-0826/04-document-page.png]` |
| **10** | **Ölçüyü sınırlayın** (`--measure: 68ch`) ve tek kap (`1152px`) kullanın. | Orta-yüksek — okuma yorgunluğu | küçük (§8.6) | `body.compact`'ta 115–125 karakter/satır |

**Sırayı bozmayın:** 1–4 tek başına, birbirine bağımlı olmadan uygulanabilir
ve toplam ~60 satır CSS'tir; ölçülebilir kalitenin çoğu oradadır. 5, 6, 9
işaretleme/JS dokunuşu ister. 8 mekaniktir ama geniştir — en son yapın,
çünkü ondan önce yapılan her düzeltme onun kapsamını daraltır.

---

## 12. Ne DEĞİŞTİRİLMEMELİ

Denetimde doğru bulunan ve korunması gereken kararlar:

- **`--serif`in hukuk metninde kullanımı** — alıntı, taslak paragrafı ve cevap
  prozası serif kalmalı. Bu, ürünün kimliği ve doğru bir karar.
- **`h2.section .no` (`§ 1`)** — külliyat dilinin en iyi çalışan parçası.
- **`.duebig`** (34px bordo son gün tarihi) — sayfadaki en iyi tasarlanmış an;
  desen olarak çoğaltın.
- **W12-UI2 small-caps sıfırlaması** (satır 1467–1503) — doğru yöne atılmış
  adım; §8.3 onu tamamlıyor, geri almıyor.
- **480px kırılımındaki başlık çalışması** (satır 1622–1653) — hedefe uyuyor.
- **`role="tablist"`/`aria-live`/`aria-label` kullanımı** — işaretleme
  semantiği genel olarak iyi.
- **Tek dosya, sıfır bağımlılık, CSP-karmalı satır içi CSS/JS** — bu bir
  kısıt değil, bir güvenlik özelliğidir; hiçbir öneri onu gevşetmiyor.

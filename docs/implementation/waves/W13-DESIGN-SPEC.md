# W13 — DESIGN-SPEC: konsolun tasarım ve UX şartnamesi

Tarih: **02.09.2026** · Hat: SYNTH-DESIGN · Tip: **uygulanabilir şartname**
(bu dosya dışında hiçbir depo dosyası değiştirilmedi, git işlemi yapılmadı).

Kaynak hatlar: `W13-DESIGN.md` (token/kontrast/tipografi denetimi, ölçülmüş),
`W13-UXAUDIT.md` (25 ekran görüntülü tarayıcı yürüyüşü, ölçülmüş),
`W13-COPY.md` (115 dize kalemi, ses ve sözlük), `W13-GLOBAL.md` (atıf/kaynak
sunum dilbilgisi), `W13-DAILYFLOW.md` (dört iş günü API simülasyonu),
`W13-FEATURE.md` (yeni ekran gereksinimleri F1/F6).

Hedef dosya: `control-plane/public/console.html` (bugün 8 634 satır; stil
8–1654, gövde 1656–1968, betik 1970–8631).

---

## 0. Uygulayıcıya sözleşme — önce bunu okuyun

### 0.1 Kırılmaz kısıtlar

1. **Tek `<style>`, tek `<script>`, LF-only.** Yeni blok eklemeyin; mevcut
   blokların içinde çalışın (`control-plane/tests/pipeline/console.test.ts`).
2. **Metin yalnız `textContent`.** İşaretleme atayan API'ler (`innerHTML`,
   `insertAdjacentHTML`, `DOMParser`), dinamik kod değerlendiren API'ler ve
   belge akışına doğrudan yazan eski API'ler yasaktır. Bütün işaretleme
   `document.createElement` + `className`/`setAttribute` ile kurulur.
3. **Satır içi olay niteliği (`onclick=…`) ve satır içi `style=` niteliği
   yasak.** Durum sınıfla taşınır (`el.classList.toggle`), görünürlük
   `el.hidden` ile.
4. **Uzak kaynak yok.** CSP `font-src 'none'`, `img-src 'none'`
   (`control-plane/src/api/consolePage.ts:66-67`): webfont, PNG, SVG dosyası,
   `background-image: url(...)` — hepsi bloke. Satır içi `<svg>` serbesttir.
   Simge yerine **kelime** kullanın; zorunluysa satır içi SVG çizin.
5. **CSP karması dosyadan üretilir**; CSS/JS değişikliği karma güncellemesi
   gerektirmez, ama dosya iki blok kuralını bozarsa test düşer.
6. Sayfa **390 px'te**, **koyu temada** ve **yazdırmada** çalışmaya devam
   etmelidir. Bu üçü her kalemin kabul ölçütünün parçasıdır.

### 0.2 Dürüstlük sözleşmesi (tasarımı bağlar)

- **Ölçülmemiş bir şey için sayı basılmaz.** Sözcüksel örtüşme oranı kalibre
  edilmemiştir; yüzde olarak sunulamaz. Kademe (1–4 çubuk) evet, ondalık
  yüzde hayır. (`W13-GLOBAL` §9.2/5, §10)
- **"Bayrak yok" ≠ "temiz".** Bir karar/norm durum rozetinin varsayılanı
  **"olumsuz işlem taranmadı"**dır; asla yeşil "sorun yok" değildir.
- **Renk tek başına anlam taşımaz.** Her durum rozeti hem renk hem Türkçe
  kelime taşır (WCAG 1.4.1 + yazdırma + renk körlüğü).
- Zorunlu değişmez cümleler (`DEADLINE_DISCLAIMER`, `deneysel — UYAP Doküman
  Editörü'nde açarak doğrulayın`, `DOĞRULANMADI — madde metniyle kontrol
  edin`, dört durum damgası) **birebir korunur**; tasarım onları kısaltamaz.

### 0.3 Uygulama sırası (bozmayın)

| Dalga | Kalemler | Neden bu sırada |
|---|---|---|
| **1 — temel** | DS-01…DS-05 | ~120 satır CSS; ölçülebilir kalitenin çoğu ve dört P0 erişilebilirlik hatası burada. Sonraki her kalemin kapsamını daraltır. |
| **2 — bileşen** | CMP-01…CMP-08 | Ekranlar bunlara dayanıyor; önce sözleşmeler. |
| **3 — kanıt bileşenleri** | CMP-09…CMP-12 | Ürünün çekirdek farkı; ekran işinden önce bitmeli. |
| **4 — ekran** | SCR-01…SCR-10 | Her ekran yalnız bileşenleri dizer. |
| **5 — yeni ekran** | SCR-11…SCR-13 | Arka uç uçları gerektirir (F1/F6); şartname hazırdır. |
| **6 — sistem** | SYS-01…SYS-04 | Sözlük testi, klavye, yazdırma, hata kurtarma — çapraz. |

---

## 1. TASARIM TOKENLARI (tam küme, birebir değerler)

Bugünkü durum: **26 renk tokenı** (2'si ölü, 3'ü aynı bordoyu üç adla taşıyor),
**29 punto**, **34 boşluk**, **18 harf aralığı**, **15 satır yüksekliği**,
**5 kırılım**, **3 kap genişliği**, boşluk/süre/z-index tokenı **yok**
(`W13-DESIGN` §1). Aşağıdaki küme bunların yerine geçer.

### 1.1 Renk — açık tema (`:root`)

Her oran `W13-DESIGN` §8.1'de hesaplanmıştır; yorum satırlarındaki sayılar
korunmalıdır (gelecekteki bir denetimin dayanağıdır).

```css
:root {
  color-scheme: light dark;

  /* — yüzeyler — */
  --bg:            #F2EEE2;  /* sayfa zemini (fildişi) */
  --bg-sunk:       #E7E1D1;  /* çekilmiş alan, ray, tablo başlığı, devre dışı */
  --surface:       #FFFCF6;  /* kart */
  --surface-2:     #F4EFE2;  /* girdi dolgusu, alıntı zemini */

  /* — mürekkep — */
  --ink:           #221F19;  /* gövde     · surface 16.60:1 */
  --ink-2:         #57503F;  /* ikincil   · surface  7.55:1 */
  --ink-3:         #6B6353;  /* üst-veri  · surface  5.55:1 · bg 5.12:1 */

  /* — çizgiler — */
  --hair:          #E0D8C4;  /* DEKORATİF ayraç (kontrast şartı yok) */
  --line:          #C6BBA0;  /* yapısal bölücü */
  --border:        #8E836A;  /* ZORUNLU denetim sınırı · surface 3.66:1 */

  /* — mühür (bordo) — */
  --seal:          #7A2830;  /* METİN/çizgi · surface 9.43:1 */
  --seal-solid:    #7A2830;  /* DOLU yüzey */
  --seal-solid-2:  #5C1D24;  /* DOLU yüzey, hover/basılı */
  --seal-tint:     #F3E6E4;  /* yumuşak dolgu · seal 7.94:1 */
  --on-seal:       #FDF9F0;  /* DOLU bordo ÜSTÜNDEKİ metin · 9.19:1 */

  /* — yaldız (bronz) — */
  --bronze:        #7E6935;  /* METİN olarak · surface 5.18:1 · bg 4.57:1 */
  --bronze-line:   #B79E63;  /* YALNIZ çizgi/kural */
  --bronze-tint:   #F7F1E2;  /* · bronze 4.71:1 */

  /* — anlam — */
  --ok:       #2F6446;  --ok-tint:       #E4EFE6;  /* 6.76 · 5.87 */
  --warn:     #7C5710;  --warn-tint:     #F6EDD8;  /* 6.35 · 5.58 */
  --bad:      #94302A;  --bad-tint:      #F7E7E3;  /* 7.55 · 6.44 */
  --abstain:  #54507B;  --abstain-tint:  #EAE8F1;  /* 7.30 · 6.16 */

  /* — perde — */
  --scrim: rgba(34, 31, 25, .55);   /* örtülen yüzeye karşı 3.74:1 */
}
```

### 1.2 Renk — koyu tema

Bugünkü yapı doğru kurulmuş (`:root` → `@media (prefers-color-scheme: dark)`
→ `:root[data-theme="dark"]`, satır 61–132); **yalnız değerler değişir.**

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* aşağıdaki blok */ } }
:root[data-theme="dark"] { /* aynı blok */ }

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
  --on-seal:       #FDF3EE;  /* DOLU bordo üstünde 7.35:1 — ARTIK KOYU DEĞİL */

  --bronze:        #CBAF72;  /* surface 8.09:1 */
  --bronze-line:   #8A7647;
  --bronze-tint:   #2A2418;

  --ok:       #7FD0A1;  --ok-tint:      #17241C;
  --warn:     #E2B85C;  --warn-tint:    #261E10;
  --bad:      #EE8E82;  --bad-tint:     #2A1714;
  --abstain:  #B6ADDD;  --abstain-tint: #1D1B26;

  --scrim: rgba(6, 5, 4, .70);
```

**Tek cümlelik renk sözleşmesi:** `--seal-solid` yalnız *dolgu*, `--seal`
yalnız *metin ve çizgi* olarak kullanılır; ikisi asla yer değiştirmez.
Koyu temadaki P0 hatanın (`--seal-ink` aynı adla iki karşıt iş yapıyordu,
`.viewtab.active` 2.45:1) kökü bu ayrımın olmamasıydı.

**Silinen tokenlar ve eşlemesi** (26 → 21):

| Silinen | Yerine |
|---|---|
| `--seal-deep`, `--bronze-soft` | *(ölü, karşılığı yok)* |
| `--band`, `--btn` | `--seal-solid` |
| `--btn-deep` | `--seal-solid-2` |
| `--btn-ink`, `--seal-ink` | `--on-seal` |
| `--paper`, `--paper-deep` | `--bg`, `--bg-sunk` |
| `--panel`, `--panel-2` | `--surface`, `--surface-2` |
| `--quote-bg` | `--surface-2` |
| `--ink-soft`, `--ink-faint` | `--ink-2`, `--ink-3` |
| `--line-strong` | `--line` |
| `--bronze-text` | `--bronze` |

**Sabit kodlanmış renkler kaldırılır:** `#fff` (3 yer: `.toast.ok`,
`.toast.bad`, `.days.late` — koyu temada AA'yı kıran üç P0),
`rgba(255,255,255,.16)` (5 yer, koyu temada butonlara jel parlaklığı veriyor),
`rgba(42,35,24,.03)` (2 yer, koyu temada görünmez), yazdırma bloğundaki
`#7d2a33`/`#000`/`#fff`.

**Geçiş kolaylığı:** eski adlar `:root` içinde alias olarak geçici
bırakılabilir (`--panel: var(--surface);`). Ama **DS-01'in kabul ölçütü
alias'ların kalmamasıdır**; alias yalnız uygulama sırasında durur.

### 1.3 Tipografi tokenları

CSP `font-src 'none'` ⇒ yalnız sistem yığını. Hedef makine Windows 10'dur:
`Constantia` ve `Segoe UI Variable Text`/`Segoe UI` fiilen kuruludur.

```css
:root {
  /* Hukuk metni: alıntı, taslak paragrafı, cevap prozası, başlıklar */
  --serif: Constantia, "Palatino Linotype", Palatino, Cambria, Georgia, serif;
  /* Arayüz kabuğu: etiket, buton, çip, tablo, üst-veri, form */
  --ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system,
        "Helvetica Neue", Arial, sans-serif;
  /* YALNIZ hash / UUID / makine kimliği / hizalanan sayı sütunu */
  --mono: "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace;

  --fs-100: 12px;  --lh-100: 1.45;  /* mono üst-veri, hash */
  --fs-200: 13px;  --lh-200: 1.5;   /* ince yazı, yardım metni, rozet */
  --fs-300: 14px;  --lh-300: 1.5;   /* arayüz etiketi, buton, tablo başlığı */
  --fs-400: 15px;  --lh-400: 1.55;  /* yoğun gövde: tablo hücresi, liste satırı */
  --fs-500: 16px;  --lh-500: 1.62;  /* GÖVDE — hukuk metni, alıntı, paragraf */
  --fs-600: 18px;  --lh-600: 1.45;  /* kart başlığı */
  --fs-700: 21px;  --lh-700: 1.3;   /* bölüm başlığı (h2.section) */
  --fs-800: 26px;  --lh-800: 1.2;   /* sayfa başlığı (dosya adı, dilekçe adı) */
  --fs-900: 34px;  --lh-900: 1.15;  /* tek gösterim: verdict kelimesi, son gün */

  --tracking-tight: -0.01em;   /* yalnız ≥26px */
  --tracking-flat:   0;        /* varsayılan — HER YER */
  --tracking-label:  0.06em;   /* YALNIZ .fieldlabel ve h2.section */
}
body { font-family: var(--ui); font-size: var(--fs-500); line-height: var(--lh-500); }
```

Serif geri verilen **kapalı liste** (başka hiçbir yerde `--serif` kullanılmaz):

```css
blockquote.quote, .claim .text, .para .ptext, .edpara .ptext, .doctext,
.src h3, h1, h2, h3, .verdict .word, .verdict .expl, .duebig,
.welcome ol, .abstain-panel p, .note-p, .steps, ul.reasons {
  font-family: var(--serif);
}
```

**Kurallar (test edilebilir):**

| # | Kural | Ölçüt |
|---|---|---|
| T1 | `10px`, `10.5px`, `11px`, `11.5px` **yasak** | stil sayfasında `font-size` bildiriminde bu değerler 0 kez geçer |
| T2 | Yarım punto (`12.5`, `13.5`, `14.5`, `15.5`, `16.5`) **yasak** | aynı |
| T3 | `letter-spacing` yalnız `.fieldlabel` ve `h2.section`, `0.06em` | diğer 16 değer sıfırlanır |
| T4 | `font-variant-caps: all-small-caps` **tamamen kaldırılır** | Constantia'nın small-caps setinde Ğ/Ş gerçek glif taşımıyor; "DEĞERLENDİRME"de Ğ komşularından ince çıkıyor (`W13-DESIGN` §3.2) |
| T5 | `text-transform: uppercase` **hiçbir kurala eklenmez** | bugün zaten yok; Türkçe `i → I` hatasını yapısal olarak imkânsız kılar |
| T6 | Monospace yalnız hash/UUID/makine kimliği/hizalanan sayı sütunu | `ul.reasons`, `button.tpl .req`, `.statusline`, `.abstain-panel .counts`, `.mchip`, `.evchip`, `.itemrow .when`, `.deadrow .due` **`--ui`'ye geçer** |

**Rakam düzeltmesi (en yüksek etkili tek CSS bloğu).** Constantia varsayılan
olarak eski usul (old-style) rakam kullanır: `3 4 5 7 9` taban çizgisinin
altına iner. Esas no `2026/123`, madde `m. 157`, tarih `15.07.2026`, tutar
`45.000 TL` — hepsi kimliktir, sıralı metin değil.

```css
body { font-variant-numeric: lining-nums proportional-nums; }
table.matters td, table.matters th, table.grid td, table.grid th,
.deadrow .due, .duebig, .ledger, .meta dd, .kv dd, .itemrow .when,
.answermeta, .headrow, .verdict .word, .src .courtline, .evcard .meta dd,
.hashline, .chunkline, .rawcode, .timing, .budgethint, .badge--num, .stat .n {
  font-variant-numeric: lining-nums tabular-nums;
  font-feature-settings: "lnum" 1, "tnum" 1;   /* Constantia için yedek */
}
```

### 1.4 Boşluk, yarıçap, yükselti, hareket, ölçü, katman

```css
:root {
  /* Boşluk — 4px tabanı, 10 basamak (bugün 34 değer) */
  --s-1:  4px;  --s-2:  8px;  --s-3: 12px;  --s-4: 16px;  --s-5: 20px;
  --s-6: 24px;  --s-7: 32px;  --s-8: 40px;  --s-9: 56px;  --s-10: 72px;

  /* Yarıçap */
  --r-1:  6px;      /* çip, rozet, kbd */
  --r-2: 10px;      /* buton, girdi, küçük yüzey */
  --r-3: 14px;      /* kart */
  --r-4: 20px;      /* panel, modal */
  --r-pill: 999px;  /* YALNIZ durum hapları ve segment sekmesi */

  /* Yükselti — üç kademe, hepsi yumuşak */
  --e-0: none;
  --e-1: 0 1px 2px rgba(34,31,25,.05), 0 2px 8px -2px rgba(34,31,25,.06);
  --e-2: 0 2px 4px rgba(34,31,25,.06), 0 12px 28px -8px rgba(34,31,25,.16);
  --e-3: 0 8px 16px rgba(34,31,25,.10), 0 32px 64px -16px rgba(34,31,25,.32);

  /* Hareket */
  --t-fast:  120ms;   /* renk, opaklık */
  --t-base:  180ms;   /* denetim durumu */
  --t-slow:  240ms;   /* giriş/çıkış */
  --ease: cubic-bezier(.22,.61,.36,1);

  /* Ölçü ve kap */
  --measure:   68ch;     /* hukuk prozası hedef ölçüsü */
  --w-page:  1152px;     /* TEK kap genişliği (920/1120/1380 yerine) */
  --w-reading: 760px;    /* tek sütunlu okuma bloğu */
  --gutter: var(--s-6);
  --label-col: 168px;    /* TEK etiket sütunu (bugün 104/110/150/158/168/170/200/220) */

  /* Dokunma hedefi */
  --tap: 40px;

  /* Katman */
  --z-base: 0; --z-sticky: 10; --z-topbar: 20;
  --z-popover: 40; --z-modal: 60; --z-toast: 80;

  /* Odak halkası */
  --ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--seal);
}
:root[data-theme="dark"] {
  --e-1: 0 1px 2px rgba(0,0,0,.35), 0 2px 8px -2px rgba(0,0,0,.30);
  --e-2: 0 2px 4px rgba(0,0,0,.40), 0 12px 28px -8px rgba(0,0,0,.50);
  --e-3: 0 8px 16px rgba(0,0,0,.45), 0 32px 64px -16px rgba(0,0,0,.65);
}
```

**Eski değerden yeni token'a eşleme kılavuzu** (mekanik):
`1,2,3 → --s-1` · `5,6,7 → --s-2` · `9,10,11 → --s-3` · `13,14,15 → --s-4` ·
`18,20,22 → --s-5` · `24,26,28 → --s-6` · `30,32,34,36,38 → --s-7` ·
`40,48,50 → --s-8` · `54,58,60,64 → --s-9` · `72,88,120 → --s-10`.

**Dikey ritim:** kart içi bloklar arası `--s-4`; kart–kart `--s-4`;
bölüm–bölüm `--s-9`; sayfa alt boşluğu `--s-10`.

### 1.5 Kırılım noktaları — beş dağınık değer yerine dört

Bugün `1100 · 900 (×2) · 800 · 640 (×3) · 480` var ve aynı sayfada üç ayrı
"dar ekran" tanımı yapıyor. Medya sorgusunda özel değişken kullanılamaz; bu
**dört sayı birebir** yazılır:

| Ad | Değer | Ne değişir |
|---|---|---|
| `sm` | `max-width: 640px` | tek sütun; tablo → kart listesi; sekmeler kaydırılabilir şerit |
| `md` | `max-width: 900px` | iki sütunlu ızgaralar tek sütuna; belge sayfası tek sütun; editör sağ paneli alta |
| `lg` | `max-width: 1200px` | üst çubuk durum hapları tek "Durum" hapına iner; editör 3 sütun → 2 sütun |
| `xl` | `min-width: 1560px` | kap `--w-page`te sabit kalır, büyümez |

**Doğrulama noktaları:** 390 · 768 · 960 · 1024 · 1440 · 1920.
`960` bugün kırık: `document.scrollWidth = 1087 > innerWidth = 960`
(`.pills`, `.pill.mute`, `.themebtn` taşıyor — `W13-UXAUDIT` U11/P1-13).
`lg` kırılımı bunu kapatır.

### 1.6 Hareket sözleşmesi

Bugünkü `prefers-reduced-motion` bloğu yalnız 8 seçici sayıyor; **sonsuz
döngülü `.runbar .sweep` listede yok**, `scroll-behavior: smooth` ve 48
`transition` bildirimi kapatılmıyor. Yerine tek blok:

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

Ek olarak: `@keyframes mgspin` ve `.mg-tick` **silinir** (96 saniyelik sonsuz
dönüş hiçbir bilgi taşımıyor). `.card:hover { transform: translateY(-2px) }`
**kaldırılır** (20 kartlı sayfada fare gezdikçe düzen titriyor).

Kalan animasyonlar: `viewIn` `--t-slow`, `rise` `--t-slow`, `grow` `--t-slow`,
`skel` `1.4s` (yalnız iskelet), `sweep` `1.3s` (yalnız belirsiz ilerleme,
`aria-hidden`).

---

## 2. TEMELLER

### 2.1 Renk kullanım sözleşmesi

| Renk | YALNIZ şu anlamda | Yasak kullanım |
|---|---|---|
| `--seal-solid` | birincil eylem dolgusu, aktif sekme dolgusu | bağlantı, rozet kenarı, dekoratif şerit |
| `--seal` | bağlantı metni, birincil metin vurgusu, odak halkası, doğrulanmış atıf | arka plan |
| `--bronze` | bölüm etiketi metni, `§` numarası | ilerleme dolgusu, ikon, çip zemini |
| `--bronze-line` | bölüm ayraç çizgisi, alıntı sol şeridi | metin |
| `--ok/--warn/--bad/--abstain` | **yalnız durum** | dekorasyon, kategori ayrımı |

Bugünkü sorun: bordo hem gezinme, hem bağlantı, hem buton, hem rozet, hem
seçim rengi, hem alıntı şeridi; bronz hem etiket, hem çizgi, hem ikon, hem
ilerleme dolgusu. **Lüks kıtlıktan gelir**: bordo bir sayfada birden fazla
anlamda göründüğü an mühür olmaktan çıkıp tema rengine döner.

### 2.2 Kimlik

- **Monogram yeniden çizilir.** Bugün `C` (40px, x=34) ve `X` (30px, x=53)
  **9px örtüşüyor**, üstelik iki ayrı taban çizgisinde (y=63 / y=67); 34px'te
  halkalar 0.35px kalınlığa inip gri lekeye dönüşüyor.
  Yeni işaret: **dış bordo halka + içinde tek `§`**. Tek glif, her boyda
  okunur, Türkçe aksan sorunu yok. `stroke-width: 2` +
  `vector-effect: non-scaling-stroke`; 34px altında halka çizilmez. Halka
  rengi `--seal` (açık 8.33:1, koyu 8.41:1).
- **`body { border-top: 4px solid var(--band) }` → `1px solid var(--seal-solid)`**
  ya da tamamen kaldırılır: koyu temada 4px kırmızı şerit **hata çubuğu** gibi
  okunuyor.
- **Marka adı**: `.masthead .brand { letter-spacing: .34em }` → `0`.
  "C O L L E X" altı harfli bir kelimeyi kelime olmaktan çıkarıyor.
- **Favicon** (P2, CSP dokunuşu gerektirir): `<head>`'e tek
  `<link rel="icon" href="data:image/svg+xml,…§…">` **ve** `consolePage.ts`
  CSP'sinde `img-src 'none'` → `img-src data:`. Kabul ölçütü: CSP dizesinde
  `http`/`https` şeması geçmez, yalnız `data:` eklenir. Bu değişiklik
  yapılmazsa favicon **eklenmez** (sessizce bloke olur, sahte kazanç olur).

### 2.3 Yoğunluk ve ızgara

Bugün paylaşılan ızgara yok; 14 bileşen kendi `grid-template-columns`'unu
sabit px ile tanımlıyor ve etiket sütunu **sekiz farklı genişlikte**
(104/110/150/158/168/170/200/220) — kullanıcı sayfayı kaydırırken sol kenar
sekiz kez kayıyor.

```css
.g-label   { display:grid; grid-template-columns: var(--label-col) minmax(0,1fr); gap: var(--s-2) var(--s-4); }
.g-2       { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--s-4); }
.g-3       { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--s-4); }
.g-auto    { display:grid; grid-template-columns: repeat(auto-fill, minmax(300px,1fr)); gap: var(--s-4); }
.g-form    { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px,1fr)); gap: var(--s-4); }
.g-doc     { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: var(--s-6); }
.g-editor  { display:grid; grid-template-columns: 220px minmax(0,1fr) 340px; gap: var(--s-5); }
```
`@media (max-width:1200px)` → `.g-editor { grid-template-columns: minmax(0,1fr) 320px; }`
(anahat gizlenir, `nav.toc` sticky çubuğa iner)
`@media (max-width:900px)` → `.g-2,.g-3,.g-doc,.g-editor { grid-template-columns: minmax(0,1fr); }`

**Ölçü kuralı.** Proza asla kabın tamamına yayılmaz:

```css
.claim .text, .answermeta, .abstain-panel p, .note-p, .welcome ol,
blockquote.quote, .strip, .stamp, .livebanner, .notyet, .reason,
.empty p, .placeholder p { max-width: var(--measure); }
```
Bugün `body.compact .wrap` (yani günlük varsayılan) satır başına **115–125
karakter** üretiyor; optimum 60–75'tir.

**Kap birleştirme.** `920 / 1120 / 1380` üç kap yerine tek
`--w-page: 1152px`. `body.compact` ile normal arasındaki fark **kaldırılır**
(hep kompakt); yalnız `body.editing .wrap { max-width: 1380px }` kalır —
orada üç sütun gerçekten gerekli.

---

## 3. BİLEŞEN ŞARTNAMELERİ

Her bileşen için: **CSS**, **durumlar**, **aria**, **kabul ölçütü**. Bütün
işaretleme `createElement` + `textContent` ile kurulur.

### 3.1 Buton — 17 muamele → 4 varyant, tek geometri

Bugün 17 ayrı tıklanabilir görsel muamele var; **iki farklı birincil buton**
(`button.seal` 15px/`14 32 15` ve `a.dl` 14px/`12 26 13`) — `<button>` mü
`<a>` mı olduğuna göre boy değişiyor. Yıkıcı varyant fiilen yok
(`.ghost.danger` durağan halde `.ghost` ile birebir aynı). Devre dışı hali
**dört ayrı opaklık** (.6/.55/.55/.6/.85) ve opaklık metni AA altına düşürüyor
(`--ink-soft` 6.13 × .55 ≈ 3.4:1).

```css
.btn {
  font: var(--fs-300)/1 var(--ui);
  letter-spacing: 0;
  border-radius: var(--r-2);
  padding: 10px 18px;
  min-height: var(--tap);
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2);
  background: none; color: inherit; text-decoration: none;
  transition: background var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease),
              color var(--t-fast) var(--ease);
}
.btn--primary   { background: var(--seal-solid); color: var(--on-seal); }
.btn--primary:hover   { background: var(--seal-solid-2); }
.btn--secondary { background: var(--surface); color: var(--ink); border-color: var(--border); }
.btn--secondary:hover { border-color: var(--seal); color: var(--seal); }
.btn--quiet     { background: transparent; color: var(--ink-2); }
.btn--quiet:hover     { color: var(--seal); background: var(--seal-tint); }
.btn--danger    { background: transparent; color: var(--bad);
                  border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
.btn--danger:hover    { background: var(--bad-tint); }
.btn--sm { padding: 6px 12px; min-height: 32px; font-size: var(--fs-200); }
.btn[disabled], .btn[aria-disabled="true"] {
  background: var(--bg-sunk); color: var(--ink-3);
  border-color: var(--hair); cursor: not-allowed; opacity: 1;
}
.btn--busy { pointer-events: none; }
```

**Devre dışı hali opaklıkla değil token'la** yapılır — `--ink-3` üzerinde
4.5:1 korunur.

| Bugün | Yarın |
|---|---|
| `button.seal`, `a.dl` | `.btn.btn--primary` (tek geometri) |
| `a.dl.alt`, `button.ghost.primary`, `button.ghost` | `.btn.btn--secondary` |
| `button.pre`, `.edoutline .olink` | `.btn.btn--quiet` |
| `button.ghost.danger`, `button.rowdel` | `.btn.btn--danger` |
| `button.ghost.small` | `.btn.btn--secondary.btn--sm` |
| `button.pill`, `.themebtn` | `.statuspill` (§3.2) |
| `button.tpl` | `.card--selectable` (§3.4) |
| `button.viewtab`, `button.subtab` | `.tab` / `.subtab` (§3.9) |
| `label.rchip span`, `label.fchk span` | `.choice` (§3.6) |

**Meşguliyet durumu (zorunlu, her `<form>` submit yolunda).** Gönderim
sırasında `btn.disabled = true` + `.btn--busy`; **metin değişmez** (etiket
kayması olmaz), durum yanındaki `.timing` alanına yazılır; gönderim bitince
geri alınır. Bu, `W13-UXAUDIT` P1-2'yi (çift tık → iki özdeş dava dosyası)
kapatan mekanizmadır.

**Kabul ölçütü.** (a) Tıklanabilir öğe için tanımlı görsel muamele sayısı ≤ 6.
(b) Bir ekranda `.btn--primary` en fazla **bir** kez görünür. (c) `Dosyayı
sil` `.btn--danger`. (d) `Dosyayı aç` formuna üç hızlı tık **bir** POST üretir.

### 3.2 Durum hapı (`.statuspill`)

Üst çubuktaki üç durum (Veritabanı · Canlı araştırma · Bulut AI) ve tema
düğmesi. Nokta + kelime; kelime her zaman yazılıdır, renk tek gösterge değil.

```css
.statuspill {
  display:inline-flex; align-items:center; gap: var(--s-2);
  font: var(--fs-200)/1.3 var(--ui);
  padding: 6px 12px; min-height: 32px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--surface); color: var(--ink-2); cursor: pointer;
}
.statuspill .dot { width:8px; height:8px; border-radius:50%; background: var(--ink-3); flex:none; }
.statuspill.is-ok   .dot { background: var(--ok); }
.statuspill.is-warn .dot { background: var(--warn); }
.statuspill.is-bad  .dot { background: var(--bad); }
@media (max-width:1200px) { .statuspill .t { display:none; } .statuspill { padding:6px 8px; } }
```

`lg` altında üç hap tek bir **"Durum"** hapına iner (en kötü durumun rengini
taşır); tıklanınca Ayarlar › Sistem durumu'na gider. 960 px'teki yatay kaymayı
kapatan değişiklik budur.

**Kabul ölçütü.** 960 px genişlikte `document.scrollWidth <= innerWidth`.

### 3.3 Rozet (`.badge`) — 10 bileşen, 3 ölçü sistemi → 1

Bugün `.chip`, `.fchip`, `.mchip`, `.evchip`, `.autochip`, `.kaynaksiz`,
`.days`, `.pill` beş farklı dikey dolgu, dört punto ve üç dolgu-rengi
stratejisi taşıyor; aynı satırda üçü üç farklı yükseklikte. Büyük/küçük harf
de tutarsız (`Dilekçe` / `KAYNAKSIZ: 0` / `UDF deneysel` / `aktif dosya`).

```css
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font: var(--fs-200)/1.3 var(--ui);
  padding: 3px 9px;
  border-radius: var(--r-1);
  border: 1px solid transparent;
  background: var(--bg-sunk); color: var(--ink-2);
  white-space: nowrap;
}
.badge--ok      { background: var(--ok-tint);      color: var(--ok);
                  border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
.badge--warn    { background: var(--warn-tint);    color: var(--warn);
                  border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
.badge--bad     { background: var(--bad-tint);     color: var(--bad);
                  border-color: color-mix(in srgb, var(--bad) 30%, transparent); }
.badge--abstain { background: var(--abstain-tint); color: var(--abstain);
                  border-color: color-mix(in srgb, var(--abstain) 30%, transparent); }
.badge--seal    { background: var(--seal-tint);    color: var(--seal);
                  border-color: color-mix(in srgb, var(--seal) 30%, transparent); }
.badge--num     { font-family: var(--mono); font-variant-numeric: lining-nums tabular-nums; }
```

**Metin biçimi: cümle düzeni.** `Destekleniyor` · `Kaynaksız: 2` ·
`Sentetik kanıt` · `Aktif dosya` · `UDF — deneysel`. Yalnız dört durum damgası
(`TAM` `ŞERHLİ` `KISMİ` `ÇEKİMSER`) ve `KAYNAKSIZ` büyük harf kalır — bunlar
ürünün değişmez sözlüğüdür.

**Kalan gün rozeti — koyu tema P0.** Bugün `.days.late` beyaz metin `#e38074`
üstünde **2.76:1**, ve koyu temada çip açık renkli olduğu için görsel aciliyet
tersine dönüyor. Yeni: `.days--late` = `.badge--bad`, `.days--soon` =
`.badge--warn`, `.days--ok` = `.badge`, `.days--done` = `.badge--ok`.

**Cümle uzunluğundaki "rozet"ler rozet değildir.** Bugün tespit kartında
700 px genişliğinde bir hap var ("Sorunun doğrudan dayanağı — madde
numarasıyla birebir eşleşme"). Bu `.reason` satırı olur:

```css
.reason { font: var(--fs-200)/1.5 var(--ui); color: var(--ink-2);
          padding-left: 14px; border-left: 2px solid var(--bronze-line);
          max-width: var(--measure); }
```

**Kabul ölçütü.** Rozet sınıfı sayısı ≤ 7; eski yedi seçici kalmaz; koyu
temada `.days--late` kontrastı ≥ 4.5:1.

### 3.4 Kart

Bugün tek `.card` var ve **her şey karttır**: uyarı paneli, tablo sarmalayıcı,
boş durum, kanıt kartı, kenar sütunu, sistem durumu. Sonuç sıfır hiyerarşi —
dört ardışık özdeş beyaz dikdörtgen.

```css
.card { background: var(--surface); border: 1px solid var(--hair);
        border-radius: var(--r-3); padding: var(--s-5); box-shadow: var(--e-1); }
.card--flat   { box-shadow: var(--e-0); border-color: var(--line); }
.card--raised { box-shadow: var(--e-2); }
.card--quiet  { background: var(--bg-sunk); box-shadow:none; border-color: var(--hair); }
.card__head   { display:flex; align-items:center; justify-content:space-between;
                gap: var(--s-3); margin-bottom: var(--s-4); }
.card__title  { font: var(--fs-600)/var(--lh-600) var(--serif); margin:0; }
.card--selectable { cursor:pointer; text-align:left; width:100%; }
.card--selectable[aria-pressed="true"] { border-color: var(--seal); box-shadow: var(--e-2); }
```

**Kural:** bir ekranda `--e-2` taşıyan kart sayısı ≤ 1 (Dosyalarım'da
"Yaklaşan ve geciken süreler", Araştır'da verdict kartı).

### 3.5 Tablo

İki tablo bileşeni farklı dolgu ve başlık rengi kullanıyor; hiçbirinde
`tabular-nums`, sıralama göstergesi veya sabit başlık yok.

```css
.tbl { width:100%; border-collapse: collapse; font: var(--fs-400)/1.45 var(--ui); }
.tbl th { text-align:left; font: var(--fs-300)/1.4 var(--ui); color: var(--ink-3);
          letter-spacing: 0; padding: var(--s-2) var(--s-3);
          border-bottom: 1px solid var(--line); position: sticky; top: 0;
          background: var(--surface); z-index: var(--z-sticky); }
.tbl td { padding: var(--s-3); border-bottom: 1px solid var(--hair); vertical-align: top; }
.tbl tr:last-child td { border-bottom: 0; }
.tbl--rows tbody tr { cursor: pointer; }
.tbl--rows tbody tr:hover { background: var(--seal-tint); }
.tbl .num { text-align: right; font-variant-numeric: lining-nums tabular-nums; }
.scrollx { overflow-x: auto; }   /* `.scroll` ile birleştirilir — iki sınıf aynı işi yapıyor */
```

Satır yüksekliği ≥ 44px. **640 px altında tablo → kart listesi** (§4.3);
bugün 390 px'te tablo kendi kabında 611 px'e taşıyor ve `Durum` /
`Sonraki süre` / `Son işlem` sütunları ekran dışında kalıyor — **en kritik
bilgi (sıradaki süre) mobilde görünmüyor**.

### 3.6 Form alanı

Bugün `.tin` `border: 1px solid transparent` + `background: var(--panel-2)`
kullanıyor ⇒ alan sınırı **1.12:1** (koyuda 1.08:1); koyu temada form
neredeyse görünmüyor. `select.tin { appearance: auto }` ile
`select.matterpick { appearance: none } + ::after "▾"` aynı sayfada iki farklı
açılır menü dili kuruyor.

```css
.field {
  font: var(--fs-400)/1.5 var(--ui); color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--border);          /* 3.66:1 — artık görünür */
  border-radius: var(--r-2);
  padding: 9px 12px; min-height: var(--tap); width: 100%;
  transition: border-color var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease);
}
.field:hover { border-color: color-mix(in srgb, var(--seal) 45%, var(--border)); }
.field:focus-visible { outline:none; border-color: var(--seal); box-shadow: 0 0 0 3px var(--seal-tint); }
.field[aria-invalid="true"] { border-color: var(--bad); background: var(--bad-tint); }
textarea.field { font-family: var(--serif); font-size: var(--fs-500); min-height: 96px; resize: vertical; }
select.field { appearance: none; padding-right: 34px; }
.selectwrap { position: relative; }
.selectwrap::after { content: "▾"; position:absolute; right:12px; top:50%;
                     transform: translateY(-50%); pointer-events:none; color: var(--ink-3); }

.lab { display:block; font: var(--fs-200)/1.4 var(--ui); color: var(--ink-2); margin-bottom: 4px; }
.fieldlabel { font: var(--fs-200)/1.4 var(--ui); color: var(--bronze);
              letter-spacing: var(--tracking-label); margin-bottom: var(--s-2); }
.fieldhelp { font: var(--fs-200)/1.5 var(--ui); color: var(--ink-3); margin-top:4px; max-width: var(--measure); }
.fielderr  { font: var(--fs-200)/1.5 var(--ui); color: var(--bad); margin-top:4px; }
.fielderr:empty { display: none; }

.choice { display:inline-flex; }
.choice input { position:absolute; opacity:0; width:0; height:0; }
.choice span { display:inline-flex; align-items:center; min-height: var(--tap);
               padding: 8px 16px; border:1px solid var(--line); border-radius: var(--r-pill);
               background: var(--surface); color: var(--ink-2); font: var(--fs-300)/1 var(--ui);
               cursor:pointer; }
.choice input:checked + span { border-color: var(--seal); color: var(--seal); background: var(--seal-tint); }
.choice input:focus-visible + span { box-shadow: var(--ring); }
.choice input:disabled + span { background: var(--bg-sunk); color: var(--ink-3); cursor: not-allowed; }
```

**Doğrulama sözleşmesi.** Hatada: alana `aria-invalid="true"`,
`aria-describedby` ile `.fielderr` id'si, metin COPY §5.5 kalıbıyla
(*ne oldu · neden · sonraki adım*), ve **ilk hatalı alana odak**. Bugün
`.fielderr` var ama alan renk değiştirmiyor.

### 3.7 Modal / diyalog

Perde bugün `ink 36%` = **2.14:1** (arkadaki sayfa tam okunur kalıyor);
kaydırıldığında `Kapat (Esc)` düğmesinin `top` değeri **-560 px** oluyor
(erişilemez); tarayıcı geri tuşu modal açıkken altındaki ekranı sessizce
değiştiriyor.

```css
.modal { position: fixed; inset: 0; z-index: var(--z-modal);
         display: grid; place-items: center; padding: var(--s-4);
         background: var(--scrim); backdrop-filter: blur(2px); }
.modal[hidden] { display: none; }
.modal__panel { background: var(--surface); border:1px solid var(--line);
                border-radius: var(--r-4); box-shadow: var(--e-3);
                width: min(920px, 100%); max-height: 88vh;
                display:flex; flex-direction:column; }
.modal__head { position: sticky; top: 0; z-index: 1; background: var(--surface);
               border-bottom: 1px solid var(--hair); border-radius: var(--r-4) var(--r-4) 0 0;
               padding: var(--s-4) var(--s-5); display:flex; align-items:center;
               justify-content:space-between; gap: var(--s-3); }
.modal__body { overflow: auto; padding: var(--s-5); }
.modal__foot { border-top: 1px solid var(--hair); padding: var(--s-4) var(--s-5);
               display:flex; gap: var(--s-2); justify-content:flex-end; }
body.is-locked { overflow: hidden; }
```

**Davranış sözleşmesi (pazarlıksız):**

1. `role="dialog"`, `aria-modal="true"`, `aria-labelledby="<başlık id>"`.
2. Açılışta odak `.modal__panel[tabindex="-1"]`'e; kapanışta **tetikleyen
   öğeye** geri.
3. **Odak tuzağı**: `Tab`/`Shift+Tab` panel içinde döner.
4. `Esc` kapatır; kapatma düğmesi başlıkta ve **sticky**.
5. Açılışta `history.pushState({modal:id})`; `popstate` **yalnız modalı**
   kapatır, alttaki görünümü değiştirmez; kapatma `history.back()` ile.
6. Arka plan kaydırması kilitlenir (`body.is-locked`).
7. İkinci kaydırma çubuğu yalnız `.modal__body`de.

**Yerel `confirm()` kullanılmaz** — bugün kaydedilmemiş taslakla ayrılırken
tarayıcının kendi diyaloğu ("127.0.0.1:8931 diyor ki") çıkıyor. Yıkıcı ve
onaylı akışlar bu bileşeni kullanır. (`beforeunload` tarayıcı kısıtı olduğu
için sekme kapatmada kalabilir; uygulama içi gezinmede kalmaz.)

### 3.8 Bildirim (toast)

Tek `#toast` elemanı var; ikinci bildirim birincisini eziyor; koyu temada iki
varyant da AA'yı kırıyor (`#fff` üzerine `--ok` 2.08:1, `--bad` 2.76:1).

```css
.toasts { position: fixed; left:50%; bottom: var(--s-6); transform: translateX(-50%);
          z-index: var(--z-toast); display:flex; flex-direction:column; gap: var(--s-2);
          width: min(560px, calc(100vw - var(--s-8))); }
.toast { background: var(--ink); color: var(--surface);
         border-radius: var(--r-2); box-shadow: var(--e-3);
         padding: var(--s-3) var(--s-4); font: var(--fs-300)/1.5 var(--ui);
         border-left: 4px solid var(--ink-3);
         display:flex; gap: var(--s-3); align-items:flex-start; justify-content:space-between; }
.toast--ok   { border-left-color: var(--ok); }
.toast--warn { border-left-color: var(--warn); }
.toast--bad  { border-left-color: var(--bad); }
```

Renk yalnız **4px sol kenarda**; metin her zaman `--surface` üzerinde `--ink`
zemininde (her iki temada ≥ 12:1). Kuyruk en fazla 3 bildirim; süre `ok` 4 sn,
`warn` 8 sn, **`bad` otomatik kapanmaz** ve kapat düğmesi zorunludur. Kap
`role="status" aria-live="polite"`; `bad` için `role="alert"`.

Metin kalıbı: tek cümle, geçmiş zaman, nesne adlı — "Taslak kaydedildi — v3."
· "Süre dosyaya kaydedildi: Yılmaz / Kira tahliye."

### 3.9 Sekme

`role="tablist"` doğru ama **ok tuşu gezinmesi yok**; 480 px'te 5 sekme 4+1
kırılıp `AYARLAR` ortada tek kalıyor; aktif sekme koyu temada 2.45:1.

```css
.tabs { display:flex; gap: 4px; }
.tab { font: var(--fs-300)/1 var(--ui); letter-spacing:0; font-variant-caps: normal;
       padding: 10px 18px; min-height: var(--tap);
       border:1px solid transparent; border-radius: var(--r-pill);
       background: transparent; color: var(--ink-2); cursor:pointer; white-space:nowrap; }
.tab:hover { color: var(--seal); background: var(--seal-tint); }
.tab[aria-selected="true"] { background: var(--seal-solid); color: var(--on-seal); }

.subtabs { display:flex; gap: var(--s-4); border-bottom: 1px solid var(--line); }
.subtab { font: var(--fs-300)/1 var(--ui); padding: 12px 4px; min-height: var(--tap);
          background:none; border:0; border-bottom: 2px solid transparent;
          color: var(--ink-2); cursor:pointer; }
.subtab[aria-selected="true"] { color: var(--seal); border-bottom-color: var(--seal); }

@media (max-width: 640px) {
  .tabs, .subtabs { overflow-x:auto; flex-wrap:nowrap; scroll-snap-type: x proximity; }
  .tab, .subtab { scroll-snap-align: start; }
}
```

**Klavye (roving tabindex):** aktif sekme `tabindex="0"`, diğerleri `-1`;
`ArrowLeft`/`ArrowRight` komşuya (sarmalı), `Home`/`End` uçlara,
`Enter`/`Space` etkinleştirir. `aria-controls` + panelde `role="tabpanel"` +
`aria-labelledby`.

### 3.10 İlerleme, iskelet, boş durum

Bugün **dört ayrı ilerleme dili** var ve **yükleme iskeleti hiç yok**
(`skeleton` sınıfı yok, `aria-busy` hiç kullanılmıyor) — liste/tablo
yenilenirken alan boş kalıyor ve düzen sıçrıyor.

```css
/* 1. Belirsiz */
.runbar { height:3px; background: var(--bg-sunk); border-radius: var(--r-pill); overflow:hidden; }
.runbar .sweep { height:100%; width:40%; background: var(--seal);
                 animation: sweep 1.3s var(--ease) infinite; }
/* 2. Belirli */
.meter { display:grid; grid-template-columns: var(--label-col) minmax(0,1fr) 48px;
         align-items:center; gap: var(--s-3); font: var(--fs-200)/1.4 var(--ui); }
.meter__track { height:6px; background: var(--bg-sunk); border-radius: var(--r-pill); }
.meter__fill  { height:100%; background: var(--bronze-line); border-radius: var(--r-pill); }
.meter__val   { text-align:right; font-variant-numeric: lining-nums tabular-nums; }
/* 3. Adım listesi */
.steps { list-style:none; margin:0; padding:0; }
.steps li { display:flex; gap: var(--s-3); padding: var(--s-2) 0;
            border-bottom: 1px solid var(--hair); font: var(--fs-300)/1.5 var(--ui); }
/* 4. İskelet */
.skel { background: linear-gradient(90deg, var(--bg-sunk) 0%, var(--surface-2) 50%, var(--bg-sunk) 100%);
        background-size: 200% 100%; border-radius: var(--r-1);
        animation: skel 1.4s var(--ease) infinite; }
.skel--line { height: 1em; margin-bottom: var(--s-2); }
.skel--line:nth-child(3n) { width: 72%; }
@keyframes skel { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skel { animation:none; background: var(--bg-sunk); } }
```

İskelet **zorunlu** olduğu yerler: `#matterlist`, `#filelist`, `#deadlist`,
`#templates`, `#out`, `#docpage`, `#matterpage`. Sarmalayıcıya
`aria-busy="true"`, veri gelince `false`.

**Kural: sahte ilerleme yasak.** Sabit yüzdeli çubuk yok, "AI düşünüyor…"
tiyatrosu yok. Bekleme her zaman **ne yapıldığını** söyler: "Bedesten —
Yargıtay kararları taranıyor (3/12)". `research/progress.ts` 54 aracın Türkçe
etiketini zaten üretiyor.

**Boş durum.** Bugün iki desen var, hiçbiri sonraki adımı söylemiyor.

```css
.empty { display:grid; gap: var(--s-3); justify-items:start;
         padding: var(--s-7) var(--s-5); background: var(--bg-sunk);
         border: 1px dashed var(--line); border-radius: var(--r-3); }
.empty__mark  { font: var(--fs-800)/1 var(--serif); color: var(--bronze-line); }
.empty__title { font: var(--fs-600)/var(--lh-600) var(--serif); color: var(--ink); }
.empty p { font: var(--fs-300)/1.55 var(--ui); color: var(--ink-2); margin:0; }
```

Kalıp: **ne yok · nasıl doldurulur** + bir `.btn--secondary`. Yalnız yokluğu
bildiren boş durum yazılmaz.

### 3.11 Kaynak kartı, durum rozetleri, atıf çipi

Shepard's/KeyCite'ın öğrettiği dört kural (`W13-GLOBAL` §3.1): durum
**metinden önce** ve **başlığın solunda** gelir; derece vardır, ikili değildir;
örtük riskin ayrı bir adı vardır; **"bayrak yok" ≠ "temiz"**.

```
[K-3]  ● Olumsuz işlem taranmadı                      ← durum şeridi (en üstte)
Yargıtay 3. Hukuk Dairesi, E. 2023/4521, K. 2024/1187, T. 12.03.2024
[Yürürlükte 02.09.2026] [Bedesten (UYAP)] [Doğrulanmış alıntı]   ← .badge sırası
┌ "…birebir alıntı, serif, --fs-500, en çok 6 satır…" ┐
Tamamını göster · Bölüme git · Dayanak olarak kullan   ← .btn--quiet.btn--sm ×3
▸ Teknik künye                                        ← <details>, VARSAYILAN KAPALI
```

**Durum şeridi (`.authority`)** — `EvidenceView`'a eklenecek **additive**
`authoritySignal` alanına bağlanır:

| Değer | Rozet metni | Sınıf |
|---|---|---|
| `taranmadi` (**varsayılan**) | `Olumsuz işlem taranmadı` | `.badge` (nötr) |
| `aleyhe-var` | `Aleyhe atıf bulundu` | `.badge--warn` |
| `bozulmus` | `Bu karara aykırı içtihat var` | `.badge--bad` |
| `lehe` | `Aynı yönde atıf bulundu` | `.badge--ok` |
| `ortuk-risk` | `Dayanağı değişmiş olabilir` | `.badge--warn` |

Veri kaynağı `legal.document_relations` (enum zaten `AMENDS · REPEALS · CITES
· INTERPRETS · OVERRULES · RELATED`; `DEFAULT_CITATOR_KINDS` bugün yalnız
`AMENDS`+`REPEALS` izliyor). **Veri gelene kadar rozet her zaman `taranmadi`
gösterilir** — yeşil asla varsayılan olamaz.

**Alıntı kutusu.** `max-height:180px; overflow:auto` **kaldırılır** (üç iç içe
kaydırma çubuğunun kaynağı); yerine 6 satır kırpma + "Tamamını göster".

```css
blockquote.quote { font: var(--fs-500)/1.62 var(--serif); background: var(--surface-2);
                   border-left: 3px solid var(--bronze-line);
                   border-radius: 0 var(--r-2) var(--r-2) 0;
                   padding: var(--s-3) var(--s-4); margin: var(--s-3) 0;
                   max-width: var(--measure); }
blockquote.quote.is-clamped { display:-webkit-box; -webkit-line-clamp:6;
                              -webkit-box-orient:vertical; overflow:hidden; }
```

Alıntılar **cümle sınırında** kesilir, kelime ortasından değil (bugün
`"MADDE 157 - (1) Hileli davranışlarla … kendisi…"`).

**Teknik künye `<details>`.** `chunkId` (UUID), `konum N-M (Unicode karakter
sayımı)`, `Parmak izi (SHA-256)`, ham kod adları **buraya taşınır**. Belge
sayfasında bugün tek ekranda **19 UUID + 19 ofset satırı + SHA-256 +
ANTHROPIC_API_KEY** görünüyor. Ana akışta UUID **hiçbir zaman** görünmez.

**Satır içi atıf çipi ve hover önizleme (bugün yok).**

```css
.cite { display:inline-flex; align-items:center; font: var(--fs-200)/1 var(--ui);
        padding: 1px 6px; border-radius: var(--r-1); border:1px solid var(--seal);
        color: var(--seal); background: var(--seal-tint); cursor:pointer;
        vertical-align: baseline; text-decoration:none; }
.cite--broken { border-color: var(--bad); color: var(--bad); background: var(--bad-tint);
                text-decoration: line-through; }
.citepop { position:absolute; z-index: var(--z-popover); width: min(420px, 90vw);
           background: var(--surface); border:1px solid var(--line);
           border-radius: var(--r-3); box-shadow: var(--e-2); padding: var(--s-4);
           font: var(--fs-300)/1.5 var(--ui); }
.citepop[hidden] { display:none; }
```

İçerik: künye + yürürlük rozeti + **200 karakterde kesilmiş** alıntı +
"Kaynağa git". `mouseenter` 200 ms gecikmeyle, `focus` ile de açılır,
`Esc`/`blur`/`mouseleave` kapatır.

**Numaralandırma sözleşmesi:** satır içi `[K-n]` çipindeki numara, yan
paneldeki kart numarasıyla **birebir aynı**dır. Bu tek kural güven algısının
yarısıdır.

**Derin bağlantı.** `#parca-<chunkId>` çapası korunur, ama vurgulama **ofset
aralığı düzeyine** iner (ofsetler `EvidenceItem`de zaten var, ADR-003):
hedef bölüme gidildiğinde ilgili kod-noktası aralığı `<mark>` ile vurgulanır.

### 3.12 Tespit kartı ve uyarı bütçesi

Bugün bir cevap kartı **7 432 px = 8,3 ekran**; aynı feragat cümlesi kart
içinde **6 kez** tekrarlıyor. Bir KISMİ cevapta **11–14 uyarı bloğu / 20–24
cümle** görünüyor, ikisi birebir tekrar.

**Uyarı bütçesi — 3 sabit + 1 koşullu. Ölçüt: bir cevap ekranında en fazla
4 uyarı bloğu, en fazla 8 cümle; hiçbir cümle iki kez yazılmaz.**

| Sıra | Blok | İçerik |
|---|---|---|
| 1 | **Cevabın başı — tek blok** | Durum damgası + tek cümlelik anlamı + **aynı blok içinde** kesinleştirme cümlesi. Bugünkü 3+4+5 birleşir; ayrı "Kesinleştirilemez" bandı kalkar. |
| 2 | **Cevabın künyesi — tek liste** | Kapsam + karşılığı bulunamayan sözcükler + üretim yolu + veri kaynağı + (varsa) süre bütçesi / alıntı kısaltıldı / yalnız-yükleme. Cevap ekrandayken üstteki `.stamp` **gizlenir**. |
| 3 | **Cevabın sonu — Uyarılar kartı** | İşleyiş uyarıları + doğrulama gerekçeleri; P0 sınıfı kod yoksa **kapalı** `<details>` ("3 uyarı"). |
| 4 | **Koşullu şerit** | Yalnız DENEME KORPUSU'nda `#demobanner`. |

Kalanlar uyarı olmaktan çıkıp kendi bölümlerinin altına taşınır. Altbilgi
notu (5 kalıcı cümle) tek satır bağlantı olur: "Bu konsol nasıl çalışır? ·
Verileriniz nereye gider?" → Ayarlar › Verilerim nerede?

**Tespit kartı yapısı.** İlk **2 tespit açık**, kalanlar katlanmış
(`<details open>` / `<details>`). Feragat cümleleri kart başlığında **bir kez**;
tespitlerde yalnız farklılık kalır.

**Karşıt otorite tablosu — belge bazında tekilleştirme.** Bugün 11 satırda
3 farklı belge var (aynı Yargıtay kararı **3 kez**, aynı kanun **4 kez**,
hepsinde aynı gerekçe hücresi) ve üstteki özet "aleyhe karar bulunamadı"
derken tabloda `aksi sonuç (NEGATIVE)` üç kez görünüyor. Yeni sözleşme:
satır = **belge**; "hangi aramada bulundu" ayrı sütun/rozet; ham enum adları
Türkçe karşılığın arkasında `<details>` içinde.

**Çekimserlik bir duvar değil, yol ayrımıdır.** ÇEKİMSER kartı dört eylem
sunar: `Canlı kaynaklarda ara` · `Belge yükle` · `Soruyu daralt` ·
`Değerlendirme tarihini değiştir`.

### 3.13 Kanıt kenar çubuğu ve editör paragrafı

**Editörün gerçek gürültü kaynağı:** her paragrafın altında **6 buton**
(`Alıntı ekle · KAYNAKSIZ olarak bırak · Bu paragrafı yaz (Bulut AI) ·
Yukarı · Aşağı · Sil`) — mahkeme hitabı ve imza bloğu dahil. 40 paragraflık
bir dilekçede **240 özdeş buton**.

```css
.edpara { position:relative; padding: var(--s-3) var(--s-3) var(--s-3) 44px;
          border-radius: var(--r-2); }
.edpara:hover, .edpara:focus-within { background: var(--surface-2); }
.edpara .pno { position:absolute; left: var(--s-3); top: var(--s-3);
               font: var(--fs-200)/1.5 var(--mono); color: var(--ink-3);
               font-variant-numeric: lining-nums tabular-nums; }
.edpara .ptext { font: var(--fs-500)/1.7 var(--serif); }
.edpara__acts { position:absolute; top:4px; right:4px; display:none; gap:4px; }
.edpara:hover .edpara__acts, .edpara:focus-within .edpara__acts { display:flex; }
.edpara.is-unsourced { box-shadow: inset 3px 0 0 var(--seal); }
```

Görünür eylem **üçe** iner: `Alıntı ekle` · `Bulut AI` · `⋯` (menüde
`KAYNAKSIZ olarak bırak`, `Yukarı`, `Aşağı`, `Sil`). Dokunmatik cihazda
`focus-within` aynı işi görür. `⋯` menüsü `role="menu"`, öğeler
`role="menuitem"`, `ArrowUp/Down` + `Esc` + odak geri dönüşü.

**Kenar çubuğu.** Kart = `[K-n]` + künye + kırpılmış alıntı + `Bölüme git` +
`Paragrafa ekle`. `Kullanılmayan kaynaklar (alakasız görünüyor)` bölümü **iş
listesi** gibi sunulur: başlıkta sayaç, her satırda `İncele` / `Dayanak olarak
kullan`, karar denetim kaydına düşer.

**Çelişki düzeltmesi.** Kenar çubuğu K-1'i "hukuk alanı bu belgeyle uyuşmuyor"
diye işaretlerken, aynı K-1 `Alıntı ekle` penceresinde **hiçbir uyarı olmadan
ilk sırada** listeleniyor. Yeni kural: alaka kapısının elediği kanıtlar o
pencerede **ayrı başlık altında** ("Alakasız görünen kaynaklar") ve rozetli
listelenir.

**Birincil eylem tersine dönmüş — düzeltilir.** Bugün `Kaydet` hayalet, `DOCX`
dolu bordo. Yeni: `Kaydet` = `.btn--primary`; `DOCX` / `Markdown` / `UDF` bir
**"Dışa aktar"** menüsünde `.btn--secondary`.

**UDF etiketi.** `console.html:1647` dar ekranda `.edacts a.dl.udf .tag
{ display:none }` — 390 px'te düğme yalnız "UDF" diyor ve kalan tek uyarı
`title` ipucu dokunmatik cihazda **hiç görünmez**. Yeni: `deneysel` etiketi
**hiçbir kırılımda gizlenmez**; menüde satır `UDF (UYAP) — deneysel`.

### 3.14 Bırakma alanı

```css
.dropzone { display:grid; gap: var(--s-2); justify-items:center; text-align:center;
            padding: var(--s-7); border: 2px dashed var(--line);
            border-radius: var(--r-3); background: var(--bg-sunk); cursor:pointer; }
.dropzone:hover, .dropzone.is-over { border-color: var(--seal); background: var(--seal-tint); }
.dropzone:focus-visible { box-shadow: var(--ring); }
```

Durumlar: boşta → `is-over` → yükleniyor (dosya adı + iskelet satırı +
`.runbar`) → başarılı (satır listeye eklenir) → hatalı (§5.4).

### 3.15 Açılır bölüm (`<details>`) — teknik ayrıntı kabı

```css
details.trace { border-top: 1px solid var(--hair); margin-top: var(--s-3); }
details.trace > summary { cursor:pointer; list-style:none; padding: var(--s-2) 0;
                          font: var(--fs-200)/1.4 var(--ui); color: var(--ink-3); }
details.trace > summary::-webkit-details-marker { display:none; }
details.trace > summary::before { content: "▸ "; }
details.trace[open] > summary::before { content: "▾ "; }
details.trace .rawcode { font-family: var(--mono); font-size: var(--fs-100); color: var(--ink-3); }
```

**Kural:** UUID, ofset, SHA-256, ham enum (`NEUTRAL`, `EVIDENCE_CAP_APPLIED`,
`SCOPED_OUT_NORM_CONTENT`, `QUESTION_NOT_COVERED` …), HTTP kodu, uç yolu,
ortam değişkeni adı **yalnız** `details.trace` içinde görünür. Bugün bir
korpus cevabında 8 farklı kod ~40 kez ana akışta geçiyor.

---

## 4. EKRAN ŞARTNAMELERİ

### 4.1 Kabuk (her ekranda)

**Bugünkü ölçüm:** ilk açılışta içerik **537 px**'te başlıyor (1440×900
ekranın %60'ı başlık); içerikten önce **üç yığılmış banner** var (`.stamp` +
`.strip.demo` + `.strip.yellow`) ve 390 px'te bunlar **≈330 px** dikey alan
kaplıyor — ilk ekranın yarısı uyarı.

**Yeni kabuk (tek satırlık üst çubuk, büyük başlık yok):**

```
┌ 1px bordo üst çizgi ─────────────────────────────────────────────────┐
│ [§]ColleX   [Dosya: Yılmaz / Kira tahliye ▾]  [Ara: Ctrl+K]  [● Durum] [◐]│  ← 56px, sticky
├──────────────────────────────────────────────────────────────────────┤
│ Dosyalarım · Araştır · Karar ara · Belgeler · Taslak · Ayarlar        │  ← .tabs, 48px
├──────────────────────────────────────────────────────────────────────┤
│ Veri kaynağı — yerel korpus (collex_local) · 02.09.2026        [tek satır] │
└──────────────────────────────────────────────────────────────────────┘
```

| Değişiklik | Gerekçe |
|---|---|
| `body.compact` ile normal başlık ayrımı **kaldırılır**; hep kompakt. Büyük `.masthead` (monomark + `h1.brand` + `.tagline` + iki `hr.rule`) silinir. | İki başlık modu iki bakım yükü; büyük başlık yalnız ilk açılışta görülüyor ve profil kaydedilince sayfa **360 px yukarı sıçrıyor** (P2-15). |
| Üç banner **tek satıra** iner: `.stamp` kalıcı ve tek satır; `.strip.demo` `.stamp` içine `.badge--abstain` olarak; `.strip.yellow` (dosyasız çalışma) **üst çubuktaki dosya seçicisinin yanına** `.badge--warn` olarak. | Uyarı her yerde olduğunda hiçbir yerdedir. |
| `.stamp` cevap ekrandayken **gizlenir** (C18). | Aynı cümle iki kez yazılıyor. |
| Dosya seçici, **`GET /v1/matters` sonucuyla budanır**. | Bugün seçicide 6 dosya listeleniyorken uç 2 döndürüyor; ölü kimlik seçilince her araştırma `MATTER_NOT_FOUND` ile düşüyor ve konsol kendini toparlamıyor (P1-3). |
| Dosya seçicide **başlık + esas no** yazılır. | Aynı başlıklı iki dosya bugün ayırt edilemiyor. |
| `Ctrl+K` genel arama (§4.11). | |

**Duyarlılık:**

| Genişlik | Üst çubuk | Sekmeler | Gövde |
|---|---|---|---|
| **1920** | tam; kap 1152 px ortalanır | tam | `.g-doc`, `.g-editor` tam |
| **1440** | tam | tam | aynı |
| **1024** | tam | tam | `.g-editor` 3 sütun |
| **960** | üç durum hapı → tek "Durum" hapı | tam | `.g-editor` 2 sütun; **yatay kayma yok** |
| **768** | dosya seçici 2. satıra tam genişlik | tam | tek sütun ızgaralar |
| **390** | marka + Durum + Tema; dosya seçici 2. satır | yatay kaydırılabilir şerit (5–6 sekme tek satırda kalmaz, **sarmaz**) | tablo → kart listesi |

**Yazdırma:** kabuk tamamen gizlenir (`.masthead`, `.tabs`, `.statuspill`,
`.toasts`, `.modal`, `.btn`), yalnız içerik basılır (§5.6).

### 4.2 Dosyalarım (`#view-dosyalarim`)

```
[Yaklaşan ve geciken süreler]                     ← .card--raised, TAM GENİŞLİK, en üstte
  ┌ 08.09.2026 Salı  ┐  Cevap dilekçesi süresi     [6 gün]
  │  --fs-800, seal  │  Yılmaz / Kira tahliye
  └ tabular-nums ────┘  ▸ 3 gecikmiş süre           ← ayrı, katlanmış
  [Süre hesapla]  [Süreleri yenile]

[ Dosya ara ………………… ] [Tümü|Açık|Beklemede|Kapalı] [+ Yeni dosya]

[tablo: Dosya · Müvekkil / Karşı taraf · Esas no · Durum · Sonraki süre · Son işlem]
```

| Değişiklik | Gerekçe |
|---|---|
| Süre paneli başlığı **"Bugün / Bu hafta" → "Yaklaşan ve geciken süreler"** | Panel bugün başlığı "Bugün / Bu hafta" iken içinde `GECİKMİŞ — 212 gün` gösteriyor (P2-8). |
| **Gecikmişler ayrı ve katlanmış** bir alt bölümde; en üstte **en yakın gelecek** süre durur | `nextDeadline` bugün 49 gün geçmiş bir süreyi "sonraki süre" diye gösteriyor, 6 gün kalan gerçek süre arkasında kalıyor (`W13-DAILYFLOW` P1-3). |
| Tarih `--fs-800` + `tabular-nums` + `--seal`; kalan gün `.badge` | `.duebig` deseni ürünün en iyi tasarlanmış anı; çoğaltılır. |
| Tablo satır yüksekliği 44px, esas no sütunu `--mono` + sağa yaslı, hover `--seal-tint` | |
| **640 px altında tablo → kart listesi**: her kart = başlık (`--fs-600`) + müvekkil/karşı taraf + esas no + **sonraki süre rozeti** + son işlem tarihi | Bugün mobilde sonraki süre sütunu ekran dışında (P1-17). |
| Arama yer tutucusu kırpılmaz: `Dosya ara` (kısa), altında `.fieldhelp`: "Başlık, müvekkil, karşı taraf, mahkeme ve esas no aranır." | Bugün "…mahkeme, es" diye kesiliyor (P2-13). |
| `+ Yeni dosya` formunda gönderim kilidi + **"Aynı başlık/esas no ile açık dosya var"** uyarısı | P1-2. |
| Boş liste `.empty`: "Henüz dosya yok — **+ Yeni dosya** ile ilkini açın." | |

### 4.3 Dosya sayfası (`#view-dosya`)

```
Yılmaz / Kira tahliye                                       ← h1 --fs-800
İzmir 3. Sulh Hukuk Mahkemesi · E. 2026/123 · Dava · Açık   ← .fs-300 --ink-2
[Aktif dosya ⓘ]  [Sonraki süre: 08.09.2026 — 6 gün]         ← .badge --seal / --warn

[Belge yükle]  [Bu dosyada araştır]  [Taslak oluştur]        ← 1 primary + 2 secondary
Özet · Belgeler(4) · Zaman çizelgesi(6) · Süreler(4) · Cevaplar(14) · Taslaklar(1) · Notlar(2)
…
────────────────────────────────────────────────────────────
Tehlikeli bölge
  Bu dosyayı sil                                            ← .btn--danger, sayfanın EN ALTINDA
```

| Değişiklik | Gerekçe |
|---|---|
| Altı eşit ghost düğme → **üç** birincil/ikincil eylem; `Not ekle` / `Süre ekle` ilgili sekmenin içine; **`Dosyayı sil` ayrı "Tehlikeli bölge" bloğunda** | Bugün "Dosyayı sil" ile "Not ekle" görsel olarak eşit (P2-5). |
| `Aktif dosya` rozetine **ⓘ** ve `title` + tıklanınca tek cümlelik açıklama: bkz. §6.3 | Ürünün merkezî kavramı hiçbir yerde tanımlı değil; 4 çipin dördünde de `title: null` (P1-1). |
| Sekme başlıklarında **sayaç** | "Nerede kalmıştım" sorusunu tek bakışta cevaplar. |
| `Belge deposu: collex_demo` künye satırından **kaldırılır** | Veritabanı adı kullanıcı arayüzünde (P2-19). |
| Silme onayı §3.7 modalıyla, metin §6.6'daki birebir dize | Bugün nesnenin adı yok, geri alınamazlık söylenmiyor (D15). |

### 4.4 Araştır (`#view-arastir`) — form

| Değişiklik | Gerekçe |
|---|---|
| **Soru kutusu boş başlar.** Demo sorusu yalnız "Örnek sorular" şeridinde. | Bugün `#q.value === #q.placeholder`; fark edilmeden basılınca bir kira dosyasına ceza hukuku araştırması otomatik dosyalanıyor (P1-14). |
| Kapsam seçicisinde **varsayılan**: yerel korpus boşsa "Canlı kaynaklar — derin araştırma"; boş korpus deposu "(boş — kendi belgelerinizi yükleyin)" diye etiketlenir. | Boş korpusta her soru ÇEKİMSER dönüyor; ilk izlenim "çalışmıyor". |
| `--with-mcp`, `ColleX-Baslat.cmd`, `ANTHROPIC_API_KEY` satırları formdan **çıkarılır**; yerine §6.5'teki cümleler. | Makine sözlüğü avukatın önünde, üstelik daktilo yazısıyla (P1-8). |
| Soru kutusuna `maxlength` + karakter sayacı (son 500 karakterde görünür) | 330 000 karakterlik soru bugün "İstek geçersiz — alanları kontrol edin." veriyor (P2-14). |
| Filtre kutusu genişletilir: `Merci` (Yargıtay/Danıştay/BAM/AYM/kurul), `Daire`, `Yıl aralığı`, `Hariç tutulacak kelimeler` | Rakip bunları satıyor; MCP araçları parametreleri zaten destekliyor, konsol açmıyor. |
| Gönderim kilidi zaten var (3 tık → 1 POST) — **korunur**. | |

### 4.5 Araştır — cevap görünümü

**Bugünkü ölçüm:** belge sorusu cevabı **7 432 px = 8,3 ekran**; korpus
sorusu 6 804 px; aynı boilerplate 6 kez; ~40 İngilizce makine kodu geçişi.

```
┌ VERDICT KARTI (.card--raised) ─────────────────────────────────────┐
│  ●  TAM                                                            │  ← --fs-900, madalya 56px
│  Tüm tespitler doğrulanmış kaynağa bağlı.                          │  ← değişmez cümle
│  KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî  │  ← aynı blokta
│  değerlendirme avukatındır                                         │
│  ┌ 4 ┐ ┌ 4 ┐ ┌ 02.09.2026 ┐                                        │  ← .stat üçlüsü, kelimenin ALTINDA
│  kaynak tespit  değerlendirme tarihi                               │     --fs-700 sayı + --fs-200 etiket
└────────────────────────────────────────────────────────────────────┘
Künye (tek liste): Kapsam · Karşılığı bulunamayan sözcükler · Üretim · Veri kaynağı
[sticky ince çubuk] § 1 Tespitler · § 2 Kaynaklar · § 3 Karşıt otorite · § 4 Uyarılar
§ 1 TESPİTLER   (ilk 2 açık, kalanlar katlanmış)
§ 2 KAYNAKLAR   (kalıcı sağ panel ≥1200px; altında liste <1200px)
§ 3 KARŞIT OTORİTE  (belge bazında tekilleştirilmiş tablo)
§ 4 UYARILAR    (<details>, kapalı, "3 uyarı")
```

| Değişiklik | Gerekçe |
|---|---|
| `.ledger` sağa yaslı mono `--ink-faint` yerine **`.stat` üçlüsü**, kelimenin altında | Sayfadaki en önemli sayaçlar en zayıf tipografide. |
| `h2.section` `--fs-700` (21px) — gövdeden **büyük** | Bugün 17px small-caps; gövdeden (15.5px) küçük görünüyor. |
| **Kalıcı kaynak paneli** (üç bölgeli düzen) ≥1200 px: anahat / cevap / kaynaklar. Modal değil. | Editör bunu yapıyor, cevap görünümü yapmıyor (`W13-GLOBAL` §9.1/1). |
| Boilerplate kart başlığında **bir kez** | 6 kez tekrar. |
| ÇEKİMSER için ayrı, nötr metin + dört eylem (§3.12) | "en az bir doğrulama başarısız" yanıltıcı (P1-19). |

### 4.6 Belgeler (`#view-belgeler`)

| Değişiklik | Gerekçe |
|---|---|
| **Yükleme sonucu çağıran görünüme bildirilir.** `uploadFiles` bir `onError` geri çağrısı alır; hata kartı, yüklemeyi başlatan görünüme yazılır. | `console.html:3771` hata kartını `#fileerrors`/`#filelist`e, yani gizli `#view-belgeler` içine yazıyor; dosya sayfasından yüklenen taranmış PDF **sessizce** düşüyor (P0-2). |
| `okCount === 0` hâlinde de bildirim çıkar, `tone: "bad"`. Kısmî başarıda bildirim **başarısız dosyanın adını ve nedenini** taşır. | `console.html:3786` `if (okCount)` yüzünden hiç bildirim çıkmıyor; kısmî başarıda yeşil "1/2 belge yüklendi" çıkıyor. |
| Süzgeç satırı düzeltilir: `Dosya` etiketi kendi `select`inin **üstünde**, `select` genişliği ≤ 320 px | Bugün etiket arama kutusunun sağında (x=660), `select` 1 068 px genişliğinde (P2-3). |
| Bırakma alanı metni: "Belge bırakın veya seçin — PDF, Word (DOCX), düz metin (TXT), UYAP belgesi (UDF)" | Bugün yalnız uzantı kısaltmaları (D25). |
| Boş liste `.empty`: "Henüz belge yok — UYAP'tan indirdiğiniz tebligat, karar veya dilekçeyi buraya bırakın." | |

### 4.7 Belge sayfası (`#view-belge`) — en büyük tek kazanç

**Bugünkü ölçüm:** 1440 px genişlikte **4 321 px yükseklik**; sol pane
≈570 px'te bitiyor, sağ sütun 3 700 px daha akıyor ⇒ ekranın sol yarısı
3 700 px boyunca boş. Sağ sütun düz bir yığın: `BELGEYE SOR` → `TARAFLAR` →
`ATIFLAR` (17 satır, `HMK m.127` ve `TCK m.157` ikişer kez) → `TARİHLER`
(11 satır) → `TALEPLER` → `AI ANALİZİ` → `SORULAN SORULAR`. Katlama yok,
sayaç yok, önceliklendirme yok. Tek sayfada **19 UUID**.

```
kira_sozlesmesi.txt                                   ← h1 --fs-800
Yılmaz / Kira tahliye · 13 bölüm · yüklendi 25.08.2026 ← --fs-300 --ink-2
[Atıfları denetle]  [Bu belgeye sor]  [Taslakta kullan]

┌ SOL (sticky, max-height: calc(100vh - 24px)) ┬ SAĞ (subtabs) ─────────┐
│ Belge metni, bölüm bölüm, çapalı             │ Sor · Künye · Atıflar(13)│
│ (mobilde max-height: none)                   │ · Tarihler(11) · Talepler│
│                                              │ · Bulut AI               │
└──────────────────────────────────────────────┴──────────────────────────┘
```

| Değişiklik | Gerekçe |
|---|---|
| Sağ sütun **`.subtabs`** ile bölünür; sekme başlığında sayaç | 4 321 px → ~1 400 px. |
| `ATIFLAR`: yinelenenler birleştirilir (`HMK m.127 ×2`); satırda **tek** `Doğrula` düğmesi; madde no `.badge--num` | Bugün 17 satır ve her satırda özdeş iki düğme. |
| `TARİHLER`: iki düğme yerine satır + hover'da beliren eylemler; bağlam metni **cümle sınırında** kesilir | Bugün 7 parçanın hepsi kelime ortasından başlıyor ve bitiyor (P1-18). |
| **UUID / ofset / SHA-256 satırı ana akıştan çıkar** → `details.trace` ("Teknik künye") | 19 UUID + 19 ofset; mobilde `Parmak izi (SHA-256)` **ilk** görünen alan. |
| Sol pane `position: sticky; align-self: start`; **900 px altında `max-height: none`** | Telefonda belge metni ekranın yarısında kendi kaydırmasıyla hapsoluyor. |
| Mobilde ilk ekranda **belge metni ve "Belgeye sor"** olur, künye değil | |
| Boş durumlar sonraki adımı söyler (§6.7 tablosu D3) | |

### 4.8 Taslak — şablon seçimi ve form

**Bugünkü ölçüm:** 13 kartlı katalog seçimden sonra **açık kalıyor**, form
**2 581 px** aşağıda başlıyor ve sayfa **kaydırılmıyor** (`scrollY` 8'de
kaldı). Kart içeriği dikey ortalı olduğu için bir satırdaki dört başlık
44–58 px kayıyor. 240 px sütunda 13px metin = 32 karakter/satır.

| Değişiklik | Gerekçe |
|---|---|
| Katalog `.g-auto` (`minmax(300px,1fr)`), `align-items: start`, `grid-auto-rows: 1fr`; açıklama **2 satıra kırpılır**; "Zorunlu alanlar" `<details>` içinde ve `--ui` ile | Kart tabanları rastgele; açıklamalar 8–12 satır; zorunlu alan listesi 10.5px monospace Türkçe cümle. |
| **Seçimden sonra katalog tek satırlık şeride iner**: "Seçilen şablon: Cevap Dilekçesi — **değiştir**" ve forma `scrollIntoView({block:'start'})` | Avukat karta basıyor, ekranda hiçbir şey değişmiyor (P1-5). |
| Katalogda arama/filtre kutusu (13 kart) | |
| Alan grubu başlıkları düzeltilir: sözleşme/ihtarname/arabuluculuk şablonlarında "Mahkeme ve dosya" yerine **"Belge künyesi"** | Sözleşme formunda mahkeme alanı olmayan "Mahkeme ve dosya" kutusu görünüyor (C15). |
| `Kanıt kaynağı` → "Son araştırma" seçilince **soru metni + tarih + hüküm** yazılır, UUID değil | Bugün tek bilgi `kullanılacak araştırma no: 8b0b0018-f4c…` (P1-20). |

### 4.9 Taslak — editör

| Değişiklik | Gerekçe |
|---|---|
| Paragraf başına 6 düğme → **3 görünür öğe** (§3.13) | Editörün gürültü kaynağı. |
| `Kaydet` = `.btn--primary`; dışa aktarma menüde `.btn--secondary` | Sayfadaki tek dolu buton kaydetmek değil dışa aktarmak. |
| Sağ panelde `blockquote` iç kaydırması kaldırılır (6 satır kırpma) | 1920 px'te aynı anda **üç** kaydırma çubuğu görünüyor. |
| `.edoutline` noktalarına **şekil + Türkçe durum adı**: `● Temiz` / `▲ Karşı içtihat` / `■ Kaynaksız`; `.olegend` renk adlarıyla değil durum adlarıyla yazılır | WCAG 1.4.1; bugün lejant "● yeşil: KAYNAKSIZ yok" diyor — renk körü için hiçbir şey eklemiyor. |
| Sürüm penceresi: her satırda **yerel saat**, KAYNAKSIZ sayısı, "ne değişti" özeti ve kayıt notu | `GET /v1/drafts/{id}/versions` v1 ve v2 için **aynı** `createdAt` döndürüyor; iki satır ayırt edilemiyor (P1-4). Not: tarih hatası arka uç işidir; arayüz **aynı iki tarih gelirse** "sürüm saatleri ayırt edilemiyor" satırı gösterir, sahte bir sıra uydurmaz. |
| Taslak uyarıları kartı: **KAYNAKSIZ sayısı > 0 ise açık** gelir | En kritik uyarı bugün katlanmış "Taslak uyarıları (5)" içinde ve sayı sessizce büyüyor. |
| Yazdırma görünümü editörün **varsayılan önizlemesi** olur (`body.editing` yazdırma stili, A4) | UYAP'a alışkın göz A4/serif/blok paragraf bekler. |

### 4.10 Süreler

Ürünün **en iyi yüzeyi**; korunur ve şu üç şey eklenir:

| Değişiklik | Gerekçe |
|---|---|
| Modal başlığı sticky (§3.7) | Kaydırınca `Kapat (Esc)` erişilemez oluyor (P1-15). |
| Kural açıklamaları ve hesap adımları **`--ui` ile**, monospace değil | Kanun metni kod değildir (P2-9). |
| Sonuç kartında büyük tarih (`--fs-900`, `--seal`, `tabular-nums`) + `DOĞRULANMADI — madde metniyle kontrol edin` rozeti + `DEADLINE_DISCLAIMER` **birebir** | Değişmez cümleler korunur. |
| Adli tatil kutusu **üç durumlu**: "Adli tatile tâbi" / "Tâbi değil" / "Bilmiyorum". Üçüncüde uzatmasız ve uzatmalı **iki tarih** birlikte gösterilir. | HMK m.104 uzatması yalnız adli tatile tâbi işlerde ve yalnız son gün tatile rastlarsa uygulanır; bugün kutu kural bazında önceden işaretli geliyor ve **güvensiz tarafta** hata üretebilir. |

### 4.11 Ayarlar

| Değişiklik | Gerekçe |
|---|---|
| `.g-form` düzeltmesi; `Adres` `span2`; alanlarda görünür kenarlık (§3.6) | Ayarlar ızgarası düzensiz; alanların kenarlığı yok (P2-11). |
| Yer tutucular gerçek örnek olur, dolu sanılmaz: "Örn. İzmir Barosu" | "İzmir Barosu" ve "Avukat" bugün yer tutucu; dolu sanılıp geçilebiliyor. |
| **Tek tema kaynağı**: üst çubuk düğmesi de `PUT /v1/settings` yazar; `localStorage` yalnız önbellek | Bugün iki kontrol iki farklı yere yazıyor; başka tarayıcıda tema kayboluyor (P2-16). |
| **"Verilerim nerede?"** kartı korunur ve üç satırla güçlendirilir (§6.8) | Ürünün en güçlü konumu. |
| Sistem durumu kartında `Kota yok` satırı: "Sorgu, dilekçe ve dışa aktarma sayısı sınırsızdır." | Rakiplerin kota belirsizliğine karşı doğrulanabilir tek cümle. |
| Kaydetme sonrası **sayfa sıçraması yok** (kompakt başlık kalktığı için sorun kendiliğinden düşer) | P2-15. |

### 4.12 YENİ — Karar arama (`#karar-ara`)

Arka uç: `POST /v1/sources/search`, `POST /v1/sources/fetch` (`W13-FEATURE`
F1). Arayüz şartnamesi:

```
[ Arama metni …………………………… ]  [Ara]
Merci: [Yargıtay ▾] Daire: [3. Hukuk Dairesi ▾] Yıl: [2020]–[2025]
Karar türü: [ ] Tümü [ ] Onama [ ] Bozma      Hariç tut: [………]
Kayıtlı aramalar: [Tahliye taahhüdü ×] [Munzam zarar ×]

──────────────────────────────────────────────────────────────
Yargıtay 3. HD, E. 2023/4521, K. 2024/1187, T. 12.03.2024
  "…eşleşen cümle, --fs-400, tek satır kırpılmış…"
  [Tam metni getir]  [Dosyaya kaydet]  [Taslakta kullan]
  ● Olumsuz işlem taranmadı
──────────────────────────────────────────────────────────────
```

- Sonuç satırı **liste** düzenindedir (kart değil): künye + eşleşen cümle +
  üç `.btn--quiet.btn--sm` + durum rozeti. Satır yüksekliği ≤ 96 px.
- `Tam metni getir` satırı yerinde **hash'li kaynak kartına** genişletir
  (§3.11); sayfa değiştirmez.
- Bekleme: `.steps` ile hangi kaynakta olunduğu yazılır; sahte yüzde yok.
- Sonuç yoksa `.empty`: "Bu ölçütlerle karar bulunamadı — merci veya yıl
  aralığını genişletin."
- Kaynak erişilemezse hata **kaynak adıyla**: "Bedesten bugün cevap vermedi;
  diğer kaynaklardaki sonuçlar aşağıda." (kısmî sonuç gösterilir, sessiz boş
  liste **asla**).
- 640 px altında filtre satırı `<details>` içine iner ("Filtreler (3)").

### 4.13 YENİ — Genel arama (`Ctrl+K` paleti)

Arka uç: `POST /v1/search` (bugün kullanılmıyor) + `GET /v1/matters/search`
(`W13-FEATURE` F6).

```
┌ .modal__panel, 640px, üstte ─────────────────────────┐
│ [ depozito …………………………………………… ]                    │
│ DOSYALAR (2)                                          │
│   Yılmaz / Kira tahliye · E. 2026/123                 │
│ BELGELER (3)                                          │
│   kira_sozlesmesi.txt — "…depozito bedeli…"           │
│ NOTLAR (1) · SÜRELER (0) · CEVAPLAR (4) · TASLAKLAR(1)│
└───────────────────────────────────────────────────────┘
```

- `role="dialog"` + `role="listbox"`/`role="option"`; `ArrowUp/Down` gezer,
  `Enter` açar, `Esc` kapatır, odak kutuya, kapanışta tetikleyiciye.
- Gruplar tür başlığıyla; her grupta en fazla 5 satır + "tümünü göster".
- Eşleşen ibare satır içinde `<mark>` ile vurgulanır.
- 300 ms debounce; 500 ms'den uzun sürerse `.skel--line` ×3.
- Boş sorgu: son 5 açılan dosya + "Ne arayabilirsiniz: dosya adı, belge
  içeriği, not, süre başlığı."

### 4.14 YENİ — Atıf denetim raporu

Belge sayfasındaki `Atıfları denetle` düğmesinin çıktısı (`W13-FEATURE` F4).
Tam genişlik tablo, `--fs-400`:

| Atıf | Bulundu | Dilekçe tarihi itibarıyla | Aleyhe kayıt | Eylem |
|---|---|---|---|---|
| `İİK m.363/1` | ✓ | `Yürürlükte 12.03.2024` | `Aleyhe atıf bulundu` | Tam metne git |
| `HMK m.999` | ✕ **Bulunamadı** | — | — | — |

- `Bulunamadı` satırı **asla uydurulmuş bir künye göstermez**; hücre boş kalır.
- Tablo üstünde tek cümlelik özet ve **denetim tarihi**; altında
  `Raporu indir (DOCX)`.
- Rapor, avukatın "gereken özeni gösterdim" diye saklayabileceği belgedir;
  her satırda **yeniden doğrulama tarifi** bulunur.

### 4.15 Yazdırma

Bugün **iki ayrı `@media print` bloğu** var (satır 1425 ve 1603), `@page`
kuralı yok, birim karışıyor (`12pt` ↔ `18px`), varsayılan baskıda `.wrap`
920 px + 120 px alt dolgu korunuyor.

```css
@page { size: A4; margin: 25mm 20mm 22mm 25mm; }
@media print {
  :root { --surface:#fff; --bg:#fff; --surface-2:#fff;
          --ink:#000; --ink-2:#333; --ink-3:#555;
          --hair:#ccc; --line:#999; --border:#666; }
  body { font: 11.5pt/1.5 var(--serif); border-top: 0; }
  .masthead, .tabs, .statuspill, .toasts, .modal, .btn, .runbar,
  .dropzone, .edpara__acts, details.trace { display: none !important; }
  .wrap { max-width: none; padding: 0; }
  .card, .verdict { box-shadow:none; border:0; break-inside: avoid; }
  h2.section, .card__title { font-size: 12pt; break-after: avoid; }
  .edpara { padding: 0 0 6pt 26pt; }
  .edpara .pno { font-size: 10pt; }
  blockquote.quote { break-inside: avoid; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; }
}
```

İki blok **birleştirilir**; `body.editing` farkı yalnız "kabuk gizle"
satırlarıydı, o da artık genel kuralda.

---

## 5. ETKİLEŞİM KURALLARI

### 5.1 Klavye haritası

| Tuş | Bağlam | Eylem |
|---|---|---|
| `Ctrl+K` | her yer | Genel arama paleti (§4.13) |
| `Ctrl+Enter` | soru kutusu, taslak formu | Gönder |
| `Ctrl+S` | editör | Kaydet (**korunur**, bugün çalışıyor) |
| `Esc` | modal, popover, menü | Kapat (en içteki önce) |
| `Tab` / `Shift+Tab` | modal | Panel içinde döner (tuzak) |
| `←` `→` `Home` `End` | `.tabs`, `.subtabs` | Roving tabindex gezinme |
| `↑` `↓` `Enter` | `⋯` menüsü, arama paleti | Gezinme + seçim |
| `Enter` / `Space` | `.card--selectable`, tablo satırı | Aç |
| `Alt+1..6` | her yer | Sekmeye git (Dosyalarım…Ayarlar) |

**Atlama bağlantısı:** `<body>`'nin ilk odaklanabilir öğesi
`.skiplink` — "İçeriğe atla" (`--seal-solid` üzerinde `--on-seal`, yalnız
odakta görünür).

### 5.2 Odak yönetimi

- **Odak halkası (P0 düzeltmesi).** Bugün `outline-style: none` ve tek
  gösterge `box-shadow 0 0 0 3px rgba(125,42,51,.18)` ⇒ **≈1,4:1**; WCAG 2.2
  (2.4.11/2.4.13) 3:1 ister.

```css
:where(button, a, [tabindex], select, input, textarea,
       [contenteditable], summary):focus-visible {
  outline: none;
  box-shadow: var(--ring);
  border-radius: inherit;      /* hap butonda hap halka */
}
```
Yeni oran: açık **9.43:1**, koyu **7.72:1**. `border-radius: inherit` bugünkü
`var(--r-sm)` sabitini değiştirir (hap butonlarda kare halka çiziyordu).

- Görünüm değişiminde odak yeni görünümün `<h1>`/`<h2>`'sine
  (`tabindex="-1"` + `.focus()`), sayfa başına kaydırma.
- Modal/popover/menü: aç → içeri, kapat → tetikleyiciye.
- Form hatası: **ilk hatalı alana** odak.
- Silme sonrası odak, silinen satırın komşusuna; liste boşaldıysa `.empty`
  içindeki eyleme.

### 5.3 Yükleme ve iyimser davranış

| Durum | Davranış |
|---|---|
| Liste/tablo ilk yükleme | `.skel--line` ×5 + `aria-busy="true"` |
| Liste yenileme | Mevcut içerik durur, üstte `.runbar`; **boşaltılmaz** (düzen sıçraması yok) |
| Form gönderimi | Buton `disabled` + `.btn--busy`; metin sabit; `.timing`e durum |
| Uzun iş (canlı araştırma) | `.steps` listesi, her adımda kaynak adı ve çağrı sayısı |
| İyimser güncelleme | **Yalnız** geri alınabilir ve yerel işlerde (not silme, sekme değişimi). Cevap, taslak, süre, belge: iyimser güncelleme **yok** — sonucu sunucu söyler |

### 5.4 Hata kurtarma

Kalıp: **ne oldu · neden · sonraki adım**. Makine kodu Türkçe cümleden
**sonra**, `details.trace` içinde.

| Olay | Yüzey | Kurtarma |
|---|---|---|
| Yükleme başarısız | Çağıran görünümde **görünür** hata kartı + `tone:"bad"` bildirim (dosya adı + neden) | "Aranabilir PDF olarak yeniden kaydedin" / "Bulut OCR" (metin bugün zaten mükemmel yazılmış, yalnız görünmüyor) |
| `MATTER_NOT_FOUND` | Aktif dosya **temizlenir**, seçici budanır, tek cümlelik bildirim | §6.6'daki dize |
| `STORE_UNAVAILABLE` | Tam sayfa `.card--quiet` + "Yeniden dene" | Sunucu penceresi yönlendirmesi **yok** (tek kullanıcı) |
| `PAYLOAD_TOO_LARGE` | Alan düzeyinde, hangi sınırın aşıldığı yazılır | §6.6 |
| `EXPORT_REFUSED` | Modal, hangi atfın doğrulanamadığı listelenir | "Paragrafı düzeltin ya da KAYNAKSIZ olarak işaretleyin" |
| Ağ/zaman aşımı | `.toast--bad` (otomatik kapanmaz) + "Yeniden dene" düğmesi | |
| Kısmî başarı | **Yeşil değil** `.toast--warn`; başarısızın adı ve nedeni | |

### 5.5 Aria sözleşmesi

| Öğe | Sözleşme |
|---|---|
| Görünümler | `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby` |
| Canlı bölgeler | Sonuç kapları `aria-live="polite"`; hata bildirimi `role="alert"`; ilerleme `aria-live="polite"` + `aria-busy` |
| Modal | `role="dialog" aria-modal="true" aria-labelledby` |
| Menü | `role="menu"` / `role="menuitem"` |
| Rozet | Yalnız görsel değil; metin `textContent`te; ek bilgi `aria-label` değil **görünür metin** |
| `.hashline .h` kopyala | `aria-label="Özeti kopyala"` + kopyalandı bildirimi `aria-live` |
| Tablo | `<caption>` (görsel olarak gizli değil — başlık zaten var), `scope="col"` |
| Dekoratif SVG | `aria-hidden="true"` |
| Sayfa dili | `<html lang="tr">` (**korunur**) |

### 5.6 Hareket ve `prefers-reduced-motion`

§1.6'daki tek blok. Ek kural: hiçbir animasyon etkileşimi engellemez
(`pointer-events` kapatılmaz); `viewIn`/`rise` sırasında sayfa tıklanabilir
kalır (bugün doğru, korunur).

---

## 6. METİN SİSTEMİ

### 6.1 Ses

- **Kesin, sakin, saygılı.** Üç parça: *ne oldu · neden · şimdi ne yapın*.
- **Özür dileme.** "Üzgünüz", "maalesef", "lütfen" kullanılmaz.
- **Alarm kurma.** "Dikkat!", "mutlaka", ünlem işareti yok. Ciddiyet büyük
  harfli damgayla verilir (KAYNAKSIZ, KESİNLEŞTİRİLEMEZ, DOĞRULANMADI), ton
  yükseltmekle değil.
- **Şirinlik yok.** Emoji, espri, "Hadi başlayalım" yok.
- **Satış yok.** "güçlü", "akıllı", "gelişmiş", "kolayca" yasak. Ürün ne
  yaptığını söyler, ne kadar iyi olduğunu söylemez.
- **Fail belli.** "Yapılamadı" değil, "ColleX bunu yapamadı" / "Sunucu cevap
  vermedi".
- **Hukukçuya hukukçu gibi.** "dava şartı", "hak düşürücü süre", "def'i",
  "tefhim" açıklanmadan kullanılır. Buna karşılık **hiçbir yerde**: uç, mod,
  parametre, gövde, enum, token, entailment, fixture, chunk, upstream, cache,
  timeout, snippet.
- **Tek kullanıcı.** "Sistemi başlatan kişi", "yöneticinize başvurun",
  "ekibiniz" yok.

### 6.2 Sözlük — bir kavram, bir sözcük

| Kavram | Tek doğru sözcük | Kullanılmayacak |
|---|---|---|
| Dava/danışmanlık işi | **dosya** (dava dosyası) | matter, iş, klasör |
| Yüklenen belge | **belge** | dosya, doküman, evrak |
| Belgenin bir parçası | **bölüm** | parça, chunk, segment |
| Kanıt olarak gösterilen pasaj | **kaynak** (kart) / **kanıt** (küme) | referans, delil |
| Dilekçede sayılan delil | **delil** / **Ek-n** | kanıt |
| Paragrafın bağlandığı kaynak | **dayanak** | referans (atıf = gövdedeki [K-n]) |
| Cevaptaki tek önerme | **tespit** | iddia, claim, bulgu |
| Bulut hattı — kısa etiket | **Bulut AI** | Bulut Yapay Zekâ, bulut ai, Cloud AI |
| Bulut hattı — düzyazı | ilk anışta **bulut yapay zekâ (Bulut AI)** | yapay zeka (şapkasız) |
| "Bulut AI" ekleri | AI'**yı**, AI'**nın**, AI'**dır**, AI'**ya** | AI'yi, AI'nin |
| Hukuk metni deposu | **yerel korpus** | veritabanı, depo |
| Ürün veritabanı | **veritabanı** | korpus |
| Canlı derin araştırma | **canlı araştırma** | MCP geçidi, deep research |
| Süre hesabı | **süre** | deadline, termin |

**Yazım:** tarih her zaman `GG.AA.YYYY`, saat `SS:dd` **yerel saat**;
madde atfı `HMK m.127/1`; diakritik `hukukî · resmî · hâl · zekâ · vekâlet`
şapkalı, `ticari · cezai · idari · dahil` şapkasız; yüzde `%50`; düşünce
çizgisi `—`, aralık `–`, birleştirme `-`; tırnak `“…”`.

### 6.3 Yeni öğeler için birebir dizeler — kavram tanımları

Bugün `KAYNAKSIZ` editörde **22+ kez** geçiyor ama **tek bir tanım cümlesi
yok**; `K-1…K-n` hiçbir yerde açıklanmıyor; `aktif dosya` 4 çipin dördünde de
`title: null`.

| Öğe | Birebir metin |
|---|---|
| `Aktif dosya` ipucu | `Aktif dosya — bu ekranda üretilen cevaplar, yüklediğiniz belgeler ve taslaklar bu dava dosyasına bağlanır.` |
| `KAYNAKSIZ` tanımı (editör başlığında bir kez) | `KAYNAKSIZ — bu paragrafın hukukî dayanağı doğrulanmış bir kaynağa bağlanamadı. Dosyaya vermeden önce dayanağı siz eklemelisiniz.` |
| `K-n` tanımı (Kanıtlar paneli başlığında bir kez) | `K-1, K-2 … bu cevaptaki kaynakların numarasıdır; metindeki [K-n] işareti aynı numaralı kaynağa gider.` |
| `Ek-n` tanımı | `Ek-1, Ek-2 … dilekçeye eklenen belgelerin sırasıdır.` |
| `sürüm` tanımı | `Sürüm — her Kaydet işlemi yeni bir sürüm oluşturur; önceki sürümler silinmez.` |
| `deneysel` (UDF) | `deneysel — UYAP Doküman Editörü'nde açarak doğrulayın` *(değişmez)* |
| `Sentetik kanıt` rozeti | `Örnek metin — gerçek karar değil` |

Son satır bilinçlidir: "(SENTETİK)" kelimesi bir avukat için hiçbir şey ifade
etmez ve "sahte karar üretiyor" izlenimi verir.

### 6.4 Değişmez cümleler (dört yüzeyde birebir aynı)

`console.html`, `answer/renderer.ts`, `export/text.py`, `drafting/markdown.ts`
— **karakteri karakterine**, **noktasız**:

1. `TAM — Tüm tespitler doğrulanmış kaynağa bağlı.`
2. `ŞERHLİ — Tespitler kaynaklı; çekince veya çelişen otorite var.`
3. `KISMİ — Bazı tespitler doğrulanamadı; cevap kesinleştirilemez.`
4. `ÇEKİMSER — Yeterli doğrulanabilir kaynak yok.`
5. `KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır`
6. `KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın`

**Yeni, 7. değişmez cümle (çekimserlik için — 6'dan ayrılır):**

7. `ÇEKİMSER — bu soru elinizdeki kaynaklarda karşılık bulmuyor; bir doğrulama başarısız olmadı`

Ayrıca birebir sabit kalanlar: `DEADLINE_DISCLAIMER`,
`yüklediğiniz belge — yürürlük değerlendirilemez`,
`deneysel — UYAP Doküman Editörü'nde açarak doğrulayın`,
`DOĞRULANMADI — madde metniyle kontrol edin`,
`Bu taslak makine üretimidir; avukat incelemesi zorunludur.`

**Test:** `console.test.ts`'e "değişmez cümleler" testi eklenir; yedi dize
dört kaynakta birebir aranır (noktalama dahil).

### 6.5 Uyarı hiyerarşisi — kaç uyarı, nerede, hangi tonda

| Kademe | Nerede | Ton | Sayı |
|---|---|---|---|
| **1. Damga** | Cevabın/kartın başında | Nötr olgu, büyük harfli tek kelime + tek cümle | ekran başına **1** |
| **2. Künye** | Damganın altında tek liste | Nötr olgu, satır başına bir olgu | **1 blok** |
| **3. Uyarılar kartı** | İçeriğin sonunda, katlanmış | Sakin, gerekçeli | **1 blok** |
| **4. Koşullu şerit** | Yalnız DENEME KORPUSU'nda | Tek cümle | **0 veya 1** |

Kalıcı kabuk uyarısı: **yalnız `.stamp`, tek satır** ve cevap ekrandayken
gizli. Altbilgideki 5 cümlelik not tek satır bağlantı olur.

**Ölçüt (test edilebilir):** bir cevap ekranında uyarı bloğu ≤ 4, uyarı
cümlesi ≤ 8, tekrar eden cümle = 0.

### 6.6 Yeni ve düzeltilen dizeler

| Bağlam | Birebir metin |
|---|---|
| Ölü aktif dosya | `Seçili dava dosyası artık yok; dosyasız çalışmaya geçildi. Üst çubuktan bir dosya seçebilirsiniz.` |
| Çift kayıt uyarısı | `Aynı başlık ve esas no ile açık bir dosya var: “{başlık}”. Yine de yeni bir dosya açmak istiyor musunuz?` |
| Yükleme kısmî başarı | `2 belgeden 1'i yüklendi. “{dosya adı}” yüklenemedi: {neden}` |
| Yükleme tam başarısızlık | `“{dosya adı}” yüklenemedi: {neden}` |
| Belge silme onayı | `“{dosya adı}” silinsin mi? Belge, sürümleri ve bölümleri kalıcı olarak kaldırılır; bu işlem geri alınamaz.` / düğme: `Belgeyi sil` |
| Dosya silme onayı | `“{dosya başlığı}” silinsin mi?` · `Silinecek: dosya kaydı, notları, süreleri ve bağları.` · `Silinmeyecek: belgeler, cevaplar ve taslaklar — taslaklar dosyasız kalır ve Taslak › Kayıtlı taslaklar'dan açılır.` · `Bu işlem geri alınamaz.` / düğme: `Dosyayı sil` |
| Boyut sınırı | `Gönderilen içerik sunucu sınırını aşıyor: metin istekleri en fazla 1 MB, belgeler 25 MB, Bulut OCR 32 MB ve 100 sayfa, dosya kayıtları 64 KB.` |
| Soru çok uzun | `Soru {n} karakter; en fazla {sınır} karakter gönderilebilir. Olay örgüsünü kısaltıp hukukî soruyu yazın.` |
| Süre aşımı (yükleme) | `Belge işleme süresi aşıldı (3 dakika).` |
| Bulut AI zaman aşımı | `Bulut AI süresinde yanıt vermedi (1 dakika; Bulut OCR için 5 dakika) — yeniden deneyin.` |
| Bulut AI onayı yok | `Bu istek için Bulut AI onayı verilmedi. Onay kutusunu işaretleyip yeniden gönderin — seçtiğiniz belge/kanıt metni Anthropic sunucularına gider.` |
| Özellik kapalı | `Bu özellik bu sunucuda henüz açık değil; açıldığında bu ekran kendiliğinden çalışır.` |
| Genel bulunamadı | `Kayıt bulunamadı; silinmiş ya da başka bir dosyaya taşınmış olabilir.` |
| Düğme adları | `Süreleri yenile` · `Durumu yenile` · `Listeyi yenile` · `Belgeyi kapsam dışı bırak` · `Dosyadan çıkar` · `Taslağı aç` · `Belgeyi sil` |
| Boş durum — sürüm | `Henüz sürüm yok — ilk Kaydet ile v1 oluşur.` |
| Boş durum — süre | `Bu dosyada süre yok — Süre ekle ile ilk süreyi hesaplayın.` |
| Boş durum — not | `Henüz not yok — Not ekle ile görüşme özeti veya hatırlatma yazın.` |
| Boş durum — taraf | `Belgede taraf adı bulunamadı — taraf bilgilerini taslak formuna elle girin.` |
| Boş durum — atıf | `Belgede kanun veya karar atfı bulunamadı.` |
| Boş durum — tarih | `Belgede tarih bulunamadı — süreleri Süre hesabı ekranından elle başlatın.` |
| Boş durum — talep | `Belgede talep cümlesi bulunamadı — talepleri taslak formuna elle yazın.` |
| Teknik ayrıntı başlığı | `Teknik ayrıntılar` / `Teknik künye` / `Teknik doğrulama ayrıntıları` |

### 6.7 Yasaklı sözcük testi (LANG-8)

`console.test.ts`'e `LANG-7`'nin (Bulut AI adlandırması) yanına ikinci bir
test eklenir. Kullanıcıya dönük metinde **geçmemesi** gereken diziler:

- Pazarlama/üstünlük: `başarı oranı`, `davanızı kazandırır`, `%N doğruluk`,
  `en iyi`, `hukuki tavsiye`, `avukata gerek kalmadan`, `halüsinasyonsuz`,
  `%100 kaynaklı`, `garanti`
- Mühendislik sızıntısı: `uç`(tek başına), `endpoint`, `parametre`, `enum`,
  `chunk`, `parça`(kullanıcıya dönük), `token`, `entailment`, `fixture`,
  `timeout`, `cache`, `matter`, `Invalid enum value`, `Invalid literal value`
- Ton: `lütfen`, `üzgünüz`, `maalesef`, `Dikkat:`, `mutlaka`
- Tek-kullanıcı ihlali: `sistemi başlatan kişi`, `yöneticinize`, `ekibiniz`

Test, `console.html`'in `<script>` bloğundaki dize sabitlerini tarar.
Reklam Yasağı Yönetmeliği açısından ilk grup ayrıca **hukukî** bir
gerekliliktir: ürün avukata sayı vermemeli, avukatın da o sayıyı taşımasına
izin vermemelidir.

### 6.8 "Verilerim nerede?" kartı — üç satır

```
Dosyalarınız, cevaplar, taslaklar ve ayarlar yalnız bu bilgisayardaki yerel
veritabanında durur; yüklediğiniz belgelerin aslı bu bilgisayardaki depo
klasöründedir.

Bulut AI varsayılan olarak KAPALIDIR. Kapalıyken hiçbir bayt bu bilgisayarı
terk etmez. Açtığınız her istek için ayrı ayrı onay verirsiniz ve ne
gönderildiğini önce görürsünüz.

Canlı araştırma yalnız sorunuzdan türetilen arama metnini resmî kaynak
sunucularına gönderir. Bu çalışma alanı UYAP ile eşitlenmez; kimse uzaktan
bağlanıp kurulum yapmaz.
```

Bu üç cümle ürünün en savunulabilir konumudur ve **doğrulanabilir** olduğu
için sözleşmeyle çelişmez.

---

## 7. İLK AÇILIŞ — 60 saniyede ürünü öğreten tasarım (tur kütüphanesi yok)

**Bugünkü ölçüm:** ekran bir *ürün* gibi değil bir *kapak sayfası* gibi
açılıyor; içerik **537 px**'te başlıyor; okunan ilk tam cümle bir gizlilik
uyarısı; "Üç adımda başlayın" listesindeki üç düğme de aynı hayalet stilde.
On dakikada ürün çalıştırılabiliyor ama **ne olduğu anlaşılamıyor**.

**Tasarım: canlı kontrol listesi kartı** — modal yok, katman yok, tur yok.
Dosyalarım'ın en üstünde, süre panelinin **üstünde** durur; üç adım da
tamamlanınca kendiliğinden kaybolur (durum sunucudan okunur: profil dolu mu ·
en az bir dosya var mı · en az bir belge veya cevap var mı).

```
┌ .card (--e-1) ─────────────────────────────────────────────────────┐
│ ColleX'e hoş geldiniz                                    [gizle]    │  --fs-700
│ ColleX, sorunuzu resmî kaynaklarda arar ve yalnız birebir           │  --fs-500 serif
│ doğrulayabildiği alıntılara dayanarak cevap verir.                  │  --measure
│ Doğrulayamadığını yazmaz.                                           │
│                                                                     │
│ ① Kim olduğunuzu yazın            Taslaklardaki vekil bloğu buradan │
│    ✓ tamamlandı / [Profili doldur]  dolar.                          │
│ ② İlk dosyanızı açın              Cevaplar, belgeler ve taslaklar   │
│    [+ Yeni dosya]                   bir dava dosyasına bağlanır.    │
│ ③ Bir belge yükleyin ya da soru sorun                               │
│    [Belge yükle] [Soru sor]                                         │
│                                                                     │
│ Ne yapmaz: sizin adınıza imza atmaz, UYAP'a evrak göndermez;        │  --fs-200
│ hukukî tavsiye vermez; doğrulayamadığı bir alıntıyı dosyaya yazmaz. │
└─────────────────────────────────────────────────────────────────────┘
```

**Kurallar:**

- Her adımda **tek** birincil eylem; tamamlanan adım `✓` + `--ink-3` ile
  soluklaşır, düğmesi kaybolur.
- Kart `localStorage`'a değil, **gerçek duruma** bakar; "gizle" seçilirse
  `preferences` içinde saklanır (`PUT /v1/settings`) — böylece başka tarayıcıda
  da gizli kalır.
- İlk cümle **ürünün ne yaptığıdır**, gizlilik uyarısı değil. Gizlilik cümlesi
  Ayarlar › "Verilerim nerede?"ye bağlanan tek satırdır.
- **60 saniye ölçütü:** kartı okuyan biri (a) ürünün ne yaptığını, (b) neyi
  yapmadığını, (c) ilk üç adımını söyleyebilmelidir. Kart 12 satırı,
  metin 90 kelimeyi aşmaz.
- Araştır ekranında ayrıca **iş kartları** şeridi (keşfedilebilirlik):
  `Belgeyi özetle` · `Kronoloji çıkar` · `Atıfları denetle` · `Karşı tarafın
  dilekçesini denetle` · `Süre hesapla` · `Karşıt içtihat tara`. Her kart
  mevcut uçlara sabit gövde gönderir; yeni uç gerekmez. Bugün ürünün
  yeteneklerinin yarısı keşfedilemez durumda.

---

## 8. KABUL ÖLÇÜTLERİ — ölçülebilir liste

Her satır bir testle ya da tek bir tarayıcı ölçümüyle doğrulanabilir.

| # | Ölçüt | Nasıl ölçülür |
|---|---|---|
| A1 | Odak halkası ≥ 3:1 (her iki tema) | `--seal`/`--surface` = 9.43 / 7.72; `outline`/`box-shadow` bir öğede görünür |
| A2 | `.tab[aria-selected="true"]` metni ≥ 4.5:1 (koyu) | `--on-seal` / `--seal-solid` = 7.35 |
| A3 | `.toast--ok/--bad` metni ≥ 4.5:1 (koyu) | `--surface` / `--ink` ≥ 12 |
| A4 | Form alanı sınırı ≥ 3:1 (her iki tema) | `--border`/`--surface` = 3.66 / 3.57 |
| A5 | `.days--late` ≥ 4.5:1 (koyu) | `--bad`/`--bad-tint` |
| A6 | `prefers-reduced-motion`'da sonsuz animasyon yok | `.runbar .sweep` dahil hepsi 1ms |
| A7 | 960 px'te `document.scrollWidth <= innerWidth` | tarayıcı ölçümü |
| A8 | 390 px'te dosya listesi kart düzeninde ve "sonraki süre" görünür | tarayıcı ölçümü |
| A9 | Bir cevap ekranında uyarı bloğu ≤ 4, cümle ≤ 8, tekrar 0 | DOM sayımı |
| A10 | Ana akışta UUID/ofset/SHA-256 geçişi = 0 (hepsi `details.trace` içinde) | DOM sayımı |
| A11 | Ana akışta İngilizce makine kodu geçişi = 0 | DOM sayımı |
| A12 | Belge sayfası yüksekliği 1440 px'te ≤ 1 600 px | tarayıcı ölçümü (bugün 4 321) |
| A13 | Bir cevap kartı yüksekliği ≤ 3 ekran | tarayıcı ölçümü (bugün 8,3) |
| A14 | `.btn--primary` ekran başına ≤ 1 | DOM sayımı |
| A15 | Çift tık → tek POST (her form) | ağ sayımı |
| A16 | `font-size` bildiriminde 10/10.5/11/11.5 ve yarım punto = 0 | stil taraması |
| A17 | `letter-spacing` bildirimi ≤ 2 seçicide | stil taraması |
| A18 | `font-variant-caps: all-small-caps` = 0 | stil taraması |
| A19 | `text-transform: uppercase` = 0 | stil taraması |
| A20 | Yedi değişmez cümle dört kaynakta birebir aynı | `console.test.ts` |
| A21 | Yasaklı sözcük listesi (LANG-8) 0 eşleşme | `console.test.ts` |
| A22 | Yazdırmada `@page A4` ve kabuk gizli | baskı önizleme |
| A23 | Modal: odak tuzağı + `Esc` + geri tuşu alttaki görünümü değiştirmiyor | tarayıcı ölçümü |
| A24 | Sekmelerde ok tuşu gezinmesi çalışıyor | tarayıcı ölçümü |
| A25 | Liste yenilenirken düzen sıçraması yok (iskelet + `aria-busy`) | tarayıcı ölçümü |
| A26 | Tek `<style>`, tek `<script>`, LF-only, `textContent` kuralı korunuyor | `console.test.ts` (mevcut) |
| A27 | Yakalanmamış JS istisnası = 0 | tarayıcı konsolu (bugün 0 — **korunmalı**) |

---

## 9. KORUNACAKLAR — hiçbir değişiklik bunları zayıflatmaz

Denetimlerde **beklentinin üstünde** çıkan ve dokunulmaması gereken kararlar:

1. **Süre hesabı ekranı** — ürünün en iyi yüzeyi: beş numaralı hesap adımı
   düz Türkçe ve madde atfıyla, `DOĞRULANMADI` rozeti, birebir feragat.
2. **Gerçek çekimserlik** — konu dışı soruda 0 kaynak, 0 tespit ve
   "Karşılığı bulunamayan sözcükler" listesi.
3. **Alaka kapısı (ADR-022)** sahada doğrulandı: ceza hukuku araştırmasından
   üretilen kira cevap dilekçesinde 4 kanıtın dördü de kullanılmayanlara
   düştü, HUKUKÎ SEBEPLER boş bırakıldı.
4. **Kalıcılık** — sunucu öldürülüp yeniden başlatıldıktan sonra ayarlar,
   dosya, öğeler ve taslak eksiksiz geri geldi.
5. **`contenteditable="plaintext-only"`** — zengin metin ve `<script>` taşıyan
   yapıştırma etkisiz.
6. **Dışa aktarım künyeleri** — `Content-Disposition` hem ASCII hem
   `filename*=UTF-8''`; `X-ColleX-Experimental: udf`.
7. **`h2.section .no` (`§ 1`)** — külliyat dilinin en iyi çalışan parçası.
8. **`.duebig` deseni** — sayfadaki en iyi tasarlanmış an; çoğaltılır.
9. **W12-UI2 small-caps sıfırlaması** — doğru yöne atılmış adım; §1.3 onu
   tamamlar, geri almaz.
10. **Tek dosya, sıfır bağımlılık, CSP-karmalı satır içi CSS/JS** — bu bir
    kısıt değil, bir güvenlik özelliğidir; bu şartnamedeki hiçbir öneri onu
    gevşetmez.
11. **İlerleme panelinin dürüstlüğü** — `research/progress.ts` 54 aracın
    Türkçe etiketini üretiyor; sahte yüzdeyle değiştirilmez.

---

## 10. BU ŞARTNAMENİN KAPSAMI DIŞI

- Süre kurallarının madde metniyle doğrulanması (hukukçu işi; `W13-COPY` §3
  19 maddeyi çekmiş durumda).
- Şablonlardaki hukukî hatalar (L1–L33) — metin işi, tasarım işi değil.
- Arka uç kusurları: alıntı bütünlüğü denetimi (UXAUDIT P0-1), süzgeçlerin
  sessizce yok sayılması, sürüm tarihlerinin aynı gelmesi, silme uçlarının
  yokluğu. Bu şartname **yalnız arayüz tarafını** tarif eder ve arka uç
  düzeltilmeden önce sahte bir güven göstermez.
- Yedekleme/geri yükleme (`W13-ENGRISK` E1) — Ayarlar'da yeri ayrılmıştır,
  davranışı ayrı bir kalemdir.


# belge-ciktilari

Üretilen belgelerin gövdesi (dilekçe metni, talep sonucu, olaylar) büyük ölçüde temiz avukat Türkçesi; asıl sorun belgeye EKLENEN makine bölümleridir. Varsayılan dışa aktarımda dilekçenin içine "EK — DOĞRULAMA BİLGİLERİ" adlı bir bölüm giriyor ve orada "SHA-256 (ilk 8)", "3 parça" ve ham kanıt kimlikleri yer alıyor; hemen ardından gelen "DAYANAK KAYNAKLARI" ekinde her kaynak için üç ayrı makine satırı basılıyor. Araştırma raporunda durum daha ağır: künye tablosunda "retrieval · entailment · authority · currentness · coverage" gibi İngilizce kodlar, "pipeline", "as-of", "kanonik metin + offset", "collex.evidence-bundle/v1" gibi ifadeler doğrudan avukatın eline geçen belgede duruyor; "DOĞRULAMA" bölümü ise avukata Python ve JavaScript'te metin dilimlemeyi anlatıyor. Atıf denetim raporunun tablo hücresinde "alıntı hash ile doğrulandı" yazıyor, gerekçe hücrelerinde "yerel korpus" dört ayrı yerde geçiyor. Ayrıca taslağın Uyarılar bölümüne ham kanıt kimliği ve QUOTE_ALTERED gibi makine kodları sızıyor. Sözleşme inceleme raporu ile denetim raporunun "Durum sözlüğü" blokları iyi yazılmış; ürünün geri kalanında örnek alınması gereken ton orasıdır. Aşağıdaki bulguların tamamı metin değişikliğiyle çözülür ve teknik doğruluk kaybolmaz: karşılaştırma zaten belge üretilmeden önce yapılıyor ve tutmazsa dosya hiç yazılmıyor — bunu yöntemin adını vermeden söylemek mümkündür.

Bulgu: 40

## [P0] jargon — satir 38

**Mevcut:**
```
" mahkeme kararları DEĞİLDİR; yerel test/geliştirme için üretilmiş"
```

**Neden:** Devamı 'sentetik fixture metinleridir' — 'fixture' İngilizce bir yazılım terimi ve belgenin en tepesindeki kırmızı uyarı bandında duruyor. Uyarı bandı, anlaşılması en kritik metindir.

**Öneri:**
```
" mahkeme kararları DEĞİLDİR; yalnızca programı denemek için üretilmiş"
```

**Not:** export/text.py — SYNTHETIC_BANNER. 39. satırdaki 'sentetik fixture metinleridir' -> 'örnek metinlerdir'.

## [P0] jargon — satir 46

**Mevcut:**
```
"Bu soruya mevcut korpusta doğrulanabilir kaynak bulunamadı. Doğrulanamayan"
```

**Neden:** 'Korpus' kullanıcının birebir saydığı kelimelerden. Üstelik bu cümle ÇEKİMSER raporun ilk cümlesidir: avukatın ürünün neden cevap vermediğini anlayacağı tek yer. Devamındaki 'makine gerekçeleri' de mühendis dilidir.

**Öneri:**
```
"Bu soru için elimizdeki kaynaklarda doğrulanabilir bir dayanak bulunamadı. Doğrulayamadığımız"
```

**Not:** export/text.py — ABSTENTION_TEXT. 47-48. satırlardaki '…aşağıdaki makine gerekçeleri hangi kontrolün başarısız olduğunu gösterir.' da 'aşağıda hangi kaynakların neden kullanılamadığı yazılıdır.' olmalı.

## [P0] jargon — satir 46

**Mevcut:**
```
"SENTETİK VERİ — Bu taslağa bağlanan kaynaklar sentetik test korpusundandır;" +
```

**Neden:** Dilekçenin ilk satırındaki uyarı. Hem 'SENTETİK' hem 'korpus' geçiyor. Avukat bu uyarıyı anlamazsa deneme verisiyle üretilmiş bir dilekçeyi gerçek sanabilir — üründeki en tehlikeli anlaşılmazlık budur.

**Öneri:**
```
"DENEME VERİSİ — Bu taslaktaki kaynaklar gerçek değildir; programı denemek için üretilmiş örnek metinlerdir," +
```

**Not:** control-plane/src/drafting/markdown.ts — SYNTHETIC_LINE. Aynı cümle export/petition.py:125-126 ve export/udf.py:82-83'te tekrarlanıyor; üçü birlikte değişmeli.

## [P0] jargon — satir 83

**Mevcut:**
```
  "Mahkeme kararları yerel korpusta tam değildir: bulunmaması kararın" +
```

**Neden:** Aynı rapor hücresi. Cümlenin anlamı doğru ve önemli (bulunmaması yokluk demek değil) ama 'yerel korpusta tam değildir' ile başladığı için bu koruyucu açıklama boşa gidiyor.

**Öneri:**
```
  "Elimizdeki mahkeme kararları eksiksiz değildir: bulunamaması, kararın" +
```

**Not:** control-plane/src/contracts/corpusResolver.ts. 'yerel korpus' ayrıca 88. satırda (REASON_STORE_UNAVAILABLE) ve 98-100. satırlarda (absentArticleNote, iki kez) geçiyor; dördü de 'elimizdeki kaynaklar' olmalı.

## [P0] jargon — satir 86

**Mevcut:**
```
  "Bu mevzuat, dilekçenin tarihinde yerel korpusta yok — kapsam dışı.";
```

**Neden:** ATIF DENETİM RAPORU'nun gerekçe hücresinde basılıyor. 'Yerel korpus' anlaşılmaz; 'kapsam dışı' ise üründe üç ayrı anlamda kullanılan 'kapsam' kelimesidir. Satır avukata ne yapması gerektiğini de söylemiyor.

**Öneri:**
```
  "Bu mevzuatın dilekçe tarihindeki metni elimizdeki kaynaklarda bulunmuyor; bu atfı kendiniz teyit edin.";
```

**Not:** control-plane/src/contracts/corpusResolver.ts — REASON_LAW_OUT_OF_SCOPE.

## [P0] jargon — satir 126

**Mevcut:**
```
            f"- Belge sürüm kimliği: `{escape_inline(entry.document_version_id)}`",
```

**Neden:** Markdown raporunun KAYNAKLAR bölümünde her kaynak için iki uzun makine kimliği basılıyor (126-127). Avukat bunları ne okur ne kullanır; kaynağı bulmasını sağlayan künye, tarih ve URL satırları zaten üstünde duruyor.

**Öneri:**
```
Bu satırı ve 127. satırdaki 'Belge kimliği' satırını belgeden kaldırın; kaynağa erişim için künye, tarih ve 'Kaynak URL' satırları yeterlidir.
```

**Not:** export/bundle_markdown.py — _source_entry(). Aynı iki satır export/bundle_docx.py:353-354'te de var.

## [P0] jargon — satir 128

**Mevcut:**
```
f"{len(self.text_verified_ids)} tanesi kanonik metin +"
```

**Neden:** Bu metin raporun İNSAN künyesindeki 'Bütünlük doğrulaması' satırına, yani avukatın ilk gördüğü tablonun içine basılıyor. 'Kanonik metin' ve 'offset karşılaştırması' avukatın bilmediği iki terim, üstelik yan yana.

**Öneri:**
```
f"{len(self.text_verified_ids)} tanesi kaynağın kendi metniyle karşılaştırılarak"
```

**Not:** export/verify.py — VerificationReport.summary(). 129. satırdaki ' offset karşılaştırmasıyla' parçası da bu değişiklikle birlikte silinmeli.

## [P0] jargon — satir 132

**Mevcut:**
```
parts.append(f"{len(self.hash_only_ids)} tanesi SHA-256 karşılaştırmasıyla")
```

**Neden:** Aynı künye satırının ikinci yarısı. 'SHA-256' kullanıcının ekranı kapattığını söylediği kelimelerin başında geliyor.

**Öneri:**
```
parts.append(f"{len(self.hash_only_ids)} tanesi kaydedilmiş metinle karşılaştırılarak")
```

**Not:** export/verify.py. Ayrım (metinle mi, kayıtla mı) korunuyor; sadece yöntemin adı düşüyor.

## [P0] jargon — satir 135

**Mevcut:**
```
"KAYNAKLAR bölümündeki ilgili girişten 'Belge sürüm kimliği'"
```

**Neden:** Devamında parantez içinde 'documentVersionId' yazıyor — belgenin içinde İngilizce bir değişken adı. Avukat 'sürüm kimliği' ile ne yapacağını da bilmez; o alan uzun bir makine kodudur.

**Öneri:**
```
KAYNAKLAR bölümündeki girişte, alıntının hangi kaynağın hangi tarihli metninden alındığı yazılıdır. Kaynağı kendi resmî sitesinden aynı tarihli metinle açın.
```

**Not:** export/text.py — VERIFY_STEPS 1. Parantez içindeki 'documentVersionId' her koşulda kaldırılmalı.

## [P0] jargon — satir 139

**Mevcut:**
```
"Kanonik metnin UTF-8 baytları üzerinde SHA-256 özetini hesaplayın."
```

**Neden:** Avukatın eline geçen raporun DOĞRULAMA bölümünde yazıyor. 'Kanonik', 'UTF-8', 'bayt', 'SHA-256 özeti' — dördü de avukat sözlüğünde yok. Bu cümleyi gören avukat bölümü atlar, dolayısıyla ürünün en güçlü tarafını hiç görmez.

**Öneri:**
```
Kaynaktan aldığınız metnin, bu belgedeki alıntının alındığı metin olup olmadığını program otomatik denetler; denetim tutmazsa belge hiç üretilmez. Elle bakmak isterseniz kaynaktaki paragrafı bu belgedeki alıntı kutusuyla karşılaştırın: harfi harfine aynı olmalıdır.
```

**Not:** export/text.py — VERIFY_STEPS. Aynı liste hem Markdown hem DOCX raporunda numaralı olarak basılıyor.

## [P0] jargon — satir 143

**Mevcut:**
```
"Metni 'Konum' alanındaki [başlangıç, bitiş) aralığında dilimleyin. Bu"
```

**Neden:** Devamı 'offsetler UNICODE KOD NOKTASI indeksleridir — UTF-16 birimi veya bayt değildir. (Python'da doğrudan metin dilimleme; JavaScript'te kod noktalarına ayırdıktan sonra dilimleme.)' diye gidiyor. Müvekkile ya da mahkemeye gidecek bir belgede avukata Python öğretilemez. Bu tek paragraf ürünü 'yazılımcı işi' gibi gösteriyor.

**Öneri:**
```
Alıntının kaynak metnin neresinden alındığı, KAYNAKLAR bölümündeki girişte yazılıdır. O yeri açın ve alıntıyı gözünüzle karşılaştırın.
```

**Not:** export/text.py — VERIFY_STEPS 3. Python/JavaScript cümlesi tamamen silinmeli; teknik okuyucu için ayrı bir dosyaya taşınabilir.

## [P0] jargon — satir 152

**Mevcut:**
```
" doğrulama bilgilerini özetler. Tam alıntılar ve tam SHA-256 özetleri DAYANAK" +
```

**Neden:** 'EK — DOĞRULAMA BİLGİLERİ' bölümünün ilk paragrafı, yani avukatın bu bölümü anlamak için okuyacağı tek cümle. O cümlede 'SHA-256 özetleri' geçiyor ve bölümün ne işe yaradığı söylenmiyor.

**Öneri:**
```
" hangi kaynağa dayandığını ve alıntının kaynağıyla uyuşup uyuşmadığını gösterir. Kaynakların tam künyesi ve tam alıntı metinleri DAYANAK" +
```

**Not:** control-plane/src/drafting/appendix.ts, 150-154. satırlar. 151. satırdaki 'Bu bölüm belge gövdesine ait değildir' de 'Bu bölüm dilekçe metnine dahil değildir; mahkemeye verirken çıkarabilirsiniz.' olmalı — avukata ne yapacağı söylenmeli.

## [P0] jargon — satir 154

**Mevcut:**
```
` (${QUOTE_ALTERED}). Atıf yazılmadı; paragraf KAYNAKSIZ işaretlendi.` +
```

**Neden:** Belgenin uyarılar bölümüne 'QUOTE_ALTERED' diye İngilizce bir makine kodu basılıyor. Bir dilekçenin ekinde İngilizce büyük harfli hata kodu bulunması, belgeyi kullanılamaz gösterir.

**Öneri:**
```
`. Bu paragrafa atıf yazılmadı ve paragraf kaynaksız olarak işaretlendi.` +
```

**Not:** control-plane/src/drafting/quoteIntegrity.ts — quoteAlteredMessage(). 47. satırdaki 'alıntı değiştirildi — kanıt bağı koptu' da 'alıntı metni kaynağındakinden farklı' olmalı: 'kanıt bağı' tanımsız bir terimdir.

## [P0] jargon — satir 157

**Mevcut:**
```
" paketteki her alıntının SHA-256 özeti ve offset aralığı yeniden"
```

**Neden:** Bu cümle ürünün en önemli vaadini anlatıyor ('tek bir kontrol bile başarısız olsaydı bu dosya hiç oluşturulmazdı') ama 'SHA-256 özeti ve offset aralığı' yüzünden okunmadan geçiliyor. Rakiplere karşı en güçlü cümle jargonun altında kalıyor.

**Öneri:**
```
Bu dosya yazılmadan önce her alıntı, alındığı kaynak metinle otomatik olarak karşılaştırıldı: alıntının bozulmadığı, her atfın belgedeki bir kaynağa karşılık geldiği ve yazılan atıf numaralarıyla KAYNAKLAR girişlerinin birebir örtüştüğü denetlendi. Bu denetimlerden biri bile tutmasaydı dosya hiç oluşturulmazdı.
```

**Not:** export/text.py — VERIFY_SELF_CHECK. Teknik doğruluk korunuyor: karşılaştırmanın yapıldığı söyleniyor, yöntemin adı verilmiyor.

## [P0] jargon — satir 161

**Mevcut:**
```
`   - Kanıt kimliği: ${entry.evidenceId}`,
```

**Neden:** DAYANAK KAYNAKLARI ekinde her kaynağın altına 'Kanıt kimliği: ev-7f3a19c2-…' gibi bir makine kimliği basılıyor. Avukat bu satırı ne okuyabilir ne kullanabilir; belgeyi kalabalıklaştırmaktan başka işi yoktur.

**Öneri:**
```
Bu satırı belgeden kaldırın. Kaynağın belgede bulunmasını sağlayan şey zaten [K-n] numarasıdır; kimlik satırına ihtiyaç yoktur.
```

**Not:** control-plane/src/drafting/markdown.ts. Aynı satır export/petition.py:454 ve export/udf.py:263'te de var; üçü birlikte kaldırılmalı.

## [P0] jargon — satir 162

**Mevcut:**
```
` "${shortQuote(entry.quote)}" — SHA-256 (ilk 8): ${shortHash8(entry.quoteSha256)}` +
```

**Neden:** Bu satır 'EK — DOĞRULAMA BİLGİLERİ' bölümündedir ve o bölüm draft.sections'ın parçası, yani DİLEKÇENİN KENDİ BÖLÜMLERİNDEN biridir. Dilekçenin sonunda her kaynak için 'SHA-256 (ilk 8): a3f19c02' yazan bir satır kalıyor. Bu, mahkemeye verilecek nüshada bulunmamalıdır.

**Öneri:**
```
` "${shortQuote(entry.quote)}" — Alıntı denetimi: kaynağıyla birebir uyuştu` +
```

**Not:** control-plane/src/drafting/appendix.ts — buildEkDogrulamaSection(). Kısa özet değeri avukatın kullanamayacağı bir veridir; kaldırılması bilgi kaybı değildir.

## [P0] jargon — satir 162

**Mevcut:**
```
`   - Alıntı SHA-256: ${entry.quoteSha256}`,
```

**Neden:** Her kaynak için 64 karakterlik iki ayrı özet satırı basılıyor (163. satır 'Belge içerik SHA-256'). Ölçüme göre üretilen dilekçenin büyük bölümü bu ek; avukat için okunamaz, mahkeme için anlamsız.

**Öneri:**
```
`   - Alıntı denetimi: kaynağıyla birebir uyuştu`,
```

**Not:** control-plane/src/drafting/markdown.ts, 162-163. İki satır tek satıra iniyor. Tam özet değerleri isteyene ayrı doğrulama dosyası olarak zaten üretiliyor (export/bundle*.py); belgeden çıkması bilgi kaybı değildir.

## [P0] jargon — satir 168

**Mevcut:**
```
`Ek-${index + 1} — ${inlineText(upload.fileName)} — yüklenen belge, ${upload.chunkCount} parça` +
```

**Neden:** 'parça' burada 'chunk' karşılığıdır ve kullanıcının açıkça saydığı anlaşılmaz kelimelerden biridir. Avukat 'Ek-1 — kira sözleşmesi.pdf — yüklenen belge, 7 parça' satırını okuyunca belgesinin parçalandığını sanar; ayrıca bu sayı onun için hiçbir işe yaramaz.

**Öneri:**
```
`Ek-${index + 1} — ${inlineText(upload.fileName)} — dosyaya eklediğiniz belge` +
```

**Not:** control-plane/src/drafting/appendix.ts. 169. satırdaki SHA-256 parçasıyla birlikte kaldırılınca satır tek başına anlaşılır oluyor.

## [P0] jargon — satir 183

**Mevcut:**
```
DOGRULANDI: "alıntı hash ile doğrulandı",
```

**Neden:** Bu metin ATIF DENETİM RAPORU'nun 'Alıntı' sütununda hücre içeriği olarak basılıyor; avukat tabloya bakınca satır satır 'hash' okuyor. Denetim raporu müvekkile veya karşı tarafa gösterilebilecek bir belgedir.

**Öneri:**
```
DOGRULANDI: "alıntı kaynağıyla birebir uyuşuyor",
```

**Not:** control-plane/src/contracts/citationAudit.ts — QUOTE_LABEL_TR. 184-185. satırlar zaten doğru tonda; yalnız bu satır bozuk.

## [P0] jargon — satir 191

**Mevcut:**
```
("Doğrulama zamanı (pipeline)", bundle.verified_at),
```

**Neden:** 'Pipeline' İngilizce bir yazılım terimi ve belgenin künye tablosunda etiket olarak duruyor. 202. satırdaki '("Üretici (pipeline)", bundle.producer)' aynı hatayı tekrarlıyor.

**Öneri:**
```
("Kaynak denetiminin yapıldığı zaman", bundle.verified_at),
```

**Not:** export/plan.py — tech_rows(). 'Üretici (pipeline)' satırı da 'Üreten program' olmalı.

## [P0] jargon — satir 197

**Mevcut:**
```
"Kaynak isabeti=retrieval · Pasaj desteği=entailment ·"
```

**Neden:** Raporun 'Teknik künye' tablosunda beş İngilizce kelime doğrudan basılıyor: retrieval, entailment, authority, currentness, coverage. Teknik künye de belgenin içindedir; avukat müvekkiline verdiği dosyada İngilizce makine terimleri görür.

**Öneri:**
```
Bu satırı belgeden tamamen kaldırın. Güven tablosunun sütun başlıkları zaten Türkçedir; İngilizce karşılıkların belgede işi yoktur.
```

**Not:** export/plan.py — tech_rows(). 198. satırdaki ' Otorite=authority · Güncellik=currentness · Kapsam=coverage' aynı satırın devamı.

## [P0] jargon — satir 356

**Mevcut:**
```
        "Konum (Unicode kod noktası)",
```

**Neden:** Word raporunda her kaynağın altında 'Konum (Unicode kod noktası): 1420–1587 (167 kod noktası)' yazıyor. 'Unicode' ve 'kod noktası' kullanıcının saydığı kelimelerden; sayılar da avukat için kullanılamaz.

**Öneri:**
```
        "Alıntının kaynak metindeki yeri",
```

**Not:** export/bundle_docx.py. Değer kısmındaki '(… kod noktası)' eki de kaldırılmalı; aynı satır export/bundle_markdown.py:128'de '- Konum (kod noktası):' olarak tekrarlanıyor.

## [P0] jargon — satir 441

**Mevcut:**
```
`Kanıt ${evidenceId} alıntısı paragraf metninde birebir yer almıyor;` +
```

**Neden:** Bu cümle taslağın 'Uyarılar' listesine giriyor ve o liste dışa aktarılan belgede basılıyor (markdown.ts:129, petition.py:490). Sonuç: dilekçenin uyarılar bölümünde 'Kanıt ev-3f0a… alıntısı…' diye bir makine kimliği görünüyor. Devamındaki '(uydurma atıf koruması)' de mühendis dilidir.

**Öneri:**
```
`Bir kaynağın alıntısı paragraf metninde birebir bulunmadığı için o kaynağa atıf yazılmadı; alıntıyı metne geri alın ya da atfı kaldırın.`
```

**Not:** control-plane/src/drafting/composer.ts — assessmentParagraph(). 419-420 ('kanıt bütünlüğü koruması') ve 442 ('uydurma atıf koruması') parantezleri de kaldırılmalı.

## [P0] jargon — satir 452

**Mevcut:**
```
_para(document, f"Alıntı SHA-256: {entry.quote_sha256}", STYLE_FIELD)
```

**Neden:** Word çıktısında aynı sorun: DAYANAK KAYNAKLARI eki kaynak başına üç makine satırı taşıyor (452-454). Avukat dosyayı Word'de açtığında sayfalarca anlamsız harf dizisi görüyor.

**Öneri:**
```
_para(document, "Alıntı denetimi: kaynağıyla birebir uyuştu", STYLE_FIELD)
```

**Not:** export/petition.py — _add_appendix_entry(). 453 ('Belge içerik SHA-256') ve 454 ('Kanıt kimliği') satırları kaldırılmalı.

## [P1] jargon — satir 31

**Mevcut:**
```
" adına imza atmaz, UYAP'a evrak göndermez, PIN/token/özel anahtar"
```

**Neden:** Cümle doğru ve gerekli bir sınır beyanı, ama 'token' avukatın bilmediği bir kelime ve tam da güven vermesi gereken cümlenin ortasında duruyor.

**Öneri:**
```
" adına imza atmaz, UYAP'a evrak göndermez, e-imza şifrenizi veya kartınızı"
```

**Not:** export/text.py — LAWYER_REVIEW_NOTICE. Aynı ifade UDF_NOTICE (164-169) ve UDF_FILE_NOTICE (173-178) içinde de tekrarlanıyor.

## [P1] eksik-aciklama — satir 59

**Mevcut:**
```
H_CONFIDENCE = "Tespit Bazlı Güven Tablosu"
```

**Neden:** Başlık avukata tablonun ne olduğunu söylemiyor: yüzdeler neyin yüzdesi, %64 ne demek, düşükse ne yapmalı? 'Bazlı' ayrıca mühendis Türkçesi ve tablonun altında hiçbir açıklama satırı yok.

**Öneri:**
```
H_CONFIDENCE = "Her Sonucun Ne Kadar Sağlam Dayandığı"
```

**Not:** export/text.py. Tablonun hemen altına şu satır eklenmeli: 'Bu yüzdeler programın kendi ölçümüdür, doğruluk garantisi değildir; düşük değerli satırlardaki kaynağı mutlaka kendiniz okuyun.'

## [P1] ton — satir 60

**Mevcut:**
```
  "Bu inceleme KURAL TABANLIDIR: metni sizin kontrol listenizle karşılaştırır." +
```

**Neden:** 'Kural tabanlı' bir yazılım mimarisi terimi ve SÖZLEŞME İNCELEME RAPORU'nun ilk uyarı cümlesi olarak basılıyor. Cümlenin geri kalanı (yorum üretmez, yapay zekâ kullanmaz) çok iyi; sadece açılışı mühendis gibi konuşuyor.

**Öneri:**
```
  "Bu inceleme, sözleşme metnini sizin kontrol listenizle satır satır karşılaştırmaktan ibarettir." +
```

**Not:** control-plane/src/contracts/clauseReview.ts — REVIEW_NOTICES. Aynı cümle export/review.py:62-63'te tekrarlanıyor; ikisi birlikte değişmeli.

## [P1] tanimsiz-terim — satir 71

**Mevcut:**
```
    ("retrieval", "Kaynak isabeti"),
```

**Neden:** 'Kaynak isabeti' ve 72. satırdaki 'Pasaj desteği' güven tablosunun sütun başlıkları olarak belgeye basılıyor; ikisi de uydurulmuş, belgede tanımı olmayan terimler. Avukat %72 'Pasaj desteği' satırını görünce ne anlaması gerektiğini bilmez.

**Öneri:**
```
    ("retrieval", "Doğru kaynağa ulaşma"),
```

**Not:** export/bundle.py — CONFIDENCE_DIMENSIONS. 72. satır 'Pasaj desteği' -> 'Alıntının sonucu karşılaması'. Tablonun altına her sütunun bir cümlelik tanımını veren sözlük eklenmeli — denetim raporundaki 'Durum sözlüğü' bloğu doğru örnektir.

## [P1] tanimsiz-terim — satir 72

**Mevcut:**
```
"QUALIFIED": "ŞERHLİ (tespitler kaynaklı, ancak çekince/çelişki var)",
```

**Neden:** 'ŞERHLİ' bir durum damgası olarak uydurulmuş; hukuktaki 'şerh' ile ilgisi yok. 'Tespit' de burada 'claim' karşılığı kullanılıyor, avukatın bildiği tespit değil. Bu değer künye tablosunda 'Cevap durumu' satırında basılıyor.

**Öneri:**
```
"QUALIFIED": "KAYNAKLI, ANCAK ÇEKİNCELİ — her sonuç bir kaynağa dayanıyor, ancak kaynaklar arasında çelişki veya çekince var",
```

**Not:** export/text.py — STATUS_TR. 71 (TAM), 73 (KISMİ) ve 74 (ÇEKİMSER) satırları da kendini açıklayacak hale getirilmeli; 'ÇEKİMSER' özellikle tanımsız.

## [P1] tanimsiz-terim — satir 82

**Mevcut:**
```
"KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan"
```

**Neden:** 'KESİNLEŞTİRİLEMEZ' uydurulmuş bir damga; belgede tanımı yok. Avukat bunu 'karar kesinleşmez' gibi usul anlamında okuyabilir — tam tersi bir çağrışım. Künyede 'Kesinleştirilebilir' etiketiyle birlikte basılıyor.

**Öneri:**
```
"KULLANIMA HAZIR DEĞİL — en az bir kaynak denetimi tutmadı; aşağıdaki gerekçeleri okumadan"
```

**Not:** export/text.py — FINALIZE_BLOCKED. plan.py:162'deki 'Kesinleştirilebilir' etiketi 'Kullanıma hazır mı?' olmalı; 78-80. satırdaki FINALIZE_OK ile birlikte düşünülmeli.

## [P1] jargon — satir 115

**Mevcut:**
```
`- Şablon: ${draft.template} (${draft.kind})`,
```

**Neden:** Künyeye 'kira-tahliye-ihtarname-v2 (dilekce)' gibi bir makine kimliği basılıyor. 'dilekce'/'sozlesme' değerleri Türkçe karakter içermeyen ham kodlardır ve belgede öyle görünüyor.

**Öneri:**
```
`- Belge türü: ${draft.title}`,
```

**Not:** control-plane/src/drafting/markdown.ts. Aynı satır export/petition.py:400 ve export/udf.py:180'de tekrarlanıyor. 113. satırdaki '- Taslak kimliği: dft-<uuid>' de okunamaz; kaldırılmalı ya da kısa bir 'Taslak no' olmalı.

## [P1] tanimsiz-terim — satir 124

**Mevcut:**
```
`- KAYNAKSIZ paragraf sayısı: ${draft.unsupportedCount}`,
```

**Neden:** Dilekçenin künyesinde 'KAYNAKSIZ paragraf sayısı: 3' yazıyor ama belgenin hiçbir yerinde KAYNAKSIZ'ın ne demek olduğu ve ne yapılması gerektiği yazmıyor. Denetim ve inceleme raporlarındaki 'Durum sözlüğü' bloğunun karşılığı burada yok.

**Öneri:**
```
`- Hukukî dayanağı doğrulanamayan paragraf sayısı: ${draft.unsupportedCount} (belgede ⚠ KAYNAKSIZ diye işaretlidir; dayanağı avukat eklemelidir)`,
```

**Not:** control-plane/src/drafting/markdown.ts. Aynı satır export/petition.py:410'da 'KAYNAKSIZ paragraf' etiketiyle var. En doğrusu belgeye kısa bir 'İşaretlerin anlamı' bloğu eklemektir.

## [P1] jargon — satir 157

**Mevcut:**
```
`   - Kaynak: ${entry.source === "UPLOAD" ? "yüklenen belge" : entry.source}`,
```

**Neden:** UPLOAD dışındaki bütün değerler ham makine kodu olarak basılıyor (ör. 'YARGITAY_BEDESTEN', 'MEVZUAT_GOV'). Dilekçenin ekinde İngilizce/büyük harfli sistem adları görünüyor.

**Öneri:**
```
`   - Kaynak: ${sourceLabelTr(entry.source)}`,
```

**Not:** control-plane/src/drafting/markdown.ts. Her kaynak koduna Türkçe karşılık veren sözlük gerekli: 'Yargıtay karar bankası', 'Resmî mevzuat sitesi', 'Dosyaya eklediğiniz belge'. Aynı sorun export/petition.py:449 ve export/udf.py:253'te de var.

## [P1] jargon — satir 158

**Mevcut:**
```
("Değerlendirme tarihi (as-of)", T.human_date(bundle.as_of)),
```

**Neden:** 'as-of' İngilizce. Üstelik bu satır belgedeki en önemli tarihtir (yürürlük hangi tarihe göre hesaplandı) ve etiketin kendisi anlaşılmıyor.

**Öneri:**
```
("Yürürlük hangi tarihe göre değerlendirildi", T.human_date(bundle.as_of)),
```

**Not:** export/plan.py — meta_rows(). Teknik künyedeki 190. satır ('As-of (ISO)') da 'Aynı tarih, makine biçiminde' olmalı ya da kaldırılmalı.

## [P1] jargon — satir 165

**Mevcut:**
```
"UYAP/UDF sınırı: Bu belge DOCX/Markdown olarak üretilir. Nihai düzenleme"
```

**Neden:** 'DOCX/Markdown' bir dosya biçimi çifti; 'Markdown'ı hiçbir avukat bilmez. 'UYAP/UDF sınırı:' açılışı da başlık gibi duruyor ama cümle olarak okunuyor. Bu uyarı dilekçe DOCX'inin sonunda da basılıyor.

**Öneri:**
```
"Bu belge Word dosyası olarak üretilir. Son düzenleme"
```

**Not:** export/text.py — UDF_NOTICE; petition.py:532'de dilekçenin sonuna ekleniyor.

## [P1] ui-kusuru — satir 192

**Mevcut:**
```
f"### Tespit {index} — {T.VERDICT_TR[claim.verdict]}"
```

**Neden:** Devamındaki satır başlığa '({escape_inline(claim.claim_id)})' ekliyor: 'Tespit 1 — DESTEKLENİYOR (clm-4f2a…)'. Makine kimliği belgedeki EN GÖRÜNÜR yere, başlığa basılıyor. Ayrıca 'Tespit' burada 'sonuç' anlamında kullanılıyor, avukatın bildiği tespit değil.

**Öneri:**
```
f"### {index}. Sonuç — {T.VERDICT_TR[claim.verdict]}"
```

**Not:** export/bundle_markdown.py, 191-192. claim_id başlıktan çıkarılmalı. Aynı sorun export/bundle_docx.py:424'te de var.

## [P1] jargon — satir 194

**Mevcut:**
```
("Kanıt paketi şeması", bundle.schema),
```

**Neden:** Künye tablosuna 'collex.evidence-bundle/v1' gibi bir değer basılıyor. Hem 'şema' hem değerin kendisi avukat için anlamsız; belgeye teknik görüntü veriyor.

**Öneri:**
```
Bu satırı belgeden kaldırın; sürüm bilgisi zaten 'Sistem sürümü' satırında var.
```

**Not:** export/plan.py — tech_rows().

## [P2] tanimsiz-terim — satir 55

**Mevcut:**
```
TITLE = "Hukukî Araştırma Cevabı — Kanıt Paketi"
```

**Neden:** 'Kanıt paketi' uydurulmuş bir terim ve belgenin BAŞLIĞI. Avukat 'kanıt paketi' deyince delil listesini anlar; buradaki anlam ise 'raporun dayandığı kaynaklar'. Belgenin adı ilk yanlış anlamayı üretiyor.

**Öneri:**
```
TITLE = "Hukukî Araştırma Raporu — Kaynaklarıyla Birlikte"
```

**Not:** export/text.py. 'Kanıt paketi' ifadesi plan.py, bundle_markdown.py ve composer.ts'de de geçiyor; başlık değişirse hepsi 'rapor' etrafında birleşmeli.

## [P2] ui-kusuru — satir 110

**Mevcut:**
```
        tier = "" if entry.authority_tier is None else f" (kademe {entry.authority_tier})"
```

**Neden:** KAYNAKLAR bölümünde 'Otorite: Yargıtay Hukuk Genel Kurulu (kademe 2)' gibi bir satır çıkıyor. 'Kademe 2'nin neye göre olduğu belgede hiçbir yerde yazmıyor; sayı tek başına bilgi taşımıyor, sadece soru doğuruyor.

**Öneri:**
```
        tier = ""
```

**Not:** export/bundle_markdown.py — _source_entry(). Kademe numarası ya belgeden çıkarılmalı ya da 'Bağlayıcılık sırası: 2/5 (1 en yüksek)' gibi kendini açıklayan biçime getirilmeli. Aynı satır export/bundle_docx.py:332'de var.

## [P2] eksik-aciklama — satir 150

**Mevcut:**
```
  out.push("", "## DAYANAK KAYNAKLARI", "");
```

**Neden:** Belgedeki en uzun bölüm hiçbir giriş cümlesi olmadan başlıyor. Avukat bu bölümün neden var olduğunu, dilekçeyi mahkemeye verirken ekin kalıp kalmayacağını bilmiyor.

**Öneri:**
```
  out.push("", "## DAYANAK KAYNAKLARI", "", "Bu ek, dilekçede atıf yapılan her kaynağın künyesini ve alıntısını gösterir. Dilekçeyi mahkemeye verirken bu eki çıkarabilirsiniz; ek ayrı bir dosya olarak da alınabilir.", "");
```

**Not:** control-plane/src/drafting/markdown.ts. Aynı boşluk export/petition.py:524'te de var.

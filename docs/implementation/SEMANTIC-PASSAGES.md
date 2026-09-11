# Ana araştırmada yerel pasaj seçimi — 09.09.2026

## 10.09 — genel onama kalıbı ve değerlendirme hatası

İki gerçek kararda (`1224717400`, `1224719800`) konu tanımı + HMK 371 standart cümlesi + genel onama formülü görüldü. Artık yalnız bu tam, tanınan kalıptan oluşan gerekçe özel ispat sorusuna aday pasaj üretmez. Açık kanun adı/kısa adı ve davacı/davalı temyiz eden varyantları tanınır. Ek somut gerekçe varsa dışlama yapılmaz. Gerçek soru temyiz/bozma/onama veya 371 ile ilgiliyse metin korunur; planlayıcının sonradan eklediği arama sözcükleri bu istisnayı açamaz. Kaç belgenin böyle elendiği kanıt aşamasında `stockAffirmanceDocumentsExcluded` sayısıyla kaydedilir. Bu sınırlı kalıp denetimi bütün genel gerekçeleri tanıdığı iddiası taşımaz.

İki karardaki eski doğrudan ilgililik etiketi de düzeltildi. Gerekçeyi okuma ile konu benzerliği farklı ölçülerdir. Bu örneklemde sorunun özel ispat yönünü açıklayan doğrulanmış olumlu karar kalmadı; daha iyi olumlu örnekler edinilmeden semantik kalitenin arttığı söylenemez.

`probe-decision-reasoning.mjs` her iki sabit gerçek metinde adayların elendiğini doğruladı. 10.09 canlı tekrar (`8266a678-4d77-42a8-8ceb-83f41c180607`) ise kaynak hatalarıyla 0 belge getirdi; filtreden geçtiği veya isabetin arttığına kanıt değildir. Tam TS son raporu 2565 geçti / 6 mevcut atlama; ayrıca sonradan eklenen gerçek `runResearch` bileşim testi elenen belge sayısını ve boş kanıtı doğruluyor. `check-reasoning-mutations.mjs` gerekçe bağlantısı, kalıp elemesi, soruya göre istisna, ek gerekçeyi koruma, bölüm sınırı, karakter konumu ve etiket bastırma davranışlarını sınar.

10.09.2026 güncellemesi: yerel E5 sıralamasında kalibre edilmemiş yakın/orta/uzak etiketleri artık üretilmiyor; sonuç açıklaması bunu bildiriyor. Regresyon önce etikette başarısız oldu, düzeltmeden sonra geçti. Gerekçe sınırı, asıl metne karakter aralığı dönüşü ve etiket bastırma için üç ek mutasyon yakalandı. Tam TypeScript **2560 geçti / 6 mevcut atlama**, tip kontrolü temiz. Önceki gerekçe düzeltmesinin tamamlanmış raporu da **2559 geçti / 6 atlama** olarak dosyadan doğrulandı. Genel usul cümleleri ile özel ispat sorusunun ayrılması ve sabit karar kümesinde kalite karşılaştırması açık.

Yerel E5 modeli ana `runResearch` yoluna bağlandı. Yalnız açık yerel model yapılandırması kullanılır; MCP aracı eklenmez, uzak bir embedding sağlayıcısı kendiliğinden çağrılmaz. Senkron ve asenkron araştırma aynı seçeneği alır.

Her getirilen karardan en çok dört örtüşmeyen, kelime eşleşmesiyle seçilmiş aday pasaj alınır. Toplam en çok 40 pasaj tek model çağrısında karşılaştırılır. Model belge başına eski alıntı kotasını koruyarak seçim yapar; metni, karakter aralığını, kaynak kimliğini, karşıtlık bilgisini ve mevcut retrieval puanını değiştirmez. Sıfır/bozuk vektör, boyut/adet uyuşmazlığı veya servis hatasında eski seçim aynen korunur. Model süresi kalan araştırma bütçesiyle ve en çok 5 saniyeyle sınırlıdır; iptal sinyalini yok sayan port da beklemeyi uzatamaz. Semantik seçim .4 coverage veya .85 entailment eşiklerini değiştirmez.

## Gerçek denemede bulunan yeni sorun

Önceki uzun İzmir işçilik sorusu, 14 çağrı / 6 belge / 120 saniye bütçesiyle çalıştırıldı. `43cca49a-688f-4ae0-b751-da375d1b2234`: 12 çağrı, 6 getirme, yaklaşık 72,2 saniye kaynak erişimi; semantik seçimli kanıt aşaması 855 ms. Trace `semanticPassageSelectionApplied:1` döndürdü. Sonuç PARTIAL / kesinleştirilemez. İki alıntı da 9. HD 2026/2266 E., 2026/4307 K. kararının ilk derece özetinden geldi. **Bu sonuç kalite başarısı değildir.**

Kararın tam metni yerel kayıt üzerinden okundu. Açık `B. Değerlendirme ve Gerekçe` bölümü olmasına rağmen önceki seçici dava/cevap/ilk derece özetinin sözcük eşleşmesini tercih ediyordu. Artık karar türünde ve tanınan açık gerekçe başlığı bulunan metinlerde seçim bu bölümden yapılır; karar/hüküm/sonuç başlığında durur. Başlıksız metinlerde önceki davranış korunur. Unicode karakter aralıkları asıl metne geri çevrilir; alıntı doğrulaması aynı kalır.

Aynı sabit gerçek metinle karşılaştırmada ilk derece özeti yerine gerekçe seçildi (`decision-reasoning-comparison.json`). Ancak seçilen gerekçe hâlâ genel usul/onama cümleleri içeriyor; mevcut kelime kapsamı eşiğini geçmesi tanıkla ispat sorusunu cevapladığını kanıtlamıyor. Bu ikinci kalite açığı çözülmüş sayılmıyor. Bölüm seçimi sınırlı ve açık bir başlık listesine dayanır; bütün karar biçimlerini tanıdığı iddia edilmez.

## Doğrulama ve devam

Pasaj seçimi için 9 birim kontrolü ve gerçek araştırma bileşimini kullanan 1 test; gerekçe ayrımı için 2 test eklendi. Seçim yönü, belge kotası, kanıt puanını değiştirme ve bitmiş süre bütçesi olmak üzere dört mutasyon yakalandı. İlk entegrasyon sonrası tam TS: 2557 geçti / 6 mevcut atlama. Gerekçe düzeltmesinin tam paket sonucu ayrıca STATUS'a kaydedilir.

Sıradaki üç somut iş: (1) genel usul cümleleri ile sorunun özel ispat meselesini ayıran kalite kontrolü, (2) aynı sabit karar kümesinde semantik/kelime seçiminin konu bazlı karşılaştırması, (3) yerel modelin kalibre edilmemiş yakın/orta/uzak etiketlerini düzeltmek. Yerel OCR, bağımsız rakip karşılaştırması ve 18 açının iki bulgusuz denetim turu da açık. Ürün üstünlüğü iddia edilmez.

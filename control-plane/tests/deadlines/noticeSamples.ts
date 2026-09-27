/**
 * Realistic Turkish tebligat samples for the "Tebligattan süreye" reader.
 * Hand-written for these tests (names, numbers and barcodes are invented);
 * they follow the layout of real UETS receipts, PTT mazbatas, gerekçeli
 * karar first pages and İİK Örnek 7 payment orders.
 */

/** UETS receipt: gerekçeli karar of an asliye hukuk; ulaşma 27.10 → tebliğ 01.11 (Pazar, month end). */
export const UETS_RECEIPT = [
  "T.C.",
  "ADALET BAKANLIĞI",
  "ULUSAL ELEKTRONİK TEBLİGAT SİSTEMİ (UETS)",
  "ELEKTRONİK TEBLİGAT ALINDI BELGESİ",
  "",
  "Gönderici Birim      : İstanbul 12. Asliye Hukuk Mahkemesi",
  "Muhatap              : Av. Zeynep KARACA (Davacı Vekili)",
  "Elektronik Adres     : 12345-67890-12345",
  "Barkod No            : UETS-2026-0000123456",
  "Dosya No             : 2025/345 Esas",
  "Evrak Türü           : Gerekçeli Karar",
  "Gönderilme Tarihi    : 26.10.2026 15:42",
  "Muhataba Ulaştırıldığı Tarih : 27.10.2026 09:14:05",
  "Okunma Tarihi        : 28.10.2026 11:02",
  "",
  "Bu belge, 7201 sayılı Tebligat Kanunu'nun 7/a maddesi ve Elektronik Tebligat Yönetmeliği uyarınca oluşturulmuştur.",
].join("\n");

/** Same receipt, ulaşma 24.10.2026 → fifth day 29.10.2026, Cumhuriyet Bayramı. */
export const UETS_RECEIPT_HOLIDAY = UETS_RECEIPT.replace("26.10.2026 15:42", "23.10.2026 16:05")
  .replace("27.10.2026 09:14:05", "24.10.2026 10:20:00")
  .replace("28.10.2026 11:02", "30.10.2026 08:55");

/** Receipt that also prints the deemed date — agreeing with ulaşma + 5. */
export const UETS_RECEIPT_AGREEING = `${UETS_RECEIPT}\nTebliğ Edilmiş Sayıldığı Tarih : 01.11.2026`;

/** Receipt whose printed tebliğ date disagrees with ulaşma + 5. */
export const UETS_RECEIPT_CONFLICTING = `${UETS_RECEIPT}\nTebliğ Tarihi : 30.10.2026`;

/** PTT tebligat mazbatası: dava dilekçesi served on a company employee. */
export const PTT_MAZBATA = [
  "TEBLİĞ MAZBATASI",
  "Barkod No: RR 123 456 789 TR",
  "Tebliğ Eden Merci: Ankara 3. İş Mahkemesi",
  "Dosya No: 2026/118 Esas",
  "Tebliğ Olunacak Evrak: Dava dilekçesi ve eki, duruşma günü bildirir davetiye",
  "Muhatap: Kaya İnşaat Ltd. Şti. yetkilisi",
  "Adres: Kızılay Mah. Atatürk Blv. No: 12 Çankaya/ANKARA",
  "",
  "Tebliğ Tarihi: 14.10.2026",
  "Tebliğ olunacak evrak muhatap şirket adına daimi çalışan Ahmet Yılmaz'a 14.10.2026 tarihinde imzası alınarak tebliğ edildi.",
  "Tebliğ memuru: Mehmet Demir (PTT)",
].join("\n");

/** Mazbata written only as a sentence ("… bizzat imzasına tebliğ edildi"). */
export const PTT_MAZBATA_SENTENCE = [
  "TEBLİGAT MAZBATASI",
  "Gönderen: İzmir 2. Sulh Hukuk Mahkemesi",
  "Tebliğ olunan evrak: Bilirkişi raporu",
  "Muhatap: Selin Arı",
  "Tebligat evrakı 05/11/2026 tarihinde muhatabın bizzat kendisine imzasına tebliğ edildi.",
  "Dağıtıcı: H. Kurt",
].join("\n");

/** Mazbata under TK m.21 (muhtara bırakma, kapıya yapıştırma). */
export const PTT_MAZBATA_TK21 = [
  "TEBLİĞ MAZBATASI",
  "Tebliğ Eden Merci: Bursa 1. Asliye Ticaret Mahkemesi",
  "Tebliğ Olunacak Evrak: Gerekçeli Karar",
  "Muhatap adreste bulunmadığından, komşusu Ali Er'den adreste oturduğu teyit edilerek evrak mahalle muhtarı Veli Tan'a teslim edildi;",
  "Tebligat Kanunu'nun 21/1. maddesi gereğince 2 numaralı ihbarname kapısına yapıştırıldı.",
  "Tebliğ Tarihi: 09.12.2026",
].join("\n");

/** First page of a gerekçeli karar — NO tebliğ date on it. */
export const GEREKCELI_KARAR = [
  "T.C.",
  "İZMİR",
  "4. ASLİYE TİCARET MAHKEMESİ",
  "GEREKÇELİ KARAR",
  "",
  "ESAS NO    : 2025/771 Esas",
  "KARAR NO   : 2026/402",
  "HAKİM      : Ayşe DEMİR 12345",
  "KATİP      : Ali VURAL 67890",
  "",
  "DAVACI     : Deniz Lojistik A.Ş.",
  "VEKİLİ     : Av. Can ÖZ",
  "DAVALI     : Ege Gıda San. Tic. Ltd. Şti.",
  "DAVA       : Alacak (Ticari Satımdan Kaynaklanan)",
  "DAVA TARİHİ: 03/02/2025",
  "KARAR TARİHİ: 12/05/2026",
  "G.KARAR YAZIM TARİHİ: 02/06/2026",
  "",
  "Davacı vekili dava dilekçesinde özetle; müvekkili şirket ile davalı arasında 01/03/2024 tarihli taşıma sözleşmesi imzalandığını, bedelin ödenmediğini ileri sürmüştür. Dava dilekçesi davalıya 20/02/2025 tarihinde tebliğ edilmiş, davalı süresinde cevap vermemiştir.",
  "Yargıtay 11. Hukuk Dairesi'nin 14.03.2023 tarih, 2022/1234 E. 2023/987 K. sayılı kararında da belirtildiği üzere …",
  "HÜKÜM: Davanın KABULÜNE, … Dair, kararın tebliğinden itibaren 2 hafta içinde İzmir Bölge Adliye Mahkemesine istinaf yolu açık olmak üzere, davacı vekilinin yüzüne karşı, davalının yokluğunda verilen karar açıkça okunup usulen anlatıldı. 12/05/2026",
].join("\n");

/** A kesinleşme şerhi: every date belongs to OTHER events. */
export const KESINLESME_SERHI = [
  "T.C.",
  "İZMİR 4. ASLİYE TİCARET MAHKEMESİ",
  "ESAS NO: 2025/771",
  "KARAR NO: 2026/402",
  "KESİNLEŞME ŞERHİ",
  "İşbu karar davacı vekiline 20.06.2026, davalıya 23.06.2026 tarihinde tebliğ edilmiş olup, süresi içinde istinaf yoluna başvurulmadığından 08.07.2026 tarihinde kesinleşmiştir.",
].join("\n");

/** İİK Örnek 7 ödeme emri (genel haciz yolu). */
export const ODEME_EMRI_ORNEK7 = [
  "T.C.",
  "İSTANBUL ANADOLU 7. İCRA DAİRESİ",
  "ÖDEME EMRİ",
  "(İlamsız takiplerde — Örnek No: 7)",
  "Dosya No: 2026/15487 Esas",
  "Borçlu: Mert Aksoy, Bağdat Cad. No: 5 Kadıköy/İSTANBUL",
  "Alacaklı: Yıldız Tekstil A.Ş.",
  "Alacak miktarı: 48.500,00 TL",
  "Yukarıda yazılı borcu işbu ödeme emrinin tebliğinden itibaren 10 gün içinde ödemeniz; borcun tamamına veya bir kısmına, alacaklının takip hakkına itirazınız varsa bunu 7 gün içinde icra dairesine bildirmeniz gerektiği ihtar olunur.",
  "Düzenleme Tarihi: 02.10.2026",
].join("\n");

/** Kambiyo ödeme emri (Örnek 10) — five-day itiraz. */
export const ODEME_EMRI_KAMBIYO = ODEME_EMRI_ORNEK7.replace("(İlamsız takiplerde — Örnek No: 7)", "(Kambiyo senetlerine mahsus haciz yoluyla takipte — Örnek No: 10)").replace(
  "7 gün içinde icra dairesine",
  "5 gün içinde icra mahkemesine",
);

/** A dava dilekçesi served by itself (the petition, not a receipt). */
export const DAVA_DILEKCESI = [
  "ANKARA NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "DAVACI      : Elif Koç",
  "VEKİLİ      : Av. Burak Şen",
  "DAVALI      : Mavi Otomotiv A.Ş.",
  "KONU        : Ayıplı araç nedeniyle bedel iadesi talebimizden ibarettir; ödeme emri ve icra takibi yoktur.",
  "AÇIKLAMALAR :",
  "1- Müvekkil 12.01.2026 tarihli satış sözleşmesi ile davalıdan araç satın almıştır.",
].join("\n");

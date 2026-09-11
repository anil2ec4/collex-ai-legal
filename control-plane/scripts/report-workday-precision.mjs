import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Full texts were read individually. These are agent labels, not a blinded
// lawyer-reviewed benchmark. Grade 2 = substantive decision on the queried
// employment issue; 1 = related but procedural/incidental; 0 = unrelated.
const labels = {
  "71370900": [0, "Boşanma hükmünün kesinleşmesi ve icra; işçilik uyuşmazlığı değil."],
  "1223426300": [0, "İnşaat sigortası uyuşmazlığında daireye gönderme."],
  "1224718700": [1, "İşçi-işveren tazminat uyuşmazlığı; yalnız görevli daireye gönderme, esasa ilişkin gerekçe yok."],
  "1224719500": [1, "Kıdem iadesi/alacak uyuşmazlığında yalnız daireye gönderme."],
  "1223480200": [1, "Ücret ödeme idari para cezası; kıdem vadesine dolaylı atıf, kıdem hakkını çözmüyor."],
  "1219965000": [1, "İşçilik ödemeleri nedeniyle teminat uyuşmazlığı; bozma tüzel kişinin taraf ehliyetine ilişkin."],
  "1224339200": [0, "Adli yardım reddine itirazın daireye gönderilmesi; fazla çalışma değil."],
  "1220747300": [0, "Uyuşturucu ticareti ve etkin pişmanlık."],
  "1220735500": [0, "Uyuşturucu ticareti ceza hesabı."],
  "1222562600": [1, "Yurt dışı işçilik alacakları; direnme/yeni hüküm ayrımı nedeniyle daireye gönderme."],
  "1224717400": [2, "Fazla çalışma, tanık ve nöbet çizelgesi değerlendirmesine dayanan hükmün onanması."],
  "1224719800": [2, "Fesih, kıdem ve fazla çalışma alacaklarının ispatına ilişkin hükmün onanması."],
};
const source = new URL("../../var/audit-20260907/query-precision-fulltexts.json", import.meta.url);
const samples = JSON.parse(readFileSync(source, "utf8").replace(/^\uFEFF/u, ""));
const rows = samples.map(({ query, row, card }, index) => {
  const label = labels[row.externalId];
  if (!label || typeof card.text !== "string" || !card.text.length) throw new Error("Unlabelled or empty sample");
  return { query, rank: index % 3 + 1, externalId: row.externalId, title: row.title,
    sourceUrl: row.sourceUrl, grade: label[0], reason: label[1],
    sha256: createHash("sha256").update(card.text).digest("hex") };
});
const report = {
  measuredAt: "2026-09-07", rubric: "2: doğrudan esasa ilişkin; 1: ilgili fakat usul/dolaylı; 0: ilgisiz",
  limitation: "İki kavram, dört sorgu, ilk üç sonuç. Ajanın tam metin etiketlemesi; bağımsız avukat doğrulaması yok. Genel arama başarısını ölçmez.",
  queries: [...new Set(rows.map((r) => r.query))].map((query) => {
    const selected = rows.filter((r) => r.query === query);
    return { query, inspected: selected.length, direct: selected.filter((r) => r.grade === 2).length,
      relatedOnly: selected.filter((r) => r.grade === 1).length,
      unrelated: selected.filter((r) => r.grade === 0).length };
  }), rows,
};
writeFileSync(new URL("../../var/audit-20260907/query-precision-labelled.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ limitation: report.limitation, queries: report.queries }, null, 2));

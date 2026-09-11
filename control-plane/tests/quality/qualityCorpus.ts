/**
 * SENTETİK (synthetic) Turkish legal corpus for the retrieval-quality tests.
 *
 * NOTHING HERE IS REAL TURKISH LAW OR A REAL COURT DECISION. Every title
 * carries "(SENTETİK)", every URL points at example.invalid, and every passage
 * is hand-written to exercise one specific retrieval mechanism. It must never
 * be shown to a human as law, and no number produced from it is a statement
 * about legal quality.
 *
 * It is also deliberately NOT the eval corpus (evals/fixtures/corpus). These
 * tests must fail when a mechanism breaks, not when a gold answer changes, so
 * the text here is authored independently and the assertions are about
 * behaviour — "the stemmer bridged the genitive", "the opposing outcome was
 * classified and surfaced" — never about a gold record.
 *
 * WHY EACH DOCUMENT EXISTS
 *   CEZA-KANUNU  two versions with adjacent effective periods and a real
 *                commencement date, so as-of selection has three distinct
 *                answers (before commencement / v1 / v2). legislation_no 5237
 *                is structural: the reference parser's abbreviation table maps
 *                "TCK" to that number, and the citation-form test needs a real
 *                abbreviation to resolve. The TEXT is invented.
 *   TORBA-KANUNU an amending provision that names its target in prose, for
 *                one-hop citation expansion. Its chunk opens with its own
 *                "MADDE 1 -" heading, which is exactly the trap the pairing
 *                rule has to avoid.
 *   KARAR-ONAMA  a decision whose operative words are AFFIRMATIVE.
 *   KARAR-BOZMA  a decision on the SAME issue whose operative words are
 *                NEGATIVE. The pair is the whole point: retrieval that ranks
 *                by similarity to the question finds one of them and must be
 *                made to surface the other.
 *   TAPU-NOTU    an unrelated document, so "returns nothing" assertions are
 *                about the query and not about an empty corpus.
 */

import { createHash } from "node:crypto";
import type { Sql } from "../../src/store/db.js";

export const QUALITY_SOURCE = "fixture-quality";

/** Commencement of v2. Chosen as a date, not a boundary trick. */
export const V2_FROM = "2024-07-01";
export const V1_FROM = "2019-01-01";

/** The three as-of dates the temporal test uses. */
export const BEFORE_ANY_VERSION = "2018-03-15";
export const DURING_V1 = "2021-05-05";
export const DURING_V2 = "2025-05-05";

/**
 * Commencement of the amending law. Deliberately EARLIER than the amendment it
 * enacts (its own article 2 defers article 1 to V2_FROM, which is ordinary
 * Turkish drafting). That gap is what makes citation expansion's as-of
 * behaviour observable: between these two dates the amending provision is in
 * force while its target still reads the old way, so following the citation
 * must land on v1 — a bug that returned "the current text" would land on v2
 * and be invisible if both commenced on the same day.
 */
export const TORBA_FROM = "2023-01-01";
export const TORBA_BEFORE_V2 = "2023-06-01";

export interface QualityChunk {
  /** null for decision sections (structural_path becomes the section name). */
  articleNo: string | null;
  /** Section slug for decisions; ignored when articleNo is set. */
  section?: string;
  text: string;
}

export interface QualityVersion {
  label: string;
  /** null => effective_period NULL (a decision has no validity period). */
  effectiveFrom: string | null;
  /** null => open-ended. */
  effectiveTo?: string | null;
  legislationNo?: string;
  docketNo?: string;
  decisionNo?: string;
  decisionDate?: string;
  court?: string;
  chunks: QualityChunk[];
}

export interface QualityDoc {
  externalId: string;
  title: string;
  documentType: string;
  /** Oldest first — insertion order drives the close-on-append trigger. */
  versions: QualityVersion[];
}

const V1_ARTICLE_160 =
  "MADDE 160 - (1) Aldatıcı davranışlarla bir kimseyi yanıltarak " +
  "kendisine veya bir başkasına haksız çıkar sağlayan kişi, dolandırıcılık " +
  "fiilinden dolayı iki yıldan altı yıla kadar hapis cezası ile " +
  "cezalandırılır.";

const V2_ARTICLE_160 =
  "MADDE 160 - (1) Aldatıcı davranışlarla bir kimseyi yanıltarak " +
  "kendisine veya bir başkasına haksız çıkar sağlayan kişi, dolandırıcılık " +
  "fiilinden dolayı dört yıldan sekiz yıla kadar hapis cezası ile " +
  "cezalandırılır.";

const ARTICLE_161 =
  "MADDE 161 - (1) Yüz altmışıncı maddede tanımlanan fiilin bilişim " +
  "sistemleri araç olarak kullanılmak suretiyle işlenmesi ağırlaştırıcı " +
  "sebep sayılır.";

export const QUALITY_DOCS: readonly QualityDoc[] = [
  {
    externalId: "SENTETIK-CEZA-KANUNU",
    title: "Sentetik Ceza Kanunu — dolandırıcılık maddeleri (SENTETİK)",
    documentType: "kanun",
    versions: [
      {
        label: "v1",
        effectiveFrom: V1_FROM,
        effectiveTo: V2_FROM,
        legislationNo: "5237",
        chunks: [
          { articleNo: "160", text: V1_ARTICLE_160 },
          { articleNo: "161", text: ARTICLE_161 },
        ],
      },
      {
        label: "v2",
        effectiveFrom: V2_FROM,
        legislationNo: "5237",
        chunks: [
          { articleNo: "160", text: V2_ARTICLE_160 },
          { articleNo: "161", text: ARTICLE_161 },
        ],
      },
    ],
  },
  {
    externalId: "SENTETIK-TORBA-KANUNU",
    title: "Sentetik Değişiklik Kanunu (SENTETİK)",
    documentType: "kanun",
    versions: [
      {
        label: "v1",
        effectiveFrom: TORBA_FROM,
        legislationNo: "7101",
        chunks: [
          {
            articleNo: "1",
            // Opens with its OWN "MADDE 1 -" heading and then cites a
            // DIFFERENT article of a different law. Pairing that walks
            // forward from the legislation reference must resolve 5237/160
            // and must not mistake the heading's "1" for the target.
            text:
              "MADDE 1 - (1) 5237 sayılı Sentetik Ceza Kanununun 160 ıncı " +
              "maddesinin birinci fıkrasında yer alan \"iki yıldan altı yıla " +
              "kadar\" ibaresi \"dört yıldan sekiz yıla kadar\" şeklinde " +
              "değiştirilmiştir.",
          },
          {
            articleNo: "2",
            text:
              "MADDE 2 - (1) Bu Kanunun birinci maddesi 1/7/2024 tarihinde, " +
              "diğer hükümleri yayımı tarihinde yürürlüğe girer.",
          },
        ],
      },
    ],
  },
  {
    externalId: "SENTETIK-KARAR-ONAMA",
    title: "Sentetik Ceza Dairesi E. 2023/100 K. 2024/200 (SENTETİK)",
    documentType: "yargitay_karari",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        docketNo: "2023/100",
        decisionNo: "2024/200",
        decisionDate: "2024-02-14",
        court: "Sentetik Yargıtay 21. Ceza Dairesi",
        chunks: [
          {
            articleNo: null,
            section: "ozet",
            text:
              "ÖZET: Ödeme kabiliyeti bulunmadığı hâlde peşin tahsilat yapan " +
              "sanığın eyleminin dolandırıcılık suçunu oluşturduğu hakkında.",
          },
          {
            articleNo: null,
            section: "gerekce",
            text:
              "GEREKÇE: Sanığın edimini yerine getirme niyeti taşımadan peşin " +
              "tahsilat yaptığı ve sözleşme öncesinde aldatma kastıyla " +
              "hareket ettiği anlaşıldığından, dolandırıcılık suçunun " +
              "unsurlarının oluştuğu kabul edilmelidir.",
          },
        ],
      },
    ],
  },
  {
    externalId: "SENTETIK-KARAR-BOZMA",
    title: "Sentetik Ceza Dairesi E. 2023/300 K. 2024/400 (SENTETİK)",
    documentType: "yargitay_karari",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        docketNo: "2023/300",
        decisionNo: "2024/400",
        decisionDate: "2024-09-03",
        court: "Sentetik Yargıtay 21. Ceza Dairesi",
        chunks: [
          {
            articleNo: null,
            section: "ozet",
            text:
              "ÖZET: Peşin tahsilat yapıldıktan sonra edimin yerine " +
              "getirilmemesi hâlinde uyuşmazlığın hukuki nitelikte olduğu ve " +
              "dolandırıcılık suçunun unsurları oluşmadığı hakkında.",
          },
          {
            articleNo: null,
            section: "gerekce",
            text:
              "GEREKÇE: Sanığın sözleşme öncesinde aldatma kastıyla hareket " +
              "ettiği ispatlanamadığından, taraflar arasındaki uyuşmazlığın " +
              "hukuki nitelikte olduğu ve dolandırıcılık suçunun unsurları " +
              "oluşmadığından yerel mahkeme hükmünün bozulmasına karar " +
              "verilmiştir.",
          },
        ],
      },
    ],
  },
  {
    externalId: "SENTETIK-TAPU-NOTU",
    title: "Sentetik tapu sicili notu (SENTETİK)",
    documentType: "doktrin",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            section: "metin",
            text:
              "Taşınmaz mülkiyetinin devrinde tapu sicilindeki tescilin " +
              "kurucu etkisi bulunur; zilyetliğin devri tek başına mülkiyeti " +
              "geçirmez.",
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

export interface InsertedQualityCorpus {
  /** externalId -> documents.id */
  documentIds: Map<string, string>;
  /** "<externalId>#<versionLabel>" -> document_versions.id */
  versionIds: Map<string, string>;
  /** "<externalId>#<versionLabel>:<articleNo|section>" -> chunks.id */
  chunkIds: Map<string, string>;
  /** chunks.id -> the stable unit id the assertions use. */
  unitOf: Map<string, string>;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Unicode code-point length (NOT UTF-16 units) — the offset policy. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

function trLower(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function slotOf(chunk: QualityChunk): string {
  return chunk.articleNo ?? chunk.section ?? "metin";
}

export async function insertQualityCorpus(
  sql: Sql,
): Promise<InsertedQualityCorpus> {
  const documentIds = new Map<string, string>();
  const versionIds = new Map<string, string>();
  const chunkIds = new Map<string, string>();
  const unitOf = new Map<string, string>();

  for (const doc of QUALITY_DOCS) {
    const url = "https://example.invalid/quality/" + doc.externalId;
    const docRows = await sql`
      insert into legal.documents
        (scope, tenant_id, source, external_id, document_type, jurisdiction,
         title, canonical_source_url)
      values
        ('public'::legal.document_scope, null, ${QUALITY_SOURCE},
         ${doc.externalId}, ${doc.documentType}, 'TR', ${doc.title}, ${url})
      returning id`;
    const documentId = asId(docRows[0], "documents");
    documentIds.set(doc.externalId, documentId);

    for (const version of doc.versions) {
      const versionKey = doc.externalId + "#" + version.label;
      const canonicalText = version.chunks.map((c) => c.text).join("\n");
      const snapRows = await sql`
        insert into legal.source_snapshots
          (source, external_id, requested_url, final_url, retrieved_at,
           http_status, media_type, raw_object_key, raw_sha256,
           parser_name, parser_version)
        values
          (${QUALITY_SOURCE}, ${versionKey}, ${url}, ${url}, now(), 200,
           'text/html', ${"quality/" + versionKey + ".html"},
           ${sha256Hex(canonicalText)}, 'quality-fixture', '1.0.0')
        returning id`;
      const snapshotId = asId(snapRows[0], "source_snapshots");

      const effective =
        version.effectiveFrom === null
          ? null
          : "[" +
            version.effectiveFrom +
            "," +
            (version.effectiveTo ?? "") +
            ")";

      const versionRows = await sql`
        insert into legal.document_versions
          (document_id, source_snapshot_id, version_label, status,
           effective_period, decision_date, court, docket_no, decision_no,
           legislation_no, canonical_text, normalized_text, content_sha256)
        values
          (${documentId}, ${snapshotId}, ${version.label}, 'published',
           ${effective}::daterange,
           ${version.decisionDate ?? null}::date,
           ${version.court ?? null},
           ${version.docketNo ?? null}, ${version.decisionNo ?? null},
           ${version.legislationNo ?? null},
           ${canonicalText}, ${trLower(canonicalText)},
           ${sha256Hex(canonicalText)})
        returning id`;
      const versionId = asId(versionRows[0], "document_versions");
      versionIds.set(versionKey, versionId);

      let offset = 0;
      for (const [ordinal, chunk] of version.chunks.entries()) {
        const startChar = offset;
        const endChar = startChar + codePointLength(chunk.text);
        offset = endChar + 1; // the "\n" joiner is one code point
        const structuralPath =
          chunk.articleNo !== null
            ? ["madde-" + chunk.articleNo]
            : ["bolum-" + (chunk.section ?? "metin")];
        const chunkRows = await sql`
          insert into legal.chunks
            (document_version_id, ordinal, structural_path, article_no,
             start_char, end_char, original_text, search_text,
             normalizer_version, content_sha256, token_count)
          values
            (${versionId}, ${ordinal}, ${structuralPath}, ${chunk.articleNo},
             ${startChar}, ${endChar}, ${chunk.text}, ${trLower(chunk.text)},
             'trnorm-v1', ${sha256Hex(chunk.text)},
             ${chunk.text.split(/\s+/u).length})
          returning id`;
        const chunkId = asId(chunkRows[0], "chunks");
        const slot = versionKey + ":" + slotOf(chunk);
        chunkIds.set(slot, chunkId);
        unitOf.set(chunkId, slot);
      }
    }
  }

  return { documentIds, versionIds, chunkIds, unitOf };
}

function asId(row: Record<string, unknown> | undefined, table: string): string {
  const id = row?.["id"];
  if (typeof id !== "string") {
    throw new Error("insert into legal." + table + " returned no id");
  }
  return id;
}

/**
 * The part of a real case file that carries no legal lexeme at all: parties,
 * dates, amounts, file numbers, procedural history. This is exactly the text
 * that used to sink the coverage ratio, so every long form below carries it.
 * SENTETİK.
 */
const CASE_FILE_TAIL =
  "Dosya kapsamında ayrıca 12 Ocak 2024 tarihli iki sayfalık bir tutanak, " +
  "aynı tarihe ait banka dekontları ve taraflar arasındaki 41 sayfalık " +
  "yazışma dökümü bulunmaktadır. Yazışmaların büyük bölümü teslim takvimi " +
  "ve fatura numaraları üzerinedir. Dosya, İzmir 3. Asliye Ceza Mahkemesinin " +
  "2024/771 esas sayısına kayıtlıdır ve bir kez tensip zaptı düzenlenmiştir. " +
  "Vekâletname 3 Şubat 2024 tarihinde düzenlenmiş, harç ve masraflar aynı gün " +
  "yatırılmıştır. Müvekkilim 41 yaşında, evli ve iki çocuk sahibidir; daha " +
  "önce herhangi bir soruşturma geçirmemiştir. Adres değişikliği 2024 yılının " +
  "Haziran ayında UYAP üzerinden bildirilmiştir. "

export interface LongFormPair {
  id: string;
  /** The legal question a lawyer would type if they were being terse. */
  short: string;
  /** The same question inside the facts. */
  long: string;
}

/** SENTETİK fact patterns: invented parties, dates and amounts. */
export const LONG_FORM_PAIRS: readonly LongFormPair[] = [
  {
    id: "L1",
    short: "Peşin tahsilat yapıp edimini yerine getirmemek dolandırıcılık suçunu oluşturur mu?",
    long:
      "Müvekkilim Ayşe Yıldırım, 14 Mart 2023 tarihinde İzmir Karşıyaka'da ikamet eden " +
      "karşı taraf ile sözlü olarak anlaşmış ve kendisine ait bir taşınır malın satışı " +
      "konusunda görüşmelere başlamıştır. Karşı taraf, 18 Mart 2023 tarihinde müvekkilimin " +
      "banka hesabına 45.000 TL peşin ödeme yapmış, kalan 30.000 TL teslim anında " +
      "ödenecek biçimde kararlaştırılmıştır. Müvekkilim, ödeme tarihinden sonra malı teslim " +
      "etmemiş, karşı tarafın 2 Nisan ve 19 Nisan 2023 tarihli iki ihtarnamesine de cevap " +
      "vermemiştir. Karşı taraf İzmir Cumhuriyet Başsavcılığına şikâyette bulunmuş, " +
      "soruşturma 2023/18452 sayılı dosya üzerinden yürütülmektedir. Müvekkilim, malı " +
      "teslim etmemesinin sebebinin kendi tedarikçisinin iflası olduğunu beyan etmektedir. " +
      CASE_FILE_TAIL +
      "Peşin tahsilat yapıp edimini yerine getirmemek dolandırıcılık suçunu oluşturur mu?",
  },
  {
    id: "L2",
    short: "Aldatma kastı ispatlanamazsa uyuşmazlık hukuki nitelikte midir?",
    long:
      "Dosyamızda karşı taraf, müvekkilimin sözleşme öncesinde kendisini yanılttığını " +
      "ileri sürmektedir. Taraflar arasında 7 Şubat 2022 tarihli yazılı bir çerçeve " +
      "anlaşma bulunmakta, anlaşmanın dördüncü maddesinde teslim tarihi 30 Haziran 2022 " +
      "olarak belirlenmiştir. Müvekkilim teslimatı 12 Eylül 2022 tarihinde kısmen " +
      "gerçekleştirmiş, kalan kısım için ek süre talep etmiştir. Karşı taraf ek süre " +
      "talebini reddederek hem cezai şart hem de şikâyet yoluna başvurmuştur. Bilirkişi " +
      "raporunda müvekkilimin üretim kapasitesinin anlaşma tarihinde yeterli olduğu, " +
      "gecikmenin tedarik zinciri kaynaklı olduğu belirtilmiştir. " +
      CASE_FILE_TAIL +
      "Aldatma kastı ispatlanamazsa uyuşmazlık hukuki nitelikte midir?",
  },
  {
    id: "L3",
    short: "Bilişim sistemlerinin araç olarak kullanılması ağırlaştırıcı sebep sayılır mı?",
    long:
      "Müvekkilim hakkında yürütülen soruşturmada, kendisine ait olduğu ileri sürülen bir " +
      "internet sitesi üzerinden 2023 yılının Mayıs ayında toplam on bir kişiden para " +
      "toplandığı iddia edilmektedir. Site kayıtlarına göre ödemeler sanal POS " +
      "üzerinden alınmış, her bir ödeme 2.500 TL ile 9.000 TL arasında değişmiştir. " +
      "Müvekkilim, sitenin kendisi tarafından değil, eski iş ortağı Mehmet Kaya " +
      "tarafından yönetildiğini, alan adının yalnızca kendi adına kayıtlı olduğunu " +
      "beyan etmektedir. Savcılık, eylemin internet üzerinden gerçekleştirilmiş olmasına " +
      "ayrıca ağırlık vermektedir. " +
      CASE_FILE_TAIL +
      "Bilişim sistemlerinin araç olarak kullanılması ağırlaştırıcı sebep sayılır mı?",
  },
  {
    id: "L4",
    short: "Taşınmaz mülkiyetinin devrinde tapu sicilindeki tescilin etkisi nedir?",
    long:
      "Müvekkilim, 2019 yılında Manisa'da bulunan bir taşınmazı harici satış sözleşmesiyle " +
      "satın almış, bedelin tamamını elden ödemiş ve taşınmaza fiilen yerleşmiştir. " +
      "Taraflar tapu devrini daha sonra yapmak üzere anlaşmış, ancak satıcı 2021 yılında " +
      "vefat etmiş ve mirasçıları devirden kaçınmıştır. Müvekkilim taşınmazda altı yıldır " +
      "oturmakta, emlak vergisini kendisi ödemekte ve komşuları tarafından malik olarak " +
      "bilinmektedir. Mirasçılar ise kaydın hâlâ murise ait olduğunu ileri sürmektedir. " +
      "Dosyaya sunulan kayıtta müvekkilim lehine hiçbir şerh bulunmamaktadır. " +
      CASE_FILE_TAIL +
      "Taşınmaz mülkiyetinin devrinde tapu sicilindeki tescilin etkisi nedir?",
  },
  {
    id: "L5",
    short: "Ödeme kabiliyeti bulunmadığı hâlde peşin tahsilat yapan sanığın eylemi nasıl değerlendirilir?",
    long:
      "Soruşturma dosyasında müvekkilimin, 2023 yılı Ekim ayında üç ayrı kişiden toplam " +
      "180.000 TL peşin tahsilat yaptığı, bu tarihte kendisine ait şirketin banka " +
      "hesaplarında 4.200 TL bulunduğu ve şirketin iki aydır maaş ödeyemediği " +
      "belirtilmektedir. Müvekkilim, tahsilat sırasında bir müşteriden alacağının " +
      "kısa sürede tahsil edileceğini düşündüğünü, ancak o alacağın da ödenmediğini " +
      "beyan etmektedir. Dosyaya sunulan hesap hareketleri, tahsil edilen paranın " +
      "büyük bölümünün mevcut borçların kapatılmasında kullanıldığını göstermektedir. " +
      CASE_FILE_TAIL +
      "Ödeme kabiliyeti bulunmadığı hâlde peşin tahsilat yapan sanığın eylemi nasıl değerlendirilir?",
  },
  {
    id: "L6",
    short: "Değişiklik kanunuyla dolandırıcılık maddesinin cezası nasıl değiştirilmiştir?",
    long:
      "Müvekkilime isnat edilen eylem 2023 yılının Kasım ayında gerçekleşmiş, iddianame " +
      "ise 2025 yılının Şubat ayında düzenlenmiştir. Arada, dolandırıcılık maddesinin " +
      "birinci fıkrasındaki hapis cezası aralığını değiştiren bir kanun yürürlüğe " +
      "girmiştir. Müdafi olarak, eylem tarihindeki metin ile yargılama tarihindeki " +
      "metnin hangi bakımdan farklılaştığını ve hangi ibarelerin değiştirildiğini " +
      "duruşmadan önce net biçimde ortaya koymak istiyorum. Dosyada ayrıca üç tanık " +
      "beyanı ve bir bilirkişi raporu bulunmaktadır. Tanıklardan ikisi olay " +
      "tarihinde iş yerinde bulunduklarını, üçüncüsü ise yalnızca telefonla " +
      "görüştüğünü ifade etmiştir. Bilirkişi raporunda, dosyaya sunulan hesap " +
      "hareketlerinin incelendiği ve tahsilatların tamamının aynı hafta içinde " +
      "yapıldığı belirtilmiştir. Duruşma günü 11 Nisan 2025 olarak tayin " +
      "edilmiş, savunma için ek süre talebimiz mahkemece kabul edilmiştir. " +
      CASE_FILE_TAIL +
      "Değişiklik kanunuyla dolandırıcılık maddesinin cezası nasıl değiştirilmiştir?",
  },
];

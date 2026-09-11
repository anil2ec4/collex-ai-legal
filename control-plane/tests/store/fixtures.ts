/**
 * SENTETİK (synthetic) Turkish legal fixtures for the store integration
 * tests.
 *
 * NOTHING HERE IS REAL TURKISH LAW. Every title carries the "(SENTETİK)"
 * marker, every canonical_source_url points at example.invalid, and the
 * article texts are hand-written paraphrases sized to exercise a specific
 * retrieval behaviour. They must never be presented to a human as case law
 * or legislation.
 *
 * Mechanics that mirror the production ingestion path:
 *  - content_sha256 values are REAL sha256 digests over the exact UTF-8 bytes
 *    inserted alongside them (that is what test (g) verifies);
 *  - start_char/end_char are Unicode CODE POINT offsets into canonical_text
 *    (chunks joined by a single "\n"), per migration 20260826020000;
 *  - search_text / normalized_text are tr-TR lowercased, like
 *    legal_reference/normalize.py and retrieval/normalize.ts produce;
 *  - multi-version documents are inserted OLDEST FIRST so the 20260826100000
 *    close-on-append trigger performs the system_period / effective_period
 *    close for real instead of the fixture faking a closed range.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../../src/store/db.js";

export const FIXTURE_SOURCE = "fixture-mevzuat";

/** Fixed as-of used by most assertions: after TCK v2, before KRIPTO-2027. */
export const AS_OF = "2026-08-27";

/**
 * The local single-user tenant (mirrors chunkStore.LOCAL_TENANT_ID and
 * drafting/types.ts). Fixture (j) is owned by it, exactly as an intake upload
 * on collex_local would be.
 */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** The upload's fileId (sha256[:16] shape) — the store keys it as external_id. */
export const UPLOAD_FILE_ID = "a1b2c3d4e5f60718";

export interface FixtureChunk {
  articleNo: string | null;
  text: string;
  /** Defaults to 'trnorm-v1' (the schema default and the query normalizer). */
  normalizerVersion?: string;
}

export interface FixtureVersion {
  label: string;
  /** null => effective_period NULL (validity unknown). */
  effectiveFrom: string | null;
  legislationNo?: string;
  docketNo?: string;
  decisionNo?: string;
  decisionDate?: string;
  publicationDate?: string;
  court?: string;
  chunks: FixtureChunk[];
}

export interface FixtureDoc {
  externalId: string;
  title: string;
  documentType: string;
  scope: "public" | "tenant";
  /**
   * Which synthetic tenant owns it; required when scope === "tenant".
   * "L" is the LOCAL single-user tenant (a fixed uuid), A/B are random.
   */
  tenantKey?: "A" | "B" | "L";
  /** legal.documents.source; defaults to FIXTURE_SOURCE ("UPLOAD" for an intake upload). */
  source?: string;
  /** Oldest first — insertion order is what drives the versioning trigger. */
  versions: FixtureVersion[];
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

export const FIXTURE_DOCS: readonly FixtureDoc[] = [
  {
    // (a) turkish-vs-simple recall, (b) exact pin, (c) two-version temporal.
    // Both versions contain the BARE form "dolandırıcılık" and "cezası" but
    // never the genitive "dolandırıcılığın" the test query uses: only the
    // Turkish stemmer bridges that gap.
    externalId: "TCK-5237-EXCERPT",
    title: "Türk Ceza Kanunu — dolandırıcılık maddeleri (SENTETİK)",
    documentType: "kanun",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: "2005-06-01",
        legislationNo: "5237",
        chunks: [
          {
            articleNo: "157",
            text:
              "Madde 157 - Hileli davranışlarla bir kimseyi aldatıp, onun " +
              "veya başkasının zararına olarak kendisine veya başkasına yarar " +
              "sağlayan kişi dolandırıcılık suçunu işler; bu suçun cezası bir " +
              "yıldan beş yıla kadar hapistir.",
          },
        ],
      },
      {
        label: "v2",
        effectiveFrom: "2023-01-01",
        legislationNo: "5237",
        chunks: [
          {
            articleNo: "157",
            text:
              "Madde 157 - Hileli davranışlarla bir kimseyi aldatıp, onun " +
              "veya başkasının zararına olarak kendisine veya başkasına yarar " +
              "sağlayan kişi dolandırıcılık suçunu işler; bu suçun cezası iki " +
              "yıldan yedi yıla kadar hapistir.",
          },
          {
            articleNo: "158",
            text:
              "Madde 158 - Dolandırıcılık suçunun bilişim sistemlerinin araç " +
              "olarak kullanılması suretiyle işlenmesi hâlinde verilecek ceza " +
              "artırılır.",
          },
        ],
      },
    ],
  },
  {
    // (d) RRF: m.49 lands in BOTH lanes, m.65 in the lexical lane only,
    // m.72 in neither for the "haksız fiil tazminatı" query (measured).
    externalId: "TBK-6098-HAKSIZ-FIIL",
    title: "Türk Borçlar Kanunu — haksız fiil ve zamanaşımı (SENTETİK)",
    documentType: "kanun",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: "2012-07-01",
        legislationNo: "6098",
        chunks: [
          {
            articleNo: "49",
            text:
              "Madde 49 - Kusurlu ve hukuka aykırı bir fiille başkasına " +
              "verilen zarar, haksız fiilden doğan tazminat yükümlülüğünü " +
              "doğurur.",
          },
          {
            articleNo: "65",
            text:
              "Madde 65 - Hakkaniyet gerektiriyorsa, hâkim; ayırt etme gücü " +
              "bulunmayan kişinin verdiği zararın, kısmen veya tamamen " +
              "giderilmesine karar verebilir; haksız eylem sonucunda doğan bu " +
              "tür bir tazminat sorumluluğu, fiil ehliyeti bulunmayanlar " +
              "bakımından hakkaniyet esasına dayanır.",
          },
          {
            articleNo: "72",
            text:
              "Madde 72 - Tazminat istemi, zarar görenin zararı ve tazminat " +
              "yükümlüsünü öğrendiği tarihten başlayarak iki yılın ve her " +
              "hâlde fiilin işlendiği tarihten başlayarak on yılın " +
              "geçmesiyle zamanaşımına uğrar.",
          },
        ],
      },
    ],
  },
  {
    // (d) short chunk whose search_text IS the query: word_similarity 1.0 and
    // the best ts_rank_cd, so it sits at rank 1 of both ranked lanes.
    externalId: "HAKSIZ-FIIL-NOTU",
    title: "Haksız fiil tazminatı — kısa not (SENTETİK)",
    documentType: "not",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [{ articleNo: null, text: "Haksız fiil tazminatı" }],
      },
    ],
  },
  {
    // (b) the LEXICAL BAIT. Its text is almost exactly the citation query,
    // so it wins both ranked lanes outright — yet it carries no
    // legislation_no of its own, so it must NEVER displace the pinned
    // TCK m.157 chunk. This is what makes the pin test non-vacuous.
    externalId: "DOKTRIN-5237-NOTU",
    title: "5237 sayılı Kanun m. 157 üzerine doktrin notu (SENTETİK)",
    documentType: "makale",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            text:
              "5237 sayılı Kanun m. 157 hükmüne ilişkin doktrin notu; 5237 " +
              "sayılı Kanun madde 157 tartışması.",
          },
        ],
      },
    ],
  },
  {
    // (b) docket/decision pin + (f) Turkish dotted/dotless-I casing.
    externalId: "IST-BAM-2024-12",
    title: "İstanbul BAM kararı (SENTETİK)",
    documentType: "karar",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        docketNo: "2023/45",
        decisionNo: "2024/12",
        decisionDate: "2024-03-15",
        publicationDate: "2024-04-01",
        court: "İstanbul Bölge Adliye Mahkemesi",
        chunks: [
          {
            articleNo: null,
            text:
              "İSTANBUL Bölge Adliye Mahkemesi 15. Hukuk Dairesi, ISPARTA " +
              "merkezli şirketin haksız eylem sorumluluğunu değerlendirmiştir.",
          },
        ],
      },
    ],
  },
  {
    // (e) four chunks of ONE document all matching "kira sözleşmesi"; the
    // source-diversity cap must drop one. legislation_no is deliberately NOT
    // 6098 so it cannot collide with the TBK exact-pin fixtures.
    externalId: "KIRA-EXCERPT",
    title: "Kira sözleşmesi hükümleri (SENTETİK)",
    documentType: "kanun",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: "2012-07-01",
        legislationNo: "6570",
        chunks: [
          {
            articleNo: "299",
            text:
              "Madde 299 - Kira sözleşmesi, kiraya verenin bir şeyin " +
              "kullanılmasını kiracıya bırakmayı üstlendiği sözleşmedir.",
          },
          {
            articleNo: "300",
            text:
              "Madde 300 - Kira sözleşmesi belirli veya belirsiz süreli " +
              "olabilir; süre bitiminde kira sözleşmesi yenilenebilir.",
          },
          {
            articleNo: "301",
            text:
              "Madde 301 - Kiraya veren, kiralananı kira sözleşmesi ile " +
              "amaçlanan kullanıma elverişli durumda teslim etmekle " +
              "yükümlüdür.",
          },
          {
            articleNo: "302",
            text:
              "Madde 302 - Kira sözleşmesi ile bağlantılı yan giderler kiraya " +
              "verene aittir; kira sözleşmesi kapsamında aksi " +
              "kararlaştırılabilir.",
          },
        ],
      },
    ],
  },
  {
    // (c) not in force on AS_OF; in force from 2027-01-01.
    externalId: "KRIPTO-2027",
    title: "Kriptovarlık Hizmet Sağlayıcıları Kanunu (SENTETİK, müstakbel)",
    documentType: "kanun",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: "2027-01-01",
        legislationNo: "7600",
        chunks: [
          {
            articleNo: "1",
            text:
              "Madde 1 - Kriptovarlık hizmet sağlayıcılarının yükümlülükleri " +
              "bu Kanunda düzenlenir; kriptovarlık platformları kayıt altına " +
              "alınır.",
          },
        ],
      },
    ],
  },
  {
    // Normalizer drift (migration 20260826030000 P3): indexed under a
    // normalizer this control-plane does not use for queries.
    externalId: "NORMALIZER-DRIFT-NOTU",
    title: "Kusursuz sorumluluk notu — eski normalizer (SENTETİK)",
    documentType: "not",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            normalizerVersion: "trnorm-v2",
            text:
              "Kusursuz sorumluluk ilkesi, tehlike sorumluluğu bakımından " +
              "özel bir görünüm arz eder.",
          },
        ],
      },
    ],
  },
  {
    // (c) the undated-version fallback: v1 has an UNKNOWN validity window and
    // is superseded in SYSTEM time by v2; v2 has a real one. Proves the
    // fallback branch is single-valued instead of leaking both rows.
    externalId: "GENELGE-UYGULAMA",
    title: "Uygulama genelgesi (SENTETİK)",
    documentType: "genelge",
    scope: "public",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            text:
              "Genelge 2019/1 - eski uygulama esasları bu genelgede " +
              "açıklanmıştır.",
          },
        ],
      },
      {
        label: "v2",
        effectiveFrom: "2024-01-01",
        chunks: [
          {
            articleNo: null,
            text:
              "Genelge 2024/1 - güncel uygulama esasları bu genelgede " +
              "açıklanmıştır.",
          },
        ],
      },
    ],
  },
  {
    // (i) RLS: two tenants, same wording, different owners.
    externalId: "TENANT-DOSYA",
    title: "Müvekkil dosyası A (SENTETİK)",
    documentType: "dosya",
    scope: "tenant",
    tenantKey: "A",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            text:
              "GİZLİ-A: müvekkilin dolandırıcılık iddiasına ilişkin dosya " +
              "notu.",
          },
        ],
      },
    ],
  },
  {
    externalId: "TENANT-DOSYA",
    title: "Müvekkil dosyası B (SENTETİK)",
    documentType: "dosya",
    scope: "tenant",
    tenantKey: "B",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            text:
              "GİZLİ-B: karşı tarafın dolandırıcılık savunmasına ilişkin " +
              "dosya notu.",
          },
        ],
      },
    ],
  },
  {
    // (j) FILE SCOPE (W12): an intake UPLOAD owned by the LOCAL single-user
    // tenant, keyed by its fileId. Invisible to every default-scope search on
    // a connection with no tenant context — which is every local-mode answer
    // — and reachable ONLY through filters.fileIds. Its words overlap the
    // public KIRA-EXCERPT on purpose, so scoping can be asserted by identity
    // in both directions.
    externalId: UPLOAD_FILE_ID,
    title: "Kira sözleşmesi taslağı (SENTETİK yükleme)",
    documentType: "sozlesme",
    scope: "tenant",
    tenantKey: "L",
    source: "UPLOAD",
    versions: [
      {
        label: "v1",
        effectiveFrom: null,
        chunks: [
          {
            articleNo: null,
            text:
              "YÜKLENEN-L: Depozito iadesi — kiracı, kira sözleşmesi sona " +
              "erdiğinde depozitonun on beş gün içinde iadesini talep eder.",
          },
          {
            articleNo: null,
            text:
              "YÜKLENEN-L: Kira bedeli her ayın beşinci günü ödenir; gecikme " +
              "hâlinde cezai şart uygulanır.",
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

export interface InsertedFixtures {
  /** "<externalId>" (public) or "<externalId>@<tenantKey>" -> documents.id */
  documentIds: Map<string, string>;
  /** "<docKey>#<versionLabel>" -> document_versions.id */
  versionIds: Map<string, string>;
  /** "<docKey>#<versionLabel>:<articleNo|_>" -> chunks.id */
  chunkIds: Map<string, string>;
  /** "<docKey>#<versionLabel>" -> canonical_text as inserted. */
  canonicalTexts: Map<string, string>;
  /** Synthetic tenant uuids for this run (L is the fixed LOCAL tenant). */
  tenants: { A: string; B: string; L: string };
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

export function docKey(doc: FixtureDoc): string {
  return doc.tenantKey === undefined
    ? doc.externalId
    : doc.externalId + "@" + doc.tenantKey;
}

export async function insertFixtures(sql: Sql): Promise<InsertedFixtures> {
  const tenants = { A: randomUUID(), B: randomUUID(), L: LOCAL_TENANT_ID };
  const documentIds = new Map<string, string>();
  const versionIds = new Map<string, string>();
  const chunkIds = new Map<string, string>();
  const canonicalTexts = new Map<string, string>();

  for (const doc of FIXTURE_DOCS) {
    const key = docKey(doc);
    const tenantId =
      doc.scope === "tenant" ? tenants[doc.tenantKey ?? "A"] : null;
    const source = doc.source ?? FIXTURE_SOURCE;
    const url = "https://example.invalid/fixture/" + key;

    const docRows = await sql`
      insert into legal.documents
        (scope, tenant_id, source, external_id, document_type, jurisdiction,
         title, canonical_source_url)
      values
        (${doc.scope}::legal.document_scope, ${tenantId}, ${source},
         ${doc.externalId}, ${doc.documentType}, 'TR', ${doc.title}, ${url})
      returning id`;
    const documentId = asId(docRows[0], "documents");
    documentIds.set(key, documentId);

    for (const version of doc.versions) {
      const versionKey = key + "#" + version.label;
      const canonicalText = version.chunks.map((c) => c.text).join("\n");
      const snapRows = await sql`
        insert into legal.source_snapshots
          (source, external_id, requested_url, final_url, retrieved_at,
           http_status, media_type, raw_object_key, raw_sha256,
           parser_name, parser_version)
        values
          (${source}, ${key}, ${url}, ${url}, now(), 200, 'text/html',
           ${"fixture/" + versionKey + ".html"}, ${sha256Hex(canonicalText)},
           'fixture-parser', '1.0.0')
        returning id`;
      const snapshotId = asId(snapRows[0], "source_snapshots");

      const effective =
        version.effectiveFrom !== null
          ? "[" + version.effectiveFrom + ",)"
          : null;

      const versionRows = await sql`
        insert into legal.document_versions
          (document_id, source_snapshot_id, version_label, status,
           effective_period, decision_date, publication_date, court,
           docket_no, decision_no, legislation_no,
           canonical_text, normalized_text, content_sha256)
        values
          (${documentId}, ${snapshotId}, ${version.label}, 'published',
           ${effective}::daterange,
           ${version.decisionDate ?? null}::date,
           ${version.publicationDate ?? null}::date,
           ${version.court ?? null},
           ${version.docketNo ?? null}, ${version.decisionNo ?? null},
           ${version.legislationNo ?? null},
           ${canonicalText}, ${trLower(canonicalText)},
           ${sha256Hex(canonicalText)})
        returning id`;
      const versionId = asId(versionRows[0], "document_versions");
      versionIds.set(versionKey, versionId);
      canonicalTexts.set(versionKey, canonicalText);

      let offset = 0;
      for (const [ordinal, chunk] of version.chunks.entries()) {
        const startChar = offset;
        const endChar = startChar + codePointLength(chunk.text);
        offset = endChar + 1; // the "\n" joiner is one code point
        const structuralPath =
          chunk.articleNo !== null ? ["madde-" + chunk.articleNo] : ["metin"];
        const chunkRows = await sql`
          insert into legal.chunks
            (document_version_id, ordinal, structural_path, article_no,
             start_char, end_char, original_text, search_text,
             normalizer_version, content_sha256, token_count)
          values
            (${versionId}, ${ordinal}, ${structuralPath},
             ${chunk.articleNo}, ${startChar}, ${endChar}, ${chunk.text},
             ${trLower(chunk.text)},
             ${chunk.normalizerVersion ?? "trnorm-v1"},
             ${sha256Hex(chunk.text)},
             ${chunk.text.split(/\s+/u).length})
          returning id`;
        chunkIds.set(
          versionKey + ":" + (chunk.articleNo ?? "_"),
          asId(chunkRows[0], "chunks"),
        );
      }
    }
  }

  return { documentIds, versionIds, chunkIds, canonicalTexts, tenants };
}

function asId(row: Record<string, unknown> | undefined, table: string): string {
  const id = row?.["id"];
  if (typeof id !== "string") {
    throw new Error("insert into legal." + table + " returned no id");
  }
  return id;
}

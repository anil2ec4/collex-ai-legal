/**
 * Shared offline fixtures for the cloud-AI tests. All content is SENTETİK —
 * authored for these tests, never real Turkish law, never a real key.
 */

import type { AiDraftLike, AiFileChunk } from "../../src/ai/types.js";

export const KEY = "sk-ant-TEST-anahtar-0123456789-asla-loglanmaz";

/** A minimal, uncompressed PDF with `pages` leaf pages. */
export function syntheticPdf(pages: number, options: { countInRoot?: boolean } = {}): Buffer {
  const countInRoot = options.countInRoot ?? true;
  const kids = Array.from({ length: pages }, (_v, i) => `${3 + i} 0 R`).join(" ");
  const leaves = Array.from(
    { length: pages },
    (_v, i) => `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n`,
  ).join("");
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      `2 0 obj\n<< /Type /Pages /Kids [${kids}]${countInRoot ? ` /Count ${pages}` : ""} >>\nendobj\n` +
      leaves +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "latin1",
  );
}

export const CHUNK_1_TEXT =
  "DAVACI: Ayşe Yılmaz\nDAVALI: Veli Kaya\nKONU: 50.000 TL alacağın tahsili talebi.";
export const CHUNK_2_TEXT =
  "OLAYLAR: 05.01.2025 tarihinde davalı sentetik bir yatırım vaadinde bulunmuştur.";

export function sampleChunks(): AiFileChunk[] {
  const c1Length = [...CHUNK_1_TEXT].length;
  return [
    {
      fileId: "file-1",
      fileName: "dilekce.docx",
      chunkId: "c1",
      ordinal: 0,
      text: CHUNK_1_TEXT,
      startChar: 0,
      endChar: c1Length,
      contentSha256: "ab".repeat(32),
    },
    {
      fileId: "file-1",
      fileName: "dilekce.docx",
      chunkId: "c2",
      ordinal: 1,
      text: CHUNK_2_TEXT,
      startChar: c1Length + 1,
      endChar: c1Length + 1 + [...CHUNK_2_TEXT].length,
      contentSha256: "ab".repeat(32),
    },
  ];
}

export const QUOTE_TCK =
  "Dolandırıcılık suçunun sentetik temel hâlinde faile bir yıldan beş yıla kadar" +
  " hapis ve beşbin güne kadar adlî para cezası verilir.";
export const QUOTE_KARSIT =
  "Somut olayda sentetik dolandırıcılık suçunun unsurlarının oluşmadığı anlaşılmakla" +
  " sanığın beraatine karar verilmiştir.";

export function sampleDraft(): AiDraftLike {
  return {
    draftId: "dft-1",
    kind: "dilekce",
    title: "Dava Dilekçesi",
    version: 1,
    sections: [
      {
        id: "olaylar",
        title: "OLAYLAR",
        paragraphs: [
          {
            id: "p-olaylar-1",
            text: "1. (2025-01-05) Davalı sentetik bir yatırım vaadinde bulunmuştur.",
            evidenceIds: [],
            supported: true,
            role: "olaylar",
            note: "beyan/İRADE — kanıt gerektirmez",
          },
        ],
      },
      {
        id: "hd",
        title: "HUKUKÎ DEĞERLENDİRME",
        paragraphs: [
          {
            id: "p-hd-1",
            text: "Hukukî değerlendirme için doğrulanmış kaynak sunulmamıştır.",
            evidenceIds: [],
            supported: false,
            role: "hukukiDegerlendirme",
            note: "KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli",
          },
        ],
      },
      {
        id: "imza",
        title: "",
        paragraphs: [
          { id: "p-imza-1", text: "Tarih: 2026-09-02", evidenceIds: [], supported: true, role: "imza" },
        ],
      },
    ],
    evidence: [
      {
        evidenceId: "ev-1",
        label: "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 157",
        source: "MEVZUAT",
        title: "Türk Ceza Kanunu (SENTETİK)",
        legislationNo: "5237",
        article: "157",
        quote: QUOTE_TCK,
        quoteSha256: "11".repeat(32),
        contentSha256: "22".repeat(32),
      },
      {
        evidenceId: "ev-2",
        label: "Yargıtay 15. Ceza Dairesi, E. 2023/7810, K. 2024/2356, 2024-06-24",
        source: "BEDESTEN",
        title: "Yargıtay 15. CD (SENTETİK)",
        court: "Yargıtay 15. Ceza Dairesi",
        decisionDate: "2024-06-24",
        docketNo: "2023/7810",
        decisionNo: "2024/2356",
        quote: QUOTE_KARSIT,
        quoteSha256: "33".repeat(32),
        contentSha256: "44".repeat(32),
        direction: "karşıt",
      },
    ],
    unsupportedCount: 1,
    warnings: ["Bu taslak makine üretimidir; avukat incelemesi zorunludur."],
  };
}

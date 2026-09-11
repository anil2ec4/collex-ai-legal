/**
 * Shared offline fixtures for the drafting tests. All content is SENTETİK —
 * authored for these tests, never real Turkish law.
 */

import { sha256HexUtf8 } from "../../src/verification/validator.js";
import { DRAFT_TEMPLATES, getTemplate } from "../../src/drafting/templates.js";
import type {
  DraftEvidence,
  DraftEvidencePack,
  DraftFileChunk,
  DraftMatter,
  DraftRequest,
  StoredAnswerLike,
} from "../../src/drafting/types.js";

export const QUOTE_TCK =
  "Dolandırıcılık suçunun sentetik temel hâlinde faile bir yıldan beş yıla kadar" +
  " hapis ve beşbin güne kadar adlî para cezası verilir.";

export const QUOTE_KIRA =
  "Kiracı, sentetik kira bedelini her ayın beşinci günü sonuna kadar ödemekle" +
  " yükümlüdür; aksi hâlde temerrüt hükümleri uygulanır.";

export const TCK_LABEL = "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 157";

export function tckEvidence(): DraftEvidence {
  return {
    evidenceId: "ev-tck157",
    label: TCK_LABEL,
    source: "MEVZUAT",
    title: "Türk Ceza Kanunu (SENTETİK)",
    legislationNo: "5237",
    article: "157",
    quote: QUOTE_TCK,
    quoteSha256: sha256HexUtf8(QUOTE_TCK),
    contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_TCK}`),
  };
}

export const QUOTE_KARSIT =
  "Somut olayda sentetik dolandırıcılık suçunun unsurlarının oluşmadığı anlaşılmakla" +
  " sanığın beraatine karar verilmiştir.";

/** A contrary-direction Yargıtay decision (contract A fixtures). */
export function karsitEvidence(): DraftEvidence {
  return {
    evidenceId: "ev-karsit",
    label: "Yargıtay 15. Ceza Dairesi, E. 2023/7810, K. 2024/2356, T. 24.06.2024",
    source: "BEDESTEN",
    title: "Yargıtay 15. CD (SENTETİK)",
    court: "Yargıtay 15. Ceza Dairesi",
    decisionDate: "2024-06-24",
    docketNo: "2023/7810",
    decisionNo: "2024/2356",
    quote: QUOTE_KARSIT,
    quoteSha256: sha256HexUtf8(QUOTE_KARSIT),
    contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_KARSIT}`),
    direction: "karşıt",
  };
}

export function kiraEvidence(): DraftEvidence {
  return {
    evidenceId: "ev-kira",
    label: "6098 sayılı Türk Borçlar Kanunu (SENTETİK), m. 313",
    source: "MEVZUAT",
    title: "Türk Borçlar Kanunu (SENTETİK)",
    legislationNo: "6098",
    article: "313",
    quote: QUOTE_KIRA,
    quoteSha256: sha256HexUtf8(QUOTE_KIRA),
    contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_KIRA}`),
  };
}

/** Audit #2 fixture: an unrelated TCK article (nobody cites it, nobody mentions it). */
export const QUOTE_TCK158 =
  "Sentetik nitelikli dolandırıcılık hâlinde ceza üç yıldan on yıla kadar hapistir.";

export function tck158Evidence(): DraftEvidence {
  return {
    evidenceId: "ev-tck158",
    label: "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 158",
    source: "MEVZUAT",
    title: "Türk Ceza Kanunu (SENTETİK)",
    legislationNo: "5237",
    article: "158",
    quote: QUOTE_TCK158,
    quoteSha256: sha256HexUtf8(QUOTE_TCK158),
    contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_TCK158}`),
    direction: "yön belirtmez",
  };
}

/** A pack whose single claim quotes the TCK passage it cites — the happy path. */
export function tckPack(overrides: Partial<DraftEvidencePack> = {}): DraftEvidencePack {
  return {
    claims: [
      {
        claimId: "claim-ev-tck157",
        text: `${TCK_LABEL}: "${QUOTE_TCK}"`,
        evidenceIds: ["ev-tck157"],
      },
    ],
    evidence: [tckEvidence()],
    synthetic: true,
    syntheticNotice: "Sentetik fixture korpusu",
    ...overrides,
  };
}

export function davaMatter(overrides: Partial<DraftMatter> = {}): DraftMatter {
  return {
    baslik: "İSTANBUL NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
    taraflar: [
      { ad: "Ayşe Yılmaz", rol: "Davacı" },
      { ad: "Av. Mehmet Demir", rol: "Davacı Vekili" },
      { ad: "Veli Kaya", rol: "Davalı" },
    ],
    olaylar: [
      { tarih: "2025-03-10", metin: "Taraflar arasında sentetik bir satış görüşmesi yapılmıştır." },
      // The matter NAMES the criminal provision (W12-FIX2 relevance gate:
      // an explicitly referenced source is always used; without this
      // sentence the TCK fixture would be a DOMAIN_MISMATCH under a hukuk
      // davası template — see relevance.test.ts for that case).
      {
        tarih: "2025-01-05",
        metin:
          "Davalı, davacıya sentetik bir yatırım vaadinde bulunmuştur; davacı eylemin" +
          " TCK m. 157 anlamında dolandırıcılık oluşturduğunu ileri sürmektedir.",
      },
      { tarih: "2025-04-02", metin: "Ödenen bedel iade edilmemiş, davalıya ulaşılamamıştır." },
    ],
    talepler: [
      "Sentetik alacağın 50.000 TL olarak davalıdan tahsiline",
      "Yargılama giderleri ile vekâlet ücretinin davalıya yükletilmesine",
    ],
    ...overrides,
  };
}

/** HMK m.119-complete matter: identity numbers, addresses, counsel, value. */
export function hmk119Matter(overrides: Partial<DraftMatter> = {}): DraftMatter {
  return {
    mahkeme: "İstanbul 3. Asliye Hukuk Mahkemesi",
    davaDegeri: "50.000 TL",
    tarih: "2026-09-02",
    vekil: { ad: "Mehmet Demir", baro: "İstanbul Barosu", sicilNo: "12345", adres: "Çağlayan, İstanbul" },
    taraflar: [
      { ad: "Ayşe Yılmaz", rol: "Davacı", tckn: "12345678901", adres: "Kadıköy, İstanbul" },
      { ad: "Sentetik Ticaret A.Ş.", rol: "Davalı", vkn: "1234567890", adres: "Şişli, İstanbul" },
    ],
    olaylar: [{ tarih: "05.01.2025", metin: "Davalı sentetik bir yatırım vaadinde bulunmuştur." }],
    talepler: ["Sentetik alacağın tahsiline"],
    ekBilgiler: { yer: "İstanbul" },
    ...overrides,
  };
}

export function davaRequest(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return {
    kind: "dilekce",
    template: "dava-dilekcesi",
    matter: davaMatter(),
    ...overrides,
  };
}

export function hizmetRequest(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return {
    kind: "sozlesme",
    template: "hizmet-sozlesmesi",
    matter: {
      taraflar: [
        { ad: "Örnek Yazılım A.Ş.", rol: "Hizmet Veren" },
        { ad: "Sentetik Holding A.Ş.", rol: "Hizmet Alan" },
      ],
      olaylar: [],
      talepler: [],
      ekBilgiler: {
        hizmetKonusu: "aylık bakım ve destek hizmeti (sentetik)",
        bedel: "aylık 40.000 TL + KDV",
        odemePlani: "aylık eşit taksitler",
        sure: "12 ay",
        yetkiliMahkeme: "İstanbul (Çağlayan)",
      },
    },
    ...overrides,
  };
}

export function kiraRequest(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return {
    kind: "sozlesme",
    template: "kira-sozlesmesi",
    matter: {
      taraflar: [
        { ad: "Fatma Çelik", rol: "Kiraya Veren" },
        { ad: "Ali Şahin", rol: "Kiracı" },
      ],
      olaylar: [],
      talepler: [],
      ekBilgiler: {
        mecur: "İstanbul, Sentetik Mah. Örnek Sk. No: 1 D: 2 adresli konut",
        kiraBedeli: "30.000 TL",
        odemeGunu: "5",
        depozito: "iki aylık kira tutarı",
        ozelSartlar: ["Mecurda evcil hayvan beslenmeyecektir.", "Duvarlara sabit delik açılmayacaktır."],
      },
    },
    ...overrides,
  };
}

/** One uploaded-document chunk (audit #4 fixture). */
export const CHUNK_TEXT =
  "DAVACI : Ayşe Yılmaz. Davalı, 12.05.2024 tarihinde davacıya ait iş yerinde 45.000 TL" +
  " tutarında haksız menfaat temin etmiştir. Davacı 3 Haziran 2024 tarihinde ihtarname" +
  " göndermiştir.";

export function uploadChunk(overrides: Partial<DraftFileChunk> = {}): DraftFileChunk {
  const text = overrides.text ?? CHUNK_TEXT;
  return {
    fileId: "file-1",
    fileName: "protokol.pdf",
    chunkId: "chunk-1",
    ordinal: 0,
    text,
    startChar: 0,
    endChar: [...text].length,
    contentSha256: sha256HexUtf8(`TAM METİN\n${CHUNK_TEXT}`),
    ...overrides,
  };
}

/** A stored answer with one SUPPORTED and one CONFLICTED claim (audit #3). */
export function conflictedAnswer(): StoredAnswerLike {
  return {
    result: {
      runId: "run-1",
      claims: [
        {
          claimId: "claim-ev-tck157",
          text: `${TCK_LABEL}: "${QUOTE_TCK}"`,
          evidenceIds: ["ev-tck157"],
          verdict: "SUPPORTED",
        },
        {
          claimId: "claim-celiskili",
          text: `${TCK_LABEL}: "${QUOTE_TCK}"`,
          evidenceIds: ["ev-tck157"],
          verdict: "CONFLICTING_AUTHORITIES",
          contraryEvidenceIds: ["ev-karsit"],
        },
      ],
      evidence: [
        {
          evidenceId: "ev-tck157",
          source: "MEVZUAT",
          title: "Türk Ceza Kanunu (SENTETİK)",
          legislationNo: "5237",
          article: "157",
          quote: QUOTE_TCK,
          quoteSha256: tckEvidence().quoteSha256,
          contentSha256: tckEvidence().contentSha256,
          stance: "neutral",
        },
        {
          evidenceId: "ev-karsit",
          source: "BEDESTEN",
          title: "Yargıtay 15. CD (SENTETİK)",
          court: "Yargıtay 15. Ceza Dairesi",
          docketNo: "2023/7810",
          decisionNo: "2024/2356",
          decisionDate: "2024-06-24",
          quote: QUOTE_KARSIT,
          quoteSha256: sha256HexUtf8(QUOTE_KARSIT),
          contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_KARSIT}`),
          stance: "contrary",
        },
      ],
      bundle: { synthetic: true, syntheticNotice: "sentetik fixture korpusu" },
    },
  };
}

/** Minimal VALID request for any template, derived from its requiredFields. */
export function minimalRequestFor(templateId: string): DraftRequest {
  const template = getTemplate(templateId);
  if (template === undefined) throw new Error(`unknown template ${templateId}`);
  const matter: DraftMatter = {
    taraflar: [
      { ad: "Sentetik Taraf Bir", rol: "Taraf 1" },
      { ad: "Sentetik Taraf İki", rol: "Taraf 2" },
    ],
    olaylar: [],
    talepler: [],
  };
  const ek: Record<string, unknown> = {};
  for (const path of template.requiredFields) {
    if (path === "taraflar") continue;
    if (path === "olaylar") matter.olaylar = [{ tarih: "2025-01-05", metin: "Sentetik olay." }];
    else if (path === "talepler") matter.talepler = ["Sentetik talep."];
    else if (path.startsWith("ekBilgiler.")) {
      const key = path.slice("ekBilgiler.".length);
      const field = template.fields.find((f) => f.path === `matter.${path}`);
      ek[key] =
        field?.kind === "list"
          ? "Sentetik madde bir\nSentetik madde iki"
          : field?.kind === "date"
            ? "2026-01-15"
            : field?.kind === "select" && field.options !== undefined
              ? field.options[0]
              : `sentetik ${key}`;
    }
  }
  if (Object.keys(ek).length > 0) matter.ekBilgiler = ek;
  return { kind: template.kind, template: template.id, matter };
}

export const ALL_TEMPLATE_IDS = DRAFT_TEMPLATES.map((t) => t.id);

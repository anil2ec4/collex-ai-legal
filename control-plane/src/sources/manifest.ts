/**
 * Kapsam manifestosu — "neyi tarıyoruz, neyi taramıyoruz" (W14/B-14).
 *
 * Both competitors sell coverage with a NUMBER, and both contradict
 * themselves: one prints "12 milyondan fazla" on one surface and "11 milyondan
 * fazla" on another; the other publishes no corpus size, no currency date and
 * no refresh interval at all and substitutes an authority argument. The only
 * way to win that argument without joining it is to publish the SHAPE of the
 * coverage and, above all, the GAPS.
 *
 * Hard rule of this module (W13-BACKLOG §C.1): **no cell invents a number.**
 * The only numbers in the response are the ones `/v1/health` already measured
 * (registered tools, corpus counts, migration counts) and counts of things
 * this repository can literally enumerate (sources in the catalog, tools in
 * the registry). Anything unmeasured says `"ölçülmedi"` — never 0, never an
 * estimate, never a range.
 */

import {
  buildToolInventory,
  summarizeToolInventory,
  type ToolReachability,
} from "../capabilities/inventory.js";
import { ALL_TOOL_NAMES } from "../capabilities/registry.js";
import { SOURCE_CATALOG, type SourceFamily } from "./catalog.js";

// ---------------------------------------------------------------------------
// Live status inputs (all injected; the manifest measures nothing itself)
// ---------------------------------------------------------------------------

/** Lifecycle of the MCP gateway child, as /v1/research/health reports it. */
export type ManifestMcpState = "off" | "starting" | "ok" | "down";

export interface ManifestHealthInput {
  /** MCP gateway child state; absent = unknown. */
  mcp?: ManifestMcpState;
  /** Tool count measured over the wire by the gateway probe. */
  toolCount?: number;
  /** Local product database: "ok" | "down" | "missing". */
  db?: string;
  dbName?: string | null;
  /** Applied/expected/missing migrations, straight from /v1/health. */
  migrations?: { applied?: number; expected?: number; missing?: readonly string[] };
  /** Local corpus counts, straight from /v1/health. */
  corpus?: Record<string, number>;
  /**
   * Last successful reach per source id, ISO timestamps. The control-plane
   * does not keep such a log yet; absent means the cell says "ölçülmedi".
   */
  lastReachBySource?: Readonly<Record<string, string>>;
  /** Is the local library spool enabled (W14/B-20)? */
  localLibraryEnabled?: boolean;
  /** How many documents the spool currently holds; absent = not measured. */
  localLibraryDocuments?: number;
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export type ManifestSourceStatus = "acik" | "kapali" | "bilinmiyor";

export interface ManifestSource {
  id: string;
  /** Lawyer Turkish. */
  ad: string;
  aile: SourceFamily;
  durum: ManifestSourceStatus;
  /** Turkish sentence explaining `durum` — never a bare machine code. */
  durumNotu: string;
  /** ISO timestamp of the last successful reach, or null when unmeasured. */
  sonErisim: string | null;
  /** Raw MCP tool answering this source (machine). */
  arac: string;
  /** Is that tool reachable from a code path today? */
  bagli: boolean;
  /** Turkish notes: filters it supports, and what it does NOT contain. */
  notlar: string[];
}

export interface ManifestGap {
  id: string;
  baslik: string;
  aciklama: string;
}

export interface CoverageManifest {
  schema: "collex.sources.manifest/v1";
  olusturulma: string;
  /** One sentence a lawyer can read before anything else. */
  ozet: string;
  kaynaklar: ManifestSource[];
  /** "Bilinen boşluklar" — at least five rows, always. */
  bilinenBosluklar: ManifestGap[];
  /**
   * The only numeric block, and every number in it was measured elsewhere:
   * the registry, the tool inventory, and /v1/health.
   */
  olculenSayilar: {
    kayitliArac: number;
    baglananArac: number;
    baglanmayanArac: number;
    secilebilirKaynak: number;
    /** Over-the-wire tool count from the gateway probe, or null. */
    gecitAracSayisi: number | null;
    yerelVeritabani: string;
    yerelVeritabaniAdi: string | null;
    migrasyonUygulanan: number | null;
    migrasyonBeklenen: number | null;
    migrasyonEksik: readonly string[];
    /** Local corpus counts exactly as /v1/health reported them, or null. */
    yerelKorpus: Record<string, number> | null;
    yerelKutuphaneAcik: boolean;
    yerelKutuphaneBelge: number | null;
  };
  /** Every tool and whether a code path can call it (B-15's honesty ledger). */
  aracEnvanteri: ToolReachability[];
  /** Verbatim honesty note; the console prints it unchanged. */
  durustlukNotu: string;
}

// ---------------------------------------------------------------------------
// Static gaps — the part competitors will not publish
// ---------------------------------------------------------------------------

/**
 * Known gaps. Each one is a DECISION with a reason, not an apology. Verified
 * against the repository on 02.09.2026: `grep -ri "aihm\|echr"` over `src/`
 * and the Python tool surface returns nothing, and the tool surface is frozen
 * at 54 (CLAUDE.md rule 4), so none of these can be present by accident.
 */
export const KNOWN_GAPS: readonly ManifestGap[] = Object.freeze([
  Object.freeze({
    id: "aihm",
    baslik: "AİHM (HUDOC) kapsamda değildir",
    aciklama:
      "Avrupa İnsan Hakları Mahkemesi kararları taranmaz; HUDOC'a bağlı hiçbir araç yoktur." +
      " AİHM içtihadına dayanacaksanız kararı kendiniz getirip dosyaya yükleyin.",
  }),
  Object.freeze({
    id: "doktrin",
    baslik: "Doktrin ve literatür taranmaz",
    aciklama:
      "Makale, şerh, ders kitabı ve tez taranmaz. Bunlar lisanslı içeriktir;" +
      " kopyalanmış bir havuz kurmak yerine kapsam dışı bırakılmıştır.",
  }),
  Object.freeze({
    id: "reklam-rtuk",
    baslik: "Reklam Kurulu ve RTÜK kararları yoktur",
    aciklama:
      "Bu iki kurulun karar veri tabanına bağlı araç yoktur; kurul kararları" +
      " listesi KİK, KVKK, Rekabet, Sayıştay, BDDK, BTK, GİB ve Sigorta Tahkim ile sınırlıdır.",
  }),
  Object.freeze({
    id: "ilk-derece",
    baslik: "İlk derece kapsamı ölçülmemiştir",
    aciklama:
      "Yerel mahkeme ve istinaf kararlarına yalnız Bedesten'in yerel/istinaf şeritleri" +
      " ve UYAP Emsal üzerinden ulaşılır. Bu şeritlerin ne kadarını kapsadığı" +
      " ÖLÇÜLMEDİ; eksiksiz olduğu iddia edilmez.",
  }),
  Object.freeze({
    id: "uyap-baglantisi",
    baslik: "UYAP/UETS ile hesap bağlantısı yoktur",
    aciklama:
      "Sisteme avukat kimliğinizle UYAP'a bağlanan bir eklenti veya uzak kurulum" +
      " eklenmemiştir; bu bilinçli bir tercihtir. Belgeler sürükle-bırak ile girer.",
  }),
  Object.freeze({
    // W15: kimlik (id) DEĞİŞMEZ — kayıtlı raporlar ve testler ona bağlı.
    // Yalnız avukatın gördüğü başlık ve açıklama kanonik sözlüğe çevrildi.
    id: "yerel-korpus",
    baslik: "Hukuk kütüphanesi kurulumda boş gelir",
    aciklama:
      "ColleX kurulduğunda bu bilgisayardaki hukuk kütüphanesinde hiçbir karar" +
      " veya mevzuat yoktur; kütüphane siz araştırma yaptıkça dolar. Kütüphane" +
      " boşken yalnız burada arayan bir soru “DAYANAK BULUNAMADI (ÇEKİMSER)”" +
      " döner — bu bir arıza değil, ürünün kuralıdır: dayanağını gösteremediği" +
      " bir cevabı yazmaz.",
  }),
  Object.freeze({
    id: "guncellik",
    baslik: "Tazeleme sıklığı ölçülmemiştir",
    aciklama:
      "Kaynaklar canlı olarak sorgulanır; kaynak sunucuların kendi güncelleme" +
      " sıklığı bizim tarafımızdan ölçülmez ve burada bir tarih verilmez.",
  }),
  Object.freeze({
    id: "kapsam-sayisi",
    baslik: "Kütüphanede kaç karar olduğu yayımlanmaz",
    aciklama:
      "“N milyon karar” türü bir sayı yayımlanmaz, çünkü bu kurulumda o sayıyı" +
      " doğrulayacak bir ölçüm yoktur. Doğrulanmamış her sayı bir yükümlülüktür.",
  }),
]);

// W15: aynı dürüstlük, avukat diliyle. Eski hâli "araç kayıt defteri",
// "veri tabanı", "korpus" ve "/v1/health" diyordu; bir avukata gösterilebilecek
// bir yer değil bunların hiçbiri. "Ölçülmemiş hiçbir alana sayı yazılmaz"
// cümlesi birebir korundu — dalganın taahhüdü odur ve bir test onu tutar.
const HONESTY_NOTE =
  "Bu sayfadaki sayıların tamamı bu bilgisayarda ölçülmüştür; hiçbiri tahmin" +
  " değildir. Ölçülmemiş hiçbir alana sayı yazılmaz; ölçülmeyen alan" +
  " “ölçülmedi” der. Hukuk kütüphanesinde kaç karar olduğu ve “doğruluk oranı”" +
  " gibi sayılar hiç yayımlanmaz: bunları dürüstçe ölçemeyiz.";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function statusFor(
  mcp: ManifestMcpState | undefined,
  bagli: boolean,
): { durum: ManifestSourceStatus; durumNotu: string } {
  if (!bagli) {
    return {
      durum: "kapali",
      durumNotu:
        "Bu kaynak ColleX'te tanımlı, ancak şu an hiçbir ekran onu sorgulamıyor.",
    };
  }
  if (mcp === "ok") {
    return {
      durum: "acik",
      durumNotu: "Resmî kaynak bağlantısı çalışıyor; bu kaynakta arama yapılabilir.",
    };
  }
  if (mcp === "off") {
    return {
      durum: "kapali",
      durumNotu:
        "Resmî kaynak bağlantısı kapalı; bu kaynakta şu an arama yapılamaz." +
        " Açmak için ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın.",
    };
  }
  if (mcp === "starting") {
    return { durum: "bilinmiyor", durumNotu: "Resmî kaynak bağlantısı açılıyor; durumu birkaç saniye içinde belli olur." };
  }
  if (mcp === "down") {
    return {
      durum: "kapali",
      durumNotu: "Resmî kaynak bağlantısına ulaşılamıyor; bu kaynakta şu an arama yapılamaz.",
    };
  }
  return {
    durum: "bilinmiyor",
    durumNotu: "Resmî kaynak bağlantısının durumu bu sayfaya bildirilmedi.",
  };
}

/**
 * Turkish names of the catalog's decision-type codes. The Kapsam screen
 * printed the notes as they came — "Karar türü seçilebilir: norm_denetimi,
 * bireysel_basvuru" — machine codes in the lawyer's line (27.09.2026).
 */
const DECISION_TYPE_TR: Readonly<Record<string, string>> = Object.freeze({
  norm_denetimi: "norm denetimi",
  bireysel_basvuru: "bireysel başvuru",
  uyusmazlik: "uyuşmazlık",
  duzenleyici: "düzenleyici işlem",
  mahkeme: "mahkeme kararı",
  daire: "daire kararı",
  genel_kurul: "genel kurul kararı",
  temyiz_kurulu: "temyiz kurulu kararı",
});

function sourceNotes(
  supportsChamber: boolean,
  supportsDateRange: boolean,
  decisionTypes: readonly string[] | undefined,
  gap: string | undefined,
): string[] {
  const notes: string[] = [];
  if (supportsChamber) notes.push("Daire süzgeci desteklenir.");
  if (supportsDateRange) notes.push("Tarih/yıl aralığı süzgeci desteklenir.");
  if (decisionTypes !== undefined && decisionTypes.length > 0) {
    notes.push(
      `Karar türü seçilebilir: ${decisionTypes.map((t) => DECISION_TYPE_TR[t] ?? t).join(", ")}.`,
    );
  }
  if (gap !== undefined) notes.push(gap);
  if (notes.length === 0) notes.push("Ek süzgeç yoktur; yalnız serbest metin aranır.");
  return notes;
}

export function buildCoverageManifest(
  health: ManifestHealthInput = {},
  options: { now?: () => string } = {},
): CoverageManifest {
  const now = options.now ?? (() => new Date().toISOString());
  const inventory = buildToolInventory();
  const summary = summarizeToolInventory(inventory);
  const reachableTools = new Set(
    inventory.filter((t) => t.state === "REACHABLE").map((t) => t.tool),
  );

  const kaynaklar: ManifestSource[] = SOURCE_CATALOG.map((source) => {
    const bagli = reachableTools.has(source.toolName);
    const { durum, durumNotu } = statusFor(health.mcp, bagli);
    return {
      id: source.id,
      ad: source.label,
      aile: source.family,
      durum,
      durumNotu,
      sonErisim: health.lastReachBySource?.[source.id] ?? null,
      arac: source.toolName,
      bagli,
      notlar: sourceNotes(
        source.supportsChamber === true,
        source.supportsDateRange === true,
        source.decisionTypes,
        source.gap,
      ),
    };
  });

  const acik = kaynaklar.filter((k) => k.durum === "acik").length;
  const ozet =
    health.mcp === "ok"
      ? `Resmî kaynak bağlantısı çalışıyor; ${acik} kaynakta arama yapılabilir.` +
        " Aşağıdaki “bilinen boşluklar” bölümü, HİÇ TARANMAYAN yerleri listeler."
      : "Resmî kaynak bağlantısı şu an çalışmıyor; aşağıdaki liste neyin" +
        " taranabildiğini ve — daha önemlisi — neyin hiç taranmadığını gösterir.";

  return {
    schema: "collex.sources.manifest/v1",
    olusturulma: now(),
    ozet,
    kaynaklar,
    bilinenBosluklar: [...KNOWN_GAPS],
    olculenSayilar: {
      kayitliArac: ALL_TOOL_NAMES.length,
      baglananArac: summary.reachable,
      baglanmayanArac: summary.notYetWired,
      secilebilirKaynak: SOURCE_CATALOG.length,
      gecitAracSayisi: health.toolCount ?? null,
      yerelVeritabani: health.db ?? "bilinmiyor",
      yerelVeritabaniAdi: health.dbName ?? null,
      migrasyonUygulanan: health.migrations?.applied ?? null,
      migrasyonBeklenen: health.migrations?.expected ?? null,
      migrasyonEksik: Object.freeze([...(health.migrations?.missing ?? [])]),
      yerelKorpus: health.corpus ?? null,
      yerelKutuphaneAcik: health.localLibraryEnabled === true,
      yerelKutuphaneBelge: health.localLibraryDocuments ?? null,
    },
    aracEnvanteri: inventory,
    durustlukNotu: HONESTY_NOTE,
  };
}

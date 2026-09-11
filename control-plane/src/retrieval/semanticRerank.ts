/**
 * Anlam benzerliğine göre YENİDEN SIRALAMA — W16, Şerit C.
 *
 * ### Ne yapar, ne yapmaz
 *
 * Bu modül bir ARAMA MOTORU DEĞİLDİR. Hangi belgelerin geleceğini o belirlemez;
 * gelen küçük bir aday kümesinin SIRASINI değiştirir. Yoğun (dense) şerit
 * `retrieval/hybrid.ts` içinde STUB'dır ve öyle kalır — pgvector bu makineye
 * kurulamaz. Ama sıralama için veritabanı indeksi zorunlu değildir: aday kümesi
 * birkaç on belgedir, kosinüs benzerliği bellekte hesaplanır.
 *
 * ### Üç kural, hiçbiri esnetilmez
 *
 * 1. **Yalnız TAM METNİ GETİRİLMİŞ belge yeniden sıralanabilir.** Arama sonuç
 *    listesindeki özet (snippet) kanıt değildir; sıralama girdisi de olamaz.
 *    Bu bir yorum değil, çalışan bir kapıdır: her belge kendi tam metninin
 *    SHA-256 parmak izini taşımak zorundadır ve modül parmak izini yeniden
 *    hesaplayıp doğrular ({@link assertRerankable}). Bir özet, tam metnin
 *    parmak izini üretemez.
 * 2. **Benzerlik sayısı ekrana YÜZDE olarak çıkmaz.** Dışarı verilen tek şey
 *    üç kademeli sözel etikettir ({@link SimilarityBand}: `yakın` / `orta` /
 *    `uzak`) ve yanında her zaman {@link SEMANTIC_RERANK_DISCLAIMER} durur:
 *    bu bir doğruluk ölçüsü değildir, metin benzerliğidir. Ham kosinüs
 *    değeri sonuç nesnesine HİÇ KONMAZ — konsa bir gün bir ekranda "%83"
 *    olarak belirirdi.
 * 3. **Ağ çağrısı FAIL-CLOSED'dır.** Zaman aşımı, hata, eksik vektör, yanlış
 *    boyut, sonsuz/NaN sayı — hepsinde sıra DEĞİŞMEZ ve neden tipli bir
 *    uyarı olarak döner ({@link SemanticRerankReason}). Yarım uygulanmış bir
 *    sıralama yoktur: ya hepsi, ya hiçbiri.
 *
 * ### Determinizm
 *
 * Aynı girdi + aynı gömme -> aynı sıra. Kosinüs değeri karşılaştırmadan önce
 * {@link SIMILARITY_PRECISION} basamağa yuvarlanır (kayan nokta gürültüsü
 * sıra değiştirmesin diye; yuvarlanmış tam sayı karşılaştırması geçişlidir,
 * epsilon karşılaştırması değildir), eşitlik ise **(kaynak, dış kimlik)** ile
 * bozulur. Hiçbir yerde uuid, ekleme sırası ya da saat kullanılmaz.
 *
 * ### Anahtar
 *
 * Ağ bağlantısını kuran {@link createEmbeddingPort} kimliği yalnız `fetch`
 * başlığına yazar. Ne atılan hataya, ne bir günlüğe, ne de bir JSON'a girer;
 * `embeddingConfig.ts` zaten anahtarı örneğin dışında (WeakMap) tutar.
 */

import { codePointWindows } from "../research/semanticPassages.js";
import { sha256HexUtf8 } from "../verification/validator.js";
import {
  formatDocumentText,
  formatQueryText,
  type EmbeddingConfig,
  type EmbeddingDisabledReason,
} from "./embeddingConfig.js";

// ---------------------------------------------------------------------------
// Değişmez cümle
// ---------------------------------------------------------------------------

/**
 * Yeniden sıralama uygulandığında sonuçla birlikte giden ve ekranda etiketin
 * yanında duran tek cümle. Sabittir; testi tek karakter değişse kırılır.
 */
export const SEMANTIC_RERANK_DISCLAIMER =
  "Bu sıra, belgelerin tam metinlerinin olay anlatımınıza METİN OLARAK ne kadar" +
  " benzediğine göre dizilmiştir. Bu bir DOĞRULUK ÖLÇÜSÜ DEĞİLDİR, metin" +
  " benzerliğidir; hangi kararın olayınıza uyduğunu yalnız siz belirlersiniz.";

// ---------------------------------------------------------------------------
// Tavanlar
// ---------------------------------------------------------------------------

/** Tek çağrıda karşılaştırılabilecek en çok belge. Aday kümesi küçüktür. */
export const MAX_RERANK_DOCUMENTS = 40;
/** Varsayılan belge sayısı — birkaç on belge, bellekte. */
export const DEFAULT_RERANK_DOCUMENTS = 10;
/** Gömme çağrısının duvar süresi; aşılırsa sıra DEĞİŞMEZ. */
export const DEFAULT_RERANK_TIMEOUT_MS = 20_000;
/**
 * Gömmeye gönderilen TEK PENCERENİN kod noktası tavanı.
 *
 * Bir Yargıtay kararı yüz binlerce karakter olabilir; her gömme modelinin bir
 * bağlam sınırı vardır ve sınırı aşan istek ya kesilir ya reddedilir. Belge
 * bu tavandan uzunsa artık yalnız BAŞI değil, en çok
 * {@link MAX_EMBED_WINDOWS_PER_DOCUMENT} adet, her biri bu uzunlukta,
 * {@link EMBED_WINDOW_STRIDE} kaymalı pencere gömülür (ilk ve son pencere her
 * zaman vardır; `research/semanticPassages.ts :: codePointWindows`) ve belgenin
 * benzerliği pencerelerin EN YÜKSEK kosinüsüdür. Pencereleme
 * DETERMİNİSTİKTİR. {@link SemanticRerankOutcome.karsilastirilanKarakter}
 * pencere boyunu, {@link SemanticRerankOutcome.karsilastirilanPencere} toplam
 * pencere sayısını söyler.
 */
export const MAX_EMBED_CODE_POINTS = 8_000;
/** Ardışık iki pencerenin başlangıçları arasındaki kod noktası; pencereler örtüşür. */
export const EMBED_WINDOW_STRIDE = 4_000;
/** Bir belgeden gömmeye giden en çok pencere; toplam giriş sayısını sınırlı tutar. */
export const MAX_EMBED_WINDOWS_PER_DOCUMENT = 4;
/** Kosinüs değerinin karşılaştırma öncesi yuvarlandığı ondalık basamak. */
export const SIMILARITY_PRECISION = 6;

// ---------------------------------------------------------------------------
// Üç kademeli sözel etiket
// ---------------------------------------------------------------------------

export type SimilarityBand = "yakın" | "orta" | "uzak";

/**
 * Kademe sınırları.
 *
 * Bunlar ÖLÇÜLMÜŞ değerler değildir; bir kosinüs sayısını üç sözcüğe çeviren
 * KESME NOKTALARIDIR ve bilerek yuvarlak seçilmiştir. Bir kalite eşiği gibi
 * okunmamaları için sayı hiçbir yerde ekrana çıkmaz, yalnız sözcük çıkar.
 */
export const SIMILARITY_BAND_THRESHOLDS = Object.freeze({
  yakin: 0.75,
  orta: 0.5,
});

export function similarityBand(cosine: number): SimilarityBand {
  if (cosine >= SIMILARITY_BAND_THRESHOLDS.yakin) return "yakın";
  if (cosine >= SIMILARITY_BAND_THRESHOLDS.orta) return "orta";
  return "uzak";
}

// ---------------------------------------------------------------------------
// Yeniden sıralanabilir belge
// ---------------------------------------------------------------------------

/**
 * Yeniden sıralamaya girebilecek TEK belge biçimi.
 *
 * `contentSha256` isteğe bağlı bir alan değildir: modül `fullText`in parmak
 * izini yeniden hesaplar ve tutmuyorsa belgeyi reddeder. Arama listesinden
 * kopyalanmış bir özet bu kapıdan geçemez.
 */
export interface RerankableDocument {
  /** Katalog kaynak kimliği — eşitlik bozmanın birinci anahtarı. */
  readonly sourceId: string;
  /** Kaynağın kendi belge kimliği — eşitlik bozmanın ikinci anahtarı. */
  readonly externalId: string;
  /** Getirilmiş TAM metin (kanonik biçimde). */
  readonly fullText: string;
  /** `fullText`in UTF-8 baytları üzerinden SHA-256'sı. */
  readonly contentSha256: string;
  /** Varsa belge başlığı; yalnız `gemini` biçiminde kullanılır. */
  readonly title?: string;
}

export class SnippetNotRerankableError extends Error {
  constructor(
    readonly sourceId: string,
    readonly externalId: string,
    readonly problem: "EMPTY_TEXT" | "CONTENT_HASH_MISMATCH",
  ) {
    super(
      `document ${sourceId}::${externalId} is not rerankable (${problem}):` +
        " only a fetched full text may be reranked",
    );
    this.name = "SnippetNotRerankableError";
  }
}

/**
 * Belgenin gerçekten getirilmiş bir tam metin olduğunu DOĞRULA.
 *
 * Bir arama özetini `fullText` diye geçirmenin tek yolu, o özetin tam metnin
 * parmak izini taşımasıdır — ki taşıyamaz. Bu yüzden kural burada bir yorum
 * değil, çalışan bir kapıdır.
 */
export function assertRerankable(doc: RerankableDocument): void {
  if (doc.fullText.trim() === "") {
    throw new SnippetNotRerankableError(doc.sourceId, doc.externalId, "EMPTY_TEXT");
  }
  if (sha256HexUtf8(doc.fullText) !== doc.contentSha256) {
    throw new SnippetNotRerankableError(
      doc.sourceId,
      doc.externalId,
      "CONTENT_HASH_MISMATCH",
    );
  }
}

export function isRerankable(doc: RerankableDocument): boolean {
  try {
    assertRerankable(doc);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Gömme bağlantısı (enjekte edilebilir port)
// ---------------------------------------------------------------------------

/**
 * Metinleri vektöre çeviren port. Testte GERÇEK AĞ YOKTUR: bu arayüz enjekte
 * edilir ve deterministik bir sahte ile doldurulur.
 */
export interface EmbeddingPort {
  embed(
    texts: readonly string[],
    opts?: { signal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]>;
}

export class EmbeddingCallError extends Error {
  constructor(readonly reason: "EMBEDDING_TIMEOUT" | "EMBEDDING_FAILED") {
    // Mesaj SABİTTİR: sağlayıcının gövdesi, başlıkları ve kimliği asla bir
    // hata metnine kopyalanmaz.
    super(
      reason === "EMBEDDING_TIMEOUT"
        ? "embedding call timed out"
        : "embedding call failed",
    );
    this.name = "EmbeddingCallError";
  }
}

interface EmbeddingResponseLike {
  data?: unknown;
}

/**
 * OpenAI-uyumlu `/embeddings` ucuna giden gerçek bağlantı (OpenRouter ya da
 * yerel sunucu — ikisi de aynı gövdeyi konuşur).
 *
 * Kimlik YALNIZ `Authorization` başlığına yazılır. Hata mesajları sabittir;
 * sağlayıcının yanıt gövdesi hiçbir koşulda hataya ya da günlüğe geçmez, çünkü
 * bazı sağlayıcılar hata gövdesinde isteği (dolayısıyla başlığı) yankılar.
 */
export function createEmbeddingPort(
  config: EmbeddingConfig,
  fetchImpl: typeof fetch = fetch,
): EmbeddingPort {
  return {
    async embed(texts, opts) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (config.hasApiKey) headers["authorization"] = `Bearer ${config.apiKey}`;

      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}/embeddings`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: config.model, input: [...texts] }),
          ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
        });
      } catch (error) {
        throw new EmbeddingCallError(
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "EMBEDDING_TIMEOUT"
            : "EMBEDDING_FAILED",
        );
      }
      if (!response.ok) throw new EmbeddingCallError("EMBEDDING_FAILED");

      let payload: EmbeddingResponseLike;
      try {
        payload = (await response.json()) as EmbeddingResponseLike;
      } catch {
        throw new EmbeddingCallError("EMBEDDING_FAILED");
      }
      const data = payload.data;
      if (!Array.isArray(data)) throw new EmbeddingCallError("EMBEDDING_FAILED");
      const vectors: number[][] = [];
      for (const entry of data) {
        const embedding = (entry as { embedding?: unknown } | null)?.embedding;
        if (!Array.isArray(embedding)) throw new EmbeddingCallError("EMBEDDING_FAILED");
        vectors.push(embedding as number[]);
      }
      return vectors;
    },
  };
}

// ---------------------------------------------------------------------------
// Kosinüs
// ---------------------------------------------------------------------------

/**
 * Kosinüs benzerliği. Boyutlar eşit değilse ya da bir vektörün boyu sıfırsa
 * `null` döner — uydurma bir 0 değil, "hesaplanamadı".
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA <= 0 || normB <= 0) return null;
  const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(value) ? value : null;
}

/** Karşılaştırma anahtarı: kayan nokta gürültüsü sırayı değiştirmesin diye. */
export function quantizeSimilarity(cosine: number): number {
  const factor = 10 ** SIMILARITY_PRECISION;
  return Math.round(cosine * factor);
}

// ---------------------------------------------------------------------------
// Sonuç
// ---------------------------------------------------------------------------

export type SemanticRerankReason =
  /** Gömme sağlayıcısı kapalı; nedeni `embeddingConfig` verir. */
  | EmbeddingDisabledReason
  /** Ağ çağrısı süresinde bitmedi. */
  | "EMBEDDING_TIMEOUT"
  /** Ağ çağrısı hata verdi ya da yanıt okunamadı. */
  | "EMBEDDING_FAILED"
  /** Vektör sayısı/boyutu beklenenle uyuşmadı; kosinüs hesaplanamadı. */
  | "EMBEDDING_SHAPE_MISMATCH"
  /** Sıralanacak, tam metni getirilmiş belge yok. */
  | "NO_FULL_TEXT"
  /** Karşılaştırılacak bir olay metni yok. */
  | "EMPTY_QUERY";

const REASON_MESSAGE_TR: Readonly<Record<string, string>> = Object.freeze({
  EMBEDDING_TIMEOUT:
    "Anlam benzerliğine göre sıralama YAPILAMADI: metin karşılaştırma hizmeti" +
    " süresinde yanıt vermedi. Sıra değiştirilmedi.",
  EMBEDDING_FAILED:
    "Anlam benzerliğine göre sıralama YAPILAMADI: metin karşılaştırma hizmetine" +
    " ulaşılamadı. Sıra değiştirilmedi.",
  EMBEDDING_SHAPE_MISMATCH:
    "Anlam benzerliğine göre sıralama YAPILAMADI: metin karşılaştırma hizmeti" +
    " beklenmedik bir yanıt verdi. Sıra değiştirilmedi.",
  NO_FULL_TEXT:
    "Anlam benzerliğine göre sıralama YAPILAMADI: karşılaştırma yalnız tam metni" +
    " getirilmiş belgeler arasında yapılır, bu listede öyle bir belge yok." +
    " Sıra değiştirilmedi.",
  EMPTY_QUERY:
    "Anlam benzerliğine göre sıralama YAPILAMADI: karşılaştırılacak bir olay" +
    " metni yok. Sıra değiştirilmedi.",
});

/**
 * Nedenin avukat Türkçesi karşılığı. Gömme kapalıysa cümleyi
 * `embeddingConfig.ts` yazar (tek kaynak); burada yalnız çalışma zamanı
 * nedenleri tanımlıdır.
 */
export function rerankReasonMessageTr(
  reason: SemanticRerankReason,
  fallback?: string,
): string {
  return (
    REASON_MESSAGE_TR[reason] ??
    fallback ??
    "Anlam benzerliğine göre sıralama YAPILAMADI. Sıra değiştirilmedi."
  );
}

export interface SemanticRerankWarning {
  readonly reason: SemanticRerankReason;
  /** Avukat Türkçesi; her zaman "sıra değiştirilmedi" der. */
  readonly message: string;
}

export interface SemanticRankedDocument<T> {
  readonly item: T;
  /**
   * Üç kademeli SÖZEL etiket. Sayı YOK — ne burada, ne aşağıda, ne ekranda.
   * Sıralama uygulanmadıysa bu alan hiç bulunmaz.
   */
  readonly benzerlik?: SimilarityBand;
}

export interface SemanticRerankOutcome<T> {
  /** Sıra. Uygulanmadıysa GİRDİ SIRASININ tıpatıp aynısı. */
  readonly items: readonly SemanticRankedDocument<T>[];
  readonly applied: boolean;
  /** Uygulanmadıysa nedeni; uygulandıysa yok. */
  readonly warning?: SemanticRerankWarning;
  /** Uygulandıysa {@link SEMANTIC_RERANK_DISCLAIMER}; aksi hâlde yok. */
  readonly aciklama?: string;
  /** Kaç belgenin tam metni karşılaştırıldı. */
  readonly karsilastirilanBelge: number;
  /**
   * Her PENCERENİN kod noktası tavanı — belge bundan uzunsa birden çok
   * pencere gömüldü ve en yüksek benzerlik alındı. Uygulanmadıysa yok.
   */
  readonly karsilastirilanKarakter?: number;
  /** Bütün belgelerden gömülen toplam pencere sayısı. Uygulanmadıysa yok. Eklemeli alan. */
  readonly karsilastirilanPencere?: number;
}

export interface SemanticRerankOptions<T> {
  /** Karşılaştırma metni: avukatın olay anlatımı ya da sorusu. */
  readonly query: string;
  /** Sıralanacak öğeler, ÇAĞIRANIN mevcut sırasında. */
  readonly items: readonly T[];
  /** Her öğeden yeniden sıralanabilir belgeyi çıkar. */
  readonly toDocument: (item: T) => RerankableDocument;
  readonly config: EmbeddingConfig;
  readonly port: EmbeddingPort;
  /** Duvar süresi; 0 kapatır. Varsayılan {@link DEFAULT_RERANK_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Test için enjekte edilebilir zaman aşımı sinyali üreteci. */
  readonly newTimeoutSignal?: (ms: number) => AbortSignal;
}

function unchanged<T>(
  items: readonly T[],
  reason: SemanticRerankReason,
  message: string,
): SemanticRerankOutcome<T> {
  return {
    items: items.map((item) => ({ item })),
    applied: false,
    warning: { reason, message },
    karsilastirilanBelge: 0,
  };
}

/** Kod noktası (UTF-16 birimi DEĞİL) sayarak baştan kırp. */
function headByCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join("");
}

/**
 * Aday kümesini olay metnine metin benzerliğine göre yeniden dizer.
 *
 * FAIL-CLOSED: aşağıdaki her durumda sıra DEĞİŞMEZ ve neden tipli döner —
 * boş soru, tam metinli belge yokluğu, zaman aşımı, ağ hatası, eksik vektör,
 * boyut uyuşmazlığı, NaN/sonsuz sayı. Yarım uygulanmış sıra yoktur.
 *
 * `toDocument` bir arama özeti verirse {@link SnippetNotRerankableError} ATILIR
 * — bu bir çağıran hatasıdır ve sessizce yutulmaz: özet, kanıt olamadığı gibi
 * sıralama girdisi de olamaz.
 */
export async function semanticRerank<T>(
  options: SemanticRerankOptions<T>,
): Promise<SemanticRerankOutcome<T>> {
  const { items, query, config, port, toDocument } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RERANK_TIMEOUT_MS;
  const newTimeoutSignal =
    options.newTimeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));

  const trimmedQuery = query.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (trimmedQuery === "") {
    return unchanged(items, "EMPTY_QUERY", rerankReasonMessageTr("EMPTY_QUERY"));
  }
  if (items.length === 0) {
    return unchanged(items, "NO_FULL_TEXT", rerankReasonMessageTr("NO_FULL_TEXT"));
  }
  if (items.length > MAX_RERANK_DOCUMENTS) {
    throw new RangeError(
      `semanticRerank accepts at most ${MAX_RERANK_DOCUMENTS} documents;` +
        ` received ${items.length}`,
    );
  }

  // Kapı: her belge gerçekten getirilmiş bir tam metin mi? Değilse ATAR.
  const documents = items.map((item) => {
    const doc = toDocument(item);
    assertRerankable(doc);
    return doc;
  });

  // Her belge, tavandan uzunsa, örtüşen pencerelere bölünür; her pencere ayrı
  // bir gömme girdisidir ve belgenin benzerliği pencerelerin EN YÜKSEĞİDİR.
  const windows = documents.map((doc) =>
    codePointWindows(
      doc.fullText,
      MAX_EMBED_CODE_POINTS,
      EMBED_WINDOW_STRIDE,
      MAX_EMBED_WINDOWS_PER_DOCUMENT,
    ),
  );
  const inputs = [
    formatQueryText(config.promptStyle, headByCodePoints(trimmedQuery, MAX_EMBED_CODE_POINTS)),
    ...documents.flatMap((doc, i) =>
      (windows[i] as string[]).map((window) =>
        formatDocumentText(config.promptStyle, window, doc.title ?? ""),
      ),
    ),
  ];

  let vectors: readonly (readonly number[])[];
  try {
    vectors = await port.embed(inputs, {
      ...(timeoutMs > 0 ? { signal: newTimeoutSignal(timeoutMs) } : {}),
    });
  } catch (error) {
    const reason: SemanticRerankReason =
      error instanceof EmbeddingCallError
        ? error.reason
        : error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ? "EMBEDDING_TIMEOUT"
          : "EMBEDDING_FAILED";
    return unchanged(items, reason, rerankReasonMessageTr(reason));
  }

  if (vectors.length !== inputs.length) {
    return unchanged(
      items,
      "EMBEDDING_SHAPE_MISMATCH",
      rerankReasonMessageTr("EMBEDDING_SHAPE_MISMATCH"),
    );
  }

  const queryVector = vectors[0] as readonly number[];
  const scored: { index: number; key: number; band: SimilarityBand }[] = [];
  let cursor = 1;
  for (let i = 0; i < documents.length; i += 1) {
    let best: number | null = null;
    for (let w = 0; w < (windows[i] as string[]).length; w += 1) {
      const cosine = cosineSimilarity(queryVector, vectors[cursor] as readonly number[]);
      cursor += 1;
      if (cosine === null) {
        // Tek bir pencere bile ölçülemiyorsa TAMAMI iptal: yarım sıra, yanlış
        // sıradan daha tehlikelidir çünkü doğru görünür.
        return unchanged(
          items,
          "EMBEDDING_SHAPE_MISMATCH",
          rerankReasonMessageTr("EMBEDDING_SHAPE_MISMATCH"),
        );
      }
      if (best === null || cosine > best) best = cosine;
    }
    if (best === null) {
      return unchanged(
        items,
        "EMBEDDING_SHAPE_MISMATCH",
        rerankReasonMessageTr("EMBEDDING_SHAPE_MISMATCH"),
      );
    }
    scored.push({ index: i, key: quantizeSimilarity(best), band: similarityBand(best) });
  }

  // Sıra: benzerlik (azalan) -> kaynak kimliği -> dış kimlik. Hiçbir anahtar
  // bu sürecin bir özelliği değildir; hepsi VERİNİN özelliğidir.
  scored.sort((a, b) => {
    if (a.key !== b.key) return b.key - a.key;
    const da = documents[a.index] as RerankableDocument;
    const db = documents[b.index] as RerankableDocument;
    if (da.sourceId !== db.sourceId) return da.sourceId < db.sourceId ? -1 : 1;
    if (da.externalId !== db.externalId) return da.externalId < db.externalId ? -1 : 1;
    return 0;
  });

  // E5 gives high cosine values even to unrelated texts. The legacy cutoffs
  // have not been validated for this model, so they cannot label its results.
  const uncalibratedLocal = config.provider === "local" &&
    config.model === "intfloat/multilingual-e5-small:onnx-qint8";
  return {
    items: scored.map((entry) => ({
      item: items[entry.index] as T,
      ...(!uncalibratedLocal ? { benzerlik: entry.band } : {}),
    })),
    applied: true,
    aciklama: SEMANTIC_RERANK_DISCLAIMER + (uncalibratedLocal
      ? " Bu yerel model için yakınlık eşikleri doğrulanmadığından yakın/orta/uzak etiketleri gösterilmez."
      : ""),
    karsilastirilanBelge: documents.length,
    karsilastirilanKarakter: MAX_EMBED_CODE_POINTS,
    karsilastirilanPencere: inputs.length - 1,
  };
}

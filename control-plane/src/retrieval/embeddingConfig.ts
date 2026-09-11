/**
 * Gömme (embedding) sağlayıcısının çözümlenmesi — W16, Şerit C.
 *
 * ### Neden bu dosya var
 *
 * `retrieval/hybrid.ts` içindeki yoğun (dense) şerit bir STUB'dır ve öyle
 * kalır: pgvector bu makineye kurulamaz, dolayısıyla veritabanı tarafında
 * vektör indeksi YOKTUR. Ama bir aday listesini metin benzerliğine göre
 * yeniden dizmek için indeks ZORUNLU DEĞİLDİR — aday kümesi birkaç on
 * belgedir ve kosinüs benzerliği bellekte hesaplanır. Bu dosya o hesabın
 * ÖNKOŞULUNU çözer: bir gömme sağlayıcısı yapılandırılmış mı, değilse
 * NEDEN değil.
 *
 * ### Varsayılan KAPALI
 *
 * Hiçbir ortam değişkeni yoksa sonuç `{enabled:false, reason:
 * "EMBEDDING_NOT_CONFIGURED"}` olur. "Kapalı" bir hata değildir; ürünün
 * varsayılan hâlidir ve ekranda tek cümleyle söylenir. Kapalı olmanın nedeni
 * TİPLİ bir koddur ({@link EmbeddingDisabledReason}), çünkü "anahtar yok" ile
 * "adres bozuk" farklı iki cümledir ve avukat hangisi olduğunu bilmelidir.
 *
 * ### Değişken adları UYDURULMAZ
 *
 * Buradaki dokuz adın hepsi `CLAUDE.md` → "Environment contract" bölümünde
 * zaten tanımlıdır ve Python tarafındaki `semantic_search/embedder.py` ile
 * AYNI anlama gelir (aynı varsayılan model, aynı varsayılan boyut, aynı
 * `EMBEDDING_PROVIDER=local` anahtarı). İki çalışma zamanı aynı ortamı aynı
 * biçimde okur; biri açıkken diğerinin kapalı olması bir kurulum hatasıdır,
 * bir tasarım farkı değil.
 *
 * ### Anahtar hiçbir yere yazılmaz
 *
 * `src/ai/config.ts` kalıbı birebir uygulanır: anahtar modül-özel bir
 * `WeakMap` içinde durur, örneğin kendi özelliği DEĞİLDİR (`JSON.stringify`,
 * `Object.keys`, yayma (spread), `getOwnPropertySymbols` göremez), `toJSON()`
 * yalnız yapılandırma bilgisini döner ve `util.inspect` / `console.log`
 * anahtarın yerine **[gizli]** basar.
 */

import { inspect } from "node:util";

// ---------------------------------------------------------------------------
// Ortam değişkeni ADLARI (değerler hiçbir yere yazılmaz)
// ---------------------------------------------------------------------------

export const EMBEDDING_ENV = Object.freeze({
  /** "local" -> yerel OpenAI-uyumlu sunucu; boş/başka -> OpenRouter. */
  provider: "EMBEDDING_PROVIDER",
  apiKey: "OPENROUTER_API_KEY",
  model: "OPENROUTER_EMBEDDING_MODEL",
  dimension: "OPENROUTER_EMBEDDING_DIMENSION",
  promptStyle: "EMBEDDING_PROMPT_STYLE",
  localBaseUrl: "LOCAL_EMBEDDING_BASE_URL",
  localApiKey: "LOCAL_EMBEDDING_API_KEY",
  localModel: "LOCAL_EMBEDDING_MODEL",
  localDimension: "LOCAL_EMBEDDING_DIMENSION",
} as const);

// ---------------------------------------------------------------------------
// Varsayılanlar — Python `semantic_search/embedder.py` ile birebir aynı
// ---------------------------------------------------------------------------

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2:free";
export const DEFAULT_OPENROUTER_DIMENSION = 2048;
/** OpenRouter varsayılanı ham metin ister (Nemotron). */
export const DEFAULT_OPENROUTER_PROMPT_STYLE: EmbeddingPromptStyle = "raw";

export const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434/v1";
export const DEFAULT_LOCAL_MODEL = "nomic-embed-text";
export const DEFAULT_LOCAL_DIMENSION = 768;
/** Yerel kurulumun tavsiye edilen modeli e5 ailesindendir. */
export const DEFAULT_LOCAL_PROMPT_STYLE: EmbeddingPromptStyle = "e5";

export const PROMPT_STYLES = Object.freeze(["gemini", "e5", "raw"] as const);
export type EmbeddingPromptStyle = (typeof PROMPT_STYLES)[number];

export type EmbeddingProvider = "openrouter" | "local";

// ---------------------------------------------------------------------------
// Kapalı olma nedenleri — tipli, çünkü her biri başka bir cümledir
// ---------------------------------------------------------------------------

export type EmbeddingDisabledReason =
  /** Hiçbir sağlayıcı tanımlı değil. Ürünün VARSAYILAN hâli. */
  | "EMBEDDING_NOT_CONFIGURED"
  /** `EMBEDDING_PROVIDER` tanınmayan bir değer taşıyor. */
  | "EMBEDDING_PROVIDER_UNKNOWN"
  /** OpenRouter seçilmiş ama `OPENROUTER_API_KEY` yok/boş. */
  | "EMBEDDING_KEY_MISSING"
  /** Boyut değişkeni pozitif tam sayı değil. */
  | "EMBEDDING_DIMENSION_INVALID"
  /** Yerel adres http(s) ile başlamıyor. */
  | "EMBEDDING_BASE_URL_INVALID"
  /** `EMBEDDING_PROMPT_STYLE` üç bilinen değerden biri değil. */
  | "EMBEDDING_PROMPT_STYLE_INVALID";

const DISABLED_MESSAGE_TR: Readonly<Record<EmbeddingDisabledReason, string>> =
  Object.freeze({
    EMBEDDING_NOT_CONFIGURED:
      "Anlam benzerliğine göre sıralama KAPALI: bu bilgisayarda tanımlı bir" +
      " metin karşılaştırma hizmeti yok. Sonuçlar, kaç ayrı aramanın aynı" +
      " kararı bulduğuna göre sıralandı.",
    EMBEDDING_PROVIDER_UNKNOWN:
      "Anlam benzerliğine göre sıralama KAPALI: metin karşılaştırma hizmetinin" +
      " türü tanınmadı. Ayarı düzeltmeden bu sıralama çalışmaz.",
    EMBEDDING_KEY_MISSING:
      "Anlam benzerliğine göre sıralama KAPALI: bulut metin karşılaştırma" +
      " hizmeti için gerekli kimlik tanımlı değil.",
    EMBEDDING_DIMENSION_INVALID:
      "Anlam benzerliğine göre sıralama KAPALI: metin karşılaştırma hizmetinin" +
      " vektör boyutu ayarı geçersiz (pozitif bir tam sayı olmalı).",
    EMBEDDING_BASE_URL_INVALID:
      "Anlam benzerliğine göre sıralama KAPALI: yerel metin karşılaştırma" +
      " hizmetinin adresi geçersiz (http:// veya https:// ile başlamalı).",
    EMBEDDING_PROMPT_STYLE_INVALID:
      "Anlam benzerliğine göre sıralama KAPALI: metin karşılaştırma hizmetinin" +
      " metin biçimi ayarı tanınmadı.",
  });

/** Avukat Türkçesiyle, kapalı olmanın nedenini söyleyen tek cümle. */
export function embeddingDisabledMessageTr(reason: EmbeddingDisabledReason): string {
  return DISABLED_MESSAGE_TR[reason];
}

export interface EmbeddingDisabled {
  readonly enabled: false;
  readonly reason: EmbeddingDisabledReason;
  /** Avukat Türkçesi tek cümle. */
  readonly message: string;
  /**
   * Ayarın hangi değişkenden okunduğu — yalnız ADI, hiçbir zaman değeri.
   * Nedeni "hiç yapılandırılmamış" olduğunda yoktur.
   */
  readonly envName?: string;
}

export interface EmbeddingEnabled {
  readonly enabled: true;
  readonly config: EmbeddingConfig;
}

export type EmbeddingResolution = EmbeddingEnabled | EmbeddingDisabled;

export interface EmbeddingConfigJson {
  configured: true;
  provider: EmbeddingProvider;
  model: string;
  baseUrl: string;
  dimension: number;
  promptStyle: EmbeddingPromptStyle;
  /** Bir kimlik tanımlı MI — kimliğin KENDİSİ değil. */
  hasApiKey: boolean;
}

/**
 * Anahtar örneğin DIŞINDA durur (modül-özel WeakMap): kendi özelliği yok,
 * simgesi yok; `JSON.stringify` / `Object.keys` / yayma / `inspect` bulamaz.
 */
const apiKeys = new WeakMap<EmbeddingConfig, string>();

export class EmbeddingConfig {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  readonly baseUrl: string;
  readonly dimension: number;
  readonly promptStyle: EmbeddingPromptStyle;
  /** Yok sayılan/geçersiz isteğe bağlı ayarlar hakkında Türkçe notlar. */
  readonly warnings: readonly string[];
  private readonly keyed: boolean;

  constructor(options: {
    provider: EmbeddingProvider;
    model: string;
    baseUrl: string;
    dimension: number;
    promptStyle: EmbeddingPromptStyle;
    apiKey?: string;
    warnings?: readonly string[];
  }) {
    if (!Number.isInteger(options.dimension) || options.dimension <= 0) {
      throw new RangeError("EmbeddingConfig requires a positive integer dimension");
    }
    this.provider = options.provider;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.dimension = options.dimension;
    this.promptStyle = options.promptStyle;
    this.warnings = options.warnings ?? [];
    const key = options.apiKey?.trim() ?? "";
    this.keyed = key !== "";
    if (this.keyed) apiKeys.set(this, key);
  }

  /** Prototip getirici: asla kendi sayılabilir özelliği olmaz, serileşmez. */
  get apiKey(): string {
    return apiKeys.get(this) ?? "";
  }

  get hasApiKey(): boolean {
    return this.keyed;
  }

  toJSON(): EmbeddingConfigJson {
    return {
      configured: true,
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
      dimension: this.dimension,
      promptStyle: this.promptStyle,
      hasApiKey: this.keyed,
    };
  }

  [inspect.custom](): string {
    return (
      `EmbeddingConfig { provider: '${this.provider}', model: '${this.model}',` +
      ` baseUrl: '${this.baseUrl}', dimension: ${this.dimension},` +
      ` promptStyle: '${this.promptStyle}', apiKey: [gizli] }`
    );
  }

  toString(): string {
    return this[inspect.custom]();
  }
}

// ---------------------------------------------------------------------------
// Çözümleme
// ---------------------------------------------------------------------------

type EnvLike = Record<string, string | undefined>;

function readTrimmed(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function disabled(
  reason: EmbeddingDisabledReason,
  envName?: string,
): EmbeddingDisabled {
  return {
    enabled: false,
    reason,
    message: embeddingDisabledMessageTr(reason),
    ...(envName !== undefined ? { envName } : {}),
  };
}

function resolveDimension(
  env: EnvLike,
  name: string,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  const raw = readTrimmed(env, name);
  if (raw === undefined) return { ok: true, value: fallback };
  if (!/^[0-9]+$/u.test(raw)) return { ok: false };
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

function resolvePromptStyle(
  env: EnvLike,
  fallback: EmbeddingPromptStyle,
): { ok: true; value: EmbeddingPromptStyle } | { ok: false } {
  const raw = readTrimmed(env, EMBEDDING_ENV.promptStyle);
  if (raw === undefined) return { ok: true, value: fallback };
  const lowered = raw.toLowerCase();
  const match = PROMPT_STYLES.find((style) => style === lowered);
  return match === undefined ? { ok: false } : { ok: true, value: match };
}

/**
 * Ortamdan gömme yapılandırmasını çöz. Varsayılan KAPALI.
 *
 * Sıra, Python `get_embedder()` ile aynıdır: `EMBEDDING_PROVIDER=local` yerel
 * sunucuyu seçer (yerel sunucuların çoğu kimlik doğrulamaz, bu yüzden anahtar
 * ZORUNLU DEĞİLDİR); aksi hâlde `OPENROUTER_API_KEY` varsa OpenRouter; hiçbiri
 * yoksa kapalı.
 */
export function resolveEmbeddingConfig(env: EnvLike = process.env): EmbeddingResolution {
  const rawProvider = readTrimmed(env, EMBEDDING_ENV.provider)?.toLowerCase();
  const apiKey = readTrimmed(env, EMBEDDING_ENV.apiKey);

  if (rawProvider !== undefined && rawProvider !== "local" && rawProvider !== "openrouter") {
    return disabled("EMBEDDING_PROVIDER_UNKNOWN", EMBEDDING_ENV.provider);
  }

  const provider: EmbeddingProvider | undefined =
    rawProvider === "local"
      ? "local"
      : rawProvider === "openrouter" || apiKey !== undefined
        ? "openrouter"
        : undefined;

  if (provider === undefined) return disabled("EMBEDDING_NOT_CONFIGURED");

  const warnings: string[] = [];

  if (provider === "local") {
    const baseUrl =
      readTrimmed(env, EMBEDDING_ENV.localBaseUrl) ?? DEFAULT_LOCAL_BASE_URL;
    if (!/^https?:\/\//iu.test(baseUrl)) {
      return disabled("EMBEDDING_BASE_URL_INVALID", EMBEDDING_ENV.localBaseUrl);
    }
    const dimension = resolveDimension(
      env,
      EMBEDDING_ENV.localDimension,
      DEFAULT_LOCAL_DIMENSION,
    );
    if (!dimension.ok) {
      return disabled("EMBEDDING_DIMENSION_INVALID", EMBEDDING_ENV.localDimension);
    }
    const promptStyle = resolvePromptStyle(env, DEFAULT_LOCAL_PROMPT_STYLE);
    if (!promptStyle.ok) {
      return disabled("EMBEDDING_PROMPT_STYLE_INVALID", EMBEDDING_ENV.promptStyle);
    }
    const localKey = readTrimmed(env, EMBEDDING_ENV.localApiKey);
    if (apiKey !== undefined) {
      warnings.push(
        `${EMBEDDING_ENV.provider}=local seçili; ${EMBEDDING_ENV.apiKey} yok sayıldı.`,
      );
    }
    return {
      enabled: true,
      config: new EmbeddingConfig({
        provider: "local",
        model: readTrimmed(env, EMBEDDING_ENV.localModel) ?? DEFAULT_LOCAL_MODEL,
        baseUrl: baseUrl.replace(/\/+$/u, ""),
        dimension: dimension.value,
        promptStyle: promptStyle.value,
        ...(localKey !== undefined ? { apiKey: localKey } : {}),
        warnings,
      }),
    };
  }

  if (apiKey === undefined) {
    return disabled("EMBEDDING_KEY_MISSING", EMBEDDING_ENV.apiKey);
  }
  const dimension = resolveDimension(
    env,
    EMBEDDING_ENV.dimension,
    DEFAULT_OPENROUTER_DIMENSION,
  );
  if (!dimension.ok) {
    return disabled("EMBEDDING_DIMENSION_INVALID", EMBEDDING_ENV.dimension);
  }
  const promptStyle = resolvePromptStyle(env, DEFAULT_OPENROUTER_PROMPT_STYLE);
  if (!promptStyle.ok) {
    return disabled("EMBEDDING_PROMPT_STYLE_INVALID", EMBEDDING_ENV.promptStyle);
  }

  return {
    enabled: true,
    config: new EmbeddingConfig({
      provider: "openrouter",
      model: readTrimmed(env, EMBEDDING_ENV.model) ?? DEFAULT_OPENROUTER_MODEL,
      baseUrl: DEFAULT_OPENROUTER_BASE_URL,
      dimension: dimension.value,
      promptStyle: promptStyle.value,
      apiKey,
      warnings,
    }),
  };
}

// ---------------------------------------------------------------------------
// Metin biçimi (prompt style)
// ---------------------------------------------------------------------------

/**
 * Soru metnini modelin beklediği biçime sok — Python `_format_query` ile aynı.
 * Yanlış biçim sessizce kaliteyi düşürür; bu yüzden iki çalışma zamanı da aynı
 * üç kalıbı kullanır.
 */
export function formatQueryText(style: EmbeddingPromptStyle, query: string): string {
  if (style === "e5") return `query: ${query}`;
  if (style === "raw") return query;
  return `task: search result | query: ${query}`;
}

/** Belge metnini modelin beklediği biçime sok — Python `_format_document`. */
export function formatDocumentText(
  style: EmbeddingPromptStyle,
  document: string,
  title = "",
): string {
  if (style === "e5") return `passage: ${document}`;
  if (style === "raw") return document;
  return `title: ${title} | text: ${document}`;
}

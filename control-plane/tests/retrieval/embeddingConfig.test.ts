/**
 * W16 Şerit C — gömme (embedding) yapılandırmasının gerileme testleri.
 *
 * Burada kanıtlanan üç şey var:
 *
 *   - VARSAYILAN KAPALI. Boş bir ortamda sonuç `enabled:false` ve nedeni
 *     tiplidir; "kapalı" bir hata değil, ürünün normal hâlidir.
 *   - Kapalı olmanın nedenleri BİRBİRİNDEN AYRIDIR: "hiç yapılandırılmamış"
 *     ile "adres bozuk" aynı cümle değildir ve avukat hangisi olduğunu görür.
 *   - ANAHTAR SIZMAZ. Ne `JSON.stringify`, ne `Object.keys`, ne yayma, ne
 *     `util.inspect`, ne `String()`, ne de bir hata mesajı anahtarı gösterir.
 *
 * Hiçbir test süreç ortamını okumaz: `resolveEmbeddingConfig` her çağrıda
 * sahte bir ortam nesnesi alır.
 */

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_DIMENSION,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENROUTER_DIMENSION,
  DEFAULT_OPENROUTER_MODEL,
  EMBEDDING_ENV,
  EmbeddingConfig,
  embeddingDisabledMessageTr,
  formatDocumentText,
  formatQueryText,
  resolveEmbeddingConfig,
} from "../../src/retrieval/embeddingConfig.js";

/** Bilerek ayırt edici: metinlerde aranacak. */
const SECRET = "sk-or-TEST-GIZLI-ANAHTAR-9f3a2b7c";

describe("Şerit C — gömme yapılandırması varsayılan KAPALI", () => {
  it("boş ortamda kapalıdır ve nedeni EMBEDDING_NOT_CONFIGURED'dır", () => {
    const resolution = resolveEmbeddingConfig({});
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_NOT_CONFIGURED");
    expect(resolution.message).toBe(
      embeddingDisabledMessageTr("EMBEDDING_NOT_CONFIGURED"),
    );
    // Avukat Türkçesi: sebebi ve sonucu tek cümlede söyler.
    expect(resolution.message).toContain("KAPALI");
    expect(resolution.envName).toBeUndefined();
  });

  it("ilgisiz değişkenler dolu olsa bile kapalı kalır", () => {
    const resolution = resolveEmbeddingConfig({
      ANTHROPIC_API_KEY: "x",
      COLLEX_DB_URL: "postgres://localhost/collex_local",
    });
    expect(resolution.enabled).toBe(false);
  });

  it("boşluktan ibaret bir anahtar 'anahtar var' saymaz", () => {
    const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.apiKey]: "   " });
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_NOT_CONFIGURED");
  });
});

describe("Şerit C — kapalı olma nedenleri birbirinden ayrıdır", () => {
  it("tanınmayan sağlayıcı adı EMBEDDING_PROVIDER_UNKNOWN verir", () => {
    const resolution = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "uzakyapayzeka",
      [EMBEDDING_ENV.apiKey]: SECRET,
    });
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_PROVIDER_UNKNOWN");
    expect(resolution.envName).toBe(EMBEDDING_ENV.provider);
  });

  it("openrouter seçilip anahtar verilmezse EMBEDDING_KEY_MISSING verir", () => {
    const resolution = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "openrouter",
    });
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_KEY_MISSING");
    expect(resolution.envName).toBe(EMBEDDING_ENV.apiKey);
  });

  it("http(s) olmayan yerel adres EMBEDDING_BASE_URL_INVALID verir", () => {
    const resolution = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "local",
      [EMBEDDING_ENV.localBaseUrl]: "localhost:11434/v1",
    });
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_BASE_URL_INVALID");
    expect(resolution.envName).toBe(EMBEDDING_ENV.localBaseUrl);
  });

  it("boyut tam sayı değilse EMBEDDING_DIMENSION_INVALID verir", () => {
    for (const bad of ["0", "-8", "768.5", "çok"]) {
      const resolution = resolveEmbeddingConfig({
        [EMBEDDING_ENV.provider]: "local",
        [EMBEDDING_ENV.localDimension]: bad,
      });
      expect(resolution.enabled).toBe(false);
      if (resolution.enabled) throw new Error("unreachable");
      expect(resolution.reason).toBe("EMBEDDING_DIMENSION_INVALID");
    }
  });

  it("tanınmayan metin biçimi EMBEDDING_PROMPT_STYLE_INVALID verir", () => {
    const resolution = resolveEmbeddingConfig({
      [EMBEDDING_ENV.apiKey]: SECRET,
      [EMBEDDING_ENV.promptStyle]: "bertopia",
    });
    expect(resolution.enabled).toBe(false);
    if (resolution.enabled) throw new Error("unreachable");
    expect(resolution.reason).toBe("EMBEDDING_PROMPT_STYLE_INVALID");
  });

  it("her nedenin ayrı bir Türkçe cümlesi vardır", () => {
    const reasons = [
      "EMBEDDING_NOT_CONFIGURED",
      "EMBEDDING_PROVIDER_UNKNOWN",
      "EMBEDDING_KEY_MISSING",
      "EMBEDDING_DIMENSION_INVALID",
      "EMBEDDING_BASE_URL_INVALID",
      "EMBEDDING_PROMPT_STYLE_INVALID",
    ] as const;
    const messages = reasons.map((r) => embeddingDisabledMessageTr(r));
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) expect(message).toContain("KAPALI");
  });
});

describe("Şerit C — açıkken Python tarafıyla aynı varsayılanlar", () => {
  it("OPENROUTER_API_KEY tek başına OpenRouter'ı açar", () => {
    const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.apiKey]: SECRET });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) throw new Error("unreachable");
    expect(resolution.config.provider).toBe("openrouter");
    expect(resolution.config.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolution.config.dimension).toBe(DEFAULT_OPENROUTER_DIMENSION);
    expect(resolution.config.promptStyle).toBe("raw");
    expect(resolution.config.hasApiKey).toBe(true);
  });

  it("EMBEDDING_PROVIDER=local anahtarsız açılır (yerel sunucular kimlik istemez)", () => {
    const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.provider]: "local" });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) throw new Error("unreachable");
    expect(resolution.config.provider).toBe("local");
    expect(resolution.config.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(resolution.config.dimension).toBe(DEFAULT_LOCAL_DIMENSION);
    expect(resolution.config.promptStyle).toBe("e5");
    expect(resolution.config.hasApiKey).toBe(false);
  });

  it("local seçiliyken OpenRouter anahtarı yok sayılır ve bu YAZILIR", () => {
    const resolution = resolveEmbeddingConfig({
      [EMBEDDING_ENV.provider]: "local",
      [EMBEDDING_ENV.apiKey]: SECRET,
    });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) throw new Error("unreachable");
    expect(resolution.config.provider).toBe("local");
    expect(resolution.config.warnings.join(" ")).toContain(EMBEDDING_ENV.apiKey);
    // Uyarı, değişkenin ADINI söyler; DEĞERİNİ değil.
    expect(resolution.config.warnings.join(" ")).not.toContain(SECRET);
  });

  it("metin biçimi kalıpları Python `_format_query`/`_format_document` ile aynıdır", () => {
    expect(formatQueryText("e5", "tahliye")).toBe("query: tahliye");
    expect(formatDocumentText("e5", "metin")).toBe("passage: metin");
    expect(formatQueryText("raw", "tahliye")).toBe("tahliye");
    expect(formatDocumentText("raw", "metin")).toBe("metin");
    expect(formatDocumentText("gemini", "metin", "başlık")).toBe(
      "title: başlık | text: metin",
    );
  });
});

describe("Şerit C — anahtar hiçbir çıktıya sızmaz", () => {
  function enabledConfig(): EmbeddingConfig {
    const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.apiKey]: SECRET });
    if (!resolution.enabled) throw new Error("unreachable");
    return resolution.config;
  }

  it("JSON, anahtar listesi, yayma, inspect ve String() anahtarı göstermez", () => {
    const config = enabledConfig();
    // Erişilebilir — ağ katmanı kullanacak.
    expect(config.apiKey).toBe(SECRET);

    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(JSON.stringify({ embedding: config, nested: [config] })).not.toContain(SECRET);
    expect(Object.keys(config)).not.toContain("apiKey");
    expect(JSON.stringify({ ...config })).not.toContain(SECRET);
    expect(Object.getOwnPropertySymbols(config).length).toBe(0);
    expect(inspect(config)).not.toContain(SECRET);
    expect(inspect({ deep: { config } }, { depth: 6 })).not.toContain(SECRET);
    expect(String(config)).not.toContain(SECRET);
    expect(`${config}`).not.toContain(SECRET);
  });

  it("inspect çıktısı anahtarın yerine [gizli] yazar", () => {
    const config = enabledConfig();
    expect(inspect(config)).toContain("[gizli]");
    expect(config.toJSON().hasApiKey).toBe(true);
    expect(JSON.stringify(config.toJSON())).not.toContain(SECRET);
  });

  it("anahtarsız yerel yapılandırma boş anahtar döner, çöp değil", () => {
    const resolution = resolveEmbeddingConfig({ [EMBEDDING_ENV.provider]: "local" });
    if (!resolution.enabled) throw new Error("unreachable");
    expect(resolution.config.apiKey).toBe("");
    expect(resolution.config.hasApiKey).toBe(false);
  });

  it("geçersiz boyutla nesne kurulamaz", () => {
    expect(
      () =>
        new EmbeddingConfig({
          provider: "local",
          model: "m",
          baseUrl: "http://127.0.0.1:1",
          dimension: 0,
          promptStyle: "raw",
        }),
    ).toThrow(RangeError);
  });
});

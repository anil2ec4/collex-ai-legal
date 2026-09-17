/**
 * A REAL dense lane for private Matter documents, without pgvector (W20 E).
 *
 * What it is
 * ----------
 * Exact cosine search over the fresh chunk vectors of the caller's selected
 * uploads. The query is embedded locally (E5 `query:` prefix), vectors are
 * read from `app_private.chunk_vectors` pre-filtered by tenant + current
 * version (or, under a W21 version pin, exactly the pinned versions) + the
 * caller's file scope, and ranked by dot product (vectors are
 * unit length). At Matter scale — hundreds to a few thousand chunks — this is
 * milliseconds and exact; no ANN index is involved or claimed.
 *
 * What it is NOT
 * --------------
 * It does not search the public corpus: public chunks have no vectors on this
 * machine. A search without a file scope returns nothing from this lane (and
 * says so in health), which is the honest result, not a failure.
 *
 * Security
 * --------
 * The ids it returns are untrusted input to hybrid.ts, which re-applies the
 * store's visibility filter while hydrating them (`chunkProvenanceByIds`).
 * The pre-filter here is an efficiency, not the boundary.
 *
 * State (reported by /v1/health and in every search's dense report)
 * -----------------------------------------------------------------
 *   ACTIVE    the last query embedding succeeded (or none was tried and the
 *             probe succeeded)
 *   DEGRADED  the embedder failed; the lane returns nothing and lexical
 *             retrieval carries the answer — the product says so
 *   FAILED    set by hybrid.ts when a search throws unexpectedly
 *   DISABLED  NoopDenseLane: not configured at all
 */

import { formatQueryText, type EmbeddingPromptStyle } from "../retrieval/embeddingConfig.js";
import type { DenseLane, DenseLaneState } from "../retrieval/hybrid.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import type { StoreSearchFilters } from "../store/chunkStore.js";
import type { ChunkVectorStore, EmbeddingProfile, VectorStats } from "./chunkVectorStore.js";
import { decodeVector, dot, l2Normalize } from "./vectorCodec.js";

export const DENSE_BACKEND_TR =
  "Tam kosinüs benzerliği (float32, PostgreSQL bytea) — yalnız yüklediğiniz belgeler";

export interface DenseLaneHealth {
  readonly state: DenseLaneState;
  readonly backend: string;
  readonly scope: "private_uploads_only";
  readonly profile: string;
  readonly model: string;
  readonly dimensions: number;
  readonly vectors: number;
  readonly staleVectors: number;
  readonly chunksWithoutVector: number;
  readonly pendingJobs: number;
  readonly failedJobs: number;
  readonly probe: { readonly ok: boolean; readonly latencyMs: number | null };
  readonly lastError: string | null;
  readonly reasonTr: string;
}

export interface ExactCosineDenseLaneOptions {
  readonly store: ChunkVectorStore;
  readonly embedder: EmbeddingPort;
  readonly profile: EmbeddingProfile;
  /** Query-embedding timeout (default 10 s). */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export class ExactCosineDenseLane implements DenseLane {
  readonly name = "local-exact-cosine";
  private current: DenseLaneState = "ACTIVE";
  private lastError: string | null = null;
  private readonly options: ExactCosineDenseLaneOptions;

  constructor(options: ExactCosineDenseLaneOptions) {
    this.options = options;
  }

  get state(): DenseLaneState {
    return this.current;
  }

  private async embedQuery(text: string): Promise<Float32Array | undefined> {
    const { embedder, profile } = this.options;
    try {
      const [vector] = await embedder.embed(
        [formatQueryText(profile.promptStyle as EmbeddingPromptStyle, text)],
        { signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000) },
      );
      if (vector === undefined || vector.length !== profile.dimensions) {
        throw new Error("query embedding has the wrong shape");
      }
      const unit = l2Normalize(vector);
      if (unit === undefined) throw new Error("query embedding is not usable");
      this.current = "ACTIVE";
      this.lastError = null;
      return unit;
    } catch {
      // DEGRADED, not thrown: lexical retrieval still answers, and the dense
      // report says the semantic lane contributed nothing this time.
      this.current = "DEGRADED";
      this.lastError = "Yerel metin karşılaştırma hizmetine ulaşılamadı.";
      return undefined;
    }
  }

  async search(
    queryText: string,
    options: { asOf: string; limit: number; filters?: StoreSearchFilters | undefined },
  ): Promise<string[]> {
    const fileIds = options.filters?.fileIds ?? [];
    // Only private uploads have vectors here; without a file scope there is
    // nothing this lane can honestly rank.
    if (fileIds.length === 0 || options.limit <= 0) return [];
    // W21 version pin: only the pinned versions' fresh vectors are ranked.
    // A superseded version that was never embedded contributes nothing —
    // never the current version's vectors — and an empty pin matches nothing.
    const pins = options.filters?.documentVersionIds;
    if (pins !== undefined && pins.length === 0) return [];
    const query = await this.embedQuery(queryText);
    if (query === undefined) return [];
    const { profile, store } = this.options;
    const candidates =
      pins === undefined
        ? await store.scopedVectors(profile, fileIds)
        : await store.scopedVectors(profile, fileIds, pins);
    const scored: Array<{ id: string; score: number }> = [];
    for (const candidate of candidates) {
      const vector = decodeVector(candidate.embedding, profile.dimensions);
      if (vector === undefined) continue;
      scored.push({ id: candidate.chunkId, score: dot(query, vector) });
    }
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return scored.slice(0, options.limit).map((entry) => entry.id);
  }

  /** Probe the embedder now and report the lane's truthful state. */
  async health(): Promise<DenseLaneHealth> {
    const now = this.options.now ?? (() => performance.now());
    const started = now();
    const probe = await this.embedQuery("sağlık denetimi");
    const latencyMs = probe === undefined ? null : Math.round(now() - started);
    let stats: VectorStats = {
      vectors: 0,
      staleVectors: 0,
      chunksWithoutVector: 0,
      pendingJobs: 0,
      failedJobs: 0,
    };
    let statsFailed = false;
    try {
      stats = await this.options.store.stats(this.options.profile.key);
    } catch {
      statsFailed = true;
    }
    const state: DenseLaneState = statsFailed ? "FAILED" : this.current;
    const reasonTr =
      state === "ACTIVE"
        ? stats.chunksWithoutVector > 0
          ? `Anlamsal arama açık; ${stats.chunksWithoutVector} bölüm henüz vektörlenmedi (arka planda sürüyor).`
          : "Anlamsal arama açık; yüklediğiniz belgelerin tüm bölümleri vektörlü."
        : state === "DEGRADED"
          ? "Anlamsal arama geçici olarak devre dışı: yerel metin karşılaştırma hizmetine ulaşılamıyor. Aramalar kelime eşleşmesiyle sürüyor."
          : "Anlamsal arama durumu okunamadı.";
    return {
      state,
      backend: DENSE_BACKEND_TR,
      scope: "private_uploads_only",
      profile: this.options.profile.key,
      model: this.options.profile.model,
      dimensions: this.options.profile.dimensions,
      ...stats,
      probe: { ok: probe !== undefined, latencyMs },
      lastError: this.lastError,
      reasonTr,
    };
  }
}

/**
 * `/v1/sources*` hono sub-router (W14/B-14 + B-16 server side).
 *
 * Exported as `createSourcesRouter(deps)`. This module NEVER touches
 * `src/api/server.ts`; the mount line is handed to the lane that owns it.
 *
 * Routes:
 *   GET  /v1/sources/catalog   -> the selectable sources + fetch kinds (form data)
 *   GET  /v1/sources/manifest  -> kapsam manifestosu (B-14)
 *   POST /v1/sources/search    -> künye rows over the selected sources (B-16)
 *   POST /v1/sources/related   -> "olayı anlat" -> multi-query spread + mutabakat
 *                                 (W16 Şerit B; `relatedSearch.ts`)
 *   POST /v1/sources/fetch     -> hash-sealed source card for ONE row (B-16)
 *   POST /v1/sources/within    -> "bu metnin içinde ara" for the two lanes the
 *                                 research planner has no reason to plan
 *
 * Every user-facing string is lawyer Turkish; every machine code stays English
 * UPPER_SNAKE and is explained in Turkish where it is shown.
 */

import { Hono } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import type { EmbeddingResolution } from "../retrieval/embeddingConfig.js";
import { MAX_RERANK_DOCUMENTS } from "../retrieval/semanticRerank.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import {
  FETCH_KINDS,
  FETCH_KIND_IDS,
  SOURCE_CATALOG,
  SOURCE_IDS,
  WITHIN_KINDS,
  WITHIN_KIND_IDS,
  withinKind,
} from "./catalog.js";
import {
  fetchSourceCard,
  UnknownFetchKindError,
  type SourceCard,
} from "./fetchService.js";
import {
  buildCoverageManifest,
  type CoverageManifest,
  type ManifestHealthInput,
} from "./manifest.js";
import { DisabledLocalLibrary, type LocalLibraryPort } from "./localLibrary.js";
import {
  MAX_RELATED_QUERIES,
  NoQueriesBuiltError,
  relatedSearch,
  type RelatedSearchResult,
} from "./relatedSearch.js";
import {
  MAX_SOURCE_SEARCH_LIMIT,
  NoSourcesSelectedError,
  searchSources,
  type SourceSearchResult,
} from "./searchService.js";

export interface SourcesRouterDeps {
  /** Process-local configuration; never changes the MCP child's environment. */
  embedding?: EmbeddingResolution;
  /** Upstream MCP gateway; absent = typed 502 on the live routes. */
  gateway?: ProviderGateway;
  /** Health snapshot for the manifest; called per request. */
  health?: () => Promise<ManifestHealthInput> | ManifestHealthInput;
  /** Where a fetched full document is spooled (W14/B-20). */
  library?: LocalLibraryPort;
  now?: () => string;
  monotonic?: () => number;
  newId?: () => string;
  perCallTimeoutMs?: number;
  /** Wall budget for ONE `/v1/sources/related` request; 0 disables the check. */
  relatedTimeBudgetMs?: number;
  /** Upstream-call ceiling for ONE `/v1/sources/related` request. */
  relatedMaxUpstreamCalls?: number;
}

/**
 * Shown ONLY when this process really has no gateway.
 *
 * W14 L-VERIFY V-3 measured the old sentence on a server that had been
 * started with the flag it recommends: `createApp` built the live gateway and
 * handed it to the research router alone, so "Karar ara" told the lawyer to
 * do the one thing they had already done. The wiring is the fix (see
 * `src/api/server.ts`, `sourcesGateway`); this text is the other half — it
 * now leads with the action a lawyer can actually take (the launcher, which
 * always starts the gateway) and keeps the operator's flag in a trailing
 * clause for someone starting the server by hand. When the gateway IS wired
 * and the upstreams are simply unreachable, this message is never produced:
 * the answer is ALL_SOURCES_FAILED with every failed source NAMED.
 */
const NO_GATEWAY_MESSAGE =
  "Resmî kaynak geçidi bu sunucuda açık değil; kaynak araması yapılamaz." +
  " ColleX'i masaüstündeki başlatıcıyla açtığınızda geçit de açılır" +
  " (sunucuyu elle başlatıyorsanız --with-mcp ekleyin).";

const isoDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, "ISO tarih bekleniyor (YYYY-AA-GG).");

const searchSchema = z
  .object({
    query: z.string().min(2, "Arama en az 2 karakter olmalı.").max(500),
    sources: z.array(z.enum(SOURCE_IDS as [string, ...string[]])).max(30).optional(),
    exactPhrase: z.boolean().optional(),
    excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional(),
    chamber: z.string().min(1).max(20).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    decisionType: z.string().min(1).max(40).optional(),
    legislationNo: z.string().regex(/^[0-9]{1,12}$/u).optional(),
    page: z.number().int().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(MAX_SOURCE_SEARCH_LIMIT).optional(),
  })
  .strict();

/**
 * Filters for the "olayı anlat" lane. The same names `searchSchema` uses, so a
 * lawyer who has learned one form has learned both; `query`/`exactPhrase`/
 * `excludeTerms` are ABSENT on purpose — this lane BUILDS the queries and
 * `queries[]` reports every one of them, so a hand-written query here would be
 * a second, unreported search grammar.
 */
const relatedFiltersSchema = z
  .object({
    chamber: z.string().min(1).max(20).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    decisionType: z.string().min(1).max(40).optional(),
    legislationNo: z.string().regex(/^[0-9]{1,12}$/u).optional(),
    page: z.number().int().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(MAX_SOURCE_SEARCH_LIMIT).optional(),
  })
  .strict();

const relatedSchema = z
  .object({
    olay: z
      .string()
      .min(10, "Olayı en az 10 karakterle anlatın.")
      .max(4000, "Olay metni en çok 4000 karakter olabilir."),
    sources: z.array(z.enum(SOURCE_IDS as [string, ...string[]])).max(30).optional(),
    filters: relatedFiltersSchema.optional(),
    maxQueries: z.number().int().min(1).max(MAX_RELATED_QUERIES).optional(),
    /**
     * W16 şerit G: anlam benzerliğine göre yeniden sıralama. VARSAYILAN
     * KAPALI ve kapalı kalması doğru davranıştır: gömme sağlayıcısı yoksa
     * sonuç EKSİKSİZ döner ve nedeni `semantikSiralama` alanında yazar.
     * Şema `.strict()` olduğu için bu alan eklenmeden istek 400 alıyordu.
     */
    rerank: z.boolean().optional(),
    /**
     * How many head rows the semantic stage may compare, at most
     * {@link MAX_RERANK_DOCUMENTS}; the service clamps once more. Additive;
     * meaningless without `rerank:true`.
     */
    rerankDocuments: z.number().int().min(1).max(MAX_RERANK_DOCUMENTS).optional(),
  })
  .strict();

const fetchSchema = z
  .object({
    kind: z.enum(FETCH_KIND_IDS as [string, ...string[]]),
    externalId: z.string().min(1).max(2000),
    query: z.string().max(500).optional(),
    page: z.number().int().min(1).max(500).optional(),
    /** File the fetched document into the local library (W14/B-20). */
    saveToLibrary: z.boolean().optional(),
  })
  .strict();

const withinSchema = z
  .object({
    kind: z.enum(WITHIN_KIND_IDS as [string, ...string[]]),
    id: z.string().min(1).max(200),
    keyword: z.string().min(1).max(200),
    maxResults: z.number().int().min(1).max(25).optional(),
  })
  .strict();

function invalidBody(issues: Array<{ path: string; message: string }>): {
  error: { kind: string; message: string; issues: Array<{ path: string; message: string }> };
} {
  return {
    error: {
      kind: "INVALID_REQUEST",
      message: "Kaynak isteği doğrulanamadı — eksik veya hatalı alanlar var.",
      issues,
    },
  };
}

/** The card as it goes over the wire: the full text is a separate field. */
export interface SourceCardResponse {
  card: Omit<SourceCard, "text">;
  /** Canonical text, so the console can show the passage in context. */
  text: string;
  /** Whether the document was filed into the local library, and what happened. */
  library: { action: string; key: string; reason?: string };
  /** Turkish provenance line for the chip under the card. */
  kaynakEtiketi: string;
}

/** "resmî kaynak · alınma GG.AA.YYYY" — never "(SENTETİK)". */
export function libraryChipLabel(fetchedAtIso: string): string {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/u.exec(fetchedAtIso);
  const day =
    m === null ? fetchedAtIso : `${m[3] as string}.${m[2] as string}.${m[1] as string}`;
  return `resmî kaynak · alınma ${day}`;
}

export function createSourcesRouter(deps: SourcesRouterDeps = {}): Hono {
  const app = new Hono();
  const library = deps.library ?? new DisabledLocalLibrary();
  const now = deps.now ?? (() => new Date().toISOString());

  const parse = async <T>(
    raw: Promise<unknown>,
    schema: z.ZodType<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; body: unknown }> => {
    let body: unknown;
    try {
      body = await raw;
    } catch {
      return {
        ok: false,
        body: { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } },
      };
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        body: invalidBody(
          fieldIssues(parsed.error),
        ),
      };
    }
    return { ok: true, value: parsed.data };
  };

  // ---- catalog: what the search form may offer -----------------------------
  app.get("/v1/sources/catalog", (c) =>
    c.json(
      {
        kaynaklar: SOURCE_CATALOG.map((s) => ({
          id: s.id,
          ad: s.label,
          aile: s.family,
          arac: s.toolName,
          daireSuzgeci: s.supportsChamber === true,
          tarihAraligi: s.supportsDateRange === true,
          kararTurleri: s.decisionTypes ?? [],
        })),
        tamMetinTurleri: FETCH_KINDS.map((f) => ({ tur: f.kind, ad: f.label })),
        icindeAramaTurleri: WITHIN_KINDS.map((w) => ({ tur: w.kind, ad: w.label })),
      },
      200,
    ),
  );

  // ---- coverage manifesto (B-14) -------------------------------------------
  app.get("/v1/sources/manifest", async (c) => {
    let health: ManifestHealthInput = {};
    try {
      health = (await deps.health?.()) ?? {};
    } catch {
      // The page MUST open even when the health probe throws: an unavailable
      // probe is itself a coverage fact, not a 500.
      health = {};
    }
    const enriched: ManifestHealthInput = {
      ...health,
      ...(health.localLibraryEnabled === undefined
        ? { localLibraryEnabled: !(library instanceof DisabledLocalLibrary) }
        : {}),
    };
    const manifest: CoverageManifest = buildCoverageManifest(enriched, { now });
    return c.json(manifest, 200);
  });

  // ---- list search (B-16) --------------------------------------------------
  app.post("/v1/sources/search", async (c) => {
    const parsed = await parse(c.req.json(), searchSchema);
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NO_GATEWAY_MESSAGE } },
        502,
      );
    }
    const request = parsed.value;
    if (
      request.yearFrom !== undefined &&
      request.yearTo !== undefined &&
      request.yearFrom > request.yearTo
    ) {
      return c.json(
        invalidBody([
          { path: "yearFrom", message: "Başlangıç yılı bitiş yılından büyük olamaz." },
        ]),
        400,
      );
    }

    let result: SourceSearchResult;
    try {
      result = await searchSources(request, {
        gateway: deps.gateway,
        ...(deps.now !== undefined ? { now: deps.now } : {}),
        ...(deps.monotonic !== undefined ? { monotonic: deps.monotonic } : {}),
        ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
        ...(deps.perCallTimeoutMs !== undefined
          ? { perCallTimeoutMs: deps.perCallTimeoutMs }
          : {}),
      });
    } catch (error) {
      if (error instanceof NoSourcesSelectedError) {
        return c.json(
          invalidBody([{ path: "sources", message: "Tanınan hiçbir kaynak seçilmedi." }]),
          400,
        );
      }
      return c.json(
        {
          error: {
            kind: "SEARCH_FAILED",
            message: "Kaynak araması beklenmedik biçimde sonlandı.",
          },
        },
        500,
      );
    }

    // A search where EVERY selected source failed is not an empty result list:
    // it is a failure, and it says which sources failed.
    if (result.rows.length === 0 && result.okSources.length === 0) {
      return c.json(
        {
          error: {
            kind: "ALL_SOURCES_FAILED",
            message:
              "Seçilen kaynakların hiçbirine ulaşılamadı; sonuç listesi BOŞ DEĞİL, YOK.",
            failedSources: result.failedSources,
          },
          searchId: result.searchId,
          trace: result.trace,
        },
        502,
      );
    }
    return c.json(result, 200);
  });

  // ---- "olayı anlat -> ilgili kararlar" (W16, Şerit B) ----------------------
  app.post("/v1/sources/related", async (c) => {
    const parsed = await parse(c.req.json(), relatedSchema);
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NO_GATEWAY_MESSAGE } },
        502,
      );
    }
    const request = parsed.value;
    const filters = request.filters;
    if (
      filters?.yearFrom !== undefined &&
      filters.yearTo !== undefined &&
      filters.yearFrom > filters.yearTo
    ) {
      return c.json(
        invalidBody([
          {
            path: "filters.yearFrom",
            message: "Başlangıç yılı bitiş yılından büyük olamaz.",
          },
        ]),
        400,
      );
    }

    let result: RelatedSearchResult;
    try {
      result = await relatedSearch(
        {
          olay: request.olay,
          ...(request.sources !== undefined ? { sources: request.sources } : {}),
          ...(filters !== undefined ? { filters } : {}),
          ...(request.maxQueries !== undefined ? { maxQueries: request.maxQueries } : {}),
          ...(request.rerank !== undefined ? { rerank: request.rerank } : {}),
          ...(request.rerankDocuments !== undefined
            ? { rerankDocuments: request.rerankDocuments }
            : {}),
        },
        {
          gateway: deps.gateway,
          ...(deps.embedding !== undefined ? { embedding: deps.embedding } : {}),
          ...(deps.now !== undefined ? { now: deps.now } : {}),
          ...(deps.monotonic !== undefined ? { monotonic: deps.monotonic } : {}),
          ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
          ...(deps.perCallTimeoutMs !== undefined
            ? { perCallTimeoutMs: deps.perCallTimeoutMs }
            : {}),
          ...(deps.relatedTimeBudgetMs !== undefined
            ? { timeBudgetMs: deps.relatedTimeBudgetMs }
            : {}),
          ...(deps.relatedMaxUpstreamCalls !== undefined
            ? { maxUpstreamCalls: deps.relatedMaxUpstreamCalls }
            : {}),
        },
      );
    } catch (error) {
      if (error instanceof NoSourcesSelectedError) {
        return c.json(
          invalidBody([{ path: "sources", message: "Tanınan hiçbir kaynak seçilmedi." }]),
          400,
        );
      }
      /* c8 ignore next 8 */
      if (error instanceof NoQueriesBuiltError) {
        return c.json(
          invalidBody([
            {
              path: "olay",
              message: "Bu metinden arama üretilemedi; olayı biraz daha anlatın.",
            },
          ]),
          400,
        );
      }
      return c.json(
        {
          error: {
            kind: "RELATED_SEARCH_FAILED",
            message: "İlgili karar araması beklenmedik biçimde sonlandı.",
          },
        },
        500,
      );
    }

    // Same rule as `/v1/sources/search`: every selected source failing is not
    // an empty list, it is a FAILURE, and it names the sources.
    if (result.okSources.length === 0 && result.failedSources.length > 0) {
      return c.json(
        {
          error: {
            kind: "ALL_SOURCES_FAILED",
            message:
              "Seçilen kaynakların hiçbirine ulaşılamadı; sonuç listesi BOŞ DEĞİL, YOK.",
            failedSources: result.failedSources,
          },
          relatedId: result.relatedId,
          queries: result.queries,
        },
        502,
      );
    }
    return c.json(result, 200);
  });

  // ---- full text -> hash-sealed card (B-16) --------------------------------
  app.post("/v1/sources/fetch", async (c) => {
    const parsed = await parse(c.req.json(), fetchSchema);
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NO_GATEWAY_MESSAGE } },
        502,
      );
    }
    const request = parsed.value;
    let outcome;
    try {
      outcome = await fetchSourceCard(
        {
          kind: request.kind,
          externalId: request.externalId,
          ...(request.query !== undefined ? { query: request.query } : {}),
          ...(request.page !== undefined ? { extra: { page_number: request.page } } : {}),
        },
        {
          gateway: deps.gateway,
          ...(deps.now !== undefined ? { now: deps.now } : {}),
          ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
          ...(deps.perCallTimeoutMs !== undefined
            ? { perCallTimeoutMs: deps.perCallTimeoutMs }
            : {}),
        },
      );
    } catch (error) {
      /* c8 ignore next 3 */
      if (error instanceof UnknownFetchKindError) {
        return c.json(invalidBody([{ path: "kind", message: "Bilinmeyen belge türü." }]), 400);
      }
      return c.json(
        {
          error: {
            kind: "FETCH_FAILED",
            message: "Belge getirme beklenmedik biçimde sonlandı.",
          },
        },
        500,
      );
    }

    if (!outcome.ok) {
      return c.json(
        {
          error: {
            kind: outcome.failure.kind,
            message: outcome.failure.message,
            correlationId: outcome.failure.correlationId,
          },
        },
        502,
      );
    }

    const { text, ...card } = outcome.card;
    const shouldSave = request.saveToLibrary !== false;
    const libraryOutcome = shouldSave
      ? await library.put({
          source: card.provider,
          externalId: card.externalId,
          title: card.title,
          sourceUrl: card.sourceUrl,
          toolName: request.kind,
          fetchedAt: card.retrievedAt,
          text,
          contentSha256: card.contentSha256,
        })
      : { action: "duplicate" as const, key: "", reason: "NOT_REQUESTED" };

    const body: SourceCardResponse = {
      card,
      text,
      library: {
        action: libraryOutcome.action,
        key: libraryOutcome.key,
        ...(libraryOutcome.reason !== undefined ? { reason: libraryOutcome.reason } : {}),
      },
      kaynakEtiketi: libraryChipLabel(card.retrievedAt),
    };
    return c.json(body, 200);
  });

  // ---- search inside one instrument / one journal issue ---------------------
  app.post("/v1/sources/within", async (c) => {
    const parsed = await parse(c.req.json(), withinSchema);
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NO_GATEWAY_MESSAGE } },
        502,
      );
    }
    const request = parsed.value;
    const descriptor = withinKind(request.kind);
    /* c8 ignore next */
    if (descriptor === undefined) {
      return c.json(invalidBody([{ path: "kind", message: "Bilinmeyen arama türü." }]), 400);
    }
    const outcome = await deps.gateway.callTool({
      toolName: descriptor.toolName,
      args: {
        [descriptor.idParam]: request.id,
        keyword: request.keyword,
        max_results: request.maxResults ?? 10,
      },
    });
    if (outcome.status === "error") {
      return c.json(
        {
          error: {
            kind: outcome.error.kind,
            message:
              `Belge içinde arama yapılamadı (${outcome.error.kind});` +
              " kaynak sunucuya ulaşılamadı veya istek reddedildi.",
          },
        },
        502,
      );
    }
    return c.json(
      {
        kind: descriptor.kind,
        label: descriptor.label,
        tool: descriptor.toolName,
        id: request.id,
        keyword: request.keyword,
        // Provider payload passed through as DATA (the console renders it with
        // textContent only); it is never evidence and never a citation.
        sonuc: outcome.data,
        generatedAt: now(),
      },
      200,
    );
  });

  return app;
}

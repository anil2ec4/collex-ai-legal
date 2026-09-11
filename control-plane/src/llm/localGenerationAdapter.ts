/**
 * Local generation adapter: an OpenAI-compatible chat endpoint.
 *
 * Model-agnostic by construction. Ollama, llama.cpp's server and LM Studio
 * all expose `POST /v1/chat/completions` with the same request/response
 * shape, so one adapter reaches any of them and the model is a setting. No
 * model family is named anywhere in this file.
 *
 * Three things this is careful about
 * ----------------------------------
 * 1. **The boundary is checked at CALL time, not only at construction.**
 *    A configuration that changes between requests must not be able to move
 *    privileged text across the boundary; `assertBoundary` runs on every
 *    call. See `endpointTrust.ts` for why LAN needs an explicit allow-list.
 *
 * 2. **Document text is DATA, never instructions.** Everything a document
 *    contributed goes through `wrapEvidenceForModel`, the same fence the
 *    cloud lane uses. A PDF that says "ignore your instructions" is quoted
 *    inside the fence and cannot become a turn of its own.
 *
 * 3. **Nothing privileged is logged.** Errors carry status codes and byte
 *    counts, never prompt or completion text, and never the API key.
 *
 * Small-machine defaults
 * ----------------------
 * The intended appliance has 8 GB of unified memory, so requests are issued
 * ONE at a time through an internal queue (`concurrency`, default 1). A
 * second concurrent generation on that hardware does not halve latency, it
 * evicts the first one's cache. Long work is decomposed into many small
 * resumable units by the caller instead.
 */

import type { EvidenceRef, ClaimDraft } from "../evidence/types.js";
import type {
  DrafterInput,
  DrafterPort,
  EntailmentJudgement,
  EntailmentPort,
} from "./ports.js";
import { wrapEvidenceForModel } from "../security/untrusted.js";
import {
  boundaryAllows,
  classifyEndpoint,
  type DataBoundary,
  type EndpointTrust,
} from "./endpointTrust.js";
import type { LocalGenerationConfig } from "./localGenerationConfig.js";

export type LocalGenerationErrorCode =
  | "UNREACHABLE"
  | "HTTP"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "MALFORMED_JSON"
  | "BOUNDARY";

export class LocalGenerationError extends Error {
  constructor(
    message: string,
    readonly code: LocalGenerationErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LocalGenerationError";
  }
}

/** API keys are held off the instance so they cannot be stringified out. */
const apiKeys = new WeakMap<object, string>();

export interface LocalGenerationOptions {
  readonly config: LocalGenerationConfig;
  readonly boundary: DataBoundary;
  /** Optional bearer credential for a LAN endpoint. Never stored on `this`. */
  readonly apiKey?: string | undefined;
  /** Injectable for tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly trustedLocalHosts?: readonly string[];
}

export interface GenerateJsonRequest {
  /** Instructions. TRUSTED — authored here, never taken from a document. */
  readonly system: string;
  /** The task. TRUSTED. */
  readonly instruction: string;
  /**
   * Text that came from a document or any other untrusted source. Fenced
   * before it reaches the model.
   */
  readonly untrustedText?: string | undefined;
  /** A short description of the JSON shape wanted. TRUSTED. */
  readonly shapeHint: string;
  readonly maxOutputTokens?: number | undefined;
}

export interface LocalGenerationStats {
  readonly calls: number;
  readonly failures: number;
  readonly promptChars: number;
  readonly completionChars: number;
}

interface ChatChoice {
  message?: { content?: unknown };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

export class LocalGenerationAdapter implements DrafterPort, EntailmentPort {
  readonly model: string;
  readonly baseUrl: string;
  readonly trust: EndpointTrust;
  private readonly boundary: DataBoundary;
  private readonly config: LocalGenerationConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly trustedLocalHosts: readonly string[];
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];
  private stats = { calls: 0, failures: 0, promptChars: 0, completionChars: 0 };

  constructor(options: LocalGenerationOptions) {
    this.config = options.config;
    this.model = options.config.model;
    this.baseUrl = options.config.baseUrl;
    this.trust = options.config.trust;
    this.boundary = options.boundary;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.trustedLocalHosts = options.trustedLocalHosts ?? [];
    if (options.apiKey !== undefined && options.apiKey !== "") {
      apiKeys.set(this, options.apiKey);
    }
  }

  get usage(): LocalGenerationStats {
    return { ...this.stats };
  }

  /** Never leaks the key, the prompts or the completions. */
  toJSON(): { model: string; baseUrl: string; trust: EndpointTrust; usage: LocalGenerationStats } {
    return {
      model: this.model,
      baseUrl: this.baseUrl,
      trust: this.trust,
      usage: this.usage,
    };
  }

  /**
   * Re-check the boundary on every call.
   *
   * Construction-time checking alone is not enough: the adapter outlives one
   * request, and a boundary that is only asserted once is a boundary that a
   * later configuration change walks through.
   */
  private assertBoundary(): void {
    const decision = classifyEndpoint(this.baseUrl, {
      trustedLocalHosts: this.trustedLocalHosts,
    });
    if (!decision.ok) {
      throw new LocalGenerationError(decision.message, "BOUNDARY");
    }
    const refusal = boundaryAllows(this.boundary, decision.trust);
    if (refusal !== undefined) {
      throw new LocalGenerationError(refusal.message, "BOUNDARY");
    }
  }

  /** Serialize requests to `concurrency` at a time (default: one). */
  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.config.concurrency <= 1) {
      const run = this.queue.then(task, task);
      // Keep the chain alive even when a task rejects, so one failure does
      // not wedge every later request behind an unhandled rejection.
      this.queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }
    // A bounded queue, not a spin. Waiting on an ALREADY-SETTLED promise in
    // a loop never yields to anything that could lower `inFlight`, so the
    // previous shape busy-looped the event loop forever once the limit was
    // reached — with the whole control plane on that loop.
    while (this.inFlight >= this.config.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += 1;
    try {
      return await task();
    } finally {
      this.inFlight -= 1;
      const next = this.waiters.shift();
      if (next !== undefined) next();
    }
  }

  /**
   * Ask the model for JSON and parse it.
   *
   * This is the primitive the exhaustive Matter analysis lane uses for every
   * unit, so it is deliberately narrow: one system message, one user message,
   * a low temperature and a parsed object or a typed failure. Prose
   * generation is NOT offered — a legal claim must be assembled from verified
   * evidence, not written freehand by a small local model.
   */
  async generateJson<T = unknown>(request: GenerateJsonRequest): Promise<T> {
    this.assertBoundary();

    const fenced =
      request.untrustedText === undefined || request.untrustedText === ""
        ? ""
        : `\n\n${wrapEvidenceForModel(request.untrustedText)}`;
    const user =
      `${request.instruction}\n\n` +
      `Yanıtı YALNIZ şu biçimde geçerli JSON olarak ver: ${request.shapeHint}\n` +
      `Başka hiçbir metin ekleme.${fenced}`;

    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
      stream: false,
    });

    return this.enqueue(async () => {
      this.stats.calls += 1;
      this.stats.promptChars += user.length + request.system.length;

      let response: Response;
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        const key = apiKeys.get(this);
        if (key !== undefined) headers["authorization"] = `Bearer ${key}`;
        response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
          // A redirect would carry privileged text to whatever host the
          // response names, AFTER the boundary check has already passed —
          // so redirects are refused outright rather than followed. An
          // inference endpoint has no legitimate reason to redirect.
          redirect: "error",
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        this.stats.failures += 1;
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw new LocalGenerationError(
          timedOut
            ? "Yerel model yanıt vermedi (süre aşıldı)."
            : "Yerel modele ulaşılamadı.",
          timedOut ? "TIMEOUT" : "UNREACHABLE",
        );
      }

      if (!response.ok) {
        this.stats.failures += 1;
        // The status is safe to surface; the body is not (it can echo the
        // prompt, which is privileged).
        throw new LocalGenerationError(
          "Yerel model isteği reddetti.",
          "HTTP",
          response.status,
        );
      }

      let payload: ChatResponse;
      try {
        payload = (await response.json()) as ChatResponse;
      } catch {
        this.stats.failures += 1;
        throw new LocalGenerationError("Yerel modelin yanıtı okunamadı.", "MALFORMED_JSON");
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        this.stats.failures += 1;
        throw new LocalGenerationError("Yerel model boş yanıt döndürdü.", "EMPTY_RESPONSE");
      }
      this.stats.completionChars += content.length;

      const parsed = parseJsonLoosely(content);
      if (parsed === undefined) {
        this.stats.failures += 1;
        throw new LocalGenerationError(
          "Yerel modelin yanıtı beklenen biçimde değildi.",
          "MALFORMED_JSON",
        );
      }
      return parsed as T;
    });
  }

  /**
   * DrafterPort. Deliberately NOT implemented by generating prose.
   *
   * The citation-first contract says claims are built from validated evidence
   * ids. A small local model is not trusted to compose a legal claim, and a
   * drafter that invents text would defeat the entailment gate rather than
   * pass it. The exhaustive analysis lane uses `generateJson` for structured
   * extraction instead, where every field is checked against source text.
   */
  async draftClaims(_input: DrafterInput): Promise<ClaimDraft[]> {
    throw new LocalGenerationError(
      "Yerel model taslak iddia üretmez; belgelerden çıkarım için kullanılır.",
      "BOUNDARY",
    );
  }

  /**
   * EntailmentPort: does this passage actually support the claim?
   *
   * A judgement is a bounded classification over text the caller already
   * holds, which is what a small model can do reliably. The score is clamped
   * and a malformed answer becomes "not entailed" — the conservative
   * direction, because an unsupported claim must never be finalized.
   */
  async assess(claimText: string, evidence: EvidenceRef): Promise<EntailmentJudgement> {
    try {
      const parsed = await this.generateJson<{
        entails?: unknown;
        score?: unknown;
        rationale?: unknown;
      }>({
        system:
          "Sen bir hukuk metni denetleyicisisin. Sana verilen PASAJIN," +
          " verilen İDDİAYI gerçekten destekleyip desteklemediğini" +
          " değerlendirirsin. Pasajda yazmayan hiçbir şeyi varsayma.",
        instruction:
          `İDDİA: ${claimText}\n\n` +
          "Aşağıdaki pasaj bu iddiayı destekliyor mu? Yalnız pasajda" +
          " yazana bak.",
        untrustedText: evidence.quote,
        shapeHint: '{"entails": true|false, "score": 0..1, "rationale": "kısa gerekçe"}',
        maxOutputTokens: 256,
      });
      const score = clamp01(Number(parsed.score));
      const entails = parsed.entails === true;
      return {
        entails,
        score: Number.isFinite(score) ? score : 0,
        rationale:
          typeof parsed.rationale === "string" && parsed.rationale.trim() !== ""
            ? `yerel-model: ${parsed.rationale.slice(0, 300)}`
            : "yerel-model: gerekçe verilmedi.",
      };
    } catch (error) {
      // A judge that cannot answer must not wave the claim through.
      const detail = error instanceof LocalGenerationError ? error.code : "HATA";
      return {
        entails: false,
        score: 0,
        rationale: `yerel-model: değerlendirme yapılamadı (${detail}).`,
      };
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Parse JSON that a small model may have wrapped in prose or a code fence.
 *
 * Tolerant about PACKAGING only — never about content. If no balanced JSON
 * value can be found the caller gets `undefined` and treats the call as
 * failed; nothing is guessed or repaired.
 */
export function parseJsonLoosely(raw: string): unknown {
  const text = raw.trim();
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const fence = text.indexOf("```");
  if (fence >= 0) {
    const afterOpen = text.indexOf("\n", fence);
    const close = text.indexOf("```", fence + 3);
    if (afterOpen >= 0 && close > afterOpen) {
      const inner = tryParse(text.slice(afterOpen + 1, close).trim());
      if (inner !== undefined) return inner;
    }
  }
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      const inner = tryParse(text.slice(start, end + 1));
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

function tryParse(text: string): unknown {
  if (text === "") return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

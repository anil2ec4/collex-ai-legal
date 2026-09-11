/**
 * Cloud-AI audit ledger + cumulative ceilings (W14 B-23; ENGRISK E13).
 *
 * TWO problems, one module.
 *
 * 1. NO RECORD. A lawyer has to be able to answer "what did you send to a
 *    cloud model, when, and about which file?" — for the client, for the bar
 *    association's guidance, and for KVKK m.9 where the lawyer is the data
 *    controller. There was no record at all.
 *
 * 2. NO CEILING. `analysis.ts` caps the input tokens PER CALL and the
 *    adapter counts tokens, but nothing bounded the total (grep for
 *    `cost` / `quota` / `rateLimit` found nothing). Combined with the CSRF
 *    hole B-04 closes, a foreign page could loop `useCloudAi:true` requests
 *    and spend the lawyer's API budget without limit; they would find out
 *    from the Anthropic invoice.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT
 * ---------------------------------
 * Recorded: timestamp, route, matter/file id, CHARACTER COUNT, approximate
 * input tokens, model, and whether masking was applied.
 *
 * **Never recorded: the text itself.** A ledger that stored the prompt would
 * be a second copy of the client's document in a place nobody thinks about,
 * and would make the audit trail more dangerous than the thing it audits.
 * `tests/ai/ledger.test.ts` searches the stored row for a fixture sentence
 * and fails if it is there.
 *
 * The ledger is best-effort: a failed INSERT never blocks or fails a
 * request, because losing an audit line is bad and losing the lawyer's work
 * is worse. A failure is logged with its code.
 */

import type { Sql } from "../store/db.js";

/** Calls per rolling hour. Generous for a person, useless for a loop. */
export const AI_MAX_CALLS_PER_HOUR = 60;
/** Approximate input tokens per calendar day (server local time). */
export const AI_MAX_INPUT_TOKENS_PER_DAY = 400_000;

export const AI_RATE_LIMITED_KIND = "AI_RATE_LIMITED";

export function aiRateLimitedMessage(reason: "hourly" | "daily"): string {
  return reason === "hourly"
    ? `Bulut yapay zekâ saatlik sınıra ulaşıldı (${AI_MAX_CALLS_PER_HOUR} çağrı/saat).` +
        " Bir süre sonra yeniden deneyin; bu sınır beklenmedik bir maliyeti önlemek içindir."
    : `Bulut yapay zekâ günlük jeton sınırına ulaşıldı (~${AI_MAX_INPUT_TOKENS_PER_DAY.toLocaleString("tr-TR")} jeton).` +
        " Yarın sıfırlanır; bu sınır beklenmedik bir maliyeti önlemek içindir.";
}

export interface AiLedgerEntry {
  at: string;
  /** `analyze-document` | `ocr` | `draft-paragraph`. */
  route: string;
  model: string;
  /** Characters of input actually sent. */
  chars: number;
  /** Approximate input tokens (the adapter's own estimate). */
  inputTokens: number;
  fileId?: string;
  matterId?: string;
  draftId?: string;
  sectionId?: string;
  /** True when the text was masked before sending (B-23). */
  masked: boolean;
}

export interface AiUsageWindow {
  callsLastHour: number;
  inputTokensToday: number;
}

export interface AiLedger {
  record(entry: AiLedgerEntry): Promise<void>;
  usage(now: Date): Promise<AiUsageWindow>;
  list(limit: number): Promise<AiLedgerEntry[]>;
}

/**
 * Default, always available: bounded in-memory ring. `serve.mjs` swaps in
 * the Pg-backed one when the schema is present, exactly like every other
 * store in this codebase.
 */
export class InMemoryAiLedger implements AiLedger {
  private readonly entries: AiLedgerEntry[] = [];
  private readonly cap: number;

  constructor(cap = 500) {
    this.cap = cap;
  }

  async record(entry: AiLedgerEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
  }

  async usage(now: Date): Promise<AiUsageWindow> {
    const hourAgo = now.getTime() - 3_600_000;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    let callsLastHour = 0;
    let inputTokensToday = 0;
    for (const entry of this.entries) {
      const at = Date.parse(entry.at);
      if (Number.isNaN(at)) continue;
      if (at >= hourAgo) callsLastHour += 1;
      if (at >= dayStart.getTime()) inputTokensToday += entry.inputTokens;
    }
    return { callsLastHour, inputTokensToday };
  }

  async list(limit: number): Promise<AiLedgerEntry[]> {
    return this.entries.slice(-limit).reverse();
  }
}

/** PostgreSQL-backed ledger over `app_private.ai_calls`. */
export class PgAiLedger implements AiLedger {
  private readonly sql: Sql;
  private readonly tenantId: string;
  private readonly log: (line: string) => void;

  constructor(options: { sql: Sql; tenantId: string; log?: (line: string) => void }) {
    this.sql = options.sql;
    this.tenantId = options.tenantId;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  }

  async record(entry: AiLedgerEntry): Promise<void> {
    try {
      await this.sql`
        insert into app_private.ai_calls
          (tenant_id, called_at, route, model, chars, input_tokens,
           file_id, matter_id, draft_id, section_id, masked)
        values (${this.tenantId}::uuid, ${entry.at}::timestamptz, ${entry.route},
                ${entry.model}, ${entry.chars}, ${entry.inputTokens},
                ${entry.fileId ?? null}, ${entry.matterId ?? null},
                ${entry.draftId ?? null}, ${entry.sectionId ?? null}, ${entry.masked})`;
    } catch (error) {
      // Never fail the request over an audit line.
      this.log(`[collex] AI_LEDGER_WRITE_FAILED ${(error as { code?: string })?.code ?? "?"}`);
    }
  }

  async usage(now: Date): Promise<AiUsageWindow> {
    try {
      const rows = await this.sql`
        select
          count(*) filter (where called_at >= ${new Date(now.getTime() - 3_600_000)}::timestamptz)::int
            as calls_last_hour,
          coalesce(sum(input_tokens) filter (
            where called_at >= date_trunc('day', ${now}::timestamptz)), 0)::bigint
            as input_tokens_today
        from app_private.ai_calls
        where tenant_id = ${this.tenantId}::uuid`;
      const row = rows[0] ?? {};
      return {
        callsLastHour: Number(row["calls_last_hour"] ?? 0),
        inputTokensToday: Number(row["input_tokens_today"] ?? 0),
      };
    } catch {
      // A ledger that cannot be read must not become a denial of service.
      return { callsLastHour: 0, inputTokensToday: 0 };
    }
  }

  async list(limit: number): Promise<AiLedgerEntry[]> {
    try {
      const rows = await this.sql`
        select called_at, route, model, chars, input_tokens,
               file_id, matter_id, draft_id, section_id, masked
        from app_private.ai_calls
        where tenant_id = ${this.tenantId}::uuid
        order by called_at desc
        limit ${limit}`;
      return rows.map((r) => ({
        at: new Date(r["called_at"] as string | Date).toISOString(),
        route: String(r["route"]),
        model: String(r["model"]),
        chars: Number(r["chars"] ?? 0),
        inputTokens: Number(r["input_tokens"] ?? 0),
        ...(r["file_id"] !== null ? { fileId: String(r["file_id"]) } : {}),
        ...(r["matter_id"] !== null ? { matterId: String(r["matter_id"]) } : {}),
        ...(r["draft_id"] !== null ? { draftId: String(r["draft_id"]) } : {}),
        ...(r["section_id"] !== null ? { sectionId: String(r["section_id"]) } : {}),
        masked: r["masked"] === true,
      }));
    } catch {
      return [];
    }
  }
}

/**
 * Ceiling check. Returns the refusal reason, or undefined when the call may
 * proceed. Pure over the usage window so the routes stay testable.
 */
export function overCeiling(usage: AiUsageWindow): "hourly" | "daily" | undefined {
  if (usage.callsLastHour >= AI_MAX_CALLS_PER_HOUR) return "hourly";
  if (usage.inputTokensToday >= AI_MAX_INPUT_TOKENS_PER_DAY) return "daily";
  return undefined;
}

/**
 * Fake `fetch` for the Anthropic Messages API. Captures every request
 * (url, headers, parsed JSON body) and answers with a synthetic tool_use
 * message. All offline; nothing here opens a socket.
 */

export interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> & {
    model: string;
    system: string;
    messages: Array<{ role: string; content: unknown }>;
    tools: Array<{ name: string; strict: boolean; input_schema: unknown }>;
    tool_choice: Record<string, unknown>;
    max_tokens: number;
  };
  signal: AbortSignal | null | undefined;
}

export interface FakeReply {
  toolInput?: unknown;
  toolName?: string;
  stopReason?: string;
  usage?: Record<string, number>;
  /** >= 400 produces an error response with this status. */
  status?: number;
  retryAfter?: string;
  /** Throw this instead of answering (network failure). */
  throwError?: Error;
}

export type ReplyFn = (
  body: CapturedCall["body"],
  call: number,
) => FakeReply | Response | Promise<FakeReply | Response>;

type FetchInput = Parameters<typeof fetch>[0];
type FetchHeaders = NonNullable<RequestInit["headers"]>;

function normalizeHeaders(headers: FetchHeaders | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key.toLowerCase()] = value;
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value);
  return out;
}

/** First user text of the request (string content or the text block). */
export function userText(call: CapturedCall): string {
  const content = call.body.messages[0]?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => (block as { type?: unknown }).type === "text")
      .map((block) => String((block as { text?: unknown }).text ?? ""))
      .join("\n");
  }
  return "";
}

export function fakeAnthropic(reply: ReplyFn): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body)) as CapturedCall["body"];
    const call: CapturedCall = {
      url,
      headers: normalizeHeaders(init?.headers),
      body,
      signal: init?.signal,
    };
    calls.push(call);
    const answer = await reply(body, calls.length);
    if (answer instanceof Response) return answer;
    if (answer.throwError !== undefined) throw answer.throwError;
    if (answer.status !== undefined && answer.status >= 400) {
      return new Response(
        JSON.stringify({ type: "error", error: { type: "api_error", message: "fake" } }),
        {
          status: answer.status,
          headers: {
            "content-type": "application/json",
            ...(answer.retryAfter !== undefined ? { "retry-after": answer.retryAfter } : {}),
          },
        },
      );
    }
    const toolName = answer.toolName ?? body.tools[0]?.name ?? "tool";
    const stopReason = answer.stopReason ?? "tool_use";
    const content =
      answer.toolInput === undefined
        ? []
        : [{ type: "tool_use", id: "toolu_fake", name: toolName, input: answer.toolInput }];
    const payload = {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: stopReason,
      usage: { input_tokens: 100, output_tokens: 50, ...answer.usage },
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A fetch that never answers until the request's AbortSignal fires. */
export function hangingFetch(): typeof fetch {
  return ((_input: FetchInput, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) return;
      if (signal.aborted) {
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
        once: true,
      });
    })) as typeof fetch;
}

/** Records every console/stderr line so a test can prove a secret never leaked. */
export function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
  };
  const record = (...args: unknown[]): void => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  console.log = record;
  console.error = record;
  console.warn = record;
  console.info = record;
  console.debug = record;
  process.stderr.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines,
    restore: () => {
      console.log = originals.log;
      console.error = originals.error;
      console.warn = originals.warn;
      console.info = originals.info;
      console.debug = originals.debug;
      process.stderr.write = originals.stderr as typeof process.stderr.write;
      process.stdout.write = originals.stdout as typeof process.stdout.write;
    },
  };
}

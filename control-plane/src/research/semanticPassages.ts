import type { AnswerCandidate } from "../answer/evidencePack.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import { codePointSlice } from "../verification/validator.js";

/**
 * Fixed-size CODE-POINT windows over a long text, for embedding.
 *
 * Every window is exactly `size` code points long when the text is longer
 * than `size` (the last window is anchored to the END of the text, so the
 * tail is never a short fragment); a text that fits is returned whole. When
 * more than `maxWindows` would be produced, evenly spaced ones are kept and
 * the first and the last always survive. Deterministic: same text, same
 * windows. Code points, never UTF-16 units (ADR-003).
 */
export function codePointWindows(
  text: string, size: number, stride: number, maxWindows: number,
): string[] {
  const points = [...text];
  if (size <= 0 || points.length <= size) return [text];
  const step = Math.max(1, Math.min(stride, size));
  const starts: number[] = [];
  for (let start = 0; start + size < points.length; start += step) starts.push(start);
  const tail = points.length - size;
  if (starts[starts.length - 1] !== tail) starts.push(tail);
  let chosen = starts;
  const cap = Math.max(1, maxWindows);
  if (starts.length > cap) {
    chosen = cap === 1 ? [0] : Array.from({ length: cap }, (_, i) =>
      starts[Math.round((i * (starts.length - 1)) / (cap - 1))] as number);
    chosen = [...new Set(chosen)];
  }
  return chosen.map(start => points.slice(start, start + size).join(""));
}

export interface PassageGroup {
  text: string;
  candidates: AnswerCandidate[];
  fallback: AnswerCandidate[];
}

/** Local E5 only. Selects existing source spans; never rewrites evidence scores. */
export async function selectSemanticPassages(
  groups: PassageGroup[], query: string, port: EmbeddingPort, timeoutMs: number,
): Promise<{ candidates: AnswerCandidate[]; applied: boolean; reason?: string }> {
  const fallback = groups.flatMap(g => g.fallback);
  const rows = groups.flatMap((g, group) => g.candidates.map(candidate => ({
    group, candidate, quote: codePointSlice(g.text, candidate.startChar, candidate.endChar),
  })));
  if (timeoutMs <= 0 || rows.length < 2 || rows.length > 40) {
    return { candidates: fallback, applied: false, reason: "SEMANTIC_PASSAGES_SKIPPED" };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const vectors = await Promise.race([
      port.embed(["query: " + Array.from(query).slice(0, 2000).join(""),
        ...rows.map(r => "passage: " + r.quote)], { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, Math.min(5000, timeoutMs));
      }),
    ]);
    if (vectors.length !== rows.length + 1) throw new Error("count");
    const unit = vectors.map(v => {
      if (v.length !== 384 || v.some(x => !Number.isFinite(x))) throw new Error("dimension");
      const norm = Math.hypot(...v);
      if (!Number.isFinite(norm) || norm === 0) throw new Error("norm");
      return v.map(x => x / norm);
    });
    const queryVector = unit[0]!;
    const scored = rows.map((r, i) => ({ ...r,
      score: unit[i + 1]!.reduce((sum, x, k) => sum + x * queryVector[k]!, 0),
    }));
    const candidates = groups.flatMap((g, group) => scored.filter(r => r.group === group)
      .sort((a, b) => b.score - a.score || a.candidate.startChar - b.candidate.startChar)
      .slice(0, g.fallback.length).map(r => r.candidate)
      .sort((a, b) => a.startChar - b.startChar));
    return { candidates, applied: true };
  } catch {
    return { candidates: fallback, applied: false, reason: "SEMANTIC_PASSAGES_UNAVAILABLE" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

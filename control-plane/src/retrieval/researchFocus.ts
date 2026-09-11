/** Explicit final research instruction; facts remain available to retrieval. */
export function explicitResearchFocus(question: string): string | undefined {
  const sentences = question.split(/(?<=[.!?…])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
  if (sentences.length < 2) return undefined;
  const last = sentences[sentences.length - 1]!;
  return /(?:^|\s)(?:araştır|araştırın|bul|bulun|incele|inceleyin|karşılaştır|karşılaştırın)[.!?…]*$/iu.test(last)
    ? last : undefined;
}

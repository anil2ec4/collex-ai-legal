import { expect, it } from "vitest";
import { selectQuoteSpans } from "../../src/research/liveEvidence.js";

it("finds the relevant tail of a long paragraph rather than quoting its unrelated opening", () => {
  const text = "😀 Dosya usulüne göre incelendi. ".repeat(45) +
    "Fazla çalışma tanık anlatımı işveren kayıtları ile ispat edilir. " + "Gerekçe açıklanmıştır. ".repeat(8);
  const spans = selectQuoteSpans(text, "fazla çalışma tanık işveren kayıtları ispat", { maxSpans: 1 });
  const quote = Array.from(text).slice(spans[0]!.startChar, spans[0]!.endChar).join("");
  expect(quote).toContain("Fazla çalışma tanık anlatımı işveren kayıtları");
  expect(Array.from(quote).length).toBeLessThanOrEqual(600);
  expect(spans[0]!.score).toBe(1);
});

it("does not select overlapping windows as two separate passages", () => {
  const text = "Başlangıç açıklaması. ".repeat(40) + "Fazla çalışma tanık ispatı. ".repeat(30);
  const spans = selectQuoteSpans(text, "fazla çalışma tanık ispatı");
  for (let i = 1; i < spans.length; i++) expect(spans[i]!.startChar).toBeGreaterThanOrEqual(spans[i - 1]!.endChar);
});

it("ranks Turkish inflections consistently with the evidence coverage gate", () => {
  const text = "Dosyanın usule uygun olarak gönderildiği ve incelemeye alındığı görülmüştür.\n\n" +
    "Tanıkların anlatımları işverenin kayıtlarıyla birlikte değerlendirilmiş ve ispatın sağlandığı sonucuna varılmıştır.";
  const [span] = selectQuoteSpans(text, "tanıkla işveren kayıtları ispatı", { maxSpans: 1 });
  expect(Array.from(text).slice(span!.startChar, span!.endChar).join("")).toContain("Tanıkların");
  expect(span!.score).toBeGreaterThanOrEqual(0.75);
});

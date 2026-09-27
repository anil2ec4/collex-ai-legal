/**
 * Evidence resolution (W12): conflicted claims reused as CONFLICTED, warm()
 * before get(), uploads as exhibits + suggested facts (no claims), GG.AA.YYYY
 * in citation labels.
 */

import { describe, expect, it } from "vitest";

import {
  draftEvidenceLabel,
  extractDateTr,
  extractSuggestedFacts,
  splitSentencesTr,
  MAX_SUGGESTED_FACTS,
  resolveDraftEvidence,
} from "../../src/drafting/evidence.js";
import { conflictedAnswer, uploadChunk } from "./fixtures.js";

describe("draftEvidenceLabel", () => {
  it("renders decision dates GG.AA.YYYY and keeps the künye order", () => {
    expect(
      draftEvidenceLabel({
        title: "x",
        court: "Yargıtay 3. HD",
        docketNo: "2023/1",
        decisionNo: "2024/2",
        decisionDate: "2024-06-24",
      }),
    ).toBe("Yargıtay 3. HD, E. 2023/1, K. 2024/2, T. 24.06.2024");
    expect(draftEvidenceLabel({ title: "Türk Ceza Kanunu", legislationNo: "5237", article: "157" })).toBe(
      "5237 sayılı Türk Ceza Kanunu, m. 157",
    );
  });
});

describe("resolveDraftEvidence — runId", () => {
  it("calls warm() before get(), reuses SUPPORTED, marks CONFLICTING as conflicted", async () => {
    const order: string[] = [];
    const resolved = await resolveDraftEvidence(
      { runId: "run-1" },
      {
        answers: {
          warm: async (id) => {
            order.push(`warm:${id}`);
          },
          get: (id) => {
            order.push(`get:${id}`);
            return conflictedAnswer();
          },
        },
      },
    );
    expect(order).toEqual(["warm:run-1", "get:run-1"]);
    expect(resolved.issues).toEqual([]);
    const claims = resolved.pack!.claims;
    expect(claims.map((c) => [c.claimId, c.conflicted === true])).toEqual([
      ["claim-ev-tck157", false],
      ["claim-celiskili", true],
    ]);
    expect(resolved.warnings.some((w) => w.includes("çelişki") && w.includes("KARŞI İÇTİHAT"))).toBe(true);
    expect(resolved.machineWarnings.some((w) => w.includes("CONFLICTING_AUTHORITIES"))).toBe(true);
    expect(resolved.pack!.synthetic).toBe(true);
  });

  it("a claim resting only on non-pinned neighbour passages is context, never a Dayanak (W12-FIX)", async () => {
    const base = conflictedAnswer();
    const supported = base.result.claims[0]!;
    const neighbour = {
      ...base.result.evidence[0]!,
      evidenceId: "ev-tck158",
      article: "158",
      quote: "MADDE 158 - (1) Dolandırıcılık suçunun nitelikli hâlleri.",
      retrieval: { pinned: false },
    };
    const answer = {
      result: {
        ...base.result,
        claims: [
          supported,
          { claimId: "claim-ev-tck158", text: "TCK m.158: nitelikli hâller", evidenceIds: ["ev-tck158"], verdict: "SUPPORTED" },
        ],
        evidence: [{ ...base.result.evidence[0]!, retrieval: { pinned: true } }, neighbour],
      },
    };
    const resolved = await resolveDraftEvidence({ runId: "run-1" }, { answers: { get: () => answer } });
    expect(resolved.pack?.claims.map((c) => c.claimId)).toEqual(["claim-ev-tck157"]);
    // The neighbour's evidence stays available (unusedEvidence after composition), and the reader is told in Turkish.
    expect(resolved.pack?.evidence.map((e) => e.evidenceId)).toContain("ev-tck158");
    expect(resolved.warnings.some((w) => w.includes("komşu hükümlere dayandığı için"))).toBe(true);
    expect(resolved.machineWarnings.some((w) => w.includes("claim-ev-tck158") && w.includes("CONTEXT_ONLY"))).toBe(true);

    // Without any pinned passage (an application question) every supported claim is reused as before.
    const unpinned = { result: { ...answer.result, evidence: answer.result.evidence.map((e) => ({ ...e, retrieval: { pinned: false } })) } };
    const all = await resolveDraftEvidence({ runId: "run-1" }, { answers: { get: () => unpinned } });
    expect(all.pack?.claims.map((c) => c.claimId)).toEqual(["claim-ev-tck157", "claim-ev-tck158"]);
  });

  it("skips INSUFFICIENT_EVIDENCE claims with one human sentence", async () => {
    const answer = conflictedAnswer();
    answer.result = {
      ...answer.result,
      claims: [{ ...answer.result.claims[0]!, verdict: "INSUFFICIENT_EVIDENCE" }],
    };
    const resolved = await resolveDraftEvidence({ runId: "run-1" }, { answers: { get: () => answer } });
    expect(resolved.pack!.claims).toEqual([]);
    expect(resolved.warnings).toEqual([
      "1 hukukî değerlendirme, doğrulanmış kanıtı bulunmadığı için taslağa yazılmadı; değerlendirme avukata bırakıldı.",
    ]);
  });
});

describe("resolveDraftEvidence — fileIds (audit #4)", () => {
  it("produces exhibits and suggested facts, never claims", async () => {
    const chunk = uploadChunk();
    const resolved = await resolveDraftEvidence(
      { fileIds: ["file-1"] },
      { files: { getChunks: async () => [chunk, uploadChunk({ chunkId: "chunk-2", ordinal: 1, text: "Kısa metin." })] } },
    );
    expect(resolved.issues).toEqual([]);
    const pack = resolved.pack!;
    expect(pack.claims).toEqual([]);
    expect(pack.evidence).toHaveLength(2);
    expect(pack.evidence[0]).toMatchObject({ source: "UPLOAD", fileId: "file-1", chunkId: "chunk-1", label: "protokol.pdf" });
    expect(pack.uploads).toEqual([
      { fileId: "file-1", fileName: "protokol.pdf", contentSha256: chunk.contentSha256, chunkCount: 2 },
    ]);
    expect(pack.suggestedFacts!.map((f) => f.tarih)).toEqual(["12.05.2024", "03.06.2024"]);
    expect(pack.suggestedFacts!.every((f) => f.fileId === "file-1")).toBe(true);
    expect(resolved.warnings[0]).toContain("Ek-n");
  });

  it("extracts dates in numeric, ISO and Turkish long form; caps the list", () => {
    expect(extractDateTr("Sözleşme 12.05.2024 tarihinde imzalandı.")).toBe("12.05.2024");
    expect(extractDateTr("Tebliğ 2024-06-03 günü yapıldı.")).toBe("03.06.2024");
    expect(extractDateTr("3 Haziran 2024 tarihinde ihtar çekildi.")).toBe("03.06.2024");
    expect(extractDateTr("Tarih yok.")).toBeUndefined();
    const many = Array.from({ length: 40 }, (_, i) => `Davalı ${i + 1}.01.2024 tarihinde ödeme yapmamıştır.`).join(" ");
    const facts = extractSuggestedFacts([uploadChunk({ text: many })]);
    expect(facts.length).toBe(MAX_SUGGESTED_FACTS);
  });
});

describe("suggested facts — abbreviation-aware sentences (27.09.2026)", () => {
  it("never cuts a fact at 'm.', 'E.', an ordinal or 'A.Ş.'", () => {
    const text =
      "Fesih bildirimi 02.10.2023 tarihinde Şişli 12. Noterliği aracılığıyla Örnek A.Ş. adına gönderildi. " +
      "4857 sayılı Kanun m. 17 uyarınca bildirim süresi 8 haftadır. Yargıtay 9. HD. 2020/1111 E. sayılı karar da aynı yöndedir.";
    expect(splitSentencesTr(text).map((s) => s.trim())).toEqual([
      "Fesih bildirimi 02.10.2023 tarihinde Şişli 12. Noterliği aracılığıyla Örnek A.Ş. adına gönderildi.",
      "4857 sayılı Kanun m. 17 uyarınca bildirim süresi 8 haftadır.",
      "Yargıtay 9. HD. 2020/1111 E. sayılı karar da aynı yöndedir.",
    ]);
    const facts = extractSuggestedFacts([uploadChunk({ text })]);
    expect(facts.some((f) => f.metin.endsWith("Kanun m.") || /^\d+ /u.test(f.metin))).toBe(false);
    expect(facts[0]?.tarih).toBe("02.10.2023");
  });
});

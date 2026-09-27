/**
 * reviseDraft rules (W12 contract [D]): section/paragraph validation,
 * evidence closure, lexical binding, the entailment trust gate, the karşıt
 * lock, evidenceUse toggles, version/count/warning recomputation.
 */

import { describe, expect, it } from "vitest";
import { formatTimestampTr } from "../../src/drafting/input.js";

import { composeDraft, DraftValidationError } from "../../src/drafting/composer.js";
import { reviseDraft, type DraftPatch, type DraftPatchSection } from "../../src/drafting/revise.js";
import { QUOTE_ALTERED } from "../../src/drafting/quoteIntegrity.js";
import {
  EK_DOGRULAMA_SECTION_ID,
  KARSI_ICTIHAT_SECTION_ID,
  NOTE_KAYNAKLI,
  NOTE_KAYNAKSIZ,
  type Draft,
} from "../../src/drafting/types.js";
import {
  QUOTE_KARSIT,
  QUOTE_TCK158,
  davaRequest,
  karsitEvidence,
  tck158Evidence,
  tckEvidence,
  tckPack,
} from "./fixtures.js";

const NOW = () => new Date("2026-09-02T11:00:00.000Z");
const OPTS = { trustEntailment: false, now: NOW };

/** Base draft: TCK 157 cited, TCK 158 unused, a contrary decision. */
function baseDraft(): Draft {
  return composeDraft(
    davaRequest(),
    tckPack({
      evidence: [{ ...tckEvidence(), direction: "destekleyen" }, tck158Evidence(), karsitEvidence()],
    }),
    { now: NOW },
  );
}

/** The editable body of a draft as a patch (ek-dogrulama excluded). */
function asPatchSections(draft: Draft): DraftPatchSection[] {
  return draft.sections
    .filter((s) => s.id !== EK_DOGRULAMA_SECTION_ID)
    .map((s) => ({
      id: s.id,
      paragraphs: s.paragraphs.map((p) => ({
        id: p.id,
        text: p.text,
        evidenceIds: [...p.evidenceIds],
        role: p.role,
      })),
    }));
}

function section(draft: Draft, id: string) {
  return draft.sections.find((s) => s.id === id);
}

describe("reviseDraft — versions, warnings and identity", () => {
  it("increments the version, stamps updatedAt, refreshes warnings, keeps the id", () => {
    const draft = baseDraft();
    const { draft: revised, issues } = reviseDraft(draft, { sections: asPatchSections(draft) }, OPTS);
    expect(issues).toEqual([]);
    expect(revised.draftId).toBe(draft.draftId);
    expect(revised.version).toBe(2);
    expect(revised.createdAt).toBe(draft.createdAt);
    expect(revised.updatedAt).toBe("2026-09-02T11:00:00.000Z");
    expect(revised.reviewRequired).toBe(true);
    expect(revised.unsupportedCount).toBe(draft.unsupportedCount);
    expect(revised.evidence.map((e) => e.evidenceId)).toEqual(draft.evidence.map((e) => e.evidenceId));
    expect(revised.unusedEvidence.map((e) => e.evidenceId)).toEqual(["ev-tck158"]);
    expect(revised.warnings.filter((w) => /^Sürüm \d+:/u.test(w))).toEqual([
      `Sürüm 2: avukat düzenlemesi (${formatTimestampTr("2026-09-02T11:00:00.000Z")}).`,
    ]);
    // Revising twice replaces the revision line instead of stacking it.
    const { draft: third } = reviseDraft(revised, { sections: asPatchSections(revised) }, OPTS);
    expect(third.version).toBe(3);
    expect(third.warnings.filter((w) => /^Sürüm \d+:/u.test(w))).toHaveLength(1);
    // The ek-dogrulama section is regenerated and stays last.
    expect(third.sections[third.sections.length - 1]?.id).toBe(EK_DOGRULAMA_SECTION_ID);
  });

  it("stores edited text as plain text (hygiene only) and generates ids for new paragraphs", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    const sonuc = sections.find((s) => s.id === "sonuc")!;
    // A zero-width character and a control are dropped; the markup is kept
    // AS TEXT (27.09.2026) — each renderer escapes it for its own medium, and
    // the Markdown export's escaping is asserted in markdown.test.ts.
    sonuc.paragraphs.push({ text: "3. <b>Faiz</b>​ talebimiz\u0007 saklıdır." });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues).toEqual([]);
    const added = section(revised, "sonuc")!.paragraphs[sonuc.paragraphs.length - 1]!;
    expect(added.id).toBe("p-sonuc-u1");
    expect(added.text).toBe("3. <b>Faiz</b> talebimiz saklıdır.");
    expect(added.role).toBe("talepler");
    expect(added.supported).toBe(true);
  });

  it("drops empty paragraphs and unknown ids with issues, never silently", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    sections.find((s) => s.id === "konu")!.paragraphs.push({ id: "p-hayalet", text: "   " });
    sections.find((s) => s.id === "konu")!.paragraphs.push({ id: "p-hayalet-2", text: "Yeni konu satırı." });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues.map((i) => i.message)).toEqual([
      "Boş paragraf atlandı.",
      "'p-hayalet-2' taslakta yok; yeni paragraf olarak eklendi.",
    ]);
    expect(section(revised, "konu")!.paragraphs).toHaveLength(2);
    expect(revised.warnings.some((w) => w.startsWith("Düzenleme uyarısı: 'p-hayalet-2'"))).toBe(true);
  });
});

describe("reviseDraft — structure", () => {
  it("throws for an unknown section, a duplicate section and a wrong order", () => {
    const draft = baseDraft();
    expect(() =>
      reviseDraft(draft, { sections: [{ id: "yok", paragraphs: [] }] }, OPTS),
    ).toThrow(DraftValidationError);
    expect(() =>
      reviseDraft(
        draft,
        { sections: [{ id: "konu", paragraphs: [] }, { id: "konu", paragraphs: [] }] },
        OPTS,
      ),
    ).toThrow(DraftValidationError);
    const reversed = [...asPatchSections(draft)].reverse();
    expect(() => reviseDraft(draft, { sections: reversed }, OPTS)).toThrow(/şablon sırasını/u);
  });

  it("ignores a client-sent ek-dogrulama section and rebuilds it", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    sections.push({ id: EK_DOGRULAMA_SECTION_ID, paragraphs: [{ text: "sahte doğrulama" }] });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues.some((i) => i.message.includes("makine tarafından üretilir"))).toBe(true);
    const ek = section(revised, EK_DOGRULAMA_SECTION_ID)!;
    expect(ek.paragraphs.some((p) => p.text.includes("sahte"))).toBe(false);
    expect(ek.paragraphs.some((p) => p.text.startsWith("K-1 — "))).toBe(true);
  });

  it("keeps the karşı içtihat section when omitted; removes it only when sent empty", () => {
    const draft = baseDraft();
    const omitted = asPatchSections(draft).filter((s) => s.id !== KARSI_ICTIHAT_SECTION_ID);
    const kept = reviseDraft(draft, { sections: omitted }, OPTS);
    expect(section(kept.draft, KARSI_ICTIHAT_SECTION_ID)?.paragraphs).toHaveLength(1);
    expect(kept.issues.some((i) => i.message.includes("kaldırılamaz"))).toBe(true);

    const emptied = asPatchSections(draft).map((s) =>
      s.id === KARSI_ICTIHAT_SECTION_ID ? { ...s, paragraphs: [] } : s,
    );
    const removed = reviseDraft(draft, { sections: emptied }, OPTS);
    expect(section(removed.draft, KARSI_ICTIHAT_SECTION_ID)).toBeUndefined();
    // The contrary entry is no longer cited -> parked, never a dayanak.
    expect(removed.draft.unusedEvidence.map((e) => e.evidenceId)).toContain("ev-karsit");
  });
});

describe("reviseDraft — evidence binding rules", () => {
  it("lexical binding: the quote's words must survive the edit", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    const sebepler = sections.find((s) => s.id === "hukuki-sebepler")!;
    // The lawyer trims the quote to its first words: overlap drops below the floor.
    sebepler.paragraphs[0]!.text = "Dayanak: TCK m. 157 — \"Dolandırıcılık suçunun sentetik temel hâlinde …\"";
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    const p = section(revised, "hukuki-sebepler")!.paragraphs[0]!;
    expect(p.evidenceIds).toEqual([]);
    expect(p.supported).toBe(false);
    expect(p.note).toBe(NOTE_KAYNAKSIZ);
    expect(
      issues.some((i) => i.path.endsWith(".evidenceIds") && i.code === QUOTE_ALTERED),
    ).toBe(true);
    expect(revised.unsupportedCount).toBe(draft.unsupportedCount + 1);
  });

  it("lexical binding: a single changed number inside the quote breaks the binding", () => {
    const quote = "Sentetik TCK madde 157 uyarınca faile bir yıldan beş yıla kadar hapis cezası verilir.";
    // The label carries no digits, so the only "157" in the paragraph is the quote's.
    const numeric = {
      ...tckEvidence(),
      evidenceId: "ev-num",
      label: "Sentetik Ceza Kanunu (SENTETİK)",
      quote,
      quoteSha256: "a".repeat(64),
      direction: "destekleyen" as const,
    };
    const draft = composeDraft(
      davaRequest(),
      tckPack({
        claims: [{ claimId: "c-num", text: `${numeric.label}: "${quote}"`, evidenceIds: ["ev-num"] }],
        evidence: [numeric],
      }),
      { now: NOW },
    );
    const sections = asPatchSections(draft);
    const sebepler = sections.find((s) => s.id === "hukuki-sebepler")!;
    expect(sebepler.paragraphs[0]!.evidenceIds).toEqual(["ev-num"]);
    sebepler.paragraphs[0]!.text = sebepler.paragraphs[0]!.text.replace("madde 157", "madde 158");
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    const p = section(revised, "hukuki-sebepler")!.paragraphs[0]!;
    expect(p.evidenceIds).toEqual([]);
    expect(p.supported).toBe(false);
    expect(issues.some((i) => i.code === QUOTE_ALTERED)).toBe(true);
    expect(issues.some((i) => i.message.includes("kaynağındakinden farklı"))).toBe(true);
  });

  it("evidenceIds must be in the draft's evidence or unusedEvidence", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    sections.find((s) => s.id === "sonuc")!.paragraphs[0]!.evidenceIds = ["ev-yok"];
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(section(revised, "sonuc")!.paragraphs[0]!.evidenceIds).toEqual([]);
    expect(issues.some((i) => i.message.includes("'ev-yok'"))).toBe(true);
  });

  it("citing an unused entry lexically pulls it into the document", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    sections.find((s) => s.id === "hukuki-sebepler")!.paragraphs.push({
      text: `Dayanak: TCK m. 158 — "${QUOTE_TCK158}"`,
      evidenceIds: ["ev-tck158"],
      role: "hukukiSebepler",
    });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues).toEqual([]);
    expect(revised.evidence.map((e) => e.evidenceId)).toContain("ev-tck158");
    expect(revised.unusedEvidence).toEqual([]);
    const added = section(revised, "hukuki-sebepler")!.paragraphs[1]!;
    expect(added.supported).toBe(true);
    expect(added.note).toBe(NOTE_KAYNAKLI);
    expect(section(revised, EK_DOGRULAMA_SECTION_ID)!.paragraphs.some((p) => p.text.includes("m. 158"))).toBe(true);
  });

  it("entailment binding is refused without trust and recorded with trust", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    const aciklamalar = sections.find((s) => s.id === "aciklamalar")!;
    const legal = aciklamalar.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    legal.text = "Anlamsal özet: sentetik dolandırıcılık için hapis cezası öngörülür.";
    legal.binding = { kind: "entailment", score: 0.93, judge: "fake-judge" };

    const untrusted = reviseDraft(draft, { sections }, OPTS);
    const p1 = section(untrusted.draft, "aciklamalar")!.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    expect(p1.supported).toBe(false);
    expect(p1.evidenceIds).toEqual([]);
    expect(p1.binding).toBeUndefined();
    expect(untrusted.issues.some((i) => i.path.endsWith(".binding") && i.message.includes("entailment"))).toBe(true);

    const trusted = reviseDraft(draft, { sections }, { trustEntailment: true, now: NOW });
    const p2 = section(trusted.draft, "aciklamalar")!.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    expect(p2.supported).toBe(true);
    expect(p2.evidenceIds).toEqual(["ev-tck157"]);
    expect(p2.binding).toEqual({ kind: "entailment", score: 0.93, judge: "fake-judge" });
    expect(trusted.issues).toEqual([]);
    expect(trusted.draft.machineWarnings?.some((w) => w.includes("judge=fake-judge"))).toBe(true);
    expect(trusted.draft.warnings.some((w) => w.includes("sunucu tarafı yazıcı"))).toBe(true);
  });

  it("an out-of-range entailment score is refused even with trust", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    const legal = sections.find((s) => s.id === "aciklamalar")!.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    legal.text = "Özet metin.";
    legal.binding = { kind: "entailment", score: 1.7, judge: "j" };
    const { draft: revised, issues } = reviseDraft(draft, { sections }, { trustEntailment: true, now: NOW });
    expect(issues.some((i) => i.message.includes("geçersiz"))).toBe(true);
    expect(section(revised, "aciklamalar")!.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!.supported).toBe(false);
  });

  it("karşıt lock: contrary evidence is never bound under hukuki-sebepler or a legal role", () => {
    const draft = baseDraft();
    const sections = asPatchSections(draft);
    sections.find((s) => s.id === "hukuki-sebepler")!.paragraphs.push({
      text: `Dayanak: Yargıtay — "${QUOTE_KARSIT}"`,
      evidenceIds: ["ev-karsit"],
      role: "hukukiSebepler",
    });
    sections.find((s) => s.id === "aciklamalar")!.paragraphs.push({
      text: `Doğrulanmış kaynak uyarınca — "${QUOTE_KARSIT}"`,
      evidenceIds: ["ev-karsit"],
      role: "hukukiDegerlendirme",
    });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    const locked = issues.filter((i) => i.message.includes("aksi yönünde"));
    expect(locked).toHaveLength(2);
    for (const s of ["hukuki-sebepler", "aciklamalar"]) {
      for (const p of section(revised, s)!.paragraphs) expect(p.evidenceIds).not.toContain("ev-karsit");
    }
    // The contrary decision may still be QUOTED in the facts (non-legal role).
    const sections2 = asPatchSections(draft);
    sections2.find((s) => s.id === "aciklamalar")!.paragraphs.push({
      text: `4. Davalı, Yargıtay'ın "${QUOTE_KARSIT}" ifadesine dayanmaktadır.`,
      evidenceIds: ["ev-karsit"],
      role: "olaylar",
    });
    const quoted = reviseDraft(draft, { sections: sections2 }, OPTS);
    expect(quoted.issues).toEqual([]);
    expect(section(quoted.draft, "aciklamalar")!.paragraphs.some((p) => p.evidenceIds.includes("ev-karsit"))).toBe(true);
  });

  it("an uploaded exhibit can never back a legal role", () => {
    const draft = baseDraft();
    draft.evidence.push({
      evidenceId: "ev-up",
      label: "protokol.pdf",
      source: "UPLOAD",
      title: "protokol.pdf",
      quote: "Sentetik protokol metni 4. madde.",
      quoteSha256: "0".repeat(64),
      contentSha256: "1".repeat(64),
      fileId: "file-1",
      chunkId: "c1",
    });
    const sections = asPatchSections(draft);
    sections.find((s) => s.id === "aciklamalar")!.paragraphs.push({
      text: "Doğrulanmış kaynak uyarınca — Sentetik protokol metni 4. madde.",
      evidenceIds: ["ev-up"],
      role: "hukukiDegerlendirme",
    });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues.some((i) => i.message.includes("yüklenen bir belgedir"))).toBe(true);
    const p = section(revised, "aciklamalar")!.paragraphs[section(revised, "aciklamalar")!.paragraphs.length - 1]!;
    expect(p.supported).toBe(false);
    // Exhibits stay in the evidence list regardless.
    expect(revised.evidence.some((e) => e.evidenceId === "ev-up")).toBe(true);
  });
});

describe("reviseDraft — W12-FIX regressions (02.09.2026)", () => {
  it("keeps the server's own entailment binding on an UNTOUCHED paragraph re-sent as 'lexical'", () => {
    const base = baseDraft();
    const sections = asPatchSections(base);
    const aciklamalar = sections.find((s) => s.id === "aciklamalar")!;
    // Server-side writer (trusted) binds a paraphrase by entailment.
    aciklamalar.paragraphs.push({
      text: "Kanunun ilgili hükmü, dolandırıcılık suçunun ağırlaştırıcı hâllerini ayrıca düzenler.",
      evidenceIds: [tck158Evidence().evidenceId],
      role: "hukukiDegerlendirme",
      binding: { kind: "entailment", score: 0.91, judge: "test-judge" },
    });
    const trusted = reviseDraft(base, { sections }, { trustEntailment: true, now: NOW }).draft;
    const ai = section(trusted, "aciklamalar")!.paragraphs.find((p) => p.text.startsWith("Kanunun ilgili hükmü"))!;
    expect(ai.supported).toBe(true);
    expect(ai.binding).toEqual({ kind: "entailment", score: 0.91, judge: "test-judge" });

    // The console's Kaydet: every paragraph back with binding "lexical", the AI one untouched.
    const resent = asPatchSections(trusted).map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => ({ ...p, binding: "lexical" as const })),
    }));
    const saved = reviseDraft(trusted, { sections: resent }, OPTS);
    const kept = section(saved.draft, "aciklamalar")!.paragraphs.find((p) => p.id === ai.id)!;
    expect(kept.supported).toBe(true);
    expect(kept.evidenceIds).toEqual([tck158Evidence().evidenceId]);
    expect(kept.binding).toEqual({ kind: "entailment", score: 0.91, judge: "test-judge" });
    expect(kept.note).toBe(NOTE_KAYNAKLI);
    expect(saved.issues.filter((i) => i.path.endsWith(".binding"))).toEqual([]);

    // An EDITED AI paragraph is re-judged lexically (and fails: the quote is not in the text).
    const edited = asPatchSections(trusted).map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => (p.id === ai.id ? { ...p, text: p.text + " (düzenlendi)", binding: "lexical" as const } : p)),
    }));
    const reJudged = reviseDraft(trusted, { sections: edited }, OPTS);
    const demoted = section(reJudged.draft, "aciklamalar")!.paragraphs.find((p) => p.id === ai.id)!;
    expect(demoted.supported).toBe(false);
    expect(demoted.binding).toBeUndefined();
  });

  it("a beyan role inside HUKUKÎ SEBEPLER is forced to the legal role and marked KAYNAKSIZ (no laundering)", () => {
    const base = baseDraft();
    const sections = asPatchSections(base);
    const sebepler = sections.find((s) => s.id === "hukuki-sebepler")!;
    sebepler.paragraphs.push({
      text: "Davalı, TBK m.344 ve Yargıtay 3. HD 2019/1234 E. uyarınca kira bedelinden sorumludur.",
      evidenceIds: [],
      role: "olaylar",
      binding: "lexical",
    });
    const { draft, issues } = reviseDraft(base, { sections }, OPTS);
    const laundered = section(draft, "hukuki-sebepler")!.paragraphs.find((p) => p.text.startsWith("Davalı, TBK m.344"))!;
    expect(laundered.role).toBe("hukukiSebepler");
    expect(laundered.supported).toBe(false);
    expect(laundered.note).toBe(NOTE_KAYNAKSIZ);
    expect(issues.some((i) => i.path.endsWith(".role") && i.message.includes("bu bölümde kullanılamaz"))).toBe(true);
    expect(draft.unsupportedCount).toBe(base.unsupportedCount + 1);
  });

  it("an existing legal paragraph cannot be downgraded to a beyan role", () => {
    const base = baseDraft();
    const sections = asPatchSections(base);
    const aciklamalar = sections.find((s) => s.id === "aciklamalar")!;
    const assessment = aciklamalar.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    assessment.role = "olaylar";
    assessment.evidenceIds = [];
    const { draft, issues } = reviseDraft(base, { sections }, OPTS);
    const kept = section(draft, "aciklamalar")!.paragraphs.find((p) => p.id === assessment.id)!;
    expect(kept.role).toBe("hukukiDegerlendirme");
    expect(kept.supported).toBe(false);
    expect(kept.note).toBe(NOTE_KAYNAKSIZ);
    expect(issues.some((i) => i.message.includes("düşürülemez"))).toBe(true);
    // A mixed section still takes a genuine fact paragraph.
    const facts = asPatchSections(base);
    facts.find((s) => s.id === "aciklamalar")!.paragraphs.push({ text: "3. (10.02.2025) Davalı, ihtarnameyi tebellüğ etmiştir.", evidenceIds: [], role: "olaylar" });
    const withFact = reviseDraft(base, { sections: facts }, OPTS);
    expect(withFact.issues.some((i) => i.path.endsWith(".role"))).toBe(false);
  });
});

describe("reviseDraft — evidenceUse toggles", () => {
  it("true adds a HUKUKÎ SEBEPLER line for an unused entry; false removes it again", () => {
    const draft = baseDraft();
    const on = reviseDraft(draft, { sections: asPatchSections(draft), evidenceUse: { "ev-tck158": true } }, OPTS);
    expect(on.issues).toEqual([]);
    const sebepler = section(on.draft, "hukuki-sebepler")!.paragraphs;
    expect(sebepler.map((p) => p.evidenceIds)).toEqual([["ev-tck157"], ["ev-tck158"]]);
    expect(sebepler[1]!.text).toContain(QUOTE_TCK158);
    expect(sebepler[1]!.supported).toBe(true);
    expect(on.draft.unusedEvidence).toEqual([]);
    expect(on.draft.evidence.map((e) => e.evidenceId)).toContain("ev-tck158");

    const off = reviseDraft(on.draft, { sections: asPatchSections(on.draft), evidenceUse: { "ev-tck158": false } }, OPTS);
    expect(off.issues).toEqual([]);
    expect(section(off.draft, "hukuki-sebepler")!.paragraphs.map((p) => p.evidenceIds)).toEqual([["ev-tck157"]]);
    expect(off.draft.unusedEvidence.map((e) => e.evidenceId)).toEqual(["ev-tck158"]);
    expect(off.draft.version).toBe(3);
  });

  it("false keeps an entry that other paragraphs still cite, and says so", () => {
    const draft = baseDraft();
    const { draft: revised, issues } = reviseDraft(
      draft,
      { sections: asPatchSections(draft), evidenceUse: { "ev-tck157": false } },
      OPTS,
    );
    // The assessment paragraph still cites it -> stays in evidence.
    expect(revised.evidence.map((e) => e.evidenceId)).toContain("ev-tck157");
    expect(issues.some((i) => i.path === "evidenceUse.ev-tck157" && i.message.includes("hâlâ kullanılıyor"))).toBe(true);
    // The zorunlu sebepler slot got its loud placeholder back.
    const sebepler = section(revised, "hukuki-sebepler")!.paragraphs;
    expect(sebepler).toHaveLength(1);
    expect(sebepler[0]!.supported).toBe(false);
    expect(revised.unsupportedCount).toBe(1);
  });

  it("refuses to make a contrary decision or an upload a dayanak", () => {
    const draft = baseDraft();
    const patch: DraftPatch = { sections: asPatchSections(draft), evidenceUse: { "ev-karsit": true, "ev-yok": true } };
    const { draft: revised, issues } = reviseDraft(draft, patch, OPTS);
    expect(issues.map((i) => i.path).sort()).toEqual(["evidenceUse.ev-karsit", "evidenceUse.ev-yok"]);
    expect(section(revised, "hukuki-sebepler")!.paragraphs.every((p) => !p.evidenceIds.includes("ev-karsit"))).toBe(true);
  });
});

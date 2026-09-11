/**
 * Relevance gate (W12-FIX2, review P1-1b): a draft's HUKUKÎ SEBEPLER and
 * hukukî değerlendirme use only evidence relevant to the MATTER. Reproduces
 * reviewer R1's case — an S1 (TCK m.157) research seeding a kira cevap
 * dilekçesi — and pins the three rules: domain, lexical overlap, explicit
 * reference (never dropped). SENTETİK fixtures throughout.
 */

import { describe, expect, it } from "vitest";

import { composeDraft } from "../../src/drafting/composer.js";
import { resolveDraftEvidence } from "../../src/drafting/evidence.js";
import {
  assessEvidenceRelevance,
  domainsCompatible,
  evidenceDomain,
  relevanceWarning,
} from "../../src/drafting/relevance.js";
import { DRAFT_TEMPLATES, getTemplate } from "../../src/drafting/templates.js";
import { reviseDraft } from "../../src/drafting/revise.js";
import { EK_DOGRULAMA_SECTION_ID, KARSI_ICTIHAT_SECTION_ID, type Draft, type DraftMatter, type DraftRequest } from "../../src/drafting/types.js";
import { conflictedAnswer, karsitEvidence, kiraEvidence, tck158Evidence, tckEvidence, QUOTE_KIRA } from "./fixtures.js";

/** Reviewer R1's matter: a kira/tahliye cevap dilekçesi that never mentions criminal law. */
function kiraCevapMatter(overrides: Partial<DraftMatter> = {}): DraftMatter {
  return {
    mahkeme: "İzmir 2. Sulh Hukuk Mahkemesi",
    esasNo: "2026/412 E.",
    taraflar: [
      { ad: "Veli Kaya", rol: "Davalı" },
      { ad: "Ayşe Yılmaz", rol: "Davacı" },
    ],
    olaylar: [
      // No "sentetik" here on purpose: the fixture titles carry that word and
      // the overlap rule would read it as a shared content word.
      { tarih: "2025-02-01", metin: "Taraflar arasında bir konut kira sözleşmesi imzalanmıştır." },
      { tarih: "2026-01-15", metin: "Davacı kiraya veren, kira bedelinin ödenmediğini ileri sürerek tahliye ve tazminat istemiştir." },
    ],
    talepler: ["Haksız ve dayanaksız davanın reddine", "Yargılama giderleri ile vekâlet ücretinin davacıya yükletilmesine"],
    ekBilgiler: { konu: "Kira tahliye ve tazminat davasına cevaplarımız" },
    ...overrides,
  };
}

function cevapRequest(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return { kind: "dilekce", template: "cevap-dilekcesi", matter: kiraCevapMatter(), ...overrides };
}

function sebeplerIds(draft: Draft): string[] {
  return draft.sections
    .flatMap((s) => s.paragraphs)
    .filter((p) => p.role === "hukukiSebepler")
    .flatMap((p) => p.evidenceIds);
}

function degerlendirmeIds(draft: Draft): string[] {
  return draft.sections
    .flatMap((s) => s.paragraphs)
    .filter((p) => p.role === "hukukiDegerlendirme")
    .flatMap((p) => p.evidenceIds);
}

describe("template domains", () => {
  it("every template carries a domain; the icra itirazı is the only icra one", () => {
    for (const template of DRAFT_TEMPLATES) expect(template.domain).toBeDefined();
    expect(DRAFT_TEMPLATES.filter((t) => t.domain === "icra").map((t) => t.id)).toEqual(["icra-itiraz-dilekcesi"]);
    expect(getTemplate("cevap-dilekcesi")?.domain).toBe("ozel-hukuk");
    expect(getTemplate("kira-sozlesmesi")?.domain).toBe("ozel-hukuk");
  });
});

describe("evidenceDomain", () => {
  it("classifies by court first, then legislation number, then title, then source family", () => {
    expect(evidenceDomain(tckEvidence())).toBe("ceza");
    expect(evidenceDomain(karsitEvidence())).toBe("ceza");
    expect(evidenceDomain(kiraEvidence())).toBe("ozel-hukuk");
    expect(evidenceDomain({ legislationNo: "5271", title: "Ceza Muhakemesi Kanunu" })).toBe("ceza");
    expect(evidenceDomain({ legislationNo: "6100", title: "Hukuk Muhakemeleri Kanunu" })).toBe("ozel-hukuk");
    expect(evidenceDomain({ legislationNo: "4721", title: "Türk Medenî Kanunu" })).toBe("ozel-hukuk");
    expect(evidenceDomain({ legislationNo: "2577", title: "İdari Yargılama Usulü Kanunu" })).toBe("idare");
    expect(evidenceDomain({ legislationNo: "2004", title: "İcra ve İflas Kanunu" })).toBe("icra");
    expect(evidenceDomain({ court: "Yargıtay 3. Hukuk Dairesi", title: "x" })).toBe("ozel-hukuk");
    expect(evidenceDomain({ court: "Danıştay 13. Dairesi", title: "x" })).toBe("idare");
    expect(evidenceDomain({ court: "İstanbul Anadolu 5. İcra Hukuk Mahkemesi", title: "x" })).toBe("icra");
    expect(evidenceDomain({ court: "Anayasa Mahkemesi", title: "x" })).toBe("genel");
    expect(evidenceDomain({ source: "KVKK", title: "Kurul kararı" })).toBe("idare");
    expect(evidenceDomain({ legislationNo: "9999", title: "Bilinmeyen Kanun" })).toBe("genel");
  });

  it("compatibility: genel fits everything; icra accepts özel hukuk; ceza never fits özel hukuk", () => {
    expect(domainsCompatible("ozel-hukuk", "genel")).toBe(true);
    expect(domainsCompatible("ozel-hukuk", "ceza")).toBe(false);
    expect(domainsCompatible("icra", "ozel-hukuk")).toBe(true);
    expect(domainsCompatible("ceza", "ozel-hukuk")).toBe(false);
    expect(domainsCompatible("genel", "ceza")).toBe(true);
  });
});

describe("assessEvidenceRelevance", () => {
  it("referenced > domain > overlap; uploads are never gated; contrary follows a kept domain", () => {
    const unrelatedTbk = {
      ...kiraEvidence(),
      evidenceId: "ev-tbk-uzak",
      article: "1",
      quote: "Sözleşme, tarafların iradelerini karşılıklı ve birbirine uygun olarak açıklamalarıyla kurulur.",
    };
    const verdicts = assessEvidenceRelevance({
      templateDomain: "ozel-hukuk",
      matterText: "Kira bedeli ödenmedi; tahliye ve tazminat isteniyor.",
      entries: [
        tckEvidence(),
        kiraEvidence(),
        unrelatedTbk,
        karsitEvidence(),
        { ...kiraEvidence(), evidenceId: "ev-up", source: "UPLOAD", label: "belge.pdf", title: "belge.pdf" },
      ],
      referenced: () => false,
    });
    expect(verdicts.get("ev-tck157")?.verdict).toBe("DOMAIN_MISMATCH");
    expect(verdicts.get("ev-kira")?.verdict).toBe("relevant");
    expect(verdicts.get("ev-kira")?.overlap).toContain("kira");
    expect(verdicts.get("ev-tbk-uzak")?.verdict).toBe("NOT_RELEVANT");
    // The contrary criminal decision has no kept criminal sibling: parked.
    expect(verdicts.get("ev-karsit")?.verdict).toBe("DOMAIN_MISMATCH");
    expect(verdicts.has("ev-up")).toBe(false);

    const named = assessEvidenceRelevance({
      templateDomain: "ozel-hukuk",
      matterText: "TCK m. 157 anlamında dolandırıcılık",
      entries: [tckEvidence(), karsitEvidence()],
      referenced: (entry) => entry.evidenceId === "ev-tck157",
    });
    expect(named.get("ev-tck157")?.verdict).toBe("referenced");
    // ... and now the contrary decision opposes something the document relies on.
    expect(named.get("ev-karsit")?.verdict).toBe("relevant");
  });

  it("is deterministic and writes one Turkish sentence without ids or enums", () => {
    const a = assessEvidenceRelevance({ templateDomain: "ozel-hukuk", matterText: "kira", entries: [tckEvidence(), kiraEvidence()], referenced: () => false });
    const b = assessEvidenceRelevance({ templateDomain: "ozel-hukuk", matterText: "kira", entries: [tckEvidence(), kiraEvidence()], referenced: () => false });
    expect([...a.entries()]).toEqual([...b.entries()]);
    const sentence = relevanceWarning("ozel-hukuk", 2, 1);
    expect(sentence).toContain("2 kaynak bu belgenin hukuk alanıyla (özel hukuk) örtüşmediği için");
    expect(sentence).toContain("1 kaynak talep/olay metniyle hiçbir ortak sözcük taşımadığı için");
    expect(sentence).not.toMatch(/ev-|DOMAIN_MISMATCH|NOT_RELEVANT/u);
  });
});

describe("composeDraft — the S1 research seeding a kira cevap dilekçesi (R1)", () => {
  it("a pinned TCK provision never becomes a Dayanak or a değerlendirme of a hukuk davası dilekçesi", async () => {
    // The stored S1-like answer: TCK m.157 pinned + a contrary ceza decision.
    const answer = conflictedAnswer();
    answer.result = {
      ...answer.result,
      evidence: answer.result.evidence.map((e) => (e.evidenceId === "ev-tck157" ? { ...e, retrieval: { pinned: true } } : e)),
    };
    const resolved = await resolveDraftEvidence({ runId: "run-s1" }, { answers: { get: () => answer } });
    expect(resolved.pack?.claims.map((c) => c.claimId)).toEqual(["claim-ev-tck157", "claim-celiskili"]);

    const draft = composeDraft(cevapRequest(), resolved.pack);
    expect(sebeplerIds(draft)).toEqual([]);
    expect(degerlendirmeIds(draft)).toEqual([]);
    expect(draft.sections.find((s) => s.id === KARSI_ICTIHAT_SECTION_ID)).toBeUndefined();
    const body = draft.sections
      .filter((s) => s.id !== EK_DOGRULAMA_SECTION_ID)
      .flatMap((s) => s.paragraphs.map((p) => p.text))
      .join("\n");
    expect(body).not.toMatch(/5237|Ceza Kanunu|TCK/u);
    expect(draft.evidence).toEqual([]);
    expect(draft.unusedEvidence.map((e) => [e.evidenceId, e.unusedReason])).toEqual([
      ["ev-tck157", "DOMAIN_MISMATCH"],
      ["ev-karsit", "DOMAIN_MISMATCH"],
    ]);
    expect(draft.machineWarnings).toEqual(
      expect.arrayContaining(["DOMAIN_MISMATCH:ev-tck157", "DOMAIN_MISMATCH:ev-karsit"]),
    );
    expect(draft.machineWarnings?.some((w) => w.startsWith("claim-ev-tck157:") && w.includes("DOMAIN_MISMATCH"))).toBe(true);
    // The legal slots fall back to the loud KAYNAKSIZ placeholders, not silence.
    expect(draft.unsupportedCount).toBeGreaterThan(0);
    expect(draft.warnings.some((w) => w.includes("2 kaynak bu belgenin hukuk alanıyla (özel hukuk) örtüşmediği için"))).toBe(true);
    expect(draft.warnings.some((w) => w.startsWith("2 doğrulanmış kaynak taslakta kullanılmadı"))).toBe(false);
  });

  it("the same source IS used when the talepler/olaylar name it (never drop what the lawyer references)", async () => {
    const resolved = await resolveDraftEvidence({ runId: "run-s1" }, { answers: { get: () => conflictedAnswer() } });
    const draft = composeDraft(
      cevapRequest({
        matter: kiraCevapMatter({
          talepler: ["Davacının TCK m. 157 kapsamında dolandırıcılık iddiasının reddine"],
        }),
      }),
      resolved.pack,
    );
    expect(sebeplerIds(draft)).toEqual(["ev-tck157"]);
    expect(degerlendirmeIds(draft)).toContain("ev-tck157");
    expect(draft.sections.find((s) => s.id === KARSI_ICTIHAT_SECTION_ID)?.paragraphs[0]?.evidenceIds).toEqual(["ev-karsit"]);
    expect(draft.unusedEvidence).toEqual([]);
    expect(draft.machineWarnings ?? []).not.toContain("DOMAIN_MISMATCH:ev-tck157");
  });

  it("an in-domain source with no shared word is NOT_RELEVANT; one sharing a word stays usable", () => {
    const far = {
      ...kiraEvidence(),
      evidenceId: "ev-tbk-uzak",
      article: "1",
      quote: "Bir kimse iradesini açıklarken hata yaptığında bağlanmaz.",
    };
    const pack = {
      claims: [
        { claimId: "c-kira", text: `${kiraEvidence().label}: "${QUOTE_KIRA}"`, evidenceIds: ["ev-kira"] },
        { claimId: "c-uzak", text: `${far.label}: "${far.quote}"`, evidenceIds: ["ev-tbk-uzak"] },
      ],
      evidence: [kiraEvidence(), far, tck158Evidence()],
      synthetic: true,
    };
    const draft = composeDraft(cevapRequest(), pack);
    expect(degerlendirmeIds(draft)).toEqual(["ev-kira"]);
    expect(sebeplerIds(draft)).toEqual(["ev-kira"]);
    expect(draft.unusedEvidence.map((e) => [e.evidenceId, e.unusedReason])).toEqual([
      ["ev-tbk-uzak", "NOT_RELEVANT"],
      ["ev-tck158", "DOMAIN_MISMATCH"],
    ]);
    expect(draft.machineWarnings).toEqual(expect.arrayContaining(["NOT_RELEVANT:ev-tbk-uzak", "DOMAIN_MISMATCH:ev-tck158"]));
  });

  it("the lawyer can force a parked source in with evidenceUse:true (the gate is an override-able filter)", async () => {
    const resolved = await resolveDraftEvidence({ runId: "run-s1" }, { answers: { get: () => conflictedAnswer() } });
    const draft = composeDraft(cevapRequest(), resolved.pack);
    expect(draft.unusedEvidence.find((e) => e.evidenceId === "ev-tck157")?.unusedReason).toBe("DOMAIN_MISMATCH");
    const sections = draft.sections
      .filter((s) => s.id !== EK_DOGRULAMA_SECTION_ID)
      .map((s) => ({ id: s.id, paragraphs: s.paragraphs.map((p) => ({ id: p.id, text: p.text, evidenceIds: [...p.evidenceIds], role: p.role })) }));
    const revised = reviseDraft(draft, { sections, evidenceUse: { "ev-tck157": true } }, { trustEntailment: false, now: () => new Date("2026-09-02T12:00:00.000Z") });
    expect(sebeplerIds(revised.draft)).toEqual(["ev-tck157"]);
    const used = revised.draft.evidence.find((e) => e.evidenceId === "ev-tck157");
    expect(used).toBeDefined();
    expect(used?.unusedReason).toBeUndefined();
    // The contrary decision stays parked with its reason until the lawyer pulls it in too.
    expect(revised.draft.unusedEvidence.map((e) => [e.evidenceId, e.unusedReason])).toEqual([["ev-karsit", "DOMAIN_MISMATCH"]]);
  });
});

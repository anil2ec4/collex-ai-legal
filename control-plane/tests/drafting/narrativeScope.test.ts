/**
 * W16 şerit E — olay anlatısı, dayanak kapsamı ve hukukî mütalaa şablonu.
 *
 * Üç davranış ölçülüyor; üçü de ürünün dürüstlük sözleşmesinin parçası:
 *
 *  1. Avukatın kendi anlattığı olay, belgeye BEYAN olarak girer. Hiçbir
 *     koşulda `supported:true` olmaz ve hiçbir koşulda bir Dayanak üretmez
 *     (ADR-021). Rakip ürün yüklenen evrakı doğrudan hukukî değerlendirmeye
 *     karıştırdığını kendi sayfasında yazıyor; bizim ayrımımız burada test
 *     edilir.
 *  2. Dayanak kapsamı (Kısa / Geniş) DOĞRULAMAYI değiştirmez. Rakip "normal /
 *     uzun metin" satıyor; bizim seçimimiz metnin uzunluğunu değil kaynak
 *     kümesini etkiler ve alıntı bütünlüğü her iki kipte aynıdır.
 *  3. Hukukî mütalaanın aleyhe bölümü BOŞ BIRAKILAMAZ. Aleyhe kaynak yoksa
 *     sabit cümle yazılır ve o cümle "arşivde yok" demez — yalnız bu belgeye
 *     bağlanan kaynaklara bakıldığını söyler.
 */

import { describe, expect, it } from "vitest";

import { composeDraft } from "../../src/drafting/composer.js";
import {
  KAPSAM_GENIS,
  KAPSAM_KEY,
  KAPSAM_KISA,
  KAPSAM_SABIT_CUMLE,
  OLAY_ANLATISI_KEY,
  getTemplate,
} from "../../src/drafting/templates.js";
import {
  ALEYHE_KAYNAK_YOK_TEXT,
  KAYNAKSIZ_PREFIX,
  NOTE_OLAY_ANLATISI,
} from "../../src/drafting/types.js";
import type { DraftParagraph } from "../../src/drafting/types.js";

import { davaMatter, davaRequest, karsitEvidence, tckEvidence, tckPack } from "./fixtures.js";

const NARRATIVE = [
  "Müvekkil ile davalı arasında 10.03.2025 tarihinde sözlü bir anlaşma yapılmıştır.",
  "",
  "05.01.2025 tarihinde davalı, müvekkile yatırım vaadinde bulunmuş ve bedeli tahsil etmiştir.",
  "",
  "Bugüne kadar hiçbir ödeme yapılmamış, davalıya ulaşılamamıştır.",
].join("\n");

function allParagraphs(sections: readonly { paragraphs: readonly DraftParagraph[] }[]): DraftParagraph[] {
  return sections.flatMap((s) => [...s.paragraphs]);
}

function narrativeRequest(extra: Record<string, string> = {}) {
  return davaRequest({
    matter: davaMatter({
      ekBilgiler: { [OLAY_ANLATISI_KEY]: NARRATIVE, ...extra },
    }),
  });
}

describe("W16 · olay anlatısı is the lawyer's own statement, never a Dayanak", () => {
  it("offers the narrative template field on the petition templates", () => {
    // Template fields are addressed by their request PATH, not a bare key.
    const alan = getTemplate("dava-dilekcesi")!.fields.find(
      (f) => f.path === `matter.ekBilgiler.${OLAY_ANLATISI_KEY}`,
    );
    expect(alan, "dava dilekçesi olay anlatısı alanını taşımalı").toBeDefined();
    expect(alan!.required).toBe(false);
  });

  it("writes every narrative paragraph as beyan: supported:false, no evidence, marked note", () => {
    const draft = composeDraft(narrativeRequest(), tckPack());
    const narrative = allParagraphs(draft.sections).filter((p) => p.note === NOTE_OLAY_ANLATISI);
    expect(narrative.length).toBeGreaterThan(0);
    for (const p of narrative) {
      expect(p.supported, p.id).toBe(false);
      expect(p.evidenceIds, p.id).toEqual([]);
    }
  });

  it("never lets the narrative become a hukukî değerlendirme paragraph", () => {
    const draft = composeDraft(narrativeRequest(), tckPack());
    const legal = allParagraphs(draft.sections).filter((p) => p.role === "hukukiDegerlendirme");
    for (const p of legal) {
      expect(p.note, p.id).not.toBe(NOTE_OLAY_ANLATISI);
      // The narrative text itself may not be carried into a bound assessment.
      expect(p.text.includes("yatırım vaadinde bulunmuş ve bedeli tahsil etmiştir")).toBe(false);
    }
  });

  it("offers the dated narrative sentences as suggestions, never as inserted prose", () => {
    const draft = composeDraft(narrativeRequest(), tckPack());
    const fromNarrative = draft.suggestedFacts.filter((f) => f.kaynak === "olay-anlatisi");
    expect(fromNarrative.length).toBeGreaterThanOrEqual(2);
    for (const fact of fromNarrative) {
      // GG.AA.YYYY on screen; and a suggestion has no file/passage provenance
      // because an account has neither — a made-up one is worse than none.
      expect(fact.tarih).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
      expect(fact.fileId).toBeUndefined();
      expect(fact.chunkId).toBeUndefined();
    }
  });

  it("marks the narrative paragraphs KAYNAKSIZ in the rendered draft, like any unbound prose", () => {
    const draft = composeDraft(narrativeRequest(), tckPack());
    const narrative = allParagraphs(draft.sections).find((p) => p.note === NOTE_OLAY_ANLATISI);
    expect(narrative).toBeDefined();
    expect(draft.unsupportedCount).toBeGreaterThan(0);
    // The prefix is applied by the renderer, not stored in the paragraph text;
    // what the composer owes is the honest flag, checked above.
    expect(narrative!.text.startsWith(KAYNAKSIZ_PREFIX)).toBe(false);
  });

  it("offers the field only where the template declares it", () => {
    // A contract form never asked for an account, so it must not silently
    // grow one: the field's ABSENCE from the form is what the composer reads.
    const sozlesme = getTemplate("hizmet-sozlesmesi")!;
    expect(
      sozlesme.fields.some((f) => f.path === `matter.ekBilgiler.${OLAY_ANLATISI_KEY}`),
      "hizmet sözleşmesi olay anlatısı alanı taşımamalı",
    ).toBe(false);
  });
});

describe("W16 · dayanak kapsamı changes the SOURCES, never the verification", () => {
  it("names the honest sentence and repeats it when a scope was chosen", () => {
    expect(KAPSAM_SABIT_CUMLE).toContain("daha çok KAYNAK");
    expect(KAPSAM_SABIT_CUMLE).toContain("daha çok CÜMLE demek değildir");
    const draft = composeDraft(narrativeRequest({ [KAPSAM_KEY]: KAPSAM_GENIS }), tckPack());
    expect(draft.warnings.some((w) => w.includes(KAPSAM_SABIT_CUMLE))).toBe(true);
  });

  it("keeps quote binding and the unsupported count identical in both scopes", () => {
    const kisa = composeDraft(narrativeRequest({ [KAPSAM_KEY]: KAPSAM_KISA }), tckPack());
    const genis = composeDraft(narrativeRequest({ [KAPSAM_KEY]: KAPSAM_GENIS }), tckPack());

    const bound = (d: typeof kisa): string[] =>
      allParagraphs(d.sections)
        .filter((p) => p.evidenceIds.length > 0)
        .map((p) => `${p.role}:${p.evidenceIds.join(",")}`)
        .sort();

    // Same sources bound the same way, and the same paragraphs left unbound:
    // the switch may widen what is OFFERED, never loosen what is CHECKED.
    expect(bound(genis)).toEqual(bound(kisa));
    expect(genis.unsupportedCount).toBe(kisa.unsupportedCount);
    expect(genis.evidence.map((e) => e.quoteSha256).sort()).toEqual(
      kisa.evidence.map((e) => e.quoteSha256).sort(),
    );
  });

  it("treats an unrecognized scope as the narrow one and SAYS so", () => {
    const draft = composeDraft(narrativeRequest({ [KAPSAM_KEY]: "çok uzun" }), tckPack());
    expect(draft.warnings.some((w) => w.includes("anlaşılmadı") && w.includes("kısa kapsam"))).toBe(true);
  });
});

describe("W16 · hukukî mütalaa: the aleyhe section can never be empty", () => {
  function mutalaaRequest() {
    return davaRequest({
      template: "hukuki-mutalaa",
      matter: davaMatter({
        ekBilgiler: {
          [OLAY_ANLATISI_KEY]: NARRATIVE,
          // The mütalaa form asks what the müvekkil actually wants answered.
          soru: "Davalıya karşı açılacak davanın hukukî dayanağı nedir?",
        },
      }),
    });
  }

  it("is registered as the fourteenth template", () => {
    const tpl = getTemplate("hukuki-mutalaa");
    expect(tpl).toBeDefined();
    expect(tpl!.kind).toBe("dilekce");
  });

  it("writes the fixed sentence when no contrary source is bound to the draft", () => {
    const draft = composeDraft(mutalaaRequest(), tckPack({ evidence: [tckEvidence()] }));
    const texts = allParagraphs(draft.sections).map((p) => p.text);
    expect(texts).toContain(ALEYHE_KAYNAK_YOK_TEXT);
  });

  it("says absence is not proof — never 'there is no contrary authority'", () => {
    expect(ALEYHE_KAYNAK_YOK_TEXT).toContain("anlamına gelmez");
    expect(ALEYHE_KAYNAK_YOK_TEXT).toContain("yalnızca bu belgeye");
    // It must not claim an archive search happened.
    expect(ALEYHE_KAYNAK_YOK_TEXT).not.toMatch(/arşivde .* yoktur/u);
  });

  it("writes the real contrary sources when the pack has one, and drops the fixed sentence", () => {
    const draft = composeDraft(
      mutalaaRequest(),
      tckPack({ evidence: [tckEvidence(), karsitEvidence()] }),
    );
    const contrary = allParagraphs(draft.sections).filter((p) => p.role === "karsiIctihat");
    expect(contrary.length).toBeGreaterThan(0);
    expect(contrary.map((p) => p.text)).not.toContain(ALEYHE_KAYNAK_YOK_TEXT);
    expect(contrary.some((p) => p.evidenceIds.length > 0)).toBe(true);
  });
});

/**
 * Template registry completeness (W12: 13 templates; W16 added the 14th,
 * hukukî mütalaa): kinds, lawyer-usable
 * metadata, typed console fields, requiredFields enforcement — and every
 * template composes with minimal valid input into clean text (no
 * `undefined`, no `[object Object]`, no machine placeholder).
 */

import { describe, expect, it } from "vitest";

import {
  DRAFT_TEMPLATES,
  FIELD_GROUPS,
  getTemplate,
  labelForPath,
  validateRequiredFields,
} from "../../src/drafting/templates.js";
import { composeDraft, DraftValidationError } from "../../src/drafting/composer.js";
import { renderDraftMarkdown } from "../../src/drafting/markdown.js";
import { DRAFT_REVIEW_BANNER } from "../../src/drafting/types.js";
import { ALL_TEMPLATE_IDS, davaRequest, hizmetRequest, minimalRequestFor } from "./fixtures.js";

const EXPECTED_IDS: [string, string][] = [
  ["dava-dilekcesi", "dilekce"],
  ["cevap-dilekcesi", "dilekce"],
  ["istinaf-basvuru", "dilekce"],
  ["temyiz-dilekcesi", "dilekce"],
  ["ihtarname", "dilekce"],
  ["icra-itiraz-dilekcesi", "dilekce"],
  ["arabuluculuk-basvurusu", "dilekce"],
  ["hizmet-sozlesmesi", "sozlesme"],
  ["kira-sozlesmesi", "sozlesme"],
  ["tahliye-taahhutnamesi", "sozlesme"],
  ["is-sozlesmesi", "sozlesme"],
  ["satis-sozlesmesi", "sozlesme"],
  ["vekalet-ucret-sozlesmesi", "sozlesme"],
  // W16: 14. şablon — müvekkile yazılı görüş. Ürünün zorunlu aleyhe
  // değerlendirmesiyle en doğal eşleşen belge türü.
  ["hukuki-mutalaa", "dilekce"],
];

const FIELD_KINDS = new Set(["text", "list", "party-list", "event-list", "date", "number", "select"]);

describe("template registry (14 templates)", () => {
  it("carries exactly the fourteen templates with the right kinds, the original five first", () => {
    expect(DRAFT_TEMPLATES.map((t) => [t.id, t.kind])).toEqual(EXPECTED_IDS);
    expect(ALL_TEMPLATE_IDS).toHaveLength(14);
  });

  it("every template is fully described and structurally complete", () => {
    for (const template of DRAFT_TEMPLATES) {
      expect(template.title.length).toBeGreaterThan(3);
      expect(template.description.length).toBeGreaterThan(40);
      expect(template.requiredFields.length).toBeGreaterThan(0);
      expect(template.sections.length).toBeGreaterThanOrEqual(5);
      for (const section of template.sections) {
        expect(section.slots.length).toBeGreaterThan(0);
      }
      // Every template carries a signature block, and nothing that belongs to
      // the document itself comes after it. W14 (B-25 / W13-COPY L26): the
      // only section allowed below the signature is the annex of machine
      // legal notes, whose heading says it is not part of the document.
      const imzaIndex = template.sections.findIndex((s) => s.slots.some((slot) => slot.kind === "imza"));
      expect(imzaIndex, template.id).toBeGreaterThanOrEqual(0);
      for (const section of template.sections.slice(imzaIndex + 1)) {
        expect(section.id, `${template.id}: ${section.id} after imza`).toBe("dayanak");
        expect(section.title).toContain("PARÇASI DEĞİLDİR");
      }
    }
  });

  it("B-25/L26: the signature block comes BEFORE the machine legal notes in every contract", () => {
    for (const template of DRAFT_TEMPLATES) {
      const dayanak = template.sections.findIndex((s) => s.id === "dayanak");
      if (dayanak < 0) continue;
      const imza = template.sections.findIndex((s) => s.slots.some((slot) => slot.kind === "imza"));
      expect(imza, `${template.id}: imza index`).toBeGreaterThanOrEqual(0);
      expect(imza, `${template.id}: parties must not sign under machine notes`).toBeLessThan(dayanak);
      expect(template.sections[dayanak]!.title).toBe(
        "EK — HUKUKÎ DAYANAK NOTLARI (SÖZLEŞMENİN PARÇASI DEĞİLDİR; İMZAYA GİRMEZ)",
      );
    }
  });

  // W16: the rule is not "court petition" but "the legal assessment IS the
  // document". A hukukî mütalaa is exactly that — the müvekkil is paying for
  // the assessment — so it joins the four petitions rather than the notices
  // and contracts, where a legal assessment is optional apparatus.
  const ASSESSMENT_IS_THE_DOCUMENT = [
    "dava-dilekcesi",
    "cevap-dilekcesi",
    "istinaf-basvuru",
    "temyiz-dilekcesi",
    "hukuki-mutalaa",
  ];

  it("documents whose assessment IS the document carry the legal slots as zorunlu; notices/contracts keep them optional", () => {
    for (const id of ASSESSMENT_IS_THE_DOCUMENT) {
      const slots = getTemplate(id)!.sections.flatMap((s) => s.slots);
      expect(slots.find((s) => s.kind === "hukukiDegerlendirme")?.zorunlu, id).toBe(true);
      expect(slots.find((s) => s.kind === "hukukiSebepler")?.zorunlu, id).toBe(true);
    }
    for (const template of DRAFT_TEMPLATES) {
      if (ASSESSMENT_IS_THE_DOCUMENT.includes(template.id)) continue;
      for (const slot of template.sections.flatMap((s) => s.slots)) {
        if (slot.kind === "hukukiDegerlendirme" || slot.kind === "hukukiSebepler") {
          expect(slot.zorunlu, `${template.id}`).toBe(false);
        }
      }
    }
  });

  it("every template carries typed, grouped, human-labeled fields covering its requiredFields", () => {
    const groups = new Set<string>(Object.values(FIELD_GROUPS));
    for (const template of DRAFT_TEMPLATES) {
      expect(template.fields.length).toBeGreaterThan(0);
      for (const required of template.requiredFields) {
        const field = template.fields.find((f) => f.path === `matter.${required}`);
        expect(field, `${template.id}: field for ${required} missing`).toBeDefined();
        expect(field!.required).toBe(true);
      }
      const paths = new Set<string>();
      for (const field of template.fields) {
        expect(field.path.startsWith("matter.")).toBe(true);
        expect(paths.has(field.path), `${template.id}: duplicate ${field.path}`).toBe(false);
        paths.add(field.path);
        expect(field.label).not.toMatch(/ekBilgiler|matter\./);
        expect(field.label.length).toBeGreaterThan(2);
        expect(field.group !== undefined && groups.has(field.group), `${template.id}: ${field.path} group`).toBe(true);
        if (field.kind !== undefined) expect(FIELD_KINDS.has(field.kind)).toBe(true);
        if (field.kind === "select") expect(field.options?.length ?? 0).toBeGreaterThan(1);
        if (field.kind === "list") expect(field.multiline).toBe(true);
      }
      // Party input is always a party-list; a dilekçe always has vekil fields.
      expect(template.fields.find((f) => f.path === "matter.taraflar")?.kind).toBe("party-list");
      if (template.kind === "dilekce") {
        expect(template.fields.some((f) => f.path === "matter.vekil.ad")).toBe(true);
      }
    }
  });

  it("clauses reference the governing provisions in text (references, not verified law)", () => {
    const clauseText = (id: string): string =>
      getTemplate(id)!.sections.flatMap((s) => s.slots.map((slot) => slot.text ?? "")).join("\n");
    expect(clauseText("kira-sozlesmesi")).toContain("TBK m.344");
    expect(clauseText("kira-sozlesmesi")).toContain("TBK m.352/1");
    expect(clauseText("is-sozlesmesi")).toContain("İş K. m.17");
    expect(clauseText("vekalet-ucret-sozlesmesi")).toContain("Avukatlık K. m.164");
    expect(clauseText("icra-itiraz-dilekcesi")).toContain("İİK m.62");
    expect(clauseText("temyiz-dilekcesi")).toContain("HMK m.361");
    expect(clauseText("tahliye-taahhutnamesi")).toContain("TBK m.352/1");
    expect(clauseText("satis-sozlesmesi")).toContain("TBK m.208");
    expect(clauseText("arabuluculuk-basvurusu")).toContain("m.18/A");
    expect(clauseText("ihtarname")).toContain("TBK m.117");
  });

  it("all 14 templates compose with minimal valid input into clean text", () => {
    for (const id of ALL_TEMPLATE_IDS) {
      const draft = composeDraft(minimalRequestFor(id), undefined, {
        now: () => new Date("2026-09-02T09:00:00.000Z"),
      });
      expect(draft.template).toBe(id);
      expect(draft.warnings[0]).toBe(DRAFT_REVIEW_BANNER);
      expect(draft.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of draft.sections) {
        for (const p of section.paragraphs) {
          expect(p.text, `${id}/${p.id}`).not.toContain("undefined");
          expect(p.text, `${id}/${p.id}`).not.toContain("[object Object]");
          expect(p.text, `${id}/${p.id}`).not.toContain("TAMAMLANACAK");
          expect(p.text, `${id}/${p.id}`).not.toMatch(/\{[a-zA-Z]+\}/u);
          expect(p.text, `${id}/${p.id}`).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
          expect(p.text.trim(), `${id}/${p.id}`).not.toBe("");
        }
      }
      // A signature block with a GG.AA.YYYY date is always present.
      const last = draft.sections[draft.sections.length - 1]!;
      expect(last.paragraphs.some((p) => p.text.includes("02.09.2026"))).toBe(true);
      // The Markdown renderer accepts every draft.
      const md = renderDraftMarkdown(draft);
      expect(md.split("\n")[0]).toBe(DRAFT_REVIEW_BANNER);
      expect(md).not.toContain("undefined");
    }
  });

  it("istinaf karar field carries the künye-format label lawyers can follow", () => {
    const istinaf = getTemplate("istinaf-basvuru")!;
    const karar = istinaf.fields.find((f) => f.path === "matter.ekBilgiler.karar");
    expect(karar?.label).toBe("İstinafa konu karar (Mahkeme, E. .../..., K. .../..., T. ...)");
    expect(karar?.required).toBe(true);
  });

  // -------------------------------------------------------------- W14 B-25
  // Legal-content corrections from W13-COPY L5–L28. Each assertion is one
  // defect a lawyer would otherwise sign or file.

  const clauseText = (id: string): string =>
    getTemplate(id)!.sections.flatMap((s) => s.slots.map((slot) => slot.text ?? "")).join("\n");
  const fieldText = (id: string): string =>
    getTemplate(id)!
      .fields.map((f) => `${f.label} ${f.placeholder ?? ""} ${f.help ?? ""} ${(f.options ?? []).join(" ")}`)
      .join("\n");
  const allText = (id: string): string => `${getTemplate(id)!.description}\n${clauseText(id)}\n${fieldText(id)}`;

  it("L5/L6/L7: the TBK m.352/1 one-month hak düşürücü süre is in the tahliye and kira templates", () => {
    const tahliye = allText("tahliye-taahhutnamesi");
    expect(tahliye).toContain("BİR AY İÇİNDE");
    expect(tahliye).toContain("TBK m.352/1");
    expect(clauseText("kira-sozlesmesi")).toContain("BİR AY İÇİNDE");
  });

  it("L5: 'el yazısı' is no longer taught as a validity condition — TBK m.352/1 says YAZILI", () => {
    const tahliye = allText("tahliye-taahhutnamesi");
    expect(tahliye).not.toContain("el yazısı/imzasıyla");
    expect(tahliye).toContain("YAZILI");
    expect(getTemplate("tahliye-taahhutnamesi")!.description).toContain(
      "el yazısı kanunda aranan bir geçerlilik şartı değildir",
    );
  });

  it("L8/L9/L10: TBK m.344 is 'değişim oranı', covers çatılı işyeri, and m.344/3 is present", () => {
    const kira = clauseText("kira-sozlesmesi");
    expect(kira).toContain("DEĞİŞİM ORANINI");
    expect(kira).toContain("Konut ve çatılı işyeri kiralarında");
    expect(kira).toContain("TBK m.344/3");
    expect(kira).toContain("HÂKİM");
    // The old, wrong formulation must be gone from clause and field text.
    expect(allText("kira-sozlesmesi")).not.toContain("ortalamasını aşamaz");
    expect(allText("kira-sozlesmesi")).not.toContain("konutlarda artış");
  });

  it("L11: TBK m.347's fifteen-day notice and ten-year termination right are stated", () => {
    const kira = clauseText("kira-sozlesmesi");
    expect(kira).toContain("EN AZ ON BEŞ GÜN ÖNCE");
    expect(kira).toContain("ON YILLIK UZAMA SÜRESİ SONUNDA");
    expect(kira).toContain("üç ay önce");
    expect(kira).toContain("TBK m.347/1");
  });

  it("L12/L13/L14: Av.K. m.164/2 caps only the NİSPİ fee, and m.164/son is quoted correctly", () => {
    const vekalet = allText("vekalet-ucret-sozlesmesi");
    expect(vekalet).toContain("BELLİ BİR YÜZDESİ");
    expect(vekalet).toContain("m.163/2");
    expect(vekalet).toContain("İŞ SAHİBİNİN BORCU");
    expect(vekalet).toContain("m.164/3");
    // The reversed reading ("no fee may exceed 25% of the case value") is gone.
    expect(vekalet).not.toContain("değerinin yüzde yirmi beşini aşamaz");
    expect(vekalet).not.toContain("dava değerinin %25'ini aşamaz;");
    // And the contractual choice is no longer presented as a rule of law.
    expect(clauseText("vekalet-ucret-sozlesmesi")).not.toContain(
      "bu tutar, kararlaştırılan ücretten mahsup edilmez",
    );
  });

  it("L15: FSEK m.52 requires the transferred rights to be listed one by one", () => {
    const hizmet = allText("hizmet-sozlesmesi");
    expect(hizmet).toContain("AYRI AYRI GÖSTERİLMESİ");
    expect(hizmet).toContain("FSEK m.52");
    for (const article of ["m.21", "m.22", "m.23", "m.24", "m.25"]) {
      expect(clauseText("hizmet-sozlesmesi"), article).toContain(article);
    }
  });

  it("L16: the three mandatory İş K. m.41 numbers are in the iş sözleşmesi", () => {
    const isSozlesme = clauseText("is-sozlesmesi");
    expect(isSozlesme).toContain("BİR SAAT OTUZ DAKİKA");
    expect(isSozlesme).toContain("ALTI AY");
    expect(isSozlesme).toContain("İKİ YÜZ YETMİŞ SAATİ");
    // m.41 requires the worker's consent, not a WRITTEN consent.
    expect(isSozlesme).toContain("İŞÇİNİN ONAYI");
    expect(isSozlesme).not.toContain("işçinin yazılı onayı gerekir");
  });

  it("L17: the hizmet template no longer classes itself under TBK m.393 (iş sözleşmesi)", () => {
    const description = getTemplate("hizmet-sozlesmesi")!.description;
    expect(description).toContain("TBK m.502 vd.");
    expect(description).toContain("m.470 vd.");
    expect(description).toContain("iş sözleşmesi sayılabilir");
    expect(description).not.toContain("(TBK m.393 vd. /");
  });

  it("L20/L21/L22: istinaf and temyiz carry KARARIN ÖZETİ and a required tebliğ tarihi", () => {
    for (const [id, article] of [
      ["istinaf-basvuru", "m.342/2-d"],
      ["temyiz-dilekcesi", "m.364/2-e"],
    ] as const) {
      const template = getTemplate(id)!;
      const section = template.sections.find((s) => s.id === "karar-ozeti");
      expect(section, `${id}: karar-ozeti section`).toBeDefined();
      expect(section!.title).toBe("KARARIN ÖZETİ");
      const ozet = template.fields.find((f) => f.path === "matter.ekBilgiler.kararOzeti");
      expect(ozet, `${id}: kararOzeti field`).toBeDefined();
      expect(ozet!.required).toBe(true);
      expect(ozet!.help).toContain(article);

      const teblig = template.fields.find((f) => f.path === "matter.ekBilgiler.tebligTarihi")!;
      expect(teblig.required, `${id}: tebligTarihi required`).toBe(true);
      expect(template.requiredFields).toContain("ekBilgiler.tebligTarihi");
    }
  });

  it("L19: the temyiz künye help cites HMK m.364/2-c, not m.364/1-c", () => {
    const help = getTemplate("temyiz-dilekcesi")!.fields.find(
      (f) => f.path === "matter.ekBilgiler.karar",
    )!.help!;
    expect(help).toContain("m.364/2-c");
    expect(help).toContain("hukuk dairesinden");
    expect(help).not.toContain("m.364/1-c");
  });

  it("L23/L24: the cevap dilekçesi finally asks for def'iler and karşı dava", () => {
    const cevap = getTemplate("cevap-dilekcesi")!;
    const defiler = cevap.fields.find((f) => f.path === "matter.ekBilgiler.defiler");
    expect(defiler).toBeDefined();
    expect(defiler!.help).toContain("HMK m.141/1");
    expect(defiler!.kind).toBe("list");
    const karsi = cevap.fields.find((f) => f.path === "matter.ekBilgiler.karsiDava");
    expect(karsi).toBeDefined();
    expect(karsi!.help).toContain("HMK m.133/1");
    expect(cevap.sections.some((s) => s.id === "defiler")).toBe(true);
    expect(cevap.sections.some((s) => s.id === "karsi-dava")).toBe(true);
  });

  it("L27/L28: satış temerrüt is conditional on an agreed day; the mülkiyet clause has one branch", () => {
    const satis = clauseText("satis-sozlesmesi");
    expect(satis).toContain("TBK m.117/1");
    expect(satis).toContain("İHTARIYLA");
    expect(satis).not.toContain("ihtara gerek olmaksızın vadenin dolmasıyla");
    expect(satis).toContain("Kaydın bulunmadığı");
    expect(satis).not.toContain("Kayıt varsa mülkiyet");
    // C16: the select value is written into the document, so it reads as text.
    const secim = getTemplate("satis-sozlesmesi")!.fields.find(
      (f) => f.path === "matter.ekBilgiler.mulkiyetiSakliTutma",
    )!;
    expect(secim.options).toEqual(["Yok", "Var — TMK m.764 uyarınca noter özel siciline tescil edilecek"]);
  });

  it("L18/L25: no document body carries an app instruction or a raw machine rule id", () => {
    for (const template of DRAFT_TEMPLATES) {
      const body = clauseText(template.id);
      for (const forbidden of [
        "hmk-istinaf",
        "hmk-temyiz",
        "Süreler ekranından",
        "doğrulayın",
        "Genel Tebliği Seri No",
      ]) {
        expect(body, `${template.id}: "${forbidden}" in document body`).not.toContain(forbidden);
      }
      // No machine path or English leaks into the signed/filed text.
      expect(body, template.id).not.toMatch(/ekBilgiler|matter\.|endpoint|payload/u);
    }
  });

  it("the field labels stay Turkish and free of machine words (M2)", () => {
    expect(labelForPath("matter.matterId")).toBe("Dosya numarası");
    for (const template of DRAFT_TEMPLATES) {
      for (const field of template.fields) {
        expect(field.label, `${template.id}: ${field.path}`).not.toMatch(/matter|ekBilgiler|\(matter\)/u);
      }
    }
  });

  it("the 14 template ids, kinds and domains are unchanged by the W14 content fixes", () => {
    expect(DRAFT_TEMPLATES.map((t) => `${t.id}:${t.kind}:${t.domain}`)).toEqual([
      "dava-dilekcesi:dilekce:ozel-hukuk",
      "cevap-dilekcesi:dilekce:ozel-hukuk",
      "istinaf-basvuru:dilekce:ozel-hukuk",
      "temyiz-dilekcesi:dilekce:ozel-hukuk",
      "ihtarname:dilekce:ozel-hukuk",
      "icra-itiraz-dilekcesi:dilekce:icra",
      "arabuluculuk-basvurusu:dilekce:ozel-hukuk",
      "hizmet-sozlesmesi:sozlesme:ozel-hukuk",
      "kira-sozlesmesi:sozlesme:ozel-hukuk",
      "tahliye-taahhutnamesi:sozlesme:ozel-hukuk",
      "is-sozlesmesi:sozlesme:ozel-hukuk",
      "satis-sozlesmesi:sozlesme:ozel-hukuk",
      "vekalet-ucret-sozlesmesi:sozlesme:ozel-hukuk",
      "hukuki-mutalaa:dilekce:genel",
    ]);
  });

  it("C10–C13: one spelling per word, and 'DELİLLER' instead of 'HUKUKÎ DELİLLER'", () => {
    const everything = DRAFT_TEMPLATES.map((t) => allText(t.id)).join("\n");
    expect(everything).not.toContain("ticarî");
    expect(everything).not.toContain("dâhil");
    expect(getTemplate("dava-dilekcesi")!.sections.find((s) => s.id === "deliller")!.title).toBe(
      "DELİLLER",
    );
  });

  it("labelForPath resolves template fields, prefixes and generic fallbacks", () => {
    expect(labelForPath("matter.ekBilgiler.karar", "istinaf-basvuru")).toContain(
      "İstinafa konu karar",
    );
    expect(labelForPath("matter.ekBilgiler.mecur", "kira-sozlesmesi")).toBe(
      "Kiralanan (mecur) adresi/niteliği",
    );
    expect(labelForPath("matter.taraflar.0.ad", "dava-dilekcesi")).toContain("Taraflar");
    expect(labelForPath("matter.vekil.sicilNo", "dava-dilekcesi")).toBe("Baro sicil no");
    expect(labelForPath("matter.taraflar.0.tckn", "temyiz-dilekcesi")).toContain("Taraflar");
    expect(labelForPath("evidence.runId")).toBe("Araştırma no");
    expect(labelForPath("hic.yok")).toBe("hic.yok");
  });

  it("validateRequiredFields reports each missing dot path with matter. prefix", () => {
    const template = getTemplate("kira-sozlesmesi")!;
    const issues = validateRequiredFields(template, {
      taraflar: [{ ad: "A", rol: "Kiracı" }],
      ekBilgiler: { kiraBedeli: "30.000 TL" },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("matter.ekBilgiler.mecur");
  });

  it("empty arrays and blank strings do NOT satisfy a required field", () => {
    const template = getTemplate("dava-dilekcesi")!;
    const issues = validateRequiredFields(template, {
      taraflar: [],
      olaylar: [{ metin: "x" }],
      talepler: ["   "],
    });
    const paths = issues.map((i) => i.path).sort();
    expect(paths).toContain("matter.taraflar");
    expect(paths).not.toContain("matter.olaylar");
  });

  it("composeDraft turns missing required fields into a DraftValidationError", () => {
    const request = hizmetRequest();
    delete (request.matter.ekBilgiler as Record<string, unknown>)["hizmetKonusu"];
    try {
      composeDraft(request);
      expect.unreachable("compose should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftValidationError);
      const issues = (error as DraftValidationError).issues;
      expect(issues.map((i) => i.path)).toEqual(["matter.ekBilgiler.hizmetKonusu"]);
    }
  });

  it("composeDraft refuses an unknown template and a kind mismatch", () => {
    expect(() => composeDraft(davaRequest({ template: "yok-boyle-sablon" }))).toThrow(
      DraftValidationError,
    );
    expect(() => composeDraft(davaRequest({ kind: "sozlesme" }))).toThrow(DraftValidationError);
  });
});

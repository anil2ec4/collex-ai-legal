/**
 * Filed-copy defects (drafting audit, 27.09.2026). Every test here failed on
 * the tree before the fix it pins. These documents are FILED in court: the
 * worst class of defect is wrong content in the copy that gets filed.
 *
 * All content is SENTETİK — authored for these tests, never real Turkish law.
 */

import { describe, expect, it } from "vitest";

import { composeDraft, DraftValidationError } from "../../src/drafting/composer.js";
import { addresseeDative, datifSuffix, todayTr } from "../../src/drafting/input.js";
import { renderDraftMarkdown } from "../../src/drafting/markdown.js";
import { findUnfilledPlaceholders } from "../../src/drafting/placeholders.js";
import { reviseDraft, type DraftPatchSection } from "../../src/drafting/revise.js";
import {
  contentDisposition,
  createDraftingRouter,
  type DraftDocxExecRequest,
} from "../../src/drafting/routes.js";
import { InMemoryDraftStore } from "../../src/drafting/store.js";
import { OLAY_ANLATISI_KEY } from "../../src/drafting/input.js";
import { DEADLINE_DISCLAIMER } from "../../src/deadlines/rules.js";
import { escapeMarkdownText } from "../../src/security/renderGuard.js";
import {
  EK_DOGRULAMA_SECTION_ID,
  KAYNAKSIZ_PREFIX,
  NOTE_KAYNAKSIZ,
  NOTE_OLAY_ANLATISI,
  type Draft,
  type DraftFileChunk,
  type DraftParagraph,
  type DraftRequest,
} from "../../src/drafting/types.js";
import { readFile, writeFile } from "node:fs/promises";
import {
  QUOTE_TCK,
  davaMatter,
  davaRequest,
  minimalRequestFor,
  tckPack,
  uploadChunk,
} from "./fixtures.js";

const NOW = { now: () => new Date("2026-09-27T09:00:00.000Z") };
const OPTS = { trustEntailment: false, now: () => new Date("2026-09-27T10:00:00.000Z") };

function texts(draft: Draft, sectionId: string): string[] {
  return (draft.sections.find((s) => s.id === sectionId)?.paragraphs ?? []).map((p) => p.text);
}

function allParagraphs(draft: Draft): DraftParagraph[] {
  return draft.sections.flatMap((s) => s.paragraphs);
}

function bodyText(draft: Draft): string {
  return allParagraphs(draft)
    .map((p) => p.text)
    .join("\n");
}

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

function withEk(base: DraftRequest, ek: Record<string, unknown>, extra: Partial<DraftRequest["matter"]> = {}): DraftRequest {
  return {
    ...base,
    matter: { ...base.matter, ...extra, ekBilgiler: { ...(base.matter.ekBilgiler ?? {}), ...ek } },
  };
}

type App = ReturnType<typeof createDraftingRouter>;

async function post(app: App, body: unknown): Promise<Response> {
  return app.request("/v1/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// #1 — entity escapes printed into the filed copies
// ---------------------------------------------------------------------------

describe("#1 draft text is stored plain; only the Markdown render escapes", () => {
  const request = davaRequest({
    matter: davaMatter({
      taraflar: [
        { ad: "Yılmaz & Kaya İnşaat Ltd. Şti.", rol: "Davacı" },
        { ad: "Anadolu Lojistik A.Ş.", rol: "Davalı" },
      ],
      olaylar: [
        {
          tarih: "2025-01-10",
          metin: "Sözleşmenin 5.2. maddesi uyarınca gecikme faizi <%5> ve ceza koşulu kararlaştırıldı.",
        },
      ],
      talepler: ["Faiz oranının %9 > yasal faiz olduğunun tespitine"],
    }),
  });

  it("keeps '&', '<%5>' and '%9 >' as written in party, event, request and signature", () => {
    const draft = composeDraft(request, undefined, NOW);
    expect(texts(draft, "taraflar")).toContain("DAVACI : Yılmaz & Kaya İnşaat Ltd. Şti.");
    expect(bodyText(draft)).toContain("gecikme faizi <%5> ve");
    expect(bodyText(draft)).toContain("%9 > yasal faiz");
    expect(texts(draft, "imza").join("\n")).toContain("Yılmaz & Kaya İnşaat Ltd. Şti. — (imza)");
    for (const p of allParagraphs(draft)) {
      expect(p.text, p.id).not.toMatch(/&(?:amp|lt|gt|#40|#58|#46);/u);
    }
  });

  it("renders Markdown that reads as written and stays inert", () => {
    const md = renderDraftMarkdown(composeDraft(request, undefined, NOW));
    expect(md).toContain("Yılmaz & Kaya İnşaat Ltd. Şti.");
    expect(md).toContain("<%5>");
    expect(md).toContain("%9 > yasal faiz");
    expect(md).not.toContain("&amp;");
  });

  it("folds the escapes of a draft stored before the fix (Markdown)", () => {
    const draft = composeDraft(request, undefined, NOW);
    const legacy: Draft = JSON.parse(
      JSON.stringify(draft).replaceAll("Yılmaz & Kaya", "Yılmaz &amp; Kaya").replaceAll("<%5>", "&lt;%5&gt;"),
    );
    const md = renderDraftMarkdown(legacy);
    expect(md).toContain("Yılmaz & Kaya İnşaat");
    expect(md).toContain("<%5>");
    expect(md).not.toContain("&amp;");
    expect(md).not.toContain("&lt;%5");
  });

  it("escapeMarkdownText neutralizes markup, links, definitions and forged citation lines", () => {
    expect(escapeMarkdownText("<script>alert(1)</script>")).not.toMatch(/<script|<\/script/u);
    expect(escapeMarkdownText("[tıkla](javascript:alert(1))")).not.toContain("](");
    expect(escapeMarkdownText("![x](https://evil.example/p.png)")).not.toContain("](");
    expect(escapeMarkdownText("> Dayanak [K-1]: sahte")).toBe("&gt; Dayanak [K-1]: sahte");
    expect(escapeMarkdownText("[ref]: https://evil.example")).not.toMatch(/^\[ref\]:/u);
    expect(escapeMarkdownText("bkz. https://evil.example/x")).not.toContain("https://evil");
    expect(escapeMarkdownText("&lt; yazdım")).toBe("&amp;lt; yazdım");
    expect(escapeMarkdownText("A & B, %9 > yasal, <%5>")).toBe("A & B, %9 > yasal, <%5>");
  });
});

// ---------------------------------------------------------------------------
// #2 — timeliness the dates contradict
// ---------------------------------------------------------------------------

function icraRequest(tebligTarihi: string, tarih: string): DraftRequest {
  const base = minimalRequestFor("icra-itiraz-dilekcesi");
  return withEk(base, { tebligTarihi }, { tarih, mahkeme: "İstanbul Anadolu 5. İcra Müdürlüğü" });
}

describe("#2 a document may not say 'süresi içinde' when its own dates say otherwise", () => {
  it("icra itiraz: tebliğ 03.08.2026, dilekçe 27.09.2026 — keeps the fact, drops the claim, warns loudly", () => {
    const draft = composeDraft(icraRequest("2026-08-03", "2026-09-27"), undefined, NOW);
    expect(texts(draft, "sure")).toEqual(["Ödeme emri tarafımıza 03.08.2026 tarihinde tebliğ edilmiştir."]);
    expect(bodyText(draft)).not.toMatch(/süre(si)? içinde/u);
    const warning = draft.warnings.find((w) => w.includes("SÜRE GEÇMİŞ"));
    expect(warning).toBeDefined();
    expect(warning).toContain("10.08.2026");
    expect(warning).toContain(DEADLINE_DISCLAIMER);
  });

  it("icra itiraz filed in time keeps its sentence and adds no warning", () => {
    const draft = composeDraft(icraRequest("2026-09-24", "2026-09-27"), undefined, NOW);
    expect(texts(draft, "sure")[0]).toContain("yedi günlük süre içinde yapılmaktadır");
    expect(draft.warnings.some((w) => w.includes("SÜRE GEÇMİŞ"))).toBe(false);
  });

  it("istinaf: a tebliğ earlier than the decision date is flagged", () => {
    const base = minimalRequestFor("istinaf-basvuru");
    const draft = composeDraft(
      withEk(
        base,
        {
          karar: "İstanbul 3. Asliye Hukuk Mahkemesi, E. 2025/10, K. 2026/4, T. 01.02.2026",
          tebligTarihi: "2026-01-15",
          kararOzeti: "Davanın reddine karar verilmiştir.",
        },
        { tarih: "2026-01-20" },
      ),
      undefined,
      NOW,
    );
    expect(draft.warnings.some((w) => w.includes("TARİH TUTARSIZ") && w.includes("01.02.2026"))).toBe(true);
  });

  it("istinaf filed after the two weeks: KONU no longer says 'Süresi içinde'", () => {
    const base = minimalRequestFor("istinaf-basvuru");
    const draft = composeDraft(
      withEk(base, { tebligTarihi: "2026-03-02", kararOzeti: "Davanın reddi." }, { tarih: "2026-06-01" }),
      undefined,
      NOW,
    );
    expect(texts(draft, "konu")[0]).not.toContain("Süresi içinde");
    expect(draft.warnings.some((w) => w.includes("SÜRE GEÇMİŞ"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #3 — system placeholders in the NİHAİ copy
// ---------------------------------------------------------------------------

function cevapRequest(ek: Record<string, unknown> = {}): DraftRequest {
  return withEk(minimalRequestFor("cevap-dilekcesi"), ek, { mahkeme: "İstanbul 3. Asliye Hukuk Mahkemesi" });
}

describe("#3 placeholders: omitted when optional, flagged when not, refused in the NİHAİ copy", () => {
  it("a cevap dilekçesi with no counterclaim and no def'i has no such sections (and says why)", () => {
    const draft = composeDraft(cevapRequest(), undefined, NOW);
    expect(draft.sections.map((s) => s.id)).not.toContain("karsi-dava");
    expect(draft.sections.map((s) => s.id)).not.toContain("defiler");
    expect(bodyText(draft)).not.toContain("Karşı dava talebi varsa");
    expect(bodyText(draft)).not.toContain("Def'iler (zamanaşımı");
    expect(draft.warnings.some((w) => w.includes("KARŞI DAVA bölümü taslağa yazılmadı"))).toBe(true);
    expect(draft.warnings.some((w) => w.includes("DEF'İLERİMİZ bölümü") && w.includes("HMK m.141/1"))).toBe(true);
  });

  it("temyiz: no '[… — doldurun]' for an absent first-instance decision or duruşma choice", () => {
    const base = minimalRequestFor("temyiz-dilekcesi");
    const draft = composeDraft(withEk(base, { kararOzeti: "Onama." }), undefined, NOW);
    const kunye = texts(draft, "kunye").join("\n");
    expect(kunye).not.toContain("İlk derece kararı");
    expect(kunye).not.toContain("HMK m.369");
    expect(kunye).not.toContain("doldurun");
  });

  it("records every system placeholder it writes, stubs included", () => {
    const draft = composeDraft(
      davaRequest({ matter: davaMatter({ baslik: undefined }) }),
      undefined,
      NOW,
    );
    const open = findUnfilledPlaceholders(draft).map((f) => f.text);
    expect(open).toContain("[GÖREVLİ VE YETKİLİ]");
    expect(open.some((t) => t.includes("avukat tarafından eklenmelidir"))).toBe(true);
    expect(draft.warnings.some((w) => w.startsWith("Doldurulmamış yer tutucu:"))).toBe(true);
    const ozet = composeDraft(minimalRequestFor("temyiz-dilekcesi"), undefined, NOW);
    const karar = ozet.sections.find((s) => s.id === "karar-ozeti")!.paragraphs[0]!;
    expect(karar.text).toBe("[Kararın özeti — doldurun]");
    expect(karar.placeholders).toEqual(["[Kararın özeti — doldurun]"]);
  });

  it("refuses the NİHAİ export (409 PLACEHOLDER_UNFILLED) and never spawns the exporter", async () => {
    let spawned = 0;
    const app = createDraftingRouter({
      exec: async () => {
        spawned += 1;
        return { code: 0, stderr: "" };
      },
      now: NOW.now,
      log: () => undefined,
    });
    const created = (await (await post(app, minimalRequestFor("temyiz-dilekcesi"))).json()) as Draft;
    for (const format of ["md", "docx", "udf"]) {
      const res = await app.request(
        `/v1/drafts/${created.draftId}/export?format=${format}&annex=none&marks=none`,
      );
      expect(res.status, format).toBe(409);
      const body = (await res.json()) as {
        error: { kind: string; code: string; message: string; placeholders: { text: string }[] };
      };
      expect(body.error.kind).toBe("EXPORT_REFUSED");
      expect(body.error.code).toBe("PLACEHOLDER_UNFILLED");
      expect(body.error.message).toContain("[Kararın özeti — doldurun]");
      expect(body.error.placeholders.map((p) => p.text)).toContain("[Kararın özeti — doldurun]");
    }
    expect(spawned).toBe(0);
    // The marked draft copy is still available and shows the placeholder.
    const taslak = await app.request(`/v1/drafts/${created.draftId}/export?format=md`);
    expect(taslak.status).toBe(200);
    expect(await taslak.text()).toContain("[Kararın özeti — doldurun]");
  });

  it("filling the placeholders unlocks the NİHAİ copy", async () => {
    const app = createDraftingRouter({ now: NOW.now, log: () => undefined });
    const created = (await (await post(app, minimalRequestFor("temyiz-dilekcesi"))).json()) as Draft;
    const sections = asPatchSections(created).map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((p) => ({
        ...p,
        // The KAYNAKSIZ stubs are notes to the lawyer: the lawyer writes the
        // legal basis over them (the paragraph stays KAYNAKSIZ — the lawyer's
        // own assessment — and the filing copy may carry that).
        text: p.text.includes("avukat tarafından")
          ? "Bölge adliye mahkemesinin kararı HMK m.371 uyarınca bozulmalıdır."
          : p.text
              .replace("[Kararın özeti — doldurun]", "Bölge adliye mahkemesi davayı reddetmiştir.")
              .replace("[KARARI VEREN BÖLGE ADLİYE MAHKEMESİ HUKUK DAİRESİ]", "İSTANBUL BAM 12. HUKUK DAİRESİ"),
      })),
    }));
    const put = await app.request(`/v1/drafts/${created.draftId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections }),
    });
    expect(put.status).toBe(200);
    const revised = (await put.json()) as Draft;
    expect(findUnfilledPlaceholders(revised)).toEqual([]);
    expect(revised.warnings.some((w) => w.startsWith("Doldurulmamış yer tutucu:"))).toBe(false);
    const nihai = await app.request(`/v1/drafts/${created.draftId}/export?format=md&annex=none&marks=none`);
    expect(nihai.status).toBe(200);
    expect(await nihai.text()).not.toContain("doldurun");
  });

  it("a draft stored before the field existed is detected, and its tokens reach the exporter's JSON", async () => {
    const store = new InMemoryDraftStore();
    const seen: string[] = [];
    const app = createDraftingRouter({
      store,
      exec: async (request: DraftDocxExecRequest) => {
        const jsonPath = request.args[request.args.indexOf("--draft") + 1] as string;
        seen.push(await readFile(jsonPath, "utf8"));
        await writeFile(request.args[request.args.indexOf("--out") + 1] as string, "PK");
        return { code: 0, stderr: "" };
      },
      now: NOW.now,
      log: () => undefined,
    });
    const draft = composeDraft(minimalRequestFor("temyiz-dilekcesi"), undefined, NOW);
    const legacy: Draft = JSON.parse(JSON.stringify(draft), (key, value) =>
      key === "placeholders" ? undefined : value,
    );
    store.put(legacy);
    const nihai = await app.request(`/v1/drafts/${legacy.draftId}/export?format=docx&annex=none&marks=none`);
    expect(nihai.status).toBe(409);
    await app.request(`/v1/drafts/${legacy.draftId}/export?format=docx`);
    const wire = JSON.parse(seen[0] as string) as Draft;
    const ozet = wire.sections.find((s) => s.id === "karar-ozeti")!.paragraphs[0]!;
    expect(ozet.placeholders).toEqual(["[Kararın özeti — doldurun]"]);
  });
});

// ---------------------------------------------------------------------------
// #4 — a failed binding is reported AND applied
// ---------------------------------------------------------------------------

describe("#4 an altered quote marks the paragraph KAYNAKSIZ, whatever its role", () => {
  it("a one-letter change in a quoted passage under an olaylar paragraph", () => {
    const draft = composeDraft(davaRequest(), tckPack(), NOW);
    const sections = asPatchSections(draft);
    const altered = QUOTE_TCK.replace("bir yıldan", "iki yıldan");
    sections
      .find((s) => s.id === "aciklamalar")!
      .paragraphs.push({ text: `Olay: "${altered}"`, evidenceIds: ["ev-tck157"], role: "olaylar" });
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(issues.some((i) => i.code === "QUOTE_ALTERED")).toBe(true);
    const paragraph = revised.sections
      .find((s) => s.id === "aciklamalar")!
      .paragraphs.find((p) => p.text.startsWith("Olay:"))!;
    expect(paragraph.supported).toBe(false);
    expect(paragraph.note).toBe(NOTE_KAYNAKSIZ);
    expect(paragraph.evidenceIds).toEqual([]);
    expect(revised.unsupportedCount).toBe(draft.unsupportedCount + 1);
    expect(renderDraftMarkdown(revised)).toContain(`${KAYNAKSIZ_PREFIX} — Olay:`);
  });
});

// ---------------------------------------------------------------------------
// #9 — saving does not un-mark the lawyer's own account
// ---------------------------------------------------------------------------

describe("#9 the olay anlatısı stays supported:false through a save", () => {
  const request = davaRequest({
    matter: davaMatter({
      ekBilgiler: {
        [OLAY_ANLATISI_KEY]: "Müvekkil 10.03.2025 tarihinde sözlü bir anlaşma yapmıştır.",
      },
    }),
  });

  it("a no-op PUT keeps its status, note and count", () => {
    const draft = composeDraft(request, tckPack(), NOW);
    const before = allParagraphs(draft).filter((p) => p.note === NOTE_OLAY_ANLATISI);
    expect(before).toHaveLength(1);
    const { draft: revised } = reviseDraft(draft, { sections: asPatchSections(draft) }, OPTS);
    const after = allParagraphs(revised).find((p) => p.id === before[0]!.id)!;
    expect(after.supported).toBe(false);
    expect(after.note).toBe(NOTE_OLAY_ANLATISI);
    expect(revised.unsupportedCount).toBe(draft.unsupportedCount);
  });

  it("an account can never be bound to a source by a save", () => {
    const draft = composeDraft(request, tckPack(), NOW);
    const sections = asPatchSections(draft);
    const narrativeId = allParagraphs(draft).find((p) => p.note === NOTE_OLAY_ANLATISI)!.id;
    for (const section of sections) {
      for (const p of section.paragraphs) {
        if (p.id === narrativeId) {
          p.text = `${p.text} "${QUOTE_TCK}"`;
          p.evidenceIds = ["ev-tck157"];
        }
      }
    }
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    const after = allParagraphs(revised).find((p) => p.id === narrativeId)!;
    expect(after.evidenceIds).toEqual([]);
    expect(after.supported).toBe(false);
    expect(issues.some((i) => i.message.includes("Olay anlatısı"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #6 — Turkish in the filed document
// ---------------------------------------------------------------------------

describe("#6 the addressee's dative is Turkish", () => {
  it.each([
    ["YARGITAY", "YARGITAY'A"],
    ["Yargıtay", "Yargıtay'a"],
    ["DANIŞTAY", "DANIŞTAY'A"],
    ["YARGITAY 3. HD", "YARGITAY 3. HD'YE"],
    ["İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ", "İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE"],
    ["İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE", "İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE"],
    ["İstanbul 3. Asliye Hukuk Mahkemesi'ne", "İstanbul 3. Asliye Hukuk Mahkemesi'ne"],
    ["İSTANBUL 3. ASLİYE HUKUK MAHKEMESİNE", "İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE"],
    ["ANKARA 2. SULH CEZA HAKİMLİĞİ", "ANKARA 2. SULH CEZA HAKİMLİĞİ'NE"],
    ["ANKARA 2. SULH CEZA HAKİMLİĞİ'NE", "ANKARA 2. SULH CEZA HAKİMLİĞİ'NE"],
    ["YARGITAY CUMHURİYET BAŞSAVCILIĞI", "YARGITAY CUMHURİYET BAŞSAVCILIĞI'NA"],
    ["ANAYASA MAHKEMESİ BAŞKANLIĞI'NA", "ANAYASA MAHKEMESİ BAŞKANLIĞI'NA"],
    ["İSTANBUL BAM 12. HUKUK DAİRESİ", "İSTANBUL BAM 12. HUKUK DAİRESİ'NE"],
    ["İSTANBUL ANADOLU 5. İCRA DAİRESİ", "İSTANBUL ANADOLU 5. İCRA DAİRESİ'NE"],
    ["İSTANBUL ANADOLU 5. İCRA MÜDÜRLÜĞÜ", "İSTANBUL ANADOLU 5. İCRA MÜDÜRLÜĞÜ'NE"],
    ["İSTANBUL ARABULUCULUK BÜROSU", "İSTANBUL ARABULUCULUK BÜROSU'NA"],
    ["ANKARA", "ANKARA'YA"],
    ["İZMİR", "İZMİR'E"],
    ["BAŞKANLIĞI", "BAŞKANLIĞI'NA"],
  ])("%s → %s", (input, expected) => {
    expect(addresseeDative(input)).toBe(expected);
  });

  it("keeps the old suffix-only contract for names that carry none", () => {
    expect(datifSuffix("ASLİYE HUKUK MAHKEMESİ")).toBe("'NE");
    expect(datifSuffix("MÜDÜRLÜĞÜ")).toBe("'NE");
    expect(datifSuffix("YARGITAY")).toBe("'A");
  });

  it("the composer addresses the court with it", () => {
    const yargitay = composeDraft(
      davaRequest({ matter: davaMatter({ baslik: undefined, mahkeme: "Yargıtay" }) }),
      undefined,
      NOW,
    );
    expect(texts(yargitay, "baslik")).toEqual(["YARGITAY'A"]);
    const typed = composeDraft(
      davaRequest({ matter: davaMatter({ baslik: undefined, mahkeme: "İstanbul 3. Asliye Hukuk Mahkemesi'ne" }) }),
      undefined,
      NOW,
    );
    expect(texts(typed, "baslik")).toEqual(["İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ'NE"]);
  });

  it("an ihtarname is not closed with a court formula, and '7 (yedi) gün' is not 'gün gün'", () => {
    const draft = composeDraft(
      withEk(minimalRequestFor("ihtarname"), { sure: "7 (yedi) gün", noter: "İstanbul 5. Noterliği" }),
      undefined,
      NOW,
    );
    const ihtar = texts(draft, "ihtar").join("\n");
    expect(ihtar).not.toContain("karar verilmesini");
    expect(ihtar).toContain("ihtar olunur");
    expect(ihtar).toContain("7 (yedi) gün içinde");
    expect(ihtar).not.toContain("gün gün");
  });

  it("a value ending in '.' before a template '.' does not print '..'", () => {
    const draft = composeDraft(
      withEk(minimalRequestFor("temyiz-dilekcesi"), {
        karar: "İstanbul BAM 12. Hukuk Dairesi, E. 2025/100, K. 2026/40, T. 15.03.2026.",
        kararOzeti: "Onama.",
      }),
      undefined,
      NOW,
    );
    expect(texts(draft, "kunye").join("\n")).not.toContain("..");
  });
});

// ---------------------------------------------------------------------------
// #7 — Ek numbering and the DELİLLER line of the filed copy
// ---------------------------------------------------------------------------

describe("#7 Ek-n follows the lawyer's order; the filed line is the exhibit alone", () => {
  function port(chunks: DraftFileChunk[]) {
    // Hex order, as the database used to answer.
    return { getChunks: async () => [...chunks].sort((a, b) => a.fileId.localeCompare(b.fileId)) };
  }

  it("numbers exhibits in the order of evidence.fileIds, with a human title", async () => {
    const chunks = [
      uploadChunk({ fileId: "a51af8c8adb920d2", fileName: "Bilirkişi Raporu.pdf", chunkId: "c-a" }),
      uploadChunk({ fileId: "f17eb37a678089bd", fileName: "tanik-bom.txt", chunkId: "c-f" }),
    ];
    const app = createDraftingRouter({ files: port(chunks), now: NOW.now, log: () => undefined });
    const response = await post(app, {
      ...davaRequest(),
      evidence: { fileIds: ["f17eb37a678089bd", "a51af8c8adb920d2"] },
    });
    expect(response.status).toBe(200);
    const draft = (await response.json()) as Draft;
    const deliller = texts(draft, "deliller");
    expect(deliller).toEqual([
      "Ek-1: tanik-bom (dosyaya eklediğiniz belge)",
      "Ek-2: Bilirkişi Raporu (dosyaya eklediğiniz belge)",
    ]);
    const nihai = renderDraftMarkdown(draft, { mode: { annex: "none", marks: "none" } });
    expect(nihai).toContain("Ek-1: tanik-bom\n");
    expect(nihai).not.toContain("dosyaya eklediğiniz belge");
  });
});

// ---------------------------------------------------------------------------
// #8 — the vekil's address (HMK m.119/1-c)
// ---------------------------------------------------------------------------

describe("#8 the vekil address survives when the party record names the same lawyer", () => {
  const client = {
    ad: "Mehmet Yılmaz",
    rol: "Davacı",
    vekil: { ad: "Av. Ayşe Kaya", baro: "İstanbul Barosu", sicilNo: "45678" },
  };

  it("merges the matter-level vekil into the party's own record", () => {
    const draft = composeDraft(
      davaRequest({
        matter: davaMatter({
          taraflar: [client, { ad: "Anadolu Lojistik A.Ş.", rol: "Davalı" }],
          vekil: { ad: "Av. Ayşe Kaya", baro: "İstanbul Barosu", sicilNo: "45678", adres: "Bağdat Cad. No: 12 Kadıköy/İstanbul" },
        }),
      }),
      undefined,
      NOW,
    );
    const taraflar = texts(draft, "taraflar");
    const vekilAt = taraflar.findIndex((t) => t.startsWith("VEKİLİ : Av. Ayşe Kaya"));
    expect(vekilAt).toBeGreaterThanOrEqual(0);
    expect(taraflar[vekilAt + 1]).toBe("Adres : Bağdat Cad. No: 12 Kadıköy/İstanbul");
  });

  it("never lends one lawyer's address to another", () => {
    const draft = composeDraft(
      davaRequest({
        matter: davaMatter({
          taraflar: [client, { ad: "Anadolu Lojistik A.Ş.", rol: "Davalı" }],
          vekil: { ad: "Av. Başka Avukat", adres: "Başka adres" },
        }),
      }),
      undefined,
      NOW,
    );
    expect(texts(draft, "taraflar").join("\n")).not.toContain("Başka adres");
  });
});

// ---------------------------------------------------------------------------
// #11 — the smaller ones
// ---------------------------------------------------------------------------

describe("#11 mütalaa signature, ekBilgiler validation, the Istanbul day, filename*", () => {
  it("a hukukî mütalaa is signed by the lawyer, not as the client's representative", () => {
    const draft = composeDraft(
      withEk(minimalRequestFor("hukuki-mutalaa"), {}, {
        taraflar: [
          { ad: "Mehmet Yılmaz", rol: "Mütalaa İsteyen" },
          { ad: "Anadolu Lojistik A.Ş.", rol: "Karşı Taraf" },
        ],
        vekil: { ad: "Av. Ayşe Kaya", baro: "İstanbul Barosu", sicilNo: "45678" },
      }),
      undefined,
      NOW,
    );
    const imza = texts(draft, "imza");
    expect(imza.join("\n")).not.toContain("VEKİLİ");
    expect(imza).toContain("Av. Ayşe Kaya (İstanbul Barosu, Sicil No: 45678) — (imza)");
  });

  it("refuses an ekBilgiler key the template does not offer, by name", async () => {
    expect(() =>
      composeDraft(withEk(minimalRequestFor("icra-itiraz-dilekcesi"), { tebligTarhi: "2026-08-03" }), undefined, NOW),
    ).toThrow(DraftValidationError);
    const app = createDraftingRouter({ now: NOW.now, log: () => undefined });
    const res = await post(app, withEk(minimalRequestFor("icra-itiraz-dilekcesi"), { tebligTarhi: "2026-08-03" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: { path: string; label: string; message: string }[] } };
    const issue = body.error.issues.find((i) => i.path === "matter.ekBilgiler.tebligTarhi");
    expect(issue).toBeDefined();
    expect(issue!.label).toBe("Fazladan alan (tebligTarhi)");
  });

  it("refuses a select value that is not one of the field's options", async () => {
    const app = createDraftingRouter({ now: NOW.now, log: () => undefined });
    const bad = await post(app, withEk(minimalRequestFor("temyiz-dilekcesi"), { durusma: "Evet" }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { issues: { path: string; message: string }[] } };
    expect(body.error.issues[0]?.path).toBe("matter.ekBilgiler.durusma");
    expect(body.error.issues[0]?.message).toContain("Duruşma talep edilmemektedir");
    const good = await post(
      app,
      withEk(minimalRequestFor("temyiz-dilekcesi"), { durusma: "Duruşma yapılması talep edilmektedir" }),
    );
    expect(good.status).toBe(200);
  });

  it("dates a draft written at 01:30 in İstanbul with the İstanbul day", () => {
    expect(todayTr(new Date("2026-09-26T22:30:00.000Z"))).toBe("27.09.2026");
    const draft = composeDraft(
      davaRequest({ matter: davaMatter({ tarih: undefined }) }),
      undefined,
      { now: () => new Date("2026-09-26T22:30:00.000Z") },
    );
    expect(texts(draft, "imza")[0]).toContain("27.09.2026");
  });

  it("percent-encodes ( ) ' * in filename* (RFC 8187 attr-char)", () => {
    const header = contentDisposition({ ascii: "a.docx", utf8: "Dilekçe (v2) 'son' *.docx" });
    const star = header.split("filename*=UTF-8''")[1] as string;
    expect(star).not.toMatch(/[()'*]/u);
    expect(star).toContain("%28v2%29");
    expect(star).toContain("%27son%27");
  });
});

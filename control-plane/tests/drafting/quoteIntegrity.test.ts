/**
 * W14 · B-01 — the quote integrity gate.
 *
 * These tests replay W13-UXAUDIT P0-1 exactly: a lawyer attaches K-1 to a
 * HUKUKÎ SEBEPLER paragraph and then edits the text INSIDE the quote. Two
 * separate mutations were measured to survive every guard:
 *
 *   (a) `üç yıldan yedi yıla` -> `beş yıldan on yıla`  (a penalty in WORDS,
 *       so `extractNumbers` never sees it and a 0.7 token floor does not move);
 *   (b) `MADDE 157` -> `MADDE 158`  (the digits `157` are still present in
 *       the künye, so the number check passes).
 *
 * Each mutation is asserted twice: once proving the OLD lexical guard still
 * says "fine" (so the regression cannot silently come back by reverting to
 * it), and once proving the new gate refuses.
 *
 * All content is SENTETİK — authored for this test, not real Turkish law.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { writeFile } from "node:fs/promises";

import {
  evidenceBindingHolds,
  evidenceOverlaps,
  composeDraft,
} from "../../src/drafting/composer.js";
import {
  QUOTE_ALTERED,
  canonicalQuoteText,
  findAlteredQuotes,
  paragraphContainsQuote,
} from "../../src/drafting/quoteIntegrity.js";
import { reviseDraft } from "../../src/drafting/revise.js";
import { createDraftingRouter } from "../../src/drafting/routes.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";
import { NOTE_KAYNAKSIZ, type Draft, type DraftEvidence } from "../../src/drafting/types.js";
import { davaRequest, tckPack } from "./fixtures.js";

const NOW = () => new Date("2026-09-02T11:00:00.000Z");
const OPTS = { trustEntailment: false, now: NOW };

/** SENTETİK statute text carrying BOTH mutation sites of UXAUDIT P0-1. */
const QUOTE_157 =
  "MADDE 157 - (1) Hileli davranışlarla bir kimseyi aldatarak sentetik bir" +
  " yarar sağlayan kişiye üç yıldan yedi yıla kadar hapis ve beşbin güne" +
  " kadar adlî para cezası verilir.";

const LABEL_157 = "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 157";

function evidence157(): DraftEvidence {
  return {
    evidenceId: "ev-157",
    label: LABEL_157,
    source: "MEVZUAT",
    title: "Türk Ceza Kanunu (SENTETİK)",
    legislationNo: "5237",
    article: "157",
    quote: QUOTE_157,
    quoteSha256: sha256HexUtf8(QUOTE_157),
    contentSha256: sha256HexUtf8(`SENTETİK TAM METİN\n${QUOTE_157}`),
    direction: "destekleyen",
  };
}

/** A composed draft whose HUKUKÎ SEBEPLER paragraph is bound to ev-157. */
function draft157(): Draft {
  return composeDraft(
    davaRequest(),
    tckPack({
      claims: [{ claimId: "c-157", text: `${LABEL_157}: "${QUOTE_157}"`, evidenceIds: ["ev-157"] }],
      evidence: [evidence157()],
    }),
    { now: NOW },
  );
}

function patchSections(draft: Draft): {
  id: string;
  paragraphs: { id: string; text: string; evidenceIds: string[]; role: string }[];
}[] {
  return draft.sections
    .filter((s) => s.id !== "ek-dogrulama")
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

/** Apply one string mutation to every paragraph that cites ev-157. */
function mutate(draft: Draft, from: string, to: string): ReturnType<typeof patchSections> {
  const sections = patchSections(draft);
  let hits = 0;
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      if (!paragraph.evidenceIds.includes("ev-157")) continue;
      const next = paragraph.text.replace(from, to);
      if (next !== paragraph.text) hits += 1;
      paragraph.text = next;
    }
  }
  expect(hits).toBeGreaterThan(0);
  return sections;
}

describe("canonical quote comparison", () => {
  it("is insensitive to re-wrapping, entity escapes and invisible characters", () => {
    expect(canonicalQuoteText("a  b\nc")).toBe("a b c");
    expect(canonicalQuoteText("Madde 3 &amp; 4")).toBe("Madde 3 & 4");
    expect(canonicalQuoteText("a&lt;b&gt;c")).toBe("a<b>c");
    expect(canonicalQuoteText("a​b")).toBe("ab");
    // The render guard escaped the paragraph; the stored quote is raw.
    expect(paragraphContainsQuote('… "Madde 3 &amp; 4 uyarınca" …', "Madde 3 & 4 uyarınca")).toBe(
      true,
    );
  });

  it("is sensitive to a single changed letter or digit", () => {
    expect(paragraphContainsQuote("üç yıldan yedi yıla", "üç yıldan yedi yıla")).toBe(true);
    expect(paragraphContainsQuote("beş yıldan on yıla", "üç yıldan yedi yıla")).toBe(false);
    expect(paragraphContainsQuote("MADDE 158", "MADDE 157")).toBe(false);
  });

  it("never binds an empty quote", () => {
    expect(paragraphContainsQuote("herhangi bir metin", "")).toBe(false);
    expect(paragraphContainsQuote("herhangi bir metin", "   ")).toBe(false);
  });
});

describe("B-01 (a): a penalty written in WORDS is changed inside the quote", () => {
  const altered = QUOTE_157.replace("üç yıldan yedi yıla", "beş yıldan on yıla");

  it("the OLD lexical guard accepts it — this is why the gate had to change", () => {
    expect(evidenceOverlaps(altered, QUOTE_157)).toBe(true);
    expect(evidenceBindingHolds(altered, QUOTE_157)).toBe(false);
  });

  it("PUT demotes the paragraph to KAYNAKSIZ and reports QUOTE_ALTERED", () => {
    const draft = draft157();
    const sections = mutate(draft, "üç yıldan yedi yıla", "beş yıldan on yıla");
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    const bound = revised.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.evidenceIds.includes("ev-157"));
    expect(bound).toHaveLength(0);
    const demoted = revised.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.text.includes("beş yıldan on yıla"));
    expect(demoted.length).toBeGreaterThan(0);
    expect(demoted.every((p) => p.supported === false && p.note === NOTE_KAYNAKSIZ)).toBe(true);
    const issue = issues.find((i) => i.code === QUOTE_ALTERED);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("alıntı metni kaynağındakinden farklı");
    expect(issue?.message).toContain("K-1");
  });
});

describe("B-01 (b): a madde number is changed inside the quote", () => {
  const altered = QUOTE_157.replace("MADDE 157", "MADDE 158");
  // The künye still says "m. 157", exactly as measured in UXAUDIT.
  const paragraphText = `Dayanak: ${LABEL_157} — "${altered}"`;

  it("the OLD lexical guard accepts it (157 survives in the künye)", () => {
    expect(evidenceOverlaps(paragraphText, QUOTE_157)).toBe(true);
    expect(evidenceBindingHolds(paragraphText, QUOTE_157)).toBe(false);
  });

  it("PUT demotes the paragraph to KAYNAKSIZ and reports QUOTE_ALTERED", () => {
    const draft = draft157();
    const sections = mutate(draft, "MADDE 157", "MADDE 158");
    const { draft: revised, issues } = reviseDraft(draft, { sections }, OPTS);
    expect(revised.sections.flatMap((s) => s.paragraphs).some((p) => p.evidenceIds.length > 0)).toBe(
      false,
    );
    expect(issues.some((i) => i.code === QUOTE_ALTERED)).toBe(true);
  });
});

describe("B-01: an untouched draft is unchanged", () => {
  it("keeps every binding, produces no finding and no issue", () => {
    const draft = draft157();
    expect(findAlteredQuotes(draft)).toEqual([]);
    const { draft: revised, issues } = reviseDraft(draft, { sections: patchSections(draft) }, OPTS);
    expect(issues.filter((i) => i.code === QUOTE_ALTERED)).toEqual([]);
    expect(findAlteredQuotes(revised)).toEqual([]);
    const cited = revised.sections.flatMap((s) => s.paragraphs).filter((p) => p.evidenceIds.length > 0);
    expect(cited.length).toBeGreaterThan(0);
    expect(revised.unsupportedCount).toBe(draft.unsupportedCount);
  });
});

// ---------------------------------------------------------------------------
// The export gate — md is rendered in TypeScript, so it needs its own refusal
// ---------------------------------------------------------------------------

/**
 * A draft whose stored state already carries the altered paragraph (this is
 * what a pre-B-01 save left in the store, and what a direct store write can
 * still produce). Every format must refuse it.
 */
function tamperedStore(): { store: { get: (id: string) => Draft | undefined }; draft: Draft } {
  const draft = draft157();
  const tampered: Draft = {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((p) =>
        p.evidenceIds.includes("ev-157")
          ? { ...p, text: p.text.replace("üç yıldan yedi yıla", "beş yıldan on yıla") }
          : p,
      ),
    })),
  };
  return {
    draft: tampered,
    store: { get: (id: string) => (id === tampered.draftId ? tampered : undefined) },
  };
}

describe("B-01: export refuses every format, writes nothing", () => {
  it("md, docx and udf all answer EXPORT_REFUSED with QUOTE_ALTERED", async () => {
    const { store, draft } = tamperedStore();
    let spawned = 0;
    const app = new Hono();
    app.route(
      "/",
      createDraftingRouter({
        store: store as never,
        log: () => {},
        exec: async () => {
          spawned += 1;
          return { code: 0, stderr: "" };
        },
      }),
    );
    for (const format of ["md", "docx", "udf"] as const) {
      const response = await app.request(
        `/v1/drafts/${draft.draftId}/export?format=${format}`,
      );
      expect(response.status, format).toBe(409);
      const body = (await response.json()) as {
        error: { kind: string; code: string; message: string; paragraphs: { ref: string }[] };
      };
      expect(body.error.kind, format).toBe("EXPORT_REFUSED");
      expect(body.error.code, format).toBe(QUOTE_ALTERED);
      expect(body.error.message, format).toContain("alıntı metni kaynağındakinden farklı");
      expect(body.error.paragraphs[0]?.ref, format).toBe("K-1");
    }
    // No exporter process is started for a refused draft.
    expect(spawned).toBe(0);
  });

  it("an untouched draft still exports (md 200, docx reaches the exporter)", async () => {
    const draft = draft157();
    let spawned = 0;
    const app = new Hono();
    app.route(
      "/",
      createDraftingRouter({
        store: { get: (id: string) => (id === draft.draftId ? draft : undefined) } as never,
        log: () => {},
        exec: async ({ args }) => {
          spawned += 1;
          // Stand in for the real exporter: write the file it was asked for.
          const out = args[args.indexOf("--out") + 1] as string;
          await writeFile(out, "PK\u0003\u0004 sentetik docx");
          return { code: 0, stderr: "" };
        },
      }),
    );
    const md = await app.request(`/v1/drafts/${draft.draftId}/export?format=md`);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain("Dayanak [K-1]");
    const docx = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(docx.status).toBe(200);
    expect(spawned).toBe(1);
  });
});

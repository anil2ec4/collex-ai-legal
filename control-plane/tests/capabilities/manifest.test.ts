/**
 * W14/B-14 — the coverage manifesto.
 *
 * The one thing this endpoint must never do is invent a number. Both
 * competitors sell coverage with figures they contradict elsewhere or refuse
 * to publish at all; the answer here is to publish the SHAPE and the GAPS, and
 * to leave every unmeasured cell saying "ölçülmedi" (null) rather than 0.
 */

import { describe, expect, it } from "vitest";

import { ALL_TOOL_NAMES } from "../../src/capabilities/registry.js";
import { summarizeToolInventory } from "../../src/capabilities/inventory.js";
import { SOURCE_CATALOG } from "../../src/sources/catalog.js";
import { buildCoverageManifest, KNOWN_GAPS } from "../../src/sources/manifest.js";
import { createSourcesRouter } from "../../src/sources/routes.js";
import { InMemoryLocalLibrary } from "../../src/sources/localLibrary.js";
import type { CoverageManifest } from "../../src/sources/manifest.js";

const T0 = "2026-09-02T10:00:00.000Z";

/** The sentence the console must render verbatim (B-14 acceptance). */
export const AIHM_SENTENCE = "AİHM (HUDOC) kapsamda değildir";

async function getManifest(
  deps: Parameters<typeof createSourcesRouter>[0] = {},
): Promise<{ status: number; body: CoverageManifest }> {
  const app = createSourcesRouter({ now: () => T0, ...deps });
  const response = await app.request("/v1/sources/manifest");
  return { status: response.status, body: (await response.json()) as CoverageManifest };
}

describe("B-14 coverage manifest", () => {
  it("returns {id, ad, durum, sonErisim, notlar} for every source", async () => {
    const { status, body } = await getManifest({ health: () => ({ mcp: "ok" }) });
    expect(status).toBe(200);
    expect(body.kaynaklar).toHaveLength(SOURCE_CATALOG.length);
    for (const source of body.kaynaklar) {
      expect(typeof source.id).toBe("string");
      expect(source.ad.length).toBeGreaterThan(2);
      expect(["acik", "kapali", "bilinmiyor"]).toContain(source.durum);
      // Unmeasured: null, never a fabricated timestamp.
      expect(source.sonErisim).toBeNull();
      expect(source.notlar.length).toBeGreaterThan(0);
      expect(source.durumNotu.length).toBeGreaterThan(10);
    }
  });

  it("carries at least five known gaps, AİHM verbatim among them", async () => {
    const { body } = await getManifest();
    expect(body.bilinenBosluklar.length).toBeGreaterThanOrEqual(5);
    expect(KNOWN_GAPS.length).toBeGreaterThanOrEqual(5);
    const titles = body.bilinenBosluklar.map((g) => g.baslik);
    expect(titles).toContain(AIHM_SENTENCE);
    // Every gap explains itself; none is a bare label.
    for (const gap of body.bilinenBosluklar) {
      expect(gap.aciklama.length, gap.id).toBeGreaterThan(40);
    }
    // The gaps the backlog names explicitly.
    const ids = body.bilinenBosluklar.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining(["aihm", "doktrin", "reklam-rtuk", "ilk-derece", "yerel-korpus"]),
    );
  });

  it("declares AİHM and Reklam Kurulu / RTÜK are genuinely absent from the surface", async () => {
    const { body } = await getManifest();
    const tools = body.aracEnvanteri.map((t) => t.tool.toLowerCase()).join(" ");
    const labels = body.kaynaklar.map((k) => k.ad.toLocaleLowerCase("tr-TR")).join(" ");
    // The claim in the gap list is checkable against the actual inventory.
    expect(tools).not.toMatch(/aihm|echr|hudoc/u);
    expect(labels).not.toMatch(/aihm|reklam kurulu|rtük/u);
  });

  it("opens with the MCP gateway off and says the sources are closed", async () => {
    const { status, body } = await getManifest({ health: () => ({ mcp: "off" }) });
    expect(status).toBe(200);
    expect(body.ozet).toContain("çalışmıyor");
    for (const source of body.kaynaklar.filter((k) => k.bagli)) {
      expect(source.durum).toBe("kapali");
      // W15: the note used to explain the closure with a launch flag
      // ("sunucu --with-mcp ile başlatılmamış") on a screen the lawyer reads.
      // The BEHAVIOUR pinned here is the same and now stricter: the note must
      // still say the source is closed AND must now say what to do about it,
      // without a command-line flag.
      expect(source.durumNotu).toContain("kapalı");
      expect(source.durumNotu).toContain("ColleX simgesine");
      expect(source.durumNotu).not.toContain("--with-mcp");
    }
  });

  it("still opens when the health probe throws", async () => {
    const { status, body } = await getManifest({
      health: () => {
        throw new Error("probe exploded");
      },
    });
    expect(status).toBe(200);
    expect(body.olculenSayilar.yerelVeritabani).toBe("bilinmiyor");
    expect(JSON.stringify(body)).not.toContain("probe exploded");
  });

  it("only prints numbers it was GIVEN by /v1/health, and null otherwise", async () => {
    const { body } = await getManifest();
    const numbers = body.olculenSayilar;
    // Measured here, in this repository:
    expect(numbers.kayitliArac).toBe(ALL_TOOL_NAMES.length);
    expect(numbers.secilebilirKaynak).toBe(SOURCE_CATALOG.length);
    expect(numbers.baglananArac).toBe(summarizeToolInventory().reachable);
    expect(numbers.baglananArac + numbers.baglanmayanArac).toBe(54);
    // NOT measured here — null, never 0 and never an estimate.
    expect(numbers.gecitAracSayisi).toBeNull();
    expect(numbers.migrasyonUygulanan).toBeNull();
    expect(numbers.migrasyonBeklenen).toBeNull();
    expect(numbers.yerelKorpus).toBeNull();
    expect(numbers.yerelKutuphaneBelge).toBeNull();
    expect(numbers.yerelVeritabaniAdi).toBeNull();
  });

  it("passes /v1/health numbers through unchanged when it has them", async () => {
    const { body } = await getManifest({
      health: () => ({
        mcp: "ok",
        toolCount: 54,
        db: "ok",
        dbName: "collex_local",
        migrations: { applied: 11, expected: 11, missing: [] },
        corpus: { publicDocuments: 3, publicChunks: 41 },
      }),
    });
    expect(body.olculenSayilar.gecitAracSayisi).toBe(54);
    expect(body.olculenSayilar.yerelVeritabani).toBe("ok");
    expect(body.olculenSayilar.yerelVeritabaniAdi).toBe("collex_local");
    expect(body.olculenSayilar.migrasyonUygulanan).toBe(11);
    expect(body.olculenSayilar.yerelKorpus).toEqual({ publicDocuments: 3, publicChunks: 41 });
  });

  it("reports whether the local library is on, from the injected port", async () => {
    const off = await getManifest();
    expect(off.body.olculenSayilar.yerelKutuphaneAcik).toBe(false);
    const on = await getManifest({ library: new InMemoryLocalLibrary() });
    expect(on.body.olculenSayilar.yerelKutuphaneAcik).toBe(true);
  });

  it("publishes no corpus size and no accuracy figure anywhere", async () => {
    const { body } = await getManifest({
      health: () => ({ mcp: "ok", corpus: { publicDocuments: 3 } }),
    });
    const text = JSON.stringify(body);
    // No "12 milyondan fazla karar" anywhere. The gap list may say the words
    // "N milyon" to explain WHY no such figure is published; what must never
    // appear is a DIGIT in front of them.
    expect(text).not.toMatch(/[0-9][0-9.,\s]*milyon/iu);
    expect(text).not.toMatch(/%\s*[0-9]/u);
    expect(text).not.toMatch(/halüsinasyon/iu);
    expect(text).not.toMatch(/SENTETİK/u);
    expect(body.durustlukNotu).toContain("Ölçülmemiş hiçbir alana sayı yazılmaz");
  });

  it("exposes the whole tool inventory so the page can show what is not wired", async () => {
    const { body } = await getManifest();
    expect(body.aracEnvanteri).toHaveLength(54);
    for (const entry of body.aracEnvanteri) {
      expect(["REACHABLE", "NOT_YET_WIRED"]).toContain(entry.state);
    }
  });

  it("lists the catalog the search form is built from", async () => {
    const app = createSourcesRouter({ now: () => T0 });
    const response = await app.request("/v1/sources/catalog");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      kaynaklar: Array<{ id: string; ad: string; daireSuzgeci: boolean }>;
      tamMetinTurleri: Array<{ tur: string }>;
      icindeAramaTurleri: Array<{ tur: string }>;
    };
    expect(body.kaynaklar).toHaveLength(SOURCE_CATALOG.length);
    expect(body.kaynaklar.find((k) => k.id === "yargitay")?.daireSuzgeci).toBe(true);
    expect(body.tamMetinTurleri.map((f) => f.tur)).toContain("karar");
    expect(body.icindeAramaTurleri.map((w) => w.tur)).toContain("mevzuat");
  });

  it("uses the injected clock, so the page is deterministic in tests", async () => {
    const { body } = await buildOnce();
    expect(body.olusturulma).toBe(T0);
  });
});

async function buildOnce(): Promise<{ body: CoverageManifest }> {
  return { body: buildCoverageManifest({}, { now: () => T0 }) };
}

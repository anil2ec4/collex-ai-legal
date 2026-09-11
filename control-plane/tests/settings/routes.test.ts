/**
 * Settings router + store normalization (W12-A, contract [M]) — offline.
 */

import { describe, expect, it } from "vitest";
import { createSettingsRouter } from "../../src/settings/routes.js";
import {
  DEFAULT_SETTINGS,
  InMemorySettingsStore,
  normalizeSettings,
  type Settings,
  type SettingsStore,
} from "../../src/settings/store.js";

interface ErrorBody {
  error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> };
}

function harness(store: SettingsStore = new InMemorySettingsStore()) {
  const app = createSettingsRouter({ store });
  const get = async () => {
    const res = await app.request("/v1/settings");
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const put = async (body: unknown, raw = false) => {
    const res = await app.request("/v1/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  return { app, store, get, put };
}

const FULL: Settings = {
  profile: {
    ad: "Av. Anıl Eray",
    unvan: "Avukat",
    baro: "İstanbul Barosu",
    sicilNo: "12345",
    adres: "Kadıköy / İstanbul",
    telefon: "+90 555 000 00 00",
    eposta: "avukat@example.invalid",
    uetsAdresi: "25000-00000-00000",
    vergiDairesi: "Kadıköy",
    vergiNo: "1234567890",
  },
  preferences: { defaultCity: "İstanbul", defaultAsOf: "2026-09-02", theme: "dark", showDemoPresets: false },
};

describe("GET /v1/settings", () => {
  it("returns the full default shape when nothing was saved", async () => {
    const h = harness();
    const res = await h.get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_SETTINGS);
    const prefs = (res.body as Settings).preferences;
    expect(prefs).toEqual({ defaultCity: "", defaultAsOf: "today", theme: "system", showDemoPresets: true });
    expect(Object.values((res.body as Settings).profile).every((v) => v === "")).toBe(true);
  });
});

describe("PUT /v1/settings", () => {
  it("round-trips a full document", async () => {
    const h = harness();
    const saved = await h.put(FULL);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(FULL);
    expect((await h.get()).body).toEqual(FULL);
  });

  it("is a FULL replace: fields left out fall back to their defaults", async () => {
    const h = harness();
    await h.put(FULL);
    const res = await h.put({ profile: { ad: "Av. Yeni" }, preferences: { theme: "light" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: { ...DEFAULT_SETTINGS.profile, ad: "Av. Yeni" },
      preferences: { ...DEFAULT_SETTINGS.preferences, theme: "light" },
    });
  });

  it("rejects bad values with Turkish issues and keeps the stored document", async () => {
    const h = harness();
    await h.put(FULL);
    const theme = await h.put({ profile: {}, preferences: { theme: "sepia" } });
    expect(theme.status).toBe(400);
    expect((theme.body as ErrorBody).error.kind).toBe("INVALID_REQUEST");
    expect((theme.body as ErrorBody).error.issues).toEqual([
      { path: "preferences.theme", message: "Tema: system, light veya dark olmalı." },
    ]);

    const asOf = await h.put({ profile: {}, preferences: { defaultAsOf: "02.09.2026" } });
    expect(asOf.status).toBe(400);
    expect((asOf.body as ErrorBody).error.issues?.[0]?.path).toBe("preferences.defaultAsOf");

    const unknown = await h.put({ profile: { imza: "x" }, preferences: {} });
    expect(unknown.status).toBe(400);
    // V-19: the issue NAMES the stray key. zod reports `unrecognized_keys`
    // at the PARENT object, so this used to say `path: "profile"` — the
    // object that is fine — and a top-level stray field said `path: ""`.
    expect((unknown.body as ErrorBody).error.issues?.[0]).toEqual({
      path: "profile.imza",
      message: "Tanınmayan alan.",
    });

    const missing = await h.put({ profile: {} });
    expect(missing.status).toBe(400);
    expect((missing.body as ErrorBody).error.issues?.[0]).toEqual({ path: "preferences", message: "Bu alan zorunludur." });

    const notJson = await h.put("{", true);
    expect(notJson.status).toBe(400);
    expect((notJson.body as ErrorBody).error.message).toBe("İstek gövdesi JSON olmalı.");

    expect((await h.get()).body).toEqual(FULL);
  });

  it("a throwing store is a typed 503", async () => {
    const dead: SettingsStore = {
      load: async () => {
        throw new Error("ECONNREFUSED");
      },
      save: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const h = harness(dead);
    expect((await h.get()).status).toBe(503);
    const put = await h.put(FULL);
    expect(put.status).toBe(503);
    expect((put.body as ErrorBody).error.kind).toBe("STORE_UNAVAILABLE");
    expect((put.body as ErrorBody).error.message).toMatch(/Yerel veritabanına ulaşılamadı/);
  });
});

describe("normalizeSettings", () => {
  it("lays junk and partial documents over the defaults field by field", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        profile: { ad: "Av. X", baro: 42, unknown: "y" },
        preferences: { theme: "neon", defaultAsOf: "2026-01-01", showDemoPresets: "no", defaultCity: "Ankara" },
      }),
    ).toEqual({
      profile: { ...DEFAULT_SETTINGS.profile, ad: "Av. X" },
      preferences: { defaultCity: "Ankara", defaultAsOf: "2026-01-01", theme: "system", showDemoPresets: true },
    });
    expect(normalizeSettings({ profile: "nope", preferences: null })).toEqual(DEFAULT_SETTINGS);
  });
});

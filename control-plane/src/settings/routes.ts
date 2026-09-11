/**
 * Settings HTTP sub-router (W12-A, contract [M]) — mounted at "/" by the
 * integration lane.
 *
 *   GET /v1/settings -> { profile, preferences }
 *   PUT /v1/settings -> 200 same shape (FULL replace: what is not sent
 *                       becomes its default — zod fills the defaults)
 *
 * 400 INVALID_REQUEST with Turkish issues; 503 STORE_UNAVAILABLE when the
 * store throws (local PostgreSQL down).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "./store.js";

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };
const text = (max: number) => z.string(REQ).max(max, `En fazla ${max} karakter.`).default("");

export const settingsSchema = z
  .object(
    {
      profile: z
        .object(
          {
            ad: text(200),
            unvan: text(100),
            baro: text(100),
            sicilNo: text(50),
            adres: text(1000),
            telefon: text(50),
            eposta: text(200),
            uetsAdresi: text(200),
            vergiDairesi: text(200),
            vergiNo: text(50),
          },
          REQ,
        )
        .strict("Tanınmayan alan."),
      preferences: z
        .object(
          {
            defaultCity: text(100),
            defaultAsOf: z
              .string(REQ)
              .regex(
                /^(today|\d{4}-\d{2}-\d{2})$/,
                "Varsayılan tarih 'today' veya ISO tarih (YYYY-AA-GG) olmalı.",
              )
              .default(DEFAULT_SETTINGS.preferences.defaultAsOf),
            theme: z
              .enum(["system", "light", "dark"], {
                errorMap: () => ({ message: "Tema: system, light veya dark olmalı." }),
              })
              .default(DEFAULT_SETTINGS.preferences.theme),
            showDemoPresets: z.boolean(REQ).default(DEFAULT_SETTINGS.preferences.showDemoPresets),
          },
          REQ,
        )
        .strict("Tanınmayan alan."),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

const storeUnavailable = (c: Context) =>
  c.json(
    { error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı; ayarlar okunamıyor." } },
    503,
  );

export interface SettingsRouterDeps {
  store: SettingsStore;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Hono {
  const app = new Hono();

  app.get("/v1/settings", async (c) => {
    let settings: Settings;
    try {
      settings = await deps.store.load();
    } catch {
      return storeUnavailable(c);
    }
    return c.json(settings, 200);
  });

  app.put("/v1/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } }, 400);
    }
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Ayarlar doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error, turkishZodMessage),
          },
        },
        400,
      );
    }
    let saved: Settings;
    try {
      saved = await deps.store.save(parsed.data);
    } catch {
      return storeUnavailable(c);
    }
    return c.json(saved, 200);
  });

  return app;
}

/**
 * Lawyer settings (W12-A, contract [M]): the profile that fills the vekil
 * block of a petition, and the console preferences.
 *
 *   GET/PUT /v1/settings -> { profile: {...}, preferences: {...} }
 *
 * Stored as two jsonb documents per tenant in app_private.settings
 * (keys 'profile' and 'preferences'). `load()` always returns the FULL
 * shape: stored values are laid over `DEFAULT_SETTINGS`, so a field added
 * later reads as its default rather than as undefined, and a document
 * written by an older build never breaks a newer reader.
 */

import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID, assertUuid } from "../store/answerStore.js";

export interface LawyerProfile {
  ad: string;
  unvan: string;
  baro: string;
  sicilNo: string;
  adres: string;
  telefon: string;
  eposta: string;
  uetsAdresi: string;
  vergiDairesi: string;
  vergiNo: string;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Preferences {
  defaultCity: string;
  /** 'today' or an ISO date 'YYYY-MM-DD'. */
  defaultAsOf: string;
  theme: ThemePreference;
  showDemoPresets: boolean;
}

export interface Settings {
  profile: LawyerProfile;
  preferences: Preferences;
}

export const PROFILE_KEYS = [
  "ad",
  "unvan",
  "baro",
  "sicilNo",
  "adres",
  "telefon",
  "eposta",
  "uetsAdresi",
  "vergiDairesi",
  "vergiNo",
] as const satisfies ReadonlyArray<keyof LawyerProfile>;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  profile: Object.freeze({
    ad: "",
    unvan: "",
    baro: "",
    sicilNo: "",
    adres: "",
    telefon: "",
    eposta: "",
    uetsAdresi: "",
    vergiDairesi: "",
    vergiNo: "",
  }),
  preferences: Object.freeze({
    defaultCity: "",
    defaultAsOf: "today",
    theme: "system",
    showDemoPresets: true,
  }),
}) as Settings;

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<Settings>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lay an untrusted stored document over the defaults, field by field. */
export function normalizeSettings(raw: { profile?: unknown; preferences?: unknown } | undefined): Settings {
  const profileIn = (raw?.profile ?? {}) as Record<string, unknown>;
  const prefsIn = (raw?.preferences ?? {}) as Record<string, unknown>;
  const profile = { ...DEFAULT_SETTINGS.profile };
  for (const key of PROFILE_KEYS) {
    const value = profileIn[key];
    if (typeof value === "string") profile[key] = value;
  }
  const theme = prefsIn["theme"];
  const asOf = prefsIn["defaultAsOf"];
  const city = prefsIn["defaultCity"];
  const demo = prefsIn["showDemoPresets"];
  const preferences: Preferences = {
    defaultCity: typeof city === "string" ? city : DEFAULT_SETTINGS.preferences.defaultCity,
    defaultAsOf:
      asOf === "today" || (typeof asOf === "string" && ISO_DATE_RE.test(asOf))
        ? asOf
        : DEFAULT_SETTINGS.preferences.defaultAsOf,
    theme: theme === "light" || theme === "dark" || theme === "system" ? theme : DEFAULT_SETTINGS.preferences.theme,
    showDemoPresets: typeof demo === "boolean" ? demo : DEFAULT_SETTINGS.preferences.showDemoPresets,
  };
  return { profile, preferences };
}

export class InMemorySettingsStore implements SettingsStore {
  private current: Settings = normalizeSettings(undefined);

  async load(): Promise<Settings> {
    return structuredClone(this.current);
  }

  async save(settings: Settings): Promise<Settings> {
    this.current = normalizeSettings(settings);
    return structuredClone(this.current);
  }
}

export interface PgSettingsStoreOptions {
  sql: Sql;
  tenantId?: string;
}

export class PgSettingsStore implements SettingsStore {
  private readonly sql: Sql;
  private readonly tenantId: string;

  constructor(options: PgSettingsStoreOptions) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
  }

  async load(): Promise<Settings> {
    const rows = await this.sql`
      select key, value from app_private.settings
      where tenant_id = ${this.tenantId} and key in ('profile', 'preferences')`;
    const docs: { profile?: unknown; preferences?: unknown } = {};
    for (const row of rows as SqlRow[]) {
      if (row["key"] === "profile") docs.profile = row["value"];
      if (row["key"] === "preferences") docs.preferences = row["value"];
    }
    return normalizeSettings(docs);
  }

  async save(settings: Settings): Promise<Settings> {
    const normalized = normalizeSettings(settings);
    await this.sql`
      insert into app_private.settings (tenant_id, key, value, updated_at)
      values (${this.tenantId}, 'profile', ${this.sql.json(normalized.profile as never)}, now()),
             (${this.tenantId}, 'preferences', ${this.sql.json(normalized.preferences as never)}, now())
      on conflict (tenant_id, key) do update set
        value = excluded.value,
        updated_at = now()`;
    return normalized;
  }
}

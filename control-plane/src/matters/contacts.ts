/**
 * Kişi kartları (contact cards) + menfaat çatışması taraması — W14, B-42.
 *
 * Today `client` / `opposing` are free text on the matter and are retyped into
 * every draft, so a conflict-of-interest scan is impossible: the same person
 * is "Ahmet Yılmaz", "AHMET YILMAZ" and "Yılmaz, Ahmet" in three matters.
 * A contact is entered ONCE and referenced; the same identity can then be
 * checked across every matter before a new one is opened.
 *
 * Storage: `app_private.settings` (tenant_id, key, value jsonb) under the key
 * 'contacts' — the SAME table the lawyer profile uses. Deliberately no new
 * table: migrations belong to L-SAFE, a solo practice holds hundreds of
 * contacts (not millions), and the document is read whole on every call.
 *
 * The conflict scan is lexical and local: Turkish-folded name equality
 * against `matters.client` / `matters.opposing`. It never claims to be a
 * legal conclusion — the response carries the Turkish sentence the console
 * shows and the matters it found, and the lawyer decides.
 */

import { randomUUID } from "node:crypto";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID, assertUuid } from "../store/answerStore.js";
import type { MatterStore, MatterSummary } from "./types.js";

export const CONTACT_ROLES = [
  "muvekkil",
  "karsi-taraf",
  "vekil",
  "tanik",
  "bilirkisi",
  "diger",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  muvekkil: "Müvekkil",
  "karsi-taraf": "Karşı taraf",
  vekil: "Karşı vekil",
  tanik: "Tanık",
  bilirkisi: "Bilirkişi",
  diger: "Diğer",
};

export interface Contact {
  id: string;
  ad: string;
  tckn: string;
  vkn: string;
  adres: string;
  telefon: string;
  eposta: string;
  uetsAdresi: string;
  rol: ContactRole;
  notlar: string;
  createdAt: string;
  updatedAt: string;
}

export type NewContact = Omit<Contact, "id" | "createdAt" | "updatedAt">;

/** Settings key the contacts document lives under. */
export const CONTACTS_SETTINGS_KEY = "contacts";

/** Hard ceiling on the document (a solo practice, not a CRM). */
export const MAX_CONTACTS = 2000;

export interface ContactStore {
  list(): Promise<Contact[]>;
  save(contacts: readonly Contact[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Normalisation / validation helpers (pure)
// ---------------------------------------------------------------------------

/** Fold a party name for comparison: Turkish-insensitive, single-spaced. */
export function foldName(name: string): string {
  return normalizeTurkishSearch(name).replace(/\s+/gu, " ").trim();
}

/** Digits only (a lawyer types "123 456 789 01"). */
export function digitsOnly(value: string): string {
  return value.replace(/\D/gu, "");
}

/**
 * T.C. kimlik numarası check (11 digits, first non-zero, the two official
 * check digits). Used as a WARNING, never as a rejection: a foreign client
 * has no TCKN and a company has a VKN instead.
 */
export function isValidTckn(value: string): boolean {
  const d = digitsOnly(value);
  if (d.length !== 11 || d[0] === "0") return false;
  const n = [...d].map((c) => Number(c));
  const odd = n[0]! + n[2]! + n[4]! + n[6]! + n[8]!;
  const even = n[1]! + n[3]! + n[5]! + n[7]!;
  const tenth = (odd * 7 - even) % 10;
  if (((tenth + 10) % 10) !== n[9]) return false;
  const sumFirstTen = n.slice(0, 10).reduce((a, b) => a + b, 0);
  return sumFirstTen % 10 === n[10];
}

/** Vergi kimlik numarası: exactly 10 digits (no public checksum contract). */
export function isVknShaped(value: string): boolean {
  return digitsOnly(value).length === 10;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

export function normalizeContact(raw: unknown): Contact | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const id = rec["id"];
  const ad = rec["ad"];
  if (typeof id !== "string" || id === "" || typeof ad !== "string" || ad.trim() === "") {
    return undefined;
  }
  const text = (key: string): string => (typeof rec[key] === "string" ? String(rec[key]) : "");
  const rol = text("rol");
  return {
    id,
    ad: ad.trim(),
    tckn: text("tckn"),
    vkn: text("vkn"),
    adres: text("adres"),
    telefon: text("telefon"),
    eposta: text("eposta"),
    uetsAdresi: text("uetsAdresi"),
    rol: (CONTACT_ROLES as readonly string[]).includes(rol) ? (rol as ContactRole) : "diger",
    notlar: text("notlar"),
    createdAt: text("createdAt"),
    updatedAt: text("updatedAt"),
  };
}

export function normalizeContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  const out: Contact[] = [];
  for (const entry of raw) {
    const contact = normalizeContact(entry);
    if (contact !== undefined) out.push(contact);
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export class InMemoryContactStore implements ContactStore {
  private contacts: Contact[] = [];

  async list(): Promise<Contact[]> {
    return this.contacts.map((c) => ({ ...c }));
  }

  async save(contacts: readonly Contact[]): Promise<void> {
    this.contacts = contacts.slice(0, MAX_CONTACTS).map((c) => ({ ...c }));
  }
}

export class PgContactStore implements ContactStore {
  private readonly sql: Sql;
  private readonly tenantId: string;

  constructor(options: { sql: Sql; tenantId?: string }) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
  }

  async list(): Promise<Contact[]> {
    const rows = await this.sql`
      select value from app_private.settings
      where tenant_id = ${this.tenantId} and key = ${CONTACTS_SETTINGS_KEY}`;
    const row = rows[0] as SqlRow | undefined;
    return normalizeContacts(row?.["value"]);
  }

  async save(contacts: readonly Contact[]): Promise<void> {
    const bounded = contacts.slice(0, MAX_CONTACTS);
    await this.sql`
      insert into app_private.settings (tenant_id, key, value, updated_at)
      values (${this.tenantId}, ${CONTACTS_SETTINGS_KEY},
              ${this.sql.json(bounded as never)}, now())
      on conflict (tenant_id, key) do update set
        value = excluded.value,
        updated_at = now()`;
  }
}

// ---------------------------------------------------------------------------
// Conflict scan
// ---------------------------------------------------------------------------

/** One matter the scanned name already appears in, and on which side. */
export interface ConflictHit {
  matterId: string;
  matterTitle: string;
  /** Which field of the matter matched. */
  side: "client" | "opposing";
  status: string;
}

export interface ConflictReport {
  ad: string;
  /** The role the lawyer is about to file this person under. */
  rol: ContactRole;
  /** Matters where the name is on the OPPOSITE side — the actual warning. */
  conflicts: ConflictHit[];
  /** Matters where the name is on the SAME side ("bu müvekkilin dosyaları"). */
  sameSide: ConflictHit[];
  hasConflict: boolean;
  /** The exact Turkish sentence the console shows (never assembled there). */
  message: string;
}

export const NO_CONFLICT_MESSAGE_TR =
  "Bu ad, açık dosyalarınızda karşı taraf olarak geçmiyor. Tarama yalnız ad " +
  "benzerliğine bakar; menfaat çatışması değerlendirmesi size aittir.";

export function conflictMessage(conflicts: readonly ConflictHit[]): string {
  if (conflicts.length === 0) return NO_CONFLICT_MESSAGE_TR;
  const first = conflicts[0]!;
  const rest = conflicts.length - 1;
  const tail = rest > 0 ? ` ve ${rest} dosyada daha` : "";
  const where = first.side === "opposing" ? "karşı taraf" : "müvekkil";
  return (
    `Menfaat çatışması olabilir: bu ad “${first.matterTitle}” dosyasında ` +
    `${where} olarak geçiyor${tail}. Dosyayı açmadan önce kontrol edin.`
  );
}

/**
 * Scan every matter for the folded name. `rol` decides which side counts as a
 * conflict: a müvekkil that already appears as karşı taraf (and the reverse).
 */
export function scanConflicts(
  ad: string,
  rol: ContactRole,
  matters: readonly MatterSummary[],
): ConflictReport {
  const needle = foldName(ad);
  const conflicts: ConflictHit[] = [];
  const sameSide: ConflictHit[] = [];
  if (needle !== "") {
    // A contact filed as "karşı taraf"/"vekil" conflicts when the same name is
    // already OUR client; anything else conflicts when it is the opposing side.
    const opposingSideRole = rol === "karsi-taraf" || rol === "vekil";
    for (const matter of matters) {
      const asClient = foldName(matter.client) === needle;
      const asOpposing = foldName(matter.opposing) === needle;
      const hit = (side: "client" | "opposing"): ConflictHit => ({
        matterId: matter.id,
        matterTitle: matter.title,
        side,
        status: matter.status,
      });
      if (asClient) (opposingSideRole ? conflicts : sameSide).push(hit("client"));
      if (asOpposing) (opposingSideRole ? sameSide : conflicts).push(hit("opposing"));
    }
  }
  return {
    ad,
    rol,
    conflicts,
    sameSide,
    hasConflict: conflicts.length > 0,
    message: conflictMessage(conflicts),
  };
}

// ---------------------------------------------------------------------------
// Service (used by the router)
// ---------------------------------------------------------------------------

export interface ContactServiceDeps {
  store: ContactStore;
  matters: MatterStore;
  now?: () => Date;
}

export class ContactService {
  private readonly store: ContactStore;
  private readonly matters: MatterStore;
  private readonly now: () => Date;

  constructor(deps: ContactServiceDeps) {
    this.store = deps.store;
    this.matters = deps.matters;
    this.now = deps.now ?? (() => new Date());
  }

  async list(opts: { q?: string; rol?: ContactRole } = {}): Promise<Contact[]> {
    const all = await this.store.list();
    const needle = opts.q === undefined ? "" : foldName(opts.q);
    return all
      .filter((c) => opts.rol === undefined || c.rol === opts.rol)
      .filter(
        (c) =>
          needle === "" ||
          foldName(c.ad).includes(needle) ||
          digitsOnly(c.tckn).includes(digitsOnly(needle)) ||
          foldName(c.eposta).includes(needle),
      )
      .sort((a, b) => a.ad.localeCompare(b.ad, "tr-TR"));
  }

  async get(id: string): Promise<Contact | undefined> {
    return (await this.store.list()).find((c) => c.id === id);
  }

  async create(input: NewContact): Promise<Contact | { error: "LIMIT" }> {
    const all = await this.store.list();
    if (all.length >= MAX_CONTACTS) return { error: "LIMIT" };
    const at = nowIso(this.now);
    const contact: Contact = { ...input, id: randomUUID(), createdAt: at, updatedAt: at };
    await this.store.save([...all, contact]);
    return contact;
  }

  async update(id: string, patch: Partial<NewContact>): Promise<Contact | undefined> {
    const all = await this.store.list();
    const index = all.findIndex((c) => c.id === id);
    if (index < 0) return undefined;
    const next: Contact = { ...all[index]!, ...patch, updatedAt: nowIso(this.now) };
    const copy = [...all];
    copy[index] = next;
    await this.store.save(copy);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.store.list();
    const kept = all.filter((c) => c.id !== id);
    if (kept.length === all.length) return false;
    await this.store.save(kept);
    return true;
  }

  async conflictCheck(ad: string, rol: ContactRole): Promise<ConflictReport> {
    const matters = await this.matters.list({});
    return scanConflicts(ad, rol, matters);
  }
}

/**
 * Kişi kartları HTTP lane — W14, B-42.
 *
 *   GET    /v1/contacts?q=&rol=        { contacts: Contact[] }
 *   POST   /v1/contacts                201 Contact (+ warnings[])
 *   GET    /v1/contacts/{id}           200 Contact
 *   PATCH  /v1/contacts/{id}           200 Contact
 *   DELETE /v1/contacts/{id}           204
 *   POST   /v1/contacts/conflict-check 200 ConflictReport
 *
 * The conflict check is a POST on purpose: a party's name is personal data
 * and must not travel in a query string (it lands in server logs and browser
 * history).
 *
 * A malformed TCKN / VKN is a WARNING, never a rejection — a foreign client
 * has no TCKN and a company has a VKN — but the lawyer is told, because a
 * mistyped identity number is what breaks a tebligat.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import {
  CONTACT_ROLES,
  ContactService,
  MAX_CONTACTS,
  isValidTckn,
  isVknShaped,
  type Contact,
  type ContactRole,
} from "./contacts.js";

export {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  ContactService,
  InMemoryContactStore,
  PgContactStore,
  scanConflicts,
  type Contact,
  type ContactRole,
  type ContactStore,
  type ConflictReport,
} from "./contacts.js";

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };
const text = (max: number) => z.string(REQ).max(max, `En fazla ${max} karakter.`);

const roleEnum = z.enum(CONTACT_ROLES, {
  errorMap: () => ({
    message: "Rol: muvekkil, karsi-taraf, vekil, tanik, bilirkisi veya diger olmalı.",
  }),
});

export const newContactSchema = z
  .object({
    ad: z.string(REQ).trim().min(1, "Ad boş bırakılamaz.").max(300, "En fazla 300 karakter."),
    tckn: text(20).optional(),
    vkn: text(20).optional(),
    adres: text(1000).optional(),
    telefon: text(50).optional(),
    eposta: text(200).optional(),
    uetsAdresi: text(200).optional(),
    rol: roleEnum.optional(),
    notlar: text(5000).optional(),
  })
  .strict("Tanınmayan alan.");

export const contactPatchSchema = newContactSchema.partial().strict("Tanınmayan alan.");

export const conflictRequestSchema = z
  .object({
    ad: z.string(REQ).trim().min(1, "Ad boş bırakılamaz.").max(300, "En fazla 300 karakter."),
    rol: roleEnum.optional(),
  })
  .strict("Tanınmayan alan.");

function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

/** V-19: an unrecognized key is named by its own path, never by "". */
function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return fieldIssues(error, turkishZodMessage);
}

const invalid = (c: Context, message: string, issues: Array<{ path: string; message: string }> = []) =>
  c.json({ error: { kind: "INVALID_REQUEST", message, issues } }, 400);

const notFound = (c: Context) =>
  c.json({ error: { kind: "NOT_FOUND", message: "Kişi kaydı bulunamadı." } }, 404);

const storeUnavailable = (c: Context) =>
  c.json(
    {
      error: {
        kind: "STORE_UNAVAILABLE",
        message: "Yerel veritabanına ulaşılamadı; kişi kartları açılamıyor.",
      },
    },
    503,
  );

export const TCKN_WARNING_TR =
  "T.C. kimlik numarası doğrulanamadı (11 hane ve kontrol hanesi tutmuyor); kayıt yine de saklandı.";
export const VKN_WARNING_TR =
  "Vergi kimlik numarası 10 haneli değil; kayıt yine de saklandı.";

/** Identity-number warnings for a contact (never a rejection). */
export function contactWarnings(contact: Pick<Contact, "tckn" | "vkn">): string[] {
  const warnings: string[] = [];
  if (contact.tckn !== "" && !isValidTckn(contact.tckn)) warnings.push(TCKN_WARNING_TR);
  if (contact.vkn !== "" && !isVknShaped(contact.vkn)) warnings.push(VKN_WARNING_TR);
  return warnings;
}

export interface ContactsRouterDeps {
  service: ContactService;
}

export function createContactsRouter(deps: ContactsRouterDeps): Hono {
  const app = new Hono();
  const { service } = deps;

  const guarded = async <T>(
    c: Context,
    work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: await work() };
    } catch {
      return { ok: false, response: storeUnavailable(c) };
    }
  };

  app.get("/v1/contacts", async (c) => {
    const rol = c.req.query("rol");
    if (rol !== undefined && !(CONTACT_ROLES as readonly string[]).includes(rol)) {
      return invalid(c, "Kişi listesi filtresi doğrulanamadı.", [
        { path: "rol", message: "Rol: muvekkil, karsi-taraf, vekil, tanik, bilirkisi veya diger olmalı." },
      ]);
    }
    const q = c.req.query("q");
    if (q !== undefined && q.length > 200) {
      return invalid(c, "Kişi listesi filtresi doğrulanamadı.", [
        { path: "q", message: "Arama en fazla 200 karakter." },
      ]);
    }
    const result = await guarded(c, () =>
      service.list({
        ...(q !== undefined ? { q } : {}),
        ...(rol !== undefined ? { rol: rol as ContactRole } : {}),
      }),
    );
    if (!result.ok) return result.response;
    return c.json({ contacts: result.value }, 200);
  });

  // Registered BEFORE /v1/contacts/:id so the literal segment wins.
  app.post("/v1/contacts/conflict-check", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, "İstek gövdesi JSON olmalı.");
    }
    const parsed = conflictRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(c, "Çatışma taraması doğrulanamadı.", issuesOf(parsed.error));
    }
    const result = await guarded(c, () =>
      service.conflictCheck(parsed.data.ad, parsed.data.rol ?? "muvekkil"),
    );
    if (!result.ok) return result.response;
    return c.json(result.value, 200);
  });

  app.post("/v1/contacts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, "İstek gövdesi JSON olmalı.");
    }
    const parsed = newContactSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(c, "Kişi kartı doğrulanamadı — eksik veya hatalı alanlar var.", issuesOf(parsed.error));
    }
    const input = {
      ad: parsed.data.ad,
      tckn: parsed.data.tckn ?? "",
      vkn: parsed.data.vkn ?? "",
      adres: parsed.data.adres ?? "",
      telefon: parsed.data.telefon ?? "",
      eposta: parsed.data.eposta ?? "",
      uetsAdresi: parsed.data.uetsAdresi ?? "",
      rol: parsed.data.rol ?? "diger",
      notlar: parsed.data.notlar ?? "",
    };
    const result = await guarded(c, () => service.create(input));
    if (!result.ok) return result.response;
    if ("error" in result.value) {
      return c.json(
        {
          error: {
            kind: "LIMIT_EXCEEDED",
            message: `Kişi kartı sayısı sınırı aşıldı (en fazla ${MAX_CONTACTS}).`,
          },
        },
        409,
      );
    }
    const contact = result.value;
    const warnings = contactWarnings(contact);
    // The conflict scan runs on creation too: the warning is worth more
    // before the matter is opened than after.
    const report = await guarded(c, () => service.conflictCheck(contact.ad, contact.rol));
    return c.json(
      {
        ...contact,
        warnings,
        ...(report.ok ? { conflict: report.value } : {}),
      },
      201,
    );
  });

  app.get("/v1/contacts/:id", async (c) => {
    const result = await guarded(c, () => service.get(c.req.param("id")));
    if (!result.ok) return result.response;
    if (result.value === undefined) return notFound(c);
    return c.json({ ...result.value, warnings: contactWarnings(result.value) }, 200);
  });

  app.patch("/v1/contacts/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, "İstek gövdesi JSON olmalı.");
    }
    const parsed = contactPatchSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(c, "Kişi kartı güncellemesi doğrulanamadı.", issuesOf(parsed.error));
    }
    const result = await guarded(c, () => service.update(c.req.param("id"), parsed.data));
    if (!result.ok) return result.response;
    if (result.value === undefined) return notFound(c);
    return c.json({ ...result.value, warnings: contactWarnings(result.value) }, 200);
  });

  app.delete("/v1/contacts/:id", async (c) => {
    const result = await guarded(c, () => service.remove(c.req.param("id")));
    if (!result.ok) return result.response;
    if (!result.value) return notFound(c);
    return c.body(null, 204);
  });

  return app;
}

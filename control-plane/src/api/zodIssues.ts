/**
 * One validation issue per offending FIELD (W14 phase C, V-19).
 *
 * THE DEFECT. Every `.strict()` schema in this API answers a stray field with
 * a zod `unrecognized_keys` issue. That issue is reported at the PARENT
 * object's path with the offending key names in `issue.keys` — so for a
 * top-level object `issue.path` is the EMPTY ARRAY, `issue.path.join(".")` is
 * `""`, and the response carried
 *
 *     {"path":"","label":"","message":"Tanınmayan alan."}
 *
 * which no interface can point at: the console highlights the field named by
 * `path`, and `""` names nothing. Measured on `POST /v1/drafts` and
 * `POST /v1/matters/{id}/items` (W14-F-VERIFY §3, V-19). The lawyer was told
 * "there is an unrecognized field" and never told WHICH.
 *
 * THE RULE. An unrecognized key becomes ONE issue per key, whose `path` is
 * the key's own dotted path (`bogusAlan`, `payload.bilinmeyen`), so the
 * caller — and the label lookup that turns a path into Turkish
 * (`drafting/templates.ts :: labelForPath`) — has something to name. Every
 * other issue keeps the path zod gave it.
 *
 * Joining the keys into a single dotted string (`a.b` for two stray fields)
 * was the shape `ai/routes.ts` used; it reads as ONE nested path that does
 * not exist. Two stray fields are two issues.
 *
 * The message stays the caller's translated text: the field is named by
 * `path`, not by prose, and the pinned Turkish sentence ("Tanınmayan alan.")
 * is what every existing test and every screen already reads.
 */

import type { z } from "zod";

export interface FieldIssue {
  /** Dotted path of the field the caller must fix. Never empty for a strict key. */
  path: string;
  message: string;
}

/**
 * The ONE Turkish sentence every `.strict()` schema in this API answers a
 * stray field with. Kept here so the routes that must recognise it (to give
 * the field a human label) and the routes that produce it cannot drift.
 */
export const UNRECOGNIZED_FIELD_MESSAGE_TR = "Tanınmayan alan.";

/**
 * Human label for a field no schema knows: Turkish sentence first, the key
 * itself in parentheses (the dictionary rule). `labelForPath` would echo the
 * bare key, and a bare machine token is not a label.
 */
export function unrecognizedFieldLabel(path: string): string {
  return `Fazladan alan (${path})`;
}

/**
 * A residual zod default message in lawyer Turkish (the dictionary rule),
 * for a route that has no dictionary of its own (W22: the matter-analysis and
 * review-table routes answered a bad body with zod's English, "Invalid enum
 * value. Expected 'full_review' | ..."). The field is named by `path`; an
 * unknown message is passed through unchanged.
 */
export function zodMessageTr(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim; izin verilen değerlerden biri olmalı.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return UNRECOGNIZED_FIELD_MESSAGE_TR;
  if (message.startsWith("String must contain at least")) return "Değer çok kısa.";
  if (message.startsWith("String must contain at most")) return "Değer çok uzun.";
  if (message.startsWith("Array must contain at least")) return "Liste en az bir öğe içermeli.";
  if (message.startsWith("Array must contain at most")) return "Listede izin verilenden fazla öğe var.";
  if (message.startsWith("Number must be")) return "Sayı izin verilen aralıkta değil.";
  if (message.startsWith("Invalid uuid")) return "Geçersiz kimlik.";
  if (message.startsWith("Invalid date")) return "Geçersiz tarih.";
  return message;
}

/** zod's `unrecognized_keys` issue carries the offending names in `keys`. */
function unrecognizedKeys(issue: z.ZodIssue): readonly (string | number)[] | undefined {
  if (issue.code !== "unrecognized_keys") return undefined;
  const keys = (issue as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.length > 0 ? (keys as (string | number)[]) : undefined;
}

/**
 * Flatten a `ZodError` into one issue per offending field.
 *
 * @param translate maps a residual zod default message to lawyer Turkish;
 *                  the caller owns its own dictionary (they differ per route).
 * @param prefix    dotted prefix for a sub-schema parsed on its own
 *                  (`"payload."` in the matter-item routes).
 */
export function fieldIssues(
  error: z.ZodError,
  translate: (message: string) => string = (message) => message,
  prefix = "",
): FieldIssue[] {
  const out: FieldIssue[] = [];
  for (const issue of error.issues) {
    const message = translate(issue.message);
    const keys = unrecognizedKeys(issue);
    if (keys !== undefined) {
      for (const key of keys) {
        out.push({ path: prefix + [...issue.path, key].join("."), message });
      }
      continue;
    }
    out.push({ path: prefix + issue.path.join("."), message });
  }
  return out;
}

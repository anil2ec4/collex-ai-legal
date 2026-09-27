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
    if (issue.path.length === 0) {
      // W17/c — MEASURED: a body that is not an object at all ("metin", [],
      // null) produced {"path": "", "message": "Expected object, received
      // string"} — an empty path the console cannot point at, in English.
      // The whole body is the field, and it is named.
      out.push({
        path: prefix.replace(/\.$/u, "") || BODY_PATH,
        message: issue.code === "invalid_type" ? BODY_NOT_OBJECT_MESSAGE_TR : message,
      });
      continue;
    }
    out.push({ path: prefix + issue.path.join("."), message });
  }
  return out;
}

/** The path an issue about the request body AS A WHOLE is reported at. */
export const BODY_PATH = "body";

/** The Turkish sentence for a request body that is not a JSON object. */
export const BODY_NOT_OBJECT_MESSAGE_TR =
  "İstek gövdesi alanlardan oluşan bir nesne olmalı; gönderilen gövde bir nesne değil.";

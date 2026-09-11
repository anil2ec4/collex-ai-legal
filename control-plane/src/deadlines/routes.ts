/**
 * Süre hesabı hono sub-router (contract [S]).
 *
 *   GET  /v1/deadlines/rules            { rules: DeadlineRule[], disclaimer }
 *   GET  /v1/deadlines/holidays?year=   { year, holidays, adliTatil, ... }   (additive)
 *   POST /v1/deadlines/compute          { ruleId? | custom?, startDate, applyAdliTatil? }
 *                                       -> DeadlineComputation (200)
 *
 * Errors: 400 { error: { kind: 'INVALID_REQUEST', message, issues[] } } for
 * malformed bodies and unknown rules; 400 { kind: 'RULE_NOT_COMPUTABLE' } for
 * note-only rules. Messages are Turkish; codes stay English UPPER_SNAKE.
 *
 * Exported as `createDeadlinesRouter(deps)`; the API integration mounts it at
 * '/' (this lane does NOT touch src/api/server.ts). Pure: no DB, no clock.
 */

import { Hono } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import { computeDeadline, DeadlineInputError } from "./calc.js";
import { ADLI_TATIL_LABEL, adliTatilRange, holidaysForYear, religiousCalendarCovers } from "./holidays.js";
import { toIsoDate } from "./dates.js";
import { DEADLINE_DISCLAIMER, DEADLINE_RULES, type DeadlineRule } from "./rules.js";

/** zod messages are user-facing: Turkish, never "Required". */
const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

const customPeriodSchema = z
  .object({
    value: z.number(REQ).int("Tam sayı olmalı.").min(1, "En az 1 olmalı."),
    unit: z.enum(["gun", "hafta", "ay", "yil"], {
      required_error: "Birim zorunludur.",
      invalid_type_error: "Birim 'gun', 'hafta', 'ay' veya 'yil' olmalı.",
    }),
  })
  .strict("Tanınmayan alan.");

export const computeRequestSchema = z
  .object(
    {
      ruleId: z
        .string(REQ)
        .min(1, "Kural kimliği boş olamaz.")
        .max(100, "En fazla 100 karakter.")
        .optional(),
      custom: customPeriodSchema.optional(),
      startDate: z
        .string(REQ)
        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Tarih YYYY-AA-GG biçiminde olmalı (ör. 2026-09-03)."),
      applyAdliTatil: z.boolean(REQ).optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

export type ComputeRequest = z.infer<typeof computeRequestSchema>;

/** Residual zod default messages, translated (Türkçe). */
function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

export interface DeadlinesRouterDeps {
  /** Rule registry; defaults to DEADLINE_RULES (tests may inject a subset). */
  rules?: readonly DeadlineRule[];
}

export function createDeadlinesRouter(deps: DeadlinesRouterDeps = {}): Hono {
  const app = new Hono();
  const rules = deps.rules ?? DEADLINE_RULES;

  app.get("/v1/deadlines/rules", (c) =>
    c.json(
      {
        rules,
        disclaimer: DEADLINE_DISCLAIMER,
        adliTatil: { label: ADLI_TATIL_LABEL, basis: "HMK m.102 / İYUK m.61" },
      },
      200,
    ),
  );

  app.get("/v1/deadlines/holidays", (c) => {
    const raw = c.req.query("year") ?? "";
    const year = /^\d{4}$/u.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "year parametresi dört haneli bir yıl olmalı (ör. 2026).",
            issues: [{ path: "year", message: "Geçersiz yıl." }],
          },
        },
        400,
      );
    }
    const range = adliTatilRange(year);
    return c.json(
      {
        year,
        holidays: holidaysForYear(year),
        adliTatil: { start: toIsoDate(range.start), end: toIsoDate(range.end), label: ADLI_TATIL_LABEL },
        religiousCalendarCovered: religiousCalendarCovers(year),
        source: "2429 sayılı Kanun (sabit günler); dinî bayramlar: Diyanet takvimi — doğrulayın",
        note: "Arife günleri ve 28 Ekim öğleden sonra tatildir; hesapta iş günü sayılır (ihtiyatlı). İdari izin günleri resmî tatil değildir.",
        disclaimer: DEADLINE_DISCLAIMER,
      },
      200,
    );
  });

  app.post("/v1/deadlines/compute", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } },
        400,
      );
    }
    const parsed = computeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Süre hesabı isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error, turkishZodMessage),
          },
        },
        400,
      );
    }
    const request = parsed.data;
    try {
      const result = computeDeadline(
        {
          ...(request.ruleId !== undefined ? { ruleId: request.ruleId } : {}),
          ...(request.custom !== undefined ? { custom: request.custom } : {}),
          startDate: request.startDate,
          ...(request.applyAdliTatil !== undefined ? { applyAdliTatil: request.applyAdliTatil } : {}),
        },
        { rules },
      );
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof DeadlineInputError) {
        return c.json(
          {
            error: {
              kind: error.kind,
              message: error.message,
              issues: [{ path: error.path ?? "", message: error.message }],
            },
          },
          400,
        );
      }
      throw error;
    }
  });

  return app;
}

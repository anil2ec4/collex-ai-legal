/**
 * Faiz hesabı hono sub-router (W23).
 *
 *   GET  /v1/interest/rates     { kinds[], periods[], disclaimer }
 *   POST /v1/interest/compute   { kind, principal, from, to, periods?, dayBasis? } -> InterestComputation
 *
 * Errors: 400 { error: { kind: 'INVALID_REQUEST', message, issues[] } } with
 * Turkish messages. Pure: no DB, no clock.
 */

import { Hono } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";

import { computeInterest, InterestInputError } from "./calc.js";
import { INTEREST_DISCLAIMER, INTEREST_KIND_LABELS_TR, INTEREST_KINDS, YASAL_FAIZ_PERIODS } from "./rates.js";

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };
const isoDate = z.string(REQ).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, "Tarih YYYY-AA-GG biçiminde olmalı.");

export const interestComputeRequestSchema = z
  .object(
    {
      kind: z.enum(["yasal", "ticari-avans", "sozlesmesel"], {
        required_error: "Faiz türü zorunludur.",
        invalid_type_error: "Faiz türü: yasal, ticari-avans veya sozlesmesel.",
      }),
      principal: z.number(REQ).positive("Anapara sıfırdan büyük olmalı.").max(1e15, "Anapara çok büyük.").finite(),
      from: isoDate,
      to: isoDate,
      periods: z
        .array(
          z
            .object(
              {
                from: isoDate,
                to: isoDate,
                annualPercent: z.number(REQ).min(0, "Oran negatif olamaz.").max(1000, "Oran çok büyük.").finite(),
                source: z.string(REQ).min(1, "Oranın kaynağını yazın.").max(300, "En fazla 300 karakter."),
              },
              REQ,
            )
            .strict("Tanınmayan alan."),
        )
        .max(60, "En fazla 60 dönem girilebilir.")
        .optional(),
      dayBasis: z.union([z.literal(365), z.literal(360)], { invalid_type_error: "Yıl esası 365 ya da 360 olmalı." }).optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

function invalid(issues: Array<{ path: string; message: string }>) {
  return {
    error: {
      kind: "INVALID_REQUEST",
      message: "Faiz isteği doğrulanamadı — eksik veya hatalı alanlar var.",
      issues,
    },
  };
}

export function createInterestRouter(): Hono {
  const app = new Hono();

  app.get("/v1/interest/rates", (c) =>
    c.json({
      kinds: INTEREST_KINDS.map((id) => ({ id, label: INTEREST_KIND_LABELS_TR[id] })),
      periods: YASAL_FAIZ_PERIODS,
      disclaimer: INTEREST_DISCLAIMER,
    }),
  );

  app.post("/v1/interest/compute", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(invalid([{ path: "body", message: "İstek gövdesi geçerli JSON değil." }]), 400);
    }
    const parsed = interestComputeRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json(invalid(fieldIssues(parsed.error)), 400);
    try {
      return c.json(computeInterest(parsed.data), 200);
    } catch (error) {
      if (error instanceof InterestInputError) {
        return c.json(invalid([{ path: error.path, message: error.message }]), 400);
      }
      throw error;
    }
  });

  return app;
}

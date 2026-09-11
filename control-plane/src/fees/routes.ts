/**
 * Harç / parasal sınır / AAÜT hono sub-router (W14 B-35).
 *
 *   GET  /v1/fees/tariffs?year=2026   { year, years, groups, lines[], disclaimer }
 *   POST /v1/fees/compute             { year, kind, davaDegeri?, mahkeme?, yol?, overrides? }
 *                                     -> FeeComputation (200)
 *
 * Errors: 400 { error: { kind: 'INVALID_REQUEST' | 'TARIFF_YEAR_NOT_FOUND' |
 * 'TARIFF_LINE_NOT_FOUND', message, issues[] } }. Messages are Turkish; codes
 * stay English UPPER_SNAKE.
 *
 * Exported as `createFeesRouter(deps)`; the API integration mounts it at '/'
 * (this lane does NOT touch src/api/server.ts). Pure: no DB, no clock.
 */

import { Hono } from "hono";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";

import {
  computeFees,
  FEE_COMPUTE_KINDS,
  FEE_LIMIT_PATHS,
  FeeInputError,
  type FeeComputeInput,
} from "./calc.js";
import {
  FEE_DISCLAIMER,
  FEE_GROUP_LABELS_TR,
  FEE_LINE_GROUPS,
  FEE_TARIFFS,
  FEE_YEARS,
  findTariff,
  type FeeTariff,
} from "./tariffs.js";

/** zod messages are user-facing: Turkish, never "Required". */
const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

export const feeComputeRequestSchema = z
  .object(
    {
      year: z
        .number(REQ)
        .int("Yıl tam sayı olmalı.")
        .min(1900, "Yıl 1900'den küçük olamaz.")
        .max(2200, "Yıl 2200'den büyük olamaz."),
      kind: z.enum(["dava-harci", "vekalet-ucreti", "kesinlik-siniri"], {
        required_error: "Hesap türü zorunludur.",
        invalid_type_error: "Hesap türü: dava harcı, vekâlet ücreti veya kesinlik sınırı.",
      }),
      davaDegeri: z
        .number(REQ)
        .min(0, "Dava değeri sıfır veya sıfırdan büyük olmalı.")
        .finite("Dava değeri geçerli bir sayı olmalı.")
        .optional(),
      mahkeme: z
        .enum(["sulh", "asliye", "kanun-yolu"], {
          invalid_type_error: "Mahkeme: sulh, asliye veya kanun yolu.",
        })
        .optional(),
      yol: z
        .enum(["hmk-istinaf", "hmk-temyiz", "iik-istinaf", "iyuk-istinaf"], {
          invalid_type_error: "Kanun yolu seçimi geçersiz.",
        })
        .optional(),
      overrides: z
        .record(
          z.string().min(1, "Kalem kimliği boş olamaz.").max(100, "En fazla 100 karakter."),
          z.number(REQ).min(0, "Tutar sıfır veya sıfırdan büyük olmalı.").finite("Geçerli bir sayı girin."),
        )
        .optional(),
    },
    REQ,
  )
  .strict("Tanınmayan alan.");

export type FeeComputeRequest = z.infer<typeof feeComputeRequestSchema>;

/** Residual zod default messages, translated (Türkçe). */
function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

export interface FeesRouterDeps {
  /** Tariff registry; defaults to FEE_TARIFFS (tests may inject a subset). */
  tariffs?: readonly FeeTariff[];
}

export function createFeesRouter(deps: FeesRouterDeps = {}): Hono {
  const app = new Hono();
  const tariffs = deps.tariffs ?? FEE_TARIFFS;
  const years = tariffs.map((tariff) => tariff.year);
  const defaultYear = years.length > 0 ? Math.max(...years) : Number.NaN;

  app.get("/v1/fees/tariffs", (c) => {
    const raw = c.req.query("year") ?? "";
    const year = raw === "" ? defaultYear : /^\d{4}$/u.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(year)) {
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
    const tariff =
      deps.tariffs === undefined
        ? findTariff(year)
        : tariffs.find((candidate) => candidate.year === year);
    if (tariff === undefined) {
      return c.json(
        {
          error: {
            kind: "TARIFF_YEAR_NOT_FOUND",
            message: `${year} yılı için tarife tanımlı değil. Listedeki yıllardan birini seçin.`,
            issues: [{ path: "year", message: "Tanımlı olmayan yıl." }],
          },
        },
        400,
      );
    }
    return c.json(
      {
        year: tariff.year,
        years: deps.tariffs === undefined ? FEE_YEARS : years,
        groups: FEE_LINE_GROUPS.map((group) => ({ id: group, label: FEE_GROUP_LABELS_TR[group] })),
        lines: tariff.lines,
        disclaimer: FEE_DISCLAIMER,
        note:
          "Tutarı boş (null) olan kalemler her yıl Resmî Gazete'de yenilenir; ColleX bu yılın rakamını bilmez. Güncel tutarı hesaplama isteğinde 'overrides' ile girin.",
      },
      200,
    );
  });

  app.post("/v1/fees/compute", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } },
        400,
      );
    }
    const parsed = feeComputeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Harç hesabı isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error, turkishZodMessage),
          },
        },
        400,
      );
    }
    const request = parsed.data;
    const input: FeeComputeInput = {
      year: request.year,
      kind: request.kind,
      ...(request.davaDegeri !== undefined ? { davaDegeri: request.davaDegeri } : {}),
      ...(request.mahkeme !== undefined ? { mahkeme: request.mahkeme } : {}),
      ...(request.yol !== undefined ? { yol: request.yol } : {}),
      ...(request.overrides !== undefined ? { overrides: request.overrides } : {}),
    };
    try {
      const result = computeFees(input, deps.tariffs === undefined ? {} : { tariffs });
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof FeeInputError) {
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

export { FEE_COMPUTE_KINDS, FEE_LIMIT_PATHS };

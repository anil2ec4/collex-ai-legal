/**
 * W17/b — a dead archive is NOT "arandı, bulunamadı".
 *
 * The petition report keeps four contrary states apart on purpose, and the
 * whole point of the fourth is that an outage is not an absence of authority.
 * An adversarial audit measured that ARAMA_BASARISIZ was UNREACHABLE through
 * the only production port: `searchSources` catches every gateway throw and
 * every provider error into `failedSources` and then RESOLVES with `rows: []`,
 * and the port ignored those fields. So a lawyer whose MCP gateway was down
 * read "arandı, bulunamadı — Bu sorgu çalıştı ve sonuç getirmedi" for a search
 * that never reached a single source.
 *
 * This suite drives the MOUNTED app with a gateway that always rejects, which
 * is the exact production path.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
  CONTRARY_FAILED_TR,
  CONTRARY_LANE_LABEL_TR,
} from "../../src/contracts/petitionAnalysis.js";
import type { ProviderGateway } from "../../src/gateway/gateway.js";

const AS_OF = "2026-03-01";

const PETITION = [
  "İZMİR 3. ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "DAVALI : Sentetik A.Ş.",
  "",
  "AÇIKLAMALAR",
  "1. Taraflar arasında 10.03.2025 tarihinde kira sözleşmesi kurulmuştur.",
  "2. Davacının kira bedelinin uyarlanmasına ilişkin talebi yerinde değildir.",
  "",
  "SONUÇ VE İSTEM",
  "3. Davanın reddine karar verilmesini talep ederiz.",
].join("\n");

/** Every tool call fails, the way an unreachable MCP child fails. */
const deadGateway: ProviderGateway = {
  callTool: async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:8898");
  },
};

/** Answers normally, with nothing to report. */
const emptyGateway: ProviderGateway = {
  callTool: async () => ({
    status: "ok" as const,
    data: { decisions: [], total_records: 0 },
    provider: "BEDESTEN" as const,
    observedAt: "2026-03-02T09:00:00.000Z",
    warnings: [],
  }),
};

async function analyse(gateway: ProviderGateway): Promise<{
  claims: { contrary: { lanes: { state: string; reason: string; stateLabel: string }[] } }[];
}> {
  const app = createApp({ gateway });
  const res = await app.request("/v1/contracts/petition-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: PETITION, asOf: AS_OF }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as never;
}

describe("W17/b · an unreachable archive reports ARAMA_BASARISIZ", () => {
  it("never draws an outage as a completed search that found nothing", async () => {
    const body = await analyse(deadGateway);
    const lanes = body.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.length).toBeGreaterThan(0);
    // THE LINE. The state that says "we looked and there is nothing" may not
    // appear when nothing was looked at.
    expect(lanes.some((lane) => lane.state === "ARANDI_BULUNAMADI")).toBe(false);
    const failed = lanes.filter((lane) => lane.state === "ARAMA_BASARISIZ");
    expect(failed.length).toBeGreaterThan(0);
    for (const lane of failed) {
      expect(lane.reason).toBe(CONTRARY_FAILED_TR);
      expect(lane.stateLabel).toBe(CONTRARY_LANE_LABEL_TR.ARAMA_BASARISIZ);
    }
  });

  it("the driver's own text never reaches the report", async () => {
    const body = await analyse(deadGateway);
    const text = JSON.stringify(body);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("127.0.0.1");
  });

  it("says the outage is not a result", async () => {
    expect(CONTRARY_FAILED_TR).not.toContain("bulunamadı");
    expect(CONTRARY_FAILED_TR).toContain("Bu bir sonuç değildir");
  });

  it("NON-VACUITY: a source that really answers with nothing IS ARANDI_BULUNAMADI", async () => {
    const body = await analyse(emptyGateway);
    const lanes = body.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.some((lane) => lane.state === "ARANDI_BULUNAMADI")).toBe(true);
    expect(lanes.some((lane) => lane.state === "ARAMA_BASARISIZ")).toBe(false);
  });
});

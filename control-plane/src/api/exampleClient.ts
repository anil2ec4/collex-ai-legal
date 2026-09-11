/**
 * Minimal typed example client for the control-plane v1 API.
 *
 * Usage:
 *   const client = new ControlPlaneClient("http://127.0.0.1:8787");
 *   const health = await client.health();
 *   const results = await client.search("mülkiyet hakkı");
 */

import type { Outcome, SearchFilters, SearchHit } from "../capabilities/types.js";
import type { RunState, RunStatus } from "../orchestration/executor.js";

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
  capabilities: readonly string[];
  registeredToolCount: number;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  partialReason?: string;
}

export class ControlPlaneApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: unknown,
  ) {
    super(`control-plane API error (HTTP ${httpStatus})`);
    this.name = "ControlPlaneApiError";
  }
}

export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.fetchImpl = fetchImpl;
  }

  async health(): Promise<HealthResponse> {
    return this.getJson<HealthResponse>("/v1/health");
  }

  async search(
    query: string,
    filters?: SearchFilters,
    asOf?: string,
  ): Promise<Outcome<SearchHit[]>> {
    return this.postJson<Outcome<SearchHit[]>>("/v1/search", {
      query,
      ...(filters !== undefined ? { filters } : {}),
      ...(asOf !== undefined ? { asOf } : {}),
    });
  }

  async createResearchRun(
    query: string,
    dataClass: "public" | "client" = "public",
  ): Promise<CreateRunResponse> {
    return this.postJson<CreateRunResponse>("/v1/research-runs", { query, dataClass });
  }

  async getResearchRun(runId: string): Promise<RunState> {
    return this.getJson<RunState>(`/v1/research-runs/${encodeURIComponent(runId)}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`);
    return this.decode<T>(response);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.decode<T>(response);
  }

  private async decode<T>(response: Response): Promise<T> {
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok && response.status !== 502) {
      // 502 carries a typed Outcome error envelope, which callers may want.
      throw new ControlPlaneApiError(response.status, payload);
    }
    return payload as T;
  }
}

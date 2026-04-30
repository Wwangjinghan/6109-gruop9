import type { IntentPayload, IntentStatus } from "../types/intent.js";

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface SubmitResponse {
  intentId: string;
  status: IntentStatus;
}

export interface StatusResponse {
  intentId: string;
  action: string;
  userId: string;
  status: IntentStatus;
  batchId?: string;
  userOpHash?: string;
  txHash?: string;
  error?: string;
  receivedAt: number;
}

export class RelayerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "RelayerError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface RelayerClientConfig {
  baseUrl: string;
  /** Request timeout in ms (default 15 000) */
  timeoutMs?: number;
}

export class RelayerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: RelayerClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /**
   * POST /intents — submit a signed intent payload.
   * Returns immediately with { intentId, status: "pending" }.
   */
  async submit(payload: IntentPayload): Promise<SubmitResponse> {
    return this._post<SubmitResponse>("/intents", payload);
  }

  /**
   * GET /intents/:id — fetch current status of an intent.
   */
  async getStatus(intentId: string): Promise<StatusResponse> {
    return this._get<StatusResponse>(`/intents/${intentId}`);
  }

  /**
   * Poll GET /intents/:id until `status` is terminal or `timeoutMs` elapses.
   *
   * Terminal statuses: "executed" | "failed"
   * @returns the final StatusResponse
   * @throws if the polling timeout is exceeded
   */
  async pollUntilDone(
    intentId: string,
    {
      intervalMs = 3_000,
      timeoutMs = 120_000,
    }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<StatusResponse> {
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set<IntentStatus>(["executed", "failed"]);

    while (Date.now() < deadline) {
      const status = await this.getStatus(intentId);
      if (terminal.has(status.status)) return status;
      await sleep(intervalMs);
    }

    throw new Error(`Intent ${intentId} did not reach a terminal status within ${timeoutMs}ms`);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const { resp, json } = await this._fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new RelayerError(`POST ${path} failed`, resp.status, json);
    return json as T;
  }

  private async _get<T>(path: string): Promise<T> {
    const { resp, json } = await this._fetch(path, { method: "GET" });
    if (!resp.ok) throw new RelayerError(`GET ${path} failed`, resp.status, json);
    return json as T;
  }

  private async _fetch(path: string, init: RequestInit): Promise<{ resp: Response; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

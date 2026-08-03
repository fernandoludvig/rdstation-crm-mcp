import { API_BASE_URL } from "../constants.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class RdCrmApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = "RdCrmApiError";
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal HTTP client for the RD Station CRM v1 API.
 *
 * - Token auth via `?token=` query param (RDSTATION_CRM_TOKEN env var).
 * - Retries 429/5xx with exponential backoff.
 * - Kept isolated from tools so a future v2 (OAuth) client can slot in.
 */
export class RdCrmClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = API_BASE_URL,
  ) {
    if (!token) {
      throw new Error("RD Station CRM token is required");
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query = {}, body } = options;

    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("token", this.token);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let lastError: Error = new Error("Request failed");
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s
      }
      try {
        const response = await fetch(url, {
          method,
          headers: {
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
          lastError = new RdCrmApiError(
            `RD Station CRM API returned ${response.status}`,
            response.status,
          );
          continue;
        }

        const text = await response.text();
        if (!response.ok) {
          throw new RdCrmApiError(
            `RD Station CRM API returned ${response.status}`,
            response.status,
            text,
          );
        }
        return (text ? JSON.parse(text) : {}) as T;
      } catch (error) {
        if (error instanceof RdCrmApiError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        // Network errors / timeouts are retryable.
        if (attempt === MAX_RETRIES) break;
      }
    }
    throw lastError;
  }

  get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>(path, { method: "GET", query });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PUT", body });
  }
}

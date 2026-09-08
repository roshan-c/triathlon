import type { paths } from "./schema.js";

interface ProblemBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
  code?: string;
  detail?: string;
  requestId?: string;
}

export type { paths, components } from "./schema.js";

export interface ClientOptions {
  baseUrl: string;
  accessKey?: string;
  clientName?: string;
  fetch?: typeof globalThis.fetch;
}

export class TriathlonClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "TriathlonClientError";
  }
}

export class TriathlonClient {
  private readonly baseUrl: string;
  private readonly accessKey?: string;
  private readonly clientName: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessKey = options.accessKey;
    this.clientName = options.clientName ?? "custom";
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-triathlon-client", this.clientName);
    if (this.accessKey) headers.set("authorization", `Bearer ${this.accessKey}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: init.credentials ?? "include",
    });
    if (!response.ok) {
      // SAFETY: the public API error envelope is an object with these optional
      // fields; the empty fallback covers non-JSON responses.
      const body = await response.json().catch(() => ({})) as ProblemBody;
      throw new TriathlonClientError(
        body.error?.message ?? body.detail ?? `Triathlon returned HTTP ${response.status}`,
        response.status,
        body.error?.code ?? body.code ?? `HTTP_${response.status}`,
        body.error?.requestId ?? body.requestId,
      );
    }
    if (response.status === 204) {
      // SAFETY: callers of a 204 endpoint intentionally receive no body.
      return undefined as T;
    }
    // SAFETY: the caller chooses T from the endpoint response contract.
    return response.json() as Promise<T>;
  }

  capabilities(): Promise<Success<paths["/api/v1/capabilities"]["get"]>> {
    return this.request("/api/v1/capabilities");
  }

  projects(): Promise<Success<paths["/api/v1/projects"]["get"]>> {
    return this.request("/api/v1/projects");
  }

  board(projectId: string): Promise<Success<paths["/api/v1/projects/{projectId}/board"]["get"]>> {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/board`);
  }

  ticket(projectId: string, ref: string): Promise<Success<paths["/api/v1/projects/{projectId}/tickets/{ref}"]["get"]>> {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ref)}`);
  }
}

type Success<TOperation> = TOperation extends {
  responses: { 200: { content: { "application/json": infer T } } };
} ? T : unknown;

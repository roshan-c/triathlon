import type { GatewayRequest, GatewayResponse } from "./types.js";

export class GatewayClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

export class GatewayClient {
  constructor(
    private readonly agentUrl: string,
    private readonly agentKey: string
  ) {}

  async call<T = unknown>(tool: string, args: Record<string, unknown> = {}, requestId?: string) {
    const payload: GatewayRequest = {
      tool,
      args,
      requestId: requestId ?? `${tool}-${Date.now()}`
    };

    const response = await fetch(this.agentUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.agentKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let body: GatewayResponse<T>;
    try {
      body = (await response.json()) as GatewayResponse<T>;
    } catch {
      throw new GatewayClientError(
        "Gateway returned non-JSON response.",
        "BAD_GATEWAY_RESPONSE",
        response.status
      );
    }

    if (!response.ok || !body.ok) {
      throw new GatewayClientError(
        body.error?.message ?? `Gateway request failed with status ${response.status}.`,
        body.error?.code ?? `HTTP_${response.status}`,
        response.status,
        body.requestId
      );
    }

    return body.result as T;
  }
}

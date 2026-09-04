import type { GatewayRequest } from "./types.js";
import { z } from "zod";
import type { JSONValue } from "convex/values";
import type { GatewayArgs } from "./types.js";

const gatewayResponseSchema = z
  .object({
    ok: z.boolean(),
    requestId: z.string().optional(),
    result: z.json().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string()
      })
      .optional()
  })
  .strict();

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

  async call<T extends JSONValue = JSONValue>(tool: string, args: GatewayArgs = {}, requestId?: string) {
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

    let body: ReturnType<typeof gatewayResponseSchema.parse>;
    try {
      body = gatewayResponseSchema.parse(await response.json());
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

    // SAFETY: The response envelope is validated at the I/O boundary; each caller supplies
    // the result type associated with the requested gateway tool.
    return body.result as T;
  }
}

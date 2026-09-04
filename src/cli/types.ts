import type { JSONValue } from "convex/values";

export type GatewayArgs = Record<string, JSONValue | undefined>;

export type GatewayRequest = {
  tool: string;
  args?: GatewayArgs;
  requestId?: string;
};

export type GatewayResponse<T extends JSONValue = JSONValue> = {
  ok: boolean;
  requestId?: string;
  result?: T;
  error?: {
    code: string;
    message: string;
  };
};

export type CliGlobalOptions = {
  json?: boolean;
  url?: string;
  key?: string;
  projectId?: string;
  envFile?: string;
  skipProjectCheck?: boolean;
};

export type CliConfig = {
  agentUrl: string;
  agentKey: string;
  projectId?: string;
  json: boolean;
  skipProjectCheck: boolean;
};

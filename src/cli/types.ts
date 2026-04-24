export type GatewayRequest = {
  tool: string;
  args?: Record<string, unknown>;
  requestId?: string;
};

export type GatewayResponse<T = unknown> = {
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

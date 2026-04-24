import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliConfig, CliGlobalOptions } from "./types.js";

function parseDotEnv(content: string) {
  const output: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    output[key] = value;
  }

  return output;
}

function loadEnvFile(envFile: string) {
  const absolutePath = resolve(process.cwd(), envFile);
  if (!existsSync(absolutePath)) {
    return {} as Record<string, string>;
  }

  return parseDotEnv(readFileSync(absolutePath, "utf8"));
}

function normalizeAgentUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith("/agent/v1")) {
    return trimmed;
  }

  return `${trimmed.replace(/\/$/, "")}/agent/v1`;
}

export function resolveCliConfig(options: CliGlobalOptions): CliConfig {
  const envFilePath = options.envFile ?? ".env";
  const envFromFile = loadEnvFile(envFilePath);

  const agentUrl = normalizeAgentUrl(
    options.url ??
      process.env.TRI_AGENT_URL ??
      envFromFile.TRI_AGENT_URL ??
      process.env.AGENT_CONVEX_SITE_URL ??
      envFromFile.AGENT_CONVEX_SITE_URL ??
      ""
  );

  const agentKey =
    options.key ??
    process.env.TRI_AGENT_KEY ??
    envFromFile.TRI_AGENT_KEY ??
    process.env.AGENT_API_KEY ??
    envFromFile.AGENT_API_KEY ??
    "";

  const projectId =
    options.projectId ?? process.env.TRI_PROJECT_ID ?? envFromFile.TRI_PROJECT_ID ?? undefined;

  if (!agentUrl) {
    throw new Error(
      "Missing TRI_AGENT_URL. Provide --url or set TRI_AGENT_URL in your shell/.env."
    );
  }

  if (!agentKey) {
    throw new Error(
      "Missing TRI_AGENT_KEY. Provide --key or set TRI_AGENT_KEY in your shell/.env."
    );
  }

  return {
    agentUrl,
    agentKey,
    projectId,
    json: Boolean(options.json),
    skipProjectCheck: Boolean(options.skipProjectCheck)
  };
}

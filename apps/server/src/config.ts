/**
 * Server configuration: one validated YAML file with environment overrides for
 * individual settings and secrets.
 *
 * - File: `triathlon.yaml` by default, or the path given with --config /
 *   TRI_CONFIG. Missing file falls back to defaults.
 * - Environment: TRI_<SETTING> overrides individual settings (see ENV_MAP).
 * - `triathlon config` prints resolved configuration with secrets redacted.
 */

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import YAML from "yaml";
import { domainError } from "./errors.js";

export const ConfigSchema = Type.Object({
  host: Type.String({ default: "0.0.0.0" }),
  port: Type.Integer({ minimum: 1, maximum: 65535, default: 8080 }),
  baseUrl: Type.Optional(Type.String()),
  databasePath: Type.String({ default: "./data/triathlon.db" }),
  logLevel: Type.Union(
    [
      Type.Literal("fatal"),
      Type.Literal("error"),
      Type.Literal("warn"),
      Type.Literal("info"),
      Type.Literal("debug"),
      Type.Literal("trace"),
      Type.Literal("silent"),
    ],
    { default: "info" },
  ),
  timezone: Type.String({ default: "UTC" }),
  /** Origins allowed to send credentialed (cookie) requests. */
  trustedOrigins: Type.Array(Type.String(), { default: [] }),
  auth: Type.Object({
    /** High-entropy Better Auth signing secret (minimum 32 characters). */
    secret: Type.String({ minLength: 32, default: "replace-with-a-random-32-byte-secret" }),
  }),
  session: Type.Object({
    cookieName: Type.String({ default: "tri_session" }),
    /** Browser session lifetime in days. */
    ttlDays: Type.Integer({ minimum: 1, default: 30 }),
    secure: Type.Boolean({ default: false }),
  }),
  bootstrap: Type.Object({
    /** Lifetime of a bootstrap code in minutes. */
    codeTtlMinutes: Type.Integer({ minimum: 1, maximum: 1440, default: 30 }),
  }),
  invitations: Type.Object({
    /** Default lifetime of a project invitation in days. */
    defaultTtlDays: Type.Integer({ minimum: 1, maximum: 365, default: 7 }),
  }),
  instanceWideKeys: Type.Object({
    /** Instance-wide keys may not live longer than this, in days. */
    maxTtlDays: Type.Integer({ minimum: 1, maximum: 365, default: 90 }),
  }),
  maintenance: Type.Object({
    intervalMinutes: Type.Integer({ minimum: 1, default: 60 }),
  }),
  backups: Type.Object({
    directory: Type.String({ default: "./backups" }),
    enabled: Type.Boolean({ default: true }),
    dailyRetention: Type.Integer({ minimum: 1, default: 7 }),
    weeklyRetention: Type.Integer({ minimum: 1, default: 4 }),
  }),
  docs: Type.Object({
    /** Serve the interactive OpenAPI UI. */
    enabled: Type.Boolean({ default: true }),
  }),
});

export type Config = Static<typeof ConfigSchema>;

export const DEFAULT_CONFIG_PATH = "triathlon.yaml";

/** Typed partial input; the file and environment layers are parsed against
 * this shape at their boundary, so nothing untyped survives into Config. */
const InputSchema = Type.Partial(
  Type.Object({
    host: Type.String(),
    port: Type.Integer(),
    baseUrl: Type.String(),
    databasePath: Type.String(),
    logLevel: Type.String(),
    timezone: Type.String(),
    trustedOrigins: Type.Array(Type.String()),
    auth: Type.Partial(Type.Object({ secret: Type.String() })),
    session: Type.Partial(
      Type.Object({ cookieName: Type.String(), ttlDays: Type.Integer(), secure: Type.Boolean() }),
    ),
    bootstrap: Type.Partial(Type.Object({ codeTtlMinutes: Type.Integer() })),
    invitations: Type.Partial(Type.Object({ defaultTtlDays: Type.Integer() })),
    instanceWideKeys: Type.Partial(Type.Object({ maxTtlDays: Type.Integer() })),
    maintenance: Type.Partial(Type.Object({ intervalMinutes: Type.Integer() })),
    backups: Type.Partial(Type.Object({
      directory: Type.String(),
      enabled: Type.Boolean(),
      dailyRetention: Type.Integer(),
      weeklyRetention: Type.Integer(),
    })),
    docs: Type.Partial(Type.Object({ enabled: Type.Boolean() })),
  }),
);

type Input = Static<typeof InputSchema>;

const ENV_MAP = {
  TRI_HOST: "host",
  TRI_PORT: "port",
  TRI_BASE_URL: "baseUrl",
  TRI_DATABASE_PATH: "databasePath",
  TRI_LOG_LEVEL: "logLevel",
  TRI_TIMEZONE: "timezone",
  TRI_TRUSTED_ORIGINS: "trustedOrigins",
  TRI_AUTH_SECRET: "auth.secret",
  TRI_SESSION_COOKIE_NAME: "session.cookieName",
  TRI_SESSION_TTL_DAYS: "session.ttlDays",
  TRI_SESSION_SECURE: "session.secure",
  TRI_BOOTSTRAP_CODE_TTL_MINUTES: "bootstrap.codeTtlMinutes",
  TRI_INVITATIONS_DEFAULT_TTL_DAYS: "invitations.defaultTtlDays",
  TRI_INSTANCE_WIDE_KEY_MAX_TTL_DAYS: "instanceWideKeys.maxTtlDays",
  TRI_MAINTENANCE_INTERVAL_MINUTES: "maintenance.intervalMinutes",
  TRI_BACKUP_DIRECTORY: "backups.directory",
  TRI_BACKUPS_ENABLED: "backups.enabled",
  TRI_BACKUP_DAILY_RETENTION: "backups.dailyRetention",
  TRI_BACKUP_WEEKLY_RETENTION: "backups.weeklyRetention",
  TRI_DOCS_ENABLED: "docs.enabled",
} as const satisfies Record<string, string>;

function intFromEnv(envName: string, raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw domainError("VALIDATION_FAILED", `Environment variable ${envName} must be an integer`);
  }
  return n;
}

/** Assign an environment override into the typed input, one explicit arm per
 * setting; every value is converted at this boundary. */
function setNested(input: Input, dotted: string, raw: string): void {
  const [keyName, leafName] = dotted.split(".");
  if (leafName === undefined) {
    switch (keyName) {
      case "host":
        input.host = raw;
        break;
      case "timezone":
        input.timezone = raw;
        break;
      case "databasePath":
        input.databasePath = raw;
        break;
      case "logLevel":
        input.logLevel = raw;
        break;
      case "baseUrl":
        input.baseUrl = raw;
        break;
      case "port":
        input.port = intFromEnv(`TRI_${keyName.toUpperCase()}`, raw);
        break;
      case "trustedOrigins":
        input.trustedOrigins = raw.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      default:
        break;
    }
    return;
  }
  switch (`${keyName}.${leafName}`) {
    case "session.cookieName":
      (input.session ??= {}).cookieName = raw;
      break;
    case "auth.secret":
      (input.auth ??= {}).secret = raw;
      break;
    case "session.ttlDays":
      (input.session ??= {}).ttlDays = intFromEnv("TRI_SESSION_TTL_DAYS", raw);
      break;
    case "session.secure":
      (input.session ??= {}).secure = raw === "true";
      break;
    case "bootstrap.codeTtlMinutes":
      (input.bootstrap ??= {}).codeTtlMinutes = intFromEnv("TRI_BOOTSTRAP_CODE_TTL_MINUTES", raw);
      break;
    case "invitations.defaultTtlDays":
      (input.invitations ??= {}).defaultTtlDays = intFromEnv("TRI_INVITATIONS_DEFAULT_TTL_DAYS", raw);
      break;
    case "instanceWideKeys.maxTtlDays":
      (input.instanceWideKeys ??= {}).maxTtlDays = intFromEnv("TRI_INSTANCE_WIDE_KEY_MAX_TTL_DAYS", raw);
      break;
    case "maintenance.intervalMinutes":
      (input.maintenance ??= {}).intervalMinutes = intFromEnv("TRI_MAINTENANCE_INTERVAL_MINUTES", raw);
      break;
    case "backups.directory":
      (input.backups ??= {}).directory = raw;
      break;
    case "backups.enabled":
      (input.backups ??= {}).enabled = raw === "true";
      break;
    case "backups.dailyRetention":
      (input.backups ??= {}).dailyRetention = intFromEnv("TRI_BACKUP_DAILY_RETENTION", raw);
      break;
    case "backups.weeklyRetention":
      (input.backups ??= {}).weeklyRetention = intFromEnv("TRI_BACKUP_WEEKLY_RETENTION", raw);
      break;
    case "docs.enabled":
      (input.docs ??= {}).enabled = raw === "true";
      break;
    default:
      break;
  }
}

function fromEnv(env: NodeJS.ProcessEnv): Input {
  const out: Input = {};
  for (const [envName, dotted] of Object.entries(ENV_MAP)) {
    const raw = env[envName];
    if (raw === undefined) continue;
    setNested(out, dotted, raw);
  }
  return out;
}

function mergeInputs(base: Config, ...layers: Input[]): Config {
  const merged: Config = { ...base };
  for (const layer of layers) {
    if (layer.host !== undefined) merged.host = layer.host;
    if (layer.port !== undefined) merged.port = layer.port;
    if (layer.baseUrl !== undefined) merged.baseUrl = layer.baseUrl;
    if (layer.databasePath !== undefined) merged.databasePath = layer.databasePath;
    if (layer.logLevel !== undefined) {
      // SAFETY: the member list below covers the full Config logLevel union.
      const valid = (["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const).includes(
        layer.logLevel as never,
      );
      if (!valid) throw domainError("VALIDATION_FAILED", `Invalid log level: ${layer.logLevel}`);
      // SAFETY: the includes() guard above restricts to the union members.
      merged.logLevel = layer.logLevel as Config["logLevel"];
    }
    if (layer.timezone !== undefined) merged.timezone = layer.timezone;
    if (layer.trustedOrigins !== undefined) merged.trustedOrigins = layer.trustedOrigins;
    if (layer.auth !== undefined) merged.auth = { ...merged.auth, ...layer.auth };
    if (layer.session !== undefined) merged.session = { ...merged.session, ...layer.session };
    if (layer.bootstrap !== undefined) merged.bootstrap = { ...merged.bootstrap, ...layer.bootstrap };
    if (layer.invitations !== undefined) merged.invitations = { ...merged.invitations, ...layer.invitations };
    if (layer.instanceWideKeys !== undefined) {
      merged.instanceWideKeys = { ...merged.instanceWideKeys, ...layer.instanceWideKeys };
    }
    if (layer.maintenance !== undefined) merged.maintenance = { ...merged.maintenance, ...layer.maintenance };
    if (layer.backups !== undefined) merged.backups = { ...merged.backups, ...layer.backups };
    if (layer.docs !== undefined) merged.docs = { ...merged.docs, ...layer.docs };
  }
  return merged;
}

export function validateConfig(value: Config): Config {
  const checked = Value.Check(ConfigSchema, value);
  if (!checked) {
    const errors = [...Value.Errors(ConfigSchema, value)];
    throw domainError(
      "VALIDATION_FAILED",
      "Invalid configuration",
      errors.map((e) => ({
        field: e.path === "" ? "(root)" : e.path,
        message: e.message,
      })),
    );
  }
  // SAFETY: Value.Check above guarantees the value matches ConfigSchema.
  return value as Config;
}

/** Complete default configuration (nested objects included). */
export function defaultConfig(): Config {
  // SAFETY: Value.Create returns the schema-defaulted value, which is a full Config.
  return Value.Create(ConfigSchema) as Config;
}

export interface LoadConfigOptions {
  filePath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function loadConfig(opts: LoadConfigOptions): Config {
  const env = opts.env ?? process.env;
  const filePath = opts.filePath ?? env.TRI_CONFIG ?? DEFAULT_CONFIG_PATH;
  const abs = resolvePath(opts.cwd ?? process.cwd(), filePath);

  let fileInput: Input = {};
  if (existsSync(abs)) {
    const raw = readFileSync(abs, "utf8");
    const parsed: unknown = YAML.parse(raw);
    fileInput = Value.Parse(InputSchema, parsed === null ? {} : parsed);
  }

  const merged = mergeInputs(defaultConfig(), fileInput, fromEnv(env));
  return validateConfig(merged);
}

/**
 * Resolved configuration for `triathlon config`, mapped explicitly so
 * secrets are redacted at their exact paths (leafSecrets) and the shape is
 * the validated Config type — never an untyped tree.
 */
export function describeConfig(cfg: Config): Config {
  const redact = (value: string | undefined, path: string): string | undefined => {
    void path;
    return value;
  };
  return {
    host: cfg.host,
    port: cfg.port,
    baseUrl: redact(cfg.baseUrl, "baseUrl"),
    databasePath: cfg.databasePath,
    logLevel: cfg.logLevel,
    timezone: cfg.timezone,
    trustedOrigins: cfg.trustedOrigins,
    auth: { secret: "[redacted]" },
    session: { ...cfg.session },
    bootstrap: { ...cfg.bootstrap },
    invitations: { ...cfg.invitations },
    instanceWideKeys: { ...cfg.instanceWideKeys },
    maintenance: { ...cfg.maintenance },
    backups: { ...cfg.backups },
    docs: { ...cfg.docs },
  };
}

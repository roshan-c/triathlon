import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentModelConfig, RegisteredProject, Registry, T3Settings, ThemePreference } from "./types.js";

export function defaultT3Settings(): T3Settings {
  return {
    defaultAgent: "agent:claude",
    defaultBaseRef: "",
    sendBackToThread: true,
    agents: {
      "agent:claude": {
        assignee: "agent:claude",
        label: "Claude Code",
        provider: "claudeAgent",
        model: "claude-opus-5-5",
        reasoningKey: "effort",
        reasoningValue: "medium",
      },
      "agent:agy": {
        assignee: "agent:agy",
        label: "Antigravity",
        provider: "antigravity",
        model: "gemini-4-neon",
        reasoningKey: "thought_level",
        reasoningValue: "high",
      },
      "agent:pi": {
        assignee: "agent:pi",
        label: "Pi",
        provider: "pi",
        model: "opencode-go/qwen4-max",
        reasoningKey: "thinking",
        reasoningValue: "high",
      },
      "agent:codex": {
        assignee: "agent:codex",
        label: "Codex",
        provider: "codex",
        model: "gpt-5.3-codex",
        reasoningKey: "reasoningEffort",
        reasoningValue: "high",
      },
    },
  };
}

function mergeT3Settings(raw?: Partial<T3Settings> | null): T3Settings {
  const base = defaultT3Settings();
  if (!raw || typeof raw !== "object") return base;
  const mergedAgents: Record<string, AgentModelConfig> = { ...base.agents };
  if (raw.agents && typeof raw.agents === "object") {
    for (const [key, val] of Object.entries(raw.agents)) {
      if (!val || typeof val !== "object") continue;
      const existing = mergedAgents[key];
      mergedAgents[key] = {
        assignee: val.assignee || existing?.assignee || key,
        label: val.label || existing?.label || key,
        provider: val.provider || existing?.provider || "claudeAgent",
        model: val.model || existing?.model || "",
        reasoningKey: val.reasoningKey ?? existing?.reasoningKey ?? "effort",
        reasoningValue: val.reasoningValue ?? existing?.reasoningValue ?? "",
      };
    }
  }
  return {
    defaultAgent: typeof raw.defaultAgent === "string" && raw.defaultAgent.trim() ? raw.defaultAgent.trim() : base.defaultAgent,
    defaultBaseRef: typeof raw.defaultBaseRef === "string" ? raw.defaultBaseRef.trim() : base.defaultBaseRef,
    sendBackToThread: raw.sendBackToThread !== false,
    agents: mergedAgents,
  };
}

export function getTriathlonHome(): string {
  return process.env.TRIATHLON_HOME ? resolve(process.env.TRIATHLON_HOME) : join(homedir(), ".triathlon");
}

export function getRegistryPath(): string {
  return join(getTriathlonHome(), "registry.json");
}

export function projectIdForPath(projectPath: string): string {
  const normalized = resolve(projectPath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function defaultRegistry(): Registry {
  return {
    version: 1,
    lastProjectId: null,
    theme: "light",
    t3: defaultT3Settings(),
    projects: [],
  };
}

export async function readRegistry(): Promise<Registry> {
  const path = getRegistryPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<Registry>;
    return {
      version: 1,
      lastProjectId: parsed.lastProjectId ?? null,
      theme: parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : "light",
      t3: mergeT3Settings(parsed.t3),
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return defaultRegistry();
    }
    throw error;
  }
}

export async function writeRegistry(registry: Registry): Promise<Registry> {
  const path = getRegistryPath();
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temp, path);
  return registry;
}

export async function registerProject(input: {
  path: string;
  key: string;
  name: string;
}): Promise<RegisteredProject> {
  const normalizedPath = resolve(input.path);
  const id = projectIdForPath(normalizedPath);
  const registry = await readRegistry();
  const existingIndex = registry.projects.findIndex((p) => p.id === id || resolve(p.path) === normalizedPath);
  const entry: RegisteredProject = {
    id,
    path: normalizedPath,
    key: input.key,
    name: input.name,
    addedAt: existingIndex >= 0 ? registry.projects[existingIndex].addedAt : new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    registry.projects[existingIndex] = entry;
  } else {
    registry.projects.push(entry);
  }
  registry.lastProjectId = id;
  await writeRegistry(registry);
  return entry;
}

export async function unregisterProject(idOrPath: string): Promise<boolean> {
  const registry = await readRegistry();
  const normalized = resolve(idOrPath);
  const before = registry.projects.length;
  registry.projects = registry.projects.filter(
    (p) => p.id !== idOrPath && p.key.toLowerCase() !== idOrPath.toLowerCase() && resolve(p.path) !== normalized,
  );
  if (registry.projects.length === before) return false;
  if (registry.lastProjectId && !registry.projects.some((p) => p.id === registry.lastProjectId)) {
    registry.lastProjectId = registry.projects[0]?.id ?? null;
  }
  await writeRegistry(registry);
  return true;
}

export async function updateRegistryPrefs(prefs: {
  lastProjectId?: string | null;
  theme?: ThemePreference;
  t3?: Partial<T3Settings>;
}): Promise<Registry> {
  const registry = await readRegistry();
  if (prefs.lastProjectId !== undefined) registry.lastProjectId = prefs.lastProjectId;
  if (prefs.theme !== undefined) registry.theme = prefs.theme;
  if (prefs.t3 !== undefined) {
    registry.t3 = mergeT3Settings({
      ...registry.t3,
      ...prefs.t3,
      agents: prefs.t3.agents ? { ...registry.t3.agents, ...prefs.t3.agents } : registry.t3.agents,
    });
  }
  return writeRegistry(registry);
}

export async function resolveRegisteredProject(idOrKeyOrPath?: string): Promise<RegisteredProject | null> {
  const registry = await readRegistry();
  if (!idOrKeyOrPath) {
    if (registry.lastProjectId) {
      const found = registry.projects.find((p) => p.id === registry.lastProjectId);
      if (found) return found;
    }
    return registry.projects[0] ?? null;
  }
  const normalized = resolve(idOrKeyOrPath);
  return (
    registry.projects.find(
      (p) =>
        p.id === idOrKeyOrPath ||
        p.key.toLowerCase() === idOrKeyOrPath.toLowerCase() ||
        p.name.toLowerCase() === idOrKeyOrPath.toLowerCase() ||
        resolve(p.path) === normalized,
    ) ?? null
  );
}

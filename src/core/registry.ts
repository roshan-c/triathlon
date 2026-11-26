import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RegisteredProject, Registry, ThemePreference } from "./types.js";

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
}): Promise<Registry> {
  const registry = await readRegistry();
  if (prefs.lastProjectId !== undefined) registry.lastProjectId = prefs.lastProjectId;
  if (prefs.theme !== undefined) registry.theme = prefs.theme;
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

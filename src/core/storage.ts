import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";
import { parseTicketMarkdown, serializeTicketMarkdown } from "./markdown.js";
import type { BoardEvent, ColumnConfig, CyclesFile, ProjectConfig, Ticket } from "./types.js";
import { TriathlonError } from "./types.js";

export const TRIATHLON_DIR = ".triathlon";

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "backlog", name: "Backlog", category: "backlog", wipLimit: null },
  { id: "todo", name: "Todo", category: "todo", wipLimit: null },
  { id: "in-progress", name: "In progress", category: "started", wipLimit: 3 },
  { id: "in-review", name: "In review", category: "review", wipLimit: 3 },
  { id: "done", name: "Done", category: "done", wipLimit: null },
];

export function triathlonDir(projectRoot: string): string {
  return join(resolve(projectRoot), TRIATHLON_DIR);
}

export function configPath(projectRoot: string): string {
  return join(triathlonDir(projectRoot), "config.yaml");
}

export function cyclesPath(projectRoot: string): string {
  return join(triathlonDir(projectRoot), "cycles.yaml");
}

export function eventsPath(projectRoot: string): string {
  return join(triathlonDir(projectRoot), "events.jsonl");
}

export function ticketsDir(projectRoot: string): string {
  return join(triathlonDir(projectRoot), "tickets");
}

export function ticketPath(projectRoot: string, ticketId: string): string {
  return join(ticketsDir(projectRoot), `${ticketId}.md`);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDir = process.cwd()): Promise<string | null> {
  let current = resolve(startDir);
  while (true) {
    if (await pathExists(configPath(current))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temp = `${targetPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, targetPath);
}

export async function readConfig(projectRoot: string): Promise<ProjectConfig> {
  const file = configPath(projectRoot);
  if (!(await pathExists(file))) {
    throw new TriathlonError(`No Triathlon project found at ${resolve(projectRoot)}`, "PROJECT_NOT_FOUND", 404);
  }
  const raw = await readFile(file, "utf8");
  const parsed = yaml.load(raw) as Partial<ProjectConfig> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new TriathlonError(`Invalid config.yaml at ${file}`, "INVALID_CONFIG", 500);
  }
  return {
    schemaVersion: 2,
    key: String(parsed.key ?? "TRI").toUpperCase(),
    name: String(parsed.name ?? "Triathlon Project"),
    description: String(parsed.description ?? ""),
    owner: String(parsed.owner ?? "Roshan"),
    nextTicketNumber: Number.isInteger(parsed.nextTicketNumber) && (parsed.nextTicketNumber as number) >= 1
      ? (parsed.nextTicketNumber as number)
      : 1,
    reviewGate: parsed.reviewGate !== false,
    columns: Array.isArray(parsed.columns) && parsed.columns.length >= 2 ? parsed.columns : DEFAULT_COLUMNS,
  };
}

export async function writeConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  const text = yaml.dump(config, { lineWidth: 120, noRefs: true, sortKeys: false });
  await atomicWrite(configPath(projectRoot), text);
}

export async function readCycles(projectRoot: string): Promise<CyclesFile> {
  const file = cyclesPath(projectRoot);
  if (!(await pathExists(file))) {
    return { nextCycleNumber: 1, cycles: [] };
  }
  const raw = await readFile(file, "utf8");
  const parsed = yaml.load(raw) as Partial<CyclesFile> | null;
  return {
    nextCycleNumber: Number.isInteger(parsed?.nextCycleNumber) && (parsed?.nextCycleNumber as number) >= 1
      ? (parsed?.nextCycleNumber as number)
      : 1,
    cycles: Array.isArray(parsed?.cycles) ? parsed.cycles : [],
  };
}

export async function writeCycles(projectRoot: string, data: CyclesFile): Promise<void> {
  const text = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false });
  await atomicWrite(cyclesPath(projectRoot), text);
}

export async function readEvents(projectRoot: string): Promise<BoardEvent[]> {
  const file = eventsPath(projectRoot);
  if (!(await pathExists(file))) return [];
  const raw = await readFile(file, "utf8");
  const events: BoardEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as BoardEvent);
    } catch {
      // Skip malformed line rather than crashing the whole board.
    }
  }
  return events;
}

export async function appendEvent(
  projectRoot: string,
  event: Omit<BoardEvent, "id" | "at"> & { id?: string; at?: string },
): Promise<BoardEvent> {
  const full: BoardEvent = {
    id: event.id ?? randomUUID(),
    at: event.at ?? new Date().toISOString(),
    type: event.type,
    actor: event.actor,
    ...(event.ticketId ? { ticketId: event.ticketId } : {}),
    ...(event.cycleId ? { cycleId: event.cycleId } : {}),
    ...(event.data ? { data: event.data } : {}),
  };
  await mkdir(triathlonDir(projectRoot), { recursive: true });
  await appendFile(eventsPath(projectRoot), `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

export async function readAllTickets(projectRoot: string): Promise<Ticket[]> {
  const dir = ticketsDir(projectRoot);
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  const mdFiles = entries.filter((name) => name.endsWith(".md") && !name.startsWith("."));
  const tickets = await Promise.all(
    mdFiles.map(async (fileName) => {
      const fullPath = join(dir, fileName);
      const raw = await readFile(fullPath, "utf8");
      const fallbackId = fileName.replace(/\.md$/, "");
      return parseTicketMarkdown(raw, fallbackId);
    }),
  );
  return tickets.sort(
    (a, b) => a.rank - b.rank || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

export async function readTicket(projectRoot: string, ticketId: string): Promise<Ticket> {
  const normalizedId = ticketId.trim().toUpperCase();
  const file = ticketPath(projectRoot, normalizedId);
  if (!(await pathExists(file))) {
    throw new TriathlonError(`Ticket ${normalizedId} not found`, "TICKET_NOT_FOUND", 404);
  }
  const raw = await readFile(file, "utf8");
  return parseTicketMarkdown(raw, normalizedId);
}

export async function writeTicket(projectRoot: string, ticket: Ticket): Promise<Ticket> {
  await mkdir(ticketsDir(projectRoot), { recursive: true });
  const serialized = serializeTicketMarkdown(ticket);
  await atomicWrite(ticketPath(projectRoot, ticket.id), serialized);
  return parseTicketMarkdown(serialized, ticket.id);
}

export async function deleteTicketFile(projectRoot: string, ticketId: string): Promise<void> {
  const normalizedId = ticketId.trim().toUpperCase();
  const file = ticketPath(projectRoot, normalizedId);
  if (!(await pathExists(file))) {
    throw new TriathlonError(`Ticket ${normalizedId} not found`, "TICKET_NOT_FOUND", 404);
  }
  await unlink(file);
}

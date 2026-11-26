import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { inspectPrForBranch, markPrReady, mergePrWithGh, type PrInfo } from "./github.js";
import { toggleChecklistInMarkdown } from "./markdown.js";
import { buildMetricsReport, calculateCycleMetrics } from "./metrics.js";
import { projectIdForPath, registerProject } from "./registry.js";
import { sendReviewFeedbackToT3 } from "./t3.js";
import {
  appendEvent,
  DEFAULT_COLUMNS,
  deleteTicketFile,
  pathExists,
  readAllTickets,
  readConfig,
  readCycles,
  readEvents,
  readTicket,
  ticketsDir,
  triathlonDir,
  writeConfig,
  writeCycles,
  writeTicket,
} from "./storage.js";
import type {
  BoardEvent,
  ColumnConfig,
  Cycle,
  MetricsReport,
  Priority,
  ProjectConfig,
  ProjectSnapshot,
  ReviewCheck,
  ReviewFileChange,
  Ticket,
} from "./types.js";
import { displayActor, isAgentActor, TriathlonError } from "./types.js";

const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

function sanitizeKey(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleaned)) {
    throw new TriathlonError(
      "Project key must be 2-10 uppercase letters or digits starting with a letter (e.g. DIS, TRI).",
      "INVALID_KEY",
    );
  }
  return cleaned;
}

function findColumn(config: ProjectConfig, idOrName: string): ColumnConfig {
  const needle = idOrName.trim().toLowerCase();
  const col = config.columns.find(
    (c) => c.id.toLowerCase() === needle || c.name.toLowerCase() === needle || c.category === needle,
  );
  if (!col) {
    throw new TriathlonError(
      `Unknown column "${idOrName}". Available: ${config.columns.map((c) => c.id).join(", ")}`,
      "UNKNOWN_COLUMN",
    );
  }
  return col;
}

function columnByCategory(config: ProjectConfig, category: ColumnConfig["category"]): ColumnConfig {
  const col = config.columns.find((c) => c.category === category);
  if (!col) {
    throw new TriathlonError(`No column configured for category "${category}"`, "MISSING_COLUMN", 500);
  }
  return col;
}

function nextRankInColumn(tickets: Ticket[], columnId: string): number {
  const max = tickets
    .filter((t) => t.status === columnId)
    .reduce((acc, t) => Math.max(acc, t.rank), 0);
  return max + 1000;
}

export async function initProject(options: {
  dir?: string;
  key?: string;
  name?: string;
  owner?: string;
  force?: boolean;
  register?: boolean;
  installSkill?: boolean;
  demo?: boolean;
}): Promise<{ projectRoot: string; config: ProjectConfig; projectId: string; installedSkillPath?: string }> {
  const projectRoot = resolve(options.dir ?? process.cwd());
  const existing = await pathExists(join(triathlonDir(projectRoot), "config.yaml"));
  if (existing && !options.force) {
    throw new TriathlonError(
      `Triathlon is already initialized in ${projectRoot}. Use --force to reinitialize.`,
      "ALREADY_INITIALIZED",
      409,
    );
  }

  const folderName = basename(projectRoot);
  const key = sanitizeKey(options.key ?? (folderName.replace(/[^a-zA-Z]/g, "").slice(0, 3) || "TRI").toUpperCase());
  const name = options.name?.trim() || folderName;
  const owner = options.owner?.trim() || "Roshan";

  const config: ProjectConfig = {
    schemaVersion: 2,
    key,
    name,
    description: "",
    owner,
    nextTicketNumber: 1,
    reviewGate: true,
    columns: structuredClone(DEFAULT_COLUMNS),
  };

  await mkdir(ticketsDir(projectRoot), { recursive: true });
  await writeConfig(projectRoot, config);
  await writeCycles(projectRoot, { nextCycleNumber: 1, cycles: [] });

  let installedSkillPath: string | undefined;
  if (options.installSkill) {
    const skillSource = new URL("../../skills/triathlon/SKILL.md", import.meta.url);
    const skillTarget = join(projectRoot, ".claude", "skills", "triathlon", "SKILL.md");
    await mkdir(join(projectRoot, ".claude", "skills", "triathlon"), { recursive: true });
    await writeFile(skillTarget, await readFile(skillSource, "utf8"), "utf8");
    installedSkillPath = skillTarget;
  }

  if (options.demo) {
    await seedDemoData(projectRoot, config);
  }

  const freshConfig = await readConfig(projectRoot);
  if (options.register !== false) {
    await registerProject({ path: projectRoot, key: freshConfig.key, name: freshConfig.name });
  }

  return {
    projectRoot,
    config: freshConfig,
    projectId: projectIdForPath(projectRoot),
    installedSkillPath,
  };
}

export class ProjectStore {
  readonly root: string;
  readonly projectId: string;

  constructor(projectRoot: string) {
    this.root = resolve(projectRoot);
    this.projectId = projectIdForPath(this.root);
  }

  async getConfig(): Promise<ProjectConfig> {
    return readConfig(this.root);
  }

  async updateConfig(patch: {
    name?: string;
    description?: string;
    owner?: string;
    reviewGate?: boolean;
    columns?: ColumnConfig[];
  }): Promise<ProjectConfig> {
    const config = await readConfig(this.root);
    if (patch.name !== undefined && patch.name.trim()) config.name = patch.name.trim();
    if (patch.description !== undefined) config.description = patch.description;
    if (patch.owner !== undefined && patch.owner.trim()) config.owner = patch.owner.trim();
    if (patch.reviewGate !== undefined) config.reviewGate = Boolean(patch.reviewGate);
    if (patch.columns !== undefined && patch.columns.length >= 2) {
      config.columns = patch.columns;
    }
    await writeConfig(this.root, config);
    await registerProject({ path: this.root, key: config.key, name: config.name });
    return config;
  }

  async getSnapshot(): Promise<ProjectSnapshot> {
    const [config, tickets, cyclesFile, events] = await Promise.all([
      readConfig(this.root),
      readAllTickets(this.root),
      readCycles(this.root),
      readEvents(this.root),
    ]);
    return {
      projectId: this.projectId,
      path: this.root,
      config,
      tickets,
      cycles: cyclesFile.cycles,
      recentEvents: events.slice(-60),
      lastEventAt: events.at(-1)?.at ?? null,
      eventCount: events.length,
    };
  }

  async listTickets(filters?: {
    status?: string;
    cycleId?: string | null;
    priority?: Priority;
    assignee?: string;
    label?: string;
    triage?: Ticket["triage"] | "all";
    search?: string;
  }): Promise<Ticket[]> {
    let tickets = await readAllTickets(this.root);
    if (!filters) return tickets;

    if (filters.triage && filters.triage !== "all") {
      tickets = tickets.filter((t) => t.triage === filters.triage);
    }
    if (filters.status) {
      const needle = filters.status.toLowerCase();
      tickets = tickets.filter((t) => t.status.toLowerCase() === needle);
    }
    if (filters.cycleId !== undefined) {
      if (filters.cycleId === "none" || filters.cycleId === null) {
        tickets = tickets.filter((t) => t.cycleId === null);
      } else {
        tickets = tickets.filter((t) => t.cycleId === filters.cycleId);
      }
    }
    if (filters.priority) {
      tickets = tickets.filter((t) => t.priority === filters.priority);
    }
    if (filters.assignee) {
      const needle = filters.assignee.toLowerCase();
      tickets = tickets.filter((t) => (t.assignee ?? "").toLowerCase() === needle);
    }
    if (filters.label) {
      const needle = filters.label.toLowerCase();
      tickets = tickets.filter((t) => t.labels.includes(needle));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      tickets = tickets.filter((t) =>
        `${t.id} ${t.title} ${t.description} ${t.labels.join(" ")} ${t.assignee ?? ""}`.toLowerCase().includes(q),
      );
    }
    return tickets;
  }

  async getReadyTickets(limit = 10): Promise<Ticket[]> {
    const [config, tickets] = await Promise.all([readConfig(this.root), readAllTickets(this.root)]);
    const doneIds = new Set(
      tickets
        .filter((t) => config.columns.find((c) => c.id === t.status)?.category === "done")
        .map((t) => t.id),
    );
    const todoCols = new Set(
      config.columns.filter((c) => c.category === "todo").map((c) => c.id),
    );

    return tickets
      .filter((t) => t.triage === "accepted" && todoCols.has(t.status))
      .filter((t) => t.blockedBy.every((dep) => doneIds.has(dep)))
      .sort(
        (a, b) =>
          PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
          a.rank - b.rank ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      )
      .slice(0, limit);
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    return readTicket(this.root, ticketId);
  }

  async createTicket(input: {
    title: string;
    description?: string;
    status?: string;
    priority?: Priority;
    estimate?: number | null;
    labels?: string[];
    assignee?: string | null;
    cycleId?: string | null;
    blockedBy?: string[];
    files?: string[];
    branch?: string | null;
    criteria?: string[];
    proposed?: boolean;
    actor?: string;
  }): Promise<Ticket> {
    const title = input.title?.trim();
    if (!title) throw new TriathlonError("Ticket title is required", "INVALID_TITLE");

    const [config, existingTickets, cyclesFile] = await Promise.all([
      readConfig(this.root),
      readAllTickets(this.root),
      readCycles(this.root),
    ]);

    const actor = input.actor?.trim() || config.owner;
    const statusCol = input.proposed
      ? columnByCategory(config, "backlog")
      : input.status
        ? findColumn(config, input.status)
        : columnByCategory(config, "todo");

    const num = config.nextTicketNumber;
    const id = `${config.key}-${num}`;
    config.nextTicketNumber = num + 1;

    let body = (input.description ?? "").trim();
    if (input.criteria?.length) {
      const checklistBlock = input.criteria
        .map((line) => `- [ ] ${line.trim()}`)
        .filter((line) => line.length > 6)
        .join("\n");
      if (checklistBlock) {
        body = body ? `${body}\n\n## Acceptance Criteria\n${checklistBlock}` : `## Acceptance Criteria\n${checklistBlock}`;
      }
    }

    const now = new Date().toISOString();
    const ticket: Ticket = {
      id,
      title,
      description: body,
      status: statusCol.id,
      priority: input.priority ?? "none",
      estimate: input.estimate ?? null,
      labels: [...new Set((input.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean))],
      assignee: input.assignee?.trim() || null,
      cycleId: input.cycleId ?? null,
      rank: nextRankInColumn(existingTickets, statusCol.id),
      blockedBy: [...new Set((input.blockedBy ?? []).map((b) => b.trim().toUpperCase()).filter(Boolean))],
      files: [...new Set((input.files ?? []).map((f) => f.trim()).filter(Boolean))],
      branch: input.branch?.trim() || null,
      t3ThreadId: null,
      t3Provider: null,
      t3Model: null,
      t3Reasoning: null,
      triage: input.proposed ? "proposed" : "accepted",
      proposedBy: input.proposed ? actor : null,
      review: { state: "none" },
      checklist: [],
      comments: [],
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };

    await writeConfig(this.root, config);
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "ticket.created",
      actor,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: {
        status: saved.status,
        priority: saved.priority,
        estimate: saved.estimate,
        triage: saved.triage,
      },
    });

    // Track mid-cycle scope addition if added directly into an active cycle
    if (saved.cycleId && saved.triage === "accepted") {
      const cycle = cyclesFile.cycles.find((c) => c.id === saved.cycleId && c.state === "active");
      if (cycle) {
        cycle.scopeChanges.push({
          at: now,
          ticketId: saved.id,
          action: "added",
          points: saved.estimate ?? 0,
          actor,
        });
        await writeCycles(this.root, cyclesFile);
        await appendEvent(this.root, {
          at: now,
          type: "cycle.scope_changed",
          actor,
          ticketId: saved.id,
          cycleId: cycle.id,
          data: { action: "added", points: saved.estimate ?? 0 },
        });
      }
    }

    return saved;
  }

  async updateTicket(
    ticketId: string,
    patch: {
      title?: string;
      description?: string;
      priority?: Priority;
      estimate?: number | null;
      labels?: string[];
      assignee?: string | null;
      cycleId?: string | null;
      blockedBy?: string[];
      files?: string[];
      branch?: string | null;
      rank?: number;
      actor?: string;
    },
  ): Promise<Ticket> {
    const [config, ticket, cyclesFile] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readCycles(this.root),
    ]);
    const actor = patch.actor?.trim() || config.owner;
    const now = new Date().toISOString();
    const prevCycleId = ticket.cycleId;
    const changes: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) throw new TriathlonError("Title cannot be empty", "INVALID_TITLE");
      if (t !== ticket.title) {
        changes.title = { from: ticket.title, to: t };
        ticket.title = t;
      }
    }
    if (patch.description !== undefined && patch.description !== ticket.description) {
      ticket.description = patch.description;
      changes.description = true;
    }
    if (patch.priority !== undefined && patch.priority !== ticket.priority) {
      changes.priority = { from: ticket.priority, to: patch.priority };
      ticket.priority = patch.priority;
    }
    if (patch.estimate !== undefined && patch.estimate !== ticket.estimate) {
      changes.estimate = { from: ticket.estimate, to: patch.estimate };
      ticket.estimate = patch.estimate;
    }
    if (patch.labels !== undefined) {
      ticket.labels = [...new Set(patch.labels.map((l) => l.trim().toLowerCase()).filter(Boolean))];
      changes.labels = ticket.labels;
    }
    if (patch.assignee !== undefined && patch.assignee !== ticket.assignee) {
      changes.assignee = { from: ticket.assignee, to: patch.assignee };
      ticket.assignee = patch.assignee?.trim() || null;
    }
    if (patch.cycleId !== undefined && patch.cycleId !== ticket.cycleId) {
      changes.cycleId = { from: ticket.cycleId, to: patch.cycleId };
      ticket.cycleId = patch.cycleId || null;
    }
    if (patch.blockedBy !== undefined) {
      ticket.blockedBy = [
        ...new Set(
          patch.blockedBy
            .map((b) => b.trim().toUpperCase())
            .filter((b) => b && b !== ticket.id),
        ),
      ];
      changes.blockedBy = ticket.blockedBy;
    }
    if (patch.files !== undefined) {
      ticket.files = [...new Set(patch.files.map((f) => f.trim()).filter(Boolean))];
      changes.files = ticket.files;
    }
    if (patch.branch !== undefined) {
      ticket.branch = patch.branch?.trim() || null;
      changes.branch = ticket.branch;
    }
    if (patch.rank !== undefined && Number.isFinite(patch.rank)) {
      ticket.rank = patch.rank;
    }

    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    if (Object.keys(changes).length > 0) {
      await appendEvent(this.root, {
        at: now,
        type: "ticket.updated",
        actor,
        ticketId: saved.id,
        cycleId: saved.cycleId ?? undefined,
        data: changes,
      });
    }

    // Track active cycle scope changes
    if (prevCycleId !== saved.cycleId) {
      let cyclesDirty = false;
      if (prevCycleId) {
        const oldCycle = cyclesFile.cycles.find((c) => c.id === prevCycleId && c.state === "active");
        if (oldCycle) {
          oldCycle.scopeChanges.push({
            at: now,
            ticketId: saved.id,
            action: "removed",
            points: saved.estimate ?? 0,
            actor,
          });
          cyclesDirty = true;
          await appendEvent(this.root, {
            at: now,
            type: "cycle.scope_changed",
            actor,
            ticketId: saved.id,
            cycleId: oldCycle.id,
            data: { action: "removed", points: saved.estimate ?? 0 },
          });
        }
      }
      if (saved.cycleId) {
        const newCycle = cyclesFile.cycles.find((c) => c.id === saved.cycleId && c.state === "active");
        if (newCycle) {
          newCycle.scopeChanges.push({
            at: now,
            ticketId: saved.id,
            action: "added",
            points: saved.estimate ?? 0,
            actor,
          });
          cyclesDirty = true;
          await appendEvent(this.root, {
            at: now,
            type: "cycle.scope_changed",
            actor,
            ticketId: saved.id,
            cycleId: newCycle.id,
            data: { action: "added", points: saved.estimate ?? 0 },
          });
        }
      }
      if (cyclesDirty) await writeCycles(this.root, cyclesFile);
    }

    return saved;
  }

  async moveTicket(
    ticketId: string,
    targetColumn: string,
    options?: { rank?: number; actor?: string; enforceReviewGate?: boolean },
  ): Promise<Ticket> {
    const [config, ticket, allTickets] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
    ]);
    const actor = options?.actor?.trim() || config.owner;
    const toCol = findColumn(config, targetColumn);

    const enforceGate =
      options?.enforceReviewGate ?? (config.reviewGate && isAgentActor(actor));

    if (enforceGate && toCol.category === "done" && ticket.review.state !== "approved") {
      throw new TriathlonError(
        `Review gate is enabled: ${actor} cannot move ${ticket.id} directly to "${toCol.name}". Call request_review instead so ${config.owner} can approve it.`,
        "REVIEW_REQUIRED",
        403,
      );
    }

    const fromStatus = ticket.status;
    const now = new Date().toISOString();
    ticket.status = toCol.id;
    ticket.rank =
      options?.rank !== undefined && Number.isFinite(options.rank)
        ? options.rank
        : fromStatus === toCol.id
          ? ticket.rank
          : nextRankInColumn(allTickets, toCol.id);
    ticket.updatedAt = now;

    // If a human drags a review-pending ticket directly to Done, mark review approved
    if (toCol.category === "done" && ticket.review.state === "pending" && !isAgentActor(actor)) {
      ticket.review.state = "approved";
      ticket.review.decidedBy = actor;
      ticket.review.decidedAt = now;
    }

    const saved = await writeTicket(this.root, ticket);

    if (fromStatus !== toCol.id) {
      await appendEvent(this.root, {
        at: now,
        type: "ticket.moved",
        actor,
        ticketId: saved.id,
        cycleId: saved.cycleId ?? undefined,
        data: { from: fromStatus, to: toCol.id },
      });
    }

    return saved;
  }

  async claimTicket(ticketId: string, actor: string, options?: { branch?: string; moveToStarted?: boolean }): Promise<Ticket> {
    const [config, ticket, allTickets, cyclesFile] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
      readCycles(this.root),
    ]);
    const now = new Date().toISOString();
    const fromStatus = ticket.status;
    ticket.assignee = actor.trim();
    if (options?.branch) ticket.branch = options.branch.trim();

    let movedTo: string | null = null;
    if (options?.moveToStarted !== false) {
      const startedCol = columnByCategory(config, "started");
      const currentCat = config.columns.find((c) => c.id === ticket.status)?.category;
      if (currentCat === "backlog" || currentCat === "todo") {
        ticket.status = startedCol.id;
        ticket.rank = nextRankInColumn(allTickets, startedCol.id);
        movedTo = startedCol.id;
      }
    }

    // If the ticket wasn't in a cycle yet and there's an active cycle, pull it into the active cycle
    // so it stays visible on the active cycle board and counts toward cycle scope.
    let addedToCycleId: string | null = null;
    if (!ticket.cycleId) {
      const activeCycle = cyclesFile.cycles.find((c) => c.state === "active");
      if (activeCycle) {
        ticket.cycleId = activeCycle.id;
        addedToCycleId = activeCycle.id;
        activeCycle.scopeChanges.push({
          at: now,
          ticketId: ticket.id,
          action: "added",
          points: ticket.estimate ?? 0,
          actor: ticket.assignee,
        });
        await writeCycles(this.root, cyclesFile);
      }
    }

    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "ticket.claimed",
      actor: ticket.assignee,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: { assignee: ticket.assignee, ...(movedTo ? { from: fromStatus, to: movedTo } : {}) },
    });
    if (movedTo && movedTo !== fromStatus) {
      await appendEvent(this.root, {
        at: now,
        type: "ticket.moved",
        actor: ticket.assignee,
        ticketId: saved.id,
        cycleId: saved.cycleId ?? undefined,
        data: { from: fromStatus, to: movedTo },
      });
    }
    if (addedToCycleId) {
      await appendEvent(this.root, {
        at: now,
        type: "cycle.scope_changed",
        actor: ticket.assignee,
        ticketId: saved.id,
        cycleId: addedToCycleId,
        data: { action: "added", points: saved.estimate ?? 0 },
      });
    }
    return saved;
  }

  async toggleChecklistItem(
    ticketId: string,
    index: number,
    options?: { checked?: boolean; actor?: string },
  ): Promise<Ticket> {
    const [config, ticket] = await Promise.all([readConfig(this.root), readTicket(this.root, ticketId)]);
    const actor = options?.actor?.trim() || config.owner;
    const { markdown, item } = toggleChecklistInMarkdown(ticket.description, index, options?.checked);
    const now = new Date().toISOString();
    ticket.description = markdown;
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "ticket.checklist_toggled",
      actor,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: { index, text: item.text, checked: item.checked },
    });
    return saved;
  }

  async addComment(ticketId: string, body: string, actor?: string): Promise<Ticket> {
    const trimmed = body.trim();
    if (!trimmed) throw new TriathlonError("Comment body cannot be empty", "INVALID_COMMENT");
    const [config, ticket] = await Promise.all([readConfig(this.root), readTicket(this.root, ticketId)]);
    const author = actor?.trim() || config.owner;
    const now = new Date().toISOString();
    const commentId = randomUUID().slice(0, 8);
    ticket.comments.push({
      id: commentId,
      author,
      body: trimmed,
      createdAt: now,
    });
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "ticket.commented",
      actor: author,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: { commentId, preview: trimmed.slice(0, 140) },
    });
    return saved;
  }

  async requestReview(
    ticketId: string,
    input: {
      summary: string;
      question?: string | null;
      filesChanged?: ReviewFileChange[];
      checks?: ReviewCheck[];
      branch?: string | null;
      actor?: string;
    },
  ): Promise<Ticket> {
    const [config, ticket, allTickets] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
    ]);
    const actor = input.actor?.trim() || ticket.assignee || config.owner;
    const reviewCol = columnByCategory(config, "review");
    const fromStatus = ticket.status;
    const now = new Date().toISOString();

    if (input.branch) ticket.branch = input.branch.trim();
    ticket.status = reviewCol.id;
    if (fromStatus !== reviewCol.id) {
      ticket.rank = nextRankInColumn(allTickets, reviewCol.id);
    }
    ticket.review = {
      state: "pending",
      requestedBy: actor,
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      summary: input.summary.trim(),
      question: input.question?.trim() || null,
      filesChanged: input.filesChanged ?? [],
      checks: input.checks ?? [],
      note: null,
    };
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "review.requested",
      actor,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: {
        from: fromStatus,
        to: reviewCol.id,
        requestedBy: actor,
        summary: ticket.review.summary,
      },
    });
    return saved;
  }

  async approveReview(
    ticketId: string,
    options?: {
      note?: string;
      actor?: string;
      prNumber?: number | null;
      prUrl?: string | null;
      mergeState?: Ticket["review"]["mergeState"];
    },
  ): Promise<Ticket> {
    const [config, ticket, allTickets] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
    ]);
    const actor = options?.actor?.trim() || config.owner;
    if (config.reviewGate && isAgentActor(actor)) {
      throw new TriathlonError("Agents cannot approve their own reviews.", "FORBIDDEN", 403);
    }
    const doneCol = columnByCategory(config, "done");
    const fromStatus = ticket.status;
    const requestedBy = ticket.review.requestedBy ?? ticket.assignee ?? config.owner;
    const now = new Date().toISOString();

    ticket.status = doneCol.id;
    if (fromStatus !== doneCol.id) {
      ticket.rank = nextRankInColumn(allTickets, doneCol.id);
    }
    ticket.review = {
      ...ticket.review,
      state: "approved",
      decidedBy: actor,
      decidedAt: now,
      note: options?.note?.trim() || ticket.review.note || null,
      prNumber: options?.prNumber ?? ticket.review.prNumber ?? null,
      prUrl: options?.prUrl ?? ticket.review.prUrl ?? null,
      mergeState: options?.mergeState ?? ticket.review.mergeState ?? "none",
    };
    if (options?.note?.trim()) {
      ticket.comments.push({
        id: randomUUID().slice(0, 8),
        author: actor,
        body: `Approved: ${options.note.trim()}`,
        createdAt: now,
      });
    }
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "review.approved",
      actor,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: {
        from: fromStatus,
        to: doneCol.id,
        requestedBy,
        note: options?.note?.trim() || null,
        ...(saved.review.prNumber ? { prNumber: saved.review.prNumber, merged: saved.review.mergeState === "merged" } : {}),
      },
    });
    return saved;
  }

  async approveAndMergeReview(
    ticketId: string,
    options?: { note?: string; actor?: string; skipMerge?: boolean },
  ): Promise<{ ticket: Ticket; status: "merged" | "waiting_ci" | "approved_only"; pr?: PrInfo | null }> {
    const [config, ticket] = await Promise.all([readConfig(this.root), readTicket(this.root, ticketId)]);
    const actor = options?.actor?.trim() || config.owner;
    if (config.reviewGate && isAgentActor(actor)) {
      throw new TriathlonError("Agents cannot approve their own reviews.", "FORBIDDEN", 403);
    }

    // Non-code ticket (no branch) or explicit board-only approval
    if (options?.skipMerge || !ticket.branch) {
      const saved = await this.approveReview(ticketId, { note: options?.note, actor });
      return { ticket: saved, status: "approved_only", pr: null };
    }

    const pr = await inspectPrForBranch(this.root, ticket.branch);
    if (!pr) {
      throw new TriathlonError(
        `No GitHub PR found for branch "${ticket.branch}". Push and open a PR first, or use Approve without merging.`,
        "PR_NOT_FOUND",
        409,
      );
    }

    if (pr.state === "MERGED") {
      const saved = await this.approveReview(ticketId, {
        note: options?.note,
        actor,
        prNumber: pr.number,
        prUrl: pr.url,
        mergeState: "merged",
      });
      return { ticket: saved, status: "merged", pr };
    }

    if (pr.state === "CLOSED") {
      throw new TriathlonError(`PR #${pr.number} is closed (not merged).`, "PR_CLOSED", 409);
    }

    if (pr.checks.overall === "fail") {
      throw new TriathlonError(
        `Cannot merge PR #${pr.number} — CI checks failed: ${pr.checks.failedNames.join(", ")}`,
        "CI_FAILED",
        409,
      );
    }

    if (pr.isDraft) {
      await markPrReady(this.root, pr.number);
    }

    // If CI checks are still running, queue auto-merge and let SyncEngine complete it when green
    if (pr.checks.overall === "pending") {
      try {
        await mergePrWithGh(this.root, pr.number, { auto: true });
      } catch {
        // Repo may not have GitHub auto-merge enabled; SyncEngine's background watcher will merge once green.
      }
      const now = new Date().toISOString();
      ticket.review = {
        ...ticket.review,
        state: "pending",
        decidedBy: actor,
        decidedAt: now,
        note: options?.note?.trim() || null,
        prNumber: pr.number,
        prUrl: pr.url,
        mergeState: "waiting_ci",
      };
      if (options?.note?.trim()) {
        ticket.comments.push({
          id: randomUUID().slice(0, 8),
          author: actor,
          body: `Approved (queued to merge PR #${pr.number} after CI passes): ${options.note.trim()}`,
          createdAt: now,
        });
      }
      ticket.updatedAt = now;
      const saved = await writeTicket(this.root, ticket);
      return { ticket: saved, status: "waiting_ci", pr };
    }

    // All CI checks passed (or no checks configured) -> squash-merge now!
    await mergePrWithGh(this.root, pr.number);
    const saved = await this.approveReview(ticketId, {
      note: options?.note,
      actor,
      prNumber: pr.number,
      prUrl: pr.url,
      mergeState: "merged",
    });
    return { ticket: saved, status: "merged", pr };
  }

  async rejectReview(ticketId: string, input: { note: string; actor?: string }): Promise<Ticket> {
    const note = input.note?.trim();
    if (!note) throw new TriathlonError("A feedback note is required when sending a ticket back.", "INVALID_NOTE");
    const [config, ticket, allTickets] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
    ]);
    const actor = input.actor?.trim() || config.owner;
    const startedCol = columnByCategory(config, "started");
    const fromStatus = ticket.status;
    const requestedBy = ticket.review.requestedBy ?? ticket.assignee ?? config.owner;
    const now = new Date().toISOString();

    ticket.status = startedCol.id;
    if (fromStatus !== startedCol.id) {
      ticket.rank = nextRankInColumn(allTickets, startedCol.id);
    }
    ticket.review = {
      ...ticket.review,
      state: "changes_requested",
      decidedBy: actor,
      decidedAt: now,
      note,
    };
    ticket.comments.push({
      id: randomUUID().slice(0, 8),
      author: actor,
      body: `Sent back from review: ${note}`,
      createdAt: now,
    });
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "review.rejected",
      actor,
      ticketId: saved.id,
      cycleId: saved.cycleId ?? undefined,
      data: { from: fromStatus, to: startedCol.id, requestedBy, note },
    });

    // Automatically forward review feedback to linked T3 Code thread (if enabled & linked)
    if (saved.t3ThreadId) {
      await sendReviewFeedbackToT3(this.root, saved, note, actor);
    }

    return saved;
  }

  async acceptTriage(ticketId: string, options?: { priority?: Priority; estimate?: number | null; cycleId?: string | null; actor?: string }): Promise<Ticket> {
    const [config, ticket] = await Promise.all([readConfig(this.root), readTicket(this.root, ticketId)]);
    const actor = options?.actor?.trim() || config.owner;
    const now = new Date().toISOString();
    ticket.triage = "accepted";
    if (options?.priority !== undefined) ticket.priority = options.priority;
    if (options?.estimate !== undefined) ticket.estimate = options.estimate;
    if (options?.cycleId !== undefined) ticket.cycleId = options.cycleId;
    ticket.updatedAt = now;
    const saved = await writeTicket(this.root, ticket);

    await appendEvent(this.root, {
      at: now,
      type: "triage.accepted",
      actor,
      ticketId: saved.id,
      data: { proposedBy: ticket.proposedBy },
    });
    return saved;
  }

  async dismissTriage(ticketId: string, actor?: string): Promise<void> {
    const config = await readConfig(this.root);
    const ticket = await readTicket(this.root, ticketId);
    const now = new Date().toISOString();
    await deleteTicketFile(this.root, ticket.id);
    await appendEvent(this.root, {
      at: now,
      type: "triage.dismissed",
      actor: actor?.trim() || config.owner,
      ticketId: ticket.id,
      data: { title: ticket.title, proposedBy: ticket.proposedBy },
    });
  }

  async deleteTicket(ticketId: string, actor?: string): Promise<void> {
    const config = await readConfig(this.root);
    const ticket = await readTicket(this.root, ticketId);
    await deleteTicketFile(this.root, ticket.id);
    await appendEvent(this.root, {
      type: "ticket.deleted",
      actor: actor?.trim() || config.owner,
      ticketId: ticket.id,
      data: { title: ticket.title },
    });
  }

  async listCycles(): Promise<Cycle[]> {
    const file = await readCycles(this.root);
    return file.cycles;
  }

  async createCycle(input: {
    name: string;
    goal?: string;
    startDate: string;
    endDate: string;
    actor?: string;
  }): Promise<Cycle> {
    const [config, cyclesFile] = await Promise.all([readConfig(this.root), readCycles(this.root)]);
    const number = cyclesFile.nextCycleNumber;
    const id = `cycle-${number}`;
    const cycle: Cycle = {
      id,
      number,
      name: input.name.trim() || `Cycle ${number}`,
      goal: (input.goal ?? "").trim(),
      state: "planned",
      startDate: input.startDate.slice(0, 10),
      endDate: input.endDate.slice(0, 10),
      actualStart: null,
      actualEnd: null,
      initialPoints: 0,
      scopeChanges: [],
      snapshot: null,
    };
    cyclesFile.nextCycleNumber = number + 1;
    cyclesFile.cycles.push(cycle);
    await writeCycles(this.root, cyclesFile);
    await appendEvent(this.root, {
      type: "cycle.created",
      actor: input.actor?.trim() || config.owner,
      cycleId: cycle.id,
      data: { number: cycle.number, name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate },
    });
    return cycle;
  }

  async startCycle(cycleId: string, actor?: string): Promise<Cycle> {
    const [config, cyclesFile, tickets] = await Promise.all([
      readConfig(this.root),
      readCycles(this.root),
      readAllTickets(this.root),
    ]);
    const cycle = cyclesFile.cycles.find((c) => c.id === cycleId);
    if (!cycle) throw new TriathlonError(`Cycle ${cycleId} not found`, "CYCLE_NOT_FOUND", 404);
    if (cycle.state === "completed") {
      throw new TriathlonError(`Completed cycle ${cycleId} cannot be restarted`, "CYCLE_COMPLETED");
    }
    const otherActive = cyclesFile.cycles.find((c) => c.state === "active" && c.id !== cycle.id);
    if (otherActive) {
      throw new TriathlonError(`Cycle ${otherActive.name} is already active. Complete it first.`, "ACTIVE_CYCLE_EXISTS", 409);
    }

    const now = new Date().toISOString();
    cycle.state = "active";
    cycle.actualStart = now;
    cycle.initialPoints = tickets
      .filter((t) => t.cycleId === cycle.id && t.triage === "accepted")
      .reduce((sum, t) => sum + (t.estimate ?? 0), 0);

    await writeCycles(this.root, cyclesFile);
    await appendEvent(this.root, {
      at: now,
      type: "cycle.started",
      actor: actor?.trim() || config.owner,
      cycleId: cycle.id,
      data: { initialPoints: cycle.initialPoints },
    });
    return cycle;
  }

  async completeCycle(
    cycleId: string,
    options?: { rolloverTo?: string | "backlog" | null; actor?: string },
  ): Promise<{ cycle: Cycle; rolledOverTicketIds: string[] }> {
    const [config, cyclesFile, tickets, events] = await Promise.all([
      readConfig(this.root),
      readCycles(this.root),
      readAllTickets(this.root),
      readEvents(this.root),
    ]);
    const cycle = cyclesFile.cycles.find((c) => c.id === cycleId);
    if (!cycle) throw new TriathlonError(`Cycle ${cycleId} not found`, "CYCLE_NOT_FOUND", 404);
    if (cycle.state === "completed") return { cycle, rolledOverTicketIds: [] };

    const now = new Date().toISOString();
    const actor = options?.actor?.trim() || config.owner;
    cycle.state = "completed";
    cycle.actualEnd = now;
    if (!cycle.actualStart) cycle.actualStart = `${cycle.startDate}T00:00:00.000Z`;
    cycle.snapshot = calculateCycleMetrics({ config, tickets, events, cycle, now });

    const doneColIds = new Set(config.columns.filter((c) => c.category === "done").map((c) => c.id));
    const rolledOverTicketIds: string[] = [];

    if (options?.rolloverTo) {
      const targetCycleId = options.rolloverTo === "backlog" ? null : options.rolloverTo;
      if (targetCycleId && !cyclesFile.cycles.some((c) => c.id === targetCycleId && c.state !== "completed")) {
        throw new TriathlonError(`Rollover target cycle ${targetCycleId} not found`, "CYCLE_NOT_FOUND", 404);
      }
      const backlogCol = columnByCategory(config, "backlog");
      for (const ticket of tickets) {
        if (ticket.cycleId === cycle.id && !doneColIds.has(ticket.status)) {
          ticket.cycleId = targetCycleId;
          if (targetCycleId === null) ticket.status = backlogCol.id;
          ticket.updatedAt = now;
          await writeTicket(this.root, ticket);
          rolledOverTicketIds.push(ticket.id);
        }
      }
    }

    await writeCycles(this.root, cyclesFile);
    await appendEvent(this.root, {
      at: now,
      type: "cycle.completed",
      actor,
      cycleId: cycle.id,
      data: {
        completedPoints: cycle.snapshot.completedPoints,
        completedTickets: cycle.snapshot.completedTickets,
        rolledOver: rolledOverTicketIds.length,
      },
    });
    return { cycle, rolledOverTicketIds };
  }

  async getMetrics(cycleId?: string | null): Promise<MetricsReport> {
    const [config, tickets, cyclesFile, events] = await Promise.all([
      readConfig(this.root),
      readAllTickets(this.root),
      readCycles(this.root),
      readEvents(this.root),
    ]);
    return buildMetricsReport({ config, tickets, cycles: cyclesFile.cycles, events, cycleId });
  }

  async getEvents(limit?: number): Promise<BoardEvent[]> {
    const events = await readEvents(this.root);
    return limit ? events.slice(-limit) : events;
  }

  async buildAgentPrompt(ticketId: string): Promise<string> {
    const [config, ticket, allTickets] = await Promise.all([
      readConfig(this.root),
      readTicket(this.root, ticketId),
      readAllTickets(this.root),
    ]);
    const blockers = ticket.blockedBy.map((id) => {
      const dep = allTickets.find((t) => t.id === id);
      return dep ? `- ${dep.id}: ${dep.title} (${dep.status})` : `- ${id}`;
    });

    const commentLines = ticket.comments.length
      ? [
          "",
          "## Comments (read carefully and follow any instructions below)",
          ...ticket.comments.flatMap((c) => [
            "",
            `### ${displayActor(c.author)} (${c.createdAt.slice(0, 16).replace("T", " ")} UTC)`,
            c.body.trim(),
          ]),
        ]
      : [];

    const reviewFeedbackLines =
      ticket.review.state === "changes_requested" && ticket.review.note
        ? ["", "## Previous Review Feedback", ticket.review.note.trim()]
        : [];

    const lines = [
      `Work on ticket **${ticket.id}: ${ticket.title}** in project ${config.name} (${this.root}).`,
      "",
      `- Priority: ${ticket.priority}`,
      `- Estimate: ${ticket.estimate ?? "unestimated"} pts`,
      ...(ticket.branch ? [`- Branch: \`${ticket.branch}\``] : []),
      ...(ticket.files.length ? [`- Linked files: ${ticket.files.map((f) => `\`${f}\``).join(", ")}`] : []),
      "",
      "## Description",
      ticket.description || "(No description provided.)",
      ...commentLines,
      ...reviewFeedbackLines,
      ...(blockers.length ? ["", "## Dependencies", ...blockers] : []),
      "",
      "## Triathlon Workflow",
      `1. Claim this ticket if not already claimed: \`tri -P "${this.root}" claim ${ticket.id} --by agent:<your-name>\` (or via Triathlon MCP \`claim_ticket\`).`,
      `2. As you satisfy checklist items, mark them done via \`tri -P "${this.root}" check ${ticket.id} <n>\` or MCP \`toggle_checklist_item\`.`,
      `3. When finished and verified, request human review via \`tri -P "${this.root}" review request ${ticket.id} --summary "..."\` or MCP \`request_review\` (do not move directly to Done).`,
    ];
    return lines.join("\n");
  }
}

async function seedDemoData(projectRoot: string, config: ProjectConfig): Promise<void> {
  const store = new ProjectStore(projectRoot);
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

  const c1 = await store.createCycle({
    name: "Foundation",
    goal: "Stand up core data pipeline and Markdown storage.",
    startDate: fmt(addDays(today, -20)),
    endDate: fmt(addDays(today, -7)),
    actor: config.owner,
  });

  const t1 = await store.createTicket({
    title: "Design Markdown ticket frontmatter schema",
    description: "Define clean YAML frontmatter + checklist parsing.\n\n## Acceptance Criteria\n- [x] Parse YAML frontmatter\n- [x] Extract checklist items",
    status: "todo",
    priority: "high",
    estimate: 5,
    labels: ["core"],
    cycleId: c1.id,
    actor: config.owner,
  });
  await store.startCycle(c1.id, config.owner);
  await store.claimTicket(t1.id, "agent:claude");
  await store.requestReview(t1.id, {
    summary: "Implemented gray-matter parser with round-trip checklist toggling and unit tests.",
    filesChanged: [{ path: "src/core/markdown.ts", added: 142, removed: 0, isNew: true }],
    checks: [{ name: "vitest", status: "pass", detail: "18 passed in 0.4 s" }],
    actor: "agent:claude",
  });
  await store.approveReview(t1.id, { actor: config.owner });
  await store.completeCycle(c1.id, { actor: config.owner });

  const c2 = await store.createCycle({
    name: "Evaluation & Polish",
    goal: "Deliver dissertation metrics pipeline, review inbox, and live board sync.",
    startDate: fmt(addDays(today, -5)),
    endDate: fmt(addDays(today, 9)),
    actor: config.owner,
  });

  const t2 = await store.createTicket({
    title: "Compute lead and cycle time from events.jsonl",
    description: "Read every transition from `events.jsonl` and compute lead time and cycle time per ticket.\n\n## Acceptance Criteria\n- [x] Parse events into per-ticket transitions\n- [x] Handle reopened tickets\n- [ ] Export p50 and p85 to metrics.csv",
    status: "todo",
    priority: "urgent",
    estimate: 5,
    labels: ["metrics"],
    cycleId: c2.id,
    branch: `${config.key.toLowerCase()}-2-cycle-time`,
    files: ["src/core/metrics.ts"],
    actor: config.owner,
  });

  const t3 = await store.createTicket({
    title: "Velocity chart across cycles",
    description: "Render committed vs completed points per cycle with SVG export.\n\n## Acceptance Criteria\n- [x] One bar per cycle\n- [x] Reads cleanly in greyscale print",
    status: "todo",
    priority: "high",
    estimate: 3,
    labels: ["metrics", "ui"],
    cycleId: c2.id,
    actor: config.owner,
  });

  await store.createTicket({
    title: "Export burndown SVG for chapter 5 figures",
    description: "Ensure labels never overlap the Today marker.",
    status: "todo",
    priority: "medium",
    estimate: 3,
    labels: ["figures"],
    cycleId: c2.id,
    blockedBy: [t2.id],
    actor: config.owner,
  });

  await store.createTicket({
    title: "Add glossary of agent terms to front matter",
    description: "Proposed after scanning chapter 4 terminology.",
    priority: "none",
    labels: ["writing"],
    proposed: true,
    actor: "agent:claude",
  });

  await store.startCycle(c2.id, config.owner);
  await store.claimTicket(t2.id, "agent:claude");
  await store.claimTicket(t3.id, "agent:codex");
  await store.requestReview(t3.id, {
    summary: "Added velocity series and clean SVG exporter for dissertation figures.",
    question: "Should partial cycles stay in the rolling average or be excluded?",
    filesChanged: [
      { path: "src/core/metrics.ts", added: 84, removed: 12 },
      { path: "test/metrics.test.ts", added: 41, removed: 0 },
    ],
    checks: [
      { name: "vitest", status: "pass", detail: "42 passed in 1.2 s" },
      { name: "tsc --noEmit", status: "pass", detail: "0 errors" },
    ],
    actor: "agent:codex",
  });
}

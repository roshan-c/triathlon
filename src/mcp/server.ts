import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ProjectStore } from "../core/project.js";
import { readRegistry, resolveRegisteredProject } from "../core/registry.js";
import { findProjectRoot } from "../core/storage.js";
import { TriathlonError } from "../core/types.js";

async function resolveStore(projectArg?: string, defaultProject?: string): Promise<ProjectStore> {
  const hint = projectArg ?? defaultProject;
  if (hint) {
    const reg = await resolveRegisteredProject(hint);
    if (reg) return new ProjectStore(reg.path);
    const root = await findProjectRoot(hint);
    if (root) return new ProjectStore(root);
    throw new TriathlonError(`Project "${hint}" not found in registry or filesystem.`, "PROJECT_NOT_FOUND", 404);
  }
  const cwdRoot = await findProjectRoot(process.cwd());
  if (cwdRoot) return new ProjectStore(cwdRoot);
  const reg = await resolveRegisteredProject();
  if (reg) return new ProjectStore(reg.path);
  throw new TriathlonError(
    "No Triathlon project found in current directory or global registry. Run `tri init` first.",
    "PROJECT_NOT_FOUND",
    404,
  );
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof TriathlonError ? error.code : "ERROR";
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, code }, null, 2) }],
  };
}

function normalizeAgentActor(actor?: string): string {
  const raw = (actor ?? "agent:mcp").trim();
  if (!raw) return "agent:mcp";
  return raw.startsWith("agent:") ? raw : `agent:${raw}`;
}

export async function runMcpServer(options?: { defaultProject?: string }): Promise<void> {
  const server = new McpServer({
    name: "triathlon",
    version: "2.0.0",
  });

  const projectParam = z
    .string()
    .optional()
    .describe("Optional project ID, key (e.g. DIS), name, or path. Defaults to cwd or last active project.");

  server.tool(
    "list_projects",
    "List all locally registered Triathlon projects.",
    {},
    async () => {
      try {
        const reg = await readRegistry();
        return ok({ lastProjectId: reg.lastProjectId, projects: reg.projects });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_board_summary",
    "Get project config, columns, active cycle, and counts per column.",
    { project: projectParam },
    async ({ project }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const snap = await store.getSnapshot();
        const activeCycle = snap.cycles.find((c) => c.state === "active") ?? null;
        const counts = Object.fromEntries(
          snap.config.columns.map((col) => [
            col.id,
            snap.tickets.filter((t) => t.triage === "accepted" && t.status === col.id).length,
          ]),
        );
        return ok({
          project: {
            id: snap.projectId,
            key: snap.config.key,
            name: snap.config.name,
            path: snap.path,
            reviewGate: snap.config.reviewGate,
          },
          columns: snap.config.columns,
          counts,
          proposedForTriage: snap.tickets.filter((t) => t.triage === "proposed").length,
          activeCycle: activeCycle
            ? {
                id: activeCycle.id,
                number: activeCycle.number,
                name: activeCycle.name,
                goal: activeCycle.goal,
                startDate: activeCycle.startDate,
                endDate: activeCycle.endDate,
              }
            : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "list_tickets",
    "List tickets in a project with optional filters.",
    {
      project: projectParam,
      status: z.string().optional(),
      cycleId: z.string().optional(),
      priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
      assignee: z.string().optional(),
      label: z.string().optional(),
      triage: z.enum(["accepted", "proposed", "all"]).optional(),
      search: z.string().optional(),
    },
    async (args) => {
      try {
        const store = await resolveStore(args.project, options?.defaultProject);
        const tickets = await store.listTickets({
          status: args.status,
          cycleId: args.cycleId,
          priority: args.priority,
          assignee: args.assignee,
          label: args.label,
          triage: args.triage ?? "accepted",
          search: args.search,
        });
        return ok(
          tickets.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            estimate: t.estimate,
            assignee: t.assignee,
            cycleId: t.cycleId,
            labels: t.labels,
            blockedBy: t.blockedBy,
            triage: t.triage,
            reviewState: t.review.state,
            checklistDone: t.checklist.filter((c) => c.checked).length,
            checklistTotal: t.checklist.length,
          })),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_ready_tickets",
    "Get unblocked Todo tickets sorted by priority, ready for an agent to claim.",
    {
      project: projectParam,
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ project, limit }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const ready = await store.getReadyTickets(limit ?? 10);
        return ok(ready);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_ticket",
    "Read the full Markdown ticket including description, acceptance criteria checklist, linked files, review state, and comments.",
    {
      project: projectParam,
      ticketId: z.string().describe("Ticket ID such as TRI-12"),
    },
    async ({ project, ticketId }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        return ok(await store.getTicket(ticketId));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "create_ticket",
    "Create a new ticket or propose one for human triage (set proposed=true for agent suggestions).",
    {
      project: projectParam,
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
      estimate: z.number().int().min(0).nullable().optional(),
      labels: z.array(z.string()).optional(),
      cycleId: z.string().nullable().optional(),
      blockedBy: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      criteria: z.array(z.string()).optional(),
      proposed: z.boolean().optional().describe("If true, places ticket into Backlog -> Needs triage."),
      actor: z.string().optional().describe("Agent identity, e.g. agent:claude or claude"),
    },
    async (args) => {
      try {
        const store = await resolveStore(args.project, options?.defaultProject);
        const ticket = await store.createTicket({
          title: args.title,
          description: args.description,
          status: args.status,
          priority: args.priority,
          estimate: args.estimate,
          labels: args.labels,
          cycleId: args.cycleId,
          blockedBy: args.blockedBy,
          files: args.files,
          criteria: args.criteria,
          proposed: args.proposed,
          actor: normalizeAgentActor(args.actor),
        });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "claim_ticket",
    "Claim a ticket for an agent and move it to In progress (if currently in Backlog or Todo).",
    {
      project: projectParam,
      ticketId: z.string(),
      actor: z.string().describe("Agent identity, e.g. agent:claude or agent:codex"),
      branch: z.string().optional(),
    },
    async ({ project, ticketId, actor, branch }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const ticket = await store.claimTicket(ticketId, normalizeAgentActor(actor), { branch });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "update_ticket",
    "Update ticket metadata, description, linked files, or branch.",
    {
      project: projectParam,
      ticketId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
      estimate: z.number().int().min(0).nullable().optional(),
      labels: z.array(z.string()).optional(),
      blockedBy: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      branch: z.string().nullable().optional(),
      actor: z.string().optional(),
    },
    async (args) => {
      try {
        const store = await resolveStore(args.project, options?.defaultProject);
        const ticket = await store.updateTicket(args.ticketId, {
          title: args.title,
          description: args.description,
          priority: args.priority,
          estimate: args.estimate,
          labels: args.labels,
          blockedBy: args.blockedBy,
          files: args.files,
          branch: args.branch,
          actor: normalizeAgentActor(args.actor),
        });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "move_ticket",
    "Move a ticket to another column. Review gate prevents agents from moving directly to Done without human approval; use request_review instead.",
    {
      project: projectParam,
      ticketId: z.string(),
      toColumn: z.string().describe("Target column ID or name, e.g. in-progress, todo"),
      actor: z.string().optional(),
    },
    async ({ project, ticketId, toColumn, actor }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const ticket = await store.moveTicket(ticketId, toColumn, {
          actor: normalizeAgentActor(actor),
          enforceReviewGate: true,
        });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "toggle_checklist_item",
    "Check or uncheck an acceptance-criteria item (0-based index) inside the ticket's Markdown file.",
    {
      project: projectParam,
      ticketId: z.string(),
      index: z.number().int().min(0).describe("0-based checklist item index"),
      checked: z.boolean().optional(),
      actor: z.string().optional(),
    },
    async ({ project, ticketId, index, checked, actor }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const ticket = await store.toggleChecklistItem(ticketId, index, {
          checked,
          actor: normalizeAgentActor(actor),
        });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "add_comment",
    "Add a progress note or question comment to a ticket.",
    {
      project: projectParam,
      ticketId: z.string(),
      body: z.string().min(1),
      actor: z.string().optional(),
    },
    async ({ project, ticketId, body, actor }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const ticket = await store.addComment(ticketId, body, normalizeAgentActor(actor));
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "request_review",
    "Submit completed work to the human Review Inbox with summary, optional decision question, modified files, and verification checks.",
    {
      project: projectParam,
      ticketId: z.string(),
      summary: z.string().min(1).describe("Concise summary of what was implemented and verified."),
      question: z.string().optional().describe("Optional decision/question that needs the human's call."),
      branch: z.string().optional(),
      filesChanged: z
        .array(
          z.object({
            path: z.string(),
            added: z.number().int().min(0),
            removed: z.number().int().min(0),
            isNew: z.boolean().optional(),
          }),
        )
        .optional(),
      checks: z
        .array(
          z.object({
            name: z.string(),
            status: z.enum(["pass", "fail", "skip"]),
            detail: z.string().optional(),
          }),
        )
        .optional(),
      actor: z.string().optional(),
    },
    async (args) => {
      try {
        const store = await resolveStore(args.project, options?.defaultProject);
        const ticket = await store.requestReview(args.ticketId, {
          summary: args.summary,
          question: args.question,
          branch: args.branch,
          filesChanged: args.filesChanged,
          checks: args.checks,
          actor: normalizeAgentActor(args.actor),
        });
        return ok(ticket);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_active_cycle",
    "Get the currently active cycle and its progress.",
    { project: projectParam },
    async ({ project }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        const cycles = await store.listCycles();
        const active = cycles.find((c) => c.state === "active") ?? null;
        return ok({ activeCycle: active });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_metrics",
    "Compute live dissertation metrics (cycle time, lead time, burndown, time in column, assignee breakdown) for a cycle.",
    {
      project: projectParam,
      cycleId: z.string().optional(),
    },
    async ({ project, cycleId }) => {
      try {
        const store = await resolveStore(project, options?.defaultProject);
        return ok(await store.getMetrics(cycleId));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.resource("projects", "triathlon://projects", async () => {
    const reg = await readRegistry();
    return {
      contents: [
        {
          uri: "triathlon://projects",
          mimeType: "application/json",
          text: JSON.stringify(reg, null, 2),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { Command } from "commander";
import {
  exportBurndownSvg,
  exportEventsCsv,
  exportMetricsCsv,
  exportMetricsMarkdown,
} from "../core/metrics.js";
import { initProject, ProjectStore } from "../core/project.js";
import {
  readRegistry,
  registerProject,
  resolveRegisteredProject,
  unregisterProject,
} from "../core/registry.js";
import { findProjectRoot, readConfig } from "../core/storage.js";
import { launchTicketInT3 } from "../core/t3.js";
import type { Priority, ReviewCheck, ReviewFileChange, Ticket } from "../core/types.js";
import { displayActor, TriathlonError } from "../core/types.js";
import { runMcpServer } from "../mcp/server.js";
import { startServer } from "../server/index.js";

function out(value: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

async function resolveStore(projectFlag?: string): Promise<ProjectStore> {
  if (projectFlag) {
    const reg = await resolveRegisteredProject(projectFlag);
    if (reg) return new ProjectStore(reg.path);
    const root = await findProjectRoot(projectFlag);
    if (root) return new ProjectStore(root);
    throw new TriathlonError(`Project "${projectFlag}" not found`, "PROJECT_NOT_FOUND", 404);
  }
  const cwdRoot = await findProjectRoot(process.cwd());
  if (cwdRoot) return new ProjectStore(cwdRoot);
  const reg = await resolveRegisteredProject();
  if (reg) return new ProjectStore(reg.path);
  throw new TriathlonError(
    "No Triathlon project found in this directory or global registry. Run `tri init` first.",
    "PROJECT_NOT_FOUND",
    404,
  );
}

function pad(str: string, width: number): string {
  return str.length >= width ? `${str.slice(0, Math.max(0, width - 1))}…` : str.padEnd(width);
}

function formatTicketTable(tickets: Ticket[]): string {
  if (!tickets.length) return "No matching tickets.";
  const header = `${pad("ID", 10)} ${pad("STATUS", 13)} ${pad("PRIO", 8)} ${pad("PTS", 4)} ${pad("ASSIGNEE", 15)} TITLE`;
  const sep = "-".repeat(Math.min(100, header.length + 28));
  const rows = tickets.map((t) => {
    const pts = t.estimate === null ? "–" : String(t.estimate);
    const blocked = t.blockedBy.length ? ` [blocked:${t.blockedBy.join(",")}]` : "";
    const check = t.checklist.length
      ? ` (${t.checklist.filter((c) => c.checked).length}/${t.checklist.length})`
      : "";
    return `${pad(t.id, 10)} ${pad(t.status, 13)} ${pad(t.priority, 8)} ${pad(pts, 4)} ${pad(displayActor(t.assignee), 15)} ${t.title}${check}${blocked}`;
  });
  return [header, sep, ...rows].join("\n");
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFileChanges(items: string[]): ReviewFileChange[] {
  // Format: "path:+84:-12" or "path:new" or "path"
  return items.map((entry) => {
    const [path, a, r] = entry.split(":");
    if (a === "new") return { path, added: 0, removed: 0, isNew: true };
    return {
      path,
      added: Number(a?.replace("+", "") ?? 0) || 0,
      removed: Number(r?.replace("-", "") ?? 0) || 0,
    };
  });
}

function parseChecks(items: string[]): ReviewCheck[] {
  // Format: "pytest:pass:48 passed" or "ruff:pass"
  return items.map((entry) => {
    const [name, rawStatus, ...rest] = entry.split(":");
    const status = rawStatus === "fail" || rawStatus === "skip" ? rawStatus : "pass";
    const detail = rest.join(":").trim() || undefined;
    return { name, status, detail };
  });
}

const program = new Command();

program
  .name("tri")
  .description("Triathlon — local-first, Markdown-backed work tracker for solo developers and coding agents")
  .version("2.0.0")
  .option("-P, --project <idOrPath>", "Project ID, key, name, or directory")
  .option("--json", "Output JSON", false);

function globalOpts(): { project?: string; json: boolean } {
  const opts = program.opts<{ project?: string; json?: boolean }>();
  return { project: opts.project, json: Boolean(opts.json) };
}

program
  .command("init")
  .description("Initialize a .triathlon/ workspace in the current directory and register it")
  .option("--dir <path>", "Target directory (default: cwd)")
  .option("-k, --key <key>", "Project key (e.g. DIS, TRI)")
  .option("-n, --name <name>", "Project display name")
  .option("--owner <name>", "Your display name", "Roshan")
  .option("--skill", "Install bundled Triathlon SKILL.md into .claude/skills/triathlon/", false)
  .option("--demo", "Seed realistic demo cycles and tickets", false)
  .option("--no-register", "Do not add to ~/.triathlon/registry.json")
  .option("--force", "Overwrite existing .triathlon/config.yaml", false)
  .action(async (opts) => {
    const { json } = globalOpts();
    const res = await initProject({
      dir: opts.dir,
      key: opts.key,
      name: opts.name,
      owner: opts.owner,
      installSkill: opts.skill,
      demo: opts.demo,
      register: opts.register,
      force: opts.force,
    });
    if (json) return out(res, true);
    out(
      [
        `Initialized ${res.config.name} (${res.config.key}) at ${res.projectRoot}/.triathlon`,
        ...(res.installedSkillPath ? [`Installed agent skill: ${res.installedSkillPath}`] : []),
        `Run \`tri serve\` to open the local workbench.`,
      ].join("\n"),
      false,
    );
  });

program
  .command("projects")
  .description("List all registered projects in the local hub")
  .action(async () => {
    const { json } = globalOpts();
    const reg = await readRegistry();
    if (json) return out(reg, true);
    if (!reg.projects.length) return out("No registered projects. Run `tri init` inside a repo.", false);
    const lines = reg.projects.map(
      (p) => `${p.id === reg.lastProjectId ? "*" : " "} ${pad(p.key, 8)} ${pad(p.name, 22)} ${p.path}`,
    );
    out(lines.join("\n"), false);
  });

program
  .command("register [dir]")
  .description("Register an existing .triathlon/ repo in the local hub")
  .action(async (dir?: string) => {
    const { json } = globalOpts();
    const target = resolve(dir ?? process.cwd());
    const config = await readConfig(target);
    const entry = await registerProject({ path: target, key: config.key, name: config.name });
    if (json) return out(entry, true);
    out(`Registered ${entry.name} (${entry.key}) -> ${entry.path}`, false);
  });

program
  .command("unregister <idOrPath>")
  .description("Remove a project from the local hub registry (keeps files on disk)")
  .action(async (idOrPath: string) => {
    const { json } = globalOpts();
    const removed = await unregisterProject(idOrPath);
    if (json) return out({ removed }, true);
    out(removed ? `Unregistered ${idOrPath}` : `Project "${idOrPath}" was not in the registry.`, false);
  });

program
  .command("serve")
  .description("Start the local multi-project Triathlon workbench")
  .option("-p, --port <port>", "Port to bind", "4177")
  .option("-H, --host <host>", "Host interface to bind", "127.0.0.1")
  .option(
    "--allow-tailscale-user <logins>",
    "Comma-separated Tailscale-User-Login allowlist (for use behind `tailscale serve`)",
    process.env.TRIATHLON_ALLOW_TAILSCALE_USER,
  )
  .option("--no-open", "Do not open the browser automatically")
  .action(async (opts) => {
    await startServer({
      port: Number(opts.port),
      host: opts.host,
      open: opts.open,
      allowedTailscaleUsers: parseList(opts.allowTailscaleUser),
    });
  });

program
  .command("mcp")
  .description("Start the stdio MCP server for coding agents")
  .action(async () => {
    const { project } = globalOpts();
    await runMcpServer({ defaultProject: project });
  });

program
  .command("new <title>")
  .description("Create a new ticket Markdown file")
  .option("-d, --desc <text>", "Markdown description")
  .option("-s, --status <column>", "Column ID or name")
  .option("-p, --priority <priority>", "none|low|medium|high|urgent", "none")
  .option("-e, --points <n>", "Story point estimate")
  .option("-l, --labels <csv>", "Comma-separated labels")
  .option("-a, --assignee <actor>", "Assignee (e.g. Roshan or agent:claude)")
  .option("-c, --cycle <cycleId>", "Cycle ID (e.g. cycle-1)")
  .option("-b, --blocked-by <csv>", "Comma-separated blocking ticket IDs")
  .option("-f, --files <csv>", "Comma-separated linked repo file paths")
  .option("--branch <name>", "Git branch name")
  .option("--criteria <item...>", "Acceptance criteria checklist items")
  .option("--proposed", "Mark as agent-proposed for human triage", false)
  .option("--by <actor>", "Actor performing the action")
  .action(async (title: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.createTicket({
      title,
      description: opts.desc,
      status: opts.status,
      priority: opts.priority as Priority,
      estimate: opts.points !== undefined ? Number(opts.points) : null,
      labels: parseList(opts.labels),
      assignee: opts.assignee,
      cycleId: opts.cycle ?? null,
      blockedBy: parseList(opts.blockedBy),
      files: parseList(opts.files),
      branch: opts.branch,
      criteria: opts.criteria,
      proposed: opts.proposed,
      actor: opts.by,
    });
    if (json) return out(ticket, true);
    out(`Created ${ticket.id}: ${ticket.title} (${ticket.status})`, false);
  });

program
  .command("ls")
  .description("List tickets")
  .option("-s, --status <column>", "Filter by column")
  .option("-c, --cycle <cycleId>", "Filter by cycle (or 'none')")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("-a, --assignee <actor>", "Filter by assignee")
  .option("-l, --label <label>", "Filter by label")
  .option("--triage <state>", "accepted|proposed|all", "accepted")
  .option("-q, --search <text>", "Full-text search")
  .action(async (opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const tickets = await store.listTickets({
      status: opts.status,
      cycleId: opts.cycle,
      priority: opts.priority as Priority | undefined,
      assignee: opts.assignee,
      label: opts.label,
      triage: opts.triage,
      search: opts.search,
    });
    if (json) return out(tickets, true);
    out(formatTicketTable(tickets), false);
  });

program
  .command("ready")
  .description("Show unblocked Todo tickets sorted by priority (agent pickup queue)")
  .option("-n, --limit <n>", "Max tickets", "10")
  .action(async (opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const tickets = await store.getReadyTickets(Number(opts.limit));
    if (json) return out(tickets, true);
    out(formatTicketTable(tickets), false);
  });

program
  .command("show <ticketId>")
  .description("Inspect a ticket in detail")
  .action(async (ticketId: string) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const t = await store.getTicket(ticketId);
    if (json) return out(t, true);
    const lines = [
      `${t.id}  ${t.title}`,
      `Status: ${t.status} | Priority: ${t.priority} | Points: ${t.estimate ?? "—"} | Assignee: ${displayActor(t.assignee)} | Cycle: ${t.cycleId ?? "—"}`,
      ...(t.labels.length ? [`Labels: ${t.labels.join(", ")}`] : []),
      ...(t.blockedBy.length ? [`Blocked by: ${t.blockedBy.join(", ")}`] : []),
      ...(t.branch ? [`Branch: ${t.branch}`] : []),
      ...(t.files.length ? [`Files: ${t.files.join(", ")}`] : []),
      "",
      t.description || "(No description)",
      ...(t.comments.length
        ? ["", "Comments:", ...t.comments.map((c) => `  [${c.createdAt.slice(0, 16)}] ${displayActor(c.author)}: ${c.body}`)]
        : []),
    ];
    out(lines.join("\n"), false);
  });

program
  .command("mv <ticketId> <column>")
  .description("Move a ticket to another column")
  .option("--rank <n>", "Explicit numeric rank")
  .option("--by <actor>", "Actor performing the move")
  .action(async (ticketId: string, column: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.moveTicket(ticketId, column, {
      rank: opts.rank !== undefined ? Number(opts.rank) : undefined,
      actor: opts.by,
    });
    if (json) return out(ticket, true);
    out(`Moved ${ticket.id} -> ${ticket.status}`, false);
  });

program
  .command("edit <ticketId>")
  .description("Update ticket metadata or description")
  .option("--title <title>")
  .option("--desc <description>")
  .option("-p, --priority <priority>")
  .option("-e, --points <n>")
  .option("-a, --assignee <actor>")
  .option("-c, --cycle <cycleId>")
  .option("-l, --labels <csv>")
  .option("-b, --blocked-by <csv>")
  .option("-f, --files <csv>")
  .option("--branch <name>")
  .option("--by <actor>")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.updateTicket(ticketId, {
      title: opts.title,
      description: opts.desc,
      priority: opts.priority as Priority | undefined,
      estimate: opts.points !== undefined ? (opts.points === "none" ? null : Number(opts.points)) : undefined,
      assignee: opts.assignee !== undefined ? (opts.assignee === "none" ? null : opts.assignee) : undefined,
      cycleId: opts.cycle !== undefined ? (opts.cycle === "none" ? null : opts.cycle) : undefined,
      labels: opts.labels !== undefined ? parseList(opts.labels) : undefined,
      blockedBy: opts.blockedBy !== undefined ? parseList(opts.blockedBy) : undefined,
      files: opts.files !== undefined ? parseList(opts.files) : undefined,
      branch: opts.branch,
      actor: opts.by,
    });
    if (json) return out(ticket, true);
    out(`Updated ${ticket.id}`, false);
  });

program
  .command("claim <ticketId>")
  .description("Claim a ticket for an actor (human or agent) and move it to In progress")
  .requiredOption("--by <actor>", "Actor claiming the ticket, e.g. agent:claude")
  .option("--branch <name>", "Branch name")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.claimTicket(ticketId, opts.by, { branch: opts.branch });
    if (json) return out(ticket, true);
    out(`${ticket.id} claimed by ${ticket.assignee} (${ticket.status})`, false);
  });

program
  .command("check <ticketId> <itemNumber>")
  .description("Toggle an acceptance-criteria checklist item (1-based index)")
  .option("--done", "Force checked")
  .option("--undone", "Force unchecked")
  .option("--by <actor>", "Actor")
  .action(async (ticketId: string, itemNumber: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const index = Number(itemNumber) - 1;
    const checked = opts.done ? true : opts.undone ? false : undefined;
    const ticket = await store.toggleChecklistItem(ticketId, index, { checked, actor: opts.by });
    if (json) return out(ticket, true);
    const item = ticket.checklist[index];
    out(`${ticket.id} [${item?.checked ? "x" : " "}] ${item?.text ?? ""}`, false);
  });

program
  .command("comment <ticketId> <body...>")
  .description("Add a comment to a ticket")
  .option("--by <actor>", "Author")
  .action(async (ticketId: string, bodyParts: string[], opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.addComment(ticketId, bodyParts.join(" "), opts.by);
    if (json) return out(ticket, true);
    out(`Added comment to ${ticket.id}`, false);
  });

program
  .command("prompt <ticketId>")
  .description("Print a copy-ready agent brief for a ticket")
  .action(async (ticketId: string) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const prompt = await store.buildAgentPrompt(ticketId);
    if (json) return out({ ticketId, prompt }, true);
    out(prompt, false);
  });

program
  .command("launch <ticketId>")
  .description("Start a T3 Code thread in a new git worktree for a ticket (uses assignee's agent/model defaults)")
  .option("--agent <assignee>", "Override agent (e.g. agent:claude, agent:agy, agent:pi, agent:codex)")
  .option("--provider <id>", "Override T3 provider instance id")
  .option("--model <slug>", "Override model slug")
  .option("--reasoning <value>", "Override reasoning strength (effort / thought_level / thinking)")
  .option("--base <ref>", "Base git ref for the new worktree (defaults to origin/<default>)")
  .option("--branch <name>", "Branch name for the new worktree")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const result = await launchTicketInT3(store, ticketId, {
      agent: opts.agent,
      provider: opts.provider,
      model: opts.model,
      reasoningValue: opts.reasoning,
      baseRef: opts.base,
      branch: opts.branch,
    });
    if (json) return out(result, true);
    out(
      `Launched ${result.ticket.id} in T3 Code (${result.provider} / ${result.model}${result.reasoning ? ` · ${result.reasoning}` : ""})\nThread: ${result.threadId}\nWorktree branch: ${result.branch} (from ${result.baseRef})`,
      false,
    );
  });

program
  .command("rm <ticketId>")
  .description("Delete a ticket")
  .action(async (ticketId: string) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    await store.deleteTicket(ticketId);
    if (json) return out({ deleted: ticketId }, true);
    out(`Deleted ${ticketId}`, false);
  });

// Review subcommands
const reviewCmd = program.command("review").description("Human-in-the-loop review gate commands");

reviewCmd
  .command("request <ticketId>")
  .description("Submit a ticket to the Review Inbox")
  .requiredOption("--summary <text>", "What was built and verified")
  .option("--question <text>", "Optional decision needing human input")
  .option("--file <spec...>", "Modified file entry: path:+added:-removed or path:new")
  .option("--check <spec...>", "Verification check entry: name:pass|fail:detail")
  .option("--branch <name>", "Branch name")
  .option("--by <actor>", "Agent or human requesting review")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.requestReview(ticketId, {
      summary: opts.summary,
      question: opts.question,
      filesChanged: opts.file ? parseFileChanges(opts.file) : [],
      checks: opts.check ? parseChecks(opts.check) : [],
      branch: opts.branch,
      actor: opts.by,
    });
    if (json) return out(ticket, true);
    out(`Submitted ${ticket.id} for review.`, false);
  });

reviewCmd
  .command("approve <ticketId>")
  .description("Approve a ticket in review and move it to Done")
  .option("--note <text>", "Optional approval note")
  .option("--by <actor>", "Reviewer")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.approveReview(ticketId, { note: opts.note, actor: opts.by });
    if (json) return out(ticket, true);
    out(`Approved ${ticket.id} -> ${ticket.status}`, false);
  });

reviewCmd
  .command("reject <ticketId>")
  .description("Send a ticket back to In progress with feedback")
  .requiredOption("--note <text>", "Feedback explaining what needs changes")
  .option("--by <actor>", "Reviewer")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.rejectReview(ticketId, { note: opts.note, actor: opts.by });
    if (json) return out(ticket, true);
    out(`Sent ${ticket.id} back to ${ticket.status}`, false);
  });

// Triage subcommands
const triageCmd = program.command("triage").description("Accept or dismiss agent-proposed tickets");

triageCmd
  .command("accept <ticketId>")
  .option("-p, --priority <priority>")
  .option("-e, --points <n>")
  .option("-c, --cycle <cycleId>")
  .action(async (ticketId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const ticket = await store.acceptTriage(ticketId, {
      priority: opts.priority as Priority | undefined,
      estimate: opts.points !== undefined ? Number(opts.points) : undefined,
      cycleId: opts.cycle,
    });
    if (json) return out(ticket, true);
    out(`Accepted ${ticket.id} into backlog.`, false);
  });

triageCmd
  .command("dismiss <ticketId>")
  .action(async (ticketId: string) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    await store.dismissTriage(ticketId);
    if (json) return out({ dismissed: ticketId }, true);
    out(`Dismissed ${ticketId}.`, false);
  });

// Cycle subcommands
const cycleCmd = program.command("cycle").description("Manage cycles");

cycleCmd
  .command("list")
  .action(async () => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const cycles = await store.listCycles();
    if (json) return out(cycles, true);
    if (!cycles.length) return out("No cycles yet. Create one with `tri cycle create`.", false);
    out(
      cycles
        .map((c) => `${pad(c.id, 10)} ${pad(c.state, 10)} ${c.startDate}..${c.endDate}  ${c.name}`)
        .join("\n"),
      false,
    );
  });

cycleCmd
  .command("create <name>")
  .requiredOption("--start <YYYY-MM-DD>", "Start date")
  .requiredOption("--end <YYYY-MM-DD>", "End date")
  .option("--goal <text>", "Cycle goal")
  .action(async (name: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const cycle = await store.createCycle({
      name,
      startDate: opts.start,
      endDate: opts.end,
      goal: opts.goal,
    });
    if (json) return out(cycle, true);
    out(`Created ${cycle.id} (${cycle.name})`, false);
  });

cycleCmd
  .command("start <cycleId>")
  .action(async (cycleId: string) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const cycle = await store.startCycle(cycleId);
    if (json) return out(cycle, true);
    out(`Started ${cycle.id} (${cycle.initialPoints} committed points)`, false);
  });

cycleCmd
  .command("complete <cycleId>")
  .option("--rollover <target>", "Move unfinished tickets to 'backlog' or another cycleId")
  .action(async (cycleId: string, opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const result = await store.completeCycle(cycleId, { rolloverTo: opts.rollover ?? null });
    if (json) return out(result, true);
    out(
      `Completed ${result.cycle.id} (${result.cycle.snapshot?.completedPoints ?? 0} pts, ${result.rolledOverTicketIds.length} rolled over)`,
      false,
    );
  });

// Metrics command
program
  .command("metrics")
  .description("Compute cycle metrics or export dissertation-ready CSV / Markdown / SVG")
  .option("-c, --cycle <cycleId>", "Cycle ID or number")
  .option("--export <format>", "csv|events-csv|md|svg|json")
  .option("-o, --output <file>", "Write export to file instead of stdout")
  .action(async (opts) => {
    const { project, json } = globalOpts();
    const store = await resolveStore(project);
    const report = await store.getMetrics(opts.cycle);

    if (opts.export) {
      const fmt = String(opts.export).toLowerCase();
      let payload: string;
      if (fmt === "csv") payload = exportMetricsCsv(report);
      else if (fmt === "events-csv") payload = exportEventsCsv(await store.getEvents());
      else if (fmt === "md" || fmt === "markdown") payload = exportMetricsMarkdown(report);
      else if (fmt === "svg") payload = exportBurndownSvg(report);
      else payload = `${JSON.stringify(report, null, 2)}\n`;

      if (opts.output) {
        await writeFile(resolve(opts.output), payload, "utf8");
        out(`Wrote ${fmt} metrics to ${resolve(opts.output)}`, false);
      } else {
        process.stdout.write(payload);
      }
      return;
    }

    if (json) return out(report, true);
    out(exportMetricsMarkdown(report), false);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof TriathlonError) {
    console.error(`Error [${error.code}]: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});

#!/usr/bin/env node

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion */

import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { TriathlonClient, TriathlonClientError } from "@triathlon/client";

interface GlobalOptions { json?: boolean; url?: string; key?: string; projectId?: string }
interface Context { client: TriathlonClient; projectId: string; json: boolean }

function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

function output(value: unknown, json: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, json ? 2 : 2)}\n`);
}

async function context(command: Command): Promise<Context> {
  const options = globals(command);
  const baseUrl = options.url ?? process.env.TRI_URL;
  const accessKey = options.key ?? process.env.TRI_KEY;
  if (!baseUrl) throw new Error("Missing server URL; use --url or TRI_URL");
  if (!accessKey) throw new Error("Missing access key; use --key or TRI_KEY");
  const client = new TriathlonClient({ baseUrl, accessKey, clientName: "cli" });
  const capabilities = await client.capabilities() as {
    accessibleProjects?: Array<{ id: string; name: string }>;
  };
  const requested = options.projectId ?? process.env.TRI_PROJECT_ID;
  const projects = capabilities.accessibleProjects ?? [];
  const selected = requested
    ? projects.find((project) => project.id === requested)
    : projects.length === 1 ? projects[0] : undefined;
  if (!selected) {
    throw new Error(requested
      ? `Project ${requested} is not accessible with this credential`
      : "Select a project with --project-id or TRI_PROJECT_ID");
  }
  return { client, projectId: selected.id, json: Boolean(options.json) };
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
    body: JSON.stringify(value),
  };
}

function projectPath(projectId: string, suffix = ""): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function ticketDetail(ctx: Context, ref: string): Promise<{ ticket: { resourceVersion: number } }> {
  return ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(ref)}`));
}

const program = new Command()
  .name("tri")
  .description("Remote client for the Triathlon public API")
  .version("0.2.0")
  .option("-j, --json", "machine-readable JSON output")
  .option("--url <url>", "Triathlon server URL (TRI_URL)")
  .option("--key <key>", "access key (TRI_KEY)")
  .option("--project-id <id>", "project scope (TRI_PROJECT_ID)")
  .showHelpAfterError();

program.command("doctor").action(async (_opts, command) => {
  const ctx = await context(command);
  output({ ok: true, projectId: ctx.projectId, capabilities: await ctx.client.capabilities() }, ctx.json);
});

const project = program.command("project");
project.command("summary").action(async (_opts, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId)), ctx.json);
});
project.command("members").action(async (_opts, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId, "/members")), ctx.json);
});

const tickets = program.command("tickets");
tickets.command("board").action(async (_opts, command) => {
  const ctx = await context(command);
  output(await ctx.client.board(ctx.projectId), ctx.json);
});
tickets.command("list")
  .option("--visibility <visibility>", "open|closed|deleted", "open")
  .action(async (opts: { visibility: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, `/tickets?visibility=${encodeURIComponent(opts.visibility)}`)), ctx.json);
  });
tickets.command("show").requiredOption("--id <ref>").action(async (opts: { id: string }, command) => {
  const ctx = await context(command);
  output(await ticketDetail(ctx, opts.id), ctx.json);
});
tickets.command("create")
  .requiredOption("--title <title>")
  .option("--description <markdown>")
  .option("--points <points>", "story points", Number)
  .option("--priority <priority>", "low|medium|high")
  .option("--column-id <id>")
  .action(async (opts: { title: string; description?: string; points?: number; priority?: string; columnId?: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, "/tickets"), jsonBody({
      title: opts.title, descriptionMd: opts.description, points: opts.points,
      priority: opts.priority, columnId: opts.columnId,
    })), ctx.json);
  });
tickets.command("move")
  .requiredOption("--id <ref>").requiredOption("--column-id <id>")
  .option("--position <position>", "zero-based position", Number, 0)
  .action(async (opts: { id: string; columnId: string; position: number }, command) => {
    const ctx = await context(command);
    const detail = await ticketDetail(ctx, opts.id);
    output(await ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(opts.id)}/move`), jsonBody({
      columnId: opts.columnId, position: opts.position,
      expectedResourceVersion: detail.ticket.resourceVersion,
    })), ctx.json);
  });
tickets.command("comment").requiredOption("--id <ref>").requiredOption("--body <text>")
  .action(async (opts: { id: string; body: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(opts.id)}/comments`), jsonBody({ body: opts.body })), ctx.json);
  });
tickets.command("request-review").requiredOption("--id <ref>").action(async (opts: { id: string }, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(opts.id)}/review/request`), jsonBody({})), ctx.json);
});
tickets.command("review").requiredOption("--id <ref>").requiredOption("--decision <decision>").option("--comment <text>")
  .action(async (opts: { id: string; decision: string; comment?: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(opts.id)}/review/decide`), jsonBody({ decision: opts.decision, comment: opts.comment })), ctx.json);
  });
tickets.command("resolve").requiredOption("--id <ref>").requiredOption("--comment <text>")
  .action(async (opts: { id: string; comment: string }, command) => {
    const ctx = await context(command);
    const detail = await ticketDetail(ctx, opts.id);
    output(await ctx.client.request(projectPath(ctx.projectId, `/tickets/${encodeURIComponent(opts.id)}/resolve`), jsonBody({
      comment: opts.comment, expectedResourceVersion: detail.ticket.resourceVersion,
    })), ctx.json);
  });
tickets.command("frontier").action(async (_opts, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId, "/frontier")), ctx.json);
});

const sprints = program.command("sprints");
sprints.command("list").action(async (_opts, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId, "/sprints")), ctx.json);
});
sprints.command("create").requiredOption("--name <name>").option("--start <date>").option("--end <date>")
  .action(async (opts: { name: string; start?: string; end?: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, "/sprints"), jsonBody({
      name: opts.name, plannedStart: opts.start, plannedEnd: opts.end,
    })), ctx.json);
  });
for (const action of ["activate", "complete"] as const) {
  sprints.command(action).requiredOption("--id <id>").action(async (opts: { id: string }, command) => {
    const ctx = await context(command);
    output(await ctx.client.request(projectPath(ctx.projectId, `/sprints/${encodeURIComponent(opts.id)}/${action}`), jsonBody({})), ctx.json);
  });
}
sprints.command("metrics").requiredOption("--id <id>").action(async (opts: { id: string }, command) => {
  const ctx = await context(command);
  output(await ctx.client.request(projectPath(ctx.projectId, `/sprints/${encodeURIComponent(opts.id)}/metrics`)), ctx.json);
});

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof TriathlonClientError) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message, requestId: error.requestId } })}\n`);
    process.exitCode = error.status === 401 || error.status === 403 ? 3 : error.status === 409 ? 4 : 2;
  } else {
    process.stderr.write(`${JSON.stringify({ error: { code: "CLI_ERROR", message: error instanceof Error ? error.message : String(error) } })}\n`);
    process.exitCode = 1;
  }
});

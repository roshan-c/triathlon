#!/usr/bin/env node

import { Command, Option } from "commander";
import { z } from "zod";
import { GatewayClient, GatewayClientError } from "./client.js";
import { resolveCliConfig } from "./config.js";
import { printResult } from "./output.js";
import { confirm } from "./prompts.js";
import type { CliConfig, CliGlobalOptions } from "./types.js";

function toTimestamp(rawDate: string, fieldName: string) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date string.`);
  }
  return date.getTime();
}

function collect(value: string, previous: string[] = []) {
  return [...previous, value];
}

const ticketDetailSchema = z.object({
  blockedBy: z.array(z.json())
});

function getGlobalOptions(command: Command): CliGlobalOptions {
  const opts = command.optsWithGlobals<CliGlobalOptions>();
  return {
    json: Boolean(opts.json),
    url: opts.url,
    key: opts.key,
    projectId: opts.projectId,
    envFile: opts.envFile,
    skipProjectCheck: Boolean(opts.skipProjectCheck)
  };
}

async function verifyProjectScope(config: CliConfig, client: GatewayClient) {
  if (config.skipProjectCheck || !config.projectId) {
    return;
  }

  const summary = await client.call<{ projectId: string; name: string }>("projects.getSummary", {});

  if (!summary?.projectId) {
    throw new Error("Could not verify project scope from projects.getSummary.");
  }

  if (summary.projectId !== config.projectId) {
    throw new Error(
      `TRI_PROJECT_ID mismatch. Expected ${config.projectId} but gateway key resolves to ${summary.projectId}.`
    );
  }
}

async function runWithClient(
  command: Command,
  handler: (ctx: { client: GatewayClient; config: CliConfig; command: Command }) => Promise<void>
) {
  const config = resolveCliConfig(getGlobalOptions(command));
  const client = new GatewayClient(config.agentUrl, config.agentKey);
  await verifyProjectScope(config, client);
  await handler({ client, config, command });
}

const program = new Command();

program
  .name("tri")
  .description("Triathlon CLI: agent-gateway wrapper for ticket, sprint, and metrics workflows")
  .version("0.1.0")
  .option("-j, --json", "Output raw JSON")
  .option("--url <url>", "Agent gateway URL (TRI_AGENT_URL)")
  .option("--key <key>", "Agent key (TRI_AGENT_KEY)")
  .option("--project-id <id>", "Expected project id for safety check (TRI_PROJECT_ID)")
  .option("--env-file <path>", "Env file path", ".env")
  .option("--skip-project-check", "Skip TRI_PROJECT_ID safety validation")
  .showHelpAfterError();

program
  .command("doctor")
  .description("Verify configuration and gateway connectivity")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const describe = await client.call<{ version: string; tools: string[] }>("system.describe", {});
      const summary = await client.call<{ projectId: string; name: string; role: string }>(
        "projects.getSummary",
        {}
      );

      if (config.json) {
        printResult(
          {
            ok: true,
            config: {
              agentUrl: config.agentUrl,
              projectId: config.projectId ?? null,
              skipProjectCheck: config.skipProjectCheck
            },
            describe,
            summary
          },
          true
        );
        return;
      }

      printResult(
        {
          status: "ok",
          gateway: config.agentUrl,
          project: summary,
          tools: describe.tools?.length ?? 0,
          version: describe.version
        },
        false,
        "Doctor check passed"
      );
    });
  });

const projectCmd = program.command("project").description("Project-level read operations");

projectCmd
  .command("summary")
  .description("Get project summary for current key scope")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("projects.getSummary", {});
      printResult(result, config.json, "Project summary");
    });
  });

projectCmd
  .command("members")
  .description("List project members")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("projects.members", {});
      printResult(result, config.json, "Project members");
    });
  });

const ticketsCmd = program.command("tickets").description("Ticket lifecycle operations");

ticketsCmd
  .command("board")
  .description("Get the board with its columns and tickets")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.board", {});
      printResult(result, config.json, "Ticket board");
    });
  });

ticketsCmd
  .command("list")
  .description("List tickets")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.list", {});
      printResult(result, config.json, "Tickets");
    });
  });

ticketsCmd
  .command("show")
  .description("Show a ticket with comments and links")
  .requiredOption("--id <ticketId>", "Ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.get", { ticketId: opts.id });
      printResult(result, config.json, "Ticket");
    });
  });

ticketsCmd
  .command("create")
  .description("Create a ticket")
  .requiredOption("--title <title>", "Ticket title")
  .option("--description <description>", "Ticket description")
  .option("--column-name <name>", "Column name", "Backlog")
  .option("--column-id <id>", "Column id")
  .option("--points <points>", "Story points", (v) => Number(v))
  .option("--priority <priority>", "Priority: low|medium|high", "medium")
  .option("--sprint-id <id>", "Sprint id")
  .option("--assignee <externalId>", "Assignee external id")
  .option("--label <label>", "Label; repeat for multiple labels", collect)
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.create", {
        title: opts.title,
        description: opts.description,
        columnName: opts.columnName,
        columnId: opts.columnId,
        storyPoints: Number.isFinite(opts.points) ? opts.points : undefined,
        priority: opts.priority,
        sprintId: opts.sprintId,
        assigneeExternalId: opts.assignee,
        labels: opts.label ?? []
      });

      printResult(result, config.json, "Ticket created");
    });
  });

ticketsCmd
  .command("update")
  .description("Update a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .option("--title <title>")
  .option("--description <description>")
  .option("--points <points>", "Story points", (v) => Number(v))
  .option("--priority <priority>", "Priority: low|medium|high")
  .option("--assignee <externalId>", "Assignee external id")
  .option("--label <label>", "Replace labels; repeat for multiple labels", collect)
  .option("--clear-labels", "Remove all labels")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const payload = {
        ticketId: opts.id,
        title: opts.title,
        description: opts.description,
        storyPoints: Number.isFinite(opts.points) ? opts.points : undefined,
        priority: opts.priority,
        assigneeExternalId: opts.assignee,
        labels: opts.clearLabels ? [] : opts.label
      };

      const hasUpdate = Object.entries(payload).some(
        ([key, value]) => key !== "ticketId" && value !== undefined
      );

      if (!hasUpdate) {
        throw new Error(
          "No update fields provided. Use --title/--description/--points/--priority/--assignee/--label/--clear-labels."
        );
      }

      const result = await client.call("tickets.update", payload);
      printResult(result, config.json, "Ticket updated");
    });
  });

ticketsCmd
  .command("move")
  .description("Move a ticket to a new column")
  .requiredOption("--id <ticketId>", "Ticket id")
  .addOption(new Option("--to-column-id <id>", "Destination column id"))
  .addOption(new Option("--to-column-name <name>", "Destination column name"))
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      if (!opts.toColumnId && !opts.toColumnName) {
        throw new Error("Provide --to-column-id or --to-column-name.");
      }

      const result = await client.call("tickets.move", {
        ticketId: opts.id,
        toColumnId: opts.toColumnId,
        toColumnName: opts.toColumnName
      });
      printResult(result, config.json, "Ticket moved");
    });
  });

ticketsCmd
  .command("comment")
  .description("Post a comment on a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .requiredOption("--body <text>", "Comment body")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.comment", {
        ticketId: opts.id,
        body: opts.body
      });
      printResult(result, config.json, "Comment posted");
    });
  });

ticketsCmd
  .command("close")
  .description("Close a ticket atomically with a comment")
  .requiredOption("--id <ticketId>", "Ticket id")
  .requiredOption("--comment <text>", "Closing comment")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.close", {
        ticketId: opts.id,
        comment: opts.comment
      });
      printResult(result, config.json, "Ticket closed");
    });
  });

ticketsCmd
  .command("frontier")
  .description("List open, unclaimed tickets without open blockers")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.frontier", {});
      printResult(result, config.json, "Ticket frontier");
    });
  });

ticketsCmd
  .command("blocked-by")
  .description("List a ticket's blocking edges")
  .requiredOption("--id <ticketId>", "Ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const detail = ticketDetailSchema.parse(
        await client.call("tickets.get", { ticketId: opts.id })
      );
      printResult(detail.blockedBy, config.json, "Blocked by");
    });
  });

ticketsCmd
  .command("add-blocked-by")
  .description("Add a blocker to a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .requiredOption("--blocker-id <ticketId>", "Blocking ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.addBlockedBy", {
        ticketId: opts.id,
        blockerId: opts.blockerId
      });
      printResult(result, config.json, "Blocker added");
    });
  });

ticketsCmd
  .command("remove-blocked-by")
  .description("Remove a blocker from a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .requiredOption("--blocker-id <ticketId>", "Blocking ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.removeBlockedBy", {
        ticketId: opts.id,
        blockerId: opts.blockerId
      });
      printResult(result, config.json, "Blocker removed");
    });
  });

ticketsCmd
  .command("delete")
  .description("Delete a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const bypass = Boolean(opts.yes || opts.force);
      if (!bypass) {
        const ok = await confirm(`Delete ticket ${opts.id}? This cannot be undone.`);
        if (!ok) {
          printResult({ ok: false, cancelled: true }, config.json, "Cancelled");
          return;
        }
      }

      const result = await client.call("tickets.delete", { ticketId: opts.id });
      printResult(result, config.json, "Ticket deleted");
    });
  });

ticketsCmd
  .command("attach-sprint")
  .description("Attach or clear a ticket sprint")
  .requiredOption("--id <ticketId>", "Ticket id")
  .option("--sprint-id <sprintId>", "Sprint id")
  .option("--clear", "Clear sprint assignment")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      if (!opts.clear && !opts.sprintId) {
        throw new Error("Provide --sprint-id or --clear.");
      }
      const result = await client.call("tickets.attachToSprint", {
        ticketId: opts.id,
        sprintId: opts.clear ? undefined : opts.sprintId
      });
      printResult(result, config.json, "Ticket sprint updated");
    });
  });

ticketsCmd
  .command("request-review")
  .description("Request review for a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.requestReview", { ticketId: opts.id });
      printResult(result, config.json, "Review requested");
    });
  });

ticketsCmd
  .command("approve-review")
  .description("Approve review for a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.approveReview", { ticketId: opts.id });
      printResult(result, config.json, "Review approved");
    });
  });

ticketsCmd
  .command("reject-review")
  .description("Reject review for a ticket")
  .requiredOption("--id <ticketId>", "Ticket id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("tickets.rejectReview", { ticketId: opts.id });
      printResult(result, config.json, "Review rejected");
    });
  });

const sprintsCmd = program.command("sprints").description("Sprint operations");

sprintsCmd
  .command("list")
  .description("List sprints")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("sprints.list", {});
      printResult(result, config.json, "Sprints");
    });
  });

sprintsCmd
  .command("create")
  .description("Create a sprint")
  .requiredOption("--name <name>", "Sprint name")
  .requiredOption("--start <date>", "Start date (ISO or parseable date)")
  .requiredOption("--end <date>", "End date (ISO or parseable date)")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const startDate = toTimestamp(opts.start, "start");
      const endDate = toTimestamp(opts.end, "end");
      const result = await client.call("sprints.create", {
        name: opts.name,
        startDate,
        endDate
      });
      printResult(result, config.json, "Sprint created");
    });
  });

sprintsCmd
  .command("activate")
  .description("Activate sprint")
  .requiredOption("--id <sprintId>", "Sprint id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("sprints.activate", { sprintId: opts.id });
      printResult(result, config.json, "Sprint activated");
    });
  });

sprintsCmd
  .command("complete")
  .description("Complete sprint")
  .requiredOption("--id <sprintId>", "Sprint id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("sprints.complete", { sprintId: opts.id });
      printResult(result, config.json, "Sprint completed");
    });
  });

const metricsCmd = program.command("metrics").description("Metrics operations");

metricsCmd
  .command("sprint")
  .description("Fetch sprint metrics")
  .requiredOption("--sprint-id <sprintId>", "Sprint id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("metrics.forSprint", { sprintId: opts.sprintId });
      printResult(result, config.json, "Sprint metrics");
    });
  });

metricsCmd
  .command("velocity")
  .description("Fetch velocity history")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("metrics.velocityHistory", {});
      printResult(result, config.json, "Velocity history");
    });
  });

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof GatewayClientError) {
    console.error(`Error [${error.code}]: ${error.message}`);
    process.exit(2);
  }

  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.error("Unknown error.");
  process.exit(1);
});

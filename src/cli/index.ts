#!/usr/bin/env node

import { Command, Option } from "commander";
import { GatewayClient, GatewayClientError } from "./client.js";
import { resolveCliConfig } from "./config.js";
import { printResult } from "./output.js";
import { confirm } from "./prompts.js";
import type { CliConfig, CliGlobalOptions } from "./types.js";

type AnyOptions = CliGlobalOptions & Record<string, unknown>;

function toTimestamp(rawDate: string, fieldName: string) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date string.`);
  }
  return date.getTime();
}

function getGlobalOptions(command: Command): CliGlobalOptions {
  const opts = command.optsWithGlobals<AnyOptions>();
  return {
    json: Boolean(opts.json),
    url: typeof opts.url === "string" ? opts.url : undefined,
    key: typeof opts.key === "string" ? opts.key : undefined,
    projectId: typeof opts.projectId === "string" ? opts.projectId : undefined,
    envFile: typeof opts.envFile === "string" ? opts.envFile : undefined,
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
  .description("Triathlon CLI: agent-gateway wrapper for board, sprint, and metrics workflows")
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

const boardCmd = program.command("board").description("Board operations");

boardCmd
  .command("snapshot")
  .description("Get board snapshot including columns and cards")
  .action(async (_opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("boards.getSnapshot", {});
      printResult(result, config.json, "Board snapshot");
    });
  });

const cardsCmd = program.command("cards").description("Card lifecycle operations");

cardsCmd
  .command("create")
  .description("Create a card")
  .requiredOption("--title <title>", "Card title")
  .option("--description <description>", "Card description")
  .option("--column-name <name>", "Column name", "Backlog")
  .option("--column-id <id>", "Column id")
  .option("--points <points>", "Story points", (v) => Number(v))
  .option("--priority <priority>", "Priority: low|medium|high", "medium")
  .option("--sprint-id <id>", "Sprint id")
  .option("--assignee <externalId>", "Assignee external id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("boards.createCard", {
        title: opts.title,
        description: opts.description,
        columnName: opts.columnName,
        columnId: opts.columnId,
        storyPoints: Number.isFinite(opts.points) ? opts.points : undefined,
        priority: opts.priority,
        sprintId: opts.sprintId,
        assigneeExternalId: opts.assignee,
        labels: []
      });

      printResult(result, config.json, "Card created");
    });
  });

cardsCmd
  .command("update")
  .description("Update a card")
  .requiredOption("--id <cardId>", "Card id")
  .option("--title <title>")
  .option("--description <description>")
  .option("--points <points>", "Story points", (v) => Number(v))
  .option("--priority <priority>", "Priority: low|medium|high")
  .option("--assignee <externalId>", "Assignee external id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const payload = {
        cardId: opts.id,
        title: opts.title,
        description: opts.description,
        storyPoints: Number.isFinite(opts.points) ? opts.points : undefined,
        priority: opts.priority,
        assigneeExternalId: opts.assignee
      };

      const hasUpdate = Object.entries(payload).some(
        ([key, value]) => key !== "cardId" && value !== undefined
      );

      if (!hasUpdate) {
        throw new Error("No update fields provided. Use --title/--description/--points/--priority/--assignee.");
      }

      const result = await client.call("boards.updateCard", payload);
      printResult(result, config.json, "Card updated");
    });
  });

cardsCmd
  .command("move")
  .description("Move a card to a new column")
  .requiredOption("--id <cardId>", "Card id")
  .addOption(new Option("--to-column-id <id>", "Destination column id"))
  .addOption(new Option("--to-column-name <name>", "Destination column name"))
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      if (!opts.toColumnId && !opts.toColumnName) {
        throw new Error("Provide --to-column-id or --to-column-name.");
      }

      const result = await client.call("boards.moveCard", {
        cardId: opts.id,
        toColumnId: opts.toColumnId,
        toColumnName: opts.toColumnName
      });
      printResult(result, config.json, "Card moved");
    });
  });

cardsCmd
  .command("delete")
  .description("Delete a card")
  .requiredOption("--id <cardId>", "Card id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const bypass = Boolean(opts.yes || opts.force);
      if (!bypass) {
        const ok = await confirm(`Delete card ${opts.id}? This cannot be undone.`);
        if (!ok) {
          printResult({ ok: false, cancelled: true }, config.json, "Cancelled");
          return;
        }
      }

      const result = await client.call("boards.deleteCard", { cardId: opts.id });
      printResult(result, config.json, "Card deleted");
    });
  });

cardsCmd
  .command("attach-sprint")
  .description("Attach or clear a card sprint")
  .requiredOption("--id <cardId>", "Card id")
  .option("--sprint-id <sprintId>", "Sprint id")
  .option("--clear", "Clear sprint assignment")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      if (!opts.clear && !opts.sprintId) {
        throw new Error("Provide --sprint-id or --clear.");
      }
      const result = await client.call("boards.attachCardToSprint", {
        cardId: opts.id,
        sprintId: opts.clear ? undefined : opts.sprintId
      });
      printResult(result, config.json, "Card sprint updated");
    });
  });

cardsCmd
  .command("request-review")
  .description("Request review for a card")
  .requiredOption("--id <cardId>", "Card id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("boards.requestReview", { cardId: opts.id });
      printResult(result, config.json, "Review requested");
    });
  });

cardsCmd
  .command("approve-review")
  .description("Approve review for a card")
  .requiredOption("--id <cardId>", "Card id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("boards.approveReview", { cardId: opts.id });
      printResult(result, config.json, "Review approved");
    });
  });

cardsCmd
  .command("reject-review")
  .description("Reject review for a card")
  .requiredOption("--id <cardId>", "Card id")
  .action(async (opts, command) => {
    await runWithClient(command, async ({ client, config }) => {
      const result = await client.call("boards.rejectReview", { cardId: opts.id });
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

program.parseAsync(process.argv).catch((error: unknown) => {
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

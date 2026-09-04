import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import type { GenericId as Id, JSONValue } from "convex/values";
import { z } from "zod";

type ProjectId = Id<"projects">;

const agentKeyConfigSchema = z.object({
  keyId: z.string(),
  key: z.string(),
  keyLabel: z.string().optional(),
  projectId: z.string(),
  externalId: z.string(),
  enabled: z.boolean().optional()
});

type AgentKeyConfig = z.infer<typeof agentKeyConfigSchema>;

type AgentResponse = {
  ok: boolean;
  requestId?: string;
  result?: JSONValue;
  error?: {
    code: string;
    message: string;
  };
};

// SAFETY: Agent-supplied identifier strings are Convex document Ids in
// serialized form. `Id<T>` is the same string at the type level, and the
// Convex mutation boundary re-validates the target table for every call.
const asColumnId = (id: string) => id as Id<"columns">;
// SAFETY: Same contract as `asColumnId`, for ticket Ids.
const asTicketId = (id: string) => id as Id<"tickets">;
// SAFETY: Same contract as `asColumnId`, for sprint Ids.
const asSprintId = (id: string) => id as Id<"sprints">;

// --- Request schema: each tool's arguments are decoded here, at the I/O
// boundary, into a discriminated union keyed by the tool name. ---

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);
const optionalFiniteNumber = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().finite().optional()
);
const optionalLabelList = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.array(z.string()).optional()
);
const optionalPriority = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["low", "medium", "high"]).optional()
);
const nonEmptyText = (field: string) =>
  z
    .string()
    .min(1, `${field} must be a non-empty string.`)
    .refine((value) => value.trim() !== "", `${field} must be a non-empty string.`);

const noArgs = z.object({}).strict();

const KNOWN_TOOLS = new Set<string>([
  "system.describe",
  "projects.getSummary",
  "projects.members",
  "tickets.board",
  "tickets.create",
  "tickets.get",
  "tickets.list",
  "tickets.update",
  "tickets.move",
  "tickets.comment",
  "tickets.close",
  "tickets.frontier",
  "tickets.addBlockedBy",
  "tickets.removeBlockedBy",
  "tickets.requestReview",
  "tickets.approveReview",
  "tickets.rejectReview",
  "tickets.delete",
  "tickets.attachToSprint",
  "sprints.list",
  "sprints.create",
  "sprints.activate",
  "sprints.complete",
  "metrics.forSprint",
  "metrics.velocityHistory"
]);

// Catch-all: any tool name outside the allowlist. Kept as a union member so
// unknown tools keep their distinct 403 TOOL_FORBIDDEN response.
const unknownToolSchema = z.object({
  tool: z.string().refine((tool) => !KNOWN_TOOLS.has(tool)),
  args: z.record(z.string(), z.any()).optional(),
  requestId: z.string().optional()
});

const requestSchema = z.union([
  z.object({
    tool: z.literal("system.describe"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("projects.getSummary"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("projects.members"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.board"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.list"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.frontier"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.get"),
    args: z.object({ ticketId: nonEmptyText("ticketId") }).strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.create"),
    args: z
      .object({
        columnId: optionalText,
        columnName: optionalText,
        title: nonEmptyText("title"),
        description: optionalText,
        storyPoints: optionalFiniteNumber,
        sprintId: optionalText,
        assigneeExternalId: optionalText,
        priority: optionalPriority,
        labels: optionalLabelList
      })
      .strict()
      .refine((args) => args.columnId || args.columnName, {
        message: "columnId or columnName is required."
      }),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.update"),
    args: z
      .object({
        ticketId: nonEmptyText("ticketId"),
        title: optionalText,
        description: optionalText,
        storyPoints: optionalFiniteNumber,
        priority: optionalPriority,
        labels: optionalLabelList,
        assigneeExternalId: optionalText
      })
      .strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.move"),
    args: z
      .object({
        ticketId: nonEmptyText("ticketId"),
        toColumnId: optionalText,
        toColumnName: optionalText
      })
      .strict()
      .refine((args) => args.toColumnId || args.toColumnName, {
        message: "toColumnId or toColumnName is required."
      }),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.comment"),
    args: z.object({ ticketId: nonEmptyText("ticketId"), body: nonEmptyText("body") }).strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.close"),
    args: z
      .object({ ticketId: nonEmptyText("ticketId"), comment: nonEmptyText("comment") })
      .strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.addBlockedBy"),
    args: z
      .object({
        ticketId: nonEmptyText("ticketId"),
        blockerId: nonEmptyText("blockerId")
      })
      .strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.removeBlockedBy"),
    args: z
      .object({
        ticketId: nonEmptyText("ticketId"),
        blockerId: nonEmptyText("blockerId")
      })
      .strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.enum([
      "tickets.requestReview",
      "tickets.approveReview",
      "tickets.rejectReview",
      "tickets.delete"
    ]),
    args: z.object({ ticketId: nonEmptyText("ticketId") }).strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("tickets.attachToSprint"),
    args: z.object({ ticketId: nonEmptyText("ticketId"), sprintId: optionalText }).strict(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("sprints.list"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("sprints.create"),
    args: z
      .object({
        name: nonEmptyText("name"),
        startDate: optionalFiniteNumber,
        endDate: optionalFiniteNumber
      })
      .strict()
      .optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("sprints.activate"),
    args: z
      .object({
        sprintId: nonEmptyText("sprintId")
      })
      .strict()
      .optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("sprints.complete"),
    args: z
      .object({
        sprintId: nonEmptyText("sprintId")
      })
      .strict()
      .optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("metrics.forSprint"),
    args: z
      .object({
        sprintId: nonEmptyText("sprintId")
      })
      .strict()
      .optional(),
    requestId: z.string().optional()
  }),
  z.object({
    tool: z.literal("metrics.velocityHistory"),
    args: noArgs.optional(),
    requestId: z.string().optional()
  }),
  unknownToolSchema
]);

// Used for the INVALID_TOOL / INVALID_ARGS audit paths, where the full
// discriminated parse did not succeed but the raw fields still need reading.
const looseBodySchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.any()).optional(),
  requestId: z.string().optional()
});

function toResponse(status: number, body: AgentResponse) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function loadAgentKeys(): AgentKeyConfig[] {
  const raw = process.env.AGENT_KEYS_JSON;
  if (!raw) {
    throw new Error(
      "AGENT_KEYS_JSON is not configured. Set it in Convex env (Dashboard or `npx convex env set AGENT_KEYS_JSON <json>`)."
    );
  }
  const parsed = z.array(agentKeyConfigSchema).safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("AGENT_KEYS_JSON must be a JSON array of agent key configs.");
  }
  return parsed.data;
}

function summarizeArgs(args: Record<string, JSONValue> | undefined) {
  if (!args) {
    return undefined;
  }
  const redacted: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(args)) {
    const stringValue = z.string().safeParse(value);
    if (stringValue.success && stringValue.data.length > 80) {
      redacted[key] = `${stringValue.data.slice(0, 77)}...`;
    } else {
      redacted[key] = value;
    }
  }
  return JSON.stringify(redacted);
}

function summarizeResult(result: JSONValue | undefined) {
  if (result === null || result === undefined) {
    return undefined;
  }
  const stringValue = z.string().safeParse(result);
  if (stringValue.success) {
    return stringValue.data.length > 120
      ? `${stringValue.data.slice(0, 117)}...`
      : stringValue.data;
  }
  if (Array.isArray(result)) {
    return `array(${result.length})`;
  }
  if (result instanceof Object) {
    const keys = Object.keys(result);
    return `object(${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",..." : ""})`;
  }
  return String(result);
}

type BoardForNameLookup = {
  columns?: readonly { _id: Id<"columns">; name: string }[];
} | null;

function resolveColumnIdByName(board: BoardForNameLookup, columnName: string | undefined) {
  if (!board || !columnName) {
    return undefined;
  }
  const match = board.columns?.find(
    (column) => column.name.toLowerCase() === columnName.toLowerCase()
  );
  return match?._id;
}

async function recordAudit(ctx: any, payload: {
  keyId: string;
  keyLabel?: string;
  projectId: ProjectId;
  externalId: string;
  tool: string;
  requestId?: string;
  argsSummary?: string;
  resultSummary?: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}) {
  await ctx.runMutation(internal.agentAudit.insert, {
    ...payload,
    projectId: payload.projectId,
    createdAt: Date.now()
  });
}

export const agent = httpAction(async (ctx: any, request: Request) => {
  if (request.method !== "POST") {
    return toResponse(405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });
  }

  const token = getBearerToken(request);
  if (!token) {
    return toResponse(401, { ok: false, error: { code: "UNAUTHORIZED", message: "Missing bearer token." } });
  }

  let keyConfig: AgentKeyConfig | undefined;
  try {
    const keys = loadAgentKeys();
    keyConfig = keys.find((entry) => entry.enabled !== false && entry.key === token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid AGENT_KEYS_JSON.";
    return toResponse(500, { ok: false, error: { code: "CONFIG_ERROR", message } });
  }

  if (!keyConfig) {
    return toResponse(401, { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid agent key." } });
  }

  // SAFETY: AGENT_KEYS_JSON stores each project's Convex database Id as a
  // string; `Id<"projects">` is that same string at the type level.
  const projectId = keyConfig.projectId as ProjectId;
  const externalId = keyConfig.externalId;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return toResponse(400, { ok: false, error: { code: "BAD_JSON", message: "Invalid JSON body." } });
  }

  const loose = looseBodySchema.safeParse(rawBody);
  if (!loose.success) {
    return toResponse(400, { ok: false, error: { code: "INVALID_TOOL", message: "Tool name is required." } });
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid tool arguments.";
    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId,
      externalId,
      tool: loose.data.tool,
      requestId: loose.data.requestId,
      argsSummary: summarizeArgs(loose.data.args),
      success: false,
      errorCode: "INVALID_ARGS",
      errorMessage: message
    });
    return toResponse(400, { ok: false, requestId: loose.data.requestId, error: { code: "INVALID_ARGS", message } });
  }

  const requestId = parsed.data.requestId;

  try {
    let result: JSONValue | undefined = undefined;

    switch (parsed.data.tool) {
      case "system.describe":
        result = {
          version: "2.0",
          projectScope: "single_project_per_key",
          tools: Array.from(KNOWN_TOOLS).sort()
        };
        break;
      case "projects.getSummary":
        result = await ctx.runQuery(api.projects.summary, { projectId, externalId });
        break;
      case "projects.members":
        result = await ctx.runQuery(api.projects.members, { projectId, externalId });
        break;
      case "tickets.board":
        result = await ctx.runQuery(api.tickets.board, { projectId, externalId });
        break;
      case "tickets.list":
        result = await ctx.runQuery(api.tickets.list, { projectId, externalId });
        break;
      case "tickets.frontier":
        result = await ctx.runQuery(api.tickets.frontier, { projectId, externalId });
        break;
      case "tickets.get": {
        const args = parsed.data.args ?? {};
        result = await ctx.runQuery(api.tickets.get, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId)
        });
        break;
      }
      case "tickets.create": {
        const args = parsed.data.args ?? {};
        let columnId = args.columnId;
        if (!columnId) {
          const board = await ctx.runQuery(api.tickets.board, { projectId, externalId });
          columnId = resolveColumnIdByName(board, args.columnName) ?? undefined;
        }
        if (!columnId) {
          throw new Error("Column not found. Provide columnId or a valid columnName.");
        }
        result = await ctx.runMutation(api.tickets.create, {
          projectId,
          externalId,
          columnId: asColumnId(columnId),
          title: args.title,
          description: args.description,
          storyPoints: args.storyPoints,
          sprintId: args.sprintId ? asSprintId(args.sprintId) : undefined,
          assigneeExternalId: args.assigneeExternalId,
          priority: args.priority,
          labels: args.labels
        });
        break;
      }
      case "tickets.update": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.update, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId),
          title: args.title,
          description: args.description,
          storyPoints: args.storyPoints,
          priority: args.priority,
          labels: args.labels,
          assigneeExternalId: args.assigneeExternalId
        });
        break;
      }
      case "tickets.move": {
        const args = parsed.data.args ?? {};
        let toColumnId = args.toColumnId;

        if (!toColumnId) {
          const board = await ctx.runQuery(api.tickets.board, { projectId, externalId });
          toColumnId = resolveColumnIdByName(board, args.toColumnName) ?? undefined;
        }

        if (!toColumnId) {
          throw new Error("Destination column not found. Provide toColumnId or a valid toColumnName.");
        }

        result = await ctx.runMutation(api.tickets.move, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId),
          toColumnId: asColumnId(toColumnId)
        });
        break;
      }
      case "tickets.comment": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.comment, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId),
          body: args.body
        });
        break;
      }
      case "tickets.close": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.close, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId),
          comment: args.comment
        });
        break;
      }
      case "tickets.addBlockedBy": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.addBlockedBy, {
          projectId,
          externalId,
          fromTicketId: asTicketId(args.ticketId),
          toTicketId: asTicketId(args.blockerId)
        });
        break;
      }
      case "tickets.removeBlockedBy": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.removeBlockedBy, {
          projectId,
          externalId,
          fromTicketId: asTicketId(args.ticketId),
          toTicketId: asTicketId(args.blockerId)
        });
        break;
      }
      case "tickets.requestReview":
      case "tickets.approveReview":
      case "tickets.rejectReview": {
        const args = parsed.data.args ?? {};
        const mutation = {
          "tickets.requestReview": api.tickets.requestReview,
          "tickets.approveReview": api.tickets.approveReview,
          "tickets.rejectReview": api.tickets.rejectReview
        }[parsed.data.tool];
        result = await ctx.runMutation(mutation, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId)
        });
        break;
      }
      case "tickets.delete": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.remove, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId)
        });
        break;
      }
      case "tickets.attachToSprint": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.tickets.attachToSprint, {
          projectId,
          externalId,
          ticketId: asTicketId(args.ticketId),
          sprintId: args.sprintId ? asSprintId(args.sprintId) : undefined
        });
        break;
      }
      case "sprints.list":
        result = await ctx.runQuery(api.sprints.list, { projectId, externalId });
        break;
      case "sprints.create": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.sprints.create, {
          projectId,
          externalId,
          name: args.name,
          startDate: args.startDate,
          endDate: args.endDate
        });
        break;
      }
      case "sprints.activate": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.sprints.activate, {
          projectId,
          externalId,
          sprintId: asSprintId(args.sprintId)
        });
        break;
      }
      case "sprints.complete": {
        const args = parsed.data.args ?? {};
        result = await ctx.runMutation(api.sprints.complete, {
          projectId,
          externalId,
          sprintId: asSprintId(args.sprintId)
        });
        break;
      }
      case "metrics.forSprint": {
        const args = parsed.data.args ?? {};
        result = await ctx.runQuery(api.metrics.forSprint, {
          projectId,
          externalId,
          sprintId: asSprintId(args.sprintId)
        });
        break;
      }
      case "metrics.velocityHistory":
        result = await ctx.runQuery(api.metrics.velocityHistory, { projectId, externalId });
        break;
      default:
        await recordAudit(ctx, {
          keyId: keyConfig.keyId,
          keyLabel: keyConfig.keyLabel,
          projectId,
          externalId,
          tool: parsed.data.tool,
          requestId,
          argsSummary: summarizeArgs(parsed.data.args),
          success: false,
          errorCode: "TOOL_FORBIDDEN",
          errorMessage: "Tool not allowed."
        });
        return toResponse(403, { ok: false, requestId, error: { code: "TOOL_FORBIDDEN", message: "Tool not allowed." } });
    }

    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId,
      externalId,
      tool: parsed.data.tool,
      requestId,
      argsSummary: summarizeArgs(parsed.data.args),
      resultSummary: summarizeResult(result),
      success: true
    });

    return toResponse(200, { ok: true, requestId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId,
      externalId,
      tool: parsed.data.tool,
      requestId,
      argsSummary: summarizeArgs(parsed.data.args),
      success: false,
      errorCode: "TOOL_ERROR",
      errorMessage: message
    });
    return toResponse(500, { ok: false, requestId, error: { code: "TOOL_ERROR", message } });
  }
});

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";

type AgentKeyConfig = {
  keyId: string;
  key: string;
  keyLabel?: string;
  projectId: string;
  externalId: string;
  enabled?: boolean;
};

type AgentRequest = {
  tool: string;
  args?: Record<string, unknown>;
  requestId?: string;
};

type AgentResponse = {
  ok: boolean;
  requestId?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

const PRIORITY_VALUES = new Set(["low", "medium", "high"]);

type ArgValidator = (input: unknown) => Record<string, unknown>;

function ensureObject(input: unknown) {
  if (input === undefined || input === null) {
    return {} as Record<string, unknown>;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Arguments must be an object.");
  }
  return input as Record<string, unknown>;
}

function assertNoExtraKeys(obj: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unexpected argument: ${key}.`);
    }
  }
}

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, name: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value === "" ? undefined : value;
}

function optionalNumber(value: unknown, name: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function optionalStringArray(value: unknown, name: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings.`);
  }
  if (value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value as string[];
}

const TOOL_VALIDATORS: Record<string, ArgValidator> = {
  "system.describe": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  },
  "projects.getSummary": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  },

  "projects.members": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  },
  "boards.getSnapshot": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  },
  "boards.createCard": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, [
      "columnId",
      "columnName",
      "title",
      "description",
      "storyPoints",
      "sprintId",
      "assigneeExternalId",
      "priority",
      "labels"
    ]);
    const title = requireString(obj.title, "title");
    const priority = optionalString(obj.priority, "priority");
    if (priority && !PRIORITY_VALUES.has(priority)) {
      throw new Error("priority must be low, medium, or high.");
    }
    return {
      columnId: optionalString(obj.columnId, "columnId"),
      columnName: optionalString(obj.columnName, "columnName"),
      title,
      description: optionalString(obj.description, "description"),
      storyPoints: optionalNumber(obj.storyPoints, "storyPoints"),
      sprintId: optionalString(obj.sprintId, "sprintId"),
      assigneeExternalId: optionalString(obj.assigneeExternalId, "assigneeExternalId"),
      priority,
      labels: optionalStringArray(obj.labels, "labels")
    };
  },
  "boards.updateCard": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, [
      "cardId",
      "title",
      "description",
      "storyPoints",
      "priority",
      "labels",
      "assigneeExternalId"
    ]);
    const cardId = requireString(obj.cardId, "cardId");
    const priority = optionalString(obj.priority, "priority");
    if (priority && !PRIORITY_VALUES.has(priority)) {
      throw new Error("priority must be low, medium, or high.");
    }
    return {
      cardId,
      title: optionalString(obj.title, "title"),
      description: optionalString(obj.description, "description"),
      storyPoints: optionalNumber(obj.storyPoints, "storyPoints"),
      priority,
      labels: optionalStringArray(obj.labels, "labels"),
      assigneeExternalId: optionalString(obj.assigneeExternalId, "assigneeExternalId")
    };
  },
  "boards.moveCard": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["cardId", "toColumnId", "toColumnName"]);
    const toColumnId = optionalString(obj.toColumnId, "toColumnId");
    const toColumnName = optionalString(obj.toColumnName, "toColumnName");

    if (!toColumnId && !toColumnName) {
      throw new Error("toColumnId or toColumnName is required.");
    }

    return {
      cardId: requireString(obj.cardId, "cardId"),
      toColumnId,
      toColumnName
    };
  },
  "boards.deleteCard": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["cardId"]);
    return { cardId: requireString(obj.cardId, "cardId") };
  },
  "boards.attachCardToSprint": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["cardId", "sprintId"]);
    return {
      cardId: requireString(obj.cardId, "cardId"),
      sprintId: optionalString(obj.sprintId, "sprintId")
    };
  },
  "sprints.list": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  },
  "sprints.create": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["name", "startDate", "endDate"]);
    const startDate = optionalNumber(obj.startDate, "startDate");
    const endDate = optionalNumber(obj.endDate, "endDate");
    if (startDate === undefined || endDate === undefined) {
      throw new Error("startDate and endDate are required.");
    }
    return {
      name: requireString(obj.name, "name"),
      startDate,
      endDate
    };
  },
  "sprints.activate": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["sprintId"]);
    return { sprintId: requireString(obj.sprintId, "sprintId") };
  },
  "sprints.complete": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["sprintId"]);
    return { sprintId: requireString(obj.sprintId, "sprintId") };
  },
  "metrics.forSprint": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, ["sprintId"]);
    return { sprintId: requireString(obj.sprintId, "sprintId") };
  },
  "metrics.velocityHistory": (input) => {
    const obj = ensureObject(input);
    assertNoExtraKeys(obj, []);
    return {};
  }
};

const TOOL_ALLOWLIST = new Set(Object.keys(TOOL_VALIDATORS));

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

function loadAgentKeys() {
  const raw = process.env.AGENT_KEYS_JSON;
  if (!raw) {
    throw new Error(
      "AGENT_KEYS_JSON is not configured. Set it in Convex env (Dashboard or `npx convex env set AGENT_KEYS_JSON <json>`)."
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("AGENT_KEYS_JSON must be a JSON array.");
  }
  return parsed as AgentKeyConfig[];
}

function summarizeArgs(args: Record<string, unknown> | undefined) {
  if (!args) {
    return undefined;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 80) {
      redacted[key] = `${value.slice(0, 77)}...`;
    } else {
      redacted[key] = value;
    }
  }
  return JSON.stringify(redacted);
}

function summarizeResult(result: unknown) {
  if (result === null || result === undefined) {
    return undefined;
  }
  if (typeof result === "string") {
    return result.length > 120 ? `${result.slice(0, 117)}...` : result;
  }
  if (Array.isArray(result)) {
    return `array(${result.length})`;
  }
  if (typeof result === "object") {
    const keys = Object.keys(result as Record<string, unknown>);
    return `object(${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",..." : ""})`;
  }
  return String(result);
}

function resolveColumnIdByName(board: any, columnName: string | undefined) {
  if (!board || !columnName) {
    return undefined;
  }
  const match = board.columns?.find(
    (column: any) =>
      typeof column?.name === "string" && column.name.toLowerCase() === columnName.toLowerCase()
  );
  return match?._id as string | undefined;
}

async function recordAudit(ctx: any, payload: {
  keyId: string;
  keyLabel?: string;
  projectId: string;
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
    projectId: payload.projectId as any,
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

  let body: AgentRequest;
  try {
    body = (await request.json()) as AgentRequest;
  } catch {
    return toResponse(400, { ok: false, error: { code: "BAD_JSON", message: "Invalid JSON body." } });
  }

  const tool = body?.tool;
  if (!tool || typeof tool !== "string") {
    return toResponse(400, { ok: false, error: { code: "INVALID_TOOL", message: "Tool name is required." } });
  }

  if (!TOOL_ALLOWLIST.has(tool)) {
    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId: keyConfig.projectId,
      externalId: keyConfig.externalId,
      tool,
      requestId: body.requestId,
      argsSummary: summarizeArgs(body.args),
      success: false,
      errorCode: "TOOL_FORBIDDEN",
      errorMessage: "Tool not allowed."
    });
    return toResponse(403, { ok: false, requestId: body.requestId, error: { code: "TOOL_FORBIDDEN", message: "Tool not allowed." } });
  }

  let args: Record<string, unknown> = {};
  try {
    const validator = TOOL_VALIDATORS[tool];
    args = validator(body.args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid tool arguments.";
    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId: keyConfig.projectId,
      externalId: keyConfig.externalId,
      tool,
      requestId: body.requestId,
      argsSummary: summarizeArgs(body.args),
      success: false,
      errorCode: "INVALID_ARGS",
      errorMessage: message
    });
    return toResponse(400, { ok: false, requestId: body.requestId, error: { code: "INVALID_ARGS", message } });
  }

  try {
    let result: unknown = null;
    const projectId = keyConfig.projectId as any;
    const externalId = keyConfig.externalId;

    switch (tool) {
      case "system.describe":
        result = {
          version: "1.1",
          projectScope: "single_project_per_key",
          tools: Array.from(TOOL_ALLOWLIST).sort()
        };
        break;
      case "projects.getSummary":
        result = await ctx.runQuery(api.projects.summary, { projectId, externalId });
        break;

      case "projects.members":
        result = await ctx.runQuery(api.projects.members, { projectId, externalId });
        break;
      case "boards.getSnapshot":
        result = await ctx.runQuery(api.boards.getBoard, { projectId, externalId });
        break;
      case "boards.createCard": {
        let columnId = args.columnId as string | undefined;
        if (!columnId) {
          const board = await ctx.runQuery(api.boards.getBoard, { projectId, externalId });
          columnId = resolveColumnIdByName(board, args.columnName as string | undefined) ?? undefined;
        }
        if (!columnId) {
          throw new Error("Column not found. Provide columnId or a valid columnName.");
        }
        result = await ctx.runMutation(api.boards.createCard, {
          projectId,
          externalId,
          columnId,
          title: args.title as string,
          description: args.description as string | undefined,
          storyPoints: args.storyPoints as number | undefined,
          sprintId: args.sprintId as string | undefined,
          assigneeExternalId: args.assigneeExternalId as string | undefined,
          priority: args.priority as any,
          labels: args.labels as string[] | undefined
        });
        break;
      }
      case "boards.updateCard":
        result = await ctx.runMutation(api.boards.updateCard, {
          projectId,
          externalId,
          cardId: args.cardId as string,
          title: args.title as string | undefined,
          description: args.description as string | undefined,
          storyPoints: args.storyPoints as number | undefined,
          priority: args.priority as any,
          labels: args.labels as string[] | undefined,
          assigneeExternalId: args.assigneeExternalId as string | undefined
        });
        break;
      case "boards.moveCard": {
        let toColumnId = args.toColumnId as string | undefined;

        if (!toColumnId) {
          const board = await ctx.runQuery(api.boards.getBoard, { projectId, externalId });
          toColumnId = resolveColumnIdByName(board, args.toColumnName as string | undefined) ?? undefined;
        }

        if (!toColumnId) {
          throw new Error("Destination column not found. Provide toColumnId or a valid toColumnName.");
        }

        result = await ctx.runMutation(api.boards.moveCard, {
          projectId,
          externalId,
          cardId: args.cardId as string,
          toColumnId
        });
        break;
      }
      case "boards.deleteCard":
        result = await ctx.runMutation(api.boards.deleteCard, {
          projectId,
          externalId,
          cardId: args.cardId as string
        });
        break;
      case "boards.attachCardToSprint":
        result = await ctx.runMutation(api.boards.attachCardToSprint, {
          projectId,
          externalId,
          cardId: args.cardId as string,
          sprintId: (args.sprintId as string) || undefined
        });
        break;
      case "sprints.list":
        result = await ctx.runQuery(api.sprints.list, { projectId, externalId });
        break;
      case "sprints.create":
        result = await ctx.runMutation(api.sprints.create, {
          projectId,
          externalId,
          name: args.name as string,
          startDate: args.startDate as number,
          endDate: args.endDate as number
        });
        break;
      case "sprints.activate":
        result = await ctx.runMutation(api.sprints.activate, {
          projectId,
          externalId,
          sprintId: args.sprintId as string
        });
        break;
      case "sprints.complete":
        result = await ctx.runMutation(api.sprints.complete, {
          projectId,
          externalId,
          sprintId: args.sprintId as string
        });
        break;
      case "metrics.forSprint":
        result = await ctx.runQuery(api.metrics.forSprint, {
          projectId,
          externalId,
          sprintId: args.sprintId as string
        });
        break;
      case "metrics.velocityHistory":
        result = await ctx.runQuery(api.metrics.velocityHistory, { projectId, externalId });
        break;
      default:
        return toResponse(404, { ok: false, requestId: body.requestId, error: { code: "UNKNOWN_TOOL", message: "Unknown tool." } });
    }

    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId: keyConfig.projectId,
      externalId: keyConfig.externalId,
      tool,
      requestId: body.requestId,
      argsSummary: summarizeArgs(args),
      resultSummary: summarizeResult(result),
      success: true
    });

    return toResponse(200, { ok: true, requestId: body.requestId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    await recordAudit(ctx, {
      keyId: keyConfig.keyId,
      keyLabel: keyConfig.keyLabel,
      projectId: keyConfig.projectId,
      externalId: keyConfig.externalId,
      tool,
      requestId: body.requestId,
      argsSummary: summarizeArgs(body.args),
      success: false,
      errorCode: "TOOL_ERROR",
      errorMessage: message
    });
    return toResponse(500, { ok: false, requestId: body.requestId, error: { code: "TOOL_ERROR", message } });
  }
});

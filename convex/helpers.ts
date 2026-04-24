import { ConvexError } from "convex/values";

export const DEFAULT_COLUMNS = ["Backlog", "Todo", "In Progress", "Review", "Done"];

function readProjectAdminExternalIds() {
  const raw = process.env.PROJECT_ADMIN_EXTERNAL_IDS_JSON;
  if (!raw) {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    const values = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return new Set(values);
  } catch {
    return new Set<string>();
  }
}

export async function getUserByExternalId(ctx: any, externalId: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_externalId", (q: any) => q.eq("externalId", externalId))
    .unique();
  if (!user) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not found." });
  }
  return user;
}

export async function canCreateProjects(ctx: any, externalId: string) {
  const adminIds = readProjectAdminExternalIds();
  if (adminIds.has(externalId)) {
    return { canCreate: true as const, reason: "admin_allowlist" };
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_externalId", (q: any) => q.eq("externalId", externalId))
    .unique();

  if (!user) {
    return { canCreate: false as const, reason: "user_not_found" };
  }

  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
    .collect();

  const isOwnerAnywhere = memberships.some((membership: any) => membership.role === "owner");

  if (isOwnerAnywhere) {
    return { canCreate: true as const, reason: "owner_membership" };
  }

  return { canCreate: false as const, reason: "owner_or_admin_required" };
}

export async function assertCanCreateProjects(ctx: any, externalId: string) {
  const access = await canCreateProjects(ctx, externalId);
  if (!access.canCreate) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only workspace owners or admins can create projects."
    });
  }
}

export async function ensureProjectMember(ctx: any, projectId: string, externalId: string) {
  const user = await getUserByExternalId(ctx, externalId);

  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_projectId_userId", (q: any) => q.eq("projectId", projectId).eq("userId", user._id))
    .unique();

  if (!membership) {
    throw new ConvexError({ code: "FORBIDDEN", message: "You are not a member of this project." });
  }

  return { user, membership };
}

export async function seedDefaultBoard(ctx: any, projectId: string, createdAt = Date.now()) {
  const boardId = await ctx.db.insert("boards", {
    projectId,
    name: "Main Board",
    createdAt
  });

  await Promise.all(
    DEFAULT_COLUMNS.map((columnName, position) =>
      ctx.db.insert("columns", {
        boardId,
        name: columnName,
        position,
        createdAt
      })
    )
  );

  return boardId;
}

export async function getBoardByProjectId(ctx: any, projectId: string) {
  const board = await ctx.db
    .query("boards")
    .withIndex("by_projectId", (q: any) => q.eq("projectId", projectId))
    .unique();
  if (!board) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Board not found." });
  }
  return board;
}

export async function getColumnByName(ctx: any, boardId: string, columnName: string) {
  const columns = await ctx.db
    .query("columns")
    .withIndex("by_boardId_position", (q: any) => q.eq("boardId", boardId))
    .collect();
  return columns.find((column: any) => column.name.toLowerCase() === columnName.toLowerCase()) ?? null;
}

export function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function eachDayBetween(startTimestamp: number, endTimestamp: number) {
  const days: number[] = [];
  const pointer = new Date(startOfDay(startTimestamp));
  const end = startOfDay(endTimestamp);

  while (pointer.getTime() <= end) {
    days.push(pointer.getTime());
    pointer.setDate(pointer.getDate() + 1);
    pointer.setHours(0, 0, 0, 0);
  }

  return days;
}

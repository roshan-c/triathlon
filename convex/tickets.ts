import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v, type GenericId as Id } from "convex/values";
import { ensureProjectMember, getBoardByProjectId, getUserByExternalId } from "./helpers";

const query = queryGeneric;
const mutation = mutationGeneric;

const priority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
const linkType = v.union(v.literal("blockedBy"), v.literal("parentOf"));

type TicketPatch = {
  updatedAt: number;
  columnId?: Id<"columns">;
  sprintId?: Id<"sprints">;
  title?: string;
  description?: string;
  storyPoints?: number;
  priority?: "low" | "medium" | "high";
  labels?: string[];
  assigneeId?: Id<"users">;
  reviewStatus?: "none" | "requested" | "approved" | "rejected";
  reviewedBy?: Id<"users">;
  reviewedAt?: number;
};

async function getTicketForProject(ctx: any, projectId: Id<"projects">, ticketId: Id<"tickets">) {
  const ticket = await ctx.db.get(ticketId);
  if (!ticket || ticket.projectId !== projectId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Ticket not found." });
  }
  return ticket;
}

async function getDoneColumn(ctx: any, boardId: Id<"boards">) {
  const columns = await ctx.db
    .query("columns")
    .withIndex("by_boardId_position", (q: any) => q.eq("boardId", boardId))
    .collect();
  const done = columns.find((column: any) => column.name.toLowerCase() === "done");
  if (!done) {
    throw new ConvexError({ code: "DONE_COLUMN_MISSING", message: "This board has no Done column." });
  }
  return done;
}

function assertCanEnterDone(ticket: any) {
  const status = ticket.reviewStatus ?? "none";
  if (status === "requested") {
    throw new ConvexError({
      code: "REVIEW_REQUIRED",
      message: "This ticket is awaiting review. Approve the review before moving it to Done."
    });
  }
  if (status === "rejected") {
    throw new ConvexError({
      code: "REVIEW_REJECTED",
      message: "This ticket was rejected in review. Re-request review after addressing feedback."
    });
  }
}

async function nextTicketNumber(ctx: any, projectId: Id<"projects">) {
  const counter = await ctx.db
    .query("ticketCounters")
    .withIndex("by_projectId", (q: any) => q.eq("projectId", projectId))
    .unique();
  if (!counter) {
    await ctx.db.insert("ticketCounters", { projectId, nextNumber: 2 });
    return 1;
  }
  const number = counter.nextNumber;
  await ctx.db.patch(counter._id, { nextNumber: number + 1 });
  return number;
}

async function resolveAssignee(ctx: any, projectId: Id<"projects">, externalId: string) {
  const assignee = await getUserByExternalId(ctx, externalId);
  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_projectId_userId", (q: any) =>
      q.eq("projectId", projectId).eq("userId", assignee._id)
    )
    .unique();
  if (!membership) {
    throw new ConvexError({ code: "INVALID_ASSIGNEE", message: "Assignee must be a project member." });
  }
  return assignee._id;
}

export const board = query({
  args: { projectId: v.id("projects"), externalId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const [columns, tickets] = await Promise.all([
      ctx.db
        .query("columns")
        .withIndex("by_boardId_position", (q: any) => q.eq("boardId", board._id))
        .collect(),
      ctx.db
        .query("tickets")
        .withIndex("by_boardId", (q: any) => q.eq("boardId", board._id))
        .collect()
    ]);
    return {
      boardId: board._id,
      boardName: board.name,
      columns: columns.map((column: any) => ({
        _id: column._id,
        name: column.name,
        position: column.position,
        tickets: tickets
          .filter((ticket: any) => ticket.columnId === column._id)
          .sort((left: any, right: any) => left.number - right.number)
      }))
    };
  }
});

export const list = query({
  args: { projectId: v.id("projects"), externalId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    return await ctx.db
      .query("tickets")
      .withIndex("by_projectId", (q: any) => q.eq("projectId", args.projectId))
      .collect();
  }
});

export const get = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets")
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const ticket = await getTicketForProject(ctx, args.projectId, args.ticketId);
    const [comments, blockedBy, blocks, children, parents] = await Promise.all([
      ctx.db
        .query("ticketComments")
        .withIndex("by_ticketId_createdAt", (q: any) => q.eq("ticketId", args.ticketId))
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_fromTicketId_type", (q: any) =>
          q.eq("fromTicketId", args.ticketId).eq("type", "blockedBy")
        )
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_toTicketId_type", (q: any) =>
          q.eq("toTicketId", args.ticketId).eq("type", "blockedBy")
        )
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_fromTicketId_type", (q: any) =>
          q.eq("fromTicketId", args.ticketId).eq("type", "parentOf")
        )
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_toTicketId_type", (q: any) =>
          q.eq("toTicketId", args.ticketId).eq("type", "parentOf")
        )
        .collect()
    ]);
    return { ticket, comments, blockedBy, blocks, children, parents };
  }
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    columnId: v.id("columns"),
    title: v.string(),
    description: v.optional(v.string()),
    storyPoints: v.optional(v.number()),
    sprintId: v.optional(v.id("sprints")),
    assigneeExternalId: v.optional(v.string()),
    priority: v.optional(priority),
    labels: v.optional(v.array(v.string()))
  },
  returns: v.object({ ticketId: v.id("tickets"), number: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const column = await ctx.db.get(args.columnId);
    if (!column || column.boardId !== board._id) {
      throw new ConvexError({ code: "INVALID_COLUMN", message: "Column does not belong to this board." });
    }
    if (args.sprintId) {
      const sprint = await ctx.db.get(args.sprintId);
      if (!sprint || sprint.projectId !== args.projectId) {
        throw new ConvexError({ code: "INVALID_SPRINT", message: "Sprint not found." });
      }
    }
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError({ code: "INVALID_TITLE", message: "Ticket title is required." });
    }
    const assigneeId = args.assigneeExternalId
      ? await resolveAssignee(ctx, args.projectId, args.assigneeExternalId)
      : undefined;
    const number = await nextTicketNumber(ctx, args.projectId);
    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      projectId: args.projectId,
      boardId: board._id,
      columnId: args.columnId,
      number,
      sprintId: args.sprintId,
      title,
      description: args.description?.trim() ?? "",
      storyPoints: Math.max(0, args.storyPoints ?? 0),
      priority: args.priority ?? "medium",
      assigneeId,
      labels: args.labels ?? [],
      reviewStatus: "none",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now
    });
    return { ticketId, number };
  }
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    storyPoints: v.optional(v.number()),
    priority: v.optional(priority),
    labels: v.optional(v.array(v.string())),
    assigneeExternalId: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const patch: TicketPatch = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError({ code: "INVALID_TITLE", message: "Ticket title is required." });
      }
      patch.title = title;
    }
    if (args.description !== undefined) patch.description = args.description.trim();
    if (args.storyPoints !== undefined) patch.storyPoints = Math.max(0, args.storyPoints);
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.labels !== undefined) patch.labels = args.labels;
    if (args.assigneeExternalId !== undefined) {
      patch.assigneeId = args.assigneeExternalId
        ? await resolveAssignee(ctx, args.projectId, args.assigneeExternalId)
        : undefined;
    }
    await ctx.db.patch(args.ticketId, patch);
    return null;
  }
});

export const move = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets"),
    toColumnId: v.id("columns")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const ticket = await getTicketForProject(ctx, args.projectId, args.ticketId);
    const destination = await ctx.db.get(args.toColumnId);
    if (!destination || destination.boardId !== ticket.boardId) {
      throw new ConvexError({ code: "INVALID_COLUMN", message: "Destination column is invalid." });
    }
    if (ticket.columnId === args.toColumnId) return null;
    if (destination.name.toLowerCase() === "done") assertCanEnterDone(ticket);
    const now = Date.now();
    await ctx.db.patch(args.ticketId, { columnId: args.toColumnId, updatedAt: now });
    await ctx.db.insert("ticketEvents", {
      ticketId: args.ticketId,
      fromColumnId: ticket.columnId,
      toColumnId: args.toColumnId,
      movedBy: user._id,
      movedAt: now
    });
    return null;
  }
});

export const comment = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets"),
    body: v.string()
  },
  returns: v.id("ticketComments"),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const body = args.body.trim();
    if (!body) {
      throw new ConvexError({ code: "INVALID_COMMENT", message: "Comment body is required." });
    }
    return await ctx.db.insert("ticketComments", {
      ticketId: args.ticketId,
      authorId: user._id,
      body,
      createdAt: Date.now()
    });
  }
});

export const close = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets"),
    comment: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const ticket = await getTicketForProject(ctx, args.projectId, args.ticketId);
    const body = args.comment.trim();
    if (!body) {
      throw new ConvexError({ code: "INVALID_COMMENT", message: "A closing comment is required." });
    }
    const done = await getDoneColumn(ctx, ticket.boardId);
    if (ticket.columnId !== done._id) assertCanEnterDone(ticket);
    const now = Date.now();
    await ctx.db.insert("ticketComments", {
      ticketId: args.ticketId,
      authorId: user._id,
      body,
      createdAt: now
    });
    if (ticket.columnId !== done._id) {
      await ctx.db.patch(args.ticketId, { columnId: done._id, updatedAt: now });
      await ctx.db.insert("ticketEvents", {
        ticketId: args.ticketId,
        fromColumnId: ticket.columnId,
        toColumnId: done._id,
        movedBy: user._id,
        movedAt: now
      });
    }
    return null;
  }
});

async function createLink(
  ctx: any,
  args: {
    projectId: Id<"projects">;
    externalId: string;
    fromTicketId: Id<"tickets">;
    toTicketId: Id<"tickets">;
  },
  type: "blockedBy" | "parentOf"
) {
  const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
  if (args.fromTicketId === args.toTicketId) {
    throw new ConvexError({ code: "INVALID_LINK", message: "A ticket cannot link to itself." });
  }
  await Promise.all([
    getTicketForProject(ctx, args.projectId, args.fromTicketId),
    getTicketForProject(ctx, args.projectId, args.toTicketId)
  ]);
  const links = await ctx.db
    .query("ticketLinks")
    .withIndex("by_fromTicketId_type", (q: any) =>
      q.eq("fromTicketId", args.fromTicketId).eq("type", type)
    )
    .collect();
  const existing = links.find((link: any) => link.toTicketId === args.toTicketId);
  if (existing) return existing._id;
  return await ctx.db.insert("ticketLinks", {
    projectId: args.projectId,
    fromTicketId: args.fromTicketId,
    toTicketId: args.toTicketId,
    type,
    createdBy: user._id,
    createdAt: Date.now()
  });
}

async function deleteLink(
  ctx: any,
  args: {
    projectId: Id<"projects">;
    externalId: string;
    fromTicketId: Id<"tickets">;
    toTicketId: Id<"tickets">;
  },
  type: "blockedBy" | "parentOf"
) {
  await ensureProjectMember(ctx, args.projectId, args.externalId);
  await Promise.all([
    getTicketForProject(ctx, args.projectId, args.fromTicketId),
    getTicketForProject(ctx, args.projectId, args.toTicketId)
  ]);
  const links = await ctx.db
    .query("ticketLinks")
    .withIndex("by_fromTicketId_type", (q: any) =>
      q.eq("fromTicketId", args.fromTicketId).eq("type", type)
    )
    .collect();
  const link = links.find((candidate: any) => candidate.toTicketId === args.toTicketId);
  if (link) await ctx.db.delete(link._id);
  return null;
}

const linkArgs = {
  projectId: v.id("projects"),
  externalId: v.string(),
  fromTicketId: v.id("tickets"),
  toTicketId: v.id("tickets")
};

export const addLink = mutation({
  args: {
    ...linkArgs,
    type: linkType
  },
  returns: v.id("ticketLinks"),
  handler: async (ctx, args) => await createLink(ctx, args, args.type)
});

export const removeLink = mutation({
  args: {
    ...linkArgs,
    type: linkType
  },
  returns: v.null(),
  handler: async (ctx, args) => await deleteLink(ctx, args, args.type)
});

export const addBlockedBy = mutation({
  args: linkArgs,
  returns: v.id("ticketLinks"),
  handler: async (ctx, args) => await createLink(ctx, args, "blockedBy")
});

export const removeBlockedBy = mutation({
  args: linkArgs,
  returns: v.null(),
  handler: async (ctx, args) => await deleteLink(ctx, args, "blockedBy")
});

export const addParentOf = mutation({
  args: linkArgs,
  returns: v.id("ticketLinks"),
  handler: async (ctx, args) => await createLink(ctx, args, "parentOf")
});

export const removeParentOf = mutation({
  args: linkArgs,
  returns: v.null(),
  handler: async (ctx, args) => await deleteLink(ctx, args, "parentOf")
});

export const blockedBy = query({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const links = await ctx.db
      .query("ticketLinks")
      .withIndex("by_fromTicketId_type", (q: any) =>
        q.eq("fromTicketId", args.ticketId).eq("type", "blockedBy")
      )
      .collect();
    return await Promise.all(links.map((link: any) => ctx.db.get(link.toTicketId)));
  }
});

export const dependencies = query({
  args: { projectId: v.id("projects"), externalId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const [tickets, links] = await Promise.all([
      ctx.db
        .query("tickets")
        .withIndex("by_projectId", (q: any) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_projectId_type", (q: any) =>
          q.eq("projectId", args.projectId).eq("type", "blockedBy")
        )
        .collect()
    ]);

    return {
      tickets: tickets.sort((left: any, right: any) => left.number - right.number),
      links
    };
  }
});

export const toggleBlocks = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    blockerTicketId: v.id("tickets"),
    blockedTicketId: v.id("tickets")
  },
  returns: v.object({ active: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    if (args.blockerTicketId === args.blockedTicketId) {
      throw new ConvexError({ code: "INVALID_LINK", message: "A ticket cannot block itself." });
    }

    await Promise.all([
      getTicketForProject(ctx, args.projectId, args.blockerTicketId),
      getTicketForProject(ctx, args.projectId, args.blockedTicketId)
    ]);

    const links = await ctx.db
      .query("ticketLinks")
      .withIndex("by_fromTicketId_type", (q: any) =>
        q.eq("fromTicketId", args.blockedTicketId).eq("type", "blockedBy")
      )
      .collect();
    const existing = links.find((link: any) => link.toTicketId === args.blockerTicketId);

    if (existing) {
      await ctx.db.delete(existing._id);
      return { active: false };
    }

    await ctx.db.insert("ticketLinks", {
      projectId: args.projectId,
      fromTicketId: args.blockedTicketId,
      toTicketId: args.blockerTicketId,
      type: "blockedBy",
      createdBy: user._id,
      createdAt: Date.now()
    });
    return { active: true };
  }
});

export const frontier = query({
  args: { projectId: v.id("projects"), externalId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const done = await getDoneColumn(ctx, board._id);
    const [tickets, links] = await Promise.all([
      ctx.db
        .query("tickets")
        .withIndex("by_projectId", (q: any) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_projectId_type", (q: any) =>
          q.eq("projectId", args.projectId).eq("type", "blockedBy")
        )
        .collect()
    ]);
    const ticketsById = new Map(tickets.map((ticket: any) => [ticket._id, ticket]));
    const blockedIds = new Set(
      links
        .filter((link: any) => ticketsById.get(link.toTicketId)?.columnId !== done._id)
        .map((link: any) => link.fromTicketId)
    );
    return tickets
      .filter(
        (ticket: any) =>
          ticket.columnId !== done._id && ticket.assigneeId === undefined && !blockedIds.has(ticket._id)
      )
      .sort((left: any, right: any) => left.number - right.number);
  }
});

export const requestReview = mutation({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    await ctx.db.patch(args.ticketId, { reviewStatus: "requested", updatedAt: Date.now() });
    return null;
  }
});

export const approveReview = mutation({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const now = Date.now();
    await ctx.db.patch(args.ticketId, {
      reviewStatus: "approved",
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now
    });
    return null;
  }
});

export const rejectReview = mutation({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const now = Date.now();
    await ctx.db.patch(args.ticketId, {
      reviewStatus: "rejected",
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now
    });
    return null;
  }
});

export const attachToSprint = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    ticketId: v.id("tickets"),
    sprintId: v.optional(v.id("sprints"))
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    if (args.sprintId) {
      const sprint = await ctx.db.get(args.sprintId);
      if (!sprint || sprint.projectId !== args.projectId) {
        throw new ConvexError({ code: "INVALID_SPRINT", message: "Sprint not found." });
      }
    }
    await ctx.db.patch(args.ticketId, { sprintId: args.sprintId, updatedAt: Date.now() });
    return null;
  }
});

export const activity = query({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    return await ctx.db
      .query("ticketEvents")
      .withIndex("by_ticketId_movedAt", (q: any) => q.eq("ticketId", args.ticketId))
      .collect();
  }
});

export const remove = mutation({
  args: { projectId: v.id("projects"), externalId: v.string(), ticketId: v.id("tickets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    await getTicketForProject(ctx, args.projectId, args.ticketId);
    const [events, comments, outgoing, incoming] = await Promise.all([
      ctx.db
        .query("ticketEvents")
        .withIndex("by_ticketId_movedAt", (q: any) => q.eq("ticketId", args.ticketId))
        .collect(),
      ctx.db
        .query("ticketComments")
        .withIndex("by_ticketId_createdAt", (q: any) => q.eq("ticketId", args.ticketId))
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_fromTicketId_type", (q: any) => q.eq("fromTicketId", args.ticketId))
        .collect(),
      ctx.db
        .query("ticketLinks")
        .withIndex("by_toTicketId_type", (q: any) => q.eq("toTicketId", args.ticketId))
        .collect()
    ]);
    const related = [...events, ...comments, ...outgoing, ...incoming];
    await Promise.all(related.map((document: any) => ctx.db.delete(document._id)));
    await ctx.db.delete(args.ticketId);
    return null;
  }
});

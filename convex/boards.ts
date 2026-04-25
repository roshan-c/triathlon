import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import { ensureProjectMember, getBoardByProjectId, getUserByExternalId } from "./helpers";

const query = queryGeneric;
const mutation = mutationGeneric;

export const getBoard = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.union(
    v.null(),
    v.object({
      boardId: v.id("boards"),
      boardName: v.string(),
      columns: v.array(
        v.object({
          _id: v.id("columns"),
          name: v.string(),
          position: v.number(),
          cards: v.array(
            v.object({
              _id: v.id("cards"),
              title: v.string(),
              description: v.string(),
              storyPoints: v.number(),
              priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
              sprintId: v.optional(v.id("sprints")),
              assigneeId: v.optional(v.id("users")),
              labels: v.array(v.string()),
              reviewStatus: v.optional(v.union(v.literal("none"), v.literal("requested"), v.literal("approved"), v.literal("rejected"))),
              reviewedBy: v.optional(v.id("users")),
              reviewedAt: v.optional(v.number()),
              createdAt: v.number(),
              updatedAt: v.number()
            })
          )
        })
      )
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);

    const [columns, cards] = await Promise.all([
      ctx.db
        .query("columns")
        .withIndex("by_boardId_position", (q) => q.eq("boardId", board._id))
        .collect(),
      ctx.db
        .query("cards")
        .withIndex("by_boardId", (q) => q.eq("boardId", board._id))
        .collect()
    ]);

    const cardsByColumn = new Map<string, any[]>();
    for (const card of cards) {
      const key = card.columnId as string;
      const bucket = cardsByColumn.get(key) ?? [];
      bucket.push(card);
      cardsByColumn.set(key, bucket);
    }

    return {
      boardId: board._id,
      boardName: board.name,
      columns: columns.map((column) => ({
        _id: column._id,
        name: column.name,
        position: column.position,
        cards: (cardsByColumn.get(column._id as string) ?? [])
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((card) => ({
            _id: card._id,
            title: card.title,
            description: card.description,
            storyPoints: card.storyPoints,
            priority: card.priority,
            sprintId: card.sprintId,
            assigneeId: card.assigneeId,
            labels: card.labels,
            reviewStatus: card.reviewStatus,
            reviewedBy: card.reviewedBy,
            reviewedAt: card.reviewedAt,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt
          }))
      }))
    };
  }
});

export const createCard = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    columnId: v.id("columns"),
    title: v.string(),
    description: v.optional(v.string()),
    storyPoints: v.optional(v.number()),
    sprintId: v.optional(v.id("sprints")),
    assigneeExternalId: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    labels: v.optional(v.array(v.string()))
  },
  returns: v.id("cards"),
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

    let assigneeId: any = undefined;
    if (args.assigneeExternalId) {
      const assignee = await getUserByExternalId(ctx, args.assigneeExternalId);
      const membership = await ctx.db
        .query("projectMembers")
        .withIndex("by_projectId_userId", (q: any) =>
          q.eq("projectId", args.projectId).eq("userId", assignee._id)
        )
        .unique();

      if (!membership) {
        throw new ConvexError({ code: "INVALID_ASSIGNEE", message: "Assignee must be a project member." });
      }
      assigneeId = assignee._id;
    }

    const now = Date.now();
    return await ctx.db.insert("cards", {
      boardId: board._id,
      columnId: args.columnId,
      sprintId: args.sprintId,
      title: args.title.trim(),
      description: args.description?.trim() ?? "",
      storyPoints: Math.max(0, args.storyPoints ?? 0),
      priority: args.priority ?? "medium",
      assigneeId,
      labels: args.labels ?? [],
      reviewStatus: "none",
      reviewedBy: undefined,
      reviewedAt: undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now
    });
  }
});

export const updateCard = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    storyPoints: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    labels: v.optional(v.array(v.string())),
    assigneeExternalId: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    let assigneeId: any = undefined;
    if (args.assigneeExternalId !== undefined) {
      if (args.assigneeExternalId === "") {
        assigneeId = undefined;
      } else {
        const assignee = await getUserByExternalId(ctx, args.assigneeExternalId);
        const membership = await ctx.db
          .query("projectMembers")
          .withIndex("by_projectId_userId", (q: any) =>
            q.eq("projectId", args.projectId).eq("userId", assignee._id)
          )
          .unique();

        if (!membership) {
          throw new ConvexError({ code: "INVALID_ASSIGNEE", message: "Assignee must be a project member." });
        }
        assigneeId = assignee._id;
      }
    }

    const patch: Record<string, unknown> = {
      updatedAt: Date.now()
    };

    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description;
    if (args.storyPoints !== undefined) patch.storyPoints = Math.max(0, args.storyPoints);
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.labels !== undefined) patch.labels = args.labels;
    if (args.assigneeExternalId !== undefined) patch.assigneeId = assigneeId;

    await ctx.db.patch(args.cardId, patch);
    return null;
  }
});

export const moveCard = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards"),
    toColumnId: v.id("columns")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);

    const [card, destinationColumn] = await Promise.all([
      ctx.db.get(args.cardId),
      ctx.db.get(args.toColumnId)
    ]);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    if (!destinationColumn || destinationColumn.boardId !== board._id) {
      throw new ConvexError({ code: "INVALID_COLUMN", message: "Destination column is invalid." });
    }

    if (card.columnId === args.toColumnId) {
      return null;
    }

    const reviewStatus = card.reviewStatus ?? "none";

    if (destinationColumn.name.toLowerCase() === "done") {
      if (reviewStatus === "requested") {
        throw new ConvexError({
          code: "REVIEW_REQUIRED",
          message: "This task is awaiting review. Approve the review before moving to Done."
        });
      }
      if (reviewStatus === "rejected") {
        throw new ConvexError({
          code: "REVIEW_REJECTED",
          message: "This task was rejected in review. Re-request review or address feedback before moving to Done."
        });
      }
    }

    const now = Date.now();
    const fromColumnId = card.columnId;

    await ctx.db.patch(args.cardId, {
      columnId: args.toColumnId,
      updatedAt: now
    });

    await ctx.db.insert("cardEvents", {
      cardId: args.cardId,
      fromColumnId,
      toColumnId: args.toColumnId,
      movedBy: user._id,
      movedAt: now
    });

    return null;
  }
});

export const attachCardToSprint = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards"),
    sprintId: v.optional(v.id("sprints"))
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    if (args.sprintId) {
      const sprint = await ctx.db.get(args.sprintId);
      if (!sprint || sprint.projectId !== args.projectId) {
        throw new ConvexError({ code: "INVALID_SPRINT", message: "Sprint not found." });
      }
    }

    await ctx.db.patch(args.cardId, {
      sprintId: args.sprintId,
      updatedAt: Date.now()
    });

    return null;
  }
});

export const activity = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards")
  },
  returns: v.array(
    v.object({
      _id: v.id("cardEvents"),
      movedAt: v.number(),
      movedBy: v.id("users"),
      fromColumnId: v.id("columns"),
      toColumnId: v.id("columns")
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const card = await ctx.db.get(args.cardId);
    if (!card) {
      return [];
    }

    const events = await ctx.db
      .query("cardEvents")
      .withIndex("by_cardId_movedAt", (q) => q.eq("cardId", args.cardId))
      .collect();

    return events.map((event) => ({
      _id: event._id,
      movedAt: event.movedAt,
      movedBy: event.movedBy,
      fromColumnId: event.fromColumnId,
      toColumnId: event.toColumnId
    }));
  }
});

export const requestReview = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    await ctx.db.patch(args.cardId, {
      reviewStatus: "requested",
      updatedAt: Date.now()
    });

    return null;
  }
});

export const approveReview = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    const now = Date.now();
    await ctx.db.patch(args.cardId, {
      reviewStatus: "approved",
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now
    });

    return null;
  }
});

export const rejectReview = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    const now = Date.now();
    await ctx.db.patch(args.cardId, {
      reviewStatus: "rejected",
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now
    });

    return null;
  }
});

export const deleteCard = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    cardId: v.id("cards")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const board = await getBoardByProjectId(ctx, args.projectId);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.boardId !== board._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found." });
    }

    const events = await ctx.db
      .query("cardEvents")
      .withIndex("by_cardId_movedAt", (q) => q.eq("cardId", args.cardId))
      .collect();

    await Promise.all(events.map((event) => ctx.db.delete(event._id)));
    await ctx.db.delete(args.cardId);
    return null;
  }
});

import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import { calculateSprintMetrics } from "./metrics";
import { ensureProjectMember } from "./helpers";

const query = queryGeneric;
const mutation = mutationGeneric;

export const list = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.array(
    v.object({
      _id: v.id("sprints"),
      name: v.string(),
      startDate: v.number(),
      endDate: v.number(),
      status: v.union(v.literal("planned"), v.literal("active"), v.literal("archived"), v.literal("completed"))
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const sprints = await ctx.db
      .query("sprints")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    return sprints
      .map((sprint) => ({
        _id: sprint._id,
        name: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        status: sprint.status
      }))
      .sort((a, b) => {
        if (a.status === "active" && b.status !== "active") {
          return -1;
        }
        if (a.status !== "active" && b.status === "active") {
          return 1;
        }
        return b.startDate - a.startDate;
      });
  }
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    name: v.string(),
    startDate: v.number(),
    endDate: v.number()
  },
  returns: v.id("sprints"),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    if (args.endDate < args.startDate) {
      throw new ConvexError({ code: "INVALID_DATES", message: "Sprint end date must be on or after start date." });
    }

    return await ctx.db.insert("sprints", {
      projectId: args.projectId,
      name: args.name,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "planned"
    });
  }
});

export const activate = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    sprintId: v.id("sprints")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const sprint = await ctx.db.get(args.sprintId);
    if (!sprint || sprint.projectId !== args.projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Sprint not found." });
    }

    const activeSprints = await ctx.db
      .query("sprints")
      .withIndex("by_projectId_status", (q: any) => q.eq("projectId", args.projectId).eq("status", "active"))
      .collect();

    await Promise.all(
      activeSprints
        .filter((activeSprint) => activeSprint._id !== args.sprintId)
        .map((activeSprint) => ctx.db.patch(activeSprint._id, { status: "planned" }))
    );

    await ctx.db.patch(args.sprintId, { status: "active" });
    return null;
  }
});

export const complete = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    sprintId: v.id("sprints")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const sprint = await ctx.db.get(args.sprintId);
    if (!sprint || sprint.projectId !== args.projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Sprint not found." });
    }

    const metricsSnapshot = await calculateSprintMetrics(ctx, { projectId: args.projectId, sprint });

    await ctx.db.patch(args.sprintId, {
      status: "archived",
      metricsSnapshot
    });
    return null;
  }
});

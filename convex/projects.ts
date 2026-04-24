import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  assertCanCreateProjects,
  canCreateProjects,
  ensureProjectMember,
  getUserByExternalId,
  seedDefaultBoard
} from "./helpers";

const query = queryGeneric;
const mutation = mutationGeneric;

const projectSummaryValidator = v.object({
  projectId: v.id("projects"),
  name: v.string(),
  description: v.optional(v.string()),
  role: v.union(v.literal("owner"), v.literal("member")),
  createdAt: v.number()
});

export const listMine = query({
  args: { externalId: v.string() },
  returns: v.array(projectSummaryValidator),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user) {
      return [];
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const projects: Array<{
      projectId: any;
      name: string;
      description?: string;
      role: "owner" | "member";
      createdAt: number;
    }> = [];

    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId);
      if (!project) {
        continue;
      }

      projects.push({
        projectId: project._id,
        name: project.name,
        description: project.description,
        role: membership.role,
        createdAt: project.createdAt
      });
    }

    projects.sort((a, b) => b.createdAt - a.createdAt);
    return projects;
  }
});

export const myProject = query({
  args: { externalId: v.string() },
  returns: v.union(v.null(), projectSummaryValidator),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user) {
      return null;
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    let latest: {
      projectId: any;
      name: string;
      description?: string;
      role: "owner" | "member";
      createdAt: number;
    } | null = null;

    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId);
      if (!project) {
        continue;
      }

      if (!latest || project.createdAt > latest.createdAt) {
        latest = {
          projectId: project._id,
          name: project.name,
          description: project.description,
          role: membership.role,
          createdAt: project.createdAt
        };
      }
    }

    return latest;
  }
});

export const summary = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.union(v.null(), projectSummaryValidator),
  handler: async (ctx, args) => {
    const { membership } = await ensureProjectMember(ctx, args.projectId, args.externalId);
    const project = await ctx.db.get(args.projectId);

    if (!project) {
      return null;
    }

    return {
      projectId: project._id,
      name: project.name,
      description: project.description,
      role: membership.role,
      createdAt: project.createdAt
    };
  }
});

export const canCreate = query({
  args: { externalId: v.string() },
  returns: v.object({
    canCreate: v.boolean(),
    reason: v.optional(v.string())
  }),
  handler: async (ctx, args) => {
    const access = await canCreateProjects(ctx, args.externalId);
    return {
      canCreate: access.canCreate,
      reason: access.reason
    };
  }
});

export const create = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    creatorName: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    creatorAvatarUrl: v.optional(v.string())
  },
  returns: projectSummaryValidator,
  handler: async (ctx, args) => {
    await assertCanCreateProjects(ctx, args.externalId);

    const now = Date.now();

    let user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user) {
      const userId = await ctx.db.insert("users", {
        externalId: args.externalId,
        name: args.creatorName?.trim() || args.externalId,
        email: args.creatorEmail?.trim() || `${args.externalId}@placeholder.local`,
        avatarUrl: args.creatorAvatarUrl,
        createdAt: now
      });
      user = await ctx.db.get(userId);
      if (!user) {
        throw new ConvexError({ code: "INTERNAL_ERROR", message: "Could not initialize project owner." });
      }
    }

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new ConvexError({ code: "INVALID_NAME", message: "Project name is required." });
    }

    const description = args.description?.trim() || undefined;

    const projectId = await ctx.db.insert("projects", {
      name: trimmedName,
      description,
      createdBy: user._id,
      createdAt: now
    });

    await ctx.db.insert("projectMembers", {
      projectId,
      userId: user._id,
      role: "owner",
      joinedAt: now
    });

    await seedDefaultBoard(ctx, projectId, now);

    return {
      projectId,
      name: trimmedName,
      description,
      role: "owner" as const,
      createdAt: now
    };
  }
});

export const members = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      externalId: v.string(),
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
      role: v.union(v.literal("owner"), v.literal("member"))
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const users: Array<{
      userId: any;
      externalId: string;
      name: string;
      email: string;
      avatarUrl?: string;
      role: "owner" | "member";
    }> = [];

    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) {
        continue;
      }

      users.push({
        userId: user._id,
        externalId: user.externalId,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: membership.role
      });
    }

    return users;
  }
});

export const updateMyName = mutation({
  args: {
    externalId: v.string(),
    name: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getUserByExternalId(ctx, args.externalId);
    await ctx.db.patch(user._id, { name: args.name });
    return null;
  }
});

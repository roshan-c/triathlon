import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const query = queryGeneric;
const mutation = mutationGeneric;

export const me = query({
  args: { externalId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      externalId: v.string(),
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
      createdAt: v.number()
    })
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      externalId: user.externalId,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt
    };
  }
});

export const syncProfile = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!existingUser) {
      await ctx.db.insert("users", {
        externalId: args.externalId,
        name: args.name,
        email: args.email,
        avatarUrl: args.avatarUrl,
        createdAt: Date.now()
      });
      return null;
    }

    await ctx.db.patch(existingUser._id, {
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl
    });
    return null;
  }
});

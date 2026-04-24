import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import { ensureProjectMember } from "./helpers";

const query = queryGeneric;
const mutation = mutationGeneric;

function makeShareCode() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36).slice(-3);
  return `${randomPart}${timePart}`;
}

export const getUploadUrl = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    return await ctx.storage.generateUploadUrl();
  }
});

export const createShare = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    storageId: v.id("_storage")
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);

    const fileUrl = await ctx.storage.getUrl(args.storageId);
    if (!fileUrl) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Uploaded snapshot could not be found." });
    }

    let shareCode = makeShareCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await ctx.db
        .query("sharedWhiteboards")
        .withIndex("by_shareCode", (q) => q.eq("shareCode", shareCode))
        .unique();
      if (!existing) {
        break;
      }
      shareCode = makeShareCode();
    }

    const duplicate = await ctx.db
      .query("sharedWhiteboards")
      .withIndex("by_shareCode", (q) => q.eq("shareCode", shareCode))
      .unique();
    if (duplicate) {
      throw new ConvexError({ code: "COLLISION", message: "Could not create a unique share code." });
    }

    await ctx.db.insert("sharedWhiteboards", {
      projectId: args.projectId,
      shareCode,
      snapshotStorageId: args.storageId,
      createdAt: Date.now(),
      createdBy: user._id
    });

    return shareCode;
  }
});

export const getSharedSnapshot = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    shareCode: v.string()
  },
  returns: v.union(
    v.null(),
    v.object({
      snapshotUrl: v.string(),
      createdAt: v.number(),
      createdBy: v.id("users")
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const shared = await ctx.db
      .query("sharedWhiteboards")
      .withIndex("by_shareCode", (q) => q.eq("shareCode", args.shareCode))
      .unique();

    if (!shared || shared.projectId !== args.projectId) {
      return null;
    }

    const snapshotUrl = await ctx.storage.getUrl(shared.snapshotStorageId);
    if (!snapshotUrl) {
      return null;
    }

    return {
      snapshotUrl,
      createdAt: shared.createdAt,
      createdBy: shared.createdBy
    };
  }
});

export const listLibrary = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.array(
    v.object({
      itemId: v.id("whiteboardLibraryItems"),
      title: v.string(),
      snapshotUrl: v.union(v.string(), v.null()),
      createdAt: v.number(),
      updatedAt: v.number(),
      createdBy: v.id("users"),
      creatorName: v.string()
    })
  ),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const items = await ctx.db
      .query("whiteboardLibraryItems")
      .withIndex("by_projectId_updatedAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    return await Promise.all(
      items.map(async (item) => {
        const [creator, snapshotUrl] = await Promise.all([
          ctx.db.get(item.createdBy),
          ctx.storage.getUrl(item.snapshotStorageId)
        ]);

        return {
          itemId: item._id,
          title: item.title,
          snapshotUrl,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          createdBy: item.createdBy,
          creatorName: creator?.name ?? "Unknown member"
        };
      })
    );
  }
});

export const saveToLibrary = mutation({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    title: v.string(),
    storageId: v.id("_storage")
  },
  returns: v.id("whiteboardLibraryItems"),
  handler: async (ctx, args) => {
    const { user } = await ensureProjectMember(ctx, args.projectId, args.externalId);

    const normalizedTitle = args.title.trim();
    if (!normalizedTitle) {
      throw new ConvexError({ code: "INVALID_TITLE", message: "Whiteboard title is required." });
    }

    const fileUrl = await ctx.storage.getUrl(args.storageId);
    if (!fileUrl) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Uploaded snapshot could not be found." });
    }

    const now = Date.now();
    return await ctx.db.insert("whiteboardLibraryItems", {
      projectId: args.projectId,
      title: normalizedTitle,
      snapshotStorageId: args.storageId,
      createdAt: now,
      updatedAt: now,
      createdBy: user._id
    });
  }
});

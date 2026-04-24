import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const insert = internalMutation({
  args: {
    keyId: v.string(),
    keyLabel: v.optional(v.string()),
    projectId: v.id("projects"),
    externalId: v.string(),
    tool: v.string(),
    requestId: v.optional(v.string()),
    argsSummary: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    success: v.boolean(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number()
  },
  returns: v.id("agentAuditLogs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentAuditLogs", args);
  }
});

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number()
  }).index("by_externalId", ["externalId"]),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number()
  }).index("by_createdBy", ["createdBy"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    joinedAt: v.number()
  })
    .index("by_projectId", ["projectId"])
    .index("by_userId", ["userId"])
    .index("by_projectId_userId", ["projectId", "userId"]),

  boards: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    createdAt: v.number()
  }).index("by_projectId", ["projectId"]),

  columns: defineTable({
    boardId: v.id("boards"),
    name: v.string(),
    position: v.number(),
    createdAt: v.number()
  }).index("by_boardId_position", ["boardId", "position"]),

  cards: defineTable({
    boardId: v.id("boards"),
    columnId: v.id("columns"),
    sprintId: v.optional(v.id("sprints")),
    title: v.string(),
    description: v.string(),
    storyPoints: v.number(),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    assigneeId: v.optional(v.id("users")),
    labels: v.array(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_boardId", ["boardId"])
    .index("by_columnId", ["columnId"])
    .index("by_sprintId", ["sprintId"]) 
    .index("by_assigneeId", ["assigneeId"]),

  sprints: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    status: v.union(v.literal("planned"), v.literal("active"), v.literal("archived"), v.literal("completed")),
    metricsSnapshot: v.optional(
      v.object({
        capturedAt: v.number(),
        sprintName: v.string(),
        velocity: v.number(),
        throughput: v.number(),
        averageCycleTimeHours: v.number(),
        averageLeadTimeHours: v.number(),
        tasksCompletedPerDay: v.array(v.object({ day: v.string(), completed: v.number() })),
        burndown: v.array(v.object({ day: v.string(), remainingPoints: v.number() }))
      })
    )
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_status", ["projectId", "status"]),

  cardEvents: defineTable({
    cardId: v.id("cards"),
    fromColumnId: v.id("columns"),
    toColumnId: v.id("columns"),
    movedBy: v.id("users"),
    movedAt: v.number()
  })
    .index("by_cardId_movedAt", ["cardId", "movedAt"])
    .index("by_toColumnId_movedAt", ["toColumnId", "movedAt"])
    .index("by_toColumnId", ["toColumnId"]),

  sharedWhiteboards: defineTable({
    projectId: v.id("projects"),
    shareCode: v.string(),
    snapshotStorageId: v.id("_storage"),
    createdAt: v.number(),
    createdBy: v.id("users")
  })
    .index("by_projectId", ["projectId"])
    .index("by_shareCode", ["shareCode"]),

  whiteboardLibraryItems: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    snapshotStorageId: v.id("_storage"),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users")
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_updatedAt", ["projectId", "updatedAt"]),

  agentAuditLogs: defineTable({
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
  })
    .index("by_projectId_createdAt", ["projectId", "createdAt"])
    .index("by_keyId_createdAt", ["keyId", "createdAt"])
});

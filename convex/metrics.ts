import { queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  dayKey,
  eachDayBetween,
  endOfDay,
  ensureProjectMember,
  getBoardByProjectId,
  getColumnByName
} from "./helpers";

const query = queryGeneric;

const dailyCompletedValidator = v.object({ day: v.string(), completed: v.number() });
const burndownPointValidator = v.object({ day: v.string(), remainingPoints: v.number() });
const sprintMetricsValidator = v.object({
  sprintName: v.string(),
  velocity: v.number(),
  throughput: v.number(),
  averageCycleTimeHours: v.number(),
  averageLeadTimeHours: v.number(),
  tasksCompletedPerDay: v.array(dailyCompletedValidator),
  burndown: v.array(burndownPointValidator)
});

function sprintWindow(sprint: { startDate: number; endDate: number }) {
  return {
    start: sprint.startDate,
    end: endOfDay(sprint.endDate)
  };
}

export async function calculateSprintMetrics(ctx: any, args: { projectId: string; sprint: any }) {
  const board = await getBoardByProjectId(ctx, args.projectId);
  const { start, end } = sprintWindow(args.sprint);

  const [doneColumn, inProgressColumn, sprintCards] = await Promise.all([
    getColumnByName(ctx, board._id, "Done"),
    getColumnByName(ctx, board._id, "In Progress"),
    ctx.db
      .query("cards")
      .withIndex("by_sprintId", (q: any) => q.eq("sprintId", args.sprint._id))
      .collect()
  ]);

  if (!doneColumn || !inProgressColumn) {
    throw new ConvexError({ code: "CONFIG_ERROR", message: "Done or In Progress column is missing." });
  }

  const cards = sprintCards.filter((card: any) => card.boardId === board._id);
  const cardsById = new Map<string, any>(cards.map((card: any) => [card._id as string, card]));

  const doneEvents = await ctx.db
    .query("cardEvents")
    .withIndex("by_toColumnId_movedAt", (q: any) => q.eq("toColumnId", doneColumn._id).gte("movedAt", start).lte("movedAt", end))
    .collect();

  const firstDoneByCard = new Map<string, number>();
  for (const event of doneEvents) {
    const card = cardsById.get(event.cardId as string);
    if (!card) {
      continue;
    }

    const current = firstDoneByCard.get(event.cardId as string);
    if (current === undefined || event.movedAt < current) {
      firstDoneByCard.set(event.cardId as string, event.movedAt);
    }
  }

  let velocity = 0;
  for (const [cardId] of firstDoneByCard) {
    velocity += cardsById.get(cardId)?.storyPoints ?? 0;
  }

  const throughput = firstDoneByCard.size;

  const cardsCountedInBurndown = cards.filter((card: any) => {
    const firstDoneAt = firstDoneByCard.get(card._id as string);
    return firstDoneAt === undefined || firstDoneAt >= start;
  });
  const totalScopePoints = cardsCountedInBurndown.reduce(
    (sum: number, card: any) => sum + card.storyPoints,
    0
  );

  const completedPerDayMap = new Map<string, number>();
  for (const [, movedAt] of firstDoneByCard) {
    const key = dayKey(movedAt);
    completedPerDayMap.set(key, (completedPerDayMap.get(key) ?? 0) + 1);
  }

  const sprintDays = eachDayBetween(start, end);
  const tasksCompletedPerDay = sprintDays.map((dayTimestamp) => {
    const key = dayKey(dayTimestamp);
    return {
      day: key,
      completed: completedPerDayMap.get(key) ?? 0
    };
  });

  const burndown = sprintDays.map((dayTimestamp) => {
    const dayEnd = endOfDay(dayTimestamp);
    let burnedPoints = 0;
    for (const [cardId, movedAt] of firstDoneByCard) {
      if (movedAt <= dayEnd) {
        burnedPoints += cardsById.get(cardId)?.storyPoints ?? 0;
      }
    }

    return {
      day: dayKey(dayTimestamp),
      remainingPoints: Math.max(0, totalScopePoints - burnedPoints)
    };
  });

  let cycleAccumulatorMs = 0;
  let cycleCount = 0;
  let leadAccumulatorMs = 0;
  let leadCount = 0;

  for (const [cardId, doneAt] of firstDoneByCard.entries()) {
    const card = cardsById.get(cardId);
    if (!card) {
      continue;
    }

    leadAccumulatorMs += doneAt - card.createdAt;
    leadCount += 1;

    const events = await ctx.db
      .query("cardEvents")
      .withIndex("by_cardId_movedAt", (q: any) => q.eq("cardId", card._id))
      .collect();

    const relevantDoneEvent = events.find(
      (event: any) => event.toColumnId === doneColumn._id && event.movedAt === doneAt
    );
    if (!relevantDoneEvent) {
      continue;
    }

    const priorInProgressEvents = events.filter(
      (event: any) => event.toColumnId === inProgressColumn._id && event.movedAt <= relevantDoneEvent.movedAt
    );
    const latestInProgress = priorInProgressEvents[priorInProgressEvents.length - 1];

    if (latestInProgress) {
      cycleAccumulatorMs += relevantDoneEvent.movedAt - latestInProgress.movedAt;
      cycleCount += 1;
    }
  }

  const averageCycleTimeHours = cycleCount > 0 ? cycleAccumulatorMs / cycleCount / (1000 * 60 * 60) : 0;
  const averageLeadTimeHours = leadCount > 0 ? leadAccumulatorMs / leadCount / (1000 * 60 * 60) : 0;

  return {
    sprintName: args.sprint.name,
    velocity,
    throughput,
    averageCycleTimeHours,
    averageLeadTimeHours,
    tasksCompletedPerDay,
    burndown
  };
}

export const forSprint = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string(),
    sprintId: v.id("sprints")
  },
  returns: sprintMetricsValidator,
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);

    const sprint = await ctx.db.get(args.sprintId);

    if (!sprint || sprint.projectId !== args.projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Sprint not found." });
    }

    if (sprint.metricsSnapshot && (sprint.status === "archived" || sprint.status === "completed")) {
      return sprint.metricsSnapshot;
    }

    return await calculateSprintMetrics(ctx, { projectId: args.projectId, sprint });
  }
});

export const velocityHistory = query({
  args: {
    projectId: v.id("projects"),
    externalId: v.string()
  },
  returns: v.array(v.object({ sprintName: v.string(), velocity: v.number() })),
  handler: async (ctx, args) => {
    await ensureProjectMember(ctx, args.projectId, args.externalId);
    const sprints = await ctx.db
      .query("sprints")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const history = await Promise.all(
      sprints.map(async (sprint) => {
        const metrics = sprint.metricsSnapshot ?? (await calculateSprintMetrics(ctx, { projectId: args.projectId, sprint }));
        return {
          sprintName: sprint.name,
          velocity: metrics.velocity,
          startDate: sprint.startDate,
          status: sprint.status
        };
      })
    );

    return history
      .filter((sprint) => sprint.status === "archived" || sprint.status === "completed")
      .sort((a, b) => a.startDate - b.startDate)
      .map(({ sprintName, velocity }) => ({ sprintName, velocity }));
  }
});

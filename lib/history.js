import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalBoard, validateBoard } from "./board.js";

const exec = promisify(execFile);
const DAY = 86_400_000;

async function git(args, cwd) {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

export async function readBoardAt(ref, { cwd = process.cwd(), path = "board.json" } = {}) {
  try {
    const board = JSON.parse(await git(["show", `${ref}:${path}`], cwd));
    return validateBoard(board).length === 0 ? canonicalBoard(board) : null;
  } catch {
    return null;
  }
}

export async function readBoardHistory({ cwd = process.cwd(), path = "board.json" } = {}) {
  let lines;
  try {
    lines = (await git(["log", "--format=%H%x09%aI%x09%an", "--", path], cwd)).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const entries = [];
  for (const line of lines.reverse()) {
    const [commit, committedAt, ...authorParts] = line.split("\t");
    try {
      const text = await git(["show", `${commit}:${path}`], cwd);
      const board = JSON.parse(text);
      if (validateBoard(board).length === 0) {
        entries.push({ commit, committedAt, author: authorParts.join("\t"), board: canonicalBoard(board) });
      }
    } catch {
      // Commits before board.json existed or contained valid v1 data do not belong to board history.
    }
  }
  return entries;
}

function columnCategory(board, columnId) {
  return board.board.columns.find((column) => column.id === columnId)?.category;
}

export function ticketTransitions(history) {
  const transitions = [];
  let previous = null;
  for (const entry of history) {
    for (const [ticketId, ticket] of Object.entries(entry.board.tickets)) {
      const before = previous?.board.tickets[ticketId];
      if (before && before.columnId !== ticket.columnId) {
        const oldCommentIds = new Set(before.comments.map((comment) => comment.id));
        const attribution = [...ticket.comments].reverse().find((comment) => !oldCommentIds.has(comment.id) && comment.body.startsWith("Moved automatically when the linked pull request"));
        transitions.push({
          ticketId,
          from: before.columnId,
          to: ticket.columnId,
          fromCategory: columnCategory(previous.board, before.columnId),
          toCategory: columnCategory(entry.board, ticket.columnId),
          at: entry.committedAt,
          author: attribution?.author ?? entry.author,
          commit: entry.commit,
          sprintId: ticket.sprintId,
          storyPoints: ticket.storyPoints ?? 0,
        });
      }
    }
    previous = entry;
  }
  return transitions;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function findCycleStart(transitions, ticketId, closedAt) {
  return [...transitions]
    .reverse()
    .find((transition) => transition.ticketId === ticketId && transition.toCategory === "started" && Date.parse(transition.at) <= Date.parse(closedAt))?.at;
}

export function calculateSprintMetrics(board, history, sprintId, endAt = new Date().toISOString()) {
  const sprint = board.sprints[sprintId];
  if (!sprint) throw new Error(`Unknown sprint ${sprintId}`);
  const start = sprint.actualStart ?? sprint.plannedStart;
  const end = sprint.actualEnd ?? endAt;
  if (!start || !end) throw new Error(`Sprint ${sprintId} needs start and end dates for metrics`);
  const transitions = ticketTransitions(history);
  const ticketIds = new Set(sprint.ticketIds);
  const closes = transitions.filter((transition) =>
    ticketIds.has(transition.ticketId)
    && transition.sprintId === sprintId
    && transition.toCategory === "done"
    && Date.parse(transition.at) >= Date.parse(start)
    && Date.parse(transition.at) <= Date.parse(end));

  // A current Done ticket can predate the first committed v1 board. Count it without a duration.
  const closedIds = new Set(closes.map((close) => close.ticketId));
  for (const ticketId of ticketIds) {
    const ticket = board.tickets[ticketId];
    if (ticket && columnCategory(board, ticket.columnId) === "done" && !closedIds.has(ticketId)) {
      closes.push({ ticketId, at: ticket.updatedAt, storyPoints: ticket.storyPoints ?? 0, sprintId });
    }
  }

  const leadDays = [];
  const cycleDays = [];
  for (const close of closes) {
    const ticket = board.tickets[close.ticketId];
    if (ticket?.createdAt) leadDays.push((Date.parse(close.at) - Date.parse(ticket.createdAt)) / DAY);
    const cycleStart = findCycleStart(transitions, close.ticketId, close.at);
    if (cycleStart) cycleDays.push((Date.parse(close.at) - Date.parse(cycleStart)) / DAY);
  }

  const burndown = [];
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  for (let day = startTime; day <= endTime; day += DAY) {
    const dayEnd = Math.min(day + DAY - 1, endTime);
    let snapshot = [...history].reverse().find((entry) => Date.parse(entry.committedAt) <= dayEnd)?.board ?? board;
    let remaining = 0;
    for (const ticketId of ticketIds) {
      const ticket = snapshot.tickets[ticketId];
      if (ticket && ticket.sprintId === sprintId && columnCategory(snapshot, ticket.columnId) !== "done") {
        remaining += ticket.storyPoints ?? 0;
      }
    }
    burndown.push({ date: new Date(day).toISOString().slice(0, 10), pointsRemaining: remaining });
  }

  return {
    calculatedAt: end,
    velocity: closes.reduce((sum, close) => sum + (close.storyPoints ?? 0), 0),
    throughput: closes.length,
    averageLeadDays: leadDays.length ? round(leadDays.reduce((sum, value) => sum + value, 0) / leadDays.length) : null,
    averageCycleDays: cycleDays.length ? round(cycleDays.reduce((sum, value) => sum + value, 0) / cycleDays.length) : null,
    burndown,
  };
}

export function projectMetrics(board, history) {
  const active = Object.values(board.sprints).find((sprint) => sprint.state === "active");
  const completed = Object.values(board.sprints).filter((sprint) => sprint.state === "completed");
  const transitions = ticketTransitions(history);
  const contributors = Object.values(transitions.reduce((summary, transition) => {
    const current = summary[transition.author] ?? { name: transition.author, transitions: 0, completedTickets: 0, completedPoints: 0 };
    current.transitions += 1;
    if (transition.toCategory === "done") {
      current.completedTickets += 1;
      current.completedPoints += transition.storyPoints;
    }
    summary[transition.author] = current;
    return summary;
  }, {})).sort((left, right) => right.completedPoints - left.completedPoints || right.transitions - left.transitions || left.name.localeCompare(right.name));
  return {
    project: board.project.name,
    generatedAt: new Date().toISOString(),
    activeSprint: active ? { id: active.id, name: active.name, metrics: calculateSprintMetrics(board, history, active.id) } : null,
    completedSprints: completed.map((sprint) => ({ id: sprint.id, name: sprint.name, metrics: sprint.metrics })),
    contributors,
    transitions,
  };
}

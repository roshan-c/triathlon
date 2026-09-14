import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const COLUMN_CATEGORIES = new Set(["not-started", "started", "done"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const SPRINT_STATES = new Set(["planned", "active", "completed"]);

export class BoardError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = "BoardError";
    this.problems = problems;
  }
}

export function createBoard({ name = "My project", key = "PROJ" } = {}) {
  const normalizedKey = String(key).trim().toUpperCase();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    project: {
      key: normalizedKey,
      name: String(name).trim(),
      description: "",
      nextTicketNumber: 2,
    },
    board: {
      columns: [
        { id: "backlog", name: "Backlog", category: "not-started", wipLimit: null },
        { id: "in-progress", name: "In progress", category: "started", wipLimit: 4 },
        { id: "done", name: "Done", category: "done", wipLimit: null },
      ],
      pullRequests: {
        openedColumnId: "in-progress",
        mergedColumnId: "done",
      },
    },
    sprints: {},
    tickets: {
      [`${normalizedKey}-1`]: {
        id: `${normalizedKey}-1`,
        title: "Set up the first sprint",
        description: "Edit this ticket or create another one from the local board.",
        columnId: "backlog",
        rank: 1000,
        priority: "medium",
        storyPoints: 1,
        labels: ["getting-started"],
        assignee: null,
        sprintId: null,
        createdAt: now,
        updatedAt: now,
        comments: [],
      },
    },
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, path, problems) {
  if (typeof value !== "string" || value.trim() === "") problems.push(`${path} must be a non-empty string`);
}

function rejectUnknown(record, allowed, path, problems) {
  if (!isRecord(record)) return;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) problems.push(`${path}.${key} is not supported`);
  }
}

function optionalIsoDate(value, path, problems) {
  if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    problems.push(`${path} must be null or an ISO date`);
  }
}

export function validateBoard(board) {
  const problems = [];
  if (!isRecord(board)) return ["board must be an object"];
  rejectUnknown(board, ["schemaVersion", "project", "board", "sprints", "tickets"], "board", problems);
  if (board.schemaVersion !== 1) problems.push("schemaVersion must be 1");

  if (!isRecord(board.project)) {
    problems.push("project must be an object");
  } else {
    rejectUnknown(board.project, ["key", "name", "description", "nextTicketNumber"], "project", problems);
    requiredString(board.project.key, "project.key", problems);
    if (typeof board.project.key === "string" && !/^[A-Z][A-Z0-9]{1,9}$/.test(board.project.key)) {
      problems.push("project.key must contain 2-10 uppercase letters or numbers and start with a letter");
    }
    requiredString(board.project.name, "project.name", problems);
    if (typeof board.project.description !== "string") problems.push("project.description must be a string");
    if (!Number.isInteger(board.project.nextTicketNumber) || board.project.nextTicketNumber < 1) {
      problems.push("project.nextTicketNumber must be a positive integer");
    }
  }

  rejectUnknown(board.board, ["columns", "pullRequests"], "board", problems);
  const columns = board.board?.columns;
  const columnIds = new Set();
  if (!Array.isArray(columns) || columns.length < 2) {
    problems.push("board.columns must contain at least two columns");
  } else {
    columns.forEach((column, index) => {
      const path = `board.columns[${index}]`;
      if (!isRecord(column)) return problems.push(`${path} must be an object`);
      rejectUnknown(column, ["id", "name", "category", "wipLimit"], path, problems);
      requiredString(column.id, `${path}.id`, problems);
      requiredString(column.name, `${path}.name`, problems);
      if (columnIds.has(column.id)) problems.push(`${path}.id must be unique`);
      columnIds.add(column.id);
      if (!COLUMN_CATEGORIES.has(column.category)) problems.push(`${path}.category is invalid`);
      if (column.wipLimit !== null && (!Number.isInteger(column.wipLimit) || column.wipLimit < 1)) {
        problems.push(`${path}.wipLimit must be null or a positive integer`);
      }
    });
  }

  const pullRequests = board.board?.pullRequests;
  if (!isRecord(pullRequests)) {
    problems.push("board.pullRequests must be an object");
  } else {
    rejectUnknown(pullRequests, ["openedColumnId", "mergedColumnId"], "board.pullRequests", problems);
    if (!columnIds.has(pullRequests.openedColumnId)) problems.push("board.pullRequests.openedColumnId is unknown");
    if (!columnIds.has(pullRequests.mergedColumnId)) problems.push("board.pullRequests.mergedColumnId is unknown");
    const opened = columns?.find((column) => column.id === pullRequests.openedColumnId);
    const merged = columns?.find((column) => column.id === pullRequests.mergedColumnId);
    if (opened && opened.category !== "started") problems.push("openedColumnId must identify a started column");
    if (merged && merged.category !== "done") problems.push("mergedColumnId must identify a done column");
  }

  if (!isRecord(board.sprints)) {
    problems.push("sprints must be an object keyed by sprint ID");
  }
  if (!isRecord(board.tickets)) {
    problems.push("tickets must be an object keyed by ticket ID");
  }

  const activeSprints = [];
  for (const [id, sprint] of Object.entries(isRecord(board.sprints) ? board.sprints : {})) {
    const path = `sprints.${id}`;
    if (!isRecord(sprint)) {
      problems.push(`${path} must be an object`);
      continue;
    }
    rejectUnknown(sprint, ["id", "name", "state", "plannedStart", "plannedEnd", "actualStart", "actualEnd", "ticketIds", "metrics"], path, problems);
    if (sprint.id !== id) problems.push(`${path}.id must match its object key`);
    requiredString(sprint.name, `${path}.name`, problems);
    if (!SPRINT_STATES.has(sprint.state)) problems.push(`${path}.state is invalid`);
    if (sprint.state === "active") activeSprints.push(id);
    if ((sprint.state === "active" || sprint.state === "completed") && !sprint.actualStart) problems.push(`${path}.actualStart is required after a sprint starts`);
    if (sprint.state === "completed" && !sprint.actualEnd) problems.push(`${path}.actualEnd is required when completed`);
    optionalIsoDate(sprint.plannedStart, `${path}.plannedStart`, problems);
    optionalIsoDate(sprint.plannedEnd, `${path}.plannedEnd`, problems);
    optionalIsoDate(sprint.actualStart, `${path}.actualStart`, problems);
    optionalIsoDate(sprint.actualEnd, `${path}.actualEnd`, problems);
    if (sprint.plannedStart && sprint.plannedEnd && Date.parse(sprint.plannedEnd) < Date.parse(sprint.plannedStart)) problems.push(`${path}.plannedEnd must not precede plannedStart`);
    if (sprint.actualStart && sprint.actualEnd && Date.parse(sprint.actualEnd) < Date.parse(sprint.actualStart)) problems.push(`${path}.actualEnd must not precede actualStart`);
    if (!Array.isArray(sprint.ticketIds)) problems.push(`${path}.ticketIds must be an array`);
    else if (new Set(sprint.ticketIds).size !== sprint.ticketIds.length) problems.push(`${path}.ticketIds must be unique`);
    if (sprint.state === "completed" && (!isRecord(sprint.metrics) || Object.keys(sprint.metrics).length === 0)) problems.push(`${path}.metrics is required when completed`);
    if (sprint.state !== "completed" && sprint.metrics !== null) problems.push(`${path}.metrics must be null until completed`);
    if (isRecord(sprint.metrics) && Object.keys(sprint.metrics).length > 0) {
      const metricPath = `${path}.metrics`;
      rejectUnknown(sprint.metrics, ["calculatedAt", "velocity", "throughput", "averageLeadDays", "averageCycleDays", "burndown"], metricPath, problems);
      optionalIsoDate(sprint.metrics.calculatedAt, `${metricPath}.calculatedAt`, problems);
      if (typeof sprint.metrics.velocity !== "number" || sprint.metrics.velocity < 0) problems.push(`${metricPath}.velocity must be a non-negative number`);
      if (!Number.isInteger(sprint.metrics.throughput) || sprint.metrics.throughput < 0) problems.push(`${metricPath}.throughput must be a non-negative integer`);
      for (const field of ["averageLeadDays", "averageCycleDays"]) {
        if (sprint.metrics[field] !== null && typeof sprint.metrics[field] !== "number") problems.push(`${metricPath}.${field} must be null or a number`);
      }
      if (!Array.isArray(sprint.metrics.burndown)) problems.push(`${metricPath}.burndown must be an array`);
      else sprint.metrics.burndown.forEach((point, index) => {
        if (!isRecord(point) || typeof point.date !== "string" || !Number.isFinite(point.pointsRemaining) || point.pointsRemaining < 0) {
          problems.push(`${metricPath}.burndown[${index}] is invalid`);
        }
      });
    }
  }
  if (activeSprints.length > 1) problems.push("only one sprint can be active");

  const seenNumbers = new Set();
  for (const [id, ticket] of Object.entries(isRecord(board.tickets) ? board.tickets : {})) {
    const path = `tickets.${id}`;
    if (!isRecord(ticket)) {
      problems.push(`${path} must be an object`);
      continue;
    }
    rejectUnknown(ticket, ["id", "title", "description", "columnId", "rank", "priority", "storyPoints", "labels", "assignee", "sprintId", "createdAt", "updatedAt", "comments"], path, problems);
    if (ticket.id !== id) problems.push(`${path}.id must match its object key`);
    const expectedPattern = board.project?.key ? new RegExp(`^${board.project.key}-([1-9][0-9]*)$`) : null;
    const match = expectedPattern?.exec(id);
    if (!match) problems.push(`${path}.id must use the project key and a positive number`);
    else if (seenNumbers.has(match[1])) problems.push(`${path}.id has a duplicate ticket number`);
    else seenNumbers.add(match[1]);
    requiredString(ticket.title, `${path}.title`, problems);
    if (typeof ticket.description !== "string") problems.push(`${path}.description must be a string`);
    if (!columnIds.has(ticket.columnId)) problems.push(`${path}.columnId is unknown`);
    if (typeof ticket.rank !== "number" || !Number.isFinite(ticket.rank)) problems.push(`${path}.rank must be a finite number`);
    if (!PRIORITIES.has(ticket.priority)) problems.push(`${path}.priority is invalid`);
    if (ticket.storyPoints !== null && (!Number.isInteger(ticket.storyPoints) || ticket.storyPoints < 0)) {
      problems.push(`${path}.storyPoints must be null or a non-negative integer`);
    }
    if (!Array.isArray(ticket.labels) || ticket.labels.some((label) => typeof label !== "string" || label.trim() === "")) {
      problems.push(`${path}.labels must contain non-empty strings`);
    }
    if (ticket.assignee !== null && typeof ticket.assignee !== "string") problems.push(`${path}.assignee must be null or a string`);
    if (ticket.sprintId !== null && !board.sprints?.[ticket.sprintId]) problems.push(`${path}.sprintId is unknown`);
    optionalIsoDate(ticket.createdAt, `${path}.createdAt`, problems);
    optionalIsoDate(ticket.updatedAt, `${path}.updatedAt`, problems);
    if (!Array.isArray(ticket.comments)) {
      problems.push(`${path}.comments must be an array`);
    } else {
      const commentIds = new Set();
      ticket.comments.forEach((comment, index) => {
        const commentPath = `${path}.comments[${index}]`;
        if (!isRecord(comment)) return problems.push(`${commentPath} must be an object`);
        rejectUnknown(comment, ["id", "author", "body", "createdAt"], commentPath, problems);
        requiredString(comment.id, `${commentPath}.id`, problems);
        requiredString(comment.author, `${commentPath}.author`, problems);
        requiredString(comment.body, `${commentPath}.body`, problems);
        optionalIsoDate(comment.createdAt, `${commentPath}.createdAt`, problems);
        if (commentIds.has(comment.id)) problems.push(`${commentPath}.id must be unique within its ticket`);
        commentIds.add(comment.id);
      });
    }
  }

  if (isRecord(board.project) && Number.isInteger(board.project.nextTicketNumber)) {
    const largestNumber = Math.max(0, ...Object.keys(isRecord(board.tickets) ? board.tickets : {}).map((id) => Number(id.split("-").at(-1)) || 0));
    if (board.project.nextTicketNumber <= largestNumber) problems.push("project.nextTicketNumber must be greater than every existing ticket number");
  }

  for (const [id, sprint] of Object.entries(isRecord(board.sprints) ? board.sprints : {})) {
    if (!Array.isArray(sprint.ticketIds)) continue;
    for (const ticketId of sprint.ticketIds) {
      if (!board.tickets?.[ticketId]) problems.push(`sprints.${id}.ticketIds contains unknown ticket ${ticketId}`);
      else if (board.tickets[ticketId].sprintId !== id) problems.push(`${ticketId} and sprint ${id} disagree about membership`);
    }
  }

  return problems;
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })));
}

export function canonicalBoard(board) {
  const sprints = Object.fromEntries(Object.entries(sortedRecord(board.sprints)).map(([id, sprint]) => [id, {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    plannedStart: sprint.plannedStart,
    plannedEnd: sprint.plannedEnd,
    actualStart: sprint.actualStart,
    actualEnd: sprint.actualEnd,
    ticketIds: [...sprint.ticketIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    metrics: sprint.metrics,
  }]));
  const tickets = Object.fromEntries(Object.entries(sortedRecord(board.tickets)).map(([id, ticket]) => [id, {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    columnId: ticket.columnId,
    rank: ticket.rank,
    priority: ticket.priority,
    storyPoints: ticket.storyPoints,
    labels: [...new Set(ticket.labels.map((label) => label.trim().toLowerCase()))].sort(),
    assignee: ticket.assignee,
    sprintId: ticket.sprintId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    comments: [...ticket.comments]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((comment) => ({ id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt })),
  }]));
  return {
    schemaVersion: board.schemaVersion,
    project: {
      key: board.project.key,
      name: board.project.name,
      description: board.project.description,
      nextTicketNumber: board.project.nextTicketNumber,
    },
    board: {
      columns: board.board.columns.map((column) => ({ id: column.id, name: column.name, category: column.category, wipLimit: column.wipLimit })),
      pullRequests: {
        openedColumnId: board.board.pullRequests.openedColumnId,
        mergedColumnId: board.board.pullRequests.mergedColumnId,
      },
    },
    sprints,
    tickets,
  };
}

export function formatBoard(board) {
  return `${JSON.stringify(canonicalBoard(board), null, 2)}\n`;
}

export function revisionOf(board) {
  return createHash("sha256").update(formatBoard(board)).digest("hex").slice(0, 16);
}

export async function readBoard(path = "board.json") {
  const absolutePath = resolve(path);
  let text;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new BoardError(`No board found at ${absolutePath}`);
    throw error;
  }
  let board;
  try {
    board = JSON.parse(text);
  } catch (error) {
    throw new BoardError(`Invalid JSON in ${absolutePath}: ${error.message}`);
  }
  const problems = validateBoard(board);
  if (problems.length) throw new BoardError(`Invalid board at ${absolutePath}`, problems);
  return { board: canonicalBoard(board), path: absolutePath, revision: revisionOf(board) };
}

export async function writeBoard(path, board, { expectedRevision } = {}) {
  const absolutePath = resolve(path);
  const problems = validateBoard(board);
  if (problems.length) throw new BoardError("Board update was rejected", problems);
  if (expectedRevision) {
    const current = await readBoard(absolutePath);
    if (current.revision !== expectedRevision) {
      throw new BoardError("board.json changed after this page loaded; reload before saving");
    }
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, formatBoard(board), "utf8");
  await rename(temporary, absolutePath);
  return { board: canonicalBoard(board), path: absolutePath, revision: revisionOf(board) };
}

export function validateBoardChange(previous, next) {
  const problems = [];
  for (const [id, sprint] of Object.entries(previous.sprints)) {
    if (sprint.state !== "completed") continue;
    const changed = next.sprints[id];
    if (!changed) problems.push(`completed sprint ${id} cannot be deleted`);
    else if (changed.state !== "completed") problems.push(`completed sprint ${id} cannot be reopened`);
    else if (JSON.stringify(changed.metrics) !== JSON.stringify(sprint.metrics)) problems.push(`completed sprint ${id} metrics are immutable`);
  }
  return problems;
}

export function nextRank(board, columnId) {
  return Object.values(board.tickets)
    .filter((ticket) => ticket.columnId === columnId)
    .reduce((maximum, ticket) => Math.max(maximum, ticket.rank), 0) + 1000;
}

export function ticketReferences(text) {
  const references = new Set();
  for (const match of String(text ?? "").matchAll(/^Triathlon-Tickets:\s*(.+)$/gim)) {
    for (const candidate of match[1].split(/[ ,]+/)) {
      const id = candidate.trim().replace(/[.;]$/, "").toUpperCase();
      if (id) references.add(id);
    }
  }
  return [...references];
}

export function applyPullRequestEvent(board, { event, body, actor, occurredAt = new Date().toISOString() }) {
  const ticketIds = ticketReferences(body);
  if (!ticketIds.length) throw new BoardError("PR body must contain a Triathlon-Tickets: trailer");
  const unknown = ticketIds.filter((id) => !board.tickets[id]);
  if (unknown.length) throw new BoardError(`PR references unknown tickets: ${unknown.join(", ")}`);
  const next = structuredClone(board);
  const changed = [];
  if (event !== "opened" && event !== "merged" && event !== "approved" && event !== "closed") {
    throw new BoardError(`Unsupported pull-request event: ${event}`);
  }
  for (const id of ticketIds) {
    const ticket = next.tickets[id];
    const currentColumn = next.board.columns.find((column) => column.id === ticket.columnId);
    let targetColumnId = null;
    if (event === "opened" && currentColumn.category === "not-started") targetColumnId = next.board.pullRequests.openedColumnId;
    if (event === "merged" && currentColumn.category !== "done") targetColumnId = next.board.pullRequests.mergedColumnId;
    if (!targetColumnId) continue;
    const from = ticket.columnId;
    ticket.columnId = targetColumnId;
    ticket.rank = nextRank(next, targetColumnId);
    ticket.updatedAt = occurredAt;
    ticket.comments.push({
      id: randomUUID(),
      author: actor,
      body: event === "opened" ? "Moved automatically when the linked pull request opened." : "Moved automatically when the linked pull request merged.",
      createdAt: occurredAt,
    });
    changed.push({ ticketId: id, from, to: targetColumnId });
  }
  return { board: next, ticketIds, changed };
}

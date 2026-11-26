import matter from "gray-matter";
import yaml from "js-yaml";
import type {
  ChecklistItem,
  Priority,
  ReviewPacket,
  Ticket,
  TicketComment,
  TriageState,
} from "./types.js";

const COMMENTS_HEADING = /^##\s+Comments\s*$/m;
const CHECKBOX_LINE = /^(\s*[-*]\s+)\[([ xX])\]\s+(.+)$/;

const VALID_PRIORITIES = new Set<Priority>(["none", "low", "medium", "high", "urgent"]);
const VALID_TRIAGE = new Set<TriageState>(["accepted", "proposed", "dismissed"]);

export function extractChecklist(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CHECKBOX_LINE.exec(line);
    if (match) {
      items.push({
        index: items.length,
        checked: match[2].toLowerCase() === "x",
        text: match[3].trim(),
      });
    }
  }
  return items;
}

export function toggleChecklistInMarkdown(
  markdown: string,
  index: number,
  forceChecked?: boolean,
): { markdown: string; item: ChecklistItem } {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let current = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = CHECKBOX_LINE.exec(line);
    if (!match) continue;
    if (current === index) {
      const nextChecked = forceChecked !== undefined ? forceChecked : match[2].toLowerCase() !== "x";
      lines[i] = `${match[1]}[${nextChecked ? "x" : " "}] ${match[3]}`;
      return {
        markdown: lines.join("\n"),
        item: { index, checked: nextChecked, text: match[3].trim() },
      };
    }
    current += 1;
  }
  throw new Error(`Checklist item #${index + 1} not found`);
}

function parseCommentsSection(rawSection: string): TicketComment[] {
  const comments: TicketComment[] = [];
  const trimmed = rawSection.trim();
  if (!trimmed) return comments;

  const blocks = trimmed.split(/^###\s+/m).filter(Boolean);
  for (const block of blocks) {
    const firstNewline = block.indexOf("\n");
    const header = (firstNewline >= 0 ? block.slice(0, firstNewline) : block).trim();
    const body = (firstNewline >= 0 ? block.slice(firstNewline + 1) : "").trim();
    if (!header) continue;
    // Header format: "<iso> · <author> · <id>" or "<iso> · <author>"
    const parts = header.split(/\s+·\s+/);
    const createdAt = parts[0]?.trim() || new Date().toISOString();
    const author = parts[1]?.trim() || "Unknown";
    const id = parts[2]?.trim() || `c-${comments.length + 1}`;
    comments.push({ id, author, body, createdAt });
  }
  return comments;
}

function serializeCommentsSection(comments: TicketComment[]): string {
  if (!comments.length) return "";
  const rendered = comments.map(
    (c) => `### ${c.createdAt} · ${c.author} · ${c.id}\n${c.body.trim()}`,
  );
  return `\n\n## Comments\n\n${rendered.join("\n\n")}`;
}

function normalizeReview(raw: unknown): ReviewPacket {
  if (!raw || typeof raw !== "object") {
    return { state: "none" };
  }
  const obj = raw as Record<string, unknown>;
  const state =
    obj.state === "pending" || obj.state === "approved" || obj.state === "changes_requested"
      ? obj.state
      : "none";
  if (state === "none") return { state: "none" };
  return {
    state,
    requestedBy: typeof obj.requestedBy === "string" ? obj.requestedBy : null,
    requestedAt: typeof obj.requestedAt === "string" ? obj.requestedAt : null,
    decidedBy: typeof obj.decidedBy === "string" ? obj.decidedBy : null,
    decidedAt: typeof obj.decidedAt === "string" ? obj.decidedAt : null,
    summary: typeof obj.summary === "string" ? obj.summary : null,
    question: typeof obj.question === "string" ? obj.question : null,
    filesChanged: Array.isArray(obj.filesChanged) ? (obj.filesChanged as ReviewPacket["filesChanged"]) : [],
    checks: Array.isArray(obj.checks) ? (obj.checks as ReviewPacket["checks"]) : [],
    note: typeof obj.note === "string" ? obj.note : null,
    prNumber: typeof obj.prNumber === "number" ? obj.prNumber : null,
    prUrl: typeof obj.prUrl === "string" ? obj.prUrl : null,
    mergeState:
      obj.mergeState === "waiting_ci" || obj.mergeState === "merged" || obj.mergeState === "ci_failed"
        ? obj.mergeState
        : "none",
  };
}

export function parseTicketMarkdown(raw: string, fallbackId: string): Ticket {
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const content = parsed.content.trim();

  let description = content;
  let comments: TicketComment[] = [];

  const commentsMatch = COMMENTS_HEADING.exec(content);
  if (commentsMatch && commentsMatch.index !== undefined) {
    description = content.slice(0, commentsMatch.index).trim();
    const afterHeading = content.slice(commentsMatch.index + commentsMatch[0].length);
    comments = parseCommentsSection(afterHeading);
  }

  const now = new Date().toISOString();
  const priorityRaw = String(data.priority ?? "none").toLowerCase() as Priority;
  const triageRaw = String(data.triage ?? "accepted").toLowerCase() as TriageState;

  const estimateNum =
    data.estimate === null || data.estimate === undefined || data.estimate === ""
      ? null
      : Number(data.estimate);

  const ticket: Ticket = {
    id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : fallbackId,
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : fallbackId,
    description,
    status: typeof data.status === "string" && data.status.trim() ? data.status.trim() : "backlog",
    priority: VALID_PRIORITIES.has(priorityRaw) ? priorityRaw : "none",
    estimate: estimateNum !== null && Number.isFinite(estimateNum) && estimateNum >= 0 ? estimateNum : null,
    labels: Array.isArray(data.labels)
      ? [...new Set(data.labels.map((l) => String(l).trim().toLowerCase()).filter(Boolean))]
      : [],
    assignee: typeof data.assignee === "string" && data.assignee.trim() ? data.assignee.trim() : null,
    cycleId: typeof data.cycleId === "string" && data.cycleId.trim() ? data.cycleId.trim() : null,
    rank: typeof data.rank === "number" && Number.isFinite(data.rank) ? data.rank : 1000,
    blockedBy: Array.isArray(data.blockedBy)
      ? [...new Set(data.blockedBy.map((b) => String(b).trim().toUpperCase()).filter(Boolean))]
      : [],
    files: Array.isArray(data.files)
      ? [...new Set(data.files.map((f) => String(f).trim()).filter(Boolean))]
      : [],
    branch: typeof data.branch === "string" && data.branch.trim() ? data.branch.trim() : null,
    t3ThreadId: typeof data.t3ThreadId === "string" && data.t3ThreadId.trim() ? data.t3ThreadId.trim() : null,
    t3Provider: typeof data.t3Provider === "string" && data.t3Provider.trim() ? data.t3Provider.trim() : null,
    t3Model: typeof data.t3Model === "string" && data.t3Model.trim() ? data.t3Model.trim() : null,
    t3Reasoning: typeof data.t3Reasoning === "string" && data.t3Reasoning.trim() ? data.t3Reasoning.trim() : null,
    triage: VALID_TRIAGE.has(triageRaw) ? triageRaw : "accepted",
    proposedBy: typeof data.proposedBy === "string" && data.proposedBy.trim() ? data.proposedBy.trim() : null,
    review: normalizeReview(data.review),
    checklist: extractChecklist(description),
    comments,
    createdBy: typeof data.createdBy === "string" && data.createdBy.trim() ? data.createdBy.trim() : "Owner",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
  };

  return ticket;
}

export function serializeTicketMarkdown(ticket: Ticket): string {
  const frontmatter: Record<string, unknown> = {
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    estimate: ticket.estimate,
    labels: ticket.labels,
    assignee: ticket.assignee,
    cycleId: ticket.cycleId,
    rank: ticket.rank,
  };

  if (ticket.blockedBy.length > 0) frontmatter.blockedBy = ticket.blockedBy;
  if (ticket.files.length > 0) frontmatter.files = ticket.files;
  if (ticket.branch) frontmatter.branch = ticket.branch;
  if (ticket.t3ThreadId) frontmatter.t3ThreadId = ticket.t3ThreadId;
  if (ticket.t3Provider) frontmatter.t3Provider = ticket.t3Provider;
  if (ticket.t3Model) frontmatter.t3Model = ticket.t3Model;
  if (ticket.t3Reasoning) frontmatter.t3Reasoning = ticket.t3Reasoning;
  if (ticket.triage !== "accepted") frontmatter.triage = ticket.triage;
  if (ticket.proposedBy) frontmatter.proposedBy = ticket.proposedBy;

  if (ticket.review && ticket.review.state !== "none") {
    const rev: Record<string, unknown> = { state: ticket.review.state };
    if (ticket.review.requestedBy) rev.requestedBy = ticket.review.requestedBy;
    if (ticket.review.requestedAt) rev.requestedAt = ticket.review.requestedAt;
    if (ticket.review.decidedBy) rev.decidedBy = ticket.review.decidedBy;
    if (ticket.review.decidedAt) rev.decidedAt = ticket.review.decidedAt;
    if (ticket.review.summary) rev.summary = ticket.review.summary;
    if (ticket.review.question) rev.question = ticket.review.question;
    if (ticket.review.filesChanged?.length) rev.filesChanged = ticket.review.filesChanged;
    if (ticket.review.checks?.length) rev.checks = ticket.review.checks;
    if (ticket.review.note) rev.note = ticket.review.note;
    if (ticket.review.prNumber) rev.prNumber = ticket.review.prNumber;
    if (ticket.review.prUrl) rev.prUrl = ticket.review.prUrl;
    if (ticket.review.mergeState && ticket.review.mergeState !== "none") rev.mergeState = ticket.review.mergeState;
    frontmatter.review = rev;
  }

  frontmatter.createdBy = ticket.createdBy;
  frontmatter.createdAt = ticket.createdAt;
  frontmatter.updatedAt = ticket.updatedAt;

  const yamlText = yaml.dump(frontmatter, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();

  const body = ticket.description.trim();
  const comments = serializeCommentsSection(ticket.comments);

  const sections = [`---\n${yamlText}\n---`];
  if (body) sections.push(body);
  if (comments) {
    if (body) {
      return `${sections[0]}\n\n${body}${comments}\n`;
    }
    return `${sections[0]}${comments}\n`;
  }
  return body ? `${sections[0]}\n\n${body}\n` : `${sections[0]}\n`;
}

export type ColumnCategory = "backlog" | "todo" | "started" | "review" | "done";

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export type TriageState = "accepted" | "proposed" | "dismissed";

export type ReviewState = "none" | "pending" | "approved" | "changes_requested";

export type CycleState = "planned" | "active" | "completed";

export interface ColumnConfig {
  id: string;
  name: string;
  category: ColumnCategory;
  wipLimit: number | null;
}

export interface ProjectConfig {
  schemaVersion: 2;
  key: string;
  name: string;
  description: string;
  owner: string;
  nextTicketNumber: number;
  reviewGate: boolean;
  columns: ColumnConfig[];
}

export interface ChecklistItem {
  index: number;
  text: string;
  checked: boolean;
}

export interface TicketComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewFileChange {
  path: string;
  added: number;
  removed: number;
  isNew?: boolean;
}

export interface ReviewCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

export type MergeState = "none" | "waiting_ci" | "merged" | "ci_failed";

export interface ReviewPacket {
  state: ReviewState;
  requestedBy?: string | null;
  requestedAt?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  summary?: string | null;
  question?: string | null;
  filesChanged?: ReviewFileChange[];
  checks?: ReviewCheck[];
  note?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  mergeState?: MergeState;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string; // ColumnConfig.id
  priority: Priority;
  estimate: number | null;
  labels: string[];
  assignee: string | null;
  cycleId: string | null;
  rank: number;
  blockedBy: string[];
  files: string[];
  branch: string | null;
  t3ThreadId: string | null;
  t3Provider: string | null;
  t3Model: string | null;
  t3Reasoning: string | null;
  triage: TriageState;
  proposedBy: string | null;
  review: ReviewPacket;
  checklist: ChecklistItem[];
  comments: TicketComment[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeChange {
  at: string;
  ticketId: string;
  action: "added" | "removed";
  points: number;
  actor: string;
}

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  dayIndex: number;
  remainingPoints: number;
  evenPacePoints: number;
  remainingTickets: number;
  scopeAddedPoints: number;
  scopeAddedTickets: string[];
}

export interface ColumnTimeRow {
  columnId: string;
  columnName: string;
  category: ColumnCategory;
  medianHours: number;
  p85Hours: number;
  sharePercent: number;
  sampleCount: number;
}

export interface AssigneeMetricRow {
  assignee: string;
  isAgent: boolean;
  completedTickets: number;
  completedPoints: number;
  medianCycleDays: number | null;
  p85CycleDays: number | null;
  reviewsApproved: number;
  reviewsSentBack: number;
}

export interface TicketMetricRow {
  ticketId: string;
  title: string;
  assignee: string | null;
  isAgent: boolean;
  estimate: number;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  leadDays: number | null;
  cycleDays: number | null;
  reviewWaitMinutes: number | null;
  reopened: boolean;
}

export interface CycleVelocityPoint {
  cycleId: string;
  cycleNumber: number;
  name: string;
  state: CycleState;
  committedPoints: number;
  completedPoints: number;
  completedTickets: number;
}

export interface CycleMetricsSnapshot {
  calculatedAt: string;
  eventCount: number;
  committedPoints: number;
  completedPoints: number;
  totalPoints: number;
  completedTickets: number;
  totalTickets: number;
  scopeAddedPoints: number;
  scopeAddedTicketIds: string[];
  medianCycleDays: number | null;
  avgCycleDays: number | null;
  p85CycleDays: number | null;
  medianLeadDays: number | null;
  avgLeadDays: number | null;
  p85LeadDays: number | null;
  medianReviewWaitMinutes: number | null;
  reviewsApproved: number;
  reviewsSentBack: number;
  throughputPerWeek: number;
  burndown: BurndownPoint[];
  timeInColumn: ColumnTimeRow[];
  byAssignee: AssigneeMetricRow[];
  tickets: TicketMetricRow[];
}

export interface Cycle {
  id: string;
  number: number;
  name: string;
  goal: string;
  state: CycleState;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  actualStart: string | null;
  actualEnd: string | null;
  initialPoints: number;
  scopeChanges: ScopeChange[];
  snapshot: CycleMetricsSnapshot | null;
}

export interface CyclesFile {
  nextCycleNumber: number;
  cycles: Cycle[];
}

export type EventType =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.moved"
  | "ticket.claimed"
  | "ticket.checklist_toggled"
  | "ticket.commented"
  | "ticket.deleted"
  | "triage.accepted"
  | "triage.dismissed"
  | "review.requested"
  | "review.approved"
  | "review.rejected"
  | "cycle.created"
  | "cycle.started"
  | "cycle.completed"
  | "cycle.scope_changed"
  | "t3.launched"
  | "t3.feedback_sent";

export interface BoardEvent {
  id: string;
  at: string;
  type: EventType;
  actor: string;
  ticketId?: string;
  cycleId?: string;
  data?: Record<string, unknown>;
}

export interface MetricsReport {
  projectKey: string;
  projectName: string;
  generatedAt: string;
  lastEventAt: string | null;
  totalEvents: number;
  selectedCycle: Cycle | null;
  previousCycleMedianCycleDays: number | null;
  metrics: CycleMetricsSnapshot;
  velocityHistory: CycleVelocityPoint[];
}

export interface RegisteredProject {
  id: string;
  path: string;
  key: string;
  name: string;
  addedAt: string;
}

export type ThemePreference = "light" | "dark" | "system";

export interface AgentModelConfig {
  assignee: string;
  label: string;
  provider: string;
  model: string;
  reasoningKey: string;
  reasoningValue: string;
}

export interface T3Settings {
  defaultAgent: string;
  defaultBaseRef: string;
  sendBackToThread: boolean;
  agents: Record<string, AgentModelConfig>;
}

export interface Registry {
  version: 1;
  lastProjectId: string | null;
  theme: ThemePreference;
  t3: T3Settings;
  projects: RegisteredProject[];
}

export interface ProjectSummary extends RegisteredProject {
  exists: boolean;
  reviewWaitingCount: number;
  backlogCount: number;
  activeCycleName: string | null;
}

export interface ProjectSnapshot {
  projectId: string;
  path: string;
  config: ProjectConfig;
  tickets: Ticket[];
  cycles: Cycle[];
  recentEvents: BoardEvent[];
  lastEventAt: string | null;
  eventCount: number;
}

export class TriathlonError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "TRIATHLON_ERROR", status = 400) {
    super(message);
    this.name = "TriathlonError";
    this.code = code;
    this.status = status;
  }
}

export function isAgentActor(actor: string | null | undefined): boolean {
  if (!actor) return false;
  return actor.startsWith("agent:");
}

export function displayActor(actor: string | null | undefined): string {
  if (!actor) return "Unassigned";
  return actor.startsWith("agent:") ? actor.slice("agent:".length) : actor;
}

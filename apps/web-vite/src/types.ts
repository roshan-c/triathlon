export type RouteName = "dashboard" | "board" | "backlog" | "sprints" | "metrics";

export interface Project {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface Column {
  id: string;
  name: string;
  position: number;
  category?: string;
}

export interface Ticket {
  id: string;
  number: number;
  title: string;
  descriptionMd?: string | null;
  points?: number | null;
  priority?: "low" | "medium" | "high";
  assigneeId?: string | null;
  columnId: string;
  category?: string;
  sprintId?: string | null;
  reviewState?: string;
  resourceVersion?: number;
  createdAt?: string;
}

export interface BoardColumn {
  column: Column;
  tickets: Ticket[];
}

export interface Sprint {
  id: string;
  name: string;
  state: "planned" | "active" | "completed" | "archived";
  plannedStart: string;
  plannedEnd: string;
  createdAt?: string;
}

export interface SprintMetrics {
  velocity: number;
  throughput?: number;
  cycleTimes?: Record<string, number>;
  leadTimes?: Record<string, number>;
  burndown?: Array<{ day: string; pointsRemaining: number }>;
  completedPerDay?: Record<string, number>;
}

export interface WorkspaceData {
  project: Project;
  projects: Project[];
  user: { id: string; name: string; email: string; image?: string | null };
  refreshKey: number;
  refresh: () => void;
}

import type {
  Cycle,
  MetricsReport,
  Priority,
  ProjectConfig,
  ProjectSnapshot,
  ProjectSummary,
  T3Settings,
  ThemePreference,
  Ticket,
} from "../../core/types.js";
import type { PrInfo } from "../../core/github.js";

export type { PrInfo };

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; code?: string };
      if (data.error) message = data.error;
      if (data.code) code = data.code;
    } catch {
      // keep status text
    }
    throw new ApiError(message, code);
  }
  return (await res.json()) as T;
}

export const api = {
  getProjects: () =>
    request<{ theme: ThemePreference; lastProjectId: string | null; projects: ProjectSummary[] }>(
      "/api/projects",
    ),

  registerProject: (body: {
    path: string;
    initIfMissing?: boolean;
    key?: string;
    name?: string;
    owner?: string;
    demo?: boolean;
  }) => request<{ id: string; path: string; key: string; name: string }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  unregisterProject: (projectId: string) =>
    request<{ removed: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),

  updatePreferences: (body: { theme?: ThemePreference; lastProjectId?: string | null }) =>
    request("/api/preferences", { method: "PATCH", body: JSON.stringify(body) }),

  getSnapshot: (projectId: string) =>
    request<ProjectSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/snapshot`),

  updateConfig: (projectId: string, patch: Partial<ProjectConfig>) =>
    request<ProjectConfig>(`/api/projects/${encodeURIComponent(projectId)}/config`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  createTicket: (
    projectId: string,
    body: {
      title: string;
      description?: string;
      status?: string;
      priority?: Priority;
      estimate?: number | null;
      labels?: string[];
      assignee?: string | null;
      cycleId?: string | null;
      blockedBy?: string[];
      files?: string[];
      branch?: string | null;
      criteria?: string[];
      proposed?: boolean;
    },
  ) =>
    request<Ticket>(`/api/projects/${encodeURIComponent(projectId)}/tickets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateTicket: (
    projectId: string,
    ticketId: string,
    patch: Partial<{
      title: string;
      description: string;
      priority: Priority;
      estimate: number | null;
      labels: string[];
      assignee: string | null;
      cycleId: string | null;
      blockedBy: string[];
      files: string[];
      branch: string | null;
      rank: number;
    }>,
  ) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  moveTicket: (projectId: string, ticketId: string, status: string, rank?: number) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/move`,
      { method: "POST", body: JSON.stringify({ status, rank }) },
    ),

  toggleChecklist: (projectId: string, ticketId: string, index: number, checked?: boolean) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/checklist/${index}`,
      { method: "POST", body: JSON.stringify({ checked }) },
    ),

  addComment: (projectId: string, ticketId: string, body: string) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    ),

  getPrompt: (projectId: string, ticketId: string) =>
    request<{ prompt: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/prompt`,
    ),

  getT3Settings: () => request<T3Settings>("/api/t3/settings"),

  updateT3Settings: (patch: Partial<T3Settings>) =>
    request<T3Settings>("/api/t3/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  launchInT3: (
    projectId: string,
    ticketId: string,
    overrides?: {
      agent?: string;
      provider?: string;
      model?: string;
      reasoningKey?: string;
      reasoningValue?: string;
      baseRef?: string;
      branch?: string;
    },
  ) =>
    request<{
      ticket: Ticket;
      threadId: string;
      branch: string;
      baseRef: string;
      agent: string;
      provider: string;
      model: string;
      reasoning: string | null;
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/t3/launch`,
      { method: "POST", body: JSON.stringify(overrides ?? {}) },
    ),

  getT3Status: (projectId: string, ticketId: string) =>
    request<{ linked: boolean; threadId?: string; status?: string; title?: string; branch?: string | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/t3/status`,
    ),

  deleteTicket: (projectId: string, ticketId: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`,
      { method: "DELETE" },
    ),

  requestReview: (
    projectId: string,
    ticketId: string,
    body: { summary: string; question?: string | null; branch?: string | null },
  ) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/review/request`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  getTicketPr: (projectId: string, ticketId: string) =>
    request<{ found: boolean; pr: PrInfo | null; error?: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/pr`,
    ),

  getTicketPrDiff: (projectId: string, ticketId: string) =>
    request<{ source: "pr" | "git" | null; prNumber?: number; patch: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/pr/diff`,
    ),

  rerunTicketCi: (projectId: string, ticketId: string) =>
    request<{ prNumber: number; rerunRunIds: number[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/pr/rerun-ci`,
      { method: "POST" },
    ),

  requestTicketRebase: (projectId: string, ticketId: string) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/pr/rebase`,
      { method: "POST" },
    ),

  approveReview: (
    projectId: string,
    ticketId: string,
    options?: string | { note?: string; skipMerge?: boolean },
  ) => {
    const body = typeof options === "string" ? { note: options } : (options ?? {});
    return request<{
      ticket: Ticket;
      status: "merged" | "waiting_ci" | "approved_only";
      pr: PrInfo | null;
      prOpened?: boolean;
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/review/approve`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  rejectReview: (projectId: string, ticketId: string, note: string) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/review/reject`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),

  acceptTriage: (
    projectId: string,
    ticketId: string,
    body?: { priority?: Priority; estimate?: number | null; cycleId?: string | null },
  ) =>
    request<Ticket>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/triage/accept`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),

  dismissTriage: (projectId: string, ticketId: string) =>
    request<{ dismissed: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/triage/dismiss`,
      { method: "POST" },
    ),

  createCycle: (projectId: string, body: { name: string; goal?: string; startDate: string; endDate: string }) =>
    request<Cycle>(`/api/projects/${encodeURIComponent(projectId)}/cycles`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  startCycle: (projectId: string, cycleId: string) =>
    request<Cycle>(
      `/api/projects/${encodeURIComponent(projectId)}/cycles/${encodeURIComponent(cycleId)}/start`,
      { method: "POST" },
    ),

  completeCycle: (projectId: string, cycleId: string, rolloverTo?: string | "backlog" | null) =>
    request<{ cycle: Cycle; rolledOverTicketIds: string[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/cycles/${encodeURIComponent(cycleId)}/complete`,
      { method: "POST", body: JSON.stringify({ rolloverTo }) },
    ),

  getMetrics: (projectId: string, cycleId?: string | null) => {
    const qs = cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : "";
    return request<MetricsReport>(`/api/projects/${encodeURIComponent(projectId)}/metrics${qs}`);
  },

  exportMetricsUrl: (projectId: string, format: "csv" | "events-csv" | "md" | "svg" | "json", cycleId?: string | null) => {
    const params = new URLSearchParams({ format });
    if (cycleId) params.set("cycleId", cycleId);
    return `/api/projects/${encodeURIComponent(projectId)}/metrics/export?${params.toString()}`;
  },
};

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand on restricted contexts
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("Copy failed in this browser context.");
  }
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return `${diffSec} s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 14) return `${diffDay} d`;
  return `${Math.round(diffDay / 7)} w`;
}

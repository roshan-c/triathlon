import { TriathlonClient } from "@triathlon/client";
import type { BoardColumn, Column, Project, Sprint, SprintMetrics, Ticket } from "../types";

const API_BASE = (import.meta.env.DEV ? window.location.origin : (import.meta.env.VITE_TRIATHLON_URL ?? window.location.origin)).replace(/\/$/, "");

export const client = new TriathlonClient({
  baseUrl: API_BASE,
  clientName: "vite-web",
});

export const apiBase = API_BASE;

export async function bootstrapOwner(input: { code: string; email: string; displayName: string; password: string }): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/bootstrap/redeem`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => null) as { message?: string; detail?: string } | null;
  throw new Error(body?.detail ?? body?.message ?? "Owner setup failed.");
}

export async function getProjects(): Promise<Project[]> {
  const access = await client.projects() as Array<{ project: { id: string; name: string }; role: "owner" | "member" }>;
  return access.map((entry) => ({ id: entry.project.id, name: entry.project.name, role: entry.role }));
}

export function createProject(name: string): Promise<Project> {
  return client.request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getBoard(projectId: string): Promise<BoardColumn[]> {
  return client.board(projectId) as Promise<BoardColumn[]>;
}

export function getSprints(projectId: string): Promise<Sprint[]> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints`);
}

export function getSprintMetrics(projectId: string, sprintId: string): Promise<SprintMetrics> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/metrics`);
}

export async function getVelocityHistory(projectId: string, sprints: Sprint[]): Promise<Array<{ sprintName: string; velocity: number }>> {
  const completed = sprints.filter((sprint) => sprint.state === "completed" || sprint.state === "archived");
  return Promise.all(completed.map(async (sprint) => ({
    sprintName: sprint.name,
    velocity: (await getSprintMetrics(projectId, sprint.id)).velocity,
  })));
}

export function createTicket(projectId: string, input: { title: string; descriptionMd?: string; points?: number; priority: string; columnId: string; assigneeId?: string }): Promise<Ticket> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/tickets`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export async function moveTicket(projectId: string, ticket: Ticket, target: Column): Promise<void> {
  const detail = await client.ticket(projectId, ticket.id) as { ticket: Ticket };
  const current = detail.ticket;
  if (target.category === "done") {
    const comment = window.prompt("Outcome comment", "Resolved from board");
    if (!comment?.trim()) return;
    await client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticket.id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ comment, expectedResourceVersion: current.resourceVersion }),
    });
    return;
  }
  if (current.category === "done") {
    if (!window.confirm("Reopen this closed ticket and move it out of Done?")) return;
    await client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticket.id)}/reopen`, {
      method: "POST",
      body: JSON.stringify({ columnId: target.id, expectedResourceVersion: current.resourceVersion }),
    });
    return;
  }
  await client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticket.id)}/move`, {
    method: "POST",
    body: JSON.stringify({ columnId: target.id, position: 0, expectedResourceVersion: current.resourceVersion }),
  });
}

export function attachTicket(projectId: string, sprintId: string, ticketId: string): Promise<unknown> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/members`, {
    method: "POST",
    body: JSON.stringify({ ticketIds: [ticketId] }),
  });
}

export function createSprint(projectId: string, input: { name: string; plannedStart: string; plannedEnd: string }): Promise<Sprint> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function activateSprint(projectId: string, sprintId: string): Promise<Sprint> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/activate`, { method: "POST" });
}

export function completeSprint(projectId: string, sprintId: string): Promise<Sprint> {
  return client.request(`/api/v1/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/complete`, { method: "POST" });
}

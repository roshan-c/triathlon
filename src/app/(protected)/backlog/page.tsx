"use client";

import { useMutation, useQuery } from "convex/react";
import { PriorityBadge } from "@/components/priority-badge";
import { useAppContext } from "@/components/app-context";
import { EmptyState, PageHeader } from "@/components/ui";
import { cvx } from "@/lib/convex";

export default function BacklogPage() {
  const { externalId, project } = useAppContext();

  const board = useQuery(cvx.tickets.board, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const attachTicketToSprint = useMutation(cvx.tickets.attachToSprint);

  const backlog = board?.columns.find((column: any) => column.name === "Backlog");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Backlog"
        description="Prioritize tickets and attach them to upcoming sprints."
      />

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
        {(backlog?.tickets ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState>No tickets in backlog. Add tickets from the board.</EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(backlog?.tickets ?? []).map((ticket: any) => (
              <article key={ticket._id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="tnum font-mono text-xs text-[var(--muted-foreground)]">#{ticket.number}</span>
                    <h2 className="truncate text-sm font-medium text-[var(--foreground)]">{ticket.title}</h2>
                    <PriorityBadge priority={ticket.priority} />
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-[var(--muted-foreground)]">
                    {ticket.description || "No description"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="tnum font-mono text-xs text-[var(--muted-foreground)]">{ticket.storyPoints} pts</span>
                  <select
                    value={ticket.sprintId ?? ""}
                    aria-label={`Sprint for ${ticket.title}`}
                    className="text-sm"
                    onChange={(event) =>
                      void attachTicketToSprint({
                        projectId: project.projectId,
                        externalId,
                        ticketId: ticket._id,
                        sprintId: event.target.value || undefined
                      })
                    }
                  >
                    <option value="">No sprint</option>
                    {(sprints ?? []).map((sprint: any) => (
                      <option key={sprint._id} value={sprint._id}>
                        {sprint.name}
                      </option>
                    ))}
                  </select>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
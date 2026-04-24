"use client";

import { useMutation, useQuery } from "convex/react";
import { PriorityBadge } from "@/components/priority-badge";
import { useAppContext } from "@/components/app-context";
import { cvx } from "@/lib/convex";

export default function BacklogPage() {
  const { externalId, project } = useAppContext();

  const board = useQuery(cvx.boards.getBoard, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const attachCardToSprint = useMutation(cvx.boards.attachCardToSprint);

  const backlog = board?.columns.find((column: any) => column.name === "Backlog");

  return (
    <section className="panel p-4">
      <h1 className="font-display text-2xl font-bold uppercase text-[var(--foreground)]">Backlog</h1>
      <p className="muted mt-1 text-sm">Prioritize items and attach them to upcoming sprints.</p>

      <div className="mt-4 space-y-3">
        {(backlog?.cards ?? []).length === 0 ? (
          <p className="muted rounded-md border-2 border-dashed border-[var(--border)] p-4 text-sm">
            No cards in backlog.
          </p>
        ) : (
          (backlog?.cards ?? []).map((card: any) => (
            <article key={card._id} className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold uppercase text-[var(--foreground)]">{card.title}</h2>
                <PriorityBadge priority={card.priority} />
              </div>
              <p className="muted mt-1 text-sm">{card.description || "No description"}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="pill bg-[var(--background-alt)] text-[var(--muted-foreground)]">{card.storyPoints} pts</span>
                <select
                  value={card.sprintId ?? ""}
                  className="rounded-md px-2 py-1 text-sm"
                  onChange={(event) =>
                    void attachCardToSprint({
                      projectId: project.projectId,
                      externalId,
                      cardId: card._id,
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
          ))
        )}
      </div>
    </section>
  );
}

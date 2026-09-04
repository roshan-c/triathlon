"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAppContext } from "@/components/app-context";
import { PageHeader } from "@/components/ui";
import { cvx } from "@/lib/convex";

function asTimestamp(dateInput: string) {
  return new Date(`${dateInput}T00:00:00`).getTime();
}

function SprintDates({ startDate, endDate }: { startDate: number; endDate: number }) {
  return (
    <p className="tnum text-xs text-[var(--muted-foreground)]">
      {new Date(startDate).toLocaleDateString()} - {new Date(endDate).toLocaleDateString()}
    </p>
  );
}

export default function SprintsPage() {
  const { externalId, project } = useAppContext();

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const createSprint = useMutation(cvx.sprints.create);
  const activateSprint = useMutation(cvx.sprints.activate);
  const completeSprint = useMutation(cvx.sprints.complete);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const activeSprints = (sprints ?? []).filter(
    (sprint: any) => sprint.status !== "archived" && sprint.status !== "completed"
  );
  const archivedSprints = (sprints ?? []).filter(
    (sprint: any) => sprint.status === "archived" || sprint.status === "completed"
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await createSprint({
      projectId: project.projectId,
      externalId,
      name,
      startDate: asTimestamp(startDate),
      endDate: asTimestamp(endDate)
    });

    setName("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sprints"
        description="Create sprint cycles, activate the current one, and archive the rest."
      />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <section className="h-fit rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)]">New sprint</h2>
          <form className="mt-4 space-y-3.5" onSubmit={submit}>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Sprint name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Start date</span>
              <input
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full"
                required
                type="date"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">End date</span>
              <input
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full"
                required
                type="date"
              />
            </label>
            <button className="btn btn-primary w-full" type="submit">
              Save sprint
            </button>
          </form>
        </section>

        <section className="space-y-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--border)] px-5 py-3.5">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Planned and active</h2>
            </div>
            {activeSprints.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[var(--muted-foreground)]">No active or planned sprints.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {activeSprints.map((sprint: any) => (
                  <article key={sprint._id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-sm font-medium text-[var(--foreground)]">{sprint.name}</h3>
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${
                            sprint.status === "active"
                              ? "bg-[var(--ok-soft)] text-[var(--ok-text)]"
                              : "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          }`}
                        >
                          {sprint.status}
                        </span>
                      </div>
                      <div className="mt-1">
                        <SprintDates startDate={sprint.startDate} endDate={sprint.endDate} />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {sprint.status !== "active" ? (
                        <button
                          type="button"
                          className="btn btn-sm bg-[var(--ok-soft)] text-[var(--ok-text)] hover:bg-[color-mix(in_srgb,var(--ok-soft)_80%,var(--ok)_20%)]"
                          onClick={() =>
                            void activateSprint({
                              projectId: project.projectId,
                              externalId,
                              sprintId: sprint._id
                            })
                          }
                        >
                          Activate
                        </button>
                      ) : null}

                      {sprint.status === "active" ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            void completeSprint({
                              projectId: project.projectId,
                              externalId,
                              sprintId: sprint._id
                            })
                          }
                        >
                          Complete
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--border)] px-5 py-3.5">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Archived</h2>
            </div>
            {archivedSprints.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[var(--muted-foreground)]">No archived sprints yet.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {archivedSprints.map((sprint: any) => (
                  <article key={sprint._id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5">
                    <div>
                      <h3 className="text-sm font-medium text-[var(--foreground)]">{sprint.name}</h3>
                      <div className="mt-1">
                        <SprintDates startDate={sprint.startDate} endDate={sprint.endDate} />
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-md bg-[var(--background-alt)] px-2 py-0.5 text-[11px] font-medium capitalize text-[var(--muted-foreground)]">
                      archived
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
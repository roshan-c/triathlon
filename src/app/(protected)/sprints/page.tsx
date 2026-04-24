"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAppContext } from "@/components/app-context";
import { cvx } from "@/lib/convex";

function asTimestamp(dateInput: string) {
  return new Date(`${dateInput}T00:00:00`).getTime();
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
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <section className="panel p-4">
        <h1 className="font-display text-2xl font-bold uppercase text-[var(--foreground)]">Create Sprint</h1>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <label className="block text-sm">
            <span className="muted mb-1 block">Sprint name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md px-3 py-2"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="muted mb-1 block">Start date</span>
            <input
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-md px-3 py-2"
              required
              type="date"
            />
          </label>
          <label className="block text-sm">
            <span className="muted mb-1 block">End date</span>
            <input
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-md px-3 py-2"
              required
              type="date"
            />
          </label>
          <button className="btn-accent w-full rounded-md px-3 py-2.5 font-semibold uppercase" type="submit">
            Save sprint
          </button>
        </form>
      </section>

      <section className="panel p-4">
        <h2 className="font-display text-2xl font-bold uppercase text-[var(--foreground)]">Active Sprint List</h2>
        <div className="mt-4 space-y-3">
          {activeSprints.length === 0 ? (
            <p className="muted text-sm">No active or planned sprints.</p>
          ) : null}
          {activeSprints.map((sprint: any) => (
            <article key={sprint._id} className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold uppercase text-[var(--foreground)]">{sprint.name}</h3>
                  <p className="muted text-xs">
                    {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`pill ${
                    sprint.status === "active"
                      ? "bg-[var(--ok-soft)] text-[var(--ok-text)]"
                      : "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                  }`}
                >
                  {sprint.status}
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                {sprint.status !== "active" ? (
                  <button
                    type="button"
                    className="rounded-md border-2 border-[var(--ok-text)] bg-[var(--ok-soft)] px-3 py-1.5 text-xs font-semibold uppercase text-[var(--ok-text)]"
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
                    className="btn-ghost rounded-md px-3 py-1.5 text-xs font-semibold uppercase"
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

        <h3 className="mt-8 font-display text-lg font-bold uppercase text-[var(--foreground)]">Archived Sprints</h3>
        <div className="mt-3 space-y-3">
          {archivedSprints.length === 0 ? (
            <p className="muted text-sm">No archived sprints yet.</p>
          ) : null}
          {archivedSprints.map((sprint: any) => (
            <article key={sprint._id} className="rounded-md border-2 border-[var(--border)] bg-[var(--background-alt)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold uppercase text-[var(--foreground)]">{sprint.name}</h3>
                  <p className="muted text-xs">
                    {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                  </p>
                </div>
                <span className="pill bg-[var(--card)] text-[var(--muted-foreground)]">archived</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

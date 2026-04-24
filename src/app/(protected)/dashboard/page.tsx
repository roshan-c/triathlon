"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useAppContext } from "@/components/app-context";
import { cvx } from "@/lib/convex";

export default function DashboardPage() {
  const { externalId, project, session } = useAppContext();

  const board = useQuery(cvx.boards.getBoard, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const activeSprint = sprints?.find((sprint: any) => sprint.status === "active") ?? null;
  const totalCards =
    board?.columns.reduce((count: number, column: any) => count + column.cards.length, 0) ?? 0;
  const doneCards = board?.columns.find((column: any) => column.name === "Done")?.cards.length ?? 0;

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <p className="muted text-sm">Welcome back, {session.user.name}</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase text-[var(--foreground)]">{project.name}</h1>
        <p className="muted mt-2 max-w-2xl text-sm">
          Keep sprint flow visible for everyone. Board and metrics update in real time as tasks move.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="panel p-4">
          <p className="muted text-xs uppercase tracking-wide">Project Role</p>
          <p className="mt-2 text-2xl font-semibold capitalize text-[var(--foreground)]">{project.role}</p>
        </article>
        <article className="panel p-4">
          <p className="muted text-xs uppercase tracking-wide">Total Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{totalCards}</p>
        </article>
        <article className="panel p-4">
          <p className="muted text-xs uppercase tracking-wide">Done Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{doneCards}</p>
        </article>
        <article className="panel p-4">
          <p className="muted text-xs uppercase tracking-wide">Active Sprint</p>
          <p className="mt-2 text-base font-semibold text-[var(--foreground)]">{activeSprint?.name ?? "No active sprint"}</p>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href={{ pathname: "/board", query: { projectId: project.projectId } }}
          className="panel p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
        >
          <h2 className="font-display text-lg font-semibold uppercase">Board</h2>
          <p className="muted mt-1 text-sm">Move cards and collaborate live with your team.</p>
        </Link>
        <Link
          href={{ pathname: "/sprints", query: { projectId: project.projectId } }}
          className="panel p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
        >
          <h2 className="font-display text-lg font-semibold uppercase">Sprints</h2>
          <p className="muted mt-1 text-sm">Plan and activate sprint cycles.</p>
        </Link>
        <Link
          href={{ pathname: "/metrics", query: { projectId: project.projectId } }}
          className="panel p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
        >
          <h2 className="font-display text-lg font-semibold uppercase">Metrics</h2>
          <p className="muted mt-1 text-sm">Track burndown, velocity, throughput, and cycle time.</p>
        </Link>
      </section>
    </div>
  );
}

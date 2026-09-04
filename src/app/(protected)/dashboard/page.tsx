"use client";

import { IconArrowRight, IconChartLine, IconFlag, IconLayoutKanban } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useAppContext } from "@/components/app-context";
import { StatCard } from "@/components/ui";
import { cvx } from "@/lib/convex";

export default function DashboardPage() {
  const { externalId, project, session } = useAppContext();

  const board = useQuery(cvx.tickets.board, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const activeSprint = sprints?.find((sprint: any) => sprint.status === "active") ?? null;
  const totalTickets =
    board?.columns.reduce((count: number, column: any) => count + column.tickets.length, 0) ?? 0;
  const doneTickets = board?.columns.find((column: any) => column.name === "Done")?.tickets.length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">Welcome back, {session.user.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--foreground)]">{project.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Board and metrics update in real time as tickets move.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Project role" value={<span className="capitalize">{project.role}</span>} />
        <StatCard label="Total tickets" value={totalTickets} />
        <StatCard label="Closed tickets" value={doneTickets} />
        <StatCard label="Active sprint" value={activeSprint?.name ?? "No active sprint"} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <QuickLink
          href={{ pathname: "/board", query: { projectId: project.projectId } }}
          icon={<IconLayoutKanban size={22} />}
          title="Board"
          description="Move tickets and collaborate live with your team."
        />
        <QuickLink
          href={{ pathname: "/sprints", query: { projectId: project.projectId } }}
          icon={<IconFlag size={22} />}
          title="Sprints"
          description="Plan and activate sprint cycles."
        />
        <QuickLink
          href={{ pathname: "/metrics", query: { projectId: project.projectId } }}
          icon={<IconChartLine size={22} />}
          title="Metrics"
          description="Track burndown, velocity, throughput, and cycle time."
        />
      </section>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  description
}: {
  href: { pathname: string; query: { projectId: string } };
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
        {icon}
      </span>
      <div className="mt-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)]">{title}</h2>
        <IconArrowRight size={16} className="text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
    </Link>
  );
}
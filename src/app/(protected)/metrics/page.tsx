"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAppContext } from "@/components/app-context";
import { cvx } from "@/lib/convex";

export default function MetricsPage() {
  const { externalId, project } = useAppContext();

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const [selectedSprintId, setSelectedSprintId] = useState<string>("");

  useEffect(() => {
    if (!sprints || sprints.length === 0) {
      if (selectedSprintId) {
        setSelectedSprintId("");
      }
      return;
    }

    const sprintStillExists = sprints.some((sprint: any) => sprint._id === selectedSprintId);
    if (!selectedSprintId || !sprintStillExists) {
      const preferredSprint = sprints.find((sprint: any) => sprint.status === "active") ?? sprints[0];
      setSelectedSprintId(preferredSprint?._id ?? "");
    }
  }, [selectedSprintId, sprints]);

  const metrics = useQuery(
    cvx.metrics.forSprint,
    selectedSprintId
      ? {
          projectId: project.projectId,
          externalId,
          sprintId: selectedSprintId
        }
      : "skip"
  );

  const velocityHistory = useQuery(cvx.metrics.velocityHistory, {
    projectId: project.projectId,
    externalId
  });

  const chartGrid = "var(--chart-grid)";
  const chartText = "var(--muted-foreground)";
  const tooltipStyle = {
    background: "var(--card)",
    border: "2px solid var(--border)",
    borderRadius: "8px",
    color: "var(--foreground)",
    fontSize: "12px"
  };

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold uppercase text-[var(--foreground)]">Metrics Dashboard</h1>
          <select
            value={selectedSprintId}
            onChange={(event) => setSelectedSprintId(event.target.value)}
            className="rounded-md px-3 py-2 text-sm"
          >
            {(sprints ?? []).length === 0 ? <option value="">No sprints</option> : null}
            {(sprints ?? []).map((sprint: any) => (
              <option key={sprint._id} value={sprint._id}>
                {sprint.name}
              </option>
            ))}
          </select>
        </div>

        {metrics ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <p className="muted text-xs uppercase">Velocity</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">{metrics.velocity} pts</p>
            </article>
            <article className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <p className="muted text-xs uppercase">Throughput</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">{metrics.throughput} tasks</p>
            </article>
            <article className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <p className="muted text-xs uppercase">Avg Cycle Time</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">{metrics.averageCycleTimeHours.toFixed(1)} h</p>
            </article>
            <article className="rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-3">
              <p className="muted text-xs uppercase">Avg Lead Time</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">{metrics.averageLeadTimeHours.toFixed(1)} h</p>
            </article>
          </div>
        ) : (
          <p className="muted mt-4 text-sm">Select a sprint to load metrics.</p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel p-4">
          <h2 className="font-display text-lg font-semibold uppercase text-[var(--foreground)]">Burndown</h2>
          <div className="mt-3 h-72">
            <ResponsiveContainer>
              <LineChart data={metrics?.burndown ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="day" fontSize={11} stroke={chartText} />
                <YAxis allowDecimals={false} stroke={chartText} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="remainingPoints" stroke="var(--chart-accent)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel p-4">
          <h2 className="font-display text-lg font-semibold uppercase text-[var(--foreground)]">Tasks Completed Per Day</h2>
          <div className="mt-3 h-72">
            <ResponsiveContainer>
              <BarChart data={metrics?.tasksCompletedPerDay ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="day" fontSize={11} stroke={chartText} />
                <YAxis allowDecimals={false} stroke={chartText} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="completed" fill="var(--chart-secondary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="panel p-4">
        <h2 className="font-display text-lg font-semibold uppercase text-[var(--foreground)]">Velocity by Sprint</h2>
        <div className="mt-3 h-72">
          <ResponsiveContainer>
            <BarChart data={velocityHistory ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
              <XAxis dataKey="sprintName" fontSize={11} stroke={chartText} />
              <YAxis allowDecimals={false} stroke={chartText} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="velocity" fill="var(--chart-neutral)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

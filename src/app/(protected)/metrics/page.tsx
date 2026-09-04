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
import { PageHeader, StatCard } from "@/components/ui";
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
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow-md)",
    color: "var(--foreground)",
    fontSize: "12px"
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Metrics" description="Velocity, throughput, and cycle time computed from real ticket movement.">
        <select
          value={selectedSprintId}
          onChange={(event) => setSelectedSprintId(event.target.value)}
          aria-label="Sprint"
          className="text-sm"
        >
          {(sprints ?? []).length === 0 ? <option value="">No sprints</option> : null}
          {(sprints ?? []).map((sprint: any) => (
            <option key={sprint._id} value={sprint._id}>
              {sprint.name}
            </option>
          ))}
        </select>
      </PageHeader>

      {metrics ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Velocity" value={`${metrics.velocity} pts`} />
          <StatCard label="Throughput" value={`${metrics.throughput} tasks`} />
          <StatCard label="Avg cycle time" value={`${metrics.averageCycleTimeHours.toFixed(1)} h`} />
          <StatCard label="Avg lead time" value={`${metrics.averageLeadTimeHours.toFixed(1)} h`} />
        </section>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">Select a sprint to load metrics.</p>
      )}

      <section className="grid gap-5 lg:grid-cols-2">
        <ChartPanel title="Burndown">
          <ResponsiveContainer>
            <LineChart data={metrics?.burndown ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
              <XAxis dataKey="day" fontSize={11} stroke={chartText} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke={chartText} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="remainingPoints" stroke="var(--chart-accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Tasks completed per day">
          <ResponsiveContainer>
            <BarChart data={metrics?.tasksCompletedPerDay ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
              <XAxis dataKey="day" fontSize={11} stroke={chartText} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke={chartText} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)" }} />
              <Bar dataKey="completed" fill="var(--chart-secondary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </section>

      <ChartPanel title="Velocity by sprint">
        <ResponsiveContainer>
          <BarChart data={velocityHistory ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
            <XAxis dataKey="sprintName" fontSize={11} stroke={chartText} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} stroke={chartText} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)" }} />
            <Bar dataKey="velocity" fill="var(--chart-neutral)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">{title}</h2>
      <div className="mt-4 h-72">{children}</div>
    </section>
  );
}
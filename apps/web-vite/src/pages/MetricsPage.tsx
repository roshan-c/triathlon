import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSprintMetrics, getSprints, getVelocityHistory } from "../lib/api";
import { useResource } from "../lib/use-resource";
import type { SprintMetrics, WorkspaceData } from "../types";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, Panel } from "../components/ui";

export function MetricsPage({ workspace }: { workspace: WorkspaceData }) {
  const sprints = useResource(() => getSprints(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const [chosenId, setChosenId] = useState("");
  const selectedId = sprints.data?.some((sprint) => sprint.id === chosenId) ? chosenId : sprints.data?.find((sprint) => sprint.state === "active")?.id ?? sprints.data?.[0]?.id ?? "";
  const metrics = useResource<SprintMetrics>(() => selectedId ? getSprintMetrics(workspace.project.id, selectedId) : Promise.resolve({ velocity: 0 }), [workspace.project.id, selectedId, workspace.refreshKey]);
  const history = useResource(() => getVelocityHistory(workspace.project.id, sprints.data ?? []), [workspace.project.id, sprints.data?.length ?? 0, workspace.refreshKey]);
  const cycle = useMemo(() => averageHours(metrics.data?.cycleTimes), [metrics.data]);
  const lead = useMemo(() => averageHours(metrics.data?.leadTimes), [metrics.data]);
  const burndown = metrics.data?.burndown ?? [];
  const completed = Object.entries(metrics.data?.completedPerDay ?? {}).map(([day, value]) => ({ day, completed: value }));

  if (sprints.loading) return <LoadingBlock label="Loading delivery signals…" />;
  if (sprints.error) return <ErrorBlock message={sprints.error} onRetry={sprints.reload} />;

  return (
    <div className="screen metrics-screen">
      <PageHeader eyebrow="DELIVERY SIGNALS / LIVE" title="Metrics" description="Velocity, throughput, and cycle time from real ticket movement." actions={<select value={selectedId} onChange={(event) => setChosenId(event.target.value)} aria-label="Sprint">{sprints.data?.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.state}</option>)}</select>} />
      {!sprints.data?.length ? <EmptyBlock>Create a sprint to begin collecting metrics.</EmptyBlock> : metrics.loading || history.loading ? <LoadingBlock label="Computing sprint metrics…" /> : metrics.error || history.error ? <ErrorBlock message={metrics.error || history.error || "Could not load metrics."} onRetry={() => { metrics.reload(); history.reload(); }} /> : <>
        <Panel className="metric-strip"><Metric label="VELOCITY" value={`${metrics.data?.velocity ?? 0} pts`} accent /><Metric label="THROUGHPUT" value={`${metrics.data?.throughput ?? completed.reduce((sum, entry) => sum + Number(entry.completed), 0)} tasks`} /><Metric label="AVG CYCLE TIME" value={`${cycle.toFixed(1)} h`} /><Metric label="AVG LEAD TIME" value={`${lead.toFixed(1)} h`} /></Panel>
        <div className="chart-grid"><ChartPanel title="Burndown" subtitle="Remaining story points"><ResponsiveContainer width="100%" height="100%"><LineChart data={burndown}><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--border-strong)" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Line type="monotone" dataKey="pointsRemaining" stroke="var(--accent)" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></ChartPanel><ChartPanel title="Tasks completed per day" subtitle="Daily throughput"><ResponsiveContainer width="100%" height="100%"><BarChart data={completed}><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--border-strong)" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey="completed" fill="var(--warning)" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></ChartPanel></div>
        <ChartPanel className="velocity-chart" title="Velocity by sprint" subtitle="Completed cycle history"><ResponsiveContainer width="100%" height="100%"><BarChart data={history.data ?? []}><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--border-strong)" /><XAxis dataKey="sprintName" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey="velocity" fill="var(--ink)" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></ChartPanel>
      </>}
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div><span>{label}</span><strong className={accent ? "accent-text" : ""}>{value}</strong></div>; }
function ChartPanel({ title, subtitle, className = "", children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }) { return <Panel className={`chart-panel ${className}`}><header><h2>{title}</h2><p>{subtitle}</p></header><div className="chart-body">{children}</div></Panel>; }
function averageHours(values?: Record<string, number>): number { const list = Object.values(values ?? {}); return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length / 3600 : 0; }

import { useState, type FormEvent } from "react";
import { activateSprint, completeSprint, createSprint, getSprints } from "../lib/api";
import { useResource } from "../lib/use-resource";
import type { Sprint, WorkspaceData } from "../types";
import { ActionButton, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, Panel, StatusChip } from "../components/ui";
import { formatDate } from "../lib/format";

export function SprintsPage({ workspace }: { workspace: WorkspaceData }) {
  const resource = useResource(() => getSprints(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = resource.data?.find((sprint) => sprint.state === "active");
  const planned = resource.data?.filter((sprint) => sprint.state === "planned") ?? [];
  const archived = resource.data?.filter((sprint) => sprint.state === "completed" || sprint.state === "archived") ?? [];

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); workspace.refresh(); resource.reload(); }
    catch (unknownError) { setError(unknownError instanceof Error ? unknownError.message : "The sprint update failed."); }
    finally { setBusy(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutate(async () => { await createSprint(workspace.project.id, { name, plannedStart: new Date(`${start}T00:00:00`).toISOString(), plannedEnd: new Date(`${end}T00:00:00`).toISOString() }); setName(""); setStart(""); setEnd(""); });
  };

  if (resource.loading) return <LoadingBlock label="Loading sprint cycles…" />;
  if (resource.error) return <ErrorBlock message={resource.error} onRetry={resource.reload} />;

  return (
    <div className="screen sprints-screen">
      <PageHeader eyebrow="SPRINT CONTROL / PLANNING" title="Sprints" description="Create sprint cycles, activate the current one, and archive the rest." actions={<ActionButton onClick={() => document.getElementById("sprint-name")?.focus()}>New sprint</ActionButton>} />
      {error ? <ErrorBlock message={error} /> : null}
      <div className="sprints-layout">
        <Panel className="sprint-form"><h2>New sprint</h2><form onSubmit={submit}><label>SPRINT NAME<input id="sprint-name" value={name} onChange={(event) => setName(event.target.value)} required /></label><label>START DATE<input type="date" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>END DATE<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} required /></label><ActionButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save sprint"}</ActionButton></form></Panel>
        <div className="sprint-timeline">
          {active ? <section className="active-sprint dark-panel"><div className="section-title-row"><StatusChip tone="active">ACTIVE</StatusChip><span>{formatDate(active.plannedStart)} – {formatDate(active.plannedEnd)}</span></div><h2>{active.name}</h2><p>Active delivery window · keep the board current before completing this cycle.</p><div className="progress dark-progress"><span style={{ width: "71%" }} /></div><ActionButton disabled={busy} onClick={() => void mutate(() => completeSprint(workspace.project.id, active.id))}>Complete sprint</ActionButton></section> : <EmptyBlock>No sprint is active. Activate a planned cycle below.</EmptyBlock>}
          <Panel className="sprint-list"><h2>Planned next</h2>{planned.length ? planned.map((sprint) => <SprintRow key={sprint.id} sprint={sprint} action={<ActionButton disabled={busy} onClick={() => void mutate(() => activateSprint(workspace.project.id, sprint.id))}>Activate</ActionButton>} />) : <EmptyBlock>No planned sprints.</EmptyBlock>}</Panel>
          <Panel className="sprint-list archived-list"><h2>Archived</h2>{archived.length ? archived.map((sprint) => <SprintRow key={sprint.id} sprint={sprint} action={<StatusChip tone="done">ARCHIVED</StatusChip>} />) : <EmptyBlock>No archived sprints yet.</EmptyBlock>}</Panel>
        </div>
      </div>
    </div>
  );
}

function SprintRow({ sprint, action }: { sprint: Sprint; action: React.ReactNode }) {
  return <article className="sprint-row"><span><strong>{sprint.name}</strong><small>{formatDate(sprint.plannedStart)} – {formatDate(sprint.plannedEnd)}</small></span><span className="sprint-row-action">{sprint.state === "planned" ? <StatusChip>{sprint.state.toUpperCase()}</StatusChip> : null}{action}</span></article>;
}

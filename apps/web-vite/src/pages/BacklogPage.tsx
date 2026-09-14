import { useMemo, useState } from "react";
import { attachTicket, getBoard, getSprints } from "../lib/api";
import { useResource } from "../lib/use-resource";
import type { RouteName, Ticket, WorkspaceData } from "../types";
import { ActionButton, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, StatusChip, TicketRow } from "../components/ui";
import { formatDate } from "../lib/format";

export function BacklogPage({ workspace, navigate }: { workspace: WorkspaceData; navigate: (route: RouteName) => void }) {
  const board = useResource(() => getBoard(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const sprints = useResource(() => getSprints(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backlog = useMemo(() => board.data?.find((entry) => entry.column.name.toLowerCase() === "backlog")?.tickets ?? [], [board.data]);
  const planned = sprints.data?.filter((sprint) => sprint.state === "planned") ?? [];
  const target = planned.find((sprint) => sprint.id === targetId) ?? planned[0];
  const visible = useMemo(() => backlog.filter((ticket) => (priority === "all" || ticket.priority === priority) && `${ticket.number} ${ticket.title} ${ticket.assigneeId ?? ""}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)), [backlog, priority, query]);
  const selectedTickets = backlog.filter((ticket) => selected.has(ticket.id));
  const points = selectedTickets.reduce((sum, ticket) => sum + (ticket.points ?? 0), 0);

  const toggle = (ticket: Ticket) => setSelected((current) => { const next = new Set(current); if (next.has(ticket.id)) next.delete(ticket.id); else next.add(ticket.id); return next; });
  const plan = async () => {
    if (!target || selected.size === 0) return;
    setBusy(true); setError(null);
    try { await Promise.all([...selected].map((ticketId) => attachTicket(workspace.project.id, target.id, ticketId))); setSelected(new Set()); workspace.refresh(); board.reload(); }
    catch (unknownError) { setError(unknownError instanceof Error ? unknownError.message : "Could not plan the selected tickets."); }
    finally { setBusy(false); }
  };

  if (board.loading || sprints.loading) return <LoadingBlock label="Loading backlog…" />;
  if (board.error || sprints.error) return <ErrorBlock message={board.error || sprints.error || "Could not load backlog."} onRetry={() => { board.reload(); sprints.reload(); }} />;

  return (
    <div className="screen backlog-screen">
      <PageHeader eyebrow={`WORK QUEUE / ${backlog.length} ITEMS`} title="Backlog" description="Prioritize tickets and attach them to upcoming sprints." actions={<ActionButton onClick={() => navigate("board")}>Open board</ActionButton>} />
      <div className="triage-controls panel">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, number, or assignee…" aria-label="Search backlog" />
        <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Priority"><option value="all">Priority · All</option><option value="high">Priority · High</option><option value="medium">Priority · Medium</option><option value="low">Priority · Low</option></select>
        <span className="sort-label">Sort · Points</span><StatusChip>{visible.length} OPEN</StatusChip>
      </div>
      {error ? <ErrorBlock message={error} /> : null}
      <div className="backlog-workarea">
        <section className="backlog-queue panel"><h2>Backlog queue <span>· ranked for planning</span></h2>{visible.length ? visible.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} status={ticket.priority === "high" ? "NEEDS SPEC" : "READY"} tone={ticket.priority === "high" ? "blocked" : "active"} selectable selected={selected.has(ticket.id)} onSelect={() => toggle(ticket)} />) : <EmptyBlock>No tickets match these filters.</EmptyBlock>}</section>
        <aside className="candidate-panel dark-panel">
          <span className="eyebrow">SPRINT CANDIDATE</span>
          {target ? <><select className="dark-select" value={target.id} onChange={(event) => setTargetId(event.target.value)} aria-label="Target sprint">{planned.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select><p>{formatDate(target.plannedStart)} – {formatDate(target.plannedEnd)}</p><strong className="candidate-points">{points} / 30 PTS</strong><div className="progress dark-progress"><span style={{ width: `${Math.min(points / 30 * 100, 100)}%` }} /></div><div className="candidate-list">{selectedTickets.length ? selectedTickets.map((ticket) => <span key={ticket.id}><b>#{ticket.number}</b><em>{ticket.title}</em><small>{ticket.points ?? 0} pts</small></span>) : <p>Select tickets from the queue to build this sprint.</p>}</div><div className="candidate-status"><StatusChip tone="active">{selected.size} SELECTED</StatusChip><StatusChip tone={points > 30 ? "blocked" : "neutral"}>{Math.max(30 - points, 0)} PTS FREE</StatusChip></div><div className="candidate-spacer" /><ActionButton disabled={busy || selected.size === 0} onClick={() => void plan()}>{busy ? "Planning…" : "Plan sprint"}</ActionButton><small>Capacity includes room for operating reserve.</small></> : <EmptyBlock>Create a planned sprint before assigning backlog work.</EmptyBlock>}
        </aside>
      </div>
    </div>
  );
}

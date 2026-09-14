import { useMemo } from "react";
import { getBoard, getSprints } from "../lib/api";
import { useResource } from "../lib/use-resource";
import type { RouteName, WorkspaceData } from "../types";
import { ActionButton, ErrorBlock, LoadingBlock, Panel, StatusChip, TicketRow } from "../components/ui";

export function DashboardPage({ workspace, navigate }: { workspace: WorkspaceData; navigate: (route: RouteName) => void }) {
  const board = useResource(() => getBoard(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const sprints = useResource(() => getSprints(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const tickets = useMemo(() => board.data?.flatMap((entry) => entry.tickets) ?? [], [board.data]);
  const active = sprints.data?.find((sprint) => sprint.state === "active");
  const done = board.data?.find((entry) => entry.column.category === "done")?.tickets.length ?? 0;
  const total = tickets.length;
  const completion = total ? Math.round(done / total * 100) : 0;
  const attention = tickets.filter((ticket) => ticket.priority === "high" || ticket.reviewState === "requested").slice(0, 3);

  if (board.loading || sprints.loading) return <LoadingBlock label="Loading sprint cockpit…" />;
  if (board.error || sprints.error) return <ErrorBlock message={board.error || sprints.error || "Could not load dashboard."} onRetry={() => { board.reload(); sprints.reload(); }} />;

  return (
    <div className="screen dashboard-screen">
      <header className="dashboard-topbar">
        <div><span className="eyebrow">{workspace.project.name.toUpperCase()} / {active?.name.toUpperCase() ?? "NO ACTIVE SPRINT"}</span><h1>Sprint cockpit</h1></div>
        <ActionButton onClick={() => navigate("board")}>New ticket</ActionButton>
      </header>
      <section className="focus-grid">
        <div className="focus-card dark-panel">
          <span className="eyebrow accent-text">TODAY · DELIVERY FOCUS</span>
          <h2>{attention.length ? "Unblock review before stand-up" : "Keep the course clear"}</h2>
          <p>{attention.length ? `${attention.length} high-signal ticket${attention.length === 1 ? "" : "s"} need a decision before the next handoff.` : "No high-priority or review-requested tickets are currently waiting."}</p>
          <div className="inline-actions"><StatusChip tone={attention.length ? "blocked" : "active"}>{attention.length} AT RISK</StatusChip><ActionButton onClick={() => navigate("board")}>Open board</ActionButton></div>
        </div>
        <Panel className="health-card">
          <span className="eyebrow">SPRINT HEALTH</span>
          <div className="big-metric">{completion}% <small>complete<br />{active ? active.name : "No active sprint"}</small></div>
          <div className="progress"><span style={{ width: `${completion}%` }} /></div>
          <p>{done} done · {Math.max(total - done, 0)} open · {attention.length} at risk</p>
        </Panel>
      </section>
      <section className="attention-section">
        <div className="section-heading"><h2>Needs attention</h2><p>Clear these before the next team handoff.</p></div>
        <div className="attention-grid">
          <div className="ticket-queue">
            {attention.length ? attention.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} status={ticket.reviewState === "requested" ? "IN REVIEW" : "AT RISK"} tone={ticket.reviewState === "requested" ? "active" : "blocked"} />) : <div className="state-block empty-state">Nothing needs immediate attention.</div>}
          </div>
          <Panel className="handoff-card"><h2>Review handoff</h2><strong className="accent-text">{attention.length} waiting</strong><p>1&nbsp; Check the highest-priority ticket</p><p>2&nbsp; Confirm the next reviewer</p><small>Live data refreshes with project events.</small><ActionButton onClick={() => navigate("board")}>Start review</ActionButton></Panel>
        </div>
      </section>
      <section className="snapshot-section">
        <div className="section-title-row"><h2>Board snapshot</h2><button type="button" onClick={() => navigate("board")}>OPEN FULL BOARD →</button></div>
        <div className="snapshot-grid">
          {(board.data ?? []).filter((entry) => entry.column.name.toLowerCase() !== "backlog").slice(0, 3).map((entry) => <Panel className="snapshot-column" key={entry.column.id}><div className="column-title"><strong>{entry.column.name}</strong><span>{String(entry.tickets.length).padStart(2, "0")}</span></div>{entry.tickets.slice(0, 2).map((ticket) => <div className="mini-ticket" key={ticket.id}>#{ticket.number}&nbsp; {ticket.title}<small>{ticket.assigneeId || "Unassigned"} · {ticket.points ?? 0} pts</small></div>)}</Panel>)}
        </div>
      </section>
    </div>
  );
}

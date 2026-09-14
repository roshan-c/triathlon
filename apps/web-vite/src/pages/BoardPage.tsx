import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import { createTicket, getBoard, getSprints, moveTicket } from "../lib/api";
import { useResource } from "../lib/use-resource";
import type { Ticket, WorkspaceData } from "../types";
import { ActionButton, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader, StatusChip } from "../components/ui";
import { initials } from "../lib/format";

export function BoardPage({ workspace }: { workspace: WorkspaceData }) {
  const board = useResource(() => getBoard(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const sprints = useResource(() => getSprints(workspace.project.id), [workspace.project.id, workspace.refreshKey]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [points, setPoints] = useState(3);
  const [priority, setPriority] = useState("medium");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = sprints.data?.find((sprint) => sprint.state === "active");
  const total = board.data?.reduce((sum, entry) => sum + entry.tickets.length, 0) ?? 0;
  const firstColumn = board.data?.[0]?.column;

  const visibleBoard = useMemo(() => (board.data ?? []).map((entry) => ({ ...entry, tickets: entry.tickets.filter((ticket) => `${ticket.number} ${ticket.title} ${ticket.assigneeId ?? ""}`.toLowerCase().includes(filter.toLowerCase())) })), [board.data, filter]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!firstColumn || !title.trim()) return;
    setBusy(true); setError(null);
    try {
      await createTicket(workspace.project.id, { title: title.trim(), descriptionMd: description.trim() || undefined, points, priority, columnId: firstColumn.id, assigneeId: assignee.trim() || undefined });
      setTitle(""); setDescription(""); setAssignee(""); workspace.refresh(); board.reload();
    } catch (unknownError) { setError(unknownError instanceof Error ? unknownError.message : "Could not add ticket."); }
    finally { setBusy(false); }
  };

  const drop = async (event: DragEvent, columnId: string) => {
    event.preventDefault();
    const ticketId = event.dataTransfer.getData("text/ticket-id");
    const ticket = board.data?.flatMap((entry) => entry.tickets).find((item) => item.id === ticketId);
    const target = board.data?.find((entry) => entry.column.id === columnId)?.column;
    if (!ticket || !target || ticket.columnId === target.id) return;
    setError(null);
    try { await moveTicket(workspace.project.id, ticket, target); workspace.refresh(); board.reload(); }
    catch (unknownError) { setError(unknownError instanceof Error ? unknownError.message : "Could not move ticket."); }
  };

  if (board.loading || sprints.loading) return <LoadingBlock label="Loading ticket board…" />;
  if (board.error || sprints.error) return <ErrorBlock message={board.error || sprints.error || "Could not load board."} onRetry={() => { board.reload(); sprints.reload(); }} />;

  return (
    <div className="screen board-screen">
      <PageHeader eyebrow="WORKFLOW / LIVE BOARD" title="Ticket board" description="Drag to move work. Drop tickets into the lane that reflects their current state." actions={<><StatusChip tone="active">{active?.name.toUpperCase() ?? "NO ACTIVE SPRINT"}</StatusChip><ActionButton onClick={() => document.getElementById("new-ticket-title")?.focus()}>New ticket</ActionButton></>} />
      <form className="board-controls panel" onSubmit={submit}>
        <input id="new-ticket-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title / What needs to be done?" required />
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description / Optional context" />
        <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Assignee / Any" aria-label="Assignee" />
        <input value={points} onChange={(event) => setPoints(Number(event.target.value))} type="number" min="0" max="100" aria-label="Points" />
        <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        <ActionButton type="submit" disabled={busy}>{busy ? "Adding…" : "Add ticket"}</ActionButton>
        <div className="filter-row"><span>SHOWING {total} TICKETS</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter tickets…" aria-label="Filter tickets" />{filter ? <button type="button" onClick={() => setFilter("")}>CLEAR FILTER</button> : null}</div>
      </form>
      {error ? <ErrorBlock message={error} /> : null}
      <div className="kanban" aria-label="Ticket board">
        {visibleBoard.map((entry) => <section className="kanban-column" key={entry.column.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void drop(event, entry.column.id)}><div className="column-title"><strong>{entry.column.name}</strong><span>{String(entry.tickets.length).padStart(2, "0")}</span></div><div className="ticket-stack">{entry.tickets.length ? entry.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />) : <EmptyBlock>Drop a ticket here.</EmptyBlock>}</div></section>)}
      </div>
      <div className="dependency-strip"><span><strong>Dependency pulse</strong><small>Move work between lanes to keep the delivery graph current.</small></span><StatusChip tone="blocked">LIVE BOARD</StatusChip><span>DRAG A TICKET INTO ANOTHER LANE →</span></div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const review = ticket.reviewState && ticket.reviewState !== "unreviewed" ? ticket.reviewState.replaceAll("_", " ") : ticket.priority || "medium";
  return <article className={`board-ticket priority-${ticket.priority || "medium"}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/ticket-id", ticket.id); }}><span>#{ticket.number} · {review.toUpperCase()}</span><strong>{ticket.title}</strong><small>{ticket.points ?? 0} pts · {ticket.assigneeId ? initials(ticket.assigneeId) : "Unassigned"}</small></article>;
}

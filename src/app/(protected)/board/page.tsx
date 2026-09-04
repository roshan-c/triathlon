"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  type CollisionDetection,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  useDroppable
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { PriorityBadge } from "@/components/priority-badge";
import { useAppContext } from "@/components/app-context";
import { EmptyState, PageHeader } from "@/components/ui";
import { cvx, Priority } from "@/lib/convex";

type ReviewStatus = "none" | "requested" | "approved" | "rejected";

type BoardTicket = {
  _id: string;
  number: number;
  title: string;
  description: string;
  storyPoints: number;
  priority: Priority;
  sprintId?: string | null;
  assigneeId?: string | null;
  labels: readonly string[];
  reviewStatus?: ReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  columnId: string;
  isClosed?: boolean;
};

type BoardColumn = {
  _id: string;
  name: string;
  position: number;
  tickets: readonly BoardTicket[];
};

type Board = {
  boardId: string;
  boardName: string;
  columns: readonly BoardColumn[];
};

type TicketComment = {
  _id: string;
  authorId: string;
  body: string;
  createdAt: number;
};

type TicketLink = {
  _id: string;
  fromTicketId: string;
  toTicketId: string;
};

type TicketDetail = {
  ticket: BoardTicket;
  comments: readonly TicketComment[];
  blockedBy: readonly TicketLink[];
  blocks: readonly TicketLink[];
  children: readonly TicketLink[];
  parents: readonly TicketLink[];
};

type DependencyGraph = {
  tickets: readonly BoardTicket[];
  links: readonly TicketLink[];
};

const ticketFirstCollision: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const ticketCollision = collisions.find((collision) => String(collision.id).startsWith("ticket:"));
  return ticketCollision ? [ticketCollision] : collisions;
};

function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status === "none") return null;
  const styles = {
    requested: "bg-[var(--warn-soft)] text-[var(--warn-text)]",
    approved: "bg-[var(--ok-soft)] text-[var(--ok-text)]",
    rejected: "bg-[var(--danger-soft)] text-[var(--danger-text)]"
  };
  const labels = {
    requested: "review",
    approved: "approved",
    rejected: "rejected"
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function TicketPreview({ ticket }: { ticket: BoardTicket }) {
  return (
    <div className="w-[280px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)]">
      <p className="tnum font-mono text-xs text-[var(--muted-foreground)]">#{ticket.number}</p>
      <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--foreground)]">{ticket.title}</p>
      <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span className="tnum font-mono">{ticket.storyPoints} pts</span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      {(ticket.reviewStatus ?? "none") !== "none" ? (
        <div className="mt-2">
          <ReviewBadge status={ticket.reviewStatus ?? "none"} />
        </div>
      ) : null}
    </div>
  );
}

function DraggableTicket({ ticket, onSelect }: { ticket: BoardTicket; onSelect: (ticketId: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
    isDragging
  } = useDraggable({
    id: ticket._id,
    data: {
      ticketId: ticket._id,
      columnId: ticket.columnId
    }
  });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `ticket:${ticket._id}`,
    data: {
      kind: "ticket",
      ticketId: ticket._id
    }
  });

  const setNodeRef = (node: HTMLButtonElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  };

  return (
    <button
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 25 : 1
      }}
      className={`group w-full rounded-lg border bg-[var(--surface)] p-3 text-left shadow-[var(--shadow-sm)] transition ${
        isDragging
          ? "opacity-40"
          : "opacity-100 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
      } ${
        isOver && !isDragging
          ? "border-[var(--accent)] ring-2 ring-[var(--ring)]"
          : "border-[var(--border)]"
      }`}
      onClick={() => onSelect(ticket._id)}
      {...listeners}
      {...attributes}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="tnum font-mono text-[11px] text-[var(--muted-foreground)]">#{ticket.number}</span>
        <div className="flex items-center gap-1.5">
          {ticket.isClosed ? (
            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-[var(--ok-soft)] text-[var(--ok-text)]">
              closed
            </span>
          ) : null}
          <ReviewBadge status={ticket.reviewStatus ?? "none"} />
        </div>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--foreground)]">{ticket.title}</p>
      <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span className="tnum font-mono">{ticket.storyPoints} pts</span>
        <PriorityBadge priority={ticket.priority} />
      </div>
    </button>
  );
}

function BoardColumn({ column, children }: { column: BoardColumn; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: column._id,
    data: { kind: "column", columnId: column._id }
  });

  return (
    <section
      ref={setNodeRef}
      className={`flex h-[64vh] min-w-[17rem] max-w-[22rem] flex-1 flex-col rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-sm)] transition-colors ${
        isOver ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">{column.name}</h2>
        <span className="tnum rounded-md bg-[var(--background-alt)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
          {column.tickets.length}
        </span>
      </header>
      <div className="thin-scroll flex flex-1 flex-col gap-2.5 overflow-auto border-t border-[var(--border)] px-3 py-3">
        {children}
      </div>
    </section>
  );
}

export default function BoardPage() {
  const { externalId, project } = useAppContext();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // SAFETY: tickets.board returns the board object with the columns and ticket
  // fields represented by the local view types below.
  const board = useQuery(cvx.tickets.board, {
    projectId: project.projectId,
    externalId
  }) as Board | null;

  const members = useQuery(cvx.projects.members, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  // SAFETY: tickets.dependencies returns the project ticket and blockedBy-link
  // arrays represented by DependencyGraph; loading returns undefined.
  const dependencyGraph = useQuery(cvx.tickets.dependencies, {
    projectId: project.projectId,
    externalId
  }) as DependencyGraph | undefined;

  const createTicket = useMutation(cvx.tickets.create);
  const moveTicket = useMutation(cvx.tickets.move);
  const updateTicket = useMutation(cvx.tickets.update);
  const deleteTicket = useMutation(cvx.tickets.remove);
  const attachTicketToSprint = useMutation(cvx.tickets.attachToSprint);
  const commentOnTicket = useMutation(cvx.tickets.comment);
  const toggleBlocks = useMutation(cvx.tickets.toggleBlocks);
  const requestReview = useMutation(cvx.tickets.requestReview);
  const approveReview = useMutation(cvx.tickets.approveReview);
  const rejectReview = useMutation(cvx.tickets.rejectReview);

  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDescription, setNewTicketDescription] = useState("");
  const [newTicketStoryPoints, setNewTicketStoryPoints] = useState(1);
  const [newTicketSprintId, setNewTicketSprintId] = useState("");
  const [newTicketAssigneeExternalId, setNewTicketAssigneeExternalId] = useState("");

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [activeDragTicketId, setActiveDragTicketId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [dependencyNotice, setDependencyNotice] = useState("");

  useEffect(() => {
    if (!selectedTicketId) {
      return;
    }

    setCommentBody("");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTicketId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTicketId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 6
      }
    })
  );

  const allTickets = useMemo(
    () =>
      board?.columns.flatMap((column) =>
        column.tickets.map((ticket) => ({
          ...ticket,
          columnId: column._id,
          isClosed: column.name.toLowerCase() === "done"
        }))
      ) ?? [],
    [board]
  );
  const columnFilter = searchParams.get("column") ?? "";
  const labelFilter = searchParams.get("label") ?? "";
  const assigneeFilter = searchParams.get("assignee") ?? "";
  const requestedStatus = searchParams.get("status") ?? "";
  const statusFilter = requestedStatus === "open" || requestedStatus === "closed" ? requestedStatus : "";

  const labelOptions = useMemo(
    () =>
      Array.from(new Set(["ready-for-agent", ...allTickets.flatMap((ticket) => ticket.labels)]))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [allTickets]
  );

  const filteredColumns = useMemo(
    () =>
      (board?.columns ?? [])
        .filter((column) => {
          if (columnFilter && column._id !== columnFilter) return false;
          const isDone = column.name.toLowerCase() === "done";
          if (statusFilter === "open" && isDone) return false;
          if (statusFilter === "closed" && !isDone) return false;
          return true;
        })
        .map((column) => ({
          ...column,
          tickets: column.tickets.filter((ticket) => {
            if (labelFilter && !ticket.labels.includes(labelFilter)) return false;
            if (assigneeFilter === "unassigned" && ticket.assigneeId) return false;
            if (assigneeFilter && assigneeFilter !== "unassigned") {
              const assignee = (members ?? []).find((member: any) => member.externalId === assigneeFilter);
              if (!assignee || ticket.assigneeId !== assignee.userId) return false;
            }
            return true;
          })
        })),
    [assigneeFilter, board?.columns, columnFilter, labelFilter, members, statusFilter]
  );

  const visibleTicketCount = filteredColumns.reduce((total, column) => total + column.tickets.length, 0);
  const hasFilters = Boolean(columnFilter || labelFilter || assigneeFilter || statusFilter);

  const setFilter = (name: "column" | "label" | "assignee" | "status", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("column");
    params.delete("label");
    params.delete("assignee");
    params.delete("status");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  const selectedTicket = allTickets.find((ticket) => ticket._id === selectedTicketId) ?? null;
  const activeDragTicket = allTickets.find((ticket) => ticket._id === activeDragTicketId) ?? null;

  // SAFETY: tickets.get validates and returns the TicketDetail shape defined
  // by convex/tickets.ts; a skipped or loading query returns undefined.
  const ticketDetail = useQuery(
    cvx.tickets.get,
    selectedTicketId
      ? {
          projectId: project.projectId,
          externalId,
          ticketId: selectedTicketId
        }
      : "skip"
  ) as TicketDetail | undefined;

  const detailedTicket = ticketDetail?.ticket ?? selectedTicket;
  const selectedColumn = board?.columns.find((column) => column._id === detailedTicket?.columnId);
  const isClosed = selectedColumn?.name.toLowerCase() === "done";

  const activity = useQuery(
    cvx.tickets.activity,
    selectedTicket
      ? {
          projectId: project.projectId,
          externalId,
          ticketId: selectedTicket._id
        }
      : "skip"
  );

  const onDragStart = (event: DragStartEvent) => {
    // SAFETY: DraggableTicket registers useDraggable data carrying ticketId.
    const ticketId = event.active.data.current?.ticketId as string | undefined;
    setActiveDragTicketId(ticketId ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    // SAFETY: DraggableTicket registers useDraggable data carrying columnId.
    const fromColumnId = event.active.data.current?.columnId as string | undefined;
    // SAFETY: DraggableTicket registers useDraggable data carrying ticketId.
    const ticketId = event.active.data.current?.ticketId as string | undefined;

    setActiveDragTicketId(null);

    if (event.over?.data.current?.kind === "ticket") {
      // SAFETY: ticket droppables always carry their ticketId in data.
      const targetTicketId = event.over.data.current.ticketId as string | undefined;
      if (!ticketId || !targetTicketId || ticketId === targetTicketId) return;

      // SAFETY: tickets.toggleBlocks returns the declared { active: boolean }
      // result indicating whether the edge exists after the atomic toggle.
      const result = (await toggleBlocks({
        projectId: project.projectId,
        externalId,
        blockerTicketId: ticketId,
        blockedTicketId: targetTicketId
      })) as { active: boolean };
      const blocker = allTickets.find((ticket) => ticket._id === ticketId);
      const blocked = allTickets.find((ticket) => ticket._id === targetTicketId);
      setDependencyNotice(
        result.active
          ? `#${blocker?.number ?? "?"} now blocks #${blocked?.number ?? "?"}.`
          : `#${blocker?.number ?? "?"} no longer blocks #${blocked?.number ?? "?"}.`
      );
      return;
    }

    // SAFETY: column droppables always carry their columnId in data.
    const toColumnId = event.over?.data.current?.columnId as string | undefined;

    if (!toColumnId || !fromColumnId || !ticketId || toColumnId === fromColumnId) {
      return;
    }

    try {
      await moveTicket({
        projectId: project.projectId,
        externalId,
        ticketId,
        toColumnId
      });
    } catch (error: any) {
      const code = error?.data?.code ?? error?.code;
      if (code === "REVIEW_REQUIRED") {
        window.alert("This ticket is awaiting review. Approve the review before moving to Done.");
      } else if (code === "REVIEW_REJECTED") {
        window.alert("This ticket was rejected in review. Re-request review or address feedback before moving to Done.");
      } else {
        throw error;
      }
    }
  };

  const submitNewTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!board || !newTicketTitle.trim()) {
      return;
    }

    await createTicket({
      projectId: project.projectId,
      externalId,
      columnId: board.columns[0]._id,
      title: newTicketTitle,
      description: newTicketDescription,
      storyPoints: Number.isFinite(newTicketStoryPoints) ? Math.max(0, newTicketStoryPoints) : 0,
      sprintId: newTicketSprintId || undefined,
      assigneeExternalId: newTicketAssigneeExternalId || undefined,
      priority: "medium",
      labels: []
    });

    setNewTicketTitle("");
    setNewTicketDescription("");
    setNewTicketStoryPoints(1);
    setNewTicketSprintId("");
    setNewTicketAssigneeExternalId("");
  };

  const deleteSelectedTicket = async () => {
    if (!selectedTicket) {
      return;
    }
    const confirmed = window.confirm("Delete this ticket permanently?");
    if (!confirmed) {
      return;
    }

    await deleteTicket({
      projectId: project.projectId,
      externalId,
      ticketId: selectedTicket._id
    });
    setSelectedTicketId(null);
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTicketId || !commentBody.trim()) return;
    await commentOnTicket({
      projectId: project.projectId,
      externalId,
      ticketId: selectedTicketId,
      body: commentBody
    });
    setCommentBody("");
  };

  if (!board) {
    return (
      <div className="space-y-8">
        <PageHeader title="Board" description="Drag tickets between columns. Drop one ticket onto another to link them as blocker and blocked." />
        <EmptyState>Loading board...</EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Board"
        description="Drag tickets between columns. Drop one ticket onto another to link them as blocker and blocked."
      />

      {/* New ticket */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
        <form onSubmit={submitNewTicket}>
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Title</label>
              <input
                value={newTicketTitle}
                onChange={(event) => setNewTicketTitle(event.target.value)}
                className="w-full text-sm"
                placeholder="What needs to be done?"
                required
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Description</label>
              <input
                value={newTicketDescription}
                onChange={(event) => setNewTicketDescription(event.target.value)}
                className="w-full text-sm"
                placeholder="Optional context"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Story points</label>
              <input
                value={newTicketStoryPoints}
                onChange={(event) => setNewTicketStoryPoints(Number(event.target.value || 0))}
                type="number"
                min={0}
                className="w-full text-sm"
                placeholder="0"
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Assignee</label>
              <select
                value={newTicketAssigneeExternalId}
                onChange={(event) => setNewTicketAssigneeExternalId(event.target.value)}
                className="w-full text-sm"
              >
                <option value="">Unassigned</option>
                {(members ?? []).map((member: any) => (
                  <option key={member.userId} value={member.externalId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Sprint</label>
              <select
                value={newTicketSprintId}
                onChange={(event) => setNewTicketSprintId(event.target.value)}
                className="w-full text-sm"
              >
                <option value="">No sprint</option>
                {(sprints ?? []).map((sprint: any) => (
                  <option key={sprint._id} value={sprint._id}>
                    {sprint.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end md:col-span-4">
              <button className="btn btn-primary w-full text-sm" type="submit">
                Add ticket
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Filters */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-sm)]" aria-label="Board filters">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--muted-foreground)]">
            Showing {visibleTicketCount} {visibleTicketCount === 1 ? "ticket" : "tickets"}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            Clear filters
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="filter-column" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Column</label>
            <select
              id="filter-column"
              aria-label="Filter by column"
              className="w-full text-sm"
              value={columnFilter}
              onChange={(event) => setFilter("column", event.target.value)}
            >
              <option value="">All columns</option>
              {board.columns.map((column) => (
                <option key={column._id} value={column._id}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-label" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Label</label>
            <select
              id="filter-label"
              aria-label="Filter by label"
              className="w-full text-sm"
              value={labelFilter}
              onChange={(event) => setFilter("label", event.target.value)}
            >
              <option value="">All labels</option>
              {labelOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-assignee" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Assignee</label>
            <select
              id="filter-assignee"
              aria-label="Filter by assignee"
              className="w-full text-sm"
              value={assigneeFilter}
              onChange={(event) => setFilter("assignee", event.target.value)}
            >
              <option value="">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {(members ?? []).map((member: any) => (
                <option key={member.userId} value={member.externalId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">State</label>
            <select
              id="filter-status"
              aria-label="Filter by state"
              className="w-full text-sm"
              value={statusFilter}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">Open and closed</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={ticketFirstCollision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDragTicketId(null)}
      >
        <section className="thin-scroll flex items-stretch gap-3 overflow-x-auto pb-3">
          {filteredColumns.map((column) => (
            <BoardColumn key={column._id} column={column}>
              {column.tickets.map((ticket) => (
                <DraggableTicket
                  key={ticket._id}
                  ticket={{
                    ...ticket,
                    columnId: column._id,
                    isClosed: column.name.toLowerCase() === "done"
                  }}
                  onSelect={setSelectedTicketId}
                />
              ))}
            </BoardColumn>
          ))}
          {filteredColumns.length === 0 ? (
            <EmptyState>No columns match these filters.</EmptyState>
          ) : null}
        </section>

        <DragOverlay>{activeDragTicket ? <TicketPreview ticket={activeDragTicket} /> : null}</DragOverlay>
      </DndContext>

      {dependencyNotice ? (
        <p className="text-xs text-[var(--accent-text)]" role="status" aria-live="polite">
          {dependencyNotice}
        </p>
      ) : null}

      {/* Dependency graph */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]" aria-labelledby="dependency-graph-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="dependency-graph-heading" className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Dependency graph
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Every ticket and its blocked-by edges across this project.</p>
          </div>
          <span className="tnum rounded-md bg-[var(--background-alt)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
            {dependencyGraph?.links.length ?? 0} {dependencyGraph?.links.length === 1 ? "edge" : "edges"}
          </span>
        </div>

        <div className="divide-y divide-[var(--border)] px-4">
          {dependencyGraph === undefined ? (
            <p className="py-6 text-sm text-[var(--muted-foreground)]">Loading dependencies...</p>
          ) : dependencyGraph.tickets.length === 0 ? (
            <p className="py-6 text-sm text-[var(--muted-foreground)]">No tickets in this project.</p>
          ) : (
            allTickets.map((ticket) => {
              const blockerIds = dependencyGraph.links
                .filter((link) => link.fromTicketId === ticket._id)
                .map((link) => link.toTicketId);
              const blockedIds = dependencyGraph.links
                .filter((link) => link.toTicketId === ticket._id)
                .map((link) => link.fromTicketId);

              return (
                <article key={ticket._id} className="grid gap-3 py-4 lg:grid-cols-[minmax(12rem,1fr)_1.2fr_1.2fr] lg:items-start">
                  <button type="button" className="flex items-baseline gap-2 text-left" onClick={() => setSelectedTicketId(ticket._id)}>
                    <span className="tnum shrink-0 font-mono text-xs text-[var(--muted-foreground)]">#{ticket.number}</span>
                    <span className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent-text)]">
                      {ticket.title}
                    </span>
                  </button>

                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Blocked by</p>
                    <div className="flex flex-wrap gap-1.5">
                      {blockerIds.length === 0 ? (
                        <span className="text-xs text-[var(--muted-foreground)]">None</span>
                      ) : (
                        blockerIds.map((blockerId) => {
                          const blocker = allTickets.find((candidate) => candidate._id === blockerId);
                          return blocker ? (
                            <button
                              key={blockerId}
                              type="button"
                              className={`rounded-md px-2 py-0.5 font-mono text-xs transition-colors ${
                                blocker.isClosed
                                  ? "bg-[var(--ok-soft)] text-[var(--ok-text)] hover:bg-[color-mix(in_srgb,var(--ok-soft)_80%,var(--ok)_20%)]"
                                  : "bg-[var(--danger-soft)] text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-soft)_80%,var(--danger)_20%)]"
                              }`}
                              onClick={() => setSelectedTicketId(blocker._id)}
                            >
                              #{blocker.number} {blocker.isClosed ? "closed" : "open"}
                            </button>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Blocks</p>
                    <div className="flex flex-wrap gap-1.5">
                      {blockedIds.length === 0 ? (
                        <span className="text-xs text-[var(--muted-foreground)]">None</span>
                      ) : (
                        blockedIds.map((blockedId) => {
                          const blocked = allTickets.find((candidate) => candidate._id === blockedId);
                          return blocked ? (
                            <button
                              key={blockedId}
                              type="button"
                              className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-xs text-[var(--accent-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-soft)_80%,var(--accent)_20%)]"
                              onClick={() => setSelectedTicketId(blocked._id)}
                            >
                              #{blocked.number}
                            </button>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {selectedTicket ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3"
          onClick={() => setSelectedTicketId(null)}
        >
          <section
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="tnum font-mono text-sm text-[var(--muted-foreground)]">#{selectedTicket.number}</span>
                <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">{selectedTicket.title}</h3>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    isClosed
                      ? "bg-[var(--ok-soft)] text-[var(--ok-text)]"
                      : "bg-[var(--background-alt)] text-[var(--muted-foreground)]"
                  }`}
                >
                  {isClosed ? "Closed" : "Open"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={deleteSelectedTicket}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedTicketId(null)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Title</span>
                <input
                  defaultValue={selectedTicket.title}
                  className="w-full"
                  onBlur={(event) =>
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      title: event.target.value
                    })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Story points</span>
                <input
                  defaultValue={selectedTicket.storyPoints}
                  type="number"
                  min={0}
                  className="w-full"
                  onBlur={(event) =>
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      storyPoints: Number(event.target.value || 0)
                    })
                  }
                />
              </label>

              <label className="block text-sm md:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Description</span>
                <textarea
                  defaultValue={selectedTicket.description}
                  className="min-h-24 w-full"
                  onBlur={(event) =>
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      description: event.target.value
                    })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Priority</span>
                <select
                  value={selectedTicket.priority}
                  className="w-full"
                  onChange={(event) =>
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      // SAFETY: the options in this select are exactly the
                      // Priority members low/medium/high.
                      priority: event.target.value as Priority
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Assignee</span>
                <select
                  value={selectedTicket.assigneeId ?? ""}
                  className="w-full"
                  onChange={(event) => {
                    const selectedUserId = event.target.value;
                    const selectedMember = (members ?? []).find((member: any) => member.userId === selectedUserId);
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      assigneeExternalId: selectedMember?.externalId ?? ""
                    });
                  }}
                >
                  <option value="">Unassigned</option>
                  {(members ?? []).map((member: any) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm md:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Labels</span>
                <input
                  key={`${selectedTicket._id}-${selectedTicket.labels.join(",")}`}
                  defaultValue={selectedTicket.labels.join(", ")}
                  className="w-full"
                  placeholder="ready-for-agent, frontend"
                  onBlur={(event) =>
                    void updateTicket({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      labels: event.target.value
                        .split(",")
                        .map((label) => label.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Sprint</span>
                <select
                  value={selectedTicket.sprintId ?? ""}
                  className="w-full"
                  onChange={(event) =>
                    void attachTicketToSprint({
                      projectId: project.projectId,
                      externalId,
                      ticketId: selectedTicket._id,
                      sprintId: event.target.value || undefined
                    })
                  }
                >
                  <option value="">No sprint</option>
                  {(sprints ?? []).map((sprint: any) => (
                    <option key={sprint._id} value={sprint._id}>
                      {sprint.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="text-sm">
                <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Review</p>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  {(selectedTicket.reviewStatus ?? "none") === "none" ? (
                    <button
                      type="button"
                      className="btn btn-primary w-full text-xs"
                      onClick={() =>
                        void requestReview({
                          projectId: project.projectId,
                          externalId,
                          ticketId: selectedTicket._id
                        })
                      }
                    >
                      Request review
                    </button>
                  ) : (selectedTicket.reviewStatus ?? "none") === "requested" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-sm flex-1 bg-[var(--ok-soft)] text-[var(--ok-text)] hover:bg-[color-mix(in_srgb,var(--ok-soft)_80%,var(--ok)_20%)]"
                        onClick={() =>
                          void approveReview({
                            projectId: project.projectId,
                            externalId,
                            ticketId: selectedTicket._id
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm flex-1 bg-[var(--danger-soft)] text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-soft)_80%,var(--danger)_20%)]"
                        onClick={() =>
                          void rejectReview({
                            projectId: project.projectId,
                            externalId,
                            ticketId: selectedTicket._id
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-[var(--foreground)]">
                        {(selectedTicket.reviewStatus ?? "none") === "approved" ? "Approved" : "Rejected"}
                      </p>
                      {selectedTicket.reviewedAt ? (
                        <p className="tnum text-xs text-[var(--muted-foreground)]">
                          {new Date(selectedTicket.reviewedAt).toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-sm">
                <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Recent activity</p>
                <div className="thin-scroll max-h-40 space-y-1.5 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                  {(activity ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">No movement yet.</p>
                  ) : (
                    (activity ?? []).map((item: any) => (
                      <p key={item._id} className="tnum text-xs text-[var(--muted-foreground)]">
                        Moved at {new Date(item.movedAt).toLocaleString()}
                      </p>
                    ))
                  )}
                </div>
              </div>

              <div className="text-sm md:col-span-2">
                <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Relationships</p>
                <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Blocked by</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(ticketDetail?.blockedBy ?? []).length === 0 ? (
                        <span className="text-xs text-[var(--muted-foreground)]">No open blockers.</span>
                      ) : (
                        (ticketDetail?.blockedBy ?? []).map((link) => {
                          const related = allTickets.find((ticket) => ticket._id === link.toTicketId);
                          return related ? (
                            <button
                              key={link._id}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedTicketId(related._id)}
                            >
                              <span className="tnum font-mono">#{related.number}</span> {related.title}
                            </button>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Blocks</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(ticketDetail?.blocks ?? []).length === 0 ? (
                        <span className="text-xs text-[var(--muted-foreground)]">No blocked tickets.</span>
                      ) : (
                        (ticketDetail?.blocks ?? []).map((link) => {
                          const related = allTickets.find((ticket) => ticket._id === link.fromTicketId);
                          return related ? (
                            <button
                              key={link._id}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedTicketId(related._id)}
                            >
                              <span className="tnum font-mono">#{related.number}</span> {related.title}
                            </button>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-sm md:col-span-2">
                <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Comments</p>
                <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  {(ticketDetail?.comments ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">No comments yet.</p>
                  ) : (
                    (ticketDetail?.comments ?? []).map((comment) => {
                      const author = (members ?? []).find(
                        (member: any) => member.userId === comment.authorId
                      );
                      return (
                        <article key={comment._id} className="rounded-lg bg-[var(--surface)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-[var(--foreground)]">
                              {author?.name ?? "Unknown member"}
                            </span>
                            <time className="tnum text-[var(--muted-foreground)]" dateTime={new Date(comment.createdAt).toISOString()}>
                              {new Date(comment.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                            {comment.body}
                          </p>
                        </article>
                      );
                    })
                  )}
                  <form className="flex gap-2" onSubmit={submitComment}>
                    <input
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      className="min-w-0 flex-1 text-sm"
                      placeholder="Add a comment"
                      aria-label="Comment"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary text-xs"
                      disabled={!commentBody.trim()}
                    >
                      Post
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
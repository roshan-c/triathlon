import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import type { ColumnConfig, Priority, ProjectSnapshot, Ticket } from "../../core/types.js";
import { displayActor, isAgentActor } from "../../core/types.js";
import { formatRelativeTime } from "../lib/api.js";
import {
  AgentGlyph,
  BlockedIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  FilterIcon,
  MoveArrowsIcon,
  PriorityGlyph,
  SearchIcon,
  WarningTriangleIcon,
} from "./Icons.js";

interface BoardViewProps {
  snapshot: ProjectSnapshot;
  onOpenTicket: (ticketId: string) => void;
  onNewTicket: (defaultStatus?: string) => void;
  onMoveTicket: (ticketId: string, toColumnId: string, rank?: number) => Promise<void>;
  onOpenSearch: () => void;
  onOpenMore: () => void;
  onOpenReview: (ticketId?: string) => void;
}

const pointerFirstCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

function shortenPath(fullPath: string): string {
  const homeMatch = fullPath.match(/^\/home\/[^/]+(\/.*)?$/) ?? fullPath.match(/^\/Users\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] ?? ""}` : fullPath;
}

function priorityLabel(p: Priority): string {
  if (p === "none") return "Not set";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function TicketCardContent({
  ticket,
  columnCategory,
  doneIds,
}: {
  ticket: Ticket;
  columnCategory: ColumnConfig["category"];
  doneIds: Set<string>;
}) {
  const activeBlockers = ticket.blockedBy.filter((id) => !doneIds.has(id));
  const checkDone = ticket.checklist.filter((c) => c.checked).length;
  const checkTotal = ticket.checklist.length;
  const isDone = columnCategory === "done";
  const isReview = columnCategory === "review";

  return (
    <div
      className="rounded-md border px-3.5 py-3 text-left transition-colors"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        opacity: isDone ? 0.86 : 1,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tabular-nums" style={{ color: "var(--ink-3)" }}>
          {ticket.id}
        </span>
        {isDone ? (
          <span style={{ color: "var(--done)" }} title="Completed">
            <CheckIcon size={14} />
          </span>
        ) : (
          <PriorityGlyph priority={ticket.priority} size={14} />
        )}
      </div>

      <div
        className="mb-2.5 text-[13px] font-semibold leading-[1.35]"
        style={{ color: isDone ? "var(--ink-2)" : "var(--ink)" }}
      >
        {ticket.title}
      </div>

      {activeBlockers.length > 0 && !isDone && (
        <div
          className="mb-2 flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          <BlockedIcon size={13} />
          <span>
            Blocked by {activeBlockers[0]}
            {activeBlockers.length > 1 ? ` +${activeBlockers.length - 1}` : ""}
          </span>
        </div>
      )}

      {isReview && (
        <div
          className="mb-2 flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          <ClockIcon size={13} />
          <span>Your review · {formatRelativeTime(ticket.review.requestedAt ?? ticket.updatedAt)}</span>
        </div>
      )}

      {checkTotal > 0 && !isDone && !isReview && (
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round((checkDone / checkTotal) * 100)}%`,
                background: "var(--ink)",
              }}
            />
          </div>
          <span className="text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {checkDone} of {checkTotal}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {isAgentActor(ticket.assignee) && <AgentGlyph size={13} className="shrink-0" />}
          <span className="truncate">
            {isDone && ticket.review.decidedBy
              ? `${displayActor(ticket.assignee)} · approved by you`
              : isDone
                ? `${displayActor(ticket.assignee)} · ${formatRelativeTime(ticket.updatedAt)} ago`
                : displayActor(ticket.assignee)}
          </span>
        </span>
        {ticket.estimate !== null && (
          <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-3)" }}>
            {ticket.estimate} pt
          </span>
        )}
      </div>
    </div>
  );
}

function SortableCard({
  ticket,
  columnCategory,
  doneIds,
  onOpenTicket,
}: {
  ticket: Ticket;
  columnCategory: ColumnConfig["category"];
  doneIds: Set<string>;
  onOpenTicket: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    data: { columnId: ticket.status, ticket },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transform ? transition : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        type="button"
        onClick={() => onOpenTicket(ticket.id)}
        className="block w-full rounded-md text-left"
      >
        <TicketCardContent ticket={ticket} columnCategory={columnCategory} doneIds={doneIds} />
      </button>
    </div>
  );
}

function BoardColumn({
  column,
  tickets,
  doneIds,
  onOpenTicket,
}: {
  column: ColumnConfig;
  tickets: Ticket[];
  doneIds: Set<string>;
  onOpenTicket: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}`, data: { columnId: column.id } });

  const overWip = column.wipLimit !== null && tickets.length > column.wipLimit;
  const collapseLimit = column.category === "backlog" || column.category === "done" ? 6 : 99;
  const visibleTickets = expanded ? tickets : tickets.slice(0, collapseLimit);
  const hiddenCount = tickets.length - visibleTickets.length;

  return (
    <section
      ref={setNodeRef}
      className="flex min-w-[248px] flex-1 flex-col"
      aria-label={column.name}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
            {column.name}
          </h2>
          {column.wipLimit === null && (
            <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
              {tickets.length}
            </span>
          )}
        </div>
        {column.wipLimit !== null && (
          <span
            className="flex items-center gap-1 text-[12px] font-medium tabular-nums"
            style={{ color: overWip ? "var(--accent)" : "var(--ink-3)" }}
          >
            {overWip && <WarningTriangleIcon size={13} />}
            <span>
              {tickets.length} of {column.wipLimit} limit
            </span>
          </span>
        )}
      </div>

      <div
        className="mb-3 w-full"
        style={{
          height: overWip ? "2px" : "1px",
          background: overWip ? "var(--accent)" : "var(--border)",
        }}
      />

      <SortableContext items={visibleTickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          className="flex min-h-[120px] flex-1 flex-col gap-2.5 rounded-md pb-6 transition-colors"
          style={{ background: isOver ? "var(--bg-hover)" : "transparent" }}
        >
          {visibleTickets.map((ticket) => (
            <SortableCard
              key={ticket.id}
              ticket={ticket}
              columnCategory={column.category}
              doneIds={doneIds}
              onOpenTicket={onOpenTicket}
            />
          ))}

          {tickets.length === 0 && (
            <div className="py-6 text-center text-[12px]" style={{ color: "var(--ink-3)" }}>
              No tickets
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 px-1 text-left text-[12px] hover:underline"
              style={{ color: "var(--ink-3)" }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export function BoardView({
  snapshot,
  onOpenTicket,
  onNewTicket,
  onMoveTicket,
  onOpenSearch,
  onOpenMore,
  onOpenReview,
}: BoardViewProps) {
  const activeCycle = snapshot.cycles.find((c) => c.state === "active") ?? null;
  const defaultMobileCol =
    snapshot.config.columns.find((c) => c.category === "started")?.id ?? snapshot.config.columns[0].id;

  const [cycleFilter, setCycleFilter] = useState<string>(activeCycle ? activeCycle.id : "all");
  const [priorityFilter, setPriorityFilter] = useState<string>("any");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("any");
  const [labelFilter, setLabelFilter] = useState<string>("any");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mobileColId, setMobileColId] = useState<string>(defaultMobileCol);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [movingTicket, setMovingTicket] = useState<Ticket | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const acceptedTickets = useMemo(
    () => snapshot.tickets.filter((t) => t.triage === "accepted"),
    [snapshot.tickets],
  );

  const doneColIds = useMemo(
    () => new Set(snapshot.config.columns.filter((c) => c.category === "done").map((c) => c.id)),
    [snapshot.config.columns],
  );
  const doneIds = useMemo(
    () => new Set(acceptedTickets.filter((t) => doneColIds.has(t.status)).map((t) => t.id)),
    [acceptedTickets, doneColIds],
  );
  const backlogColIds = useMemo(
    () => new Set(snapshot.config.columns.filter((c) => c.category === "backlog").map((c) => c.id)),
    [snapshot.config.columns],
  );

  const allAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of acceptedTickets) if (t.assignee) set.add(t.assignee);
    return [...set].sort();
  }, [acceptedTickets]);

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of acceptedTickets) for (const l of t.labels) set.add(l);
    return [...set].sort();
  }, [acceptedTickets]);

  const filteredTickets = useMemo(() => {
    return acceptedTickets.filter((t) => {
      if (cycleFilter !== "all") {
        const inSelectedCycle = t.cycleId === cycleFilter;
        const inBacklog = backlogColIds.has(t.status) && t.cycleId === null;
        if (!inSelectedCycle && !inBacklog) return false;
      }
      if (priorityFilter !== "any" && t.priority !== (priorityFilter as Priority)) return false;
      if (assigneeFilter !== "any") {
        if (assigneeFilter === "unassigned" && t.assignee !== null) return false;
        if (assigneeFilter === "agents" && !isAgentActor(t.assignee)) return false;
        if (assigneeFilter !== "unassigned" && assigneeFilter !== "agents" && t.assignee !== assigneeFilter) {
          return false;
        }
      }
      if (labelFilter !== "any" && !t.labels.includes(labelFilter)) return false;
      return true;
    });
  }, [acceptedTickets, cycleFilter, priorityFilter, assigneeFilter, labelFilter, backlogColIds]);

  const ticketsByColumn = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const col of snapshot.config.columns) map.set(col.id, []);
    for (const t of filteredTickets) {
      const list = map.get(t.status) ?? map.get(snapshot.config.columns[0].id);
      list?.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id, undefined, { numeric: true }));
    }
    return map;
  }, [filteredTickets, snapshot.config.columns]);

  const cycleStats = useMemo(() => {
    if (!activeCycle) return null;
    const cycleTickets = acceptedTickets.filter((t) => t.cycleId === activeCycle.id);
    const totalPts = cycleTickets.reduce((s, t) => s + (t.estimate ?? 0), 0);
    const donePts = cycleTickets
      .filter((t) => doneColIds.has(t.status))
      .reduce((s, t) => s + (t.estimate ?? 0), 0);
    const startMs = Date.parse(`${activeCycle.startDate}T00:00:00.000Z`);
    const endMs = Date.parse(`${activeCycle.endDate}T00:00:00.000Z`);
    const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
    const dayNum = Math.min(totalDays, Math.max(1, Math.ceil((Date.now() - startMs) / 86_400_000)));
    return { totalPts, donePts, totalDays, dayNum };
  }, [activeCycle, acceptedTickets, doneColIds]);

  const draggingTicket = draggingId ? acceptedTickets.find((t) => t.id === draggingId) ?? null : null;

  const handleDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;

    const ticketId = String(active.id);
    const overId = String(over.id);
    const dragged = acceptedTickets.find((t) => t.id === ticketId);
    if (!dragged) return;

    let targetColumnId: string;
    let targetRank: number | undefined;

    if (overId.startsWith("col:")) {
      targetColumnId = overId.slice(4);
    } else {
      const overTicket = acceptedTickets.find((t) => t.id === overId);
      if (!overTicket || overTicket.id === ticketId) return;
      targetColumnId = overTicket.status;
      const fullCol = ticketsByColumn.get(targetColumnId) ?? [];
      const activeIdx = fullCol.findIndex((t) => t.id === ticketId);
      const colWithoutDragged = fullCol.filter((t) => t.id !== ticketId);
      const overIdx = colWithoutDragged.findIndex((t) => t.id === overId);

      if (overIdx >= 0) {
        const movingDownSameCol = dragged.status === targetColumnId && activeIdx >= 0 && activeIdx <= overIdx;
        if (movingDownSameCol) {
          const curr = colWithoutDragged[overIdx];
          const next = colWithoutDragged[overIdx + 1];
          targetRank = next ? (curr.rank + next.rank) / 2 : curr.rank + 1000;
        } else {
          const prev = colWithoutDragged[overIdx - 1];
          const curr = colWithoutDragged[overIdx];
          targetRank = prev ? (prev.rank + curr.rank) / 2 : curr.rank - 500;
        }
      }
    }

    if (dragged.status === targetColumnId && targetRank === undefined) return;
    void onMoveTicket(ticketId, targetColumnId, targetRank);
  };

  const selectedCycleObj = snapshot.cycles.find((c) => c.id === cycleFilter);
  const activeMobileCol =
    snapshot.config.columns.find((c) => c.id === mobileColId) ?? snapshot.config.columns[0];
  const mobileColTickets = ticketsByColumn.get(activeMobileCol.id) ?? [];
  const mobileOverWip =
    activeMobileCol.wipLimit !== null && mobileColTickets.length > activeMobileCol.wipLimit;
  const mobileAtWip =
    activeMobileCol.wipLimit !== null && mobileColTickets.length === activeMobileCol.wipLimit;
  const activeFilterCount =
    (priorityFilter !== "any" ? 1 : 0) +
    (assigneeFilter !== "any" ? 1 : 0) +
    (labelFilter !== "any" ? 1 : 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ================= MOBILE BOARD (< md) ================= */}
      <div className="flex h-full flex-col overflow-hidden md:hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between gap-3 px-4 pt-3 pb-2.5"
          style={{ background: "var(--bg-sidebar)" }}
        >
          <button
            type="button"
            onClick={onOpenMore}
            className="min-w-0 py-1 text-left"
          >
            <div className="flex items-center gap-1 text-[17px] font-bold leading-tight tracking-tight">
              <span className="truncate">{snapshot.config.name}</span>
              <ChevronDownIcon size={15} className="shrink-0 opacity-70" />
            </div>
            <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
              {shortenPath(snapshot.path)}
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Search tickets"
              className="flex h-11 w-11 items-center justify-center rounded-md"
              style={{ color: "var(--ink)" }}
            >
              <SearchIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => onNewTicket(activeMobileCol.id)}
              className="min-h-[38px] rounded-lg px-3.5 py-2 text-[14px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              + New
            </button>
          </div>
        </header>

        {/* Compact Cycle pulse */}
        {activeCycle && cycleStats && (
          <div
            className="border-b px-4 pt-1 pb-3"
            style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
          >
            <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
              <span>
                <strong className="font-semibold">Cycle {activeCycle.number}</strong>
                <span style={{ color: "var(--ink-2)" }}>
                  {" "}
                  · day {cycleStats.dayNum} of {cycleStats.totalDays}
                </span>
              </span>
              <span className="tabular-nums">
                <strong className="font-semibold">{cycleStats.donePts}</strong>
                <span style={{ color: "var(--ink-2)" }}>/{cycleStats.totalPts} pts</span>
              </span>
            </div>
            <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${cycleStats.totalPts > 0 ? Math.round((cycleStats.donePts / cycleStats.totalPts) * 100) : 0}%`,
                  background: "var(--ink)",
                }}
              />
            </div>
          </div>
        )}

        {/* Ticket count + Filter trigger */}
        <div className="flex items-center justify-between px-4 py-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
          <span className="tabular-nums">
            {filteredTickets.length} ticket{filteredTickets.length === 1 ? "" : "s"}
            {selectedCycleObj ? ` · cycle ${selectedCycleObj.number} and backlog` : ""}
          </span>
          <button
            type="button"
            onClick={() => setMobileFilterOpen(true)}
            className="flex min-h-[40px] items-center gap-1.5 px-1 font-medium"
            style={{ color: activeFilterCount > 0 ? "var(--accent)" : "var(--ink)" }}
          >
            <FilterIcon size={15} />
            <span>Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</span>
          </button>
        </div>

        {/* Horizontal scrollable column tab strip */}
        <div
          className="no-scrollbar flex shrink-0 items-stretch gap-5 overflow-x-auto border-b px-4"
          style={{ borderColor: "var(--border)" }}
          role="tablist"
          aria-label="Board columns"
        >
          {snapshot.config.columns.map((col) => {
            const count = (ticketsByColumn.get(col.id) ?? []).length;
            const active = col.id === activeMobileCol.id;
            const over = col.wipLimit !== null && count > col.wipLimit;
            return (
              <button
                key={col.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMobileColId(col.id)}
                className="relative flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap pb-2 text-[14px]"
                style={{
                  color: active ? "var(--ink)" : "var(--ink-2)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span>{col.name}</span>
                {over && (
                  <span style={{ color: "var(--accent)" }}>
                    <WarningTriangleIcon size={13} />
                  </span>
                )}
                <span
                  className="text-[13px] tabular-nums"
                  style={{ color: over ? "var(--accent)" : "var(--ink-3)", fontWeight: over ? 600 : 400 }}
                >
                  {col.wipLimit !== null ? `${count}/${col.wipLimit}` : count}
                </span>
                {active && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[2px]"
                    style={{ background: "var(--accent)" }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Active column card list */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
          {/* WIP note */}
          {(mobileOverWip || mobileAtWip) && activeMobileCol.wipLimit !== null && (
            <div className="mb-3 flex items-center gap-1.5 text-[13px]">
              {mobileOverWip && (
                <span style={{ color: "var(--accent)" }}>
                  <WarningTriangleIcon size={14} />
                </span>
              )}
              <span
                className="font-semibold tabular-nums"
                style={{ color: mobileOverWip ? "var(--accent)" : "var(--ink)" }}
              >
                {mobileColTickets.length} of {activeMobileCol.wipLimit} limit.
              </span>
              <span style={{ color: "var(--ink-2)" }}>
                {mobileOverWip
                  ? "Finish one before starting another."
                  : activeMobileCol.category === "review"
                    ? "Waiting on your review."
                    : "Column at capacity."}
              </span>
            </div>
          )}

          {mobileColTickets.length === 0 ? (
            <div className="py-12 text-center text-[13px]" style={{ color: "var(--ink-3)" }}>
              No tickets in {activeMobileCol.name}.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {mobileColTickets.map((ticket) => {
                const checkDone = ticket.checklist.filter((c) => c.checked).length;
                const checkTotal = ticket.checklist.length;
                const isReview = activeMobileCol.category === "review";
                const isDone = activeMobileCol.category === "done";
                const activeBlockers = ticket.blockedBy.filter((id) => !doneIds.has(id));
                const failedChecks = (ticket.review.checks ?? []).filter((c) => c.status === "fail").length;

                return (
                  <article
                    key={ticket.id}
                    className="rounded-lg border px-4 py-3.5"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                  >
                    <button
                      type="button"
                      onClick={() => (isReview ? onOpenReview(ticket.id) : onOpenTicket(ticket.id))}
                      className="block w-full text-left"
                    >
                      {/* Top meta row */}
                      <div className="mb-1.5 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                        {isDone ? (
                          <span style={{ color: "var(--done)" }}>
                            <CheckIcon size={14} />
                          </span>
                        ) : (
                          <PriorityGlyph priority={ticket.priority} size={14} />
                        )}
                        <span className="tabular-nums">{ticket.id}</span>
                        <span>·</span>
                        <span>{priorityLabel(ticket.priority)}</span>
                        {isReview && ticket.assignee && (
                          <>
                            <span className="ml-1 inline-flex items-center gap-1">
                              {isAgentActor(ticket.assignee) && <AgentGlyph size={12} />}
                              <span>{displayActor(ticket.assignee)}</span>
                            </span>
                            {ticket.estimate !== null && (
                              <>
                                <span>·</span>
                                <span className="tabular-nums">{ticket.estimate} pt</span>
                              </>
                            )}
                          </>
                        )}
                      </div>

                      {/* Title */}
                      <h3
                        className="m-0 mb-2.5 text-[16px] font-semibold leading-snug"
                        style={{ color: isDone ? "var(--ink-2)" : "var(--ink)" }}
                      >
                        {ticket.title}
                      </h3>

                      {activeBlockers.length > 0 && !isDone && (
                        <div
                          className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium"
                          style={{ color: "var(--accent)" }}
                        >
                          <BlockedIcon size={14} />
                          <span>Blocked by {activeBlockers[0]}</span>
                        </div>
                      )}

                      {checkTotal > 0 && !isDone && !isReview && (
                        <div className="mb-2.5 flex items-center gap-2.5">
                          <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round((checkDone / checkTotal) * 100)}%`,
                                background: "var(--ink)",
                              }}
                            />
                          </div>
                          <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                            {checkDone} of {checkTotal}
                          </span>
                        </div>
                      )}
                    </button>

                    {/* Card footer with 44px hit-area Move / Review button */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      {isReview ? (
                        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
                          <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--accent)" }}>
                            <ClockIcon size={14} />
                            <span>
                              Your review · {formatRelativeTime(ticket.review.requestedAt ?? ticket.updatedAt)}
                            </span>
                          </span>
                          {failedChecks > 0 && (
                            <span className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                              · {failedChecks} failed
                            </span>
                          )}
                        </div>
                      ) : (
                        <div
                          className="flex min-w-0 items-center gap-1.5 truncate text-[13px]"
                          style={{ color: "var(--ink-2)" }}
                        >
                          {isAgentActor(ticket.assignee) && <AgentGlyph size={14} className="shrink-0" />}
                          <span className="truncate">
                            {displayActor(ticket.assignee)}
                            {isAgentActor(ticket.assignee) && activeMobileCol.category === "started" ? " · working" : ""}
                            {ticket.estimate !== null ? ` · ${ticket.estimate} pt` : ""}
                          </span>
                        </div>
                      )}

                      {isReview ? (
                        <button
                          type="button"
                          onClick={() => onOpenReview(ticket.id)}
                          className="-mr-2 flex min-h-[44px] shrink-0 items-center gap-1 px-2 text-[13px] font-semibold"
                          style={{ color: "var(--ink)" }}
                        >
                          <span>Review</span>
                          <ChevronRightIcon size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setMovingTicket(ticket)}
                          className="-mr-2 flex min-h-[44px] shrink-0 items-center gap-1.5 px-2 text-[13px] font-semibold"
                          style={{ color: "var(--ink)" }}
                        >
                          <MoveArrowsIcon size={14} />
                          <span>Move</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Mobile Move Column Sheet */}
        {movingTicket && (
          <div
            className="fixed inset-0 z-50 flex items-end"
            style={{ background: "var(--scrim)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setMovingTicket(null);
            }}
          >
            <div
              className="pb-safe w-full rounded-t-2xl border-t px-5 pt-3 shadow-2xl"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
              role="dialog"
              aria-modal="true"
              aria-label={`Move ${movingTicket.id}`}
            >
              <div className="mx-auto mb-3 h-1 w-9 rounded-full" style={{ background: "var(--border-strong)" }} />
              <div className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                Move {movingTicket.id}
              </div>
              <div className="mb-3 truncate text-[15px] font-semibold">{movingTicket.title}</div>
              <div className="divide-y border-t" style={{ borderColor: "var(--border)" }}>
                {snapshot.config.columns.map((col) => {
                  const isCurrent = col.id === movingTicket.status;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={async () => {
                        const t = movingTicket;
                        setMovingTicket(null);
                        if (!isCurrent) {
                          await onMoveTicket(t.id, col.id);
                          setMobileColId(col.id);
                        }
                      }}
                      className="flex min-h-[48px] w-full items-center justify-between text-left text-[15px]"
                      style={{
                        borderColor: "var(--border)",
                        color: isCurrent ? "var(--accent)" : "var(--ink)",
                        fontWeight: isCurrent ? 600 : 400,
                      }}
                    >
                      <span>{col.name}</span>
                      {isCurrent && <CheckIcon size={16} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Mobile Filter Sheet */}
        {mobileFilterOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end"
            style={{ background: "var(--scrim)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileFilterOpen(false);
            }}
          >
            <div
              className="pb-safe w-full rounded-t-2xl border-t px-5 pt-3 shadow-2xl"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
              role="dialog"
              aria-modal="true"
              aria-label="Filter tickets"
            >
              <div className="mx-auto mb-3 h-1 w-9 rounded-full" style={{ background: "var(--border-strong)" }} />
              <div className="mb-4 flex items-center justify-between">
                <h2 className="m-0 text-[16px] font-bold">Filter board</h2>
                <button
                  type="button"
                  onClick={() => setMobileFilterOpen(false)}
                  aria-label="Close filters"
                  className="flex h-10 w-10 items-center justify-center"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-4 pb-4">
                <label className="block">
                  <div className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    Cycle
                  </div>
                  <select
                    value={cycleFilter}
                    onChange={(e) => setCycleFilter(e.target.value)}
                    className="w-full rounded-md border px-3 py-2.5"
                    style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                  >
                    <option value="all">All cycles</option>
                    {snapshot.cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        Cycle {c.number} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    Priority
                  </div>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full rounded-md border px-3 py-2.5"
                    style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                  >
                    <option value="any">Any priority</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="none">Not set</option>
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    Assignee
                  </div>
                  <select
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="w-full rounded-md border px-3 py-2.5"
                    style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                  >
                    <option value="any">Anyone</option>
                    <option value="agents">Agents</option>
                    <option value="unassigned">Unassigned</option>
                    {allAssignees.map((a) => (
                      <option key={a} value={a}>
                        {displayActor(a)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    Label
                  </div>
                  <select
                    value={labelFilter}
                    onChange={(e) => setLabelFilter(e.target.value)}
                    className="w-full rounded-md border px-3 py-2.5"
                    style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                  >
                    <option value="any">Any label</option>
                    {allLabels.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPriorityFilter("any");
                      setAssigneeFilter("any");
                      setLabelFilter("any");
                    }}
                    className="min-h-[44px] px-2 text-[14px]"
                    style={{ color: "var(--ink-2)" }}
                  >
                    Reset filters
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileFilterOpen(false)}
                    className="min-h-[44px] rounded-lg px-5 text-[14px] font-semibold"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= DESKTOP BOARD (>= md) ================= */}
      <div className="hidden h-full flex-col overflow-hidden md:flex">
        <header className="flex items-center justify-between gap-6 px-7 pt-5 pb-4">
          <div className="min-w-0">
            <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              {snapshot.config.name}
            </div>
            <h1 className="m-0 text-[24px] font-bold tracking-tight">Board</h1>
          </div>

          <div className="flex items-center gap-4">
            {activeCycle && cycleStats && (
              <div className="hidden min-w-[200px] lg:block">
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>
                    Cycle {activeCycle.number} · {activeCycle.name}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>
                    day {cycleStats.dayNum} of {cycleStats.totalDays}
                  </span>
                </div>
                <div className="my-1.5 h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${cycleStats.totalPts > 0 ? Math.round((cycleStats.donePts / cycleStats.totalPts) * 100) : 0}%`,
                      background: "var(--ink)",
                    }}
                  />
                </div>
                <div className="text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                  {cycleStats.donePts} of {cycleStats.totalPts} points done
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenSearch}
              className="flex items-center justify-between gap-6 rounded-md border px-3 py-1.5 text-[12px]"
              style={{
                background: "var(--bg-card)",
                borderColor: "var(--border-strong)",
                color: "var(--ink-3)",
              }}
            >
              <span className="flex items-center gap-2">
                <SearchIcon size={13} />
                <span>Search or jump to…</span>
              </span>
              <kbd className="font-sans text-[11px]" style={{ color: "var(--ink-3)" }}>
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => onNewTicket()}
              className="rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              + New ticket
            </button>
          </div>
        </header>

        <div
          className="flex flex-wrap items-center justify-between gap-4 border-y px-7 py-2.5 text-[12px]"
          style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
        >
          <div className="flex flex-wrap items-center gap-5">
            <span className="tabular-nums">
              {filteredTickets.length} ticket{filteredTickets.length === 1 ? "" : "s"}
              {selectedCycleObj ? ` in cycle ${selectedCycleObj.number} and backlog` : ""}
            </span>

            <label className="flex items-center gap-1.5">
              <span style={{ color: "var(--ink-3)" }}>Cycle</span>
              <select
                value={cycleFilter}
                onChange={(e) => setCycleFilter(e.target.value)}
                className="bg-transparent font-semibold"
                style={{ color: "var(--ink)" }}
              >
                <option value="all">All</option>
                {snapshot.cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number} · {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span style={{ color: "var(--ink-3)" }}>Priority</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="bg-transparent font-semibold"
                style={{ color: "var(--ink)" }}
              >
                <option value="any">Any</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">Not set</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span style={{ color: "var(--ink-3)" }}>Assignee</span>
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="bg-transparent font-semibold"
                style={{ color: "var(--ink)" }}
              >
                <option value="any">Anyone</option>
                <option value="agents">Agents</option>
                <option value="unassigned">Unassigned</option>
                {allAssignees.map((a) => (
                  <option key={a} value={a}>
                    {displayActor(a)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span style={{ color: "var(--ink-3)" }}>Label</span>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className="bg-transparent font-semibold"
                style={{ color: "var(--ink)" }}
              >
                <option value="any">Any</option>
                {allLabels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--done)" }}
              aria-hidden="true"
            />
            <span>
              {snapshot.lastEventAt
                ? `Synced from events.jsonl ${formatRelativeTime(snapshot.lastEventAt)} ago`
                : "Watching .triathlon/"}
            </span>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerFirstCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 gap-5 overflow-x-auto px-7 pt-5">
            {snapshot.config.columns.map((col) => (
              <BoardColumn
                key={col.id}
                column={col}
                tickets={ticketsByColumn.get(col.id) ?? []}
                doneIds={doneIds}
                onOpenTicket={onOpenTicket}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingTicket ? (
              <div className="w-[260px] shadow-xl">
                <TicketCardContent
                  ticket={draggingTicket}
                  columnCategory={
                    snapshot.config.columns.find((c) => c.id === draggingTicket.status)?.category ?? "todo"
                  }
                  doneIds={doneIds}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

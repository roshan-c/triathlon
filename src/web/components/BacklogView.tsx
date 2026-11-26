import { useEffect, useMemo, useState } from "react";
import type { Priority, ProjectSnapshot, Ticket } from "../../core/types.js";
import { displayActor, isAgentActor } from "../../core/types.js";
import { api, formatRelativeTime } from "../lib/api.js";
import { AgentGlyph, CheckIcon, PlusIcon, PriorityGlyph, SearchIcon } from "./Icons.js";

const PRIO_ORDER: Record<Priority, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };

interface BacklogViewProps {
  snapshot: ProjectSnapshot;
  onOpenTicket: (ticketId: string) => void;
  onNewTicket: (defaultStatus?: string) => void;
  onOpenSearch: () => void;
  onRefresh: () => Promise<void>;
}

export function BacklogView({
  snapshot,
  onOpenTicket,
  onNewTicket,
  onOpenSearch,
  onRefresh,
}: BacklogViewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [undoProposal, setUndoProposal] = useState<Ticket | null>(null);

  const backlogColIds = useMemo(
    () => new Set(snapshot.config.columns.filter((c) => c.category === "backlog").map((c) => c.id)),
    [snapshot.config.columns],
  );
  const todoCol = useMemo(
    () => snapshot.config.columns.find((c) => c.category === "todo") ?? snapshot.config.columns[0],
    [snapshot.config.columns],
  );
  const activeCycle =
    snapshot.cycles.find((c) => c.state === "active") ??
    snapshot.cycles.find((c) => c.state === "planned") ??
    null;

  const triageTickets = useMemo(
    () =>
      snapshot.tickets
        .filter((t) => t.triage === "proposed")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.tickets],
  );

  const readyBacklog = useMemo(
    () =>
      snapshot.tickets
        .filter((t) => t.triage === "accepted" && backlogColIds.has(t.status))
        .sort(
          (a, b) =>
            PRIO_ORDER[b.priority] - PRIO_ORDER[a.priority] ||
            a.rank - b.rank ||
            a.id.localeCompare(b.id, undefined, { numeric: true }),
        ),
    [snapshot.tickets, backlogColIds],
  );

  const flatList = useMemo(() => [...triageTickets, ...readyBacklog], [triageTickets, readyBacklog]);
  const readyPoints = readyBacklog.reduce((s, t) => s + (t.estimate ?? 0), 0);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (!flatList.length) return;
      if (e.key === "j" || e.key === "J") {
        setFocusedIndex((i) => Math.min(flatList.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "K") {
        setFocusedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "x" || e.key === "X") {
        const curr = flatList[focusedIndex];
        if (curr) toggleSelect(curr.id);
      } else if (e.key === "Enter") {
        const curr = flatList[focusedIndex];
        if (curr) onOpenTicket(curr.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatList, focusedIndex, onOpenTicket]);

  const bulkAction = async (fn: (id: string) => Promise<unknown>) => {
    if (!selectedIds.size) return;
    setBusy(true);
    try {
      for (const id of selectedIds) await fn(id);
      setSelectedIds(new Set());
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDismissProposal = async (ticket: Ticket) => {
    setBusy(true);
    try {
      await api.dismissTriage(snapshot.projectId, ticket.id);
      setUndoProposal(ticket);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleUndoDismiss = async () => {
    if (!undoProposal) return;
    const restore = undoProposal;
    setUndoProposal(null);
    setBusy(true);
    try {
      await api.createTicket(snapshot.projectId, {
        title: restore.title,
        description: restore.description,
        priority: restore.priority,
        estimate: restore.estimate,
        labels: restore.labels,
        proposed: true,
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleAddToCycle = async (ticket: Ticket) => {
    setBusy(true);
    try {
      if (activeCycle) {
        await api.updateTicket(snapshot.projectId, ticket.id, { cycleId: activeCycle.id });
      }
      await api.moveTicket(snapshot.projectId, ticket.id, todoCol.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const renderDesktopRow = (ticket: Ticket, idx: number, isProposal: boolean) => {
    const isSelected = selectedIds.has(ticket.id);
    const isFocused = focusedIndex === idx;
    return (
      <div
        key={ticket.id}
        onClick={() => setFocusedIndex(idx)}
        className="grid grid-cols-[32px_28px_72px_1fr_150px_140px_64px_76px] items-center gap-2 border-b px-7 py-3 text-[13px] transition-colors"
        style={{
          borderColor: "var(--border)",
          background: isSelected ? "var(--bg-row-selected)" : isFocused ? "var(--bg-hover)" : "transparent",
        }}
      >
        <div>
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`Select ${ticket.id}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect(ticket.id);
            }}
            className="flex h-4 w-4 items-center justify-center rounded-[3px] border"
            style={{
              background: isSelected ? "var(--ink)" : "transparent",
              borderColor: isSelected ? "var(--ink)" : "var(--border-input)",
              color: "var(--bg-card)",
              opacity: isSelected || isFocused ? 1 : 0.55,
            }}
          >
            {isSelected && <CheckIcon size={11} />}
          </button>
        </div>
        <div className="flex items-center">
          <PriorityGlyph priority={ticket.priority} size={14} />
        </div>
        <div className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
          {ticket.id}
        </div>
        <div className="min-w-0 pr-4">
          <button
            type="button"
            onClick={() => onOpenTicket(ticket.id)}
            className="truncate text-left hover:underline"
            style={{ color: "var(--ink)", fontWeight: isSelected ? 600 : 400 }}
          >
            {ticket.title}
          </button>
        </div>
        <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
          {ticket.labels.join(", ") || "—"}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[12px]" style={{ color: "var(--ink-2)" }}>
          {isProposal ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1" style={{ color: "var(--ink-3)" }}>
                <AgentGlyph size={12} />
                <span>from {displayActor(ticket.proposedBy)}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={async (e) => {
                  e.stopPropagation();
                  setBusy(true);
                  try {
                    await api.acceptTriage(snapshot.projectId, ticket.id);
                    await onRefresh();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-[11px] font-semibold hover:underline"
                style={{ color: "var(--done)" }}
              >
                Accept
              </button>
            </div>
          ) : (
            <>
              {isAgentActor(ticket.assignee) && <AgentGlyph size={13} />}
              <span className="truncate">{displayActor(ticket.assignee)}</span>
            </>
          )}
        </div>
        <div className="text-right text-[12px] tabular-nums" style={{ color: "var(--ink)" }}>
          {ticket.estimate ?? "–"}
        </div>
        <div className="text-right text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
          {formatRelativeTime(ticket.createdAt)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header (responsive) */}
      <header
        className="flex items-center justify-between gap-4 border-b px-4 pt-3.5 pb-3 md:border-b-0 md:px-7 md:pt-5 md:pb-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {snapshot.config.name}
          </div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight md:text-[24px]">Backlog</h1>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search backlog"
            className="flex h-11 w-11 items-center justify-center rounded-md md:h-auto md:w-auto md:justify-between md:gap-6 md:border md:px-3 md:py-1.5 md:text-[12px]"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-strong)",
              color: "var(--ink-2)",
            }}
          >
            <span className="flex items-center gap-2">
              <SearchIcon size={17} className="md:hidden" />
              <SearchIcon size={13} className="hidden md:block" />
              <span className="hidden md:inline">Search or jump to…</span>
            </span>
            <kbd className="hidden font-sans text-[11px] md:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => onNewTicket("backlog")}
            className="min-h-[38px] rounded-lg px-3.5 py-2 text-[14px] font-semibold md:min-h-0 md:rounded-md md:text-[13px]"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            <span className="md:hidden">+ New</span>
            <span className="hidden md:inline">+ New ticket</span>
          </button>
        </div>
      </header>

      {/* Undo toast after Dismiss */}
      {undoProposal && (
        <div
          className="flex items-center justify-between px-4 py-2.5 text-[13px] md:px-7"
          style={{ background: "var(--bar-bg)", color: "var(--bar-fg)" }}
        >
          <span className="truncate">Dismissed “{undoProposal.title}”</span>
          <button
            type="button"
            onClick={handleUndoDismiss}
            className="ml-4 shrink-0 font-semibold underline"
          >
            Undo
          </button>
        </div>
      )}

      {/* ================= MOBILE BACKLOG (< md) ================= */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 md:hidden">
        {triageTickets.length > 0 && (
          <section className="mb-6">
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="m-0 text-[15px] font-bold">Needs triage</h2>
              <span className="text-[14px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                {triageTickets.length}
              </span>
            </div>
            <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
              Proposed by agents. Accept to move into Ready.
            </p>
            <div className="divide-y border-b" style={{ borderColor: "var(--border)" }}>
              {triageTickets.map((t) => (
                <div key={t.id} className="py-3.5" style={{ borderColor: "var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => onOpenTicket(t.id)}
                    className="mb-2 block w-full text-left text-[15px] font-semibold leading-snug"
                    style={{ color: "var(--ink)" }}
                  >
                    {t.title}
                  </button>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                      <AgentGlyph size={13} />
                      <span className="tabular-nums">
                        {t.id} · {displayActor(t.proposedBy)} · {formatRelativeTime(t.createdAt)}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDismissProposal(t)}
                        className="min-h-[40px] px-2.5 text-[14px]"
                        style={{ color: "var(--ink-2)" }}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await api.acceptTriage(snapshot.projectId, t.id);
                            await onRefresh();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="min-h-[40px] rounded-lg border px-4 text-[14px] font-semibold"
                        style={{
                          background: "var(--bg-card)",
                          borderColor: "var(--border-input)",
                          color: "var(--ink)",
                        }}
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="m-0 text-[15px] font-bold">Ready</h2>
              <span className="text-[13px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                {readyBacklog.length} · {readyPoints} pts
              </span>
            </div>
            <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              + adds to {activeCycle ? `cycle ${activeCycle.number}` : todoCol.name}
            </span>
          </div>

          {readyBacklog.length === 0 ? (
            <div className="py-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
              Backlog is empty. Tap + New to capture work.
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {readyBacklog.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenTicket(t.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                      <PriorityGlyph priority={t.priority} size={13} />
                      <span className="tabular-nums">
                        {t.id} · {displayActor(t.assignee)}
                        {t.estimate !== null ? ` · ${t.estimate} pt` : ""}
                      </span>
                    </div>
                    <div className="text-[15px] leading-snug" style={{ color: "var(--ink)" }}>
                      {t.title}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAddToCycle(t)}
                    aria-label={`Add ${t.id} to ${activeCycle ? `cycle ${activeCycle.number}` : todoCol.name}`}
                    className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
                    style={{ color: "var(--ink)" }}
                  >
                    <PlusIcon size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ================= DESKTOP BACKLOG (>= md) ================= */}
      <div className="hidden flex-1 flex-col overflow-hidden md:flex">
        {selectedIds.size > 0 && (
          <div
            className="flex items-center justify-between px-7 py-2.5 text-[12px]"
            style={{ background: "var(--bar-bg)", color: "var(--bar-fg)" }}
          >
            <div className="flex items-center gap-5">
              <span className="font-semibold tabular-nums">{selectedIds.size} selected</span>
              <span className="opacity-30">|</span>
              {activeCycle && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    bulkAction(async (id) => {
                      await api.updateTicket(snapshot.projectId, id, { cycleId: activeCycle.id });
                      await api.moveTicket(snapshot.projectId, id, todoCol.id);
                    })
                  }
                  className="font-medium hover:underline"
                >
                  Move to Cycle {activeCycle.number} <span className="ml-1 opacity-60">C</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => bulkAction((id) => api.updateTicket(snapshot.projectId, id, { priority: "high" }))}
                className="font-medium hover:underline"
              >
                Set High priority <span className="ml-1 opacity-60">P</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  bulkAction((id) => api.updateTicket(snapshot.projectId, id, { assignee: snapshot.config.owner }))
                }
                className="font-medium hover:underline"
              >
                Assign to me <span className="ml-1 opacity-60">A</span>
              </button>
            </div>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="opacity-75 hover:opacity-100">
              Esc to clear
            </button>
          </div>
        )}

        <div
          className="grid grid-cols-[32px_28px_72px_1fr_150px_140px_64px_76px] items-center gap-2 border-y px-7 py-2 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", color: "var(--ink-3)" }}
        >
          <div />
          <div />
          <div>ID</div>
          <div>Title</div>
          <div>Labels</div>
          <div>Assignee</div>
          <div className="text-right">Points</div>
          <div className="text-right">Age</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {triageTickets.length > 0 && (
            <section className="mb-4">
              <div className="flex items-baseline justify-between px-7 pt-5 pb-2">
                <div className="text-[13px]">
                  <strong className="font-semibold">Needs triage</strong>
                  <span className="ml-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    {triageTickets.length} · proposed by agents, not yet accepted
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      for (const t of triageTickets) await api.acceptTriage(snapshot.projectId, t.id);
                      await onRefresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="text-[12px] font-semibold hover:underline"
                  style={{ color: "var(--ink)" }}
                >
                  Accept all proposals
                </button>
              </div>
              {triageTickets.map((t, i) => renderDesktopRow(t, i, true))}
            </section>
          )}

          <section>
            <div className="flex items-baseline justify-between px-7 pt-5 pb-2">
              <div className="text-[13px]">
                <strong className="font-semibold">Ready</strong>
                <span className="ml-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
                  {readyBacklog.length} · sorted by priority
                </span>
              </div>
              <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                {readyPoints} points
              </span>
            </div>
            {readyBacklog.length === 0 ? (
              <div className="px-7 py-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
                Backlog is empty. Press <kbd className="font-mono">C</kbd> or click + New ticket to capture work.
              </div>
            ) : (
              readyBacklog.map((t, i) => renderDesktopRow(t, triageTickets.length + i, false))
            )}
          </section>

          <div className="flex flex-wrap items-center gap-4 px-7 py-5 text-[12px]" style={{ color: "var(--ink-3)" }}>
            <span>Priority:</span>
            {(["urgent", "high", "medium", "low", "none"] as Priority[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <PriorityGlyph priority={p} size={13} />
                <span className="capitalize">{p === "none" ? "Not set" : p}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { ProjectSnapshot } from "../../core/types.js";
import { displayActor } from "../../core/types.js";
import { api, formatRelativeTime } from "../lib/api.js";
import {
  AgentGlyph,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  WarningTriangleIcon,
} from "./Icons.js";

interface ReviewInboxViewProps {
  snapshot: ProjectSnapshot;
  initialTicketId?: string | null;
  onRefresh: () => Promise<void>;
  onOpenTicket: (ticketId: string) => void;
}

export function ReviewInboxView({
  snapshot,
  initialTicketId,
  onRefresh,
  onOpenTicket,
}: ReviewInboxViewProps) {
  const [tab, setTab] = useState<"waiting" | "decided">("waiting");
  const [selectedId, setSelectedId] = useState<string | null>(initialTicketId ?? null);
  const [mobileShowDetail, setMobileShowDetail] = useState<boolean>(Boolean(initialTicketId));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTicketId) {
      setSelectedId(initialTicketId);
      setTab("waiting");
      setMobileShowDetail(true);
    }
  }, [initialTicketId]);

  const reviewColIds = useMemo(
    () => new Set(snapshot.config.columns.filter((c) => c.category === "review").map((c) => c.id)),
    [snapshot.config.columns],
  );

  const waitingTickets = useMemo(
    () =>
      snapshot.tickets
        .filter((t) => t.triage === "accepted" && (reviewColIds.has(t.status) || t.review.state === "pending"))
        .sort(
          (a, b) =>
            Date.parse(a.review.requestedAt ?? a.updatedAt) -
            Date.parse(b.review.requestedAt ?? b.updatedAt),
        ),
    [snapshot.tickets, reviewColIds],
  );

  const decidedEvents = useMemo(
    () =>
      snapshot.recentEvents
        .filter((e) => e.type === "review.approved" || e.type === "review.rejected")
        .reverse(),
    [snapshot.recentEvents],
  );

  const decidedTickets = useMemo(
    () =>
      snapshot.tickets
        .filter((t) => t.review.state === "approved" || t.review.state === "changes_requested")
        .sort(
          (a, b) =>
            Date.parse(b.review.decidedAt ?? b.updatedAt) -
            Date.parse(a.review.decidedAt ?? a.updatedAt),
        ),
    [snapshot.tickets],
  );

  const list = tab === "waiting" ? waitingTickets : decidedTickets;
  const selectedIndex = selectedId ? list.findIndex((t) => t.id === selectedId) : 0;
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = list[safeIndex] ?? null;

  useEffect(() => {
    setNote("");
    setError(null);
  }, [selected?.id]);

  // Keyboard navigation J/K, A (approve) on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!list.length) return;
      if (e.key === "j" || e.key === "J") {
        setSelectedId(list[Math.min(list.length - 1, safeIndex + 1)].id);
      } else if (e.key === "k" || e.key === "K") {
        setSelectedId(list[Math.max(0, safeIndex - 1)].id);
      } else if ((e.key === "a" || e.key === "A") && tab === "waiting" && selected) {
        e.preventDefault();
        void handleApprove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, safeIndex, selected, tab]);

  const handleApprove = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveReview(snapshot.projectId, selected.id, note.trim() || undefined);
      setNote("");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    if (!note.trim()) {
      setError("Add a short note telling the agent what to change before sending back.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.rejectReview(snapshot.projectId, selected.id, note.trim());
      setNote("");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const approvedCount = decidedEvents.filter((e) => e.type === "review.approved").length;
  const rejectedCount = decidedEvents.filter((e) => e.type === "review.rejected").length;

  const filesCount = selected?.review.filesChanged?.length ?? 0;
  const checksCount = selected?.review.checks?.length ?? 0;
  const passedChecks = (selected?.review.checks ?? []).filter((c) => c.status === "pass").length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left queue column (full width on mobile when queue shown; 336px sidebar on desktop) */}
      <section
        className={`${mobileShowDetail && selected ? "hidden md:flex" : "flex"} h-full w-full shrink-0 flex-col md:w-[336px] md:border-r`}
        style={{ borderColor: "var(--border)", background: "var(--bg-paper)" }}
      >
        <div className="px-5 pt-4 pb-3 md:px-6 md:pt-5">
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {snapshot.config.name}
          </div>
          <h1 className="m-0 text-[24px] font-bold tracking-tight">Review</h1>
          <div className="mt-3.5 flex items-center gap-5 text-[13px]">
            <button
              type="button"
              onClick={() => setTab("waiting")}
              className="min-h-[36px]"
              style={{
                color: tab === "waiting" ? "var(--ink)" : "var(--ink-3)",
                fontWeight: tab === "waiting" ? 600 : 400,
              }}
            >
              Waiting on you · {waitingTickets.length}
            </button>
            <button
              type="button"
              onClick={() => setTab("decided")}
              className="min-h-[36px]"
              style={{
                color: tab === "decided" ? "var(--ink)" : "var(--ink-3)",
                fontWeight: tab === "decided" ? 600 : 400,
              }}
            >
              Decided · {decidedTickets.length}
            </button>
          </div>
        </div>

        <div className="h-px w-full" style={{ background: "var(--border)" }} />

        <div className="flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <div className="px-5 py-10 text-[13px] md:px-6" style={{ color: "var(--ink-3)" }}>
              {tab === "waiting" ? "Nothing waiting on your review." : "No review decisions recorded yet."}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {list.map((ticket) => {
                const isSelected = selected?.id === ticket.id;
                const failedChecks = (ticket.review.checks ?? []).filter((c) => c.status === "fail");
                const fCount = ticket.review.filesChanged?.length ?? 0;
                const allPassed = (ticket.review.checks?.length ?? 0) > 0 && failedChecks.length === 0;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(ticket.id);
                      setMobileShowDetail(true);
                    }}
                    className="relative block w-full px-5 py-4 text-left transition-colors md:px-6"
                    style={{
                      background: isSelected ? "var(--bg-card)" : "transparent",
                      borderColor: "var(--border)",
                    }}
                  >
                    {isSelected && (
                      <span
                        className="absolute bottom-0 left-0 top-0 hidden w-[3px] md:block"
                        style={{ background: "var(--accent)" }}
                        aria-hidden="true"
                      />
                    )}
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span style={{ color: "var(--ink-3)" }}>
                        {ticket.id} · {displayActor(ticket.review.requestedBy ?? ticket.assignee)}
                      </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: tab === "waiting" ? "var(--accent)" : "var(--ink-3)" }}
                      >
                        {formatRelativeTime(ticket.review.requestedAt ?? ticket.updatedAt)}
                      </span>
                    </div>
                    <div className="mb-1 text-[14px] font-semibold md:text-[13px]" style={{ color: "var(--ink)" }}>
                      {ticket.title}
                    </div>
                    {failedChecks.length > 0 ? (
                      <div
                        className="flex items-center gap-1.5 text-[12px] font-medium"
                        style={{ color: "var(--accent)" }}
                      >
                        <WarningTriangleIcon size={13} />
                        <span>
                          {failedChecks.length} check failed · {failedChecks[0].name}
                        </span>
                      </div>
                    ) : (
                      <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                        {[
                          fCount > 0 ? `${fCount} files` : null,
                          allPassed ? "checks passed" : null,
                          ticket.review.question ? "1 question" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Ready for review"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="border-t px-5 py-5 md:px-6" style={{ borderColor: "var(--border)" }}>
            <div className="eyebrow mb-3">Decided recently</div>
            {decidedEvents.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                No reviews decided yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[12px]">
                {decidedEvents.slice(0, 5).map((ev) => {
                  const t = snapshot.tickets.find((item) => item.id === ev.ticketId);
                  const isApproved = ev.type === "review.approved";
                  return (
                    <div key={ev.id} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0" style={{ color: isApproved ? "var(--done)" : "var(--ink-2)" }}>
                        {isApproved ? <CheckIcon size={13} /> : "↩"}
                      </span>
                      <span className="truncate" style={{ color: "var(--ink-2)" }}>
                        {ev.ticketId} {isApproved ? (t?.title ?? "approved") : `sent back: ${String(ev.data?.note ?? "")}`}
                      </span>
                    </div>
                  );
                })}
                <div className="mt-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
                  Approved {approvedCount}, sent back {rejectedCount}.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Right review detail pane (full screen on mobile when selected) */}
      <section
        className={`${mobileShowDetail && selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}
        style={{ background: "var(--bg-card)" }}
      >
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
            Select a ticket from the review queue to inspect agent work.
          </div>
        ) : (
          <>
            {/* Mobile pushed top bar (< md) */}
            <header
              className="flex items-center justify-between border-b px-3 py-2 md:hidden"
              style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
            >
              <button
                type="button"
                onClick={() => setMobileShowDetail(false)}
                className="flex min-h-[44px] items-center gap-1 px-1 text-[15px]"
                style={{ color: "var(--ink)" }}
              >
                <ChevronLeftIcon size={17} />
                <span>Review</span>
              </button>
              <span className="text-[14px] font-semibold tabular-nums">
                {safeIndex + 1} of {list.length} {tab}
              </span>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label="Previous review"
                  disabled={safeIndex <= 0}
                  onClick={() => setSelectedId(list[Math.max(0, safeIndex - 1)].id)}
                  className="flex h-11 w-10 items-center justify-center disabled:opacity-30"
                >
                  <ChevronUpIcon size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Next review"
                  disabled={safeIndex >= list.length - 1}
                  onClick={() => setSelectedId(list[Math.min(list.length - 1, safeIndex + 1)].id)}
                  className="flex h-11 w-10 items-center justify-center disabled:opacity-30"
                >
                  <ChevronDownIcon size={16} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-8">
              <div className="mb-1.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                  <AgentGlyph size={13} />
                  <span>
                    {selected.id} ·{" "}
                    <strong className="font-semibold" style={{ color: "var(--ink)" }}>
                      {displayActor(selected.review.requestedBy ?? selected.assignee)}
                    </strong>{" "}
                    asked {formatRelativeTime(selected.review.requestedAt ?? selected.updatedAt)} ago
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTicket(selected.id)}
                  className="hidden text-[12px] font-medium hover:underline md:inline"
                  style={{ color: "var(--ink-2)" }}
                >
                  Open full ticket
                </button>
              </div>

              <h2 className="m-0 mb-1 text-[22px] font-bold tracking-tight md:mb-8 md:text-[24px]">
                {selected.title}
              </h2>

              {/* Mobile branch/files/checks compact subline */}
              <div className="mb-5 text-[12px] md:hidden" style={{ color: "var(--ink-3)" }}>
                {[
                  selected.branch ? `branch ${selected.branch}` : null,
                  filesCount > 0 ? `${filesCount} files` : null,
                  checksCount > 0 ? `${passedChecks} of ${checksCount} checks passed` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>

              {/* Sections: mobile stacks Acceptance BEFORE Checks & Changes; desktop uses 2-col grid */}
              <div className="flex flex-col divide-y border-t" style={{ borderColor: "var(--border)" }}>
                {/* Summary */}
                <div
                  className="order-1 grid grid-cols-1 gap-2 py-4 md:grid-cols-[150px_1fr] md:gap-6 md:py-5"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="text-[13px] font-semibold">Summary</div>
                  <div className="text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>
                    {selected.review.summary || selected.description || "No summary provided."}
                  </div>
                </div>

                {/* Needs your call */}
                {selected.review.question && (
                  <div
                    className="order-2 grid grid-cols-1 gap-2 py-4 md:grid-cols-[150px_1fr] md:gap-6 md:py-5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="hidden text-[13px] font-semibold md:block" style={{ color: "var(--accent)" }}>
                      Needs your call
                    </div>
                    <div
                      className="border-l-2 pl-4 text-[14px] leading-relaxed"
                      style={{ borderColor: "var(--accent)", color: "var(--ink)" }}
                    >
                      <div className="mb-1 text-[13px] font-semibold md:hidden" style={{ color: "var(--accent)" }}>
                        Needs your call
                      </div>
                      {selected.review.question}
                    </div>
                  </div>
                )}

                {/* Acceptance (order-3 on mobile, order-5 on desktop) */}
                {selected.checklist.length > 0 && (
                  <div
                    className="order-3 grid grid-cols-1 gap-2 py-4 md:order-5 md:grid-cols-[150px_1fr] md:gap-6 md:py-5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="text-[13px] font-semibold">Acceptance</div>
                    <div className="flex flex-col gap-1 md:gap-2.5">
                      {selected.checklist.map((item) => (
                        <button
                          key={item.index}
                          type="button"
                          role="checkbox"
                          aria-checked={item.checked}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api.toggleChecklist(snapshot.projectId, selected.id, item.index, !item.checked);
                              await onRefresh();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="flex min-h-[44px] w-full items-center gap-3 text-left text-[14px] md:min-h-[24px] md:text-[13px]"
                        >
                          <span
                            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border md:h-4 md:w-4"
                            style={{
                              background: item.checked ? "var(--ink)" : "transparent",
                              borderColor: item.checked ? "var(--ink)" : "var(--border-input)",
                              color: "var(--bg-card)",
                            }}
                          >
                            {item.checked && <CheckIcon size={12} />}
                          </span>
                          <span>{item.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Checks (order-4 on both) */}
                {checksCount > 0 && (
                  <div
                    className="order-4 grid grid-cols-1 gap-2 py-4 md:grid-cols-[150px_1fr] md:gap-6 md:py-5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="text-[13px] font-semibold">Checks</div>
                    <div className="flex flex-col gap-2 text-[13px]">
                      {selected.review.checks!.map((c) => (
                        <div key={c.name} className="grid grid-cols-[120px_1fr] items-baseline gap-3 md:grid-cols-[180px_1fr] md:gap-4">
                          <span className="flex items-center gap-2">
                            <span style={{ color: c.status === "pass" ? "var(--done)" : "var(--accent)" }}>
                              {c.status === "pass" ? <CheckIcon size={13} /> : <WarningTriangleIcon size={13} />}
                            </span>
                            <span className="truncate font-mono text-[12px]">{c.name}</span>
                          </span>
                          <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                            {c.detail ?? c.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Changes (order-5 on mobile, order-3 on desktop) */}
                {filesCount > 0 && (
                  <div
                    className="order-5 grid grid-cols-1 gap-2 py-4 md:order-3 md:grid-cols-[150px_1fr] md:gap-6 md:py-5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between md:block">
                      <span className="text-[13px] font-semibold">Changes</span>
                      <button
                        type="button"
                        onClick={() => onOpenTicket(selected.id)}
                        className="text-[12px] font-medium md:hidden"
                        style={{ color: "var(--accent)" }}
                      >
                        Open ticket
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5 text-[13px]">
                      {selected.review.filesChanged!.map((f) => (
                        <div key={f.path} className="grid grid-cols-[1fr_56px_56px] items-baseline gap-2">
                          <span className="truncate font-mono text-[12px]" style={{ color: "var(--ink)" }}>
                            {f.path}
                          </span>
                          {f.isNew ? (
                            <span className="col-span-2 text-right text-[12px]" style={{ color: "var(--ink-3)" }}>
                              new file
                            </span>
                          ) : (
                            <>
                              <span className="text-right tabular-nums text-[12px]" style={{ color: "var(--done)" }}>
                                +{f.added}
                              </span>
                              <span className="text-right tabular-nums text-[12px]" style={{ color: "var(--ink-3)" }}>
                                −{f.removed}
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pinned decision footer */}
            {tab === "waiting" && (
              <footer
                className="pb-safe border-t px-4 pt-3 md:px-10 md:py-4"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border)" }}
              >
                {error && (
                  <div className="mb-2 text-[12px] font-medium" style={{ color: "var(--accent)" }}>
                    {error}
                  </div>
                )}
                {selected.t3ThreadId && (
                  <div className="mb-2 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    Linked T3 thread · Send back will message <code>{selected.t3ThreadId.slice(0, 18)}…</code>
                  </div>
                )}
                <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={`Note for ${displayActor(selected.review.requestedBy ?? selected.assignee)} (optional)`}
                    className="min-h-[44px] flex-1 rounded-lg border px-3.5 py-2 outline-none md:min-h-[38px] md:rounded-md md:text-[13px]"
                    style={{
                      background: "var(--bg-card)",
                      borderColor: "var(--border-input)",
                      color: "var(--ink)",
                    }}
                  />
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleReject}
                      className="min-h-[44px] rounded-lg border px-4 py-2 text-[14px] font-medium md:min-h-[38px] md:rounded-md md:text-[13px]"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                    >
                      ← Send back
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleApprove}
                      className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-semibold md:min-h-[38px] md:flex-none md:rounded-md md:text-[13px]"
                      style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                    >
                      <CheckIcon size={15} />
                      <span>Approve and merge</span>
                    </button>
                  </div>
                </div>
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  );
}

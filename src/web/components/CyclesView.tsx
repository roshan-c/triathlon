import { useState } from "react";
import type { ProjectSnapshot } from "../../core/types.js";
import { api } from "../lib/api.js";

interface CyclesViewProps {
  snapshot: ProjectSnapshot;
  onRefresh: () => Promise<void>;
}

export function CyclesView({ snapshot, onRefresh }: CyclesViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doneColIds = new Set(snapshot.config.columns.filter((c) => c.category === "done").map((c) => c.id));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await run(async () => {
      await api.createCycle(snapshot.projectId, { name: name.trim(), goal: goal.trim(), startDate, endDate });
      setName("");
      setGoal("");
      setCreating(false);
    });
  };

  const sortedCycles = [...snapshot.cycles].sort((a, b) => b.number - a.number);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header
        className="flex items-center justify-between border-b px-4 pt-3.5 pb-3 md:px-8 md:pt-5 md:pb-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {snapshot.config.name}
          </div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight md:text-[24px]">Cycles</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="min-h-[38px] rounded-lg px-3.5 py-2 text-[14px] font-semibold md:min-h-0 md:rounded-md md:text-[13px]"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          {creating ? "Cancel" : "+ New cycle"}
        </button>
      </header>

      <div className="px-4 py-5 md:px-8 md:py-6">
        {error && (
          <div className="mb-4 text-[12px] font-medium" style={{ color: "var(--accent)" }}>
            {error}
          </div>
        )}

        {creating && (
          <form
            onSubmit={handleCreate}
            className="mb-8 max-w-[620px] rounded-md border p-5"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
          >
            <div className="eyebrow mb-3">Plan a cycle</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  Name
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Evaluation chapter"
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  Goal
                </label>
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What makes this cycle a success?"
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  Start date
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
                  End date
                </label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px]"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md px-4 py-1.5 text-[13px] font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Create cycle
              </button>
            </div>
          </form>
        )}

        {sortedCycles.length === 0 ? (
          <div className="py-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
            No cycles yet. Create one to track scope, burndown, and dissertation velocity.
          </div>
        ) : (
          <div className="divide-y border-t" style={{ borderColor: "var(--border)" }}>
            {sortedCycles.map((cycle) => {
              const tickets = snapshot.tickets.filter((t) => t.cycleId === cycle.id && t.triage === "accepted");
              const doneTickets = tickets.filter((t) => doneColIds.has(t.status));
              const totalPts = cycle.snapshot?.totalPoints ?? tickets.reduce((s, t) => s + (t.estimate ?? 0), 0);
              const donePts = cycle.snapshot?.completedPoints ?? doneTickets.reduce((s, t) => s + (t.estimate ?? 0), 0);
              const nextPlanned = snapshot.cycles.find((c) => c.state === "planned" && c.number > cycle.number);

              return (
                <div
                  key={cycle.id}
                  className="flex flex-wrap items-start justify-between gap-6 py-5"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 max-w-[600px]">
                    <div className="flex items-baseline gap-3">
                      <h2 className="m-0 text-[15px] font-semibold">
                        Cycle {cycle.number} · {cycle.name}
                      </h2>
                      <span
                        className="text-[12px] font-medium capitalize"
                        style={{ color: cycle.state === "active" ? "var(--accent)" : "var(--ink-3)" }}
                      >
                        {cycle.state}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                      {cycle.startDate} – {cycle.endDate} · {donePts} of {totalPts} pts ({doneTickets.length}/{tickets.length}{" "}
                      tickets)
                      {cycle.scopeChanges.length > 0 ? ` · ${cycle.scopeChanges.length} scope changes` : ""}
                    </div>
                    {cycle.goal && (
                      <p className="mt-2 mb-0 text-[13px]" style={{ color: "var(--ink-2)" }}>
                        {cycle.goal}
                      </p>
                    )}
                    {cycle.snapshot && (
                      <div className="mt-2 text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                        Snapshot frozen · median cycle {cycle.snapshot.medianCycleDays ?? "—"} d · p85{" "}
                        {cycle.snapshot.p85CycleDays ?? "—"} d
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {cycle.state === "planned" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(async () => { await api.startCycle(snapshot.projectId, cycle.id); })}
                        className="rounded-md border px-3 py-1.5 text-[12px] font-semibold"
                        style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
                      >
                        Start cycle
                      </button>
                    )}
                    {cycle.state === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api.completeCycle(
                              snapshot.projectId,
                              cycle.id,
                              nextPlanned ? nextPlanned.id : "backlog",
                            );
                          })
                        }
                        className="rounded-md border px-3 py-1.5 text-[12px] font-semibold"
                        style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
                      >
                        Complete &amp; snapshot
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

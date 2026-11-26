import { useEffect, useState } from "react";
import type { Priority, ProjectSnapshot, ProjectSummary } from "../../core/types.js";
import { api } from "../lib/api.js";
import { CloseIcon, SearchIcon } from "./Icons.js";
import type { NavView } from "./Sidebar.js";

export function NewTicketModal({
  snapshot,
  defaultStatus,
  onClose,
  onCreated,
}: {
  snapshot: ProjectSnapshot;
  defaultStatus?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const activeCycle = snapshot.cycles.find((c) => c.state === "active");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState(defaultStatus ?? snapshot.config.columns[1]?.id ?? snapshot.config.columns[0].id);
  const [priority, setPriority] = useState<Priority>("medium");
  const [estimate, setEstimate] = useState("");
  const [cycleId, setCycleId] = useState(defaultStatus === "backlog" ? "" : (activeCycle?.id ?? ""));
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createTicket(snapshot.projectId, {
        title: title.trim(),
        description,
        status,
        priority,
        estimate: estimate.trim() === "" ? null : Number(estimate),
        cycleId: cycleId || null,
        assignee: assignee.trim() || null,
        labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
        criteria: criteria.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[560px] rounded-md border shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
        role="dialog"
        aria-modal="true"
        aria-label="New ticket"
      >
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="m-0 text-[16px] font-bold">New ticket</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
              Title
            </label>
            <input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Write methodology §3.2"
              className="w-full rounded-md border px-3 py-2 text-[14px]"
              style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Column</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              >
                {snapshot.config.columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">Not set</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Points</label>
              <input
                type="number"
                min={0}
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                placeholder="3"
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px] tabular-nums"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Cycle</label>
              <select
                value={cycleId}
                onChange={(e) => setCycleId(e.target.value)}
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              >
                <option value="">None</option>
                {snapshot.cycles.filter((c) => c.state !== "completed").map((c) => (
                  <option key={c.id} value={c.id}>Cycle {c.number} · {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Assignee</label>
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Roshan or agent:claude"
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Labels</label>
              <input
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="metrics, writing"
                className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Description (Markdown)</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context, constraints, links..."
              className="w-full rounded-md border p-2.5 text-[13px]"
              style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
              Acceptance criteria (one per line)
            </label>
            <textarea
              rows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              placeholder={"Parse events into per-ticket transitions\nUnit tests pass"}
              className="w-full rounded-md border p-2.5 text-[12px]"
              style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3.5 py-1.5 text-[13px]"
              style={{ borderColor: "var(--border-strong)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md px-4 py-1.5 text-[13px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Create ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddProjectModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (projectId: string) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [initIfMissing, setInitIfMissing] = useState(true);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.registerProject({
        path: path.trim(),
        initIfMissing,
        key: key.trim() || undefined,
        name: name.trim() || undefined,
        demo,
      });
      await onAdded(created.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[480px] rounded-md border shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Add local project"
      >
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="m-0 text-[16px] font-bold">Add local repository</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          {error && <div className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>{error}</div>}
          <div>
            <label className="mb-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>Absolute folder path</label>
            <input
              autoFocus
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/roshan/dissertation"
              className="w-full rounded-md border px-3 py-2 font-mono text-[12px]"
              style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
            />
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={initIfMissing} onChange={(e) => setInitIfMissing(e.target.checked)} />
            <span>Initialize <code>.triathlon/</code> if not already present</span>
          </label>
          {initIfMissing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Key (optional)</label>
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="DIS"
                  className="w-full rounded-md border px-2.5 py-1.5 text-[12px] uppercase"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>Display name (optional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dissertation"
                  className="w-full rounded-md border px-2.5 py-1.5 text-[12px]"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
                />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
                <span>Seed with sample cycles &amp; tickets</span>
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3.5 py-1.5 text-[13px]" style={{ borderColor: "var(--border-strong)" }}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className="rounded-md px-4 py-1.5 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
              Add project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CommandPalette({
  projects,
  snapshot,
  onClose,
  onSelectProject,
  onSelectView,
  onOpenTicket,
  onNewTicket,
}: {
  projects: ProjectSummary[];
  snapshot: ProjectSnapshot | null;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onSelectView: (view: NavView) => void;
  onOpenTicket: (id: string) => void;
  onNewTicket: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matchingTickets = (snapshot?.tickets ?? [])
    .filter((t) => !q || `${t.id} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(q))
    .slice(0, 8);
  const matchingProjects = projects.filter((p) => !q || `${p.key} ${p.name}`.toLowerCase().includes(q));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[540px] overflow-hidden rounded-md border shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <SearchIcon size={15} className="opacity-60" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a ticket, project, or view…"
            className="flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: "var(--ink)" }}
          />
          <kbd className="text-[11px]" style={{ color: "var(--ink-3)" }}>Esc</kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto py-2">
          <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Actions
          </div>
          <button
            type="button"
            onClick={() => { onClose(); onNewTicket(); }}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
          >
            <span>Create new ticket</span>
            <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>C</span>
          </button>
          {(["board", "backlog", "review", "cycles", "metrics", "settings"] as NavView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { onSelectView(v); onClose(); }}
              className="flex w-full items-center justify-between px-4 py-1.5 text-left text-[13px] capitalize hover:bg-[var(--bg-hover)]"
            >
              <span>Go to {v}</span>
            </button>
          ))}

          {matchingTickets.length > 0 && (
            <>
              <div className="mt-2 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                Tickets
              </div>
              {matchingTickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onOpenTicket(t.id); onClose(); }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                >
                  <span className="truncate">
                    <span className="mr-2 tabular-nums text-[12px]" style={{ color: "var(--ink-3)" }}>{t.id}</span>
                    {t.title}
                  </span>
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-3)" }}>{t.status}</span>
                </button>
              ))}
            </>
          )}

          {matchingProjects.length > 1 && (
            <>
              <div className="mt-2 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                Projects
              </div>
              {matchingProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSelectProject(p.id); onClose(); }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                >
                  <span>{p.name}</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>{p.key}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

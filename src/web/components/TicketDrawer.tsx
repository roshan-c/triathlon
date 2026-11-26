import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Priority, ProjectSnapshot, T3Settings, Ticket } from "../../core/types.js";
import { displayActor, isAgentActor } from "../../core/types.js";
import { api, copyText, formatRelativeTime } from "../lib/api.js";
import {
  AgentGlyph,
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CopyIcon,
  EditPencilIcon,
  PriorityGlyph,
} from "./Icons.js";

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claudeAgent: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
  antigravity: ["gemini-4-neon", "gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen", "gemini-3.8-flash"],
  pi: [
    "opencode-go/qwen4-max",
    "opencode-go/qwen3.8-max",
    "opencode-go/claude-haiku-5-5",
    "opencode-go/deepseek-v4.1-flash",
    "opencode-go/gemini-4-argon",
  ],
  codex: ["gpt-5.3-codex", "gpt-5.2-codex"],
};

const REASONING_OPTIONS: Record<string, string[]> = {
  effort: ["low", "medium", "high", "xhigh", "max", "ultrathink"],
  thought_level: ["low", "medium", "high", "xhigh"],
  thinking: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  reasoningEffort: ["low", "medium", "high", "xhigh"],
};

function defaultBranchFor(ticket: Ticket): string {
  if (ticket.branch) return ticket.branch;
  const slug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${ticket.id.toLowerCase()}-${slug || "work"}`;
}

interface TicketDrawerProps {
  snapshot: ProjectSnapshot;
  ticket: Ticket;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSelectTicket: (ticketId: string) => void;
}

export function TicketDrawer({
  snapshot,
  ticket,
  onClose,
  onRefresh,
  onSelectTicket,
}: TicketDrawerProps) {
  const [editingBody, setEditingBody] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket.title);
  const [descDraft, setDescDraft] = useState(ticket.description);
  const [commentDraft, setCommentDraft] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [t3Settings, setT3Settings] = useState<T3Settings | null>(null);
  const [launchAgent, setLaunchAgent] = useState("agent:claude");
  const [launchModel, setLaunchModel] = useState("");
  const [launchReasoning, setLaunchReasoning] = useState("");
  const [launchBaseRef, setLaunchBaseRef] = useState("");
  const [launchBranch, setLaunchBranch] = useState(defaultBranchFor(ticket));
  const [t3Status, setT3Status] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(ticket.title);
    setDescDraft(ticket.description);
    setEditingBody(false);
    setError(null);
    setLaunchOpen(false);
    setLaunchBranch(defaultBranchFor(ticket));
    setT3Status(null);
  }, [ticket.id, ticket.title, ticket.description]);

  const openLaunchDialog = async () => {
    setError(null);
    try {
      const settings = t3Settings ?? (await api.getT3Settings());
      setT3Settings(settings);
      const assigneeKey =
        ticket.assignee && ticket.assignee.startsWith("agent:") && settings.agents[ticket.assignee.toLowerCase()]
          ? ticket.assignee.toLowerCase()
          : settings.defaultAgent;
      const profile = settings.agents[assigneeKey] ?? Object.values(settings.agents)[0];
      setLaunchAgent(profile.assignee);
      setLaunchModel(profile.model);
      setLaunchReasoning(profile.reasoningValue);
      setLaunchBaseRef(settings.defaultBaseRef);
      setLaunchBranch(defaultBranchFor(ticket));
      setLaunchOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load T3 settings");
    }
  };

  const handleLaunchAgentChange = (nextAgent: string) => {
    setLaunchAgent(nextAgent);
    const profile = t3Settings?.agents[nextAgent];
    if (profile) {
      setLaunchModel(profile.model);
      setLaunchReasoning(profile.reasoningValue);
    }
  };

  const handleConfirmLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const profile = t3Settings?.agents[launchAgent];
    await run(async () => {
      await api.launchInT3(snapshot.projectId, ticket.id, {
        agent: launchAgent,
        provider: profile?.provider,
        model: launchModel.trim() || undefined,
        reasoningKey: profile?.reasoningKey,
        reasoningValue: launchReasoning,
        baseRef: launchBaseRef.trim() || undefined,
        branch: launchBranch.trim() || undefined,
      });
      setLaunchOpen(false);
    });
  };

  const handleCheckT3Status = async () => {
    try {
      const res = await api.getT3Status(snapshot.projectId, ticket.id);
      setT3Status(res.status ?? "unknown");
    } catch {
      setT3Status("unavailable");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const checkDone = ticket.checklist.filter((c) => c.checked).length;
  const checkTotal = ticket.checklist.length;
  const remainingChecks = checkTotal - checkDone;

  const proseMarkdown = ticket.description
    .replace(/^##\s+Acceptance Criteria\s*$/gim, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*[-*]\s+\[[ xX]\]\s+/.test(line))
    .join("\n")
    .trim();

  const blocksTickets = snapshot.tickets.filter((t) => t.blockedBy.includes(ticket.id));
  const ticketEvents = snapshot.recentEvents
    .filter((e) => e.ticketId === ticket.id)
    .slice(-6)
    .reverse();

  const currentCol = snapshot.config.columns.find((c) => c.id === ticket.status);
  const cycle = snapshot.cycles.find((c) => c.id === ticket.cycleId) ?? null;

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

  const handleSaveTitleAndDesc = async () => {
    await run(async () => {
      await api.updateTicket(snapshot.projectId, ticket.id, {
        title: titleDraft.trim() || ticket.title,
        description: descDraft,
      });
      setEditingBody(false);
    });
  };

  const handleCopyPrompt = async () => {
    try {
      const { prompt } = await api.getPrompt(snapshot.projectId, ticket.id);
      await copyText(prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy prompt");
    }
  };

  const handleCommentSubmit = async () => {
    if (!commentDraft.trim()) return;
    await run(async () => {
      await api.addComment(snapshot.projectId, ticket.id, commentDraft.trim());
      setCommentDraft("");
    });
  };

  const handleSendToReview = async () => {
    await run(async () => {
      await api.requestReview(snapshot.projectId, ticket.id, {
        summary: `Ready for review (${checkDone}/${checkTotal} checklist items completed).`,
      });
    });
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${ticket.id}? This removes .triathlon/tickets/${ticket.id}.md.`)) return;
    await run(async () => {
      await api.deleteTicket(snapshot.projectId, ticket.id);
      onClose();
    });
  };

  const renderProperties = (mobileGrid: boolean) => (
    <div className={mobileGrid ? "grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 text-[13px]" : "flex flex-col gap-4"} style={{ borderColor: "var(--border)" }}>
      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Status</div>
        <select
          value={ticket.status}
          disabled={busy}
          onChange={(e) => run(async () => { await api.moveTicket(snapshot.projectId, ticket.id, e.target.value); })}
          className="w-full bg-transparent text-[14px] font-semibold md:text-[13px] md:font-medium"
          style={{ color: "var(--ink)" }}
        >
          {snapshot.config.columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Priority</div>
        <div className="flex items-center gap-1.5">
          <PriorityGlyph priority={ticket.priority} size={13} />
          <select
            value={ticket.priority}
            disabled={busy}
            onChange={(e) => run(async () => { await api.updateTicket(snapshot.projectId, ticket.id, { priority: e.target.value as Priority }); })}
            className="flex-1 bg-transparent text-[14px] font-medium capitalize md:text-[13px]"
            style={{ color: "var(--ink)" }}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">Not set</option>
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Assignee</div>
        <input
          defaultValue={ticket.assignee ?? ""}
          placeholder="Unassigned"
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== ticket.assignee) {
              void run(async () => { await api.updateTicket(snapshot.projectId, ticket.id, { assignee: next }); });
            }
          }}
          className="w-full bg-transparent text-[14px] font-medium outline-none md:text-[13px]"
          style={{ color: "var(--ink)" }}
        />
      </div>

      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Estimate</div>
        <input
          type="number"
          min={0}
          defaultValue={ticket.estimate ?? ""}
          placeholder="Unestimated"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const next = raw === "" ? null : Number(raw);
            if (next !== ticket.estimate) {
              void run(async () => { await api.updateTicket(snapshot.projectId, ticket.id, { estimate: next }); });
            }
          }}
          className="w-full bg-transparent text-[14px] font-medium tabular-nums outline-none md:text-[13px]"
          style={{ color: "var(--ink)" }}
        />
      </div>

      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Cycle</div>
        <select
          value={ticket.cycleId ?? ""}
          disabled={busy}
          onChange={(e) => run(async () => { await api.updateTicket(snapshot.projectId, ticket.id, { cycleId: e.target.value || null }); })}
          className="w-full bg-transparent text-[14px] font-medium md:text-[13px]"
          style={{ color: "var(--ink)" }}
        >
          <option value="">No cycle</option>
          {snapshot.cycles.map((c) => (
            <option key={c.id} value={c.id}>Cycle {c.number} · {c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Labels</div>
        <input
          defaultValue={ticket.labels.join(", ")}
          placeholder="metrics, chapter-5"
          onBlur={(e) => {
            const next = e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
            if (next.join(",") !== ticket.labels.join(",")) {
              void run(async () => { await api.updateTicket(snapshot.projectId, ticket.id, { labels: next }); });
            }
          }}
          className="w-full bg-transparent text-[14px] outline-none md:text-[13px]"
          style={{ color: "var(--ink)" }}
        />
      </div>

      {!mobileGrid && <div className="h-px" style={{ background: "var(--border)" }} />}

      {ticket.blockedBy.length > 0 && (
        <div>
          <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Blocked by</div>
          <div className="flex flex-col gap-1">
            {ticket.blockedBy.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTicket(id)}
                className="text-left text-[13px] font-medium hover:underline md:text-[12px]"
                style={{ color: "var(--accent)" }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      {blocksTickets.length > 0 && (
        <div>
          <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Blocks</div>
          <div className="flex flex-col gap-1">
            {blocksTickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTicket(t.id)}
                className="truncate text-left text-[13px] hover:underline md:text-[12px]"
                style={{ color: "var(--ink)" }}
              >
                {t.id} · {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {ticket.branch && (
        <div>
          <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Branch</div>
          <div className="truncate font-mono text-[12px]" style={{ color: "var(--ink)" }}>{ticket.branch}</div>
        </div>
      )}

      {ticket.t3ThreadId && (
        <div className={mobileGrid ? "col-span-2" : ""}>
          <div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: "var(--ink-3)" }}>
            <span>T3 thread</span>
            <button
              type="button"
              onClick={() => void handleCheckT3Status()}
              className="hover:underline"
              style={{ color: "var(--ink-2)" }}
            >
              {t3Status ? t3Status : "check status"}
            </button>
          </div>
          <div className="truncate font-mono text-[11px]" style={{ color: "var(--ink)" }}>
            {ticket.t3ThreadId}
          </div>
          {(ticket.t3Model || ticket.t3Reasoning) && (
            <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
              {[ticket.t3Model, ticket.t3Reasoning].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}

      {ticket.files.length > 0 && (
        <div className={mobileGrid ? "col-span-2" : ""}>
          <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Linked files</div>
          <div className="flex flex-col gap-1 font-mono text-[11px]" style={{ color: "var(--ink-2)" }}>
            {ticket.files.map((f) => <div key={f} className="truncate">{f}</div>)}
          </div>
        </div>
      )}

      <div className={mobileGrid ? "col-span-2 flex items-center justify-between pt-2" : ""}>
        <div>
          <div className="mb-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Created</div>
          <div className="text-[12px]" style={{ color: "var(--ink-2)" }}>
            {new Date(ticket.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} by{" "}
            {displayActor(ticket.createdBy)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="mt-2 min-h-[36px] text-left text-[12px] hover:underline md:text-[11px]"
          style={{ color: "var(--ink-3)" }}
        >
          Delete ticket
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <aside
        className="flex h-full w-full flex-col md:max-w-[740px] md:border-l md:shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
        role="dialog"
        aria-modal="true"
        aria-label={ticket.id}
      >
        {/* Mobile top bar (< md) */}
        <header
          className="flex items-center justify-between border-b px-3 py-2 md:hidden"
          style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] items-center gap-1 px-1 text-[15px]"
            style={{ color: "var(--ink)" }}
          >
            <ChevronLeftIcon size={17} />
            <span>Board</span>
          </button>
          <span className="text-[15px] font-bold tabular-nums">{ticket.id}</span>
          <button
            type="button"
            onClick={() => setEditingBody((v) => !v)}
            className="flex min-h-[44px] items-center gap-1.5 px-2 text-[14px]"
            style={{ color: "var(--ink)" }}
          >
            <EditPencilIcon size={14} />
            <span>{editingBody ? "Cancel" : "Edit"}</span>
          </button>
        </header>

        {/* Desktop top bar (>= md) */}
        <header
          className="hidden items-center justify-between border-b px-7 py-3.5 md:flex"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
            <span>Board</span>
            <span>›</span>
            <span className="font-semibold" style={{ color: "var(--ink)" }}>
              {ticket.id}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void openLaunchDialog()}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-semibold"
              style={{ borderColor: "var(--border-input)", color: "var(--ink)" }}
            >
              <AgentGlyph size={13} />
              <span>Run in T3</span>
            </button>
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium"
              style={{ borderColor: "var(--border-strong)", color: "var(--ink-2)" }}
            >
              <CopyIcon size={13} />
              <span>{copiedPrompt ? "Copied prompt" : "Copy prompt"}</span>
            </button>
            <button
              type="button"
              onClick={() => setEditingBody((v) => !v)}
              className="rounded-md border px-2.5 py-1 text-[12px] font-medium"
              style={{ borderColor: "var(--border-strong)", color: "var(--ink-2)" }}
            >
              {editingBody ? "Cancel edit" : "Edit"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: "var(--bg-hover)", color: "var(--ink)" }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </header>

        {error && (
          <div
            className="border-b px-5 py-2 text-[12px] font-medium md:px-7"
            style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          >
            {error}
          </div>
        )}

        {/* Body + Right properties rail on desktop */}
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="min-w-0 flex-1 px-5 py-5 md:px-7 md:py-6">
            {/* Mobile compact metadata + Copy prompt line */}
            {!editingBody && (
              <div className="mb-2.5 flex items-center justify-between gap-2 text-[12px] md:hidden">
                <span className="flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
                  <PriorityGlyph priority={ticket.priority} size={13} />
                  <span className="capitalize">{ticket.priority === "none" ? "No priority" : ticket.priority}</span>
                  {ticket.estimate !== null && <span>· {ticket.estimate} pt</span>}
                  {cycle && <span>· Cycle {cycle.number}</span>}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openLaunchDialog()}
                    className="flex min-h-[36px] items-center gap-1.5 font-semibold"
                    style={{ color: "var(--accent)" }}
                  >
                    <AgentGlyph size={13} />
                    <span>Run in T3</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className="flex min-h-[36px] items-center gap-1.5 font-semibold"
                    style={{ color: "var(--ink)" }}
                  >
                    <CopyIcon size={13} />
                    <span>{copiedPrompt ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            )}

            {editingBody ? (
              <div className="flex flex-col gap-3">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[18px] font-bold"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                />
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={10}
                  className="w-full rounded-md border p-3 font-mono text-[13px] leading-relaxed"
                  style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingBody(false)}
                    className="min-h-[40px] rounded-md border px-3.5 py-1.5 text-[13px]"
                    style={{ borderColor: "var(--border-strong)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveTitleAndDesc}
                    className="min-h-[40px] rounded-md px-4 py-1.5 text-[13px] font-semibold"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                  >
                    Save Markdown
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="m-0 text-[22px] font-bold leading-snug tracking-tight">{ticket.title}</h2>
                <div
                  className="mt-1.5 mb-5 flex items-center gap-1.5 text-[12px]"
                  style={{ color: "var(--ink-3)" }}
                >
                  {isAgentActor(ticket.assignee) && <AgentGlyph size={13} />}
                  <span>
                    {ticket.assignee
                      ? `${displayActor(ticket.assignee)} · updated ${formatRelativeTime(ticket.updatedAt)} ago`
                      : `Unassigned · updated ${formatRelativeTime(ticket.updatedAt)} ago`}
                  </span>
                </div>

                <div className="md-body mb-6">
                  {proseMarkdown ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{proseMarkdown}</ReactMarkdown>
                  ) : (
                    <p style={{ color: "var(--ink-3)" }}>No description yet. Tap Edit to write Markdown.</p>
                  )}
                </div>
              </>
            )}

            {/* Interactive Checklist (44px tap targets on mobile) */}
            {checkTotal > 0 && !editingBody && (
              <section className="mb-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="m-0 text-[14px] font-semibold md:text-[13px]">Checklist</h3>
                  <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                    {checkDone} of {checkTotal} done
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {ticket.checklist.map((item) => (
                    <button
                      key={item.index}
                      type="button"
                      role="checkbox"
                      aria-checked={item.checked}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.toggleChecklist(snapshot.projectId, ticket.id, item.index, !item.checked);
                        })
                      }
                      className="flex min-h-[44px] w-full items-center gap-3 py-2.5 text-left text-[14px] md:min-h-[36px] md:text-[13px]"
                      style={{ borderColor: "var(--border)" }}
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
                      <span
                        style={{
                          color: item.checked ? "var(--ink-3)" : "var(--ink)",
                          textDecoration: item.checked ? "line-through" : "none",
                        }}
                      >
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Mobile 2x2 Properties Grid */}
            <div className="mb-6 md:hidden">{renderProperties(true)}</div>

            {/* Activity & Comments */}
            <section className="border-t pt-5 md:border-t-0 md:pt-0" style={{ borderColor: "var(--border)" }}>
              <h3 className="mb-3 text-[13px] font-semibold">Activity</h3>

              <div className="mb-4 flex flex-col gap-2 text-[12px]">
                {ticket.comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border px-3 py-2"
                    style={{ background: "var(--bg-paper)", borderColor: "var(--border)" }}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold" style={{ color: "var(--ink)" }}>
                        {displayActor(c.author)}
                      </span>
                      <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>
                        {formatRelativeTime(c.createdAt)} ago
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap text-[13px]" style={{ color: "var(--ink)" }}>
                      {c.body}
                    </div>
                  </div>
                ))}

                {ticketEvents.map((ev) => (
                  <div key={ev.id} className="flex items-baseline justify-between gap-4 py-0.5">
                    <span className="truncate" style={{ color: "var(--ink-2)" }}>
                      <strong className="font-semibold" style={{ color: "var(--ink)" }}>
                        {displayActor(ev.actor)}
                      </strong>{" "}
                      {formatEventSummary(ev.type, ev.data)}
                    </span>
                    <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-3)" }}>
                      {formatRelativeTime(ev.at)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Desktop inline comment input */}
              <div
                className="hidden items-center gap-2 rounded-md border px-3 py-2 md:flex"
                style={{ borderColor: "var(--border-input)", background: "var(--bg-card)" }}
              >
                <input
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleCommentSubmit();
                    }
                  }}
                  placeholder="Leave a comment"
                  className="flex-1 bg-transparent text-[13px] outline-none"
                  style={{ color: "var(--ink)" }}
                />
                <button
                  type="button"
                  disabled={busy || !commentDraft.trim()}
                  onClick={handleCommentSubmit}
                  className="text-[11px] disabled:opacity-40"
                  style={{ color: "var(--ink-3)" }}
                >
                  ⌘↵ to send
                </button>
              </div>
            </section>
          </div>

          {/* Desktop right properties rail */}
          <div
            className="hidden w-[216px] shrink-0 border-l px-5 py-6 text-[12px] md:block"
            style={{ borderColor: "var(--border)" }}
          >
            {renderProperties(false)}
          </div>
        </div>

        {/* Mobile sticky footer (comment input + Send to review) */}
        <footer
          className="pb-safe border-t px-4 pt-3 md:hidden"
          style={{ background: "var(--bg-paper)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2.5">
            <input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commentDraft.trim()) {
                  e.preventDefault();
                  void handleCommentSubmit();
                }
              }}
              placeholder="Leave a comment"
              className="min-h-[44px] flex-1 rounded-lg border px-3.5 py-2 outline-none"
              style={{
                background: "var(--bg-card)",
                borderColor: "var(--border-input)",
                color: "var(--ink)",
              }}
            />
            {commentDraft.trim() ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleCommentSubmit}
                className="min-h-[44px] shrink-0 rounded-lg px-4 text-[14px] font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Post
              </button>
            ) : (
              currentCol?.category !== "review" &&
              currentCol?.category !== "done" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSendToReview}
                  className="min-h-[44px] shrink-0 rounded-lg px-4 text-[14px] font-semibold"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  Send to review →
                </button>
              )
            )}
          </div>
          {remainingChecks > 0 && (
            <div className="mt-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
              {remainingChecks} checklist item{remainingChecks === 1 ? "" : "s"} left. You can still send it.
            </div>
          )}
        </footer>

        {/* Desktop pinned footer */}
        <footer
          className="hidden items-center justify-between border-t px-7 py-3.5 md:flex"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {remainingChecks > 0
              ? `${remainingChecks} checklist item${remainingChecks === 1 ? "" : "s"} left before review`
              : `.triathlon/tickets/${ticket.id}.md`}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="rounded-md border px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
            >
              {copiedPrompt ? "Copied" : "Copy agent prompt"}
            </button>
            {currentCol?.category !== "review" && currentCol?.category !== "done" && (
              <button
                type="button"
                disabled={busy}
                onClick={handleSendToReview}
                className="rounded-md px-3.5 py-1.5 text-[13px] font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Send to review →
              </button>
            )}
          </div>
        </footer>
      </aside>

      {/* Launch in T3 Code modal/sheet */}
      {launchOpen && t3Settings && (
        <div
          className="fixed inset-0 z-60 flex items-end justify-center p-0 sm:items-center sm:p-6"
          style={{ background: "var(--scrim)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLaunchOpen(false);
          }}
        >
          <form
            onSubmit={handleConfirmLaunch}
            className="pb-safe w-full max-w-[460px] rounded-t-2xl border p-5 shadow-2xl sm:rounded-md"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="m-0 text-[16px] font-bold">Run {ticket.id} in T3 Code</h3>
              <button type="button" onClick={() => setLaunchOpen(false)} aria-label="Close">
                <CloseIcon size={14} />
              </button>
            </div>
            <p className="mt-0 mb-4 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Starts a new T3 thread in a dedicated git worktree so it can open a clean PR.
            </p>

            {(() => {
              const activeProfile = t3Settings.agents[launchAgent];
              const provider = activeProfile?.provider ?? "claudeAgent";
              const rKey = activeProfile?.reasoningKey ?? "effort";
              const models = MODEL_SUGGESTIONS[provider] ?? [];
              const reasonings = REASONING_OPTIONS[rKey] ?? ["low", "medium", "high"];
              return (
                <div className="flex flex-col gap-3.5">
                  <div>
                    <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                      Agent (from assignee: {ticket.assignee ?? "unassigned"})
                    </label>
                    <select
                      value={launchAgent}
                      onChange={(e) => handleLaunchAgentChange(e.target.value)}
                      className="w-full rounded-md border px-3 py-2 text-[13px]"
                      style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                    >
                      {Object.values(t3Settings.agents).map((a) => (
                        <option key={a.assignee} value={a.assignee}>
                          {a.assignee} — {a.label} ({a.provider})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
                    <div>
                      <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                        Model override
                      </label>
                      <input
                        list="launch-models"
                        value={launchModel}
                        onChange={(e) => setLaunchModel(e.target.value)}
                        className="w-full rounded-md border px-2.5 py-2 font-mono text-[12px]"
                        style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                      />
                      <datalist id="launch-models">
                        {models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                        Reasoning ({rKey})
                      </label>
                      <select
                        value={launchReasoning}
                        onChange={(e) => setLaunchReasoning(e.target.value)}
                        className="w-full rounded-md border px-2.5 py-2 text-[13px]"
                        style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                      >
                        <option value="">Default</option>
                        {reasonings.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                        Worktree base ref (blank = auto)
                      </label>
                      <input
                        value={launchBaseRef}
                        onChange={(e) => setLaunchBaseRef(e.target.value)}
                        placeholder="origin/main"
                        className="w-full rounded-md border px-2.5 py-2 font-mono text-[12px]"
                        style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px]" style={{ color: "var(--ink-3)" }}>
                        New branch name
                      </label>
                      <input
                        value={launchBranch}
                        onChange={(e) => setLaunchBranch(e.target.value)}
                        className="w-full rounded-md border px-2.5 py-2 font-mono text-[12px]"
                        style={{ background: "var(--bg-paper)", borderColor: "var(--border-input)", color: "var(--ink)" }}
                      />
                    </div>
                  </div>

                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLaunchOpen(false)}
                      className="min-h-[40px] rounded-md border px-3.5 text-[13px]"
                      style={{ borderColor: "var(--border-strong)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="min-h-[40px] rounded-md px-4 text-[13px] font-semibold"
                      style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                    >
                      {busy ? "Starting…" : "Start worktree thread"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </form>
        </div>
      )}
    </div>
  );
}

function formatEventSummary(type: string, data?: Record<string, unknown>): string {
  switch (type) {
    case "ticket.created":
      return "created this ticket";
    case "ticket.moved":
      return `moved this to ${String(data?.to ?? "")}`;
    case "ticket.claimed":
      return "claimed this ticket";
    case "ticket.checklist_toggled":
      return `${data?.checked ? "checked" : "unchecked"} “${String(data?.text ?? "item")}”`;
    case "review.requested":
      return "asked for your review";
    case "review.approved":
      return "approved and moved to Done";
    case "review.rejected":
      return "sent this back from review";
    case "ticket.updated":
      return "updated properties";
    case "t3.launched":
      return `started T3 worktree thread (${String(data?.model ?? "")})`;
    case "t3.feedback_sent":
      return "sent review feedback to T3 thread";
    default:
      return type;
  }
}

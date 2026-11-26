import { useState } from "react";
import type { ProjectSnapshot, ProjectSummary, ThemePreference } from "../../core/types.js";
import { displayActor, isAgentActor } from "../../core/types.js";
import {
  AgentGlyph,
  BacklogIcon,
  BoardIcon,
  BrandMark,
  ChevronsUpDownIcon,
  CyclesIcon,
  MetricsIcon,
  MoonIcon,
  ReviewIcon,
  SettingsIcon,
  SunIcon,
} from "./Icons.js";

export type NavView = "board" | "backlog" | "review" | "cycles" | "metrics" | "settings";

interface SidebarProps {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  snapshot: ProjectSnapshot | null;
  view: NavView;
  theme: ThemePreference;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onSelectView: (view: NavView) => void;
  onToggleTheme: (theme: ThemePreference) => void;
  onOpenTicket: (ticketId: string) => void;
}

function shortenPath(fullPath: string): string {
  const homeMatch = fullPath.match(/^\/home\/[^/]+(\/.*)?$/) ?? fullPath.match(/^\/Users\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] ?? ""}` : fullPath;
}

export function Sidebar({
  projects,
  activeProjectId,
  snapshot,
  view,
  theme,
  onSelectProject,
  onAddProject,
  onSelectView,
  onToggleTheme,
  onOpenTicket,
}: SidebarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const backlogColIds = new Set(
    snapshot?.config.columns.filter((c) => c.category === "backlog").map((c) => c.id) ?? ["backlog"],
  );
  const reviewColIds = new Set(
    snapshot?.config.columns.filter((c) => c.category === "review").map((c) => c.id) ?? ["in-review"],
  );
  const startedColIds = new Set(
    snapshot?.config.columns.filter((c) => c.category === "started").map((c) => c.id) ?? ["in-progress"],
  );

  const backlogCount =
    snapshot?.tickets.filter((t) => t.triage === "proposed" || (t.triage === "accepted" && backlogColIds.has(t.status)))
      .length ?? 0;

  const reviewWaitingCount =
    snapshot?.tickets.filter(
      (t) => t.triage === "accepted" && (reviewColIds.has(t.status) || t.review.state === "pending"),
    ).length ?? 0;

  // Active agents currently holding In Progress tickets
  const activeAgentWork = (snapshot?.tickets ?? [])
    .filter((t) => t.triage === "accepted" && startedColIds.has(t.status) && isAgentActor(t.assignee))
    .reduce<Map<string, string>>((acc, t) => {
      const name = displayActor(t.assignee);
      if (!acc.has(name)) acc.set(name, t.id);
      return acc;
    }, new Map());

  const navItems: {
    id: NavView;
    label: string;
    icon: typeof BoardIcon;
    badge?: string;
    badgeAccent?: boolean;
  }[] = [
    { id: "board", label: "Board", icon: BoardIcon },
    { id: "backlog", label: "Backlog", icon: BacklogIcon, badge: backlogCount > 0 ? String(backlogCount) : undefined },
    {
      id: "review",
      label: "Review",
      icon: ReviewIcon,
      badge: reviewWaitingCount > 0 ? `${reviewWaitingCount} waiting` : undefined,
      badgeAccent: reviewWaitingCount > 0,
    },
    { id: "cycles", label: "Cycles", icon: CyclesIcon },
    { id: "metrics", label: "Metrics", icon: MetricsIcon },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <aside
      className="hidden h-full w-[232px] shrink-0 flex-col border-r md:flex"
      style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <BrandMark size={16} className="shrink-0" />
        <span className="text-[14px] font-bold tracking-tight">Triathlon</span>
      </div>

      {/* Project switcher */}
      <div className="relative px-5 pb-4">
        <div className="eyebrow mb-1.5">Project</div>
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="group flex w-full items-center justify-between rounded-md py-1 text-left transition-colors"
          aria-expanded={pickerOpen}
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              {activeProject?.name ?? "No project"}
            </div>
            <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
              {activeProject ? shortenPath(activeProject.path) : "Add a local repo"}
            </div>
          </div>
          <ChevronsUpDownIcon size={14} className="shrink-0 opacity-60 group-hover:opacity-100" />
        </button>

        {pickerOpen && (
          <div
            className="absolute left-3 right-3 top-full z-40 mt-1 rounded-md border py-1.5 shadow-lg"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
          >
            {projects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                onClick={() => {
                  onSelectProject(proj.id);
                  setPickerOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:opacity-100"
                style={{
                  background: proj.id === activeProjectId ? "var(--bg-active)" : "transparent",
                }}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    <span className="mr-1.5 font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {proj.key}
                    </span>
                    {proj.name}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {shortenPath(proj.path)}
                  </div>
                </div>
                {proj.reviewWaitingCount > 0 && (
                  <span
                    className="ml-2 shrink-0 text-[11px] font-semibold tabular-nums"
                    style={{ color: "var(--accent)" }}
                  >
                    {proj.reviewWaitingCount}
                  </span>
                )}
              </button>
            ))}
            <div className="my-1.5 h-px" style={{ background: "var(--border)" }} />
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                onAddProject();
              }}
              className="w-full px-3 py-1.5 text-left text-[12px] font-medium"
              style={{ color: "var(--ink-2)" }}
            >
              + Add or initialize local repo…
            </button>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 px-3" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[13px] transition-colors"
              style={{
                background: active ? "var(--bg-active)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-2)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-2.5">
                <span style={{ color: active ? "var(--accent)" : "var(--ink-2)" }}>
                  <Icon size={15} />
                </span>
                <span>{item.label}</span>
              </span>
              {item.badge && (
                <span
                  className="text-[12px] font-medium tabular-nums"
                  style={{ color: item.badgeAccent ? "var(--accent)" : "var(--ink-3)" }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Active agents */}
      <div className="px-5 pb-4">
        <div className="eyebrow mb-2">Agents</div>
        {activeAgentWork.size === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            None active
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {[...activeAgentWork.entries()].map(([agentName, ticketId]) => (
              <button
                key={agentName}
                type="button"
                onClick={() => onOpenTicket(ticketId)}
                className="flex w-full items-center justify-between text-left text-[12px] hover:underline"
              >
                <span className="flex items-center gap-2" style={{ color: "var(--ink)" }}>
                  <AgentGlyph size={14} className="opacity-75" />
                  <span>{agentName}</span>
                </span>
                <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>
                  on {ticketId}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer: owner + Light/Dark toggle */}
      <div
        className="flex items-center justify-between border-t px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="truncate text-[12px]" style={{ color: "var(--ink-2)" }}>
          {snapshot?.config.owner ?? "Local"}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Color theme">
          <button
            type="button"
            onClick={() => onToggleTheme("light")}
            aria-label="Light theme"
            aria-pressed={theme === "light"}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{
              background: theme === "light" ? "var(--bg-active)" : "transparent",
              color: theme === "light" ? "var(--ink)" : "var(--ink-3)",
            }}
          >
            <SunIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => onToggleTheme("dark")}
            aria-label="Dark theme"
            aria-pressed={theme === "dark"}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{
              background: theme === "dark" ? "var(--bg-active)" : "transparent",
              color: theme === "dark" ? "var(--ink)" : "var(--ink-3)",
            }}
          >
            <MoonIcon size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

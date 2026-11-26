import { useState } from "react";
import type { ProjectSnapshot, ProjectSummary, ThemePreference } from "../../core/types.js";
import {
  BacklogIcon,
  BoardIcon,
  ChevronRightIcon,
  CyclesIcon,
  MetricsIcon,
  MoreIcon,
  ReviewIcon,
  SettingsIcon,
} from "./Icons.js";
import type { NavView } from "./Sidebar.js";

function shortenPath(fullPath: string): string {
  const homeMatch = fullPath.match(/^\/home\/[^/]+(\/.*)?$/) ?? fullPath.match(/^\/Users\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] ?? ""}` : fullPath;
}

interface MobileTabBarProps {
  snapshot: ProjectSnapshot | null;
  view: NavView;
  onSelectView: (view: NavView) => void;
  onOpenMore: () => void;
}

export function MobileTabBar({ snapshot, view, onSelectView, onOpenMore }: MobileTabBarProps) {
  const backlogColIds = new Set(
    snapshot?.config.columns.filter((c) => c.category === "backlog").map((c) => c.id) ?? ["backlog"],
  );
  const reviewColIds = new Set(
    snapshot?.config.columns.filter((c) => c.category === "review").map((c) => c.id) ?? ["in-review"],
  );

  const backlogCount =
    snapshot?.tickets.filter(
      (t) => t.triage === "proposed" || (t.triage === "accepted" && backlogColIds.has(t.status)),
    ).length ?? 0;

  const reviewWaitingCount =
    snapshot?.tickets.filter(
      (t) => t.triage === "accepted" && (reviewColIds.has(t.status) || t.review.state === "pending"),
    ).length ?? 0;

  const isMoreActive = view === "cycles" || view === "settings";

  const tabs: {
    id: NavView | "more";
    label: string;
    icon: typeof BoardIcon;
    count?: number;
    accentCount?: boolean;
  }[] = [
    { id: "board", label: "Board", icon: BoardIcon },
    { id: "backlog", label: "Backlog", icon: BacklogIcon, count: backlogCount },
    { id: "review", label: "Review", icon: ReviewIcon, count: reviewWaitingCount, accentCount: true },
    { id: "metrics", label: "Metrics", icon: MetricsIcon },
    { id: "more", label: "More", icon: MoreIcon },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="pb-safe flex shrink-0 items-stretch border-t md:hidden"
      style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === "more" ? isMoreActive : view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => (tab.id === "more" ? onOpenMore() : onSelectView(tab.id))}
            className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1 text-[11px]"
            style={{
              color: active ? "var(--ink)" : "var(--ink-2)",
              fontWeight: active ? 600 : 400,
            }}
          >
            <span className="relative inline-flex items-center justify-center">
              <Icon size={18} />
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="absolute -right-3.5 -top-1.5 text-[11px] font-semibold leading-none tabular-nums"
                  style={{ color: tab.accentCount ? "var(--accent)" : "var(--ink-2)" }}
                >
                  {tab.count}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

interface MoreBottomSheetProps {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  theme: ThemePreference;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onSelectTheme: (theme: ThemePreference) => void;
  onSelectView: (view: NavView) => void;
}

export function MoreBottomSheet({
  projects,
  activeProjectId,
  theme,
  onClose,
  onSelectProject,
  onAddProject,
  onSelectTheme,
  onSelectView,
}: MoreBottomSheetProps) {
  const [switchingProject, setSwitchingProject] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:hidden"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="pb-safe w-full rounded-t-2xl border-t px-5 pt-3 shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
        role="dialog"
        aria-modal="true"
        aria-label="More options"
      >
        {/* Drag handle */}
        <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ background: "var(--border-strong)" }} />

        {/* Project row */}
        <div className="pb-4">
          <button
            type="button"
            onClick={() => setSwitchingProject((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between text-left"
          >
            <div className="min-w-0 pr-3">
              <div className="truncate text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
                {activeProject?.name ?? "No project"}
              </div>
              <div className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                {activeProject ? shortenPath(activeProject.path) : "Add a local repo"} · {projects.length} project
                {projects.length === 1 ? "" : "s"}
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
              <span>{switchingProject ? "Done" : "Switch"}</span>
              <ChevronRightIcon size={14} />
            </span>
          </button>

          {switchingProject && (
            <div className="mt-3 flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelectProject(p.id);
                    onClose();
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-md px-3 text-left text-[14px]"
                  style={{
                    background: p.id === activeProjectId ? "var(--bg-active)" : "transparent",
                    color: "var(--ink)",
                  }}
                >
                  <span className="truncate font-medium">
                    <span className="mr-2 font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {p.key}
                    </span>
                    {p.name}
                  </span>
                  {p.reviewWaitingCount > 0 && (
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
                      {p.reviewWaitingCount}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddProject();
                }}
                className="flex min-h-[44px] w-full items-center px-3 text-left text-[13px] font-medium"
                style={{ color: "var(--accent)" }}
              >
                + Add or initialize local repo…
              </button>
            </div>
          )}
        </div>

        <div className="h-px w-full" style={{ background: "var(--border)" }} />

        {/* Theme segmented control */}
        <div className="flex min-h-[56px] items-center justify-between gap-4 py-3">
          <span className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Theme
          </span>
          <div
            className="grid grid-cols-3 rounded-lg border p-0.5"
            style={{ background: "var(--bg-paper)", borderColor: "var(--border-strong)" }}
            role="group"
            aria-label="Color theme"
          >
            {(["light", "dark", "system"] as ThemePreference[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onSelectTheme(opt)}
                aria-pressed={theme === opt}
                className="min-h-[36px] min-w-[68px] rounded-md px-3 text-[13px] capitalize transition-colors"
                style={{
                  background: theme === opt ? "var(--bg-active)" : "transparent",
                  color: theme === opt ? "var(--ink)" : "var(--ink-2)",
                  fontWeight: theme === opt ? 600 : 400,
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px w-full" style={{ background: "var(--border)" }} />

        {/* Cycles + Settings */}
        <div className="grid grid-cols-2 gap-2 py-2">
          <button
            type="button"
            onClick={() => {
              onSelectView("cycles");
              onClose();
            }}
            className="flex min-h-[48px] items-center gap-2.5 rounded-md px-2 text-[14px] font-medium"
            style={{ color: "var(--ink)" }}
          >
            <CyclesIcon size={16} />
            <span>Cycles</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectView("settings");
              onClose();
            }}
            className="flex min-h-[48px] items-center gap-2.5 rounded-md px-2 text-[14px] font-medium"
            style={{ color: "var(--ink)" }}
          >
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

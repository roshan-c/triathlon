import { useCallback, useEffect, useState } from "react";
import type { ProjectSnapshot, ProjectSummary, ThemePreference } from "../core/types.js";
import { BacklogView } from "./components/BacklogView.js";
import { BoardView } from "./components/BoardView.js";
import { CyclesView } from "./components/CyclesView.js";
import { MetricsView } from "./components/MetricsView.js";
import { MobileTabBar, MoreBottomSheet } from "./components/MobileNav.js";
import { AddProjectModal, CommandPalette, NewTicketModal } from "./components/Modals.js";
import { ReviewInboxView } from "./components/ReviewInboxView.js";
import { SettingsView } from "./components/SettingsView.js";
import { type NavView, Sidebar } from "./components/Sidebar.js";
import { TicketDrawer } from "./components/TicketDrawer.js";
import { api } from "./lib/api.js";

function applyResolvedTheme(pref: ThemePreference) {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  document.documentElement.dataset.theme = resolved;
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [view, setView] = useState<NavView>("board");
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null);
  const [newTicketStatus, setNewTicketStatus] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async (preferredId?: string | null) => {
    const res = await api.getProjects();
    setProjects(res.projects);
    setTheme(res.theme);
    applyResolvedTheme(res.theme);
    const valid = res.projects.filter((p) => p.exists);
    const chosen =
      (preferredId && valid.find((p) => p.id === preferredId)?.id) ??
      (res.lastProjectId && valid.find((p) => p.id === res.lastProjectId)?.id) ??
      valid[0]?.id ??
      null;
    setActiveProjectId(chosen);
    return chosen;
  }, []);

  const loadSnapshot = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    const snap = await api.getSnapshot(projectId);
    setSnapshot(snap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadProjects().then((id) => loadSnapshot(id));
  }, [loadProjects, loadSnapshot]);

  // Listen to OS color-scheme changes when theme === "system"
  useEffect(() => {
    applyResolvedTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyResolvedTheme("system");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme]);

  // Live SSE watcher subscription
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("board-update", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { projectId?: string };
        void loadProjects(activeProjectId);
        if (activeProjectId && (!data.projectId || data.projectId === activeProjectId)) {
          void loadSnapshot(activeProjectId);
        }
      } catch {
        // ignore parse issues
      }
    });
    return () => source.close();
  }, [activeProjectId, loadProjects, loadSnapshot]);

  // Global keyboard shortcuts (⌘K, c)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && snapshot && !openTicketId && !showPalette) {
        e.preventDefault();
        setNewTicketStatus(snapshot.config.columns[1]?.id ?? snapshot.config.columns[0].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot, openTicketId, showPalette]);

  const handleSelectProject = async (id: string) => {
    setActiveProjectId(id);
    setOpenTicketId(null);
    setReviewTicketId(null);
    await loadSnapshot(id);
  };

  const handleToggleTheme = async (next: ThemePreference) => {
    setTheme(next);
    applyResolvedTheme(next);
    await api.updatePreferences({ theme: next });
  };

  const handleRefresh = async () => {
    await Promise.all([loadProjects(activeProjectId), loadSnapshot(activeProjectId)]);
  };

  const handleMoveTicket = async (ticketId: string, toColumnId: string, rank?: number) => {
    if (!snapshot) return;
    const prevSnapshot = snapshot;
    const nextRank =
      rank ??
      snapshot.tickets
        .filter((t) => t.status === toColumnId && t.id !== ticketId)
        .reduce((max, t) => Math.max(max, t.rank), 0) + 1000;

    // Optimistic update so the card lands immediately without snapping back
    setSnapshot({
      ...snapshot,
      tickets: snapshot.tickets.map((t) =>
        t.id === ticketId
          ? { ...t, status: toColumnId, rank: nextRank, updatedAt: new Date().toISOString() }
          : t,
      ),
    });

    try {
      await api.moveTicket(snapshot.projectId, ticketId, toColumnId, nextRank);
      await handleRefresh();
    } catch (error) {
      setSnapshot(prevSnapshot);
      throw error;
    }
  };

  const openTicket = openTicketId && snapshot ? snapshot.tickets.find((t) => t.id === openTicketId) ?? null : null;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden md:flex-row">
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        snapshot={snapshot}
        view={view}
        theme={theme}
        onSelectProject={(id) => void handleSelectProject(id)}
        onAddProject={() => setShowAddProject(true)}
        onSelectView={(v) => {
          setReviewTicketId(null);
          setView(v);
        }}
        onToggleTheme={(t) => void handleToggleTheme(t)}
        onOpenTicket={(id) => setOpenTicketId(id)}
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden" style={{ background: "var(--bg-paper)" }}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "var(--ink-3)" }}>
            Loading workbench…
          </div>
        ) : !snapshot ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <h1 className="m-0 mb-2 text-[22px] font-bold">No Triathlon projects registered</h1>
            <p className="m-0 mb-6 max-w-[420px] text-[13px]" style={{ color: "var(--ink-2)" }}>
              Initialize a repository with <code>tri init</code> in your terminal or register a local folder directly
              from here.
            </p>
            <button
              type="button"
              onClick={() => setShowAddProject(true)}
              className="min-h-[44px] rounded-lg px-4 py-2 text-[14px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              + Add local repository
            </button>
          </div>
        ) : (
          <>
            {view === "board" && (
              <BoardView
                snapshot={snapshot}
                onOpenTicket={(id) => setOpenTicketId(id)}
                onNewTicket={(status) =>
                  setNewTicketStatus(status ?? snapshot.config.columns[1]?.id ?? snapshot.config.columns[0].id)
                }
                onMoveTicket={handleMoveTicket}
                onOpenSearch={() => setShowPalette(true)}
                onOpenMore={() => setShowMoreSheet(true)}
                onOpenReview={(ticketId) => {
                  setReviewTicketId(ticketId ?? null);
                  setView("review");
                }}
              />
            )}
            {view === "backlog" && (
              <BacklogView
                snapshot={snapshot}
                onOpenTicket={(id) => setOpenTicketId(id)}
                onNewTicket={(status) => setNewTicketStatus(status ?? "backlog")}
                onOpenSearch={() => setShowPalette(true)}
                onRefresh={handleRefresh}
              />
            )}
            {view === "review" && (
              <ReviewInboxView
                snapshot={snapshot}
                initialTicketId={reviewTicketId}
                onRefresh={handleRefresh}
                onOpenTicket={(id) => setOpenTicketId(id)}
              />
            )}
            {view === "cycles" && <CyclesView snapshot={snapshot} onRefresh={handleRefresh} />}
            {view === "metrics" && <MetricsView snapshot={snapshot} />}
            {view === "settings" && (
              <SettingsView
                snapshot={snapshot}
                onRefresh={handleRefresh}
                onUnregister={async () => {
                  await api.unregisterProject(snapshot.projectId);
                  const nextId = await loadProjects(null);
                  await loadSnapshot(nextId);
                }}
              />
            )}
          </>
        )}
      </main>

      <MobileTabBar
        snapshot={snapshot}
        view={view}
        onSelectView={(v) => {
          setReviewTicketId(null);
          setView(v);
        }}
        onOpenMore={() => setShowMoreSheet(true)}
      />

      {showMoreSheet && (
        <MoreBottomSheet
          projects={projects}
          activeProjectId={activeProjectId}
          theme={theme}
          onClose={() => setShowMoreSheet(false)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onAddProject={() => setShowAddProject(true)}
          onSelectTheme={(t) => void handleToggleTheme(t)}
          onSelectView={(v) => {
            setReviewTicketId(null);
            setView(v);
          }}
        />
      )}

      {openTicket && snapshot && (
        <TicketDrawer
          snapshot={snapshot}
          ticket={openTicket}
          onClose={() => setOpenTicketId(null)}
          onRefresh={handleRefresh}
          onSelectTicket={(id) => setOpenTicketId(id)}
        />
      )}

      {newTicketStatus !== null && snapshot && (
        <NewTicketModal
          snapshot={snapshot}
          defaultStatus={newTicketStatus}
          onClose={() => setNewTicketStatus(null)}
          onCreated={handleRefresh}
        />
      )}

      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onAdded={async (id) => {
            const chosen = await loadProjects(id);
            await loadSnapshot(chosen);
          }}
        />
      )}

      {showPalette && (
        <CommandPalette
          projects={projects}
          snapshot={snapshot}
          onClose={() => setShowPalette(false)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onSelectView={(v) => {
            setReviewTicketId(null);
            setView(v);
          }}
          onOpenTicket={(id) => setOpenTicketId(id)}
          onNewTicket={() =>
            snapshot && setNewTicketStatus(snapshot.config.columns[1]?.id ?? snapshot.config.columns[0].id)
          }
        />
      )}
    </div>
  );
}

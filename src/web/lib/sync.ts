import { useSyncExternalStore } from "react";
import type { ProjectSnapshot, ProjectSummary, ThemePreference } from "../../core/types.js";
import { api } from "./api.js";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export interface T3LiveStatusMap {
  [ticketId: string]: {
    threadId: string;
    status: string;
    checkedAt: string;
  };
}

interface SyncProjectsPayload {
  theme: ThemePreference;
  lastProjectId: string | null;
  projects: ProjectSummary[];
}

type SyncFrame =
  | { seq: number; at: string; kind: "projects"; payload: SyncProjectsPayload }
  | { seq: number; at: string; kind: "snapshot"; projectId: string; payload: ProjectSnapshot }
  | { seq: number; at: string; kind: "t3_status"; projectId: string; payload: T3LiveStatusMap };

export interface SyncStoreState {
  connection: ConnectionState;
  lastSeq: number;
  lastSyncedAt: string | null;
  theme: ThemePreference;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  snapshots: Record<string, ProjectSnapshot>;
  t3Status: Record<string, T3LiveStatusMap>;
  loading: boolean;
}

const CACHE_KEY = "triathlon:sync-cache:v1";

function loadCachedState(): Partial<SyncStoreState> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SyncStoreState>;
    return {
      theme: parsed.theme ?? "light",
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      activeProjectId: parsed.activeProjectId ?? null,
      snapshots: parsed.snapshots && typeof parsed.snapshots === "object" ? parsed.snapshots : {},
    };
  } catch {
    return {};
  }
}

function saveCache(state: SyncStoreState): void {
  try {
    const activeSnap = state.activeProjectId ? state.snapshots[state.activeProjectId] : null;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        theme: state.theme,
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        snapshots: activeSnap && state.activeProjectId ? { [state.activeProjectId]: activeSnap } : {},
      }),
    );
  } catch {
    // Ignore storage quota issues
  }
}

class TriathlonSyncClient {
  private state: SyncStoreState;
  private listeners = new Set<() => void>();
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private inFlightMutations = 0;

  constructor() {
    const cached = loadCachedState();
    this.state = {
      connection: "connecting",
      lastSeq: 0,
      lastSyncedAt: null,
      theme: cached.theme ?? "light",
      projects: cached.projects ?? [],
      activeProjectId: cached.activeProjectId ?? null,
      snapshots: cached.snapshots ?? {},
      t3Status: {},
      loading: !cached.activeProjectId || !cached.snapshots?.[cached.activeProjectId],
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.started) this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SyncStoreState => this.state;

  private setState(updater: (prev: SyncStoreState) => SyncStoreState): void {
    this.state = updater(this.state);
    saveCache(this.state);
    for (const listener of this.listeners) listener();
  }

  private start(): void {
    this.started = true;
    this.connect();

    // iOS PWA / background tab resume & network recovery: reconnect immediately!
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      if (!navigator.onLine) {
        this.setState((s) => ({ ...s, connection: "offline" }));
        return;
      }
      this.reconnectNow();
    };
    const onOffline = () => {
      this.setState((s) => ({ ...s, connection: "offline" }));
    };

    window.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("offline", onOffline);
  }

  private connect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const params = new URLSearchParams();
    if (this.state.lastSeq > 0) params.set("since", String(this.state.lastSeq));
    if (this.state.activeProjectId) params.set("projectId", this.state.activeProjectId);

    const es = new EventSource(`/api/sync?${params.toString()}`);
    this.eventSource = es;

    es.addEventListener("sync_init", (ev) => {
      this.reconnectAttempt = 0;
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          seq: number;
          at: string;
          projects: SyncProjectsPayload;
          snapshot: ProjectSnapshot | null;
          t3Status?: T3LiveStatusMap;
        };
        this.applyProjectsPayload(data.projects, data.seq, data.at, data.snapshot, data.t3Status);
      } catch {
        // ignore
      }
    });

    es.addEventListener("sync_ready", (ev) => {
      this.reconnectAttempt = 0;
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { seq: number; at: string };
        this.setState((s) => ({
          ...s,
          connection: "live",
          lastSeq: Math.max(s.lastSeq, data.seq),
          lastSyncedAt: data.at,
          loading: false,
        }));
      } catch {
        // ignore
      }
    });

    es.addEventListener("sync", (ev) => {
      this.reconnectAttempt = 0;
      try {
        const frame = JSON.parse((ev as MessageEvent).data) as SyncFrame;
        this.applyFrame(frame);
      } catch {
        // ignore
      }
    });

    es.addEventListener("ping", () => {
      if (this.state.connection !== "live") {
        this.setState((s) => ({ ...s, connection: "live" }));
      }
    });

    es.onerror = () => {
      es.close();
      if (this.eventSource === es) this.eventSource = null;
      if (!navigator.onLine) {
        this.setState((s) => ({ ...s, connection: "offline" }));
        return;
      }
      this.setState((s) => ({ ...s, connection: "reconnecting" }));
      const delay = Math.min(8000, 1000 * 2 ** this.reconnectAttempt);
      this.reconnectAttempt += 1;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };
  }

  reconnectNow(): void {
    this.reconnectAttempt = 0;
    this.connect();
  }

  private applyProjectsPayload(
    payload: SyncProjectsPayload,
    seq: number,
    at: string,
    initialSnapshot?: ProjectSnapshot | null,
    initialT3?: T3LiveStatusMap,
  ): void {
    this.setState((s) => {
      const valid = payload.projects.filter((p) => p.exists);
      const chosen =
        (s.activeProjectId && valid.find((p) => p.id === s.activeProjectId)?.id) ??
        (payload.lastProjectId && valid.find((p) => p.id === payload.lastProjectId)?.id) ??
        valid[0]?.id ??
        null;

      const nextSnapshots = { ...s.snapshots };
      if (initialSnapshot) {
        nextSnapshots[initialSnapshot.projectId] = initialSnapshot;
      }
      const nextT3 = { ...s.t3Status };
      if (initialSnapshot && initialT3) {
        nextT3[initialSnapshot.projectId] = initialT3;
      }

      return {
        ...s,
        connection: "live",
        lastSeq: Math.max(s.lastSeq, seq),
        lastSyncedAt: at,
        theme: payload.theme,
        projects: payload.projects,
        activeProjectId: chosen,
        snapshots: nextSnapshots,
        t3Status: nextT3,
        loading: false,
      };
    });
  }

  private applyFrame(frame: SyncFrame): void {
    if (frame.kind === "projects") {
      this.applyProjectsPayload(frame.payload, frame.seq, frame.at);
      return;
    }
    if (frame.kind === "snapshot") {
      // Avoid clobbering an optimistic local write while its HTTP request is still in-flight
      if (this.inFlightMutations > 0) {
        this.setState((s) => ({ ...s, lastSeq: Math.max(s.lastSeq, frame.seq), lastSyncedAt: frame.at }));
        return;
      }
      this.setState((s) => ({
        ...s,
        connection: "live",
        lastSeq: Math.max(s.lastSeq, frame.seq),
        lastSyncedAt: frame.at,
        snapshots: { ...s.snapshots, [frame.projectId]: frame.payload },
        loading: false,
      }));
      return;
    }
    if (frame.kind === "t3_status") {
      this.setState((s) => ({
        ...s,
        lastSeq: Math.max(s.lastSeq, frame.seq),
        t3Status: { ...s.t3Status, [frame.projectId]: frame.payload },
      }));
    }
  }

  async selectProject(projectId: string | null): Promise<void> {
    this.setState((s) => ({ ...s, activeProjectId: projectId }));
    if (!projectId) return;
    const snap = await api.getSnapshot(projectId);
    this.setState((s) => ({
      ...s,
      activeProjectId: projectId,
      snapshots: { ...s.snapshots, [projectId]: snap },
      loading: false,
    }));
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    const prev = this.state.theme;
    this.setState((s) => ({ ...s, theme }));
    try {
      await api.updatePreferences({ theme });
    } catch (err) {
      this.setState((s) => ({ ...s, theme: prev }));
      throw err;
    }
  }

  async refreshActive(): Promise<void> {
    const [projRes, snap] = await Promise.all([
      api.getProjects(),
      this.state.activeProjectId ? api.getSnapshot(this.state.activeProjectId) : Promise.resolve(null),
    ]);
    this.applyProjectsPayload(projRes, this.state.lastSeq, new Date().toISOString(), snap);
  }

  // TanStack DB–style optimistic mutation with automatic rollback on server error
  async mutateOptimistic<T>(
    projectId: string,
    applyDraft: (snap: ProjectSnapshot) => ProjectSnapshot,
    persist: () => Promise<T>,
  ): Promise<T> {
    const prevSnap = this.state.snapshots[projectId];
    if (prevSnap) {
      this.setState((s) => ({
        ...s,
        snapshots: { ...s.snapshots, [projectId]: applyDraft(prevSnap) },
      }));
    }
    this.inFlightMutations += 1;
    try {
      const result = await persist();
      this.inFlightMutations = Math.max(0, this.inFlightMutations - 1);
      // Reconcile cleanly with authoritative server state
      await this.refreshActive();
      return result;
    } catch (error) {
      this.inFlightMutations = Math.max(0, this.inFlightMutations - 1);
      if (prevSnap) {
        this.setState((s) => ({
          ...s,
          snapshots: { ...s.snapshots, [projectId]: prevSnap },
        }));
      }
      throw error;
    }
  }
}

export const syncClient = new TriathlonSyncClient();

export function useSyncStore(): SyncStoreState {
  return useSyncExternalStore(syncClient.subscribe, syncClient.getState, syncClient.getState);
}

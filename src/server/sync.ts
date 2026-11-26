import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import { inspectPrForBranch, mergePrWithGh } from "../core/github.js";
import { ProjectStore } from "../core/project.js";
import { getRegistryPath, readRegistry } from "../core/registry.js";
import { configPath, pathExists, readAllTickets, readConfig, readCycles, triathlonDir, writeTicket } from "../core/storage.js";
import { getT3ThreadStatus } from "../core/t3.js";
import type { ProjectSnapshot, ProjectSummary, RegisteredProject, ThemePreference } from "../core/types.js";

export interface SyncProjectsPayload {
  theme: ThemePreference;
  lastProjectId: string | null;
  projects: ProjectSummary[];
}

export interface T3LiveStatusMap {
  [ticketId: string]: {
    threadId: string;
    status: string;
    checkedAt: string;
  };
}

export type SyncFrameInput =
  | { kind: "projects"; payload: SyncProjectsPayload }
  | { kind: "snapshot"; projectId: string; payload: ProjectSnapshot }
  | { kind: "t3_status"; projectId: string; payload: T3LiveStatusMap };

export type SyncFrame = SyncFrameInput & { seq: number; at: string };

export async function buildProjectSummaries(): Promise<SyncProjectsPayload> {
  const registry = await readRegistry();
  const summaries: ProjectSummary[] = await Promise.all(
    registry.projects.map(async (proj) => {
      const exists = await pathExists(configPath(proj.path));
      if (!exists) {
        return {
          ...proj,
          exists: false,
          reviewWaitingCount: 0,
          backlogCount: 0,
          activeCycleName: null,
        };
      }
      try {
        const [config, tickets, cyclesFile] = await Promise.all([
          readConfig(proj.path),
          readAllTickets(proj.path),
          readCycles(proj.path),
        ]);
        const reviewColIds = new Set(config.columns.filter((c) => c.category === "review").map((c) => c.id));
        const backlogColIds = new Set(config.columns.filter((c) => c.category === "backlog").map((c) => c.id));
        const reviewWaitingCount = tickets.filter(
          (t) => t.triage === "accepted" && (reviewColIds.has(t.status) || t.review.state === "pending"),
        ).length;
        const backlogCount = tickets.filter(
          (t) => t.triage === "proposed" || (t.triage === "accepted" && backlogColIds.has(t.status)),
        ).length;
        const activeCycle = cyclesFile.cycles.find((c) => c.state === "active");
        return {
          ...proj,
          key: config.key,
          name: config.name,
          exists: true,
          reviewWaitingCount,
          backlogCount,
          activeCycleName: activeCycle ? `Cycle ${activeCycle.number} · ${activeCycle.name}` : null,
        };
      } catch {
        return {
          ...proj,
          exists: false,
          reviewWaitingCount: 0,
          backlogCount: 0,
          activeCycleName: null,
        };
      }
    }),
  );

  return {
    theme: registry.theme,
    lastProjectId: registry.lastProjectId,
    projects: summaries,
  };
}

export class SyncEngine extends EventEmitter {
  private seq = 0;
  private history: SyncFrame[] = [];
  private readonly maxHistory = 120;
  private projectWatchers = new Map<string, { path: string; watcher: FSWatcher }>();
  private registryWatcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private subscriberCount = 0;
  private t3PollTimer: NodeJS.Timeout | null = null;
  private ciPollTimer: NodeJS.Timeout | null = null;
  private t3StatusCache = new Map<string, T3LiveStatusMap>();
  private started = false;

  get currentSeq(): number {
    return this.seq;
  }

  getCachedT3Status(projectId: string): T3LiveStatusMap {
    return this.t3StatusCache.get(projectId) ?? {};
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Watch ~/.triathlon/registry.json so `tri init` / `tri register` from any terminal syncs live!
    const regPath = getRegistryPath();
    this.registryWatcher = chokidar.watch(regPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 25 },
    });
    const onRegChange = () => {
      this.schedule("registry", async () => {
        const reg = await readRegistry();
        this.syncProjectWatchers(reg.projects);
        await this.publishProjects();
      });
    };
    this.registryWatcher.on("add", onRegChange);
    this.registryWatcher.on("change", onRegChange);
    this.registryWatcher.on("error", () => {});

    void readRegistry()
      .then((reg) => this.syncProjectWatchers(reg.projects))
      .catch(() => {});

    // Always watch any tickets queued with `mergeState === "waiting_ci"` (even if no browser tab is open!)
    if (!this.ciPollTimer) {
      this.ciPollTimer = setInterval(() => {
        void this.pollWaitingCiMerges();
      }, 15_000);
    }
  }

  syncProjectWatchers(projects: RegisteredProject[]): void {
    const activeIds = new Set(projects.map((p) => p.id));

    for (const [id, entry] of this.projectWatchers.entries()) {
      if (!activeIds.has(id)) {
        void entry.watcher.close();
        this.projectWatchers.delete(id);
      }
    }

    for (const proj of projects) {
      if (this.projectWatchers.has(proj.id)) continue;
      const target = triathlonDir(proj.path);
      const watcher = chokidar.watch(target, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
        ignored: /\.tmp$/,
      });

      const onFileChange = () => {
        this.schedule(`proj:${proj.id}`, async () => {
          await this.publishProjectChange(proj.id, proj.path);
        });
      };

      watcher.on("add", onFileChange);
      watcher.on("change", onFileChange);
      watcher.on("unlink", onFileChange);
      watcher.on("error", () => {});

      this.projectWatchers.set(proj.id, { path: proj.path, watcher });
    }
  }

  private schedule(key: string, fn: () => Promise<void>, delayMs = 60): void {
    const prev = this.debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      void fn().catch(() => {});
    }, delayMs);
    this.debounceTimers.set(key, timer);
  }

  private pushFrame(frameWithoutSeq: SyncFrameInput): SyncFrame {
    this.seq += 1;
    const frame = {
      ...frameWithoutSeq,
      seq: this.seq,
      at: new Date().toISOString(),
    } as SyncFrame;
    this.history.push(frame);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.emit("frame", frame);
    return frame;
  }

  async publishProjects(): Promise<SyncFrame> {
    const payload = await buildProjectSummaries();
    this.syncProjectWatchers(payload.projects.filter((p) => p.exists));
    return this.pushFrame({ kind: "projects", payload });
  }

  async publishProjectChange(projectId: string, projectPath?: string): Promise<void> {
    let targetPath = projectPath ?? this.projectWatchers.get(projectId)?.path;
    if (!targetPath) {
      const reg = await readRegistry();
      targetPath = reg.projects.find((p) => p.id === projectId)?.path;
    }
    if (targetPath && (await pathExists(configPath(targetPath)))) {
      const store = new ProjectStore(targetPath);
      const snapshot = await store.getSnapshot();
      this.pushFrame({ kind: "snapshot", projectId, payload: snapshot });
    }
    await this.publishProjects();
  }

  getFramesSince(sinceSeq: number): { frames: SyncFrame[]; needsResync: boolean } {
    if (sinceSeq <= 0) return { frames: [], needsResync: true };
    if (sinceSeq >= this.seq) return { frames: [], needsResync: false };
    const oldest = this.history[0]?.seq ?? this.seq + 1;
    if (sinceSeq < oldest - 1) {
      return { frames: [], needsResync: true };
    }
    return {
      frames: this.history.filter((f) => f.seq > sinceSeq),
      needsResync: false,
    };
  }

  onClientConnected(): void {
    this.start();
    this.subscriberCount += 1;
    if (this.subscriberCount === 1 && !this.t3PollTimer) {
      // Lightly poll live T3 thread status for active in-progress tickets while a client is watching
      this.t3PollTimer = setInterval(() => {
        void this.pollActiveT3Threads();
      }, 12_000);
    }
  }

  onClientDisconnected(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0 && this.t3PollTimer) {
      clearInterval(this.t3PollTimer);
      this.t3PollTimer = null;
    }
  }

  private async pollActiveT3Threads(): Promise<void> {
    if (this.subscriberCount === 0) return;
    const reg = await readRegistry();
    for (const proj of reg.projects) {
      if (!(await pathExists(configPath(proj.path)))) continue;
      try {
        const [config, tickets] = await Promise.all([readConfig(proj.path), readAllTickets(proj.path)]);
        const startedIds = new Set(config.columns.filter((c) => c.category === "started").map((c) => c.id));
        const activeLinked = tickets.filter(
          (t) => t.triage === "accepted" && startedIds.has(t.status) && Boolean(t.t3ThreadId),
        );
        if (!activeLinked.length) continue;

        const nextMap: T3LiveStatusMap = {};
        for (const t of activeLinked) {
          if (!t.t3ThreadId) continue;
          try {
            const st = await getT3ThreadStatus(t.t3ThreadId);
            nextMap[t.id] = { threadId: t.t3ThreadId, status: st.status, checkedAt: new Date().toISOString() };
          } catch {
            // Skip transient t3 CLI errors
          }
        }
        const prevMap = this.t3StatusCache.get(proj.id) ?? {};
        const changed =
          Object.keys(nextMap).length !== Object.keys(prevMap).length ||
          Object.entries(nextMap).some(([id, v]) => prevMap[id]?.status !== v.status);
        if (changed) {
          this.t3StatusCache.set(proj.id, nextMap);
          this.pushFrame({ kind: "t3_status", projectId: proj.id, payload: nextMap });
        }
      } catch {
        // Ignore project read errors during background poll
      }
    }
  }

  private async pollWaitingCiMerges(): Promise<void> {
    const reg = await readRegistry().catch(() => null);
    if (!reg) return;
    for (const proj of reg.projects) {
      if (!(await pathExists(configPath(proj.path)))) continue;
      try {
        const tickets = await readAllTickets(proj.path);
        const waiting = tickets.filter((t) => t.review.mergeState === "waiting_ci" && Boolean(t.branch));
        if (!waiting.length) continue;

        const store = new ProjectStore(proj.path);
        for (const ticket of waiting) {
          if (!ticket.branch) continue;
          try {
            const pr = await inspectPrForBranch(proj.path, ticket.branch);
            if (!pr) continue;
            if (pr.state === "MERGED") {
              await store.approveReview(ticket.id, {
                actor: ticket.review.decidedBy ?? undefined,
                prNumber: pr.number,
                prUrl: pr.url,
                mergeState: "merged",
              });
              await this.publishProjectChange(proj.id, proj.path);
              continue;
            }
            if (pr.checks.overall === "fail") {
              ticket.review.mergeState = "ci_failed";
              ticket.updatedAt = new Date().toISOString();
              ticket.comments.push({
                id: `ci-${Date.now().toString(36)}`,
                author: "triathlon",
                body: `Auto-merge halted on PR #${pr.number} because CI failed: ${pr.checks.failedNames.join(", ")}`,
                createdAt: ticket.updatedAt,
              });
              await writeTicket(proj.path, ticket);
              await this.publishProjectChange(proj.id, proj.path);
              continue;
            }
            if (pr.checks.overall === "pass" || pr.checks.overall === "none") {
              await mergePrWithGh(proj.path, pr.number, { branch: ticket.branch });
              await store.approveReview(ticket.id, {
                actor: ticket.review.decidedBy ?? undefined,
                prNumber: pr.number,
                prUrl: pr.url,
                mergeState: "merged",
              });
              await this.publishProjectChange(proj.id, proj.path);
            }
          } catch {
            // Transient gh / network error; retry next tick
          }
        }
      } catch {
        // Ignore project read error
      }
    }
  }

  async close(): Promise<void> {
    if (this.t3PollTimer) {
      clearInterval(this.t3PollTimer);
      this.t3PollTimer = null;
    }
    if (this.ciPollTimer) {
      clearInterval(this.ciPollTimer);
      this.ciPollTimer = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    if (this.registryWatcher) {
      await this.registryWatcher.close();
      this.registryWatcher = null;
    }
    await Promise.all([...this.projectWatchers.values()].map((e) => e.watcher.close()));
    this.projectWatchers.clear();
  }
}

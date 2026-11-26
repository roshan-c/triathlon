import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import { triathlonDir } from "../core/storage.js";
import type { RegisteredProject } from "../core/types.js";

export interface LiveUpdateEvent {
  projectId: string;
  at: string;
  reason: string;
}

export class ProjectWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();

  syncProjects(projects: RegisteredProject[]): void {
    const activeIds = new Set(projects.map((p) => p.id));

    for (const [id, watcher] of this.watchers.entries()) {
      if (!activeIds.has(id)) {
        void watcher.close();
        this.watchers.delete(id);
      }
    }

    for (const project of projects) {
      if (this.watchers.has(project.id)) continue;
      const target = triathlonDir(project.path);
      const watcher = chokidar.watch(target, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 25 },
        ignored: /\.tmp$/,
      });

      const trigger = (eventName: string, filePath: string) => {
        const existing = this.timers.get(project.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          this.timers.delete(project.id);
          this.emit("update", {
            projectId: project.id,
            at: new Date().toISOString(),
            reason: `${eventName}:${filePath}`,
          } satisfies LiveUpdateEvent);
        }, 60);
        this.timers.set(project.id, timer);
      };

      watcher.on("add", (p) => trigger("add", p));
      watcher.on("change", (p) => trigger("change", p));
      watcher.on("unlink", (p) => trigger("unlink", p));
      watcher.on("error", () => {
        // Ignore transient watch errors on deleted folders.
      });

      this.watchers.set(project.id, watcher);
    }
  }

  notify(projectId: string, reason = "api"): void {
    this.emit("update", {
      projectId,
      at: new Date().toISOString(),
      reason,
    } satisfies LiveUpdateEvent);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all([...this.watchers.values()].map((w) => w.close()));
    this.watchers.clear();
  }
}

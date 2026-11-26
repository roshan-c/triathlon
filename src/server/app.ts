import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  exportBurndownSvg,
  exportEventsCsv,
  exportMetricsCsv,
  exportMetricsMarkdown,
} from "../core/metrics.js";
import { initProject, ProjectStore } from "../core/project.js";
import {
  readRegistry,
  registerProject,
  resolveRegisteredProject,
  unregisterProject,
  updateRegistryPrefs,
} from "../core/registry.js";
import { configPath, pathExists, readAllTickets, readConfig, readCycles } from "../core/storage.js";
import type { ProjectSummary, ThemePreference } from "../core/types.js";
import { TriathlonError } from "../core/types.js";
import { type LiveUpdateEvent, ProjectWatcher } from "./watcher.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function buildProjectSummaries(): Promise<{
  theme: ThemePreference;
  lastProjectId: string | null;
  projects: ProjectSummary[];
}> {
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

async function storeForParam(projectId: string): Promise<ProjectStore> {
  const found = await resolveRegisteredProject(projectId);
  if (!found) {
    throw new TriathlonError(`Registered project "${projectId}" not found`, "PROJECT_NOT_FOUND", 404);
  }
  return new ProjectStore(found.path);
}

export function createApp(options?: {
  watcher?: ProjectWatcher;
  webDistDir?: string;
  allowedTailscaleUsers?: string[];
}) {
  const watcher = options?.watcher ?? new ProjectWatcher();
  const webDistDir = options?.webDistDir ?? resolve(import.meta.dirname, "../web");
  const allowedUsers = new Set(
    (options?.allowedTailscaleUsers ?? [])
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean),
  );
  const app = new Hono();

  // Optional Tailscale identity gate (trusts Tailscale-User-Login injected by `tailscale serve`)
  if (allowedUsers.size > 0) {
    app.use("*", async (c, next) => {
      const login = c.req.header("tailscale-user-login")?.trim().toLowerCase() ?? "";
      if (!login || !allowedUsers.has(login)) {
        if (c.req.path.startsWith("/api/")) {
          return c.json(
            {
              error: login
                ? `Tailscale user "${login}" is not authorized to access this Triathlon instance.`
                : "Tailscale identity header missing. Access this instance via Tailscale Serve.",
              code: "FORBIDDEN",
            },
            403,
          );
        }
        return c.html(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access denied · Triathlon</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F6F4EF;color:#1F1D1A;font-family:Inter,system-ui,sans-serif;padding:24px}main{max-width:420px;border-left:3px solid #B4371B;padding-left:18px}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#5B574F;font-size:14px;line-height:1.5}</style></head><body><main><h1>Access restricted</h1><p>${login ? `Signed in as <strong>${login.replace(/[<>&"]/g, "")}</strong>, which is not allowed on this Triathlon instance.` : "Tailscale identity header is missing. Open this board through your Tailscale Serve HTTPS URL."}</p></main></body></html>`,
          403,
        );
      }
      await next();
    });
  }

  app.get("/api/whoami", (c) => {
    return c.json({
      login: c.req.header("tailscale-user-login") ?? null,
      name: c.req.header("tailscale-user-name") ?? null,
      authEnforced: allowedUsers.size > 0,
    });
  });

  app.onError((err, c) => {
    if (err instanceof TriathlonError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return c.json({ error: message, code: "INTERNAL_ERROR" }, 500);
  });

  // Live SSE stream for file/API updates across all projects
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const onUpdate = (ev: LiveUpdateEvent) => {
        void stream.writeSSE({
          event: "board-update",
          data: JSON.stringify(ev),
        });
      };
      watcher.on("update", onUpdate);
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ at: new Date().toISOString() }),
      });

      const keepAlive = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "{}" });
      }, 25_000);

      await new Promise<void>((resolveDone) => {
        stream.onAbort(() => {
          clearInterval(keepAlive);
          watcher.off("update", onUpdate);
          resolveDone();
        });
      });
    });
  });

  // Registry & preferences
  app.get("/api/projects", async (c) => {
    const data = await buildProjectSummaries();
    watcher.syncProjects(data.projects.filter((p) => p.exists));
    return c.json(data);
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json()) as {
      path?: string;
      initIfMissing?: boolean;
      key?: string;
      name?: string;
      owner?: string;
      demo?: boolean;
    };
    if (!body.path?.trim()) {
      throw new TriathlonError("Project folder path is required", "INVALID_PATH");
    }
    const targetPath = resolve(body.path.trim());
    const hasConfig = await pathExists(configPath(targetPath));

    let entry;
    if (!hasConfig) {
      if (!body.initIfMissing) {
        throw new TriathlonError(
          `No .triathlon/config.yaml found at ${targetPath}. Enable initialize to create one.`,
          "PROJECT_NOT_INITIALIZED",
          404,
        );
      }
      const created = await initProject({
        dir: targetPath,
        key: body.key,
        name: body.name,
        owner: body.owner,
        demo: body.demo,
        register: true,
      });
      entry = { id: created.projectId, path: created.projectRoot, key: created.config.key, name: created.config.name };
    } else {
      const config = await readConfig(targetPath);
      entry = await registerProject({ path: targetPath, key: config.key, name: config.name });
    }

    const reg = await readRegistry();
    watcher.syncProjects(reg.projects);
    watcher.notify(entry.id, "project.registered");
    return c.json(entry, 201);
  });

  app.delete("/api/projects/:projectId", async (c) => {
    const ok = await unregisterProject(c.req.param("projectId"));
    const reg = await readRegistry();
    watcher.syncProjects(reg.projects);
    return c.json({ removed: ok });
  });

  app.patch("/api/preferences", async (c) => {
    const body = (await c.req.json()) as { theme?: ThemePreference; lastProjectId?: string | null };
    const updated = await updateRegistryPrefs(body);
    return c.json(updated);
  });

  // Project snapshot & config
  app.get("/api/projects/:projectId/snapshot", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    await updateRegistryPrefs({ lastProjectId: store.projectId });
    return c.json(await store.getSnapshot());
  });

  app.patch("/api/projects/:projectId/config", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json();
    const updated = await store.updateConfig(body);
    watcher.notify(store.projectId, "config.updated");
    return c.json(updated);
  });

  // Tickets
  app.post("/api/projects/:projectId/tickets", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json();
    const ticket = await store.createTicket(body);
    watcher.notify(store.projectId, "ticket.created");
    return c.json(ticket, 201);
  });

  app.get("/api/projects/:projectId/tickets/:ticketId", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    return c.json(await store.getTicket(c.req.param("ticketId")));
  });

  app.get("/api/projects/:projectId/tickets/:ticketId/prompt", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const prompt = await store.buildAgentPrompt(c.req.param("ticketId"));
    return c.json({ prompt });
  });

  app.patch("/api/projects/:projectId/tickets/:ticketId", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json();
    const ticket = await store.updateTicket(c.req.param("ticketId"), body);
    watcher.notify(store.projectId, "ticket.updated");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/move", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = (await c.req.json()) as { status: string; rank?: number; actor?: string };
    const ticket = await store.moveTicket(c.req.param("ticketId"), body.status, {
      rank: body.rank,
      actor: body.actor,
    });
    watcher.notify(store.projectId, "ticket.moved");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/checklist/:index", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const index = Number(c.req.param("index"));
    const body = (await c.req.json().catch(() => ({}))) as { checked?: boolean; actor?: string };
    const ticket = await store.toggleChecklistItem(c.req.param("ticketId"), index, body);
    watcher.notify(store.projectId, "ticket.checklist");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/comments", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = (await c.req.json()) as { body: string; actor?: string };
    const ticket = await store.addComment(c.req.param("ticketId"), body.body, body.actor);
    watcher.notify(store.projectId, "ticket.commented");
    return c.json(ticket, 201);
  });

  app.delete("/api/projects/:projectId/tickets/:ticketId", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    await store.deleteTicket(c.req.param("ticketId"));
    watcher.notify(store.projectId, "ticket.deleted");
    return c.json({ deleted: true });
  });

  // Review workflow
  app.post("/api/projects/:projectId/tickets/:ticketId/review/request", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json();
    const ticket = await store.requestReview(c.req.param("ticketId"), body);
    watcher.notify(store.projectId, "review.requested");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/review/approve", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = (await c.req.json().catch(() => ({}))) as { note?: string; actor?: string };
    const ticket = await store.approveReview(c.req.param("ticketId"), body);
    watcher.notify(store.projectId, "review.approved");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/review/reject", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = (await c.req.json()) as { note: string; actor?: string };
    const ticket = await store.rejectReview(c.req.param("ticketId"), body);
    watcher.notify(store.projectId, "review.rejected");
    return c.json(ticket);
  });

  // Triage workflow
  app.post("/api/projects/:projectId/tickets/:ticketId/triage/accept", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json().catch(() => ({}));
    const ticket = await store.acceptTriage(c.req.param("ticketId"), body);
    watcher.notify(store.projectId, "triage.accepted");
    return c.json(ticket);
  });

  app.post("/api/projects/:projectId/tickets/:ticketId/triage/dismiss", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    await store.dismissTriage(c.req.param("ticketId"));
    watcher.notify(store.projectId, "triage.dismissed");
    return c.json({ dismissed: true });
  });

  // Cycles
  app.post("/api/projects/:projectId/cycles", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = await c.req.json();
    const cycle = await store.createCycle(body);
    watcher.notify(store.projectId, "cycle.created");
    return c.json(cycle, 201);
  });

  app.post("/api/projects/:projectId/cycles/:cycleId/start", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const cycle = await store.startCycle(c.req.param("cycleId"));
    watcher.notify(store.projectId, "cycle.started");
    return c.json(cycle);
  });

  app.post("/api/projects/:projectId/cycles/:cycleId/complete", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const body = (await c.req.json().catch(() => ({}))) as { rolloverTo?: string | "backlog" | null };
    const result = await store.completeCycle(c.req.param("cycleId"), body);
    watcher.notify(store.projectId, "cycle.completed");
    return c.json(result);
  });

  // Metrics & Dissertation exports
  app.get("/api/projects/:projectId/metrics", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const cycleId = c.req.query("cycleId");
    return c.json(await store.getMetrics(cycleId));
  });

  app.get("/api/projects/:projectId/metrics/export", async (c) => {
    const store = await storeForParam(c.req.param("projectId"));
    const format = (c.req.query("format") ?? "csv").toLowerCase();
    const cycleId = c.req.query("cycleId");
    const report = await store.getMetrics(cycleId);
    const slug = `${report.projectKey.toLowerCase()}-${report.selectedCycle ? `cycle-${report.selectedCycle.number}` : "all"}`;

    if (format === "events-csv") {
      const events = await store.getEvents();
      return new Response(exportEventsCsv(events), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}-events.csv"`,
        },
      });
    }
    if (format === "md" || format === "markdown") {
      return new Response(exportMetricsMarkdown(report), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}-metrics.md"`,
        },
      });
    }
    if (format === "svg") {
      return new Response(exportBurndownSvg(report), {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}-burndown.svg"`,
        },
      });
    }
    if (format === "json") {
      return new Response(JSON.stringify(report, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}-metrics.json"`,
        },
      });
    }
    return new Response(exportMetricsCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-metrics.csv"`,
      },
    });
  });

  // Static frontend serving (Vite build in dist/web)
  app.get("*", async (c) => {
    const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const candidate = resolve(join(webDistDir, reqPath.replace(/^\/+/, "")));
    if (candidate.startsWith(webDistDir) && (await pathExists(candidate))) {
      try {
        const content = await readFile(candidate);
        const type = MIME[extname(candidate)] ?? "application/octet-stream";
        return new Response(content, { headers: { "content-type": type } });
      } catch {
        // Fall through to index.html
      }
    }
    const indexFile = join(webDistDir, "index.html");
    if (await pathExists(indexFile)) {
      const html = await readFile(indexFile, "utf8");
      return c.html(html);
    }
    return c.text("Triathlon UI is not built yet. Run `npm run build` first.", 503);
  });

  return { app, watcher };
}

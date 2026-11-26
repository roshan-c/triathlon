import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../src/core/project.js";
import { createApp } from "../src/server/app.js";

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-server-"));
  process.env.TRIATHLON_HOME = join(sandbox, ".triathlon-home");
});

afterEach(async () => {
  delete process.env.TRIATHLON_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe("Hono local API", () => {
  it("lists projects, creates/moves tickets, handles review inbox, and exports dissertation metrics", async () => {
    const repoDir = join(sandbox, "demo-repo");
    const { projectId } = await initProject({
      dir: repoDir,
      key: "DEM",
      name: "Demo Repo",
      owner: "Roshan",
      demo: true,
    });

    const { app, sync } = createApp();
    try {
      const listRes = await app.request("/api/projects");
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { projects: { id: string; reviewWaitingCount: number }[] };
      expect(listBody.projects).toHaveLength(1);
      expect(listBody.projects[0].reviewWaitingCount).toBe(1);

      const snapRes = await app.request(`/api/projects/${projectId}/snapshot`);
      expect(snapRes.status).toBe(200);
      const snap = (await snapRes.json()) as { tickets: { id: string }[]; cycles: { id: string }[] };
      expect(snap.tickets.length).toBeGreaterThanOrEqual(4);
      expect(snap.cycles.length).toBe(2);

      // Create ticket via API
      const createRes = await app.request(`/api/projects/${projectId}/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Verify API create", priority: "high", estimate: 2 }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };

      // Prompt endpoint
      const promptRes = await app.request(`/api/projects/${projectId}/tickets/${created.id}/prompt`);
      expect(promptRes.status).toBe(200);
      const promptBody = (await promptRes.json()) as { prompt: string };
      expect(promptBody.prompt).toContain(created.id);

      // Export metrics as CSV and SVG
      const csvRes = await app.request(`/api/projects/${projectId}/metrics/export?format=csv`);
      expect(csvRes.status).toBe(200);
      expect(await csvRes.text()).toContain("ticket_id,title");

      const svgRes = await app.request(`/api/projects/${projectId}/metrics/export?format=svg`);
      expect(svgRes.status).toBe(200);
      expect(await svgRes.text()).toContain("<svg");
    } finally {
      await sync.close();
    }
  });

  it("enforces Tailscale-User-Login allowlist when configured", async () => {
    const { app, sync } = createApp({ allowedTailscaleUsers: ["roshan-c@github"] });
    try {
      const noHeader = await app.request("/api/projects");
      expect(noHeader.status).toBe(403);

      const wrongUser = await app.request("/api/projects", {
        headers: { "Tailscale-User-Login": "other@github" },
      });
      expect(wrongUser.status).toBe(403);

      const allowed = await app.request("/api/whoami", {
        headers: { "Tailscale-User-Login": "Roshan-C@github", "Tailscale-User-Name": "Roshan" },
      });
      expect(allowed.status).toBe(200);
      const body = (await allowed.json()) as { login: string; authEnforced: boolean };
      expect(body.login).toBe("Roshan-C@github");
      expect(body.authEnforced).toBe(true);
    } finally {
      await sync.close();
    }
  });
});

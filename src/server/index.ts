import { execFile } from "node:child_process";
import { serve } from "@hono/node-server";
import { readRegistry, registerProject } from "../core/registry.js";
import { findProjectRoot, readConfig } from "../core/storage.js";
import { createApp } from "./app.js";
import { ProjectWatcher } from "./watcher.js";

export async function startServer(options?: {
  port?: number;
  host?: string;
  open?: boolean;
  cwd?: string;
  allowedTailscaleUsers?: string[];
}): Promise<{ url: string; close: () => Promise<void> }> {
  const port = options?.port ?? 4177;
  const host = options?.host ?? "127.0.0.1";
  const allowedTailscaleUsers = options?.allowedTailscaleUsers ?? [];

  if (
    allowedTailscaleUsers.length > 0 &&
    host !== "127.0.0.1" &&
    host !== "::1" &&
    host !== "localhost"
  ) {
    console.warn(
      `Warning: --allow-tailscale-user is enabled while binding to ${host}. Bind to 127.0.0.1 behind \`tailscale serve\` so clients cannot spoof Tailscale-User-Login headers.`,
    );
  }

  // Auto-register cwd if it's a Triathlon repo not yet in the hub
  const cwdRoot = await findProjectRoot(options?.cwd ?? process.cwd());
  if (cwdRoot) {
    const config = await readConfig(cwdRoot);
    await registerProject({ path: cwdRoot, key: config.key, name: config.name });
  }

  const watcher = new ProjectWatcher();
  const registry = await readRegistry();
  watcher.syncProjects(registry.projects);

  const { app } = createApp({ watcher, allowedTailscaleUsers });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  const url = `http://${host}:${port}`;
  console.log(`Triathlon workbench: ${url}`);
  console.log(`Registered projects: ${registry.projects.length}`);
  if (allowedTailscaleUsers.length > 0) {
    console.log(`Tailscale auth restricted to: ${allowedTailscaleUsers.join(", ")}`);
  }

  if (options?.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", url] : [url];
    execFile(cmd, args, () => {});
  }

  const close = async () => {
    await watcher.close();
    if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  };

  process.once("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });

  return { url, close };
}

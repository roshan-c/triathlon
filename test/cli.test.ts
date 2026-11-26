import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI = resolve(import.meta.dirname, "../dist/cli/index.js");

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-cli-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function runCli(args: string[], cwd: string) {
  return execFileAsync("node", [CLI, ...args], {
    cwd,
    env: { ...process.env, TRIATHLON_HOME: join(sandbox, ".triathlon-home") },
  });
}

describe("tri CLI end-to-end", () => {
  it("runs init, new, ready, claim, review gate, and metrics export via --json", { timeout: 20_000 }, async () => {
    const repo = join(sandbox, "proj");
    await runCli(["init", "--dir", repo, "--key", "PRO", "--name", "Proj", "--skill"], sandbox);

    const created = await runCli(
      ["new", "Ship CLI test", "-p", "high", "-e", "3", "--criteria", "Passes smoke test", "--json"],
      repo,
    );
    const ticket = JSON.parse(created.stdout) as { id: string };
    expect(ticket.id).toBe("PRO-1");

    const ready = await runCli(["ready", "--json"], repo);
    expect((JSON.parse(ready.stdout) as { id: string }[]).map((t) => t.id)).toEqual(["PRO-1"]);

    await runCli(["claim", "PRO-1", "--by", "agent:claude"], repo);
    await runCli(["check", "PRO-1", "1", "--done", "--by", "agent:claude"], repo);
    await runCli(
      ["review", "request", "PRO-1", "--summary", "Implemented and tested", "--check", "vitest:pass:ok", "--by", "agent:claude"],
      repo,
    );
    await runCli(["review", "approve", "PRO-1"], repo);

    const csv = await runCli(["metrics", "--export", "csv"], repo);
    expect(csv.stdout).toContain("PRO-1");
  });
});

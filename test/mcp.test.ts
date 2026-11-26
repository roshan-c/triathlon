import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../src/core/project.js";

const CLI = resolve(import.meta.dirname, "../dist/cli/index.js");

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-mcp-"));
  process.env.TRIATHLON_HOME = join(sandbox, ".triathlon-home");
});

afterEach(async () => {
  delete process.env.TRIATHLON_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe("tri mcp stdio server", () => {
  it("lists tools, creates/claims a ticket, enforces review gate, and submits review", async () => {
    const repo = join(sandbox, "mcp-repo");
    await initProject({ dir: repo, key: "MCP", name: "MCP Repo", owner: "Roshan" });

    const transport = new StdioClientTransport({
      command: "node",
      args: [CLI, "mcp", "--project", repo],
      env: { ...process.env, TRIATHLON_HOME: join(sandbox, ".triathlon-home") } as Record<string, string>,
    });

    const client = new Client({ name: "triathlon-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("get_ready_tickets");
      expect(names).toContain("request_review");

      const createdRes = await client.callTool({
        name: "create_ticket",
        arguments: {
          title: "Test MCP workflow",
          priority: "high",
          estimate: 2,
          criteria: ["Connect client", "Submit review"],
          actor: "agent:claude",
        },
      });
      const created = JSON.parse((createdRes.content as { text: string }[])[0].text) as { id: string };
      expect(created.id).toBe("MCP-1");

      await client.callTool({
        name: "claim_ticket",
        arguments: { ticketId: "MCP-1", actor: "agent:claude" },
      });

      // Review gate blocks moving straight to done
      const blockedMove = await client.callTool({
        name: "move_ticket",
        arguments: { ticketId: "MCP-1", toColumn: "done", actor: "agent:claude" },
      });
      expect(blockedMove.isError).toBe(true);

      const reviewed = await client.callTool({
        name: "request_review",
        arguments: {
          ticketId: "MCP-1",
          summary: "All MCP tools verified.",
          checks: [{ name: "vitest", status: "pass", detail: "green" }],
          actor: "agent:claude",
        },
      });
      expect(reviewed.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  });
});

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { baseBranchName } from "./github.js";
import type { ProjectStore } from "./project.js";
import { readRegistry } from "./registry.js";
import { appendEvent, readTicket, writeTicket } from "./storage.js";
import type { AgentModelConfig, T3Settings, Ticket } from "./types.js";
import { TriathlonError } from "./types.js";

const execFileAsync = promisify(execFile);

const AGENT_ALIASES: Record<string, string> = {
  "agent:antigravity": "agent:agy",
  "agent:gemini": "agent:agy",
  "agent:claude-code": "agent:claude",
  "agent:anthropic": "agent:claude",
  "agent:openai": "agent:codex",
};

export interface LaunchT3Options {
  agent?: string;
  provider?: string;
  model?: string;
  reasoningKey?: string;
  reasoningValue?: string;
  baseRef?: string;
  branch?: string;
}

export interface LaunchT3Result {
  ticket: Ticket;
  threadId: string;
  branch: string;
  baseRef: string;
  agent: string;
  provider: string;
  model: string;
  reasoning: string | null;
}

export function normalizeAgentAssignee(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (!lower.startsWith("agent:")) return null;
  return AGENT_ALIASES[lower] ?? lower;
}

export function resolveAgentProfile(
  ticket: Ticket,
  settings: T3Settings,
  overrides?: LaunchT3Options,
): AgentModelConfig {
  const requested =
    normalizeAgentAssignee(overrides?.agent) ??
    normalizeAgentAssignee(ticket.assignee) ??
    normalizeAgentAssignee(settings.defaultAgent) ??
    "agent:claude";

  const base =
    settings.agents[requested] ??
    settings.agents[settings.defaultAgent] ??
    Object.values(settings.agents)[0] ?? {
      assignee: requested,
      label: requested,
      provider: "claudeAgent",
      model: "claude-opus-5-5",
      reasoningKey: "effort",
      reasoningValue: "medium",
    };

  return {
    assignee: requested,
    label: base.label,
    provider: overrides?.provider?.trim() || base.provider,
    model: overrides?.model?.trim() || base.model,
    reasoningKey: overrides?.reasoningKey?.trim() || base.reasoningKey,
    reasoningValue:
      overrides?.reasoningValue !== undefined ? overrides.reasoningValue.trim() : base.reasoningValue,
  };
}

export function slugifyBranch(ticketId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${ticketId.toLowerCase()}-${slug || "work"}`;
}

export async function detectDefaultBaseRef(projectRoot: string, configuredBaseRef?: string): Promise<string> {
  if (configuredBaseRef?.trim()) return configuredBaseRef.trim();
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd: projectRoot,
    });
    const ref = stdout.trim();
    if (ref) return ref;
  } catch {
    // No remote origin/HEAD; fall back to local branch
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectRoot,
    });
    const branch = stdout.trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {
    // Fall through
  }
  return "main";
}

function runT3WithStdin(args: string[], stdinText: string): Promise<string> {
  return new Promise((resolveOut, reject) => {
    const child = spawn("t3", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(
        new TriathlonError(
          `Failed to run \`t3\` CLI (${err.message}). Make sure T3 Code is installed and on PATH.`,
          "T3_UNAVAILABLE",
          503,
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new TriathlonError(
            `t3 ${args.slice(0, 2).join(" ")} failed (exit ${code}): ${(stderr || stdout).trim()}`,
            "T3_COMMAND_FAILED",
            502,
          ),
        );
      } else {
        resolveOut(stdout.trim());
      }
    });
    child.stdin.write(stdinText, "utf8");
    child.stdin.end();
  });
}

function extractThreadId(output: string): string {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const candidate =
      parsed.threadId ??
      parsed.id ??
      (parsed.thread && typeof parsed.thread === "object"
        ? (parsed.thread as Record<string, unknown>).threadId ?? (parsed.thread as Record<string, unknown>).id
        : null);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  } catch {
    // Plain text output fallback: first non-empty line
  }
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) {
    throw new TriathlonError("t3 thread start did not return a thread ID", "T3_PARSE_ERROR", 502);
  }
  return line;
}

export async function launchTicketInT3(
  store: ProjectStore,
  ticketId: string,
  overrides?: LaunchT3Options,
): Promise<LaunchT3Result> {
  const [registry, ticket] = await Promise.all([readRegistry(), store.getTicket(ticketId)]);
  const profile = resolveAgentProfile(ticket, registry.t3, overrides);
  const baseRef = await detectDefaultBaseRef(store.root, overrides?.baseRef || registry.t3.defaultBaseRef);
  const branch = overrides?.branch?.trim() || ticket.branch || slugifyBranch(ticket.id, ticket.title);

  const basePrompt = await store.buildAgentPrompt(ticket.id, { branch, baseBranch: baseRef });
  const prompt = [
    basePrompt,
    "",
    "## Worktree & PR Notes",
    `- You are running in a dedicated git worktree on branch \`${branch}\` (based on \`${baseRef}\`).`,
    `- Keep commits clean and focused on ${ticket.id}.`,
    `- Before requesting review, push \`${branch}\` to \`origin\` and open a GitHub PR against \`${baseBranchName(baseRef)}\` (see the Triathlon Workflow above). Approving the review merges that PR.`,
    `- Once the PR is open, call \`tri -P ${store.root} review request ${ticket.id} --summary "..." --by ${profile.assignee}\` (or use Triathlon MCP \`request_review\`).`,
  ].join("\n");

  const args = [
    "thread",
    "start",
    "--title",
    `${ticket.id}: ${ticket.title}`,
    "--worktree",
    baseRef,
    "--branch",
    branch,
    "--json",
  ];

  if (profile.provider && profile.model) {
    args.push("--provider", profile.provider, "--model", profile.model);
    if (profile.reasoningKey && profile.reasoningValue) {
      args.push("--option", `${profile.reasoningKey}=${profile.reasoningValue}`);
    }
  }

  args.push(store.root, "-");

  const rawOutput = await runT3WithStdin(args, prompt);
  const threadId = extractThreadId(rawOutput);

  // Claim ticket for the resolved agent, move to In progress, and persist T3 metadata
  await store.claimTicket(ticket.id, profile.assignee, { branch, moveToStarted: true });
  const fresh = await readTicket(store.root, ticket.id);
  fresh.t3ThreadId = threadId;
  fresh.t3Provider = profile.provider;
  fresh.t3Model = profile.model;
  fresh.t3Reasoning = profile.reasoningValue ? `${profile.reasoningKey}=${profile.reasoningValue}` : null;
  fresh.updatedAt = new Date().toISOString();
  const saved = await writeTicket(store.root, fresh);

  await appendEvent(store.root, {
    type: "t3.launched",
    actor: profile.assignee,
    ticketId: saved.id,
    cycleId: saved.cycleId ?? undefined,
    data: {
      threadId,
      provider: profile.provider,
      model: profile.model,
      reasoning: fresh.t3Reasoning,
      branch,
      baseRef,
    },
  });

  return {
    ticket: saved,
    threadId,
    branch,
    baseRef,
    agent: profile.assignee,
    provider: profile.provider,
    model: profile.model,
    reasoning: fresh.t3Reasoning,
  };
}

export async function sendReviewFeedbackToT3(
  projectRoot: string,
  ticket: Ticket,
  note: string,
  reviewer: string,
): Promise<{ sent: boolean; error?: string }> {
  const registry = await readRegistry();
  if (!registry.t3.sendBackToThread || !ticket.t3ThreadId) {
    return { sent: false };
  }

  const message = [
    `${reviewer} sent **${ticket.id}: ${ticket.title}** back from Review with feedback:`,
    "",
    `> ${note.trim()}`,
    "",
    `Please address this feedback in your worktree and re-submit via \`tri -P ${projectRoot} review request ${ticket.id} --summary "..."\` (or Triathlon MCP \`request_review\`) when ready.`,
  ].join("\n");

  try {
    await runT3WithStdin(["thread", "send", "--json", ticket.t3ThreadId, "-"], message);
    await appendEvent(projectRoot, {
      type: "t3.feedback_sent",
      actor: reviewer,
      ticketId: ticket.id,
      cycleId: ticket.cycleId ?? undefined,
      data: { threadId: ticket.t3ThreadId, note: note.trim() },
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getT3ThreadStatus(threadId: string): Promise<{
  threadId: string;
  status: string;
  title?: string;
  branch?: string | null;
}> {
  const { stdout } = await execFileAsync("t3", ["thread", "show", "--messages", "0", "--json", threadId]);
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const thread = (parsed.thread && typeof parsed.thread === "object"
    ? parsed.thread
    : parsed) as Record<string, unknown>;
  return {
    threadId,
    status: String(thread.status ?? "unknown"),
    title: typeof thread.title === "string" ? thread.title : undefined,
    branch: typeof thread.branch === "string" ? thread.branch : null,
  };
}

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrInfo } from "../src/core/github.js";

// Keep the pure/local-git helpers real; stub everything that talks to GitHub.
vi.mock("../src/core/github.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/github.js")>();
  return {
    ...real,
    inspectPrForBranch: vi.fn(),
    pushBranchAndOpenPr: vi.fn(),
    mergePrWithGh: vi.fn(),
    markPrReady: vi.fn(),
  };
});

const github = await import("../src/core/github.js");
const { initProject, ProjectStore } = await import("../src/core/project.js");

const inspectPr = vi.mocked(github.inspectPrForBranch);
const pushAndOpen = vi.mocked(github.pushBranchAndOpenPr);
const mergePr = vi.mocked(github.mergePrWithGh);

let sandbox: string;
let repoDir: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
}

function openPr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 42,
    url: "https://github.com/acme/repo/pull/42",
    title: "DIS-1: Parser",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checks: github.summarizeChecks([]),
    ...overrides,
  };
}

async function setupTicketInReview(branch: string) {
  await initProject({ dir: repoDir, key: "DIS", name: "Dissertation", owner: "Roshan" });
  const store = new ProjectStore(repoDir);
  const ticket = await store.createTicket({ title: "Parser", description: "Parse things." });
  await store.claimTicket(ticket.id, "agent:claude", { branch });
  await store.requestReview(ticket.id, { summary: "Implemented the parser.", actor: "agent:claude" });
  return { store, ticket };
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-agent-pr-"));
  process.env.TRIATHLON_HOME = join(sandbox, ".triathlon-home");
  repoDir = join(sandbox, "repo");
  await mkdir(repoDir);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "-q", "--allow-empty", "-m", "init");
  vi.clearAllMocks();
});

afterEach(async () => {
  delete process.env.TRIATHLON_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe("buildAgentPrompt PR instructions", () => {
  it("tells the agent to push its branch and open a PR before requesting review", async () => {
    await initProject({ dir: repoDir, key: "DIS", name: "Dissertation", owner: "Roshan" });
    const store = new ProjectStore(repoDir);
    const ticket = await store.createTicket({ title: 'Say "hi"' });

    const prompt = await store.buildAgentPrompt(ticket.id, { branch: "dis-1-say-hi", baseBranch: "origin/main" });
    expect(prompt).toContain("git push -u origin dis-1-say-hi");
    expect(prompt).toContain('gh pr create --base main --head dis-1-say-hi --title "DIS-1: Say \\"hi\\""');

    const pushAt = prompt.indexOf("git push -u origin");
    const reviewAt = prompt.indexOf("review request DIS-1");
    expect(pushAt).toBeGreaterThan(-1);
    expect(reviewAt).toBeGreaterThan(pushAt);
    expect(prompt).toContain("Only after the PR is open");
  });

  it("falls back to HEAD when no branch is known", async () => {
    await initProject({ dir: repoDir, key: "DIS", name: "Dissertation", owner: "Roshan" });
    const store = new ProjectStore(repoDir);
    const ticket = await store.createTicket({ title: "No branch" });
    const prompt = await store.buildAgentPrompt(ticket.id);
    expect(prompt).toContain("git push -u origin HEAD");
    expect(prompt).toContain("gh pr create --base main --title");
  });
});

describe("getLocalBranchStatus", () => {
  it("counts commits ahead of the base and reports missing branches", async () => {
    git("branch", "feature");
    expect(await github.getLocalBranchStatus(repoDir, "feature")).toEqual({ exists: true, baseRef: "main", ahead: 0 });

    git("checkout", "-q", "feature");
    await writeFile(join(repoDir, "a.txt"), "a");
    git("add", "a.txt");
    git("commit", "-q", "-m", "a");
    git("checkout", "-q", "main");
    expect(await github.getLocalBranchStatus(repoDir, "feature")).toEqual({ exists: true, baseRef: "main", ahead: 1 });

    expect((await github.getLocalBranchStatus(repoDir, "nope")).exists).toBe(false);
  });
});

describe("approve fallback for unpushed branches", () => {
  async function commitOnBranch(branch: string) {
    git("checkout", "-q", "-b", branch);
    await writeFile(join(repoDir, "work.txt"), "work");
    git("add", "work.txt");
    git("commit", "-q", "-m", "work");
    git("checkout", "-q", "main");
  }

  it("pushes the branch, opens a PR, and queues the merge for CI", async () => {
    await commitOnBranch("dis-1-parser");
    const { store, ticket } = await setupTicketInReview("dis-1-parser");
    inspectPr.mockResolvedValueOnce(null).mockResolvedValueOnce(openPr());
    pushAndOpen.mockResolvedValueOnce("https://github.com/acme/repo/pull/42");

    const res = await store.approveAndMergeReview(ticket.id, { actor: "Roshan" });

    expect(pushAndOpen).toHaveBeenCalledWith(
      repoDir,
      "dis-1-parser",
      expect.objectContaining({ baseBranch: "main", title: "DIS-1: Parser", body: expect.stringContaining("Implemented the parser.") }),
    );
    expect(res.prOpened).toBe(true);
    // A fresh PR has no CI results yet, so it must not be merged immediately.
    expect(res.status).toBe("waiting_ci");
    expect(mergePr).toHaveBeenCalledWith(repoDir, 42, { auto: true });
    expect(res.ticket.review.mergeState).toBe("waiting_ci");
    expect(res.ticket.review.prNumber).toBe(42);
    expect(res.ticket.comments.at(-1)?.body).toContain("opened PR #42");
  });

  it("reports PR_NOT_PUSHED instead of pushing when openPr is false", async () => {
    await commitOnBranch("dis-1-parser");
    const { store, ticket } = await setupTicketInReview("dis-1-parser");
    inspectPr.mockResolvedValue(null);

    await expect(store.approveAndMergeReview(ticket.id, { actor: "Roshan", openPr: false })).rejects.toMatchObject({
      code: "PR_NOT_PUSHED",
    });
    expect(pushAndOpen).not.toHaveBeenCalled();
  });

  it("keeps PR_NOT_FOUND when the branch has nothing to push", async () => {
    git("branch", "dis-1-parser");
    const { store, ticket } = await setupTicketInReview("dis-1-parser");
    inspectPr.mockResolvedValue(null);

    await expect(store.approveAndMergeReview(ticket.id, { actor: "Roshan" })).rejects.toMatchObject({
      code: "PR_NOT_FOUND",
    });
    expect(pushAndOpen).not.toHaveBeenCalled();
  });

  it("does not touch git when a PR already exists", async () => {
    const { store, ticket } = await setupTicketInReview("dis-1-parser");
    inspectPr.mockResolvedValue(openPr());

    const res = await store.approveAndMergeReview(ticket.id, { actor: "Roshan" });
    expect(pushAndOpen).not.toHaveBeenCalled();
    expect(res.status).toBe("merged");
    expect(res.prOpened).toBeFalsy();
  });
});

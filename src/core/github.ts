import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TriathlonError } from "./types.js";

const execFileAsync = promisify(execFile);

export interface PrCheckItem {
  name: string;
  state: "pass" | "fail" | "pending";
  url?: string;
}

export interface PrCheckSummary {
  overall: "pass" | "fail" | "pending" | "none";
  total: number;
  passed: number;
  failed: number;
  pending: number;
  failedNames: string[];
  pendingNames: string[];
  items: PrCheckItem[];
}

export interface PrInfo {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  mergeable?: string;
  mergeStateStatus: string;
  checks: PrCheckSummary;
}

interface RawCheckNode {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

const FAIL_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);

const PASS_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function summarizeChecks(rollup: RawCheckNode[] | null | undefined): PrCheckSummary {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return {
      overall: "none",
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      failedNames: [],
      pendingNames: [],
      items: [],
    };
  }

  const items: PrCheckItem[] = [];
  const failedNames: string[] = [];
  const pendingNames: string[] = [];
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const node of rollup) {
    const name = (node.name || node.context || "check").trim();
    const url = node.detailsUrl || node.targetUrl;

    let state: PrCheckItem["state"] = "pending";
    if (node.__typename === "StatusContext" || (!node.status && node.state)) {
      const s = String(node.state ?? "").toUpperCase();
      if (s === "SUCCESS") state = "pass";
      else if (s === "FAILURE" || s === "ERROR") state = "fail";
      else state = "pending";
    } else {
      const status = String(node.status ?? "").toUpperCase();
      const conclusion = String(node.conclusion ?? "").toUpperCase();
      if (status !== "COMPLETED") {
        state = "pending";
      } else if (FAIL_CONCLUSIONS.has(conclusion)) {
        state = "fail";
      } else if (PASS_CONCLUSIONS.has(conclusion)) {
        state = "pass";
      } else {
        state = "pending";
      }
    }

    if (state === "pass") passed += 1;
    else if (state === "fail") {
      failed += 1;
      failedNames.push(name);
    } else {
      pending += 1;
      pendingNames.push(name);
    }
    items.push({ name, state, url });
  }

  const overall: PrCheckSummary["overall"] =
    failed > 0 ? "fail" : pending > 0 ? "pending" : "pass";

  return {
    overall,
    total: items.length,
    passed,
    failed,
    pending,
    failedNames,
    pendingNames,
    items,
  };
}

async function runGh(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: 5 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const msg = (e.stderr || e.stdout || e.message || "gh command failed").trim();
    throw new TriathlonError(msg, "GH_ERROR", 502);
  }
}

export async function inspectPrForBranch(projectRoot: string, branch: string): Promise<PrInfo | null> {
  const fields = "number,url,title,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup";
  const raw = await runGh(
    ["pr", "list", "--head", branch, "--state", "all", "--limit", "5", "--json", fields],
    projectRoot,
  );
  const prs = JSON.parse(raw || "[]") as {
    number: number;
    url: string;
    title: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    mergeable?: string;
    mergeStateStatus: string;
    statusCheckRollup?: RawCheckNode[];
  }[];

  if (!prs.length) return null;
  const chosen = prs.find((p) => p.state === "OPEN") ?? prs.find((p) => p.state === "MERGED") ?? prs[0];
  return {
    number: chosen.number,
    url: chosen.url,
    title: chosen.title,
    state: chosen.state,
    isDraft: Boolean(chosen.isDraft),
    mergeable: chosen.mergeable ?? "UNKNOWN",
    mergeStateStatus: chosen.mergeStateStatus ?? "UNKNOWN",
    checks: summarizeChecks(chosen.statusCheckRollup),
  };
}

export async function getPrDiffForBranch(
  projectRoot: string,
  branch: string,
): Promise<{ source: "pr" | "git"; prNumber?: number; patch: string }> {
  try {
    const pr = await inspectPrForBranch(projectRoot, branch);
    if (pr) {
      const { stdout } = await execFileAsync("gh", ["pr", "diff", String(pr.number)], {
        cwd: projectRoot,
        maxBuffer: 15 * 1024 * 1024,
      });
      return { source: "pr", prNumber: pr.number, patch: stdout };
    }
  } catch {
    // Fall back to local git diff
  }

  for (const base of ["origin/main", "main", "origin/master", "master"]) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", `${base}...${branch}`], {
        cwd: projectRoot,
        maxBuffer: 15 * 1024 * 1024,
      });
      return { source: "git", patch: stdout };
    } catch {
      // Try next base ref
    }
  }
  throw new TriathlonError(`Could not load diff for branch "${branch}".`, "DIFF_ERROR", 404);
}

export async function rerunFailedCiForPr(
  projectRoot: string,
  branch: string,
): Promise<{ prNumber: number; rerunRunIds: number[] }> {
  const pr = await inspectPrForBranch(projectRoot, branch);
  if (!pr) {
    throw new TriathlonError(`No GitHub PR found for branch "${branch}".`, "PR_NOT_FOUND", 404);
  }
  const raw = await runGh(
    ["run", "list", "--branch", branch, "--limit", "10", "--json", "databaseId,conclusion,status"],
    projectRoot,
  );
  const runs = JSON.parse(raw || "[]") as {
    databaseId: number;
    conclusion?: string | null;
    status?: string;
  }[];
  const failed = runs.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "cancelled",
  );
  if (!failed.length) {
    throw new TriathlonError(
      `No failed GitHub Actions runs found on branch "${branch}" to re-run.`,
      "NO_FAILED_RUNS",
      409,
    );
  }
  const rerunRunIds: number[] = [];
  for (const run of failed) {
    await runGh(["run", "rerun", String(run.databaseId), "--failed"], projectRoot);
    rerunRunIds.push(run.databaseId);
  }
  return { prNumber: pr.number, rerunRunIds };
}

export async function mergePrWithGh(
  projectRoot: string,
  prNumber: number,
  options?: { auto?: boolean; branch?: string },
): Promise<void> {
  // Never pass --delete-branch to `gh pr merge`: it tries to delete the local branch and
  // checkout main, which fails whenever a git worktree (e.g. a T3 Code thread) holds that branch.
  const args = ["pr", "merge", String(prNumber), "--squash"];
  if (options?.auto) args.push("--auto");
  await runGh(args, projectRoot);

  // Best-effort remote branch cleanup (no-op if GitHub already auto-deleted it)
  if (!options?.auto && options?.branch) {
    await execFileAsync("git", ["push", "origin", "--delete", options.branch], {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024,
    }).catch(() => {});
  }
}

export async function markPrReady(projectRoot: string, prNumber: number): Promise<void> {
  await runGh(["pr", "ready", String(prNumber)], projectRoot);
}

export interface LocalBranchStatus {
  /** The branch exists as a local ref (e.g. held by a T3 worktree). */
  exists: boolean;
  /** Ref the ahead count was measured against (e.g. `origin/main`), or null if none resolved. */
  baseRef: string | null;
  /** Commits on the branch that are not on `baseRef`. */
  ahead: number;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 });
  return stdout.trim();
}

/** Strips a remote prefix so `origin/main` becomes `main` (the name GitHub expects as a PR base). */
export function baseBranchName(baseRef: string): string {
  return baseRef.replace(/^(refs\/remotes\/)?origin\//, "").replace(/^refs\/heads\//, "");
}

/**
 * Reports whether a ticket branch exists locally and how many commits it has beyond the base.
 * The remote-tracking base is preferred because that is what a GitHub PR would be measured against.
 */
export async function getLocalBranchStatus(
  projectRoot: string,
  branch: string,
  baseBranch = "main",
): Promise<LocalBranchStatus> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot);
  } catch {
    return { exists: false, baseRef: null, ahead: 0 };
  }
  const base = baseBranchName(baseBranch);
  for (const ref of [`origin/${base}`, base]) {
    try {
      await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], projectRoot);
      const count = await runGit(["rev-list", "--count", `${ref}..refs/heads/${branch}`], projectRoot);
      return { exists: true, baseRef: ref, ahead: Number.parseInt(count, 10) || 0 };
    } catch {
      // Try the next candidate base ref
    }
  }
  return { exists: true, baseRef: null, ahead: 0 };
}

/** Pushes a local branch to `origin` and opens a GitHub PR for it. Returns the new PR's URL. */
export async function pushBranchAndOpenPr(
  projectRoot: string,
  branch: string,
  options: { title: string; body: string; baseBranch?: string },
): Promise<string> {
  try {
    await runGit(["push", "--set-upstream", "origin", `refs/heads/${branch}:refs/heads/${branch}`], projectRoot);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    const msg = (e.stderr || e.message || "git push failed").trim();
    throw new TriathlonError(`Could not push branch "${branch}": ${msg}`, "PUSH_FAILED", 502);
  }
  const out = await runGh(
    [
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      baseBranchName(options.baseBranch ?? "main"),
      "--title",
      options.title,
      "--body",
      options.body,
    ],
    projectRoot,
  );
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
}

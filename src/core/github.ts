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
  const fields = "number,url,title,state,isDraft,mergeStateStatus,statusCheckRollup";
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
    mergeStateStatus: chosen.mergeStateStatus ?? "UNKNOWN",
    checks: summarizeChecks(chosen.statusCheckRollup),
  };
}

export async function mergePrWithGh(
  projectRoot: string,
  prNumber: number,
  options?: { auto?: boolean },
): Promise<void> {
  const args = ["pr", "merge", String(prNumber), "--squash", "--delete-branch"];
  if (options?.auto) args.push("--auto");
  await runGh(args, projectRoot);
}

export async function markPrReady(projectRoot: string, prNumber: number): Promise<void> {
  await runGh(["pr", "ready", String(prNumber)], projectRoot);
}

import { describe, expect, it } from "vitest";
import { summarizeChecks } from "../src/core/github.js";

describe("GitHub PR check summarization", () => {
  it("handles empty check list", () => {
    const res = summarizeChecks([]);
    expect(res.overall).toBe("none");
    expect(res.total).toBe(0);
  });

  it("reports pass when all CheckRuns and StatusContexts succeed", () => {
    const res = summarizeChecks([
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
    ]);
    expect(res.overall).toBe("pass");
    expect(res.passed).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.pending).toBe(0);
  });

  it("reports pending when any check is still running and none failed", () => {
    const res = summarizeChecks([
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null },
    ]);
    expect(res.overall).toBe("pending");
    expect(res.pendingNames).toEqual(["build"]);
  });

  it("reports fail immediately if any check failed even while others are running", () => {
    const res = summarizeChecks([
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null },
    ]);
    expect(res.overall).toBe("fail");
    expect(res.failedNames).toEqual(["test"]);
    expect(res.pendingNames).toEqual(["build"]);
  });
});

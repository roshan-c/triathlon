import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractChecklist, parseTicketMarkdown, serializeTicketMarkdown, toggleChecklistInMarkdown } from "../src/core/markdown.js";
import { initProject, ProjectStore } from "../src/core/project.js";
import { defaultT3Settings, readRegistry, unregisterProject } from "../src/core/registry.js";
import { resolveAgentProfile, slugifyBranch } from "../src/core/t3.js";
import { TriathlonError } from "../src/core/types.js";

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-core-"));
  process.env.TRIATHLON_HOME = join(sandbox, ".triathlon-home");
});

afterEach(async () => {
  delete process.env.TRIATHLON_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe("markdown round-trip and checklists", () => {
  it("extracts and toggles checkboxes without corrupting prose or code fences", () => {
    const md = [
      "Summary paragraph.",
      "```md",
      "- [ ] ignored inside code fence",
      "```",
      "## Acceptance Criteria",
      "- [ ] First item",
      "- [x] Second item",
    ].join("\n");

    const items = extractChecklist(md);
    expect(items).toEqual([
      { index: 0, checked: false, text: "First item" },
      { index: 1, checked: true, text: "Second item" },
    ]);

    const toggled = toggleChecklistInMarkdown(md, 0, true);
    expect(toggled.item.checked).toBe(true);
    expect(toggled.markdown).toContain("- [x] First item");
    expect(toggled.markdown).toContain("- [ ] ignored inside code fence");
  });

  it("round-trips frontmatter, body, and comments cleanly", () => {
    const raw = serializeTicketMarkdown({
      id: "DIS-1",
      title: "Draft evaluation chapter",
      description: "Write section 5.2.\n\n- [x] Include p85 table\n- [ ] Proofread",
      status: "in-progress",
      priority: "urgent",
      estimate: 5,
      labels: ["writing", "chapter-5"],
      assignee: "agent:claude",
      cycleId: "cycle-1",
      rank: 1000,
      blockedBy: ["DIS-0"],
      files: ["chapters/05.tex"],
      branch: "dis-1-eval",
      t3ThreadId: "thread-abc",
      t3Provider: "claudeAgent",
      t3Model: "claude-opus-5-5",
      t3Reasoning: "effort=medium",
      triage: "accepted",
      proposedBy: null,
      review: { state: "none" },
      checklist: [],
      comments: [
        { id: "c1", author: "agent:claude", body: "Added draft table.", createdAt: "2026-11-20T10:00:00.000Z" },
      ],
      createdBy: "Roshan",
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-20T10:00:00.000Z",
    });

    const parsed = parseTicketMarkdown(raw, "DIS-1");
    expect(parsed.id).toBe("DIS-1");
    expect(parsed.priority).toBe("urgent");
    expect(parsed.estimate).toBe(5);
    expect(parsed.blockedBy).toEqual(["DIS-0"]);
    expect(parsed.checklist).toHaveLength(2);
    expect(parsed.checklist[0].checked).toBe(true);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].body).toBe("Added draft table.");
  });
});

describe("ProjectStore workflow & review gate", () => {
  it("initializes, registers multi-project hub, manages ready queue, and enforces review gate", async () => {
    const repoDir = join(sandbox, "dissertation");
    const init = await initProject({ dir: repoDir, key: "DIS", name: "Dissertation", owner: "Roshan" });
    expect(init.config.key).toBe("DIS");

    const reg = await readRegistry();
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0].key).toBe("DIS");

    const store = new ProjectStore(repoDir);
    const t1 = await store.createTicket({
      title: "Build events parser",
      priority: "high",
      estimate: 3,
      criteria: ["Parse JSONL", "Add tests"],
    });
    const t2 = await store.createTicket({
      title: "Export metrics CSV",
      priority: "urgent",
      estimate: 5,
      blockedBy: [t1.id],
    });
    const proposed = await store.createTicket({
      title: "Add glossary",
      proposed: true,
      actor: "agent:claude",
    });

    // t2 is blocked by t1, proposed is not accepted -> only t1 is ready!
    const ready = await store.getReadyTickets();
    expect(ready.map((t) => t.id)).toEqual([t1.id]);
    expect(proposed.triage).toBe("proposed");

    // Agent claims t1 and toggles first checklist item
    await store.addComment(t1.id, "Use Europe/London timezone in the fixture.", "Roshan");
    const promptWithComments = await store.buildAgentPrompt(t1.id);
    expect(promptWithComments).toContain("## Comments");
    expect(promptWithComments).toContain("Use Europe/London timezone in the fixture.");

    const claimed = await store.claimTicket(t1.id, "agent:claude", { branch: "dis-1-parser" });
    expect(claimed.status).toBe("in-progress");
    expect(claimed.assignee).toBe("agent:claude");

    const checked = await store.toggleChecklistItem(t1.id, 0, { checked: true, actor: "agent:claude" });
    expect(checked.checklist[0].checked).toBe(true);

    // Agent CANNOT bypass review gate to Done
    await expect(
      store.moveTicket(t1.id, "done", { actor: "agent:claude" }),
    ).rejects.toThrow(TriathlonError);

    // Agent requests review -> human sends back -> agent resubmits -> human approves
    const inReview = await store.requestReview(t1.id, {
      summary: "Parser works with tests.",
      question: "Skip malformed lines?",
      checks: [{ name: "vitest", status: "pass", detail: "12 passed" }],
      actor: "agent:claude",
    });
    expect(inReview.status).toBe("in-review");
    expect(inReview.review.state).toBe("pending");

    const sentBack = await store.rejectReview(t1.id, { note: "Add empty file test", actor: "Roshan" });
    expect(sentBack.status).toBe("in-progress");
    expect(sentBack.review.state).toBe("changes_requested");

    await store.requestReview(t1.id, { summary: "Added empty file test.", actor: "agent:claude" });
    const approved = await store.approveReview(t1.id, { actor: "Roshan" });
    expect(approved.status).toBe("done");
    expect(approved.review.state).toBe("approved");

    // Now t2 is unblocked and ready!
    const readyAfter = await store.getReadyTickets();
    expect(readyAfter.map((t) => t.id)).toEqual([t2.id]);

    // Unregister keeps files intact
    expect(await unregisterProject(init.projectId)).toBe(true);
    expect((await readRegistry()).projects).toHaveLength(0);
  });

  it("maps card assignees to T3 providers, supports aliases and per-run overrides, and slugifies branches", () => {
    const settings = defaultT3Settings();
    const baseTicket = {
      id: "SAY-3",
      title: "Resolve port 8787 clash with T3 agent-tap",
      description: "",
      status: "todo",
      priority: "urgent" as const,
      estimate: 2,
      labels: [],
      assignee: "agent:agy",
      cycleId: null,
      rank: 1000,
      blockedBy: [],
      files: [],
      branch: null,
      t3ThreadId: null,
      t3Provider: null,
      t3Model: null,
      t3Reasoning: null,
      triage: "accepted" as const,
      proposedBy: null,
      review: { state: "none" as const },
      checklist: [],
      comments: [],
      createdBy: "Roshan",
      createdAt: "2026-11-26T00:00:00.000Z",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };

    const agy = resolveAgentProfile(baseTicket, settings);
    expect(agy.provider).toBe("antigravity");
    expect(agy.model).toBe("gemini-4-neon");
    expect(agy.reasoningKey).toBe("thought_level");

    const pi = resolveAgentProfile({ ...baseTicket, assignee: "agent:pi" }, settings);
    expect(pi.provider).toBe("pi");
    expect(pi.reasoningKey).toBe("thinking");

    const overridden = resolveAgentProfile(baseTicket, settings, {
      agent: "agent:claude",
      model: "claude-sonnet-5-5",
      reasoningValue: "high",
    });
    expect(overridden.provider).toBe("claudeAgent");
    expect(overridden.model).toBe("claude-sonnet-5-5");
    expect(overridden.reasoningValue).toBe("high");

    expect(slugifyBranch(baseTicket.id, baseTicket.title)).toBe("say-3-resolve-port-8787-clash-with-t3-agent-ta");
  });
});

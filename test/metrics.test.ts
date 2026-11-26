import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMetricsReport,
  exportBurndownSvg,
  exportEventsCsv,
  exportMetricsCsv,
  exportMetricsMarkdown,
  percentile,
} from "../src/core/metrics.js";
import { initProject, ProjectStore } from "../src/core/project.js";
import { appendEvent } from "../src/core/storage.js";

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "triathlon-metrics-"));
  process.env.TRIATHLON_HOME = join(sandbox, ".triathlon-home");
});

afterEach(async () => {
  delete process.env.TRIATHLON_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe("dissertation metrics engine", () => {
  it("computes accurate percentiles", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 85)).toBeCloseTo(4.4, 5);
    expect(percentile([], 50)).toBeNull();
  });

  it("tracks cycle time keeping original start on reopen, normalizes column shares to 100%, and exports CSV/MD/SVG", async () => {
    const repoDir = join(sandbox, "thesis");
    await initProject({ dir: repoDir, key: "DIS", name: "Dissertation", owner: "Roshan" });
    const store = new ProjectStore(repoDir);

    const cycle = await store.createCycle({
      name: "Evaluation",
      goal: "Finish chapter 5 pipeline",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
    });

    const t1 = await store.createTicket({
      title: "Implement lead time",
      estimate: 5,
      cycleId: cycle.id,
      assignee: "agent:claude",
    });
    const t2 = await store.createTicket({
      title: "Draft chapter 5 prose",
      estimate: 3,
      cycleId: cycle.id,
      assignee: "Roshan",
    });

    await store.startCycle(cycle.id);

    // Mid-cycle scope addition
    const t3 = await store.createTicket({
      title: "Fix LaTeX table overflow",
      estimate: 2,
      cycleId: cycle.id,
      assignee: "Roshan",
    });
    expect(t3.id).toBe("DIS-3");

    // Simulate exact timeline via events.jsonl + final ticket states
    await store.moveTicket(t1.id, "done", { actor: "Roshan" });
    await store.moveTicket(t2.id, "done", { actor: "Roshan" });

    // Append deterministic historical transitions for a clean replay check
    const events = [
      { id: "e1", at: "2026-11-01T09:00:00.000Z", type: "ticket.created" as const, actor: "Roshan", ticketId: t1.id, data: { status: "todo" } },
      { id: "e2", at: "2026-11-02T09:00:00.000Z", type: "ticket.moved" as const, actor: "agent:claude", ticketId: t1.id, data: { from: "todo", to: "in-progress" } },
      { id: "e3", at: "2026-11-03T09:00:00.000Z", type: "review.requested" as const, actor: "agent:claude", ticketId: t1.id, data: { from: "in-progress", to: "in-review", requestedBy: "agent:claude" } },
      { id: "e4", at: "2026-11-03T09:30:00.000Z", type: "review.rejected" as const, actor: "Roshan", ticketId: t1.id, data: { from: "in-review", to: "in-progress", requestedBy: "agent:claude" } },
      { id: "e5", at: "2026-11-03T21:00:00.000Z", type: "review.requested" as const, actor: "agent:claude", ticketId: t1.id, data: { from: "in-progress", to: "in-review", requestedBy: "agent:claude" } },
      { id: "e6", at: "2026-11-03T21:30:00.000Z", type: "review.approved" as const, actor: "Roshan", ticketId: t1.id, data: { from: "in-review", to: "done", requestedBy: "agent:claude" } },
      { id: "e7", at: "2026-11-01T10:00:00.000Z", type: "ticket.created" as const, actor: "Roshan", ticketId: t2.id, data: { status: "todo" } },
      { id: "e8", at: "2026-11-02T10:00:00.000Z", type: "ticket.moved" as const, actor: "Roshan", ticketId: t2.id, data: { from: "todo", to: "in-progress" } },
      { id: "e9", at: "2026-11-05T10:00:00.000Z", type: "ticket.moved" as const, actor: "Roshan", ticketId: t2.id, data: { from: "in-progress", to: "done" } },
    ];

    const snap = await store.getSnapshot();
    const report = buildMetricsReport({
      config: snap.config,
      tickets: snap.tickets,
      cycles: snap.cycles,
      events,
      cycleId: cycle.id,
      now: "2026-11-08T12:00:00.000Z",
    });

    expect(report.metrics.completedTickets).toBe(2);
    expect(report.metrics.completedPoints).toBe(8);
    expect(report.metrics.scopeAddedPoints).toBe(2);
    expect(report.metrics.reviewsApproved).toBe(1);
    expect(report.metrics.reviewsSentBack).toBe(1);
    expect(report.metrics.medianReviewWaitMinutes).toBe(30);

    // t1 cycle time = Nov 2 09:00 -> Nov 3 21:30 = 1.52 days (~1.5d); t2 = 3.0 days -> median ~2.3d
    expect(report.metrics.medianCycleDays).toBeCloseTo(2.3, 1);

    // Time-in-column shares must sum to 100%
    const shareSum = report.metrics.timeInColumn.reduce((s, r) => s + r.sharePercent, 0);
    expect(shareSum).toBe(100);

    // Exporters produce valid non-empty CSV, Markdown, and SVG
    const csv = exportMetricsCsv(report);
    expect(csv).toContain("ticket_id,title,assignee");
    expect(csv).toContain("DIS-1");

    const evCsv = exportEventsCsv(events);
    expect(evCsv).toContain("review.approved");

    const md = exportMetricsMarkdown(report);
    expect(md).toContain("# Dissertation (DIS) — Metrics Report");
    expect(md).toContain("## Time in Column");

    const svg = exportBurndownSvg(report);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Even pace");

    // Cycle completion freezes snapshot and rolls unfinished DIS-3 to backlog
    await appendEvent(repoDir, { type: "ticket.commented", actor: "Roshan", ticketId: t3.id });
    const completed = await store.completeCycle(cycle.id, { rolloverTo: "backlog" });
    expect(completed.cycle.state).toBe("completed");
    expect(completed.cycle.snapshot).not.toBeNull();
    expect(completed.rolledOverTicketIds).toEqual([t3.id]);
    const rolledTicket = await store.getTicket(t3.id);
    expect(rolledTicket.cycleId).toBeNull();
    expect(rolledTicket.status).toBe("backlog");
  });
});

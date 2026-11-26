import type {
  AssigneeMetricRow,
  BoardEvent,
  BurndownPoint,
  ColumnCategory,
  ColumnConfig,
  ColumnTimeRow,
  Cycle,
  CycleMetricsSnapshot,
  CycleVelocityPoint,
  MetricsReport,
  ProjectConfig,
  Ticket,
  TicketMetricRow,
} from "./types.js";
import { displayActor, isAgentActor } from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  const weight = idx - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function categoryOf(columns: ColumnConfig[], columnId: string): ColumnCategory {
  return columns.find((c) => c.id === columnId)?.category ?? "backlog";
}

function normalizePercentages(rawValues: number[]): number[] {
  const total = rawValues.reduce((s, v) => s + v, 0);
  if (total <= 0) return rawValues.map(() => 0);
  const exact = rawValues.map((v) => (v / total) * 100);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder && k < order.length; k += 1) {
    floors[order[k].i] += 1;
  }
  return floors;
}

interface TransitionSpan {
  columnId: string;
  enteredAt: number;
  exitedAt: number | null;
}

function buildTicketTimeline(
  ticket: Ticket,
  events: BoardEvent[],
  columns: ColumnConfig[],
  nowMs: number,
): {
  spans: TransitionSpan[];
  firstStartedAt: number | null;
  completedAt: number | null;
  reopened: boolean;
  reviewWaitsMs: number[];
} {
  const ticketEvents = events
    .filter((e) => e.ticketId === ticket.id)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const spans: TransitionSpan[] = [];
  let firstStartedAt: number | null = null;
  let completedAt: number | null = null;
  let everDone = false;
  let reopened = false;
  const reviewWaitsMs: number[] = [];
  let pendingReviewStart: number | null = null;

  const createdMs = Date.parse(ticket.createdAt);
  const createdEvent = ticketEvents.find((e) => e.type === "ticket.created");
  const initialStatus =
    (typeof createdEvent?.data?.status === "string" ? createdEvent.data.status : null) ??
    (ticketEvents.find((e) => e.type === "ticket.moved" && typeof e.data?.from === "string")?.data?.from as
      | string
      | undefined) ??
    ticket.status;

  const startMs = createdEvent ? Date.parse(createdEvent.at) : createdMs;
  spans.push({ columnId: initialStatus, enteredAt: startMs, exitedAt: null });

  const initialCat = categoryOf(columns, initialStatus);
  if (initialCat === "started") firstStartedAt = startMs;
  if (initialCat === "review") pendingReviewStart = startMs;
  if (initialCat === "done") {
    completedAt = startMs;
    everDone = true;
  }

  for (const ev of ticketEvents) {
    const t = Date.parse(ev.at);
    if (ev.type === "ticket.moved" || ev.type === "review.requested" || ev.type === "review.approved" || ev.type === "review.rejected") {
      const toCol = typeof ev.data?.to === "string" ? ev.data.to : null;
      if (toCol) {
        const currentSpan = spans.at(-1);
        if (currentSpan && currentSpan.columnId !== toCol) {
          currentSpan.exitedAt = t;
          spans.push({ columnId: toCol, enteredAt: t, exitedAt: null });
        }
        const toCat = categoryOf(columns, toCol);
        if (toCat === "started" && firstStartedAt === null) {
          firstStartedAt = t;
        }
        if (toCat === "review" && pendingReviewStart === null) {
          pendingReviewStart = t;
        }
        if (toCat !== "review" && pendingReviewStart !== null) {
          reviewWaitsMs.push(Math.max(0, t - pendingReviewStart));
          pendingReviewStart = null;
        }
        if (toCat === "done") {
          completedAt = t;
          everDone = true;
        } else if (everDone) {
          reopened = true;
          completedAt = null;
        }
      } else if (ev.type === "review.requested" && pendingReviewStart === null) {
        pendingReviewStart = t;
      } else if ((ev.type === "review.approved" || ev.type === "review.rejected") && pendingReviewStart !== null) {
        reviewWaitsMs.push(Math.max(0, t - pendingReviewStart));
        pendingReviewStart = null;
      }
    }
  }

  // Fallback if ticket is currently Done but events didn't record the move
  if (categoryOf(columns, ticket.status) === "done" && completedAt === null) {
    completedAt = Date.parse(ticket.updatedAt);
  }
  if (categoryOf(columns, ticket.status) !== "done") {
    completedAt = null;
  }

  // Close open span at nowMs for dwell calculations (except backlog/done)
  const lastSpan = spans.at(-1);
  if (lastSpan && lastSpan.exitedAt === null && categoryOf(columns, lastSpan.columnId) !== "done") {
    lastSpan.exitedAt = Math.max(nowMs, lastSpan.enteredAt);
  }

  return { spans, firstStartedAt, completedAt, reopened, reviewWaitsMs };
}

export function calculateCycleMetrics(params: {
  config: ProjectConfig;
  tickets: Ticket[];
  events: BoardEvent[];
  cycle: Cycle | null;
  now?: string;
}): CycleMetricsSnapshot {
  const { config, tickets, events, cycle } = params;
  const nowIso = params.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const scopedTickets = cycle
    ? tickets.filter((t) => t.cycleId === cycle.id && t.triage === "accepted")
    : tickets.filter((t) => t.triage === "accepted");

  const scopeAddedMap = new Map<string, { points: number; ticketIds: string[] }>();
  let scopeAddedPoints = 0;
  const scopeAddedTicketIds: string[] = [];

  if (cycle) {
    for (const sc of cycle.scopeChanges) {
      if (sc.action !== "added") continue;
      scopeAddedPoints += sc.points;
      if (!scopeAddedTicketIds.includes(sc.ticketId)) scopeAddedTicketIds.push(sc.ticketId);
      const day = sc.at.slice(0, 10);
      const bucket = scopeAddedMap.get(day) ?? { points: 0, ticketIds: [] };
      bucket.points += sc.points;
      bucket.ticketIds.push(sc.ticketId);
      scopeAddedMap.set(day, bucket);
    }
  }

  const ticketRows: TicketMetricRow[] = [];
  const leadDaysList: number[] = [];
  const cycleDaysList: number[] = [];
  const reviewWaitMinList: number[] = [];
  const columnDurationsHours = new Map<string, number[]>();

  for (const col of config.columns) {
    if (col.category !== "backlog" && col.category !== "done") {
      columnDurationsHours.set(col.id, []);
    }
  }

  for (const ticket of scopedTickets) {
    const timeline = buildTicketTimeline(ticket, events, config.columns, nowMs);
    const createdMs = Date.parse(ticket.createdAt);

    let leadDays: number | null = null;
    let cycleDays: number | null = null;
    if (timeline.completedAt !== null) {
      leadDays = Math.max(0, (timeline.completedAt - createdMs) / DAY_MS);
      leadDaysList.push(leadDays);
      if (timeline.firstStartedAt !== null) {
        cycleDays = Math.max(0, (timeline.completedAt - timeline.firstStartedAt) / DAY_MS);
        cycleDaysList.push(cycleDays);
      }
    }

    for (const waitMs of timeline.reviewWaitsMs) {
      reviewWaitMinList.push(waitMs / 60_000);
    }

    // Aggregate per-column dwell hours for this ticket
    const ticketColMs = new Map<string, number>();
    for (const span of timeline.spans) {
      if (!columnDurationsHours.has(span.columnId)) continue;
      if (span.exitedAt === null) continue;
      const dur = Math.max(0, span.exitedAt - span.enteredAt);
      ticketColMs.set(span.columnId, (ticketColMs.get(span.columnId) ?? 0) + dur);
    }
    for (const [colId, ms] of ticketColMs.entries()) {
      columnDurationsHours.get(colId)?.push(ms / HOUR_MS);
    }

    ticketRows.push({
      ticketId: ticket.id,
      title: ticket.title,
      assignee: ticket.assignee,
      isAgent: isAgentActor(ticket.assignee),
      estimate: ticket.estimate ?? 0,
      status: ticket.status,
      createdAt: ticket.createdAt,
      startedAt: timeline.firstStartedAt ? new Date(timeline.firstStartedAt).toISOString() : null,
      completedAt: timeline.completedAt ? new Date(timeline.completedAt).toISOString() : null,
      leadDays: leadDays !== null ? round1(leadDays) : null,
      cycleDays: cycleDays !== null ? round1(cycleDays) : null,
      reviewWaitMinutes: timeline.reviewWaitsMs.length
        ? Math.round(timeline.reviewWaitsMs.reduce((a, b) => a + b, 0) / 60_000)
        : null,
      reopened: timeline.reopened,
    });
  }

  // Review approval / send-back counts within this cycle (or overall)
  const scopedIds = new Set(scopedTickets.map((t) => t.id));
  const cycleStartMs = cycle
    ? cycle.actualStart
      ? Math.min(Date.parse(cycle.actualStart), Date.parse(`${cycle.startDate}T00:00:00.000Z`))
      : Date.parse(`${cycle.startDate}T00:00:00.000Z`)
    : 0;
  const cycleEndMs = cycle
    ? cycle.actualEnd
      ? Math.max(Date.parse(cycle.actualEnd), Date.parse(`${cycle.endDate}T23:59:59.999Z`))
      : Date.parse(`${cycle.endDate}T23:59:59.999Z`)
    : nowMs;

  const reviewEvents = events.filter((e) => {
    if (e.type !== "review.approved" && e.type !== "review.rejected") return false;
    if (cycle && e.ticketId && !scopedIds.has(e.ticketId)) return false;
    const t = Date.parse(e.at);
    return t >= cycleStartMs && t <= Math.max(cycleEndMs, nowMs);
  });

  const reviewsApproved = reviewEvents.filter((e) => e.type === "review.approved").length;
  const reviewsSentBack = reviewEvents.filter((e) => e.type === "review.rejected").length;

  // Time in column (normalized to 100%)
  const trackedColumns = config.columns.filter((c) => c.category !== "backlog" && c.category !== "done");
  const rawMedians = trackedColumns.map((col) => percentile(columnDurationsHours.get(col.id) ?? [], 50) ?? 0);
  const shares = normalizePercentages(rawMedians);
  const timeInColumn: ColumnTimeRow[] = trackedColumns.map((col, idx) => {
    const samples = columnDurationsHours.get(col.id) ?? [];
    const med = percentile(samples, 50) ?? 0;
    const p85 = percentile(samples, 85) ?? 0;
    return {
      columnId: col.id,
      columnName: col.name,
      category: col.category,
      medianHours: round1(med),
      p85Hours: round1(p85),
      sharePercent: shares[idx] ?? 0,
      sampleCount: samples.length,
    };
  });

  // Assignee breakdown (from completed tickets in scope)
  const assigneeMap = new Map<
    string,
    {
      isAgent: boolean;
      completedTickets: number;
      completedPoints: number;
      cycleDays: number[];
      reviewsApproved: number;
      reviewsSentBack: number;
    }
  >();

  for (const row of ticketRows) {
    if (!row.completedAt) continue;
    const key = row.assignee ?? config.owner;
    const entry = assigneeMap.get(key) ?? {
      isAgent: isAgentActor(key),
      completedTickets: 0,
      completedPoints: 0,
      cycleDays: [],
      reviewsApproved: 0,
      reviewsSentBack: 0,
    };
    entry.completedTickets += 1;
    entry.completedPoints += row.estimate;
    if (row.cycleDays !== null) entry.cycleDays.push(row.cycleDays);
    assigneeMap.set(key, entry);
  }

  // Map ticketId -> assignee for review counts
  const ticketAssignee = new Map<string, string>();
  for (const t of scopedTickets) {
    ticketAssignee.set(t.id, t.assignee ?? config.owner);
  }
  for (const ev of reviewEvents) {
    if (!ev.ticketId) continue;
    const assigneeKey =
      (typeof ev.data?.requestedBy === "string" ? ev.data.requestedBy : null) ??
      ticketAssignee.get(ev.ticketId) ??
      config.owner;
    const entry = assigneeMap.get(assigneeKey) ?? {
      isAgent: isAgentActor(assigneeKey),
      completedTickets: 0,
      completedPoints: 0,
      cycleDays: [],
      reviewsApproved: 0,
      reviewsSentBack: 0,
    };
    if (ev.type === "review.approved") entry.reviewsApproved += 1;
    if (ev.type === "review.rejected") entry.reviewsSentBack += 1;
    assigneeMap.set(assigneeKey, entry);
  }

  const byAssignee: AssigneeMetricRow[] = [...assigneeMap.entries()]
    .map(([assignee, data]) => {
      const med = percentile(data.cycleDays, 50);
      const p85 = percentile(data.cycleDays, 85);
      return {
        assignee,
        isAgent: data.isAgent,
        completedTickets: data.completedTickets,
        completedPoints: data.completedPoints,
        medianCycleDays: med !== null ? round1(med) : null,
        p85CycleDays: p85 !== null ? round1(p85) : null,
        reviewsApproved: data.reviewsApproved,
        reviewsSentBack: data.reviewsSentBack,
      };
    })
    .sort((a, b) => Number(a.isAgent) - Number(b.isAgent) || b.completedTickets - a.completedTickets || a.assignee.localeCompare(b.assignee));

  // Burndown series
  const totalPoints = scopedTickets.reduce((s, t) => s + (t.estimate ?? 0), 0);
  const completedRows = ticketRows.filter((r) => r.completedAt !== null);
  const completedPoints = completedRows.reduce((s, r) => s + r.estimate, 0);
  const committedPoints = cycle && cycle.initialPoints > 0
    ? cycle.initialPoints
    : Math.max(0, totalPoints - scopeAddedPoints);

  const burndown: BurndownPoint[] = [];
  if (cycle) {
    const startDayMs = Date.parse(`${cycle.startDate}T00:00:00.000Z`);
    const endDayMs = Date.parse(`${cycle.endDate}T00:00:00.000Z`);
    const totalDays = Math.max(1, Math.round((endDayMs - startDayMs) / DAY_MS));
    const cutoffMs = cycle.state === "completed" && cycle.actualEnd
      ? Date.parse(cycle.actualEnd)
      : Math.min(nowMs, endDayMs + DAY_MS - 1);

    const addedDateByTicket = new Map<string, number>();
    for (const sc of cycle.scopeChanges) {
      if (sc.action === "added") {
        addedDateByTicket.set(sc.ticketId, Date.parse(sc.at));
      }
    }

    for (let d = 0; d <= totalDays; d += 1) {
      const dayMs = startDayMs + d * DAY_MS;
      const dayEndMs = dayMs + DAY_MS - 1;
      const dateStr = new Date(dayMs).toISOString().slice(0, 10);
      const evenPacePoints = round1(committedPoints * (1 - d / totalDays));

      if (dayMs > cutoffMs) {
        // Still record future even-pace points only? Keep actual undefined by stopping actual at cutoff,
        // or include future days with remainingPoints = -1? Better: only emit up to cutoff or mark future cleanly.
        // We emit full cycle days; future days carry remainingPoints: -1? No, keep BurndownPoint numeric and emit days up to today + endDate reference on cycle!
        continue;
      }

      let remainingPts = 0;
      let remainingCount = 0;
      for (const row of ticketRows) {
        const addedAt = addedDateByTicket.get(row.ticketId);
        if (addedAt !== undefined && addedAt > dayEndMs) continue;
        const doneAt = row.completedAt ? Date.parse(row.completedAt) : null;
        if (doneAt === null || doneAt > dayEndMs) {
          remainingPts += row.estimate;
          remainingCount += 1;
        }
      }

      const scopeBucket = scopeAddedMap.get(dateStr);
      burndown.push({
        date: dateStr,
        dayIndex: d,
        remainingPoints: round1(remainingPts),
        evenPacePoints,
        remainingTickets: remainingCount,
        scopeAddedPoints: scopeBucket?.points ?? 0,
        scopeAddedTickets: scopeBucket?.ticketIds ?? [],
      });
    }
  }

  const elapsedWeeks = Math.max(
    1 / 7,
    ((cycle ? Math.min(nowMs, cycleEndMs) - cycleStartMs : Math.max(DAY_MS, nowMs - (ticketRows.reduce((m, r) => Math.min(m, Date.parse(r.createdAt)), nowMs)))) /
      (7 * DAY_MS)),
  );

  const medCycle = percentile(cycleDaysList, 50);
  const avgCycle = average(cycleDaysList);
  const p85Cycle = percentile(cycleDaysList, 85);
  const medLead = percentile(leadDaysList, 50);
  const avgLead = average(leadDaysList);
  const p85Lead = percentile(leadDaysList, 85);
  const medReview = percentile(reviewWaitMinList, 50);

  return {
    calculatedAt: nowIso,
    eventCount: events.length,
    committedPoints,
    completedPoints,
    totalPoints,
    completedTickets: completedRows.length,
    totalTickets: scopedTickets.length,
    scopeAddedPoints,
    scopeAddedTicketIds,
    medianCycleDays: medCycle !== null ? round1(medCycle) : null,
    avgCycleDays: avgCycle !== null ? round1(avgCycle) : null,
    p85CycleDays: p85Cycle !== null ? round1(p85Cycle) : null,
    medianLeadDays: medLead !== null ? round1(medLead) : null,
    avgLeadDays: avgLead !== null ? round1(avgLead) : null,
    p85LeadDays: p85Lead !== null ? round1(p85Lead) : null,
    medianReviewWaitMinutes: medReview !== null ? Math.round(medReview) : null,
    reviewsApproved,
    reviewsSentBack,
    throughputPerWeek: round1(completedRows.length / elapsedWeeks),
    burndown,
    timeInColumn,
    byAssignee,
    tickets: ticketRows,
  };
}

export function buildMetricsReport(params: {
  config: ProjectConfig;
  tickets: Ticket[];
  cycles: Cycle[];
  events: BoardEvent[];
  cycleId?: string | null;
  now?: string;
}): MetricsReport {
  const { config, tickets, cycles, events, cycleId } = params;
  const nowIso = params.now ?? new Date().toISOString();

  const sortedCycles = [...cycles].sort((a, b) => a.number - b.number);
  let selected: Cycle | null = null;
  if (cycleId) {
    selected = sortedCycles.find((c) => c.id === cycleId || String(c.number) === cycleId) ?? null;
  } else {
    selected =
      sortedCycles.find((c) => c.state === "active") ??
      [...sortedCycles].reverse().find((c) => c.state === "completed") ??
      sortedCycles.at(-1) ??
      null;
  }

  const metrics =
    selected?.state === "completed" && selected.snapshot
      ? selected.snapshot
      : calculateCycleMetrics({ config, tickets, events, cycle: selected, now: nowIso });

  let previousCycleMedianCycleDays: number | null = null;
  if (selected) {
    const prev = [...sortedCycles]
      .filter((c) => c.number < selected!.number && c.state === "completed")
      .at(-1);
    if (prev) {
      const prevSnap =
        prev.snapshot ??
        calculateCycleMetrics({ config, tickets, events, cycle: prev, now: prev.actualEnd ?? nowIso });
      previousCycleMedianCycleDays = prevSnap.medianCycleDays;
    }
  }

  const velocityHistory: CycleVelocityPoint[] = sortedCycles
    .filter((c) => c.state !== "planned")
    .map((c) => {
      const snap =
        c.state === "completed" && c.snapshot
          ? c.snapshot
          : calculateCycleMetrics({ config, tickets, events, cycle: c, now: nowIso });
      return {
        cycleId: c.id,
        cycleNumber: c.number,
        name: c.name,
        state: c.state,
        committedPoints: snap.committedPoints,
        completedPoints: snap.completedPoints,
        completedTickets: snap.completedTickets,
      };
    });

  return {
    projectKey: config.key,
    projectName: config.name,
    generatedAt: nowIso,
    lastEventAt: events.at(-1)?.at ?? null,
    totalEvents: events.length,
    selectedCycle: selected,
    previousCycleMedianCycleDays,
    metrics,
    velocityHistory,
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function exportMetricsCsv(report: MetricsReport): string {
  const header = [
    "ticket_id",
    "title",
    "assignee",
    "is_agent",
    "estimate",
    "status",
    "created_at",
    "started_at",
    "completed_at",
    "lead_days",
    "cycle_days",
    "review_wait_minutes",
    "reopened",
  ];
  const rows = report.metrics.tickets.map((t) =>
    [
      t.ticketId,
      t.title,
      t.assignee ?? "",
      t.isAgent,
      t.estimate,
      t.status,
      t.createdAt,
      t.startedAt ?? "",
      t.completedAt ?? "",
      t.leadDays ?? "",
      t.cycleDays ?? "",
      t.reviewWaitMinutes ?? "",
      t.reopened,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

export function exportEventsCsv(events: BoardEvent[]): string {
  const header = ["id", "at", "type", "actor", "ticket_id", "cycle_id", "data"];
  const rows = events.map((e) =>
    [e.id, e.at, e.type, e.actor, e.ticketId ?? "", e.cycleId ?? "", e.data ? JSON.stringify(e.data) : ""]
      .map(csvEscape)
      .join(","),
  );
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

export function exportMetricsMarkdown(report: MetricsReport): string {
  const m = report.metrics;
  const cycleLabel = report.selectedCycle
    ? `Cycle ${report.selectedCycle.number}: ${report.selectedCycle.name} (${report.selectedCycle.startDate} to ${report.selectedCycle.endDate})`
    : "All tickets";

  const lines: string[] = [
    `# ${report.projectName} (${report.projectKey}) — Metrics Report`,
    "",
    `- **Scope:** ${cycleLabel}`,
    `- **Generated:** ${report.generatedAt}`,
    `- **Events analyzed:** ${m.eventCount}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Median cycle time | ${m.medianCycleDays !== null ? `${m.medianCycleDays} days` : "—"} (p85: ${m.p85CycleDays !== null ? `${m.p85CycleDays} days` : "—"}) |`,
    `| Median lead time | ${m.medianLeadDays !== null ? `${m.medianLeadDays} days` : "—"} (p85: ${m.p85LeadDays !== null ? `${m.p85LeadDays} days` : "—"}) |`,
    `| Completed points | ${m.completedPoints} of ${m.totalPoints} (${m.completedTickets} tickets) |`,
    `| Scope added mid-cycle | +${m.scopeAddedPoints} pts${m.scopeAddedTicketIds.length ? ` (${m.scopeAddedTicketIds.join(", ")})` : ""} |`,
    `| Median wait for review | ${m.medianReviewWaitMinutes !== null ? `${m.medianReviewWaitMinutes} min` : "—"} (${m.reviewsApproved} approved, ${m.reviewsSentBack} sent back) |`,
    `| Throughput | ${m.throughputPerWeek} tickets / week |`,
    "",
    "## Time in Column",
    "",
    "| Column | Median (h) | p85 (h) | Share |",
    "| --- | ---: | ---: | ---: |",
    ...m.timeInColumn.map(
      (c) => `| ${c.columnName} | ${c.medianHours} | ${c.p85Hours} | ${c.sharePercent}% |`,
    ),
    "",
    "## Cycle Time by Assignee",
    "",
    "| Assignee | Type | Completed | Points | Median (d) | p85 (d) | Reviews (approved / sent back) |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...m.byAssignee.map(
      (a) =>
        `| ${displayActor(a.assignee)} | ${a.isAgent ? "Agent" : "Human"} | ${a.completedTickets} | ${a.completedPoints} | ${a.medianCycleDays ?? "—"} | ${a.p85CycleDays ?? "—"} | ${a.reviewsApproved} / ${a.reviewsSentBack} |`,
    ),
    "",
    "## Methodology",
    "",
    "Cycle time runs from a ticket's first move into an In progress column until it reaches Done; reopened tickets keep their original start timestamp. Lead time runs from ticket creation to Done. All figures are derived from `.triathlon/events.jsonl`.",
    "",
  ];
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function exportBurndownSvg(report: MetricsReport): string {
  const cycle = report.selectedCycle;
  const points = report.metrics.burndown;
  const width = 760;
  const height = 300;
  const pad = { top: 44, right: 32, bottom: 44, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const totalDays = cycle
    ? Math.max(1, Math.round((Date.parse(`${cycle.endDate}T00:00:00.000Z`) - Date.parse(`${cycle.startDate}T00:00:00.000Z`)) / DAY_MS))
    : Math.max(1, points.length - 1);

  const maxY = Math.max(
    10,
    Math.ceil(
      Math.max(
        report.metrics.committedPoints,
        report.metrics.totalPoints,
        ...points.map((p) => Math.max(p.remainingPoints, p.evenPacePoints)),
      ) / 10,
    ) * 10,
  );

  const xForDay = (day: number) => pad.left + (day / totalDays) * plotW;
  const yForVal = (val: number) => pad.top + plotH - (val / maxY) * plotH;

  const gridLines: string[] = [];
  for (let step = 0; step <= 4; step += 1) {
    const val = Math.round((maxY / 4) * step);
    const y = yForVal(val);
    gridLines.push(
      `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#E2DED6" stroke-width="1"/>`,
      `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6E695F">${val}</text>`,
    );
  }

  const pacePath = `M ${xForDay(0)} ${yForVal(report.metrics.committedPoints)} L ${xForDay(totalDays)} ${yForVal(0)}`;
  const actualCoords = points.map((p) => `${xForDay(p.dayIndex).toFixed(1)},${yForVal(p.remainingPoints).toFixed(1)}`);
  const lastPoint = points.at(-1);

  const title = cycle
    ? `${report.projectName} · Cycle ${cycle.number} (${cycle.startDate} – ${cycle.endDate})`
    : `${report.projectName} · Points remaining`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="font-family:Inter,system-ui,-apple-system,sans-serif;background:#F6F4EF">
  <text x="${pad.left}" y="24" font-size="14" font-weight="700" fill="#1F1D1A">${escapeXml(title)}</text>
  <line x1="${width - 210}" y1="20" x2="${width - 190}" y2="20" stroke="#1F1D1A" stroke-width="2"/>
  <text x="${width - 184}" y="24" font-size="11" fill="#5B574F">Actual</text>
  <line x1="${width - 128}" y1="20" x2="${width - 108}" y2="20" stroke="#8C877D" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="${width - 102}" y="24" font-size="11" fill="#5B574F">Even pace</text>
  ${gridLines.join("\n  ")}
  <path d="${pacePath}" fill="none" stroke="#8C877D" stroke-width="1.5" stroke-dasharray="5 5"/>
  ${actualCoords.length > 1 ? `<polyline points="${actualCoords.join(" ")}" fill="none" stroke="#1F1D1A" stroke-width="2.2" stroke-linejoin="round"/>` : ""}
  ${lastPoint ? `<circle cx="${xForDay(lastPoint.dayIndex)}" cy="${yForVal(lastPoint.remainingPoints)}" r="4" fill="#1F1D1A"/>` : ""}
  ${cycle ? `<text x="${pad.left}" y="${height - 14}" font-size="11" fill="#6E695F">${escapeXml(cycle.startDate)}</text><text x="${width - pad.right}" y="${height - 14}" text-anchor="end" font-size="11" fill="#6E695F">${escapeXml(cycle.endDate)}</text>` : ""}
</svg>
`;
}

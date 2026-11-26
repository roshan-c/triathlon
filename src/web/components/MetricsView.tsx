import { useEffect, useState } from "react";
import type { MetricsReport, ProjectSnapshot } from "../../core/types.js";
import { displayActor } from "../../core/types.js";
import { api, formatRelativeTime } from "../lib/api.js";
import { AgentGlyph, DownloadIcon } from "./Icons.js";

interface MetricsViewProps {
  snapshot: ProjectSnapshot;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours} h`;
}

export function MetricsView({ snapshot }: MetricsViewProps) {
  const activeCycle = snapshot.cycles.find((c) => c.state === "active") ?? snapshot.cycles.at(-1) ?? null;
  const [selectedCycleId, setSelectedCycleId] = useState<string>(activeCycle?.id ?? "");
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .getMetrics(snapshot.projectId, selectedCycleId || null)
      .then((data) => {
        if (!cancelled) {
          setReport(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.projectId, snapshot.eventCount, selectedCycleId]);

  if (loading && !report) {
    return (
      <div className="p-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
        Computing metrics from events.jsonl…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
        Could not load metrics.
      </div>
    );
  }

  const m = report.metrics;
  const cycle = report.selectedCycle;

  // Burndown SVG geometry
  const burndown = m.burndown;
  const chartW = 640;
  const chartH = 220;
  const pad = { top: 34, right: 24, bottom: 30, left: 38 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;

  const totalDays = cycle
    ? Math.max(
        1,
        Math.round(
          (Date.parse(`${cycle.endDate}T00:00:00.000Z`) - Date.parse(`${cycle.startDate}T00:00:00.000Z`)) /
            86_400_000,
        ),
      )
    : Math.max(1, burndown.length - 1);

  const maxY = Math.max(
    10,
    Math.ceil(
      Math.max(m.committedPoints, m.totalPoints, ...burndown.map((p) => Math.max(p.remainingPoints, p.evenPacePoints))) /
        10,
    ) * 10,
  );
  const xForDay = (day: number) => pad.left + (day / totalDays) * plotW;
  const yForVal = (val: number) => pad.top + plotH - (val / maxY) * plotH;

  const lastPoint = burndown.at(-1);
  const scopePoint = burndown.find((p) => p.scopeAddedPoints > 0);
  const deltaFromPace = lastPoint ? Math.round((lastPoint.remainingPoints - lastPoint.evenPacePoints) * 10) / 10 : 0;

  // Assignee dot-to-p85 scale
  const maxAssigneeDays = Math.max(
    2,
    ...m.byAssignee.map((a) => Math.max(a.p85CycleDays ?? 0, a.medianCycleDays ?? 0)),
  );
  const roundedAxisMax = Math.ceil(maxAssigneeDays / 2) * 2;

  // Human vs agent summary sentence
  const humanRows = m.byAssignee.filter((a) => !a.isAgent && a.medianCycleDays !== null);
  const agentRows = m.byAssignee.filter((a) => a.isAgent && a.medianCycleDays !== null);
  const humanMed = humanRows[0]?.medianCycleDays ?? null;
  const agentMed = agentRows.length
    ? agentRows.reduce((s, a) => s + (a.medianCycleDays ?? 0), 0) / agentRows.length
    : null;
  const agentApproved = agentRows.reduce((s, a) => s + a.reviewsApproved, 0);
  const agentSentBack = agentRows.reduce((s, a) => s + a.reviewsSentBack, 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header
        className="flex items-center justify-between gap-3 border-b px-4 pt-3.5 pb-3 md:px-8 md:pt-5 md:pb-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {snapshot.config.name}
          </div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight md:text-[24px]">Metrics</h1>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <select
            value={selectedCycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
            aria-label="Select cycle"
            className="max-w-[140px] rounded-md border px-2.5 py-1.5 text-[13px] font-medium md:max-w-none md:px-3 md:text-[12px]"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-input)",
              color: "var(--ink)",
            }}
          >
            <option value="">Active cycle</option>
            {snapshot.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                Cycle {c.number} · {c.name}
              </option>
            ))}
          </select>

          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold md:min-h-0 md:text-[12px]"
              style={{
                background: "var(--bg-card)",
                borderColor: "var(--border-input)",
                color: "var(--ink)",
              }}
            >
              <DownloadIcon size={14} />
              <span>Export</span>
            </button>

            {exportOpen && (
              <div
                className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border py-1 shadow-lg"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)" }}
              >
                {[
                  { format: "csv" as const, label: "Ticket metrics (.csv)" },
                  { format: "events-csv" as const, label: "Raw events log (.csv)" },
                  { format: "md" as const, label: "Dissertation summary (.md)" },
                  { format: "svg" as const, label: "Burndown figure (.svg)" },
                  { format: "json" as const, label: "Full report (.json)" },
                ].map((opt) => (
                  <a
                    key={opt.format}
                    href={api.exportMetricsUrl(snapshot.projectId, opt.format, selectedCycleId || null)}
                    onClick={() => setExportOpen(false)}
                    className="block min-h-[40px] px-3.5 py-2.5 text-[13px] hover:underline md:min-h-0 md:py-2 md:text-[12px]"
                    style={{ color: "var(--ink)" }}
                  >
                    {opt.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero + 3 hairline-separated KPI strip (mobile: Hero on top + 3-up horizontal strip; desktop: 4-col) */}
      <section className="border-b px-4 py-5 md:grid md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8 md:py-7" style={{ borderColor: "var(--border)" }}>
        <div className="pb-4 md:pb-0 md:pr-6">
          <div className="text-[12px]" style={{ color: "var(--ink-2)" }}>
            Median cycle time{cycle ? ` · ${cycle.startDate} – ${cycle.endDate}` : ""}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[44px] font-bold leading-none tracking-tight tabular-nums">
              {m.medianCycleDays !== null ? m.medianCycleDays : "—"}
            </span>
            {m.medianCycleDays !== null && (
              <span className="text-[18px]" style={{ color: "var(--ink-2)" }}>
                days
              </span>
            )}
          </div>
          <div className="mt-2 text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {report.previousCycleMedianCycleDays !== null && m.medianCycleDays !== null
              ? `${m.medianCycleDays <= report.previousCycleMedianCycleDays ? "Down" : "Up"} from ${report.previousCycleMedianCycleDays} days last cycle · `
              : ""}
            {m.p85CycleDays !== null ? `p85 is ${m.p85CycleDays} days` : "complete tickets to compute"}
          </div>
        </div>

        {/* Mobile 3-up hairline strip / Desktop 3 separate columns */}
        <div
          className="grid grid-cols-3 border-t pt-4 md:contents"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="pr-2 md:border-l md:pl-7 md:pr-0" style={{ borderColor: "var(--border)" }}>
            <div className="hidden text-[12px] md:block" style={{ color: "var(--ink-2)" }}>
              Done this cycle
            </div>
            <div className="flex items-baseline gap-1 md:mt-2">
              <span className="text-[22px] font-bold leading-none tabular-nums md:text-[28px]">{m.completedPoints}</span>
              <span className="text-[12px] tabular-nums md:text-[14px]" style={{ color: "var(--ink-2)" }}>
                /{m.totalPoints} pts
              </span>
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums md:mt-2.5 md:text-[12px]" style={{ color: "var(--ink-3)" }}>
              {m.completedTickets} of {m.totalTickets} done
            </div>
          </div>

          <div className="border-l px-3 md:pl-7 md:pr-0" style={{ borderColor: "var(--border)" }}>
            <div className="hidden text-[12px] md:block" style={{ color: "var(--ink-2)" }}>
              Median wait for review
            </div>
            <div className="flex items-baseline gap-1 md:mt-2">
              <span className="text-[22px] font-bold leading-none tabular-nums md:text-[28px]">
                {m.medianReviewWaitMinutes !== null ? m.medianReviewWaitMinutes : "—"}
              </span>
              {m.medianReviewWaitMinutes !== null && (
                <span className="text-[12px] md:text-[14px]" style={{ color: "var(--ink-2)" }}>
                  min
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums md:mt-2.5 md:text-[12px]" style={{ color: "var(--ink-3)" }}>
              wait for review
            </div>
          </div>

          <div className="border-l pl-3 md:pl-7" style={{ borderColor: "var(--border)" }}>
            <div className="hidden text-[12px] md:block" style={{ color: "var(--ink-2)" }}>
              Scope added
            </div>
            <div className="flex items-baseline gap-1 md:mt-2">
              <span className="text-[22px] font-bold leading-none tabular-nums md:text-[28px]">+{m.scopeAddedPoints}</span>
              <span className="text-[12px] md:text-[14px]" style={{ color: "var(--ink-2)" }}>
                scope
              </span>
            </div>
            <div className="mt-1.5 truncate text-[11px] md:mt-2.5 md:text-[12px]" style={{ color: "var(--ink-3)" }}>
              {m.scopeAddedTicketIds.length > 0 ? m.scopeAddedTicketIds.join(", ") : "none added"}
            </div>
          </div>
        </div>
      </section>

      {/* Main charts row: Burndown + Cycle time by assignee */}
      <section
        className="grid grid-cols-1 border-b lg:grid-cols-[1.55fr_1fr]"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Points remaining burndown */}
        <div className="px-4 py-5 md:px-8 md:py-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="m-0 text-[14px] font-semibold">Points remaining</h2>
            <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--ink-2)" }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4" style={{ background: "var(--ink)" }} />
                Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0 w-4 border-t border-dashed"
                  style={{ borderColor: "var(--ink-3)" }}
                />
                Even pace
              </span>
            </div>
          </div>

          {!cycle || burndown.length === 0 ? (
            <div className="py-12 text-[13px]" style={{ color: "var(--ink-3)" }}>
              Start a cycle with estimated tickets to plot daily burndown.
            </div>
          ) : (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-auto w-full" role="img" aria-label="Cycle burndown">
              {[0, 1, 2, 3, 4].map((step) => {
                const val = Math.round((maxY / 4) * step);
                const y = yForVal(val);
                return (
                  <g key={step}>
                    <line
                      x1={pad.left}
                      y1={y}
                      x2={chartW - pad.right}
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth="1"
                    />
                    <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Even pace dashed line */}
              <line
                x1={xForDay(0)}
                y1={yForVal(m.committedPoints)}
                x2={xForDay(totalDays)}
                y2={yForVal(0)}
                stroke="var(--ink-3)"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />

              {/* Scope-added callout */}
              {scopePoint && (
                <g>
                  <line
                    x1={xForDay(scopePoint.dayIndex)}
                    y1={pad.top - 4}
                    x2={xForDay(scopePoint.dayIndex)}
                    y2={yForVal(scopePoint.remainingPoints)}
                    stroke="var(--ink-3)"
                    strokeWidth="1"
                  />
                  <text
                    x={Math.max(pad.left + 4, xForDay(scopePoint.dayIndex) - 4)}
                    y={pad.top - 12}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--ink-2)"
                  >
                    +{scopePoint.scopeAddedPoints} pts added, day {scopePoint.dayIndex}
                  </text>
                </g>
              )}

              {/* Actual polyline */}
              {burndown.length > 1 && (
                <polyline
                  points={burndown
                    .map((p) => `${xForDay(p.dayIndex).toFixed(1)},${yForVal(p.remainingPoints).toFixed(1)}`)
                    .join(" ")}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              )}

              {/* Today marker + clearance label */}
              {lastPoint && (
                <g>
                  <line
                    x1={xForDay(lastPoint.dayIndex)}
                    y1={pad.top - 6}
                    x2={xForDay(lastPoint.dayIndex)}
                    y2={chartH - pad.bottom}
                    stroke="var(--ink-3)"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={xForDay(lastPoint.dayIndex)}
                    cy={yForVal(lastPoint.remainingPoints)}
                    r="3.8"
                    fill="var(--ink)"
                  />
                  <text
                    x={Math.min(chartW - pad.right - 96, xForDay(lastPoint.dayIndex) + 8)}
                    y={pad.top + 4}
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--ink)"
                  >
                    Today
                  </text>
                  <text
                    x={Math.min(chartW - pad.right - 96, xForDay(lastPoint.dayIndex) + 8)}
                    y={pad.top + 18}
                    fontSize="11"
                    fill="var(--ink-2)"
                  >
                    {lastPoint.remainingPoints} left
                    {deltaFromPace !== 0 ? `, ${Math.abs(deltaFromPace)} ${deltaFromPace > 0 ? "above" : "ahead of"} pace` : ""}
                  </text>
                </g>
              )}

              {/* X-axis dates */}
              <text x={pad.left} y={chartH - 8} fontSize="11" fill="var(--ink-3)">
                {cycle.startDate}
              </text>
              <text x={chartW - pad.right} y={chartH - 8} textAnchor="end" fontSize="11" fill="var(--ink-3)">
                {cycle.endDate}
              </text>
            </svg>
          )}
        </div>

        {/* Cycle time by assignee */}
        <div
          className="border-t px-4 py-5 md:px-8 md:py-6 lg:border-t-0 lg:border-l"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="m-0 mb-1.5 text-[14px] font-semibold">Cycle time by assignee</h2>
          <p className="m-0 mb-5 text-[12px]" style={{ color: "var(--ink-3)" }}>
            Dot marks the median; the bar runs to p85. Done tickets in scope.
          </p>

          {m.byAssignee.length === 0 ? (
            <div className="py-6 text-[13px]" style={{ color: "var(--ink-3)" }}>
              No completed tickets in this scope yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {m.byAssignee.map((row) => {
                const med = row.medianCycleDays ?? 0;
                const p85 = row.p85CycleDays ?? med;
                const medPct = Math.min(100, (med / roundedAxisMax) * 100);
                const p85Pct = Math.min(100, (p85 / roundedAxisMax) * 100);
                return (
                  <div key={row.assignee} className="grid grid-cols-[100px_1fr_76px] items-center gap-3 text-[12px]">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {row.isAgent && <AgentGlyph size={12} className="shrink-0 opacity-75" />}
                      <span className="truncate">{displayActor(row.assignee)}</span>
                    </span>
                    <div className="relative h-4">
                      <div
                        className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2"
                        style={{ background: "var(--border)" }}
                      />
                      {row.medianCycleDays !== null && (
                        <>
                          <div
                            className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full"
                            style={{
                              left: `${medPct}%`,
                              width: `${Math.max(2, p85Pct - medPct)}%`,
                              background: "var(--ink-3)",
                            }}
                          />
                          <div
                            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                            style={{ left: `${medPct}%`, background: "var(--ink)" }}
                          />
                        </>
                      )}
                    </div>
                    <span className="text-right tabular-nums" style={{ color: "var(--ink-2)" }}>
                      {row.medianCycleDays !== null ? `${row.medianCycleDays} / ${row.p85CycleDays ?? row.medianCycleDays} d` : "—"}
                    </span>
                  </div>
                );
              })}

              <div className="grid grid-cols-[100px_1fr_76px] gap-3 text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                <div />
                <div className="flex justify-between">
                  <span>0</span>
                  <span>{roundedAxisMax / 2} d</span>
                  <span>{roundedAxisMax} d</span>
                </div>
                <div />
              </div>

              {humanMed !== null && agentMed !== null && (
                <p
                  className="mt-3 border-t pt-4 text-[12px] leading-relaxed"
                  style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
                >
                  Agent tickets averaged {agentMed.toFixed(1)} d median vs {humanMed.toFixed(1)} d for human tickets
                  {agentApproved + agentSentBack > 0
                    ? `, with ${agentSentBack} of ${agentApproved + agentSentBack} agent reviews sent back.`
                    : "."}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Where the time goes + Velocity across cycles */}
      <section className="px-4 py-5 md:px-8 md:py-6">
        <div className="grid grid-cols-1 gap-5 md:gap-8 lg:grid-cols-[200px_1fr]">
          <div>
            <h2 className="m-0 mb-1 text-[14px] font-semibold">Where the time goes</h2>
            <p className="m-0 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Hours each ticket spends per column.
            </p>
          </div>

          <div>
            <div
              className="grid grid-cols-[110px_64px_64px_1fr] items-center gap-2 border-b pb-2 text-[11px] md:grid-cols-[140px_90px_90px_1fr] md:gap-4"
              style={{ borderColor: "var(--border)", color: "var(--ink-3)" }}
            >
              <div>Column</div>
              <div className="text-right">Median</div>
              <div className="text-right">p85</div>
              <div>Share</div>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {m.timeInColumn.map((col) => {
                const isDominant = col.sharePercent === Math.max(...m.timeInColumn.map((c) => c.sharePercent)) && col.sharePercent > 0;
                return (
                  <div
                    key={col.columnId}
                    className="grid grid-cols-[110px_64px_64px_1fr] items-center gap-2 py-3 text-[13px] md:grid-cols-[140px_90px_90px_1fr] md:gap-4"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div style={{ fontWeight: isDominant ? 600 : 400 }}>{col.columnName}</div>
                    <div className="text-right tabular-nums" style={{ fontWeight: isDominant ? 600 : 400 }}>
                      {formatHours(col.medianHours)}
                    </div>
                    <div className="text-right tabular-nums" style={{ color: "var(--ink-2)" }}>
                      {formatHours(col.p85Hours)}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-[6px] flex-1 max-w-[300px] overflow-hidden rounded-full" style={{ background: "transparent" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(col.sharePercent > 0 ? 2 : 0, col.sharePercent)}%`,
                            background: isDominant ? "var(--ink)" : "var(--ink-3)",
                          }}
                        />
                      </div>
                      <span className="text-[12px] tabular-nums" style={{ fontWeight: isDominant ? 600 : 400 }}>
                        {col.sharePercent}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Velocity across cycles */}
        {report.velocityHistory.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-8 border-t pt-6 lg:grid-cols-[200px_1fr]" style={{ borderColor: "var(--border)" }}>
            <div>
              <h2 className="m-0 mb-1 text-[14px] font-semibold">Velocity by cycle</h2>
              <p className="m-0 text-[12px]" style={{ color: "var(--ink-3)" }}>
                Committed vs completed points across cycles.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {report.velocityHistory.map((v) => {
                const maxV = Math.max(1, ...report.velocityHistory.map((item) => Math.max(item.committedPoints, item.completedPoints)));
                return (
                  <div key={v.cycleId} className="grid grid-cols-[140px_1fr_110px] items-center gap-4 text-[12px]">
                    <span className="truncate font-medium">
                      C{v.cycleNumber} · {v.name}
                    </span>
                    <div className="relative h-4">
                      <div
                        className="absolute left-0 top-0.5 h-3 rounded-sm"
                        style={{
                          width: `${(v.committedPoints / maxV) * 100}%`,
                          background: "var(--track)",
                        }}
                      />
                      <div
                        className="absolute left-0 top-0.5 h-3 rounded-sm"
                        style={{
                          width: `${(v.completedPoints / maxV) * 100}%`,
                          background: v.state === "active" ? "var(--accent)" : "var(--ink)",
                        }}
                      />
                    </div>
                    <span className="text-right tabular-nums" style={{ color: "var(--ink-2)" }}>
                      {v.completedPoints} / {v.committedPoints} pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* How this is measured */}
        <div
          className="mt-8 grid grid-cols-1 gap-8 border-t pt-5 lg:grid-cols-[200px_1fr]"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="eyebrow pt-0.5">How this is measured</div>
          <p className="m-0 max-w-[680px] text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            Cycle time runs from a ticket&apos;s first move into In progress until it reaches Done; reopened tickets keep
            their first start. Figures come from {report.totalEvents} events in{" "}
            <code className="font-mono">.triathlon/events.jsonl</code>
            {report.lastEventAt ? `, last recorded ${formatRelativeTime(report.lastEventAt)} ago` : ""}. Export writes
            these exact figures as CSV, Markdown, or print-ready SVG.
          </p>
        </div>
      </section>
    </div>
  );
}

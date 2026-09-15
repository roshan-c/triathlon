import { readFile } from "node:fs/promises";

const styleUrl = new URL("../ui/style.css", import.meta.url);
const appUrl = new URL("../ui/app.js", import.meta.url);

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderMetricsHtml(report) {
  const active = report.activeSprint;
  const completed = report.completedSprints;
  const selected = active ?? completed.at(-1) ?? null;
  const metrics = selected?.metrics;
  const points = metrics?.burndown ?? [];
  const width = 760;
  const height = 260;
  const maximum = Math.max(1, ...points.map((point) => point.pointsRemaining));
  const polyline = points.map((point, index) => {
    const x = points.length < 2 ? 0 : (index / (points.length - 1)) * width;
    const y = height - (point.pointsRemaining / maximum) * height;
    return `${x},${y}`;
  }).join(" ");
  const title = escapeHtml(report.project);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} metrics</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#232621;font-family:ui-sans-serif,system-ui,sans-serif}.page{max-width:980px;margin:auto;padding:48px 28px}.eyebrow{font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:#66695f}h1{font-size:38px;margin:6px 0 8px}.sub{color:#66695f}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:30px 0}.metric{background:#fffdf8;border-top:4px solid #e65f32;padding:18px}.metric strong{display:block;font:700 30px ui-monospace,monospace}.metric span{font-size:12px;color:#66695f}.chart{background:#fffdf8;padding:24px;margin-top:20px}.chart svg{width:100%;height:auto;overflow:visible}.chart line{stroke:#d4cfc4}.chart polyline{fill:none;stroke:#257b67;stroke-width:5;stroke-linejoin:round}.history{margin-top:28px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #d4cfc4;padding:12px 0}@media(max-width:650px){.grid{grid-template-columns:1fr 1fr}}
  </style></head><body><main class="page"><span class="eyebrow">Triathlon metrics</span><h1>${title}</h1><p class="sub">Generated ${new Date(report.generatedAt).toLocaleString()}</p>${metrics ? `<section class="grid"><div class="metric"><strong>${metrics.velocity}</strong><span>Velocity</span></div><div class="metric"><strong>${metrics.throughput}</strong><span>Throughput</span></div><div class="metric"><strong>${metrics.averageLeadDays ?? "—"}</strong><span>Average lead days</span></div><div class="metric"><strong>${metrics.averageCycleDays ?? "—"}</strong><span>Average cycle days</span></div></section><section class="chart"><span class="eyebrow">${escapeHtml(selected.name)} burndown</span><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Points remaining by day"><line x1="0" y1="${height}" x2="${width}" y2="${height}"/><polyline points="${polyline}"/></svg></section>` : '<p>No sprint metrics are available.</p>'}<section class="history"><span class="eyebrow">Completed sprints</span>${completed.map((sprint) => `<div class="row"><strong>${escapeHtml(sprint.name)}</strong><span>${sprint.metrics.velocity} points · ${sprint.metrics.throughput} tickets</span></div>`).join("") || '<p>No completed sprints.</p>'}</section><section class="history"><span class="eyebrow">Contributors</span>${report.contributors.map((contributor) => `<div class="row"><strong>${escapeHtml(contributor.name)}</strong><span>${contributor.completedPoints} points · ${contributor.completedTickets} completed · ${contributor.transitions} transitions</span></div>`).join("") || '<p>No committed ticket transitions.</p>'}</section></main></body></html>`;
}

export async function renderBoardHtml(board, { editable = false, revision = "snapshot", author = "Reader" } = {}) {
  const [styles, application] = await Promise.all([
    readFile(styleUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);
  const title = String(board.project.name).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title} · Triathlon</title>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script>window.__TRIATHLON__=${safeJson({ board, editable, revision, author })};</script>
  <script>${application}</script>
</body>
</html>
`;
}

#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { applyPullRequestEvent, BoardError, createBoard, formatBoard, readBoard, validateBoardChange, writeBoard } from "../lib/board.js";
import { projectMetrics, readBoardAt, readBoardHistory } from "../lib/history.js";
import { installScaffold } from "../lib/scaffold.js";
import { serveBoard } from "../lib/server.js";
import { renderBoardHtml, renderMetricsHtml } from "../lib/template.js";

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}
function has(args, name) { return args.includes(name); }
function print(value) { process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`); }
async function renderTo(board, htmlPath = "board.html") {
  await writeFile(resolve(htmlPath), await renderBoardHtml(board), "utf8");
}

const help = `Triathlon Board — Git-native work tracking

Usage: npx triathlon <command> [options]

Commands:
  init       Create board.json and board.html
  serve      Open the localhost editor
  validate   Validate board.json
  render     Regenerate board.html
  metrics    Generate metrics.html from Git history
  pr-event   Apply a GitHub pull-request event

Common options:
  --board <path>    Board file (default: board.json)
  --html <path>     Generated board (default: board.html)
  --help            Show this help
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || has(args, "--help")) return print(help);
  const boardPath = option(args, "--board", "board.json");
  const htmlPath = option(args, "--html", "board.html");

  if (command === "init") {
    const key = option(args, "--key", "PROJ").toUpperCase();
    const name = option(args, "--name", "My project");
    const board = createBoard({ key, name });
    if (!has(args, "--force")) {
      try { await readBoard(boardPath); throw new BoardError(`${boardPath} already exists; use --force to replace it`); }
      catch (error) { if (!(error instanceof BoardError) || !error.message.startsWith("No board found")) throw error; }
    }
    await writeBoard(boardPath, board);
    await renderTo(board, htmlPath);
    const scaffold = has(args, "--no-scaffold") ? [] : await installScaffold({ force: has(args, "--force") });
    print(`Created ${[boardPath, htmlPath, ...scaffold].join(", ")}\nRun npm install, then npm run board.`);
    return;
  }

  if (command === "validate") {
    const current = await readBoard(boardPath);
    const formatted = formatBoard(current.board);
    const actual = await readFile(resolve(boardPath), "utf8");
    if (actual !== formatted) throw new BoardError(`${boardPath} is valid but not canonically formatted; save it through Triathlon`);
    print(`Valid ${boardPath} (${Object.keys(current.board.tickets).length} tickets, ${Object.keys(current.board.sprints).length} sprints)`);
    return;
  }

  if (command === "render") {
    const { board } = await readBoard(boardPath);
    const output = await renderBoardHtml(board);
    if (has(args, "--check")) {
      let actual = "";
      try { actual = await readFile(resolve(htmlPath), "utf8"); } catch {}
      if (actual !== output) throw new BoardError(`${htmlPath} is stale; run triathlon render`);
      print(`Current ${htmlPath}`);
    } else {
      await writeFile(resolve(htmlPath), output, "utf8");
      print(`Rendered ${htmlPath}`);
    }
    return;
  }

  if (command === "serve") {
    await serveBoard({ boardPath, htmlPath, port: Number(option(args, "--port", "4177")), open: !has(args, "--no-open") });
    return;
  }

  if (command === "metrics") {
    const { board } = await readBoard(boardPath);
    const history = await readBoardHistory({ cwd: process.cwd(), path: boardPath });
    if (!history.length) history.push({ commit: "working-tree", committedAt: new Date().toISOString(), author: "Local", board });
    const report = projectMetrics(board, history);
    const outputPath = option(args, "--output", "metrics.html");
    await writeFile(resolve(outputPath), renderMetricsHtml(report), "utf8");
    if (has(args, "--json")) print(report);
    else print(`Generated ${outputPath} from ${history.length} board revisions`);
    return;
  }

  if (command === "pr-event") {
    const eventPath = option(args, "--event-path", process.env.GITHUB_EVENT_PATH);
    if (!eventPath) throw new BoardError("Use --event-path or GITHUB_EVENT_PATH");
    const payload = JSON.parse(await readFile(resolve(eventPath), "utf8"));
    const requestedEvent = option(args, "--event");
    const event = requestedEvent ?? (payload.action === "opened" ? "opened" : payload.action === "closed" ? (payload.pull_request?.merged ? "merged" : "closed") : payload.review?.state?.toLowerCase() === "approved" ? "approved" : payload.action);
    const body = payload.pull_request?.body ?? "";
    const actor = payload.pull_request?.user?.login ?? payload.sender?.login ?? "github";
    const occurredAt = payload.pull_request?.merged_at ?? payload.review?.submitted_at ?? new Date().toISOString();
    const current = await readBoard(boardPath);
    const baseSha = payload.pull_request?.base?.sha;
    if (baseSha) {
      const base = await readBoardAt(baseSha, { cwd: process.cwd(), path: boardPath });
      const problems = base ? validateBoardChange(base, current.board) : [];
      if (problems.length) throw new BoardError("Pull request changes completed sprint history", problems);
    }
    const result = applyPullRequestEvent(current.board, { event, body, actor, occurredAt });
    if (result.changed.length) {
      const saved = await writeBoard(boardPath, result.board, { expectedRevision: current.revision });
      await renderTo(saved.board, htmlPath);
    }
    print({ event, ticketIds: result.ticketIds, changed: result.changed });
    return;
  }

  throw new BoardError(`Unknown command: ${command}\n\n${help}`);
}

try {
  await main();
} catch (error) {
  if (error instanceof BoardError) {
    console.error(`Error: ${error.message}`);
    for (const problem of error.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
}

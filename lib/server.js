import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { BoardError, readBoard, validateBoardChange, writeBoard } from "./board.js";
import { calculateSprintMetrics, readBoardHistory } from "./history.js";
import { renderBoardHtml } from "./template.js";

const exec = promisify(execFile);

async function authorName(cwd) {
  try {
    const { stdout } = await exec("git", ["config", "user.name"], { cwd });
    return stdout.trim() || "Local contributor";
  } catch {
    return "Local contributor";
  }
}

async function writeHtml(path, content) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, absolutePath);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new BoardError("Board update exceeds the 2 MB limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BoardError("Request body must be valid JSON");
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

async function addCompletedSnapshots(previous, next, boardPath) {
  const changeProblems = validateBoardChange(previous, next);
  if (changeProblems.length) throw new BoardError("Board update changes completed sprint history", changeProblems);
  const history = await readBoardHistory({ cwd: dirname(resolve(boardPath)), path: basename(boardPath) });
  const now = new Date().toISOString();
  history.push({ commit: "working-tree", committedAt: now, author: "Local editor", board: next });
  for (const [id, sprint] of Object.entries(next.sprints)) {
    const oldSprint = previous.sprints[id];
    if (oldSprint?.state === "completed") {
      if (JSON.stringify(sprint.metrics) !== JSON.stringify(oldSprint.metrics)) {
        throw new BoardError(`Completed sprint ${id} metrics are immutable`);
      }
      continue;
    }
    if (sprint.state === "completed") sprint.metrics = calculateSprintMetrics(next, history, id, sprint.actualEnd ?? now);
  }
}

export async function serveBoard({ boardPath = "board.json", htmlPath = "board.html", port = 4177, open = true } = {}) {
  const absoluteBoardPath = resolve(boardPath);
  const cwd = dirname(absoluteBoardPath);
  const author = await authorName(cwd);
  const host = "127.0.0.1";
  const origin = `http://${host}:${port}`;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (request.method === "GET" && url.pathname === "/") {
        const current = await readBoard(absoluteBoardPath);
        const body = await renderBoardHtml(current.board, { editable: true, revision: current.revision, author });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" });
        return response.end(body);
      }
      if (request.method === "GET" && url.pathname === "/api/board") {
        const current = await readBoard(absoluteBoardPath);
        return json(response, 200, current);
      }
      if (request.method === "PUT" && url.pathname === "/api/board") {
        if (request.headers.origin && request.headers.origin !== origin) throw new BoardError("Cross-origin board updates are not allowed");
        if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) throw new BoardError("Content-Type must be application/json");
        const current = await readBoard(absoluteBoardPath);
        const next = await readJsonBody(request);
        await addCompletedSnapshots(current.board, next, absoluteBoardPath);
        const saved = await writeBoard(absoluteBoardPath, next, { expectedRevision: request.headers["if-match"] });
        await writeHtml(htmlPath, await renderBoardHtml(saved.board));
        return json(response, 200, { board: saved.board, revision: saved.revision });
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      const known = error instanceof BoardError;
      json(response, known ? 409 : 500, { error: error.message, problems: error.problems ?? [] });
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });
  console.log(`Triathlon board: ${origin}`);
  console.log(`Saving to: ${absoluteBoardPath}`);
  if (open) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", origin] : [origin];
    execFile(command, args, () => {});
  }
  return server;
}

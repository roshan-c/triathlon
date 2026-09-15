import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBoard, readBoard, writeBoard } from "../lib/board.js";
import { serveBoard } from "../lib/server.js";

test("localhost editor saves valid changes and regenerates HTML", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "triathlon-server-"));
  const boardPath = join(directory, "board.json");
  const htmlPath = join(directory, "board.html");
  await writeBoard(boardPath, createBoard({ key: "TEST", name: "Server test" }));
  const server = await serveBoard({ boardPath, htmlPath, port: 0, open: false });
  context.after(() => server.close());
  const port = server.address().port;
  const current = await readBoard(boardPath);
  const next = structuredClone(current.board);
  next.tickets["TEST-1"].title = "Saved through localhost";
  const response = await fetch(`http://127.0.0.1:${port}/api/board`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": current.revision },
    body: JSON.stringify(next),
  });
  assert.equal(response.status, 200);
  assert.equal((await readBoard(boardPath)).board.tickets["TEST-1"].title, "Saved through localhost");
  assert.match(await readFile(htmlPath, "utf8"), /Saved through localhost/);
});

test("localhost editor rejects malformed state", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "triathlon-server-"));
  const boardPath = join(directory, "board.json");
  await writeBoard(boardPath, createBoard({ key: "TEST" }));
  const server = await serveBoard({ boardPath, htmlPath: join(directory, "board.html"), port: 0, open: false });
  context.after(() => server.close());
  const current = await readBoard(boardPath);
  const next = structuredClone(current.board);
  next.tickets["TEST-1"].columnId = "missing";
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/board`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": current.revision },
    body: JSON.stringify(next),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).problems.join("\n"), /columnId is unknown/);
});

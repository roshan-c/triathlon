import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPullRequestEvent, BoardError, createBoard, readBoard, ticketReferences, validateBoard, validateBoardChange, writeBoard } from "../lib/board.js";

test("a new board is valid and survives an atomic round trip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "triathlon-"));
  const path = join(directory, "board.json");
  const board = createBoard({ key: "TRI", name: "Triathlon" });
  assert.deepEqual(validateBoard(board), []);
  const saved = await writeBoard(path, board);
  const loaded = await readBoard(path);
  assert.equal(loaded.revision, saved.revision);
  assert.equal(loaded.board.project.name, "Triathlon");
  assert.match(await readFile(path, "utf8"), /"TRI-1"/);
});

test("an expected revision prevents a lost update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "triathlon-"));
  const path = join(directory, "board.json");
  const first = await writeBoard(path, createBoard());
  const changed = structuredClone(first.board);
  changed.project.name = "Changed";
  await writeBoard(path, changed, { expectedRevision: first.revision });
  await assert.rejects(() => writeBoard(path, first.board, { expectedRevision: first.revision }), /changed after this page loaded/);
});

test("PR trailers are strict, unique, and case-insensitive", () => {
  assert.deepEqual(ticketReferences("Notes\nTriathlon-Tickets: tri-1, TRI-2 TRI-1\n"), ["TRI-1", "TRI-2"]);
});

test("PR opening and merge events move linked tickets without moving them backwards", () => {
  const board = createBoard({ key: "TRI" });
  const opened = applyPullRequestEvent(board, { event: "opened", body: "Triathlon-Tickets: TRI-1", actor: "roshan", occurredAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(opened.board.tickets["TRI-1"].columnId, "in-progress");
  assert.equal(opened.changed.length, 1);
  const merged = applyPullRequestEvent(opened.board, { event: "merged", body: "Triathlon-Tickets: TRI-1", actor: "roshan", occurredAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(merged.board.tickets["TRI-1"].columnId, "done");
  const reopenedEvent = applyPullRequestEvent(merged.board, { event: "opened", body: "Triathlon-Tickets: TRI-1", actor: "roshan" });
  assert.equal(reopenedEvent.board.tickets["TRI-1"].columnId, "done");
  assert.equal(reopenedEvent.changed.length, 0);
});

test("unknown PR ticket references fail", () => {
  assert.throws(() => applyPullRequestEvent(createBoard({ key: "TRI" }), { event: "opened", body: "Triathlon-Tickets: TRI-99", actor: "x" }), BoardError);
});

test("completed sprint snapshots cannot be rewritten", () => {
  const previous = createBoard();
  previous.sprints.one = { id: "one", name: "One", state: "completed", plannedStart: null, plannedEnd: null, actualStart: "2026-01-01T00:00:00.000Z", actualEnd: "2026-01-02T00:00:00.000Z", ticketIds: [], metrics: { calculatedAt: "2026-01-02T00:00:00.000Z", velocity: 0, throughput: 0, averageLeadDays: null, averageCycleDays: null, burndown: [] } };
  const next = structuredClone(previous);
  next.sprints.one.metrics.velocity = 10;
  assert.match(validateBoardChange(previous, next).join("\n"), /immutable/);
});

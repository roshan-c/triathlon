import assert from "node:assert/strict";
import test from "node:test";
import { createBoard } from "../lib/board.js";
import { calculateSprintMetrics, ticketTransitions } from "../lib/history.js";

function fixture() {
  const first = createBoard({ key: "TRI" });
  first.sprints["sprint-1"] = { id: "sprint-1", name: "Sprint 1", state: "active", plannedStart: "2026-01-01T00:00:00.000Z", plannedEnd: "2026-01-07T23:59:59.999Z", actualStart: "2026-01-01T00:00:00.000Z", actualEnd: null, ticketIds: ["TRI-1"], metrics: null };
  first.tickets["TRI-1"].sprintId = "sprint-1";
  first.tickets["TRI-1"].createdAt = "2026-01-01T00:00:00.000Z";
  const second = structuredClone(first); second.tickets["TRI-1"].columnId = "in-progress";
  second.tickets["TRI-1"].comments.push({ id: "pr-open", author: "contributor", body: "Moved automatically when the linked pull request opened.", createdAt: "2026-01-02T00:00:00.000Z" });
  const third = structuredClone(second); third.tickets["TRI-1"].columnId = "done";
  return [first, second, third];
}

test("history identifies ticket transitions", () => {
  const [first, second, third] = fixture();
  const history = [
    { commit: "a", committedAt: "2026-01-01T00:00:00.000Z", author: "A", board: first },
    { commit: "b", committedAt: "2026-01-02T00:00:00.000Z", author: "B", board: second },
    { commit: "c", committedAt: "2026-01-04T00:00:00.000Z", author: "B", board: third },
  ];
  const transitions = ticketTransitions(history);
  assert.equal(transitions.length, 2);
  assert.equal(transitions[0].author, "contributor");
  assert.equal(transitions[1].toCategory, "done");
  const metrics = calculateSprintMetrics(third, history, "sprint-1", "2026-01-07T23:59:59.999Z");
  assert.equal(metrics.velocity, 1);
  assert.equal(metrics.throughput, 1);
  assert.equal(metrics.averageLeadDays, 3);
  assert.equal(metrics.averageCycleDays, 2);
  assert.equal(metrics.burndown.length, 7);
});

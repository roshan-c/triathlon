/**
 * Work module tests: numbering, validation, ordering, review gates,
 * resolve/reopen, relationships, deletion/restore, frontier.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  addProject,
  addUser,
  bootstrapOwner,
  buildWorld,
  ticketId,
  track,
} from "./helpers.js";

async function worldWithProject() {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(member.id), (await invite(w, owner, project.id)).code);
  return { w, owner, member, project };
}

test("tickets get sequential, never-reused numbers and validation", async () => {
  const { w, member, project } = await worldWithProject();
  const a = await w.work.createTicket(w.ctx(member.id), project.id, { title: "One" });
  const b = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Two" });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);

  await assert.rejects(
    w.work.createTicket(w.ctx(member.id), project.id, { title: "  " }),
    (e: Error) => e.message.startsWith("Title must be between"),
  );
  await assert.rejects(
    w.work.createTicket(w.ctx(member.id), project.id, { title: "X", points: -1 }),
    (e: Error) => e.message.startsWith("Points must be a non-negative integer"),
  );
  const labelled = await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "Labels",
    labels: ["  ALPHA ", "alpha", "beta"],
  });
  assert.deepEqual(labelled.labels, ["alpha", "beta"]);
  assert.equal(labelled.priority, "medium");
});

test("create and delete never reuse numbers; delete hides from normal queries", async () => {
  const { w, member, project } = await worldWithProject();
  const a = await w.work.createTicket(w.ctx(member.id), project.id, { title: "One" });
  await w.work.deleteTicket(w.ctx(member.id), project.id, String(a.number), a.resourceVersion);
  const b = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Two" });
  assert.equal(b.number, 2);

  const open = await w.work.listTickets(w.ctx(member.id), project.id, {});
  assert.equal(open.items.length, 1);
  assert.equal(open.items[0]?.number, 2);
  const deleted = await w.work.listTickets(w.ctx(member.id), project.id, { visibility: "deleted" });
  assert.equal(deleted.items.length, 1);
  assert.equal(deleted.items[0]?.number, 1);

  // Restore brings the tombstone back with its column and closed state.
  const restored = await w.work.restoreTicket(w.ctx(member.id), project.id, String(a.number));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.number, 1);
});

test("positions are explicit and atomic; moves cannot cross the Done boundary", async () => {
  const { w, member, project } = await worldWithProject();
  const cols = await w.projects.columnsFor(project.id);
  const [backlog, todo] = cols;
  assert.ok(backlog && todo);

  const t1 = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T1" });
  const t2 = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T2" });
  const t3 = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T3" });

  // Move t3 to the top of the column; t1/t2 shift down.
  const moved = await w.work.moveTicket(
    w.ctx(member.id),
    project.id,
    String(t3.number),
    t3.resourceVersion,
    { columnId: t3.columnId, position: 0 },
  );
  assert.equal(moved.position, 0);
  const t1After = await w.work.getTicketDetail(w.ctx(member.id), project.id, t1.id);
  assert.equal(t1After?.ticket.position, 1);
  const t2After = await w.work.getTicketDetail(w.ctx(member.id), project.id, t2.id);
  assert.equal(t2After?.ticket.position, 2);

  // Moving downward within the same column closes the old slot first.
  const movedDown = await w.work.moveTicket(
    w.ctx(member.id),
    project.id,
    String(t1.number),
    t1After?.ticket.resourceVersion ?? 0,
    { columnId: t1.columnId, position: 2 },
  );
  assert.equal(movedDown.position, 2);
  assert.equal((await w.work.getTicketDetail(w.ctx(member.id), project.id, t2.id))?.ticket.position, 1);

  // Cross-column move.
  const cross = await w.work.moveTicket(
    w.ctx(member.id),
    project.id,
    String(t1.number),
    movedDown.resourceVersion,
    { columnId: todo.id, position: 0 },
  );
  assert.equal(cross.columnId, todo.id);

  // Stale versions are rejected.
  await assert.rejects(
    w.work.moveTicket(w.ctx(member.id), project.id, String(t2.number), 999, {
      columnId: todo.id,
      position: 0,
    }),
    (e: Error) => e.message.startsWith("Resource version 999 is stale"),
  );

  // Moving into Done is refused.
  const done = cols.find((c) => c.category === "done");
  assert.ok(done);
  await assert.rejects(
    w.work.moveTicket(w.ctx(member.id), project.id, String(t2.number), t2.resourceVersion, {
      columnId: done.id,
      position: 0,
    }),
    (e: Error) => e.message === "Open tickets cannot be moved into Done; Resolve is the only way in",
  );
});

test("resolve requires an approved review and an outcome comment; reopen invalidates approval", async () => {
  const { w, member, project } = await worldWithProject();
  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "Needs review",
    points: 3,
  });

  // No comment, no approval: resolve fails.
  await assert.rejects(
    w.work.resolveTicket(w.ctx(member.id), project.id, String(ticket.number), ticket.resourceVersion, ""),
    (e: Error) => e.message === "Outcome comment must not be empty",
  );
  await assert.rejects(
    w.work.resolveTicket(w.ctx(member.id), project.id, String(ticket.number), ticket.resourceVersion, "done"),
    (e: Error) => e.message === "Resolve requires an approved review of the current revision",
  );

  // Request → decided (approval). Rejection without a comment is refused.
  await w.work.requestReview(w.ctx(member.id), project.id, String(ticket.number));
  await assert.rejects(
    w.work.decideReview(w.ctx(member.id), project.id, String(ticket.number), "rejected"),
    (e: Error) => e.message === "Rejection comment must not be empty",
  );
  await w.work.decideReview(w.ctx(member.id), project.id, String(ticket.number), "approved");

  const resolved = await w.work.resolveTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    ticket.resourceVersion,
    "Shipped!",
  );
  assert.equal(resolved.category, "done");
  const comments = await w.work.getTicketDetail(w.ctx(member.id), project.id, resolved.id);
  assert.ok(comments?.comments.some((c) => c.body === "Shipped!"));

  // Ordinary movement out of Done is refused; reopen is the only way out.
  const todo = (await w.projects.columnsFor(project.id)).find((c) => c.name === "Todo");
  assert.ok(todo);
  await assert.rejects(
    w.work.moveTicket(w.ctx(member.id), project.id, String(ticket.number), resolved.resourceVersion, {
      columnId: todo.id,
      position: 0,
    }),
    (e: Error) => e.message === "Closed tickets leave Done only through an explicit Reopen",
  );

  const reopened = await w.work.reopenTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    resolved.resourceVersion,
    { columnId: todo.id, comment: "Needs more work" },
  );
  assert.equal(reopened.category, "not_started");
  // Reopen creates a new revision and invalidates the previous approval.
  assert.equal(reopened.revision, 2);
  const review = (await w.work.getTicketDetail(w.ctx(member.id), project.id, reopened.id))?.review;
  assert.equal(review?.state, "unreviewed");
});

test("material changes create revisions and invalidate approval; comments do not", async () => {
  const { w, member, project } = await worldWithProject();
  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, { title: "V1" });
  await w.work.requestReview(w.ctx(member.id), project.id, String(ticket.number));
  await w.work.decideReview(w.ctx(member.id), project.id, String(ticket.number), "approved");

  // Comment: no revision bump, approval stays.
  await w.work.addComment(w.ctx(member.id), project.id, String(ticket.number), "note");
  const afterComment = await w.work.getTicketDetail(w.ctx(member.id), project.id, ticket.id);
  assert.equal(afterComment?.ticket.revision, 1);
  assert.equal(afterComment?.review.state, "approved");

  // Title change: new revision, approval invalidated.
  const updated = await w.work.updateTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    ticket.resourceVersion,
    { title: "V2" },
  );
  assert.equal(updated.revision, 2);
  const afterUpdate = await w.work.getTicketDetail(w.ctx(member.id), project.id, ticket.id);
  assert.equal(afterUpdate?.review.state, "unreviewed");

  // Points can be set and unset independently.
  const pointed = await w.work.updateTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    updated.resourceVersion,
    { points: 5 },
  );
  assert.equal(pointed.points, 5);
  const unpointed = await w.work.updateTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    pointed.resourceVersion,
    { points: null },
  );
  assert.equal(unpointed.points, null);
  assert.equal(unpointed.revision, 4);
});

test("blocking edges reject cycles and self-loops; deleted blockers do not block", async () => {
  const { w, member, project } = await worldWithProject();
  const a = await w.work.createTicket(w.ctx(member.id), project.id, { title: "A" });
  const b = await w.work.createTicket(w.ctx(member.id), project.id, { title: "B" });
  const c = await w.work.createTicket(w.ctx(member.id), project.id, { title: "C" });

  await w.work.addBlockers(w.ctx(member.id), project.id, String(b.number), [a.id]);
  await w.work.addBlockers(w.ctx(member.id), project.id, String(c.number), [b.id]);
  // a blocks b blocks c; c cannot block a.
  await assert.rejects(
    w.work.addBlockers(w.ctx(member.id), project.id, String(a.number), [c.id]),
    (e: Error) => e.message === "Blocking edge would create a cycle",
  );
  await assert.rejects(
    w.work.addBlockers(w.ctx(member.id), project.id, String(a.number), [a.id]),
    (e: Error) => e.message === "A ticket cannot block itself",
  );

  const detail = await w.work.getTicketDetail(w.ctx(member.id), project.id, c.id);
  assert.deepEqual(
    detail?.blockers.map((r) => r.number),
    [2],
  );
  assert.deepEqual(
    detail?.blockedBy.map((r) => r.number),
    [],
  );

  // Deleted blockers no longer block: frontier includes b (its blocker a is
  // deleted) while c remains blocked by the open b.
  await w.work.deleteTicket(w.ctx(member.id), project.id, String(a.number), a.resourceVersion);
  const frontier = await w.work.frontier(w.ctx(member.id), project.id, {});
  const numbers = frontier.items.map((t) => t.number);
  assert.ok(numbers.includes(2), "b's deleted blocker does not block");
  assert.ok(!numbers.includes(3), "c remains blocked by the open b");
});

test("frontier: open, unassigned, blockers all Closed", async () => {
  const { w, member, project } = await worldWithProject();
  const cols = await w.projects.columnsFor(project.id);
  const done = cols.find((c) => c.category === "done");
  assert.ok(done);

  // Assigned → not frontier.
  await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "Mine",
    assigneeId: member.id,
  });
  // Blocked by an open ticket → not frontier.
  const blocker = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Blocker" });
  const blocked = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Blocked" });
  await w.work.addBlockers(w.ctx(member.id), project.id, String(blocked.number), [blocker.id]);
  // Free → frontier.
  await w.work.createTicket(w.ctx(member.id), project.id, { title: "Free" });

  let frontier = await w.work.frontier(w.ctx(member.id), project.id, {});
  // Claimable: the blocker (unassigned, unblocked) and the free ticket; not
  // the assigned one or the blocked one.
  assert.deepEqual(frontier.items.map((t) => t.number), [2, 4]);

  // Blocked remains excluded even when the blocker is Closed.
  const reviewFlow = async (ticket: { number: number; resourceVersion: number }) => {
    await w.work.requestReview(w.ctx(member.id), project.id, String(ticket.number));
    await w.work.decideReview(w.ctx(member.id), project.id, String(ticket.number), "approved");
    return w.work.resolveTicket(
      w.ctx(member.id),
      project.id,
      String(ticket.number),
      ticket.resourceVersion,
      "done",
    );
  };
  void reviewFlow;
  const resolvedBlocker = await reviewFlow(blocker);
  assert.equal(resolvedBlocker.category, "done");
  // Once the blocker is Closed, the formerly blocked ticket is claimable.
  frontier = await w.work.frontier(w.ctx(member.id), project.id, {});
  assert.deepEqual(frontier.items.map((t) => t.number), [3, 4]);
});

test("parent-of edges: single parent, no cycles, deleted parents rejected", async () => {
  const { w, member, project } = await worldWithProject();
  const a = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Parent" });
  const b = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Child" });
  const c = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Grandchild" });

  const updated = await w.work.updateTicket(
    w.ctx(member.id),
    project.id,
    String(b.number),
    b.resourceVersion,
    { parentId: a.id },
  );
  assert.equal(updated.parentId, a.id);
  // Cycle: a cannot become a child of its grandchild.
  const c2 = await w.work.updateTicket(
    w.ctx(member.id),
    project.id,
    String(c.number),
    c.resourceVersion,
    { parentId: b.id },
  );
  await assert.rejects(
    w.work.updateTicket(w.ctx(member.id), project.id, String(a.number), a.resourceVersion, {
      parentId: c2.id,
    }),
    (e: Error) => e.message === "Parent assignment would create a cycle",
  );
  // Self-parenting.
  await assert.rejects(
    w.work.updateTicket(w.ctx(member.id), project.id, String(a.number), a.resourceVersion, {
      parentId: a.id,
    }),
    (e: Error) => e.message === "A ticket cannot be its own parent",
  );
  // Deleted parents are rejected.
  await w.work.deleteTicket(w.ctx(member.id), project.id, String(b.number), updated.resourceVersion);
  await assert.rejects(
    w.work.updateTicket(w.ctx(member.id), project.id, String(a.number), a.resourceVersion, {
      parentId: b.id,
    }),
    (e: Error) => e.message === "Parent must be an existing, non-deleted ticket",
  );
  const detail = await w.work.getTicketDetail(w.ctx(member.id), project.id, c2.id);
  assert.equal(detail?.parent?.id, b.id);
  assert.deepEqual(detail?.children.map((r) => r.id), []);
});

test("tombstones keep history: restored Closed tickets stay Closed; activity is recorded", async () => {
  const { w, owner, member, project } = await worldWithProject();
  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Fin" });
  await w.work.requestReview(w.ctx(member.id), project.id, String(ticket.number));
  await w.work.decideReview(w.ctx(member.id), project.id, String(ticket.number), "approved");
  const resolved = await w.work.resolveTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    ticket.resourceVersion,
    "done",
  );
  await w.work.deleteTicket(w.ctx(member.id), project.id, String(ticket.number), resolved.resourceVersion);
  const restored = await w.work.restoreTicket(w.ctx(member.id), project.id, String(ticket.number));
  assert.equal(restored.category, "done");

  const activity = await w.work.activity(w.ctx(member.id), project.id, {});
  const types = activity.items.map((a) => a.type);
  for (const expected of [
    "ticket.created",
    "review.requested",
    "review.decided",
    "ticket.resolved",
    "ticket.deleted",
    "ticket.restored",
  ]) {
    assert.ok(types.includes(expected), `missing activity ${expected}`);
  }
  // Activity is visible to members.
  const other = await addUser(w, "other@example.com", "Other");
  await w.projects.joinProject(w.ctx(other.id), (await invite(w, owner, project.id)).code);
  const visible = await w.work.activity(w.ctx(other.id), project.id, { limit: 1 });
  assert.ok(visible.items.length >= 1);
});

test("Activity is person-attributed and survives permanent ticket purge", async () => {
  const { w, owner, member, project } = await worldWithProject();
  const automation = await w.identity.createAutomation(w.ctx(member.id), "Worker");
  const automationContext = {
    actor: {
      userId: member.id,
      automationId: automation.id,
      keyScope: "project" as const,
      keyProjectId: project.id,
    },
    requestId: "req-automation",
  };
  const ticket = await w.work.createTicket(automationContext, project.id, {
    title: "Automated work",
  });
  await w.work.deleteTicket(
    w.ctx(member.id),
    project.id,
    String(ticket.number),
    ticket.resourceVersion,
  );
  await w.work.purgeTicket(w.ctx(owner.id), project.id, String(ticket.number));

  const activity = await w.work.activity(w.ctx(member.id), project.id, {});
  const created = activity.items.find((entry) => entry.type === "ticket.created");
  assert.ok(created);
  assert.equal(created.actorUserId, member.id);
  assert.equal("actorAutomationId" in created, false);
  const stored = await w.db
    .selectFrom("activity")
    .select("actor_automation_id")
    .where("id", "=", created.id)
    .executeTakeFirstOrThrow();
  assert.equal(stored.actor_automation_id, null);
});

async function invite(
  w: Awaited<Awaited<ReturnType<typeof buildWorld>>>,
  owner: Awaited<ReturnType<typeof bootstrapOwner>>,
  projectId: string,
) {
  return w.identity.createInvitation(w.ctx(owner.id), projectId, undefined);
}

void addMember;
void ticketId;

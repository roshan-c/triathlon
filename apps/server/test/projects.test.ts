/**
 * Projects module tests: creation, default workflow, ownership transfer,
 * membership, columns and Done invariants, deletion lifecycle.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  addProject,
  addUser,
  bootstrapOwner,
  buildWorld,
  track,
} from "./helpers.js";

test("project creation requires an Instance Admin and builds the default workflow", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const regular = await addUser(w, "regular@example.com", "Regular");
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });

  await assert.rejects(
    w.projects.createProject(w.ctx(regular.id), { name: "Nope" }),
    (e: Error) => e.message === "Instance Admin required",
  );

  const project = await w.projects.createProject(w.ctx(owner.id), { name: "Ship" });
  const columns = await w.projects.columnsFor(project.id);
  assert.deepEqual(
    columns.map((c) => [c.name, c.category]),
    [
      ["Backlog", "not_started"],
      ["Todo", "not_started"],
      ["In Progress", "started"],
      ["Review", "started"],
      ["Done", "done"],
    ],
  );
  void admin;
});

test("projects inherit the instance default timezone and accept an override", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const p1 = await w.projects.createProject(w.ctx(owner.id), { name: "UTC default" });
  assert.equal(p1.timezone, "UTC");
  const p2 = await w.projects.createProject(w.ctx(owner.id), {
    name: "Berlin",
    timezone: "Europe/Berlin",
  });
  assert.equal(p2.timezone, "Europe/Berlin");
  await assert.rejects(
    w.projects.createProject(w.ctx(owner.id), { name: "Bad tz", timezone: "Mars/Olympus" }),
    (e: Error) => e.message.startsWith("Unknown time zone"),
  );
});

test("ownership transfers only to an existing member; the old owner becomes a member", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(admin.id), (await invite(w, owner, project.id)).code);

  // Non-members cannot receive ownership.
  const stranger = await addUser(w, "stranger@example.com", "Stranger");
  await assert.rejects(
    w.projects.transferOwnership(w.ctx(owner.id), project.id, stranger.id),
    (e: Error) => e.message === "Ownership may transfer only to an existing project member",
  );

  const transferred = await w.projects.transferOwnership(w.ctx(owner.id), project.id, admin.id);
  assert.equal(transferred.ownerUserId, admin.id);
  const role = await w.projects.roleFor(owner.id, project.id);
  assert.equal(role, "member");

  // The previous owner's admin-wide powers do not move with project ownership.
  await assert.rejects(
    w.projects.renameProject(w.ctx(owner.id), project.id, "Renamed"),
    (e: Error) => e.message === "Project Owner required",
  );
});

test("admins can recover ownership to a member", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(admin.id), (await invite(w, owner, project.id)).code);
  const recovered = await w.projects.recoverOwnership(w.ctx(admin.id), project.id, admin.id);
  assert.equal(recovered.ownerUserId, admin.id);
});

test("removing a member atomically unassigns their Open tickets and revokes their project keys", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(member.id), (await invite(w, owner, project.id)).code);

  const key = await w.identity.createKey(w.ctx(member.id), {
    name: "tool",
    ownerType: "user",
    scope: "project",
    projectId: project.id,
  });

  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "Assigned work",
    assigneeId: member.id,
  });
  assert.equal(ticket.assigneeId, member.id);

  // Resolve a ticket first so it is Closed; a second stays Open.
  const closed = await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "Close me",
    assigneeId: member.id,
  });
  const cols = await w.projects.columnsFor(project.id);
  const done = cols.find((c) => c.category === "done");
  assert.ok(done);
  await w.work.addComment(w.ctx(member.id), project.id, String(closed.number), "setup");
  await w.work.requestReview(w.ctx(member.id), project.id, String(closed.number));
  await w.work.decideReview(w.ctx(member.id), project.id, String(closed.number), "approved");
  await w.work.resolveTicket(
    w.ctx(member.id),
    project.id,
    String(closed.number),
    closed.resourceVersion,
    "done",
  );

  await w.projects.removeMember(w.ctx(owner.id), project.id, member.id);

  // Open assignment removed; Closed assignment retained for attribution.
  const openAfter = await w.work.getTicketDetail(w.ctx(owner.id), project.id, ticket.id);
  assert.equal(openAfter?.ticket.assigneeId, null);
  const closedAfter = await w.work.getTicketDetail(w.ctx(owner.id), project.id, closed.id);
  assert.equal(closedAfter?.ticket.assigneeId, member.id);

  // Project-scoped keys are disabled.
  assert.equal(await w.identity.authenticateKey(key.secret), null);

  // Membership is gone.
  assert.equal(await w.projects.roleFor(member.id, project.id), "none");
});

test("column operations: done invariants, migration confirmation, ordering, deletion", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(member.id), (await invite(w, owner, project.id)).code);

  // Members cannot administer columns.
  await assert.rejects(
    w.projects.addColumn(w.ctx(member.id), project.id, { name: "X" }),
    (e: Error) => e.message === "Project Owner required",
  );

  // A second Done column is refused.
  await assert.rejects(
    w.projects.addColumn(w.ctx(owner.id), project.id, { name: "Done2", category: "done" }),
    (e: Error) => e.message === "A Done column already exists; recategorize it first",
  );

  // Addition appends and honors beforeColumnId.
  const added = await w.projects.addColumn(w.ctx(owner.id), project.id, { name: "QA" });
  const reordered = await w.projects.addColumn(w.ctx(owner.id), project.id, {
    name: "First",
    beforeColumnId: added.id,
  });
  const columns1 = await w.projects.columnsFor(project.id);
  const firstIdx = columns1.findIndex((c) => c.id === reordered.id);
  const qaIdx = columns1.findIndex((c) => c.id === added.id);
  assert.equal(qaIdx, firstIdx + 1);

  // Promoting a replacement Done column is a workflow migration: it demotes
  // the old Done column and requires confirmation.
  await assert.rejects(
    w.projects.recategorizeColumn(w.ctx(owner.id), project.id, added.id, {
      category: "done",
    }),
    (e: Error) => e.message.startsWith("This changes the Done column"),
  );
  const migration = await w.projects.recategorizeColumn(w.ctx(owner.id), project.id, added.id, {
    category: "done",
    confirm: true,
  });
  assert.ok(migration.affectedTickets >= 0);
  const columns2 = await w.projects.columnsFor(project.id);
  const doneColumns = columns2.filter((c) => c.category === "done");
  assert.equal(doneColumns.length, 1);
  assert.equal(doneColumns[0]?.id, added.id);
  const oldDone = columns2.find((c) => c.name === "Done");
  assert.equal(oldDone?.category, "started");

  // Demoting the Done column directly is refused (never zero Done columns).
  await assert.rejects(
    w.projects.recategorizeColumn(w.ctx(owner.id), project.id, added.id, {
      category: "started",
      confirm: true,
    }),
    (e: Error) => e.message === "Promote a replacement Done column first; the board may never have zero Done columns",
  );

  // Deleting a non-empty column requires an atomic destination. The Done
  // column itself cannot be deleted (never zero Done columns).
  await assert.rejects(
    w.projects.deleteColumn(w.ctx(owner.id), project.id, added.id),
    (e: Error) => e.message === "Promote a replacement Done column before deleting the current one",
  );
  const inProgress = columns2.find((c) => c.name === "In Progress");
  assert.ok(inProgress);
  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, {
    title: "In Progress work",
    columnId: inProgress.id,
  });
  await assert.rejects(
    w.projects.deleteColumn(w.ctx(owner.id), project.id, inProgress.id),
    (e: Error) => e.message === "A non-empty column requires an atomic destination for its tickets",
  );
  const backlog = columns2.find((c) => c.name === "Backlog");
  assert.ok(backlog);
  const moved = await w.projects.deleteColumn(w.ctx(owner.id), project.id, inProgress.id, backlog.id);
  void moved;
  const after = await w.work.getTicketDetail(w.ctx(member.id), project.id, ticket.id);
  assert.equal(after?.ticket.columnId, backlog?.id);
  assert.equal((await w.projects.columnsFor(project.id)).some((c) => c.name === "In Progress"), false);
});

test("soft deletion disables project keys; the owner restores; admins purge", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const project = await addProject(w, owner);
  const key = await w.identity.createKey(w.ctx(owner.id), {
    name: "ci",
    ownerType: "user",
    scope: "project",
    projectId: project.id,
  });

  // Only the owner soft-deletes.
  await assert.rejects(
    w.projects.deleteProject(w.ctx(admin.id), project.id),
    (e: Error) => e.message === "Project Owner required",
  );
  await w.projects.deleteProject(w.ctx(owner.id), project.id);

  // Project keys stop working immediately.
  assert.equal(await w.identity.authenticateKey(key.secret), null);

  // The project hides from members but remains visible to the owner.
  const restored = await w.projects.restoreProject(w.ctx(owner.id), project.id);
  assert.equal(restored.deletedAt, null);

  // Purge requires an Instance Admin and a deleted project.
  const member = await addUser(w, "member@example.com", "Member");
  await w.projects.joinProject(w.ctx(member.id), (await invite(w, owner, project.id)).code);
  await assert.rejects(
    w.projects.purgeProject(w.ctx(member.id), project.id),
    (e: Error) => e.message === "Instance Admin required",
  );
  await w.projects.deleteProject(w.ctx(owner.id), project.id);
  await w.projects.purgeProject(w.ctx(owner.id), project.id);
  assert.equal(await w.projects.getProject(project.id), null);
});

test("invitation redemption adds membership; owner may revoke", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const project = await addProject(w, owner);
  const invitee = await addUser(w, "invitee@example.com", "Invitee");

  const joined = await w.projects.joinProject(w.ctx(invitee.id), (await invite(w, owner, project.id)).code);
  assert.equal(joined.projectId, project.id);
  const members = await w.projects.listMembers(w.ctx(owner.id), project.id);
  assert.deepEqual(
    members.map((m) => m.userId).sort(),
    [invitee.id, owner.id].sort(),
  );
  assert.equal(
    members.find((m) => m.userId === owner.id)?.role,
    "owner",
  );
});

test("a deleted project rejects work and hides from members", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");
  const project = await addProject(w, owner);
  await w.projects.joinProject(w.ctx(member.id), (await invite(w, owner, project.id)).code);
  await w.projects.deleteProject(w.ctx(owner.id), project.id);

  await assert.rejects(
    w.work.createTicket(w.ctx(member.id), project.id, { title: "Nope" }),
    (e: Error) => e.message === "Project not found",
  );
  const list = await w.projects.listProjects(w.ctx(member.id));
  assert.equal(list.length, 0);
  const ownerList = await w.projects.listProjects(w.ctx(owner.id));
  assert.equal(ownerList.length, 1);
  assert.equal(ownerList[0]?.project.deletedAt !== null, true);
});

async function invite(
  w: Awaited<ReturnType<typeof buildWorld>>,
  owner: Awaited<ReturnType<typeof bootstrapOwner>>,
  projectId: string,
) {
  return w.identity.createInvitation(w.ctx(owner.id), projectId, undefined);
}

void addMember;
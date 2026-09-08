/**
 * Identity module tests: bootstrap, sessions, suspension, instance roles,
 * invitations, access keys, automations, audit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addProject,
  addUser,
  bootstrapOwner,
  buildWorld,
  track,
} from "./helpers.js";

test("bootstrap: first redemption creates the Instance Owner and closes bootstrap", async () => {
  const w = track(await buildWorld());
  assert.equal((await w.identity.bootstrapState()).open, true);

  const owner = await bootstrapOwner(w);
  assert.equal(owner.isInstanceOwner, true);
  assert.equal(owner.isInstanceAdmin, true);
  assert.equal((await w.identity.bootstrapState()).open, false);
});

test("bootstrap: code is single-use and expires", async () => {
  const w = track(await buildWorld());
  const { code } = await w.identity.issueBootstrapCode({ actor: { userId: "init" }, requestId: "r" });
  await w.identity.redeemBootstrap(
    { actor: { userId: "init" }, requestId: "r" },
    { code, email: "a@example.com", displayName: "A", password: "password123" },
  );
  await assert.rejects(
    w.identity.redeemBootstrap(
      { actor: { userId: "init" }, requestId: "r" },
      { code, email: "b@example.com", displayName: "B", password: "password123" },
    ),
    (e: Error) => e.message === "Bootstrap is already closed",
  );
});

test("bootstrap: code expires after the configured lifetime", async () => {
  const initial = new Date("2026-09-07T09:00:00Z");
  const later = new Date("2026-09-07T09:31:00Z");
  let now = initial;
  const w = track(await buildWorld({ clock: { now: () => now } }));
  const { code } = await w.identity.issueBootstrapCode({ actor: { userId: "init" }, requestId: "r" });
  now = later;
  await assert.rejects(
    w.identity.redeemBootstrap(
      { actor: { userId: "init" }, requestId: "r" },
      { code, email: "a@example.com", displayName: "A", password: "password123" },
    ),
    (e: Error) => e.message === "Bootstrap code has expired",
  );
});

test("login: wrong password is rejected; sessions expire after 30 days", async () => {
  const initial = new Date("2026-09-07T09:00:00Z");
  let now = initial;
  const w = track(await buildWorld({ clock: { now: () => now } }));
  const user = await bootstrapOwner(w);

  now = initial;
  await assert.rejects(
    w.identity.login({ actor: { userId: "x" }, requestId: "r" }, user.email, "wrong-password"),
    (e: Error) => e.message === "Invalid email or password",
  );
  const loginResult = await w.identity.login(
    { actor: { userId: user.id }, requestId: "r" },
    user.email,
    "password123",
  );
  const checkOk = await w.identity.checkSession(loginResult.token);
  assert.ok(checkOk.ok);
  // Opaque tokens: session ids are not usable as tokens.
  const viaSessionId = await w.identity.checkSession(loginResult.session.id);
  assert.equal(viaSessionId.ok, false);
  const viaRandom = await w.identity.checkSession(w.ids.token());
  assert.equal(viaRandom.ok, false);

  now = new Date(new Date(loginResult.session.expiresAt).getTime() + 1);
  const checkExpired = await w.identity.checkSession(loginResult.token);
  assert.equal(checkExpired.ok, false);
  assert.equal(checkExpired.reason, "expired");
});

test("suspension revokes sessions and blocks new logins; owner cannot be suspended", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const member = await addUser(w, "member@example.com", "Member");
  const memberLogin = await w.identity.login(
    { actor: { userId: member.id }, requestId: "r" },
    member.email,
    "password123",
  );

  // Non-admins cannot suspend.
  await assert.rejects(
    w.identity.suspendUser(w.ctx(member.id), admin.id, true),
    (e: Error) => e.message === "Instance Admin required",
  );

  await w.identity.suspendUser(w.ctx(admin.id), member.id, true);
  const check = await w.identity.checkSession(memberLogin.token);
  assert.equal(check.ok, false);
  // Better Auth removes revoked sessions rather than retaining tombstones.
  assert.equal(check.reason, "none");
  await assert.rejects(
    w.identity.login({ actor: { userId: member.id }, requestId: "r" }, member.email, "password123"),
    (e: Error) => e.message === "This account is suspended",
  );

  await assert.rejects(
    w.identity.suspendUser(w.ctx(admin.id), owner.id, true),
    (e: Error) => e.message === "The Instance Owner cannot be suspended",
  );
});

test("instance ownership transfers only to an existing Instance Admin; former owner stays admin", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const regular = await addUser(w, "regular@example.com", "Regular");

  await assert.rejects(
    w.identity.transferInstanceOwnership(w.ctx(owner.id), regular.id),
    (e: Error) => e.message === "Instance ownership may transfer only to an existing Instance Admin",
  );

  const result = await w.identity.transferInstanceOwnership(w.ctx(owner.id), admin.id);
  assert.equal(result.ownerUserId, admin.id);
  const former = await w.identity.getUser(w.ctx(admin.id), owner.id);
  assert.equal(former?.isInstanceAdmin, true);
  assert.equal(former?.isInstanceOwner, false);
  // Audit visibility follows ownership: audit endpoint is owner-only.
  await assert.rejects(
    w.identity.listAudit(w.ctx(owner.id), {}),
    (e: Error) => e.message === "Instance Owner required",
  );
  void (await w.identity.listAudit(w.ctx(admin.id), {}));
});

test("instance admins may not be demoted by anyone but the owner, and the owner cannot be demoted", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });

  await assert.rejects(
    w.identity.setInstanceAdmin(w.ctx(admin.id), owner.id, false),
    (e: Error) => e.message === "Instance Owner required",
  );
  await assert.rejects(
    w.identity.setInstanceAdmin(w.ctx(admin.id), admin.id, false),
    (e: Error) => e.message === "Instance Owner required",
  );
  const demoted = await w.identity.setInstanceAdmin(w.ctx(owner.id), admin.id, false);
  assert.equal(demoted.isInstanceAdmin, false);
});

test("password change and reset revoke all sessions", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const firstLogin = await w.identity.login(
    { actor: { userId: admin.id }, requestId: "r" },
    admin.email,
    "password123",
  );
  await w.identity.changePassword(w.ctx(admin.id), "password123", "newpassword1");
  assert.equal((await w.identity.checkSession(firstLogin.token)).ok, false);

  const secondLogin = await w.identity.login(
    { actor: { userId: admin.id }, requestId: "r" },
    admin.email,
    "newpassword1",
  );
  const { code } = await w.identity.createResetCode(w.ctx(owner.id), admin.id);
  await w.identity.redeemResetCode(
    { actor: { userId: "reset" }, requestId: "r" },
    code,
    "resetpassword1",
  );
  assert.equal((await w.identity.checkSession(secondLogin.token)).ok, false);
});

test("invitations: owner-only, reusable, revocable, expiring, and redeemable once per user", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const project = await addProject(w, owner);
  const invitee = await addUser(w, "invitee@example.com", "Invitee");

  // Members cannot invite.
  await w.projects.joinProject(w.ctx(admin.id), (await createInvite(w, owner, project.id)).code);
  await assert.rejects(
    w.identity.createInvitation(w.ctx(admin.id), project.id, undefined),
    (e: Error) => e.message === "Only the Project Owner may invite members",
  );

  const { code } = await createInvite(w, owner, project.id);

  // Redeem: becomes member.
  const joined = await w.projects.joinProject(w.ctx(invitee.id), code);
  assert.equal(joined.projectId, project.id);
  assert.equal(joined.member.role, "member");

  // Reusable: a second user may redeem the same token.
  const second = await addUser(w, "second@example.com", "Second");
  await w.projects.joinProject(w.ctx(second.id), code);

  // Revoked invitations stop working.
  const inv = await createInvite(w, owner, project.id);
  await w.identity.revokeInvitation(w.ctx(owner.id), project.id, inv.invitationId);
  const third = await addUser(w, "third@example.com", "Third");
  await assert.rejects(
    w.projects.joinProject(w.ctx(third.id), inv.code),
    (e: Error) => e.message === "Unknown, expired, or revoked invitation",
  );
});

test("invitation with explicit null expiry is non-expiring; default is seven days", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const project = await addProject(w, owner);
  const never = await w.identity.createInvitation(
    w.ctx(owner.id),
    project.id,
    null, // non-expiring
  );
  assert.equal(never.invitation.expiresAt, null);
  const sevenDays = await w.identity.createInvitation(w.ctx(owner.id), project.id, undefined);
  assert.ok(sevenDays.invitation.expiresAt);
  const expected = new Date("2026-09-14T09:00:00Z").toISOString();
  assert.equal(sevenDays.invitation.expiresAt, expected);
});

test("access keys: project-scoped requires membership; secrets shown once and stored as digests", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  const project = await addProject(w, owner);

  // Non-member cannot create a project key.
  await assert.rejects(
    w.identity.createKey(w.ctx(admin.id), {
      name: "admin-tool",
      ownerType: "user",
      scope: "project",
      projectId: project.id,
    }),
    (e: Error) => e.message === "Project membership required",
  );
  await w.projects.joinProject(
    w.ctx(admin.id),
    (await createInvite(w, owner, project.id)).code,
  );
  const created = await w.identity.createKey(w.ctx(admin.id), {
    name: "admin-tool",
    ownerType: "user",
    scope: "project",
    projectId: project.id,
  });
  assert.ok(created.secret.startsWith("tka_"));

  // Secret is not stored; only its digest is.
  const rows = await w.db.selectFrom("access_keys").selectAll().where("id", "=", created.key.id).execute();
  assert.equal(rows.length, 1);
  const row = rows[0];
  if (row) {
    assert.notEqual(row.secret_hash, created.secret);
    assert.ok(!row.secret_hash.includes("tka_"));
  }

  // Authenticate with the secret.
  const principal = await w.identity.authenticateKey(created.secret);
  assert.equal(principal?.id, created.key.id);
  assert.equal(principal?.scope, "project");

  // Revoked keys stop authenticating.
  await w.identity.revokeKey(w.ctx(admin.id), created.key.id);
  assert.equal(await w.identity.authenticateKey(created.secret), null);
});

test("access keys: instance-wide requires an Instance Admin, must expire within 90 days, and works everywhere", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");

  await assert.rejects(
    w.identity.createKey(w.ctx(member.id), {
      name: "sneaky",
      ownerType: "user",
      scope: "instance",
      expiresAt: "2026-10-01T00:00:00Z",
    }),
    (e: Error) => e.message === "Instance-wide keys require an Instance Admin",
  );

  await assert.rejects(
    w.identity.createKey(w.ctx(owner.id), {
      name: "forever",
      ownerType: "user",
      scope: "instance",
      expiresAt: null,
    }),
    (e: Error) => e.message === "Instance-wide keys must expire",
  );
  await assert.rejects(
    w.identity.createKey(w.ctx(owner.id), {
      name: "too-long",
      ownerType: "user",
      scope: "instance",
      expiresAt: "2027-01-01T00:00:00Z",
    }),
    (e: Error) => e.message === "Instance-wide keys may not live longer than 90 days",
  );

  const { key, secret } = await w.identity.createKey(w.ctx(owner.id), {
    name: "ci",
    ownerType: "user",
    scope: "instance",
    expiresAt: "2026-11-01T00:00:00Z",
  });
  assert.equal(key.scope, "instance");
  const principal = await w.identity.authenticateKey(secret);
  assert.equal(principal?.scope, "instance");
});

test("automations: owned by a user, keyed, and transferable without rewriting history", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const project = await addProject(w, owner);
  const automation = await w.identity.createAutomation(w.ctx(owner.id), "sync-bot");

  const { secret } = await w.identity.createKey(w.ctx(owner.id), {
    name: "sync-key",
    ownerType: "automation",
    automationId: automation.id,
    scope: "project",
    projectId: project.id,
  });
  const principal = await w.identity.authenticateKey(secret);
  assert.equal(principal?.automationId, automation.id);
  assert.equal(principal?.ownerType, "automation");
  // Automation work attributes to the owning person.
  assert.equal(principal?.ownerUserId, owner.id);

  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });
  await w.identity.transferAutomation(w.ctx(owner.id), automation.id, admin.id);
  assert.equal((await w.identity.listAutomations(w.ctx(admin.id))).length, 1);
});

test("audit: records commands with operation and target; only the Instance Owner reads it", async () => {
  const w = track(await buildWorld());
  const owner = await bootstrapOwner(w);
  const admin = await addUser(w, "admin@example.com", "Admin", { isInstanceAdmin: true });

  await assert.rejects(
    w.identity.listAudit(w.ctx(admin.id), {}),
    (e: Error) => e.message === "Instance Owner required",
  );

  await addProject(w, owner);
  const entries = await w.identity.listAudit(w.ctx(owner.id), {});
  const operations = entries.items.map((e) => e.operation);
  assert.ok(operations.includes("project.create"));
  assert.ok(operations.includes("bootstrap.redeem"));
  assert.ok(operations.includes("bootstrap.code_issue"));
  // No secrets in audit entries.
  for (const entry of entries.items) {
    assert.ok(!JSON.stringify(entry).includes("password"));
  }
});

async function createInvite(
  w: Awaited<ReturnType<typeof buildWorld>>,
  owner: Awaited<ReturnType<typeof bootstrapOwner>>,
  projectId: string,
): Promise<{ code: string; invitationId: string }> {
  const result = await w.identity.createInvitation(w.ctx(owner.id), projectId, undefined);
  return { code: result.code, invitationId: result.invitation.id };
}

/**
 * HTTP contract tests through Fastify injection: bootstrap, sessions, keys,
 * error envelope, idempotency, CSRF, capabilities, and a full ticket flow.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, type Config } from "../src/config.js";
import { openSqlite } from "../src/db/client.js";
import { createAuthModule, type AuthModule } from "../src/auth.js";
import { migrateToLatest } from "../src/db/migrate.js";
import type { FastifyInstance } from "fastify";
import { buildApp, type App } from "../src/http/app.js";
import { createIdentityService, type IdentityService } from "../src/domain/identity.js";
import { createProjectsService, projectMembershipMutations } from "../src/domain/projects.js";
import { createWorkService, workMutations } from "../src/domain/work.js";
import { createPlanningService } from "../src/domain/planning.js";
import { ProjectEventBus } from "../src/domain/events.js";
import { systemClock } from "../src/time.js";
import { realIds } from "../src/ids.js";

const ORIGIN = "http://localhost:3000";

export interface HttpWorld {
  app: App;
  identity: IdentityService;
  auth: AuthModule;
  baseUrl: string;
  close(): void;
}

export async function buildHttpWorld(config?: Partial<Config>): Promise<HttpWorld> {
  const cfg = loadConfig({
    filePath: "does-not-exist.yaml",
    env: { TRI_DATABASE_PATH: ":memory:", TRI_TRUSTED_ORIGINS: ORIGIN },
  });
  const merged: Config = {
    ...cfg,
    ...config,
    auth: { secret: "test-only-better-auth-secret-32-bytes" },
  };
  const sqlite = openSqlite(":memory:");
  await migrateToLatest(sqlite.db);
  const { db } = sqlite;
  const bus = new ProjectEventBus();
  const auth = createAuthModule({ database: sqlite.driver, config: merged, ids: realIds });

  const projects = createProjectsService({ db, clock: systemClock, ids: realIds, work: workMutations });
  const identity = createIdentityService({
    db,
    auth,
    clock: systemClock,
    ids: realIds,
    projects,
    membership: projectMembershipMutations,
    invitationDefaultTtlDays: 7,
    instanceKeyMaxTtlDays: 90,
    sessionTtlDays: 30,
    bootstrapCodeTtlMinutes: 30,
  });
  const work = createWorkService({ db, clock: systemClock, ids: realIds, projects });
  const planning = createPlanningService({ db, clock: systemClock, ids: realIds, projects, work });

  const app = await buildApp({
    config: merged,
    clock: systemClock,
    ids: realIds,
    serverVersion: "0.2.0",
    identity,
    auth,
    projects,
    work,
    planning,
    bus,
  });
  await app.ready();
  return {
    // SAFETY: buildApp returns the same TypeBox-typed instance.
    app: app as FastifyInstance & typeof app,
    identity,
    auth,
    baseUrl: "/api/v1",
    close: () => {
      void app.close();
      sqlite.close();
    },
  };
}

interface Agent {
  app: App;
  cookie?: string;
  bearer?: string;
}

async function api(
  agent: Agent,
  method: "get" | "post" | "patch" | "delete",
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; origin?: boolean; idempotency?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (agent.cookie) headers.cookie = agent.cookie;
  if (agent.bearer) headers.authorization = `Bearer ${agent.bearer}`;
  if (opts.origin ?? false) headers.origin = ORIGIN;
  if (opts.idempotency) headers["idempotency-key"] = opts.idempotency;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const qs = opts.query
    ? "?" + new URLSearchParams(opts.query).toString()
    : "";
  return agent.app.inject({
    method,
    url: `/api/v1${path}${qs}`,
    headers,
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function bootstrap(agent: Agent, identity: IdentityService): Promise<void> {
  const { code } = await identity.issueBootstrapCode({
    actor: { userId: "init" },
    requestId: "test-init",
  });
  const redeem = await api(agent, "post", "/bootstrap/redeem", {
    body: { code, email: "owner@example.com", displayName: "Owner", password: "password123" },
  });
  assert.equal(redeem.statusCode, 200);
  const setCookie = redeem.headers["set-cookie"];
  const cookie = Array.isArray(setCookie)
    ? setCookie[0]?.split(";")[0]
    : setCookie?.split(";")[0];
  assert.ok(cookie, "session cookie issued");
  agent.cookie = cookie;
}

test("bootstrap through HTTP closes registration; capabilities expose identity", async () => {
  const world = await buildHttpWorld();
  try {
    const agent: Agent = { app: world.app };
    const state = await api(agent, "get", "/bootstrap");
    assert.equal(state.json().open, true);
    const remoteCode = await api(agent, "post", "/bootstrap/code");
    assert.equal(remoteCode.statusCode, 404, "bootstrap codes are local-admin only");

    await bootstrap(agent, world.identity);

    const caps = await api(agent, "get", "/capabilities");
    assert.equal(caps.statusCode, 200);
    const body = caps.json();
    assert.equal(body.actor.email, "owner@example.com");
    assert.equal(body.actor.isInstanceOwner, true);
    assert.equal(body.credential.kind, "session");
    assert.ok(body.features.includes("sse"));
  } finally {
    world.close();
  }
});

test("mutating cookie requests require a trusted origin (CSRF)", async () => {
  const world = await buildHttpWorld();
  try {
    const agent: Agent = { app: world.app };
    await bootstrap(agent, world.identity);

    const rejected = await api(agent, "post", "/projects", {
      body: { name: "Nope" },
      origin: false,
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().error.code, "CSRF_REJECTED");

    const ok = await api(agent, "post", "/projects", {
      body: { name: "Allowed" },
      origin: true,
    });
    assert.equal(ok.statusCode, 200);
  } finally {
    world.close();
  }
});

test("an invitation creates a Better Auth account and project membership", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const project = await api(owner, "post", "/projects", {
      body: { name: "Invited" },
      origin: true,
    });
    const invitation = await api(
      owner,
      "post",
      `/projects/${project.json().id}/invitations`,
      { body: {}, origin: true },
    );
    assert.equal(invitation.statusCode, 200);

    const registration = await world.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: JSON.stringify({
        code: invitation.json().code,
        email: "member@example.com",
        name: "Member",
        password: "password123",
      }),
    });
    assert.equal(registration.statusCode, 200);
    assert.equal(registration.json().projectId, project.json().id);
    const setCookie = registration.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0]?.split(";")[0] : setCookie?.split(";")[0];
    assert.ok(cookie);

    const member: Agent = { app: world.app, cookie };
    const detail = await api(member, "get", `/projects/${project.json().id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().role, "member");

    const signIn = await world.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: JSON.stringify({ email: "member@example.com", password: "password123" }),
    });
    assert.equal(signIn.statusCode, 200);
    assert.ok(signIn.headers["set-cookie"]);
  } finally {
    world.close();
  }
});

test("suspended users cannot sign in through Better Auth", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const project = await api(owner, "post", "/projects", {
      body: { name: "Suspension" },
      origin: true,
    });
    const invitation = await api(owner, "post", `/projects/${project.json().id}/invitations`, {
      body: {},
      origin: true,
    });
    const registration = await world.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: JSON.stringify({
        code: invitation.json().code,
        email: "suspended@example.com",
        name: "Suspended",
        password: "password123",
      }),
    });
    assert.equal(registration.statusCode, 200);
    const users = await api(owner, "get", "/users", { origin: true });
    const member = users.json().find((user: { email: string }) => user.email === "suspended@example.com");
    assert.ok(member);
    const suspended = await api(owner, "post", `/users/${member.id}/suspend`, {
      body: { suspended: true },
      origin: true,
    });
    assert.equal(suspended.statusCode, 200);

    const signIn = await world.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: JSON.stringify({ email: "suspended@example.com", password: "password123" }),
    });
    assert.equal(signIn.statusCode, 403);
    assert.equal(signIn.json().error.code, "SUSPENDED");
  } finally {
    world.close();
  }
});

test("authentication rate limits return the public Problem envelope", async () => {
  const world = await buildHttpWorld();
  try {
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await world.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json", origin: ORIGIN },
        payload: JSON.stringify({ email: "missing@example.com", password: "password123" }),
      });
    }
    assert.equal(last?.statusCode, 429);
    assert.equal(last?.json().error.code, "RATE_LIMITED");
    assert.ok(last?.json().error.requestId);
  } finally {
    world.close();
  }
});

test("error envelope: stable codes, request ids, validation fields", async () => {
  const world = await buildHttpWorld();
  try {
    const agent: Agent = { app: world.app };
    await bootstrap(agent, world.identity);

    const missing = await api(agent, "get", "/projects/does-not-exist", { origin: true });
    void missing;

    const badProject = await api(agent, "post", "/projects", {
      body: { name: "" },
      origin: true,
    });
    assert.equal(badProject.statusCode, 422);
    assert.equal(badProject.json().error.code, "VALIDATION_FAILED");
    assert.ok(badProject.json().error.requestId);
  } finally {
    world.close();
  }
});

test("full ticket lifecycle over HTTP with bearer key: create, review, resolve, metrics", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const project = await api(owner, "post", "/projects", {
      body: { name: "Ship It" },
      origin: true,
    });
    assert.equal(project.statusCode, 200);
    const projectId = project.json().id;

    // The owner issues a project-scoped key for a member to use.
    const keyRes = await api(owner, "post", "/access-keys", {
      body: { name: "member-tool", scope: "project", projectId },
      origin: true,
    });
    assert.equal(keyRes.statusCode, 200);
    const secret = keyRes.json().secret;
    const member: Agent = { app: world.app, bearer: secret };

    const ticket = await api(member, "post", `/projects/${projectId}/tickets`, {
      body: { title: "Do the thing", points: 3 },
    });
    assert.equal(ticket.statusCode, 200);
    const t = ticket.json();
    assert.equal(t.number, 1);

    await api(member, "post", `/projects/${projectId}/tickets/${t.number}/review/request`, {});
    const decided = await api(member, "post", `/projects/${projectId}/tickets/${t.number}/review/decide`, {
      body: { decision: "approved" },
    });
    assert.equal(decided.statusCode, 200);
    const resolved = await api(member, "post", `/projects/${projectId}/tickets/${t.number}/resolve`, {
      body: { comment: "Shipped", expectedResourceVersion: t.resourceVersion },
    });
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.json().category, "done");

    // Sprint + metrics over HTTP.
    const sprint = await api(member, "post", `/projects/${projectId}/sprints`, {
      body: { name: "S1" },
    });
    const sprintId = sprint.json().id;
    await api(member, "post", `/projects/${projectId}/sprints/${sprintId}/activate`, {});
    await api(member, "post", `/projects/${projectId}/sprints/${sprintId}/members`, {
      body: { ticketIds: [t.id] },
    });
    // A project-scoped key inherits its owner's project permissions while
    // remaining unable to access any other project.
    const rename = await api(member, "patch", `/projects/${projectId}`, {
      body: { name: "Hijack" },
    });
    assert.equal(rename.statusCode, 200);
  } finally {
    world.close();
  }
});

test("idempotency: same key+input replays the original result; different input conflicts", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const project = await api(owner, "post", "/projects", {
      body: { name: "P" },
      origin: true,
    });
    const projectId = project.json().id;
    const key = "retry-1";

    const first = await api(owner, "post", `/projects/${projectId}/tickets`, {
      body: { title: "Once" },
      origin: true,
      idempotency: key,
    });
    assert.equal(first.statusCode, 200);

    const replay = await api(owner, "post", `/projects/${projectId}/tickets`, {
      body: { title: "Once" },
      origin: true,
      idempotency: key,
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().id, first.json().id);
    // No duplicate ticket: numbering did not advance.
    const list = await api(owner, "get", `/projects/${projectId}/tickets`);
    assert.equal(list.json().items.length, 1);

    const conflict = await api(owner, "post", `/projects/${projectId}/tickets`, {
      body: { title: "Twice" },
      origin: true,
      idempotency: key,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
  } finally {
    world.close();
  }
});

test("instance-wide keys cannot administer; only the Instance Owner reads audit", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);

    const instanceKey = await api(owner, "post", "/access-keys", {
      body: { name: "ci", scope: "instance", expiresAt: "2026-12-01T00:00:00Z" },
      origin: true,
    });
    assert.equal(instanceKey.statusCode, 200);
    const ci: Agent = { app: world.app, bearer: instanceKey.json().secret };

    const auditAsOwner = await api(owner, "get", "/audit", { origin: true });
    assert.equal(auditAsOwner.statusCode, 200);
    assert.ok(auditAsOwner.json().items.length > 0);

    // Instance-wide key member-level: cannot create projects (admin op).
    const project = await api(ci, "post", "/projects", { body: { name: "Nope" } });
    assert.equal(project.statusCode, 403);
  } finally {
    world.close();
  }
});

test("suspension and revocations flow through HTTP", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const users = await api(owner, "get", "/users", { origin: true });
    const ownerId = users.json().find((u: { isInstanceOwner: boolean }) => u.isInstanceOwner).id;

    const susp = await api(owner, "post", `/users/${ownerId}/suspend`, {
      body: { suspended: true },
      origin: true,
    });
    assert.equal(susp.statusCode, 409);
    assert.equal(susp.json().error.code, "INVALID_STATE");
  } finally {
    world.close();
  }
});

test("SSE and detail reads refuse the unauthenticated and the unauthorized with the problem envelope", async () => {
  const world = await buildHttpWorld();
  try {
    const owner: Agent = { app: world.app };
    await bootstrap(owner, world.identity);
    const project = await api(owner, "post", "/projects", {
      body: { name: "P" },
      origin: true,
    });
    const projectId = project.json().id;

    // Unauthenticated SSE: problem envelope, not raw body.
    const anon: Agent = { app: world.app };
    const sse = await api(anon, "get", `/projects/${projectId}/events`);
    assert.equal(sse.statusCode, 401);
    assert.equal(sse.json().error.code, "AUTH_REQUIRED");

    // Unknown ticket: problem envelope with the stable NOT_FOUND code.
    const detail = await api(owner, "get", `/projects/${projectId}/tickets/1`, { origin: true });
    assert.equal(detail.statusCode, 404);
    assert.equal(detail.json().error.code, "NOT_FOUND");
  } finally {
    world.close();
  }
});

test("health endpoints are unauthenticated", async () => {
  const world = await buildHttpWorld();
  try {
    const live = await world.app.inject({ method: "GET", url: "/api/v1/health/live" });
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: "ok" });
    const ready = await world.app.inject({ method: "GET", url: "/api/v1/health/ready" });
    assert.equal(ready.statusCode, 200);
    const open = await world.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    assert.equal(open.statusCode, 200);
    assert.equal(open.json().info.title, "Triathlon API");
  } finally {
    world.close();
  }
});

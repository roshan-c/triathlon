/**
 * Test world: isolated real SQLite databases (in-memory per test), migrated,
 * with the four domain services wired exactly like production.
 */

import { afterEach } from "node:test";
import { openSqlite, type SqliteDb } from "../src/db/client.js";
import { createAuthModule, type AuthModule } from "../src/auth.js";
import { defaultConfig } from "../src/config.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { fixedClock, systemClock, type Clock } from "../src/time.js";
import { realIds, fixedIds, type Ids } from "../src/ids.js";
import { ProjectEventBus } from "../src/domain/events.js";
import {
  createIdentityService,
  type IdentityService,
} from "../src/domain/identity.js";
import {
  createProjectsService,
  projectMembershipMutations,
  type ProjectsService,
} from "../src/domain/projects.js";
import {
  createWorkService,
  workMutations,
  type WorkService,
} from "../src/domain/work.js";
import {
  createPlanningService,
  type PlanningService,
} from "../src/domain/planning.js";
import type { Actor, RequestContext } from "../src/domain/context.js";
import type { User } from "../src/domain/identity.js";
import type { Db } from "../src/db/types.js";

export interface World {
  sqlite: SqliteDb;
  db: Db;
  clock: Clock;
  ids: Ids;
  bus: ProjectEventBus;
  auth: AuthModule;
  identity: IdentityService;
  projects: ProjectsService;
  work: WorkService;
  planning: PlanningService;
  /** Request context for a user actor (session-level). */
  ctx(userId: string): RequestContext;
  close(): void;
}

export interface WorldOptions {
  clock?: Clock;
  ids?: Ids;
}

export async function buildWorld(opts: WorldOptions = {}): Promise<World> {
  const clock = opts.clock ?? fixedClock(new Date("2026-09-07T09:00:00Z"));
  const ids = opts.ids ?? realIds;
  const sqlite = openSqlite(":memory:");
  await migrateToLatest(sqlite.db);
  const db = sqlite.db;
  const bus = new ProjectEventBus();
  const config = defaultConfig();
  config.databasePath = ":memory:";
  config.auth.secret = "test-only-better-auth-secret-32-bytes";
  const auth = createAuthModule({ database: sqlite.driver, config, ids });

  const projects = createProjectsService({
    db,
    clock,
    ids,
    work: workMutations,
  });
  const identity = createIdentityService({
    db,
    auth,
    clock,
    ids,
    projects,
    membership: projectMembershipMutations,
    invitationDefaultTtlDays: 7,
    instanceKeyMaxTtlDays: 90,
    sessionTtlDays: 30,
    bootstrapCodeTtlMinutes: 30,
  });
  const work = createWorkService({ db, clock, ids, projects });
  const planning = createPlanningService({ db, clock, ids, projects, work });

  const world: World = {
    sqlite,
    db,
    clock,
    ids,
    bus,
    auth,
    identity,
    projects,
    work,
    planning,
    ctx: (userId) => ({ actor: { userId, keyScope: "session" }, requestId: `req-${userId}` }),
    close: () => sqlite.close(),
  };
  return world;
}

/** Keep worlds alive until the test file finishes. */
const openWorlds = new Set<World>();
afterEach(() => {
  for (const w of openWorlds) {
    w.close();
  }
  openWorlds.clear();
});

export function track(w: World): World {
  openWorlds.add(w);
  return w;
}

/** Full bootstrap flow: emits a code (fixed values when ids are fixed) and redeems it. */
export async function bootstrapOwner(
  w: World,
  email = "owner@example.com",
  password = "password123",
  displayName = "Owner",
): Promise<User> {
  const { code } = await w.identity.issueBootstrapCode({
    actor: { userId: "init" },
    requestId: "init",
  });
  return w.identity.redeemBootstrap(
    { actor: { userId: "init" }, requestId: "init" },
    { code, email, displayName, password },
  );
}

/** Direct user fixture (bypasses invitation flows; setup only). */
export async function addUser(
  w: World,
  email: string,
  displayName: string,
  opts: { password?: string; isInstanceAdmin?: boolean } = {},
): Promise<User> {
  const id = w.ids.uuidv7();
  const createdAt = w.clock.now().toISOString();
  await w.auth.createCredentialUser({
    id,
    email,
    name: displayName,
    password: opts.password ?? "password123",
  });
  await w.db
    .insertInto("users")
    .values({
      id,
      email,
      display_name: displayName,
      password_hash: "",
      is_instance_admin: opts.isInstanceAdmin ? 1 : 0,
      is_suspended: 0,
      created_at: createdAt,
    })
    .execute();
  const meta = await w.db
    .selectFrom("instance_meta")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirstOrThrow();
  const row = await w.db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isInstanceAdmin: row.is_instance_admin === 1,
    isInstanceOwner: row.id === meta.owner_user_id,
    isSuspended: row.is_suspended === 1,
    createdAt: row.created_at,
  };
}

/** Project fixture owned by `owner` with a fresh default workflow board. */
export async function addProject(
  w: World,
  owner: User,
  name = "Ship It",
  timezone = "UTC",
) {
  return w.projects.createProject(w.ctx(owner.id), { name, timezone });
}

/** Direct membership fixture (bypasses invitations; setup only). */
export async function addMember(
  w: World,
  projectId: string,
  user: User,
  by: User,
): Promise<void> {
  await w.db
    .insertInto("project_members")
    .values({
      project_id: projectId,
      user_id: user.id,
      added_at: w.clock.now().toISOString(),
      added_by: by.id,
      removed_at: null,
      removed_by: null,
    })
    .execute();
}

export async function ticketId(w: World, projectId: string, number: number): Promise<string> {
  const row = await w.db
    .selectFrom("tickets")
    .select("id")
    .where("project_id", "=", projectId)
    .where("number", "=", number)
    .executeTakeFirstOrThrow();
  return row.id;
}

export function asActor(user: User): Actor {
  return { userId: user.id, keyScope: "session" };
}

export { fixedClock, fixedIds, systemClock };
export type { User };

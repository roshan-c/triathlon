/**
 * Application composition: configuration, database, modules, and the HTTP
 * adapter, wired explicitly. No dependency-injection container; only clock,
 * ids, and randomness receive test adapters.
 */

import type { Config } from "./config.js";
import { openSqlite, type SqliteDb } from "./db/client.js";
import { assertSchemaCompatible, migrateToLatest } from "./db/migrate.js";
import { systemClock, type Clock } from "./time.js";
import { realIds, type Ids } from "./ids.js";
import { ProjectEventBus } from "./domain/events.js";
import { createIdentityService, type IdentityService } from "./domain/identity.js";
import { createProjectsService, type ProjectsService } from "./domain/projects.js";
import { createWorkService, type WorkService } from "./domain/work.js";
import { workMutations } from "./domain/work.js";
import { createPlanningService, type PlanningService } from "./domain/planning.js";
import { buildApp, type App } from "./http/app.js";

export const SERVER_VERSION = "0.2.0";

export interface Server {
  config: Config;
  sqlite: SqliteDb;
  clock: Clock;
  ids: Ids;
  bus: ProjectEventBus;
  identity: IdentityService;
  projects: ProjectsService;
  work: WorkService;
  planning: PlanningService;
  app: App;
  close(): Promise<void>;
}

export interface CreateServerOptions {
  config: Config;
  clock?: Clock;
  ids?: Ids;
}

/**
 * Create the server against an existing database. Callers are responsible for
 * applying migrations first (the test harness and the serve/maintenance
 * commands do this explicitly).
 */
export async function createServer(opts: CreateServerOptions): Promise<Server> {
  const config = opts.config;
  const clock = opts.clock ?? systemClock;
  const ids = opts.ids ?? realIds;

  const sqlite = openSqlite(config.databasePath);
  const { db } = sqlite;
  const bus = new ProjectEventBus();

  // The instance default timezone follows configuration; projects inherit it.
  void db
    .updateTable("instance_meta")
    .set({ timezone: config.timezone })
    .where("id", "=", 1)
    .execute();

  const projects = createProjectsService({
    db,
    clock,
    ids,
    work: workMutations,
  });
  const identity = createIdentityService({
    db,
    clock,
    ids,
    projects,
    invitationDefaultTtlDays: config.invitations.defaultTtlDays,
    instanceKeyMaxTtlDays: config.instanceWideKeys.maxTtlDays,
    sessionTtlDays: config.session.ttlDays,
    bootstrapCodeTtlMinutes: config.bootstrap.codeTtlMinutes,
  });
  const work = createWorkService({ db, clock, ids, projects });
  const planning = createPlanningService({ db, clock, ids, projects, work });

  const app = await buildApp({
    config,
    db,
    clock,
    ids,
    serverVersion: SERVER_VERSION,
    identity,
    projects,
    work,
    planning,
    bus,
  });

  return {
    config,
    sqlite,
    clock,
    ids,
    bus,
    identity,
    projects,
    work,
    planning,
    app,
    close: async () => {
      await app.close();
      sqlite.close();
    },
  };
}

/** Prepare the database for serving: compatibility check + forward migrate. */
export async function prepareDatabase(sqlite: SqliteDb): Promise<void> {
  await assertSchemaCompatible(sqlite.db);
  await migrateToLatest(sqlite.db);
}
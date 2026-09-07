/**
 * Generates the checked-in OpenAPI document from the Fastify routes.
 * CI rejects stale generated artifacts (run after route changes).
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { openSqlite } from "../src/db/client.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { createIdentityService } from "../src/domain/identity.js";
import { createProjectsService } from "../src/domain/projects.js";
import { createWorkService, workMutations } from "../src/domain/work.js";
import { createPlanningService } from "../src/domain/planning.js";
import { ProjectEventBus } from "../src/domain/events.js";
import { systemClock } from "../src/time.js";
import { realIds } from "../src/ids.js";
import { buildApp } from "../src/http/app.js";
import { SERVER_VERSION } from "../src/server.js";

const outPath = resolve(process.cwd(), "openapi.json");

const config = loadConfig({ filePath: process.env.TRI_CONFIG });
config.databasePath = ":memory:";
config.host = "127.0.0.1";
config.port = 1;

const sqlite = openSqlite(":memory:");
try {
  await migrateToLatest(sqlite.db);
  const { db } = sqlite;
  const bus = new ProjectEventBus();
  const projects = createProjectsService({ db, clock: systemClock, ids: realIds, work: workMutations });
  const identity = createIdentityService({
    db,
    clock: systemClock,
    ids: realIds,
    projects,
    invitationDefaultTtlDays: config.invitations.defaultTtlDays,
    instanceKeyMaxTtlDays: config.instanceWideKeys.maxTtlDays,
    sessionTtlDays: config.session.ttlDays,
    bootstrapCodeTtlMinutes: config.bootstrap.codeTtlMinutes,
  });
  const work = createWorkService({ db, clock: systemClock, ids: realIds, projects });
  const planning = createPlanningService({ db, clock: systemClock, ids: realIds, projects, work });
  const app = await buildApp({
    config,
    db,
    clock: systemClock,
    ids: realIds,
    serverVersion: SERVER_VERSION,
    identity,
    projects,
    work,
    planning,
    bus,
  });
  await app.ready();
  const doc = app.swagger();
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
  await app.close();
} finally {
  sqlite.close();
}
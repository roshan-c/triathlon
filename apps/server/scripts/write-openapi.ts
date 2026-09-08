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
import { createProjectsService, projectMembershipMutations } from "../src/domain/projects.js";
import { createWorkService, workMutations } from "../src/domain/work.js";
import { createPlanningService } from "../src/domain/planning.js";
import { ProjectEventBus } from "../src/domain/events.js";
import { systemClock } from "../src/time.js";
import { realIds } from "../src/ids.js";
import { buildApp } from "../src/http/app.js";
import { SERVER_VERSION } from "../src/server.js";
import { createAuthModule } from "../src/auth.js";

const outPath = resolve(process.cwd(), "openapi.json");

const config = loadConfig({ filePath: process.env.TRI_CONFIG });
config.databasePath = ":memory:";
config.host = "127.0.0.1";
config.port = 1;
config.auth.secret = "openapi-generation-secret-at-least-32-bytes";

const sqlite = openSqlite(":memory:");
try {
  await migrateToLatest(sqlite.db);
  const { db } = sqlite;
  const bus = new ProjectEventBus();
  const auth = createAuthModule({ database: sqlite.driver, config, ids: realIds });
  const projects = createProjectsService({ db, clock: systemClock, ids: realIds, work: workMutations });
  const identity = createIdentityService({
    db,
    auth,
    clock: systemClock,
    ids: realIds,
    projects,
    membership: projectMembershipMutations,
    invitationDefaultTtlDays: config.invitations.defaultTtlDays,
    instanceKeyMaxTtlDays: config.instanceWideKeys.maxTtlDays,
    sessionTtlDays: config.session.ttlDays,
    bootstrapCodeTtlMinutes: config.bootstrap.codeTtlMinutes,
  });
  const work = createWorkService({ db, clock: systemClock, ids: realIds, projects });
  const planning = createPlanningService({ db, clock: systemClock, ids: realIds, projects, work });
  const app = await buildApp({
    config,
    clock: systemClock,
    ids: realIds,
    serverVersion: SERVER_VERSION,
    identity,
    auth,
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

/**
 * Ordered forward-only migrations. Migration files are immutable once
 * released; older application builds refuse a database migrated by a newer
 * build (see migrateToLatest).
 */

import { Migrator, sql } from "kysely";
import { domainError } from "../errors.js";
import { LATEST_MIGRATION, MIGRATIONS } from "./migrations/0001-init.js";
import type { Db } from "./types.js";

export interface MigrationOutcome {
  migrated: string[];
  error?: Error;
  results: unknown[];
}

/** Apply all pending migrations. Throws on failure. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
  });
  // SAFETY: Kysely's MigratorResult is structurally the migration outcome.
  const outcome = (await migrator.migrateToLatest()) as MigrationOutcome;
  if (outcome.error) throw outcome.error;
  return outcome.migrated ?? [];
}

/** Names of migrations already applied to this database. */
export async function appliedMigrations(db: Db): Promise<string[]> {
  const table = await sql<{ name: string }>`
    select name from sqlite_master
    where type = 'table' and name = 'kysely_migration'
  `.execute(db);
  if (table.rows.length === 0) return []; // fresh database: nothing applied yet
  const rows = await sql<{ name: string }>`select name from kysely_migration`.execute(db);
  return rows.rows.map((r) => r.name).sort();
}

/**
 * Refuse to run against a database migrated by a newer build: if any applied
 * migration is unknown to this build, fail closed.
 */
export async function assertSchemaCompatible(db: Db): Promise<void> {
  const applied = await appliedMigrations(db);
  const known = Object.keys(MIGRATIONS);
  const newer = applied.filter((name) => !known.includes(name));
  if (newer.length > 0) {
    throw domainError(
      "INVALID_STATE",
      `Database schema is newer than this build (applied ${newer.join(", ")}; ` +
        `this build supports up to ${LATEST_MIGRATION})`,
    );
  }
}

export function isMigrated(db: Db): Promise<boolean> {
  return appliedMigrations(db).then(
    (applied) => applied.length > 0 && applied.includes(LATEST_MIGRATION),
  );
}

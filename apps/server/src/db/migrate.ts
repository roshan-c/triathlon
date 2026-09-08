/**
 * Ordered forward-only migrations. Migration files are immutable once
 * released; older application builds refuse a database migrated by a newer
 * build (see migrateToLatest).
 */

import { Migrator, sql } from "kysely";
import { setTimeout as delay } from "node:timers/promises";
import { domainError } from "../errors.js";
import { LATEST_MIGRATION, MIGRATIONS } from "./migrations/index.js";
import type { Db } from "./types.js";

export interface MigrationOutcome {
  migrated: string[];
  error?: Error;
  results: unknown[];
}

/**
 * SQLite's Kysely adapter only serializes migrations within one connection.
 * A database-level write transaction is needed when two server processes
 * start against the same file at the same time.
 */
async function migrateWithSqliteWriteLock(db: Db): Promise<MigrationOutcome> {
  // Keep lock retries short so a second process can observe the first one's
  // commit instead of waiting for the normal request busy timeout each time.
  await sql`pragma busy_timeout = 250`.execute(db);
  let transactionStarted = false;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        await sql`begin immediate`.execute(db);
        transactionStarted = true;
        break;
      } catch (error) {
        // SAFETY: better-sqlite3 exposes SQLite error codes on its Error values.
        const code = (error as { code?: unknown }).code;
        if (code !== "SQLITE_BUSY" || attempt === 119) throw error;
        await delay(50);
      }
    }
    if (!transactionStarted) {
      throw new Error("Timed out waiting for the SQLite migration lock");
    }
    const migrator = new Migrator({
      db,
      disableTransactions: true,
      provider: { getMigrations: async () => MIGRATIONS },
    });
    // SAFETY: Kysely's MigratorResult is structurally the migration outcome.
    const outcome = (await migrator.migrateToLatest()) as MigrationOutcome;
    if (outcome.error) {
      throw outcome.error;
    }
    await sql`commit`.execute(db);
    transactionStarted = false;
    return outcome;
  } catch (error) {
    if (transactionStarted) {
      try {
        await sql`rollback`.execute(db);
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
    }
    throw error;
  } finally {
    await sql`pragma busy_timeout = 5000`.execute(db);
  }
}

/** Apply all pending migrations. Throws on failure. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const outcome = await migrateWithSqliteWriteLock(db);
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

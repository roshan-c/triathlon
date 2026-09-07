/**
 * SQLite database setup: WAL mode, foreign keys, busy timeout, and the Kysely
 * instance. Kysely and SQLite remain internal implementation details of the
 * domain modules.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database as DbSchema } from "./types.js";

export interface SqliteDb {
  driver: Database.Database;
  db: Kysely<DbSchema>;
  close(): void;
}

export function openSqlite(path: string): SqliteDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const driver = new Database(path);
  driver.pragma("journal_mode = WAL");
  driver.pragma("foreign_keys = ON");
  driver.pragma("busy_timeout = 5000");
  driver.pragma("synchronous = NORMAL");
  const db = new Kysely<DbSchema>({
    dialect: new SqliteDialect({ database: driver }),
  });
  return {
    driver,
    db,
    close: () => {
      db.destroy().catch(() => undefined);
      driver.close();
    },
  };
}
/** SQLite operational tools used by the local `triathlon` executable. */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { SqliteDb } from "./db/client.js";
import { domainError } from "./errors.js";
import type { Config } from "./config.js";

export interface IntegrityResult {
  ok: boolean;
  messages: string[];
}

export function checkIntegrity(driver: Database.Database): IntegrityResult {
  // SAFETY: better-sqlite3 returns pragma rows as objects keyed by the pragma
  // name; integrity_check emits one string-valued column per row.
  const rows = driver.pragma("integrity_check") as Array<Record<string, string>>;
  const messages = rows.flatMap((row) => Object.values(row));
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

export async function backupDatabase(sqlite: SqliteDb, destination: string): Promise<string> {
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true });
  await sqlite.driver.backup(target);
  const check = new Database(target, { readonly: true });
  try {
    const result = checkIntegrity(check);
    if (!result.ok) {
      unlinkSync(target);
      throw domainError("INVALID_STATE", `Backup integrity check failed: ${result.messages.join(", ")}`);
    }
  } finally {
    check.close();
  }
  return target;
}

/** Restore a verified backup with an atomic final rename. The target database
 * must not be open in this process. */
export function restoreDatabase(source: string, destination: string): string {
  const from = resolve(source);
  const target = resolve(destination);
  if (from === target) throw domainError("VALIDATION_FAILED", "Backup and database paths must differ");
  const sourceDb = new Database(from, { readonly: true, fileMustExist: true });
  try {
    const result = checkIntegrity(sourceDb);
    if (!result.ok) {
      throw domainError("INVALID_STATE", `Backup integrity check failed: ${result.messages.join(", ")}`);
    }
  } finally {
    sourceDb.close();
  }

  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.restore-${process.pid}`;
  try {
    copyFileSync(from, temp);
    statSync(temp);
    renameSync(temp, target);
  } catch (cause) {
    try { unlinkSync(temp); } catch { /* absent temp is harmless */ }
    throw cause;
  }
  return target;
}

export function timestampedBackupPath(directory: string, kind: "manual" | "pre-migration" | "daily" | "weekly", now = new Date()): string {
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve(directory, `triathlon-${kind}-${stamp}.db`);
}

export interface ScheduledBackupResult {
  dailyCreated: boolean;
  weeklyCreated: boolean;
  dailyPruned: number;
  weeklyPruned: number;
}

function isoWeekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function backupDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function pruneScheduledBackups(directory: string, kind: "daily" | "weekly", retention: number): number {
  const prefix = `triathlon-${kind}-`;
  const files = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
    .sort()
    .reverse();
  let removed = 0;
  for (const file of files.slice(retention)) {
    const path = resolve(directory, file);
    if (statSync(path).isFile()) {
      unlinkSync(path);
      removed += 1;
    }
  }
  return removed;
}

/** Create at most one daily and one weekly backup for a maintenance tick. */
export async function runScheduledBackups(
  sqlite: SqliteDb,
  config: Config,
  now: Date,
): Promise<ScheduledBackupResult> {
  if (!config.backups.enabled) {
    return { dailyCreated: false, weeklyCreated: false, dailyPruned: 0, weeklyPruned: 0 };
  }
  const directory = resolve(config.backups.directory);
  mkdirSync(directory, { recursive: true });
  const dailyPath = resolve(directory, `triathlon-daily-${backupDateKey(now)}.db`);
  const weeklyPath = resolve(directory, `triathlon-weekly-${isoWeekKey(now)}.db`);
  const dailyCreated = !existsSync(dailyPath);
  const weeklyCreated = !existsSync(weeklyPath);
  if (dailyCreated) await backupDatabase(sqlite, dailyPath);
  if (weeklyCreated) await backupDatabase(sqlite, weeklyPath);
  return {
    dailyCreated,
    weeklyCreated,
    dailyPruned: pruneScheduledBackups(directory, "daily", config.backups.dailyRetention),
    weeklyPruned: pruneScheduledBackups(directory, "weekly", config.backups.weeklyRetention),
  };
}

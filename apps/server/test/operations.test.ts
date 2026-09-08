import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSqlite } from "../src/db/client.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { backupDatabase, checkIntegrity, restoreDatabase, runScheduledBackups } from "../src/operations.js";
import { describeConfig, loadConfig } from "../src/config.js";

test("nested environment configuration overrides defaults and redacts auth secrets", () => {
  const config = loadConfig({
    filePath: "missing-test-config.yaml",
    env: {
      TRI_AUTH_SECRET: "a-valid-test-secret-that-is-at-least-32-bytes",
      TRI_SESSION_TTL_DAYS: "12",
      TRI_BACKUPS_ENABLED: "false",
      TRI_BACKUP_DAILY_RETENTION: "9",
    },
  });
  assert.equal(config.auth.secret, "a-valid-test-secret-that-is-at-least-32-bytes");
  assert.equal(config.session.ttlDays, 12);
  assert.equal(config.backups.enabled, false);
  assert.equal(config.backups.dailyRetention, 9);
  assert.equal(describeConfig(config).auth.secret, "[redacted]");
});

test("online backup is verified and can be restored atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "triathlon-ops-"));
  const databasePath = join(directory, "live.db");
  const backupPath = join(directory, "backup.db");
  let sqlite = openSqlite(databasePath);
  try {
    await migrateToLatest(sqlite.db);
    await sqlite.db.updateTable("instance_meta").set({ timezone: "Europe/London" }).where("id", "=", 1).execute();
    await backupDatabase(sqlite, backupPath);
    assert.equal(checkIntegrity(sqlite.driver).ok, true);
    await sqlite.db.updateTable("instance_meta").set({ timezone: "UTC" }).where("id", "=", 1).execute();
    sqlite.close();

    restoreDatabase(backupPath, databasePath);
    sqlite = openSqlite(databasePath);
    const row = await sqlite.db.selectFrom("instance_meta").select("timezone").where("id", "=", 1).executeTakeFirstOrThrow();
    assert.equal(row.timezone, "Europe/London");
    assert.equal(checkIntegrity(sqlite.driver).ok, true);
  } finally {
    try { sqlite.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("scheduled backups are date-keyed and retained by kind", async () => {
  const directory = mkdtempSync(join(tmpdir(), "triathlon-schedule-"));
  const databasePath = join(directory, "live.db");
  const sqlite = openSqlite(databasePath);
  try {
    await migrateToLatest(sqlite.db);
    const config = loadConfig({
      filePath: "missing-test-config.yaml",
      env: {
        TRI_AUTH_SECRET: "a-valid-test-secret-that-is-at-least-32-bytes",
        TRI_BACKUP_DIRECTORY: directory,
        TRI_BACKUP_DAILY_RETENTION: "2",
        TRI_BACKUP_WEEKLY_RETENTION: "1",
      },
    });
    const first = await runScheduledBackups(sqlite, config, new Date("2026-09-01T12:00:00.000Z"));
    const second = await runScheduledBackups(sqlite, config, new Date("2026-09-02T12:00:00.000Z"));
    const third = await runScheduledBackups(sqlite, config, new Date("2026-09-08T12:00:00.000Z"));
    assert.equal(first.dailyCreated, true);
    assert.equal(second.dailyCreated, true);
    assert.equal(third.dailyCreated, true);
    assert.equal(third.weeklyCreated, true);
    assert.equal(second.weeklyCreated, false);
    const backups = readdirSync(directory).filter((name) => name.endsWith(".db") && name !== "live.db");
    assert.equal(backups.filter((name) => name.startsWith("triathlon-daily-")).length, 2);
    assert.equal(backups.filter((name) => name.startsWith("triathlon-weekly-")).length, 1);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("two startup processes converge on one forward migration history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "triathlon-migrate-"));
  const databasePath = join(directory, "live.db");
  const first = openSqlite(databasePath);
  const second = openSqlite(databasePath);
  try {
    const outcomes = await Promise.all([
      migrateToLatest(first.db),
      migrateToLatest(second.db),
    ]);
    assert.equal(outcomes.every((migrated) => migrated.length >= 0), true);
    const applied = await migrateToLatest(first.db);
    assert.deepEqual(applied, []);
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

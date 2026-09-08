/**
 * Lightweight in-process maintenance: cleans expired invitations, reset
 * codes, sessions, and seven-day idempotency records. Runs inside the server
 * process with database locks.
 */

import type { SqliteDb } from "./db/client.js";
import type { Config } from "./config.js";
import { runScheduledBackups } from "./operations.js";

const IDEMPOTENCY_RETENTION_DAYS = 7;
const EXPIRED_CODE_RETENTION_DAYS = 1;

/** Returns the number of rows removed per bucket. */
export async function runMaintenance(
  sqlite: SqliteDb,
  config: Config,
  now: Date,
): Promise<Record<string, number>> {
  const { db } = sqlite;
  const cutoff = (days: number): string =>
    new Date(now.getTime() - days * 86_400_000).toISOString();

  const expiredInvitations = await db
    .deleteFrom("invitations")
    .where("expires_at", "is not", null)
    .where("expires_at", "<", now.toISOString())
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const staleCodes = await db
    .deleteFrom("bootstrap_codes")
    .where("used_at", "is", null)
    .where("expires_at", "<", cutoff(EXPIRED_CODE_RETENTION_DAYS))
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const staleResetCodes = await db
    .deleteFrom("reset_codes")
    .where("used_at", "is", null)
    .where("expires_at", "<", cutoff(EXPIRED_CODE_RETENTION_DAYS))
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const expiredSessions = await db
    .deleteFrom("auth_sessions")
    .where("expiresAt", "<", now.getTime())
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const oldIdempotency = await db
    .deleteFrom("idempotency")
    .where("created_at", "<", cutoff(IDEMPOTENCY_RETENTION_DAYS))
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const expiredRateLimits = await db
    .deleteFrom("rate_limits")
    .where("reset_at", "<", now.toISOString())
    .execute()
    .then((r) => Number(r[0]?.numDeletedRows ?? 0));

  const backups = await runScheduledBackups(sqlite, config, now);

  return {
    expiredInvitations,
    staleBootstrapCodes: staleCodes,
    staleResetCodes,
    expiredSessions,
    oldIdempotency,
    expiredRateLimits,
    scheduledDailyBackup: backups.dailyCreated ? 1 : 0,
    scheduledWeeklyBackup: backups.weeklyCreated ? 1 : 0,
    prunedDailyBackups: backups.dailyPruned,
    prunedWeeklyBackups: backups.weeklyPruned,
  };
}

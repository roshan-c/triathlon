#!/usr/bin/env node
/**
 * `triathlon` — the local administrative executable for a self-hosted
 * Triathlon instance: serve, migrate, migrate --check, config, and init
 * (secure first-owner bootstrap).
 */

import { Command } from "commander";
import { loadConfig, describeConfig, DEFAULT_CONFIG_PATH } from "./config.js";
import { openSqlite } from "./db/client.js";
import {
  appliedMigrations,
  assertSchemaCompatible,
  migrateToLatest,
} from "./db/migrate.js";
import { LATEST_MIGRATION } from "./db/migrations/0001-init.js";
import { createServer, prepareDatabase } from "./server.js";
import { runMaintenance } from "./maintenance.js";
import { systemClock } from "./time.js";

const program = new Command();

program
  .name("triathlon")
  .description("Local administrative executable for a self-hosted Triathlon instance")
  .version("0.2.0");

program
  .command("serve")
  .description("Migrate (by default) and start the HTTP server")
  .option("--config <path>", "configuration file", DEFAULT_CONFIG_PATH)
  .option("--no-migrate", "refuse to apply migrations at startup")
  .action(async (opts: { config: string; migrate: boolean }) => {
    const config = loadConfig({ filePath: opts.config });
    const sqlite = openSqlite(config.databasePath);
    try {
      if (opts.migrate) {
        await prepareDatabase(sqlite);
        console.log(`triathlon: migrations applied, schema ${LATEST_MIGRATION}`);
      } else {
        await assertSchemaCompatible(sqlite.db);
      }
    } catch (error) {
      console.error(`triathlon: ${error instanceof Error ? error.message : error}`);
      sqlite.close();
      process.exit(1);
    }

    const server = await createServer({ config });
    try {
      await server.app.listen({ host: config.host, port: config.port });
    } catch (error) {
      console.error(`triathlon: failed to start on ${config.host}:${config.port} — ${error instanceof Error ? error.message : error}`);
      await server.close();
      process.exit(1);
    }
    const url = config.baseUrl ?? `http://${config.host}:${config.port}`;
    server.app.log.info({ url }, "triathlon serving");

    // Lightweight in-process maintenance.
    const maintenance = async (): Promise<void> => {
      try {
        const result = await runMaintenance(sqlite, config, systemClock.now());
        server.app.log.debug({ result }, "maintenance complete");
      } catch (error) {
        server.app.log.warn({ err: error }, "maintenance failed");
      }
    };
    await maintenance();
    const interval = setInterval(
      () => void maintenance(),
      config.maintenance.intervalMinutes * 60_000,
    );
    interval.unref();

    const shutdown = async (signal: string): Promise<void> => {
      server.app.log.info({ signal }, "shutting down");
      clearInterval(interval);
      await server.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  });

program
  .command("migrate")
  .description("Apply forward migrations; --check only verifies")
  .option("--config <path>", "configuration file", DEFAULT_CONFIG_PATH)
  .option("--check", "verify migrations are up to date without applying")
  .action(async (opts: { config: string; check: boolean }) => {
    const config = loadConfig({ filePath: opts.config });
    const sqlite = openSqlite(config.databasePath);
    try {
      if (opts.check) {
        await assertSchemaCompatible(sqlite.db);
        const applied = await appliedMigrations(sqlite.db);
        const upToDate = applied.includes(LATEST_MIGRATION);
        console.log(
          upToDate
            ? `triathlon: schema is up to date (${LATEST_MIGRATION})`
            : `triathlon: schema is behind (applied: ${applied.join(", ") || "none"}, latest: ${LATEST_MIGRATION})`,
        );
        process.exitCode = upToDate ? 0 : 1;
      } else {
        const applied = await migrateToLatest(sqlite.db);
        console.log(
          applied.length > 0
            ? `triathlon: applied ${applied.join(", ")}`
            : `triathlon: schema already up to date (${LATEST_MIGRATION})`,
        );
      }
    } catch (error) {
      console.error(`triathlon: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    } finally {
      sqlite.close();
    }
  });

program
  .command("config")
  .description("Print resolved configuration with secrets redacted")
  .option("--config <path>", "configuration file", DEFAULT_CONFIG_PATH)
  .action((opts: { config: string }) => {
    const config = loadConfig({ filePath: opts.config });
    console.log(JSON.stringify(describeConfig(config), null, 2));
  });

program
  .command("init")
  .description("Prepare the instance and issue the one-time owner bootstrap code")
  .option("--config <path>", "configuration file", DEFAULT_CONFIG_PATH)
  .action(async (opts: { config: string }) => {
    const config = loadConfig({ filePath: opts.config });
    const sqlite = openSqlite(config.databasePath);
    try {
      await prepareDatabase(sqlite);
      const { db } = sqlite;
      const meta = await db
        .selectFrom("instance_meta")
        .select(["owner_user_id", "bootstrap_closed_at"])
        .where("id", "=", 1)
        .executeTakeFirstOrThrow();
      if (meta.owner_user_id !== null) {
        console.log(
          `triathlon: bootstrap is closed; the Instance Owner was created at ${meta.bootstrap_closed_at}`,
        );
        return;
      }
      const server = await createServer({ config });
      try {
        const { code } = await server.identity.issueBootstrapCode({
          actor: { userId: "init" },
          requestId: "init",
        });
        const base = config.baseUrl ?? `http://${config.host}:${config.port}`;
        const ttl = config.bootstrap.codeTtlMinutes;
        console.log(`triathlon: instance is unowned; bootstrap code issued (valid ${ttl} minutes).`);
        console.log(`  Code: ${code}`);
        console.log(`  Setup URL: ${base}/setup?code=${code}`);
        console.log("  Redeem via POST /api/v1/bootstrap/redeem, or visit the setup URL.");
      } finally {
        await Promise.resolve(server.close()).catch(() => undefined);
      }
    } catch (error) {
      console.error(`triathlon: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    } finally {
      sqlite.close();
    }
  });

program.parseAsync(process.argv).catch((cause: unknown) => {
  console.error(`triathlon: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
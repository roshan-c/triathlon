/**
 * Project-scoped Server-Sent Events.
 *
 * Subscribers must be members (or instance-wide keys). The route replays
 * committed activity from the database when Last-Event-ID is present, then
 * streams live events. Clients safely ignore unknown event types.
 */

import type { Kysely } from "kysely";
import { Type } from "@sinclair/typebox";
import type { Database as DbSchema } from "../../db/types.js";
import type { ProjectEvent, ProjectEventBus } from "../../domain/events.js";
import { requireOpenProject } from "../../domain/projects.js";
import type { ProjectsSeam } from "../../domain/projects.js";
import { domainError } from "../../errors.js";
import type { App } from "../app.js";

export interface EventsRouteDeps {
  db: Kysely<DbSchema>;
  bus: ProjectEventBus;
  projects: ProjectsSeam;
}

const HEARTBEAT_MS = 15_000;

export function registerEventsRoute(app: App, deps: EventsRouteDeps): void {
  app.get(
    "/api/v1/projects/:projectId/events",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
      },
    },
    async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        throw domainError("AUTH_REQUIRED", "Authentication required");
      }
      const projectId = request.params.projectId;
      await requireOpenProject(deps.projects, ctx, projectId);

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.hijack();

      const write = (event: ProjectEvent): void => {
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write(`event: ${event.eventType}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Replay from Last-Event-ID (the project event sequence).
      const lastEventId = request.headers["last-event-id"];
      const since = lastEventId === undefined ? 0 : Number.parseInt(String(lastEventId), 10);
      if (!Number.isNaN(since) && since >= 0) {
        const rows = await deps.db
          .selectFrom("activity")
          .selectAll()
          .where("project_id", "=", projectId)
          .where("seq", ">", since)
          .orderBy("seq", "asc")
          .limit(1000)
          .execute();
        for (const row of rows) {
          write({
            sequence: row.seq,
            eventId: row.id,
            eventType: row.type,
            schemaVersion: 1,
            projectId: row.project_id,
            timestamp: row.occurred_at,
            actor: {
              userId: row.actor_user_id,
              displayName: row.actor_display_name,
              automationId: row.actor_automation_id ?? undefined,
            },
            resource:
              row.target_type !== null && row.target_id !== null
                ? { type: row.target_type, id: row.target_id }
                : null,
            data: JSON.parse(row.payload_json),
          });
        }
      }

      const unsubscribe = deps.bus.subscribe(projectId, write);
      const heartbeat = setInterval(() => {
        reply.raw.write(": keepalive\n\n");
      }, HEARTBEAT_MS);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}
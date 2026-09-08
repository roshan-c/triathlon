/**
 * Project-scoped Server-Sent Events.
 *
 * Subscribers must be members (or instance-wide keys). The route replays
 * committed activity from the database when Last-Event-ID is present and
 * streams live events with sequence deduplication. Clients safely ignore
 * unknown event types.
 */

import { Type } from "@sinclair/typebox";
import type { ProjectEvent, ProjectEventBus } from "../../domain/events.js";
import type { WorkService } from "../../domain/work.js";
import { domainError } from "../../errors.js";
import type { App } from "../app.js";

export interface EventsRouteDeps {
  bus: ProjectEventBus;
  work: WorkService;
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
      // Authorization and replay belong to Work; HTTP only adapts the stream.
      const lastEventId = request.headers["last-event-id"];
      const since = lastEventId === undefined ? 0 : Number.parseInt(String(lastEventId), 10);
      const replaySince = !Number.isNaN(since) && since >= 0 ? since : 0;

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.hijack();

      let highestSequence = replaySince;
      const write = (event: ProjectEvent): void => {
        // Subscription is established before replay. Events committed during
        // the replay are delivered live first and skipped from the replay
        // page by this sequence deduplication.
        if (event.sequence <= highestSequence) return;
        highestSequence = event.sequence;
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write(`event: ${event.eventType}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = deps.bus.subscribe(projectId, write);
      try {
        // Replay in pages until the service returns fewer than its bounded
        // page size. This avoids silently losing a long offline history.
        let cursor = replaySince;
        while (true) {
          const replay = await deps.work.replayEvents(ctx, projectId, cursor);
          for (const event of replay) write(event);
          if (replay.length < 1000) break;
          cursor = replay[replay.length - 1]?.sequence ?? cursor;
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }
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

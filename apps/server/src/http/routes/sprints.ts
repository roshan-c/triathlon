/**
 * Routes: sprints, membership, metrics, snapshots.
 */

import { Type } from "@sinclair/typebox";
import type { PlanningService } from "../../domain/planning.js";
import { requireAuth } from "../types.js";
import {
  MetricsSchema,
  SprintMemberSchema,
  SprintSchema,
} from "../schemas.js";
import type { App } from "../app.js";

export interface SprintsRoutesDeps {
  planning: PlanningService;
}

export function registerSprintsRoutes(
  app: App,
  deps: SprintsRoutesDeps,
): void {
  const { planning } = deps;

  app.post(
    "/api/v1/projects/:projectId/sprints",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({
          name: Type.String(),
          plannedStart: Type.Optional(Type.String()),
          plannedEnd: Type.Optional(Type.String()),
        }),
        response: { 200: SprintSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.createSprint(ctx, request.params.projectId, {
          name: request.body.name,
          plannedStart: request.body.plannedStart,
          plannedEnd: request.body.plannedEnd,
        }),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/sprints",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 200: Type.Array(SprintSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await planning.listSprints(ctx, request.params.projectId));
    },
  );

  app.get(
    "/api/v1/projects/:projectId/sprints/:sprintId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: {
          200: Type.Object({
            sprint: SprintSchema,
            members: Type.Array(SprintMemberSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.getSprintDetail(ctx, request.params.projectId, request.params.sprintId),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/sprints/:sprintId/activate",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: { 200: SprintSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.activateSprint(ctx, request.params.projectId, request.params.sprintId),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/sprints/:sprintId/complete",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: { 200: SprintSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.completeSprint(ctx, request.params.projectId, request.params.sprintId),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/sprints/:sprintId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await planning.deleteSprint(ctx, request.params.projectId, request.params.sprintId);
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/projects/:projectId/sprints/:sprintId/members",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        body: Type.Object({ ticketIds: Type.Array(Type.String()) }),
        response: {
          200: Type.Object({
            sprint: SprintSchema,
            members: Type.Array(SprintMemberSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.addTickets(ctx, request.params.projectId, request.params.sprintId, {
          ticketIds: request.body.ticketIds,
        }),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/sprints/:sprintId/members/:ticketId",
    {
      schema: {
        params: Type.Object({
          projectId: Type.String(),
          sprintId: Type.String(),
          ticketId: Type.String(),
        }),
        response: {
          200: Type.Object({
            sprint: SprintSchema,
            members: Type.Array(SprintMemberSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.removeTicket(
          ctx,
          request.params.projectId,
          request.params.sprintId,
          request.params.ticketId,
        ),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/sprints/:sprintId/metrics",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: { 200: MetricsSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.metrics(ctx, request.params.projectId, request.params.sprintId),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/sprints/:sprintId/snapshot",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), sprintId: Type.String() }),
        response: { 200: Type.Any() },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await planning.snapshot(ctx, request.params.projectId, request.params.sprintId),
      );
    },
  );
}
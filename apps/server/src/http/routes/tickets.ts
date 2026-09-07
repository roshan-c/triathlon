/**
 * Routes: tickets, comments, blockers, review, resolve/reopen, delete/restore.
 */

import { Type } from "@sinclair/typebox";
import type { ProjectsService } from "../../domain/projects.js";
import { domainError } from "../../errors.js";
import type { WorkService } from "../../domain/work.js";
import { requireAuth } from "../types.js";
import {
  CommentSchema,
  ReviewStateSchema,
  TicketDetailSchema,
  TicketSchema,
  TicketSummarySchema,
  paged,
} from "../schemas.js";
import type { App } from "../app.js";

export interface TicketsRoutesDeps {
  work: WorkService;
  projects: ProjectsService;
}

const priority = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export function registerTicketsRoutes(
  app: App,
  deps: TicketsRoutesDeps,
): void {
  const { work } = deps;

  app.post(
    "/api/v1/projects/:projectId/tickets",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({
          title: Type.String(),
          descriptionMd: Type.Optional(Type.String()),
          points: Type.Optional(Type.Integer({ minimum: 0 })),
          priority: Type.Optional(priority),
          labels: Type.Optional(Type.Array(Type.String())),
          assigneeId: Type.Optional(Type.String()),
          parentId: Type.Optional(Type.String()),
          blockerIds: Type.Optional(Type.Array(Type.String())),
          columnId: Type.Optional(Type.String()),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.createTicket(ctx, request.params.projectId, request.body),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/tickets",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        querystring: Type.Object({
          visibility: Type.Optional(
            Type.Union([
              Type.Literal("open"),
              Type.Literal("closed"),
              Type.Literal("deleted"),
            ]),
          ),
          columnId: Type.Optional(Type.String()),
          assigneeId: Type.Optional(Type.String()),
          label: Type.Optional(Type.String()),
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: { 200: paged(TicketSummarySchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const q = request.query;
      reply.send(
        await work.listTickets(ctx, request.params.projectId, {
          visibility: q.visibility,
          columnId: q.columnId,
          assigneeId: q.assigneeId,
          label: q.label,
          cursor: q.cursor,
          limit: q.limit,
        }),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/tickets/:ref",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        response: { 200: TicketDetailSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const detail = await work.getTicketDetail(ctx, request.params.projectId, request.params.ref);
      if (!detail) throw domainError("NOT_FOUND", "Ticket not found");
      reply.send(detail);
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/tickets/:ref",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({
          title: Type.Optional(Type.String()),
          descriptionMd: Type.Optional(Type.String()),
          points: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
          priority: Type.Optional(priority),
          labels: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          assigneeId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          expectedResourceVersion: Type.Integer(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const { expectedResourceVersion, ...changes } = request.body;
      reply.send(
        await work.updateTicket(
          ctx,
          request.params.projectId,
          request.params.ref,
          expectedResourceVersion,
          changes,
        ),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/move",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({
          columnId: Type.String(),
          position: Type.Integer({ minimum: 0 }),
          expectedResourceVersion: Type.Integer(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.moveTicket(ctx, request.params.projectId, request.params.ref, request.body.expectedResourceVersion, {
          columnId: request.body.columnId,
          position: request.body.position,
        }),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/comments",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({ body: Type.String() }),
        response: { 200: CommentSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.addComment(ctx, request.params.projectId, request.params.ref, request.body.body),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/blockers",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({ ticketIds: Type.Array(Type.String()) }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.addBlockers(ctx, request.params.projectId, request.params.ref, request.body.ticketIds),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/tickets/:ref/blockers/:blockerId",
    {
      schema: {
        params: Type.Object({
          projectId: Type.String(),
          ref: Type.String(),
          blockerId: Type.String(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.removeBlocker(ctx, request.params.projectId, request.params.ref, request.params.blockerId),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/review/request",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        response: { 200: ReviewStateSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await work.requestReview(ctx, request.params.projectId, request.params.ref));
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/review/decide",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({
          decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
          comment: Type.Optional(Type.String()),
        }),
        response: { 200: ReviewStateSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.decideReview(
          ctx,
          request.params.projectId,
          request.params.ref,
          request.body.decision,
          request.body.comment,
        ),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/resolve",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({
          comment: Type.String(),
          expectedResourceVersion: Type.Integer(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.resolveTicket(
          ctx,
          request.params.projectId,
          request.params.ref,
          request.body.expectedResourceVersion,
          request.body.comment,
        ),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/reopen",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        body: Type.Object({
          columnId: Type.String(),
          comment: Type.Optional(Type.String()),
          expectedResourceVersion: Type.Integer(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.reopenTicket(ctx, request.params.projectId, request.params.ref, request.body.expectedResourceVersion, {
          columnId: request.body.columnId,
          comment: request.body.comment,
        }),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/tickets/:ref",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        querystring: Type.Object({
          expectedResourceVersion: Type.Integer(),
        }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.deleteTicket(
          ctx,
          request.params.projectId,
          request.params.ref,
          request.query.expectedResourceVersion,
        ),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/tickets/:ref/restore",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        response: { 200: TicketSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await work.restoreTicket(ctx, request.params.projectId, request.params.ref));
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/tickets/:ref/purge",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), ref: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await work.purgeTicket(ctx, request.params.projectId, request.params.ref);
      reply.code(204).send();
    },
  );
}
/**
 * Routes: projects, columns, members, invitations, board, frontier, activity.
 */

import { Type } from "@sinclair/typebox";
import type { IdentityService } from "../../domain/identity.js";
import { domainError } from "../../errors.js";
import type { ProjectsService } from "../../domain/projects.js";
import type { WorkService } from "../../domain/work.js";
import { requireAuth } from "../types.js";
import type { App } from "../app.js";
import {
  ActivityEntrySchema,
  ColumnSchema,
  InvitationSchema,
  MemberSchema,
  ProjectAccessSchema,
  ProjectSchema,
  TicketSummarySchema,
  paged,
} from "../schemas.js";

export interface ProjectsRoutesDeps {
  identity: IdentityService;
  projects: ProjectsService;
  work: WorkService;
}

export function registerProjectsRoutes(
  app: App,
  deps: ProjectsRoutesDeps,
): void {
  const { identity, projects, work } = deps;

  // ---- projects ----
  app.post(
    "/api/v1/projects",
    {
      schema: {
        body: Type.Object({
          name: Type.String(),
          timezone: Type.Optional(Type.String()),
        }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await projects.createProject(ctx, {
          name: request.body.name,
          timezone: request.body.timezone,
        }),
      );
    },
  );

  app.get(
    "/api/v1/projects",
    {
      schema: {
        response: { 200: Type.Array(ProjectAccessSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const accessible = await projects.listProjects(ctx);
      reply.send(
        accessible.map((a) => ({
          project: a.project,
          role: a.role === "owner" ? ("owner" as const) : ("member" as const),
        })),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: {
          200: Type.Object({
            project: ProjectSchema,
            role: Type.Union([Type.Literal("owner"), Type.Literal("member")]),
            columns: Type.Array(ColumnSchema),
            members: Type.Array(MemberSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const projectId = request.params.projectId;
      const { project, role } = await projects.getProjectAccess(ctx, projectId);
      const columns = await projects.columnsFor(projectId);
      const members = await projects.listMembers(ctx, projectId);
      reply.send({ project, role: role === "owner" ? ("owner" as const) : ("member" as const), columns, members });
    },
  );

  app.patch(
    "/api/v1/projects/:projectId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          timezone: Type.Optional(Type.String()),
        }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const projectId = request.params.projectId;
      if (request.body.name !== undefined && request.body.timezone !== undefined) {
        throw domainError(
          "VALIDATION_FAILED",
          "Project name and timezone must be changed in separate atomic commands",
        );
      }
      if (request.body.name !== undefined) {
        await projects.renameProject(ctx, projectId, request.body.name);
      }
      if (request.body.timezone !== undefined) {
        await projects.setTimezone(ctx, projectId, request.body.timezone);
      }
      const updated = await projects.getProject(projectId);
      if (!updated) throw domainError("NOT_FOUND", "Project not found");
      reply.send(updated);
    },
  );

  app.post(
    "/api/v1/projects/:projectId/transfer",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({ toUserId: Type.String() }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await projects.transferOwnership(ctx, request.params.projectId, request.body.toUserId),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/recover-ownership",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({ toUserId: Type.String() }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await projects.recoverOwnership(ctx, request.params.projectId, request.body.toUserId),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await projects.deleteProject(ctx, request.params.projectId));
    },
  );

  app.post(
    "/api/v1/projects/:projectId/restore",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 200: ProjectSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await projects.restoreProject(ctx, request.params.projectId));
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/purge",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await projects.purgeProject(ctx, request.params.projectId);
      reply.code(204).send();
    },
  );

  // ---- members ----
  app.get(
    "/api/v1/projects/:projectId/members",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 200: Type.Array(MemberSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await projects.listMembers(ctx, request.params.projectId));
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/members/:userId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), userId: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await projects.removeMember(ctx, request.params.projectId, request.params.userId);
      reply.code(204).send();
    },
  );

  // ---- invitations ----
  app.post(
    "/api/v1/projects/:projectId/invitations",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({
          expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        response: {
          200: Type.Object({
            invitation: InvitationSchema,
            code: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await identity.createInvitation(
          ctx,
          request.params.projectId,
          request.body.expiresAt,
        ),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/invitations",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: { 200: Type.Array(InvitationSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.listInvitations(ctx, request.params.projectId));
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/invitations/:invitationId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), invitationId: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await identity.revokeInvitation(
        ctx,
        request.params.projectId,
        request.params.invitationId,
      );
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/invitations/redeem",
    {
      schema: {
        body: Type.Object({ code: Type.String() }),
        response: {
          200: Type.Object({
            projectId: Type.String(),
            member: MemberSchema,
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await projects.joinProject(ctx, request.body.code));
    },
  );

  // ---- columns ----
  app.post(
    "/api/v1/projects/:projectId/columns",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({
          name: Type.String(),
          category: Type.Optional(
            Type.Union([
              Type.Literal("not_started"),
              Type.Literal("started"),
              Type.Literal("done"),
            ]),
          ),
          beforeColumnId: Type.Optional(Type.String()),
        }),
        response: { 200: ColumnSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await projects.addColumn(ctx, request.params.projectId, {
          name: request.body.name,
          category: request.body.category,
          beforeColumnId: request.body.beforeColumnId,
        }),
      );
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/columns/:columnId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), columnId: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          category: Type.Optional(
            Type.Union([
              Type.Literal("not_started"),
              Type.Literal("started"),
              Type.Literal("done"),
            ]),
          ),
          confirm: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            column: ColumnSchema,
            affectedTickets: Type.Integer(),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const { projectId, columnId } = request.params;
      if (request.body.name !== undefined && request.body.category !== undefined) {
        throw domainError(
          "VALIDATION_FAILED",
          "Column name and category must be changed in separate atomic commands",
        );
      }
      if (request.body.name !== undefined) {
        await projects.renameColumn(ctx, projectId, columnId, request.body.name);
      }
      if (request.body.category !== undefined) {
        const result = await projects.recategorizeColumn(ctx, projectId, columnId, {
          category: request.body.category,
          confirm: request.body.confirm,
        });
        reply.send(result);
        return;
      }
      const column = (await projects.columnsFor(projectId)).find((c) => c.id === columnId);
      if (!column) throw domainError("NOT_FOUND", "Column not found");
      reply.send({ column, affectedTickets: 0 });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/columns/reorder",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        body: Type.Object({ columnIds: Type.Array(Type.String()) }),
        response: { 200: Type.Array(ColumnSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await projects.reorderColumns(ctx, request.params.projectId, request.body.columnIds),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/columns/:columnId",
    {
      schema: {
        params: Type.Object({ projectId: Type.String(), columnId: Type.String() }),
        querystring: Type.Object({
          destinationColumnId: Type.Optional(Type.String()),
        }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await projects.deleteColumn(
        ctx,
        request.params.projectId,
        request.params.columnId,
        request.query.destinationColumnId,
      );
      reply.code(204).send();
    },
  );

  // ---- board, frontier, activity ----
  app.get(
    "/api/v1/projects/:projectId/board",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        response: {
          200: Type.Array(
            Type.Object({
              column: ColumnSchema,
              tickets: Type.Array(TicketSummarySchema),
            }),
          ),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const projectId = request.params.projectId;
      const columns = await projects.columnsFor(projectId);
      const out = [];
      for (const column of columns) {
        const page = await work.listTickets(ctx, projectId, {
          visibility: column.category === "done" ? "closed" : "open",
          columnId: column.id,
          limit: 10_000,
        });
        if (page.nextCursor !== null) {
          throw domainError(
            "VALIDATION_FAILED",
            "Board snapshot exceeds the 10,000-ticket limit; use the paginated ticket endpoint",
          );
        }
        out.push({ column, tickets: page.items });
      }
      reply.send(out);
    },
  );

  app.get(
    "/api/v1/projects/:projectId/frontier",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        querystring: Type.Object({
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: { 200: paged(TicketSummarySchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.frontier(ctx, request.params.projectId, {
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/activity",
    {
      schema: {
        params: Type.Object({ projectId: Type.String() }),
        querystring: Type.Object({
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: { 200: paged(ActivityEntrySchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await work.activity(ctx, request.params.projectId, {
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
      );
    },
  );
}

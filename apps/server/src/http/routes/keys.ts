/**
 * Routes: capabilities, access keys, automations, audit log.
 */

import { Type } from "@sinclair/typebox";

import type { IdentityService } from "../../domain/identity.js";
import type { ProjectsService } from "../../domain/projects.js";
import {
  AccessKeySchema,
  AuditEntrySchema,
  AutomationSchema,
  CapabilitiesSchema,
  paged,
} from "../schemas.js";

export interface KeysRoutesDeps {
  serverVersion: string;
  identity: IdentityService;
  projects: ProjectsService;
}

import { domainError } from "../../errors.js";
import { requireAuth } from "../types.js";
import type { App } from "../app.js";
export function registerKeysRoutes(
  app: App,
  deps: KeysRoutesDeps,
): void {
  const { identity } = deps;

  app.get(
    "/api/v1/capabilities",
    {
      schema: {
        response: { 200: CapabilitiesSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const actor = ctx.actor;
      const user = await identity.getUser(ctx, actor.userId);
      if (!user) throw domainError("NOT_FOUND", "User not found");
      const accessible = await deps.projects.listProjects(ctx);
      const isInstanceKey = actor.keyScope === "instance";
      reply.send({
        serverVersion: deps.serverVersion,
        apiVersion: 1,
        actor: {
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          isInstanceAdmin: user.isInstanceAdmin,
          isInstanceOwner: user.isInstanceOwner,
        },
        credential: {
          kind: actor.automationId ? "automation" : actor.keyId ? "key" : "session",
          keyId: actor.keyId ?? null,
          automationId: actor.automationId ?? null,
          scope: actor.keyScope ?? "session",
          projectId: actor.keyProjectId ?? null,
        },
        client: { header: ctx.clientHeader ?? null },
        effectiveScope: isInstanceKey
          ? "instance"
          : actor.keyScope === "project"
            ? "project"
            : user.isInstanceAdmin || user.isInstanceOwner
              ? "instance"
              : "none",
        accessibleProjects: accessible.map((a) => ({
          id: a.project.id,
          name: a.project.name,
          role: a.role === "owner" ? ("owner" as const) : ("member" as const),
        })),
        features: [
          "sse",
          "idempotency",
          "reviews",
          "sprints",
          "metrics",
          "audit",
          "access-keys",
          "invitations",
          "automations",
          "frontier",
        ],
      });
    },
  );

  app.post(
    "/api/v1/access-keys",
    {
      schema: {
        body: Type.Object({
          name: Type.String(),
          ownerType: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("automation")])),
          automationId: Type.Optional(Type.String()),
          scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("instance")])),
          projectId: Type.Optional(Type.String()),
          expiresAt: Type.Optional(
            Type.Union([Type.String(), Type.Null()]),
          ),
        }),
        response: {
          200: Type.Object({
            key: AccessKeySchema,
            secret: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const body = request.body;
      reply.send(
        await identity.createKey(ctx, {
          name: body.name,
          ownerType: body.ownerType ?? "user",
          automationId: body.automationId,
          scope: body.scope ?? "project",
          projectId: body.projectId,
          expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt,
        }),
      );
    },
  );

  app.get(
    "/api/v1/access-keys",
    {
      schema: {
        response: { 200: Type.Array(AccessKeySchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.listKeys(ctx));
    },
  );

  app.delete(
    "/api/v1/access-keys/:keyId",
    {
      schema: {
        params: Type.Object({ keyId: Type.String() }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await identity.revokeKey(ctx, request.params.keyId);
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/automations",
    {
      schema: {
        body: Type.Object({ name: Type.String() }),
        response: { 200: AutomationSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.createAutomation(ctx, request.body.name));
    },
  );

  app.get(
    "/api/v1/automations",
    {
      schema: {
        response: { 200: Type.Array(AutomationSchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.listAutomations(ctx));
    },
  );

  app.post(
    "/api/v1/automations/:automationId/transfer",
    {
      schema: {
        params: Type.Object({ automationId: Type.String() }),
        body: Type.Object({ toUserId: Type.String() }),
        response: { 200: AutomationSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await identity.transferAutomation(
          ctx,
          request.params.automationId,
          request.body.toUserId,
        ),
      );
    },
  );

  app.get(
    "/api/v1/audit",
    {
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: { 200: paged(AuditEntrySchema) },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await identity.listAudit(ctx, {
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
      );
    },
  );
}
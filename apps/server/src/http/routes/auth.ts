/**
 * Routes: health, bootstrap, authentication, instance administration.
 */

import { Type } from "@sinclair/typebox";
import type { FastifyReply } from "fastify";

import type { Session, User } from "../../domain/identity.js";
import type { App } from "../app.js";
import type { Config } from "../../config.js";
import type { IdentityService } from "../../domain/identity.js";
import type { RequestContext } from "../../domain/context.js";
import { requireAuth } from "../types.js";
import { SessionSchema, UserSchema } from "../schemas.js";

export interface AuthRoutesDeps {
  config: Config;
  identity: IdentityService;
}

export function registerAuthRoutes(
  app: App,
  deps: AuthRoutesDeps,
): void {
  const { config, identity } = deps;
  const cookieName = config.session.cookieName;

  interface SessionResult {
    user: User;
    session: Session;
    token: string;
  }
  const sendSession = (reply: FastifyReply, result: SessionResult): void => {
    reply.setCookie(cookieName, result.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.session.secure,
      expires: new Date(result.session.expiresAt),
    });
    const { token: _token, ...body } = result;
    reply.send(body);
  };

  // ---- health (unauthenticated) ----
  app.get(
    "/api/v1/health/live",
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal("ok") }),
        },
      },
    },
    async (_request, reply) => {
      reply.send({ status: "ok" });
    },
  );

  app.get(
    "/api/v1/health/ready",
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal("ok"), migrations: Type.String() }),
        },
      },
    },
    async (_request, reply) => {
      reply.send({ status: "ok", migrations: "applied" });
    },
  );

  // ---- bootstrap ----
  app.get(
    "/api/v1/bootstrap",
    {
      schema: {
        response: {
          200: Type.Object({ open: Type.Boolean() }),
        },
      },
    },
    async (_request, reply) => {
      reply.send(await identity.bootstrapState());
    },
  );

  app.post(
    "/api/v1/bootstrap/code",
    {
      schema: {
        response: {
          200: Type.Object({ code: Type.String(), expiresAt: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const ctx: RequestContext = { actor: { userId: "bootstrap" }, requestId: request.id };
      reply.send(await identity.issueBootstrapCode(ctx));
    },
  );

  app.post(
    "/api/v1/bootstrap/redeem",
    {
      schema: {
        body: Type.Object({
          code: Type.String(),
          email: Type.String(),
          displayName: Type.String(),
          password: Type.String(),
        }),
        response: {
          200: Type.Object({ user: UserSchema, session: SessionSchema }),
        },
      },
    },
    async (request, reply) => {
      const { code, email, displayName, password } = request.body;
      const ctx: RequestContext = { actor: { userId: "bootstrap" }, requestId: request.id };
      const result = await identity.redeemBootstrap(ctx, { code, email, displayName, password });
      const loggedIn = await identity.login(
        { actor: { userId: result.id }, requestId: request.id },
        email,
        password,
      );
      sendSession(reply, loggedIn);
    },
  );

  // ---- auth ----
  app.post(
    "/api/v1/auth/login",
    {
      schema: {
        body: Type.Object({ email: Type.String(), password: Type.String() }),
        response: {
          200: Type.Object({ user: UserSchema, session: SessionSchema }),
        },
      },
    },
    async (request, reply) => {
      const ctx: RequestContext = { actor: { userId: "anonymous" }, requestId: request.id };
      const result = await identity.login(ctx, request.body.email, request.body.password);
      sendSession(reply, result);
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      const sessionId = request.auth?.sessionId;
      if (sessionId) {
        await identity.logout(ctx, sessionId);
      }
      reply.clearCookie(cookieName, { path: "/" });
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/auth/password",
    {
      schema: {
        body: Type.Object({
          currentPassword: Type.String(),
          newPassword: Type.String(),
        }),
        response: { 204: { type: "null" } as const },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      await identity.changePassword(ctx, request.body.currentPassword, request.body.newPassword);
      reply.clearCookie(cookieName, { path: "/" });
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/auth/password/reset-code",
    {
      schema: {
        body: Type.Object({ userId: Type.String() }),
        response: {
          200: Type.Object({ code: Type.String(), expiresAt: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.createResetCode(ctx, request.body.userId));
    },
  );

  app.post(
    "/api/v1/auth/password/reset",
    {
      schema: {
        body: Type.Object({ code: Type.String(), newPassword: Type.String() }),
        response: { 200: UserSchema },
      },
    },
    async (request, reply) => {
      const ctx: RequestContext = { actor: { userId: "anonymous" }, requestId: request.id };
      reply.send(
        await identity.redeemResetCode(ctx, request.body.code, request.body.newPassword),
      );
    },
  );

  // ---- instance administration ----
  app.get(
    "/api/v1/users",
    {
      schema: {
        response: {
          200: Type.Array(UserSchema),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.listUsers(ctx));
    },
  );

  app.post(
    "/api/v1/users/:userId/admin",
    {
      schema: {
        params: Type.Object({ userId: Type.String() }),
        body: Type.Object({ isAdmin: Type.Boolean() }),
        response: { 200: UserSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await identity.setInstanceAdmin(ctx, request.params.userId, request.body.isAdmin),
      );
    },
  );

  app.post(
    "/api/v1/users/:userId/suspend",
    {
      schema: {
        params: Type.Object({ userId: Type.String() }),
        body: Type.Object({ suspended: Type.Boolean() }),
        response: { 200: UserSchema },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(
        await identity.suspendUser(ctx, request.params.userId, request.body.suspended),
      );
    },
  );

  app.post(
    "/api/v1/instance/transfer",
    {
      schema: {
        body: Type.Object({ toUserId: Type.String() }),
        response: {
          200: Type.Object({ ownerUserId: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.transferInstanceOwnership(ctx, request.body.toUserId));
    },
  );

  app.get(
    "/api/v1/instance",
    {
      schema: {
        response: {
          200: Type.Object({
            ownerUserId: Type.Union([Type.String(), Type.Null()]),
            timezone: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      requireAuth(request);
      reply.send(await identity.getInstanceMeta());
    },
  );
}
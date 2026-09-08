/**
 * Routes: health, bootstrap, authentication, instance administration.
 */

import { Type } from "@sinclair/typebox";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthModule } from "../../auth.js";
import type { App } from "../app.js";
import type { Config } from "../../config.js";
import type { IdentityService } from "../../domain/identity.js";
import type { RequestContext } from "../../domain/context.js";
import { requireAuth } from "../types.js";
import { UserSchema } from "../schemas.js";

export interface AuthRoutesDeps {
  config: Config;
  identity: IdentityService;
  auth: AuthModule;
}

function requestForBetterAuth(request: FastifyRequest, baseURL: string): Request {
  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: fromNodeHeaders(request.headers),
  };
  if (method !== "GET" && method !== "HEAD" && request.body !== undefined) {
    init.body = JSON.stringify(request.body);
  }
  return new Request(new URL(request.url, baseURL), init);
}

interface BetterAuthErrorBody {
  message?: string;
  detail?: string;
  code?: string;
}

function forwardHeaders(response: Response, reply: FastifyReply): void {
  for (const [name, value] of response.headers) {
    if (name === "set-cookie" || name === "content-length" || name === "content-encoding") continue;
    reply.header(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header("set-cookie", cookies);
}

async function forwardBetterAuth(
  response: Response,
  reply: FastifyReply,
  requestId: string,
): Promise<void> {
  forwardHeaders(response, reply);
  if (response.ok) {
    reply.code(response.status).send(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const raw = await response.text();
  let body: BetterAuthErrorBody = {};
  try {
    // SAFETY: Better Auth's documented error response is a JSON object; the
    // fallback below handles adapters that return plain text.
    body = JSON.parse(raw) as typeof body;
  } catch {
    // Better Auth adapters occasionally return plain text; retain a stable
    // Problem envelope at the public Triathlon boundary.
  }
  const status = response.status;
  const code = status === 401
    ? "INVALID_CREDENTIALS"
    : status === 429
      ? "RATE_LIMITED"
      : status >= 400 && status < 500
        ? "VALIDATION_FAILED"
        : "INTERNAL";
  reply.code(status).send({
    error: {
      status,
      code,
      message: body.detail ?? body.message ?? (raw || "Authentication request failed"),
      requestId,
    },
  });
}

export function registerAuthRoutes(
  app: App,
  deps: AuthRoutesDeps,
): void {
  const { config, identity, auth } = deps;
  const baseURL = config.baseUrl ?? `http://localhost:${config.port}`;

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
          200: Type.Object({ user: UserSchema }),
        },
      },
    },
    async (request, reply) => {
      const { code, email, displayName, password } = request.body;
      const ctx: RequestContext = { actor: { userId: "bootstrap" }, requestId: request.id };
      const user = await identity.redeemBootstrap(ctx, { code, email, displayName, password });
      const signIn = await auth.signIn(email, password, fromNodeHeaders(request.headers));
      if (!signIn.ok) {
        await forwardBetterAuth(signIn, reply, request.id);
        return;
      }
      forwardHeaders(signIn, reply);
      reply.send({ user });
    },
  );

  app.post(
    "/api/v1/users/:userId/reset-code",
    {
      schema: {
        params: Type.Object({ userId: Type.String() }),
        response: {
          200: Type.Object({ code: Type.String(), expiresAt: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const ctx = requireAuth(request);
      reply.send(await identity.createResetCode(ctx, request.params.userId));
    },
  );

  app.post(
    "/api/auth/reset-with-code",
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

  app.post(
    "/api/auth/sign-up/email",
    {
      schema: {
        body: Type.Object({
          code: Type.String(),
          email: Type.String(),
          name: Type.String(),
          password: Type.String(),
        }),
        response: {
          200: Type.Object({ user: UserSchema, projectId: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { code, email, name, password } = request.body;
      const result = await identity.registerWithInvitation(
        { actor: { userId: "registration" }, requestId: request.id },
        { code, email, displayName: name, password },
      );
      const signIn = await auth.signIn(email, password, fromNodeHeaders(request.headers));
      if (!signIn.ok) {
        await forwardBetterAuth(signIn, reply, request.id);
        return;
      }
      forwardHeaders(signIn, reply);
      reply.send(result);
    },
  );

  // Own this exact Better Auth route so suspended domain users cannot create
  // fresh sessions and login attempts retain Triathlon Audit semantics.
  app.post(
    "/api/auth/sign-in/email",
    {
      schema: {
        body: Type.Object({
          email: Type.String(),
          password: Type.String(),
          rememberMe: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      await identity.authorizeSignIn(
        { actor: { userId: "anonymous" }, requestId: request.id },
        email,
        password,
      );
      await forwardBetterAuth(
        await auth.signIn(email, password, fromNodeHeaders(request.headers)),
        reply,
        request.id,
      );
    },
  );

  // Better Auth owns browser login, logout, password changes, and sessions.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const session = await auth.getSession(fromNodeHeaders(request.headers));
      const response = await auth.handle(requestForBetterAuth(request, baseURL));
      const authOperation = request.url.endsWith("/sign-out")
        ? "auth.logout"
        : request.url.endsWith("/change-password")
          ? "auth.password_change"
          : null;
      if (authOperation !== null) {
        await identity.recordAuthEvent(
          { actor: { userId: session?.userId ?? "anonymous", sessionFingerprint: session?.sessionId }, requestId: request.id },
          authOperation,
          response.ok ? "ok" : "error",
          response.ok ? undefined : "Better Auth rejected the request",
        );
      }
      await forwardBetterAuth(response, reply, request.id);
    },
  });

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

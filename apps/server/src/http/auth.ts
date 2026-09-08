/**
 * Authentication hook: resolves the actor from a bearer access key or a
 * session cookie, enforces CSRF for credentialed browser requests, and builds
 * the RequestContext (request id, untrusted client header, idempotency).
 */

import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { AuthModule } from "../auth.js";
import type { Actor, KeyScope } from "../domain/context.js";
import { inputHash } from "../domain/tx.js";
import type { IdentityService } from "../domain/identity.js";
import type { Config } from "../config.js";
import { domainError } from "../errors.js";
import type { AuthPrincipal } from "./types.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuthHookDeps {
  config: Config;
  identity: IdentityService;
  auth: AuthModule;
}

function clientHeaderValue(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const raw = Array.isArray(header) ? header.join(",") : header;
  const trimmed = raw.trim().slice(0, 100);
  return trimmed === "" ? undefined : trimmed;
}

function idempotencyFromRequest(
  request: FastifyRequest,
  actor: Actor,
): { key: string; fingerprint: string; inputHash: string } | undefined {
  const rawHeader = request.headers["idempotency-key"];
  if (rawHeader === undefined || rawHeader === "") return undefined;
  const raw = Array.isArray(rawHeader) ? rawHeader.join(",") : rawHeader;
  const key = raw.trim();
  if (key.length > 200) {
    throw domainError("VALIDATION_FAILED", "Idempotency-Key must be at most 200 characters");
  }
  const credential = actor.keyId ?? actor.sessionFingerprint ?? actor.userId;
  const fingerprint = createHash("sha256")
    .update(`${credential}|${request.method}|${request.routeOptions.url ?? request.url}`)
    .digest("hex");
  const normalized = JSON.stringify({
    params: request.params,
    query: request.query,
    body: request.body,
  });
  return { key, fingerprint, inputHash: inputHash(normalized) };
}

export function registerAuthHook(app: {
  addHook(hook: string, fn: (request: FastifyRequest, reply: FastifyReply) => Promise<void>): void;
}, deps: AuthHookDeps): void {
  const { config, identity, auth: authModule } = deps;
  const cookieName = config.session.cookieName;

  app.addHook("preHandler", async (request, reply) => {
    const url = request.url;
    const clientHeader = clientHeaderValue(request.headers["x-triathlon-client"]);
    const source = createHash("sha256")
      .update(request.ip || request.socket.remoteAddress || "unknown")
      .digest("hex");
    const enforceLimit = async (bucket: string, limit: number): Promise<void> => {
      if (!await identity.consumeRateLimit(`${bucket}:${source}`, limit, 60)) {
        await identity.recordAuthEvent(
          { actor: { userId: "unknown" }, requestId: request.id, clientHeader },
          `rate-limit.${bucket}`,
          "error",
          "rate limit exceeded",
        );
        throw domainError("RATE_LIMITED", "Too many requests; try again shortly");
      }
    };

    if (url.startsWith("/api/auth/sign-in/email")) await enforceLimit("sign-in", 10);
    if (url.startsWith("/api/auth/sign-up/email")) await enforceLimit("invitation", 5);
    if (url.startsWith("/api/auth/reset-with-code")) await enforceLimit("reset", 5);
    if (url.startsWith("/api/v1/bootstrap/redeem")) await enforceLimit("bootstrap", 5);

    if (
      url.startsWith("/api/v1/health") ||
      url.startsWith("/api/auth") ||
      url === "/api/v1/bootstrap" ||
      url.startsWith("/api/v1/bootstrap/") ||
      request.url === "/docs" ||
      request.url.startsWith("/docs/")
    ) {
      return;
    }

    // 1. Bearer access key.
    const authorization = request.headers.authorization;
    if (authorization !== undefined && authorization.startsWith("Bearer ")) {
      await enforceLimit("access-key", 60);
      const secret = authorization.slice("Bearer ".length).trim();
      const principal = await identity.authenticateKey(secret);
      if (!principal) {
        await identity.recordAuthEvent(
          { actor: { userId: "unknown", keyScope: undefined }, requestId: request.id, clientHeader },
          "auth.key",
          "error",
          "invalid or expired access key",
        );
        throw domainError("AUTH_REQUIRED", "Invalid, expired, or revoked access key");
      }
      const actor: Actor = {
        userId: principal.ownerUserId,
        automationId: principal.automationId ?? undefined,
        keyId: principal.id,
        // SAFETY: KeyPrincipal.scope is written only with these literals by authenticateKey.
        keyScope: principal.scope as KeyScope,
        keyProjectId: principal.projectId ?? undefined,
      };
      const auth: AuthPrincipal = { actor, clientHeader };
      request.auth = auth;
      const idem = idempotencyFromRequest(request, actor);
      request.ctx = {
        actor,
        requestId: request.id,
        clientHeader,
        idempotency: idem,
      };
      return;
    }

    // 2. Session cookie.
    const token = request.cookies[cookieName];
    if (token !== undefined && token !== "") {
      const session = await authModule.getSession(fromNodeHeaders(request.headers));
      if (!session) {
        reply.clearCookie(cookieName, { path: "/" });
        throw domainError("AUTH_REQUIRED", "Session is no longer valid");
      }
      const user = await identity.getUser(
        { actor: { userId: session.userId, keyScope: "session" }, requestId: request.id },
        session.userId,
      );
      if (!user) throw domainError("AUTH_REQUIRED", "Session user no longer exists");
      if (user.isSuspended) {
        await authModule.revokeSessions(user.id);
        reply.clearCookie(cookieName, { path: "/" });
        throw domainError("SUSPENDED", "This account is suspended");
      }
      const actor: Actor = {
        userId: user.id,
        keyScope: "session",
        sessionFingerprint: session.sessionId,
      };
      const auth: AuthPrincipal = { actor, sessionId: session.sessionId, clientHeader };
      request.auth = auth;

      // CSRF: mutating requests with a session credential must come from a
      // trusted origin. Non-browser clients use bearer keys instead.
      if (MUTATING_METHODS.has(request.method)) {
        const origin = request.headers.origin;
        if (origin === undefined || !config.trustedOrigins.includes(origin)) {
          throw domainError(
            "CSRF_REJECTED",
            `Origin ${origin ?? "(missing)"} is not in the trusted-origin allowlist`,
          );
        }
      }

      const idem = idempotencyFromRequest(request, actor);
      request.ctx = {
        actor,
        requestId: request.id,
        clientHeader,
        idempotency: idem,
      };
      return;
    }

    // 3. Unauthenticated; protected routes call requireAuth().
    request.auth = undefined;
  });
}

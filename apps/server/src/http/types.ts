/**
 * Fastify request augmentation: the resolved authentication principal and
 * request context attached by the auth hook.
 */

import type { Actor, IdempotencyContext, RequestContext } from "../domain/context.js";
import { domainError } from "../errors.js";

export interface AuthPrincipal {
  actor: Actor;
  /** Set when authenticated with a browser session. */
  sessionId?: string;
  /** Untrusted X-Triathlon-Client metadata; grants no authority. */
  clientHeader?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthPrincipal;
    ctx?: RequestContext;
    idempotency?: IdempotencyContext;
  }
}

export function requireAuth(request: {
  ctx?: RequestContext;
}): RequestContext {
  if (!request.ctx) {
    throw domainError(
      "AUTH_REQUIRED",
      "Authentication required — use a session cookie or a bearer access key",
    );
  }
  return request.ctx;
}
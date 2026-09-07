/**
 * Request context: who is acting, why, and retry metadata.
 *
 * Every domain command takes a RequestContext. The HTTP adapter builds it from
 * the authenticated session or access key; module tests build it directly.
 * Automation work is attributed to the owning person (actor.userId) while the
 * audit trail additionally records the Automation and key (actor.automationId,
 * actor.keyId, actor.keyScope).
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type KeyScope = "project" | "instance" | "session";

export interface Actor {
  /** The effective person; automation requests attribute to their owner. */
  userId: string;
  /** Set when the credentials belong to an Automation's access key. */
  automationId?: string;
  /** Set when authenticated with an access key. */
  keyId?: string;
  keyScope?: KeyScope;
  /** Project scope of the key, when project-scoped. */
  keyProjectId?: string;
  /** Stable session identifier, used to scope idempotency keys. */
  sessionFingerprint?: string;
}

export interface IdempotencyContext {
  /** Client-supplied Idempotency-Key value. */
  key: string;
  /** Credential + method + route; scopes the key. */
  fingerprint: string;
  /** SHA-256 of the normalized request input. */
  inputHash: string;
}

export interface RequestContext {
  actor: Actor;
  requestId: string;
  /** Untrusted X-Triathlon-Client header value. Grants no authority. */
  clientHeader?: string;
  idempotency?: IdempotencyContext;
}

export function actorContext(
  actor: Actor,
  requestId = "test",
): RequestContext {
  return { actor, requestId };
}

/** A command with no idempotency and a synthetic request id. */
export function testContext(actor: Actor): RequestContext {
  return { actor, requestId: "test-request" };
}
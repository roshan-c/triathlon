/**
 * Identity module.
 *
 * Owns: secure first-owner bootstrap, email/password users and browser
 * sessions, suspension, Instance Owner and Instance Admin status, project
 * invitations, user-owned and Automation-owned access keys, Automations,
 * authentication context, and the security Audit log.
 *
 * The public seam is IdentityService. Tests and the HTTP adapter call this
 * interface only. Cross-module atomic commands (member removal, project
 * deletion) use the narrow `identityMutations` helpers inside their own
 * transaction; do not call those from HTTP.
 */

import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { AuthModule } from "../auth.js";
import type { Database as DbSchema } from "../db/types.js";
import type { Db } from "../db/types.js";
import { domainError } from "../errors.js";
import type { Clock } from "../time.js";
import { addDays } from "../time.js";
import type { Ids } from "../ids.js";
import type { RequestContext } from "./context.js";
import { asDomainTransaction, runCommand, type DomainTransaction, unwrapDomainTransaction } from "./tx.js";
import type { ProjectMembershipMutations } from "./projects.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  displayName: string;
  isInstanceAdmin: boolean;
  isInstanceOwner: boolean;
  isSuspended: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionPrincipal {
  user: User;
  sessionId: string;
}

export type SessionCheck =
  | { ok: true; user: User; sessionId: string }
  | { ok: false; reason: "none" | "expired" | "revoked" | "suspended" };

export interface AccessKey {
  id: string;
  name: string;
  ownerType: "user" | "automation";
  ownerUserId: string;
  automationId: string | null;
  scope: "project" | "instance";
  projectId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface KeyPrincipal {
  id: string;
  name: string;
  ownerType: "user" | "automation";
  ownerUserId: string;
  automationId: string | null;
  scope: "project" | "instance";
  projectId: string | null;
}

export interface Automation {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
}

export interface Invitation {
  id: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ValidInvitation {
  invitationId: string;
  projectId: string;
}

export interface AuditEntry {
  id: string;
  requestId: string;
  occurredAt: string;
  actorUserId: string | null;
  actorAutomationId: string | null;
  actorKeyId: string | null;
  clientHeader: string | null;
  operation: string;
  targetType: string | null;
  targetId: string | null;
  result: "ok" | "error";
  detail: string | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateKeyInput {
  name: string;
  ownerType: "user" | "automation";
  automationId?: string;
  scope: "project" | "instance";
  projectId?: string;
  expiresAt?: string | null; // explicit date; null = non-expiring
}

/** Projects-owned seam injected into Identity: who may do what in a project. */
export interface ProjectsRoleSeam {
  roleFor(userId: string, projectId: string, trx?: DomainTransaction): Promise<"owner" | "member" | "none">;
}

export interface IdentityDeps {
  db: Db;
  auth: AuthModule;
  clock: Clock;
  ids: Ids;
  projects: ProjectsRoleSeam;
  membership: ProjectMembershipMutations;
  /** Default invitation lifetime in days. */
  invitationDefaultTtlDays: number;
  /** Maximum lifetime of instance-wide keys in days. */
  instanceKeyMaxTtlDays: number;
  /** Browser session lifetime in days. */
  sessionTtlDays: number;
  /** Bootstrap code lifetime in minutes. */
  bootstrapCodeTtlMinutes: number;
}

export interface IdentityService {
  // bootstrap
  bootstrapState(): Promise<{ open: boolean }>;
  issueBootstrapCode(ctx: RequestContext): Promise<{ code: string; expiresAt: string }>;
  redeemBootstrap(
    ctx: RequestContext,
    input: { code: string; email: string; displayName: string; password: string },
  ): Promise<User>;
  registerWithInvitation(
    ctx: RequestContext,
    input: { code: string; email: string; displayName: string; password: string },
  ): Promise<{ user: User; projectId: string }>;
  // instance
  getInstanceMeta(): Promise<{ ownerUserId: string | null; timezone: string }>;
  listUsers(ctx: RequestContext): Promise<User[]>;
  getUser(ctx: RequestContext, userId: string): Promise<User | null>;
  setInstanceAdmin(ctx: RequestContext, userId: string, isAdmin: boolean): Promise<User>;
  transferInstanceOwnership(ctx: RequestContext, toUserId: string): Promise<{ ownerUserId: string }>;
  suspendUser(ctx: RequestContext, userId: string, suspended: boolean): Promise<User>;
  // auth
  /** The session token is shown once and goes into the browser cookie. */
  login(
    ctx: RequestContext,
    email: string,
    password: string,
  ): Promise<{ user: User; session: Session; token: string }>;
  /** Validate credentials and suspension before the Better Auth HTTP adapter creates a session. */
  authorizeSignIn(ctx: RequestContext, email: string, password: string): Promise<User>;
  logout(ctx: RequestContext, sessionId: string): Promise<void>;
  changePassword(ctx: RequestContext, currentPassword: string, newPassword: string): Promise<void>;
  createResetCode(ctx: RequestContext, userId: string): Promise<{ code: string; expiresAt: string }>;
  redeemResetCode(ctx: RequestContext, code: string, newPassword: string): Promise<User>;
  checkSession(token: string): Promise<SessionCheck>;
  revokeSession(ctx: RequestContext, sessionId: string): Promise<void>;
  // automations
  createAutomation(ctx: RequestContext, name: string): Promise<Automation>;
  transferAutomation(ctx: RequestContext, automationId: string, toUserId: string): Promise<Automation>;
  listAutomations(ctx: RequestContext): Promise<Automation[]>;
  // keys
  createKey(ctx: RequestContext, input: CreateKeyInput): Promise<{ key: AccessKey; secret: string }>;
  listKeys(ctx: RequestContext): Promise<AccessKey[]>;
  revokeKey(ctx: RequestContext, keyId: string): Promise<void>;
  authenticateKey(secret: string): Promise<KeyPrincipal | null>;
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  // invitations
  createInvitation(
    ctx: RequestContext,
    projectId: string,
    expiresAt: string | null | undefined,
  ): Promise<{ invitation: Invitation; code: string }>;
  listInvitations(ctx: RequestContext, projectId: string): Promise<Invitation[]>;
  revokeInvitation(ctx: RequestContext, projectId: string, invitationId: string): Promise<void>;
  validateInvitation(code: string): Promise<ValidInvitation | null>;
  // audit
  listAudit(ctx: RequestContext, opts: { cursor?: string; limit?: number }): Promise<Paged<AuditEntry>>;
  /** Record an auth-related event outside a domain command (failed logins, bad keys). */
  recordAuthEvent(
    ctx: RequestContext,
    operation: string,
    result: "ok" | "error",
    detail?: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Secret digests
// ---------------------------------------------------------------------------

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Manual-entry code alphabet: 12 chars over an unambiguous alphabet. */
export const CODE_PATTERN = /^[A-Z2-9]{12}$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Cross-module mutation helpers (internal seam, trx-scoped)
// ---------------------------------------------------------------------------

export const identityMutations = {
  /** Disable every non-revoked project-scoped key owned by a user. */
  revokeProjectKeys: (
    trx: DomainTransaction,
    projectId: string,
    userId: string,
    now: string,
  ): Promise<number> =>
    unwrapDomainTransaction(trx)
      .updateTable("access_keys")
      .set({ revoked_at: now })
      .where("project_id", "=", projectId)
      .where("owner_user_id", "=", userId)
      .where("revoked_at", "is", null)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.numUpdatedRows)),
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createIdentityService(deps: IdentityDeps): IdentityService {
  const { db, clock, ids } = deps;
  const nowIso = (): string => clock.now().toISOString();

  async function toUser(
    row: {
      id: string;
      email: string;
      display_name: string;
      is_instance_admin: number;
      is_suspended: number;
      created_at: string;
    },
    ownerUserId: string | null,
  ): Promise<User> {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      isInstanceAdmin: row.is_instance_admin === 1,
      isInstanceOwner: row.id === ownerUserId,
      isSuspended: row.is_suspended === 1,
      createdAt: row.created_at,
    };
  }

  async function getMeta(trx?: Kysely<DbSchema>): Promise<{
    ownerUserId: string | null;
    timezone: string;
    bootstrapClosedAt: string | null;
  }> {
    const meta = await (trx ?? db)
      .selectFrom("instance_meta")
      .selectAll()
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    return {
      ownerUserId: meta.owner_user_id,
      timezone: meta.timezone,
      bootstrapClosedAt: meta.bootstrap_closed_at,
    };
  }

  async function requireUserRow(userId: string, trx?: Kysely<DbSchema>): Promise<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    is_instance_admin: number;
    is_suspended: number;
    created_at: string;
  }> {
    const row = await (trx ?? db)
      .selectFrom("users")
      .selectAll()
      .where("id", "=", userId)
      .executeTakeFirst();
    if (!row) throw domainError("NOT_FOUND", "User not found");
    return row;
  }

  async function requireInstanceAdmin(ctx: RequestContext, trx?: Kysely<DbSchema>): Promise<void> {
    if (ctx.actor.keyScope !== undefined && ctx.actor.keyScope !== "session") {
      throw domainError("FORBIDDEN", "Instance administration requires a browser session");
    }
    const row = await requireUserRow(ctx.actor.userId, trx);
    if (row.is_instance_admin !== 1) {
      throw domainError("FORBIDDEN", "Instance Admin required");
    }
  }

  async function requireInstanceOwner(ctx: RequestContext, trx?: Kysely<DbSchema>): Promise<void> {
    if (ctx.actor.keyScope !== undefined && ctx.actor.keyScope !== "session") {
      throw domainError("FORBIDDEN", "Instance administration requires a browser session");
    }
    const meta = await getMeta(trx);
    if (meta.ownerUserId !== ctx.actor.userId) {
      throw domainError("FORBIDDEN", "Instance Owner required");
    }
  }

  function validatePassword(password: string): void {
    if (password.length < 8 || password.length > 200) {
      throw domainError(
        "VALIDATION_FAILED",
        "Password must be between 8 and 200 characters",
      );
    }
  }

  function validateEmail(email: string): string {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw domainError("VALIDATION_FAILED", "Invalid email address");
    }
    return normalized;
  }

  function validateDisplayName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw domainError(
        "VALIDATION_FAILED",
        "Display name must be between 1 and 100 characters",
      );
    }
    return trimmed;
  }

  function validateKeyName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw domainError(
        "VALIDATION_FAILED",
        "Key name must be between 1 and 100 characters",
      );
    }
    return trimmed;
  }

  function validateCode(code: string): string {
    const trimmed = code.trim();
    if (!CODE_PATTERN.test(trimmed)) {
      throw domainError("INVALID_CODE", "Invalid code");
    }
    return trimmed;
  }

  const service: IdentityService = {
    // ---- bootstrap ----
    bootstrapState: async () => {
      const meta = await getMeta();
      return { open: meta.ownerUserId === null };
    },

    issueBootstrapCode: (ctx) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "bootstrap.code_issue",
          targetType: "instance",
          targetId: "instance",
        },
        run: async (trx) => {
          const meta = await trx
            .selectFrom("instance_meta")
            .select("owner_user_id")
            .where("id", "=", 1)
            .executeTakeFirstOrThrow();
          if (meta.owner_user_id !== null) {
            throw domainError("BOOTSTRAP_CLOSED", "Bootstrap is already closed");
          }
          const code = ids.code();
          const expiresAt = addDays(
            clock.now(),
            deps.bootstrapCodeTtlMinutes / (24 * 60),
          ).toISOString();
          await trx
            .insertInto("bootstrap_codes")
            .values({
              id: ids.uuidv7(),
              code_hash: hashSecret(code),
              created_at: nowIso(),
              expires_at: expiresAt,
              used_at: null,
            })
            .execute();
          return { code, expiresAt };
        },
      }),

    redeemBootstrap: (ctx, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "bootstrap.redeem",
          targetType: "instance",
          targetId: "instance",
        },
        run: async (trx) => {
          const meta = await trx
            .selectFrom("instance_meta")
            .selectAll()
            .where("id", "=", 1)
            .executeTakeFirstOrThrow();
          if (meta.owner_user_id !== null) {
            throw domainError("BOOTSTRAP_CLOSED", "Bootstrap is already closed");
          }
          const code = validateCode(input.code);
          const email = validateEmail(input.email);
          validatePassword(input.password);
          const displayName = validateDisplayName(input.displayName);

          const existing = await trx
            .selectFrom("users")
            .select("id")
            .where("email", "=", email)
            .executeTakeFirst();
          if (existing) throw domainError("EMAIL_EXISTS", "Email already registered");

          const codeRow = await trx
            .selectFrom("bootstrap_codes")
            .selectAll()
            .where("code_hash", "=", hashSecret(code))
            .executeTakeFirst();
          if (!codeRow) throw domainError("INVALID_CODE", "Unknown bootstrap code");
          if (codeRow.used_at !== null) {
            throw domainError("INVALID_CODE", "Bootstrap code was already used");
          }
          if (codeRow.expires_at < clock.now().toISOString()) {
            throw domainError("CODE_EXPIRED", "Bootstrap code has expired");
          }

          const userId = ids.uuidv7();
          const createdAt = nowIso();
          await deps.auth.createCredentialUser({
            id: userId,
            email,
            name: displayName,
            password: input.password,
          });
          await trx
            .insertInto("users")
            .values({
              id: userId,
              email,
              display_name: displayName,
              // Credentials are owned exclusively by Better Auth.
              password_hash: "",
              is_instance_admin: 1,
              is_suspended: 0,
              created_at: createdAt,
            })
            .execute();
          await trx
            .updateTable("instance_meta")
            .set({ owner_user_id: userId, bootstrap_closed_at: createdAt })
            .where("id", "=", 1)
            .execute();
          await trx
            .updateTable("bootstrap_codes")
            .set({ used_at: createdAt })
            .where("id", "=", codeRow.id)
            .execute();
          const user = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirstOrThrow();
          return toUser(user, userId);
        },
      }),

    registerWithInvitation: async (ctx, input) => {
      const userId = ids.uuidv7();
      const registrationCtx: RequestContext = {
        ...ctx,
        actor: { userId, keyScope: "session" },
      };
      return runCommand({
        db,
        ctx: registrationCtx,
        clock,
        ids,
        spec: {
          operation: "invitation.register",
          activityType: "membership.added",
          targetType: "user",
          targetId: userId,
        },
        run: async (trx, spec) => {
          const code = validateCode(input.code);
          const email = validateEmail(input.email);
          validatePassword(input.password);
          const displayName = validateDisplayName(input.displayName);
          const invitation = await trx
            .selectFrom("invitations")
            .selectAll()
            .where("code_hash", "=", hashSecret(code))
            .executeTakeFirst();
          if (
            !invitation ||
            invitation.revoked_at !== null ||
            (invitation.expires_at !== null && invitation.expires_at < nowIso())
          ) {
            throw domainError("INVALID_CODE", "Unknown, expired, or revoked invitation");
          }
          const project = await trx
            .selectFrom("projects")
            .select(["id", "deleted_at"])
            .where("id", "=", invitation.project_id)
            .executeTakeFirst();
          if (!project || project.deleted_at !== null) {
            throw domainError("INVALID_CODE", "Unknown, expired, or revoked invitation");
          }
          const existing = await trx
            .selectFrom("users")
            .select("id")
            .where("email", "=", email)
            .executeTakeFirst();
          if (existing) throw domainError("EMAIL_EXISTS", "Email already registered");

          const createdAt = nowIso();
          await deps.auth.createCredentialUser({
            id: userId,
            email,
            name: displayName,
            password: input.password,
          });
          await trx
            .insertInto("users")
            .values({
              id: userId,
              email,
              display_name: displayName,
              password_hash: "",
              is_instance_admin: 0,
              is_suspended: 0,
              created_at: createdAt,
            })
            .execute();
          await deps.membership.addInvitedMember(
            asDomainTransaction(trx),
            invitation.project_id,
            userId,
            invitation.created_by,
            createdAt,
          );
          spec.projectId = invitation.project_id;
          spec.activityPayload = {
            projectId: invitation.project_id,
            userId,
            before: null,
            after: { role: "member" },
          };
          const meta = await getMeta(trx);
          const user = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirstOrThrow();
          return { user: await toUser(user, meta.ownerUserId), projectId: invitation.project_id };
        },
      });
    },

    // ---- instance ----
    getInstanceMeta: async () => {
      const meta = await getMeta();
      return { ownerUserId: meta.ownerUserId, timezone: meta.timezone };
    },

    listUsers: async (ctx) => {
      await requireInstanceAdmin(ctx);
      const meta = await getMeta();
      const rows = await db.selectFrom("users").selectAll().orderBy("email").execute();
      return Promise.all(rows.map((r) => toUser(r, meta.ownerUserId)));
    },

    getUser: async (ctx, userId) => {
      const meta = await getMeta();
      const row = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", userId)
        .executeTakeFirst();
      return row ? toUser(row, meta.ownerUserId) : null;
    },

    setInstanceAdmin: (ctx, userId, isAdmin) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: isAdmin ? "instance.admin_appoint" : "instance.admin_revoke",
          targetType: "user",
          targetId: userId,
        },
        run: async (trx) => {
          await requireInstanceOwner(ctx, trx);
          const meta = await getMeta(trx);
          if (userId === meta.ownerUserId) {
            throw domainError(
              "INVALID_STATE",
              "The Instance Owner cannot be demoted",
            );
          }
          const row = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "User not found");
          await trx
            .updateTable("users")
            .set({ is_instance_admin: isAdmin ? 1 : 0 })
            .where("id", "=", userId)
            .execute();
          const updated = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirstOrThrow();
          return toUser(updated, meta.ownerUserId);
        },
      }),

    transferInstanceOwnership: (ctx, toUserId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "instance.ownership_transfer",
          targetType: "user",
          targetId: toUserId,
        },
        run: async (trx) => {
          await requireInstanceOwner(ctx, trx);
          const _meta = await getMeta(trx);
          if (toUserId === ctx.actor.userId) {
            throw domainError("INVALID_STATE", "Ownership already held by this user");
          }
          const target = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", toUserId)
            .executeTakeFirst();
          if (!target) throw domainError("NOT_FOUND", "User not found");
          if (target.is_instance_admin !== 1) {
            throw domainError(
              "INVALID_STATE",
              "Instance ownership may transfer only to an existing Instance Admin",
            );
          }
          // The previous owner remains an admin; audit visibility moves to the
          // new owner because it is derived from `owner_user_id`.
          await trx
            .updateTable("instance_meta")
            .set({ owner_user_id: toUserId })
            .where("id", "=", 1)
            .execute();
          return { ownerUserId: toUserId };
        },
      }),

    suspendUser: (ctx, userId, suspended) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: suspended ? "user.suspend" : "user.unsuspend",
          targetType: "user",
          targetId: userId,
        },
        run: async (trx) => {
          await requireInstanceAdmin(ctx, trx);
          const meta = await getMeta(trx);
          if (userId === meta.ownerUserId) {
            throw domainError(
              "INVALID_STATE",
              "The Instance Owner cannot be suspended",
            );
          }
          const row = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "User not found");
          await trx
            .updateTable("users")
            .set({ is_suspended: suspended ? 1 : 0 })
            .where("id", "=", userId)
            .execute();
          if (suspended) {
            await deps.auth.revokeSessions(userId);
          }
          const updated = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirstOrThrow();
          return toUser(updated, meta.ownerUserId);
        },
      }),

    // ---- auth ----
    authorizeSignIn: (ctx, email, password) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.login" },
        run: async (trx) => {
          const normalized = normalizeEmail(email);
          const row = await trx
            .selectFrom("users")
            .selectAll()
            .where("email", "=", normalized)
            .executeTakeFirst();
          const valid = row ? await deps.auth.verifyPassword(row.id, password) : false;
          if (!row || !valid) {
            throw domainError("INVALID_CREDENTIALS", "Invalid email or password");
          }
          if (row.is_suspended === 1) {
            await deps.auth.revokeSessions(row.id);
            throw domainError("SUSPENDED", "This account is suspended");
          }
          const meta = await getMeta(trx);
          return toUser(row, meta.ownerUserId);
        },
      }),

    login: (ctx, email, password) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.login" },
        run: async (trx) => {
          const normalized = normalizeEmail(email);
          const row = await trx
            .selectFrom("users")
            .selectAll()
            .where("email", "=", normalized)
            .executeTakeFirst();
          if (!row) {
            throw domainError("INVALID_CREDENTIALS", "Invalid email or password");
          }
          if (row.is_suspended === 1) {
            throw domainError("SUSPENDED", "This account is suspended");
          }
          let credentialSession;
          try {
            credentialSession = await deps.auth.signInCredentials(normalized, password);
          } catch {
            throw domainError("INVALID_CREDENTIALS", "Invalid email or password");
          }
          const meta = await getMeta(trx);
          const user = await toUser(row, meta.ownerUserId);
          return {
            user,
            session: {
              id: credentialSession.sessionId,
              userId: row.id,
              createdAt: credentialSession.createdAt,
              expiresAt: credentialSession.expiresAt,
            },
            token: credentialSession.token,
          };
        },
      }),

    logout: (ctx, sessionId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.logout" },
        run: async () => {
          await deps.auth.revokeSession(ctx.actor.userId, sessionId);
        },
      }),

    changePassword: (ctx, currentPassword, newPassword) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.password_change" },
        run: async () => {
          if (!(await deps.auth.verifyPassword(ctx.actor.userId, currentPassword))) {
            throw domainError("INVALID_CREDENTIALS", "Current password is incorrect");
          }
          validatePassword(newPassword);
          await deps.auth.updatePassword(ctx.actor.userId, newPassword);
        },
      }),

    createResetCode: (ctx, userId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "auth.reset_code_issue",
          targetType: "user",
          targetId: userId,
        },
        run: async (trx) => {
          await requireInstanceAdmin(ctx, trx);
          const row = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", userId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "User not found");
          const code = ids.code();
          const expiresAt = addDays(
            clock.now(),
            30 / (24 * 60),
          ).toISOString();
          await trx
            .insertInto("reset_codes")
            .values({
              id: ids.uuidv7(),
              code_hash: hashSecret(code),
              user_id: userId,
              created_at: nowIso(),
              expires_at: expiresAt,
              used_at: null,
            })
            .execute();
          return { code, expiresAt };
        },
      }),

    redeemResetCode: (ctx, code, newPassword) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.reset_code_redeem" },
        run: async (trx) => {
          const trimmed = validateCode(code);
          validatePassword(newPassword);
          const row = await trx
            .selectFrom("reset_codes")
            .selectAll()
            .where("code_hash", "=", hashSecret(trimmed))
            .executeTakeFirst();
          if (!row) throw domainError("INVALID_CODE", "Unknown reset code");
          if (row.used_at !== null) {
            throw domainError("INVALID_CODE", "Reset code was already used");
          }
          if (row.expires_at < clock.now().toISOString()) {
            throw domainError("CODE_EXPIRED", "Reset code has expired");
          }
          const userRow = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", row.user_id)
            .executeTakeFirstOrThrow();
          await deps.auth.updatePassword(userRow.id, newPassword);
          await trx
            .updateTable("reset_codes")
            .set({ used_at: nowIso() })
            .where("id", "=", row.id)
            .execute();
          const meta = await getMeta(trx);
          return toUser(userRow, meta.ownerUserId);
        },
      }),

    checkSession: async (token) => {
      const session = await deps.auth.findSession(token);
      if (!session) return { ok: false, reason: "none" };
      if (session.expiresAt < clock.now().toISOString()) {
        return { ok: false, reason: "expired" };
      }
      const meta = await getMeta();
      const userRow = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", session.userId)
        .executeTakeFirst();
      if (!userRow) return { ok: false, reason: "none" };
      if (userRow.is_suspended === 1) return { ok: false, reason: "suspended" };
      return {
        ok: true,
        user: await toUser(userRow, meta.ownerUserId),
        sessionId: session.sessionId,
      };
    },

    revokeSession: (ctx, sessionId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "auth.session_revoke" },
        run: async () => {
          await deps.auth.revokeSession(ctx.actor.userId, sessionId);
        },
      }),

    // ---- automations ----
    createAutomation: (ctx, name) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: { operation: "automation.create" },
        run: async (trx) => {
          const trimmed = name.trim();
          if (trimmed.length === 0 || trimmed.length > 100) {
            throw domainError(
              "VALIDATION_FAILED",
              "Automation name must be between 1 and 100 characters",
            );
          }
          const automationId = ids.uuidv7();
          await trx
            .insertInto("automations")
            .values({
              id: automationId,
              owner_user_id: ctx.actor.userId,
              name: trimmed,
              created_at: nowIso(),
            })
            .execute();
          return {
            id: automationId,
            ownerUserId: ctx.actor.userId,
            name: trimmed,
            createdAt: nowIso(),
          };
        },
      }),

    transferAutomation: (ctx, automationId, toUserId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "automation.transfer",
          targetType: "automation",
          targetId: automationId,
        },
        run: async (trx) => {
          const row = await trx
            .selectFrom("automations")
            .selectAll()
            .where("id", "=", automationId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "Automation not found");
          const _meta = await getMeta(trx);
          const isOwner = row.owner_user_id === ctx.actor.userId;
          const isAdmin = (await requireUserRow(ctx.actor.userId, trx)).is_instance_admin === 1;
          if (!isOwner && !isAdmin) {
            throw domainError("FORBIDDEN", "Only the owner or an Instance Admin may transfer an Automation");
          }
          const target = await trx
            .selectFrom("users")
            .select("id")
            .where("id", "=", toUserId)
            .executeTakeFirst();
          if (!target) throw domainError("NOT_FOUND", "User not found");
          await trx
            .updateTable("automations")
            .set({ owner_user_id: toUserId })
            .where("id", "=", automationId)
            .execute();
          return {
            id: row.id,
            ownerUserId: toUserId,
            name: row.name,
            createdAt: row.created_at,
          };
        },
      }),

    listAutomations: async (ctx) => {
      const rows = await db
        .selectFrom("automations")
        .selectAll()
        .where("owner_user_id", "=", ctx.actor.userId)
        .orderBy("created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        ownerUserId: r.owner_user_id,
        name: r.name,
        createdAt: r.created_at,
      }));
    },

    // ---- keys ----
    createKey: (ctx, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "access_key.create",
          targetType: "access_key",
        },
        run: async (trx) => {
          const name = validateKeyName(input.name);
          if (input.scope === "instance") {
            // Access keys never grant administration; the Instance Admin
            // capability must come from a browser session.
            if (ctx.actor.keyScope !== "session") {
              throw domainError(
                "FORBIDDEN",
                "Instance-wide keys require a session-authenticated Instance Admin",
              );
            }
            const me = await trx
              .selectFrom("users")
              .select("is_instance_admin")
              .where("id", "=", ctx.actor.userId)
              .executeTakeFirstOrThrow();
            if (me.is_instance_admin !== 1) {
              throw domainError("FORBIDDEN", "Instance-wide keys require an Instance Admin");
            }
            if (!input.expiresAt) {
              throw domainError(
                "VALIDATION_FAILED",
                "Instance-wide keys must expire",
              );
            }
            const maxDays = deps.instanceKeyMaxTtlDays;
            const maxExpiry = addDays(clock.now(), maxDays).toISOString();
            if (input.expiresAt > maxExpiry) {
              throw domainError(
                "VALIDATION_FAILED",
                `Instance-wide keys may not live longer than ${maxDays} days`,
              );
            }
          } else {
            if (!input.projectId) {
              throw domainError(
                "VALIDATION_FAILED",
                "Project-scoped keys require a project",
              );
            }
            const project = await trx
              .selectFrom("projects")
              .select("id")
              .where("id", "=", input.projectId)
              .where("deleted_at", "is", null)
              .executeTakeFirst();
            if (!project) throw domainError("NOT_FOUND", "Project not found");
            const ownerUserId = input.ownerType === "automation"
              ? await trx
                  .selectFrom("automations")
                  .select("owner_user_id")
                  .where("id", "=", input.automationId ?? "")
                  .executeTakeFirst()
                  .then((r) => r?.owner_user_id)
              : ctx.actor.userId;
            if (!ownerUserId) throw domainError("NOT_FOUND", "Automation not found");
            if (input.ownerType === "automation" && ownerUserId !== ctx.actor.userId) {
              throw domainError("FORBIDDEN", "An Automation key may only be created by its owner");
            }
            const role = await deps.projects.roleFor(ownerUserId, input.projectId, asDomainTransaction(trx));
            if (role === "none") {
              throw domainError("FORBIDDEN", "Project membership required");
            }
          }

          const secret = "tka_" + ids.token();
          const keyId = ids.uuidv7();
          await trx
            .insertInto("access_keys")
            .values({
              id: keyId,
              name,
              owner_type: input.ownerType,
              owner_user_id: ctx.actor.userId,
              automation_id:
                input.ownerType === "automation" ? input.automationId ?? null : null,
              scope: input.scope,
              project_id: input.scope === "project" ? (input.projectId ?? null) : null,
              secret_hash: hashSecret(secret),
              expires_at: input.expiresAt ?? null,
              revoked_at: null,
              created_at: nowIso(),
              last_used_at: null,
            })
            .execute();
          return {
            key: {
              id: keyId,
              name,
              ownerType: input.ownerType,
              ownerUserId: ctx.actor.userId,
              automationId:
                input.ownerType === "automation" ? (input.automationId ?? null) : null,
              scope: input.scope,
              projectId: input.scope === "project" ? (input.projectId ?? null) : null,
              expiresAt: input.expiresAt ?? null,
              revokedAt: null,
              createdAt: nowIso(),
            },
            secret,
          };
        },
      }),

    listKeys: async (ctx) => {
      const meta = await getMeta();
      const isInstanceAdmin = (await requireUserRow(ctx.actor.userId)).is_instance_admin === 1;
      const canListAll = meta.ownerUserId === ctx.actor.userId || isInstanceAdmin;
      const rows = await db
        .selectFrom("access_keys")
        .selectAll()
        .orderBy("created_at")
        .execute();
      const visible = rows.filter(
        (r) => canListAll || r.owner_user_id === ctx.actor.userId,
      );
      return visible.map((r) => ({
          id: r.id,
          name: r.name,
          // SAFETY: the column is written with these exact literals only (identity.createKey).
          // SAFETY: the column is written with these exact literals only (identity.createKey).
          ownerType: r.owner_type as "user" | "automation",
          ownerUserId: r.owner_user_id,
          automationId: r.automation_id,
          // SAFETY: the column is written with these exact literals only (identity.createKey).
          scope: r.scope as "project" | "instance",
          projectId: r.project_id,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
          createdAt: r.created_at,
        }));
    },

    revokeKey: (ctx, keyId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "access_key.revoke",
          targetType: "access_key",
          targetId: keyId,
        },
        run: async (trx) => {
          const row = await trx
            .selectFrom("access_keys")
            .selectAll()
            .where("id", "=", keyId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "Access key not found");
          if (row.owner_user_id !== ctx.actor.userId) {
            throw domainError("FORBIDDEN", "Only the key owner may revoke it");
          }
          await trx
            .updateTable("access_keys")
            .set({ revoked_at: nowIso() })
            .where("id", "=", keyId)
            .execute();
        },
      }),

    authenticateKey: async (secret) => {
      if (!secret.startsWith("tka_")) return null;
      const row = await db
        .selectFrom("access_keys")
        .selectAll()
        .where("secret_hash", "=", hashSecret(secret))
        .executeTakeFirst();
      if (!row) return null;
      if (row.revoked_at !== null) return null;
      if (row.expires_at !== null && row.expires_at < clock.now().toISOString()) {
        return null;
      }
      const owner = await db
        .selectFrom("users")
        .select("is_suspended")
        .where("id", "=", row.owner_user_id)
        .executeTakeFirst();
      if (!owner || owner.is_suspended === 1) return null;
      void db
        .updateTable("access_keys")
        .set({ last_used_at: nowIso() })
        .where("id", "=", row.id)
        .execute();
      return {
        id: row.id,
        name: row.name,
        // SAFETY: the column is written with these exact literals only (identity.createKey).
        ownerType: row.owner_type as "user" | "automation",
        ownerUserId: row.owner_user_id,
        automationId: row.automation_id,
        // SAFETY: the column is written with these exact literals only (identity.createKey).
        scope: row.scope as "project" | "instance",
        projectId: row.project_id,
      };
    },

    consumeRateLimit: async (key, limit, windowSeconds) => {
      const now = clock.now();
      const nowText = now.toISOString();
      const resetAt = new Date(now.getTime() + windowSeconds * 1000).toISOString();
      const row = await db
        .insertInto("rate_limits")
        .values({ key, attempts: 1, reset_at: resetAt })
        .onConflict((oc) => oc.column("key").doUpdateSet({
          attempts: sql<number>`case when reset_at <= ${nowText} then 1 else attempts + 1 end`,
          reset_at: sql<string>`case when reset_at <= ${nowText} then ${resetAt} else reset_at end`,
        }))
        .returning(["attempts", "reset_at"])
        .executeTakeFirstOrThrow();
      return row.attempts <= limit;
    },

    // ---- invitations ----
    createInvitation: (ctx, projectId, expiresAt) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "invitation.create",
          targetType: "project",
          targetId: projectId,
          projectId,
          activityType: "invitation.created",
          activityPayload: { projectId, expiresAt: expiresAt ?? "never" },
        },
        run: async (trx) => {
          const role = await deps.projects.roleFor(ctx.actor.userId, projectId, asDomainTransaction(trx));
          if (role !== "owner") {
            throw domainError("FORBIDDEN", "Only the Project Owner may invite members");
          }
          const project = await trx
            .selectFrom("projects")
            .select("id")
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          if (!project) throw domainError("NOT_FOUND", "Project not found");
          let effectiveExpiry: string | null;
          if (expiresAt === undefined) {
            effectiveExpiry = addDays(clock.now(), deps.invitationDefaultTtlDays).toISOString();
          } else {
            effectiveExpiry = expiresAt;
          }
          const invitationId = ids.uuidv7();
          const code = ids.code();
          await trx
            .insertInto("invitations")
            .values({
              id: invitationId,
              code_hash: hashSecret(code),
              project_id: projectId,
              created_by: ctx.actor.userId,
              created_at: nowIso(),
              expires_at: effectiveExpiry,
              revoked_at: null,
            })
            .execute();
          return {
            invitation: {
              id: invitationId,
              projectId,
              createdBy: ctx.actor.userId,
              createdAt: nowIso(),
              expiresAt: effectiveExpiry,
              revokedAt: null,
            },
            code,
          };
        },
      }),

    listInvitations: async (ctx, projectId) => {
      const role = await deps.projects.roleFor(ctx.actor.userId, projectId);
      if (role !== "owner") {
        throw domainError("FORBIDDEN", "Only the Project Owner may list invitations");
      }
      const rows = await db
        .selectFrom("invitations")
        .selectAll()
        .where("project_id", "=", projectId)
        .orderBy("created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        createdBy: r.created_by,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
      }));
    },

    revokeInvitation: (ctx, projectId, invitationId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "invitation.revoke",
          targetType: "invitation",
          targetId: invitationId,
          projectId,
          activityType: "invitation.revoked",
          activityPayload: { projectId, invitationId },
        },
        run: async (trx) => {
          const role = await deps.projects.roleFor(ctx.actor.userId, projectId, asDomainTransaction(trx));
          if (role !== "owner") {
            throw domainError("FORBIDDEN", "Only the Project Owner may revoke invitations");
          }
          const row = await trx
            .selectFrom("invitations")
            .selectAll()
            .where("id", "=", invitationId)
            .where("project_id", "=", projectId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "Invitation not found");
          await trx
            .updateTable("invitations")
            .set({ revoked_at: nowIso() })
            .where("id", "=", invitationId)
            .execute();
        },
      }),

    validateInvitation: async (code) => {
      const trimmed = code.trim();
      if (!/^[A-Z2-9]{12}$/.test(trimmed)) return null;
      const row = await db
        .selectFrom("invitations")
        .selectAll()
        .where("code_hash", "=", hashSecret(trimmed))
        .executeTakeFirst();
      if (!row) return null;
      if (row.revoked_at !== null) return null;
      if (row.expires_at !== null && row.expires_at < clock.now().toISOString()) {
        return null;
      }
      const project = await db
        .selectFrom("projects")
        .select("id")
        .where("id", "=", row.project_id)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!project) return null;
      return { invitationId: row.id, projectId: row.project_id };
    },

    // ---- audit ----
    listAudit: async (ctx, opts) => {
      await requireInstanceOwner(ctx);
      const limit = Math.min(opts.limit ?? 50, 200);
      let query = db.selectFrom("audit_log").selectAll().orderBy("id", "desc");
      if (opts.cursor) {
        query = query.where("id", "<", opts.cursor);
      }
      const rows = await query.limit(limit + 1).execute();
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id,
        requestId: r.request_id,
        occurredAt: r.occurred_at,
        actorUserId: r.actor_user_id,
        actorAutomationId: r.actor_automation_id,
        actorKeyId: r.actor_key_id,
        clientHeader: r.client_header,
        operation: r.operation,
        targetType: r.target_type,
        targetId: r.target_id,
        // SAFETY: audit rows are written only by runCommand with these literals.
        result: r.result as "ok" | "error",
        detail: r.detail,
      }));
      return {
        items,
        nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
      };
    },

    recordAuthEvent: async (ctx, operation, result, detail) => {
      await db
        .insertInto("audit_log")
        .values({
          id: ids.uuidv7(),
          request_id: ctx.requestId,
          occurred_at: nowIso(),
          actor_user_id: ctx.actor.userId,
          actor_automation_id: ctx.actor.automationId ?? null,
          actor_key_id: ctx.actor.keyId ?? null,
          client_header: ctx.clientHeader ?? null,
          operation,
          target_type: null,
          target_id: null,
          result,
          detail: detail ?? null,
        })
        .execute();
    },
  };

  return service;
}

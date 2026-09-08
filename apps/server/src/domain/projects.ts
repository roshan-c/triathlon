/**
 * Projects module.
 *
 * Owns: project creation, soft deletion, restoration and permanent purge;
 * immutable creator and transferable current owner; membership and member
 * removal; one board per project with ordered workflow columns and their
 * semantic categories; project timezone; and project authorization decisions.
 *
 * The public seam is ProjectsService (which also implements the narrow
 * ProjectsSeam injected into Work, Planning, and Identity). Cross-module
 * atomic commands use `identityMutations` and `workMutations` inside a single
 * transaction; do not call those from HTTP.
 */

import type { Kysely, Transaction } from "kysely";
import type { Database as DbSchema } from "../db/types.js";
import type { Db } from "../db/types.js";
import type { ColumnCategory } from "../db/types.js";
import { domainError } from "../errors.js";
import type { Clock } from "../time.js";
import type { Ids } from "../ids.js";
import type { RequestContext } from "./context.js";
import { CODE_PATTERN, hashSecret, identityMutations } from "./identity.js";
import type { WorkMutations } from "./work.js";
import { asDomainTransaction, runCommand, type DomainTransaction, unwrapDomainTransaction } from "./tx.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectRole = "owner" | "member" | "none";

export interface Project {
  id: string;
  name: string;
  timezone: string;
  createdBy: string;
  ownerUserId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface Column {
  id: string;
  projectId: string;
  name: string;
  category: ColumnCategory;
  position: number;
  createdAt: string;
}

export interface Member {
  userId: string;
  joinedAt: string;
  role: Exclude<ProjectRole, "none">;
}

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

export interface AddColumnInput {
  name: string;
  category?: ColumnCategory;
  /** Insert before this existing column id; default appends. */
  beforeColumnId?: string;
}

export interface RecategorizeInput {
  category: ColumnCategory;
  /** Required when the Done identity changes. */
  confirm?: boolean;
}

/**
 * Narrow seam consumed by Work, Planning, and Identity. Read-only, safe to
 * call from any module.
 */
export interface ProjectsSeam {
  roleFor(userId: string, projectId: string, trx?: DomainTransaction): Promise<ProjectRole>;
  getProject(projectId: string, trx?: DomainTransaction): Promise<Project | null>;
  columnsFor(projectId: string, trx?: DomainTransaction): Promise<Column[]>;
  doneColumn(projectId: string, trx?: DomainTransaction): Promise<Column | null>;
  timezoneFor(projectId: string, trx?: DomainTransaction): Promise<string | null>;
}

export interface ProjectsService extends ProjectsSeam {
  /**
   * Project detail with the caller's role. Deleted projects are visible only
   * to their owner (restore surface) and instance-level credentials; the
   * authorization rule lives here, not in the HTTP adapter.
   */
  getProjectAccess(
    ctx: RequestContext,
    projectId: string,
  ): Promise<{ project: Project; role: ProjectRole }>;
  createProject(
    ctx: RequestContext,
    input: { name: string; timezone?: string },
  ): Promise<Project>;
  listProjects(ctx: RequestContext): Promise<ProjectAccess[]>;
  renameProject(ctx: RequestContext, projectId: string, name: string): Promise<Project>;
  setTimezone(ctx: RequestContext, projectId: string, timezone: string): Promise<Project>;
  transferOwnership(ctx: RequestContext, projectId: string, toUserId: string): Promise<Project>;
  recoverOwnership(ctx: RequestContext, projectId: string, toUserId: string): Promise<Project>;
  deleteProject(ctx: RequestContext, projectId: string): Promise<Project>;
  restoreProject(ctx: RequestContext, projectId: string): Promise<Project>;
  purgeProject(ctx: RequestContext, projectId: string): Promise<void>;
  joinProject(ctx: RequestContext, invitationCode: string): Promise<{ projectId: string; member: Member }>;
  listMembers(ctx: RequestContext, projectId: string): Promise<Member[]>;
  removeMember(ctx: RequestContext, projectId: string, userId: string): Promise<void>;
  addColumn(ctx: RequestContext, projectId: string, input: AddColumnInput): Promise<Column>;
  renameColumn(ctx: RequestContext, projectId: string, columnId: string, name: string): Promise<Column>;
  recategorizeColumn(
    ctx: RequestContext,
    projectId: string,
    columnId: string,
    input: RecategorizeInput,
  ): Promise<{ column: Column; affectedTickets: number }>;
  reorderColumns(
    ctx: RequestContext,
    projectId: string,
    columnIds: string[],
  ): Promise<Column[]>;
  deleteColumn(
    ctx: RequestContext,
    projectId: string,
    columnId: string,
    destinationColumnId?: string,
  ): Promise<void>;
}

/** Transaction-scoped membership operation injected into Identity onboarding. */
export interface ProjectMembershipMutations {
  addInvitedMember(
    trx: DomainTransaction,
    projectId: string,
    userId: string,
    addedBy: string,
    addedAt: string,
  ): Promise<void>;
}

export const projectMembershipMutations: ProjectMembershipMutations = {
  addInvitedMember: async (trx, projectId, userId, addedBy, addedAt) => {
    await unwrapDomainTransaction(trx)
      .insertInto("project_members")
      .values({
        project_id: projectId,
        user_id: userId,
        added_at: addedAt,
        added_by: addedBy,
        removed_at: null,
        removed_by: null,
      })
      .onConflict((oc) =>
        oc.columns(["project_id", "user_id"]).doUpdateSet({
          added_at: addedAt,
          added_by: addedBy,
          removed_at: null,
          removed_by: null,
        }),
      )
      .execute();
  },
};

export interface ProjectsDeps {
  db: Db;
  clock: Clock;
  ids: Ids;
  work: WorkMutations;
}

/**
 * Project-scoped keys cannot escape their project: any request authenticated
 * with a project key must target exactly that key's project.
 */
export function assertKeyScopeFits(
  ctx: RequestContext,
  projectId: string,
): void {
  if (ctx.actor.keyScope === "project" && ctx.actor.keyProjectId !== projectId) {
    throw domainError(
      "FORBIDDEN",
      "This access key is scoped to another project",
    );
  }
}

/**
 * Shared gate for Work, Planning, and SSE: the project exists, is not
 * deleted, and the actor is a member (or an instance-wide key).
 */
export async function requireOpenProject(
  projects: ProjectsSeam,
  ctx: RequestContext,
  projectId: string,
  trx?: DomainTransaction,
): Promise<void> {
  const project = await projects.getProject(projectId, trx);
  if (!project || project.deletedAt !== null) {
    throw domainError("NOT_FOUND", "Project not found");
  }
  assertKeyScopeFits(ctx, projectId);
  const role = await projects.roleFor(ctx.actor.userId, projectId, trx);
  if (role === "none" && ctx.actor.keyScope !== "instance") {
    throw domainError("FORBIDDEN", "Project membership required");
  }
}

export const DEFAULT_WORKFLOW: ReadonlyArray<{
  name: string;
  category: ColumnCategory;
}> = [
  { name: "Backlog", category: "not_started" },
  { name: "Todo", category: "not_started" },
  { name: "In Progress", category: "started" },
  { name: "Review", category: "started" },
  { name: "Done", category: "done" },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProjectsService(deps: ProjectsDeps): ProjectsService {
  const { db, clock, ids } = deps;
  const nowIso = (): string => clock.now().toISOString();

  const executor = (trx?: DomainTransaction): Kysely<DbSchema> =>
    trx === undefined ? db : unwrapDomainTransaction(trx);

  async function meta(trx?: Kysely<DbSchema>): Promise<{ ownerUserId: string | null; timezone: string }> {
    const row = await (trx ?? db)
      .selectFrom("instance_meta")
      .select(["owner_user_id", "timezone"])
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    return { ownerUserId: row.owner_user_id, timezone: row.timezone };
  }

  async function instanceAdmin(ctx: RequestContext, trx?: Kysely<DbSchema>): Promise<void> {
    if (ctx.actor.keyScope !== undefined && ctx.actor.keyScope !== "session") {
      throw domainError("FORBIDDEN", "Instance administration requires a browser session");
    }
    const row = await (trx ?? db)
      .selectFrom("users")
      .select("is_instance_admin")
      .where("id", "=", ctx.actor.userId)
      .executeTakeFirstOrThrow();
    if (row.is_instance_admin !== 1) {
      throw domainError("FORBIDDEN", "Instance Admin required");
    }
  }

  /** Instance-wide keys never grant project administration. Project-scoped
   * keys inherit their owner's permissions within their own project. */
  function requireSession(ctx: RequestContext): void {
    if (ctx.actor.keyScope === "instance") {
      throw domainError(
        "FORBIDDEN",
        "Instance-wide keys grant member-level access only",
      );
    }
  }

  async function roleFor(
    userId: string,
    projectId: string,
    domainTrx?: DomainTransaction,
  ): Promise<ProjectRole> {
    const q = executor(domainTrx);
    const project = await q
      .selectFrom("projects")
      .select("id")
      .where("id", "=", projectId)
      .executeTakeFirst();
    if (!project) return "none";
    const own = await q
      .selectFrom("projects")
      .select("owner_user_id")
      .where("id", "=", projectId)
      .executeTakeFirstOrThrow();
    if (own.owner_user_id === userId) return "owner";
    const member = await q
      .selectFrom("project_members")
      .select("user_id")
      .where("project_id", "=", projectId)
      .where("user_id", "=", userId)
      .where("removed_at", "is", null)
      .executeTakeFirst();
    return member ? "member" : "none";
  }

  async function requireRole(
    ctx: RequestContext,
    projectId: string,
    role: ProjectRole,
    trx?: Transaction<DbSchema>,
  ): Promise<void> {
    // Instance-wide keys grant ordinary member-level work access to every
    // project; they never grant project administration.
    if (ctx.actor.keyScope === "instance") {
      if (role === "member") return;
      throw domainError(
        "FORBIDDEN",
        "Access keys grant member-level access only; project administration requires a session",
      );
    }
    if (ctx.actor.keyScope === "project") {
      assertKeyScopeFits(ctx, projectId);
    }
    const actual = await roleFor(
      ctx.actor.userId,
      projectId,
      trx ? asDomainTransaction(trx) : undefined,
    );
    if (role === "member" && actual !== "none") return;
    if (actual !== role) {
      if (role === "owner") {
        throw domainError("FORBIDDEN", "Project Owner required");
      }
      throw domainError("FORBIDDEN", "Project membership required");
    }
  }

  async function getProjectRow(projectId: string) {
    const row = await db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", projectId)
      .executeTakeFirst();
    if (!row) throw domainError("NOT_FOUND", "Project not found");
    return row;
  }

  function toProject(row: {
    id: string;
    name: string;
    timezone: string;
    created_by: string;
    owner_user_id: string;
    created_at: string;
    deleted_at: string | null;
  }): Project {
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      createdBy: row.created_by,
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    };
  }

  function validateProjectName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw domainError(
        "VALIDATION_FAILED",
        "Project name must be between 1 and 100 characters",
      );
    }
    return trimmed;
  }

  function validateTimezone(tz: string): string {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      throw domainError("VALIDATION_FAILED", `Unknown time zone: ${tz}`);
    }
  }

  /** Done-identity migration shared by recategorize and delete paths. */
  function requireMigrateConfirm(
    confirm: boolean | undefined,
    affectedTickets: number,
  ): void {
    if (!confirm) {
      throw domainError(
        "WORKFLOW_CONFIRMATION_REQUIRED",
        `This changes the Done column and migrates ${affectedTickets} ticket(s); pass confirm: true`,
      );
    }
  }

  const service: ProjectsService = {
    roleFor,
    getProject: async (projectId, trx) => {
      const row = await executor(trx)
        .selectFrom("projects")
        .selectAll()
        .where("id", "=", projectId)
        .executeTakeFirst();
      return row ? toProject(row) : null;
    },
    columnsFor: async (projectId, trx) => {
      const rows = await executor(trx)
        .selectFrom("columns")
        .selectAll()
        .where("project_id", "=", projectId)
        .orderBy("position")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        // SAFETY: columns.category is written only with ColumnCategory literals.
        category: r.category as ColumnCategory,
        position: r.position,
        createdAt: r.created_at,
      }));
    },
    doneColumn: async (projectId, trx) => {
      const row = await executor(trx)
        .selectFrom("columns")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("category", "=", "done")
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            // SAFETY: columns.category is written only with ColumnCategory literals.
            category: row.category as ColumnCategory,
            position: row.position,
            createdAt: row.created_at,
          }
        : null;
    },
    timezoneFor: async (projectId, trx) => {
      const row = await executor(trx)
        .selectFrom("projects")
        .select("timezone")
        .where("id", "=", projectId)
        .executeTakeFirst();
      return row?.timezone ?? null;
    },

    createProject: (ctx, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.create",
          activityType: "project.created",
          projectId: undefined,
        },
        run: async (trx, _spec) => {
          await instanceAdmin(ctx, trx);
          requireSession(ctx);
          const name = validateProjectName(input.name);
          const tz = input.timezone === undefined
            ? (await meta(trx)).timezone
            : validateTimezone(input.timezone);
          const projectId = ids.uuidv7();
          const createdAt = nowIso();
          await trx
            .insertInto("projects")
            .values({
              id: projectId,
              name,
              timezone: tz,
              created_by: ctx.actor.userId,
              owner_user_id: ctx.actor.userId,
              created_at: createdAt,
              deleted_at: null,
              purged_at: null,
            })
            .execute();
          let position = 0;
          for (const w of DEFAULT_WORKFLOW) {
            await trx
              .insertInto("columns")
              .values({
                id: ids.uuidv7(),
                project_id: projectId,
                name: w.name,
                category: w.category,
                position: position++,
                created_at: createdAt,
              })
              .execute();
          }
          const row = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          return toProject(row);
        },
      }),

    getProjectAccess: async (ctx, projectId) => {
      const role = await roleFor(ctx.actor.userId, projectId);
      if (role === "none" && ctx.actor.keyScope !== "instance") {
        throw domainError("NOT_FOUND", "Project not found");
      }
      if (ctx.actor.keyScope === "project") {
        assertKeyScopeFits(ctx, projectId);
      }
      const project = await getProjectRow(projectId);
      const deletedAllowed = role === "owner" || ctx.actor.keyScope === "instance";
      if (project.deleted_at !== null && !deletedAllowed) {
        throw domainError("NOT_FOUND", "Project not found");
      }
      return { project: toProject(project), role };
    },

    listProjects: async (ctx) => {
      const isAdmin = (
        await db
          .selectFrom("users")
          .select("is_instance_admin")
          .where("id", "=", ctx.actor.userId)
          .executeTakeFirstOrThrow()
      ).is_instance_admin === 1;
      const rows = await db
        .selectFrom("projects")
        .selectAll()
        .orderBy("name")
        .execute();
      const out: ProjectAccess[] = [];
      for (const row of rows) {
        if (row.purged_at !== null) continue;
        const own = row.owner_user_id === ctx.actor.userId;
        let role: ProjectRole = "none";
        if (ctx.actor.keyScope === "instance") {
          // Instance-wide keys: ordinary member-level access to every project.
          role = "member";
        } else if (ctx.actor.keyScope === "project") {
          if (row.id !== ctx.actor.keyProjectId) continue;
          role = "member";
        } else {
          if (own) {
            role = "owner";
          } else {
            const member = await db
              .selectFrom("project_members")
              .select("user_id")
              .where("project_id", "=", row.id)
              .where("user_id", "=", ctx.actor.userId)
              .where("removed_at", "is", null)
              .executeTakeFirst();
            if (member) role = "member";
            else if (isAdmin) role = "member"; // admins may work anywhere
          }
        }
        if (row.deleted_at !== null && role === "member" && !own && !isAdmin) {
          // Deleted projects hide from everyone except the owner and admins.
          continue;
        }
        if (role !== "none") out.push({ project: toProject(row), role });
      }
      return out;
    },

    renameProject: (ctx, projectId, name) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.rename",
          projectId,
          activityType: "project.renamed",
          activityPayload: { projectId, name: name.trim() },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const trimmed = validateProjectName(name);
          const before = await trx
            .selectFrom("projects")
            .select(["name"])
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("projects")
            .set({ name: trimmed })
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .execute();
          const row = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            name: trimmed,
            before: { name: before.name },
            after: { name: trimmed },
          };
          return toProject(row);
        },
      }),

    setTimezone: (ctx, projectId, timezone) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.timezone_change",
          projectId,
          activityType: "project.timezone_changed",
          activityPayload: { projectId, timezone },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const tz = validateTimezone(timezone);
          const before = await trx
            .selectFrom("projects")
            .select(["timezone"])
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("projects")
            .set({ timezone: tz })
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .execute();
          const row = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            timezone: tz,
            before: { timezone: before.timezone },
            after: { timezone: tz },
          };
          return toProject(row);
        },
      }),

    transferOwnership: (ctx, projectId, toUserId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.ownership_transfer",
          projectId,
          activityType: "project.ownership_transferred",
          activityPayload: { projectId, toUserId },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const before = await trx
            .selectFrom("projects")
            .select(["owner_user_id"])
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .executeTakeFirstOrThrow();
          if (toUserId === ctx.actor.userId) {
            throw domainError("INVALID_STATE", "Ownership already held by this user");
          }
          const target = await trx
            .selectFrom("project_members")
            .select("user_id")
            .where("project_id", "=", projectId)
            .where("user_id", "=", toUserId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
          if (!target) {
            throw domainError(
              "INVALID_STATE",
              "Ownership may transfer only to an existing project member",
            );
          }
          await trx
            .updateTable("projects")
            .set({ owner_user_id: toUserId })
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .execute();
          // The old owner becomes an ordinary member.
          const formerOwnerWasMember = await trx
            .selectFrom("project_members")
            .select("user_id")
            .where("project_id", "=", projectId)
            .where("user_id", "=", ctx.actor.userId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
          if (!formerOwnerWasMember) {
            await trx
              .insertInto("project_members")
              .values({
                project_id: projectId,
                user_id: ctx.actor.userId,
                added_at: nowIso(),
                added_by: ctx.actor.userId,
                removed_at: null,
                removed_by: null,
              })
              .execute();
          }
          const row = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            toUserId,
            before: { ownerUserId: before.owner_user_id },
            after: { ownerUserId: toUserId },
          };
          return toProject(row);
        },
      }),

    recoverOwnership: (ctx, projectId, toUserId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.ownership_recover",
          projectId,
          activityType: "project.ownership_recovered",
          activityPayload: { projectId, toUserId },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await instanceAdmin(ctx, trx);
          requireSession(ctx);
          const before = await trx
            .selectFrom("projects")
            .select(["owner_user_id"])
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          const target = await trx
            .selectFrom("project_members")
            .select("user_id")
            .where("project_id", "=", projectId)
            .where("user_id", "=", toUserId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
          if (!target) {
            throw domainError(
              "INVALID_STATE",
              "Recovered ownership must go to an existing project member",
            );
          }
          await trx
            .updateTable("projects")
            .set({ owner_user_id: toUserId })
            .where("id", "=", projectId)
            .execute();
          const row = await trx
              .selectFrom("projects")
              .selectAll()
              .where("id", "=", projectId)
              .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            toUserId,
            before: { ownerUserId: before.owner_user_id },
            after: { ownerUserId: toUserId },
          };
          return toProject(row);
        },
      }),

    deleteProject: (ctx, projectId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.delete",
          projectId,
          activityType: "project.deleted",
          activityPayload: { projectId },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const before = await trx
            .selectFrom("projects")
            .select(["deleted_at"])
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .executeTakeFirstOrThrow();
          const deletedAt = nowIso();
          await trx
            .updateTable("projects")
            .set({ deleted_at: deletedAt })
            .where("id", "=", projectId)
            .where("deleted_at", "is", null)
            .execute();
          // Disable every project-scoped key immediately.
          await trx
            .updateTable("access_keys")
            .set({ revoked_at: deletedAt })
            .where("project_id", "=", projectId)
            .where("revoked_at", "is", null)
            .execute();
          const row = await trx
              .selectFrom("projects")
              .selectAll()
              .where("id", "=", projectId)
              .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            before: { deletedAt: before.deleted_at },
            after: { deletedAt },
          };
          return toProject(row);
        },
      }),

    restoreProject: (ctx, projectId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.restore",
          projectId,
          activityType: "project.restored",
          activityPayload: { projectId },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const before = await trx
            .selectFrom("projects")
            .select(["deleted_at"])
            .where("id", "=", projectId)
            .where("deleted_at", "is not", null)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("projects")
            .set({ deleted_at: null })
            .where("id", "=", projectId)
            .where("deleted_at", "is not", null)
            .execute();
          const row = await trx
              .selectFrom("projects")
              .selectAll()
              .where("id", "=", projectId)
              .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            before: { deletedAt: before.deleted_at },
            after: { deletedAt: null },
          };
          return toProject(row);
        },
      }),

    purgeProject: (ctx, projectId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "project.purge",
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, _spec) => {
          await instanceAdmin(ctx, trx);
          requireSession(ctx);
          const row = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "Project not found");
          if (row.deleted_at === null) {
            throw domainError(
              "INVALID_STATE",
              "Only a deleted project may be permanently purged",
            );
          }
          // Members of the purge keep historical ticket attribution because
          // tickets are not deleted; the project, its tickets, and its
          // activity are removed.
          await trx.deleteFrom("projects").where("id", "=", projectId).execute();
        },
      }),

    joinProject: (ctx, invitationCode) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "invitation.redeem",
          activityType: "membership.added",
          projectId: undefined,
          detail: "invitation-redemption",
        },
        run: async (trx, spec) => {
          const trimmed = invitationCode.trim();
          if (!CODE_PATTERN.test(trimmed)) {
            throw domainError("INVALID_CODE", "Unknown, expired, or revoked invitation");
          }
          const invitation = await trx
            .selectFrom("invitations")
            .selectAll()
            .where("code_hash", "=", hashSecret(trimmed))
            .executeTakeFirst();
          if (
            !invitation ||
            invitation.revoked_at !== null ||
            (invitation.expires_at !== null && invitation.expires_at < nowIso())
          ) {
            throw domainError("INVALID_CODE", "Unknown, expired, or revoked invitation");
          }
          const projectId = invitation.project_id;
          const project = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          if (project.deleted_at !== null) {
            throw domainError("NOT_FOUND", "Project not found");
          }
          const member = await trx
            .selectFrom("project_members")
            .selectAll()
            .where("project_id", "=", projectId)
            .where("user_id", "=", ctx.actor.userId)
            .executeTakeFirst();
          if (member && member.removed_at === null) {
            spec.activityPayload = {
              projectId,
              userId: ctx.actor.userId,
              before: { role: project.owner_user_id === ctx.actor.userId ? "owner" : "member" },
              after: { role: project.owner_user_id === ctx.actor.userId ? "owner" : "member" },
            };
            return {
              projectId,
              member: {
                userId: ctx.actor.userId,
                joinedAt: member.added_at,
                role: project.owner_user_id === ctx.actor.userId ? "owner" : "member",
              },
            };
          }
          await trx
            .insertInto("project_members")
            .values({
              project_id: projectId,
              user_id: ctx.actor.userId,
              added_at: nowIso(),
              added_by: ctx.actor.userId,
              removed_at: null,
              removed_by: null,
            })
            .execute();
          spec.projectId = projectId;
          spec.activityPayload = {
            projectId,
            userId: ctx.actor.userId,
            before: null,
            after: { role: project.owner_user_id === ctx.actor.userId ? "owner" : "member" },
          };
          return {
            projectId,
            member: {
              userId: ctx.actor.userId,
              joinedAt: nowIso(),
              role: project.owner_user_id === ctx.actor.userId ? "owner" : "member",
            },
          };
        },
      }),

    listMembers: async (ctx, projectId) => {
      await requireRole(ctx, projectId, "member");
      const project = await getProjectRow(projectId);
      const rows = await db
        .selectFrom("project_members")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("removed_at", "is", null)
        .orderBy("added_at")
        .execute();
      const members = rows.map((r) => ({
        userId: r.user_id,
        joinedAt: r.added_at,
        role: project.owner_user_id === r.user_id ? ("owner" as const) : ("member" as const),
      }));
      if (!members.some((m) => m.userId === project.owner_user_id)) {
        members.unshift({
          userId: project.owner_user_id,
          joinedAt: project.created_at,
          role: "owner",
        });
      }
      return members;
    },

    removeMember: (ctx, projectId, userId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "membership.remove",
          projectId,
          activityType: "membership.removed",
          activityPayload: { projectId, userId },
          targetType: "user",
          targetId: userId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const project = await trx
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirstOrThrow();
          if (project.owner_user_id === userId) {
            throw domainError(
              "INVALID_STATE",
              "Transfer project ownership before removing the owner",
            );
          }
          if (userId === ctx.actor.userId) {
            throw domainError("INVALID_STATE", "An owner cannot remove themself");
          }
          const member = await trx
            .selectFrom("project_members")
            .select("user_id")
            .where("project_id", "=", projectId)
            .where("user_id", "=", userId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
          if (!member) throw domainError("NOT_FOUND", "Member not found");
          const before = { role: "member" as const };
          const removedAt = nowIso();
          await trx
            .updateTable("project_members")
            .set({ removed_at: removedAt, removed_by: ctx.actor.userId })
            .where("project_id", "=", projectId)
            .where("user_id", "=", userId)
            .where("removed_at", "is", null)
            .execute();
          // Atomically unassign the member's Open tickets.
          await deps.work.unassignOpenTickets(asDomainTransaction(trx), projectId, userId, removedAt);
          // Disable their project-scoped access.
          await identityMutations.revokeProjectKeys(asDomainTransaction(trx), projectId, userId, removedAt);
          spec.activityPayload = { projectId, userId, before, after: null };
        },
      }),

    addColumn: (ctx, projectId, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "column.add",
          projectId,
          activityType: "column.added",
          activityPayload: { projectId, name: input.name.trim(), category: input.category ?? "not_started" },
          targetType: "column",
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const name = validateProjectName(input.name);
          const category = input.category ?? "not_started";
          if (category === "done") {
            const existingDone = await trx
              .selectFrom("columns")
              .select("id")
              .where("project_id", "=", projectId)
              .where("category", "=", "done")
              .executeTakeFirst();
            if (existingDone) {
              throw domainError(
                "INVALID_STATE",
                "A Done column already exists; recategorize it first",
              );
            }
          }
          const rows = await trx
            .selectFrom("columns")
            .selectAll()
            .where("project_id", "=", projectId)
            .orderBy("position")
            .execute();
          const insertionIndex = input.beforeColumnId
            ? rows.findIndex((r) => r.id === input.beforeColumnId)
            : -1;
          if (input.beforeColumnId && insertionIndex === -1) {
            throw domainError("NOT_FOUND", "beforeColumn not found");
          }
          const at = insertionIndex === -1 ? rows.length : insertionIndex;
          for (let i = at; i < rows.length; i++) {
            const r = rows[i];
            if (r) {
              await trx
                .updateTable("columns")
                .set({ position: i + 1 })
                .where("id", "=", r.id)
                .execute();
            }
          }
          const columnId = ids.uuidv7();
          await trx
            .insertInto("columns")
            .values({
              id: columnId,
              project_id: projectId,
              name,
              category,
              position: at,
              created_at: nowIso(),
            })
            .execute();
          const row = await trx
            .selectFrom("columns")
            .selectAll()
            .where("id", "=", columnId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            name: row.name,
            category: row.category,
            before: null,
            after: { id: row.id, name: row.name, category: row.category, position: row.position },
          };
          return {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            // SAFETY: columns.category is written only with ColumnCategory literals.
            category: row.category as ColumnCategory,
            position: row.position,
            createdAt: row.created_at,
          };
        },
      }),

    renameColumn: (ctx, projectId, columnId, name) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "column.rename",
          projectId,
          activityType: "column.renamed",
          activityPayload: { projectId, columnId, name: name.trim() },
          targetType: "column",
          targetId: columnId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const trimmed = validateProjectName(name);
          const before = await trx
            .selectFrom("columns")
            .select(["name"])
            .where("id", "=", columnId)
            .where("project_id", "=", projectId)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("columns")
            .set({ name: trimmed })
            .where("id", "=", columnId)
            .where("project_id", "=", projectId)
            .execute();
          const row = await trx
            .selectFrom("columns")
            .selectAll()
            .where("id", "=", columnId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            columnId,
            name: trimmed,
            before: { name: before.name },
            after: { name: trimmed },
          };
          return {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            // SAFETY: columns.category is written only with ColumnCategory literals.
            category: row.category as ColumnCategory,
            position: row.position,
            createdAt: row.created_at,
          };
        },
      }),

    recategorizeColumn: (ctx, projectId, columnId, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "column.recategorize",
          projectId,
          activityType: "column.recategorized",
          activityPayload: { projectId, columnId, category: input.category },
          targetType: "column",
          targetId: columnId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const column = await trx
            .selectFrom("columns")
            .selectAll()
            .where("id", "=", columnId)
            .where("project_id", "=", projectId)
            .executeTakeFirst();
          if (!column) throw domainError("NOT_FOUND", "Column not found");
          const beforeCategory = column.category;
          const category = input.category;
          if (
            !["not_started", "started", "done"].includes(category)
          ) {
            throw domainError("VALIDATION_FAILED", "Unknown column category");
          }
          const currentDone = await trx
            .selectFrom("columns")
            .selectAll()
            .where("project_id", "=", projectId)
            .where("category", "=", "done")
            .executeTakeFirst();

          let affectedTickets = 0;
          const doneColumnId = currentDone?.id ?? null;
          if (category === "done") {
            // Promoting a replacement Done column migrates the old one to
            // "started": its tickets become Open again.
            const doneTickets = doneColumnId
              ? await trx
                  .selectFrom("tickets")
                  .select((eb) => eb.fn.countAll<number>().as("c"))
                  .where("project_id", "=", projectId)
                  .where("column_id", "=", doneColumnId)
                  .where("deleted_at", "is", null)
                  .executeTakeFirst()
              : undefined;
            const targetTickets = await trx
              .selectFrom("tickets")
              .select((eb) => eb.fn.countAll<number>().as("c"))
              .where("project_id", "=", projectId)
              .where("column_id", "=", columnId)
              .where("deleted_at", "is", null)
              .executeTakeFirst();
            affectedTickets =
              (doneTickets?.c ?? 0) + (targetTickets?.c ?? 0);
            requireMigrateConfirm(input.confirm, affectedTickets);
            if (doneColumnId !== null && doneColumnId !== columnId) {
              await trx
                .updateTable("columns")
                .set({ category: "started" })
                .where("id", "=", doneColumnId)
                .execute();
            }
          } else if (column.category === "done") {
            // Demoting the Done column would leave zero Done columns; the
            // board may never have zero Done columns.
            throw domainError(
              "INVALID_STATE",
              "Promote a replacement Done column first; the board may never have zero Done columns",
            );
          }
          if (category === "done" && column.category === "done") {
            return {
              column: {
                id: column.id,
                projectId: column.project_id,
                name: column.name,
                // SAFETY: columns.category is written only with ColumnCategory literals.
                category: column.category as ColumnCategory,
                position: column.position,
                createdAt: column.created_at,
              },
              affectedTickets: 0,
            };
          }
          await trx
            .updateTable("columns")
            .set({ category })
            .where("id", "=", columnId)
            .execute();
          const row = await trx
            .selectFrom("columns")
            .selectAll()
            .where("id", "=", columnId)
            .executeTakeFirstOrThrow();
          spec.activityPayload = {
            projectId,
            columnId,
            category: input.category,
            affectedTickets,
            before: { category: beforeCategory },
            after: { category: row.category, affectedTickets },
          };
          return {
            column: {
              id: row.id,
              projectId: row.project_id,
              name: row.name,
              // SAFETY: columns.category is written only with ColumnCategory literals.
            category: row.category as ColumnCategory,
              position: row.position,
              createdAt: row.created_at,
            },
            affectedTickets,
          };
        },
      }),

    reorderColumns: (ctx, projectId, columnIds) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "column.reorder",
          projectId,
          activityType: "columns.reordered",
          activityPayload: { projectId, columnIds },
          targetType: "project",
          targetId: projectId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const rows = await trx
            .selectFrom("columns")
            .select("id")
            .where("project_id", "=", projectId)
            .execute();
          const existing = new Set(rows.map((r) => r.id));
          if (
            columnIds.length !== existing.size ||
            columnIds.some((id) => !existing.has(id))
          ) {
            throw domainError(
              "VALIDATION_FAILED",
              "columnIds must be a permutation of the project's columns",
            );
          }
          for (let i = 0; i < columnIds.length; i++) {
            const id = columnIds[i];
            if (id) {
              await trx
                .updateTable("columns")
                .set({ position: i })
                .where("id", "=", id)
                .execute();
            }
          }
          const updated = await trx
            .selectFrom("columns")
            .selectAll()
            .where("project_id", "=", projectId)
            .orderBy("position")
            .execute();
          spec.activityPayload = {
            projectId,
            columnIds,
            before: { columnIds: rows.map((row) => row.id) },
            after: { columnIds },
          };
          return updated.map((r) => ({
            id: r.id,
            projectId: r.project_id,
            name: r.name,
            // SAFETY: columns.category is written only with ColumnCategory literals.
            category: r.category as ColumnCategory,
            position: r.position,
            createdAt: r.created_at,
          }));
        },
      }),

    deleteColumn: (ctx, projectId, columnId, destinationColumnId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "column.delete",
          projectId,
          activityType: "column.deleted",
          activityPayload: { projectId, columnId, destinationColumnId: destinationColumnId ?? null },
          targetType: "column",
          targetId: columnId,
        },
        run: async (trx, spec) => {
          await requireRole(ctx, projectId, "owner", trx);
          requireSession(ctx);
          const column = await trx
            .selectFrom("columns")
            .selectAll()
            .where("id", "=", columnId)
            .where("project_id", "=", projectId)
            .executeTakeFirst();
          if (!column) throw domainError("NOT_FOUND", "Column not found");
          const before = { id: column.id, name: column.name, category: column.category, position: column.position };
          if (column.category === "done") {
            throw domainError(
              "INVALID_STATE",
              "Promote a replacement Done column before deleting the current one",
            );
          }
          const count = await trx
            .selectFrom("tickets")
            .select((eb) => eb.fn.countAll<number>().as("c"))
            .where("column_id", "=", columnId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          const ticketCount = count?.c ?? 0;
          if (ticketCount > 0) {
            if (!destinationColumnId) {
              throw domainError(
                "VALIDATION_FAILED",
                "A non-empty column requires an atomic destination for its tickets",
              );
            }
            const destination = await trx
              .selectFrom("columns")
              .selectAll()
              .where("id", "=", destinationColumnId)
              .where("project_id", "=", projectId)
              .executeTakeFirst();
            if (!destination) throw domainError("NOT_FOUND", "Destination column not found");
            if (destination.category === "done") {
              throw domainError(
                "INVALID_STATE",
                "Open tickets cannot be moved into Done by deleting their column",
              );
            }
            await deps.work.moveColumnTickets(
              asDomainTransaction(trx),
              projectId,
              columnId,
              destinationColumnId,
            );
          }
          await trx
            .deleteFrom("columns")
            .where("id", "=", columnId)
            .execute();
          spec.activityPayload = {
            projectId,
            columnId,
            destinationColumnId: destinationColumnId ?? null,
            before,
            after: null,
          };
        },
      }),
  };

  return service;
}

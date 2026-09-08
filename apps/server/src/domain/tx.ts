/**
 * The one-transaction command runner shared by all four domain modules.
 *
 * Every successful command executes in exactly one SQLite transaction that:
 *   1. validates invariants (in the command body),
 *   2. changes domain state (in the command body),
 *   3. appends the structured Activity record with before/after values,
 *   4. stores any idempotency result,
 *   5. allocates the monotonic project event sequence.
 *
 * The same transaction appends the security Audit record. Failed commands
 * append an error Audit record in a separate transaction so the failure is
 * never lost to a rollback. Activity publication to the SSE bus happens only
 * after commit.
 */

import { createHash } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database as DbSchema } from "../db/types.js";
import type { Db } from "../db/types.js";
import { domainError } from "../errors.js";
import type {
  IdempotencyContext,
  Json,
  RequestContext,
} from "./context.js";
import type { ProjectEvent, ProjectEventBus } from "./events.js";

/**
 * Opaque transaction capability shared between domain modules. Kysely stays
 * an implementation detail of the module that owns the database; callers can
 * pass atomicity across a seam without gaining a query-builder surface.
 */
const domainTransactionBrand: unique symbol = Symbol("triathlon.domainTransaction");
export interface DomainTransaction {
  readonly [domainTransactionBrand]: true;
}

const transactionStore = new WeakMap<DomainTransaction, Transaction<DbSchema>>();

export function asDomainTransaction(
  trx: Transaction<DbSchema>,
): DomainTransaction {
  const handle: DomainTransaction = { [domainTransactionBrand]: true };
  transactionStore.set(handle, trx);
  return handle;
}

export function unwrapDomainTransaction(
  trx: DomainTransaction,
): Transaction<DbSchema> {
  const database = transactionStore.get(trx);
  if (!database) throw new Error("Unknown domain transaction handle");
  return database;
}

export interface CommandSpec {
  /** Stable operation name, e.g. "ticket.create", used in Audit. */
  operation: string;
  /** Project-scoped activity and event sequence; requires activityType. */
  projectId?: string;
  /** Activity event type, e.g. "ticket.created". */
  activityType?: string;
  /** Structured before/after values recorded on the Activity row. */
  activityPayload?: Json;
  targetType?: string;
  targetId?: string;
  /** Optional human detail for the Audit record. */
  detail?: string;
}

export type CommandFn<TReturn> = (
  trx: Transaction<DbSchema>,
  spec: CommandSpec,
) => Promise<TReturn>;

export interface RunOptions<TReturn> {
  db: Db;
  ctx: RequestContext;
  spec: CommandSpec;
  clock: { now(): Date };
  ids: { uuidv7(): string };
  bus?: ProjectEventBus;
  run: CommandFn<TReturn>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function activityWithBeforeAfter(payload: Json | undefined): Json {
  const value = payload ?? {};
  if (value === null || Array.isArray(value) || Object(value) !== value) {
    return { before: null, after: value };
  }
  // SAFETY: Json values that are not null, arrays, or primitives are object
  // records by the Json definition at this module boundary.
  const object = value as Record<string, Json>;
  const hasBefore = Object.prototype.hasOwnProperty.call(object, "before");
  const hasAfter = Object.prototype.hasOwnProperty.call(object, "after");
  return {
    ...object,
    before: hasBefore && object.before !== undefined ? object.before : null,
    after: hasAfter && object.after !== undefined ? object.after : hasAfter ? null : value,
  };
}

async function appendAudit(
  executor: Db,
  ctx: RequestContext,
  spec: CommandSpec,
  id: string,
  occurredAt: string,
  result: "ok" | "error",
  detail: string | null,
): Promise<void> {
  await executor
    .insertInto("audit_log")
    .values({
      id,
      request_id: ctx.requestId,
      occurred_at: occurredAt,
      actor_user_id: ctx.actor.userId,
      actor_automation_id: ctx.actor.automationId ?? null,
      actor_key_id: ctx.actor.keyId ?? null,
      client_header: ctx.clientHeader ?? null,
      operation: spec.operation,
      target_type: spec.targetType ?? null,
      target_id: spec.targetId ?? null,
      result,
      detail,
    })
    .execute();
}

export async function runCommand<TReturn>(opts: RunOptions<TReturn>): Promise<TReturn> {
  const { db, ctx, spec, clock, ids, run } = opts;
  const now = clock.now().toISOString();

  const pendingEvents: Array<{ projectId: string; event: ProjectEvent }> = [];

  const checkIdempotency = async (trx: Transaction<DbSchema>): Promise<TReturn | null> => {
    const idem = ctx.idempotency;
    if (!idem) return null;
    // The authoritative check runs inside the write transaction, so concurrent
    // retries serialize on SQLite's single writer: the second sees the first
    // commit. Seven-day expiry is enforced here and on insert.
    const expiryCutoff = new Date(
      clock.now().getTime() - IDEMPOTENCY_RETENTION_MS,
    ).toISOString();
    const hit = await trx
      .selectFrom("idempotency")
      .selectAll()
      .where("key", "=", idem.key)
      .where("fingerprint", "=", idem.fingerprint)
      .where("created_at", ">=", expiryCutoff)
      .executeTakeFirst();
    if (hit) {
      if (hit.input_hash !== idem.inputHash) {
        throw domainError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with different input",
        );
      }
      // SAFETY: the stored result was written by this command runner as JSON.
      return JSON.parse(hit.result_json) as TReturn;
    }
    return null;
  };

  try {
    const value = await db.transaction().execute(async (trx) => {
      const replay = await checkIdempotency(trx);
      if (replay !== null) return replay;

      const result = await run(trx, spec);

      let displayName = "";
      if (spec.projectId !== undefined) {
        const user = await trx
          .selectFrom("users")
          .select("display_name")
          .where("id", "=", ctx.actor.userId)
          .executeTakeFirst();
        displayName = user?.display_name ?? "";
      }

      await appendAudit(trx, ctx, spec, ids.uuidv7(), now, "ok", spec.detail ?? null);

      if (spec.projectId !== undefined && spec.activityType !== undefined) {
        // The command body may replace activityPayload (e.g. with ids and
        // numbers allocated inside the transaction) before returning.
        const payload = activityWithBeforeAfter(spec.activityPayload);
        const row = await trx
          .selectFrom("activity")
          .select((eb) => eb.fn.max<number>("seq").as("m"))
          .where("project_id", "=", spec.projectId)
          .executeTakeFirst();
        const seq = (row?.m ?? 0) + 1;
        await trx
          .insertInto("activity")
          .values({
            id: ids.uuidv7(),
            project_id: spec.projectId,
            seq,
            occurred_at: now,
            actor_user_id: ctx.actor.userId,
            actor_display_name: displayName,
            // Activity is person-attributed. Automation identity belongs only
            // in the owner-visible Audit record above.
            actor_automation_id: null,
            type: spec.activityType,
            target_type: spec.targetType ?? null,
            target_id: spec.targetId ?? null,
            payload_json: JSON.stringify(payload),
          })
          .execute();

        // Publication happens only after this transaction commits (below);
        // collecting here keeps the event and its sequence together.
        pendingEvents.push({
          projectId: spec.projectId,
          event: {
            sequence: seq,
            eventId: ids.uuidv7(),
            eventType: spec.activityType,
            schemaVersion: 1,
            projectId: spec.projectId,
            timestamp: now,
            actor: {
              userId: ctx.actor.userId,
              displayName,
            },
            resource:
              spec.targetType !== undefined && spec.targetId !== undefined
                ? { type: spec.targetType, id: spec.targetId }
                : null,
            data: payload,
          },
        });
      }

      if (ctx.idempotency) {
        // Upsert so a retry after the retention window refreshes the record.
        await trx
          .insertInto("idempotency")
          .values({
            key: ctx.idempotency.key,
            fingerprint: ctx.idempotency.fingerprint,
            input_hash: ctx.idempotency.inputHash,
            result_json: JSON.stringify(result),
            created_at: now,
          })
          .onConflict((oc) =>
            oc
              .columns(["key", "fingerprint"])
              .doUpdateSet({
                input_hash: ctx.idempotency?.inputHash ?? "",
                result_json: JSON.stringify(result),
                created_at: now,
              }),
          )
          .execute();
      }

      return result;
    });

    // Publish only after the commit succeeded; a rolled-back command never
    // emits events, so Last-Event-ID replay stays consistent.
    for (const pending of pendingEvents) {
      opts.bus?.publish(pending.projectId, pending.event);
    }
    return value;
  } catch (error) {
    // Record the failure in Audit without losing it to the rollback.
    try {
      await appendAudit(
        db,
        ctx,
        spec,
        ids.uuidv7(),
        now,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    } catch {
      // Audit is best-effort; never mask the original failure.
    }
    throw error;
  }
}

const IDEMPOTENCY_RETENTION_MS = 7 * 86_400_000;

/** Stable hash of normalized input for idempotency comparison. Accepts any
 * JSON-serializable value; JSON.stringify at this boundary handles all
 * request shapes (params, query, body objects). */
export function inputHash(value: Json): string {
  return sha256(JSON.stringify(value));
}

export type { IdempotencyContext };

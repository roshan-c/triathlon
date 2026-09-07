/**
 * Shared TypeBox schemas for the HTTP transport. Fastify route schemas are the
 * transport source of truth: they validate input, type the handlers, and feed
 * the generated OpenAPI document.
 */

import { Type, type TSchema } from "@sinclair/typebox";

export const ErrorFieldsSchema = Type.Array(
  Type.Object({
    field: Type.String(),
    message: Type.String(),
  }),
);

export const ErrorSchema = Type.Object({
  error: Type.Object({
    status: Type.Integer(),
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    fields: Type.Optional(ErrorFieldsSchema),
  }),
});

export const UserSchema = Type.Object({
  id: Type.String(),
  email: Type.String(),
  displayName: Type.String(),
  isInstanceAdmin: Type.Boolean(),
  isInstanceOwner: Type.Boolean(),
  isSuspended: Type.Boolean(),
  createdAt: Type.String(),
});

export const SessionSchema = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  createdAt: Type.String(),
  expiresAt: Type.String(),
});

export const AccessKeySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  ownerType: Type.Union([Type.Literal("user"), Type.Literal("automation")]),
  ownerUserId: Type.String(),
  automationId: Type.Union([Type.String(), Type.Null()]),
  scope: Type.Union([Type.Literal("project"), Type.Literal("instance")]),
  projectId: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const AutomationSchema = Type.Object({
  id: Type.String(),
  ownerUserId: Type.String(),
  name: Type.String(),
  createdAt: Type.String(),
});

export const InvitationSchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  createdBy: Type.String(),
  createdAt: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
});

export const ProjectSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  timezone: Type.String(),
  createdBy: Type.String(),
  ownerUserId: Type.String(),
  createdAt: Type.String(),
  deletedAt: Type.Union([Type.String(), Type.Null()]),
});

export const ProjectAccessSchema = Type.Object({
  project: ProjectSchema,
  role: Type.Union([Type.Literal("owner"), Type.Literal("member")]),
});

export const ColumnSchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  name: Type.String(),
  category: Type.Union([
    Type.Literal("not_started"),
    Type.Literal("started"),
    Type.Literal("done"),
  ]),
  position: Type.Integer(),
  createdAt: Type.String(),
});

export const MemberSchema = Type.Object({
  userId: Type.String(),
  joinedAt: Type.String(),
  role: Type.Union([Type.Literal("owner"), Type.Literal("member")]),
});

export const TicketSummarySchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  number: Type.Integer(),
  title: Type.String(),
  points: Type.Union([Type.Integer(), Type.Null()]),
  priority: Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ]),
  labels: Type.Array(Type.String()),
  assigneeId: Type.Union([Type.String(), Type.Null()]),
  columnId: Type.String(),
  position: Type.Integer(),
  revision: Type.Integer(),
  resourceVersion: Type.Integer(),
  createdAt: Type.String(),
  deletedAt: Type.Union([Type.String(), Type.Null()]),
  category: Type.Union([
    Type.Literal("not_started"),
    Type.Literal("started"),
    Type.Literal("done"),
  ]),
});

export const TicketSchema = Type.Object({
  ...TicketSummarySchema.properties,
  descriptionMd: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.String(),
});

export const TicketRefSchema = Type.Object({
  id: Type.String(),
  number: Type.Integer(),
  title: Type.String(),
  category: Type.Union([
    Type.Literal("not_started"),
    Type.Literal("started"),
    Type.Literal("done"),
  ]),
  deleted: Type.Boolean(),
});

export const CommentSchema = Type.Object({
  id: Type.String(),
  ticketId: Type.String(),
  authorId: Type.String(),
  body: Type.String(),
  createdAt: Type.String(),
});

export const ReviewStateSchema = Type.Object({
  revision: Type.Integer(),
  state: Type.Union([
    Type.Literal("unreviewed"),
    Type.Literal("requested"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
  requestedBy: Type.String(),
  requestedAt: Type.String(),
  decidedBy: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
  comment: Type.Union([Type.String(), Type.Null()]),
});

export const TicketDetailSchema = Type.Object({
  ticket: TicketSchema,
  comments: Type.Array(CommentSchema),
  review: ReviewStateSchema,
  blockers: Type.Array(TicketRefSchema),
  blockedBy: Type.Array(TicketRefSchema),
  children: Type.Array(TicketRefSchema),
  parent: Type.Union([TicketRefSchema, Type.Null()]),
});

export const SprintSchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  name: Type.String(),
  plannedStart: Type.Union([Type.String(), Type.Null()]),
  plannedEnd: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([
    Type.Literal("planned"),
    Type.Literal("active"),
    Type.Literal("completed"),
  ]),
  activatedAt: Type.Union([Type.String(), Type.Null()]),
  completedAt: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.String(),
  createdAt: Type.String(),
});

export const SprintMemberSchema = Type.Object({
  ticketId: Type.String(),
  addedAt: Type.String(),
  addedBy: Type.String(),
  removedAt: Type.Union([Type.String(), Type.Null()]),
});

export const MetricsSchema = Type.Object({
  state: Type.Union([Type.Literal("active"), Type.Literal("completed")]),
  asOf: Type.String(),
  intervalStart: Type.String(),
  intervalEnd: Type.String(),
  velocity: Type.Integer(),
  throughput: Type.Integer(),
  completedPerDay: Type.Record(Type.String(), Type.Integer()),
  burndown: Type.Array(
    Type.Object({
      day: Type.String(),
      pointsRemaining: Type.Integer(),
    }),
  ),
  leadTimes: Type.Record(Type.String(), Type.Integer()),
  cycleTimes: Type.Record(Type.String(), Type.Integer()),
});

export const ActivityEntrySchema = Type.Object({
  id: Type.String(),
  projectId: Type.String(),
  seq: Type.Integer(),
  occurredAt: Type.String(),
  actorUserId: Type.String(),
  actorDisplayName: Type.String(),
  actorAutomationId: Type.Union([Type.String(), Type.Null()]),
  type: Type.String(),
  targetType: Type.Union([Type.String(), Type.Null()]),
  targetId: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

export const AuditEntrySchema = Type.Object({
  id: Type.String(),
  requestId: Type.String(),
  occurredAt: Type.String(),
  actorUserId: Type.Union([Type.String(), Type.Null()]),
  actorAutomationId: Type.Union([Type.String(), Type.Null()]),
  actorKeyId: Type.Union([Type.String(), Type.Null()]),
  clientHeader: Type.Union([Type.String(), Type.Null()]),
  operation: Type.String(),
  targetType: Type.Union([Type.String(), Type.Null()]),
  targetId: Type.Union([Type.String(), Type.Null()]),
  result: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
  detail: Type.Union([Type.String(), Type.Null()]),
});

export const CapabilitiesSchema = Type.Object({
  serverVersion: Type.String(),
  apiVersion: Type.Integer(),
  actor: Type.Object({
    userId: Type.String(),
    displayName: Type.String(),
    email: Type.String(),
    isInstanceAdmin: Type.Boolean(),
    isInstanceOwner: Type.Boolean(),
  }),
  credential: Type.Object({
    kind: Type.Union([
      Type.Literal("session"),
      Type.Literal("key"),
      Type.Literal("automation"),
    ]),
    keyId: Type.Union([Type.String(), Type.Null()]),
    automationId: Type.Union([Type.String(), Type.Null()]),
    scope: Type.Union([
      Type.Literal("project"),
      Type.Literal("instance"),
      Type.Literal("session"),
    ]),
    projectId: Type.Union([Type.String(), Type.Null()]),
  }),
  client: Type.Object({
    header: Type.Union([Type.String(), Type.Null()]),
  }),
  effectiveScope: Type.Union([
    Type.Literal("instance"),
    Type.Literal("project"),
    Type.Literal("none"),
  ]),
  accessibleProjects: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      role: Type.Union([Type.Literal("owner"), Type.Literal("member")]),
    }),
  ),
  features: Type.Array(Type.String()),
});

export function paged<S extends TSchema>(schema: S) {
  return Type.Object({
    items: Type.Array(schema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  });
}

export { Type };
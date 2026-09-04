# Issue tracker: Triathlon

Issues and specs for this repo live as tickets in one Triathlon project. Use the Triathlon agent gateway's `tickets.*` tools for all operations.

## Connection and project scope

Require these environment variables:

- `TRI_AGENT_URL`: the gateway endpoint ending in `/agent/v1`
- `TRI_AGENT_KEY`: the bearer token; keep it secret and out of output, commits, and ticket bodies
- `TRI_PROJECT_ID`: the expected project ID for write-scope verification

Before the first operation, call `system.describe` and require version `2.0`. Then call `projects.getSummary` and require its `projectId` to equal `TRI_PROJECT_ID`. Stop before any write when either check fails.

Gateway calls are `POST $TRI_AGENT_URL` with `Authorization: Bearer $TRI_AGENT_KEY`, `Content-Type: application/json`, and this body:

```json
{
  "tool": "tickets.list",
  "args": {},
  "requestId": "unique-id-for-this-call"
}
```

Read the operation result from an `{ "ok": true, "result": ... }` response. Treat a non-2xx response or `{ "ok": false }` as a failed operation and report its error code and request ID.

## Ticket operations

- **Board and discovery**: `tickets.board`, `tickets.list`, and `tickets.frontier`
- **Read one ticket**: `tickets.get` with `ticketId`
- **Create**: `tickets.create` with `columnName` or `columnId`, plus the ticket fields
- **Edit and claim**: `tickets.update`; assignment uses `assigneeExternalId`
- **Move**: `tickets.move` with `toColumnName` or `toColumnId`
- **Discuss and resolve**: `tickets.comment` and `tickets.close`; closing requires a substantive `comment`
- **Blocking**: `tickets.addBlockedBy` and `tickets.removeBlockedBy` with the blocked `ticketId` and its `blockerId`
- **Review**: `tickets.requestReview`, `tickets.approveReview`, and `tickets.rejectReview`
- **Sprint attachment**: `tickets.attachToSprint`
- **Delete**: `tickets.delete`

Ticket `number` is the human-facing project number. Tool arguments named `ticketId` or `blockerId` require the opaque ID returned by Triathlon. When given only `#<number>`, call `tickets.list`, select the exact matching `number`, then use that ticket's `_id`. Never substitute the number for an ID.

## When a skill says "publish to the issue tracker"

Call `tickets.create` with `columnName: "Backlog"`. Put the requested title in `title`, the complete spec or issue body in `description`, and carry across relevant labels, priority, and story points. Return both the created ticket's `number` and `ticketId` to the calling workflow.

## When a skill says "fetch the relevant ticket"

Resolve a supplied `#<number>` through `tickets.list` when necessary, then call `tickets.get` with the opaque `ticketId`. Use its ticket, comments, and relationship data as the full tracker context.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one Triathlon ticket with **child** tickets associated by labels and a context pointer.

- **Map**: call `tickets.create` in Backlog with label `wayfinder:map`. Its description carries the Notes / Decisions-so-far / Fog sections.
- **Child**: call `tickets.create` in Backlog with labels `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`) and `wayfinder:map-<map-number>`. Start its description with `Part of #<map-number>`.
- **Blocking**: call `tickets.addBlockedBy` with the child as `ticketId` and the prerequisite as `blockerId`. Remove the same edge with `tickets.removeBlockedBy`.
- **Frontier**: call `tickets.frontier`, then keep tickets carrying both the map label `wayfinder:map-<map-number>` and a `wayfinder:<type>` label. The gateway has already excluded closed, assigned, and open-blocked tickets and ordered the remainder by number; the first retained ticket wins.
- **Claim**: resolve the driving developer's `externalId` with `projects.members`, then call `tickets.update` with that value as `assigneeExternalId`. This is the session's first write. Ask the human when the driving developer is ambiguous.
- **Resolve**: call `tickets.close` with the answer as its closing `comment`. Then fetch the map, append a compact context pointer to its Decisions-so-far section, and persist the updated description with `tickets.update`.

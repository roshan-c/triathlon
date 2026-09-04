# Issue tracker: Triathlon

This repository tracks work as tickets in the Triathlon project. Use the Triathlon agent gateway and its `tickets.*` tools for issue discovery, creation, updates, comments, blocking relationships, reviews, and closure.

## Connection

The production gateway for this repository is:

```text
TRI_AGENT_URL=https://wry-meadowlark-759.eu-west-1.convex.site/agent/v1
TRI_PROJECT_ID=js7aek8j2g7sjzw23e6k4x6kxx85cqde
```

Set `TRI_AGENT_KEY` in the local environment or `.env` file. It is a bearer credential and must never be committed, printed, or copied into ticket descriptions.

Before any write:

1. Call `system.describe` and require gateway version `2.0`.
2. Call `projects.getSummary` and require its `projectId` to equal `TRI_PROJECT_ID`.
3. Stop if either check fails.

Gateway requests are `POST` requests to `TRI_AGENT_URL` with the bearer key and a JSON body containing `tool`, `args`, and a unique `requestId`. Treat non-2xx responses and `{ "ok": false }` responses as failures; preserve the returned error code and request ID in the report.

## Ticket operations

- Discovery: `tickets.board`, `tickets.list`, and `tickets.frontier`
- Read: `tickets.get` with the opaque `ticketId`
- Create: `tickets.create` in the `Backlog` column
- Edit and claim: `tickets.update` with `assigneeExternalId`
- Move: `tickets.move`
- Discuss and resolve: `tickets.comment` and `tickets.close`
- Blocking: `tickets.addBlockedBy` and `tickets.removeBlockedBy`
- Review: `tickets.requestReview`, `tickets.approveReview`, and `tickets.rejectReview`
- Sprint attachment: `tickets.attachToSprint`

Ticket numbers are human-facing. Resolve `#<number>` through `tickets.list` and use the returned opaque `_id` for operations that require `ticketId` or `blockerId`.

When a skill says to publish to the issue tracker, create the ticket in `Backlog`, include the complete description and acceptance criteria, and return both its human-facing number and opaque ID.

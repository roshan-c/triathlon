# THIS WAS 100% VIBE CODED. I NEEDED IT FOR ONE PROJECT AND DIDN'T WANT TO PUT ANY TIME INTO IT. NO I HAVEN'T READ THE CODE AT ALL. I DON'T CARE. IT'S A TOOL. IT WORKS REALLY WELL.

# Triathlon

Triathlon is a lightweight Trello + Jira alternative for small teams, built with Vinext, Convex, and Better Auth.

It includes:

- Kanban board with drag-and-drop
- Sprint planning
- Agile metrics (velocity, burndown, throughput, cycle/lead time)
- Project whiteboard
- Agent gateway + CLI (`tri`) for automation

---

## Tech stack

- **Frontend:** Vinext, React, TypeScript, Tailwind
- **Backend:** Convex (queries/mutations + realtime)
- **Auth:** Better Auth (email/password, cookie sessions)
- **UI libs:** dnd-kit, Recharts, Excalidraw

---

## Core features

- Email/password auth
- Multi-project workspace (`?projectId=...` URL scoping)
- Project creation restricted to owner/admin users
- Default board columns on project creation:
  - Backlog, Todo, In Progress, Review, Done
- Ticket CRUD + drag movement tracking (`TicketEvent`)
- Review gate: tickets must be approved before moving to Done
- Sprint create / activate / complete
- Metrics dashboard + whiteboard

---

## Local development

### 1) Install

```bash
npm install
```

### 2) Start Convex dev (in terminal A)

```bash
npm run convex:dev
```

### 3) Configure frontend env (`.env.local`)

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_CONVEX_URL=<from convex dev>
NEXT_PUBLIC_CONVEX_SITE_URL=<same deployment, but .convex.site>
```

### 4) Configure Convex env

```bash
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "<long-random-secret>"
```

Optional: allowlisted admins for project creation

```bash
npx convex env set PROJECT_ADMIN_EXTERNAL_IDS_JSON '["<better-auth-user-id>"]'
```

### 5) Generate auth schema (only when auth options change)

```bash
npm run auth:generate
```

### 6) Generate Convex bindings

```bash
npm run convex:codegen
```

### 7) Start app (terminal B)

```bash
npm run dev
```

---

## Production deployment (Cloudflare + Convex)

### Convex

```bash
npx convex env set SITE_URL https://<your-domain>
npx convex env set BETTER_AUTH_SECRET "<prod-secret>"
```

### Frontend

Set the production public vars in the repository's ignored `.env` file (the
development `.env.local` must keep pointing at your local/dev deployment):

- `NEXT_PUBLIC_SITE_URL=https://<your-domain>`
- `NEXT_PUBLIC_CONVEX_URL_PROD=https://<prod-deployment>.convex.cloud`
- `NEXT_PUBLIC_CONVEX_SITE_URL_PROD=https://<prod-deployment>.convex.site`

Deploy through the Make target so those production values are injected into
the client bundle:

```bash
make deploy
```

Avoid invoking `npm run deploy:prod` directly when `.env.local` points at a
development deployment; public `NEXT_PUBLIC_*` values are embedded at build
time.

---

## Smoke test checklist

1. Open `/auth` and sign in
2. If owner/admin, create a project
3. Confirm redirect to `/dashboard?projectId=...`
4. Confirm board columns exist
5. Create and move a ticket; refresh and verify persistence
6. Open Metrics and Whiteboard pages

---

## Triathlon CLI (`tri`)

The CLI wraps the same agent gateway and is built for both humans and agents.

### Required env

- `TRI_AGENT_URL` (must point to `/agent/v1`)
- `TRI_AGENT_KEY` (from `AGENT_KEYS_JSON`)
- `TRI_PROJECT_ID` (safety check against key scope)

Example:

```bash
TRI_AGENT_URL=https://<deployment>.convex.site/agent/v1
TRI_AGENT_KEY=sk_live_...
TRI_PROJECT_ID=<projectId>
```

### Install globally from this repo

```bash
npm install -g .
```

### Quick usage

```bash
tri doctor
tri project summary
tri tickets board --json
```

### Common commands

```bash
tri tickets create --title "Define agent goals" --column-name Backlog --points 3 --priority high
tri tickets move --id <ticketId> --to-column-name "In Progress"
tri tickets request-review --id <ticketId>
tri tickets approve-review --id <ticketId>
tri tickets reject-review --id <ticketId>
tri tickets delete --id <ticketId>          # prompts
tri tickets delete --id <ticketId> --force  # no prompt
tri sprints list
tri metrics velocity
```

Use `--json` on any command for machine-readable output.

---

## Agent gateway API (`/agent/v1`)

Server-to-server endpoint for automation (whiteboard excluded).

- **Endpoint:** `POST https://<convex-site-url>/agent/v1`
- **Auth:** `Authorization: Bearer <agent-key>`
- **Config env:** `AGENT_KEYS_JSON`

Each key is scoped to one project via `projectId`.

### `AGENT_KEYS_JSON` example

```json
[
  {
    "keyId": "agent-main",
    "key": "sk_live_...",
    "keyLabel": "primary-agent",
    "projectId": "<convex-project-id>",
    "externalId": "<user-external-id>",
    "enabled": true
  }
]
```

### Request shape

```json
{
    "tool": "tickets.create",
  "args": {
    "columnName": "Backlog",
    "title": "Investigate dashboard flow",
    "description": "Verify project switching keeps metrics scoped",
    "storyPoints": 2,
    "priority": "medium"
  },
  "requestId": "req-001"
}
```

### Response shape

```json
{
  "ok": true,
  "requestId": "req-001",
  "result": "<tool-result>"
}
```

### Review workflow

Tickets must be approved before moving to Done:

1. Create or update a ticket
2. Call `tickets.requestReview` when ready
3. Reviewer calls `tickets.approveReview` or `tickets.rejectReview`
4. Only approved tickets can move to Done via `tickets.move`

Errors:

- `REVIEW_REQUIRED` — ticket is awaiting review
- `REVIEW_REJECTED` — ticket was rejected; re-request after fixes

### Allowed tools

- `system.describe`
- `projects.getSummary`
- `projects.members`
- `tickets.board`
- `tickets.list`
- `tickets.get`
- `tickets.create`
- `tickets.update`
- `tickets.move` (`toColumnId` or `toColumnName`)
- `tickets.comment`
- `tickets.close`
- `tickets.frontier`
- `tickets.addBlockedBy`
- `tickets.removeBlockedBy`
- `tickets.delete`
- `tickets.attachToSprint`
- `tickets.requestReview`
- `tickets.approveReview`
- `tickets.rejectReview`
- `sprints.list`
- `sprints.create`
- `sprints.activate`
- `sprints.complete`
- `metrics.forSprint`
- `metrics.velocityHistory`

---

## License

Triathlon is released under the MIT License.

## Acknowledgments

- [Excalidraw](https://excalidraw.com) — MIT licensed whiteboard library.

## Skill package

A reusable skill manifest is included at:

- `skills/triathlon-agent/SKILL.md`

Use this for skill-capable agent runtimes that should operate Triathlon safely and consistently.

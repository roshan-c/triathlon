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
- Card CRUD + drag movement tracking (`CardEvent`)
- Review gate: cards must be approved before moving to Done
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

Set public vars to production values:

- `NEXT_PUBLIC_SITE_URL=https://<your-domain>`
- `NEXT_PUBLIC_CONVEX_URL=https://<prod-deployment>.convex.cloud`
- `NEXT_PUBLIC_CONVEX_SITE_URL=https://<prod-deployment>.convex.site`

Then deploy:

```bash
npm run deploy:prod
```

---

## Smoke test checklist

1. Open `/auth` and sign in
2. If owner/admin, create a project
3. Confirm redirect to `/dashboard?projectId=...`
4. Confirm board columns exist
5. Create and move a card; refresh and verify persistence
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
tri board snapshot --json
```

### Common commands

```bash
tri cards create --title "Define agent goals" --column-name Backlog --points 3 --priority high
tri cards move --id <cardId> --to-column-name "In Progress"
tri cards request-review --id <cardId>
tri cards approve-review --id <cardId>
tri cards reject-review --id <cardId>
tri cards delete --id <cardId>          # prompts
tri cards delete --id <cardId> --force  # no prompt
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
  "tool": "boards.createCard",
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

Cards must be approved before moving to Done:

1. Create or update a card
2. Call `boards.requestReview` when ready
3. Reviewer calls `boards.approveReview` or `boards.rejectReview`
4. Only approved cards can move to Done via `boards.moveCard`

Errors:

- `REVIEW_REQUIRED` — card is awaiting review
- `REVIEW_REJECTED` — card was rejected; re-request after fixes

### Allowed tools

- `system.describe`
- `projects.getSummary`
- `projects.members`
- `boards.getSnapshot`
- `boards.createCard`
- `boards.updateCard`
- `boards.moveCard` (`toColumnId` or `toColumnName`)
- `boards.deleteCard`
- `boards.attachCardToSprint`
- `boards.requestReview`
- `boards.approveReview`
- `boards.rejectReview`
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

# Triathlon

Triathlon is a small-team work tracker with a self-hosted TypeScript backend. The backend is the product: it owns identity, projects, tickets, sprints, audit history, access keys, automation actors, and a versioned HTTP API. The included web app, CLI, and future interfaces all use the same `/api/v1` API.

V2 is intentionally a single-node deployment. It uses SQLite in WAL mode and targets a Raspberry Pi 4B serving a team of roughly six or seven people. There is no Convex dependency, whiteboard, or separate agent gateway, and there is no data migration from the old implementation.

## Repository layout

- `apps/server` — Fastify API, Better Auth, SQLite migrations, domain modules, operations CLI.
- `packages/client` — generated TypeScript client from the checked-in OpenAPI document.
- `packages/cli` — `tri`, a remote CLI using the public API.
- `src` — the existing web UI, adapted to the public API. The Whiteboard page is removed.
- `docs/specs` and `docs/adr` — accepted v2 design records.

## Local development

Requirements: Node.js 22+, npm, and a working `better-sqlite3` build environment.

```sh
npm install
cp apps/server/triathlon.yaml.example triathlon.yaml
# Replace auth.secret with a random value of at least 32 characters.

npm run server:dev       # API on http://localhost:8080
npm run dev              # web UI on http://localhost:3000
```

The first server start applies forward migrations. Issue the one-time owner bootstrap code locally:

```sh
npm run build -w @triathlon/server
node apps/server/dist/index.js init --config ./triathlon.yaml
```

Use the printed code at `/onboarding`. Registration after bootstrap is invite-only. Project invitations can be used as a code or shareable URL; both resolve through the same API.

For a container deployment:

```sh
TRI_AUTH_SECRET="$(openssl rand -base64 32)" docker compose up --build
```

Compose persists the SQLite database and verified backups in named volumes. TLS should be terminated by a trusted reverse proxy.

## Configuration

The server reads `triathlon.yaml` and accepts individual `TRI_*` environment overrides. See [`apps/server/triathlon.yaml.example`](apps/server/triathlon.yaml.example) and [`.env.example`](.env.example). Important settings include:

- `TRI_DATABASE_PATH` — SQLite database path.
- `TRI_AUTH_SECRET` — Better Auth secret, at least 32 characters.
- `TRI_TRUSTED_ORIGINS` — comma-separated browser origins allowed to use cookie sessions.
- `TRI_INSTANCE_WIDE_KEY_MAX_TTL_DAYS` — maximum instance-key lifetime; the default is 90 days.
- `TRI_BACKUP_*` — backup directory, enablement, and daily/weekly retention.

## API and clients

The OpenAPI document is available at `apps/server/openapi.json`; the server can expose interactive API documentation when `docs.enabled` is true. All clients use the same resource and command endpoints, cookie sessions, or bearer access keys. Keys can be project-scoped or instance-wide, and automation-owned keys are represented as their own audit actor while inheriting the owning user's project permissions.

Generate the client after changing route schemas:

```sh
npm run generated
```

Build and use the remote CLI:

```sh
npm run cli:build
TRI_URL=http://localhost:8080 TRI_KEY=tri_... TRI_PROJECT_ID=<project-id> npm run tri -- doctor
npm run tri -- tickets board
```

The CLI supports JSON output with `--json`, and uses generated idempotency keys for retryable writes. MCP is deliberately deferred; an adapter can be added later without creating a second business-logic gateway.

## Useful commands

```sh
npm run typecheck
npm run build
npm run server:test
npm run lint -w @triathlon/server
npm run generated
make server
make server-test
make tri ARGS="tickets list"
```

Operational commands are built into `apps/server`:

```sh
node apps/server/dist/index.js backup --config ./triathlon.yaml
node apps/server/dist/index.js integrity --config ./triathlon.yaml
node apps/server/dist/index.js restore --from ./backups/triathlon-manual-...db --config ./triathlon.yaml
```

Backups use SQLite's online backup API, are integrity-checked, and are retained by the configured scheduled daily/weekly policy. Restore requires the server process to be stopped.

## Design constraints

The API uses UUIDv7 resource identifiers and sequential human-facing ticket numbers. Mutating commands are atomic, auditable, idempotent where a request key is accepted, and protected by resource-version checks where concurrent edits can lose data. Activity is immutable and remains available in audit/history views after soft deletion and permanent resource purges. Members can work on tickets and sprints and create project-scoped keys; only project owners administer their project, while instance administrators manage instance-wide administration.

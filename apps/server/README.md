# @triathlon/server

The Triathlon v2 backend: a self-hosted, single-node work tracker for small
teams. One server process, one SQLite database. The HTTP API at `/api/v1` is
the product — the web UI, the CLI, and automations are clients of it.

## Quick start

```sh
npm install
npm run build

# Migrate and serve (migrations run automatically on serve by default).
node dist/index.js serve --config ./triathlon.yaml

# Or step by step:
node dist/index.js migrate --config ./triathlon.yaml
node dist/index.js serve --no-migrate --config ./triathlon.yaml

# First-run setup: issue the one-time owner bootstrap code.
node dist/index.js init --config ./triathlon.yaml
```

Bootstrap: `POST /api/v1/bootstrap/redeem` with the code (or the printed
setup URL). Redeeming creates the Instance Owner and permanently closes
bootstrap registration.

## Configuration

`triathlon.yaml` (see `triathlon.yaml.example`) with `TRI_*` environment
overrides; `triathlon config` prints the resolved configuration. The server
runs without any external services.

## Commands

| Command | Purpose |
|---|---|
| `serve` | Migrate (unless `--no-migrate`) and serve HTTP. |
| `migrate` / `migrate --check` | Apply forward migrations / verify only. |
| `config` | Print resolved configuration (secrets redacted). |
| `init` | Prepare the database and issue the owner bootstrap code. |
| `write-openapi` (script) | Regenerate the checked-in `openapi.json`. |

## Layout

```text
src/
  config.ts            YAML + env configuration (TypeBox-validated)
  time.ts / ids.ts     clock, timezone, and identifier dependencies
  db/                  SQLite (WAL, FK), ordered migrations, Kysely types
  domain/
    tx.ts              one-transaction command runner (activity + audit +
                       idempotency + event sequence)
    identity.ts        users, bootstrap, sessions, keys, automations,
                       invitations, audit
    projects.ts        projects, ownership, membership, columns, roles
    work.ts            tickets, ordering, review, resolve/reopen, frontier
    planning.ts        sprints, membership, provisional metrics, snapshots
  http/                Fastify adapter: auth, routes, error envelope, SSE
  maintenance.ts       in-process cleanup of expired records
```

Tests run with `npm test` (node:test + tsx, real isolated SQLite databases).
`npm run typecheck` and `npm run lint` gate the repository.
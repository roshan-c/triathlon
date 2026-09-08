# Triathlon v2 implementation handoff

## Objective

Continue the accepted v2 rebuild in [`docs/specs/2026-09-07-v2-backend-design.md`](docs/specs/2026-09-07-v2-backend-design.md). The backend is the product: a self-hosted TypeScript/Fastify/SQLite service targeting a Raspberry Pi 4B and teams of at most seven people. All clients use one `/api/v1` API. The existing web UI is preserved except for Whiteboard. Convex and the separate Agent gateway are removed. There is intentionally no Convex data migration.

Preserve the user's existing [`PAPERCUTS.md`](PAPERCUTS.md) modification. It predates this work and must not be edited or committed with the implementation.

## Decisions already accepted

- SQLite first; discuss PostgreSQL only if SQLite becomes insufficient.
- UUIDv7 entity IDs and sequential, never-reused ticket numbers.
- One board per project; no archived projects in the v2 model.
- Instance Admins create projects. Project owners can rename/delete/restore, manage columns and invitations, and transfer/recover ownership. Members can create project keys, edit tickets, move their position, and manage sprint participation, but cannot administer the project.
- Owner and member are the only project roles. A user may review their own ticket for convenience.
- Human users are the primary actors. Automations are separate audit actors but inherit their owner's project permissions; tickets display the owning person, while audit entries retain the automation identity.
- Project access keys are supported. Instance-wide keys are owner/admin controlled and expire after 90 days. Agent and CLI requests may use the same keys and are distinguished by request headers. MCP is deferred.
- Invitations are represented by redeemable invite codes/shareable URLs with expiry and revocation.
- Ticket close requires an approved review and an outcome comment. Reopening invalidates approval. Activity is immutable and records meaningful before/after values.
- Deleted resources are soft-deleted. Instance Owner-only permanent purge is supported where specified; audit/activity history remains immutable.
- Explicit atomic operations are preferred. No second frontend product is required in this version.

## Completed

### Backend and API

- Replaced the Convex data layer with an explicit Fastify/SQLite backend under `apps/server`.
- Added domain modules for identity, projects, work, planning, audit/activity, SSE events, access keys, invitations, review, sprints, metrics, backup, restore, and integrity checks.
- Added ordered forward migrations, including Better Auth tables, persistent rate limits, permanent Activity history, schema compatibility checks, and database-level migration locking for simultaneous SQLite startup.
- Added generated OpenAPI at `apps/server/openapi.json` and the reusable `packages/client` TypeScript HTTP client.
- Public error responses use the Problem Details-style `{ error: { status, code, message, requestId } }` envelope. Better Auth non-2xx responses are normalized to that contract.
- SSE replay is served through the domain service rather than direct database access. Public Activity/SSE payloads do not expose automation identity; audit does.
- Command Activity guarantees `before` and `after` and now supplies operation-specific values for project, membership, column, ticket, review, sprint, and purge/lifecycle changes.
- Added persistent login/invitation/reset/bootstrap rate limiting and tests for suspended sign-in and 429 `RATE_LIMITED` responses.

### Authentication and onboarding

- Better Auth is mounted at `/api/auth/*` and uses the same SQLite database.
- Registration is invite-only and atomically creates the Better Auth account, domain user, and project membership.
- Bootstrap remains a local `triathlon init` flow. The remotely callable bootstrap-code endpoint is gone.
- Password reset, session invalidation, sign-out, password change, and audit semantics are covered by the current server tests.

### Operations and distribution

- Added `triathlon backup`, `triathlon restore`, and `triathlon integrity`.
- Added scheduled daily/weekly online backups with date-keyed names and exact-prefix retention pruning; defaults are seven daily and four weekly copies.
- Startup only creates a pre-migration backup when migrations are actually pending.
- Added `apps/server/Dockerfile`, `.dockerignore`, `compose.yaml`, server CI, and multi-architecture release workflows.
- Added `packages/cli`, a remote `tri` executable using the same API. It supports capability/project discovery, JSON output, idempotency keys, stable exit-code categories, ticket/sprint operations, and metrics.
- The server package has a `files` allowlist and was verified as a direct `npm pack` artifact. It intentionally remains private because it is distributed as a direct artifact rather than published to a registry.

### Frontend cutover

- Removed Convex, Convex Better Auth, the old gateway/worker, old `src/cli`, Excalidraw/Whiteboard, and the old `src/lib/convex.ts` path.
- Rewired the existing UI to `src/lib/api.ts`, a single adapter around `@triathlon/client`.
- The adapter preserves legacy UI shapes (`_id`, `storyPoints`, numeric timestamps, `status`, etc.), sends expected resource versions, handles review/resolve flows, and invalidates project data from named SSE events.
- Invite code is collected on signup. Authentication points at the self-hosted server. The board dependency graph reconstructs visible blocker edges through the public API.
- Root README, `.env.example`, Makefile, and active agent issue-tracker docs describe the self-hosted API. Historical specs/ADRs remain historical records.

### Module boundaries

- Cross-module seams now use an opaque `DomainTransaction` handle. Kysely/SQLite types remain internal to domain implementations and adapters.
- Fixed-point standards/spec review hardening is applied: instance-wide keys cannot perform instance administration, project-scoped keys inherit only their owner's project permissions, ticket positions remain contiguous across same-column moves and lifecycle changes, and metric closes use completion-time points/revisions plus current approval/Done checks.
- The frontend adapter now maps review/sprint state, reconstructs blocker relationships with the correct direction, handles explicit reopen confirmation, and keeps named SSE subscriptions reconnectable. Public transport fixes also cover atomic multi-field PATCH validation, replay beyond 1,000 events, fail-closed CORS, board snapshot bounds, and normalized Better Auth errors.
- Added interactive Swagger UI at `/docs` when documentation is enabled.

## Validation completed

The current implementation has passed:

```text
npm test -w @triathlon/server                 58 passed, 0 failed
npm run typecheck -w @triathlon/server        passed
npm run lint -w @triathlon/server             passed
npm run build -w @triathlon/server            passed
npm run typecheck -w @triathlon/client        passed
npm run build -w @triathlon/client            passed
npm run build -w @triathlon/cli               passed
npm run generated                              passed
npm run typecheck                              passed
npm run lint                                   passed
npm run build                                  passed
npm pack --workspace @triathlon/server        dry-run and install smoke passed
docker compose config                          passed with a test TRI_AUTH_SECRET
docker compose build                           passed through OrbStack (arm64/linux)
temporary container smoke                      readiness/live/docs passed; migrations applied
```

The server test suite includes the simultaneous-start migration regression. The generated OpenAPI/client artifacts were regenerated after route changes.

## Remaining work / honest limitations

1. Run the final full validation after the last handoff/client changes, including server tests, all builds, `git diff --check`, and generated-artifact checks.
2. The ARM64 image and temporary container smoke have passed through OrbStack. A physical Raspberry Pi 4B smoke has not been run; the local image was built as `arm64/linux`.
3. A running-server smoke should exercise `tri doctor` and one complete ticket lifecycle, including review, resolve, reopen, and API-key access.
4. Browser/UI end-to-end testing has not been run. In particular, verify the Reopen confirmation UX and named SSE invalidation against a running server. The adapter keeps the UI's transport boundary but uses a small amount of legacy `any` at that boundary.
5. Review whether the legacy `sessions` table and `users.password_hash` columns from `0001-init` should remain as inert compatibility schema or be removed in a future forward migration. They are not used by Better Auth.
6. Historical `docs/superpowers/specs/2026-04-28-trui-tui-design.md` still mentions the old stack by design. Update it only if historical documentation cleanup is explicitly wanted.

## Worktree and handoff rules

- The prior implementation baseline is commit `ee38427` on branch `dev`.
- Do not overwrite or stage the user's `PAPERCUTS.md` change.
- Inspect `git status --short` before editing. The implementation may be committed by the current agent; if not, stage only implementation files and leave `PAPERCUTS.md` unstaged.
- Do not reintroduce Convex, Whiteboard, Excalidraw, Cloudflare Worker, or a separate Agent gateway.
- Keep TS, SQLite, explicit composition, bounded queries, and the single-node Raspberry Pi constraint.

## Resume checks

```bash
git status --short
npm test -w @triathlon/server
npm run typecheck -w @triathlon/server
npm run lint -w @triathlon/server
npm run build -w @triathlon/server
npm run generated
npm run typecheck
npm run lint
npm run build
git diff --check
```

Completion means the API remains the single backend product, the existing UI runs through it without Convex, the accepted spec has no unaccounted requirement, and deployment limitations are recorded honestly.

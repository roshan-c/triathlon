# Triathlon v2 testing guide

This guide is for manually testing the self-hosted v2 backend and the preserved web UI. It assumes a clean local instance. V2 intentionally has no migration from the old Convex data.

The examples use port 18080 because port 8080 is occupied by another local service. Change it to 8080 if that port is free.

## 1. Start the local instance

Requirements:

- OrbStack
- Node.js 22+
- npm
- curl, jq, and openssl

In Terminal 1:

~~~sh
cd /Users/roshan/Documents/DDD/Group\ Project/triathlon
orb start
docker context show
docker info --format '{{.ServerVersion}}'

export TRI_HTTP_PORT=18080
export TRI_BASE_URL="http://localhost:$TRI_HTTP_PORT"
export TRI_TRUSTED_ORIGINS=http://localhost:3000
export TRI_SESSION_SECURE=false
export TRI_AUTH_SECRET="$(openssl rand -hex 32)"

docker compose up -d --build
docker compose ps
~~~

The server is now available at $TRI_BASE_URL. Check it:

~~~sh
export API="$TRI_BASE_URL"
curl --fail --silent "$API/api/v1/health/live" | jq
curl --fail --silent "$API/api/v1/health/ready" | jq
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' "$API/docs/"
~~~

Expected results are {"status":"ok"} for both health endpoints and HTTP 200 for /docs/.

Useful operational commands:

~~~sh
docker compose logs -f triathlon
docker compose exec triathlon node apps/server/dist/index.js config --config /app/triathlon.yaml
docker compose exec triathlon node apps/server/dist/index.js migrate --check --config /app/triathlon.yaml
~~~

## 2. Create the first owner

The first owner is created through a one-time local bootstrap code. Generate it inside the running container:

~~~sh
docker compose exec triathlon node apps/server/dist/index.js init --config /app/triathlon.yaml
~~~

Copy the printed Code value, then redeem it:

~~~sh
export BOOTSTRAP_CODE='paste-the-code-here'
export OWNER_EMAIL='owner@example.com'
export OWNER_PASSWORD='password12345'

curl --fail --silent \
  -c owner.cookies \
  -H 'Content-Type: application/json' \
  -H "Origin: $TRI_TRUSTED_ORIGINS" \
  -d "$(jq -n \
    --arg code "$BOOTSTRAP_CODE" \
    --arg email "$OWNER_EMAIL" \
    --arg password "$OWNER_PASSWORD" \
    '{code:$code,email:$email,displayName:"Instance Owner",password:$password}')" \
  "$API/api/v1/bootstrap/redeem" | tee owner.json | jq
~~~

The response should contain the owner user and owner.cookies should contain a session cookie. Confirm bootstrap is closed:

~~~sh
curl --fail --silent "$API/api/v1/bootstrap" | jq
curl --fail --silent -b owner.cookies "$API/api/v1/capabilities" | jq
~~~

Expected: open is false, the actor is an Instance Owner, and credential.kind is session.

## 3. Start the preserved web UI

In Terminal 2:

~~~sh
cd /Users/roshan/Documents/DDD/Group\ Project/triathlon
NEXT_PUBLIC_TRIATHLON_URL="$API" npm run dev -- --host 0.0.0.0 --port 3000
~~~

Open http://localhost:3000/auth, log in with the owner credentials, and use the UI for the browser checks below. The UI uses the self-hosted API; it does not use Convex.

If port 3000 is occupied, use another port and include that origin in TRI_TRUSTED_ORIGINS before starting the backend. Restart the backend after changing the trusted-origin setting.

## 4. Create a project and a member

You can create the first project in the web UI at /onboarding, or through the API:

~~~sh
PROJECT_JSON=$(curl --fail --silent \
  -b owner.cookies \
  -H 'Content-Type: application/json' \
  -H "Origin: $TRI_TRUSTED_ORIGINS" \
  -d '{"name":"V2 Manual Test","timezone":"Europe/London"}' \
  "$API/api/v1/projects")
export PROJECT_ID=$(printf '%s' "$PROJECT_JSON" | jq -r '.id')
printf 'PROJECT_ID=%s\n' "$PROJECT_ID"

curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID" | jq
~~~

Create an invitation and register a member:

~~~sh
INVITATION_JSON=$(curl --fail --silent \
  -b owner.cookies \
  -H 'Content-Type: application/json' \
  -H "Origin: $TRI_TRUSTED_ORIGINS" \
  -d '{}' \
  "$API/api/v1/projects/$PROJECT_ID/invitations")
export INVITE_CODE=$(printf '%s' "$INVITATION_JSON" | jq -r '.code')

curl --fail --silent \
  -c member.cookies \
  -H 'Content-Type: application/json' \
  -H "Origin: $TRI_TRUSTED_ORIGINS" \
  -d "$(jq -n \
    --arg code "$INVITE_CODE" \
    '{code:$code,email:"member@example.com",name:"Project Member",password:"password12345"}')" \
  "$API/api/auth/sign-up/email" | tee member.json | jq
~~~

Check roles:

~~~sh
curl --fail --silent -b member.cookies "$API/api/v1/projects/$PROJECT_ID" | jq '.role,.members'
curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID/members" | jq
~~~

## 5. Core browser checklist

Use the owner in the browser first, then repeat member-appropriate actions while logged in as the member.

### Authentication and onboarding

- [ ] Owner can log in and log out.
- [ ] Wrong passwords show a useful error and do not create a session.
- [ ] Registration without an invitation code is rejected.
- [ ] Registration with an invitation code creates a member account.
- [ ] A reused or revoked invitation is rejected.
- [ ] A suspended account cannot log in.
- [ ] Refreshing the browser preserves a valid session.
- [ ] Requests from the configured frontend origin work; an untrusted cookie mutation is rejected.

### Projects and permissions

- [ ] Owner/admin can create a project.
- [ ] Member can see the project but cannot rename, delete, restore, configure columns, or invite users.
- [ ] Owner can rename the project and change its timezone as separate actions.
- [ ] Owner can transfer project ownership to an existing member; the old owner becomes a member.
- [ ] Instance Owner/Admin can recover project ownership.
- [ ] Project deletion hides the project and disables project-scoped keys.
- [ ] Project restoration makes the project visible again.
- [ ] Only the Instance Owner/Admin can permanently purge a deleted project.

### Board and columns

- [ ] The default board contains Backlog, Todo, In Progress, Review, and Done.
- [ ] Owner can add, rename, reorder, and delete columns.
- [ ] A non-empty column cannot be deleted without a destination column.
- [ ] There is always exactly one done column.
- [ ] Moving or recategorizing the Done column requires explicit confirmation where applicable.
- [ ] Member cannot change columns.
- [ ] The whiteboard is absent from navigation and routes.

### Tickets

- [ ] Create tickets with title, description, points, priority, labels, assignee, parent, and blockers.
- [ ] Ticket numbers are sequential within the project.
- [ ] Ticket numbers are not reused after deletion.
- [ ] Edit title, description, points, priority, labels, assignee, and parent.
- [ ] Move tickets within a column and between open columns; positions remain contiguous.
- [ ] Moving an open ticket directly into Done is rejected; use Resolve.
- [ ] Add and remove blockers; cycles and self-links are rejected.
- [ ] Add comments and verify comments are immutable.
- [ ] Request review and approve a ticket, including self-review.
- [ ] Rejecting review requires a comment.
- [ ] Resolve requires current approval and an outcome comment.
- [ ] Resolve moves the ticket to Done and records completion data.
- [ ] Reopen requires explicit intent, moves the ticket out of Done, and invalidates approval.
- [ ] Material ticket edits invalidate an old approval; comments and sprint assignment do not.
- [ ] Soft-delete and restore a ticket; verify its position, relationships, sprint history, and review history.
- [ ] Only the Instance Owner/Admin can permanently purge a deleted ticket.
- [ ] Frontier contains open, unassigned tickets whose blockers are all closed.

### Sprints and metrics

- [ ] Create a planned sprint with optional planned dates.
- [ ] Activate it and verify only one active sprint is allowed.
- [ ] Add and remove tickets from the sprint.
- [ ] Change estimates and verify the burndown reflects scope and estimate changes.
- [ ] Resolve qualifying work during the active interval.
- [ ] Verify velocity uses points at completion time, not the ticket's later estimate.
- [ ] Verify throughput, lead time, cycle time, burndown, and completed-per-day values.
- [ ] Complete the sprint and verify its snapshot does not change after later ticket edits.
- [ ] Verify unfinished tickets lose current sprint membership but retain history.
- [ ] Planned sprints can be deleted; completed sprints cannot be rewritten.

## 6. Access keys, automations, and the CLI

Create a project-scoped key as the member. The secret is returned only once:

~~~sh
KEY_JSON=$(curl --fail --silent \
  -b member.cookies \
  -H 'Content-Type: application/json' \
  -H "Origin: $TRI_TRUSTED_ORIGINS" \
  -d "$(jq -n --arg project "$PROJECT_ID" \
    '{name:"member-cli",scope:"project",projectId:$project}')" \
  "$API/api/v1/access-keys")
export PROJECT_KEY=$(printf '%s' "$KEY_JSON" | jq -r '.secret')
export PROJECT_KEY_ID=$(printf '%s' "$KEY_JSON" | jq -r '.key.id')

curl --fail --silent \
  -H "Authorization: Bearer $PROJECT_KEY" \
  -H 'X-Triathlon-Client: cli' \
  "$API/api/v1/capabilities" | jq
~~~

Run the remote CLI through the same API:

~~~sh
npm run cli:build
TRI_URL="$API" TRI_KEY="$PROJECT_KEY" TRI_PROJECT_ID="$PROJECT_ID" \
  npm run tri -- --json doctor

TRI_URL="$API" TRI_KEY="$PROJECT_KEY" TRI_PROJECT_ID="$PROJECT_ID" \
  npm run tri -- tickets list
~~~

Test the following:

- [ ] Project-scoped key works only for its project.
- [ ] Project-scoped key inherits its owner's project permissions.
- [ ] Revoking the key immediately blocks future requests.
- [ ] Create an automation owned by the member.
- [ ] Create an automation-owned project key with ownerType automation and automationId.
- [ ] Use X-Triathlon-Client: agent and verify it changes audit metadata only, not permissions.
- [ ] Ticket activity shows the owning person; the Instance Owner Audit log identifies the automation actor.
- [ ] Transfer automation ownership and verify historical audit attribution is preserved.
- [ ] Create an instance-wide key as an Instance Admin/Owner with an expiry no later than 90 days.
- [ ] Verify an instance-wide key can do ordinary member work across accessible projects but cannot create projects, administer projects, suspend users, transfer ownership, or read Audit.
- [ ] Verify access-key secrets are never returned by list endpoints.

## 7. API and concurrency checklist

Use these commands while the UI is open:

~~~sh
curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID" | jq
curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID/board" | jq
curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID/frontier" | jq
curl --fail --silent -b owner.cookies "$API/api/v1/projects/$PROJECT_ID/activity?limit=10" | jq

curl --fail --silent "$API/api/v1/openapi.json" | jq '.info'
open "$API/docs/"
~~~

Test these API behaviours:

- [ ] Every error uses the public error envelope with status, code, message, and requestId.
- [ ] Missing authentication returns 401; insufficient permission returns 403; missing resources return 404.
- [ ] Invalid JSON/schema input returns 422 with a stable validation code.
- [ ] Resource-version conflicts return 409 and do not overwrite the first writer.
- [ ] Send the same mutating request twice with the same Idempotency-Key; it returns the original result without duplication.
- [ ] Reuse that key with a different body; it returns IDEMPOTENCY_CONFLICT.
- [ ] Paginated ticket, Frontier, Activity, Audit, and closed-ticket queries return nextCursor and continue correctly.
- [ ] Subscribe to SSE and make a ticket/comment/project change in another terminal; an event arrives with sequence, event type, and project ID.
- [ ] Disconnect/reconnect SSE with Last-Event-ID; no events are silently skipped or duplicated.

Quick SSE check:

~~~sh
curl -N \
  -H "Authorization: Bearer $PROJECT_KEY" \
  "$API/api/v1/projects/$PROJECT_ID/events"
~~~

Leave that running and create a ticket in the browser or with the CLI. Stop it with Ctrl-C.

## 8. Operations and recovery

Run database checks inside the container:

~~~sh
docker compose exec triathlon node apps/server/dist/index.js integrity --config /app/triathlon.yaml
docker compose exec triathlon node apps/server/dist/index.js backup \
  --config /app/triathlon.yaml \
  --output /backups/manual-test.db
docker compose exec triathlon ls -lh /backups
~~~

Restore requires the server to be stopped:

~~~sh
docker compose stop triathlon
docker compose run --rm --no-deps --entrypoint node triathlon \
  apps/server/dist/index.js restore \
  --from /backups/manual-test.db \
  --config /app/triathlon.yaml
docker compose start triathlon
curl --fail --silent "$API/api/v1/health/ready" | jq
~~~

Also test:

- [ ] Scheduled daily and weekly backups are created and retention removes only configured old files.
- [ ] Integrity reports ok for a valid database.
- [ ] Restore returns the database to the backed-up state.
- [ ] Two server starts against the same new volume converge on one migration history.
- [ ] Logs include request IDs and do not expose passwords, cookies, bearer keys, invitation codes, or reset codes.
- [ ] Health endpoints expose no private data.

## 9. Useful source-level checks

~~~sh
npm test -w @triathlon/server
npm run typecheck -w @triathlon/server
npm run lint -w @triathlon/server
npm run build -w @triathlon/server
npm run typecheck
npm run lint
npm run build
npm run generated
git diff --check
~~~

## 10. Stop, reset, and clean up

Stop the service but keep the named SQLite and backup volumes:

~~~sh
docker compose down
~~~

Start it again later with the same environment variables. To delete the local test database and backups permanently:

~~~sh
docker compose down -v
~~~

Only run down -v when you intentionally want a fresh instance. It removes the Compose volumes triathlon_triathlon-data and triathlon_triathlon-backups.

Stop the frontend development server with Ctrl-C in its terminal.


---
name: triathlon-agent
description: Operate the Triathlon Agile Board through the Convex agent gateway with project-scoped API keys.
---

# Triathlon Agent Gateway Skill

Use this skill to control the Triathlon board backend over HTTP.

## Preferred interface: Triathlon CLI

If the `tri` CLI is installed globally, use it first.

Required environment:

- `TRI_AGENT_URL` (example: `https://<deployment>.convex.site/agent/v1`)
- `TRI_AGENT_KEY` (Bearer key from `AGENT_KEYS_JSON`)
- `TRI_PROJECT_ID` (expected project id safety check)

Examples:

```bash
tri doctor
tri project summary
tri board snapshot --json
tri cards create --title "Prep sprint review" --column-name Backlog --points 3
```

## HTTP fallback

When CLI is unavailable, call the gateway directly.

## Request format

```json
{
  "tool": "boards.getSnapshot",
  "args": {},
  "requestId": "req-001"
}
```

## Example call

```bash
curl -sS "$TRI_AGENT_URL" \
  -H "Authorization: Bearer $TRI_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tool":"system.describe","args":{},"requestId":"req-describe"}'
```

## Recommended workflow

1. Call `system.describe` to inspect available tools
2. Call `projects.getSummary` to verify project context
3. Call `boards.getSnapshot` to discover column/card IDs
4. Perform actions (`boards.createCard`, `boards.moveCard`, etc.)

## Supported tools

- `system.describe`
- `projects.getSummary`
- `projects.members`
- `boards.getSnapshot`
- `boards.createCard`
- `boards.updateCard`
- `boards.moveCard` (use `toColumnId` or `toColumnName`)
- `boards.deleteCard`
- `boards.attachCardToSprint`
- `sprints.list`
- `sprints.create`
- `sprints.activate`
- `sprints.complete`
- `metrics.forSprint`
- `metrics.velocityHistory`

## Error handling guidance

- `UNAUTHORIZED`: missing/invalid key
- `TOOL_FORBIDDEN`: tool not in allowlist
- `INVALID_ARGS`: payload validation failed
- `TOOL_ERROR`: backend action failed (inspect message)

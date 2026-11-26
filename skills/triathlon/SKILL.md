---
name: triathlon
description: Manage work on the local Markdown-backed Triathlon board via the Triathlon MCP tools or `tri` CLI. Use when picking up ready tickets, updating checklists, proposing follow-up work, or submitting finished work for human review.
---

# Triathlon Agent Workflow

Triathlon stores tickets as Markdown files in `.triathlon/tickets/<ID>.md` and logs every transition in `.triathlon/events.jsonl` for cycle metrics.

Prefer the **Triathlon MCP tools** when connected; otherwise use the `tri` CLI with `--json`.

## Standard Loop

1. **Discover ready work**
   - MCP: `get_ready_tickets` (returns unblocked `todo` tickets sorted by priority).
   - CLI: `tri ready --json`
2. **Inspect & claim a ticket**
   - MCP: `get_ticket`, then `claim_ticket` with your actor identity (e.g. `agent:claude` or `agent:codex`) and branch name if applicable.
   - CLI: `tri show <ID>` then `tri claim <ID> --by agent:<name>`
3. **Track acceptance criteria as you work**
   - MCP: `toggle_checklist_item` (0-based index).
   - CLI: `tri check <ID> <1-based-index> --done --by agent:<name>`
   - Leave concise progress notes with `add_comment` / `tri comment` when something material changes.
4. **Propose follow-up work instead of cluttering the active board**
   - When you spot a worthwhile follow-up or cleanup outside the current ticket's scope, create it with `proposed: true` (`create_ticket` with `proposed: true` or `tri new "..." --proposed --by agent:<name>`). It lands in **Backlog → Needs triage** for the owner to accept or dismiss.
5. **Submit for human review (Review Gate)**
   - When the review gate is enabled, agents **cannot** move tickets directly to `done`.
   - Call `request_review` (or `tri review request <ID>`) with:
     - `summary`: what changed and why;
     - `question` (optional): any design/methodology call that needs human judgment;
     - `filesChanged`: paths and line deltas;
     - `checks`: test/lint/typecheck commands run and their outcomes.
   - If the owner sends a ticket back (`changes_requested`), read their note in `get_ticket`, address it, and call `request_review` again.

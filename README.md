# Triathlon

A local-first, Markdown-backed work tracker for solo developers working alongside coding agents.

- **Markdown files as the source of truth:** Each ticket lives in `.triathlon/tickets/<ID>.md` with YAML frontmatter, prose, interactive acceptance-criteria checklists (`- [ ]`), and comments.
- **Multi-project local hub:** One `tri serve` instance switches cleanly across all your local repositories while keeping each repo self-contained.
- **Agent-native (`tri` CLI + `tri mcp`):** Agents query the unblocked ready queue, claim tickets, check off criteria, propose follow-up tickets into **Needs triage**, and submit finished work to your **Review Inbox** (enforced by a human review gate).
- **Dissertation-ready cycles & metrics:** Append-only `.triathlon/events.jsonl` powers exact lead time, cycle time (median & p85), burndown with mid-cycle scope tracking, time-in-column bottlenecks, human vs. agent stats, and one-click **CSV / Markdown / SVG** exports.

---

## Quick start

Requires Node.js 22+.

```sh
npm install
npm run build
```

Initialize a project (optionally with realistic demo data and the bundled agent skill):

```sh
tri init --key DIS --name "Dissertation" --skill --demo
tri serve
```

The local workbench opens on `http://127.0.0.1:4177` and watches `.triathlon/` live—any edit from your editor, `tri` CLI, or an MCP agent updates the UI immediately.

---

## Workspace layout

```text
<repo>/.triathlon/
  config.yaml        # project key, name, columns, WIP limits, reviewGate
  cycles.yaml        # planned, active, and completed cycles + frozen snapshots
  events.jsonl       # append-only transition log (powers all metrics)
  tickets/
    DIS-1.md         # YAML frontmatter + Markdown description + checklist + comments
```

Registered repos and theme preferences are stored in `~/.triathlon/registry.json`.

---

## CLI (`tri`)

All commands accept `--json` and `-P, --project <id|key|path>`.

```sh
# Workspace & server
tri init --key DIS --name "Dissertation" --skill
tri projects
tri register [dir]
tri serve [--port 4177] [--no-open]

# Tickets & agent loop
tri new "Compute lead and cycle time" -p urgent -e 5 --criteria "Parse events.jsonl" "Export CSV"
tri ls [--status in-progress] [--cycle cycle-1]
tri ready                                # unblocked Todo tickets sorted by priority
tri show DIS-1
tri claim DIS-1 --by agent:claude --branch dis-1-cycle-time
tri check DIS-1 1 --done --by agent:claude
tri mv DIS-1 in-progress
tri prompt DIS-1                         # copy-ready agent brief

# Review gate
tri review request DIS-1 --summary "Implemented parser" --check "vitest:pass:18 passed" --by agent:claude
tri review approve DIS-1
tri review reject DIS-1 --note "Handle reopened tickets"

# Cycles & dissertation exports
tri cycle create "Evaluation" --start 2026-11-19 --end 2026-12-03 --goal "Chapter 5 metrics"
tri cycle start cycle-1
tri cycle complete cycle-1 --rollover backlog
tri metrics --export csv -o metrics.csv
tri metrics --export md -o chapter5-metrics.md
tri metrics --export svg -o burndown.svg
```

---

## MCP server (`tri mcp`)

Add Triathlon to Claude Code, Codex, Cursor, or any stdio MCP client:

```json
{
  "mcpServers": {
    "triathlon": {
      "command": "tri",
      "args": ["mcp"]
    }
  }
}
```

Exposed tools: `list_projects`, `get_board_summary`, `list_tickets`, `get_ready_tickets`, `get_ticket`, `create_ticket`, `claim_ticket`, `update_ticket`, `move_ticket`, `toggle_checklist_item`, `add_comment`, `request_review`, `get_active_cycle`, `get_metrics`.

---

## Deploying with Tailscale Serve + systemd (HTTPS & iOS PWA)

Keep Triathlon bound to loopback and let `tailscale serve` terminate HTTPS and inject verified `Tailscale-User-Login` identity headers:

```sh
# 1. Install the systemd user service (edit --allow-tailscale-user to your login)
mkdir -p ~/.config/systemd/user
cp deploy/triathlon.service ~/.config/systemd/user/triathlon.service
systemctl --user daemon-reload
systemctl --user enable --now triathlon

# 2. Expose over your Tailnet with automatic HTTPS
tailscale serve --bg 4177
```

Open `https://<host>.<tailnet>.ts.net` on your iPhone and use **Share → Add to Home Screen** to install Triathlon as a standalone PWA.

---

## License

MIT

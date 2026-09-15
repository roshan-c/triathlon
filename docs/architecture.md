# Triathlon architecture

## Product shape

Triathlon is a local-first module whose interface is the `triathlon` command and the `board.json` format.

```text
Browser editor ──HTTP on 127.0.0.1──▶ CLI process ──atomic write──▶ board.json
                                               └──render─────────▶ board.html
Git history ──▶ metrics and attribution
GitHub events ──▶ pr-event command ──▶ board.json + board.html
```

`board.json` is canonical. `board.html`, `metrics.html`, and workflow summaries are derived views.

## Board invariants

- Schema version is `1`.
- A project key is 2-10 uppercase letters or numbers and starts with a letter.
- Ticket IDs use the project key and a never-reused positive number.
- Column and sprint references must resolve.
- Columns are categorized as `not-started`, `started`, or `done`.
- PR open and merge targets identify started and done columns respectively.
- At most one sprint is active.
- Ticket and sprint membership must agree in both directions.
- Completed sprints have immutable metric snapshots.

The board module validates these rules before all writes. It uses a temporary file and rename for atomic replacement. A content revision prevents lost updates from stale browser tabs.

## Generated board

The renderer embeds a canonical board snapshot, CSS, and JavaScript in one HTML file. Directly opened files are read-only. The localhost variant enables write controls and sends complete proposed board states to the CLI for validation.

## Git history

Git is the activity history. Metrics compare committed board snapshots to identify transitions and their authors and timestamps. Completed sprint snapshots prevent later board edits from rewriting historical results.

## Pull requests

A `Triathlon-Tickets:` trailer is the explicit seam between GitHub and Triathlon. The CLI does not infer ticket links from branch names or prose.

Only transitions with clear forward meaning are automatic:

- open: not started → configured started column;
- approved: report only;
- merged: open → configured done column;
- closed without merge: no change.

Opening a new PR for an already completed ticket does not reopen it.

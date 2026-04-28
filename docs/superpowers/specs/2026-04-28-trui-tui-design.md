# trui — Terminal UI for Triathlon

**Date:** 2026-04-28
**Status:** Design complete, pending implementation plan

## Summary

`trui` is a terminal UI for Triathlon built with OpenTUI (React bindings) and Bun. It provides a keyboard-driven kanban board with card CRUD and review workflow, communicating with the Triathlon backend via the existing agent gateway.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Board + Cards only | User specified: kanban view + card CRUD + review gates |
| Binary | `trui` (separate from `tri`) | User preference for decoupled binary |
| UI framework | OpenTUI React bindings | JSX, hooks, familiar patterns; web app already uses React |
| Navigation | Tab-based (TabSelect) | User preference: Board tab + Detail/Edit tab |
| Architecture | Shared GatewayClient | Reuses `src/cli/client.ts` — pure TS, zero Node APIs |
| Server | Bun | OpenTUI is Bun-exclusive |
| Data fetching | Full re-fetch after mutations | Simple, correct for small data volumes |
| Config | Same sources as CLI | Flags > Env vars > .env file |

## File Structure

```
src/trui/
├── index.tsx              # Entrypoint: createCliRenderer, createRoot
├── components/
│   ├── App.tsx            # TabSelect, global state, keyboard shortcuts
│   ├── BoardTab.tsx       # Horizontal columns with cards
│   ├── ColumnView.tsx     # Single column: header + scrollable card list
│   ├── CardItem.tsx       # Single card: title, points, priority, assignee
│   ├── CardDetail.tsx     # Read-only card view + review status
│   ├── CardForm.tsx       # Create/edit form fields
│   ├── ConfirmDialog.tsx  # Overlay confirm for destructive actions
│   └── ReviewActions.tsx  # Request/approve/reject buttons
├── hooks/
│   ├── useBoard.ts        # Fetch board snapshot, refresh after mutations
│   ├── useCard.ts         # CRUD + review mutations via gateway
│   └── useConfig.ts       # Env var loading and validation
├── lib/
│   ├── gateway.ts         # Re-export GatewayClient from src/cli/client.ts
│   └── types.ts           # Re-export types from src/cli/types.ts
├── config.ts              # Config resolution (same priority as CLI)
└── tsconfig.json          # Bun target, JSX, @opentui/react
```

Build output: `trui-dist/index.js` (Bun binary)

## Dependencies

| Package | Purpose |
|---------|---------|
| `@opentui/core` | Renderer, ScrollBox, Text, Box, TabSelect, Input |
| `@opentui/react` | React bindings (JSX, hooks, createRoot) |
| `react` | Already a project dependency |

No new Convex or auth dependencies — all communication via gateway HTTP.

## Screens

### Board Tab

```
┌─ BOARD ────┬─ DETAILS/EDIT ──┐
│ Backlog    Todo  In Progress  Review   Done │
│ ┌──────┐  ┌────┐ ┌─────────┐ ┌─────┐ ┌─────┐│
│ │Card A│  │C D │ │Card E   │ │Card │ │Card ││
│ │ 3pts │  │2pt │ │ 5pts ⚑  │ │ G   │ │ H   ││
│ │ @bob │  │@ana│ │ @alice  │ │5pts │ │3pts ││
│ ├──────┤  ├────┤ │  [Review│ │@bob │ │@ana ││
│ │Card B│  │    │ │   ✓ ok] │ │     │ │     ││
│ │ 1pt  │  │    │ └─────────┘ └─────┘ └─────┘│
│ └──────┘  └────┘                             │
│                                               │
│ c:create  d:delete  Enter:detail  r:refresh  │
└───────────────────────────────────────────────┘
```

- `← →` move between columns
- `↑ ↓` select card
- `Enter` open detail
- `c` create card
- `d`/`Delete` confirm-delete
- `m` move card (then pick column 1-5)
- `r` refresh

### Detail/Edit Tab

Two modes toggled by `e`:

**View mode:** Card title, description, priority, points, assignee, column, review status. Buttons: `[Edit] [Request Review] [Approve] [Reject] [Back]`

**Edit/Create mode:** Form with title (required), description, points (number), priority (select), assignee (select from members). Submit = gateway mutation → refresh board → back to view.

Review buttons only show based on `reviewStatus`:
- `none` → [Request Review]
- `requested` → [Approve] [Reject]
- `approved`/`rejected` → status shown, no buttons

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│  trui (Bun)                                          │
│                                                       │
│  App.tsx ── holds state: board, selectedCard, mode    │
│    │                                                  │
│    ├─ useBoard.ts ── GatewayClient ── HTTP POST ──┐  │
│    │    boards.getSnapshot → columns + cards        │  │
│    │    projects.members → assignee list            │  │
│    │                                                │  │
│    └─ useCard.ts ──── GatewayClient ── HTTP POST ──┤  │
│         boards.createCard      boards.updateCard    │  │
│         boards.moveCard        boards.deleteCard    │  │
│         boards.requestReview   boards.approveReview │  │
│         boards.rejectReview                         │  │
│                                                     │  │
│  After each mutation: refreshBoard()                │  │
└─────────────────────────────────────────────────────┘  │
                                     ┌───────────────────┘
                                     ▼
                            Convex /agent/v1
                            (existing gateway)
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Missing config (no URL/key) | Exit with message before renderer starts |
| HTTP/network error | Toast banner at top, 3s, auto-dismiss |
| Gateway error (validation/auth) | Toast banner with error message |
| Move to Done without approval | Toast: "Review not approved. Request review first." |
| Delete card | ConfirmDialog overlay: "Delete '[title]'? [y/N]" |

## Keyboard Shortcuts

```
GLOBAL
  Ctrl+C              quit
  Tab / Shift+Tab     switch tabs

BOARD TAB
  ← →                 move focus between columns
  ↑ ↓                 select card
  Enter               open detail
  c                   create card
  d / Delete          delete card (with confirm)
  m                   move card (pick column)
  r                   refresh

DETAIL/EDIT TAB
  Escape              back to Board (discard unsaved edits)
  Enter               submit form
  Tab                 next form field (edit mode)
  e                   toggle view ↔ edit
  r                   request review
  a                   approve review
  j                   reject review
```

## Build & Distribution

```jsonc
// package.json additions
{
  "scripts": {
    "trui:build": "bun build src/trui/index.tsx --outdir trui-dist --target bun",
    "trui:dev": "bun --hot src/trui/index.tsx",
    "prepare": "npm run -s cli:build && npm run -s trui:build"
  },
  "bin": {
    "trui": "trui-dist/index.js"
  }
}
```

`prepare` hook builds both `tri` and `trui` on `npm install`.

## Out of Scope (Future)

- Sprint management (create, activate, complete)
- Agile metrics (burndown charts, velocity)
- Whiteboard integration
- Drag-and-drop (mouse-based reordering; keyboard navigation is primary)
- Real-time updates (manual refresh via `r` is sufficient for v1)
- Multiple project switching at runtime

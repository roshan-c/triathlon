---
id: TRI-5
title: Surface live T3 thread status and waiting-for-CI state on Board cards
status: todo
priority: high
estimate: 2
labels:
  - ui
  - t3
  - sync
assignee: null
cycleId: cycle-1
rank: 5000
files:
  - src/web/components/BoardView.tsx
  - src/web/lib/sync.ts
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.640Z'
updatedAt: '2026-11-26T19:18:35.640Z'
---

Show live T3 thread progress (`running`, `waiting`, `failed`) and `waiting for CI` directly on cards in `BoardView`, along with a quick link to open the linked T3 thread without opening the drawer.

## Acceptance Criteria
- [ ] Display compact live T3 thread status indicator on In Progress cards
- [ ] Display waiting-for-CI / CI-failed indicator on In Review cards
- [ ] Keep card layout clean and faithful to the red-pencil editorial design system

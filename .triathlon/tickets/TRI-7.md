---
id: TRI-7
title: 'Review & Board polish: reopen decided reviews and quick board filters'
status: todo
priority: low
estimate: 2
labels:
  - ui
  - ux
assignee: null
cycleId: cycle-1
rank: 7000
files:
  - src/core/project.ts
  - src/server/app.ts
  - src/web/components/ReviewInboxView.tsx
  - src/web/components/BoardView.tsx
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.672Z'
updatedAt: '2026-11-26T19:18:35.672Z'
---

Add a one-tap **Reopen to Review** action on the Decided tab (for bringing back approved/rejected tickets without editing Markdown) and lightweight assignee/label quick filters on the Board.

## Acceptance Criteria
- [ ] Add reopen-to-review endpoint and button on the Review Inbox Decided tab
- [ ] Add compact assignee and label filter controls on BoardView
- [ ] Ensure mobile touch targets remain >= 44px

---
id: TRI-4
title: Push notifications for review requests, questions, and CI failures
status: todo
priority: medium
estimate: 3
labels:
  - notifications
  - pwa
  - mobile
assignee: null
cycleId: cycle-1
rank: 4000
files:
  - src/server/sync.ts
  - src/server/app.ts
  - src/web/components/SettingsView.tsx
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.623Z'
updatedAt: '2026-11-26T19:18:35.623Z'
---

Send push alerts (via Web Push PWA and/or ntfy webhook) to phone and desktop when an agent moves a ticket to **In review**, asks a **Needs your call** question, or when CI fails on an approved PR waiting to merge.

## Acceptance Criteria
- [ ] Add notification settings (ntfy topic/URL and/or Web Push subscription) in Settings
- [ ] Trigger notifications from SyncEngine on review.requested, review question, and ci_failed
- [ ] Include direct link to the ticket/review item in each notification

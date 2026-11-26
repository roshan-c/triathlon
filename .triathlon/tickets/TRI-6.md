---
id: TRI-6
title: Per-project and per-card T3 machine targeting
status: todo
priority: medium
estimate: 3
labels:
  - t3
  - multi-machine
assignee: null
cycleId: cycle-1
rank: 6000
files:
  - src/core/types.ts
  - src/core/t3.ts
  - src/web/components/SettingsView.tsx
  - src/web/components/TicketDrawer.tsx
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.657Z'
updatedAt: '2026-11-26T19:18:35.657Z'
---

Allow configuring a default linked T3 environment per project and overriding it per launch (e.g. route macOS-only tasks like `qwen-tts` to the MacBook and Linux/backend tasks to `pi`).

## Acceptance Criteria
- [ ] Discover linked T3 environments and store optional default environmentId per project
- [ ] Pass environmentId through launchTicketInT3 and allow per-launch override in TicketDrawer
- [ ] Show target machine clearly in launch confirmation and ticket metadata

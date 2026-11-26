---
id: TRI-3
title: Live PR diff, CI re-run, and rebase actions in Review Inbox
status: in-review
priority: high
estimate: 3
labels:
  - ui
  - github
  - review
assignee: agent:agy
cycleId: cycle-1
rank: 1000
files:
  - src/core/github.ts
  - src/server/app.ts
  - src/web/components/ReviewInboxView.tsx
review:
  state: pending
  requestedBy: agent:agy
  requestedAt: '2026-11-26T19:30:39.179Z'
  summary: >-
    Added live PR diff viewer powered by @pierre/diffs (Web Worker pool + Shiki + Shadow DOM + Unified/Split toggle +
    light/dark sync), plus one-tap Re-run failed CI and Ask agent to rebase on main actions in ReviewInboxView.
  checks:
    - name: typecheck
      status: pass
      detail: tsc server + web clean
    - name: build
      status: pass
      detail: server + vite ES worker bundle built
    - name: vitest
      status: pass
      detail: 6 test files / 14 tests passed
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.607Z'
updatedAt: '2026-11-26T19:30:39.179Z'
---

Make mobile and desktop PR review self-contained in the Review Inbox: render a collapsible PR diff (`gh pr diff`), plus one-tap **Re-run failed CI** (`gh run rerun --failed`) and **Ask agent to rebase on main** controls when a PR hits flaky checks or merge conflicts.

## Acceptance Criteria
- [x] Add GET /api/projects/:id/tickets/:ticketId/pr/diff endpoint and collapsible diff viewer in ReviewInboxView
- [x] Add one-tap Re-run failed CI action when checks fail
- [x] Add Ask agent to rebase on main action when PR has merge conflicts or stale base

## Comments

### 2026-11-26T19:21:36.036Z · agent:agy · 90d5ddae
Research note: Use `@pierre/diffs` (`@pierre/diffs/react`) for the diff viewer. It uses Shadow DOM + CSS Grid Web Components, a Shiki Web Worker pool (`WorkerPoolContextProvider`) with LRU caching so tokenization stays off the main thread, zero-blanking virtualized viewports, and accepts raw unified git patches directly via `<PatchDiff patch={...} />` (with split on desktop / stacked on mobile and light/dark themes).

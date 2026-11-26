---
id: TRI-2
title: 'Post-merge cleanup: settle T3 thread and prune merged worktree'
status: todo
priority: high
estimate: 2
labels:
  - t3
  - git
  - automation
assignee: null
cycleId: cycle-1
rank: 2000
files:
  - src/core/project.ts
  - src/core/t3.ts
  - src/server/sync.ts
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.589Z'
updatedAt: '2026-11-26T19:18:35.589Z'
---

Once a PR squash-merges and the ticket moves to **Done** (either immediately or via the background CI poller), automatically settle the linked T3 thread and remove the now-merged git worktree so `~/.t3/worktrees/` does not accumulate stale checkouts.

## Acceptance Criteria
- [ ] Settle linked T3 thread automatically when review approval completes a PR merge
- [ ] Prune/remove the merged git worktree cleanly without failing if already removed
- [ ] Log cleanup failures non-fatally so board completion never breaks

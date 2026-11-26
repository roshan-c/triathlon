---
id: TRI-1
title: Auto-PR in agent prompt + fallback push on approve
status: todo
priority: urgent
estimate: 2
labels:
  - github
  - t3
  - dx
assignee: null
cycleId: cycle-1
rank: 1000
files:
  - src/core/project.ts
  - src/core/github.ts
  - src/core/t3.ts
createdBy: Roshan
createdAt: '2026-11-26T19:18:35.555Z'
updatedAt: '2026-11-26T19:18:35.555Z'
---

Update `buildAgentPrompt` so launched T3 agents push their worktree branch and open a GitHub PR before calling `tri review request`. As a safety net, if **Approve and merge** finds a local branch with commits ahead of `main` but no PR yet, offer or automatically push and open the PR.

## Acceptance Criteria
- [ ] Update buildAgentPrompt to instruct agents to push branch and open a GitHub PR before requesting review
- [ ] Detect unpushed local worktree branches on approve and support pushing + opening a PR
- [ ] Add unit test covering prompt instructions and fallback behavior

# Triathlon

Triathlon is a kanban-style work tracker for small teams, exposing a web board, an agent gateway, and a CLI. Its model is organized around projects, boards, and work items called tickets.

## Language

**Ticket**:
A unit of work on a board: title, description, labels, priority, story points, assignee.
_Avoid_: legacy work-item names, issue (bug-tracker connotation), story

**Project**:
The scope boundary of Triathlon. Members, board, sprints, and ticket numbers are all scoped to one project.

**Board**:
The single kanban surface of a project: an ordered set of columns containing tickets.

**Column**:
A stage in a board. The Done column is special: it is the closed state.

**Done**:
The terminal column. A ticket's presence there is its closed state; the review gate guards entry to it.

**Open**:
Not in the Done column.

**Closed**:
A ticket in the Done column. Moving a ticket out of Done reopens it. There is no separate status field.
_Avoid_: archived

**Ticket number**:
A per-project sequential identifier assigned at creation. Never reused, even when a ticket is deleted.
_Avoid_: id (the opaque Convex id stays the machine key)

**Blocking edge**:
A directed relationship between two tickets in the same project. "A blocks B" means B holds a blockedBy edge to A.
_Avoid_: dependency (ambiguous direction)

**Parent-of edge**:
A directed relationship from a parent ticket to a child ticket; the child is "part of" the parent. Groups wayfinder maps with their tickets.
_Avoid_: sub-issue

**Map**:
A ticket labelled `wayfinder:map` that groups tickets under it via parent-of edges. It inherits the full ticket lifecycle.
_Avoid_: epic, parent issue

**Label**:
A free-form tag string on a ticket. The five triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) are strings applied by skills, not curated entities.

**Agent key**:
A credential scoped to one project, mapped to a user. All gateway calls act as that user.
_Avoid_: API token, service account

**Frontier**:
The set of open, unclaimed tickets whose blockers are all closed — the next claimable work.
_Avoid_: backlog, queue

**Claim**:
Assigning a user to a ticket as its assignee.

**Resolve**:
Commenting the outcome on a ticket and moving it to Done.

**Review**:
A gate on Done: a ticket awaiting review cannot be moved to Done until approved or rejected.
_Avoid_: approval, sign-off

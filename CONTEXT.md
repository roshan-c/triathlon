# Triathlon

Triathlon is a backend-first kanban-style work tracker for small teams. Its model is organized around projects, boards, and work items called tickets.

## Language

**Ticket**:
A unit of work on a board: title, Markdown description, labels, priority, optional integer story points, and an optional human assignee.
_Avoid_: legacy work-item names, issue (bug-tracker connotation), story

**Project**:
The scope boundary of Triathlon. It has one board; members, sprints, access keys, and ticket numbers are scoped to it.

**Project owner**:
The project's sole administrator. The initial owner is its creator, ownership is transferable, and only the current owner may rename or delete the project, configure its board, or issue invitations.

**Project member**:
A person who may manage a project's tickets and sprints and create project-scoped access keys, but may not administer the project itself.

**Instance**:
A self-hosted Triathlon installation containing its users and projects.

**Instance owner**:
The instance's sole administrator with authority over other Instance Admins and exclusive access to the Audit log. The first user becomes owner through secure bootstrap, and ownership may transfer to an existing Instance Admin.

**Instance admin**:
A user who may create projects, issue instance-wide access keys, permanently purge deleted tickets and projects, and recover project ownership. User accounts are never permanently deleted.

**Board**:
The single kanban surface of a project: an ordered set of columns containing tickets.

**Column**:
An ordered stage in a board, categorized as not started, started, or done independently of its display name. Tickets have an explicit position within their column.

**Done**:
The board's sole terminal column category. A ticket's presence there is its closed state; the review gate guards entry to it.

**Open**:
Not in the Done column.

**Closed**:
A ticket in the Done column. Moving a ticket out of Done reopens it. There is no separate status field.
_Avoid_: archived

**Deleted**:
A ticket removed from normal use but retained as a restorable tombstone. Its ticket number and history remain preserved.
_Avoid_: archived, purged

**Ticket number**:
A per-project sequential identifier assigned at creation. Never reused, even when a ticket is deleted.
_Avoid_: id (an opaque identifier remains the machine key)

**Ticket revision**:
The version of a ticket's reviewable content and relationships. Changing that material or moving a ticket out of Done creates a new revision and invalidates approval of an earlier revision.

**Blocking edge**:
A directed, acyclic relationship between two tickets in the same project. "A blocks B" means B holds a blockedBy edge to A.
_Avoid_: dependency (ambiguous direction)

**Parent-of edge**:
A directed, acyclic relationship from a parent ticket to a child ticket; the child is "part of" its sole parent.
_Avoid_: sub-issue

**Label**:
A trimmed, lowercase, free-form tag string on a ticket. The five triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) are strings applied by skills, not curated entities.

**Automation**:
An audit identity owned by one user. Its work is attributed to that user throughout the work tracker, while the owner-only Audit log identifies the Automation that made each request. Ownership may transfer without rewriting history.
_Avoid_: assignee, service account

**Access key**:
A credential for a non-browser client, owned by either a user or an automation. It is scoped to one project by default; an Instance Admin may instead issue one with ordinary work access across every project, expiring within 90 days.
_Avoid_: agent key, API token

**Invitation**:
A revocable, optionally expiring code that may also be presented as a shareable URL. It admits one or more people to a project while valid.
_Avoid_: separate invite link

**Frontier**:
The set of open, unclaimed tickets whose blockers are all closed — the next claimable work.
_Avoid_: backlog, queue

**Claim**:
Assigning a user to a ticket as its assignee.

**Resolve**:
Adding a required outcome comment to an approved ticket revision and moving it to Done. Ordinary movement cannot enter Done.

**Reopen**:
Explicitly moving a Closed ticket out of Done. Reopening creates a new ticket revision and invalidates its previous approval.

**Review**:
A mandatory gate on Done: every ticket revision must be requested and then approved before entering Done. A person may review their own ticket; rejection requires a comment.
_Avoid_: approval, sign-off

**Sprint**:
A time-bounded set of tickets whose lifecycle is planned, active, or completed. Planned dates guide scheduling, actual activation and completion bound measurement, and a ticket belongs to at most one planned or active sprint while completed membership remains historical.
_Avoid_: archived sprint

**Velocity**:
The story points at sprint completion on tickets whose qualifying close occurred during the sprint, while they belonged to it, and whose approved revision remains Closed at completion.

**Throughput**:
The number of tickets whose qualifying close occurred during the sprint, while they belonged to it, and whose approved revision remains Closed at completion.

**Lead time**:
The duration from ticket creation to the closing event represented in a completed sprint's snapshot.

**Cycle time**:
The duration from a ticket's most recent transition from not started to started until the closing event represented in a completed sprint's snapshot.

**Burndown**:
The points remaining at each project-local day boundary, including recorded changes to sprint scope and estimates.

**Activity log**:
The permanent history of domain changes visible to project members, including structured before-and-after summaries. Work performed through an Automation is attributed to its owning user.

**Audit log**:
The permanent security history of authentication and credential use, including the specific Automation and access key behind a request. Only the Instance Owner may read it.

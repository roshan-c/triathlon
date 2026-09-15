# Triathlon

Triathlon is a Git-native work tracker for small teams.

## Language

**Project**:
The repository-scoped body of work represented by one Triathlon board.

**Board**:
The ordered set of columns and tickets stored in `board.json`.

**Column**:
An ordered stage on the Board. Its category is not started, started, or done. One configured started Column and one configured done Column receive pull-request transitions.

**Ticket**:
A unit of work identified by a stable, project-prefixed Ticket ID. It has a title, Markdown description, Column, rank, priority, optional story points, labels, optional assignee, optional Sprint, and Comments.

**Ticket ID**:
A project-prefixed sequential identifier such as `TRI-12`. It is never reused.

**Comment**:
A timestamped note written by a named Git contributor and stored on one Ticket.

**Sprint**:
A planned, active, or completed period containing Tickets. At most one Sprint is active.

**Sprint snapshot**:
The immutable metric result recorded when a Sprint completes.

**Activity history**:
Ticket changes reconstructed from committed versions of `board.json` in Git history.

**Pull-request link**:
A `Triathlon-Tickets:` trailer in a pull-request body that names the Tickets changed by that pull request.

**Contributor**:
The GitHub user who authors a linked pull request. Pull-request-driven Ticket transitions are attributed to this user.

**Static board**:
The generated, self-contained `board.html` snapshot. It can be read without Node.js but cannot save changes.

**Local editor**:
The interactive Board opened by the CLI on localhost. It validates and atomically saves changes to `board.json`, then regenerates the Static board.

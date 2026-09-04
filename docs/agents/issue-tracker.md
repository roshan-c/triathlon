# Issue tracker: Triathlon

This repository tracks work as tickets in the Triathlon project. Read [`issue-tracker-triathlon.md`](./issue-tracker-triathlon.md) for the configured production gateway, project scope, credential rules, verification checks, and ticket operation mapping.

Use the Triathlon agent gateway and its `tickets.*` tools for issue discovery, creation, updates, comments, blocking relationships, reviews, and closure. Before any write, require `system.describe` version `2.0` and confirm `projects.getSummary.projectId` equals the configured `TRI_PROJECT_ID`.

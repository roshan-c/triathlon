# Issue tracker: Triathlon

This repository tracks work as tickets in a Triathlon project. Use the public Triathlon HTTP API or the `tri` CLI; there is no separate agent gateway.

Set the server and credential in the local environment, never in committed files:

```text
TRI_URL=http://localhost:8080
TRI_KEY=tri_...
TRI_PROJECT_ID=<project-id>
```

Before writes, use `tri doctor` (or `GET /api/v1/capabilities`) to confirm the key and project scope. Treat non-2xx responses as failures and preserve the returned problem code and request ID.

The CLI and API expose ticket discovery, creation, updates, comments, blocking relationships, reviews, sprint membership, resolution, and closure. All writes use the same authorization and audit rules as the web application. Access keys may be project-scoped by default or instance-wide when explicitly created.

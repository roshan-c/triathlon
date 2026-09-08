# Triathlon issue-tracker connection

Use the self-hosted public API through the generated client or `tri` CLI. Configure the endpoint and credentials locally:

```text
TRI_URL=http://localhost:8080
TRI_KEY=tri_...
TRI_PROJECT_ID=<project-id>
```

The key must be project-scoped unless the operation intentionally requires an instance-wide key. Never commit or print the secret. Resolve human-facing ticket numbers to resource IDs before mutating a ticket, and preserve API problem codes and request IDs in reports.

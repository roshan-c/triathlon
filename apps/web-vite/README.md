# Triathlon Vite frontend

React + TypeScript client for the Triathlon HTTP API. It implements the five Figma product screens: Sprint Cockpit, Ticket Board, Backlog, Sprints, and Metrics.

## Run locally

1. Start the Triathlon API.
2. Copy `.env.example` to `.env` and set `VITE_TRIATHLON_URL` if the API is not at `http://localhost:8080`. Vite proxies `/api` to this server during development, preserving session cookies without a separate CORS setup.
3. From the repository root, run `npm run web:vite`.

Build the production bundle with `npm run web:vite:build`. In production, set `VITE_TRIATHLON_URL` for a separate API origin or reverse-proxy `/api` from the frontend origin.

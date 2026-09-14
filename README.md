# Triathlon Board

Triathlon is a Git-native board for small teams. A repository contains its work state in `board.json` and a generated, self-contained `board.html`. There is no hosted application or database.

## Start a board

Requires Node.js 22 or newer.

```sh
npx triathlon init --key TEAM --name "Team board"
npx triathlon serve
```

The local editor opens on `http://127.0.0.1:4177`. Every accepted edit is validated, written atomically to `board.json`, and rendered into `board.html`.

The generated HTML is a read-only snapshot. Open it directly when you only need to inspect the board.

## Repository scripts

When Triathlon is installed as a development dependency:

```json
{
  "scripts": {
    "board": "triathlon serve",
    "board:render": "triathlon render",
    "board:validate": "triathlon validate",
    "board:metrics": "triathlon metrics",
    "board:check": "triathlon validate && triathlon render --check"
  }
}
```

## Commands

```sh
npx triathlon init --key TEAM --name "Team board"
npx triathlon serve
npx triathlon validate
npx triathlon render
npx triathlon metrics
```

Use `serve --no-open` to start without opening a browser. Use `serve --port 5000` to select another port.

`metrics` reads committed versions of `board.json` from Git history. It writes a self-contained `metrics.html` report with sprint figures and a burndown graph. Use `metrics --json` to also print machine-readable results.

## Pull-request integration

Each pull request must contain this trailer in its body:

```text
Triathlon-Tickets: TEAM-12, TEAM-18
```

The included workflows:

- validate `board.json`, generated HTML, linked tickets, and tests;
- generate downloadable `metrics.html` and `metrics.json` artifacts on manual request;
- move linked not-started tickets to the configured started column when a PR opens;
- report linked tickets when a review is approved;
- move linked open tickets to the configured done column when the PR merges;
- leave tickets unchanged when a PR closes without merging.

PR transitions are attributed to the GitHub user who caused the event. Bot updates are idempotent and use `[skip ci]` commits.

The merge update writes directly to the base branch. Protected repositories must permit the workflow token to make this board update.

## Data and conflict behavior

`board.json` is the source of truth. Tickets and sprints are keyed by stable IDs. The writer uses stable formatting and sparse numeric ranks so normal ticket moves change as few lines as possible.

Two contributors can still conflict when they edit the same JSON area. Resolve the Git conflict, then run:

```sh
npm run board:check
```

The local editor uses a revision check. It rejects a save if another process changed `board.json` after the page loaded.

## Sprints and metrics

At most one sprint can be active. A completed sprint receives an immutable snapshot containing:

- velocity;
- throughput;
- average lead time;
- average cycle time;
- daily burndown.

Active metrics use Git commit timestamps. GitHub Actions must check out full history (`fetch-depth: 0`) for accurate reports.

## Package

The npm package name is `triathlon`. It exposes both `triathlon` and the shorter installed command `tri`.

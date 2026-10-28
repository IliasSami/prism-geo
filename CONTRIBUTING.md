# Contributing to PrismGEO

Thank you for helping. PrismGEO measures how often AI answer engines name and cite a brand, so the one rule above all others: **only store and show what an engine actually returned.** Never fill in, estimate or fabricate data, in code, fixtures or screenshots.

## Repository layout

| Path | What it holds |
| --- | --- |
| `apps/web` | Next.js 15 dashboard (App Router) and the API routes under `src/app/api` (shared validation and helpers in `src/app/api/_lib`) |
| `packages/core` | Metrics (Wilson intervals, prominence, stance), reverse-RAG passage alignment, prompt synthesis |
| `packages/crawler` | Playwright browser engines, API engines, the crawl orchestrator, the rolling scheduler and the `pnpm crawl` CLI |
| `packages/db` | SQLite through `node:sqlite` (WAL), schema and migrations, settings, file logging |
| `packages/mcp` | The MCP server for Claude (stdio entry point and the `/api/mcp` HTTP endpoint) |

Packages are consumed as TypeScript source (`main` points at `src/`); there is no separate package build step.

## Getting started

Requirements: Node.js 22.13 or later and pnpm 10.

```bash
pnpm install
pnpm browsers   # Chromium for the locked Playwright version
pnpm dev        # http://localhost:3333
```

Use a scratch database while developing so your real data stays untouched:

```bash
PRISMGEO_DB_PATH=/tmp/prismgeo-dev.db pnpm dev
```

## Before you open a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @prismgeo/web build
```

CI runs the same steps on Node 22.13.0 and 24, plus `pnpm audit --prod --audit-level=high` and a Docker build.

- Add tests next to the code you change (`packages/*/test`, `apps/web/test`, `node:test`).
- API routes validate their input with a schema and answer errors as `{ "error": "..." }` with a message a user can act on; log internal details on the server instead of returning them.
- Use fictional brands and domains in tests and examples (for example "Northwind Voice", `northwindvoice.ai`), never real companies.
- Dependencies: keep `pnpm-lock.yaml` in sync (`pnpm install --frozen-lockfile` must pass). If you bump Playwright, update the image tag in the `Dockerfile` too; CI checks that they match.

## Commits and branches

- Fork the repository and branch from `main`.
- Write descriptive commit messages; Conventional Commits are welcome (`feat: add a Bing Copilot citation parser`, `fix: Wilson interval for zero runs`).
- Add a line to `CHANGELOG.md` under "Unreleased" for user-visible changes.

## Security

Do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).

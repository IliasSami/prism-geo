# PrismGEO

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/IliasSami/prism-geo/actions/workflows/ci.yml/badge.svg)](https://github.com/IliasSami/prism-geo/actions/workflows/ci.yml)

**Self-hosted AI search visibility tracking.** PrismGEO asks ChatGPT, Perplexity, Gemini, Google AI Overviews and Microsoft Copilot the questions your buyers ask, stores the real answers, and shows how often each engine names and cites you versus your competitors, and what to do about it.

Everything runs on your machine: a Next.js dashboard, a Playwright crawler and a single SQLite file. No telemetry, no hosted service.

## What you get

| Page | Answers the question |
| :--- | :--- |
| **Overview** | Where do we stand? Mention rate, citation rate, prompts you lead, top rival, sources engines cite most. |
| **Visibility** | Us vs each competitor, by engine and by prompt, with 95% ranges so small samples look small. |
| **Opportunities** | Which prompts are we losing, to whom, and which sources to get covered on to fix it. |
| **Sources** | Every page the engines cited, and the passages from them that answers reuse. |
| **Answers** | The full text each engine returned, with its sources and the web searches it ran (when exposed). |
| **Prompts / Engines / Settings** | Manage tracked questions, engine access and health, brand, competitors, API keys, schedule, Claude connector. |

**Accuracy rule:** only answers an engine actually returned are stored. Blocks, rate limits, empty pages and "no AI Overview" are recorded as failures with a reason (and a screenshot in `data/crawl-debug/`), never filled in.

## How each engine is reached

PrismGEO uses the most reliable route you have configured, per engine:

| Engine | Without a key | With a key | Notes |
| :--- | :--- | :--- | :--- |
| ChatGPT | Logged-out browser, or your signed-in free account | OpenAI Responses API with web search | Logged-out works well |
| Gemini | Logged-out browser, or signed in | Gemini API with Google Search grounding (free tier) | Only the API returns sources and search queries |
| Perplexity | Signed-in free account (anonymous use is capped quickly) | Perplexity Sonar API | |
| Google AI Overviews | Browser, best with a signed-in Google session and slow pacing | SerpApi (free monthly tier) | One IP gets "unusual traffic" blocks after a few dozen searches |
| Microsoft Copilot | **Signed-in Microsoft account only** | none | Copilot has no logged-out chat: without a connected session it is switched off and skipped in audits |

Modes (Settings → Engines & access): **Browser only**, **API keys** (API where a key exists), **Hybrid** (browser first, API when the browser is blocked). Every stored answer records how it was captured (`browser`, `browser_signed_in`, `api`).

### Staying within rate limits, for free

1. Add a free **Gemini API key** (aistudio.google.com) and a free **SerpApi key**, and choose **Hybrid**.
2. **Connect signed-in sessions** (Engines page): a browser window opens on the machine running PrismGEO, you sign in yourself, and crawls reuse that session. PrismGEO never sees your password. This needs a desktop (a screen); it is not available on a headless server or in Docker.
3. Turn on the **rolling daily audit** (Settings → Schedule & network): each day it re-asks the N prompts measured longest ago instead of everything at once, so every engine sees a small, human-paced number of queries.
4. Optionally route browser engines through **a proxy you control** (office network or a paid provider). Free public proxies are not recommended: they can read or alter your traffic, including signed-in sessions.

The crawler paces queries per engine, slows down after a block, cools down for 10/20/30 minutes and retries, and only then gives up on that engine for the batch. In browser mode it presents a consistent desktop Chrome profile and hides the `navigator.webdriver` automation flag; it does not solve CAPTCHAs, rotate IPs or retry past a block. Check each engine's terms before automating it, and prefer the API routes above where you can.

## Quick start

Requirements: Node.js 22.13 or later (PrismGEO uses the built-in `node:sqlite`) and pnpm 10.

```bash
git clone https://github.com/IliasSami/prism-geo.git
cd prism-geo
pnpm install
pnpm browsers     # downloads the Chromium build that matches the locked Playwright version
pnpm dev          # http://localhost:3333
```

The first visit opens the setup wizard: brand, competitors, buyer prompts. Then press **Run audit** in the header (start small: a few prompts, 1 run each).

Production: `pnpm build && pnpm start`. See [Security model](#security-model) before making it reachable from other machines.

## Docker

```bash
mkdir -p data && sudo chown 1001:1001 data   # the container runs as pwuser (uid 1001)
docker compose up -d --build                 # http://localhost:3333, data in ./data
docker compose ps                            # shows "healthy" once /api/health answers
```

- The image is built on Microsoft's Playwright image (Chromium and its libraries included) and runs as the unprivileged `pwuser`, with `node` started directly under an init process.
- compose publishes the port on `127.0.0.1` only. Publish it more widely only behind your own authentication (see [Security model](#security-model)).
- Signed-in sessions need a visible browser window, so Copilot stays off in Docker; the other engines use logged-out browsing, API keys and the rolling schedule.
- The rolling schedule's hour uses the container's time zone (UTC by default); set `TZ` in `docker-compose.yml`.
- Upgrading from an image that ran as root: `docker compose run --rm --user root --entrypoint chown prismgeo -R pwuser:pwuser /app/data` once.

## Command line and cron

```bash
pnpm crawl                       # all active prompts, every enabled engine, 1 run each
pnpm crawl --rolling=15          # the 15 prompts measured longest ago (good for a daily cron)
pnpm crawl --engines=chatgpt,gemini --samples=3 --brand=<id or slug>
```

## Backup, restore and upgrades

Everything PrismGEO knows is in `data/`: the database `prismgeo.db`, plus `browser-profiles/` (signed-in sessions), `logs/`, `backups/` and `crawl-debug/`.

**Backup.** Settings → Data → **Download .db** (or `GET /api/backup`) streams a consistent snapshot of the whole database, for every client. The file contains your **API keys, the proxy password and the Claude connector token** in plain text: store it like a password. From a shell, with the server running or not: `sqlite3 data/prismgeo.db ".backup 'prismgeo-backup.db'"`.

**Restore.**
1. Stop PrismGEO (`Ctrl+C`, or `docker compose stop`).
2. Keep the current database aside: `mv data/prismgeo.db data/prismgeo.db.old` and delete `data/prismgeo.db-wal` and `data/prismgeo.db-shm` if present.
3. Copy the backup to `data/prismgeo.db` (in Docker, make sure it is owned by uid 1001).
4. Optionally check it: `sqlite3 data/prismgeo.db "PRAGMA integrity_check"` should print `ok`.
5. Start PrismGEO again.

**Upgrades.** `git pull && pnpm install && pnpm browsers && pnpm build`, or `docker compose up -d --build`. Database migrations run on start; before a migration changes data, PrismGEO copies the database into `data/backups/` first, so you can roll back by restoring that copy. Read [CHANGELOG.md](CHANGELOG.md) before upgrading.

## Security model

PrismGEO is a single-user, self-hosted tool. **It has no login.** Anyone who can reach the dashboard can read every client's data, change API keys and start crawls. So:

- **Localhost by default.** `pnpm start`, `pnpm dev` and the compose file listen on `127.0.0.1` only.
- **Host allowlist.** The server answers only to `localhost`, `127.0.0.1`, `[::1]`, the host in `PRISMGEO_URL` and the names in `PRISMGEO_ALLOWED_HOSTS`; any other `Host` or `X-Forwarded-Host` gets `421`. This stops DNS-rebinding attacks from web pages you visit. `0.0.0.0` is never accepted as a host name.
- **Same-origin JSON writes.** API calls that change data must be `application/json` from the dashboard's own origin; other pages cannot submit forms to it.
- **Expose it only behind authentication.** To reach PrismGEO from other machines, set `PRISMGEO_HOST=0.0.0.0` (or publish the Docker port) **and** put a reverse proxy with authentication in front (basic auth, OAuth proxy, Tailscale, Cloudflare Access...), then add its host name to `PRISMGEO_ALLOWED_HOSTS`.
- **The MCP endpoint** (`/api/mcp`) is the exception: it is protected by its own random token so a tunnel can reach it. Anyone with the token can read your data and start crawls; if it leaks, rotate it with `sqlite3 data/prismgeo.db "DELETE FROM system_settings WHERE key = 'mcp_connector_token'"` (a new one is created on next use). Prefer the `Authorization: Bearer` header; a token in the URL (`?token=`, needed for claude.ai) ends up in proxy and tunnel logs.
- **Secrets at rest.** API keys, the proxy password and the connector token are stored unencrypted in `data/prismgeo.db`, and signed-in sessions in `data/browser-profiles/`. Keep `data/` private (it is git-ignored and excluded from Docker builds) and treat backups as secrets.

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm lint        # ESLint (eslint-config-next)
pnpm typecheck   # every package and the web app
pnpm test        # node:test suites in packages/*/test and apps/*/test
pnpm --filter @prismgeo/web build
```

CI runs these on Node 22.13.0 and 24, plus `pnpm audit --prod --audit-level=high`, a Docker build and a check that the Docker image's Playwright tag matches `pnpm-lock.yaml`.

## Use it from Claude (MCP connector)

PrismGEO ships an MCP server so Claude (Desktop, Code, or claude.ai) can read your data and run actions: overview, visibility report, answers, crawl status, start a crawl, add prompts and competitors, and guarded read-only SQL (one statement, at most 500 rows, a few seconds, never the settings table).

Settings → **Claude connector** shows ready-to-paste config for:

- **Claude Desktop** (local stdio server; recommended)
- **Claude Code**: `claude mcp add --transport http prismgeo http://localhost:3333/api/mcp --header "Authorization: Bearer <token>"`
- **claude.ai**: needs an HTTPS tunnel to your machine; the token is part of the URL

## Configuration

`.env.example` lists the environment variables PrismGEO reads (host, port, allowed hosts, database path, log file, browser binary, proxy, API model names). Export them in your shell, process manager or Docker environment; Next.js only loads `.env` files from `apps/web/`.

API keys, proxy and schedule are set in the dashboard and stored in the local SQLite file (see [Security model](#security-model)).

## Architecture

```
apps/web          Next.js 15 dashboard and API routes (App Router)
packages/crawler  Playwright engines, API engines, orchestrator, scheduler, CLI
packages/core     Metrics (Wilson intervals, prominence, stance), reverse-RAG alignment, prompt synthesis
packages/db       SQLite (node:sqlite, WAL) with migrations on start
packages/mcp      MCP server (stdio + Streamable HTTP)
data/             prismgeo.db, browser-profiles/, crawl-debug/, logs/, backups/  (git-ignored)
```

## Limitations

- Engines change their pages often; selectors are re-verified when a capture rate drops (see the Engines page and `data/crawl-debug/`).
- API answers come from the same model families with web search, but without the consumer apps' personalization; they are labelled `api`.
- Gemini's consumer app shows sources as buttons, so browser captures of Gemini have no citations; the Gemini API route does.
- Small samples are noisy. Read the "likely" ranges, and prefer several runs per prompt over time.

## Contributing, security, license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE).

Created and maintained by **Ilias Ahmed (Ilias Sami)**: [iliassami.com](https://iliassami.com) · [@IliasSami](https://github.com/IliasSami)

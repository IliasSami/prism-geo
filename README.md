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

| Engine | Free | With a key | Notes |
| :--- | :--- | :--- | :--- |
| ChatGPT | Logged-out browser, or your signed-in free account | OpenAI Responses API + web search | Logged-out works well |
| Gemini | Logged-out browser, or signed in | **Gemini API with Google Search grounding (free tier)** | API returns real sources and search queries |
| Perplexity | Signed-in free account (anonymous use is capped quickly) | Perplexity Sonar API | |
| Google AI Overviews | Signed-in Google session, slow pacing | **SerpApi (free monthly tier)** | One IP gets "unusual traffic" blocks after a few dozen searches |
| Microsoft Copilot | Signed-in Microsoft account (required) | none | No logged-out chat exists |

Modes (Settings → Engines & access): **Browser only**, **API keys** (API where a key exists), **Hybrid** (browser first, API when the browser is blocked). Every stored answer records how it was captured (`browser`, `browser_signed_in`, `api`).

### Staying within rate limits, for free

1. Add a free **Gemini API key** (aistudio.google.com) and a free **SerpApi key**, and choose **Hybrid**.
2. **Connect signed-in sessions** (Engines page): a browser window opens, you sign in yourself, and crawls reuse that session. PrismGEO never sees your password.
3. Turn on the **rolling daily audit** (Settings → Schedule & network): each day it re-asks the N prompts measured longest ago instead of everything at once, so every engine sees a small, human-paced number of queries.
4. Optionally route browser engines through **a proxy you control** (office network or a paid provider). Free public proxies are not recommended: they can read or alter your traffic, including signed-in sessions.

The crawler paces queries per engine, slows down after a block, cools down for 10/20/30 minutes and retries, and only then gives up on that engine for the batch. In browser mode it presents a consistent desktop Chrome profile and hides the `navigator.webdriver` automation flag; it does not solve CAPTCHAs, rotate IPs or retry past a block. Check each engine's terms before automating it, and prefer the API routes above where you can.

## Quick start

Requirements: Node.js 22.13+ (uses the built-in `node:sqlite`), pnpm 10, and Google Chrome or Playwright's Chromium.

```bash
git clone https://github.com/IliasSami/prism-geo.git
cd prism-geo
pnpm install
pnpm exec playwright install chromium   # skip if Google Chrome is installed
pnpm dev                                # http://localhost:3333
```

The first visit opens the setup wizard: brand, competitors, buyer prompts. Then press **Run audit** in the header (start small: a few prompts, 1 run each).

Production: `pnpm build && pnpm start`. By default the server listens on `127.0.0.1` only; set `PRISMGEO_HOST=0.0.0.0` to expose it, and only behind your own authentication, since the dashboard has no login. The server only answers to `localhost` and the host in `PRISMGEO_URL`; list any other name you serve it under (reverse proxy, LAN name) in `PRISMGEO_ALLOWED_HOSTS`.

### Docker

```bash
docker compose up -d        # http://localhost:3333, data in ./data
```

Signed-in sessions need a visible browser window, so connect them on a desktop install; Docker deployments use logged-out browsing, API keys and the rolling schedule.

### Command line and cron

```bash
pnpm crawl                       # all active prompts, every engine, 1 run each
pnpm crawl --rolling=15          # the 15 prompts measured longest ago (good for a daily cron)
pnpm crawl --engines=chatgpt,gemini --samples=3 --brand=<id or slug>
```

## Development

```bash
pnpm typecheck   # every package and the web app
pnpm test        # node:test suites in packages/*/test
pnpm build       # production build of the dashboard
```

CI runs the same three steps on every push and pull request.

## Use it from Claude (MCP connector)

PrismGEO ships an MCP server so Claude (Desktop, Code, or claude.ai on any plan) can read your data and run actions: overview, visibility report, answers, crawl status, start a crawl, add prompts and competitors, and read-only SQL.

Settings → **Claude Connector** shows ready-to-paste config for:

- **Claude Desktop** (local stdio server; recommended)
- **Claude Code**: `claude mcp add --transport http prismgeo http://localhost:3333/api/mcp --header "Authorization: Bearer <token>"`
- **claude.ai**: needs an HTTPS tunnel to your machine; the token is part of the URL

## Configuration

`.env.example` lists the environment variables PrismGEO reads (host, port, database path, browser binary, proxy, API model names). Export them in your shell, process manager or Docker environment; Next.js only loads `.env` files from `apps/web/`.

API keys, proxy and schedule are set in the dashboard and stored **unencrypted** in the local SQLite file, as are signed-in browser profiles in `data/browser-profiles/`. Treat the `data/` folder as a secret: keep it out of git (it is ignored), off shared drives, and back it up with Settings → Storage → Backup.

## Architecture

```
apps/web          Next.js 15 dashboard and API routes (App Router)
packages/crawler  Playwright engines, API engines, orchestrator, scheduler, CLI
packages/core     Metrics (Wilson intervals, prominence, stance), reverse-RAG alignment, prompt synthesis
packages/db       SQLite (node:sqlite, WAL) with migrations on start
packages/mcp      MCP server (stdio + Streamable HTTP)
data/             prismgeo.db, browser-profiles/, crawl-debug/  (git-ignored)
```

## Limitations

- Engines change their pages often; selectors are re-verified when a capture rate drops (see the Engines page and `data/crawl-debug/`).
- API answers come from the same model families with web search, but without the consumer apps' personalization; they are labelled `api`.
- Gemini's consumer app shows sources as buttons, so browser captures of Gemini have no citations; the Gemini API route does.
- Small samples are noisy. Read the "likely" ranges, and prefer several runs per prompt over time.

## Contributing, security, license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

Created and maintained by **Ilias Ahmed (Ilias Sami)**: [iliassami.com](https://iliassami.com) · [@IliasSami](https://github.com/IliasSami)

# Changelog

All notable changes to PrismGEO are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 1.0.0-beta.1

The first public beta. PrismGEO is usable for day-to-day tracking, but expect rough edges: engines change their pages often, and the database schema may still change between beta releases (migrations back up the database first).

### What it does

- Asks ChatGPT, Gemini, Perplexity, Google AI Overviews and Microsoft Copilot the buyer questions you track, through logged-out or signed-in browser sessions or official APIs, and stores the answers they actually return.
- Measures how often each engine names and cites your brand and your competitors, with 95% ranges for small samples, and lists the prompts you lose and the sources engines rely on.
- Records failures (blocks, rate limits, no AI Overview) with a reason instead of counting them as answers.
- Rolling daily audits, a command-line crawler for cron, CSV and JSON exports, database backup.
- An MCP connector so Claude (Desktop, Code, claude.ai) can read the data and start audits.

### Security and operations

- Next.js 15.5.28, which fixes the image optimizer remote code execution and the Server Actions denial of service in earlier 15.5 releases. The image optimizer is also turned off, since PrismGEO serves no optimized images.
- The Host allowlist now also covers `/_next/image`; only `/api/mcp` itself is exempt (not `/api/mcpx` and similar), and `0.0.0.0` is no longer an allowed host name.
- MCP `query_database` runs in a worker thread with a 500-row cap and a time budget, accepts a single SELECT/WITH statement, and refuses any query that would read the settings table (API keys, connector token), however it is written.
- The MCP `start_crawl` tool runs in the server that receives the call; the stdio connector's default URL follows `PRISMGEO_PORT`.
- API keys are shown as their last 4 characters at most, and the proxy password is never sent back to the browser.
- Every API route validates its input and answers errors as `{ "error": "..." }` without database messages or file paths. Invalid prompts or competitor domains are refused with the field at fault instead of being dropped silently; the setup wizard accepts prompts as text or as objects.
- API routes act on the client named in the request (`brandId`), else the client selected in that browser, else the server-wide default, and refuse a client that no longer exists.
- Backups are streamed (no size limit), made with `VACUUM INTO` next to the database, and flagged as containing secrets. CSV exports include the engine and the question, contain every row, and open correctly in Excel.
- Docker: multi-stage image running as the unprivileged `pwuser`, health check, init process, production dependencies only; secrets and local data are excluded from the build context.
- CI: lint, type check, tests, build, a dependency audit, Node 22.13.0 and 24, a Docker build and a Playwright version drift check.
- Removed unused dependencies with known advisories (`drizzle-orm`; `zod` from core) and moved to patched `undici`, `postcss` and `zod`.

### Known limitations

- No login: run it on localhost or behind your own authentication.
- Secrets are stored unencrypted in `data/`.
- Signed-in sessions (required for Copilot) need a desktop with a screen; they are not available in Docker.
- Browser capture depends on each engine's current page layout and can break when it changes.

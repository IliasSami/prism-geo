# Changelog

All notable changes to PrismGEO are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### New

- **DataForSEO as a capture provider** (Settings → Engines & access → Data provider): one `login:password` credential answers ChatGPT and Gemini with what their interfaces showed, Google AI Overviews from the results page (asynchronous Overviews included), and Perplexity through the Sonar API, in the market and language you choose. Answers are stored as `provider` (Perplexity: `api`) with their cost and model; provider errors map to the usual failure reasons.
- **PrismGEO Capture browser extension** (`apps/extension`): save the answer you are looking at in your own ChatGPT, Gemini, Perplexity, Copilot or Google account, matched to a tracked question or added as a new one. Read only on click, previewed before sending, sent only to your server with its own token (Settings → Engines & access → Capture by hand). Stored as `manual` and excluded from engine health.
- **Download report** on Overview: a shareable Markdown summary with results by engine and by buyer stage, failures, brand-confusion warnings, the biggest gaps and the method.
- **Re-check past answers** (Settings → Competitors): re-derive mentions and stance for stored answers with the current competitors, aliases and rules.

### Fixed

- Gemini's "I encountered an error" reply is recorded as an engine error instead of stored; a domain written inside a sentence stays in the answer text; stance no longer credits the product being replaced ("Best X alternatives") and recognises more recommendation phrasings.

## 1.0.0-beta.1

The first public beta. PrismGEO is usable for day-to-day tracking, but expect rough edges: engines change their pages often, and the database schema may still change between beta releases (migrations back up the database first).

### What it does

- Asks ChatGPT, Gemini, Perplexity and Google AI Overviews (and Microsoft Copilot with a signed-in session) the buyer questions you track, through logged-out or signed-in browser sessions or official APIs, and stores the answers they actually return.
- Measures how often each engine names and cites your brand and your competitors, with 95% ranges for small samples, and lists the prompts you lose and the sources engines rely on.
- Records failures (blocks, rate limits, no AI Overview) with a reason instead of counting them as answers.
- Rolling daily audits, a command-line crawler for cron, CSV and JSON exports, database backup.
- An MCP connector so Claude (Desktop, Code, claude.ai) can read the data and start audits.

### Measurement accuracy

Tested against realistic answers in each engine's style, labelled by hand: entity-level errors dropped from 28 of 37 checks to 1 (by design: a brand named in the question gets no rank).

- Vendor names that an engine links are kept in the answer text; citation labels and raw URLs no longer count as mentions.
- One shared matcher for the crawler and the reports: dash and space variants of names ("Hoop – AI" = "Hoop - AI"), accents and case ("Équipe Délice" = "equipe delice"), no matches inside URLs, and marketplace or review hosts (App Store listings, G2) never turn into names.
- Stance reads every mention in its own clause, handles negation ("not expensive", "no major drawbacks") and lets an explicit recommendation outweigh a caveat.
- Engine error and rate-limit pages are rejected instead of stored as answers; answers cut off mid-stream are retried.
- A company named in the question is excluded from its own mention rate, and questions that name your brand are reported separately and never shown as a loss.
- Ranges are computed per question (answers to the same question are correlated), so small samples get honestly wide ranges.
- New: brand accuracy (answers that confuse you with a look-alike domain), question coverage per engine, the AI Overview rate, and a warning when an engine's answers mix capture methods.
- Reused passages are only stored when the answer shares phrases with the page, with the answer sentence kept alongside.
- Blocked engines no longer bias results toward the first questions: each engine asks in its own shuffled order, the daily schedule picks the stalest questions per engine, and an audit no longer waits on engines that are all cooling down.
- The question generator writes grammatical, natural questions from a short category, covers capabilities, pricing and buyer symptoms, and never puts your domain in branded questions.
- Entities are tracked by id, so renaming a competitor keeps its history; paused competitors and questions are left out.

### Product and design

- New brand: logo, favicon, social preview image and a violet palette, with one colour meaning per role (you, competitor, third party) and red, amber and green reserved for status.
- Pages agree with each other, navigation names match page titles, and every failure is explained in plain words with the next step, the same way in the header, Overview, Engines and the audit dialog.
- Accessible by default: text at least 12px with WCAG contrast, 36px controls (44px on touch screens), named controls, focus management in dialogs and the mobile menu.
- Phone and tablet layouts, a full-screen answer drawer, readable markdown answers, Sources grouped by page or site, loading, error and not-found pages.
- Each browser keeps its own selected client; edits always name their client.
- Category and "what makes you different" are editable; the daily schedule runs in your time zone.
- Database upgrades are versioned and automatic, take a backup first, and keep existing history visible; database and log files are private to their owner.

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

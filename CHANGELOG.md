# Changelog

All notable changes to PrismGEO are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0-beta.3 (2026-11-02)

### New

- **One-command install.** `install.sh` / `install.ps1` (or `pnpm bootstrap` in a clone) checks Node.js, installs dependencies and the crawler's browser (with system libraries on Linux), creates `.env`, builds, and prints the dashboard URL and the Claude (MCP) configuration. `pnpm start` loads `.env`, builds or installs the browser when missing and moves to the next free port. Docker images are published for amd64 and arm64 (`ghcr.io/iliassami/prism-geo`), and compose uses a named volume (no permission changes on any OS).
- **Notification bell for steps only a person can take.** When an engine shows a "verify you are human" check or needs a sign-in, that engine waits (15 minutes by default, `PRISMGEO_PERSON_WAIT_MIN`) while the others keep running, and the bell shows the request. **Open window** opens the crawler's own saved profile so you complete the step yourself; the waiting question is then asked again and the audit finishes without errors. Questions not asked in time stay on the request and **Resume** asks exactly those. PrismGEO never answers a check itself. Optional desktop alerts. A completed check is kept in a logged-out "visitor" profile for later logged-out runs.
- **Free engines are never exhausted.** Researched per-engine limits for free browser use: pauses of 1–5 minutes, hourly and daily caps per engine (e.g. Google 8 an hour and 30 a day) counting every question sent from this computer, and longer rests after blocks where blocks last longer (Google 6 → 48 h). Over the hourly cap an engine waits inside the audit; at the daily cap the rest is asked later. **Settings → Schedule → Pacing → Fast** keeps the old pace for your own proxy or paid accounts.
- **"Unanswered" audits** ask each engine only the questions it has never answered (also `scope: "gaps"` on `/api/crawl/start`), so coverage gaps between engines close.
- New failure reasons: `waiting_for_person`, `not_accepted` (the engine's page ignored the question), `budget_reached` (paused to protect free access).
- `/api/health` reports the version, Node.js and database schema.
- **Autopilot** (Settings → Schedule): keeps auditing by itself for days or weeks until every engine has answered every active question, within each engine's safe limits; skips engines resting, waiting in the bell or refusing questions and retries them later; survives restarts; reports when coverage is complete.
- **SerpApi's monthly searches are rationed**: the plan's remaining searches come from SerpApi's account endpoint (free), 10% is kept in reserve, the rest is shared out per day over the month, and every request is metered (new reason `api_budget_reached`). SerpApi is spent only where no free route exists (Google AI Mode) or when Google's browser route is blocked.
- **Approximate location for Google** (as valentin.app does it): browser searches carry Google's location signal (uule, gl, hl) and count as in your market, labelled `locationApproximate`. Calibration now measures how close they are instead of gating them (except for "Only search from here").
- **Stop audit** in the audit dialog (and `POST /api/crawl/stop`).
- **Desktop notifications** on macOS and Linux when an engine needs you and when coverage is complete (Settings → Schedule, or `PRISMGEO_NO_NOTIFY=1`).

### Fixed

- **ChatGPT signed in** ignored questions from the automated browser (and a first-use "Temporary chat" dialog covered the composer): the dialog is closed and, when the session still does not take the question, it is asked logged out and stored as a logged-out capture.
- **Copilot** moved to copilot.com with a new composer; the landing page's own Sign in resumes the saved session. Runs where its page keeps the question unsent are reported as `not_accepted` (stopping after two in a row) instead of "no readable answer".
- **Measurement:** a tracked name inside another tracked name ("Acme" in "Big Acme") no longer counts for both; "Acme-powered", "Acme/Shopify" and "@Acme" are counted; short or everyday-word names ("Front", "Loop") must match their capitalisation; look-alike domains are matched at label boundaries and the brand's own country domains are not flagged; marketplace listings no longer mark every page of the marketplace as a competitor; percentages say whether they are per-question averages; engine averages skip engines without answers; passage reuse no longer drops short product paragraphs that mention "sign up".
- **Reliability:** saved browser profiles are never opened by two things at once; one engine's error no longer ends the whole audit; a rejected key stops that engine instead of failing every question; check windows count as cleared only after a real page load and a few clean seconds; calibration cannot start twice; sign-in windows use the proxy.
- **Dashboard:** Calibrate works again (it was refused by the JSON check); Settings never saves empty keys after a failed load; API requests from other sites are refused for every method; the proxy password is kept only for the same proxy host; one shared poll for the bell; local times without hydration errors; clearer error states on Settings, Engines, Competitors and the client switcher.
- **Calibration** no longer wastes searches: its repeat search skips SerpApi's cache (a cached copy made the noise floor a meaningless 100%) and both reference searches come from the reserve.
- ChatGPT goes straight to a logged-out page for 24 hours after its signed-in session ignores a question (one visit per question instead of two).
- Markdown escapes ("e\-commerce") no longer appear in SerpApi AI Mode answers.
- **Claude connector:** slow SQL queries are really stopped; report filters (engine, batch) apply to every number; audits of more than 50 runs need confirmation; answer text is marked as untrusted content; ids from another client are refused.
- Test fixtures and examples use fictional companies only.

## 1.0.0-beta.2 (2026-10-31)

### New

- **Search location**: every route asks from one chosen country (then a language spoken there), checked before each audit. Each answer records where it was asked from. Google routes can use a city, state or postal code from Google's own geotargets list, with Google's `uule` location signal in the browser.
- **Calibration**: checks whether this computer's Google answers match answers asked from inside the chosen country. It starts by itself once DataForSEO or a large SerpApi plan is saved (on a small SerpApi plan, when you ask).
- **Google AI Mode** as an engine, through SerpApi or Apify's AI Mode actor. One engine registry now drives the whole app.
- **Signed-in personas**: several signed-in accounts per engine, each labelled; ChatGPT answers come from Temporary Chats.
- **Untracked companies**: Competitors → "Also named by the engines" suggests companies the answers name that you don't track yet.
- **Answers tailored to the wrong market** are flagged when an engine localises to where PrismGEO runs instead of the market you measure.
- **Reports** compare the sites AI Overviews cite with Google's organic top 10 from the same search.
- Paid routes run in parallel; browsers stay one page at a time.
- **DataForSEO as a capture provider** (Settings → Engines & access → Data provider): one `login:password` credential answers ChatGPT and Gemini with what their interfaces showed, Google AI Overviews from the results page (asynchronous Overviews included), and Perplexity through the Sonar API, in the market and language you choose. Answers are stored as `provider` (Perplexity: `api`) with their cost and model; provider errors map to the usual failure reasons.
- **PrismGEO Capture browser extension** (`apps/extension`): save the answer you are looking at in your own ChatGPT, Gemini, Perplexity, Copilot or Google account, matched to a tracked question or added as a new one. Read only on click, previewed before sending, sent only to your server with its own token (Settings → Engines & access → Capture by hand). Stored as `manual` and excluded from engine health.
- **Download report** on Overview: a shareable Markdown summary with results by engine and by buyer stage, failures, brand-confusion warnings, the biggest gaps and the method.
- **Re-check past answers** (Settings → Competitors): re-derive mentions and stance for stored answers with the current competitors, aliases and rules.

### Fixed

- Generated questions no longer repeat the audience ("for online shops for small online shops", "a small small online shop").
- `pnpm start` and `pnpm dev` work in Windows' default shell.
- Engine blocks are remembered across audits: the browser route rests for 1, 3, 6, 12, then 24 hours after repeated blocks instead of searching straight into an active block, and a key or provider answers meanwhile.
- A signed-in account's usage-limit dialog counts as a block, not a missing answer. A signed-in session counts only when the service's own sign-in check confirms it.
- Failures are grouped with the fix that works for each engine.
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

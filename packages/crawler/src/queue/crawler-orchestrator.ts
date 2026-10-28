import { getSettings, getRawDb, nowIso, rowToBrand } from "@prismgeo/db";
import {
  ReverseRagParser,
  detectMentions,
  entityTerms,
  lookalikeDomains,
  prominenceScore,
  seededShuffle,
  stanceOf,
  type TrackedEntity,
} from "@prismgeo/core";
import { PerplexityEngineCrawler } from "../engines/perplexity";
import { GoogleAioCrawler, NoAiOverviewError } from "../engines/google-aio";
import { CopilotEngineCrawler } from "../engines/copilot";
import { GeminiEngineCrawler } from "../engines/gemini";
import { ChatGptEngineCrawler } from "../engines/chatgpt";
import { AnswerNotFinishedError, EngineBlockedError, getProxyConfig, type EngineAnswer } from "../engines/browser-session";
import { runApiEngine, apiKeyFor, ApiKeyRejectedError, type ApiEngine, type ApiKeys } from "../engines/api-engines";
import { fetchPublicPage } from "../net/safe-fetch";
import { chromium, type Browser } from "playwright";
import { getChromiumExecutablePath } from "../stealth/fingerprint";
import crypto from "node:crypto";
import os from "node:os";
import * as cheerio from "cheerio";

export type EngineName = "perplexity" | "google_aio" | "copilot" | "gemini" | "chatgpt";

export interface CrawlBatchOptions {
  batchId?: string;
  brandId: string;
  /** Answers per prompt and engine (N). */
  sampleSize?: number;
  engines?: EngineName[];
  promptLimit?: number;
  /** Crawl exactly these prompts (all engines); overrides promptLimit. */
  promptIds?: string[];
  /** Crawl these prompts per engine (rolling schedule: each engine's own stalest prompts). */
  promptIdsByEngine?: Partial<Record<EngineName, string[]>>;
  /** Called once the batch holds the brand's crawl lock and its row is "running". */
  onStarted?: (batchId: string) => void;
  /** Multiplies the pause between queries (1 = normal human pacing). Only for tests and offline harnesses. */
  pacingScale?: number;
}

/** Why a run produced no stored answer. Persisted in crawl_batches.errors_json. */
export interface RunFailure {
  engine: EngineName;
  promptId: string | null;
  kind:
    | "blocked"
    | "no_ai_overview"
    | "no_answer"
    | "unavailable"
    | "skipped_after_blocks"
    | "skipped_after_network"
    | "skipped_setup"
    | "prompt_removed"
    | "prompt_paused"
    | "api_key_rejected"
    | "network"
    | "setup"
    | "error";
  message: string;
}

/** Another batch is already crawling this brand (in this or another process). */
export class BatchRunningError extends Error {
  constructor(readonly runningBatchId: string) {
    super(`A crawl batch is already running for this client (${runningBatchId}). Wait for it to finish.`);
  }
}

/** Errors meaning the host was never reached: this machine's connection or proxy, not the engine. */
const NETWORK_ERROR =
  /net::ERR_(TUNNEL_CONNECTION_FAILED|PROXY_[A-Z_]+|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_TIMED_OUT)|\bfetch failed\b|\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|getaddrinfo|socket hang up/;
const SETUP_ERROR = /browserType\.launch(PersistentContext)?: Executable doesn't exist|Failed to launch|chromium.*not found/i;

/** Consecutive blocks after which an engine cools down before trying again. */
const MAX_CONSECUTIVE_BLOCKS = 2;
/** Consecutive network failures after which an engine stops for this batch. */
const MAX_CONSECUTIVE_NETWORK = 2;
/** Successes after which a block-raised pacing factor is halved again. */
const PACING_DECAY_AFTER = 3;
/**
 * Cool-down waits after repeated blocks. Rate limits are usually temporary, so the engine waits
 * and probes again instead of giving up on the rest of the batch; after the last wait it stops.
 */
const COOLDOWNS_MS = [10, 20, 30].map((minutes) => minutes * 60_000);
/**
 * Delay between two queries to the same engine, so one host is never hammered. Google and
 * anonymous Perplexity rate-limit an IP after a few dozen queries, so they are paced slowest.
 */
function pacingFor(engine: EngineName, viaApi: boolean): [number, number] {
  if (viaApi) return [500, 1500];
  if (engine === "google_aio") return [15000, 30000];
  if (engine === "perplexity") return [8000, 15000];
  return [4000, 8000];
}

/** Engine access mode from Settings: browser only, API keys only, or browser with API fallback. */
type EngineMode = "stealth" | "byok" | "hybrid";
const API_ENGINES: EngineName[] = ["gemini", "chatgpt", "perplexity", "google_aio"];

// ---------------------------------------------------------------- cited pages (reverse-RAG)

/** Downloads a cited page and returns its readable text ("" when unusable). */
export type CitedPageFetcher = (url: string) => Promise<string>;

/** Readable text of an HTML page, one block per paragraph. */
export function pageTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, form, aside, [role='navigation'], [aria-hidden='true']").remove();
  return $("h1, h2, h3, h4, p, li, td")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 0)
    .join("\n\n");
}

const defaultCitedPageFetcher: CitedPageFetcher = async (url) => {
  try {
    const res = await fetchPublicPage(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.status < 200 || res.status >= 300 || !res.contentType.includes("html")) return "";
    return pageTextFromHtml(res.body);
  } catch (err) {
    console.warn(`[CrawlerOrchestrator] Cited page not fetched (${url}): ${(err as Error).message}`);
    return "";
  }
};

let citedPageFetcher: CitedPageFetcher = defaultCitedPageFetcher;

/** Replaces how cited pages are downloaded (tests and offline harnesses); null restores the guarded default. */
export function configureCitedPageFetch(fetcher: CitedPageFetcher | null): void {
  citedPageFetcher = fetcher ?? defaultCitedPageFetcher;
}

/** Per-batch cache: each cited URL is downloaded once per batch and released when the batch ends. */
type PageCache = Map<string, Promise<string>>;
const MAX_CACHED_PAGES = 500;

function cachedPageText(cache: PageCache, url: string): Promise<string> {
  let hit = cache.get(url);
  if (!hit) {
    if (cache.size >= MAX_CACHED_PAGES) cache.delete(cache.keys().next().value as string);
    hit = citedPageFetcher(url);
    cache.set(url, hit);
  }
  return hit;
}

// ---------------------------------------------------------------- failures

export function classifyFailure(engine: EngineName, promptId: string | null, err: unknown): RunFailure {
  // Playwright appends a colour-coded "Call log:" or a boxed install hint; keep only the error itself
  const message = ((err as Error)?.message || String(err)).replace(/\u001b\[[0-9;]*m/g, "").split(/\nCall log:|\n╔/)[0].trim();
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const causeText = cause ? `${cause.code || ""} ${cause.message || ""}` : "";
  let kind: RunFailure["kind"] = "error";
  if (err instanceof EngineBlockedError) kind = "blocked";
  else if (err instanceof NoAiOverviewError) kind = "no_ai_overview";
  else if (err instanceof ApiKeyRejectedError) kind = "api_key_rejected";
  else if (err instanceof AnswerNotFinishedError || /No extractable response|present but empty|did not finish/.test(message)) kind = "no_answer";
  else if (SETUP_ERROR.test(message)) kind = "setup";
  else if (NETWORK_ERROR.test(message) || NETWORK_ERROR.test(causeText)) kind = "network";
  return { engine, promptId, kind, message: causeText && kind === "network" ? `${message} (${causeText.trim()})` : message };
}

// ---------------------------------------------------------------- batch ownership and the per-brand lock

/**
 * Batches executing in this server process. Kept on globalThis so dev hot-reloads do not lose
 * it; a batch row left "running" that is not in here was interrupted by a restart.
 */
const activeBatches: Set<string> = ((globalThis as any).__prismActiveBatches ??= new Set<string>());
const BOOT_ID: string = ((globalThis as any).__prismBootId ??= crypto.randomBytes(4).toString("hex"));
/** Identifies the process running a batch: host, pid and a per-process boot id. */
export const PROCESS_OWNER = `${os.hostname()}:${process.pid}:${BOOT_ID}`;

/** How often a running batch proves it is alive, and how long silence means it died. */
const HEARTBEAT_MS = 30_000;
const STALE_AFTER_MS = 2 * 60_000;

/** True when the owner string names a process on this host that no longer runs. */
function ownerIsDead(owner: string | null): boolean {
  if (!owner) return false;
  const [host, pidText, boot] = owner.split(":");
  if (host !== os.hostname()) return false;
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return boot !== BOOT_ID;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Closes batches left "running" by a process that stopped (server restart, killed CLI): at once
 * when the owning process on this host is gone, otherwise once its heartbeat is older than
 * STALE_AFTER_MS (works across hosts sharing a database). Returns the number of batches closed.
 */
export function closeStaleBatches(): number {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const running = getRawDb()
    .prepare(
      `SELECT id, owner, COALESCE(heartbeat_at, strftime('%Y-%m-%dT%H:%M:%fZ', created_at)) AS beat
       FROM crawl_batches WHERE status = 'running'`
    )
    .all() as Array<{ id: string; owner: string | null; beat: string }>;
  const close = getRawDb().prepare(
    `UPDATE crawl_batches SET status = 'failed', current_prompt = 'Interrupted: the process running this batch stopped before it finished',
     finished_at = ? WHERE id = ? AND status = 'running'`
  );
  let closed = 0;
  for (const b of running) {
    if (activeBatches.has(b.id)) continue;
    if (b.owner === PROCESS_OWNER) continue; // being started by this process right now
    if (ownerIsDead(b.owner) || b.beat < cutoff) closed += close.run(nowIso(), b.id).changes as number;
  }
  if (closed > 0) console.warn(`[CrawlerOrchestrator] Closed ${closed} interrupted batch(es)`);
  return closed;
}

/** At process start: closes batches whose owning process is gone (call once from server/CLI boot). */
export function recoverInterruptedBatches(): number {
  return closeStaleBatches();
}

/**
 * Takes the brand's crawl lock atomically: inside one write transaction, closes dead batches,
 * refuses when another batch of the brand is running, then creates or claims `batchId`.
 */
function acquireBatch(batchId: string, brandId: string, fields: { sampleSize: number; totalRuns: number; currentEngine: string; errorsJson: string }): void {
  const sqlite = getRawDb();
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    closeStaleBatches();
    const other = sqlite
      .prepare("SELECT id FROM crawl_batches WHERE brand_id = ? AND status = 'running' AND id <> ? ORDER BY created_at DESC LIMIT 1")
      .get(brandId, batchId) as { id: string } | undefined;
    if (other) throw new BatchRunningError(other.id);
    const now = nowIso();
    const exists = sqlite.prepare("SELECT 1 FROM crawl_batches WHERE id = ?").get(batchId);
    if (exists) {
      sqlite
        .prepare(
          `UPDATE crawl_batches SET status = 'running', sample_size = ?, total_runs = ?, current_prompt = 'Initializing crawler engines...',
           current_engine = ?, errors_json = ?, owner = ?, heartbeat_at = ? WHERE id = ?`
        )
        .run(fields.sampleSize, fields.totalRuns, fields.currentEngine, fields.errorsJson, PROCESS_OWNER, now, batchId);
    } else {
      sqlite
        .prepare(
          `INSERT INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, errors_json, owner, heartbeat_at, created_at)
           VALUES (?, ?, 'running', ?, ?, 0, 'Initializing crawler engines...', ?, ?, ?, ?, ?)`
        )
        .run(batchId, brandId, fields.sampleSize, fields.totalRuns, fields.currentEngine, fields.errorsJson, PROCESS_OWNER, now, now);
    }
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}

/** Batch columns the orchestrator updates while it runs. */
const BATCH_COLUMNS = {
  status: "status",
  currentPrompt: "current_prompt",
  currentEngine: "current_engine",
  completedRuns: "completed_runs",
  failedRuns: "failed_runs",
  errorsJson: "errors_json",
  finishedAt: "finished_at",
} as const;

function updateBatch(batchId: string, fields: Partial<Record<keyof typeof BATCH_COLUMNS, string | number | null>>): void {
  const keys = Object.keys(fields) as Array<keyof typeof BATCH_COLUMNS>;
  if (keys.length === 0) return;
  getRawDb()
    .prepare(`UPDATE crawl_batches SET ${keys.map((k) => `${BATCH_COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), batchId);
}

/** Tracked entity as the crawler uses it (key = competitor id, or "brand"). */
export interface CrawlEntity extends TrackedEntity {
  competitorId: string | null;
}

export class CrawlerOrchestrator {
  /** True while `batchId` is still being executed by this process. */
  public static isRunning(batchId: string): boolean {
    return activeBatches.has(batchId);
  }

  public static async executeBatch(options: CrawlBatchOptions): Promise<string> {
    const brandId = options.brandId;
    const sampleSize = options.sampleSize || 5;
    const pacingScale = Math.max(0, options.pacingScale ?? 1);
    const requestedEngines: EngineName[] = options.engines || ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

    // 1. Fetch brand and competitor configurations
    const sqlite = getRawDb();
    const brandRow = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId) as Record<string, any> | undefined;
    if (!brandRow) throw new Error(`Brand not found: ${brandId}`);
    const brand = rowToBrand(brandRow);
    const brandAliases: string[] = JSON.parse(brand.aliasesJson || "[]").filter((a: unknown) => typeof a === "string" && a.trim().length > 0);

    // Paused competitors are neither tracked nor reported
    const competitors = (
      sqlite.prepare("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ? AND active = 1 ORDER BY created_at").all(brandId) as Array<{
        id: string;
        name: string;
        domain: string;
        aliases_json: string | null;
      }>
    ).filter((c) => c.name?.trim());
    const competitorDomains = competitors.map((c) => c.domain);
    const trackedEntities: CrawlEntity[] = [
      { key: "brand", competitorId: null, name: brand.name, isTarget: true, terms: entityTerms(brand.name, brandAliases, brand.domain) },
      ...competitors.map((c) => ({
        key: c.id,
        competitorId: c.id,
        name: c.name,
        isTarget: false,
        terms: entityTerms(c.name, JSON.parse(c.aliases_json || "[]"), c.domain),
      })),
    ];

    // Deactivated prompts are kept for history but never crawled
    const rawPrompts = (
      sqlite.prepare("SELECT id, query_text FROM prompts WHERE brand_id = ? AND active = 1 ORDER BY created_at").all(brandId) as Array<{ id: string; query_text: string }>
    ).map((p) => ({ id: p.id, queryText: p.query_text }));
    if (rawPrompts.length === 0) throw new Error(`No active prompts configured for brand ${brandId}`);
    const activePrompts = options.promptIds
      ? rawPrompts.filter((p) => options.promptIds!.includes(p.id))
      : options.promptLimit
        ? rawPrompts.slice(0, options.promptLimit)
        : rawPrompts;

    const engineSettings = getSettings<{ mode?: EngineMode }>("engine_settings", {});
    // Hybrid is the default: identical to browser-only until a key is saved, then keys are used when blocked
    const mode: EngineMode = engineSettings.mode === "byok" || engineSettings.mode === "stealth" ? engineSettings.mode : "hybrid";
    const apiKeys = getSettings<ApiKeys>("byok_api_keys", {});
    const hasApi = (engine: EngineName) => mode !== "stealth" && API_ENGINES.includes(engine) && apiKeyFor(engine, apiKeys) !== "";

    // Engines that cannot be crawled at all are reported once instead of failing every run.
    const failures: RunFailure[] = [];
    const engines = requestedEngines.filter((engine) => {
      if (engine === "copilot" && !CopilotEngineCrawler.available) {
        failures.push({ engine, promptId: null, kind: "unavailable", message: CopilotEngineCrawler.unavailableReason });
        return false;
      }
      return true;
    });

    // 2. Each engine's own prompt order: a seeded shuffle per batch, so blocks drop a random subset
    const batchId = options.batchId || `batch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const promptsFor = new Map(
      engines.map((engine) => {
        const ids = options.promptIdsByEngine?.[engine];
        const list = ids ? rawPrompts.filter((p) => ids.includes(p.id)) : activePrompts;
        return [engine, seededShuffle(list, `${batchId}:${engine}`)] as const;
      })
    );
    const totalRuns = engines.reduce((s, e) => s + (promptsFor.get(e)?.length || 0), 0) * sampleSize;

    // 3. The per-brand lock: refuses when another batch is crawling this brand (any process)
    acquireBatch(batchId, brandId, { sampleSize, totalRuns, currentEngine: engines[0] || "system", errorsJson: JSON.stringify(failures) });
    activeBatches.add(batchId);
    try {
      options.onStarted?.(batchId);
    } catch (err) {
      console.warn("[CrawlerOrchestrator] onStarted callback failed:", (err as Error).message);
    }

    console.log(`[CrawlerOrchestrator] Started batch ${batchId} for ${brand.name} (${activePrompts.length} prompts across ${engines.length} engines, N=${sampleSize})`);
    for (const f of failures) console.warn(`[CrawlerOrchestrator] Skipping ${f.engine}: ${f.message}`);

    let completedRuns = 0;
    let failedRuns = 0;
    let sharedBrowser: Browser | null = null;
    const pageCache: PageCache = new Map();
    const beat = () => {
      try {
        getRawDb().prepare("UPDATE crawl_batches SET heartbeat_at = ? WHERE id = ?").run(nowIso(), batchId);
      } catch (err) {
        console.warn("[CrawlerOrchestrator] Heartbeat failed:", (err as Error).message);
      }
    };
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    (heartbeat as { unref?: () => void }).unref?.();

    const recordFailure = async (failure: RunFailure, { quiet = false } = {}) => {
      failedRuns++;
      failures.push(failure);
      if (!quiet) console.warn(`[CrawlerOrchestrator] ${failure.engine} ${failure.kind}: ${failure.message}`);
      updateBatch(batchId, { failedRuns, errorsJson: JSON.stringify(failures) });
    };
    const promptState = getRawDb().prepare("SELECT active FROM prompts WHERE id = ?");
    /** "ok", or why the prompt must not be queried / stored any more (paused or deleted mid-batch). */
    const promptStatus = (id: string): "ok" | "prompt_removed" | "prompt_paused" => {
      const row = promptState.get(id) as { active: number } | undefined;
      return !row ? "prompt_removed" : row.active === 0 ? "prompt_paused" : "ok";
    };

    try {
      try {
        sharedBrowser = await chromium.launch({
          headless: true,
          executablePath: getChromiumExecutablePath(),
          proxy: getProxyConfig(),
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--disable-infobars"],
        });
      } catch (browserLaunchErr) {
        console.warn("[CrawlerOrchestrator] Browser launch note:", (browserLaunchErr as Error).message);
      }

      // Engines run in parallel (different hosts); each works through its own prompt order
      // sequentially with pacing, and cools down after repeated blocks.
      let enginesWorking = engines.length;
      let enginesCooling = 0;
      /** Set when the browser is not installed: every engine without an API route stops. */
      let setupFailure: string | null = null;

      await Promise.all(
        engines.map(async (engine) => {
          let consecutiveBlocks = 0;
          let consecutiveNetwork = 0;
          let successesSinceBlock = 0;
          let paused = false;
          let cooldownsUsed = 0;
          /** Why this engine stopped for the rest of the batch. */
          let stopped: { kind: RunFailure["kind"]; message: string } | null = null;
          // Each block doubles the pause between queries (max 4x); successes halve it again
          let pacingFactor = 1;
          // byok: API whenever a key exists. hybrid: browser first, API when the browser fails.
          let viaApi = mode === "byok" && hasApi(engine);
          const pause = () => {
            const [min, max] = pacingFor(engine, viaApi);
            return new Promise((r) => setTimeout(r, (min + Math.random() * (max - min)) * pacingFactor * pacingScale));
          };
          let skipped = 0;
          /** Waits out a cool-down; gives up as soon as no engine is still working (only cooling ones remain). */
          const coolDown = async (ms: number): Promise<boolean> => {
            const until = Date.now() + ms;
            enginesCooling++;
            try {
              while (Date.now() < until) {
                if (enginesWorking - enginesCooling <= 0) return false;
                await new Promise((r) => setTimeout(r, 15_000));
              }
              return true;
            } finally {
              enginesCooling--;
            }
          };
          let firstQuery = true;

          for (const prompt of promptsFor.get(engine) || []) {
            for (let runIdx = 0; runIdx < sampleSize; runIdx++) {
              if (!stopped && setupFailure && !viaApi) stopped = { kind: "skipped_setup", message: `Not run: ${setupFailure}` };
              if (stopped) {
                skipped++;
                await recordFailure({ engine, promptId: prompt.id, kind: stopped.kind, message: stopped.message }, { quiet: true });
                continue;
              }
              const state = promptStatus(prompt.id);
              if (state !== "ok") {
                await recordFailure(
                  { engine, promptId: prompt.id, kind: state, message: state === "prompt_removed" ? "Prompt deleted during the batch; not queried" : "Prompt paused during the batch; not queried" },
                  { quiet: true }
                );
                continue;
              }
              if (paused && cooldownsUsed < COOLDOWNS_MS.length) {
                const wait = COOLDOWNS_MS[cooldownsUsed++];
                console.warn(`[CrawlerOrchestrator] ${engine} blocked repeatedly; cooling down ${wait / 60_000} min before retrying`);
                if (await coolDown(wait)) {
                  paused = false;
                  consecutiveBlocks = MAX_CONSECUTIVE_BLOCKS - 1; // one more block re-pauses at once
                  firstQuery = true;
                } else {
                  cooldownsUsed = COOLDOWNS_MS.length; // only cooling engines remain: nothing to wait for
                }
              }
              if (paused) {
                skipped++;
                await recordFailure(
                  { engine, promptId: prompt.id, kind: "skipped_after_blocks", message: `${engine} still blocked after ${cooldownsUsed} cool-down(s)` },
                  { quiet: true }
                );
                continue;
              }
              if (!firstQuery) await pause();
              firstQuery = false;

              const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
              updateBatch(batchId, { currentPrompt: prompt.queryText.slice(0, 80), currentEngine: engine });

              let engineResult: EngineAnswer;
              const runBrowser = (): Promise<EngineAnswer> => {
                const browser = sharedBrowser || undefined;
                if (engine === "perplexity") return PerplexityEngineCrawler.execute(prompt.queryText, browser);
                if (engine === "copilot") return CopilotEngineCrawler.execute(prompt.queryText, browser);
                if (engine === "gemini") return GeminiEngineCrawler.execute(prompt.queryText, browser);
                if (engine === "chatgpt") return ChatGptEngineCrawler.execute(prompt.queryText, browser);
                if (engine === "google_aio") return GoogleAioCrawler.execute(prompt.queryText, browser);
                throw new Error(`Unknown engine: ${engine}`);
              };
              const runEngine = (): Promise<EngineAnswer> => (viaApi ? runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys) : runBrowser());
              try {
                try {
                  engineResult = await runEngine();
                } catch (firstErr) {
                  const kind = classifyFailure(engine, prompt.id, firstErr).kind;
                  // The API cannot help when this machine has no connection, and "no AI Overview" is a real outcome
                  if (!viaApi && mode === "hybrid" && hasApi(engine) && kind !== "no_ai_overview" && kind !== "network") {
                    console.warn(`[CrawlerOrchestrator] ${engine} browser ${kind}; falling back to API: ${(firstErr as Error).message}`);
                    if (kind === "blocked" || kind === "setup") viaApi = true; // stop using a browser that cannot work
                    engineResult = await runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys);
                  } else {
                    // One retry for transient failures (timeouts, half-rendered or unfinished answers).
                    // Blocks, rejected keys, network/setup failures and "no AI Overview" are never retried.
                    if (kind !== "no_answer" && kind !== "error") throw firstErr;
                    console.warn(`[CrawlerOrchestrator] Retrying ${engine} once after ${kind}: ${(firstErr as Error).message}`);
                    await pause();
                    engineResult = await runEngine();
                  }
                }
              } catch (runErr) {
                const failure = classifyFailure(engine, prompt.id, runErr);
                await recordFailure(failure);
                consecutiveBlocks = failure.kind === "blocked" ? consecutiveBlocks + 1 : 0;
                consecutiveNetwork = failure.kind === "network" ? consecutiveNetwork + 1 : 0;
                if (failure.kind === "blocked") {
                  pacingFactor = Math.min(4, pacingFactor * 2);
                  successesSinceBlock = 0;
                }
                if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) paused = true;
                if (consecutiveNetwork >= MAX_CONSECUTIVE_NETWORK) {
                  stopped = { kind: "skipped_after_network", message: `Not run: ${engine} could not connect ${consecutiveNetwork} times in a row (${failure.message})` };
                }
                if (failure.kind === "setup") {
                  if (!viaApi) setupFailure = failure.message;
                  stopped = { kind: "skipped_setup", message: `Not run: ${failure.message}` };
                }
                continue;
              }
              consecutiveBlocks = 0;
              consecutiveNetwork = 0;
              if (pacingFactor > 1 && ++successesSinceBlock >= PACING_DECAY_AFTER) {
                pacingFactor = Math.max(1, pacingFactor / 2);
                successesSinceBlock = 0;
              }

              // The prompt may have been deleted or paused while the engine was answering
              const after = promptStatus(prompt.id);
              if (after === "prompt_removed") {
                await recordFailure({ engine, promptId: prompt.id, kind: "prompt_removed", message: "Prompt deleted during the batch; its answer was not stored" }, { quiet: true });
                continue;
              }
              try {
                await CrawlerOrchestrator.persistRun({
                  runId,
                  brandId,
                  batchId,
                  promptId: prompt.id,
                  promptText: prompt.queryText,
                  engine,
                  runIdx,
                  engineResult,
                  brandDomain: brand.domain,
                  competitorDomains,
                  trackedEntities,
                  pageCache,
                });
                completedRuns++;
                updateBatch(batchId, { completedRuns });
              } catch (persistErr) {
                await recordFailure({ engine, promptId: prompt.id, kind: "error", message: `Persist failed: ${(persistErr as Error).message}` });
              }
            }
          }
          if (skipped > 0) console.warn(`[CrawlerOrchestrator] ${engine}: ${skipped} runs not attempted (${stopped?.kind || "still blocked after cool-downs"})`);
          enginesWorking--;
        })
      );

      // Mark batch finished
      const finalStatus = completedRuns > 0 ? "completed" : "failed";
      const byKind = failures.reduce<Record<string, number>>((acc, f) => {
        const key = `${f.engine} ${f.kind}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const failureSummary = Object.entries(byKind).map(([k, n]) => `${k} ×${n}`).join(", ");
      const statusMessage =
        completedRuns >= totalRuns && failures.length === 0
          ? "Audit completed successfully"
          : `${completedRuns}/${totalRuns} runs captured${failureSummary ? ` — ${failureSummary}` : ""}`;
      updateBatch(batchId, { status: finalStatus, currentPrompt: statusMessage, currentEngine: null, failedRuns, errorsJson: JSON.stringify(failures), finishedAt: nowIso() });

      console.log(`[CrawlerOrchestrator] Finished batch ${batchId}: ${statusMessage}`);
      return batchId;
    } catch (batchFatalErr) {
      console.error(`[CrawlerOrchestrator] Fatal error on batch ${batchId}:`, batchFatalErr);
      updateBatch(batchId, { status: "failed", currentPrompt: (batchFatalErr as Error).message, finishedAt: nowIso() });
      throw batchFatalErr;
    } finally {
      clearInterval(heartbeat);
      activeBatches.delete(batchId);
      pageCache.clear();
      if (sharedBrowser) {
        try {
          await sharedBrowser.close();
        } catch (closeErr) {
          console.warn("[CrawlerOrchestrator] Browser close warning:", (closeErr as Error).message);
        }
      }
    }
  }

  /**
   * Stores one captured answer with its citations, verified reused passages and entity mentions.
   * Cited pages are fetched first; the writes then happen in one synchronous transaction, so a
   * failed insert never leaves a half-stored answer (and concurrent engines cannot interleave).
   */
  private static async persistRun(args: {
    runId: string;
    brandId: string;
    batchId: string;
    promptId: string;
    promptText: string;
    engine: EngineName;
    runIdx: number;
    engineResult: EngineAnswer;
    brandDomain: string;
    competitorDomains: string[];
    trackedEntities: CrawlEntity[];
    pageCache: PageCache;
  }): Promise<void> {
    const { runId, brandId, batchId, promptId, promptText, engine, runIdx, engineResult, brandDomain, competitorDomains, trackedEntities, pageCache } = args;
    const id = (prefix: string) => `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
    const text = engineResult.responseText;

    // Citations: URLs in the answer and the links the engine attached, in document order
    const combinedText = `${text}\n${engineResult.citations.map((c) => c.url).join("\n")}`;
    const extracted = ReverseRagParser.extractCitationsFromText(combinedText, brandDomain, competitorDomains);
    const engineTitles = new Map<string, string>();
    for (const c of engineResult.citations) {
      const canonical = ReverseRagParser.normalizeUrl(c.url).normalizedUrl;
      if (canonical && c.title && !engineTitles.has(canonical)) engineTitles.set(canonical, c.title);
    }
    const citations = [];
    for (const cit of extracted) {
      const row = {
        ...cit,
        id: id("cit"),
        title: engineTitles.get(cit.url) || cit.anchorText || cit.domain,
        passage: null as null | { text: string; score: number; selfContained: boolean; sentence: string; shingles: number },
      };
      // Reverse-RAG: brand pages and the top-2 sources, stored only with evidence of reuse
      if (cit.isBrandDomain || cit.rank <= 2) {
        const pageText = await cachedPageText(pageCache, cit.url);
        const a = ReverseRagParser.computeChunkAlignment(text, pageText, cit.url);
        if (a.isReuse && a.sourceChunkText) {
          row.passage = { text: a.sourceChunkText, score: a.alignmentScore, selfContained: a.isSelfContained, sentence: a.answerSentence, shingles: a.sharedShingles };
        }
      }
      citations.push(row);
    }

    // Entity mentions on the prose-only text; echoes of the prompt get no rank
    const { prose, mentions } = detectMentions(text, trackedEntities, promptText);
    const allStarts = mentions.flatMap((m) => m.hits.map((h) => h.index));
    const lookalikes = lookalikeDomains(text, citations.map((c) => c.domain), brandDomain);
    const flags = lookalikes.length > 0 ? { entityConfusion: { lookalikeDomains: lookalikes } } : {};

    const sqlite = getRawDb();
    const createdAt = nowIso();
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite
        .prepare(
          `INSERT INTO prompt_runs (id, brand_id, batch_id, prompt_id, engine, run_index, response_text, sub_queries_json, execution_ms, capture_method, flags_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, brandId, batchId, promptId, engine, runIdx, text, JSON.stringify(engineResult.subQueries), engineResult.executionMs, engineResult.captureMethod, JSON.stringify(flags), createdAt);
      const insertCitation = sqlite.prepare(
        `INSERT INTO citations (id, brand_id, run_id, domain, url, title, anchor_text, rank, is_brand_domain, is_competitor_domain, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPassage = sqlite.prepare(
        `INSERT INTO reverse_rag_chunks (id, brand_id, run_id, citation_id, source_url, matched_chunk_text, similarity_score, self_contained_score, answer_sentence, shared_shingles, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of citations) {
        insertCitation.run(c.id, brandId, runId, c.domain, c.url, c.title, c.anchorText ?? null, c.rank, c.isBrandDomain ? 1 : 0, c.isCompetitorDomain ? 1 : 0, createdAt);
        if (c.passage) {
          insertPassage.run(id("chk"), brandId, runId, c.id, c.url, c.passage.text, c.passage.score, c.passage.selfContained ? 1.0 : 0.5, c.passage.sentence, c.passage.shingles, createdAt);
        }
      }
      const insertMention = sqlite.prepare(
        `INSERT INTO entity_mentions (id, brand_id, run_id, competitor_id, entity_name, is_target_brand, is_competitor, is_prompt_subject, sentiment, stance, has_caveat,
           prominence_score, position_rank, list_position, entity_confusion, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of mentions) {
        const stance = stanceOf(prose, m.hits, allStarts);
        insertMention.run(
          id("ent"),
          brandId,
          runId,
          m.entity.competitorId,
          m.entity.name,
          m.entity.isTarget ? 1 : 0,
          m.entity.isTarget ? 0 : 1,
          m.isPromptSubject ? 1 : 0,
          stance.sentiment,
          stance.stance,
          stance.hasCaveat ? 1 : 0,
          prominenceScore(m.hits[0].index, prose.length, m.listPosition),
          m.positionRank,
          m.listPosition,
          m.entity.isTarget && lookalikes.length > 0 ? 1 : 0,
          createdAt
        );
      }
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

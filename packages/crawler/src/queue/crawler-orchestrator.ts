import { getSettings, getRawDb, nowIso, rowToBrand } from "@prismgeo/db";
import {
  ReverseRagParser,
  detectMentions,
  lookalikeDomains,
  prominenceScore,
  ENGINE_IDS,
  ENGINES,
  type EngineId,
  detectLocalisation,
  languageFor,
  originCountry,
  seededShuffle,
  stanceOf,
  type TrackedEntity,
} from "@prismgeo/core";
import { PerplexityEngineCrawler } from "../engines/perplexity";
import { GoogleAioCrawler, NoAiOverviewError } from "../engines/google-aio";
import { CopilotEngineCrawler } from "../engines/copilot";
import { GeminiEngineCrawler } from "../engines/gemini";
import { ChatGptEngineCrawler } from "../engines/chatgpt";
import { AnswerNotFinishedError, EngineBlockedError, QuestionNotSentError, type EngineAnswer } from "../engines/browser-session";
import { getProxyConfig } from "../engines/proxy";
import { runApiEngine, apiKeyFor, apiRouteFor, apiRouteLocation, countryCodeFor, ApiKeyRejectedError, type ApiEngine, type ApiKeys } from "../engines/api-engines";
import { connectionCountry, countryName, planRoutes } from "../engines/location";
import { blockGroup, browserCoolingDown, clearBrowserCooldown, recordBrowserBlock, recordBrowserSuccess, untilText } from "../engines/block-memory";
import { canShowWindow, checkWindowState } from "../engines/check-window";
import { ApiBudgetError } from "../engines/serpapi-quota";
import { budgetExhausted, enginePolicy } from "../engines/budgets";
import {
  addPendingPrompts,
  setPendingPrompts,
  getActionRequest,
  needsPerson,
  openActionFor,
  pageForAction,
  personWaitMs,
  raiseActionRequest,
  setActionStatus,
  waitForPerson,
  type ActionKind,
} from "./action-requests";
import { fetchPublicPage } from "../net/safe-fetch";
import { readProfile, verifyProfile, listAccounts, isProfileConnected, activeAccount, activeAccountLabel, ProfileInUseError, PROFILE_ENGINES, type ProfileEngine } from "../engines/profiles";
const isProfileEngine = (e: string): e is ProfileEngine => (PROFILE_ENGINES as string[]).includes(e);
import { storeManualCapture, trackedEntitiesFor, type ManualCaptureInput, type ManualCaptureResult } from "./manual-capture";
import { chromium, type Browser } from "playwright";
import { getChromiumExecutablePath } from "../stealth/fingerprint";
import crypto from "node:crypto";
import os from "node:os";
import * as cheerio from "cheerio";

export type EngineName = EngineId;

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
  /** How long an engine waits for a person to complete a check or sign-in (default: personWaitMs()). */
  personWaitMs?: number;
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
    | "session_expired"
    | "wrong_location"
    | "cooling_down"
    | "waiting_for_person"
    | "not_accepted"
    | "skipped_after_not_accepted"
    | "skipped_after_blocks"
    | "skipped_after_network"
    | "skipped_setup"
    | "prompt_removed"
    | "prompt_paused"
    | "api_key_rejected"
    | "network"
    | "setup"
    | "budget_reached"
    | "error";
  message: string;
  /** When it was recorded (ISO); free-engine budgets count failed attempts by time. */
  at?: string;
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
/** Chromium refusing a profile folder another browser has open (Chromium's own wording, and ours). */
const PROFILE_IN_USE = /ProcessSingleton|existing browser session|already in use|SingletonLock/i;
const SETUP_ERROR = /browserType\.launch(PersistentContext)?: Executable doesn't exist|Failed to launch|chromium.*not found/i;

/** Consecutive blocks after which an engine cools down before trying again. */
const MAX_CONSECUTIVE_BLOCKS = 2;
/** Consecutive network failures after which an engine stops for this batch. */
const MAX_CONSECUTIVE_NETWORK = 2;
/** Times one engine waits for a person in one audit; a check that keeps coming back stops it after that. */
const MAX_PERSON_HOLDS = 3;
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
  const [min, max] = enginePolicy(engine, isProfileConnected(engine)).delay;
  return [min * 1000, max * 1000];
}

/** Engine access mode from Settings: browser only, API keys only, or browser with API fallback. */
type EngineMode = "stealth" | "byok" | "hybrid";
const API_ENGINES: EngineName[] = ENGINE_IDS.filter((e) => ENGINES[e].routes.keyed.length > 0);

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
  const rawMessage = ((err as Error)?.message || String(err)).replace(/\u001b\[[0-9;]*m/g, "");
  const message = rawMessage.split(/\nCall log:|\n╔/)[0].trim();
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const causeText = cause ? `${cause.code || ""} ${cause.message || ""}` : "";
  let kind: RunFailure["kind"] = "error";
  if (err instanceof EngineBlockedError) kind = "blocked";
  else if (err instanceof NoAiOverviewError) kind = "no_ai_overview";
  else if (err instanceof ApiKeyRejectedError) kind = "api_key_rejected";
  else if (err instanceof QuestionNotSentError) kind = "not_accepted";
  else if (err instanceof ApiBudgetError) kind = "budget_reached";
  else if (err instanceof AnswerNotFinishedError || /No extractable response|present but empty|did not finish/.test(message)) kind = "no_answer";
  // A profile another browser holds fails to launch too, but it is not a missing browser: it passes
  else if (err instanceof ProfileInUseError || PROFILE_IN_USE.test(rawMessage)) kind = "error";
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

/**
 * This machine's country and the measured markets (Settings → Engines & access). Markets default
 * to the data provider's market, which defaults to the United States.
 */
/** The saved place when it lies in the search country ("Chicago,Illinois,United States" in United States), else null. */
export function placeInCountry(place: string | undefined, country: string): string | null {
  const p = (place || "").trim();
  if (!p || !p.includes(",")) return null;
  return p.split(",").pop()!.trim().toLowerCase() === country.split(",").pop()!.trim().toLowerCase() ? p : null;
}

/**
 * Whether Google answers asked from this computer with a uule location signal were shown to match
 * answers asked from inside the country (Settings → Search location → Calibrate), for that country.
 */
export function uuleCalibrationTrusted(country: string | null): boolean {
  if (!country) return false;
  const c = getSettings<{ country?: string; trusted?: boolean }>("location_calibration", {});
  return c.trusted === true && c.country === country;
}

export function localeFromSettings(s: { markets?: string; providerLocation?: string }): { origin: string | null; markets: string[] } {
  // A provider location can contain commas ("London,England,United Kingdom"), so the fallback stays whole
  const markets = (s.markets ? s.markets.split(/\s*[,;|]\s*/) : [s.providerLocation || "United States"]).map((m) => m.trim()).filter(Boolean);
  return { origin: originCountry(), markets };
}

/**
 * Parallel requests per engine on a paid route. DataForSEO allows 30 concurrent live tasks per
 * account; the engines' own APIs rate-limit per key (Gemini's free tier most of all). Browser
 * engines always use one page at a time. PRISMGEO_API_CONCURRENCY caps it (1–10).
 */
export function apiConcurrency(engine: string, keys: ApiKeys): number {
  const route = apiRouteFor(engine, keys);
  const wanted = !route ? 1 : route.kind === "dataforseo" ? 5 : route.kind === "gemini" ? 1 : 2;
  const cap = Number(process.env.PRISMGEO_API_CONCURRENCY);
  return Number.isFinite(cap) && cap >= 1 ? Math.min(wanted, Math.floor(cap), 10) : wanted;
}

/** Tracked entity as the crawler uses it (key = competitor id, or "brand"). */
export interface CrawlEntity extends TrackedEntity {
  competitorId: string | null;
}

export class CrawlerOrchestrator {
  /**
   * Stores an answer a person captured with the PrismGEO extension, through the same pipeline as a
   * crawled answer (see manual-capture.ts).
   */
  public static storeManualCapture(input: ManualCaptureInput): Promise<ManualCaptureResult> {
    return storeManualCapture(input, (args) => CrawlerOrchestrator.persistRun({ ...args, pageCache: new Map() }));
  }

  /** True while `batchId` is still being executed by this process. */
  public static isRunning(batchId: string): boolean {
    return activeBatches.has(batchId);
  }

  public static async executeBatch(options: CrawlBatchOptions): Promise<string> {
    const brandId = options.brandId;
    const sampleSize = options.sampleSize || 5;
    const pacingScale = Math.max(0, options.pacingScale ?? 1);
    // Without a screen nobody can open the window, so the request is raised but nothing waits for it
    const waitForPersonMs = Math.max(0, options.personWaitMs ?? (canShowWindow() ? personWaitMs() : 0));
    const requestedEngines: EngineName[] = options.engines || [...ENGINE_IDS];

    // 1. Fetch brand and competitor configurations
    const sqlite = getRawDb();
    const brandRow = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId) as Record<string, any> | undefined;
    if (!brandRow) throw new Error(`Brand not found: ${brandId}`);
    const brand = rowToBrand(brandRow);
    // Paused competitors are neither tracked nor reported
    const { entities: trackedEntities, competitorDomains } = trackedEntitiesFor(brand);

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

    const engineSettings = getSettings<{ mode?: EngineMode; providerLocation?: string; providerLanguage?: string; markets?: string; strictLocation?: boolean; searchPlace?: string }>("engine_settings", {});
    // The search location: every route asks from here, as a buyer in that market would
    const searchLocation = engineSettings.providerLocation?.trim() || "United States";
    // A language not spoken in the chosen country falls back to the country's main one
    // An optional place inside the country (Google's canonical name), used only when it is in that country
    const place = placeInCountry(engineSettings.searchPlace, searchLocation);
    const providerOptions = { location: searchLocation, place: place || undefined, language: languageFor(searchLocation, engineSettings.providerLanguage) };
    const targetCountry = countryCodeFor(searchLocation);
    // Google answers from here count as asked from the search location only once calibration showed it
    const uuleTrusted = uuleCalibrationTrusted(targetCountry);
    // Off unless chosen: audits run as before, and every answer records where it was asked from
    const strictLocation = engineSettings.strictLocation === true;
    // Where a browser on this computer is answered for: its connection (or proxy) country
    const connection = await connectionCountry();
    const locale = localeFromSettings(engineSettings);
    if (connection) locale.origin = countryName(connection);
    // Hybrid is the default: identical to browser-only until a key is saved, then keys are used when blocked
    const mode: EngineMode = engineSettings.mode === "byok" || engineSettings.mode === "stealth" ? engineSettings.mode : "hybrid";
    const apiKeys = getSettings<ApiKeys>("byok_api_keys", {});
    const hasApi = (engine: EngineName) => mode !== "stealth" && API_ENGINES.includes(engine) && apiKeyFor(engine, apiKeys) !== "";

    // Engines that cannot be crawled at all are reported once instead of failing every run.
    const failures: RunFailure[] = [];
    // Saved sessions are re-checked before use: one that expired or was signed out is reported,
    // and the engine runs logged out (Copilot, which needs an account, is skipped)
    for (const engine of requestedEngines) {
      if (!isProfileEngine(engine)) continue;
      const signedInBefore = listAccounts(engine).filter((a) => readProfile(engine, a)?.signedIn === true);
      if (!signedInBefore.length) continue;
      for (const account of signedInBefore) await verifyProfile(engine, account);
      // Only when every account that was signed in has lapsed does the engine fall back to logged out
      if (!isProfileConnected(engine)) {
        failures.push({
          engine,
          promptId: null,
          kind: "session_expired",
          message: `The signed-in ${engine} session has expired or was signed out, so this audit ran logged out. Reconnect it on the Engines page.`,
        });
        // Shown under the bell too; the engine is not held for it, since it can still answer logged out
        raiseActionRequest({ brandId, batchId: options.batchId ?? null, engine, account: signedInBefore[0], kind: "sign_in", detail: "The saved session expired or was signed out" });
      }
    }
    // Which routes may answer each engine from the search location
    // An engine whose browser blocked this computer recently rests until the block has passed,
    // unless a person is asked to clear it (see the bell): then the engine waits for them instead.
    // With nobody to wait for (no screen), the rest period always applies: otherwise an open
    // request would send every audit straight into the same check, and the engine never recovers.
    const awaitsPerson = (engine: EngineName) => waitForPersonMs > 0 && openActionFor(engine, brandId)?.kind === "human_check";
    const resting = new Map(requestedEngines.map((engine) => [engine, awaitsPerson(engine) ? null : browserCoolingDown(engine)] as const));
    const plans = new Map(
      requestedEngines.map((engine) => [
        engine,
        planRoutes({
          engineLabel: ENGINES[engine].label,
          strict: strictLocation,
          target: targetCountry,
          targetLabel: searchLocation,
          connection,
          // The mode only orders the routes (see viaApi); every engine but AI Mode has a browser route
          hasBrowser: engine !== "google_ai_mode" && !resting.get(engine),
          // Google's browser route sends the location itself (uule); trusted once calibrated
          // Google's own location signal (uule, gl, hl), as location checkers such as valentin.app
          // use it: approximately in the market. Only "Only search from here" needs a passing calibration
          browserLocated: engine === "google_aio" && (uuleTrusted || !strictLocation),
          apiRoute: hasApi(engine) ? apiRouteLocation(engine, apiKeys) : null,
        }),
      ])
    );
    const apiAllowed = (engine: EngineName) => plans.get(engine)?.api === true;
    const engines = requestedEngines.filter((engine) => {
      const plan = plans.get(engine)!;
      const rest = resting.get(engine);
      if (rest && !plan.api) {
        failures.push({
          engine,
          promptId: null,
          kind: "cooling_down",
          message: `Not run: ${ENGINES[engine].label} blocked this computer's browser (${rest.blocks} time${rest.blocks > 1 ? "s" : ""} in a row, last at ${untilText(rest.lastBlockAt)}). PrismGEO waits until ${untilText(rest.until)} so the block is not extended; a key or provider route is not affected.`,
        });
        return false;
      }
      if (plan.skip && !(engine === "google_ai_mode" && !hasApi(engine))) {
        failures.push({ engine, promptId: null, kind: "wrong_location", message: plan.skip });
        return false;
      }
      // Google AI Mode has no dependable browser route: it is answered through a key or provider only
      if (engine === "google_ai_mode" && !hasApi(engine)) {
        failures.push({
          engine,
          promptId: null,
          kind: "unavailable",
          message:
            mode === "stealth"
              ? "Google AI Mode is read through SerpApi, Apify or DataForSEO, which free browser mode does not use. Choose another mode in Settings → Engines & access."
              : "Google AI Mode needs a SerpApi key (free plan: 250 searches a month), an Apify token or the DataForSEO data provider (Settings → Engines & access).",
        });
        return false;
      }
      if (engine === "copilot" && plan.browser && !CopilotEngineCrawler.available) {
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

    let completedRuns = 0;
    let failedRuns = 0;
    let sharedBrowser: Browser | null = null;
    const pageCache: PageCache = new Map();
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    // Everything after the lock is taken is inside the try, so a throw here still releases the brand
    try {
      try {
        options.onStarted?.(batchId);
      } catch (err) {
        console.warn("[CrawlerOrchestrator] onStarted callback failed:", (err as Error).message);
      }

      console.log(`[CrawlerOrchestrator] Started batch ${batchId} for ${brand.name} (${activePrompts.length} prompts across ${engines.length} engines, N=${sampleSize})`);
      for (const f of failures) console.warn(`[CrawlerOrchestrator] Skipping ${f.engine}: ${f.message}`);

      const beat = () => {
        try {
          getRawDb().prepare("UPDATE crawl_batches SET heartbeat_at = ? WHERE id = ?").run(nowIso(), batchId);
        } catch (err) {
          console.warn("[CrawlerOrchestrator] Heartbeat failed:", (err as Error).message);
        }
      };
      heartbeat = setInterval(beat, HEARTBEAT_MS);
      (heartbeat as { unref?: () => void }).unref?.();

      const recordFailure = async (failure: RunFailure, { quiet = false } = {}) => {
        failedRuns++;
        failures.push({ ...failure, at: failure.at ?? nowIso() });
        if (!quiet) console.warn(`[CrawlerOrchestrator] ${failure.engine} ${failure.kind}: ${failure.message}`);
        // A busy database must not end an engine: the failure is kept in memory and written with the next update
        try {
          updateBatch(batchId, { failedRuns, errorsJson: JSON.stringify(failures) });
        } catch (err) {
          console.warn("[CrawlerOrchestrator] Could not save a failure yet:", (err as Error).message);
        }
      };
      const promptState = getRawDb().prepare("SELECT active FROM prompts WHERE id = ?");
      /** "ok", or why the prompt must not be queried / stored any more (paused or deleted mid-batch). */
      const promptStatus = (id: string): "ok" | "prompt_removed" | "prompt_paused" => {
        const row = promptState.get(id) as { active: number } | undefined;
        return !row ? "prompt_removed" : row.active === 0 ? "prompt_paused" : "ok";
      };

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

      const crawlEngine = async (engine: EngineName): Promise<void> => {
        let consecutiveBlocks = 0;
        let consecutiveNetwork = 0;
        let consecutiveNotAccepted = 0;
        let successesSinceBlock = 0;
        let paused = false;
        let cooldownsUsed = 0;
        /** Why this engine stopped for the rest of the batch. */
        let stopped: { kind: RunFailure["kind"]; message: string } | null = null;
        // Each block doubles the pause between queries (max 4x); successes halve it again
        let pacingFactor = 1;
        // byok: API whenever a key exists. hybrid: browser first, API when the browser fails.
        // A browser outside the search location is never used when only that location counts
        let viaApi = (mode === "byok" || engine === "google_ai_mode" || !plans.get(engine)!.browser || plans.get(engine)!.preferApi === true) && apiAllowed(engine);
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
        let cooling: Promise<void> | null = null;
        /** The request this engine is held on; questions it cannot ask are added to it. */
        let heldOn: string | null = null;
        let holdsUsed = 0;
        let holding: Promise<boolean> | null = null;
        /** The kind of step a person just completed, until the next question is answered or fails. */
        let justCleared: ActionKind | null = null;
        /** Steps a person completed that the engine still showed afterwards: not asked for again this audit. */
        const noHoldKinds = new Set<ActionKind>();
        /** The API key was refused: no more paid calls for this engine in this audit. */
        let keyRejected = false;
        /** Hybrid mode with a usable key: a failing browser falls back to the API instead of waiting. */
        const keyUsable = () => mode === "hybrid" && apiAllowed(engine) && !keyRejected;
        /**
         * Holds this engine until a person completes the request (true) or the wait ends (false).
         * Parallel workers share one wait. The other engines keep running meanwhile.
         */
        const holdForPerson = (requestId: string, kind: ActionKind): Promise<boolean> =>
          (holding ??= (async () => {
            holdsUsed++;
            heldOn = requestId;
            const label = ENGINES[engine].label;
            const step = kind === "sign_in" ? "sign in" : "complete a \"verify you are human\" check";
            updateBatch(batchId, { currentEngine: engine, currentPrompt: `Waiting for you: ${label} asks you to ${step} (see the bell)` });
            console.warn(`[CrawlerOrchestrator] ${engine} waits up to ${Math.round(waitForPersonMs / 60_000)} min for a person (${kind}, request ${requestId})`);
            // This audit asks the held questions it has; any others wait for a resume
            const keepOthers = () => {
              const asked = new Set(items.map((i) => i.prompt.id));
              const left = (getActionRequest(requestId)?.pendingPromptIds || []).filter((id) => !asked.has(id));
              setPendingPrompts(requestId, left);
              return left;
            };
            if (await waitForPerson(requestId, waitForPersonMs, { windowOpen: () => checkWindowState(engine).open })) {
              const left = keepOthers();
              setActionStatus(requestId, left.length ? "ready" : "resolved", "Completed during the audit");
              clearBrowserCooldown(engine);
              heldOn = null;
              consecutiveBlocks = 0;
              firstQuery = true;
              justCleared = kind;
              return true;
            }
            // Nobody came, but a key can answer (hybrid): the questions go through the API instead
            if (keyUsable()) {
              if (!viaApi && !browserCoolingDown(engine)) recordBrowserBlock(engine, `${label} asked for a person (${kind})`);
              keepOthers();
              heldOn = null;
              viaApi = true;
              firstQuery = true;
              return true;
            }
            const dismissed = getActionRequest(requestId)?.status === "dismissed";
            if (dismissed) heldOn = null;
            stopped = dismissed
              ? { kind: "skipped_after_blocks", message: `Not run: ${label} asked for a person and the request was dismissed` }
              : { kind: "waiting_for_person", message: `Not run yet: ${label} is waiting for you to ${step}. The question stays under the bell and is asked once you resume.` };
            // Nobody cleared it: the next audits leave the browser route alone until someone does
            if (!viaApi && !browserCoolingDown(engine)) recordBrowserBlock(engine, `${label} asked for a person (${kind})`);
            return false;
          })().finally(() => {
            holding = null;
          }));
        const items = (promptsFor.get(engine) || []).flatMap((prompt) => Array.from({ length: sampleSize }, (_, runIdx) => ({ prompt, runIdx })));
        // Paid routes take parallel requests; a browser engine stays one page at a time, human-paced
        const workers = viaApi ? apiConcurrency(engine, apiKeys) : 1;

        const processItem = async (prompt: (typeof items)[number]["prompt"], runIdx: number): Promise<void> => {
          if (!stopped && setupFailure && !viaApi) stopped = { kind: "skipped_setup", message: `Not run: ${setupFailure}` };
          if (stopped) {
            skipped++;
            if (stopped.kind === "waiting_for_person" && heldOn) addPendingPrompts(heldOn, [prompt.id]);
            await recordFailure({ engine, promptId: prompt.id, kind: stopped.kind, message: stopped.message }, { quiet: true });
            return;
          }
          const state = promptStatus(prompt.id);
          if (state !== "ok") {
            await recordFailure(
              { engine, promptId: prompt.id, kind: state, message: state === "prompt_removed" ? "Prompt deleted during the batch; not queried" : "Prompt paused during the batch; not queried" },
              { quiet: true }
            );
            return;
          }
          if (paused && cooldownsUsed < COOLDOWNS_MS.length) {
            // Parallel workers share one cool-down: the first one starts it, the others wait for it
            cooling ??= (async () => {
              const wait = COOLDOWNS_MS[cooldownsUsed++];
              console.warn(`[CrawlerOrchestrator] ${engine} blocked repeatedly; cooling down ${wait / 60_000} min before retrying`);
              if (await coolDown(wait)) {
                paused = false;
                consecutiveBlocks = MAX_CONSECUTIVE_BLOCKS - 1; // one more block re-pauses at once
                firstQuery = true;
              } else {
                cooldownsUsed = COOLDOWNS_MS.length; // only cooling engines remain: nothing to wait for
              }
            })().finally(() => {
              cooling = null;
            });
            await cooling;
          }
          if (paused) {
            skipped++;
            await recordFailure(
              { engine, promptId: prompt.id, kind: "skipped_after_blocks", message: `${engine} still blocked after ${cooldownsUsed} cool-down(s)` },
              { quiet: true }
            );
            return;
          }
          // A free engine's hourly or daily budget (see budgets.ts) protects the account and this
          // computer's address; a key in hybrid mode takes over, otherwise the rest waits for later
          let spent = viaApi || pacingScale === 0 ? null : budgetExhausted(engine, isProfileConnected(engine));
          // Over the hourly cap: wait for room within the hour (the audit carries on by itself);
          // only the daily cap ends the engine's part of the audit
          while (spent?.window === "hour" && !(mode === "hybrid" && apiAllowed(engine))) {
            updateBatch(batchId, { currentEngine: engine, currentPrompt: `Pacing: ${ENGINES[engine].label} reached its safe hourly limit (${spent.limit}); continuing when the hour allows` });
            await new Promise((r) => setTimeout(r, 60_000));
            if (promptStatus(prompt.id) !== "ok") break;
            spent = budgetExhausted(engine, isProfileConnected(engine));
          }
          if (spent) {
            if (mode === "hybrid" && apiAllowed(engine)) viaApi = true;
            else {
              stopped = {
                kind: "budget_reached",
                message: `Not run: ${ENGINES[engine].label} already had ${spent.used} questions from this computer in the last ${spent.window === "day" ? "24 hours" : "hour"} (safe limit ${spent.limit}), so the rest waits for a later audit. Settings → Schedule can switch to fast pacing if you use your own proxy or paid accounts.`,
              };
              skipped++;
              await recordFailure({ engine, promptId: prompt.id, kind: stopped.kind, message: stopped.message }, { quiet: true });
              return;
            }
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
            if (engine === "google_aio") return GoogleAioCrawler.execute(prompt.queryText, browser, { country: targetCountry, language: providerOptions.language, place: place || searchLocation });
            throw new Error(`Unknown engine: ${engine}`);
          };
          const runEngine = (): Promise<EngineAnswer> => (viaApi ? runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys, providerOptions) : runBrowser());
          // The first question after a person completed a step tells whether it worked
          const afterPerson = justCleared;
          justCleared = null;
          let stillShown = false;
          try {
            try {
              engineResult = await runEngine();
            } catch (firstErr) {
              const kind = classifyFailure(engine, prompt.id, firstErr).kind;
              const asks = kind === "blocked" && !viaApi ? needsPerson((firstErr as Error).message) : null;
              // Seen live: Copilot kept showing its sign-in page to the automated browser after the
              // person signed in, so asking again would loop. That step is not asked for again this audit.
              if (asks && asks === afterPerson) {
                stillShown = true;
                noHoldKinds.add(asks);
              }
              // A check a person can clear is raised under the bell (below) instead of resting the route
              const forPerson = asks !== null && !noHoldKinds.has(asks) && holdsUsed < MAX_PERSON_HOLDS && !keyUsable();
              // Google's blocks and an account's usage limit last hours: rest the browser route at once
              // (other engines get the in-audit cool-downs first, see below)
              if (!viaApi && !forPerson && kind === "blocked" && (blockGroup(engine) === "google_search" || /usage limit/i.test((firstErr as Error).message))) {
                const rest = recordBrowserBlock(engine, (firstErr as Error).message);
                if (!keyUsable())
                  stopped = { kind: "cooling_down", message: `Not run: ${ENGINES[engine].label} blocked this computer's browser; PrismGEO waits until ${untilText(rest.until)} so the block is not extended` };
              }
              // The API cannot help when this machine has no connection, and "no AI Overview" is a real outcome
              if (!viaApi && keyUsable() && kind !== "no_ai_overview" && kind !== "network") {
                console.warn(`[CrawlerOrchestrator] ${engine} browser ${kind}; falling back to API: ${(firstErr as Error).message}`);
                if (kind === "blocked" || kind === "setup") viaApi = true; // stop using a browser that cannot work
                engineResult = await runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys, providerOptions);
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
            if (stillShown) {
              const label = ENGINES[engine].label;
              failure.message = `The ${afterPerson === "sign_in" ? "sign-in" : "human check"} was completed in the window, but ${label} still shows it to the automated browser; use a key or capture by hand (${failure.message})`;
            }
            // A rejected key stays rejected: no more paid calls for this engine in this audit
            if (failure.kind === "api_key_rejected") {
              keyRejected = true;
              if (viaApi) stopped = { kind: "api_key_rejected", message: `Not run: ${failure.message}` };
            }
            // A human check or sign-in: hold this engine for a person, then ask the question again
            const personKind = failure.kind === "blocked" && !viaApi ? needsPerson(failure.message) : null;
            if (personKind && !noHoldKinds.has(personKind) && holdsUsed < MAX_PERSON_HOLDS) {
              const request = raiseActionRequest({
                brandId,
                batchId,
                engine,
                account: activeAccount(engine) ?? "visitor",
                kind: personKind,
                detail: failure.message,
                pageUrl: pageForAction(engine, prompt.queryText),
                promptIds: [prompt.id],
              });
              if (await holdForPerson(request.id, personKind)) {
                items.push({ prompt, runIdx });
                return;
              }
              const reason = (stopped as { kind: RunFailure["kind"]; message: string } | null) ?? { kind: "waiting_for_person" as const, message: failure.message };
              await recordFailure({ engine, promptId: prompt.id, kind: reason.kind, message: `${reason.message} (${failure.message})` });
              return;
            }
            await recordFailure(failure);
            consecutiveBlocks = failure.kind === "blocked" ? consecutiveBlocks + 1 : 0;
            consecutiveNetwork = failure.kind === "network" ? consecutiveNetwork + 1 : 0;
            consecutiveNotAccepted = failure.kind === "not_accepted" ? consecutiveNotAccepted + 1 : 0;
            // The engine's page keeps ignoring questions: asking the rest would only repeat it
            if (consecutiveNotAccepted >= 2) stopped = { kind: "skipped_after_not_accepted", message: `Not run: ${ENGINES[engine].label} did not accept ${consecutiveNotAccepted} questions in a row from the automated browser` };
            if (failure.kind === "blocked") {
              pacingFactor = Math.min(4, pacingFactor * 2);
              successesSinceBlock = 0;
            }
            if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) paused = true;
            if (consecutiveNetwork >= MAX_CONSECUTIVE_NETWORK) {
              stopped = { kind: "skipped_after_network", message: `Not run: ${engine} could not connect ${consecutiveNetwork} times in a row (${failure.message})` };
            }
            // A paid plan's share for today is used up: the rest of this engine waits for the next days
            if (failure.kind === "budget_reached") stopped = { kind: "budget_reached", message: `Not run: ${failure.message}` };
            if (failure.kind === "setup") {
              if (!viaApi) setupFailure = failure.message;
              stopped = { kind: "skipped_setup", message: `Not run: ${failure.message}` };
            }
            return;
          }
          if (engineResult.captureMethod === "browser" || engineResult.captureMethod === "browser_signed_in") recordBrowserSuccess(engine);
          // A browser answer is asked from this computer's connection country
          if (!engineResult.searchedFrom && engineResult.captureMethod !== "manual" && connection) engineResult = { ...engineResult, searchedFrom: connection };
          consecutiveBlocks = 0;
          consecutiveNetwork = 0;
          consecutiveNotAccepted = 0;
          if (pacingFactor > 1 && ++successesSinceBlock >= PACING_DECAY_AFTER) {
            pacingFactor = Math.max(1, pacingFactor / 2);
            successesSinceBlock = 0;
          }

          // The prompt may have been deleted or paused while the engine was answering
          const after = promptStatus(prompt.id);
          if (after === "prompt_removed") {
            await recordFailure({ engine, promptId: prompt.id, kind: "prompt_removed", message: "Prompt deleted during the batch; its answer was not stored" }, { quiet: true });
            return;
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
              locale,
            });
            completedRuns++;
            updateBatch(batchId, { completedRuns });
          } catch (persistErr) {
            await recordFailure({ engine, promptId: prompt.id, kind: "error", message: `Persist failed: ${(persistErr as Error).message}` });
          }
        };

        // A request still open from an earlier audit holds the browser route from the start, so the
        // engine does not search into the same check again (a sign-in notice alone holds nothing).
        // Hybrid mode with a key never waits: a blocked browser falls back to the API, as in a run.
        const waiting = viaApi || keyUsable() ? null : openActionFor(engine, brandId);
        if (waiting && (waiting.kind === "human_check" || waiting.pendingPromptIds.length > 0)) {
          raiseActionRequest({ brandId, batchId, engine, account: waiting.account, kind: waiting.kind });
          // With no screen nobody can complete it: it stays under the bell, and the engine's rest
          // period (applied above) decides when it searches again
          if (waitForPersonMs > 0) await holdForPerson(waiting.id, waiting.kind);
        }

        let next = 0;
        await Promise.all(
          Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, async () => {
            while (next < items.length) {
              const { prompt, runIdx } = items[next++];
              // An unexpected throw (e.g. a busy database) fails this question and stops this engine only
              await processItem(prompt, runIdx).catch(async (err) => {
                stopped ??= { kind: "error", message: `Not run: ${ENGINES[engine].label} stopped after an unexpected error (${(err as Error)?.message || err})` };
                await recordFailure({ engine, promptId: prompt.id, kind: "error", message: (err as Error)?.message || String(err) });
              });
            }
          })
        );
        // Assigned inside the workers, which control-flow analysis does not follow
        const stopReason = stopped as { kind: RunFailure["kind"] } | null;
        if (skipped > 0) console.warn(`[CrawlerOrchestrator] ${engine}: ${skipped} runs not attempted (${stopReason?.kind || "still blocked after cool-downs"})`);
        // Still blocked after the in-audit cool-downs: the next audits leave the browser route alone for a while
        if (paused && !viaApi && !browserCoolingDown(engine)) recordBrowserBlock(engine, `${ENGINES[engine].label} still blocked after ${cooldownsUsed} cool-down(s)`);
      };

      // Each engine catches its own errors, so the batch always closes after every engine has finished
      // (one engine's throw must not end the batch and free the brand while the others still crawl)
      await Promise.all(
        engines.map((engine) =>
          crawlEngine(engine)
            .catch(async (err) => {
              console.error(`[CrawlerOrchestrator] ${engine} stopped after an unexpected error:`, err);
              await recordFailure({ engine, promptId: null, kind: "error", message: `${ENGINES[engine].label} stopped after an unexpected error: ${(err as Error)?.message || err}` });
            })
            .finally(() => {
              enginesWorking--;
            })
        )
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
      if (heartbeat) clearInterval(heartbeat);
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
    /** Where this machine is and which markets are measured, to flag answers tailored to the machine's location. */
    locale?: { origin: string | null; markets: string[] };
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
    const flags: Record<string, unknown> = lookalikes.length > 0 ? { entityConfusion: { lookalikeDomains: lookalikes } } : {};
    // Provenance of provider captures: who captured it, what it cost, which model answered
    if (engineResult.provider) flags.provider = engineResult.provider;
    if (typeof engineResult.costUsd === "number" && engineResult.costUsd > 0) flags.costUsd = engineResult.costUsd;
    if (engineResult.model) flags.model = engineResult.model;
    // Country the question was asked from ("US"), so answers from outside the market can be told apart
    if (engineResult.searchedFrom) flags.searchedFrom = engineResult.searchedFrom.toUpperCase();
    // The place the search was asked as from (Google's uule, or a provider's location) and the exact address
    if (engineResult.locationSignal) flags.locationSignal = engineResult.locationSignal;
    // A browser search sent with Google's location signal is approximately in the market, unless calibrated
    if (engineResult.locationSignal && engineResult.captureMethod !== "provider" && engineResult.captureMethod !== "manual") {
      flags.locationApproximate = getSettings<{ trusted?: boolean }>("location_calibration", {}).trusted !== true;
    }
    if (engineResult.searchUrl) flags.searchUrl = engineResult.searchUrl;
    if (engineResult.organic?.length) flags.organic = engineResult.organic;
    // Google sometimes answers with an AI Mode reply in the Overview slot: labelled, not mixed in silently
    if (engineResult.googleSurface) flags.googleSurface = engineResult.googleSurface;
    // Which signed-in account answered (its label), so persona results can be told apart
    if (engineResult.captureMethod === "browser_signed_in") {
      const account = activeAccountLabel(engine);
      if (account) flags.account = account;
    }
    // Answers tailored to this machine's location (not the measured market) are flagged, not mixed in.
    // Provider captures are asked from the chosen market; hand captures come from unknown places.
    if (args.locale && engineResult.captureMethod !== "provider" && engineResult.captureMethod !== "manual") {
      const localisedTo = detectLocalisation(text, promptText, args.locale);
      if (localisedTo) flags.localisedTo = localisedTo;
    }

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

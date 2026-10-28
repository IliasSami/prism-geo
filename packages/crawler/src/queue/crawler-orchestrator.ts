import { db, schema, eq, getSettings, getRawDb } from "@prismgeo/db";
import { ReverseRagParser, MonteCarloMetricsCalculator } from "@prismgeo/core";
import { PerplexityEngineCrawler } from "../engines/perplexity";
import { GoogleAioCrawler, NoAiOverviewError } from "../engines/google-aio";
import { CopilotEngineCrawler } from "../engines/copilot";
import { GeminiEngineCrawler } from "../engines/gemini";
import { ChatGptEngineCrawler } from "../engines/chatgpt";
import { EngineBlockedError, getProxyConfig, type EngineAnswer } from "../engines/browser-session";
import { runApiEngine, apiKeyFor, ApiKeyRejectedError, type ApiEngine, type ApiKeys } from "../engines/api-engines";
import { chromium, type Browser } from "playwright";
import { getChromiumExecutablePath } from "../stealth/fingerprint";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

type EngineName = "perplexity" | "google_aio" | "copilot" | "gemini" | "chatgpt";

export interface CrawlBatchOptions {
  batchId?: string;
  brandId: string;
  sampleSize?: number; // Monte Carlo N runs
  engines?: EngineName[];
  promptLimit?: number;
  /** Crawl exactly these prompts (used by the rolling schedule); overrides promptLimit. */
  promptIds?: string[];
}

/** Why a run produced no stored answer. Persisted in crawl_batches.errors_json. */
export interface RunFailure {
  engine: EngineName;
  promptId: string | null;
  kind: "blocked" | "no_ai_overview" | "no_answer" | "unavailable" | "skipped_after_blocks" | "api_key_rejected" | "network" | "setup" | "error";
  message: string;
}

/** Chromium errors meaning the host was never reached: this machine's connection or proxy, not the engine. */
const NETWORK_ERROR = /net::ERR_(TUNNEL_CONNECTION_FAILED|PROXY_[A-Z_]+|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|NETWORK_CHANGED)/;

/** Consecutive blocks after which an engine cools down before trying again. */
const MAX_CONSECUTIVE_BLOCKS = 2;
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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * All surface forms an entity can appear as in an answer: its name, configured aliases, its
 * domain, and the name/domain without a generic suffix ("Globex AI" -> "Globex",
 * "globex.io" -> "globex"). Terms shorter than 4 characters are dropped to avoid false hits.
 */
function entityTerms(name: string, aliases: string[], domain: string): string[] {
  const terms = new Set<string>();
  const add = (t: string | undefined) => {
    const v = (t || "").trim();
    if (v.length >= 4) terms.add(v);
  };
  add(name);
  aliases.forEach(add);
  const cleanDomain = (domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  add(cleanDomain);
  add(cleanDomain.split(".")[0]);
  add(name.replace(/(\.(ai|io|com|co|app)|\s+(ai|app|inc|hq))$/i, ""));
  return [...terms];
}

/** First match of any term (whole-word, case-insensitive): its index and the exact text matched. */
function firstMention(text: string, terms: string[]): { index: number; matched: string } | null {
  let best: { index: number; matched: string } | null = null;
  for (const term of terms) {
    const m = new RegExp(`(?<![\\w])${escapeRegex(term)}(?![\\w])`, "i").exec(text);
    if (m && (!best || m.index < best.index)) best = { index: m.index, matched: m[0] };
  }
  return best;
}

/** Cited-page text keyed by URL, shared across runs so each source is downloaded once. */
const pageTextCache = new Map<string, Promise<string>>();

/**
 * Downloads a cited page and returns its readable text, one block per paragraph, for
 * reverse-RAG alignment. Returns "" for non-HTML, errors and timeouts.
 */
function fetchCitedPageText(url: string): Promise<string> {
  if (!pageTextCache.has(url)) {
    pageTextCache.set(
      url,
      (async () => {
        try {
          const res = await fetch(url, {
            redirect: "follow",
            signal: AbortSignal.timeout(12000),
            headers: {
              "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
              accept: "text/html,application/xhtml+xml",
            },
          });
          if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return "";
          const $ = cheerio.load((await res.text()).slice(0, 3_000_000));
          $("script, style, noscript, svg, nav, footer, header, form").remove();
          return $("h1, h2, h3, h4, p, li, td")
            .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
            .get()
            .filter((t) => t.length > 0)
            .join("\n\n");
        } catch {
          return "";
        }
      })()
    );
  }
  return pageTextCache.get(url)!;
}

function classifyFailure(engine: EngineName, promptId: string, err: unknown): RunFailure {
  // Playwright appends a colour-coded "Call log:" or a boxed install hint; keep only the error itself
  const message = ((err as Error)?.message || String(err)).replace(/\u001b\[[0-9;]*m/g, "").split(/\nCall log:|\n╔/)[0].trim();
  let kind: RunFailure["kind"] = "error";
  if (err instanceof EngineBlockedError) kind = "blocked";
  else if (err instanceof NoAiOverviewError) kind = "no_ai_overview";
  else if (err instanceof ApiKeyRejectedError) kind = "api_key_rejected";
  else if (/No extractable response|present but empty/.test(message)) kind = "no_answer";
  else if (NETWORK_ERROR.test(message)) kind = "network";
  else if (/browserType\.launch: Executable doesn't exist/.test(message)) kind = "setup";
  return { engine, promptId, kind, message };
}

/**
 * Batches executing in this server process. Kept on globalThis so dev hot-reloads do not lose
 * it; a batch row left "running" that is not in here was interrupted by a restart.
 */
const activeBatches: Set<string> = ((globalThis as any).__prismActiveBatches ??= new Set<string>());

/** How often a running batch proves it is alive, and how long silence means it died. */
const HEARTBEAT_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;

/**
 * Closes batches left "running" by a process that stopped (server restart, killed CLI). A batch
 * is alive while its process refreshes heartbeat_at, which works across the web server and CLI.
 * Returns the number of batches closed.
 */
export function closeStaleBatches(): number {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const stale = getRawDb()
    .prepare(
      `SELECT id FROM crawl_batches WHERE status = 'running'
       AND COALESCE(heartbeat_at, strftime('%Y-%m-%dT%H:%M:%fZ', created_at)) < ?`
    )
    .all(cutoff) as Array<{ id: string }>;
  const close = getRawDb().prepare(
    `UPDATE crawl_batches SET status = 'failed', current_prompt = 'Interrupted: the process running this batch stopped before it finished',
     finished_at = ? WHERE id = ? AND status = 'running'`
  );
  let closed = 0;
  for (const { id } of stale) {
    if (activeBatches.has(id)) continue;
    closed += close.run(new Date().toISOString(), id).changes as number;
  }
  if (closed > 0) console.warn(`[CrawlerOrchestrator] Closed ${closed} interrupted batch(es)`);
  return closed;
}

export class CrawlerOrchestrator {
  /** True while `batchId` is still being executed by this process. */
  public static isRunning(batchId: string): boolean {
    return activeBatches.has(batchId);
  }

  public static async executeBatch(options: CrawlBatchOptions): Promise<string> {
    const brandId = options.brandId;
    const sampleSize = options.sampleSize || 5;
    const requestedEngines: EngineName[] = options.engines || ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

    // 1. Fetch brand and competitor configurations
    const brand = await db.query.brands.findFirst({
      where: eq(schema.brands.id, brandId),
    });

    if (!brand) throw new Error(`Brand not found: ${brandId}`);

    const brandAliases: string[] = JSON.parse(brand.aliasesJson || "[]").filter((a: string) => a && a.trim().length > 0);

    const competitors = await db.query.competitors.findMany({
      where: eq(schema.competitors.brandId, brandId),
    });
    const competitorDomains = competitors.map((c: any) => c.domain);

    const trackedEntities = [
      { name: brand.name, isTarget: true, terms: entityTerms(brand.name, brandAliases, brand.domain) },
      ...competitors
        .filter((c: any) => c.name && c.name.trim())
        .map((c: any) => ({
          name: c.name as string,
          isTarget: false,
          terms: entityTerms(c.name, JSON.parse(c.aliasesJson || "[]"), c.domain),
        })),
    ];

    // Deactivated prompts are kept for history but never crawled
    const rawPrompts = (
      await db.query.prompts.findMany({
        where: eq(schema.prompts.brandId, brandId),
      })
    ).filter((p: any) => p.active !== false);

    if (rawPrompts.length === 0) {
      throw new Error(`No active prompts configured for brand ${brandId}`);
    }

    const activePrompts = options.promptIds
      ? rawPrompts.filter((p: any) => options.promptIds!.includes(p.id))
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

    // 2. Resolve or create batch record
    const batchId = options.batchId || `batch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const totalRuns = activePrompts.length * engines.length * sampleSize;

    const existingBatch = await db.query.crawlBatches.findFirst({
      where: eq(schema.crawlBatches.id, batchId),
    });

    if (existingBatch) {
      await db
        .update(schema.crawlBatches)
        .set({
          status: "running",
          sampleSize,
          totalRuns,
          currentPrompt: "Initializing stealth crawler engines...",
          currentEngine: engines[0] || "system",
          errorsJson: JSON.stringify(failures),
        })
        .where(eq(schema.crawlBatches.id, batchId));
    } else {
      await db.insert(schema.crawlBatches).values({
        id: batchId,
        brandId,
        status: "running",
        sampleSize,
        totalRuns,
        completedRuns: 0,
        currentPrompt: "Initializing stealth crawler engines...",
        currentEngine: engines[0] || "system",
        errorsJson: JSON.stringify(failures),
      });
    }

    console.log(`[CrawlerOrchestrator] Started batch ${batchId} for ${brand.name} (${activePrompts.length} prompts across ${engines.length} engines, N=${sampleSize})`);
    for (const f of failures) console.warn(`[CrawlerOrchestrator] Skipping ${f.engine}: ${f.message}`);

    let completedRuns = 0;
    let failedRuns = 0;
    let sharedBrowser: Browser | null = null;
    activeBatches.add(batchId);
    const beat = () => {
      try {
        getRawDb().prepare("UPDATE crawl_batches SET heartbeat_at = ? WHERE id = ?").run(new Date().toISOString(), batchId);
      } catch (err) {
        console.warn("[CrawlerOrchestrator] Heartbeat failed:", (err as Error).message);
      }
    };
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);

    const recordFailure = async (failure: RunFailure, { quiet = false } = {}) => {
      failedRuns++;
      failures.push(failure);
      if (!quiet) console.warn(`[CrawlerOrchestrator] ${failure.engine} ${failure.kind}: ${failure.message}`);
      await db
        .update(schema.crawlBatches)
        .set({ failedRuns, errorsJson: JSON.stringify(failures) })
        .where(eq(schema.crawlBatches.id, batchId));
    };

    try {
      try {
        sharedBrowser = await chromium.launch({
          headless: true,
          executablePath: getChromiumExecutablePath(),
          proxy: getProxyConfig(),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
          ],
        });
      } catch (browserLaunchErr) {
        console.warn("[CrawlerOrchestrator] Browser launch note:", (browserLaunchErr as Error).message);
      }

      // Engines run in parallel (different hosts); each engine works through its queries
      // sequentially with pacing, and cools down after repeated blocks.
      let enginesWorking = engines.length;
      await Promise.all(
        engines.map(async (engine) => {
          let consecutiveBlocks = 0;
          let paused = false;
          let cooldownsUsed = 0;
          // Each block doubles the pause between queries for the rest of the batch (max 4x)
          let pacingFactor = 1;
          const pause = () => {
            const [min, max] = pacingFor(engine, viaApi);
            return new Promise((r) => setTimeout(r, (min + Math.random() * (max - min)) * pacingFactor));
          };
          let skipped = 0;
          /** Waits out a cool-down, giving up early once every other engine has finished. */
          const coolDown = async (ms: number): Promise<boolean> => {
            const until = Date.now() + ms;
            while (Date.now() < until) {
              if (enginesWorking <= 1) return false;
              await new Promise((r) => setTimeout(r, 15_000));
            }
            return true;
          };
          let firstQuery = true;
          // byok: API whenever a key exists. hybrid: browser first, API when the browser fails.
          let viaApi = mode === "byok" && hasApi(engine);

          for (const prompt of activePrompts) {
            for (let runIdx = 0; runIdx < sampleSize; runIdx++) {
              if (paused && cooldownsUsed < COOLDOWNS_MS.length) {
                const wait = COOLDOWNS_MS[cooldownsUsed++];
                console.warn(`[CrawlerOrchestrator] ${engine} blocked repeatedly; cooling down ${wait / 60_000} min before retrying`);
                if (await coolDown(wait)) {
                  paused = false;
                  consecutiveBlocks = MAX_CONSECUTIVE_BLOCKS - 1; // one more block re-pauses at once
                  firstQuery = true;
                } else {
                  cooldownsUsed = COOLDOWNS_MS.length; // nothing left to wait for
                }
              }
              if (paused) {
                skipped++;
                await recordFailure(
                  {
                    engine,
                    promptId: prompt.id,
                    kind: "skipped_after_blocks",
                    message: `${engine} still blocked after ${cooldownsUsed} cool-down(s)`,
                  },
                  { quiet: true }
                );
                continue;
              }
              if (!firstQuery) await pause();
              firstQuery = false;

              const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

              // Update live progress markers
              await db
                .update(schema.crawlBatches)
                .set({
                  currentPrompt: prompt.queryText.slice(0, 80),
                  currentEngine: engine,
                })
                .where(eq(schema.crawlBatches.id, batchId));

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
              const runEngine = (): Promise<EngineAnswer> =>
                viaApi ? runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys) : runBrowser();
              try {
                try {
                  engineResult = await runEngine();
                } catch (firstErr) {
                  const kind = classifyFailure(engine, prompt.id, firstErr).kind;
                  if (!viaApi && mode === "hybrid" && hasApi(engine) && kind !== "no_ai_overview") {
                    // Hybrid: the browser was blocked or failed, so answer through the API instead
                    console.warn(`[CrawlerOrchestrator] ${engine} browser ${kind}; falling back to API: ${(firstErr as Error).message}`);
                    engineResult = await runApiEngine(engine as ApiEngine, prompt.queryText, apiKeys);
                    if (kind === "blocked") viaApi = true; // stop hitting a host that is blocking us
                  } else {
                    // One retry for transient failures (timeouts, half-rendered pages). Blocks,
                    // rejected keys and "no AI Overview" are real outcomes and are never retried.
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
                if (failure.kind === "blocked") pacingFactor = Math.min(4, pacingFactor * 2);
                if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) paused = true;
                continue;
              }
              consecutiveBlocks = 0;

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
                });
                completedRuns++;
                await db
                  .update(schema.crawlBatches)
                  .set({ completedRuns })
                  .where(eq(schema.crawlBatches.id, batchId));
              } catch (persistErr) {
                await recordFailure({ engine, promptId: prompt.id, kind: "error", message: `Persist failed: ${(persistErr as Error).message}` });
              }
            }
          }
          if (skipped > 0) console.warn(`[CrawlerOrchestrator] ${engine}: ${skipped} runs skipped, engine still blocked after cool-downs`);
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
      await db
        .update(schema.crawlBatches)
        .set({
          status: finalStatus,
          currentPrompt: statusMessage,
          failedRuns,
          errorsJson: JSON.stringify(failures),
          finishedAt: new Date().toISOString(),
        })
        .where(eq(schema.crawlBatches.id, batchId));

      console.log(`[CrawlerOrchestrator] Finished batch ${batchId}: ${statusMessage}`);
      return batchId;
    } catch (batchFatalErr) {
      console.error(`[CrawlerOrchestrator] Fatal error on batch ${batchId}:`, batchFatalErr);
      await db
        .update(schema.crawlBatches)
        .set({
          status: "failed",
          currentPrompt: (batchFatalErr as Error).message,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(schema.crawlBatches.id, batchId));
      throw batchFatalErr;
    } finally {
      clearInterval(heartbeat);
      activeBatches.delete(batchId);
      pageTextCache.clear();
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
   * Stores one captured answer with its citations, matched passages and entity mentions. Cited
   * pages are fetched first; the writes then happen in one synchronous transaction, so a failed
   * insert never leaves a half-stored answer (and concurrent engines cannot interleave with it).
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
    trackedEntities: Array<{ name: string; isTarget: boolean; terms: string[] }>;
  }): Promise<void> {
    const { runId, brandId, batchId, promptId, promptText, engine, runIdx, engineResult, brandDomain, competitorDomains, trackedEntities } = args;
    const id = (prefix: string) => `${prefix}-${crypto.randomBytes(6).toString("hex")}`;

    // Citations: links the engine attached to its answer, plus any URLs written in the text
    const combinedText = `${engineResult.responseText} ${engineResult.citations.map((c) => c.url).join(" ")}`;
    const extracted = ReverseRagParser.extractCitationsFromText(combinedText, brandDomain, competitorDomains);
    const citations = [];
    for (const cit of extracted) {
      const engineCit = engineResult.citations.find((c) => c.url === cit.url || c.url.includes(cit.domain));
      const row = { ...cit, id: id("cit"), title: engineCit?.title || cit.anchorText || cit.domain, passage: null as null | { text: string; score: number; selfContained: boolean } };
      // Reverse-RAG: align the answer against the cited page's own passages (brand pages and top-2 sources)
      if (cit.isBrandDomain || cit.rank <= 2) {
        const pageText = await fetchCitedPageText(cit.url);
        const alignment = ReverseRagParser.computeChunkAlignment(engineResult.responseText, pageText, cit.url);
        if (alignment.sourceChunkText && alignment.alignmentScore > 0) {
          row.passage = { text: alignment.sourceChunkText, score: alignment.alignmentScore, selfContained: alignment.isSelfContained };
        }
      }
      citations.push(row);
    }

    // Entity mentions: every tracked entity found in the answer, ranked by order of first mention
    const text = engineResult.responseText;
    const promptLower = promptText.toLowerCase();
    const replacing = /\b(alternatives?|instead of|replace|replacement|switch(ing)? from|cheaper than)\b/.test(promptLower);
    const mentioned = trackedEntities
      .map((entity) => ({ entity, hit: firstMention(text, entity.terms) }))
      .filter((m): m is { entity: (typeof trackedEntities)[0]; hit: { index: number; matched: string } } => m.hit !== null)
      .sort((a, b) => a.hit.index - b.hit.index);

    const sqlite = getRawDb();
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite
        .prepare(
          `INSERT INTO prompt_runs (id, brand_id, batch_id, prompt_id, engine, run_index, response_text, sub_queries_json, execution_ms, capture_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, brandId, batchId, promptId, engine, runIdx, text, JSON.stringify(engineResult.subQueries), engineResult.executionMs, engineResult.captureMethod);
      const insertCitation = sqlite.prepare(
        `INSERT INTO citations (id, brand_id, run_id, domain, url, title, anchor_text, rank, is_brand_domain, is_competitor_domain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPassage = sqlite.prepare(
        `INSERT INTO reverse_rag_chunks (id, brand_id, run_id, citation_id, source_url, matched_chunk_text, similarity_score, self_contained_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of citations) {
        insertCitation.run(c.id, brandId, runId, c.domain, c.url, c.title, c.anchorText ?? null, c.rank, c.isBrandDomain ? 1 : 0, c.isCompetitorDomain ? 1 : 0);
        if (c.passage) insertPassage.run(id("chk"), brandId, runId, c.id, c.url, c.passage.text, c.passage.score, c.passage.selfContained ? 1.0 : 0.5);
      }
      const insertMention = sqlite.prepare(
        `INSERT INTO entity_mentions (id, brand_id, run_id, entity_name, is_target_brand, is_competitor, sentiment, prominence_score, position_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      mentioned.forEach(({ entity, hit }, i) => {
        // "Alternatives to X": X is the product being replaced, so its mention is not an endorsement
        const subjectOfPrompt = replacing && entity.terms.some((t) => promptLower.includes(t.toLowerCase()));
        const sentiment = subjectOfPrompt ? "neutral" : MonteCarloMetricsCalculator.classifyStance(text, hit.matched).sentiment;
        insertMention.run(
          id("ent"),
          brandId,
          runId,
          entity.name,
          entity.isTarget ? 1 : 0,
          entity.isTarget ? 0 : 1,
          sentiment,
          MonteCarloMetricsCalculator.calculateProminenceScore(hit.index, text.length),
          i + 1
        );
      });
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

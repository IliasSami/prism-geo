import { getRawDb, getSettings, setSettings } from "@prismgeo/db";
import { CrawlerOrchestrator, BatchRunningError, recoverInterruptedBatches, type EngineName } from "./crawler-orchestrator";

/**
 * Rolling daily audits. Instead of asking every prompt at once (which trips per-IP rate limits
 * on Google and anonymous Perplexity), each day every engine is asked the N prompts IT measured
 * longest ago (ties broken at random). Over a cycle every prompt is refreshed on every engine,
 * including engines that were blocked on earlier days, and each engine only ever sees a small,
 * human-paced number of queries per day.
 */

export interface ScheduleSettings {
  scheduleEnabled?: boolean;
  schedulePromptsPerDay?: number;
  scheduleHour?: number;
  /** IANA time zone the hour is in (e.g. "Europe/Paris"). Defaults to the server's zone, stored on first use. */
  scheduleTimeZone?: string;
  sampleSize?: number;
}

const STATE_KEY = "schedule_state";
const ALL_ENGINES: EngineName[] = ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

/** The server's own IANA zone (UTC in most containers). */
export const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** True when `tz` is a valid IANA zone name. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date and hour of `now` in `timeZone`. */
export function zonedDateHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/**
 * Active prompts of a brand, least recently captured first (never-captured prompts lead), random
 * among ties. With `engine`, staleness is measured on that engine's answers only.
 */
export function stalestPromptIds(brandId: string, limit: number, engine?: string): string[] {
  const rows = getRawDb()
    .prepare(
      `SELECT p.id FROM prompts p LEFT JOIN prompt_runs r ON r.prompt_id = p.id ${engine ? "AND r.engine = ?" : ""}
       WHERE p.brand_id = ? AND p.active = 1
       GROUP BY p.id ORDER BY MAX(r.created_at) IS NOT NULL, MAX(r.created_at), RANDOM() LIMIT ?`
    )
    .all(...(engine ? [engine, brandId, limit] : [brandId, limit])) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Each engine's own stalest prompts (per-engine staleness, random tie-break). */
export function stalestPromptIdsByEngine(brandId: string, engines: readonly string[], limit: number): Record<string, string[]> {
  return Object.fromEntries(engines.map((e) => [e, stalestPromptIds(brandId, limit, e)]));
}

interface FollowUp {
  /** Local date the follow-ups belong to. */
  date: string;
  /** Engines that were rate-limited in today's slice. */
  engines: string[];
  /** ISO time of the next attempt. */
  next: string;
  count: number;
}

interface ScheduleState {
  lastRunDate?: string;
  /** Brand id -> local date its slice started. */
  brands?: Record<string, string>;
  /** Brand id -> today's follow-up slices for rate-limited engines. */
  followUps?: Record<string, FollowUp>;
}

/**
 * IP-limited engines (anonymous Google AIO and Perplexity accept a couple of queries per hour)
 * are not hammered in one burst: an engine that was blocked in the day's slice gets up to
 * FOLLOW_UPS_PER_DAY more small slices, FOLLOW_UP_GAP_MS apart, each asking the prompts that
 * engine has measured longest ago. This spreads the engine's daily budget over the day.
 */
export const FOLLOW_UP_GAP_MS = 2 * 60 * 60_000;
export const FOLLOW_UPS_PER_DAY = 4;

/** Engines whose runs in a batch were refused or skipped because of blocks. */
function blockedEnginesOf(batchId: string): string[] {
  const row = getRawDb().prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(batchId) as { errors_json: string } | undefined;
  let errors: Array<{ engine: string; kind: string }> = [];
  try {
    errors = JSON.parse(row?.errors_json || "[]");
  } catch {
    errors = [];
  }
  return [...new Set(errors.filter((e) => e.kind === "blocked" || e.kind === "skipped_after_blocks").map((e) => e.engine))];
}

function updateState(fn: (s: ScheduleState) => ScheduleState): void {
  setSettings(STATE_KEY, fn(getSettings<ScheduleState>(STATE_KEY, {})));
}

let running = false;

/**
 * Runs today's slice for every brand if it is due, then any due follow-up slices for engines that
 * were rate-limited. Safe to call repeatedly. A brand is marked done for the day only once its
 * batch has actually started; a brand that is already being crawled (by the web app, the CLI or
 * another server) is retried on the next check.
 */
export async function runScheduledAuditsIfDue(now = new Date()): Promise<void> {
  const settings = getSettings<ScheduleSettings>("crawler_settings", {});
  if (!settings.scheduleEnabled || running) return;
  let timeZone = settings.scheduleTimeZone && isValidTimeZone(settings.scheduleTimeZone) ? settings.scheduleTimeZone : "";
  if (!timeZone) {
    timeZone = serverTimeZone();
    setSettings("crawler_settings", { ...settings, scheduleTimeZone: timeZone });
  }
  const hour = Math.min(23, Math.max(0, Number(settings.scheduleHour ?? 9)));
  const local = zonedDateHour(now, timeZone);
  if (local.hour < hour) return;
  const state = getSettings<ScheduleState>(STATE_KEY, {});
  const dueFollowUps = Object.entries(state.followUps || {}).filter(
    ([, f]) => f.date === local.date && f.count < FOLLOW_UPS_PER_DAY && Date.parse(f.next) <= now.getTime()
  );
  if (state.lastRunDate === local.date && dueFollowUps.length === 0) return;

  running = true;
  try {
    const sqlite = getRawDb();
    const engineSettings = getSettings<Record<string, unknown>>("engine_settings", {});
    const engines = ALL_ENGINES.filter((e) => engineSettings[e] !== false);
    const perDay = Math.min(200, Math.max(1, Number(settings.schedulePromptsPerDay ?? 15)));
    const sampleSize = Math.min(5, Math.max(1, Number(settings.sampleSize ?? 1)));
    const scheduleFollowUp = (brandId: string, batchId: string | null, count: number) => {
      const blocked = batchId ? blockedEnginesOf(batchId).filter((e) => (engines as string[]).includes(e)) : [];
      updateState((s) => {
        const followUps = { ...(s.followUps || {}) };
        if (blocked.length === 0 || count >= FOLLOW_UPS_PER_DAY) delete followUps[brandId];
        else followUps[brandId] = { date: local.date, engines: blocked, next: new Date(now.getTime() + FOLLOW_UP_GAP_MS).toISOString(), count };
        return { ...s, followUps };
      });
    };

    // Follow-up slices for engines that were rate-limited earlier today
    for (const [brandId, f] of dueFollowUps) {
      const followEngines = engines.filter((e) => f.engines.includes(e));
      if (followEngines.length === 0) {
        scheduleFollowUp(brandId, null, FOLLOW_UPS_PER_DAY);
        continue;
      }
      try {
        const batchId = await CrawlerOrchestrator.executeBatch({
          brandId,
          promptIdsByEngine: stalestPromptIdsByEngine(brandId, followEngines, perDay),
          engines: followEngines,
          sampleSize,
        });
        scheduleFollowUp(brandId, batchId, f.count + 1);
      } catch (err) {
        if (err instanceof BatchRunningError) continue; // retried on the next check
        console.error("[Scheduler] Follow-up slice failed:", (err as Error).message);
        scheduleFollowUp(brandId, null, FOLLOW_UPS_PER_DAY);
      }
    }
    if (state.lastRunDate === local.date) return;

    const brands = sqlite.prepare("SELECT id, name FROM brands ORDER BY created_at").all() as Array<{ id: string; name: string }>;
    const doneToday = (id: string) => getSettings<ScheduleState>(STATE_KEY, {}).brands?.[id] === local.date;
    const markStarted = (id: string) => updateState((s) => ({ ...s, brands: { ...(s.brands || {}), [id]: local.date } }));
    let pending = 0;
    for (const brand of brands) {
      if (doneToday(brand.id)) continue;
      const promptIdsByEngine = stalestPromptIdsByEngine(brand.id, engines, perDay);
      if (Object.values(promptIdsByEngine).every((ids) => ids.length === 0)) {
        markStarted(brand.id);
        continue;
      }
      console.log(`[Scheduler] Daily rolling audit for ${brand.name}: ${perDay} stalest prompts per engine`);
      try {
        const batchId = await CrawlerOrchestrator.executeBatch({
          brandId: brand.id,
          promptIdsByEngine,
          engines: [...engines],
          sampleSize,
          onStarted: () => markStarted(brand.id),
        });
        scheduleFollowUp(brand.id, batchId, 0);
      } catch (err) {
        if (err instanceof BatchRunningError) {
          pending++;
          console.log(`[Scheduler] ${brand.name}: a batch is already running; will retry later today`);
        } else {
          console.error(`[Scheduler] ${brand.name} audit failed:`, (err as Error).message);
          if (!doneToday(brand.id)) pending++;
        }
      }
    }
    if (pending === 0) updateState((s) => ({ ...s, lastRunDate: local.date }));
  } finally {
    running = false;
  }
}

/** Starts the once-a-minute schedule check (idempotent across dev hot reloads). */
export function startScheduler(): void {
  const g = globalThis as any;
  if (g.__prismScheduler) return;
  // Batches left "running" by a previous process must not block audits or brand deletion
  recoverInterruptedBatches();
  g.__prismScheduler = setInterval(() => {
    runScheduledAuditsIfDue().catch((err) => console.error("[Scheduler]", err));
  }, 60_000);
  console.log("[Scheduler] Rolling audit scheduler started");
}

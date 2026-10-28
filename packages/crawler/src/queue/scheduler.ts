import { getRawDb, getSettings, setSettings } from "@prismgeo/db";
import { CrawlerOrchestrator, closeStaleBatches } from "./crawler-orchestrator";

/**
 * Rolling daily audits. Instead of asking every prompt at once (which trips per-IP rate limits
 * on Google and anonymous Perplexity), each day the N prompts measured longest ago are crawled.
 * Over a cycle every prompt is refreshed, and each engine only ever sees a small, human-paced
 * number of queries per day. This is the free, sustainable way to keep data current.
 */

export interface ScheduleSettings {
  scheduleEnabled?: boolean;
  schedulePromptsPerDay?: number;
  scheduleHour?: number;
  sampleSize?: number;
}

const STATE_KEY = "schedule_state";
const ALL_ENGINES = ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"] as const;

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Active prompts of a brand, least recently captured first (never-captured prompts lead). */
export function stalestPromptIds(brandId: string, limit: number): string[] {
  const rows = getRawDb()
    .prepare(
      `SELECT p.id FROM prompts p LEFT JOIN prompt_runs r ON r.prompt_id = p.id
       WHERE p.brand_id = ? AND p.active = 1
       GROUP BY p.id ORDER BY MAX(r.created_at) IS NOT NULL, MAX(r.created_at), p.created_at LIMIT ?`
    )
    .all(brandId, limit) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

let running = false;

/** Runs today's slice for every brand if it is due. Safe to call repeatedly. */
export async function runScheduledAuditsIfDue(now = new Date()): Promise<void> {
  const settings = getSettings<ScheduleSettings>("crawler_settings", {});
  if (!settings.scheduleEnabled || running) return;
  const hour = Math.min(23, Math.max(0, Number(settings.scheduleHour ?? 9)));
  if (now.getHours() < hour) return;
  const state = getSettings<{ lastRunDate?: string }>(STATE_KEY, {});
  const today = localDate();
  if (state.lastRunDate === today) return;

  const sqlite = getRawDb();
  // A batch orphaned by a restart would otherwise block every future scheduled run
  closeStaleBatches();
  if (sqlite.prepare("SELECT 1 FROM crawl_batches WHERE status = 'running' LIMIT 1").get()) return;

  running = true;
  setSettings(STATE_KEY, { lastRunDate: today });
  try {
    const engineSettings = getSettings<Record<string, unknown>>("engine_settings", {});
    const engines = ALL_ENGINES.filter((e) => engineSettings[e] !== false);
    const perDay = Math.min(200, Math.max(1, Number(settings.schedulePromptsPerDay ?? 15)));
    const brands = sqlite.prepare("SELECT id, name FROM brands ORDER BY created_at").all() as Array<{ id: string; name: string }>;
    for (const brand of brands) {
      const promptIds = stalestPromptIds(brand.id, perDay);
      if (promptIds.length === 0) continue;
      console.log(`[Scheduler] Daily rolling audit for ${brand.name}: ${promptIds.length} stalest prompts`);
      await CrawlerOrchestrator.executeBatch({
        brandId: brand.id,
        promptIds,
        engines: [...engines],
        sampleSize: Math.min(5, Math.max(1, Number(settings.sampleSize ?? 1))),
      }).catch((err) => console.error(`[Scheduler] ${brand.name} audit failed:`, (err as Error).message));
    }
  } finally {
    running = false;
  }
}

/** Starts the once-a-minute schedule check (idempotent across dev hot reloads). */
export function startScheduler(): void {
  const g = globalThis as any;
  if (g.__prismScheduler) return;
  g.__prismScheduler = setInterval(() => {
    runScheduledAuditsIfDue().catch((err) => console.error("[Scheduler]", err));
  }, 60_000);
  console.log("[Scheduler] Rolling audit scheduler started");
}

import crypto from "node:crypto";
import { z } from "zod";
import { getRawDb, getSettings, type BrandRecord } from "@prismgeo/db";
import { CrawlerOrchestrator, closeStaleBatches, isProfileConnected } from "@prismgeo/crawler";
import { ENGINE_IDS, intSchema, brandIdSchema, type EngineId } from "./validate";

/** Body of POST /api/crawl/start (also used by the MCP start_crawl tool). */
export const crawlStartSchema = z.object({
  brandId: brandIdSchema,
  engines: z
    .array(z.string({ error: "Engines must be engine ids" }), { error: "engines must be a list of engine ids" })
    .min(1, "Select at least one engine")
    .optional(),
  sampleSize: intSchema(1, 20, "Runs per question").optional(),
  // null means "all questions", like leaving it out
  promptLimit: z.preprocess((v) => (v === null ? undefined : v), intSchema(1, 100_000, "The number of questions").optional()),
});
export type CrawlStartInput = z.output<typeof crawlStartSchema>;

export type CrawlStartResult =
  | {
      ok: true;
      body: {
        success: true;
        batchId: string;
        brandId: string;
        totalRuns: number;
        sampleSize: number;
        engines: EngineId[];
        ignoredEngines: Array<{ engine: string; reason: string }>;
        status: "running";
      };
    }
  | { ok: false; status: number; body: { error: string; runningBatchId?: string; ignoredEngines?: Array<{ engine: string; reason: string }> } };

const COPILOT_REASON = "Copilot needs a signed-in session (Settings → Engines & access)";

/**
 * Starts a crawl batch for a brand in this process: checks the per-brand lock, picks the engines,
 * writes the batch row and runs the orchestrator in the background. Returns the response body.
 */
export function startCrawl(brand: BrandRecord, input: CrawlStartInput): CrawlStartResult {
  const sqlite = getRawDb();

  // Unknown engine ids are an input error, not something to drop silently
  const unknown = (input.engines || []).filter((e) => !(ENGINE_IDS as readonly string[]).includes(e));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: `Unknown engine${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Use ${ENGINE_IDS.join(", ")}.` } };
  }

  // Without an explicit list, run the engines enabled in Settings (the scheduler does the same)
  const engineSettings = getSettings<Record<string, unknown>>("engine_settings", {});
  const requested: EngineId[] = input.engines
    ? [...new Set(input.engines as EngineId[])]
    : ENGINE_IDS.filter((e) => engineSettings[e] !== false);

  const ignoredEngines: Array<{ engine: string; reason: string }> = [];
  const engines = requested.filter((e) => {
    // Copilot has no logged-out chat, so it only runs with a signed-in session
    if (e === "copilot" && !isProfileConnected("copilot")) {
      ignoredEngines.push({ engine: e, reason: COPILOT_REASON });
      return false;
    }
    return true;
  });
  if (engines.length === 0) {
    return { ok: false, status: 400, body: { error: "None of the selected engines can run", ignoredEngines } };
  }

  // Concurrency lock. Batches whose process stopped (restart, killed CLI) stop sending
  // heartbeats and are closed as interrupted first, so they cannot block new audits.
  closeStaleBatches();
  const running = sqlite
    .prepare("SELECT id FROM crawl_batches WHERE brand_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get(brand.id) as { id: string } | undefined;
  if (running) {
    return {
      ok: false,
      status: 409,
      body: { error: "An audit is already running for this client. Wait for it to finish.", runningBatchId: running.id },
    };
  }

  // Paused prompts are not crawled, so they do not count toward the batch size either
  const activePrompts = (sqlite.prepare("SELECT COUNT(*) AS n FROM prompts WHERE brand_id = ? AND active = 1").get(brand.id) as { n: number }).n;
  if (activePrompts === 0) {
    return { ok: false, status: 400, body: { error: "This client has no active questions. Add some on the Prompts page first." } };
  }

  const savedSample = Number(getSettings<Record<string, unknown>>("crawler_settings", {}).sampleSize);
  const sampleSize = input.sampleSize ?? (Number.isInteger(savedSample) ? Math.min(20, Math.max(1, savedSample)) : 1);
  const promptLimit = input.promptLimit ?? undefined;
  const promptCount = promptLimit ? Math.min(activePrompts, promptLimit) : activePrompts;
  const totalRuns = promptCount * engines.length * sampleSize;

  const batchId = `batch-${crypto.randomUUID()}`;
  sqlite
    .prepare(
      `INSERT INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, created_at)
       VALUES (?, ?, 'running', ?, ?, 0, 'Starting browsers...', 'system', ?)`,
    )
    .run(batchId, brand.id, sampleSize, totalRuns, new Date().toISOString());

  // Runs in the background; progress is read through /api/crawl/status
  CrawlerOrchestrator.executeBatch({ batchId, brandId: brand.id, sampleSize, engines, promptLimit }).catch((err) =>
    console.error("[crawl] batch", batchId, "failed:", err),
  );

  return {
    ok: true,
    body: { success: true, batchId, brandId: brand.id, totalRuns, sampleSize, engines, ignoredEngines, status: "running" },
  };
}

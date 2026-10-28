import { getRawDb, rowToBrand, type BrandRecord } from "./client";

/**
 * Every stored row the visibility report needs for one brand, loaded with one query per table.
 * Pass the result to `buildVisibilityReport()` from @prismgeo/core:
 *
 *   buildVisibilityReport(loadReportInput(brandId))
 *
 * This is the single report path for the dashboard and any other consumer (MCP, exports).
 */
export interface ReportInputRows {
  brand: BrandRecord;
  runs: Array<{ id: string; prompt_id: string; engine: string; capture_method: string; created_at: string; flags_json: string | null }>;
  prompts: Array<{ id: string; query_text: string; intent_type: string; active: number }>;
  /** Active competitors only (paused competitors are neither tracked nor reported). */
  competitors: Array<{ id: string; name: string; domain: string; aliases_json: string | null }>;
  mentions: Array<{
    run_id: string;
    entity_name: string;
    competitor_id: string | null;
    is_target_brand: number;
    is_prompt_subject: number | null;
    position_rank: number | null;
    list_position: number | null;
    sentiment: string;
    stance: string | null;
    has_caveat: number;
    entity_confusion: number;
  }>;
  citations: Array<{ run_id: string; domain: string; url: string }>;
  batches: Array<{ failed_runs: number; errors_json: string }>;
}

export function loadReportInput(brandOrId: string | BrandRecord): ReportInputRows {
  const sqlite = getRawDb();
  let brand: BrandRecord;
  if (typeof brandOrId === "string") {
    const row = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandOrId) as Record<string, any> | undefined;
    if (!row) throw new Error(`Brand not found: ${brandOrId}`);
    brand = rowToBrand(row);
  } else {
    brand = brandOrId;
  }
  const id = brand.id;
  return {
    brand,
    runs: sqlite
      .prepare("SELECT id, prompt_id, engine, capture_method, created_at, flags_json FROM prompt_runs WHERE brand_id = ? ORDER BY created_at")
      .all(id) as ReportInputRows["runs"],
    prompts: sqlite.prepare("SELECT id, query_text, intent_type, active FROM prompts WHERE brand_id = ? ORDER BY created_at").all(id) as ReportInputRows["prompts"],
    competitors: sqlite
      .prepare("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ? AND active = 1 ORDER BY created_at")
      .all(id) as ReportInputRows["competitors"],
    mentions: sqlite
      .prepare(
        `SELECT run_id, entity_name, competitor_id, is_target_brand, is_prompt_subject, position_rank, list_position, sentiment, stance, has_caveat, entity_confusion
         FROM entity_mentions WHERE brand_id = ?`
      )
      .all(id) as ReportInputRows["mentions"],
    citations: sqlite.prepare("SELECT run_id, domain, url FROM citations WHERE brand_id = ?").all(id) as ReportInputRows["citations"],
    batches: sqlite.prepare("SELECT failed_runs, errors_json FROM crawl_batches WHERE brand_id = ?").all(id) as ReportInputRows["batches"],
  };
}

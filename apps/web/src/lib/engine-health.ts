import { getRawDb, getSettings } from "@prismgeo/db";
import { isProfileConnected, apiKeyFor, engineRemedy, type ApiKeys } from "@prismgeo/crawler";

export const ALL_ENGINES = ["chatgpt", "gemini", "perplexity", "google_aio", "copilot"] as const;
export type EngineId = (typeof ALL_ENGINES)[number];

export type HealthStatus = "working" | "degraded" | "blocked" | "untested" | "not_set_up";

export interface EngineHealth {
  engine: EngineId;
  enabled: boolean;
  status: HealthStatus;
  /** Captured answers and attempted runs in the engine's most recent batch. */
  captured: number;
  attempted: number;
  /** How the engine is reached on the next audit. */
  route: "browser" | "signed_in" | "api";
  /** A saved API key answers when the browser is blocked (hybrid mode). */
  apiFallback: boolean;
  remedy: string | null;
  lastRunAt: string | null;
}

/**
 * Engine status from the most recent batch that included the engine: Working when at least 80%
 * of its attempted runs produced an answer, Degraded from 20%, Blocked below. "No AI Overview"
 * counts as a real outcome, not a failure.
 */
export function getEngineHealth(brandId: string | undefined): EngineHealth[] {
  const sqlite = getRawDb();
  const settings = getSettings<Record<string, unknown>>("engine_settings", {});
  const mode = settings.mode === "stealth" ? "stealth" : settings.mode === "byok" ? "byok" : "hybrid";
  const keys = getSettings<ApiKeys>("byok_api_keys", {});
  const batches = brandId
    ? (sqlite
        .prepare("SELECT id, errors_json, created_at FROM crawl_batches WHERE brand_id = ? AND status <> 'running' ORDER BY created_at DESC LIMIT 10")
        .all(brandId) as Array<{ id: string; errors_json: string; created_at: string }>)
    : [];

  return ALL_ENGINES.map((engine) => {
    const enabled = settings[engine] !== false;
    const hasKey = mode !== "stealth" && engine !== "copilot" && apiKeyFor(engine, keys) !== "";
    const signedIn = isProfileConnected(engine);
    const route: EngineHealth["route"] = mode === "byok" && hasKey ? "api" : signedIn ? "signed_in" : "browser";

    let captured = 0;
    let failed = 0;
    let lastRunAt: string | null = null;
    let lastKind: string | null = null;
    for (const b of batches) {
      const runs = Number(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE batch_id = ? AND engine = ?").get(b.id, engine) as { n: number }).n
      );
      let errors: Array<{ engine: string; kind: string }> = [];
      try {
        errors = JSON.parse(b.errors_json || "[]");
      } catch {}
      const mine = errors.filter((e) => e.engine === engine && e.kind !== "no_ai_overview" && e.kind !== "unavailable" && e.kind !== "network" && e.kind !== "setup");
      const overviews = errors.filter((e) => e.engine === engine && e.kind === "no_ai_overview").length;
      if (runs + mine.length + overviews === 0) continue;
      captured = runs + overviews;
      failed = mine.length;
      lastRunAt = b.created_at;
      lastKind = mine.find((e) => e.kind === "blocked")?.kind || mine[0]?.kind || null;
      break;
    }
    const attempted = captured + failed;
    let status: HealthStatus;
    if (engine === "copilot" && !signedIn) status = "not_set_up";
    else if (attempted === 0) status = "untested";
    else if (captured / attempted >= 0.8) status = "working";
    else if (captured / attempted >= 0.2) status = "degraded";
    else status = "blocked";
    const remedy =
      status === "blocked" || status === "degraded" || status === "not_set_up"
        ? engineRemedy(engine, lastKind || (status === "not_set_up" ? "unavailable" : "blocked"))
        : null;
    return { engine, enabled, status, captured, attempted, route, apiFallback: mode === "hybrid" && hasKey, remedy, lastRunAt };
  });
}

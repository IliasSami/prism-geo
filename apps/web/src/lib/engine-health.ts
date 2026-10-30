import { ENGINE_IDS } from "@prismgeo/core";
import { getRawDb, getSettings } from "@prismgeo/db";
import { isProfileConnected, apiKeyFor, apiRouteLabel, engineRemedy, type ApiKeys } from "@prismgeo/crawler";

export const ALL_ENGINES = ENGINE_IDS;
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
  /** Name of the paid route when one is saved ("DataForSEO", "OpenAI API", ...). */
  routeLabel: string | null;
  remedy: string | null;
  lastRunAt: string | null;
  /**
   * Most frequent failure kind of the engine in its latest audit (blocked, no_answer, network,
   * setup, ...), or null. Network and setup failures are reported here but never count against
   * the health percentage.
   */
  lastFailureKind: string | null;
}

/** Failures that are about this machine, not the engine: they select the audit but are not counted. */
const LOCAL_FAILURES = new Set(["network", "setup", "skipped_after_network", "skipped_setup"]);
/** Never a failure of anything: real outcomes and prompt edits. */
const NOT_FAILURES = new Set(["no_ai_overview", "unavailable", "prompt_removed", "prompt_paused"]);

/** Most frequent kind, preferring engine failures over local ones on ties. */
function topKind(kinds: string[]): string | null {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(LOCAL_FAILURES.has(a[0])) - Number(LOCAL_FAILURES.has(b[0])))[0]?.[0] ?? null;
}

/**
 * Failure kinds that say nothing about the engine itself: a real "no Overview" outcome, an engine
 * that is unavailable, this machine's connection or setup (and runs skipped because of them), and
 * prompts paused or deleted mid-batch.
 */
const NOT_ENGINE_FAILURES = new Set([...NOT_FAILURES, ...LOCAL_FAILURES]);

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
        .prepare("SELECT id, errors_json, created_at FROM crawl_batches WHERE brand_id = ? AND status <> 'running' AND COALESCE(owner, '') <> 'manual-capture' ORDER BY created_at DESC LIMIT 10")
        .all(brandId) as Array<{ id: string; errors_json: string; created_at: string }>)
    : [];

  // One grouped query instead of one COUNT per batch and engine
  const runCounts = new Map<string, number>();
  if (batches.length > 0) {
    const rows = sqlite
      .prepare(`SELECT batch_id, engine, COUNT(*) AS n FROM prompt_runs WHERE batch_id IN (${batches.map(() => "?").join(",")}) GROUP BY batch_id, engine`)
      .all(...batches.map((b) => b.id)) as Array<{ batch_id: string; engine: string; n: number }>;
    for (const r of rows) runCounts.set(`${r.batch_id} ${r.engine}`, Number(r.n));
  }

  return ALL_ENGINES.map((engine) => {
    const enabled = settings[engine] !== false;
    const hasKey = mode !== "stealth" && engine !== "copilot" && apiKeyFor(engine, keys) !== "";
    const signedIn = isProfileConnected(engine);
    const route: EngineHealth["route"] = mode === "byok" && hasKey ? "api" : signedIn ? "signed_in" : "browser";

    let captured = 0;
    let failed = 0;
    let lastRunAt: string | null = null;
    let lastKind: string | null = null;
    let lastFailureKind: string | null = null;
    for (const b of batches) {
      const runs = runCounts.get(`${b.id} ${engine}`) || 0;
      let errors: Array<{ engine: string; kind: string }> = [];
      try {
        errors = JSON.parse(b.errors_json || "[]");
      } catch {
        errors = [];
      }
      const mine = errors.filter((e) => e.engine === engine && !NOT_ENGINE_FAILURES.has(e.kind));
      const local = errors.filter((e) => e.engine === engine && LOCAL_FAILURES.has(e.kind));
      const overviews = errors.filter((e) => e.engine === engine && e.kind === "no_ai_overview").length;
      // An audit where the engine only failed for local reasons (no browser, no connection) is still its latest audit
      if (runs + mine.length + overviews + local.length === 0) continue;
      captured = runs + overviews;
      failed = mine.length;
      lastRunAt = b.created_at;
      lastKind = mine.find((e) => e.kind === "blocked")?.kind || mine[0]?.kind || null;
      lastFailureKind = topKind([...mine, ...local].map((e) => e.kind));
      break;
    }
    const attempted = captured + failed;
    let status: HealthStatus;
    if (engine === "copilot" && !signedIn) status = "not_set_up";
    // Google AI Mode is read only through a key or provider (no dependable browser route)
    else if (engine === "google_ai_mode" && !hasKey) status = "not_set_up";
    else if (attempted === 0 && lastFailureKind && /setup/.test(lastFailureKind)) status = "not_set_up";
    else if (attempted === 0) status = "untested";
    else if (captured / attempted >= 0.8) status = "working";
    else if (captured / attempted >= 0.2) status = "degraded";
    else status = "blocked";
    const remedy =
      status === "blocked" || status === "degraded" || status === "not_set_up"
        ? engineRemedy(engine, lastKind || lastFailureKind || (status === "not_set_up" ? "unavailable" : "blocked"))
        : lastFailureKind && LOCAL_FAILURES.has(lastFailureKind)
          ? engineRemedy(engine, lastFailureKind)
          : null;
    return { engine, enabled, status, captured, attempted, route, apiFallback: mode === "hybrid" && hasKey, routeLabel: hasKey ? apiRouteLabel(engine, keys) : null, remedy, lastRunAt, lastFailureKind };
  });
}

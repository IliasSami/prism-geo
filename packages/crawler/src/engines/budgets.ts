import { getRawDb, getSettings } from "@prismgeo/db";

/**
 * How hard PrismGEO may use each free engine, so free accounts and this computer's address are
 * never exhausted. Researched 2026-11-02 from official docs, user reports (forums, Reddit, GitHub
 * issues) and PrismGEO's own live tests; no consumer chat app publishes a logged-out cap, so these
 * are deliberately cautious:
 * - ChatGPT free: about 10 flagship messages per rolling 5 h; Cloudflare checks on flagged networks.
 * - Perplexity logged out: a sign-up wall after about 10–15 questions per address.
 * - Google: the "unusual traffic" page after a few dozen automated searches; lasts hours to days.
 * - Gemini free account: limits refresh every 5 h up to a weekly cap. Copilot: "come back tomorrow".
 * Keys and data providers have their own published limits and are not budgeted here.
 */

export interface EnginePolicy {
  /** Pause between two questions to the engine, in seconds (randomised in between). */
  delay: [number, number];
  perHour: number;
  perDay: number;
}

type Route = "logged_out" | "signed_in";

const SAFE: Record<string, Record<Route, EnginePolicy>> = {
  chatgpt: { logged_out: { delay: [60, 180], perHour: 15, perDay: 60 }, signed_in: { delay: [90, 240], perHour: 8, perDay: 30 } },
  perplexity: { logged_out: { delay: [120, 300], perHour: 5, perDay: 10 }, signed_in: { delay: [60, 180], perHour: 10, perDay: 40 } },
  google_aio: { logged_out: { delay: [120, 300], perHour: 8, perDay: 30 }, signed_in: { delay: [120, 300], perHour: 8, perDay: 30 } },
  gemini: { logged_out: { delay: [60, 180], perHour: 12, perDay: 50 }, signed_in: { delay: [90, 240], perHour: 10, perDay: 40 } },
  copilot: { logged_out: { delay: [90, 240], perHour: 10, perDay: 40 }, signed_in: { delay: [90, 240], perHour: 10, perDay: 40 } },
};

/** The pacing PrismGEO used before the budgets: for a proxy or paid accounts the user controls. */
const FAST: Record<string, [number, number]> = { google_aio: [15, 30], perplexity: [8, 15] };

/** Rest after blocks in a row, in hours: Google's blocks outlast the others'. */
export const BACKOFF_HOURS: Record<string, number[]> = {
  google_search: [6, 12, 24, 48],
  perplexity: [6, 12, 24],
  default: [1, 3, 6, 12, 24],
};

/** "safe" (default): the budgets above. "fast": the old short pauses and no hourly/daily caps. */
export type PacingMode = "safe" | "fast";
export const pacingMode = (): PacingMode => (getSettings<{ pacing?: string }>("crawler_settings", {}).pacing === "fast" ? "fast" : "safe");

export function enginePolicy(engine: string, signedIn: boolean, mode: PacingMode = pacingMode()): EnginePolicy {
  const safe = SAFE[engine]?.[signedIn ? "signed_in" : "logged_out"] ?? { delay: [60, 180], perHour: 10, perDay: 40 };
  if (mode === "safe") return safe;
  return { delay: FAST[engine] ?? [4, 8], perHour: Infinity, perDay: Infinity };
}

/** Browser questions sent to the engine since `sinceIso` (stored answers and failed attempts). */
function browserUse(engine: string, sinceIso: string): number {
  const db = getRawDb();
  const answered = (
    db.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE engine = ? AND capture_method IN ('browser', 'browser_signed_in') AND created_at >= ?").get(engine, sinceIso) as { n: number }
  ).n;
  // Attempts that ended without an answer count too; "not run" entries never reached the engine
  const failed = db
    .prepare("SELECT errors_json, COALESCE(finished_at, heartbeat_at, created_at) AS ended FROM crawl_batches WHERE COALESCE(finished_at, heartbeat_at, created_at) >= ? AND errors_json LIKE ?")
    .all(sinceIso, `%"${engine}"%`) as Array<{ errors_json: string; ended: string }>;
  let attempts = 0;
  for (const b of failed) {
    try {
      for (const f of JSON.parse(b.errors_json) as Array<{ engine: string; kind: string; at?: string }>) {
        // Failures recorded before timestamps existed take their audit's end time
        if (f.engine === engine && ATTEMPT_KINDS.has(f.kind) && (f.at ?? b.ended) >= sinceIso) attempts++;
      }
    } catch {
      // unreadable row: ignore
    }
  }
  return answered + attempts;
}

/** Failure kinds where a question really went to the engine. */
const ATTEMPT_KINDS = new Set(["blocked", "no_answer", "no_ai_overview", "error", "not_accepted"]);

/**
 * Why the engine must not be asked now (its hourly or daily budget is used up), or null. Counts
 * every browser question to that engine on this computer, across clients and audits.
 */
export function budgetExhausted(engine: string, signedIn: boolean, now = Date.now()): { window: "hour" | "day"; used: number; limit: number } | null {
  const policy = enginePolicy(engine, signedIn);
  if (!Number.isFinite(policy.perHour)) return null;
  const hour = browserUse(engine, new Date(now - 3_600_000).toISOString());
  if (hour >= policy.perHour) return { window: "hour", used: hour, limit: policy.perHour };
  const day = browserUse(engine, new Date(now - 24 * 3_600_000).toISOString());
  if (day >= policy.perDay) return { window: "day", used: day, limit: policy.perDay };
  return null;
}

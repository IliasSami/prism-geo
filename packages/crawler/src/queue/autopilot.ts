import { ENGINE_IDS, ENGINES } from "@prismgeo/core";
import { getRawDb, getSettings, setSettings, nowIso } from "@prismgeo/db";
import { CrawlerOrchestrator, BatchRunningError, type EngineName } from "./crawler-orchestrator";
import { rollingAuditRunning, unansweredPromptIdsByEngine } from "./scheduler";
import { getCalibration } from "./calibrate";
import { openActionFor } from "./action-requests";
import { browserCoolingDown } from "../engines/block-memory";
import { budgetExhausted, budgetLeftToday } from "../engines/budgets";
import { isProfileConnected } from "../engines/profiles";
import { apiRouteFor, type ApiKeys } from "../engines/api-engines";
import { refreshSerpApiQuota, serpApiBudgetState } from "../engines/serpapi-quota";
import { chatGptSignedInUsable } from "../engines/chatgpt";
import { notifyDesktop } from "../engines/notify";

/**
 * Autopilot: keeps auditing a client by itself, for days or weeks, until every engine has answered
 * every active question. Every few minutes, when nothing else is crawling, it asks each engine only
 * what it has never answered, sized to what that engine may still be asked today (free engines'
 * daily budgets, the SerpApi plan's daily share). Engines that rest after a block, wait for a person
 * (the bell) or keep refusing the automated browser are skipped and retried later. The plan lives in
 * the database, so a restart picks up where it stopped. When coverage is complete it says so; the
 * rolling daily schedule then keeps answers fresh.
 */

export interface AutopilotSettings {
  enabled?: boolean;
  /** Clients to cover (default: every client). */
  brandIds?: string[];
}

export interface AutopilotEngineState {
  engine: string;
  /** Questions this engine has never answered. */
  gaps: number;
  /** What it may still be asked today. */
  room: number;
  /** Why it is not asked now, or null when it is. */
  waiting: string | null;
}

export interface AutopilotState {
  status: "off" | "working" | "waiting" | "complete";
  checkedAt: string | null;
  brandId: string | null;
  lastBatchId: string | null;
  engines: AutopilotEngineState[];
  detail: string;
}

const STATE = "autopilot_state";
const CHECK_EVERY_MS = 5 * 60_000;
/** Paid routes without a monthly cap (DataForSEO, OpenAI…): questions per autopilot audit. */
const PAID_SLICE = 50;
/** An engine whose page refused questions is tried again after this long. */
const NOT_ACCEPTED_PAUSE_MS = 12 * 3_600_000;
/** Reasons that only a setup change can lift (see engineRoom). */
const SETUP_BLOCKER = /needs a signed-in Microsoft account|needs a SerpApi key/;

export const getAutopilotState = (): AutopilotState =>
  getSettings<AutopilotState>(STATE, { status: "off", checkedAt: null, brandId: null, lastBatchId: null, engines: [], detail: "" });

/** The time of the engine's latest "page did not accept the question" failure, or null. */
function lastNotAccepted(engine: string): number | null {
  const rows = getRawDb()
    .prepare("SELECT errors_json, COALESCE(finished_at, created_at) AS at FROM crawl_batches WHERE errors_json LIKE ? ORDER BY created_at DESC LIMIT 5")
    .all(`%"${engine}"%not_accepted%`) as Array<{ errors_json: string; at: string }>;
  for (const r of rows) {
    try {
      if ((JSON.parse(r.errors_json) as Array<{ engine: string; kind: string }>).some((f) => f.engine === engine && f.kind === "not_accepted")) return Date.parse(r.at);
    } catch {
      // ignore unreadable rows
    }
  }
  return null;
}

/** What one engine may be asked now, and why not when it may not. */
export function engineRoom(engine: EngineName, brandId: string, now = Date.now()): { room: number; waiting: string | null } {
  const settings = getSettings<{ mode?: string }>("engine_settings", {});
  const keys = getSettings<ApiKeys>("byok_api_keys", {});
  const route = settings.mode === "stealth" ? null : apiRouteFor(engine, keys);
  const browserOnly = !route;
  const label = ENGINES[engine].label;
  if (engine === "copilot" && !isProfileConnected("copilot")) return { room: 0, waiting: `${label} needs a signed-in Microsoft account` };
  if (engine === "google_ai_mode" && !route) return { room: 0, waiting: `${label} needs a SerpApi key or the data provider` };
  if (openActionFor(engine, brandId)) return { room: 0, waiting: `${label} waits for you (see the bell)` };
  const refused = lastNotAccepted(engine);
  if (refused && now - refused < NOT_ACCEPTED_PAUSE_MS) return { room: 0, waiting: `${label}'s page did not accept questions recently; tried again after ${new Date(refused + NOT_ACCEPTED_PAUSE_MS).toISOString().slice(11, 16)} UTC` };

  // Engines answered through a paid route: the SerpApi plan's daily share, or a slice for pay-as-you-go
  if (route && (engine === "google_ai_mode" || settings.mode === "byok")) {
    if (route.kind === "serpapi") {
      const b = serpApiBudgetState(new Date(now));
      // AI Overviews may take two searches each
      const room = Math.max(0, b.allowanceToday - b.usedToday);
      return room > 0 ? { room, waiting: null } : { room: 0, waiting: `${label}: today's SerpApi share is used; continues tomorrow` };
    }
    return { room: PAID_SLICE, waiting: null };
  }
  const rest = browserCoolingDown(engine, now);
  if (rest && browserOnly) return { room: 0, waiting: `${label} rests after a block until ${rest.until.slice(11, 16)} UTC` };
  const signedIn = engine === "chatgpt" ? chatGptSignedInUsable(now) : isProfileConnected(engine);
  const day = budgetExhausted(engine, signedIn, now);
  if (day?.window === "day") return { room: 0, waiting: `${label} reached its safe daily limit; continues tomorrow` };
  // The hourly cap is handled inside the audit (it waits); what is left of the day decides the slice
  const left = budgetLeftToday(engine, signedIn, now);
  return { room: Number.isFinite(left) ? left : PAID_SLICE, waiting: null };
}

let busy = false;
let lastCheck = 0;

/** One autopilot step: starts the next audit slice when one can run. Called by the scheduler every minute. */
export async function runAutopilot(now = Date.now()): Promise<void> {
  const settings = getSettings<AutopilotSettings>("autopilot", {});
  if (!settings.enabled) {
    if (getAutopilotState().status !== "off") setSettings(STATE, { ...getAutopilotState(), status: "off", detail: "Autopilot is off" });
    return;
  }
  if (busy || now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;
  const db = getRawDb();
  // One crawl at a time on this computer (audits, the rolling schedule, calibration): engines share
  // its address and its saved profiles
  if ((db.prepare("SELECT COUNT(*) AS n FROM crawl_batches WHERE status = 'running'").get() as { n: number }).n > 0) return;
  if (rollingAuditRunning() || getCalibration()?.status === "running") return;

  busy = true;
  try {
    // Today's SerpApi share is only known once the plan was read (free; at most every 10 minutes)
    const serpapiKey = getSettings<ApiKeys>("byok_api_keys", {}).serpapi;
    if (serpapiKey) await refreshSerpApiQuota(serpapiKey, new Date(now));
    const engineSettings = getSettings<Record<string, unknown>>("engine_settings", {});
    const enabled = ENGINE_IDS.filter((e) => engineSettings[e] !== false) as EngineName[];
    const brands = (db.prepare("SELECT id, name FROM brands ORDER BY created_at").all() as Array<{ id: string; name: string }>).filter(
      (b) => !settings.brandIds?.length || settings.brandIds.includes(b.id)
    );
    let allComplete = true;
    for (const brand of brands) {
      const gaps = unansweredPromptIdsByEngine(brand.id, enabled);
      const engines: AutopilotEngineState[] = enabled.map((engine) => {
        const { room, waiting } = gaps[engine].length ? engineRoom(engine, brand.id, now) : { room: 0, waiting: null };
        return { engine, gaps: gaps[engine].length, room, waiting };
      });
      // Engines that cannot run at all until set up (Copilot without an account, AI Mode without a
      // key) are shown but do not keep coverage from being complete
      const open = engines.filter((e) => e.gaps > 0 && !(e.waiting && SETUP_BLOCKER.test(e.waiting)));
      if (open.length === 0) continue;
      allComplete = false;
      const ready = open.filter((e) => e.room > 0 && !e.waiting);
      if (ready.length === 0) {
        setSettings(STATE, { status: "waiting", checkedAt: nowIso(), brandId: brand.id, lastBatchId: getAutopilotState().lastBatchId, engines, detail: `${brand.name}: every engine with questions left is waiting (limits, rest or the bell); checking again in a few minutes.` } satisfies AutopilotState);
        continue;
      }
      const promptIdsByEngine = Object.fromEntries(ready.map((e) => [e.engine, gaps[e.engine].slice(0, e.room)]));
      const asked = ready.map((e) => `${ENGINES[e.engine as EngineName].label} ${Math.min(e.room, e.gaps)}`).join(", ");
      console.log(`[Autopilot] ${brand.name}: asking the unanswered questions (${asked})`);
      setSettings(STATE, { status: "working", checkedAt: nowIso(), brandId: brand.id, lastBatchId: null, engines, detail: `${brand.name}: asking ${asked}` } satisfies AutopilotState);
      try {
        const batchId = await CrawlerOrchestrator.executeBatch({
          brandId: brand.id,
          engines: ready.map((e) => e.engine as EngineName),
          promptIdsByEngine,
          sampleSize: 1,
          onStarted: (id) => setSettings(STATE, { ...getAutopilotState(), lastBatchId: id }),
        });
        setSettings(STATE, { ...getAutopilotState(), lastBatchId: batchId, checkedAt: nowIso() });
      } catch (err) {
        if (!(err instanceof BatchRunningError)) console.error(`[Autopilot] ${brand.name}:`, (err as Error).message);
      }
      return; // one slice per step; the next step looks again
    }
    if (allComplete && getAutopilotState().status !== "complete") {
      setSettings(STATE, { status: "complete", checkedAt: nowIso(), brandId: null, lastBatchId: getAutopilotState().lastBatchId, engines: [], detail: "Every engine has answered every active question. The rolling daily schedule keeps answers fresh." } satisfies AutopilotState);
      notifyDesktop("PrismGEO: coverage complete", "Every engine has answered every active question.");
    }
  } finally {
    busy = false;
  }
}

import { getRawDb, getSettings, nowIso, rowToBrand, setSettings } from "@prismgeo/db";
import { detectMentions, hostKey, languageFor, seededShuffle } from "@prismgeo/core";
import { GoogleAioCrawler, NoAiOverviewError } from "../engines/google-aio";
import { EngineBlockedError, type EngineAnswer } from "../engines/browser-session";
import { apiRouteLabel, apiRouteLocation, countryCodeFor, runApiEngine, type ApiKeys } from "../engines/api-engines";
import { connectionCountry, countryName } from "../engines/location";
import { trackedEntitiesFor } from "./manual-capture";
import { placeInCountry } from "./crawler-orchestrator";

/**
 * Calibrates Google's location signal (uule) for the search location.
 *
 * For a sample of tracked questions, Google AI Overviews is searched three times: from this
 * computer with uule (the free route), and twice through a route asked from inside the country
 * (SerpApi or DataForSEO). Two identical searches already differ somewhat, so the two reference
 * searches set the noise floor; uule answers are trusted for the country only when they agree
 * with the reference about as well as the reference agrees with itself. Nothing from the
 * calibration is stored as an answer: only the summary and per-question agreement figures.
 */

export interface CalibrationQuestion {
  promptId: string;
  /** Whether each search showed an AI Overview. */
  overview: { browser: boolean; reference: boolean; repeat: boolean };
  /** Jaccard overlap of cited sites (both searches showed an Overview), else null. */
  sources: { browser: number | null; repeat: number | null };
  /** Jaccard overlap of tracked companies named, else null. */
  companies: { browser: number | null; repeat: number | null };
}

export interface CalibrationResult {
  status: "running" | "done" | "failed";
  country: string;
  place: string;
  connection: string | null;
  reference: string | null;
  startedAt: string;
  finishedAt?: string;
  questions: CalibrationQuestion[];
  /** Agreement of uule-from-here vs the reference, and of the reference vs itself (the noise floor). */
  agreement?: {
    overview: { browser: number; repeat: number };
    sources: { browser: number | null; repeat: number | null };
    companies: { browser: number | null; repeat: number | null };
  };
  trusted: boolean;
  reason: string;
}

const KEY = "location_calibration";
/** How much worse than the noise floor uule answers may agree and still be trusted. */
export const CALIBRATION_TOLERANCE = { overview: 0.1, sources: 0.15, companies: 0.15 };
export const CALIBRATION_MIN_QUESTIONS = 8;

export const jaccard = (a: Set<string>, b: Set<string>): number | null => {
  if (a.size === 0 && b.size === 0) return null;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
};

const mean = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/** Agreement figures and the trust decision for a set of compared questions. */
export function summarizeCalibration(questions: CalibrationQuestion[]): Pick<CalibrationResult, "agreement" | "trusted" | "reason"> {
  const n = questions.length;
  const agree = (k: "browser" | "repeat") => questions.filter((q) => q.overview[k] === q.overview.reference).length / Math.max(1, n);
  const agreement = {
    overview: { browser: agree("browser"), repeat: agree("repeat") },
    sources: { browser: mean(questions.map((q) => q.sources.browser)), repeat: mean(questions.map((q) => q.sources.repeat)) },
    companies: { browser: mean(questions.map((q) => q.companies.browser)), repeat: mean(questions.map((q) => q.companies.repeat)) },
  };
  if (n < CALIBRATION_MIN_QUESTIONS) return { agreement, trusted: false, reason: `Only ${n} questions could be compared; at least ${CALIBRATION_MIN_QUESTIONS} are needed.` };
  const short: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (agreement.overview.browser < agreement.overview.repeat - CALIBRATION_TOLERANCE.overview)
    short.push(`AI Overview shown: ${pct(agreement.overview.browser)} agreement vs ${pct(agreement.overview.repeat)} between two reference searches`);
  for (const k of ["sources", "companies"] as const) {
    const { browser, repeat } = agreement[k];
    if (browser !== null && repeat !== null && browser < repeat - CALIBRATION_TOLERANCE[k])
      short.push(`${k === "sources" ? "cited sites" : "companies named"}: ${pct(browser)} overlap vs ${pct(repeat)} between two reference searches`);
  }
  if (agreement.sources.browser === null) short.push("no question showed an AI Overview on both routes, so sources could not be compared");
  return short.length
    ? { agreement, trusted: false, reason: `Not trusted: ${short.join("; ")}.` }
    : { agreement, trusted: true, reason: "Google answers asked from this computer with the location signal agree with answers asked from inside the country as closely as two searches there agree with each other." };
}

let running = false;

export function getCalibration(): CalibrationResult | null {
  const c = getSettings<CalibrationResult | Record<string, never>>(KEY, {});
  if (!("status" in c)) return null;
  const r = c as CalibrationResult;
  // A run this process is not doing was interrupted (PrismGEO restarted)
  return r.status === "running" && !running ? { ...r, status: "failed", trusted: false, reason: "Interrupted: PrismGEO stopped during the calibration. Run it again." } : r;
}

/**
 * Runs the calibration for the active search location (Settings) on `sample` questions of a
 * brand. Resolves when done; progress is readable through getCalibration().
 */
export async function calibrateLocation(brandId: string, { sample = 10, pauseMs = [15000, 30000] as [number, number] } = {}): Promise<CalibrationResult> {
  if (running) throw new Error("A calibration is already running");
  const s = getSettings<{ providerLocation?: string; providerLanguage?: string; searchPlace?: string }>("engine_settings", {});
  const location = s.providerLocation?.trim() || "United States";
  const country = countryCodeFor(location);
  if (!country) throw new Error(`The search location "${location}" is not a country`);
  const keys = getSettings<ApiKeys>("byok_api_keys", {});
  if (apiRouteLocation("google_aio", keys) !== "interface") throw new Error("Calibration needs a route asked from inside the country: add a SerpApi key (free plan) or the DataForSEO data provider.");
  const brandRow = getRawDb().prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
  if (!brandRow) throw new Error("Unknown brand");
  const { entities } = trackedEntitiesFor(rowToBrand(brandRow as Record<string, unknown>));
  const prompts = getRawDb().prepare("SELECT id, query_text FROM prompts WHERE brand_id = ? AND active = 1").all(brandId) as Array<{ id: string; query_text: string }>;
  const picked = seededShuffle(prompts, `calibration:${brandId}:${location}`).slice(0, sample);

  const place = placeInCountry(s.searchPlace, location) || location;
  const options = { location, place: place === location ? undefined : place, language: languageFor(location, s.providerLanguage) };
  const result: CalibrationResult = {
    status: "running",
    country,
    place,
    connection: await connectionCountry(),
    reference: apiRouteLabel("google_aio", keys),
    startedAt: nowIso(),
    questions: [],
    trusted: false,
    reason: "Running",
  };
  setSettings(KEY, result);
  running = true;

  const named = (a: EngineAnswer | null, q: string) => new Set(a ? detectMentions(a.responseText, entities, q).mentions.map((m) => m.entity.key) : []);
  const sites = (a: EngineAnswer | null) => new Set((a?.citations || []).map((c) => hostKey(c.url)).filter(Boolean));
  /** The answer, or null when Google showed no AI Overview (a real outcome). */
  const overviewOrNull = async (run: () => Promise<EngineAnswer>) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof NoAiOverviewError) return null;
      throw err;
    }
  };

  try {
    for (const [i, p] of picked.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, pauseMs[0] + Math.random() * (pauseMs[1] - pauseMs[0])));
      let browser: EngineAnswer | null;
      try {
        browser = await overviewOrNull(() => GoogleAioCrawler.execute(p.query_text, undefined, { country, language: options.language, place }));
      } catch (err) {
        // A blocked or failed browser search cannot be compared; it is skipped, not counted as "no Overview"
        if (err instanceof EngineBlockedError && result.questions.length === 0 && i >= 2) throw new Error(`Google is blocking searches from this computer (${countryName(result.connection)}); try again in a few hours.`);
        continue;
      }
      const reference = await overviewOrNull(() => runApiEngine("google_aio", p.query_text, keys, options)).catch(() => undefined);
      const repeat = await overviewOrNull(() => runApiEngine("google_aio", p.query_text, keys, options)).catch(() => undefined);
      if (reference === undefined || repeat === undefined) continue;
      const both = (x: EngineAnswer | null) => (x && reference ? true : false);
      result.questions.push({
        promptId: p.id,
        overview: { browser: browser !== null, reference: reference !== null, repeat: repeat !== null },
        sources: { browser: both(browser) ? jaccard(sites(browser), sites(reference)) : null, repeat: both(repeat) ? jaccard(sites(repeat), sites(reference)) : null },
        companies: { browser: both(browser) ? jaccard(named(browser, p.query_text), named(reference, p.query_text)) : null, repeat: both(repeat) ? jaccard(named(repeat, p.query_text), named(reference, p.query_text)) : null },
      });
      setSettings(KEY, result);
    }
    Object.assign(result, summarizeCalibration(result.questions), { status: "done", finishedAt: nowIso() });
  } catch (err) {
    Object.assign(result, { status: "failed", trusted: false, reason: (err as Error).message, finishedAt: nowIso() });
  } finally {
    running = false;
    setSettings(KEY, result);
  }
  return result;
}

import { getSettings, setSettings } from "@prismgeo/db";

/**
 * Remembers when an engine blocked this computer's browser, across audits and restarts.
 *
 * Without it every new audit, schedule run or calibration searched straight into an active block,
 * and each blocked search can extend it (Google's "unusual traffic" blocks last hours, not
 * minutes). After a block the browser route of that engine rests, for longer after each block in
 * a row (1 h, 3 h, 6 h, 12 h, 24 h); a successful answer clears it. Paid routes are unaffected.
 * This is backing off, never working around a block.
 */

const KEY = "browser_blocks";
const BACKOFF_HOURS = [1, 3, 6, 12, 24];
/** Blocks further apart than this do not count as "in a row". */
const STREAK_RESET_MS = 48 * 3_600_000;

/** Engines that share one block: Google AI Overviews and AI Mode are both Google Search. */
export function blockGroup(engine: string): string {
  return engine === "google_aio" || engine === "google_ai_mode" ? "google_search" : engine;
}

export interface BrowserBlock {
  /** Blocks in a row. */
  blocks: number;
  lastBlockAt: string;
  /** The browser route rests until then. */
  until: string;
  reason: string;
}

type Store = Record<string, BrowserBlock>;

/** Records a block; returns when the browser route may be tried again. */
export function recordBrowserBlock(engine: string, reason: string, now = Date.now()): BrowserBlock {
  const store = getSettings<Store>(KEY, {});
  const group = blockGroup(engine);
  const prev = store[group];
  const inRow = prev && now - Date.parse(prev.lastBlockAt) < STREAK_RESET_MS ? prev.blocks + 1 : 1;
  const hours = BACKOFF_HOURS[Math.min(inRow, BACKOFF_HOURS.length) - 1];
  const block = { blocks: inRow, lastBlockAt: new Date(now).toISOString(), until: new Date(now + hours * 3_600_000).toISOString(), reason: reason.slice(0, 300) };
  setSettings(KEY, { ...store, [group]: block });
  return block;
}

/** A successful browser answer ends the streak. */
export function recordBrowserSuccess(engine: string): void {
  const store = getSettings<Store>(KEY, {});
  const group = blockGroup(engine);
  if (!store[group]) return;
  const { [group]: _cleared, ...rest } = store;
  setSettings(KEY, rest);
}

/** The active rest period of an engine's browser route, or null when it may be used. */
export function browserCoolingDown(engine: string, now = Date.now()): BrowserBlock | null {
  const block = getSettings<Store>(KEY, {})[blockGroup(engine)];
  return block && Date.parse(block.until) > now ? block : null;
}

/** Ends a rest period early (the user chose to try again now). The streak is kept. */
export function clearBrowserCooldown(engine: string, now = Date.now()): void {
  const store = getSettings<Store>(KEY, {});
  const group = blockGroup(engine);
  if (store[group]) setSettings(KEY, { ...store, [group]: { ...store[group], until: new Date(now).toISOString() } });
}

/** "14:05" style local time for messages. */
export const untilText = (iso: string) => new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

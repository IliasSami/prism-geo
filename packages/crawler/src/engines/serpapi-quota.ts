import { getSettings, setSettings } from "@prismgeo/db";

/**
 * Spends a SerpApi plan evenly over the month, so a small plan (the free one has 250 searches a
 * month) never runs dry in one audit. The account endpoint (free, not counted) tells how many
 * searches are left; a reserve is kept for calibration and checks; the rest is shared out per day
 * over the days left in the month. Every SerpApi request goes through spendSerpApi().
 */

export class ApiBudgetError extends Error {}

interface Ledger {
  /** Local day (YYYY-MM-DD) the counters below belong to. */
  day: string;
  /** Searches this computer sent today. */
  usedToday: number;
  /** Searches left on the plan at the start of the day (from the account endpoint). */
  leftAtDayStart: number | null;
  /** Plan size per month, from the account endpoint. */
  perMonth: number | null;
  /** Last account check (ISO) and what it said. */
  checkedAt: string | null;
  left: number | null;
}

const KEY = "serpapi_ledger";
const ACCOUNT_TTL_MS = 10 * 60_000;
const today = (now: Date) => now.toISOString().slice(0, 10);
const daysLeftInMonth = (now: Date) => {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return Math.max(1, end.getUTCDate() - now.getUTCDate() + 1);
};

/** Searches kept back each month for calibration and one-off checks: 10% of the plan (at least 10). */
export const reserveFor = (perMonth: number) => Math.max(10, Math.round(perMonth * 0.1));

type Fetcher = (url: string) => Promise<{ total_searches_left?: number; plan_searches_left?: number; searches_per_month?: number; error?: string }>;
let fetcher: Fetcher = async (url) => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json();
/** Replaces the account lookup (tests). */
export function configureSerpApiAccountFetch(f: Fetcher | null): void {
  fetcher = f ?? (async (url) => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json());
}

function load(now: Date): Ledger {
  const l = getSettings<Ledger>(KEY, { day: today(now), usedToday: 0, leftAtDayStart: null, perMonth: null, checkedAt: null, left: null });
  return l.day === today(now) ? l : { ...l, day: today(now), usedToday: 0, leftAtDayStart: l.left };
}

/** Refreshes the plan's remaining searches from SerpApi's account endpoint (free) at most every 10 minutes. */
async function refresh(key: string, l: Ledger, now: Date): Promise<Ledger> {
  if (l.checkedAt && now.getTime() - Date.parse(l.checkedAt) < ACCOUNT_TTL_MS) return l;
  try {
    const a = await fetcher(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`);
    if (a.error) return l;
    const left = Number(a.total_searches_left ?? a.plan_searches_left);
    if (!Number.isFinite(left)) return l;
    return { ...l, left, perMonth: Number(a.searches_per_month) || l.perMonth, checkedAt: now.toISOString(), leftAtDayStart: l.leftAtDayStart ?? left + l.usedToday };
  } catch {
    return l; // offline: keep the last known numbers
  }
}

/** Today's allowance: what is left beyond the reserve, shared over the days left in the month. */
export function dailyAllowance(l: Pick<Ledger, "leftAtDayStart" | "perMonth">, now = new Date()): number {
  // Unknown (never checked, or a damaged record): nothing to share out
  if (typeof l.leftAtDayStart !== "number" || !Number.isFinite(l.leftAtDayStart)) return 0;
  const spare = l.leftAtDayStart - reserveFor(l.perMonth ?? 250);
  return Math.max(0, Math.floor(spare / daysLeftInMonth(now)));
}

/**
 * Records `n` SerpApi searches about to be sent, or throws ApiBudgetError when today's share (or
 * the reserve, for `purpose: "reserve"`) is used up. Calibration spends from the reserve.
 */
export async function spendSerpApi(key: string, n = 1, purpose: "audit" | "reserve" = "audit", now = new Date()): Promise<void> {
  let l = await refresh(key, load(now), now);
  if (typeof l.left !== "number" || !Number.isFinite(l.left)) throw new ApiBudgetError("[SerpApi] The plan's remaining searches could not be checked, so none are spent");
  const perMonth = l.perMonth ?? 250;
  if (purpose === "audit") {
    const allowance = dailyAllowance(l, now);
    if (l.usedToday + n > allowance) {
      throw new ApiBudgetError(
        `[SerpApi] Today's share of the plan is used (${l.usedToday} of ${allowance}; ${l.left} left this month, ${reserveFor(perMonth)} kept in reserve). The rest is asked on the next days.`
      );
    }
  } else if (l.left - n < 0) {
    throw new ApiBudgetError(`[SerpApi] The plan has no searches left this month`);
  }
  l = { ...l, usedToday: l.usedToday + n, left: l.left - n };
  setSettings(KEY, l);
}

/** What the dashboard shows: searches left, kept in reserve, and today's share. */
export function serpApiBudgetState(now = new Date()): { left: number | null; perMonth: number | null; reserve: number; allowanceToday: number; usedToday: number; checkedAt: string | null } {
  const l = load(now);
  return { left: l.left, perMonth: l.perMonth, reserve: reserveFor(l.perMonth ?? 250), allowanceToday: dailyAllowance(l, now), usedToday: l.usedToday, checkedAt: l.checkedAt };
}

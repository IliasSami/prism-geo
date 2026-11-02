import { getSettings, setSettings } from "@prismgeo/db";

/**
 * Spends a SerpApi plan evenly over the month, so a small plan (the free one has 250 searches a
 * month) never runs dry in one audit. The account endpoint (free, not counted) tells how many
 * searches are left; a reserve is kept for calibration and checks; the rest is shared out per day
 * over the days left in the month. Every SerpApi request goes through spendSerpApi().
 */

export class ApiBudgetError extends Error {}

interface Ledger {
  /** UTC day (YYYY-MM-DD) the daily counters belong to. */
  day: string;
  /** Audit searches this computer sent today (calibration is counted apart, from the reserve). */
  usedToday: number;
  /** Calibration searches sent today, spent from the monthly reserve. */
  usedReserve: number;
  /** Searches left on the plan at the start of the day; null until the day's first account check. */
  leftAtDayStart: number | null;
  /** Plan size per month, from the account endpoint. */
  perMonth: number | null;
  /** Last account check (ISO) and the searches left then, minus what was sent since. */
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

type Account = { total_searches_left?: number; plan_searches_left?: number; searches_per_month?: number; error?: string };
type Fetcher = (url: string) => Promise<Account>;
const defaultFetcher: Fetcher = async (url) => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json();
let fetcher: Fetcher = defaultFetcher;
/** Replaces the account lookup (tests). */
export function configureSerpApiAccountFetch(f: Fetcher | null): void {
  fetcher = f ?? defaultFetcher;
}

const EMPTY = (now: Date): Ledger => ({ day: today(now), usedToday: 0, usedReserve: 0, leftAtDayStart: null, perMonth: null, checkedAt: null, left: null });

/** The ledger for today: a new day starts its counters, and its share is set at the first account check. */
function load(now: Date): Ledger {
  const l = { ...EMPTY(now), ...getSettings<Partial<Ledger>>(KEY, {}) } as Ledger;
  return l.day === today(now) ? l : { ...l, day: today(now), usedToday: 0, usedReserve: 0, leftAtDayStart: null };
}

/**
 * Reads the account (free, at most every 10 minutes) and merges it into the CURRENT ledger in one
 * synchronous step, so searches recorded while the request was in flight are not lost.
 */
async function ensureFresh(key: string, now: Date): Promise<void> {
  const before = load(now);
  if (before.checkedAt && before.leftAtDayStart !== null && now.getTime() - Date.parse(before.checkedAt) < ACCOUNT_TTL_MS) return;
  let account: Account | null = null;
  try {
    account = await fetcher(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`);
  } catch {
    account = null; // offline: keep the last known numbers
  }
  const l = load(now);
  const fresh = account && !account.error ? Number(account.total_searches_left ?? account.plan_searches_left) : NaN;
  if (Number.isFinite(fresh)) {
    // More left than at the start of the day: the plan renewed, and the new month's share starts now.
    // Otherwise the lower figure wins: SerpApi may not have counted searches sent moments ago.
    const startOfDay = l.leftAtDayStart ?? l.left;
    const renewed = typeof startOfDay === "number" && fresh > startOfDay;
    l.left = renewed || typeof l.left !== "number" ? fresh : Math.min(fresh, l.left);
    l.perMonth = Number(account!.searches_per_month) || l.perMonth;
    l.checkedAt = now.toISOString();
    if (renewed) Object.assign(l, { usedToday: 0, leftAtDayStart: fresh });
  }
  if (l.leftAtDayStart === null && typeof l.left === "number") l.leftAtDayStart = l.left + l.usedToday;
  setSettings(KEY, l);
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
 * the reserve, for `purpose: "reserve"`) is used up. The check and the count happen in one
 * synchronous step after the account check, so parallel requests cannot overspend.
 */
export async function spendSerpApi(key: string, n = 1, purpose: "audit" | "reserve" = "audit", now = new Date()): Promise<void> {
  await ensureFresh(key, now);
  const l = load(now);
  if (typeof l.left !== "number" || !Number.isFinite(l.left)) throw new ApiBudgetError("[SerpApi] The plan's remaining searches could not be checked, so none are spent");
  const perMonth = l.perMonth ?? 250;
  if (purpose === "audit") {
    const allowance = dailyAllowance(l, now);
    if (l.usedToday + n > allowance) {
      throw new ApiBudgetError(
        `[SerpApi] Today's share of the plan is used (${l.usedToday} of ${allowance}; ${l.left} left this month, ${reserveFor(perMonth)} kept in reserve). The rest is asked on the next days.`
      );
    }
    l.usedToday += n;
  } else {
    if (l.left - n < 0) throw new ApiBudgetError("[SerpApi] The plan has no searches left this month");
    l.usedReserve += n;
  }
  l.left -= n;
  setSettings(KEY, l);
}

/** Reads the plan's remaining searches now (free, cached 10 minutes), so today's share is known before spending. */
export async function refreshSerpApiQuota(key: string, now = new Date()): Promise<void> {
  await ensureFresh(key, now);
}

/** What the dashboard shows: searches left, kept in reserve, and today's share. */
export function serpApiBudgetState(now = new Date()): { left: number | null; perMonth: number | null; reserve: number; allowanceToday: number; usedToday: number; usedReserve: number; checkedAt: string | null } {
  const l = load(now);
  return { left: l.left, perMonth: l.perMonth, reserve: reserveFor(l.perMonth ?? 250), allowanceToday: dailyAllowance(l, now), usedToday: l.usedToday, usedReserve: l.usedReserve, checkedAt: l.checkedAt };
}

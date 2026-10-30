import { request } from "playwright";
import { getProxyConfig } from "./browser-session";

/**
 * Where searches are asked from.
 *
 * Every engine localises its answer to where the question comes from. Paid routes are asked from
 * a chosen country (DataForSEO, SerpApi, Apify, OpenAI and Perplexity take a location); a browser
 * on this computer is answered for the country this computer's connection is in (or the proxy's,
 * when one is set). PrismGEO checks that country before every audit, records where each answer
 * was asked from, and, when "only search from the search location" is on, never uses a route
 * that would ask from somewhere else.
 */

const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const CACHE_MS = 10 * 60_000;
let cached: { key: string; at: number; country: string | null } | null = null;

/** Reads the two-letter country from a Cloudflare trace ("loc=US"), lower case; null when absent. */
export function countryFromTrace(trace: string): string | null {
  const m = /^loc=([A-Z]{2})$/m.exec(trace);
  return m && m[1] !== "XX" && m[1] !== "T1" ? m[1].toLowerCase() : null;
}

/**
 * The country this computer's browser traffic leaves from (through the configured proxy, if
 * any), lower-case ISO code, or null when it cannot be checked. Cached for ten minutes.
 */
export async function connectionCountry(): Promise<string | null> {
  // Set where the check cannot run or must not (an air-gapped server, tests)
  const fixed = process.env.PRISMGEO_CONNECTION_COUNTRY?.trim().toLowerCase();
  if (fixed && /^[a-z]{2}$/.test(fixed)) return fixed;
  const proxy = getProxyConfig();
  const key = proxy?.server || "direct";
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.country;
  let country: string | null = null;
  const ctx = await request.newContext({ proxy, timeout: 10000 }).catch(() => null);
  if (ctx) {
    try {
      const res = await ctx.get(TRACE_URL);
      if (res.ok()) country = countryFromTrace(await res.text());
    } catch {
      country = null;
    } finally {
      await ctx.dispose().catch(() => null);
    }
  }
  // A failed check is not cached, so the next audit tries again
  if (country) cached = { key, at: Date.now(), country };
  return country;
}

/** "United States" for "us"; the code itself when unknown. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "an unknown country";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export interface LocationPlan {
  /** The browser on this computer may be used. */
  browser: boolean;
  /** The saved key or provider may be used. */
  api: boolean;
  /**
   * Use the key or provider before the browser: it captures the same interface from the search
   * location while this computer is elsewhere, so it is the more faithful answer.
   */
  preferApi?: boolean;
  /** Why the engine cannot run at all from the search location, when neither may be used. */
  skip?: string;
}

/**
 * Which routes may answer an engine. With `strict` on and a target country, a browser counts only
 * when this computer connects from that country, and a key only when its API takes a location.
 */
export function planRoutes(args: {
  engineLabel: string;
  strict: boolean;
  /** Target country code ("us"), or null when the search location is not a country. */
  target: string | null;
  targetLabel: string;
  /** Country this computer connects from, or null when unknown. */
  connection: string | null;
  /** The engine has a browser route at all. */
  hasBrowser: boolean;
  /** The saved key or provider: see apiRouteLocation; null = none saved. */
  apiRoute: "interface" | "model" | "unlocated" | null;
}): LocationPlan {
  const { engineLabel, strict, target, targetLabel, connection, hasBrowser, apiRoute } = args;
  const inMarket = target !== null && connection === target;
  if (!strict || !target) {
    // Every route may run, as before; the interface captured from the right country goes first
    const preferApi = Boolean(target) && !inMarket && apiRoute === "interface";
    return preferApi ? { browser: hasBrowser, api: true, preferApi } : { browser: hasBrowser, api: apiRoute !== null };
  }
  const browser = hasBrowser && inMarket;
  const api = apiRoute === "interface" || apiRoute === "model";
  if (browser || api) return { browser, api };
  const where = connection ? `connects from ${countryName(connection)}` : "could not confirm which country it connects from";
  const fixes = [
    apiRoute === "unlocated" ? `the saved key for ${engineLabel} cannot choose a country` : "",
    `add the DataForSEO data provider (asked from ${targetLabel})`,
    hasBrowser ? `or route the browser through a proxy in ${targetLabel} that you control (Settings → Schedule & network)` : "",
  ].filter(Boolean);
  return {
    browser: false,
    api: false,
    skip: `Not run: the search location is ${targetLabel}, and this computer ${where}${hasBrowser ? `, so ${engineLabel} in a browser would answer for the wrong market` : ""}. To measure ${engineLabel} from ${targetLabel}, ${fixes.join("; ")}.`,
  };
}

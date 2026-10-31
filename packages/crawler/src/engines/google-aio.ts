import type { Browser, Page } from "playwright";
import { buildGoogleSearchUrl } from "@prismgeo/core";
import { withStealthPage, browserCaptureMethod, type CaptureMethod, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl } from "./browser-session";

export interface GoogleAioResult {
  engine: "google_aio";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
  searchUrl: string;
  locationSignal?: string;
  organic: Array<{ position: number; url: string; title: string }>;
  googleSurface: "ai_overview" | "ai_mode";
}

/** Where a Google search is asked as from: country (gl), language (hl) and a place sent as uule. */
export interface GoogleMarket {
  country?: string | null;
  language?: string;
  /** Canonical place name ("Chicago,Illinois,United States", or the country itself). */
  place?: string | null;
}

/**
 * Organic results on a Google results page, in order: links whose heading is a result title,
 * outside the AI Overview and ads. Several selector strategies, since Google's markup changes.
 */
export async function readOrganicResults(page: Page, limit = 10): Promise<Array<{ position: number; url: string; title: string }>> {
  const raw = (await page.evaluate(() => {
    const out: Array<{ url: string; title: string }> = [];
    const roots = [document.querySelector("#rso"), document.querySelector("#search"), document.body].filter(Boolean) as Element[];
    for (const root of roots) {
      for (const h3 of Array.from(root.querySelectorAll("a h3, a [role='heading'][aria-level='3']"))) {
        const a = h3.closest("a");
        if (!a || a.closest("#m-x-content, [data-subtree='aimc'], #tads, #bottomads, [data-text-ad]")) continue;
        out.push({ url: a.href, title: (h3.textContent || "").trim() });
      }
      if (out.length) break;
    }
    return out;
  })) as Array<{ url: string; title: string }>;
  const seen = new Set<string>();
  const results: Array<{ position: number; url: string; title: string }> = [];
  for (const r of raw) {
    let url = r.url;
    try {
      const u = new URL(url);
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname)) {
        if (u.pathname !== "/url") continue;
        url = u.searchParams.get("q") || u.searchParams.get("url") || "";
      }
    } catch {
      continue;
    }
    if (!/^https?:\/\//.test(url) || !r.title) continue;
    const clean = cleanCitationUrl(url);
    if (seen.has(clean)) continue;
    seen.add(clean);
    results.push({ position: results.length + 1, url: clean, title: r.title });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Which AI answer Google put on the results page. Google sometimes fills the Overview slot with an
 * AI Mode reply (headed "AI Mode reply for <query>"); it is kept, labelled as AI Mode, without that header.
 */
export function googleAnswerSurface(raw: string): { text: string; surface: "ai_overview" | "ai_mode" } {
  const aiMode = /^\s*AI Mode (?:reply|response)\b[^\n]*\n/i.exec(raw);
  if (aiMode) return { text: raw.slice(aiMode[0].length).trim(), surface: "ai_mode" };
  return { text: raw.replace(/^AI Overview\n/, ""), surface: "ai_overview" };
}

/** Google showed a normal results page without an AI Overview for this query. */
export class NoAiOverviewError extends Error {}

const AIO_SELECTOR = "#m-x-content, [data-subtree='aimc']";
/** How long Google may take to start showing an AI Overview before the search counts as "no Overview". */
export const AIO_APPEAR_TIMEOUT_MS = 25000;
/** Placeholder text of an Overview that is still being generated. */
export const AIO_PENDING = /^(AI Overview\s*)?(Thinking|Generating|Searching|Loading|Looking)\b/i;

export class GoogleAioCrawler {
  /**
   * Captures only the AI Overview block. Organic results are never stored as the "answer":
   * when Google shows no Overview the run fails with NoAiOverviewError so it is reported, not faked.
   */
  public static async execute(query: string, existingBrowser?: Browser, market: GoogleMarket = {}): Promise<GoogleAioResult> {
    const startTime = Date.now();
    const captureMethod = browserCaptureMethod("google_aio");
    // gl and hl set the market and language; uule sends the place as Google's location signal
    const { url: searchUrl } = buildGoogleSearchUrl(query, { canonicalName: market.place || undefined, country: market.country || "us", language: market.language || "en" });
    let organic: GoogleAioResult["organic"] = [];

    const answer = await withStealthPage("GoogleAioCrawler", existingBrowser, async (page) => {
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const consent = page.locator('button:has-text("Reject all"), button:has-text("Accept all")').first();
      if (await consent.isVisible({ timeout: 2000 }).catch(() => false)) {
        await consent.click();
        await page.waitForTimeout(1000);
      }
      await assertNotBlocked(page, "GoogleAioCrawler");

      // The Overview is streamed in after the page loads; slow ones show a "Thinking a little
      // longer" / "Generating" placeholder first, which is still pending, not "no Overview".
      const appeared = await page.waitForSelector(AIO_SELECTOR, { timeout: AIO_APPEAR_TIMEOUT_MS }).catch(() => null);
      if (!appeared) {
        throw new NoAiOverviewError(`[GoogleAioCrawler] No AI Overview shown for "${query}" within ${AIO_APPEAR_TIMEOUT_MS / 1000} s`);
      }
      await waitForStableAnswer(page, AIO_SELECTOR, { timeoutMs: 45000, stableMs: 2500, busyText: AIO_PENDING });

      const showMore = page.locator(`${AIO_SELECTOR.split(",")[0]} [role='button']:has-text("Show more"), div[aria-label*='Show more']`).first();
      if (await showMore.isVisible({ timeout: 1000 }).catch(() => false)) {
        await showMore.click().catch(() => null);
        await page.waitForTimeout(1500);
      }
      const extracted = await extractAnswer(page, AIO_SELECTOR, ["google.com", "gstatic.com", "googleusercontent.com"]);
      organic = await readOrganicResults(page).catch(() => []);
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "GoogleAioCrawler", query);
      return extracted;
    }, { profile: "google_aio" });

    const { text: responseText, surface: googleSurface } = googleAnswerSurface(answer.text);
    return {
      engine: "google_aio",
      query,
      responseText,
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod,
      searchUrl,
      locationSignal: market.place || undefined,
      organic,
      googleSurface,
    };
  }
}

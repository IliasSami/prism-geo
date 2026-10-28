import type { Browser } from "playwright";
import { withStealthPage, browserCaptureMethod, type CaptureMethod, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl } from "./browser-session";

export interface GoogleAioResult {
  engine: "google_aio";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
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
  public static async execute(query: string, existingBrowser?: Browser): Promise<GoogleAioResult> {
    const startTime = Date.now();
    const captureMethod = browserCaptureMethod("google_aio");

    const answer = await withStealthPage("GoogleAioCrawler", existingBrowser, async (page) => {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`, {
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
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "GoogleAioCrawler", query);
      return extracted;
    }, { profile: "google_aio" });

    return {
      engine: "google_aio",
      query,
      responseText: answer.text.replace(/^AI Overview\n/, ""),
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod,
    };
  }
}

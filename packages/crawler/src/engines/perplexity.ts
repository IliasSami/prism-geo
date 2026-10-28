import type { Browser } from "playwright";
import { withStealthPage, browserCaptureMethod, type CaptureMethod, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl } from "./browser-session";

export interface EngineResult {
  engine: "perplexity";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
}

const ANSWER_SELECTOR = ".prose";

export class PerplexityEngineCrawler {
  /**
   * Perplexity refuses logged-out `/search?q=` deep links ("Sign up and repeat your request"),
   * but answers a query typed into the homepage box, so the query is typed like a user would.
   */
  public static async execute(query: string, existingBrowser?: Browser): Promise<EngineResult> {
    const startTime = Date.now();
    const captureMethod = browserCaptureMethod("perplexity");

    const answer = await withStealthPage("PerplexityCrawler", existingBrowser, async (page) => {
      await page.goto("https://www.perplexity.ai/", { waitUntil: "domcontentloaded", timeout: 30000 });
      const input = page.locator("#ask-input, textarea, div[contenteditable='true']").first();
      await input.waitFor({ timeout: 15000 });
      await input.click();
      await page.keyboard.type(query, { delay: 15 });
      await page.keyboard.press("Enter");
      await page.waitForSelector(ANSWER_SELECTOR, { timeout: 45000 }).catch(() => null);
      await assertNotBlocked(page, "PerplexityCrawler");
      // Perplexity can pause mid-answer while it runs another search step
      await waitForStableAnswer(page, ANSWER_SELECTOR, { timeoutMs: 90000, stableMs: 5000 });
      const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["perplexity.ai"]);
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "PerplexityCrawler", query);
      return extracted;
    }, { profile: "perplexity" });

    return {
      engine: "perplexity",
      query,
      responseText: answer.text,
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      // Perplexity no longer exposes its internal search steps to logged-out users.
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod,
    };
  }
}

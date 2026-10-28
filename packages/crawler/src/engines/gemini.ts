import type { Browser } from "playwright";
import { withStealthPage, browserCaptureMethod, type CaptureMethod, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl } from "./browser-session";

export interface GeminiResult {
  engine: "gemini";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
}

const ANSWER_SELECTOR = "model-response message-content";

export class GeminiEngineCrawler {
  /**
   * Queries the Gemini app itself (gemini.google.com, logged-out tier). Previously this engine
   * scraped google.com/search, duplicating the Google AI Overviews engine under another name.
   */
  public static async execute(query: string, existingBrowser?: Browser): Promise<GeminiResult> {
    const startTime = Date.now();
    const captureMethod = browserCaptureMethod("gemini");

    const answer = await withStealthPage("GeminiCrawler", existingBrowser, async (page) => {
      await page.goto("https://gemini.google.com/app?hl=en", { waitUntil: "domcontentloaded", timeout: 30000 });
      await assertNotBlocked(page, "GeminiCrawler");
      const input = page.locator("rich-textarea .ql-editor, div[contenteditable='true']").first();
      await input.waitFor({ timeout: 15000 });
      await input.click();
      await input.fill(query);
      await page.keyboard.press("Enter");
      await page.waitForSelector(ANSWER_SELECTOR, { timeout: 45000 }).catch(() => null);
      // A 3s quiet period cut answers off mid-stream; also wait for the stop button to go away
      await waitForStableAnswer(page, ANSWER_SELECTOR, {
        timeoutMs: 120000,
        stableMs: 6000,
        busySelector: "button[aria-label*='Stop response' i], button[aria-label*='Stop generating' i], button.stop",
      });
      const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["gemini.google.com", "accounts.google.com"]);
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "GeminiCrawler", query);
      return extracted;
    }, { profile: "gemini" });

    return {
      engine: "gemini",
      query,
      responseText: answer.text,
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod,
    };
  }
}

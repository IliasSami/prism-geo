import type { Browser } from "playwright";
import { withStealthPage, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl, EngineBlockedError, type CaptureMethod } from "./browser-session";
import { isProfileConnected } from "./profiles";

export interface CopilotResult {
  engine: "copilot";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
}

const ANSWER_SELECTOR = "[data-content='ai-message']";

export class CopilotEngineCrawler {
  /**
   * Microsoft Copilot (copilot.microsoft.com) shows logged-out visitors a marketing page with a
   * sign-in button, so it can only be crawled with a profile the user signed in to themselves.
   * The old implementation stored Bing's organic results as if they were a Copilot answer.
   */
  public static get available(): boolean {
    return isProfileConnected("copilot");
  }
  public static readonly unavailableReason =
    "Microsoft Copilot requires a signed-in session: connect a Microsoft account under Settings → Signed-in sessions";

  public static async execute(query: string, existingBrowser?: Browser): Promise<CopilotResult> {
    if (!CopilotEngineCrawler.available) {
      throw new Error(`[CopilotCrawler] ${CopilotEngineCrawler.unavailableReason} ("${query}")`);
    }
    const startTime = Date.now();

    const answer = await withStealthPage("CopilotCrawler", existingBrowser, async (page) => {
      await page.goto("https://copilot.microsoft.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await assertNotBlocked(page, "CopilotCrawler");
      const input = page.locator("textarea#userInput, textarea, div[contenteditable='true']").first();
      const ready = await input.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      if (!ready) {
        // The saved session expired and Copilot fell back to its logged-out landing page
        throw new EngineBlockedError("[CopilotCrawler] No chat box: the Microsoft session expired, reconnect it in Settings");
      }
      await input.click();
      await page.keyboard.type(query, { delay: 15 });
      await page.keyboard.press("Enter");
      await page.waitForSelector(ANSWER_SELECTOR, { timeout: 45000 }).catch(() => null);
      await waitForStableAnswer(page, ANSWER_SELECTOR, { timeoutMs: 90000, stableMs: 4000 });
      const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["copilot.microsoft.com", "microsoft.com", "bing.com"]);
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "CopilotCrawler", query);
      return extracted;
    }, { profile: "copilot" });

    return {
      engine: "copilot",
      query,
      responseText: answer.text,
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod: "browser_signed_in",
    };
  }
}

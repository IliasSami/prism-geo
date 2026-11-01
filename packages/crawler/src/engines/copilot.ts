import type { Browser } from "playwright";
import { withStealthPage, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl, EngineBlockedError, QuestionNotSentError, type CaptureMethod } from "./browser-session";
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
   * Microsoft Copilot (copilot.com, formerly copilot.microsoft.com) shows logged-out visitors a marketing page with a
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
      // Copilot moved to copilot.com (seen live 2026-11-01); the old address shows a marketing page
      await page.goto("https://copilot.com/chat", { waitUntil: "domcontentloaded", timeout: 30000 });
      await assertNotBlocked(page, "CopilotCrawler");
      const input = page.locator("[role='textbox'][contenteditable='true'], textarea#userInput, textarea, [contenteditable='true']").first();
      let ready = await input.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      if (!ready) {
        // A "Sign into Copilot" landing: its own Sign in button resumes the saved Microsoft session
        // (no password is typed; a signed-out profile ends on Microsoft's sign-in form instead)
        const signIn = page.getByRole("button", { name: /^sign in$/i }).or(page.getByRole("link", { name: /^sign in$/i })).first();
        if (await signIn.isVisible().catch(() => false)) {
          await signIn.click({ timeout: 5000 }).catch(() => null);
          ready = await input.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
        }
      }
      if (!ready) {
        // The saved session expired and Copilot fell back to its logged-out landing page
        throw new EngineBlockedError("[CopilotCrawler] No chat box: the Microsoft session expired, reconnect it in Settings");
      }
      await input.click();
      await page.keyboard.type(query, { delay: 15 });
      await page.keyboard.press("Enter");
      // Sent once the composer empties; the page's Send button otherwise. Seen live 2026-11-01:
      // copilot.com failed to load its own texts and kept the question in the box, unsent.
      const unsent = async () => ((await input.innerText().catch(() => "")) || "").trim().length > 0;
      if (await page.waitForFunction((el) => !(el?.textContent || "").trim(), await input.elementHandle(), { timeout: 5000 }).then(() => false, unsent)) {
        await page.locator("button[aria-label='Send'], button[aria-label*='Submit' i]").first().click({ timeout: 3000 }).catch(() => null);
        await page.waitForTimeout(3000);
        if (await unsent()) throw new QuestionNotSentError("[CopilotCrawler] Copilot did not accept the question from the automated browser (its page kept it unsent)");
      }
      await page.waitForSelector(ANSWER_SELECTOR, { timeout: 45000 }).catch(() => null);
      await waitForStableAnswer(page, ANSWER_SELECTOR, { timeoutMs: 90000, stableMs: 4000 });
      const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["copilot.com", "copilot.microsoft.com", "microsoft.com", "bing.com"]);
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

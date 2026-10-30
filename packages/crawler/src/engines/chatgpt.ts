import type { Browser } from "playwright";
import { withStealthPage, browserCaptureMethod, type CaptureMethod, assertNotBlocked, assertRealAnswer, waitForStableAnswer, extractAnswer, cleanCitationUrl } from "./browser-session";

export interface ChatGptEngineResult {
  engine: "chatgpt";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
}

const ANSWER_SELECTOR = "[data-message-author-role='assistant'], [data-prism-answer]";

/**
 * The logged-out UI has no role attributes; each assistant turn follows a visually hidden
 * "ChatGPT said:" heading. Tag that heading's turn container so it can be selected.
 */
const MARK_ANSWER = () => {
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, .sr-only")].filter((h) =>
    /^ChatGPT said:?$/i.test((h.textContent || "").trim())
  );
  const heading = headings[headings.length - 1];
  if (heading?.parentElement) heading.parentElement.setAttribute("data-prism-answer", "1");
  return Boolean(heading);
};

export class ChatGptEngineCrawler {
  /**
   * Logged-out ChatGPT answers `chatgpt.com/?q=` directly (with web search when it decides to),
   * so the query is never re-typed: re-submitting used to create a second, unanswered turn.
   */
  public static async execute(query: string, existingBrowser?: Browser): Promise<ChatGptEngineResult> {
    const startTime = Date.now();
    const captureMethod = browserCaptureMethod("chatgpt");

    const answer = await withStealthPage("ChatGptCrawler", existingBrowser, async (page) => {
      // Signed in: a Temporary Chat (no memory, no chat history), so the account's past
      // conversations do not shape the answer. Logged-out chats have no memory anyway.
      const fresh = captureMethod === "browser_signed_in" ? "temporary-chat=true&" : "";
      await page.goto(`https://chatgpt.com/?${fresh}q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page
        .waitForFunction(() => document.body.innerText.includes("ChatGPT said") || !!document.querySelector("[data-message-author-role='assistant']"), null, { timeout: 45000 })
        .catch(() => null);
      await page.evaluate(MARK_ANSWER);
      await assertNotBlocked(page, "ChatGptCrawler");
      await waitForStableAnswer(page, ANSWER_SELECTOR, { timeoutMs: 120000, stableMs: 4000, busyText: /^(Searching|Thinking)/i });
      const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["chatgpt.com", "openai.com"]);
      // Checked inside the session so a failure snapshot of the page is saved
      assertRealAnswer(extracted.text, "ChatGptCrawler", query);
      return extracted;
    }, { profile: "chatgpt" });

    return {
      engine: "chatgpt",
      query,
      responseText: answer.text,
      citations: answer.links.map((l) => ({ url: cleanCitationUrl(l.url), title: l.title })),
      // ChatGPT does not expose the web-search queries it issues to logged-out users.
      subQueries: [],
      executionMs: Date.now() - startTime,
      captureMethod,
    };
  }
}

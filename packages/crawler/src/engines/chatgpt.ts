import type { Browser, Page } from "playwright";
import {
  withStealthPage,
  browserCaptureMethod,
  type CaptureMethod,
  assertNotBlocked,
  assertRealAnswer,
  waitForStableAnswer,
  extractAnswer,
  cleanCitationUrl,
  QuestionNotSentError,
} from "./browser-session";

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

/** The question was sent: a user turn exists (signed in) or a "You said:" heading (logged out). */
const QUESTION_SENT = () => !!document.querySelector("[data-message-author-role='user']") || /\bYou said:?/.test(document.body.innerText);

/**
 * A first-use intro dialog (seen live 2026-11-01 on a signed-in account: "Temporary chat … Continue")
 * covers the composer, so `?q=` leaves the question typed but unsent. The dialog is closed and, only
 * when no question was sent yet, the question is sent once. Human checks are never touched here.
 */
async function sendPastIntroDialog(page: Page): Promise<void> {
  const dialog = page.locator("[role='dialog']").filter({ hasText: /temporary chat|welcome|what's new|get started/i }).first();
  // isVisible() does not wait, so wait for the dialog explicitly
  const shown = await dialog.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false);
  if (!shown) return;
  await dialog.getByRole("button", { name: /^(continue|got it|okay|ok|start)$/i }).first().click({ timeout: 3000 }).catch(() => null);
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => null);
  if (await page.evaluate(QUESTION_SENT).catch(() => false)) return;
  // The composer's own Send button (aria-label, seen live 2026-11-01); Enter in the composer otherwise
  const send = page.locator("form[data-chatgpt-composer] button[aria-label='Send'], button[aria-label='Send'], [data-testid='send-button']").first();
  if (await send.isEnabled({ timeout: 3000 }).catch(() => false)) await send.click().catch(() => null);
  else await page.locator("#prompt-textarea, form[data-chatgpt-composer] [contenteditable='true']").first().press("Enter").catch(() => null);
}

/** Asks one question in a page; `signedIn` uses a Temporary Chat. */
async function ask(page: Page, query: string, signedIn: boolean) {
  // Signed in: a Temporary Chat (no memory, no chat history), so the account's past
  // conversations do not shape the answer. Logged-out chats have no memory anyway.
  const fresh = signedIn ? "temporary-chat=true&" : "";
  await page.goto(`https://chatgpt.com/?${fresh}q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sendPastIntroDialog(page);
  await page
    .waitForFunction(() => document.body.innerText.includes("ChatGPT said") || !!document.querySelector("[data-message-author-role='assistant']"), null, { timeout: 45000 })
    .catch(() => null);
  await page.evaluate(MARK_ANSWER);
  await assertNotBlocked(page, "ChatGptCrawler", ANSWER_SELECTOR);
  // Seen live 2026-11-01: a signed-in session can show a normal page yet ignore the question
  if (!(await page.evaluate(QUESTION_SENT).catch(() => false))) {
    throw new QuestionNotSentError(`[ChatGptCrawler] ChatGPT did not accept the question from the automated browser${signedIn ? " while signed in" : ""}`);
  }
  await waitForStableAnswer(page, ANSWER_SELECTOR, { timeoutMs: 120000, stableMs: 4000, busyText: /^(Searching|Thinking)/i });
  const extracted = await extractAnswer(page, ANSWER_SELECTOR, ["chatgpt.com", "openai.com"]);
  // Checked inside the session so a failure snapshot of the page is saved
  assertRealAnswer(extracted.text, "ChatGptCrawler", query);
  return extracted;
}

export class ChatGptEngineCrawler {
  /**
   * Logged-out ChatGPT answers `chatgpt.com/?q=` directly (with web search when it decides to),
   * so the query is never re-typed: re-submitting used to create a second, unanswered turn.
   * When the signed-in session does not accept the question, it is asked once logged out and
   * stored as a logged-out capture ("browser"), never as the account's answer.
   */
  public static async execute(query: string, existingBrowser?: Browser): Promise<ChatGptEngineResult> {
    const startTime = Date.now();
    let captureMethod = browserCaptureMethod("chatgpt");
    const signedIn = captureMethod === "browser_signed_in";

    let answer;
    try {
      answer = await withStealthPage("ChatGptCrawler", existingBrowser, (page) => ask(page, query, signedIn), { profile: "chatgpt" });
    } catch (err) {
      if (!(signedIn && err instanceof QuestionNotSentError)) throw err;
      console.warn("[ChatGptCrawler] The signed-in session did not accept the question; asking it logged out instead");
      answer = await withStealthPage("ChatGptCrawler", existingBrowser, (page) => ask(page, query, false));
      captureMethod = "browser";
    }

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

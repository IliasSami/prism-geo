import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getDbPath, getSettings, ensurePrivateDir, PRIVATE_FILE_MODE } from "@prismgeo/db";
import { canonicalUrl } from "@prismgeo/core";
import { generateStealthProfile, STEALTH_INJECTION_SCRIPT, getChromiumExecutablePath } from "../stealth/fingerprint";
import { readProfile, profileDir, PROFILE_ARGS, type ProfileEngine } from "./profiles";

export interface ExtractedAnswer {
  text: string;
  links: Array<{ url: string; title: string }>;
}

/** How a stored answer was obtained; persisted as prompt_runs.capture_method. */
export type CaptureMethod = "browser" | "browser_signed_in" | "api";

/**
 * Optional outbound proxy from Settings → Crawler (e.g. http://user:pass@host:port). Routing
 * browser engines through a residential or office IP is the self-hosted answer to IP-level
 * rate limits such as Google's "unusual traffic" page.
 */
export function getProxyConfig(): { server: string; username?: string; password?: string } | undefined {
  const raw = (getSettings<{ proxyUrl?: string }>("crawler_settings", {}).proxyUrl || process.env.PRISMGEO_PROXY_URL || "").trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    console.warn("[Crawler] Ignoring invalid proxy URL in settings");
    return undefined;
  }
}

/** Shape every engine (browser or API) returns to the orchestrator. */
export interface EngineAnswer {
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
  captureMethod: CaptureMethod;
}

/** The capture method a browser engine will use: its signed-in profile when one is saved. */
export const browserCaptureMethod = (engine: ProfileEngine): CaptureMethod => (readProfile(engine) ? "browser_signed_in" : "browser");

/** Raised when the engine served a bot check, login wall or other block instead of an answer. */
export class EngineBlockedError extends Error {}

const BLOCK_SIGNALS = [
  "just a moment",
  "verify you are human",
  "unusual traffic",
  "unusual activity",
  "are you a robot",
  "captcha",
  "sign up and repeat your request",
];

/**
 * Runs `fn` in a browser page and always tears it down afterwards. When the user has signed in
 * to `profile` (see profiles.ts) the saved profile is reused headlessly; otherwise a fresh
 * anonymous stealth context is created on the shared browser (or a browser of its own).
 */
export async function withStealthPage<T>(
  tag: string,
  existingBrowser: Browser | undefined,
  fn: (page: Page) => Promise<T>,
  options: { profile?: ProfileEngine } = {}
): Promise<T> {
  const marker = options.profile ? readProfile(options.profile) : null;
  let context: BrowserContext;
  let browser: Browser | null = null;
  let ownBrowser = false;

  if (marker && options.profile) {
    // A persistent profile has its own browser process; one engine uses it at a time
    context = await chromium.launchPersistentContext(profileDir(options.profile), {
      headless: true,
      executablePath: getChromiumExecutablePath(),
      args: PROFILE_ARGS,
      ignoreDefaultArgs: ["--enable-automation"],
      proxy: getProxyConfig(),
      userAgent: marker.userAgent.replace("HeadlessChrome", "Chrome") || undefined,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
  } else {
    browser = existingBrowser || null;
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        executablePath: getChromiumExecutablePath(),
        proxy: getProxyConfig(),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--disable-infobars"],
      });
      ownBrowser = true;
    }
    const stealth = generateStealthProfile(browser.version());
    context = await browser.newContext({
      userAgent: stealth.userAgent,
      viewport: stealth.viewport,
      deviceScaleFactor: stealth.deviceScaleFactor,
      locale: stealth.locale,
      timezoneId: stealth.timezoneId,
    });
  }

  let page: Page | null = null;
  try {
    await context.addInitScript(STEALTH_INJECTION_SCRIPT);
    page = marker ? context.pages()[0] || (await context.newPage()) : await context.newPage();
    return await fn(page);
  } catch (err) {
    if (page) await saveFailureSnapshot(page, tag);
    throw err;
  } finally {
    await context.close().catch((err) => console.warn(`[${tag}] Context close error:`, (err as Error).message));
    if (ownBrowser && browser) {
      await browser.close().catch((err) => console.warn(`[${tag}] Browser close error:`, (err as Error).message));
    }
  }
}

/**
 * Saves a screenshot and the HTML of a page whose crawl failed into `<data dir>/crawl-debug/`,
 * so blocks, layout changes and timeouts can be diagnosed after the batch.
 */
async function saveFailureSnapshot(page: Page, tag: string): Promise<void> {
  try {
    const dir = path.join(path.dirname(getDbPath()), "crawl-debug");
    ensurePrivateDir(dir);
    pruneSnapshots(dir);
    const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${tag}`);
    await page.screenshot({ path: `${base}.png`, timeout: 5000 });
    fs.chmodSync(`${base}.png`, PRIVATE_FILE_MODE);
    fs.writeFileSync(`${base}.html`, await page.content(), { mode: PRIVATE_FILE_MODE });
  } catch {
    // Diagnostics are best-effort and must never mask the original failure
  }
}

/**
 * Keeps failure snapshots (png + html pairs) bounded: at most the newest MAX_SNAPSHOT_FILES, and
 * nothing older than MAX_SNAPSHOT_AGE_DAYS. Snapshots can show signed-in pages, so they should not linger.
 */
const MAX_SNAPSHOT_FILES = 300;
const MAX_SNAPSHOT_AGE_DAYS = 14;
export function pruneSnapshots(dir: string, now = Date.now()): void {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png") || f.endsWith(".html")).sort();
  const cutoff = now - MAX_SNAPSHOT_AGE_DAYS * 86_400_000;
  files.forEach((f, i) => {
    const file = path.join(dir, f);
    const tooMany = i < files.length - MAX_SNAPSHOT_FILES;
    if (tooMany || fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  });
}

/**
 * Replies engines show instead of an answer. They are short (under REPLY_MAX_CHARS), so the
 * patterns are only applied to short texts: a real answer that happens to begin with "An error
 * occurred in many checkouts..." is never rejected.
 */
const REPLY_MAX_CHARS = 400;
/** Rate limits and abuse checks: the engine is refusing us, so these count as blocks. */
const THROTTLE_REPLIES = [
  /i'?m having a hard time fulfilling your request/i,
  /you'?ve (reached|hit) (your|the) (daily |usage |message |free[- ]plan |hourly )?limit/i,
  /unusual activity (has been )?detected/i,
  /(pro )?search limit reached/i,
  /too many requests/i,
  /\brate limit(ed)?\b/i,
];
/** Engine-side failures with no answer in them. */
const ERROR_REPLIES = [
  /^(hmm[.…]*\s*)?something (seems to have )?(went|gone) wrong/i,
  /^sorry,? something went wrong/i,
  /there was an error generating a response/i,
  /^network error/i,
  /^an error occurred\.?\s*(please|try|$)/i,
  /^error in (message|body) stream/i,
  /^(i'?m )?unable to (load|generate) (a )?(response|conversation)/i,
  // Gemini, seen live: "I encountered an error doing what you asked. Could you try again?"
  /^i (encountered|ran into|hit) an? (unexpected )?(error|issue|problem)( (doing|while|processing|trying|with your)\b|[.,!])/i,
];

/**
 * Rejects text that is an engine's error or throttle message rather than an answer, so it is
 * recorded as a failure instead of being stored and scored as a real response.
 */
export function assertRealAnswer(text: string, tag: string, query: string): void {
  const t = (text || "").trim();
  const head = t.slice(0, 80).replace(/\s+/g, " ");
  if (t.length < REPLY_MAX_CHARS) {
    if (THROTTLE_REPLIES.some((r) => r.test(t))) {
      throw new EngineBlockedError(`[${tag}] Throttled reply instead of an answer ("${head.slice(0, 60)}")`);
    }
    if (ERROR_REPLIES.some((r) => r.test(t))) {
      throw new Error(`[${tag}] No extractable response for "${query}" (engine error: "${head.slice(0, 60)}")`);
    }
  }
  if (t.length < 50) {
    throw new Error(`[${tag}] No extractable response for "${query}"`);
  }
}

/** Throws EngineBlockedError when the visible page is a bot check or login wall. */
export async function assertNotBlocked(page: Page, tag: string): Promise<void> {
  const head = ((await page.evaluate(() => document.body?.innerText || "")) as string).slice(0, 3000).toLowerCase();
  const hit = BLOCK_SIGNALS.find((s) => head.includes(s));
  if (hit) throw new EngineBlockedError(`[${tag}] Blocked by engine ("${hit}")`);
}

/** The answer was still streaming when the wait ran out; storing it would undercount late mentions. */
export class AnswerNotFinishedError extends Error {}

/**
 * Polls the last element matching `selector` until its text stops changing for `stableMs`
 * (i.e. the engine finished streaming). Returns false if nothing usable appeared in time, and
 * throws AnswerNotFinishedError (classified as no_answer, retried once) when text appeared but
 * was still changing or marked busy at the deadline: a truncated answer is never stored.
 */
export async function waitForStableAnswer(
  page: Page,
  selector: string,
  {
    timeoutMs = 90000,
    stableMs = 3000,
    minLength = 50,
    busyText,
    busySelector,
  }: { timeoutMs?: number; stableMs?: number; minLength?: number; busyText?: RegExp; busySelector?: string } = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const text = (await page
      .evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        const el = els[els.length - 1] as HTMLElement | undefined;
        return el ? el.innerText : "";
      }, selector)
      .catch(() => "")) as string;
    // Engines pause mid-stream (e.g. while searching); a visible "stop" control means still generating
    const generating = busySelector ? await page.locator(busySelector).first().isVisible().catch(() => false) : false;
    const busy = generating || (busyText ? busyText.test(text.slice(0, 200)) : false);
    if (text.length >= minLength && !busy && text === last) {
      if (stableSince && Date.now() - stableSince >= stableMs) return true;
      if (!stableSince) stableSince = Date.now();
    } else {
      stableSince = 0;
    }
    last = text;
    await page.waitForTimeout(750);
  }
  if (last.length >= minLength) {
    throw new AnswerNotFinishedError(`No extractable response: answer did not finish streaming within ${Math.round(timeoutMs / 1000)} s`);
  }
  return false;
}

/**
 * Extracts the answer text and its outbound source links from the last element matching
 * `selector`. Line structure is preserved (one block per line) so downstream stance
 * classification can work per sentence / list item. Inline citation chips are recorded
 * as links and removed from the text so source labels are not mistaken for mentions.
 */
export async function extractAnswer(page: Page, selector: string, excludeHosts: string[]): Promise<ExtractedAnswer> {
  return (await page.evaluate(
    ({ sel, exclude }) => {
      var __name = (target: any) => target;
      const els = document.querySelectorAll(sel);
      const root = els[els.length - 1] as HTMLElement | undefined;
      if (!root) return { text: "", links: [] };

      const unwrap = (href: string): string => {
        try {
          const u = new URL(href, location.href);
          if (u.hostname.endsWith("google.com") && u.pathname === "/url") return u.searchParams.get("q") || u.searchParams.get("url") || "";
          return u.href;
        } catch {
          return "";
        }
      };

      const links: Array<{ url: string; title: string }> = [];
      const clone = root.cloneNode(true) as HTMLElement;
      // Perplexity source chips carry the cited URL as an attribute rather than an href
      clone.querySelectorAll("[data-pplx-citation-url]").forEach((chip) => {
        const url = unwrap(chip.getAttribute("data-pplx-citation-url") || "");
        if (url.startsWith("http") && !links.some((l) => l.url === url)) {
          links.push({ url, title: (chip.textContent || "").replace(/\+\s?\d+$/, "").trim() || url });
        }
      });
      clone.querySelectorAll("[data-pplx-citation]").forEach((n) => n.remove());
      clone
        .querySelectorAll("style, script, noscript, svg, button, img, [aria-hidden='true'], .sr-only, source-footnote, sources-carousel-inline, source-inline-chip")
        .forEach((n) => n.remove());
      clone.querySelectorAll("a[href]").forEach((a) => {
        const url = unwrap(a.getAttribute("href") || "");
        const label = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (url.startsWith("http") && !exclude.some((h: string) => new URL(url).hostname.endsWith(h))) {
          if (!links.some((l) => l.url === url)) links.push({ url, title: label || url });
        }
        // Remove source chips only: a host-like label ("help.example.com"), a counted chip
        // ("Reddit +1"), or a lone one-word label that is part of its link's host ("examplehq" ->
        // examplehq.com). A linked product name ("<a>Dialsy</a> - ...") is prose and stays in the
        // text: it is both a mention and a citation.
        let host = "";
        try {
          host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          host = "";
        }
        const bare = label.toLowerCase().replace(/\s*\+\s?\d+$/, "").replace(/[\s.-]+/g, "");
        const blockText = (a.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
        // Chips are lower-case hosts; a capitalised "Callora.io" is a product name. A host written
        // inside a sentence ("the main site is example.ai.") is prose too: chips follow a sentence,
        // they never follow a word.
        const before = blockText.slice(0, Math.max(0, blockText.indexOf(label))).trimEnd();
        const inSentence = /[\p{L}\p{N},:(]$/u.test(before);
        const hostLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(label) && !inSentence;
        const counted = /\+\s?\d+$/.test(label);
        const loneHostLabel =
          blockText === label && bare.length > 0 && !/\s/.test(label) && label.length <= 25 && /^[a-z0-9-]+$/.test(label) && host.replace(/[.-]/g, "").includes(bare);
        if (label.length <= 40 && (hostLike || counted || loneHostLabel)) a.remove();
      });
      clone.querySelectorAll("td, th").forEach((n) => n.insertAdjacentText("afterend", " | "));
      clone.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, tr, br, div").forEach((n) => n.insertAdjacentText("afterend", "\n"));
      const text = (clone.textContent || "")
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        // Drop UI chrome and non-link source pills ("+1", "help.skio.com") that render as text
        .filter((l) => l && !/^\+\s?\d+$/.test(l) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(l) && !/^ChatGPT said:?$/i.test(l))
        .join("\n");
      return { text, links };
    },
    { sel: selector, exclude: excludeHosts }
  )) as ExtractedAnswer;
}

/** Canonical form of a cited URL (tracking parameters, fragment and trailing slash removed); see canonicalUrl. */
export function cleanCitationUrl(url: string): string {
  return canonicalUrl(url) ?? url;
}

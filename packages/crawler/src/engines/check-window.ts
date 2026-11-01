import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { ensurePrivateDir } from "@prismgeo/db";
import { getChromiumExecutablePath } from "../stealth/fingerprint";
import { assertNotBlocked, EngineBlockedError } from "./browser-session";
import { getProxyConfig } from "./proxy";
import { activeAccount, profileDir, visitorProfileDir, withProfileLock, writeVisitorMarker, PROFILE_ARGS, type ProfileEngine } from "./profiles";

/**
 * A visible browser window where a person completes a human check themselves.
 *
 * It opens the same saved profile the crawler uses for the engine (the signed-in account, or the
 * visitor profile when there is none) and the same proxy, so what the person completes is what the
 * crawler sees next. PrismGEO only watches whether the page still shows a check; it never clicks,
 * types or answers anything in it.
 */

/**
 * Whether this machine can show a browser window to the person using it. Linux needs an X11 or
 * Wayland display; a Docker container never has one (macOS and Windows always do).
 */
export function canShowWindow(): boolean {
  if (fs.existsSync("/.dockerenv") || process.env.PRISMGEO_IN_DOCKER === "1") return false;
  if (process.platform !== "linux") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

interface WindowState {
  /** The page in front no longer shows a check. */
  cleared: boolean;
  close: () => Promise<void>;
}

const g = globalThis as typeof globalThis & { __prismCheckWindows?: Map<string, WindowState> };
const windows = (g.__prismCheckWindows ??= new Map<string, WindowState>());

/** Whether a check window is open for the engine, and whether the check is gone from it. */
export function checkWindowState(engine: string): { open: boolean; cleared: boolean } {
  const w = windows.get(engine);
  return { open: Boolean(w), cleared: w?.cleared === true };
}

/** Closes the engine's check window (the person said they are done). */
export async function closeCheckWindow(engine: string): Promise<void> {
  await windows.get(engine)?.close();
}

/** Whether the page shows a check or wall: assertNotBlocked's signals, without its usage-limit case. */
async function showsCheck(context: BrowserContext): Promise<boolean | null> {
  const page = context.pages().at(-1);
  if (!page) return null;
  try {
    await assertNotBlocked(page, "CheckWindow");
    return false;
  } catch (err) {
    // A closing page throws other errors: keep the last reading
    return err instanceof EngineBlockedError ? !/usage limit/i.test(err.message) : null;
  }
}

/**
 * Readings in a row (one every 2 s) that must show no check before the window counts as cleared.
 * Cloudflare's widget takes a few seconds to draw, so one clean reading right after a load is
 * not enough (seen live: "cleared" flickered on while the check was still loading).
 */
export const CLEAN_READINGS_NEEDED = 3;

export interface ClearState {
  /** Clean readings in a row since the last check or failed load. */
  cleanStreak: number;
  /** A check was seen in the window at some point. */
  sawCheck: boolean;
  cleared: boolean;
}

/**
 * The window's state after one reading. `loaded`: the page in front came from a successful load
 * (an error page is never "cleared"). `shown`: it shows a check (null: unreadable, e.g. closing).
 */
export function nextClearState(s: ClearState, reading: { loaded: boolean; shown: boolean | null }): ClearState {
  if (reading.shown === null) return s;
  if (reading.shown) return { cleanStreak: 0, sawCheck: true, cleared: false };
  if (!reading.loaded) return { ...s, cleanStreak: 0, cleared: false };
  const cleanStreak = s.cleanStreak + 1;
  return { ...s, cleanStreak, cleared: cleanStreak >= CLEAN_READINGS_NEEDED };
}

const isWebPage = (url: string) => /^https?:/i.test(url);

/**
 * Opens the window on `url` and resolves when the person closes it. `cleared` tells whether the
 * last pages they saw were free of checks. A check seen and then completed in the visitor profile
 * is remembered, so logged-out audits reuse that profile from then on.
 */
export async function openCheckWindow(engine: ProfileEngine, url: string): Promise<{ cleared: boolean }> {
  if (windows.has(engine)) throw new Error(`A window for ${engine} is already open`);
  const account = activeAccount(engine);
  const dir = account ? profileDir(engine, account) : visitorProfileDir(engine);
  const state: WindowState = { cleared: false, close: async () => {} };
  windows.set(engine, state);
  let poll: ReturnType<typeof setInterval> | null = null;
  try {
    ensurePrivateDir(path.dirname(dir));
    ensurePrivateDir(dir);
    // The window holds the profile until it closes; an audit page using it is waited for first
    return await withProfileLock(dir, async () => {
      const context = await chromium.launchPersistentContext(dir, {
        headless: false,
        executablePath: getChromiumExecutablePath(),
        viewport: null,
        args: PROFILE_ARGS,
        ignoreDefaultArgs: ["--enable-automation"],
        proxy: getProxyConfig(),
      });
      try {
        state.close = () => context.close().catch(() => undefined);
        const closed = new Promise<void>((resolve) => context.on("close", () => resolve()));
        // A page counts as loaded once a web page finished loading in it (the person may reload a failed one)
        const loadedPages = new WeakSet<Page>();
        const watch = (p: Page) => p.on("load", () => isWebPage(p.url()) && loadedPages.add(p));
        context.pages().forEach(watch);
        context.on("page", watch);
        const page = context.pages()[0] || (await context.newPage());
        const loaded = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
          .then(() => isWebPage(page.url()))
          .catch(() => false);
        if (loaded) loadedPages.add(page);
        const userAgent = ((await page.evaluate(() => navigator.userAgent).catch(() => "")) as string) || "";
        let clear: ClearState = { cleanStreak: 0, sawCheck: false, cleared: false };
        const check = async () => {
          const front = context.pages().at(-1);
          const shown = await showsCheck(context);
          clear = nextClearState(clear, { loaded: Boolean(front && loadedPages.has(front) && isWebPage(front.url())), shown });
          state.cleared = clear.cleared;
        };
        await check();
        poll = setInterval(check, 2000);
        await closed;
        // Remembered only when a check was really there and the person got past it
        if (clear.cleared && clear.sawCheck && !account && userAgent) writeVisitorMarker(engine, userAgent);
        return { cleared: clear.cleared };
      } finally {
        if (poll) clearInterval(poll);
        poll = null;
        // No visible window is left behind after an error
        await context.close().catch(() => undefined);
      }
    });
  } finally {
    if (poll) clearInterval(poll);
    windows.delete(engine);
  }
}

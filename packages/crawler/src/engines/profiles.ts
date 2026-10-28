import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getDbPath, ensurePrivateDir, PRIVATE_FILE_MODE } from "@prismgeo/db";
import { getChromiumExecutablePath } from "../stealth/fingerprint";

/**
 * Persistent, user-signed-in browser profiles, one per engine.
 *
 * The user signs in themselves in a visible browser window (free accounts are enough); the
 * crawler then reuses that profile headlessly. Signed-in sessions get far higher quotas than
 * anonymous visitors (Perplexity), unlock engines that require an account (Copilot) and carry
 * long-lived cookies that trigger fewer bot checks. PrismGEO never sees or stores the password.
 */
export type ProfileEngine = "chatgpt" | "perplexity" | "gemini" | "google_aio" | "copilot";

export const PROFILE_ENGINES: ProfileEngine[] = ["chatgpt", "perplexity", "gemini", "google_aio", "copilot"];

const SIGN_IN_URLS: Record<ProfileEngine, string> = {
  chatgpt: "https://chatgpt.com/auth/login",
  perplexity: "https://www.perplexity.ai/",
  gemini: "https://gemini.google.com/app?hl=en",
  google_aio: "https://accounts.google.com/ServiceLogin?continue=https://www.google.com/",
  copilot: "https://copilot.microsoft.com/",
};

interface ProfileMarker {
  engine: ProfileEngine;
  connectedAt: string;
  /** The real user agent of the window the user signed in with, reused headlessly. */
  userAgent: string;
}

export interface ProfileStatus {
  engine: ProfileEngine;
  connected: boolean;
  connecting: boolean;
  connectedAt: string | null;
  /** Why the last sign-in window failed (e.g. no display on a headless server); cleared on success. */
  lastError: string | null;
}

const MARKER_FILE = "prismgeo-profile.json";
const connecting = new Set<ProfileEngine>();
const lastErrors: Map<ProfileEngine, string> = ((globalThis as any).__prismProfileErrors ??= new Map<ProfileEngine, string>());

/** The last sign-in window failure for an engine, or null. */
export function profileLastError(engine: ProfileEngine): string | null {
  return lastErrors.get(engine) ?? null;
}

export function profileDir(engine: ProfileEngine): string {
  return path.join(path.dirname(getDbPath()), "browser-profiles", engine);
}

export function readProfile(engine: ProfileEngine): ProfileMarker | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(profileDir(engine), MARKER_FILE), "utf8")) as ProfileMarker;
  } catch {
    return null;
  }
}

export function isProfileConnected(engine: ProfileEngine): boolean {
  return readProfile(engine) !== null;
}

export function getProfileStatuses(): ProfileStatus[] {
  return PROFILE_ENGINES.map((engine) => {
    const marker = readProfile(engine);
    return { engine, connected: marker !== null, connecting: connecting.has(engine), connectedAt: marker?.connectedAt ?? null, lastError: lastErrors.get(engine) ?? null };
  });
}

/** Chromium flags shared by the sign-in window and headless reuse of the same profile. */
export const PROFILE_ARGS = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];

/**
 * Opens a visible browser window on the engine's sign-in page and resolves once the user
 * closes it. The profile is marked connected only if the window was used (not on launch errors).
 */
export async function openSignInWindow(engine: ProfileEngine): Promise<void> {
  if (connecting.has(engine)) throw new Error(`A sign-in window for ${engine} is already open`);
  connecting.add(engine);
  try {
    const dir = profileDir(engine);
    // Profiles hold session cookies: owner-only access
    ensurePrivateDir(path.dirname(dir));
    ensurePrivateDir(dir);
    const context = await chromium.launchPersistentContext(dir, {
      headless: false,
      executablePath: getChromiumExecutablePath(),
      viewport: null,
      args: PROFILE_ARGS,
      // Without this flag Google refuses sign-in ("This browser or app may not be secure")
      ignoreDefaultArgs: ["--enable-automation"],
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(SIGN_IN_URLS[engine], { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    const userAgent = (await page.evaluate(() => navigator.userAgent).catch(() => "")) as string;
    await new Promise<void>((resolve) => context.on("close", () => resolve()));
    const marker: ProfileMarker = { engine, connectedAt: new Date().toISOString(), userAgent };
    fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify(marker, null, 2), { mode: PRIVATE_FILE_MODE });
    lastErrors.delete(engine);
  } catch (err) {
    lastErrors.set(engine, ((err as Error).message || String(err)).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 300));
    throw err;
  } finally {
    connecting.delete(engine);
  }
}

/** Deletes the saved profile (cookies and session) for an engine. */
export function removeProfile(engine: ProfileEngine): void {
  if (connecting.has(engine)) throw new Error(`Close the open ${engine} sign-in window first`);
  fs.rmSync(profileDir(engine), { recursive: true, force: true });
}

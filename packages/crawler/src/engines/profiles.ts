import { chromium, type BrowserContext } from "playwright";
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
 *
 * A profile only counts as connected when it holds the service's own session cookie (checked
 * while the window is open, again when it closes, and before each audit). Closing the window
 * without signing in, or a session that has expired, is reported as such, never as "connected".
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

/**
 * The cookie each service sets only for a signed-in account. ChatGPT and Perplexity use
 * NextAuth (the session token may be split into .0/.1 chunks); Google sets SID / __Secure-1PSID
 * for a signed-in Google account; Microsoft accounts set MSA auth cookies on login.live.com.
 * Visitor, consent, Cloudflare and sign-in-flow cookies (next-auth.state, pkce) do not count.
 */
const SESSION_RULES: Record<ProfileEngine, { domain: RegExp; name: RegExp; account: string }> = {
  // NextAuth (v4) and Auth.js (v5) name the session cookie differently
  chatgpt: { domain: /(^|\.)(chatgpt\.com|openai\.com)$/, name: /^(__Secure-)?(next-auth|authjs)\.session-token(\.\d+)?$/, account: "OpenAI account" },
  perplexity: { domain: /(^|\.)perplexity\.ai$/, name: /^(__Secure-)?(next-auth|authjs)\.session-token(\.\d+)?$/, account: "Perplexity account" },
  gemini: { domain: /(^|\.)google\.com$/, name: /^(__Secure-1PSID|__Secure-3PSID|SID)$/, account: "Google account" },
  google_aio: { domain: /(^|\.)google\.com$/, name: /^(__Secure-1PSID|__Secure-3PSID|SID)$/, account: "Google account" },
  copilot: { domain: /(^|\.)(live\.com|microsoft\.com|microsoftonline\.com)$/, name: /^(MSPAuth|__Host-MSAAUTHP|__Host-MSAAUTH|ESTSAUTHPERSISTENT)$/, account: "Microsoft account" },
};

export interface SessionCookie {
  name: string;
  domain: string;
  /** Unix seconds; -1 for a browser-session cookie. */
  expires: number;
}

/** Whether these cookies hold a live signed-in session for the engine's service. */
export function sessionFromCookies(engine: ProfileEngine, cookies: SessionCookie[], now = Date.now()): { signedIn: boolean; expiresAt: string | null } {
  const rule = SESSION_RULES[engine];
  const live = cookies.filter((c) => rule.domain.test(c.domain.replace(/^\./, "")) && rule.name.test(c.name) && (c.expires <= 0 || c.expires * 1000 > now));
  if (!live.length) return { signedIn: false, expiresAt: null };
  const expiring = live.filter((c) => c.expires > 0).map((c) => c.expires * 1000);
  return { signedIn: true, expiresAt: expiring.length ? new Date(Math.max(...expiring)).toISOString() : null };
}

interface ProfileMarker {
  engine: ProfileEngine;
  connectedAt: string;
  /** The real user agent of the window the user signed in with, reused headlessly. */
  userAgent: string;
  /** A signed-in session cookie was found (absent in markers written before verification existed). */
  signedIn?: boolean;
  verifiedAt?: string;
  /** When the session cookie expires, when it says so. */
  sessionExpiresAt?: string | null;
}

export type SessionState = "signed_in" | "not_signed_in" | "expired" | "checking" | "not_connected";

export interface ProfileStatus {
  engine: ProfileEngine;
  connected: boolean;
  connecting: boolean;
  connectedAt: string | null;
  state: SessionState;
  /** While the window is open: a signed-in session has been seen, so the window can be closed. */
  signedInDetected: boolean;
  sessionExpiresAt: string | null;
  verifiedAt: string | null;
  /** Why the last sign-in window failed, or why the profile is not connected; cleared on success. */
  lastError: string | null;
  /** Cookie names (never values) seen for the service when no sign-in was found, for diagnosing. */
  cookieNames: string[];
}

/**
 * Sites whose own session endpoint says who is signed in (NextAuth / Auth.js: /api/auth/session
 * returns the user only for a signed-in visitor). Asked from inside the open window, so it works
 * whatever the session cookie is called.
 */
const SESSION_ENDPOINTS: Partial<Record<ProfileEngine, string>> = {
  chatgpt: "https://chatgpt.com/api/auth/session",
  perplexity: "https://www.perplexity.ai/api/auth/session",
};

const MARKER_FILE = "prismgeo-profile.json";
const g = globalThis as typeof globalThis & {
  __prismProfileErrors?: Map<ProfileEngine, string>;
  __prismProfileConnecting?: Set<ProfileEngine>;
  __prismProfileDetected?: Set<ProfileEngine>;
  __prismProfileChecking?: Set<ProfileEngine>;
  __prismProfileCookieNames?: Map<ProfileEngine, string[]>;
};
const lastErrors = (g.__prismProfileErrors ??= new Map<ProfileEngine, string>());
const connecting = (g.__prismProfileConnecting ??= new Set<ProfileEngine>());
const detected = (g.__prismProfileDetected ??= new Set<ProfileEngine>());
const checking = (g.__prismProfileChecking ??= new Set<ProfileEngine>());
/** Names (never values) of the service's cookies when no sign-in was found, to diagnose cookie renames. */
const cookieNames = (g.__prismProfileCookieNames ??= new Map<ProfileEngine, string[]>());

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

function writeMarker(marker: ProfileMarker): void {
  fs.writeFileSync(path.join(profileDir(marker.engine), MARKER_FILE), JSON.stringify(marker, null, 2), { mode: PRIVATE_FILE_MODE });
}

const expired = (m: ProfileMarker, now = Date.now()) => Boolean(m.sessionExpiresAt && Date.parse(m.sessionExpiresAt) <= now);

/** True only for a verified, unexpired signed-in session (false for engines without sessions). */
export function isProfileConnected(engine: string): boolean {
  if (!(PROFILE_ENGINES as string[]).includes(engine)) return false;
  const m = readProfile(engine as ProfileEngine);
  return Boolean(m && m.signedIn === true && !expired(m));
}

function stateOf(engine: ProfileEngine, m: ProfileMarker | null): SessionState {
  if (!m) return "not_connected";
  if (m.signedIn === undefined) return "checking";
  if (!m.signedIn) return "not_signed_in";
  return expired(m) ? "expired" : "signed_in";
}

export function getProfileStatuses(): ProfileStatus[] {
  return PROFILE_ENGINES.map((engine) => {
    const marker = readProfile(engine);
    // Profiles saved before sign-in was verified are checked once, in the background
    if (marker && marker.signedIn === undefined && !checking.has(engine) && !connecting.has(engine)) {
      verifyProfile(engine).catch(() => null);
    }
    const state = stateOf(engine, marker);
    const reason =
      lastErrors.get(engine) ??
      (state === "not_signed_in"
        ? `No signed-in ${SESSION_RULES[engine].account} was found in the saved window. Connect again and sign in before closing it.`
        : state === "expired"
          ? `The ${SESSION_RULES[engine].account} session expired. Connect again to sign in.`
          : null);
    return {
      engine,
      connected: state === "signed_in",
      connecting: connecting.has(engine),
      connectedAt: marker?.connectedAt ?? null,
      state: checking.has(engine) ? "checking" : state,
      signedInDetected: detected.has(engine),
      sessionExpiresAt: marker?.sessionExpiresAt ?? null,
      verifiedAt: marker?.verifiedAt ?? null,
      lastError: reason,
      cookieNames: state === "signed_in" ? [] : (cookieNames.get(engine) ?? []),
    };
  });
}

async function readSession(context: BrowserContext, engine: ProfileEngine, opts: { askEndpoint?: boolean } = {}) {
  const cookies = (await context.cookies()) as SessionCookie[];
  const byCookie = sessionFromCookies(engine, cookies);
  if (byCookie.signedIn) {
    cookieNames.delete(engine);
    return byCookie;
  }
  const endpoint = SESSION_ENDPOINTS[engine];
  if (opts.askEndpoint && endpoint) {
    const origin = new URL(endpoint).origin;
    const page = context.pages().find((p) => {
      try {
        return new URL(p.url()).origin === origin;
      } catch {
        return false;
      }
    });
    if (page) {
      const signedIn = await page
        .evaluate(async (url) => {
          try {
            const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
            const j = r.ok ? await r.json() : null;
            return Boolean(j && typeof j === "object" && (j.user || j.account));
          } catch {
            return false;
          }
        }, endpoint)
        .catch(() => false);
      if (signedIn) {
        cookieNames.delete(engine);
        return { signedIn: true, expiresAt: null };
      }
    }
  }
  const rule = SESSION_RULES[engine];
  cookieNames.set(engine, [...new Set(cookies.filter((c) => rule.domain.test(c.domain.replace(/^\./, ""))).map((c) => c.name))].sort());
  return byCookie;
}

/** Cookie names (never values) seen for the service when no sign-in was found; for diagnosing. */
export function profileCookieNames(engine: ProfileEngine): string[] {
  return cookieNames.get(engine) ?? [];
}

/**
 * Re-checks a saved profile headlessly (no network: cookies are read from the profile on disk)
 * and records the result. Returns null when the profile cannot be opened right now (in use by
 * an audit or an open sign-in window); the saved state is then left as it was.
 */
export async function verifyProfile(engine: ProfileEngine): Promise<{ signedIn: boolean; expiresAt: string | null } | null> {
  const marker = readProfile(engine);
  if (!marker || connecting.has(engine) || checking.has(engine)) return null;
  checking.add(engine);
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir(engine), {
      headless: true,
      executablePath: getChromiumExecutablePath(),
      args: PROFILE_ARGS,
      ignoreDefaultArgs: ["--enable-automation"],
      userAgent: marker.userAgent?.replace("HeadlessChrome", "Chrome") || undefined,
    });
    let session = await readSession(context, engine);
    const endpoint = SESSION_ENDPOINTS[engine];
    if (!session.signedIn && endpoint) {
      // The cookie name may have changed: ask the site itself. If that cannot be done (offline,
      // a bot check), the result is inconclusive and the saved state is kept.
      const page = await context.newPage();
      const loaded = await page
        .goto(new URL(endpoint).origin, { waitUntil: "domcontentloaded", timeout: 30000 })
        .then((r) => Boolean(r && r.status() < 400))
        .catch(() => false);
      if (!loaded) return null;
      session = await readSession(context, engine, { askEndpoint: true });
    }
    writeMarker({ ...marker, signedIn: session.signedIn, sessionExpiresAt: session.expiresAt, verifiedAt: new Date().toISOString() });
    if (session.signedIn) lastErrors.delete(engine);
    return session;
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => null);
    checking.delete(engine);
  }
}

/** Chromium flags shared by the sign-in window and headless reuse of the same profile. */
export const PROFILE_ARGS = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];

/**
 * Opens a visible browser window on the engine's sign-in page and resolves once the user closes
 * it. While it is open the profile is watched for the service's session cookie, so the dashboard
 * can say "signed in, you can close the window"; after it closes the profile is verified again.
 * The profile counts as connected only if a signed-in session was found.
 */
export async function openSignInWindow(engine: ProfileEngine): Promise<{ signedIn: boolean }> {
  if (connecting.has(engine)) throw new Error(`A sign-in window for ${engine} is already open`);
  connecting.add(engine);
  detected.delete(engine);
  let poll: ReturnType<typeof setInterval> | null = null;
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
    let lastSeen = { signedIn: false, expiresAt: null as string | null };
    const check = async () => {
      try {
        lastSeen = await readSession(context, engine, { askEndpoint: true });
        if (lastSeen.signedIn) detected.add(engine);
        else detected.delete(engine);
      } catch {
        // the window is closing
      }
    };
    await check();
    poll = setInterval(check, 2000);
    await new Promise<void>((resolve) => context.on("close", () => resolve()));
    clearInterval(poll);
    poll = null;

    const previous = readProfile(engine);
    writeMarker({
      engine,
      connectedAt: lastSeen.signedIn ? new Date().toISOString() : previous?.connectedAt || new Date().toISOString(),
      userAgent,
      signedIn: lastSeen.signedIn,
      sessionExpiresAt: lastSeen.expiresAt,
      verifiedAt: new Date().toISOString(),
    });
    connecting.delete(engine);
    // The cookies are on disk now; confirm from there (also catches a sign-in in the last seconds)
    const confirmed = (await verifyProfile(engine)) ?? lastSeen;
    if (confirmed.signedIn) lastErrors.delete(engine);
    else lastErrors.set(engine, `The window was closed without a signed-in ${SESSION_RULES[engine].account}. Connect again and sign in before closing it.`);
    return { signedIn: confirmed.signedIn };
  } catch (err) {
    lastErrors.set(engine, ((err as Error).message || String(err)).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 300));
    throw err;
  } finally {
    if (poll) clearInterval(poll);
    connecting.delete(engine);
    detected.delete(engine);
  }
}

/** Deletes the saved profile (cookies and session) for an engine. */
export function removeProfile(engine: ProfileEngine): void {
  if (connecting.has(engine)) throw new Error(`Close the open ${engine} sign-in window first`);
  fs.rmSync(profileDir(engine), { recursive: true, force: true });
  lastErrors.delete(engine);
}

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
  /** Account id within the engine ("default" for the first account). */
  account?: string;
  /** What this account stands for, e.g. "US founder", "UK ecom manager". */
  label?: string;
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
  account: string;
  label: string | null;
  /** The account audits use for this engine now (the first one with a verified session). */
  active: boolean;
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
/*
 * Several accounts per engine are supported, as labelled personas ("US founder", "UK ecom
 * manager"): each is its own profile with its own verified session. Audits use the first account
 * whose session is valid; an expired or signed-out account is skipped. A usage limit or block is
 * never worked around by switching accounts: it is recorded and cooled down like any block.
 */
export const DEFAULT_ACCOUNT = "default";
const keyOf = (engine: ProfileEngine, account: string) => (account === DEFAULT_ACCOUNT ? engine : `${engine}@${account}`);

const g = globalThis as typeof globalThis & {
  __prismProfileErrors?: Map<string, string>;
  __prismProfileConnecting?: Set<string>;
  __prismProfileDetected?: Set<string>;
  __prismProfileChecking?: Set<string>;
  __prismProfileCookieNames?: Map<string, string[]>;
};
// Keyed by "engine" (default account) or "engine@account"
const lastErrors = (g.__prismProfileErrors ??= new Map<string, string>());
const connecting = (g.__prismProfileConnecting ??= new Set<string>());
const detected = (g.__prismProfileDetected ??= new Set<string>());
const checking = (g.__prismProfileChecking ??= new Set<string>());
/** Names (never values) of the service's cookies when no sign-in was found, to diagnose cookie renames. */
const cookieNames = (g.__prismProfileCookieNames ??= new Map<string, string[]>());

/** An account id from a label: "UK ecom manager" → "uk-ecom-manager". */
export function accountIdFrom(label: string): string {
  const id = (label || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return id || DEFAULT_ACCOUNT;
}

/** The last sign-in window failure for an account, or null. */
export function profileLastError(engine: ProfileEngine, account = DEFAULT_ACCOUNT): string | null {
  return lastErrors.get(keyOf(engine, account)) ?? null;
}

const profilesRoot = () => path.join(path.dirname(getDbPath()), "browser-profiles");

export function profileDir(engine: ProfileEngine, account = DEFAULT_ACCOUNT): string {
  return path.join(profilesRoot(), keyOf(engine, account));
}

/** The engine's saved accounts: the default one first, then the others by name. */
export function listAccounts(engine: ProfileEngine): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(profilesRoot());
  } catch {
    return [];
  }
  const others = names.filter((n) => n.startsWith(`${engine}@`)).map((n) => n.slice(engine.length + 1)).sort();
  return [...(names.includes(engine) ? [DEFAULT_ACCOUNT] : []), ...others];
}

export function readProfile(engine: ProfileEngine, account = DEFAULT_ACCOUNT): ProfileMarker | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(profileDir(engine, account), MARKER_FILE), "utf8")) as ProfileMarker;
  } catch {
    return null;
  }
}

function writeMarker(marker: ProfileMarker): void {
  const account = marker.account || DEFAULT_ACCOUNT;
  fs.writeFileSync(path.join(profileDir(marker.engine, account), MARKER_FILE), JSON.stringify({ ...marker, account }, null, 2), { mode: PRIVATE_FILE_MODE });
}

const expired = (m: ProfileMarker, now = Date.now()) => Boolean(m.sessionExpiresAt && Date.parse(m.sessionExpiresAt) <= now);
const valid = (m: ProfileMarker | null) => Boolean(m && m.signedIn === true && !expired(m));

/** The account audits use for an engine: the first with a verified, unexpired session, or null. */
export function activeAccount(engine: string): string | null {
  if (!(PROFILE_ENGINES as string[]).includes(engine)) return null;
  return listAccounts(engine as ProfileEngine).find((a) => valid(readProfile(engine as ProfileEngine, a))) ?? null;
}

/** The label of the account in use, for provenance ("default" when unlabelled). */
export function activeAccountLabel(engine: string): string | null {
  const account = activeAccount(engine);
  if (!account) return null;
  return readProfile(engine as ProfileEngine, account)?.label || account;
}

/** True when the engine has at least one verified, unexpired signed-in account. */
export function isProfileConnected(engine: string): boolean {
  return activeAccount(engine) !== null;
}

function stateOf(m: ProfileMarker | null): SessionState {
  if (!m) return "not_connected";
  if (m.signedIn === undefined) return "checking";
  if (!m.signedIn) return "not_signed_in";
  return expired(m) ? "expired" : "signed_in";
}

export function getProfileStatuses(): ProfileStatus[] {
  return PROFILE_ENGINES.flatMap((engine) => {
    const accounts = listAccounts(engine);
    const active = activeAccount(engine);
    return (accounts.length ? accounts : [DEFAULT_ACCOUNT]).map((account) => {
      const key = keyOf(engine, account);
      const marker = readProfile(engine, account);
      // Profiles saved before sign-in was verified are checked once, in the background
      if (marker && marker.signedIn === undefined && !checking.has(key) && !connecting.has(key)) {
        verifyProfile(engine, account).catch(() => null);
      }
      const state = stateOf(marker);
      const reason =
        lastErrors.get(key) ??
        (state === "not_signed_in"
          ? `No signed-in ${SESSION_RULES[engine].account} was found in the saved window. Connect again and sign in before closing it.`
          : state === "expired"
            ? `The ${SESSION_RULES[engine].account} session expired. Connect again to sign in.`
            : null);
      return {
        engine,
        account,
        label: marker?.label ?? null,
        active: account === active,
        connected: state === "signed_in",
        connecting: connecting.has(key),
        connectedAt: marker?.connectedAt ?? null,
        state: checking.has(key) ? "checking" : state,
        signedInDetected: detected.has(key),
        sessionExpiresAt: marker?.sessionExpiresAt ?? null,
        verifiedAt: marker?.verifiedAt ?? null,
        lastError: reason,
        cookieNames: state === "signed_in" ? [] : (cookieNames.get(key) ?? []),
      };
    });
  });
}

async function readSession(context: BrowserContext, engine: ProfileEngine, opts: { askEndpoint?: boolean; key?: string } = {}) {
  const key = opts.key ?? engine;
  const cookies = (await context.cookies()) as SessionCookie[];
  const byCookie = sessionFromCookies(engine, cookies);
  if (byCookie.signedIn) {
    cookieNames.delete(key);
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
        cookieNames.delete(key);
        return { signedIn: true, expiresAt: null };
      }
    }
  }
  const rule = SESSION_RULES[engine];
  cookieNames.set(key, [...new Set(cookies.filter((c) => rule.domain.test(c.domain.replace(/^\./, ""))).map((c) => c.name))].sort());
  return byCookie;
}

/** Cookie names (never values) seen for the service when no sign-in was found; for diagnosing. */
export function profileCookieNames(engine: ProfileEngine, account = DEFAULT_ACCOUNT): string[] {
  return cookieNames.get(keyOf(engine, account)) ?? [];
}

/**
 * Re-checks a saved profile headlessly (no network: cookies are read from the profile on disk)
 * and records the result. Returns null when the profile cannot be opened right now (in use by
 * an audit or an open sign-in window); the saved state is then left as it was.
 */
export async function verifyProfile(engine: ProfileEngine, account = DEFAULT_ACCOUNT): Promise<{ signedIn: boolean; expiresAt: string | null } | null> {
  const key = keyOf(engine, account);
  const marker = readProfile(engine, account);
  if (!marker || connecting.has(key) || checking.has(key)) return null;
  checking.add(key);
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir(engine, account), {
      headless: true,
      executablePath: getChromiumExecutablePath(),
      args: PROFILE_ARGS,
      ignoreDefaultArgs: ["--enable-automation"],
      userAgent: marker.userAgent?.replace("HeadlessChrome", "Chrome") || undefined,
    });
    let session = await readSession(context, engine, { key });
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
      session = await readSession(context, engine, { askEndpoint: true, key });
    }
    writeMarker({ ...marker, account, signedIn: session.signedIn, sessionExpiresAt: session.expiresAt, verifiedAt: new Date().toISOString() });
    if (session.signedIn) lastErrors.delete(key);
    return session;
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => null);
    checking.delete(key);
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
export async function openSignInWindow(engine: ProfileEngine, account = DEFAULT_ACCOUNT, label?: string): Promise<{ signedIn: boolean }> {
  const key = keyOf(engine, account);
  if (connecting.has(key)) throw new Error(`A sign-in window for ${engine} (${account}) is already open`);
  connecting.add(key);
  detected.delete(key);
  let poll: ReturnType<typeof setInterval> | null = null;
  try {
    const dir = profileDir(engine, account);
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
        lastSeen = await readSession(context, engine, { askEndpoint: true, key });
        if (lastSeen.signedIn) detected.add(key);
        else detected.delete(key);
      } catch {
        // the window is closing
      }
    };
    await check();
    poll = setInterval(check, 2000);
    await new Promise<void>((resolve) => context.on("close", () => resolve()));
    clearInterval(poll);
    poll = null;

    const previous = readProfile(engine, account);
    writeMarker({
      engine,
      account,
      label: label?.trim() || previous?.label || undefined,
      connectedAt: lastSeen.signedIn ? new Date().toISOString() : previous?.connectedAt || new Date().toISOString(),
      userAgent,
      signedIn: lastSeen.signedIn,
      sessionExpiresAt: lastSeen.expiresAt,
      verifiedAt: new Date().toISOString(),
    });
    connecting.delete(key);
    // The cookies are on disk now; confirm from there (also catches a sign-in in the last seconds)
    const confirmed = (await verifyProfile(engine, account)) ?? lastSeen;
    if (confirmed.signedIn) lastErrors.delete(key);
    else lastErrors.set(key, `The window was closed without a signed-in ${SESSION_RULES[engine].account}. Connect again and sign in before closing it.`);
    return { signedIn: confirmed.signedIn };
  } catch (err) {
    lastErrors.set(key, ((err as Error).message || String(err)).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 300));
    throw err;
  } finally {
    if (poll) clearInterval(poll);
    connecting.delete(key);
    detected.delete(key);
  }
}

/** Deletes the saved profile (cookies and session) for one account of an engine. */
export function removeProfile(engine: ProfileEngine, account = DEFAULT_ACCOUNT): void {
  const key = keyOf(engine, account);
  if (connecting.has(key)) throw new Error(`Close the open ${engine} sign-in window first`);
  fs.rmSync(profileDir(engine, account), { recursive: true, force: true });
  lastErrors.delete(key);
}

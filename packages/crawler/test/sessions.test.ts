import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway data directory; never the repo's data/ (profiles live next to the database)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-sessions-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");

const { sessionFromCookies, verifyProfile, isProfileConnected, getProfileStatuses, profileDir, activeAccount, activeAccountLabel, listAccounts, accountIdFrom } = await import("../src/engines/profiles");
const { chromium } = await import("playwright");

const now = Date.parse("2026-10-30T00:00:00Z");
const future = now / 1000 + 86_400 * 30;
const past = now / 1000 - 60;

test("a session counts only with the service's own sign-in cookie, unexpired", () => {
  // What a window closed without signing in leaves behind (seen live): visitor, Cloudflare and sign-in-flow cookies
  const visitor = [
    { name: "pplx.visitor-id", domain: "www.perplexity.ai", expires: future },
    { name: "cf_clearance", domain: ".perplexity.ai", expires: future },
    { name: "next-auth.state", domain: "www.perplexity.ai", expires: future },
    { name: "next-auth.pkce.code_verifier", domain: "www.perplexity.ai", expires: future },
    { name: "NID", domain: ".google.com", expires: future },
  ];
  assert.equal(sessionFromCookies("perplexity", visitor, now).signedIn, false);
  assert.equal(sessionFromCookies("gemini", visitor, now).signedIn, false);
  assert.equal(sessionFromCookies("perplexity", [...visitor, { name: "__Secure-next-auth.session-token", domain: "www.perplexity.ai", expires: future }], now).signedIn, true);
  assert.equal(sessionFromCookies("chatgpt", [{ name: "__Secure-next-auth.session-token.0", domain: "chatgpt.com", expires: future }], now).signedIn, true, "chunked token");
  assert.equal(sessionFromCookies("perplexity", [{ name: "__Secure-authjs.session-token", domain: "www.perplexity.ai", expires: future }], now).signedIn, true, "Auth.js v5 name");
  assert.equal(sessionFromCookies("gemini", [{ name: "__Secure-1PSID", domain: ".google.com", expires: future }], now).signedIn, true);
  assert.equal(sessionFromCookies("google_aio", [{ name: "SID", domain: ".google.com", expires: past }], now).signedIn, false, "expired");
  assert.equal(sessionFromCookies("chatgpt", [{ name: "__Secure-next-auth.session-token", domain: "www.perplexity.ai", expires: future }], now).signedIn, false, "another service's cookie");
  assert.equal(sessionFromCookies("copilot", [{ name: "__Host-MSAAUTHP", domain: "login.live.com", expires: future }], now).signedIn, true);
  assert.equal(sessionFromCookies("gemini", [{ name: "SID", domain: ".google.com", expires: future }], now).expiresAt, new Date(future * 1000).toISOString());
});

/** Writes cookies into a real Chromium profile, as a sign-in window would leave it. */
async function profileWith(engine: "google_aio" | "gemini", cookies: Array<{ name: string; domain: string; expires: number }>, account = "default", label?: string) {
  const dir = profileDir(engine, account);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true });
  await ctx.addCookies(cookies.map((c) => ({ ...c, value: "test", path: "/", secure: true, sameSite: "Lax" as const })));
  await ctx.close();
  // A marker as written by older versions (before sign-in was verified)
  fs.writeFileSync(path.join(dir, "prismgeo-profile.json"), JSON.stringify({ engine, account, label, connectedAt: new Date().toISOString(), userAgent: "" }));
}

let browserAvailable = true;
try {
  const b = await chromium.launch();
  await b.close();
} catch {
  browserAvailable = false;
}

test("an unverified saved profile is checked from disk: no sign-in → not connected; a real session cookie → connected", { skip: !browserAvailable && "no Chromium installed" }, async () => {
  const soon = Date.now() / 1000 + 86_400 * 30;
  // Google has no session endpoint, so this check reads cookies only (no network in tests)
  await profileWith("google_aio", [{ name: "NID", domain: ".google.com", expires: soon }]);
  assert.equal(isProfileConnected("google_aio"), false, "an unverified marker is not trusted");
  assert.deepEqual(await verifyProfile("google_aio"), { signedIn: false, expiresAt: null });
  const status = getProfileStatuses().find((s) => s.engine === "google_aio")!;
  assert.equal(status.state, "not_signed_in");
  assert.equal(status.connected, false);
  assert.match(status.lastError || "", /sign in before closing/);
  assert.deepEqual(status.cookieNames, ["NID"], "cookie names (never values) explain what was found");

  await profileWith("gemini", [{ name: "__Secure-1PSID", domain: ".google.com", expires: soon }]);
  const g = await verifyProfile("gemini");
  assert.equal(g?.signedIn, true);
  assert.equal(isProfileConnected("gemini"), true);
  assert.equal(getProfileStatuses().find((s) => s.engine === "gemini")!.state, "signed_in");
});

test("several labelled accounts per engine: audits use the first one with a valid session", { skip: !browserAvailable && "no Chromium installed" }, async () => {
  const soon = Date.now() / 1000 + 86_400 * 30;
  assert.equal(accountIdFrom("UK ecom manager!"), "uk-ecom-manager");
  // google_aio default account is not signed in (from the previous test); add a signed-in persona
  await profileWith("google_aio", [{ name: "__Secure-1PSID", domain: ".google.com", expires: soon }], "uk-founder", "UK founder");
  await verifyProfile("google_aio", "uk-founder");
  assert.deepEqual(listAccounts("google_aio"), ["default", "uk-founder"]);
  assert.equal(activeAccount("google_aio"), "uk-founder", "the account without a session is skipped");
  assert.equal(activeAccountLabel("google_aio"), "UK founder");
  assert.equal(isProfileConnected("google_aio"), true);
  const rows = getProfileStatuses().filter((s) => s.engine === "google_aio");
  assert.deepEqual(rows.map((r) => [r.account, r.state, r.active]), [["default", "not_signed_in", false], ["uk-founder", "signed_in", true]]);
  // A second valid account is not used while the first valid one works (no rotation)
  await profileWith("google_aio", [{ name: "SID", domain: ".google.com", expires: soon }], "us-cmo", "US CMO");
  await verifyProfile("google_aio", "us-cmo");
  assert.equal(activeAccount("google_aio"), "uk-founder");
});

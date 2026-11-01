import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-blocks-")), "test.db");
const { assertNotBlocked, EngineBlockedError } = await import("../src/engines/browser-session");
const { classifyFailure } = await import("../src/queue/crawler-orchestrator");
const { withProfileLock, tryProfileLock, profileLocked, ProfileInUseError } = await import("../src/engines/profiles");
const { nextClearState, CLEAN_READINGS_NEEDED } = await import("../src/engines/check-window");

/** Just enough of a Playwright page for assertNotBlocked. */
const pageWith = (text: string, challenge = false, answerShown = false) =>
  // evaluate(fn) reads the page text; evaluate(fn, selector) asks whether a human check is shown;
  // evaluate(fn, { answerSel }) asks whether the engine's answer is on screen
  ({
    evaluate: async (_fn: unknown, arg?: unknown) => (arg === undefined ? text : typeof arg === "string" ? challenge : answerShown),
  }) as unknown as Parameters<typeof assertNotBlocked>[0];

test("a free account's usage-limit dialog is a block, not a missing answer", async () => {
  // The dialog follows a long sidebar of recent threads (seen live on Perplexity)
  const sidebar = "Recents\n" + "an earlier question about abandoned carts\n".repeat(120);
  const page = pageWith(`${sidebar}You've reached your free search limit\nYour access will reset in a few hours. Upgrade to Perplexity Pro.`);
  await assert.rejects(assertNotBlocked(page, "PerplexityCrawler"), (err: Error) => err instanceof EngineBlockedError && /usage limit/.test(err.message));
});

test("an answer that discusses limits is not mistaken for a block", async () => {
  await assertNotBlocked(pageWith("Most SMS tools have a free plan limit of 100 messages; the search limit on APIs varies."), "PerplexityCrawler");
});

test("a Cloudflare 'verify you are human' check drawn in its own frame is a block", async () => {
  // The page text is empty: the check's words live inside Cloudflare's frame (seen live on ChatGPT)
  await assert.rejects(assertNotBlocked(pageWith("", true), "ChatGptCrawler"), (err: Error) => err instanceof EngineBlockedError && /verify you are human/.test(err.message));
});

test("an answer about captchas is not a block once the answer is on screen", async () => {
  const text = "Best CAPTCHA tools for 2026: hCaptcha, reCAPTCHA and Turnstile. Just a moment of setup each; they flag unusual activity.";
  // Without an answer on screen the same words are still a block (a check page)
  await assert.rejects(assertNotBlocked(pageWith(text), "PerplexityCrawler", ".prose"), EngineBlockedError);
  await assertNotBlocked(pageWith(text, false, true), "PerplexityCrawler", ".prose");
  // The check's own markup and an account's usage limit are still caught with an answer on screen
  await assert.rejects(assertNotBlocked(pageWith(text, true, true), "ChatGptCrawler", ".x"), /verify you are human/);
  await assert.rejects(assertNotBlocked(pageWith(`${text}\nYou've reached your free search limit`, false, true), "PerplexityCrawler", ".prose"), /usage limit/);
});

test("Chromium refusing a profile another browser holds is a passing error, not a missing browser", () => {
  const err = new Error(
    "browserType.launchPersistentContext: Failed to launch the browser process!\n[pid=1][err] The profile appears to be in use by another Chromium process (ProcessSingleton)"
  );
  assert.equal(classifyFailure("chatgpt", "p", err).kind, "error");
  assert.equal(classifyFailure("chatgpt", "p", new ProfileInUseError("The saved browser profile chatgpt is already in use")).kind, "error");
  assert.equal(classifyFailure("chatgpt", "p", new Error("browserType.launch: Executable doesn't exist at /x")).kind, "setup");
});

test("a profile folder is opened by one thing at a time; a session check never waits for it", async () => {
  const dir = path.join(os.tmpdir(), "prismgeo-lock-test");
  const order: string[] = [];
  let release!: () => void;
  const first = withProfileLock(dir, () => new Promise<void>((r) => (release = () => (order.push("first"), r()))));
  const second = withProfileLock(dir, async () => void order.push("second"));
  assert.equal(profileLocked(dir), true);
  assert.deepEqual(await tryProfileLock(dir, async () => "ran"), { ran: false }, "a busy folder is skipped, not waited for");
  await assert.rejects(withProfileLock(dir, async () => null, { waitMs: 10 }), ProfileInUseError);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(profileLocked(dir), false);
  assert.deepEqual(await tryProfileLock(dir, async () => "ran"), { ran: true, value: "ran" });
});

test("a check window counts as cleared only after three clean readings following a successful load", () => {
  let s = { cleanStreak: 0, sawCheck: false, cleared: false };
  s = nextClearState(s, { loaded: true, shown: true });
  assert.equal(s.sawCheck, true);
  // The widget is still drawing: one clean reading flickers in, then the check is back
  s = nextClearState(s, { loaded: true, shown: false });
  assert.equal(s.cleared, false);
  s = nextClearState(s, { loaded: true, shown: true });
  for (let i = 0; i < CLEAN_READINGS_NEEDED - 1; i++) s = nextClearState(s, { loaded: true, shown: false });
  assert.equal(s.cleared, false);
  s = nextClearState(s, { loaded: true, shown: null });
  assert.equal(s.cleared, false, "an unreadable page keeps the last state");
  s = nextClearState(s, { loaded: true, shown: false });
  assert.equal(s.cleared, true);
  // An error page (failed load) is never "cleared"
  let e = { cleanStreak: 0, sawCheck: false, cleared: false };
  for (let i = 0; i < 5; i++) e = nextClearState(e, { loaded: false, shown: false });
  assert.equal(e.cleared, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRealAnswer, cleanCitationUrl, EngineBlockedError, waitForStableAnswer, AnswerNotFinishedError } from "../src/engines/browser-session";
import { AIO_PENDING, AIO_APPEAR_TIMEOUT_MS } from "../src/engines/google-aio";
import { apiKeyFor } from "../src/engines/api-engines";
import { classifyFailure } from "../src/queue/crawler-orchestrator";
import { REPLIES } from "../../core/test/fixtures";

const answer = "Here are three ways to recover abandoned checkouts without discounts: fix shipping surprises, add express pay, and follow up by phone.";

test("real answers pass, engine error and throttle replies are rejected", () => {
  assert.doesNotThrow(() => assertRealAnswer(answer, "t", "q"));
  assert.throws(() => assertRealAnswer("Sorry, something went wrong. Please try again later and see if it works.", "t", "q"), /engine error/);
  assert.throws(() => assertRealAnswer("I'm having a hard time fulfilling your request. Can I help you with something else instead?", "t", "q"), EngineBlockedError);
  assert.throws(() => assertRealAnswer("Too short", "t", "q"), /No extractable response/);
});

test("known error, limit and abuse-check replies are classified; real answers that look similar are stored", () => {
  for (const r of REPLIES) {
    let verdict: "blocked" | "error" | "store" = "store";
    try {
      assertRealAnswer(r.text, "t", "q");
    } catch (err) {
      verdict = err instanceof EngineBlockedError ? "blocked" : "error";
    }
    assert.equal(verdict, r.verdict, r.text);
  }
  // the patterns only apply to short replies: a long answer that discusses rate limits is an answer
  const long = `Rate limit handling matters for voice agents. ${"Calls are queued and retried with backoff so no shopper is called twice. ".repeat(8)}`;
  assert.doesNotThrow(() => assertRealAnswer(long, "t", "q"));
});

test("failure classification: network, setup, unfinished answers", () => {
  assert.equal(classifyFailure("chatgpt", "p", new Error("fetch failed")).kind, "network");
  assert.equal(classifyFailure("chatgpt", "p", Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } })).kind, "network");
  assert.equal(classifyFailure("chatgpt", "p", new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://x")).kind, "network");
  assert.equal(classifyFailure("chatgpt", "p", new Error("browserType.launch: Executable doesn't exist at /x/chrome")).kind, "setup");
  assert.equal(classifyFailure("chatgpt", "p", new AnswerNotFinishedError("No extractable response: answer did not finish streaming within 1 s")).kind, "no_answer");
  assert.equal(classifyFailure("chatgpt", "p", new EngineBlockedError("blocked")).kind, "blocked");
});

/** A fake page whose answer text keeps changing (still streaming) or settles after a few polls. */
function streamingPage(texts: string[]) {
  let i = 0;
  return {
    evaluate: async () => texts[Math.min(i++, texts.length - 1)],
    waitForTimeout: async (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
  } as any;
}

test("a truncated (still streaming) answer is never returned as complete", async () => {
  const growing = Array.from({ length: 10_000 }, (_, k) => `Answer part ${"x".repeat(60)} ${k}`);
  await assert.rejects(() => waitForStableAnswer(streamingPage(growing), "#a", { timeoutMs: 120, stableMs: 50 }), AnswerNotFinishedError);
  const settled = ["", "partial", `${"Final answer text that is long enough. ".repeat(3)}`];
  assert.equal(await waitForStableAnswer(streamingPage(settled), "#a", { timeoutMs: 5000, stableMs: 20 }), true);
  assert.equal(await waitForStableAnswer(streamingPage([""]), "#a", { timeoutMs: 60, stableMs: 20 }), false);
});

test("AI Overview waits up to 25 s and treats placeholders as pending", () => {
  assert.equal(AIO_APPEAR_TIMEOUT_MS, 25000);
  for (const t of ["Thinking a little longer…", "AI Overview\nGenerating", "Searching", "Looking for results"]) assert.ok(AIO_PENDING.test(t), t);
  assert.ok(!AIO_PENDING.test("AI voice agents call shoppers who abandon checkout."));
});

test("tracking parameters are stripped from cited URLs", () => {
  assert.equal(cleanCitationUrl("https://a.com/p?utm_source=chatgpt.com&id=7&srsltid=x&gclid=y"), "https://a.com/p?id=7");
  assert.equal(cleanCitationUrl("not a url"), "not a url");
});

test("each API engine uses its own key", () => {
  const keys = { gemini: " g ", openai: "o", perplexity: "", serpapi: "s" };
  assert.equal(apiKeyFor("gemini", keys), "g");
  assert.equal(apiKeyFor("chatgpt", keys), "o");
  assert.equal(apiKeyFor("perplexity", keys), "");
  assert.equal(apiKeyFor("google_aio", keys), "s");
  assert.equal(apiKeyFor("copilot", keys), "");
});

test("failure snapshots are capped by count and age", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pruneSnapshots } = await import("../src/engines/browser-session");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-snap-"));
  for (let i = 0; i < 310; i++) fs.writeFileSync(path.join(dir, `2026-10-28T10-00-${String(i).padStart(3, "0")}-X.png`), "");
  const old = path.join(dir, "2026-10-28T10-00-999-old.html");
  fs.writeFileSync(old, "");
  const monthAgo = (Date.now() - 30 * 86_400_000) / 1000;
  fs.utimesSync(old, monthAgo, monthAgo);
  pruneSnapshots(dir);
  const left = fs.readdirSync(dir);
  assert.equal(left.includes("2026-10-28T10-00-999-old.html"), false);
  assert.ok(left.length <= 300);
  assert.equal(left.includes("2026-10-28T10-00-000-X.png"), false); // oldest names go first
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRealAnswer, cleanCitationUrl, EngineBlockedError } from "../src/engines/browser-session";
import { apiKeyFor } from "../src/engines/api-engines";

const answer = "Here are three ways to recover abandoned checkouts without discounts: fix shipping surprises, add express pay, and follow up by phone.";

test("real answers pass, engine error and throttle replies are rejected", () => {
  assert.doesNotThrow(() => assertRealAnswer(answer, "t", "q"));
  assert.throws(() => assertRealAnswer("Sorry, something went wrong. Please try again later and see if it works.", "t", "q"), /engine error/);
  assert.throws(() => assertRealAnswer("I'm having a hard time fulfilling your request. Can I help you with something else instead?", "t", "q"), EngineBlockedError);
  assert.throws(() => assertRealAnswer("Too short", "t", "q"), /No extractable response/);
});

test("tracking parameters are stripped from cited URLs", () => {
  assert.equal(cleanCitationUrl("https://a.com/p?utm_source=chatgpt.com&id=7&srsltid=x"), "https://a.com/p?id=7");
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

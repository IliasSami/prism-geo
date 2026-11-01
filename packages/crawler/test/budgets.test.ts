import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-budgets-")), "data", "test.db");

const { getRawDb, setSettings } = await import("@prismgeo/db");
const { budgetExhausted, enginePolicy } = await import("../src/engines/budgets");

const sqlite = getRawDb();
sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'acme', 'Acme', 'acme.example', '[]')").run();
sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active) VALUES ('p1', 'b1', 'q', 'category', 1)").run();
const now = Date.parse("2026-11-02T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const answer = sqlite.prepare("INSERT INTO prompt_runs (id, brand_id, batch_id, prompt_id, engine, run_index, response_text, capture_method, created_at) VALUES (?, 'b1', 'b', 'p1', ?, 0, 'x', ?, ?)");
const batch = sqlite.prepare("INSERT INTO crawl_batches (id, brand_id, status, created_at, errors_json) VALUES (?, 'b1', 'completed', ?, ?)");
batch.run("b", ago(60 * 48), "[]");

test("Google gets at most 8 browser searches an hour; paid captures and other engines do not count", () => {
  for (let i = 0; i < 7; i++) answer.run(`g${i}`, "google_aio", "browser_signed_in", ago(10 + i));
  answer.run("api", "google_aio", "provider", ago(5));
  answer.run("gem", "gemini", "browser", ago(5));
  assert.equal(budgetExhausted("google_aio", true, now), null, "7 of 8 used");
  // A blocked search reached Google too, so it counts
  batch.run("b-fail", ago(3), JSON.stringify([{ engine: "google_aio", promptId: "p1", kind: "blocked", message: "x", at: ago(3) }, { engine: "google_aio", promptId: "p1", kind: "cooling_down", message: "not run", at: ago(3) }]));
  assert.deepEqual(budgetExhausted("google_aio", true, now), { window: "hour", used: 8, limit: 8 });
  assert.equal(budgetExhausted("gemini", false, now), null);
});

test("the daily cap counts the last 24 hours; logged-out Perplexity is capped hardest", () => {
  for (let i = 0; i < 10; i++) answer.run(`p${i}`, "perplexity", "browser", ago(120 + i * 60));
  assert.deepEqual(budgetExhausted("perplexity", false, now), { window: "day", used: 10, limit: 10 });
  assert.equal(budgetExhausted("perplexity", false, now + 24 * 3_600_000), null, "a day later the budget is back");
});

test("fast pacing has no caps and short pauses", () => {
  setSettings("crawler_settings", { pacing: "fast" });
  assert.equal(budgetExhausted("google_aio", true, now), null);
  assert.deepEqual(enginePolicy("google_aio", true).delay, [15, 30]);
  setSettings("crawler_settings", {});
  assert.deepEqual(enginePolicy("google_aio", true).delay, [120, 300]);
});

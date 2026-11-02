import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-gaps-")), "data", "test.db");
process.env.PRISMGEO_CONNECTION_COUNTRY = "us";

const { getRawDb, setSettings } = await import("@prismgeo/db");
const { unansweredPromptIdsByEngine } = await import("../src/queue/scheduler");
const { CrawlerOrchestrator, classifyFailure, configureCitedPageFetch } = await import("../src/queue/crawler-orchestrator");
const { QuestionNotSentError } = await import("../src/engines/browser-session");
const { CopilotEngineCrawler } = await import("../src/engines/copilot");
const playwright = await import("playwright");

(playwright.chromium as any).launch = async () => {
  throw new Error("test harness: browser disabled");
};
configureCitedPageFetch(async () => "");
const sqlite = getRawDb();
setSettings("engine_settings", { mode: "stealth" });
sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'acme', 'Acme', 'acme.example', '[]')").run();
for (const [id, active] of [["p1", 1], ["p2", 1], ["p3", 1], ["p4", 0]] as const) {
  sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active, created_at) VALUES (?, 'b1', ?, 'category', ?, ?)").run(id, `question ${id}`, active, `2026-01-0${id.slice(1)}T00:00:00.000Z`);
}
sqlite.prepare("INSERT INTO crawl_batches (id, brand_id, status, created_at) VALUES ('old', 'b1', 'completed', '2026-01-01T00:00:00.000Z')").run();
const answered = sqlite.prepare("INSERT INTO prompt_runs (id, brand_id, batch_id, prompt_id, engine, run_index, response_text, capture_method, created_at) VALUES (?, 'b1', 'old', ?, ?, 0, 'an answer', 'browser', '2026-01-01T00:00:00.000Z')");
answered.run("r1", "p1", "gemini");
answered.run("r2", "p2", "gemini");
answered.run("r3", "p1", "chatgpt");

test("fill the gaps: each engine gets only the active questions it never answered, oldest first", () => {
  const gaps = unansweredPromptIdsByEngine("b1", ["gemini", "chatgpt", "perplexity"]);
  assert.deepEqual(gaps.gemini, ["p3"]);
  assert.deepEqual(gaps.chatgpt, ["p2", "p3"]);
  assert.deepEqual(gaps.perplexity, ["p1", "p2", "p3"], "paused questions are never gaps");
  assert.deepEqual(unansweredPromptIdsByEngine("b1", ["perplexity"], 2).perplexity, ["p1", "p2"], "the limit caps each engine");
});

test("no AI Overview counts as covered; recently failed questions go to the back", () => {
  sqlite
    .prepare("INSERT INTO crawl_batches (id, brand_id, status, created_at, errors_json) VALUES ('fb', 'b1', 'completed', ?, ?)")
    .run(new Date().toISOString(), JSON.stringify([
      { engine: "google_aio", promptId: "p1", kind: "no_ai_overview", message: "x" },
      { engine: "google_aio", promptId: "p2", kind: "blocked", message: "x" },
    ]));
  assert.deepEqual(unansweredPromptIdsByEngine("b1", ["google_aio"]).google_aio, ["p3", "p2"]);
});

test("a question the engine's page did not accept is its own reason, and the engine stops after two in a row", async () => {
  assert.equal(classifyFailure("copilot", "p1", new QuestionNotSentError("[CopilotCrawler] not accepted")).kind, "not_accepted");
  let asked = 0;
  Object.defineProperty(CopilotEngineCrawler, "available", { get: () => true, configurable: true });
  (CopilotEngineCrawler as any).execute = async () => {
    asked++;
    throw new QuestionNotSentError("[CopilotCrawler] Copilot did not accept the question");
  };
  const batch = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["copilot"], sampleSize: 1, promptIds: ["p1", "p2", "p3"], pacingScale: 0, personWaitMs: 0 });
  const kinds = (JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(batch) as any).errors_json) as any[]).map((e) => e.kind);
  assert.equal(asked, 2, "not asked again after two refusals");
  assert.deepEqual(kinds, ["not_accepted", "not_accepted", "skipped_after_not_accepted"]);
});

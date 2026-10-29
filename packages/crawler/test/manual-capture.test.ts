import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-manual-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");

const { getRawDb } = await import("@prismgeo/db");
const { CrawlerOrchestrator, configureCitedPageFetch } = await import("../src/queue/crawler-orchestrator");
const { normalizeQuestion, rankPromptMatches, CaptureRejectedError, NOT_MANUAL_BATCH } = await import("../src/queue/manual-capture");

configureCitedPageFetch(async () => ""); // no network in tests

const sqlite = getRawDb();
const exec = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...(args as any[]));
exec("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'northwind', 'Northwind Voice', 'northwindvoice.ai', '[\"Northwind\"]')");
exec("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES ('c1', 'b1', 'Talkly', 'talkly.com', '[]')");
exec("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension) VALUES ('p1', 'b1', 'Which AI tool calls shoppers who abandon checkout on Shopify?', 'consideration', 'buyer')");

const answer =
  "For Shopify stores, Northwind Voice is the best option for high-AOV brands: it calls shoppers within minutes and charges per recovered order. " +
  "Talkly is a cheaper alternative with a monthly plan. See https://northwindvoice.ai/pricing for details.";

const rejects = async (p: Promise<unknown>, status: number, re: RegExp) => {
  await assert.rejects(p, (err: unknown) => err instanceof CaptureRejectedError && err.status === status && re.test(err.message));
};

test("questions match regardless of case, quotes and punctuation; the picker ranks by word overlap", () => {
  assert.equal(normalizeQuestion("Which AI tool calls shoppers who abandon checkout on Shopify?"), normalizeQuestion("which ai tool calls shoppers who abandon checkout on shopify"));
  const ranked = rankPromptMatches("ai tool that calls abandoned checkout shoppers shopify", [
    { id: "p1", text: "Which AI tool calls shoppers who abandon checkout on Shopify?" },
    { id: "p2", text: "best dunning app for subscriptions" },
  ]);
  assert.equal(ranked[0].id, "p1");
  assert.equal(ranked.length, 1);
});

test("a hand-captured answer is stored like a crawled one: mentions, stance, citations; capture_method 'manual'", async () => {
  const r = await CrawlerOrchestrator.storeManualCapture({
    brandId: "b1",
    engine: "chatgpt",
    question: "which AI tool calls shoppers who abandon checkout on shopify",
    answerText: answer,
    citations: [{ url: "https://talkly.com/pricing?utm_source=chatgpt.com", title: "Talkly pricing" }, { url: "javascript:alert(1)" }],
    pageUrl: "https://chatgpt.com/c/abc",
  });
  assert.equal(r.matched, "exact");
  assert.equal(r.promptId, "p1");
  assert.deepEqual(r.mentions.map((m) => [m.name, m.sentiment]), [["Northwind Voice", "positive"], ["Talkly", "neutral"]]);
  const run = sqlite.prepare("SELECT capture_method, engine, batch_id FROM prompt_runs WHERE id = ?").get(r.runId) as any;
  assert.equal(run.capture_method, "manual");
  const urls = (sqlite.prepare("SELECT url FROM citations WHERE run_id = ? ORDER BY rank").all(r.runId) as any[]).map((c) => c.url);
  assert.ok(urls.includes("https://talkly.com/pricing") && urls.includes("https://northwindvoice.ai/pricing"), urls.join(", "));
  assert.ok(!urls.some((u) => u.startsWith("javascript")));
  const batch = sqlite.prepare("SELECT status, total_runs, completed_runs, owner FROM crawl_batches WHERE id = ?").get(run.batch_id) as any;
  assert.deepEqual({ ...batch }, { status: "completed", total_runs: 1, completed_runs: 1, owner: "manual-capture" });
  // Left out of engine health and "latest audit"
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM crawl_batches WHERE ${NOT_MANUAL_BATCH}`).get() as any).n, 0);
});

test("the same answer saved twice is refused; error pages are refused, not stored", async () => {
  await rejects(CrawlerOrchestrator.storeManualCapture({ brandId: "b1", engine: "chatgpt", promptId: "p1", answerText: answer, citations: [] }), 409, /already saved/);
  await rejects(
    CrawlerOrchestrator.storeManualCapture({ brandId: "b1", engine: "gemini", promptId: "p1", answerText: "I encountered an error doing what you asked. Could you try again?", citations: [] }),
    422,
    /finished answer/
  );
  const runs = (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs").get() as any).n;
  assert.equal(runs, 1);
});

test("an untracked question is refused unless the person adds it; unknown clients and questions are 404", async () => {
  await rejects(CrawlerOrchestrator.storeManualCapture({ brandId: "b1", engine: "perplexity", question: "is talkly worth it for a small store", answerText: answer, citations: [] }), 409, /not tracked/);
  const added = await CrawlerOrchestrator.storeManualCapture({
    brandId: "b1",
    engine: "perplexity",
    question: "is talkly worth it for a small store",
    addAsPrompt: true,
    intent: "comparison",
    answerText: `${answer} (Perplexity)`,
    citations: [],
  });
  assert.equal(added.matched, "added");
  const p = sqlite.prepare("SELECT query_text, intent_type, active FROM prompts WHERE id = ?").get(added.promptId) as any;
  assert.deepEqual({ ...p }, { query_text: "is talkly worth it for a small store", intent_type: "comparison", active: 1 });
  await rejects(CrawlerOrchestrator.storeManualCapture({ brandId: "nope", engine: "chatgpt", promptId: "p1", answerText: answer, citations: [] }), 404, /client/);
  await rejects(CrawlerOrchestrator.storeManualCapture({ brandId: "b1", engine: "chatgpt", promptId: "p-missing", answerText: answer, citations: [] }), 404, /not tracked/);
});

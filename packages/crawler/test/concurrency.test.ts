import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-concurrency-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");

const { getRawDb, setSettings } = await import("@prismgeo/db");
const { CrawlerOrchestrator, configureCitedPageFetch, apiConcurrency } = await import("../src/queue/crawler-orchestrator");

configureCitedPageFetch(async () => "");
const sqlite = getRawDb();
sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'northwind', 'Northwind Voice', 'northwindvoice.ai', '[]')").run();
sqlite.prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES ('c1', 'b1', 'Talkly', 'talkly.com', '[]')").run();
for (let i = 0; i < 10; i++) {
  sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension) VALUES (?, 'b1', ?, 'consideration', 'buyer')").run(`p${i}`, `which ai tool calls abandoned carts, question ${i}`);
}
setSettings("engine_settings", { mode: "byok" });
setSettings("byok_api_keys", { dataforseo: "ops@example.com:pw" });

test("paid routes get parallel workers sized to the provider; browsers stay sequential", () => {
  assert.equal(apiConcurrency("chatgpt", { dataforseo: "a:b" }), 5);
  assert.equal(apiConcurrency("gemini", { gemini: "g" }), 1);
  assert.equal(apiConcurrency("chatgpt", { openai: "sk" }), 2);
  assert.equal(apiConcurrency("chatgpt", {}), 1);
});

test("a DataForSEO batch runs requests in parallel and stores every answer exactly once", async () => {
  let inFlight = 0;
  let peak = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 40));
    inFlight--;
    const kw = JSON.parse(String(init.body))[0].keyword;
    const markdown = `For "${kw}", Northwind Voice is the best option for Shopify brands that want AI calls to abandoned checkouts; Talkly is an alternative with a monthly plan.`;
    return new Response(JSON.stringify({ status_code: 20000, cost: 0.004, tasks: [{ status_code: 20000, cost: 0.004, result: [{ markdown, items: [], sources: [] }] }] }));
  }) as typeof fetch;
  try {
    const batchId = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, pacingScale: 0 });
    const runs = sqlite.prepare("SELECT prompt_id, capture_method FROM prompt_runs WHERE batch_id = ?").all(batchId) as Array<{ prompt_id: string; capture_method: string }>;
    assert.equal(runs.length, 10);
    assert.equal(new Set(runs.map((r) => r.prompt_id)).size, 10, "each question answered once");
    assert.ok(runs.every((r) => r.capture_method === "provider"));
    assert.ok(peak >= 2 && peak <= 5, `parallel but within the cap (peak ${peak})`);
    const batch = sqlite.prepare("SELECT status, completed_runs, failed_runs FROM crawl_batches WHERE id = ?").get(batchId) as any;
    assert.deepEqual({ ...batch }, { status: "completed", completed_runs: 10, failed_runs: 0 });
  } finally {
    globalThis.fetch = original;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-reanalyze-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");

const { getRawDb } = await import("@prismgeo/db");
const { reanalyzeBrand } = await import("../src/queue/reanalyze");

const sqlite = getRawDb();
const exec = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...(args as any[]));

exec("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'northwind', 'Northwind Voice', 'northwindvoice.ai', '[]')");
exec("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES ('c1', 'b1', 'Talkly', 'talkly.com', '[]')");
exec("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES ('c2', 'b1', 'Dialsy AI', 'dialsy.ai', '[]')");
exec("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension) VALUES ('p1', 'b1', 'alternatives to talkly for shopify', 'consideration', 'buyer')");
exec("INSERT INTO crawl_batches (id, brand_id, status) VALUES ('bt1', 'b1', 'completed')");
const answer = [
  "If you're looking for alternatives to Talkly for your Shopify store, it depends on your use case.",
  "Best Talkly alternatives for Shopify in 2026",
  "1. Dialsy",
  "From $39/month · 14-day free trial",
  "Best if you want to make calls as well as answer them.",
].join("\n");
exec(
  "INSERT INTO prompt_runs (id, brand_id, batch_id, prompt_id, engine, run_index, response_text) VALUES ('r1', 'b1', 'bt1', 'p1', 'chatgpt', 0, ?)",
  answer
);
// Stored under older rules: Talkly credited as the top pick, Dialsy (no alias yet) not found
exec(
  "INSERT INTO entity_mentions (id, brand_id, run_id, competitor_id, entity_name, is_competitor, sentiment, stance) VALUES ('e1', 'b1', 'r1', 'c1', 'Talkly', 1, 'positive', 'recommended_primary')"
);

const mentions = () =>
  sqlite.prepare("SELECT entity_name, sentiment, is_prompt_subject FROM entity_mentions WHERE run_id = 'r1' ORDER BY entity_name").all() as Array<{
    entity_name: string;
    sentiment: string;
    is_prompt_subject: number;
  }>;

test("re-analysis re-derives mentions from the stored answer with current aliases and rules", () => {
  exec("UPDATE competitors SET aliases_json = ? WHERE id = 'c2'", JSON.stringify(["Dialsy"]));
  const result = reanalyzeBrand("b1");
  assert.deepEqual(result, { runs: 1, mentionsBefore: 1, mentionsAfter: 2, runsChanged: 1 });
  const rows = mentions();
  assert.deepEqual(
    rows.map((r) => [r.entity_name, r.sentiment, r.is_prompt_subject]),
    [
      ["Dialsy AI", "positive", 0],
      ["Talkly", "neutral", 1],
    ]
  );
  // The captured answer itself is untouched
  assert.equal((sqlite.prepare("SELECT response_text FROM prompt_runs WHERE id = 'r1'").get() as { response_text: string }).response_text, answer);
  // Idempotent
  assert.equal(reanalyzeBrand("b1").runsChanged, 0);
});

test("re-analysis refuses to run while an audit for the client is writing", () => {
  exec("INSERT INTO crawl_batches (id, brand_id, status) VALUES ('bt2', 'b1', 'running')");
  assert.throws(() => reanalyzeBrand("b1"), /audit is running/);
  exec("UPDATE crawl_batches SET status = 'completed' WHERE id = 'bt2'");
});

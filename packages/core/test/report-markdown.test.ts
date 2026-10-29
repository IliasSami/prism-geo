import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisibilityReport, renderReportMarkdown, type ReportInput } from "../src/index";

const input: ReportInput = {
  brand: { id: "b1", name: "Northwind Voice", domain: "northwindvoice.ai", aliasesJson: "[]" },
  prompts: [
    { id: "p1", query_text: "ai that calls abandoned carts shopify", intent_type: "consideration", active: 1 },
    { id: "p2", query_text: "best dunning app for shopify subscriptions", intent_type: "consideration", active: 1 },
    { id: "p3", query_text: "is northwind voice legit", intent_type: "direct", active: 1 },
  ],
  competitors: [{ id: "c1", name: "Dialsy AI", domain: "dialsy.ai", aliases_json: "[]" }],
  runs: [
    { id: "r1", prompt_id: "p1", engine: "chatgpt", capture_method: "browser", created_at: "2026-10-29T01:00:00.000Z" },
    { id: "r2", prompt_id: "p2", engine: "chatgpt", capture_method: "browser", created_at: "2026-10-29T01:05:00.000Z" },
    { id: "r3", prompt_id: "p3", engine: "chatgpt", capture_method: "browser", created_at: "2026-10-29T01:10:00.000Z" },
  ],
  mentions: [
    { run_id: "r1", entity_name: "Northwind Voice", competitor_id: null, is_target_brand: 1, position_rank: 1, sentiment: "positive" },
    { run_id: "r2", entity_name: "Dialsy AI", competitor_id: "c1", is_target_brand: 0, position_rank: 1, sentiment: "neutral" },
    { run_id: "r3", entity_name: "Northwind Voice", competitor_id: null, is_target_brand: 1, is_prompt_subject: 1, position_rank: 1, sentiment: "neutral" },
  ],
  citations: [{ run_id: "r1", domain: "northwindvoice.ai", url: "https://northwindvoice.ai/" }],
  batches: [
    {
      failed_runs: 3,
      errors_json: JSON.stringify([
        { engine: "perplexity", promptId: "p1", kind: "blocked", message: "sign-in wall" },
        { engine: "perplexity", promptId: "p2", kind: "skipped_after_blocks", message: "still blocked" },
        { engine: "perplexity", promptId: "p3", kind: "skipped_after_blocks", message: "still blocked" },
      ]),
    },
  ],
};

test("the Markdown report states rates with their denominators and keeps failures and branded questions separate", () => {
  const md = renderReportMarkdown(buildVisibilityReport(input), {
    brand: { name: "Northwind Voice", domain: "northwindvoice.ai", category: "AI voice agents for cart recovery" },
    generatedAt: "2026-10-29T02:00:00.000Z",
    competitors: ["Dialsy AI"],
  });
  assert.match(md, /^# AI search visibility: Northwind Voice/);
  assert.match(md, /appears in 50% \(likely \d+–\d+%, 1 of 2\) of answers to 2 unbranded buyer questions/);
  assert.match(md, /Most-named competitor:\*\* Dialsy AI/);
  assert.match(md, /Branded questions\*\* \(that name Northwind Voice\)/);
  assert.match(md, /Perplexity: 1 blocked by the engine, 2 skipped while it kept blocking\./);
  assert.match(md, /\| best dunning app for shopify subscriptions \| Dialsy AI \(1 of 1\) \| high \|/);
  assert.doesNotMatch(md, /NaN|undefined|null%/);
});

test("with no answers the report says so instead of showing zeros", () => {
  const md = renderReportMarkdown(buildVisibilityReport({ ...input, runs: [], mentions: [], citations: [], batches: [] }), {
    brand: { name: "Northwind Voice", domain: "northwindvoice.ai" },
    generatedAt: "2026-10-29T02:00:00.000Z",
  });
  assert.match(md, /No unbranded answers have been captured yet/);
  assert.doesNotMatch(md, /0%/);
});

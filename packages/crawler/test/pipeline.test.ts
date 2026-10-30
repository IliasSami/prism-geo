import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CASES, PROFILE } from "../../core/test/fixtures";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-pipeline-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");
// Crawls in tests run as if from the default search location (no network check)
process.env.PRISMGEO_CONNECTION_COUNTRY = "us";

const { getRawDb, setSettings, loadReportInput } = await import("@prismgeo/db");
const { buildVisibilityReport } = await import("@prismgeo/core");
const orch = await import("../src/queue/crawler-orchestrator");
const { CrawlerOrchestrator, BatchRunningError, configureCitedPageFetch, closeStaleBatches, PROCESS_OWNER } = orch;
const { stalestPromptIdsByEngine, zonedDateHour } = await import("../src/queue/scheduler");
const { ChatGptEngineCrawler } = await import("../src/engines/chatgpt");
const { GeminiEngineCrawler } = await import("../src/engines/gemini");
const { AnswerNotFinishedError } = await import("../src/engines/browser-session");
const playwright = await import("playwright");

// No browser and no network in tests
(playwright.chromium as any).launch = async () => {
  throw new Error("test harness: browser disabled");
};
configureCitedPageFetch(async (url) =>
  url.startsWith("https://northwindvoice.ai/pricing")
    ? "Northwind Voice charges a percentage of recovered revenue: you only pay when one of our AI voice agents calls a shopper who abandoned checkout and the order is completed."
    : ""
);

const sqlite = getRawDb();
const byPrompt = new Map(CASES.map((c) => [c.prompt, c]));
const answerFor = (query: string, engine: string) => {
  const c = byPrompt.get(query);
  return {
    engine,
    query,
    responseText: c ? c.responseText : `A long enough answer to "${query}" that names nobody we track, for the test.`,
    citations: c ? c.citations : [],
    subQueries: [],
    executionMs: 1,
    captureMethod: c?.style === "api" ? ("api" as const) : ("browser" as const),
  };
};

before(() => {
  setSettings("engine_settings", { mode: "stealth" });
  sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'northwind', ?, ?, ?)").run(PROFILE.brand.name, PROFILE.brand.domain, JSON.stringify(PROFILE.brand.aliases));
  for (const c of PROFILE.competitors) {
    sqlite.prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json, active) VALUES (?, 'b1', ?, ?, ?, 1)").run(c.id, c.name, c.domain, JSON.stringify(c.aliases));
  }
  // a paused competitor is neither tracked nor reported
  sqlite.prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json, active) VALUES ('c-paused', 'b1', 'Northwind Voice Rival', 'rival.example', '[]', 0)").run();
  CASES.forEach((c, i) =>
    sqlite
      .prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active, created_at) VALUES (?, 'b1', ?, ?, 1, ?)")
      .run(`p-${c.id}`, c.prompt, c.intent, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
  );
});

test("the full pipeline stores mentions, echoes, stance, confusion flags and verified passages", async () => {
  (ChatGptEngineCrawler as any).execute = async (q: string) => answerFor(q, "chatgpt");
  const batchId = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, pacingScale: 0 });
  const batch = sqlite.prepare("SELECT status, completed_runs, failed_runs, created_at, owner FROM crawl_batches WHERE id = ?").get(batchId) as any;
  assert.equal(batch.status, "completed");
  assert.equal(batch.completed_runs, CASES.length);
  assert.match(batch.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(batch.owner, PROCESS_OWNER);

  const rows = sqlite
    .prepare(
      `SELECT r.prompt_id, m.entity_name, m.competitor_id, m.is_prompt_subject, m.position_rank, m.list_position, m.sentiment, m.stance, m.has_caveat, m.entity_confusion
       FROM entity_mentions m JOIN prompt_runs r ON r.id = m.run_id`
    )
    .all() as any[];
  for (const c of CASES) {
    const got = rows.filter((r) => r.prompt_id === `p-${c.id}`);
    assert.deepEqual(got.map((g) => g.entity_name).sort(), Object.keys(c.expected).sort(), `case ${c.id}`);
    for (const g of got) {
      const exp = c.expected[g.entity_name];
      assert.equal(g.position_rank, exp.rank, `case ${c.id} rank of ${g.entity_name}`);
      assert.equal(g.is_prompt_subject, (c.echoes || []).includes(g.entity_name) ? 1 : 0);
      if (!(g.is_prompt_subject && g.competitor_id)) assert.equal(g.sentiment, exp.sentiment, `case ${c.id} sentiment of ${g.entity_name}`);
    }
  }
  assert.ok(rows.every((r) => r.entity_name !== "Northwind Voice Rival"), "paused competitor not tracked");
  assert.ok(rows.filter((r) => r.entity_name !== PROFILE.brand.name).every((r) => r.competitor_id), "competitor id stored");
  const dialsyA = rows.find((r) => r.prompt_id === "p-A" && r.entity_name === "Dialsy AI");
  assert.equal(dialsyA.has_caveat, 1);
  assert.equal(rows.find((r) => r.prompt_id === "p-B" && r.entity_name === "Vocalyze").list_position, 4);

  // entity confusion: flagged on the run and on the brand mention
  const f = sqlite.prepare("SELECT flags_json FROM prompt_runs WHERE prompt_id = 'p-F'").get() as any;
  assert.deepEqual(JSON.parse(f.flags_json), { entityConfusion: { lookalikeDomains: ["northwindvoiceai.com"] }, searchedFrom: "US" });
  assert.equal(rows.find((r) => r.prompt_id === "p-F").entity_confusion, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE json_extract(flags_json, '$.entityConfusion') IS NOT NULL").get() as any).n, 1);
  // every answer records the country it was asked from (this computer's connection, for a browser)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE json_extract(flags_json, '$.searchedFrom') IS NOT 'US'").get() as any).n, 0);

  // citations: canonical URLs in document order, engine titles on the right URL
  const cits = sqlite.prepare("SELECT c.url, c.title, c.rank FROM citations c JOIN prompt_runs r ON r.id = c.run_id WHERE r.prompt_id = 'p-D' ORDER BY c.rank").all() as any[];
  assert.deepEqual(cits.map((c) => c.url), ["https://www.talkly.com/blog/abandoned-checkout-calls", "https://help.shopify.com/en/manual/checkout-settings", "https://northwindvoice.ai/blog/klaviyo-voice"]);
  assert.equal(cits[2].title, "Klaviyo + voice");
  assert.equal(cits[0].title, "How to call abandoned checkouts");

  // reverse-RAG: nothing stored without evidence of reuse
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM reverse_rag_chunks").get() as any).n, 0);

  // the report built from the stored rows
  const report = buildVisibilityReport(loadReportInput("b1"));
  const dialsy = report.entities.find((e) => e.name === "Dialsy AI")!;
  assert.equal(dialsy.mentioned.n, report.totalAnswers - 1, "the 'dialsy ai alternatives' answer is not in Dialsy's denominator");
  assert.equal(report.prompts.find((p) => p.id === "p-F")!.youMentioned, 1);
  assert.equal(report.brandAccuracy.confusedAnswers, 1);
  assert.ok(!report.entities.some((e) => e.name === "Northwind Voice Rival"));
  const hoop = report.entities.find((e) => e.name === "Hoop Voice")!;
  assert.equal(hoop.mentioned.hits, 4, "dash variants and the 'hoop subscriptions alternatives' answer all count");
});

test("a second batch for a brand that is already crawling is refused (per-brand lock)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  (GeminiEngineCrawler as any).execute = async (q: string) => {
    await gate;
    return answerFor(q, "gemini");
  };
  const first = CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["gemini"], sampleSize: 1, promptIds: ["p-A"], pacingScale: 0 });
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(() => CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, pacingScale: 0 }), BatchRunningError);
  release();
  await first;
});

test("a batch left running by a dead process is closed at once, not after minutes", () => {
  sqlite
    .prepare("INSERT INTO crawl_batches (id, brand_id, status, owner, heartbeat_at, created_at) VALUES ('dead-owner', 'b1', 'running', ?, ?, ?)")
    .run(`${os.hostname()}:999999:deadbeef`, new Date().toISOString(), new Date().toISOString());
  assert.equal(closeStaleBatches(), 1);
  assert.equal((sqlite.prepare("SELECT status FROM crawl_batches WHERE id = 'dead-owner'").get() as any).status, "failed");
});

test("prompts paused or deleted mid-batch stop being queried", async () => {
  sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active) VALUES ('p-gone', 'b1', 'temporary question one', 'category', 1), ('p-pause', 'b1', 'temporary question two', 'category', 1)").run();
  const asked: string[] = [];
  (ChatGptEngineCrawler as any).execute = async (q: string) => {
    asked.push(q);
    if (asked.length === 1) {
      // the prompt being answered is deleted, the other one is paused (whichever the shuffle put first)
      const [askedId, otherId] = q === "temporary question one" ? ["p-gone", "p-pause"] : ["p-pause", "p-gone"];
      sqlite.prepare("DELETE FROM prompts WHERE id = ?").run(askedId);
      sqlite.prepare("UPDATE prompts SET active = 0 WHERE id = ?").run(otherId);
    }
    return answerFor(q, "chatgpt");
  };
  const batchId = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 2, promptIds: ["p-gone", "p-pause"], pacingScale: 0 });
  const errors = JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(batchId) as any).errors_json) as any[];
  assert.equal(asked.length, 1, "only the first query was sent");
  assert.ok(errors.some((e) => e.kind === "prompt_removed"));
  assert.ok(errors.some((e) => e.kind === "prompt_paused"));
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE batch_id = ?").get(batchId) as any).n, 0, "the answer to the deleted prompt is not stored");
  sqlite.prepare("DELETE FROM prompts WHERE id IN ('p-gone', 'p-pause')").run();
});

test("network failures stop the engine; unfinished answers are retried once and never stored as complete", async () => {
  let calls = 0;
  (ChatGptEngineCrawler as any).execute = async () => {
    calls++;
    throw new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://chat.example/");
  };
  const ids = CASES.slice(0, 6).map((c) => `p-${c.id}`);
  const b1 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0 });
  const errs = JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(b1) as any).errors_json) as any[];
  assert.equal(calls, 2, "stopped after two consecutive network failures");
  assert.deepEqual(errs.map((e) => e.kind), ["network", "network", "skipped_after_network", "skipped_after_network", "skipped_after_network", "skipped_after_network"]);

  let attempts = 0;
  (ChatGptEngineCrawler as any).execute = async () => {
    attempts++;
    throw new AnswerNotFinishedError("No extractable response: answer did not finish streaming within 90 s");
  };
  const b2 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ["p-A"], pacingScale: 0 });
  assert.equal(attempts, 2, "retried once");
  const e2 = JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(b2) as any).errors_json) as any[];
  assert.deepEqual(e2.map((e) => e.kind), ["no_answer"]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE batch_id = ?").get(b2) as any).n, 0);
});

test("each engine walks its own seeded order; the scheduler picks each engine's stalest prompts", async () => {
  const order: Record<string, string[]> = { chatgpt: [], gemini: [] };
  (ChatGptEngineCrawler as any).execute = async (q: string) => (order.chatgpt.push(q), answerFor(q, "chatgpt"));
  (GeminiEngineCrawler as any).execute = async (q: string) => (order.gemini.push(q), answerFor(q, "gemini"));
  const ids = CASES.map((c) => `p-${c.id}`);
  await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt", "gemini"], sampleSize: 1, promptIds: ids, pacingScale: 0, batchId: "batch-order-test" });
  assert.notDeepEqual(order.chatgpt, order.gemini);
  assert.notDeepEqual(order.chatgpt, CASES.map((c) => c.prompt));
  assert.deepEqual([...order.chatgpt].sort(), CASES.map((c) => c.prompt).sort());

  // Perplexity has never answered: its stalest prompts are all of them; ChatGPT's stalest differ from Gemini's
  sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active) VALUES ('p-new', 'b1', 'a brand new question', 'category', 1)").run();
  const picks = stalestPromptIdsByEngine("b1", ["chatgpt", "perplexity"], 3);
  assert.equal(picks.chatgpt[0], "p-new", "never-captured prompts lead");
  assert.equal(picks.perplexity.length, 3);
});

test("the schedule hour is evaluated in the configured IANA time zone", () => {
  const t = new Date("2026-10-28T07:30:00Z");
  assert.deepEqual(zonedDateHour(t, "UTC"), { date: "2026-10-28", hour: 7 });
  assert.deepEqual(zonedDateHour(t, "Europe/Paris"), { date: "2026-10-28", hour: 8 });
  assert.deepEqual(zonedDateHour(t, "America/Los_Angeles"), { date: "2026-10-28", hour: 0 });
  assert.deepEqual(zonedDateHour(new Date("2026-10-28T23:30:00Z"), "Asia/Tokyo"), { date: "2026-10-29", hour: 8 });
});

test("database files are private", () => {
  const mode = (p: string) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(process.env.PRISMGEO_DB_PATH!), 0o600);
  assert.equal(mode(path.dirname(process.env.PRISMGEO_DB_PATH!)), 0o700);
});

test("a Google block rests the browser route across audits instead of searching into the block", async () => {
  const { GoogleAioCrawler } = await import("../src/engines/google-aio");
  const { EngineBlockedError } = await import("../src/engines/browser-session");
  const { browserCoolingDown, recordBrowserSuccess } = await import("../src/engines/block-memory");
  const ids = CASES.slice(0, 5).map((c) => `p-${c.id}`);
  let searches = 0;
  (GoogleAioCrawler as any).execute = async () => {
    searches++;
    throw new EngineBlockedError('[GoogleAioCrawler] Blocked by engine ("unusual traffic")');
  };
  const b1 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["google_aio"], sampleSize: 1, promptIds: ids, pacingScale: 0 });
  const e1 = JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(b1) as any).errors_json) as any[];
  assert.equal(searches, 1, "one blocked search, not one per question");
  assert.deepEqual(e1.map((e) => e.kind), ["blocked", "cooling_down", "cooling_down", "cooling_down", "cooling_down"]);
  const rest = browserCoolingDown("google_ai_mode");
  assert.ok(rest, "AI Mode shares Google Search's rest period");
  assert.ok(Date.parse(rest!.until) - Date.now() > 55 * 60_000, "about an hour after the first block");

  // The next audit leaves Google alone and says until when
  const b2 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["google_aio"], sampleSize: 1, promptIds: ids, pacingScale: 0 });
  const e2 = JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(b2) as any).errors_json) as any[];
  assert.equal(searches, 1, "no search while resting");
  assert.deepEqual(e2.map((e) => e.kind), ["cooling_down"]);
  assert.match(e2[0].message, /waits until/);

  // After the rest, a real answer ends the streak and its organic results reach the report
  setSettings("browser_blocks", {});
  (GoogleAioCrawler as any).execute = async (q: string) => ({
    ...answerFor(q, "google_aio"),
    citations: [{ url: "https://www.g2.com/categories/voice", title: "G2" }, { url: "https://northwindvoice.ai/voice", title: "Northwind" }],
    organic: [
      { position: 1, url: "https://www.g2.com/categories/voice", title: "G2" },
      { position: 4, url: "https://northwindvoice.ai/", title: "Northwind" },
    ],
    searchUrl: "https://www.google.com/search?q=x&gl=us&hl=en&uule=w%2BCAIQICINVW5pdGVkIFN0YXRlcw",
    locationSignal: "United States",
  });
  const b3 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["google_aio"], sampleSize: 1, promptIds: ids.slice(0, 1), pacingScale: 0 });
  recordBrowserSuccess("google_aio");
  assert.equal(browserCoolingDown("google_aio"), null);
  const run = sqlite.prepare("SELECT flags_json FROM prompt_runs WHERE batch_id = ?").get(b3) as any;
  const flags = JSON.parse(run.flags_json);
  assert.equal(flags.locationSignal, "United States");
  assert.match(flags.searchUrl, /uule=/);
  assert.equal(flags.organic.length, 2);
  const report = buildVisibilityReport(loadReportInput("b1"));
  assert.equal(report.aioVsOrganic.answers, 1);
  assert.equal(report.aioVsOrganic.citedSites, 2);
  assert.equal(report.aioVsOrganic.citedInTop10, 2);
  assert.equal(report.aioVsOrganic.citedInTop3, 1);
  assert.equal(report.aioVsOrganic.brand.ranksTop10, 1);
  assert.equal(report.aioVsOrganic.brand.averagePosition, 4);
});

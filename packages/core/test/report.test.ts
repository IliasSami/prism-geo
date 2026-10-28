import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisibilityReport, findOpportunities, type ReportInput } from "../src/index";

const brand = { id: "b1", name: "Northwind Voice", domain: "northwindvoice.ai", aliasesJson: JSON.stringify(["Northwind"]) };
const competitors = [
  { id: "c-dialsy", name: "Dialsy AI", domain: "dialsy.ai", aliases_json: "[]" },
  { id: "c-talkly", name: "Talkly", domain: "talkly.com", aliases_json: "[]" },
];

type M = ReportInput["mentions"][number];
const mention = (run_id: string, who: "brand" | "c-dialsy" | "c-talkly", extra: Partial<M> = {}): M => ({
  run_id,
  entity_name: who === "brand" ? brand.name : who === "c-dialsy" ? "Dialsy AI" : "Talkly",
  competitor_id: who === "brand" ? null : who,
  is_target_brand: who === "brand" ? 1 : 0,
  is_prompt_subject: 0,
  position_rank: 1,
  list_position: null,
  sentiment: "neutral",
  stance: "neutral",
  has_caveat: 0,
  entity_confusion: 0,
  ...extra,
});
const run = (id: string, prompt_id: string, engine: string, extra: Partial<ReportInput["runs"][number]> = {}) => ({
  id,
  prompt_id,
  engine,
  capture_method: "browser",
  created_at: `2026-10-0${id.length % 9}T10:00:00.000Z`,
  flags_json: "{}",
  ...extra,
});

function input(): ReportInput {
  return {
    brand,
    prompts: [
      { id: "p1", query_text: "best ai voice agent for shopify", intent_type: "category", active: 1 },
      { id: "p2", query_text: "dialsy ai alternatives", intent_type: "comparison", active: 1 },
      { id: "p3", query_text: "is northwind voice legit", intent_type: "category", active: 1 },
      { id: "p4", query_text: "cart recovery pricing", intent_type: "pricing", active: 1 },
      { id: "p5", query_text: "paused question", intent_type: "category", active: 0 },
    ],
    competitors,
    runs: [
      run("r1", "p1", "chatgpt"),
      run("r2", "p2", "chatgpt"),
      run("r3", "p3", "chatgpt", { flags_json: JSON.stringify({ entityConfusion: { lookalikeDomains: ["northwindvoiceai.com"] } }) }),
      run("r4", "p4", "chatgpt", { capture_method: "api" }),
      run("r5", "p1", "google_aio"),
      run("r6", "p5", "chatgpt"),
      run("r7", "p1", "gemini"),
      run("r8", "p2", "gemini"),
      run("r9", "p4", "gemini"),
    ],
    mentions: [
      mention("r1", "brand", { sentiment: "positive", has_caveat: 1 }),
      mention("r1", "c-dialsy", { position_rank: 2 }),
      mention("r2", "c-dialsy", { is_prompt_subject: 1, position_rank: null }), // echo of "dialsy ai alternatives"
      mention("r2", "c-talkly", { position_rank: 1 }),
      mention("r3", "brand", { is_prompt_subject: 1, position_rank: null, entity_confusion: 1 }),
      mention("r4", "c-dialsy"),
      mention("r5", "c-dialsy"),
      // a row stored before is_prompt_subject existed: the echo is derived with the shared term logic
      mention("r8", "c-dialsy", { is_prompt_subject: null, position_rank: 1 }),
      mention("r9", "brand"),
    ],
    citations: [
      { run_id: "r1", domain: "talkly.com", url: "https://talkly.com/blog" },
      { run_id: "r4", domain: "northwindvoice.ai", url: "https://northwindvoice.ai/pricing" },
    ],
    batches: [
      {
        failed_runs: 9,
        errors_json: JSON.stringify([
          { engine: "google_aio", kind: "no_ai_overview" },
          { engine: "google_aio", kind: "no_ai_overview" },
          { engine: "google_aio", kind: "no_ai_overview" },
          { engine: "chatgpt", kind: "network" },
          { engine: "chatgpt", kind: "skipped_after_network" },
          { engine: "perplexity", kind: "setup" },
          { engine: "perplexity", kind: "blocked" },
          { engine: "gemini", kind: "no_answer" },
          { engine: "gemini", kind: "prompt_removed" },
        ]),
      },
    ],
  };
}

test("per-entity denominators leave out prompts that name the entity", () => {
  const r = buildVisibilityReport(input());
  // organic = active unbranded runs: r1 r2 r4 r5 r7 r8 r9 (r3 is branded, r6 paused)
  assert.equal(r.totalAnswers, 7);
  assert.equal(r.totalQuestions, 3);
  const dialsy = r.entities.find((e) => e.name === "Dialsy AI")!;
  assert.equal(dialsy.mentioned.n, 5, "the two answers to 'dialsy ai alternatives' cannot count for Dialsy");
  assert.equal(dialsy.mentioned.hits, 3);
  const talkly = r.entities.find((e) => e.name === "Talkly")!;
  assert.equal(talkly.mentioned.n, 7);
  assert.equal(talkly.mentioned.hits, 1);
  const you = r.entities.find((e) => e.isTarget)!;
  assert.equal(you.mentioned.hits, 2);
  assert.equal(you.positive, 1);
  assert.equal(you.caveats, 1);
  assert.equal(you.id, "brand");
  assert.equal(you.mentioned.questions, 3);
  // prompt-clustered pct: mean over questions p1 (1/3), p2 (0/2), p4 (1/2) = 27.8%
  assert.equal(you.mentioned.pct, 28);
});

test("branded prompt rows show the brand's real presence; echoes do not count as wins", () => {
  const r = buildVisibilityReport(input());
  const legit = r.prompts.find((p) => p.id === "p3")!;
  assert.equal(legit.branded, true);
  assert.equal(legit.youMentioned, 1);
  assert.equal(legit.brandedNamedRuns, 1);
  assert.equal(r.prompts.find((p) => p.id === "p1")!.brandedNamedRuns, null);
  assert.equal(legit.status, "winning");
  assert.deepEqual(legit.enginesMissingYou, []);
  const alternatives = r.prompts.find((p) => p.id === "p2")!;
  assert.deepEqual(alternatives.competitors.map((c) => c.name), ["Talkly"]);
  assert.equal(r.branded.hits, 1);
  assert.equal(r.branded.n, 1);
  assert.ok(findOpportunities(r, brand.name).every((o) => !o.prompt.branded));
});

test("failure buckets keep network, setup and removed prompts out of 'no readable answer'", () => {
  const f = buildVisibilityReport(input()).failures;
  assert.equal(f.noAnswer, 1);
  assert.equal(f.network, 2);
  assert.equal(f.setup, 1);
  assert.equal(f.blocked, 1);
  assert.equal(f.noOverview, 3);
  assert.equal(f.promptRemoved, 1);
  assert.equal(f.byEngine.chatgpt.network, 2);
  assert.equal(f.byEngine.chatgpt.noAnswer, 0);
});

test("coverage, capture-method split, AIO trigger rate and the engine-stratified headline", () => {
  const r = buildVisibilityReport(input());
  const cov = Object.fromEntries(r.coverage.map((c) => [c.engine, c]));
  assert.equal(cov.chatgpt.promptsCovered, 3);
  assert.equal(cov.google_aio.promptsCovered, 1);
  assert.equal(cov.google_aio.inHeadline, false);
  assert.deepEqual(cov.google_aio.byIntent.category, { covered: 1, total: 1 });
  assert.deepEqual(r.headline.engines.sort(), ["chatgpt", "gemini"]);
  assert.deepEqual(r.headline.excluded, [{ engine: "google_aio", share: 0.333 }]);
  // ChatGPT: brand on p1 only (1 of 3 questions) = 33%; Gemini: p4 only = 33%
  assert.equal(r.headline.brandMentionedPct, 33);
  const chatgptMethods = r.captureMethods.find((c) => c.engine === "chatgpt")!;
  assert.deepEqual(chatgptMethods.byMethod, { browser: 3, api: 1 }); // the paused prompt's answer is not counted
  assert.equal(chatgptMethods.dominant, "browser");
  assert.equal(chatgptMethods.mixed, true, "25% of ChatGPT answers came from the API");
  assert.equal(r.aioTrigger.overviews, 1);
  assert.equal(r.aioTrigger.noOverview, 3);
  assert.equal(r.aioTrigger.rate.pct, 25);
  assert.equal(r.entitiesByEngine.gemini.find((e) => e.isTarget)!.mentioned.hits, 1);
});

test("brand accuracy counts look-alike confusion with examples", () => {
  const a = buildVisibilityReport(input()).brandAccuracy;
  assert.equal(a.confusedAnswers, 1);
  assert.equal(a.confusedBrandedAnswers, 1);
  assert.equal(a.brandedAnswers, 1);
  assert.equal(a.answersNamingBrand, 3);
  assert.deepEqual(a.lookalikeDomains, [{ domain: "northwindvoiceai.com", answers: 1 }]);
  assert.equal(a.examples[0].prompt, "is northwind voice legit");
});

test("mentions are matched by competitor id, so a renamed competitor keeps its history", () => {
  const data = input();
  data.competitors = [{ ...competitors[0], name: "Dialsy" }, competitors[1]];
  const dialsy = buildVisibilityReport(data).entities.find((e) => e.id === "c-dialsy")!;
  assert.equal(dialsy.name, "Dialsy");
  assert.equal(dialsy.mentioned.hits, 3);
});

test("a competitor tracked by a marketplace host gets no citation credit for other listings", () => {
  const data = input();
  data.competitors = [{ id: "c-hoop", name: "Hoop Voice", domain: "apps.shopify.com", aliases_json: "[]" }];
  data.citations.push({ run_id: "r7", domain: "apps.shopify.com", url: "https://apps.shopify.com/talkly-voice" });
  const hoop = buildVisibilityReport(data).entities.find((e) => e.id === "c-hoop")!;
  assert.equal(hoop.cited.hits, 0);
  assert.equal(hoop.cited.n, 0);
});

test("the report stays fast at thousands of answers", () => {
  const data = input();
  const base = data.runs.length;
  for (let i = 0; i < 5000; i++) {
    const id = `x${i}`;
    data.runs.push(run(id, ["p1", "p2", "p4"][i % 3], ["chatgpt", "gemini", "perplexity"][i % 3]));
    data.mentions.push(mention(id, i % 2 ? "brand" : "c-talkly"));
    data.citations.push({ run_id: id, domain: "talkly.com", url: `https://talkly.com/p${i % 50}` });
  }
  const t0 = performance.now();
  const r = buildVisibilityReport(data);
  const ms = performance.now() - t0;
  assert.equal(r.allAnswers, base + 5000);
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});

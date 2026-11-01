import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVisibilityReport,
  detectMentions,
  entityTerms,
  findEntityHits,
  isBoilerplateParagraph,
  lookalikeDomains,
  namesEntity,
  renderReportMarkdown,
  type ReportInput,
  type TrackedEntity,
} from "../src/index";

const entity = (key: string, name: string, domain: string, isTarget = false): TrackedEntity => ({ key, name, isTarget, terms: entityTerms(name, [], domain) });

test("a tracked name inside another tracked name counts only for the longer one", () => {
  const acme = entity("brand", "Acme", "acme.com", true);
  const big = entity("c1", "Big Acme", "bigacme.io");
  const r = detectMentions("Try Big Acme first; Acme is also fine.", [acme, big], "best tools");
  assert.deepEqual(
    r.mentions.map((m) => [m.entity.name, m.hits.length, m.positionRank]),
    [
      ["Big Acme", 1, 1],
      ["Acme", 1, 2],
    ]
  );
  const only = detectMentions("Try Big Acme.", [acme, big], "best tools");
  assert.deepEqual(only.mentions.map((m) => m.entity.name), ["Big Acme"], "an entity left without hits is dropped");
  const echo = detectMentions("Big Acme and Acme both work.", [acme, big], "big acme alternatives");
  assert.deepEqual(echo.mentions.map((m) => [m.entity.name, m.isPromptSubject, m.positionRank]), [
    ["Big Acme", true, null],
    ["Acme", false, 1],
  ]);
});

test("a name followed by a hyphenated modifier or a slash, or after @, is a mention", () => {
  const acme = entity("brand", "Acme", "acme.com", true).terms;
  for (const s of ["Acme-powered stores", "Acme-based flows", "Acme/Shopify bundles", "follow @Acme for updates"]) assert.equal(findEntityHits(s, acme).length, 1, s);
  for (const s of ["acme-voice is different", "see acme/blog/post", "acme/pricing.html", "mail sales@acme.com", "acme-powered.com"]) assert.equal(findEntityHits(s, acme).length, 0, s);
});

test("common-word and very short names match their exact case only", () => {
  const front = entityTerms("Front", [], "front.com");
  assert.equal(findEntityHits("Put the offer in front of buyers", front).length, 0);
  assert.equal(findEntityHits("Front and Zendesk both handle this", front).length, 1);
  assert.equal(namesEntity("what goes in front of a shop", front), false, "the prompt is not branded");
  const ada = entityTerms("Ada", [], "ada.cx");
  assert.equal(findEntityHits("the ada compliance guide", ada).length, 0);
  assert.equal(findEntityHits("Ada is a support bot", ada).length, 1);
  const talkly = entityTerms("Talkly", [], "talkly.com");
  assert.equal(findEntityHits("TALKLY and talkly", talkly).length, 2, "distinctive names stay case-insensitive");
});

test("look-alike domains match at label boundaries; the brand's own name under a country ending is regional", () => {
  assert.deepEqual(lookalikeDomains("see blacmeadow.com, acme.de and acme.co.uk", ["shop.acme.fr"], "acme.com"), []);
  assert.deepEqual(lookalikeDomains("see acmehq.com, get-acme.com and acme.io", [], "acme.com"), ["acme.io", "acmehq.com", "get-acme.com"]);
});

test("a product paragraph that says 'sign up' is not boilerplate; a cookie banner is", () => {
  assert.equal(
    isBoilerplateParagraph("Acme lets you sign up in two minutes and connect your Shopify store, then it calls every abandoned cart within the hour and recovers lost revenue for you."),
    false
  );
  assert.equal(isBoilerplateParagraph("Sign up for our newsletter and get the latest news in your inbox."), true);
  assert.equal(
    isBoilerplateParagraph("We use cookies to improve your experience on our site. By clicking accept all you agree to our privacy policy and the terms of service. You can manage preferences at any time."),
    true
  );
});

const brand = { id: "b1", name: "Northwind Voice", domain: "northwindvoice.ai", aliasesJson: "[]" };
const run = (id: string, prompt_id: string, engine: string) => ({ id, prompt_id, engine, capture_method: "browser", created_at: "2026-10-01T10:00:00.000Z", flags_json: "{}" });
const brandMention = (run_id: string) => ({
  run_id,
  entity_name: brand.name,
  competitor_id: null,
  is_target_brand: 1,
  is_prompt_subject: 0,
  position_rank: 1,
  sentiment: "neutral",
});

test("a marketplace host is a competitor source only where the cited URL is the competitor's listing", () => {
  const input: ReportInput = {
    brand,
    prompts: [
      { id: "p1", query_text: "best voice agent", intent_type: "category", active: 1 },
      { id: "p2", query_text: "cart recovery tools", intent_type: "category", active: 1 },
    ],
    competitors: [{ id: "c1", name: "Hoop Voice", domain: "apps.shopify.com/hoop-voice", aliases_json: "[]" }],
    runs: [run("r1", "p1", "chatgpt"), run("r2", "p2", "chatgpt")],
    mentions: [],
    citations: [
      { run_id: "r1", domain: "apps.shopify.com", url: "https://apps.shopify.com/hoop-voice" },
      { run_id: "r2", domain: "apps.shopify.com", url: "https://apps.shopify.com/some-other-app" },
    ],
    batches: [],
  };
  const report = buildVisibilityReport(input);
  const src = (pid: string) => report.prompts.find((p) => p.id === pid)!.sources.find((s) => s.domain === "apps.shopify.com")!;
  assert.equal(src("p1").isCompetitor, true);
  assert.equal(src("p2").isCompetitor, false);
  input.citations = [input.citations[1]];
  assert.equal(buildVisibilityReport(input).topSources.find((s) => s.domain === "apps.shopify.com")!.isCompetitor, false);
});

test("engine averages use unrounded rates and skip engines with no counted answers", () => {
  // chatgpt 1 of 8 (12.5%, shown 13) and gemini 3 of 8 (37.5%, shown 38): the mean of the shown
  // percents rounds to 26, the mean of the real rates is 25.
  const prompts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, query_text: `generic question ${i}`, intent_type: "category", active: 1 }));
  const runs = [...prompts.map((p) => run(`a-${p.id}`, p.id, "chatgpt")), ...prompts.map((p) => run(`b-${p.id}`, p.id, "gemini"))];
  const mentions = [brandMention("a-p0"), brandMention("b-p0"), brandMention("b-p1"), brandMention("b-p2")];
  const report = buildVisibilityReport({ brand, prompts, competitors: [], runs, mentions, citations: [], batches: [] });
  assert.deepEqual(report.headline.engines.sort(), ["chatgpt", "gemini"]);
  assert.equal(report.headline.brandMentionedPct, 25);
  assert.equal(report.headline.brandCitedPct, null, "no engine showed sources, so there is no cited average");
});

test("the markdown labels the per-question average and the raw answer count", () => {
  const prompts = [
    { id: "p1", query_text: "generic question one", intent_type: "category", active: 1 },
    { id: "p2", query_text: "generic question two", intent_type: "category", active: 1 },
  ];
  const runs = [run("r1", "p1", "chatgpt"), run("r2", "p2", "chatgpt"), run("r3", "p2", "gemini"), run("r4", "p2", "perplexity")];
  const report = buildVisibilityReport({ brand, prompts, competitors: [], runs, mentions: [brandMention("r1")], citations: [], batches: [] });
  const md = renderReportMarkdown(report, { brand, generatedAt: "2026-11-01T00:00:00.000Z" });
  assert.match(md, /50% per-question average \(likely \d+–\d+%; 1 of 4 answers\)/);
  assert.match(md, /Percentages weight every question equally/);
});

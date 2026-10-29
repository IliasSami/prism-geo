import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStance, findEntityHits, proseOf, stanceOf } from "../src/index";

/** Stance of `entity` when `others` are also tracked (clause scoping needs every entity's position). */
function stanceWith(text: string, entity: string, others: string[]) {
  const prose = proseOf(text);
  const hits = findEntityHits(prose, [entity]);
  const starts = [entity, ...others].flatMap((e) => findEntityHits(prose, [e]).map((h) => h.index));
  return stanceOf(prose, hits, starts).sentiment;
}

const cases: Array<[string, string, "positive" | "neutral" | "negative", string]> = [
  ["According to northwindvoiceai.com, the agency builds chatbots.\nNorthwind is the top pick for pay-per-recovery cart calls.", "Northwind", "positive", "word-bounded: a look-alike domain is not an occurrence; later occurrences count"],
  ["Talkly: best for Shopify Plus brands.", "Talkly", "positive", "'best for' is a recommendation"],
  ["We recommend Northwind for most DTC brands.", "Northwind", "positive", "'recommend'"],
  ["Northwind is poorly documented.", "Northwind", "negative", "control"],
  ["Northwind integrates with Klaviyo and Shopify; users report no complaints.", "Northwind", "positive", "negation: 'no complaints'"],
  ["Northwind has a free tier with unlimited calls.", "Northwind", "neutral", "'unlimited' is not 'limited'"],
  ["Northwind – not recommended for B2B, but the #1 pick for Shopify cart calls.", "Northwind", "positive", "explicit recommendation outranks a caveat"],
  ["Northwind is a Klaviyo alternative for phone outreach.", "Northwind", "neutral", "'alternative' alone is not a recommendation"],
  ["Talkly is inexpensive and easy to set up.", "Talkly", "positive", "'inexpensive' is not 'expensive'"],
  ["Talkly is not expensive if calls don't convert.", "Talkly", "neutral", "negated caveat"],
  ["Plans for Talkly start with a 7-day free trial.", "Talkly", "neutral", "'start with' is not a recommendation"],
  ["Some users complain that Talkly sounds scripted.", "Talkly", "negative", "'complain' (any form)"],
  ["Talkly reviews are thin.", "Talkly", "negative", "'thin'"],
  ["Northwind\nBest for: paying only for recovered orders.", "Northwind", "positive", "heading line read with the next line"],
];

test("stance engine: negation, scoping, every occurrence, recommendation beats caveat", () => {
  for (const [text, entity, expected, why] of cases) {
    assert.equal(classifyStance(text, entity).sentiment, expected, `${why}: ${text}`);
  }
});

test("no clause bleed between entities in one sentence", () => {
  const text = "Unlike Talkly, which can get expensive at volume, Northwind only charges when an order is recovered.\nNorthwind is my pick.";
  assert.equal(stanceWith(text, "Northwind", ["Talkly"]), "positive");
  assert.equal(stanceWith(text, "Talkly", ["Northwind"]), "negative");
  assert.equal(stanceWith("Unlike Talkly, which can get expensive, Northwind charges per order.", "Northwind", ["Talkly"]), "neutral");
});

test("a recommendation with a caveat is positive and flags the caveat", () => {
  const r = classifyStance("Best for high-volume stores: Dialsy\nDialsy has a Klaviyo integration, but pricing can get expensive at scale.", "Dialsy");
  assert.equal(r.sentiment, "positive");
  assert.equal(r.stance, "recommended_alternative");
  assert.equal(r.hasCaveat, true);
  const primary = classifyStance("Talkly is the top pick for most stores.", "Talkly");
  assert.equal(primary.stance, "recommended_primary");
  assert.equal(primary.hasCaveat, false);
  assert.equal(classifyStance("Nothing here.", "Talkly").stance, "neutral");
});

test("table cells with a one-word fact are not judgements", () => {
  const table = "| Tool | Klaviyo |\n|---|---|\n| **Vocalyze** | Limited |\n| **Talkly** | Yes, but support is limited and slow to answer |";
  assert.equal(classifyStance(table, "Vocalyze").sentiment, "neutral");
  assert.equal(classifyStance(table, "Talkly").sentiment, "negative");
});

test("the product being replaced is not credited with its alternatives' praise; 'best if' under a meta line counts", () => {
  const text = [
    "If you're looking for alternatives to Talkly for your Shopify store, it depends on your use case.",
    "Talkly focuses on inbound phone support.",
    "Best Talkly alternatives for Shopify in 2026",
    "1. Dialsy AI",
    "From $39/month · 14-day free trial",
    "Best if you want to make calls as well as answer them.",
  ].join("\n");
  assert.equal(stanceWith(text, "Talkly", ["Dialsy AI"]), "neutral");
  assert.equal(stanceWith(text, "Dialsy AI", ["Talkly"]), "positive");
  assert.equal(stanceWith("Switching from Northwind? The best option is to compare pricing first.", "Northwind", []), "neutral");
  // A recommendation of the entity itself still counts
  assert.equal(stanceWith("Northwind is the best option for high-AOV stores.", "Northwind", []), "positive");
});

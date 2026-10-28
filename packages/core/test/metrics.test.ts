import { test } from "node:test";
import assert from "node:assert/strict";
import { MonteCarloMetricsCalculator, ReverseRagParser } from "../src/index";

test("Wilson interval brackets the observed rate and stays within [0, 1]", () => {
  const [low, high] = MonteCarloMetricsCalculator.calculateWilsonInterval(3, 10);
  assert.ok(low >= 0 && low < 0.3 && high > 0.3 && high <= 1);
  assert.deepEqual(MonteCarloMetricsCalculator.calculateWilsonInterval(0, 0), [0, 0]);
  const [zeroLow, zeroHigh] = MonteCarloMetricsCalculator.calculateWilsonInterval(0, 20);
  assert.equal(zeroLow, 0);
  assert.ok(zeroHigh > 0 && zeroHigh < 0.2);
});

test("prominence decays with position in the answer", () => {
  const early = MonteCarloMetricsCalculator.calculateProminenceScore(10, 1000);
  const late = MonteCarloMetricsCalculator.calculateProminenceScore(900, 1000);
  assert.ok(early > late);
});

test("stance reads the line that names the entity, not its neighbours", () => {
  const text = "Best direct fit: Globex. It calls abandoned checkouts.\nInitech is too expensive and the setup is painful.";
  assert.equal(MonteCarloMetricsCalculator.classifyStance(text, "Globex").sentiment, "positive");
  assert.notEqual(MonteCarloMetricsCalculator.classifyStance(text, "Initech").sentiment, "positive");
});

test("citations are attributed to brand and competitor domains", () => {
  const cits = ReverseRagParser.extractCitationsFromText(
    "See https://acme-voice.example/pricing and https://www.globex.example/blog and https://shopify.com/x",
    "acme-voice.example",
    ["globex.example"]
  );
  const byDomain = Object.fromEntries(cits.map((c) => [c.domain, c]));
  assert.equal(byDomain["acme-voice.example"]?.isBrandDomain, true);
  assert.equal(byDomain["globex.example"]?.isCompetitorDomain, true);
  assert.equal(byDomain["shopify.com"]?.isBrandDomain, false);
});

test("reverse-RAG alignment finds the passage an answer reuses", () => {
  const page = "Unrelated intro about our team.\n\nAI voice agents call shoppers who abandon checkout and recover lost revenue within minutes.\n\nContact us.";
  const res = ReverseRagParser.computeChunkAlignment("AI voice agents call shoppers who abandon checkout to recover revenue", page, "https://x.com");
  assert.match(res.sourceChunkText, /abandon checkout/);
  assert.ok(res.alignmentScore > 0);
});

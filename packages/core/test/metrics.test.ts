import { test } from "node:test";
import assert from "node:assert/strict";
import { ReverseRagParser, isBoilerplateParagraph, REUSE_MIN_SCORE } from "../src/index";

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

const verbatim =
  "Northwind Voice charges a percentage of recovered revenue: you only pay when one of our AI voice agents calls a shopper who abandoned checkout and the order is completed. There is no monthly fee and no setup fee, and our agents work with Shopify and Klaviyo out of the box.";
const page = [
  "We use cookies to improve your experience. Accept all cookies or manage preferences in settings.",
  "Shopify Klaviyo Shopify Klaviyo checkout checkout calls calls minutes stores integrations partners.",
  verbatim,
  "Meet the team: our founders previously built growth tools for ecommerce brands in two cities.",
].join("\n\n");

test("reverse-RAG: a passage reused inside a longer answer is found and passes the evidence gate", () => {
  const answer = [
    "Here's a quick comparison of AI voice agents for abandoned-checkout calls. Talkly is the top pick for most Shopify stores.",
    "Dialsy AI handles high call volume and integrates with Klaviyo.",
    verbatim,
  ].join("\n");
  const a = ReverseRagParser.computeChunkAlignment(answer, page, "https://northwindvoice.ai/pricing");
  assert.equal(a.sourceChunkText, verbatim);
  assert.ok(a.alignmentScore >= REUSE_MIN_SCORE);
  assert.ok(a.sharedShingles >= 2);
  assert.equal(a.isReuse, true);
  assert.match(a.answerSentence, /percentage of recovered revenue/);
});

test("reverse-RAG: navigation stuffing, cookie banners and topical overlap are not reuse", () => {
  const answer = "Talkly is the top pick for Shopify checkout calls. Northwind Voice charges per recovered order and works with Klaviyo.";
  const a = ReverseRagParser.computeChunkAlignment(answer, page, "https://northwindvoice.ai/pricing");
  assert.doesNotMatch(a.sourceChunkText, /Shopify Klaviyo Shopify Klaviyo/);
  assert.equal(a.isReuse, false, "shares words but no phrases");
  const cookie = ReverseRagParser.computeChunkAlignment(answer, "We use cookies to improve your experience on our site and to show you relevant advertising for checkout tools.", "https://x.example");
  assert.equal(cookie.isReuse, false);
  assert.equal(cookie.sourceChunkText, "");
  assert.equal(isBoilerplateParagraph("Shopify Klaviyo Shopify Klaviyo checkout checkout calls calls minutes stores integrations partners."), true);
  assert.equal(isBoilerplateParagraph("La récupération des paniers abandonnés par téléphone fonctionne avec des agents vocaux pour Shopify."), false);
});

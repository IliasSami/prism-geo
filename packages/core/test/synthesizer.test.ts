import { test } from "node:test";
import assert from "node:assert/strict";
import { IcpPromptSynthesizer, classifyValueProp, deriveCategory, categoryForms, type BrandProfileInput } from "../src/index";

const description = "Revenue team for online stores: AI voice agents that phone shoppers who leave checkout and win back the order.";
const profile: BrandProfileInput = {
  brandName: "Northwind Voice",
  domain: "northwindvoice.ai",
  niche: description,
  aliases: ["Northwind"],
  competitors: [
    { name: "Dialsy AI", domain: "dialsy.ai" },
    { name: "Ringo Calls", domain: "ringocalls.com" },
    { name: "Hoop Voice", domain: "hoopvoice.ai" },
    { name: "Talkly", domain: "talkly.com" },
  ],
  valuePropositions: ["Rings shoppers soon after an abandoned checkout", "Works with Shopify and Klaviyo", "Pay per recovered order", "Shoppers abandon checkout when shipping costs surprise them"],
};

test("value propositions are typed as pain, capability or pricing model", () => {
  assert.equal(classifyValueProp("Pay per recovered order"), "pricing");
  assert.equal(classifyValueProp("Works with Shopify and Klaviyo"), "capability");
  assert.equal(classifyValueProp("Rings shoppers soon after an abandoned checkout"), "capability");
  assert.equal(classifyValueProp("Shoppers abandon checkout when shipping costs surprise them"), "pain");
});

test("category: explicit when given, otherwise a short noun phrase from the description", () => {
  assert.equal(deriveCategory(profile), "AI voice agents");
  assert.equal(deriveCategory({ ...profile, category: "cart recovery calling software" }), "cart recovery calling software");
  assert.equal(deriveCategory({ brandName: "Northwind Voice", niche: "Northwind Voice is an AI voice agent that calls shoppers who abandon checkout." }), "AI voice agent");
  assert.equal(deriveCategory({ brandName: "X", niche: "" }), null);
  assert.deepEqual(categoryForms("AI voice agents"), { one: "AI voice agent", many: "AI voice agents", article: "an" });
  assert.deepEqual(categoryForms("cart recovery"), { one: "cart recovery tool", many: "cart recovery tools", article: "a" });
});

test("generated questions are grammatical, typed, varied, unprimed and competitor-light", () => {
  const prompts = IcpPromptSynthesizer.generatePrompts(profile);
  const texts = prompts.map((p) => p.queryText);
  const unbranded = prompts.filter((p) => p.intentType !== "direct");
  const branded = prompts.filter((p) => p.intentType === "direct");

  // never the description sentence, never a full stop inside a template, no doubled words
  for (const t of texts) {
    assert.ok(!t.includes("win back the order"), t);
    assert.ok(!/\w\.\s+\w+\s+(tools|vendor)\b/.test(t), t);
    assert.ok(!/\b(\w+) \1\b/i.test(t), t);
    assert.ok(!/best way to handle (works|pay|calls)/i.test(t), `value prop pasted into a pain template: ${t}`);
  }
  assert.ok(texts.includes("Which AI voice agents integrate with Shopify and Klaviyo?"));
  assert.ok(texts.includes("Are there AI voice agents that charge only per recovered order?"));
  assert.ok(texts.includes("Is there an AI voice agent that rings shoppers soon after an abandoned checkout?"));
  assert.ok(texts.some((t) => /^Shoppers abandon checkout when shipping costs surprise them\. What actually works/.test(t)), "symptom phrasing");

  // unbranded prompts never name the brand; branded prompts never include the domain
  for (const p of unbranded) assert.ok(!/northwind/i.test(p.queryText), p.queryText);
  for (const p of branded) assert.ok(!p.queryText.includes("northwindvoice.ai"), p.queryText);
  for (const form of ["Is Northwind Voice legit?", "Northwind Voice reviews", "Northwind Voice pricing"]) assert.ok(texts.includes(form), form);

  // at most 20% of the unbranded set names a competitor, and more than one competitor is used
  const competitorNames = profile.competitors.map((c) => c.name);
  const anchored = unbranded.filter((p) => competitorNames.some((c) => p.queryText.includes(c)));
  assert.ok(anchored.length / unbranded.length <= 0.2, `${anchored.length}/${unbranded.length}`);
  assert.ok(new Set(anchored.map((p) => competitorNames.find((c) => p.queryText.includes(c)))).size >= 2);

  // paraphrases and personas
  assert.ok(new Set(unbranded.map((p) => p.personaDimension)).size >= 4);
  assert.ok(unbranded.filter((p) => p.intentType === "category").length >= 3);
  assert.equal(new Set(texts.map((t) => t.toLowerCase())).size, texts.length, "no duplicates");
});

test("a profile with only a category still yields usable questions", () => {
  const prompts = IcpPromptSynthesizer.generatePrompts({ brandName: "Northwind Voice", domain: "northwindvoice.ai", niche: "", category: "cart recovery", aliases: [], competitors: [], valuePropositions: [] });
  assert.ok(prompts.length >= 8);
  assert.ok(prompts.some((p) => p.queryText === "What are the best cart recovery tools right now?"));
  assert.ok(prompts.every((p) => !p.queryText.includes("this category")));
});

test("category grammar: head noun before a qualifying phrase, uncountable nouns stay singular", () => {
  assert.deepEqual(
    { one: categoryForms("AI voice agents for abandoned checkout recovery").one, many: categoryForms("AI voice agents for abandoned checkout recovery").many },
    { one: "AI voice agent for abandoned checkout recovery", many: "AI voice agents for abandoned checkout recovery" },
  );
  assert.equal(categoryForms("accounting software for online shops").many, "accounting software for online shops");
  assert.equal(categoryForms("email marketing platform").many, "email marketing platforms");
  assert.equal(categoryForms("cart recovery").one, "cart recovery tool");
});

test("an audience already in the category or starting with 'small' is not repeated", () => {
  const prompts = IcpPromptSynthesizer.generatePrompts({
    brandName: "Northwind Ledger",
    domain: "northwindledger.com",
    niche: "Bookkeeping software for small online shops that sell on Shopify.",
    category: "bookkeeping software for online shops",
    aliases: [],
    competitors: [{ name: "Contoso Books", domain: "contosobooks.com" }],
    valuePropositions: [],
  }).map((p) => p.queryText);
  for (const q of prompts) {
    assert.doesNotMatch(q, /for online shops for /i, q);
    assert.doesNotMatch(q, /\bsmall small\b/i, q);
  }
  assert.ok(prompts.includes("I'm a founder of a small online shop: is a bookkeeping software for online shops worth it, and which one should I start with?"), prompts.join("\n"));
});

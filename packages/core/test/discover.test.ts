import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverCompanies, entityTerms } from "../src/index";

const answer = (extra: string) =>
  [
    "Here are the strongest options for Shopify cart-recovery calls:",
    "1. Dialsy AI — calls shoppers within minutes; best for high-AOV brands.",
    "2. Talkly — Shopify-native voice agent.",
    "3. CallNest: pay per recovered order.",
    "Pricing",
    "Best for",
    "Monthly",
    "Step 1 — connect Shopify",
    "100 — calls per month",
    "Klaviyo: keep your email flows running.",
    extra,
  ].join("\n");

const answers = [
  { text: answer("Northwind Voice is also worth a look."), engine: "chatgpt", promptId: "p1" },
  { text: answer(""), engine: "gemini", promptId: "p1" },
  { text: answer("Unlike Dialsy AI, Talkly has a free tier."), engine: "chatgpt", promptId: "p2" },
  { text: "Most brands start with Klaviyo flows, then add CallNest for calls.", engine: "gemini", promptId: "p3" },
];
const tracked = [entityTerms("Northwind Voice", ["Northwind"], "northwindvoice.ai"), entityTerms("Talkly", [], "talkly.com")];
const cited = ["www.dialsy.ai", "klaviyo.com", "callnest.io", "ico.org.uk"];

test("suggests recurring untracked vendors with their cited site; tracked companies and generic headings are left out", () => {
  const s = discoverCompanies(answers, tracked, { citedDomains: cited });
  assert.deepEqual(
    s.map((x) => [x.name, x.answers, x.questions, x.domain]),
    [
      ["CallNest", 4, 3, "callnest.io"],
      ["Klaviyo", 4, 3, "klaviyo.com"],
      ["Dialsy AI", 3, 2, "dialsy.ai"],
    ]
  );
  assert.deepEqual(s[0].engines, { chatgpt: 2, gemini: 2 });
});

test("a candidate without a matching cited site needs a brand-shaped name; big platforms are never suggested", () => {
  const s = discoverCompanies(answers, tracked, { citedDomains: [] });
  // CallNest is brand-shaped (internal capital); Dialsy AI without its site is not
  assert.deepEqual(s.map((x) => x.name), ["CallNest"]);
  const withPlatforms = discoverCompanies(answers, tracked, { citedDomains: ["shopify.com", ...cited] });
  assert.ok(!withPlatforms.some((x) => /shopify/i.test(x.name)));
  assert.ok(withPlatforms.some((x) => x.name === "Klaviyo"), "a cited site is enough evidence");
});

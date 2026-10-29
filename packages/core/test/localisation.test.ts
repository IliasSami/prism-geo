import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocalisation, originCountry, inMarkets, canonicalCountry } from "../src/text/localisation";

const fromDhaka = { origin: "Bangladesh", markets: ["United States", "Europe"] };

test("answers tailored to the machine's own country are flagged (phrasings seen live)", () => {
  const cases = [
    "Here are the best options for Shopify brands.\n\nBangladesh / South Asia\nLocal carriers may limit outbound calling.",
    "One important caveat: if your business operates in Bangladesh, confirm that the required local phone numbers are supported.",
    "Pricing starts at ৳1,500 per month for 100 calls.",
    "For Bangladesh-based stores, WhatsApp is usually the better first channel.",
    "## Bangladesh\nMost shoppers pay cash on delivery.",
    "Options by market\n\nBangladesh market\nWhatsApp-first tools work better.",
    "Bangladesh / South Asian ecommerce\nCash on delivery is common.",
  ];
  for (const text of cases) assert.equal(detectLocalisation(text, "best ai voice agent for ecommerce brands", fromDhaka), "Bangladesh", text);
});

test("not flagged: the question asks about it, it is a measured market, a passing mention, or the origin is unknown", () => {
  const text = "If your business operates in Bangladesh, check local numbers.";
  assert.equal(detectLocalisation(text, "best ai calling tool in bangladesh", fromDhaka), null, "question names it");
  assert.equal(detectLocalisation(text, "q", { origin: "Bangladesh", markets: ["Bangladesh"] }), null, "measured market");
  assert.equal(detectLocalisation("Teams in the US, UK and India use it.", "q", { origin: "India", markets: ["United States"] }), null, "passing mention");
  assert.equal(detectLocalisation("We operate in the UK and Germany.", "q", { origin: "United Kingdom", markets: ["Europe"] }), null, "Europe covers the UK");
  assert.equal(detectLocalisation(text, "q", { origin: null, markets: [] }), null, "origin unknown");
  assert.equal(detectLocalisation("Costs about Rs. 50 in some regions", "q", { origin: "Bangladesh", markets: ["United States"] }), null);
});

test("origin from the environment or the time zone; market names in DataForSEO form", () => {
  assert.equal(originCountry({}, "Asia/Dhaka"), "Bangladesh");
  assert.equal(originCountry({}, "America/Chicago"), "United States");
  assert.equal(originCountry({ PRISMGEO_ORIGIN_COUNTRY: "uk" }, "Asia/Dhaka"), "United Kingdom");
  assert.equal(originCountry({}, "Etc/UTC"), null);
  assert.ok(inMarkets("United Kingdom", ["London,England,United Kingdom"]));
  assert.ok(!inMarkets("India", ["United States", "Europe"]));
  assert.equal(canonicalCountry("USA"), "United States");
});

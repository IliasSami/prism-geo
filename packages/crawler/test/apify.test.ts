import { test } from "node:test";
import assert from "node:assert/strict";
import { apifyAiMode, apiRouteFor, apiRouteLabel, ApiKeyRejectedError, countryCodeFor, parseApifyAiMode } from "../src/engines/api-engines";

// Shape of one item of apify/google-ai-mode-scraper, as its README documents it
const item = {
  query: "what are the best crm platforms",
  text: "The best CRM depends on your bottleneck.\n\n*   **HubSpot:** intuitive, with a free tier.\n*   **Pipedrive:** a clean pipeline.",
  sources: [
    { id: 1, url: "https://www.pcmag.com/picks/the-best-crm-software#:~:text=a%20learning%20curve", title: "The Best CRM Software | PCMag", section: "citations" },
    { id: 2, url: "https://www.hubspot.com/products/crm", title: "HubSpot CRM", section: "attached" },
    { id: 3, url: "https://www.pcmag.com/picks/the-best-crm-software", title: "duplicate", section: "citations" },
    { id: 4, url: "https://example.com/further-reading", title: "More", section: "more" },
  ],
};

test("an Apify AI Mode item becomes an answer with the pages it cites", () => {
  const a = parseApifyAiMode([item], item.query);
  assert.equal(a.captureMethod, "provider");
  assert.equal(a.provider, "apify");
  assert.match(a.responseText, /HubSpot: intuitive, with a free tier\./);
  assert.doesNotMatch(a.responseText, /\*\*/);
  assert.deepEqual(
    a.citations.map((c) => c.url),
    ["https://www.pcmag.com/picks/the-best-crm-software", "https://www.hubspot.com/products/crm"],
    "text fragments are dropped, duplicates merged, and further-reading links are not citations"
  );
});

test("no AI Mode answer is a failure, never an empty answer", () => {
  assert.throws(() => parseApifyAiMode([], "q"), /AI Mode returned no answer/);
  assert.throws(() => parseApifyAiMode([{ query: "q", text: "  " }], "q"), /AI Mode returned no answer/);
  assert.throws(() => parseApifyAiMode({ error: "x" }, "q"), /AI Mode returned no answer/);
});

test("market names map to the country codes the actor expects", () => {
  assert.equal(countryCodeFor("United States"), "us");
  assert.equal(countryCodeFor("London,England,United Kingdom"), "gb");
  assert.equal(countryCodeFor("Bangladesh"), "bd");
  assert.equal(countryCodeFor("uk"), "gb");
  assert.equal(countryCodeFor("Worldwide"), null);
  assert.equal(countryCodeFor(undefined), null);
});

test("the request runs Apify's own AI Mode actor with the token in a header", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify([item]), { status: 201 });
  }) as unknown as typeof fetch;
  const a = await apifyAiMode(item.query, "apify_api_test", { location: "United Kingdom" }, fake);
  assert.equal(a.citations.length, 2);
  assert.match(seen!.url, /^https:\/\/api\.apify\.com\/v2\/acts\/apify~google-ai-mode-scraper\/run-sync-get-dataset-items/);
  assert.doesNotMatch(seen!.url, /token=/, "the token never goes in the URL");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer apify_api_test");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { queries: item.query, countryCode: "gb" });
});

test("a refused token or an empty balance stops the engine", async () => {
  for (const status of [401, 402]) {
    const fake = (async () => new Response("{}", { status })) as unknown as typeof fetch;
    await assert.rejects(apifyAiMode("q", "t", {}, fake), ApiKeyRejectedError);
  }
});

test("route order for Google AI Mode: DataForSEO, then SerpApi, then Apify; Apify is AI Mode only", () => {
  assert.equal(apiRouteLabel("google_ai_mode", { apify: "t" }), "Apify");
  assert.equal(apiRouteLabel("google_ai_mode", { apify: "t", serpapi: "s" }), "SerpApi");
  assert.equal(apiRouteLabel("google_ai_mode", { apify: "t", serpapi: "s", dataforseo: "l:p" }), "DataForSEO");
  assert.equal(apiRouteFor("google_aio", { apify: "t" }), null);
  assert.equal(apiRouteFor("chatgpt", { apify: "t" }), null);
});

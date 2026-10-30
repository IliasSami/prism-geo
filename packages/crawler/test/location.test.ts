import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-location-")), "test.db");
const { countryFromTrace, countryName, planRoutes } = await import("../src/engines/location");
const { apiRouteTargetsLocation, runApiEngine } = await import("../src/engines/api-engines");

test("the connection's country comes from the Cloudflare trace", () => {
  assert.equal(countryFromTrace("fl=1\nip=45.114.89.161\nts=1\nloc=BD\ntls=TLSv1.3\n"), "bd");
  assert.equal(countryFromTrace("loc=XX\n"), null, "unknown");
  assert.equal(countryFromTrace("<html>error</html>"), null);
  assert.equal(countryName("us"), "United States");
});

const base = { engineLabel: "ChatGPT", strict: true, target: "us", targetLabel: "United States", hasBrowser: true };

test("only searching from the US: a browser counts only when this computer connects from the US", () => {
  assert.deepEqual(planRoutes({ ...base, connection: "us", apiRoute: null }), { browser: true, api: false });
  const fromDhaka = planRoutes({ ...base, connection: "bd", apiRoute: null });
  assert.equal(fromDhaka.browser, false);
  assert.match(fromDhaka.skip!, /connects from Bangladesh.*wrong market.*DataForSEO.*proxy in United States/);
  // A key asked from the US answers instead of the browser
  assert.deepEqual(planRoutes({ ...base, connection: "bd", apiRoute: "located" }), { browser: false, api: true });
  // Gemini's API cannot choose a country: not used, and the reason says so
  const gemini = planRoutes({ ...base, engineLabel: "Gemini", connection: "bd", apiRoute: "unlocated" });
  assert.match(gemini.skip!, /saved key for Gemini cannot choose a country/);
  // In the US, the browser is used and the unlocated key is not
  assert.deepEqual(planRoutes({ ...base, connection: "us", apiRoute: "unlocated" }), { browser: true, api: false });
  // An unknown connection never counts as the US
  assert.match(planRoutes({ ...base, connection: null, apiRoute: null }).skip!, /could not confirm/);
  // AI Mode has no browser route
  assert.deepEqual(planRoutes({ ...base, engineLabel: "Google AI Mode", hasBrowser: false, connection: "bd", apiRoute: "located" }), { browser: false, api: true });
});

test("with the switch off every route may run (answers keep the country they came from)", () => {
  assert.deepEqual(planRoutes({ ...base, strict: false, connection: "bd", apiRoute: "unlocated" }), { browser: true, api: true });
});

test("which paid routes can be asked from a chosen country", () => {
  assert.equal(apiRouteTargetsLocation("gemini", { gemini: "k" }), false);
  assert.equal(apiRouteTargetsLocation("gemini", { gemini: "k", dataforseo: "l:p" }), true);
  assert.equal(apiRouteTargetsLocation("chatgpt", { openai: "k" }), true);
  assert.equal(apiRouteTargetsLocation("perplexity", { perplexity: "k" }), true);
  assert.equal(apiRouteTargetsLocation("google_aio", { serpapi: "k" }), true);
});

/** Replaces fetch for one call and returns what was requested. */
async function captureRequest(reply: unknown, run: () => Promise<unknown>) {
  const real = globalThis.fetch;
  const seen: { url: string; body: unknown } = { url: "", body: null };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.url = String(url);
    seen.body = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  try {
    return { result: await run(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

const longAnswer = "Klaviyo and Postscript are the most used options for abandoned cart recovery on Shopify stores in the US market today.";

test("each paid route is asked from the search location, and the answer records it", async () => {
  const opts = { location: "United States", language: "en" };
  const openai = await captureRequest({ output: [{ type: "message", content: [{ type: "output_text", text: longAnswer, annotations: [] }] }] }, () =>
    runApiEngine("chatgpt", "q", { openai: "k" }, opts)
  );
  assert.deepEqual((openai.seen.body as { tools: unknown[] }).tools, [{ type: "web_search", user_location: { type: "approximate", country: "US" } }]);
  assert.equal((openai.result as { searchedFrom?: string }).searchedFrom, "us");

  const pplx = await captureRequest({ choices: [{ message: { content: longAnswer } }], search_results: [] }, () => runApiEngine("perplexity", "q", { perplexity: "k" }, opts));
  assert.deepEqual((pplx.seen.body as { web_search_options: unknown }).web_search_options, { user_location: { country: "US" } });

  const serp = await captureRequest({ ai_overview: { text_blocks: [{ snippet: longAnswer }], references: [] } }, () => runApiEngine("google_aio", "q", { serpapi: "k" }, opts));
  const params = new URL(serp.seen.url).searchParams;
  assert.equal(params.get("gl"), "us");
  assert.equal(params.get("location"), "United States");
  assert.equal(params.get("hl"), "en");

  const gemini = await captureRequest({ candidates: [{ content: { parts: [{ text: longAnswer }] } }] }, () => runApiEngine("gemini", "q", { gemini: "k" }, opts));
  assert.equal((gemini.result as { searchedFrom?: string }).searchedFrom, undefined, "Gemini's API cannot be placed in a country");
});

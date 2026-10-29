import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runDataForSeo,
  markdownToText,
  parseDataForSeoCredential,
  dataForSeoError,
  ProviderAccountError,
} from "../src/engines/dataforseo";
import { apiRouteFor, apiRouteLabel, runApiEngine, ApiKeyRejectedError } from "../src/engines/api-engines";
import { EngineBlockedError } from "../src/engines/browser-session";
import { NoAiOverviewError } from "../src/engines/google-aio";

/** A DataForSEO envelope around one task result, as documented (status 20000 = ok). */
const envelope = (result: unknown, cost = 0.004, taskStatus = 20000, taskMessage = "Ok.") => ({
  version: "0.1",
  status_code: 20000,
  status_message: "Ok.",
  cost,
  tasks_count: 1,
  tasks_error: taskStatus === 20000 ? 0 : 1,
  tasks: [{ id: "t1", status_code: taskStatus, status_message: taskMessage, cost, result_count: result ? 1 : 0, result: result ? [result] : null }],
});

/** Records the request and answers with `body`. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const LONG = "Northwind Voice and Talkly both call shoppers who abandon checkout on Shopify; Northwind charges per recovered order while Talkly charges a monthly fee.";

test("credential parsing: login:password, the password may contain colons", () => {
  assert.deepEqual(parseDataForSeoCredential("ops@example.com:s3cr:et"), { login: "ops@example.com", password: "s3cr:et" });
  assert.equal(parseDataForSeoCredential("no-colon"), null);
  assert.equal(parseDataForSeoCredential(":pw"), null);
  assert.equal(parseDataForSeoCredential("login:"), null);
});

test("markdown is reduced to the plain text shape browser captures have", () => {
  const md = "## Best picks\n\n1. **[Northwind Voice](https://northwindvoice.ai/?utm_source=x)** — *pay per recovery*\n- Talkly: `monthly` plan\n\n| Tool | Price |\n|---|---|\n| Talkly | $29 |\n![logo](https://x/y.png)";
  const text = markdownToText(md);
  assert.equal(text, "Best picks\n\n1. Northwind Voice — pay per recovery\nTalkly: monthly plan\n\nTool | Price\nTalkly | $29");
});

test("ChatGPT LLM Scraper: request shape, answer text, cited sources in order, fan-out queries and cost", async () => {
  const result = {
    keyword: "ai that calls abandoned carts shopify",
    model: "gpt-5-search",
    markdown: `${LONG}\n\n[Northwind Voice](https://northwindvoice.ai/)`,
    fan_out_queries: ["ai abandoned cart calls shopify", "ai abandoned cart calls shopify"],
    sources: [{ type: "chat_gpt_source", title: "Talkly pricing", url: "https://talkly.com/pricing?utm_source=chatgpt.com", domain: "talkly.com" }],
    items: [
      { type: "chat_gpt_text", markdown: LONG, sources: [{ type: "chat_gpt_source", title: "Northwind Voice", url: "https://northwindvoice.ai/", domain: "northwindvoice.ai" }] },
    ],
  };
  const { impl, calls } = fakeFetch(envelope(result, 0.004));
  const a = await runDataForSeo("chatgpt", "ai that calls 100% abandoned carts + shopify", "ops@example.com:pw", { location: "United Kingdom", language: "en" }, impl);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced");
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("ops@example.com:pw").toString("base64")}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), [{ keyword: "ai that calls 100%25 abandoned carts %2B shopify", location_name: "United Kingdom", language_code: "en" }]);

  assert.ok(a.responseText.startsWith("Northwind Voice and Talkly"));
  assert.ok(a.responseText.endsWith("Northwind Voice"), "link reduced to its text");
  assert.deepEqual(
    a.citations.map((c) => c.url),
    ["https://northwindvoice.ai", "https://talkly.com/pricing"],
    "item sources first, tracking parameters removed, duplicates dropped"
  );
  assert.deepEqual(a.subQueries, ["ai abandoned cart calls shopify"]);
  assert.equal(a.captureMethod, "provider");
  assert.equal(a.provider, "dataforseo");
  assert.equal(a.costUsd, 0.004);
  assert.equal(a.model, "gpt-5-search");
});

test("Gemini LLM Scraper uses its own endpoint and falls back to item markdown", async () => {
  const { impl, calls } = fakeFetch(envelope({ items: [{ type: "gemini_text", markdown: LONG, sources: [{ type: "gemini_source", url: "https://talkly.com/", title: "Talkly" }] }] }));
  const a = await runDataForSeo("gemini", "q", "a@b.co:pw", {}, impl);
  assert.match(calls[0].url, /\/v3\/ai_optimization\/gemini\/llm_scraper\/live\/advanced$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), [{ keyword: "q", location_name: "United States", language_code: "en" }]);
  assert.equal(a.responseText, LONG);
  assert.equal(a.citations[0].url, "https://talkly.com");
});

test("Google AI Overview from the SERP: async Overviews requested, nested references collected; none shown is a real outcome", async () => {
  const serp = {
    items: [
      { type: "organic", url: "https://example.com" },
      {
        type: "ai_overview",
        asynchronous_ai_overview: true,
        markdown: `**AI voice agents** can call shoppers. ${LONG}`,
        items: [
          { type: "ai_overview_element", references: [{ type: "ai_overview_reference", source: "Talkly", url: "https://talkly.com/blog", title: "Talkly blog" }] },
          { type: "ai_overview_expanded_element", components: [{ references: [{ url: "https://northwindvoice.ai/pricing", title: "Pricing" }] }] },
        ],
      },
    ],
  };
  const { impl, calls } = fakeFetch(envelope(serp, 0.0026));
  const a = await runDataForSeo("google_aio", "ai voice agents", "a@b.co:pw", {}, impl);
  const body = JSON.parse(calls[0].init.body)[0];
  assert.equal(body.load_async_ai_overview, true);
  assert.match(calls[0].url, /\/v3\/serp\/google\/organic\/live\/advanced$/);
  assert.ok(a.responseText.startsWith("AI voice agents can call shoppers."));
  assert.deepEqual(a.citations.map((c) => c.url), ["https://talkly.com/blog", "https://northwindvoice.ai/pricing"]);

  const none = fakeFetch(envelope({ items: [{ type: "organic", url: "https://example.com" }] }));
  await assert.rejects(runDataForSeo("google_aio", "q", "a@b.co:pw", {}, none.impl), NoAiOverviewError);
});

test("Perplexity LLM Responses: Sonar API answer with annotations is stored as an API capture", async () => {
  const result = {
    model_name: "sonar",
    items: [{ type: "message", sections: [{ type: "text", text: LONG, annotations: [{ title: "Talkly", url: "https://talkly.com/" }] }] }],
    fan_out_queries: null,
  };
  const { impl, calls } = fakeFetch(envelope(result));
  const a = await runDataForSeo("perplexity", "x".repeat(600), "a@b.co:pw", {}, impl);
  const body = JSON.parse(calls[0].init.body)[0];
  assert.equal(body.user_prompt.length, 500, "prompt capped at the documented 500 characters");
  assert.equal(body.model_name, "sonar");
  assert.equal(a.captureMethod, "api");
  assert.equal(a.citations[0].url, "https://talkly.com");
  assert.deepEqual(a.subQueries, []);
});

test("status codes map to PrismGEO failure kinds; nothing is filled in", async () => {
  assert.ok(dataForSeoError(40100, "you are not authorized", "chatgpt") instanceof ProviderAccountError);
  assert.ok(dataForSeoError(40210, "insufficient funds", "chatgpt") instanceof ProviderAccountError);
  assert.ok(dataForSeoError(40202, "rate-limit", "gemini") instanceof EngineBlockedError);
  assert.ok(dataForSeoError(40102, "no search results", "google_aio") instanceof NoAiOverviewError);
  const transient = dataForSeoError(50000, "internal error", "chatgpt");
  assert.ok(!(transient instanceof ProviderAccountError) && !(transient instanceof EngineBlockedError));

  // Top-level auth failure (HTTP 200 with status_code 40100)
  const auth = fakeFetch({ status_code: 40100, status_message: "You are not authorized to access this resource.", tasks: [] });
  await assert.rejects(runDataForSeo("chatgpt", "q", "a@b.co:pw", {}, auth.impl), ProviderAccountError);
  // Task-level failure
  const task = fakeFetch(envelope(null, 0, 40103, "task execution failed"));
  await assert.rejects(runDataForSeo("chatgpt", "q", "a@b.co:pw", {}, task.impl), /40103/);
  // Non-JSON 401
  const http = fakeFetch("Unauthorized", 401);
  await assert.rejects(runDataForSeo("chatgpt", "q", "a@b.co:pw", {}, http.impl), ProviderAccountError);
  // Malformed credential never reaches the network
  const never = fakeFetch(envelope({}));
  await assert.rejects(runDataForSeo("chatgpt", "q", "nocolon", {}, never.impl), ProviderAccountError);
  assert.equal(never.calls.length, 0);
});

test("routing: DataForSEO is preferred where it captures the real interface; Perplexity prefers the user's own key", () => {
  const all = { dataforseo: "a@b.co:pw", openai: "sk-1", gemini: "g-1", serpapi: "s-1", perplexity: "p-1" };
  assert.equal(apiRouteFor("chatgpt", all)?.kind, "dataforseo");
  assert.equal(apiRouteFor("gemini", all)?.kind, "dataforseo");
  assert.equal(apiRouteFor("google_aio", all)?.kind, "dataforseo");
  assert.equal(apiRouteFor("perplexity", all)?.kind, "perplexity");
  assert.equal(apiRouteFor("perplexity", { dataforseo: "a@b.co:pw" })?.kind, "dataforseo");
  assert.equal(apiRouteFor("chatgpt", { openai: "sk-1" })?.kind, "openai");
  assert.equal(apiRouteFor("copilot", all), null);
  assert.equal(apiRouteLabel("google_aio", all), "DataForSEO");
  assert.equal(apiRouteLabel("chatgpt", {}), null);
});

test("a refused DataForSEO login stops the engine like a rejected API key", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ status_code: 40100, status_message: "not authorized", tasks: [] }))) as typeof fetch;
  try {
    await assert.rejects(runApiEngine("chatgpt", "q", { dataforseo: "a@b.co:pw" }), ApiKeyRejectedError);
  } finally {
    globalThis.fetch = original;
  }
});

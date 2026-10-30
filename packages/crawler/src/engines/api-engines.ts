import { EngineBlockedError, assertRealAnswer, cleanCitationUrl, type EngineAnswer } from "./browser-session";
import { NoAiOverviewError } from "./google-aio";
import { ProviderAccountError, markdownToText, runDataForSeo, type DataForSeoOptions } from "./dataforseo";

/**
 * Official API access to the engines, using the user's own keys (Settings → API keys).
 *
 * API answers come from the same model families with live web search, but without the consumer
 * app's personalisation and system prompt, so runs are stored with capture_method = 'api' and can
 * be told apart from browser captures. Gemini's API has a free tier (Google AI Studio key) that
 * includes Google Search grounding, which also returns the real search queries the model issued.
 * Google AI Overviews has no official API; SerpApi (free monthly tier) returns the Overview from
 * its own infrastructure, which avoids the "unusual traffic" blocks a single IP gets.
 */
export type ApiEngine = "gemini" | "chatgpt" | "perplexity" | "google_aio" | "google_ai_mode";

export interface ApiKeys {
  gemini?: string;
  openai?: string;
  perplexity?: string;
  serpapi?: string;
  /** DataForSEO "login:password": one credential for ChatGPT, Gemini, Google AI Overviews and Perplexity. */
  dataforseo?: string;
}

export type ApiRoute =
  | { kind: "dataforseo"; credential: string }
  | { kind: "gemini" | "openai" | "perplexity" | "serpapi"; key: string };

/**
 * Which paid route answers an engine, or null when none is saved. DataForSEO captures what the
 * consumer interface showed, so it is preferred for ChatGPT, Gemini and Google AI Overviews over
 * a model API. For Perplexity both routes are the Sonar API; the user's own Perplexity key is used
 * first (no provider fee), DataForSEO otherwise.
 */
export function apiRouteFor(engine: string, keys: ApiKeys): ApiRoute | null {
  const dfs = keys.dataforseo?.trim() || "";
  const own = (kind: "gemini" | "openai" | "perplexity" | "serpapi") => {
    const key = keys[kind]?.trim() || "";
    return key ? ({ kind, key } as const) : null;
  };
  const provider = dfs ? ({ kind: "dataforseo", credential: dfs } as const) : null;
  if (engine === "chatgpt") return provider || own("openai");
  if (engine === "gemini") return provider || own("gemini");
  if (engine === "google_aio" || engine === "google_ai_mode") return provider || own("serpapi");
  if (engine === "perplexity") return own("perplexity") || provider;
  return null;
}

/** The credential that unlocks a paid route for an engine, or "" when none is saved. */
export function apiKeyFor(engine: string, keys: ApiKeys): string {
  const route = apiRouteFor(engine, keys);
  return route ? (route.kind === "dataforseo" ? route.credential : route.key) : "";
}

/** Human-readable name of the route, for the dashboard ("DataForSEO", "OpenAI API", ...). */
export function apiRouteLabel(engine: string, keys: ApiKeys): string | null {
  const route = apiRouteFor(engine, keys);
  if (!route) return null;
  return { dataforseo: "DataForSEO", gemini: "Gemini API", openai: "OpenAI API", perplexity: "Perplexity API", serpapi: "SerpApi" }[route.kind];
}

/** The API rejected the key or the account has no access; retrying cannot help. */
export class ApiKeyRejectedError extends Error {}

const GEMINI_MODEL = process.env.PRISMGEO_GEMINI_MODEL || "gemini-flash-latest";
const OPENAI_MODEL = process.env.PRISMGEO_OPENAI_MODEL || "gpt-5-mini";
const PERPLEXITY_MODEL = process.env.PRISMGEO_PERPLEXITY_MODEL || "sonar";

async function postJson(tag: string, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = text.slice(0, 300).replace(/\s+/g, " ");
    if (res.status === 429) throw new EngineBlockedError(`[${tag}] API rate limit or quota reached (429): ${detail}`);
    if (res.status === 401 || res.status === 403) throw new ApiKeyRejectedError(`[${tag}] API key rejected (${res.status}): ${detail}`);
    throw new Error(`[${tag}] API error ${res.status}: ${detail}`);
  }
  return JSON.parse(text);
}

/** Gemini grounding links are vertexaisearch redirect URLs; resolve them to the real page. */
async function resolveRedirect(url: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(url)) return url;
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return res.headers.get("location") || url;
  } catch {
    return url;
  }
}

async function geminiApi(query: string, key: string): Promise<Omit<EngineAnswer, "executionMs">> {
  const data = await postJson(
    "GeminiApi",
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    { "x-goog-api-key": key },
    { contents: [{ role: "user", parts: [{ text: query }] }], tools: [{ google_search: {} }] }
  );
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  const meta = candidate?.groundingMetadata || {};
  const chunks: Array<{ uri: string; title: string }> = (meta.groundingChunks || []).map((c: any) => c.web).filter((w: any) => w?.uri);
  const citations = await Promise.all(
    chunks.map(async (c) => ({ url: cleanCitationUrl(await resolveRedirect(c.uri)), title: c.title || "" }))
  );
  return { responseText: text, citations, subQueries: meta.webSearchQueries || [], captureMethod: "api" };
}

async function openAiApi(query: string, key: string): Promise<Omit<EngineAnswer, "executionMs">> {
  const data = await postJson(
    "OpenAiApi",
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${key}` },
    { model: OPENAI_MODEL, input: query, tools: [{ type: "web_search" }] }
  );
  const output: any[] = data.output || [];
  const parts = output.filter((o) => o.type === "message").flatMap((o) => o.content || []).filter((c: any) => c.type === "output_text");
  const text = parts.map((p: any) => p.text).join("\n").trim();
  const citations: Array<{ url: string; title: string }> = [];
  for (const a of parts.flatMap((p: any) => p.annotations || [])) {
    if (a.type !== "url_citation" || !a.url) continue;
    const url = cleanCitationUrl(a.url);
    if (!citations.some((c) => c.url === url)) citations.push({ url, title: a.title || url });
  }
  const subQueries = output
    .filter((o) => o.type === "web_search_call")
    .flatMap((o) => [o.action?.query, ...(o.action?.queries || [])])
    .filter((q): q is string => typeof q === "string" && q.length > 0);
  return { responseText: text, citations, subQueries: [...new Set(subQueries)], captureMethod: "api" };
}

async function perplexityApi(query: string, key: string): Promise<Omit<EngineAnswer, "executionMs">> {
  const data = await postJson(
    "PerplexityApi",
    "https://api.perplexity.ai/chat/completions",
    { authorization: `Bearer ${key}` },
    { model: PERPLEXITY_MODEL, messages: [{ role: "user", content: query }] }
  );
  // Inline markers like [1] point into the citations list; they carry no text of their own
  const text = String(data.choices?.[0]?.message?.content || "").replace(/\[\d+\]/g, "").trim();
  const results: Array<{ url: string; title?: string }> = data.search_results || (data.citations || []).map((url: string) => ({ url }));
  const citations = results.filter((r) => r?.url).map((r) => ({ url: cleanCitationUrl(r.url), title: r.title || r.url }));
  return { responseText: text, citations, subQueries: [], captureMethod: "api" };
}

async function getJson(tag: string, url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  const text = await res.text();
  if (!res.ok) {
    const detail = text.slice(0, 300).replace(/\s+/g, " ");
    if (res.status === 429) throw new EngineBlockedError(`[${tag}] API rate limit or quota reached (429): ${detail}`);
    if (res.status === 401 || res.status === 403) throw new ApiKeyRejectedError(`[${tag}] API key rejected (${res.status}): ${detail}`);
    throw new Error(`[${tag}] API error ${res.status}: ${detail}`);
  }
  return JSON.parse(text);
}

/** Flattens SerpApi's ai_overview text blocks (paragraphs, headings, nested lists) into lines. */
function overviewText(blocks: any[]): string {
  const lines: string[] = [];
  const walk = (items: any[]) => {
    for (const b of items || []) {
      if (b.snippet) lines.push(b.title ? `${b.title}: ${b.snippet}` : b.snippet);
      else if (b.title) lines.push(b.title);
      if (Array.isArray(b.list)) walk(b.list);
      if (Array.isArray(b.text_blocks)) walk(b.text_blocks);
    }
  };
  walk(blocks);
  return lines.join("\n").trim();
}

async function serpApiOverview(query: string, key: string): Promise<Omit<EngineAnswer, "executionMs">> {
  const params = new URLSearchParams({ engine: "google", q: query, hl: "en", gl: "us", api_key: key });
  const data = await getJson("SerpApiAio", `https://serpapi.com/search.json?${params}`);
  if (data.error) throw new Error(`[SerpApiAio] ${data.error}`);
  let overview = data.ai_overview;
  // Overviews that load lazily come back as a token for a second request
  if (overview?.page_token && !overview.text_blocks) {
    const more = new URLSearchParams({ engine: "google_ai_overview", page_token: overview.page_token, api_key: key });
    overview = (await getJson("SerpApiAio", `https://serpapi.com/search.json?${more}`)).ai_overview;
  }
  if (!overview?.text_blocks?.length) throw new NoAiOverviewError(`[SerpApiAio] No AI Overview shown for "${query}"`);
  const citations = (overview.references || [])
    .filter((r: any) => r?.link)
    .map((r: any) => ({ url: cleanCitationUrl(r.link), title: r.title || r.source || r.link }));
  return { responseText: overviewText(overview.text_blocks), citations, subQueries: [], captureMethod: "api" };
}

/**
 * Google AI Mode through SerpApi (engine=google_ai_mode). The answer is reconstructed_markdown
 * when present, otherwise the typed text_blocks; references are the cited pages.
 */
interface SerpBlock {
  type?: string;
  snippet?: string;
  title?: string;
  list?: SerpBlock[];
  text_blocks?: SerpBlock[];
  rows?: string[][];
}
async function serpApiAiMode(query: string, key: string, opts: DataForSeoOptions): Promise<Omit<EngineAnswer, "executionMs">> {
  const params = new URLSearchParams({ engine: "google_ai_mode", q: query, api_key: key, hl: (opts.language || "en").slice(0, 2) });
  if (opts.location) params.set("location", opts.location);
  const data = await getJson("SerpApiAiMode", `https://serpapi.com/search.json?${params}`);
  if (data.error) throw new Error(`[SerpApiAiMode] ${data.error}`);
  const lines: string[] = [];
  const walk = (blocks: SerpBlock[] | undefined) => {
    for (const b of blocks || []) {
      if (b.snippet) lines.push(b.title ? `${b.title}: ${b.snippet}` : b.snippet);
      else if (b.title) lines.push(b.title);
      for (const row of b.rows || []) lines.push(row.join(" | "));
      walk(b.list);
      walk(b.text_blocks);
    }
  };
  walk(data.text_blocks);
  const text = (typeof data.reconstructed_markdown === "string" && data.reconstructed_markdown.trim() ? markdownToText(data.reconstructed_markdown) : lines.join("\n")).trim();
  if (!text) throw new Error(`[SerpApiAiMode] AI Mode returned no answer for "${query}"`);
  const citations = (Array.isArray(data.references) ? data.references : [])
    .filter((r: { link?: string }) => typeof r?.link === "string")
    .map((r: { link: string; title?: string; source?: string }) => ({ url: cleanCitationUrl(r.link), title: r.title || r.source || r.link }));
  return { responseText: text, citations, subQueries: [], captureMethod: "provider", provider: "serpapi" };
}

export async function runApiEngine(engine: ApiEngine, query: string, keys: ApiKeys, providerOptions: DataForSeoOptions = {}): Promise<EngineAnswer> {
  const route = apiRouteFor(engine, keys);
  if (!route) throw new ApiKeyRejectedError(`No API key saved for ${engine}`);
  const start = Date.now();
  let result: Omit<EngineAnswer, "executionMs">;
  if (route.kind === "dataforseo") {
    try {
      result = await runDataForSeo(engine, query, route.credential, providerOptions);
    } catch (err) {
      // A refused login or an empty balance stops the engine like a rejected key does
      if (err instanceof ProviderAccountError) throw new ApiKeyRejectedError(err.message);
      throw err;
    }
  } else {
    result =
      route.kind === "gemini"
        ? await geminiApi(query, route.key)
        : route.kind === "openai"
          ? await openAiApi(query, route.key)
          : route.kind === "serpapi"
            ? engine === "google_ai_mode"
              ? await serpApiAiMode(query, route.key, providerOptions)
              : await serpApiOverview(query, route.key)
            : await perplexityApi(query, route.key);
  }
  assertRealAnswer(result.responseText, `${engine}-${route.kind}`, query);
  return { ...result, executionMs: Date.now() - start };
}

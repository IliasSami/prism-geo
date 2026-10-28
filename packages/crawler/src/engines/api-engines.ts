import { EngineBlockedError, assertRealAnswer, cleanCitationUrl, type EngineAnswer } from "./browser-session";
import { NoAiOverviewError } from "./google-aio";

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
export type ApiEngine = "gemini" | "chatgpt" | "perplexity" | "google_aio";

export interface ApiKeys {
  gemini?: string;
  openai?: string;
  perplexity?: string;
  serpapi?: string;
}

/** The key that unlocks API access for an engine, or "" when none is saved. */
export function apiKeyFor(engine: string, keys: ApiKeys): string {
  if (engine === "gemini") return keys.gemini?.trim() || "";
  if (engine === "chatgpt") return keys.openai?.trim() || "";
  if (engine === "perplexity") return keys.perplexity?.trim() || "";
  if (engine === "google_aio") return keys.serpapi?.trim() || "";
  return "";
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

export async function runApiEngine(engine: ApiEngine, query: string, keys: ApiKeys): Promise<EngineAnswer> {
  const key = apiKeyFor(engine, keys);
  if (!key) throw new ApiKeyRejectedError(`No API key saved for ${engine}`);
  const start = Date.now();
  const result =
    engine === "gemini"
      ? await geminiApi(query, key)
      : engine === "chatgpt"
        ? await openAiApi(query, key)
        : engine === "google_aio"
          ? await serpApiOverview(query, key)
          : await perplexityApi(query, key);
  assertRealAnswer(result.responseText, `${engine}-api`, query);
  return { ...result, executionMs: Date.now() - start };
}

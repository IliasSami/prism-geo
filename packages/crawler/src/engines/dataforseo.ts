import { EngineBlockedError, cleanCitationUrl, type EngineAnswer } from "./browser-session";
import { NoAiOverviewError } from "./google-aio";

/**
 * DataForSEO as a capture provider (Settings → Engines, one "login:password" credential from
 * app.dataforseo.com/api-access). PrismGEO stays the analysis layer; DataForSEO returns:
 *
 * - ChatGPT and Gemini: the answer their consumer interface showed for the question
 *   (AI Optimization → LLM Scraper), stored with capture_method = 'provider';
 * - Google AI Overviews: the Overview on Google's results page (SERP API, asynchronous Overviews
 *   included), capture_method = 'provider';
 * - Perplexity: the Sonar API answer (AI Optimization → LLM Responses), capture_method = 'api'
 *   because it is a model API, not the perplexity.ai interface.
 *
 * Every failure is mapped to the same failure kinds as browser runs (blocked, no answer, no AI
 * Overview, rejected credential), so it is recorded with a reason and never filled in. The cost
 * DataForSEO reports for each task is kept with the run.
 */

export type DataForSeoEngine = "chatgpt" | "gemini" | "google_aio" | "google_ai_mode" | "perplexity";
export const DATAFORSEO_ENGINES: readonly DataForSeoEngine[] = ["google_ai_mode", "google_aio", "gemini", "chatgpt", "perplexity"];

export interface DataForSeoOptions {
  /** Location name as DataForSEO lists it, e.g. "United States", "United Kingdom". */
  location?: string;
  /** Language code, e.g. "en". */
  language?: string;
  /** Perplexity model for LLM Responses (default "sonar"). */
  perplexityModel?: string;
}

export interface DataForSeoAnswer extends Omit<EngineAnswer, "executionMs"> {
  provider: "dataforseo";
  /** Cost DataForSEO charged for this request, in USD. */
  costUsd: number;
  /** Model the provider reported (e.g. ChatGPT's search model), when it reports one. */
  model?: string;
}

/** The credential was refused or the account cannot pay for the request; retrying cannot help. */
export class ProviderAccountError extends Error {}

const BASE = (process.env.PRISMGEO_DATAFORSEO_URL || "https://api.dataforseo.com").replace(/\/$/, "");
const PATHS: Record<DataForSeoEngine, string> = {
  chatgpt: "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced",
  gemini: "/v3/ai_optimization/gemini/llm_scraper/live/advanced",
  google_aio: "/v3/serp/google/organic/live/advanced",
  google_ai_mode: "/v3/serp/google/ai_mode/live/advanced",
  perplexity: "/v3/ai_optimization/perplexity/llm_responses/live",
};

/** "login:password" as copied from DataForSEO's API access page. The login is an email, so it has no colon. */
export function parseDataForSeoCredential(value: string): { login: string; password: string } | null {
  const v = (value || "").trim();
  const i = v.indexOf(":");
  if (i <= 0 || i === v.length - 1) return null;
  return { login: v.slice(0, i).trim(), password: v.slice(i + 1).trim() };
}

/** DataForSEO status codes (docs.dataforseo.com/v3/appendix/errors) mapped to PrismGEO failure kinds. */
export function dataForSeoError(code: number, message: string, engine: DataForSeoEngine): Error {
  const text = `[DataForSEO ${engine}] ${code}: ${message}`;
  if ([40100, 40104, 40201, 40204, 40207, 40208].includes(code)) {
    return new ProviderAccountError(`${text}. Check the DataForSEO login and password in Settings → Engines.`);
  }
  if ([40200, 40203, 40210].includes(code)) return new ProviderAccountError(`${text}. Top up the DataForSEO balance or raise its cost limit.`);
  if ([40202, 40205, 40206, 40209].includes(code)) return new EngineBlockedError(`${text} (provider rate limit)`);
  if (code === 40102 && engine === "google_aio") return new NoAiOverviewError(`${text} (no results page)`);
  // 40102 elsewhere, 40103, 40106, 5xxxx: the provider could not produce an answer this time
  return new Error(text);
}

/** The keyword escaping DataForSEO asks for: % and + are reserved. */
const keyword = (q: string) => q.replace(/%/g, "%25").replace(/\+/g, "%2B");

/**
 * Markdown from the provider to the plain-text shape browser captures produce: links and images
 * reduced to their text, emphasis and heading markers removed, tables kept as "a | b" rows.
 */
export function markdownToText(md: string): string {
  return (md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    // Line-anchored patterns use [ \t]: \s would also consume the newline and merge lines
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}[^\n]*\n?/gm, "")
    .replace(/^[ \t]*\|([^\n]*)\|[ \t]*$/gm, (_m, row: string) => row.trim())
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Cite = { url: string; title: string };

/**
 * The parts of DataForSEO's documented responses PrismGEO reads. Every field is optional and is
 * checked at runtime: this is data from another service, so a missing or renamed field must
 * degrade to "no answer", never to a crash or a made-up value.
 */
interface DfsLink {
  url?: unknown;
  title?: unknown;
  source?: unknown;
  source_name?: unknown;
  domain?: unknown;
}
interface DfsNode {
  type?: unknown;
  markdown?: unknown;
  text?: unknown;
  sources?: unknown;
  references?: unknown;
  annotations?: unknown;
  components?: unknown;
  items?: unknown;
  sections?: unknown;
}
interface DfsResult extends DfsNode {
  model?: unknown;
  model_name?: unknown;
  fan_out_queries?: unknown;
}
interface DfsTask {
  status_code?: unknown;
  status_message?: unknown;
  cost?: unknown;
  result?: unknown;
}
interface DfsResponse {
  status_code?: unknown;
  status_message?: unknown;
  cost?: unknown;
  tasks?: unknown;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const firstText = (...vs: unknown[]): string => str(vs.find((v) => typeof v === "string" && v.trim()));
const strings = (v: unknown): string[] => [...new Set(list<unknown>(v).filter((q): q is string => typeof q === "string" && q.trim() !== ""))];

function addCitation(out: Cite[], seen: Set<string>, link: DfsLink | null | undefined, ...titleFields: Array<keyof DfsLink>): void {
  const url = str(link?.url);
  if (!/^https?:\/\//i.test(url)) return;
  const clean = cleanCitationUrl(url);
  if (seen.has(clean)) return;
  seen.add(clean);
  out.push({ url: clean, title: firstText(...titleFields.map((f) => link?.[f])).trim() || clean });
}

/** ChatGPT / Gemini LLM Scraper result → answer. */
export function parseLlmScraper(result: DfsResult): Omit<DataForSeoAnswer, "costUsd" | "provider"> {
  const items = list<DfsNode>(result.items);
  const markdown = str(result.markdown).trim() ? str(result.markdown) : items.map((i) => str(i.markdown)).filter(Boolean).join("\n\n");
  const citations: Cite[] = [];
  const seen = new Set<string>();
  // Sources the answer actually used, in answer order, then any listed only at the top level
  for (const item of items) for (const s of list<DfsLink>(item.sources)) addCitation(citations, seen, s, "title", "source_name", "domain");
  for (const s of list<DfsLink>(result.sources)) addCitation(citations, seen, s, "title", "source_name", "domain");
  return {
    responseText: markdownToText(markdown),
    citations,
    subQueries: strings(result.fan_out_queries),
    captureMethod: "provider",
    model: str(result.model) || undefined,
  };
}

/** Google organic SERP result → the AI Overview on it, or NoAiOverviewError when Google showed none. */
export function parseSerpAiOverview(result: DfsResult, query: string): Omit<DataForSeoAnswer, "costUsd" | "provider"> {
  const overview = list<DfsNode>(result.items).find((i) => i.type === "ai_overview");
  if (!overview) throw new NoAiOverviewError(`[DataForSEO google_aio] No AI Overview shown for "${query}"`);
  const citations: Cite[] = [];
  const seen = new Set<string>();
  const walk = (nodes: DfsNode[]) => {
    for (const n of nodes) {
      for (const r of list<DfsLink>(n.references)) addCitation(citations, seen, r, "title", "source", "domain");
      walk(list<DfsNode>(n.components));
    }
  };
  const elements = list<DfsNode>(overview.items);
  walk(elements);
  const markdown = str(overview.markdown).trim()
    ? str(overview.markdown)
    : elements.map((e) => firstText(e.markdown, e.text)).filter(Boolean).join("\n\n");
  const text = markdownToText(markdown);
  if (!text) throw new NoAiOverviewError(`[DataForSEO google_aio] The AI Overview for "${query}" had no text`);
  return { responseText: text, citations, subQueries: [], captureMethod: "provider" };
}

/**
 * Google AI Mode result → answer. DataForSEO returns it as an ai_overview item (same structure as
 * on the results page) with the cited pages also listed at the item's top level. AI Mode always
 * answers, so a missing answer is "no answer", not "no AI Overview".
 */
export function parseAiMode(result: DfsResult, query: string): Omit<DataForSeoAnswer, "costUsd" | "provider"> {
  const item = list<DfsNode>(result.items).find((i) => i.type === "ai_overview");
  if (!item) throw new Error(`[DataForSEO google_ai_mode] No extractable response for "${query}"`);
  try {
    const parsed = parseSerpAiOverview({ items: [item] }, query);
    const seen = new Set(parsed.citations.map((c) => c.url));
    for (const r of list<DfsLink>(item.references)) addCitation(parsed.citations, seen, r, "title", "source", "domain");
    return parsed;
  } catch {
    throw new Error(`[DataForSEO google_ai_mode] No extractable response for "${query}"`);
  }
}

/** Perplexity LLM Responses result → answer (Sonar API, so capture_method 'api'). */
export function parseLlmResponses(result: DfsResult): Omit<DataForSeoAnswer, "costUsd" | "provider"> {
  const sections = list<DfsNode>(result.items).flatMap((i) => list<DfsNode>(i.sections));
  const text = sections.map((s) => str(s.text)).filter(Boolean).join("\n\n");
  const citations: Cite[] = [];
  const seen = new Set<string>();
  for (const s of sections) for (const a of list<DfsLink>(s.annotations)) addCitation(citations, seen, a, "title");
  return {
    responseText: markdownToText(text),
    citations,
    subQueries: strings(result.fan_out_queries),
    captureMethod: "api",
    model: str(result.model_name) || undefined,
  };
}

function requestBody(engine: DataForSeoEngine, query: string, opts: DataForSeoOptions): Record<string, unknown> {
  const location_name = opts.location?.trim() || "United States";
  const language_code = opts.language?.trim() || "en";
  if (engine === "perplexity") {
    return { user_prompt: query.slice(0, 500), model_name: opts.perplexityModel || process.env.PRISMGEO_DATAFORSEO_PERPLEXITY_MODEL || "sonar" };
  }
  if (engine === "google_aio") {
    return { keyword: keyword(query), location_name, language_code, device: "desktop", depth: 10, load_async_ai_overview: true };
  }
  if (engine === "google_ai_mode") return { keyword: keyword(query).slice(0, 700), location_name, language_code, device: "desktop" };
  // ChatGPT decides itself whether to search, as it does for real users, so search is not forced
  return { keyword: keyword(query), location_name, language_code };
}

/** One live request to DataForSEO for `engine`. `fetchImpl` is injectable for tests. */
export async function runDataForSeo(
  engine: DataForSeoEngine,
  query: string,
  credential: string,
  opts: DataForSeoOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<DataForSeoAnswer> {
  const creds = parseDataForSeoCredential(credential);
  if (!creds) throw new ProviderAccountError("The DataForSEO credential must be login:password (Settings → Engines)");
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${PATHS[engine]}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([requestBody(engine, query, opts)]),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (err) {
    throw new Error(`[DataForSEO ${engine}] request failed: ${(err as Error).message}`);
  }
  const raw = await res.text();
  let data: DfsResponse;
  try {
    data = JSON.parse(raw) as DfsResponse;
  } catch {
    if (res.status === 401) throw dataForSeoError(40100, "unauthorized", engine);
    if (res.status === 402) throw dataForSeoError(40200, "payment required", engine);
    throw new Error(`[DataForSEO ${engine}] HTTP ${res.status}: ${raw.slice(0, 200).replace(/\s+/g, " ")}`);
  }
  if (data.status_code !== 20000) throw dataForSeoError(Number(data.status_code) || res.status * 100, str(data.status_message) || res.statusText, engine);
  const task = list<DfsTask>(data.tasks)[0];
  if (!task) throw new Error(`[DataForSEO ${engine}] response had no task`);
  if (task.status_code !== 20000) throw dataForSeoError(Number(task.status_code), str(task.status_message), engine);
  const result = list<DfsResult>(task.result)[0];
  if (!result) {
    if (engine === "google_aio") throw new NoAiOverviewError(`[DataForSEO google_aio] No results page for "${query}"`);
    throw new Error(`[DataForSEO ${engine}] task returned no result`);
  }
  const parsed =
    engine === "google_aio"
      ? parseSerpAiOverview(result, query)
      : engine === "google_ai_mode"
        ? parseAiMode(result, query)
        : engine === "perplexity"
          ? parseLlmResponses(result)
          : parseLlmScraper(result);
  const costUsd = Number(task.cost ?? data.cost ?? 0);
  return { ...parsed, provider: "dataforseo", costUsd: Number.isFinite(costUsd) ? costUsd : 0 };
}

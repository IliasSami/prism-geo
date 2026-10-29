import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { getRawDb, getDbPath, getActiveBrand, getAllBrands, getSettings, setSettings, loadReportInput, type BrandRecord } from "@prismgeo/db";
import { buildVisibilityReport } from "@prismgeo/core";
import crypto from "node:crypto";
import pkg from "../package.json";
import { MAX_ROWS, runGuardedQuery } from "./sql";

/**
 * PrismGEO's Claude connector: an MCP server exposing the workspace's real crawl data (answers,
 * citations, mentions, failures) and its main actions (prompts, competitors, crawls) as tools.
 *
 * It is the supported way to use PrismGEO from a Claude Pro/Max account: Claude Desktop runs it
 * as a local connector (stdio), and Claude Code or a tunnelled claude.ai custom connector reach
 * it over HTTP at /api/mcp. Claude then does the analysis and writing; PrismGEO supplies data.
 * Every number returned is computed from stored runs; nothing is estimated or filled in.
 */

/**
 * Secret required by the HTTP endpoint (/api/mcp). The web app listens on all interfaces, so
 * without it anyone on the local network could drive the workspace. Created on first use.
 */
export function getConnectorToken(): string {
  const existing = getSettings<string>("mcp_connector_token", "");
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString("base64url");
  setSettings("mcp_connector_token", token);
  return token;
}

/** Where the stdio connector reaches the running web app (start_crawl). Follows PRISMGEO_PORT. */
const APP_URL = (process.env.PRISMGEO_URL || `http://127.0.0.1:${process.env.PRISMGEO_PORT || 3333}`).replace(/\/$/, "");

export interface StartCrawlArgs {
  brandId: string;
  engines?: string[];
  sampleSize: number;
  promptLimit?: number;
}

export interface PrismMcpOptions {
  /**
   * Starts a crawl in this process. The web app's /api/mcp route passes it, so start_crawl acts on
   * the server that received the call. Without it (the stdio connector), start_crawl posts to the
   * running app at PRISMGEO_URL. It returns the response body, or throws with a readable message.
   */
  startCrawl?: (args: StartCrawlArgs) => Promise<unknown> | unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are plain SQLite values read by column name
type Row = Record<string, any>;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function resolveBrand(brandId?: string): BrandRecord {
  const brand = brandId ? getAllBrands().find((b) => b.id === brandId || b.slug === brandId) : getActiveBrand();
  if (!brand) throw new Error(brandId ? `No brand with id or slug "${brandId}"` : "No active brand. Run the PrismGEO setup wizard first.");
  return brand;
}

const all = (sql: string, ...params: SQLInputValue[]) => getRawDb().prepare(sql).all(...params) as Row[];
const get = (sql: string, ...params: SQLInputValue[]) => getRawDb().prepare(sql).get(...params) as Row | undefined;

let readOnlyDb: DatabaseSync | null = null;
function readOnly(): DatabaseSync {
  if (!readOnlyDb) readOnlyDb = new DatabaseSync(getDbPath(), { readOnly: true });
  return readOnlyDb;
}

const brandArg = { brand_id: z.string().optional().describe("Brand id or slug; defaults to the active brand") };
const ENGINES = ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"] as const;

async function callApp(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  } catch {
    throw new Error(`PrismGEO is not reachable at ${APP_URL}. Start it with "pnpm dev" in the PrismGEO folder.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `PrismGEO returned ${res.status}`);
  return body;
}

export function createPrismMcpServer(options: PrismMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: "prismgeo", version: pkg.version },
    {
      instructions:
        "PrismGEO tracks how AI answer engines (ChatGPT, Perplexity, Gemini, Google AI Overviews, Copilot) mention and cite a brand versus its competitors. " +
        "Start with get_workspace_overview, then get_visibility_report. Use list_runs/get_run to read the actual answers behind any number. " +
        "Failures (blocked, rate-limited, no AI Overview) are reported separately and are never counted as answers. " +
        "Runs have a capture_method: 'browser' (logged-out consumer app), 'browser_signed_in' or 'api'. Small samples are noisy: always state run counts.",
    }
  );

  server.registerTool(
    "get_workspace_overview",
    {
      title: "Workspace overview",
      description: "Tracked brands, the selected brand's profile, competitors, prompt counts, engine settings and recent crawl batches.",
      inputSchema: brandArg,
      annotations: { readOnlyHint: true },
    },
    async ({ brand_id }) => {
      const brand = resolveBrand(brand_id);
      const keys = getSettings<Record<string, string>>("byok_api_keys", {});
      return json({
        brands: getAllBrands().map((b) => ({ id: b.id, slug: b.slug, name: b.name, domain: b.domain, active: b.id === getActiveBrand()?.id })),
        brand: {
          id: brand.id,
          name: brand.name,
          domain: brand.domain,
          description: brand.description,
          category: brand.category,
          aliases: JSON.parse(brand.aliasesJson || "[]"),
          valueProps: JSON.parse(brand.valuePropsJson || "[]"),
        },
        competitors: all("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ?", brand.id).map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          aliases: JSON.parse(c.aliases_json || "[]"),
        })),
        prompts: get("SELECT COUNT(*) AS total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active FROM prompts WHERE brand_id = ?", brand.id),
        engineSettings: getSettings("engine_settings", {}),
        apiKeysSaved: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Boolean(v)])),
        recentBatches: all(
          "SELECT id, status, sample_size, total_runs, completed_runs, failed_runs, current_prompt AS summary, created_at, finished_at FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT 5",
          brand.id
        ),
      });
    }
  );

  server.registerTool(
    "get_visibility_report",
    {
      title: "Visibility report",
      description:
        "Measured visibility from stored runs: per engine run counts and brand mention/citation rates, every tracked entity's mention rate, average position and stance, " +
        "top cited domains, and per-prompt brand presence. Optionally limited to one engine or one batch.",
      inputSchema: {
        ...brandArg,
        engine: z.enum(ENGINES).optional(),
        batch_id: z.string().optional().describe("Only runs from this crawl batch"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ brand_id, engine, batch_id }) => {
      const brand = resolveBrand(brand_id);
      const where = ["r.brand_id = ?"];
      const params: SQLInputValue[] = [brand.id];
      if (engine) {
    where.push("r.engine = ?");
    params.push(engine);
  }
      if (batch_id) {
    where.push("r.batch_id = ?");
    params.push(batch_id);
  }
      const W = where.join(" AND ");
      const totalRuns = Number(get(`SELECT COUNT(*) AS n FROM prompt_runs r WHERE ${W}`, ...params)?.n || 0);
      if (totalRuns === 0) return json({ brand: brand.name, totalRuns: 0, note: "No captured runs match. Start a crawl with start_crawl." });

      const byEngine = all(
        `SELECT r.engine, COUNT(*) AS runs,
           SUM(EXISTS(SELECT 1 FROM entity_mentions m WHERE m.run_id = r.id AND m.is_target_brand = 1)) AS brand_mentioned_runs,
           SUM(EXISTS(SELECT 1 FROM citations c WHERE c.run_id = r.id AND c.is_brand_domain = 1)) AS brand_cited_runs,
           SUM(EXISTS(SELECT 1 FROM citations c WHERE c.run_id = r.id)) AS runs_with_any_citation
         FROM prompt_runs r WHERE ${W} GROUP BY r.engine`,
        ...params
      );
      const entities = all(
        `SELECT m.entity_name AS entity, MAX(m.is_target_brand) AS is_target, COUNT(DISTINCT m.run_id) AS runs_mentioned,
           ROUND(AVG(m.position_rank), 2) AS avg_position, ROUND(AVG(m.prominence_score), 3) AS avg_prominence,
           SUM(m.sentiment = 'positive') AS positive, SUM(m.sentiment = 'neutral') AS neutral, SUM(m.sentiment = 'negative') AS negative
         FROM entity_mentions m JOIN prompt_runs r ON r.id = m.run_id WHERE ${W} GROUP BY m.entity_name ORDER BY runs_mentioned DESC`,
        ...params
      ).map((e) => ({ ...e, mention_rate: +(e.runs_mentioned / totalRuns).toFixed(3) }));
      const topDomains = all(
        `SELECT c.domain, COUNT(*) AS citations, COUNT(DISTINCT c.run_id) AS runs, MAX(c.is_brand_domain) AS is_brand, MAX(c.is_competitor_domain) AS is_competitor
         FROM citations c JOIN prompt_runs r ON r.id = c.run_id WHERE ${W} GROUP BY c.domain ORDER BY runs DESC, citations DESC LIMIT 25`,
        ...params
      );
      const prompts = all(
        `SELECT p.id, p.query_text, p.intent_type AS intent, COUNT(r.id) AS runs,
           SUM(EXISTS(SELECT 1 FROM entity_mentions m WHERE m.run_id = r.id AND m.is_target_brand = 1)) AS brand_mentioned_runs,
           SUM(EXISTS(SELECT 1 FROM citations c WHERE c.run_id = r.id AND c.is_brand_domain = 1)) AS brand_cited_runs
         FROM prompts p JOIN prompt_runs r ON r.prompt_id = p.id WHERE ${W} GROUP BY p.id ORDER BY brand_mentioned_runs DESC, runs DESC`,
        ...params
      );
      const methods = all(`SELECT r.capture_method, COUNT(*) AS runs FROM prompt_runs r WHERE ${W} GROUP BY r.capture_method`, ...params);
      // The dashboard's own numbers (unbranded answers only, prompt-clustered ranges, per-entity
      // denominators), so Claude and the dashboard never disagree. The raw* fields below count every
      // stored answer, branded prompts included, and are only for drilling into specifics.
      const report = buildVisibilityReport(loadReportInput(brand.id));
      const dashboard = {
        note: "Headline numbers as shown in the PrismGEO dashboard. Unbranded questions only; percentages are means over questions with 95% ranges.",
        totalQuestions: report.totalQuestions,
        totalAnswers: report.totalAnswers,
        answersWithSources: report.answersWithSources,
        headline: report.headline,
        branded: report.branded,
        entities: engine ? (report.entitiesByEngine[engine] ?? []) : report.entities,
        engines: report.engines,
        coverage: report.coverage,
        captureMethods: report.captureMethods,
        aioTrigger: report.aioTrigger,
        brandAccuracy: report.brandAccuracy,
        failures: report.failures,
        topSources: report.topSources.slice(0, 15),
      };
      return json({
        brand: brand.name,
        domain: brand.domain,
        dashboard: batch_id ? undefined : dashboard,
        rawTotalRuns: totalRuns,
        rawCaptureMethods: methods,
        rawByEngine: byEngine,
        rawEntities: entities,
        rawTopCitedDomains: topDomains,
        rawPrompts: prompts,
      });
    }
  );

  server.registerTool(
    "list_runs",
    {
      title: "List captured answers",
      description: "Captured engine answers (newest first) with an excerpt, the tracked entities mentioned and cited domains. Filter by engine, prompt, batch or brand presence.",
      inputSchema: {
        ...brandArg,
        engine: z.enum(ENGINES).optional(),
        prompt_id: z.string().optional(),
        batch_id: z.string().optional(),
        brand_mentioned: z.boolean().optional().describe("true: only runs naming the brand; false: only runs that do not"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ brand_id, engine, prompt_id, batch_id, brand_mentioned, limit }) => {
      const brand = resolveBrand(brand_id);
      const where = ["r.brand_id = ?"];
      const params: SQLInputValue[] = [brand.id];
      if (engine) {
    where.push("r.engine = ?");
    params.push(engine);
  }
      if (prompt_id) {
    where.push("r.prompt_id = ?");
    params.push(prompt_id);
  }
      if (batch_id) {
    where.push("r.batch_id = ?");
    params.push(batch_id);
  }
      if (brand_mentioned !== undefined) {
        where.push(`${brand_mentioned ? "" : "NOT "}EXISTS(SELECT 1 FROM entity_mentions m WHERE m.run_id = r.id AND m.is_target_brand = 1)`);
      }
      const runs = all(
        `SELECT r.id, r.engine, r.capture_method, r.created_at, r.execution_ms, p.query_text AS prompt, substr(r.response_text, 1, 400) AS excerpt
         FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT ?`,
        ...params,
        limit
      );
      for (const run of runs) {
        run.mentions = all("SELECT entity_name, position_rank, sentiment FROM entity_mentions WHERE run_id = ? ORDER BY position_rank", run.id);
        run.cited_domains = all("SELECT DISTINCT domain FROM citations WHERE run_id = ? ORDER BY rank", run.id).map((c) => c.domain);
      }
      return json(runs);
    }
  );

  server.registerTool(
    "get_run",
    {
      title: "Get one answer",
      description: "The full stored answer for a run, with its citations, entity mentions, reverse-RAG matched source passages and the search queries the engine issued (when observable).",
      inputSchema: { run_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ run_id }) => {
      const run = get(
        "SELECT r.*, p.query_text AS prompt, p.intent_type AS intent FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id WHERE r.id = ?",
        run_id
      );
      if (!run) return fail(`No run ${run_id}`);
      return json({
        id: run.id,
        engine: run.engine,
        captureMethod: run.capture_method,
        prompt: run.prompt,
        intent: run.intent,
        createdAt: run.created_at,
        answer: run.response_text,
        searchQueries: JSON.parse(run.sub_queries_json || "[]"),
        citations: all("SELECT rank, domain, url, title, is_brand_domain, is_competitor_domain FROM citations WHERE run_id = ? ORDER BY rank", run_id),
        mentions: all("SELECT entity_name, is_target_brand, position_rank, prominence_score, sentiment FROM entity_mentions WHERE run_id = ? ORDER BY position_rank", run_id),
        matchedSourcePassages: all("SELECT source_url, similarity_score, matched_chunk_text FROM reverse_rag_chunks WHERE run_id = ? ORDER BY similarity_score DESC", run_id),
      });
    }
  );

  server.registerTool(
    "get_crawl_status",
    {
      title: "Crawl status",
      description: "Status of a crawl batch (default: the latest): progress, and every failed run grouped by engine and reason.",
      inputSchema: { ...brandArg, batch_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ brand_id, batch_id }) => {
      const brand = resolveBrand(brand_id);
      const batch = batch_id
        ? get("SELECT * FROM crawl_batches WHERE id = ?", batch_id)
        : get("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1", brand.id);
      if (!batch) return fail("No crawl batches yet");
      const failures: Array<{ engine: string; kind: string; message: string }> = JSON.parse(batch.errors_json || "[]");
      const grouped: Record<string, { count: number; example: string }> = {};
      for (const f of failures) {
        const k = `${f.engine} ${f.kind}`;
        grouped[k] = grouped[k] ? { ...grouped[k], count: grouped[k].count + 1 } : { count: 1, example: f.message };
      }
      return json({
        id: batch.id,
        status: batch.status,
        summary: batch.current_prompt,
        currentEngine: batch.current_engine,
        totalRuns: batch.total_runs,
        completedRuns: batch.completed_runs,
        failedRuns: batch.failed_runs,
        failures: grouped,
        createdAt: batch.created_at,
        finishedAt: batch.finished_at,
      });
    }
  );

  server.registerTool(
    "start_crawl",
    {
      title: "Start a crawl",
      description:
        "Starts a crawl batch in the running PrismGEO app, querying the selected engines with the brand's active prompts. Returns the batch id; poll get_crawl_status. " +
        "Browser crawls are paced (several seconds per query per engine), so a batch can take many minutes.",
      inputSchema: {
        ...brandArg,
        engines: z.array(z.enum(ENGINES)).min(1).optional().describe("Defaults to the engines enabled in Settings"),
        sample_size: z.number().int().min(1).max(20).default(1).describe("Runs per prompt per engine"),
        prompt_limit: z.number().int().min(1).optional().describe("Only the first N active prompts"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ brand_id, engines, sample_size, prompt_limit }) => {
      const brand = resolveBrand(brand_id);
      try {
        const args: StartCrawlArgs = { brandId: brand.id, engines, sampleSize: sample_size, promptLimit: prompt_limit };
        const res = options.startCrawl
          ? await options.startCrawl(args)
          : await callApp("/api/crawl/start", { method: "POST", body: JSON.stringify(args) });
        return json(res);
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.registerTool(
    "list_prompts",
    {
      title: "List prompts",
      description: "The brand's tracked prompts with intent, active flag and how many runs each has.",
      inputSchema: brandArg,
      annotations: { readOnlyHint: true },
    },
    async ({ brand_id }) => {
      const brand = resolveBrand(brand_id);
      return json(
        all(
          "SELECT p.id, p.query_text, p.intent_type AS intent, p.active, (SELECT COUNT(*) FROM prompt_runs r WHERE r.prompt_id = p.id) AS runs FROM prompts p WHERE p.brand_id = ? ORDER BY p.created_at",
          brand.id
        )
      );
    }
  );

  server.registerTool(
    "add_prompts",
    {
      title: "Add prompts",
      description: "Adds prompts (questions buyers ask AI assistants) to the brand's tracked set. Exact duplicates are skipped.",
      inputSchema: {
        ...brandArg,
        prompts: z.array(z.string().trim().min(5).max(500)).min(1).max(50),
        intent: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .default("category")
          .describe("Intent label, e.g. category, dilemma, comparison, alternatives, pricing, risk, direct (direct = names the brand)"),
        persona: z.string().trim().min(1).max(40).default("buyer").describe("Who asks it, e.g. founder, ecom_director, head_of_growth"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ brand_id, prompts, intent, persona }) => {
      const brand = resolveBrand(brand_id);
      const sqlite = getRawDb();
      const existing = new Set(all("SELECT lower(query_text) AS q FROM prompts WHERE brand_id = ?", brand.id).map((r) => r.q));
      const insert = sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active) VALUES (?, ?, ?, ?, ?, 1)");
      const added: string[] = [];
      for (const text of prompts) {
        if (existing.has(text.toLowerCase())) continue;
        insert.run(`prm-${crypto.randomBytes(6).toString("hex")}`, brand.id, text, intent, persona);
        existing.add(text.toLowerCase());
        added.push(text);
      }
      return json({ added: added.length, skippedDuplicates: prompts.length - added.length, prompts: added });
    }
  );

  server.registerTool(
    "set_prompt_active",
    {
      title: "Pause or resume a prompt",
      description: "Inactive prompts keep their history but are not crawled.",
      inputSchema: { prompt_id: z.string(), active: z.boolean() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ prompt_id, active }) => {
      const res = getRawDb().prepare("UPDATE prompts SET active = ? WHERE id = ?").run(active ? 1 : 0, prompt_id);
      return res.changes ? json({ prompt_id, active }) : fail(`No prompt ${prompt_id}`);
    }
  );

  server.registerTool(
    "add_competitor",
    {
      title: "Add competitor",
      description: "Tracks a new competitor (name, domain and the other names AI answers use for it) for the brand.",
      inputSchema: {
        ...brandArg,
        name: z.string().trim().min(2).max(120),
        domain: z.string().min(3).max(253).describe("e.g. example.com"),
        aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ brand_id, name, domain, aliases }) => {
      const brand = resolveBrand(brand_id);
      const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
      // Same rule as the dashboard's competitor form
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) return fail(`"${domain}" is not a domain like example.com`);
      if (clean === brand.domain) return fail(`${clean} is ${brand.name}'s own domain, not a competitor`);
      if (get("SELECT id FROM competitors WHERE brand_id = ? AND lower(domain) = ?", brand.id, clean)) return fail(`${clean} is already tracked`);
      const id = `cmp-${crypto.randomBytes(6).toString("hex")}`;
      getRawDb()
        .prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES (?, ?, ?, ?, ?)")
        .run(id, brand.id, name, clean, JSON.stringify(aliases));
      return json({ id, name, domain: clean, aliases, note: "Mentions are detected in future crawls; past runs are not re-scored." });
    }
  );

  server.registerTool(
    "query_database",
    {
      title: "Read-only SQL",
      description:
        "Runs one read-only SQLite SELECT (or WITH) statement against the PrismGEO database for analysis the other tools do not cover. " +
        "Tables: brands, competitors, prompts, crawl_batches, prompt_runs, citations, entity_mentions, reverse_rag_chunks. " +
        `Call describe_database first for the columns. Returns at most ${MAX_ROWS} rows and stops after a few seconds: aggregate in SQL and use LIMIT.`,
      inputSchema: { sql: z.string().min(6).max(20_000) },
      annotations: { readOnlyHint: true },
    },
    async ({ sql }) => {
      const result = await runGuardedQuery(readOnly(), getDbPath(), sql);
      if (!result.ok) return fail(result.error);
      return json({
        rowCount: result.rowCount,
        rows: result.rows,
        truncated: result.truncated,
        ...(result.timedOut ? { note: "Stopped early at the time budget; the rows above are partial. Add a LIMIT or a narrower WHERE." } : {}),
      });
    }
  );

  server.registerTool(
    "describe_database",
    {
      title: "Describe database",
      description: "Column names and types of every PrismGEO table, for writing query_database SQL.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name as string);
      return json(
        Object.fromEntries(
          tables
            .filter((t) => t !== "system_settings") // holds API keys
            .map((t) => [t, all(`PRAGMA table_info(${t})`).map((c) => `${c.name} ${c.type}`)])
        )
      );
    }
  );

  return server;
}

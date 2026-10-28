import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { runMigrations } from "./migrations";

/** Owner-only permissions: the database holds API keys, the connector token and browser cookies. */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Creates a directory with mode 0700 (and tightens it if this process owns it). */
export function ensurePrivateDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    return;
  }
  try {
    const st = fs.statSync(dir);
    if (typeof process.getuid === "function" && st.uid === process.getuid() && (st.mode & 0o077) !== 0) fs.chmodSync(dir, PRIVATE_DIR_MODE);
  } catch (err) {
    console.warn(`[PrismGEO DB] Could not restrict permissions of ${dir}: ${(err as Error).message}`);
  }
}

/** Sets 0600 on a file this process owns, if it exists. */
export function restrictFile(file: string): void {
  try {
    if (fs.existsSync(file)) fs.chmodSync(file, PRIVATE_FILE_MODE);
  } catch (err) {
    console.warn(`[PrismGEO DB] Could not restrict permissions of ${file}: ${(err as Error).message}`);
  }
}

export function getDbPath(): string {
  if (process.env.PRISMGEO_DB_PATH) {
    return process.env.PRISMGEO_DB_PATH;
  }
  // Search upwards for repository/workspace root containing data/prismgeo.db
  let curr = process.cwd();
  let rootDataCandidate: string | null = null;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(curr, "data", "prismgeo.db");
    const hasWorkspace = fs.existsSync(path.join(curr, "pnpm-workspace.yaml")) || fs.existsSync(path.join(curr, ".git"));
    if (hasWorkspace) {
      return candidate; // Found canonical workspace root database
    }
    if (fs.existsSync(candidate) && !rootDataCandidate) {
      rootDataCandidate = candidate;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  if (rootDataCandidate) return rootDataCandidate;
  const defaultDir = path.resolve(process.cwd(), "data");
  ensurePrivateDir(defaultDir);
  return path.join(defaultDir, "prismgeo.db");
}

/**
 * Opens a database file with PrismGEO's pragmas, brings its schema up to date (see
 * migrations.ts) and restricts the file permissions. Not cached; use getRawDb() in the app.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") ensurePrivateDir(path.dirname(dbPath));
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const result = runMigrations(sqlite, dbPath);
  if (result.applied.length > 0) console.log(`[PrismGEO DB] Schema v${result.from} -> v${result.to}: ${result.applied.join("; ")}`);
  if (dbPath !== ":memory:") for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) restrictFile(f);
  return sqlite;
}

/**
 * One connection per process. It lives on globalThis because Next.js evaluates this module once
 * per route bundle and again on every dev hot reload; a module-level cache leaked a new file
 * handle (and re-ran migrations) each time.
 */
const g = globalThis as typeof globalThis & { __prismDb?: DatabaseSync };
let _db: DatabaseSync | null = g.__prismDb ?? null;

export function getRawDb(customPath?: string): DatabaseSync {
  if (_db) return _db;
  const sqlite = openDatabase(customPath || getDbPath());
  _db = sqlite;
  g.__prismDb = sqlite;
  return sqlite;
}

/** ISO-8601 UTC timestamp, the one format PrismGEO writes. */
export const nowIso = () => new Date().toISOString();

// Type definitions matching schema
export interface BrandRecord {
  id: string;
  slug: string;
  name: string;
  domain: string;
  description: string | null;
  /** Short product category ("AI voice agent for cart recovery"); null when not set. */
  category: string | null;
  aliasesJson: string;
  valuePropsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorRecord {
  id: string;
  brandId: string;
  name: string;
  domain: string;
  aliasesJson: string;
  active: boolean;
  createdAt: string;
}

export interface PromptRecord {
  id: string;
  brandId: string;
  queryText: string;
  intentType: string;
  personaDimension: string;
  active: boolean;
  createdAt: string;
}

export interface CrawlBatchRecord {
  id: string;
  brandId: string;
  status: string;
  sampleSize: number;
  totalRuns: number;
  completedRuns: number;
  currentPrompt: string | null;
  currentEngine: string | null;
  failedRuns: number;
  errorsJson: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface PromptRunRecord {
  id: string;
  brandId: string;
  batchId: string;
  promptId: string;
  engine: string;
  runIndex: number;
  responseText: string;
  subQueriesJson: string;
  promptTokens: number | null;
  executionMs: number;
  /** How the answer was obtained: 'browser' (logged-out), 'browser_signed_in' or 'api'. */
  captureMethod: string;
  /** JSON object of quality flags, e.g. {"entityConfusion":{"lookalikeDomains":["northwindvoiceai.com"]}}. */
  flagsJson: string;
  createdAt: string;
}

export interface CitationRecord {
  id: string;
  brandId: string;
  runId: string;
  domain: string;
  url: string;
  title: string | null;
  snippet: string | null;
  anchorText: string | null;
  rank: number;
  isBrandDomain: boolean;
  isCompetitorDomain: boolean;
  createdAt: string;
}

export interface EntityMentionRecord {
  id: string;
  brandId: string;
  runId: string;
  /** Competitor row id (null for the target brand, or for a competitor deleted since). */
  competitorId: string | null;
  entityName: string;
  isTargetBrand: boolean;
  isCompetitor: boolean;
  /** The prompt itself names the entity (an echo); null for rows stored before this was recorded. */
  isPromptSubject: boolean | null;
  sentiment: string;
  /** recommended_primary | recommended_alternative | neutral | warning_caution; null for old rows. */
  stance: string | null;
  hasCaveat: boolean;
  prominenceScore: number;
  /** Order of first mention among non-echo tracked entities; null for echoes. */
  positionRank: number | null;
  /** Index of the list item / table row naming the entity, when the answer is a list. */
  listPosition: number | null;
  /** The answer cites or names a look-alike of the brand's domain. */
  entityConfusion: boolean;
  createdAt: string;
}

export interface OpportunityRecord {
  id: string;
  brandId: string;
  title: string;
  subQueryTarget: string;
  gapType: string;
  recommendedAction: string;
  estimatedImpact: string;
  status: string;
  createdAt: string;
}

type Row = Record<string, any>;

export function rowToBrand(row: Row): BrandRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    description: row.description,
    category: row.category ?? null,
    aliasesJson: row.aliases_json,
    valuePropsJson: row.value_props_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const rowToCompetitor = (r: Row): CompetitorRecord => ({
  id: r.id,
  brandId: r.brand_id,
  name: r.name,
  domain: r.domain,
  aliasesJson: r.aliases_json,
  active: Boolean(r.active),
  createdAt: r.created_at,
});

const rowToPrompt = (r: Row): PromptRecord => ({
  id: r.id,
  brandId: r.brand_id,
  queryText: r.query_text,
  intentType: r.intent_type,
  personaDimension: r.persona_dimension,
  active: Boolean(r.active),
  createdAt: r.created_at,
});

const rowToBatch = (r: Row): CrawlBatchRecord => ({
  id: r.id,
  brandId: r.brand_id,
  status: r.status,
  sampleSize: r.sample_size,
  totalRuns: r.total_runs ?? 0,
  completedRuns: r.completed_runs,
  currentPrompt: r.current_prompt ?? null,
  currentEngine: r.current_engine ?? null,
  failedRuns: r.failed_runs ?? 0,
  errorsJson: r.errors_json ?? "[]",
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

const rowToRun = (r: Row): PromptRunRecord => ({
  id: r.id,
  brandId: r.brand_id,
  batchId: r.batch_id,
  promptId: r.prompt_id,
  engine: r.engine,
  runIndex: r.run_index,
  responseText: r.response_text,
  subQueriesJson: r.sub_queries_json,
  promptTokens: r.prompt_tokens,
  executionMs: r.execution_ms,
  captureMethod: r.capture_method ?? "browser",
  flagsJson: r.flags_json ?? "{}",
  createdAt: r.created_at,
});

const rowToCitation = (r: Row): CitationRecord => ({
  id: r.id,
  brandId: r.brand_id,
  runId: r.run_id,
  domain: r.domain,
  url: r.url,
  title: r.title,
  snippet: r.snippet,
  anchorText: r.anchor_text,
  rank: r.rank,
  isBrandDomain: Boolean(r.is_brand_domain),
  isCompetitorDomain: Boolean(r.is_competitor_domain),
  createdAt: r.created_at,
});

const rowToMention = (r: Row): EntityMentionRecord => ({
  id: r.id,
  brandId: r.brand_id,
  runId: r.run_id,
  competitorId: r.competitor_id ?? null,
  entityName: r.entity_name,
  isTargetBrand: Boolean(r.is_target_brand),
  isCompetitor: Boolean(r.is_competitor),
  isPromptSubject: r.is_prompt_subject === null || r.is_prompt_subject === undefined ? null : Boolean(r.is_prompt_subject),
  sentiment: r.sentiment,
  stance: r.stance ?? null,
  hasCaveat: Boolean(r.has_caveat),
  prominenceScore: r.prominence_score,
  positionRank: r.position_rank ?? null,
  listPosition: r.list_position ?? null,
  entityConfusion: Boolean(r.entity_confusion),
  createdAt: r.created_at,
});

const rowToOpportunity = (r: Row): OpportunityRecord => ({
  id: r.id,
  brandId: r.brand_id,
  title: r.title,
  subQueryTarget: r.sub_query_target,
  gapType: r.gap_type,
  recommendedAction: r.recommended_action,
  estimatedImpact: r.estimated_impact,
  status: r.status,
  createdAt: r.created_at,
});

export function getActiveBrand(): BrandRecord | undefined {
  const sqlite = getRawDb();
  const setting = sqlite.prepare("SELECT value_json FROM system_settings WHERE key = 'active_brand_id'").get() as Row | undefined;
  if (setting) {
    let brandId: unknown = null;
    try {
      brandId = JSON.parse(setting.value_json);
    } catch {
      console.warn("[PrismGEO DB] Ignoring an unreadable active_brand_id setting");
    }
    if (typeof brandId === "string") {
      const row = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId) as Row | undefined;
      if (row) return rowToBrand(row);
    }
  }
  const defaultRow = sqlite.prepare("SELECT * FROM brands ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined;
  return defaultRow ? rowToBrand(defaultRow) : undefined;
}

export function setActiveBrand(brandId: string): void {
  getRawDb()
    .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('active_brand_id', ?, ?)")
    .run(JSON.stringify(brandId), nowIso());
}

export function getAllBrands(): BrandRecord[] {
  return (getRawDb().prepare("SELECT * FROM brands ORDER BY name ASC").all() as Row[]).map(rowToBrand);
}

/** A client could not be created or changed because it conflicts with an existing one. */
export class BrandConflictError extends Error {
  readonly field: "domain" | "slug" | "name";
  constructor(field: "domain" | "slug" | "name", message: string) {
    super(message);
    this.field = field;
  }
}

/** A brand/competitor domain was not a valid host name. */
export class InvalidDomainError extends Error {}

/** "https://www.Example.com:443/x" -> "example.com". Throws InvalidDomainError for anything that is not a host name. */
export function normalizeBrandDomain(raw: string): string {
  const host = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new InvalidDomainError(`"${raw}" is not a valid domain. Enter a domain like example.com.`);
  }
  return host;
}

export function slugify(name: string): string {
  return (
    String(name || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "client"
  );
}

/**
 * Creates a client. The slug is `<name>-<short id>`, so two clients may share a name; a second
 * client with the same domain is refused with a BrandConflictError carrying a readable message.
 */
export function createBrand(data: { name: string; domain: string; description?: string; category?: string; aliases?: string[]; valueProps?: string[] }): BrandRecord {
  const sqlite = getRawDb();
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Enter a client name.");
  const domain = normalizeBrandDomain(data.domain);
  const existing = sqlite.prepare("SELECT name FROM brands WHERE domain = ?").get(domain) as Row | undefined;
  if (existing) throw new BrandConflictError("domain", `A client with the domain ${domain} already exists (${existing.name}).`);
  const shortId = crypto.randomBytes(3).toString("hex");
  const slug = `${slugify(name)}-${shortId}`;
  const id = `brand-${slug}`;
  const aliasesJson = JSON.stringify((data.aliases || []).filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()));
  const valuePropsJson = JSON.stringify((data.valueProps || []).filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()));
  const now = nowIso();
  const category = typeof data.category === "string" && data.category.trim() ? data.category.trim().slice(0, 120) : null;
  try {
    sqlite
      .prepare(
        `INSERT INTO brands (id, slug, name, domain, description, category, aliases_json, value_props_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, slug, name, domain, data.description || "", category, aliasesJson, valuePropsJson, now, now);
  } catch (err) {
    const msg = (err as Error).message;
    if (/UNIQUE constraint failed: brands\.domain/.test(msg)) throw new BrandConflictError("domain", `A client with the domain ${domain} already exists.`);
    if (/UNIQUE constraint failed: brands\.(slug|id)/.test(msg)) throw new BrandConflictError("slug", "Could not create the client, please try again.");
    throw err;
  }
  return { id, slug, name, domain, description: data.description || null, category, aliasesJson, valuePropsJson, createdAt: now, updatedAt: now };
}

export function getSettings<T>(key: string, defaultValue: T): T {
  const row = getRawDb().prepare("SELECT value_json FROM system_settings WHERE key = ?").get(key) as Row | undefined;
  if (!row || !row.value_json) return defaultValue;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    console.warn(`[PrismGEO DB] Setting "${key}" is not valid JSON; using the default`);
    return defaultValue;
  }
}

export function setSettings<T>(key: string, value: T): void {
  getRawDb()
    .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), nowIso());
}

// ---------------------------------------------------------------- Drizzle-like query shim
//
// A small subset of the Drizzle API used by a few call sites. Filters are explicit: each finder
// names the keys it understands, and any other key (or a missing scope on brand-owned tables)
// throws, so a typo can never silently return every client's rows.

/** Thrown when a query-shim call uses a filter the shim does not implement. */
export class UnsupportedFilterError extends Error {}

const camelToSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Recognised filter values by snake_case column. Throws on any other key. */
function filterOf(table: string, where: unknown, allowed: string[]): Record<string, unknown> {
  if (where === undefined || where === null) return {};
  if (typeof where !== "object" || Array.isArray(where)) throw new UnsupportedFilterError(`db.query.${table}: "where" must be an object from eq()`);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    const col = camelToSnake(key);
    if (!allowed.includes(col)) {
      throw new UnsupportedFilterError(`db.query.${table}: unsupported filter "${key}" (supported: ${allowed.join(", ")}). Use getRawDb() with SQL for other queries.`);
    }
    if (value === undefined) throw new UnsupportedFilterError(`db.query.${table}: filter "${key}" is undefined`);
    out[col] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  return out;
}

/** Builds "WHERE a = ? AND b = ?" from a filter; `required` lists columns of which one must be present. */
function whereSql(table: string, filter: Record<string, unknown>, required: string[] = []): { sql: string; params: any[] } {
  if (required.length && !required.some((c) => c in filter)) {
    throw new UnsupportedFilterError(`db.query.${table}: a filter on ${required.join(" or ")} is required (brand-owned rows are never listed unscoped)`);
  }
  const cols = Object.keys(filter);
  if (cols.length === 0) return { sql: "", params: [] };
  return { sql: ` WHERE ${cols.map((c) => `${c} = ?`).join(" AND ")}`, params: cols.map((c) => filter[c]) };
}

function limitSql(limit: unknown): { sql: string; params: any[] } {
  if (limit === undefined || limit === null) return { sql: "", params: [] };
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) throw new UnsupportedFilterError(`db.query: invalid limit ${String(limit)}`);
  return { sql: " LIMIT ?", params: [n] };
}

function find(table: string, opts: { where?: unknown; limit?: unknown } | undefined, allowed: string[], required: string[], order: string): Row[] {
  const f = whereSql(table, filterOf(table, opts?.where, allowed), required);
  const l = limitSql(opts?.limit);
  return getRawDb().prepare(`SELECT * FROM ${table}${f.sql} ORDER BY ${order}${l.sql}`).all(...f.params, ...l.params) as Row[];
}

const ALLOWED_TABLES = new Set([
  "brands", "competitors", "prompts", "crawl_batches", "prompt_runs", "citations", "entity_mentions", "reverse_rag_chunks", "opportunities", "system_settings",
]);

function tableName(tableObj: any): string {
  const name = tableObj?.name || tableObj?._table;
  if (!ALLOWED_TABLES.has(name)) throw new Error(`Invalid table: ${name}`);
  return name;
}

function columnId(k: string): string {
  const s = camelToSnake(k);
  if (!/^[a-z0-9_]+$/.test(s)) throw new Error(`Invalid column identifier: ${s}`);
  return s;
}

const sqlValue = (v: unknown): any => (typeof v === "boolean" ? (v ? 1 : 0) : v ?? null);

type FindOpts = { where?: any; limit?: number; orderBy?: any };

export const db = {
  get raw() {
    return getRawDb();
  },

  query: {
    brands: {
      findMany: (opts?: FindOpts): BrandRecord[] => find("brands", opts, ["id", "slug"], [], "name ASC").map(rowToBrand),
      findFirst: (opts?: FindOpts): BrandRecord | undefined => find("brands", { ...opts, limit: 1 }, ["id", "slug"], [], "created_at ASC").map(rowToBrand)[0],
    },
    competitors: {
      findFirst: (opts?: FindOpts): CompetitorRecord | undefined =>
        find("competitors", { ...opts, limit: 1 }, ["id", "brand_id", "domain", "name"], ["id", "brand_id"], "created_at ASC").map(rowToCompetitor)[0],
      findMany: (opts?: FindOpts): CompetitorRecord[] =>
        find("competitors", opts, ["brand_id", "active"], ["brand_id"], "created_at ASC").map(rowToCompetitor),
    },
    prompts: {
      findFirst: (opts?: FindOpts): PromptRecord | undefined =>
        find("prompts", { ...opts, limit: 1 }, ["id", "brand_id", "query_text"], ["id", "brand_id"], "created_at ASC").map(rowToPrompt)[0],
      findMany: (opts?: FindOpts): PromptRecord[] => find("prompts", opts, ["brand_id", "active"], ["brand_id"], "created_at ASC").map(rowToPrompt),
    },
    crawlBatches: {
      findFirst: (opts?: FindOpts): CrawlBatchRecord | undefined =>
        find("crawl_batches", { ...opts, limit: 1 }, ["id", "brand_id", "status"], ["id", "brand_id"], "created_at DESC").map(rowToBatch)[0],
      findMany: (opts?: FindOpts): CrawlBatchRecord[] =>
        find("crawl_batches", { ...opts, limit: opts?.limit ?? 50 }, ["brand_id", "status"], ["brand_id"], "created_at DESC").map(rowToBatch),
    },
    promptRuns: {
      findMany: (opts?: FindOpts): PromptRunRecord[] =>
        find("prompt_runs", opts, ["brand_id", "prompt_id", "batch_id", "engine"], ["brand_id", "prompt_id", "batch_id"], "created_at DESC").map(rowToRun),
    },
    citations: {
      findMany: (opts?: FindOpts): CitationRecord[] =>
        find("citations", opts, ["brand_id", "run_id", "is_brand_domain", "is_competitor_domain"], ["brand_id", "run_id"], "created_at DESC").map(rowToCitation),
    },
    entityMentions: {
      findMany: (opts?: FindOpts): EntityMentionRecord[] =>
        find("entity_mentions", opts, ["brand_id", "run_id", "competitor_id"], ["brand_id", "run_id"], "created_at DESC").map(rowToMention),
    },
    reverseRagChunks: {
      findMany: (opts?: FindOpts): any[] =>
        find("reverse_rag_chunks", { ...opts, limit: opts?.limit ?? 50 }, ["brand_id", "run_id"], ["brand_id", "run_id"], "created_at DESC").map((r) => ({
          id: r.id,
          runId: r.run_id,
          citationId: r.citation_id,
          sourceUrl: r.source_url,
          matchedChunkText: r.matched_chunk_text,
          similarityScore: r.similarity_score,
          selfContainedScore: r.self_contained_score,
          answerSentence: r.answer_sentence ?? null,
          sharedShingles: r.shared_shingles ?? null,
          createdAt: r.created_at,
        })),
    },
    opportunities: {
      findFirst: (opts?: FindOpts): OpportunityRecord | undefined =>
        find("opportunities", { ...opts, limit: 1 }, ["id", "brand_id", "title"], ["id", "brand_id"], "created_at DESC").map(rowToOpportunity)[0],
      findMany: (opts?: FindOpts): OpportunityRecord[] =>
        find("opportunities", { ...opts, limit: opts?.limit ?? 50 }, ["brand_id", "status"], ["brand_id"], "created_at DESC").map(rowToOpportunity),
    },
  },

  /** Insert (upsert on id/key) helper. */
  insert: (tableObj: any) => ({
    values: async (data: any) => {
      const table = tableName(tableObj);
      const sqlite = getRawDb();
      for (const record of Array.isArray(data) ? data : [data]) {
        const keys = Object.keys(record);
        if (keys.length === 0) continue;
        const cols = keys.map(columnId);
        const conflictCol = cols.includes("id") ? "id" : cols.includes("key") ? "key" : null;
        let conflict = "";
        if (conflictCol) {
          const updates = cols.filter((c) => c !== conflictCol);
          conflict = updates.length
            ? ` ON CONFLICT(${conflictCol}) DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}`
            : ` ON CONFLICT(${conflictCol}) DO NOTHING`;
        }
        sqlite
          .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})${conflict}`)
          .run(...keys.map((k) => sqlValue(record[k])));
      }
    },
  }),

  /** Update helper; the condition is required and must name at least one column. */
  update: (tableObj: any) => ({
    set: (data: any) => ({
      where: (condition: any) => {
        const table = tableName(tableObj);
        const keys = Object.keys(data || {});
        if (keys.length === 0) return;
        if (!condition || typeof condition !== "object" || Object.keys(condition).length === 0) {
          throw new Error("Missing condition for UPDATE statement");
        }
        const condKeys = Object.keys(condition);
        getRawDb()
          .prepare(`UPDATE ${table} SET ${keys.map((k) => `${columnId(k)} = ?`).join(", ")} WHERE ${condKeys.map((k) => `${columnId(k)} = ?`).join(" AND ")}`)
          .run(...keys.map((k) => sqlValue(data[k])), ...condKeys.map((k) => sqlValue(condition[k])));
      },
    }),
  }),
};

// Schema compatibility proxies
export const schema = {
  brands: { name: "brands", slug: "slug", id: "id" },
  competitors: { name: "competitors", id: "id", domain: "domain", brandId: "brand_id", active: "active" },
  prompts: { name: "prompts", id: "id", queryText: "query_text", brandId: "brand_id", active: "active" },
  crawlBatches: { name: "crawl_batches", id: "id", brandId: "brand_id", status: "status", createdAt: "created_at" },
  promptRuns: { name: "prompt_runs", id: "id", promptId: "prompt_id", batchId: "batch_id", brandId: "brand_id", engine: "engine", createdAt: "created_at" },
  citations: { name: "citations", id: "id", runId: "run_id", brandId: "brand_id", isBrandDomain: "is_brand_domain", isCompetitorDomain: "is_competitor_domain", createdAt: "created_at" },
  entityMentions: { name: "entity_mentions", id: "id", runId: "run_id", brandId: "brand_id", competitorId: "competitor_id" },
  reverseRagChunks: { name: "reverse_rag_chunks", id: "id", runId: "run_id", brandId: "brand_id" },
  opportunities: { name: "opportunities", id: "id", title: "title", brandId: "brand_id" },
  systemSettings: { name: "system_settings", key: "key" },
};

/** `eq(schema.table.column, value)`: a single-column equality filter for the shim. */
export function eq(column: unknown, value: unknown): Record<string, unknown> {
  if (typeof column !== "string" || !column) throw new UnsupportedFilterError("eq(): the column must be a schema column name such as schema.prompts.brandId");
  return { [column]: value };
}

/** Accepted for API compatibility; ordering is fixed per finder. */
export function desc(column: unknown) {
  return column;
}

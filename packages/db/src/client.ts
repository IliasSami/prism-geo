import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export function getDbPath(): string {
  if (process.env.PRISMGEO_DB_PATH) {
    return process.env.PRISMGEO_DB_PATH;
  }
  // Search upwards for repository/workspace root containing data/prismgeo.db
  let curr = process.cwd();
  let rootDataCandidate: string | null = null;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(curr, "data", "prismgeo.db");
    const hasWorkspace =
      fs.existsSync(path.join(curr, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(curr, ".git"));
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
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return path.join(defaultDir, "prismgeo.db");
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

  const dbPath = customPath || getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new DatabaseSync(dbPath);

  // Set WAL performance and integrity pragmas
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  // Create tables with foreign key cascades and complete column schemas
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      description TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      value_props_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      query_text TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      persona_dimension TEXT NOT NULL DEFAULT 'agency_executive',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crawl_batches (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      sample_size INTEGER NOT NULL DEFAULT 10,
      total_runs INTEGER NOT NULL DEFAULT 0,
      completed_runs INTEGER NOT NULL DEFAULT 0,
      current_prompt TEXT,
      current_engine TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_runs (
      id TEXT PRIMARY KEY,
      brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES crawl_batches(id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      engine TEXT NOT NULL,
      run_index INTEGER NOT NULL,
      response_text TEXT NOT NULL,
      sub_queries_json TEXT NOT NULL DEFAULT '[]',
      prompt_tokens INTEGER,
      execution_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS citations (
      id TEXT PRIMARY KEY,
      brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      snippet TEXT,
      anchor_text TEXT,
      rank INTEGER NOT NULL DEFAULT 1,
      is_brand_domain INTEGER NOT NULL DEFAULT 0,
      is_competitor_domain INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_mentions (
      id TEXT PRIMARY KEY,
      brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
      entity_name TEXT NOT NULL,
      is_target_brand INTEGER NOT NULL DEFAULT 0,
      is_competitor INTEGER NOT NULL DEFAULT 0,
      sentiment TEXT NOT NULL DEFAULT 'neutral',
      prominence_score REAL NOT NULL DEFAULT 0.0,
      position_rank INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reverse_rag_chunks (
      id TEXT PRIMARY KEY,
      brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
      citation_id TEXT REFERENCES citations(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      matched_chunk_text TEXT NOT NULL,
      similarity_score REAL NOT NULL DEFAULT 0.0,
      self_contained_score REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sub_query_target TEXT NOT NULL,
      gap_type TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      estimated_impact TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migration helper for existing databases missing newly added columns
  const runMigration = (sql: string) => {
    try {
      sqlite.exec(sql);
    } catch {}
  };
  runMigration("ALTER TABLE crawl_batches ADD COLUMN total_runs INTEGER DEFAULT 0;");
  runMigration("ALTER TABLE crawl_batches ADD COLUMN current_prompt TEXT;");
  runMigration("ALTER TABLE crawl_batches ADD COLUMN current_engine TEXT;");
  runMigration("ALTER TABLE crawl_batches ADD COLUMN failed_runs INTEGER NOT NULL DEFAULT 0;");
  runMigration("ALTER TABLE crawl_batches ADD COLUMN errors_json TEXT NOT NULL DEFAULT '[]';");
  runMigration("ALTER TABLE crawl_batches ADD COLUMN heartbeat_at TEXT;");
  runMigration("ALTER TABLE prompt_runs ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE prompt_runs ADD COLUMN capture_method TEXT NOT NULL DEFAULT 'browser';");
  runMigration("ALTER TABLE citations ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE entity_mentions ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE reverse_rag_chunks ADD COLUMN brand_id TEXT;");

  _db = sqlite;
  g.__prismDb = sqlite;
  return sqlite;
}

// Type definitions matching schema
export interface BrandRecord {
  id: string;
  slug: string;
  name: string;
  domain: string;
  description: string | null;
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
  entityName: string;
  isTargetBrand: boolean;
  isCompetitor: boolean;
  sentiment: string;
  prominenceScore: number;
  positionRank: number;
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

export function getActiveBrand(): BrandRecord | undefined {
  const sqlite = getRawDb();
  try {
    const setting = sqlite.prepare("SELECT value_json FROM system_settings WHERE key = 'active_brand_id'").get() as any;
    if (setting) {
      const brandId = JSON.parse(setting.value_json);
      const row = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId) as any;
      if (row) {
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          domain: row.domain,
          description: row.description,
          aliasesJson: row.aliases_json,
          valuePropsJson: row.value_props_json,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }
    }
  } catch {}
  const defaultRow = sqlite.prepare("SELECT * FROM brands ORDER BY updated_at DESC LIMIT 1").get() as any;
  if (!defaultRow) return undefined;
  return {
    id: defaultRow.id,
    slug: defaultRow.slug,
    name: defaultRow.name,
    domain: defaultRow.domain,
    description: defaultRow.description,
    aliasesJson: defaultRow.aliases_json,
    valuePropsJson: defaultRow.value_props_json,
    createdAt: defaultRow.created_at,
    updatedAt: defaultRow.updated_at,
  };
}

export function setActiveBrand(brandId: string): void {
  const sqlite = getRawDb();
  sqlite
    .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('active_brand_id', ?, CURRENT_TIMESTAMP)")
    .run(JSON.stringify(brandId));
}

export function getAllBrands(): BrandRecord[] {
  const sqlite = getRawDb();
  const rows = sqlite.prepare("SELECT * FROM brands ORDER BY name ASC").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    domain: r.domain,
    description: r.description,
    aliasesJson: r.aliases_json,
    valuePropsJson: r.value_props_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createBrand(data: {
  name: string;
  domain: string;
  description?: string;
  aliases?: string[];
  valueProps?: string[];
}): BrandRecord {
  const sqlite = getRawDb();
  const id = `brand-${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const aliasesJson = JSON.stringify(data.aliases || []);
  const valuePropsJson = JSON.stringify(data.valueProps || []);
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO brands (id, slug, name, domain, description, aliases_json, value_props_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, slug, data.name, data.domain, data.description || "", aliasesJson, valuePropsJson, now, now);

  return {
    id,
    slug,
    name: data.name,
    domain: data.domain,
    description: data.description || null,
    aliasesJson,
    valuePropsJson,
    createdAt: now,
    updatedAt: now,
  };
}

export function getSettings<T>(key: string, defaultValue: T): T {
  const sqlite = getRawDb();
  try {
    const row = sqlite.prepare("SELECT value_json FROM system_settings WHERE key = ?").get(key) as any;
    if (row && row.value_json) {
      return JSON.parse(row.value_json) as T;
    }
  } catch {}
  return defaultValue;
}

export function setSettings<T>(key: string, value: T): void {
  const sqlite = getRawDb();
  sqlite
    .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
    .run(key, JSON.stringify(value));
}

// High-level fluent query client
export const db = {
  get raw() {
    return getRawDb();
  },

  query: {
    brands: {
      findMany: (): BrandRecord[] => {
        return getAllBrands();
      },
      findFirst: (options?: { where?: any }): BrandRecord | undefined => {
        const sqlite = getRawDb();
        if (options?.where?.slug) {
          const row = sqlite.prepare("SELECT * FROM brands WHERE slug = ? LIMIT 1").get(options.where.slug) as any;
          if (!row) return undefined;
          return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            domain: row.domain,
            description: row.description,
            aliasesJson: row.aliases_json,
            valuePropsJson: row.value_props_json,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }
        if (options?.where?.id) {
          const row = sqlite.prepare("SELECT * FROM brands WHERE id = ? LIMIT 1").get(options.where.id) as any;
          if (!row) return undefined;
          return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            domain: row.domain,
            description: row.description,
            aliasesJson: row.aliases_json,
            valuePropsJson: row.value_props_json,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }
        if (options?.where) {
          // Explicit where filter provided but did not match slug or id
          return undefined;
        }
        const row = sqlite.prepare("SELECT * FROM brands LIMIT 1").get() as any;
        if (!row) return undefined;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          domain: row.domain,
          description: row.description,
          aliasesJson: row.aliases_json,
          valuePropsJson: row.value_props_json,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      },
    },

    competitors: {
      findFirst: (options?: { where?: any }): CompetitorRecord | undefined => {
        const sqlite = getRawDb();
        const domain = options?.where?.domain;
        if (domain) {
          const row = sqlite.prepare("SELECT * FROM competitors WHERE domain = ? LIMIT 1").get(domain) as any;
          if (!row) return undefined;
          return {
            id: row.id,
            brandId: row.brand_id,
            name: row.name,
            domain: row.domain,
            aliasesJson: row.aliases_json,
            active: Boolean(row.active),
            createdAt: row.created_at,
          };
        }
        return undefined;
      },
      findMany: (options?: { where?: any; orderBy?: any; limit?: number }): CompetitorRecord[] => {
        const sqlite = getRawDb();
        let rows: any[];
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        if (brandId) {
          rows = sqlite.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM competitors").all() as any[];
        }
        return rows.map((r) => ({
          id: r.id,
          brandId: r.brand_id,
          name: r.name,
          domain: r.domain,
          aliasesJson: r.aliases_json,
          active: Boolean(r.active),
          createdAt: r.created_at,
        }));
      },
    },

    prompts: {
      findFirst: (options?: { where?: any }): PromptRecord | undefined => {
        const sqlite = getRawDb();
        const queryText = options?.where?.queryText ?? options?.where?.query_text;
        if (queryText) {
          const row = sqlite.prepare("SELECT * FROM prompts WHERE query_text = ? LIMIT 1").get(queryText) as any;
          if (!row) return undefined;
          return {
            id: row.id,
            brandId: row.brand_id,
            queryText: row.query_text,
            intentType: row.intent_type,
            personaDimension: row.persona_dimension,
            active: Boolean(row.active),
            createdAt: row.created_at,
          };
        }
        return undefined;
      },
      findMany: (options?: { where?: any; orderBy?: any; limit?: number }): PromptRecord[] => {
        const sqlite = getRawDb();
        let rows: any[];
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        if (brandId) {
          rows = sqlite.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(brandId) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM prompts").all() as any[];
        }
        return rows.map((r) => ({
          id: r.id,
          brandId: r.brand_id,
          queryText: r.query_text,
          intentType: r.intent_type,
          personaDimension: r.persona_dimension,
          active: Boolean(r.active),
          createdAt: r.created_at,
        }));
      },
    },

    crawlBatches: {
      findFirst: (options?: { where?: any }): CrawlBatchRecord | undefined => {
        const sqlite = getRawDb();
        let row: any;
        const id = options?.where?.id;
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        if (id) {
          row = sqlite.prepare("SELECT * FROM crawl_batches WHERE id = ? LIMIT 1").get(id);
        } else if (brandId) {
          row = sqlite.prepare("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1").get(brandId);
        } else {
          row = sqlite.prepare("SELECT * FROM crawl_batches ORDER BY created_at DESC LIMIT 1").get();
        }
        if (!row) return undefined;
        return {
          id: row.id,
          brandId: row.brand_id,
          status: row.status,
          sampleSize: row.sample_size,
          totalRuns: row.total_runs ?? 0,
          completedRuns: row.completed_runs,
          currentPrompt: row.current_prompt ?? null,
          currentEngine: row.current_engine ?? null,
          failedRuns: row.failed_runs ?? 0,
          errorsJson: row.errors_json ?? "[]",
          createdAt: row.created_at,
          finishedAt: row.finished_at,
        };
      },
      findMany: (options?: { where?: any; limit?: number; orderBy?: any }): CrawlBatchRecord[] => {
        const sqlite = getRawDb();
        const limit = options?.limit || 50;
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        let rows: any[];
        if (brandId) {
          rows = sqlite.prepare("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?").all(brandId, limit) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM crawl_batches ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
        }
        return rows.map((r) => ({
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
        }));
      },
    },

    promptRuns: {
      findMany: (options?: { limit?: number; where?: any; orderBy?: any }): PromptRunRecord[] => {
        const sqlite = getRawDb();
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const promptId = options?.where?.promptId ?? options?.where?.prompt_id;
        const batchId = options?.where?.batchId ?? options?.where?.batch_id;

        const clauses: string[] = [];
        const params: any[] = [];

        if (brandId) {
          clauses.push("brand_id = ?");
          params.push(brandId);
        }
        if (promptId) {
          clauses.push("prompt_id = ?");
          params.push(promptId);
        }
        if (batchId) {
          clauses.push("batch_id = ?");
          params.push(batchId);
        }

        let sql = "SELECT * FROM prompt_runs";
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(" AND ")}`;
        }
        sql += " ORDER BY created_at DESC";
        if (options?.limit) {
          sql += " LIMIT ?";
          params.push(options.limit);
        }

        const rows = (params.length > 0 ? sqlite.prepare(sql).all(...params) : sqlite.prepare(sql).all()) as any[];
        return rows.map((r) => ({
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
          createdAt: r.created_at,
        }));
      },
    },

    citations: {
      findMany: (options?: { where?: any; limit?: number; orderBy?: any }): CitationRecord[] => {
        const sqlite = getRawDb();
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const runId = options?.where?.runId ?? options?.where?.run_id;
        const isBrand = options?.where?.isBrandDomain ?? options?.where?.is_brand_domain;
        const isComp = options?.where?.isCompetitorDomain ?? options?.where?.is_competitor_domain;

        const clauses: string[] = [];
        const params: any[] = [];

        if (brandId) {
          clauses.push("brand_id = ?");
          params.push(brandId);
        }
        if (runId) {
          clauses.push("run_id = ?");
          params.push(runId);
        }
        if (isBrand !== undefined) {
          clauses.push("is_brand_domain = ?");
          params.push(isBrand ? 1 : 0);
        }
        if (isComp !== undefined) {
          clauses.push("is_competitor_domain = ?");
          params.push(isComp ? 1 : 0);
        }

        let sql = "SELECT * FROM citations";
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(" AND ")}`;
        }
        sql += " ORDER BY created_at DESC";
        if (options?.limit) {
          sql += " LIMIT ?";
          params.push(options.limit);
        }

        const rows = (params.length > 0 ? sqlite.prepare(sql).all(...params) : sqlite.prepare(sql).all()) as any[];
        return rows.map((r) => ({
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
        }));
      },
    },

    entityMentions: {
      findMany: (options?: { where?: any; limit?: number; orderBy?: any }): EntityMentionRecord[] => {
        const sqlite = getRawDb();
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const runId = options?.where?.runId ?? options?.where?.run_id;

        const clauses: string[] = [];
        const params: any[] = [];

        if (brandId) {
          clauses.push("brand_id = ?");
          params.push(brandId);
        }
        if (runId) {
          clauses.push("run_id = ?");
          params.push(runId);
        }

        let sql = "SELECT * FROM entity_mentions";
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(" AND ")}`;
        }
        sql += " ORDER BY created_at DESC";
        if (options?.limit) {
          sql += " LIMIT ?";
          params.push(options.limit);
        }

        const rows = (params.length > 0 ? sqlite.prepare(sql).all(...params) : sqlite.prepare(sql).all()) as any[];
        return rows.map((r) => ({
          id: r.id,
          brandId: r.brand_id,
          runId: r.run_id,
          entityName: r.entity_name,
          isTargetBrand: Boolean(r.is_target_brand),
          isCompetitor: Boolean(r.is_competitor),
          sentiment: r.sentiment,
          prominenceScore: r.prominence_score,
          positionRank: r.position_rank,
          createdAt: r.created_at,
        }));
      },
    },

    reverseRagChunks: {
      findMany: (options?: { where?: any; limit?: number }): any[] => {
        const sqlite = getRawDb();
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const limit = options?.limit || 50;
        let rows: any[];
        if (brandId) {
          rows = sqlite.prepare("SELECT * FROM reverse_rag_chunks WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?").all(brandId, limit) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM reverse_rag_chunks ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
        }
        return rows.map((r) => ({
          id: r.id,
          runId: r.run_id,
          citationId: r.citation_id,
          sourceUrl: r.source_url,
          matchedChunkText: r.matched_chunk_text,
          similarityScore: r.similarity_score,
          selfContainedScore: r.self_contained_score,
          createdAt: r.created_at,
        }));
      },
    },

    opportunities: {
      findFirst: (options?: { where?: { title?: string } }): OpportunityRecord | undefined => {
        const sqlite = getRawDb();
        if (options?.where?.title) {
          const row = sqlite.prepare("SELECT * FROM opportunities WHERE title = ? LIMIT 1").get(options.where.title) as any;
          if (!row) return undefined;
          return {
            id: row.id,
            brandId: row.brand_id,
            title: row.title,
            subQueryTarget: row.sub_query_target,
            gapType: row.gap_type,
            recommendedAction: row.recommended_action,
            estimatedImpact: row.estimated_impact,
            status: row.status,
            createdAt: row.created_at,
          };
        }
        return undefined;
      },
      findMany: (options?: { where?: any; limit?: number; orderBy?: any }): OpportunityRecord[] => {
        const sqlite = getRawDb();
        const limit = options?.limit || 50;
        let rows: any[];
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        if (brandId) {
          rows = sqlite.prepare("SELECT * FROM opportunities WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?").all(brandId, limit) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
        }
        return rows.map((r) => ({
          id: r.id,
          brandId: r.brand_id,
          title: r.title,
          subQueryTarget: r.sub_query_target,
          gapType: r.gap_type,
          recommendedAction: r.recommended_action,
          estimatedImpact: r.estimated_impact,
          status: r.status,
          createdAt: r.created_at,
        }));
      },
    },
  },

  // Insert helpers
  insert: (tableObj: any) => ({
    values: async (data: any) => {
      const sqlite = getRawDb();
      const rawTableName = tableObj.name || tableObj._table;
      const ALLOWED_TABLES = new Set([
        "brands", "competitors", "prompts", "crawl_batches",
        "prompt_runs", "citations", "entity_mentions",
        "reverse_rag_chunks", "opportunities", "system_settings"
      ]);
      if (!ALLOWED_TABLES.has(rawTableName)) {
        throw new Error(`Invalid table for insertion: ${rawTableName}`);
      }

      const insertRecord = (record: any) => {
        const keys = Object.keys(record);
        if (keys.length === 0) return;

        const snakeKeys = keys.map((k) => {
          const s = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
          if (!/^[a-z0-9_]+$/.test(s)) {
            throw new Error(`Invalid column identifier: ${s}`);
          }
          return s;
        });

        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((k) => (typeof record[k] === "boolean" ? (record[k] ? 1 : 0) : record[k] ?? null));

        const conflictCol = snakeKeys.includes("id") ? "id" : snakeKeys.includes("key") ? "key" : null;
        let conflictClause = "";
        if (conflictCol) {
          const updateCols = snakeKeys.filter((k) => k !== conflictCol);
          if (updateCols.length > 0) {
            conflictClause = ` ON CONFLICT(${conflictCol}) DO UPDATE SET ${updateCols.map((k) => `${k} = excluded.${k}`).join(", ")}`;
          } else {
            conflictClause = ` ON CONFLICT(${conflictCol}) DO NOTHING`;
          }
        }

        const sql = `INSERT INTO ${rawTableName} (${snakeKeys.join(", ")}) VALUES (${placeholders})${conflictClause}`;
        sqlite.prepare(sql).run(...values);
      };

      if (Array.isArray(data)) {
        for (const item of data) {
          insertRecord(item);
        }
      } else {
        insertRecord(data);
      }
    },
  }),

  // Update helpers
  update: (tableObj: any) => ({
    set: (data: any) => ({
      where: (condition: any) => {
        const sqlite = getRawDb();
        const rawTableName = tableObj.name || tableObj._table;
        const ALLOWED_TABLES = new Set([
          "brands", "competitors", "prompts", "crawl_batches",
          "prompt_runs", "citations", "entity_mentions",
          "reverse_rag_chunks", "opportunities", "system_settings"
        ]);
        if (!ALLOWED_TABLES.has(rawTableName)) {
          throw new Error(`Invalid table for update: ${rawTableName}`);
        }

        const keys = Object.keys(data);
        if (keys.length === 0) {
          return;
        }

        const snakeKeys = keys.map((k) => {
          const s = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
          if (!/^[a-z0-9_]+$/.test(s)) {
            throw new Error(`Invalid column identifier: ${s}`);
          }
          return s;
        });
        const setClauses = snakeKeys.map((k) => `${k} = ?`).join(", ");
        const values = keys.map((k) => (typeof data[k] === "boolean" ? (data[k] ? 1 : 0) : data[k] ?? null));

        if (!condition || typeof condition !== "object" || Object.keys(condition).length === 0) {
          throw new Error("Missing condition for UPDATE statement");
        }
        const conditionKeys = Object.keys(condition);
        const whereClauses: string[] = [];
        const whereValues: any[] = [];
        for (const k of conditionKeys) {
          const s = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
          if (!/^[a-z0-9_]+$/.test(s)) {
            throw new Error(`Invalid column identifier for where clause: ${s}`);
          }
          whereClauses.push(`${s} = ?`);
          const val = condition[k];
          whereValues.push(typeof val === "boolean" ? (val ? 1 : 0) : val ?? null);
        }

        const sql = `UPDATE ${rawTableName} SET ${setClauses} WHERE ${whereClauses.join(" AND ")}`;
        sqlite.prepare(sql).run(...values, ...whereValues);
      },
    }),
  }),
};

// Schema compatibility proxies
export const schema = {
  brands: { name: "brands", slug: "slug", id: "id" },
  competitors: { name: "competitors", domain: "domain", brandId: "brand_id" },
  prompts: { name: "prompts", queryText: "query_text", brandId: "brand_id" },
  crawlBatches: { name: "crawl_batches", id: "id", brandId: "brand_id", createdAt: "created_at" },
  promptRuns: { name: "prompt_runs", id: "id", promptId: "prompt_id", brandId: "brand_id", createdAt: "created_at" },
  citations: { name: "citations", id: "id", brandId: "brand_id", isBrandDomain: "is_brand_domain", isCompetitorDomain: "is_competitor_domain", createdAt: "created_at" },
  entityMentions: { name: "entity_mentions", id: "id", brandId: "brand_id" },
  reverseRagChunks: { name: "reverse_rag_chunks", id: "id", brandId: "brand_id" },
  opportunities: { name: "opportunities", id: "id", title: "title", brandId: "brand_id" },
  systemSettings: { name: "system_settings", key: "key" },
};

export function eq(column: any, value: any) {
  if (typeof column === "string") return { [column]: value };
  return { id: value };
}

export function desc(column: any) {
  return column;
}

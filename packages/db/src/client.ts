import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export function getDbPath(): string {
  if (process.env.PRISMGEO_DB_PATH) {
    return process.env.PRISMGEO_DB_PATH;
  }
  // Look for data directory from current directory upwards
  let curr = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(curr, "data", "prismgeo.db");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  const defaultDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return path.join(defaultDir, "prismgeo.db");
}

let _db: DatabaseSync | null = null;

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
      sourceUrl TEXT NOT NULL,
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
  runMigration("ALTER TABLE prompt_runs ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE citations ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE entity_mentions ADD COLUMN brand_id TEXT;");
  runMigration("ALTER TABLE reverse_rag_chunks ADD COLUMN brand_id TEXT;");

  _db = sqlite;
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
  completedRuns: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface PromptRunRecord {
  id: string;
  batchId: string;
  promptId: string;
  engine: string;
  runIndex: number;
  responseText: string;
  subQueriesJson: string;
  promptTokens: number | null;
  executionMs: number;
  createdAt: string;
}

export interface CitationRecord {
  id: string;
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
          completedRuns: row.completed_runs,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
        };
      },
      findMany: (options?: { limit?: number; orderBy?: any }): CrawlBatchRecord[] => {
        const sqlite = getRawDb();
        const limit = options?.limit || 50;
        const rows = sqlite.prepare("SELECT * FROM crawl_batches ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
        return rows.map((r) => ({
          id: r.id,
          brandId: r.brand_id,
          status: r.status,
          sampleSize: r.sample_size,
          completedRuns: r.completed_runs,
          createdAt: r.created_at,
          finishedAt: r.finished_at,
        }));
      },
    },

    promptRuns: {
      findMany: (options?: { limit?: number; where?: any; orderBy?: any }): PromptRunRecord[] => {
        const sqlite = getRawDb();
        let rows: any[];
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const promptId = options?.where?.promptId ?? options?.where?.prompt_id;
        if (brandId && promptId) {
          rows = sqlite.prepare("SELECT * FROM prompt_runs WHERE brand_id = ? AND prompt_id = ? ORDER BY created_at DESC").all(brandId, promptId) as any[];
        } else if (brandId) {
          if (options?.limit) {
            rows = sqlite.prepare("SELECT * FROM prompt_runs WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?").all(brandId, options.limit) as any[];
          } else {
            rows = sqlite.prepare("SELECT * FROM prompt_runs WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as any[];
          }
        } else if (promptId) {
          rows = sqlite.prepare("SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY created_at DESC").all(promptId) as any[];
        } else if (options?.limit) {
          rows = sqlite.prepare("SELECT * FROM prompt_runs ORDER BY created_at DESC LIMIT ?").all(options.limit) as any[];
        } else {
          rows = sqlite.prepare("SELECT * FROM prompt_runs ORDER BY created_at DESC").all() as any[];
        }
        return rows.map((r) => ({
          id: r.id,
          batchId: r.batch_id,
          promptId: r.prompt_id,
          engine: r.engine,
          runIndex: r.run_index,
          responseText: r.response_text,
          subQueriesJson: r.sub_queries_json,
          promptTokens: r.prompt_tokens,
          executionMs: r.execution_ms,
          createdAt: r.created_at,
        }));
      },
    },

    citations: {
      findMany: (options?: { where?: any; limit?: number; orderBy?: any }): CitationRecord[] => {
        const sqlite = getRawDb();
        let rows: any[];
        const brandId = options?.where?.brandId ?? options?.where?.brand_id;
        const isBrand = options?.where?.isBrandDomain ?? options?.where?.is_brand_domain;
        const isComp = options?.where?.isCompetitorDomain ?? options?.where?.is_competitor_domain;

        if (brandId) {
          if (isBrand !== undefined) {
            rows = sqlite.prepare("SELECT * FROM citations WHERE brand_id = ? AND is_brand_domain = ? ORDER BY created_at DESC").all(brandId, isBrand ? 1 : 0) as any[];
          } else if (isComp !== undefined) {
            rows = sqlite.prepare("SELECT * FROM citations WHERE brand_id = ? AND is_competitor_domain = ? ORDER BY created_at DESC").all(brandId, isComp ? 1 : 0) as any[];
          } else if (options?.limit) {
            rows = sqlite.prepare("SELECT * FROM citations WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?").all(brandId, options.limit) as any[];
          } else {
            rows = sqlite.prepare("SELECT * FROM citations WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as any[];
          }
        } else {
          if (isBrand !== undefined) {
            rows = sqlite.prepare("SELECT * FROM citations WHERE is_brand_domain = ? ORDER BY created_at DESC").all(isBrand ? 1 : 0) as any[];
          } else if (isComp !== undefined) {
            rows = sqlite.prepare("SELECT * FROM citations WHERE is_competitor_domain = ? ORDER BY created_at DESC").all(isComp ? 1 : 0) as any[];
          } else if (options?.limit) {
            rows = sqlite.prepare("SELECT * FROM citations ORDER BY created_at DESC LIMIT ?").all(options.limit) as any[];
          } else {
            rows = sqlite.prepare("SELECT * FROM citations ORDER BY created_at DESC").all() as any[];
          }
        }
        return rows.map((r) => ({
          id: r.id,
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

      const keys = Object.keys(data);
      const snakeKeys = keys.map((k) => {
        const s = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        if (!/^[a-z0-9_]+$/.test(s)) {
          throw new Error(`Invalid column identifier: ${s}`);
        }
        return s;
      });

      const placeholders = keys.map(() => "?").join(", ");
      const values = keys.map((k) => (typeof data[k] === "boolean" ? (data[k] ? 1 : 0) : data[k] ?? null));

      const sql = `INSERT OR REPLACE INTO ${rawTableName} (${snakeKeys.join(", ")}) VALUES (${placeholders})`;
      sqlite.prepare(sql).run(...values);
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
        const whereKey = Object.keys(condition)[0];
        const whereVal = condition[whereKey];
        const whereSnake = whereKey.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        if (!/^[a-z0-9_]+$/.test(whereSnake)) {
          throw new Error(`Invalid column identifier for where clause: ${whereSnake}`);
        }

        const sql = `UPDATE ${rawTableName} SET ${setClauses} WHERE ${whereSnake} = ?`;
        sqlite.prepare(sql).run(...values, whereVal);
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

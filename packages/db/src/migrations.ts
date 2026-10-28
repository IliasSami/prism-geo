import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Versioned schema migrations, recorded in PRAGMA user_version.
 *
 * - Each migration runs once, in its own BEGIN IMMEDIATE transaction, and bumps user_version in
 *   the same transaction. Any error rolls back and is thrown: nothing is swallowed.
 * - Columns are added only after checking PRAGMA table_info, never by catching errors.
 * - Before the first pending migration that rewrites data, an existing non-empty database is
 *   copied with VACUUM INTO to <data dir>/backups/prismgeo-pre-v<N>-<timestamp>.db (mode 0600).
 * - A database created before this runner existed has user_version 0 and is brought up to date
 *   by the same list (the baseline uses CREATE TABLE IF NOT EXISTS and only adds missing columns).
 */

export interface Migration {
  version: number;
  name: string;
  /** Rewrites or backfills existing rows (a pre-migration backup is taken first). */
  changesData: boolean;
  up(db: DatabaseSync): void;
}

/** ISO-8601 UTC with milliseconds, the one timestamp format stored by PrismGEO. */
export const ISO_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

export function columnNames(db: DatabaseSync, table: string): string[] {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Invalid table name: ${table}`);
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** Adds a column when it is missing (checked via PRAGMA table_info). Returns true if it was added. */
export function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): boolean {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Invalid column name: ${column}`);
  if (columnNames(db, table).includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

const BASELINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    description TEXT,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    value_props_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL}),
    updated_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
  );
  CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
  );
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    intent_type TEXT NOT NULL,
    persona_dimension TEXT NOT NULL DEFAULT 'agency_executive',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL}),
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
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
    created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
  );
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
  );
`;

const isoFix = (column: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline schema and legacy columns",
    changesData: false,
    up(db) {
      db.exec(BASELINE_SCHEMA);
      addColumnIfMissing(db, "crawl_batches", "total_runs", "INTEGER DEFAULT 0");
      addColumnIfMissing(db, "crawl_batches", "current_prompt", "TEXT");
      addColumnIfMissing(db, "crawl_batches", "current_engine", "TEXT");
      addColumnIfMissing(db, "crawl_batches", "failed_runs", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "crawl_batches", "errors_json", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(db, "crawl_batches", "heartbeat_at", "TEXT");
      addColumnIfMissing(db, "prompt_runs", "brand_id", "TEXT");
      addColumnIfMissing(db, "prompt_runs", "capture_method", "TEXT NOT NULL DEFAULT 'browser'");
      addColumnIfMissing(db, "citations", "brand_id", "TEXT");
      addColumnIfMissing(db, "entity_mentions", "brand_id", "TEXT");
      addColumnIfMissing(db, "reverse_rag_chunks", "brand_id", "TEXT");
    },
  },
  {
    version: 2,
    name: "backfill brand_id on answers, citations, mentions and passages",
    changesData: true,
    up(db) {
      db.exec(`
        UPDATE prompt_runs SET brand_id = (SELECT p.brand_id FROM prompts p WHERE p.id = prompt_runs.prompt_id)
          WHERE brand_id IS NULL;
        UPDATE prompt_runs SET brand_id = (SELECT b.brand_id FROM crawl_batches b WHERE b.id = prompt_runs.batch_id)
          WHERE brand_id IS NULL;
        UPDATE citations SET brand_id = (SELECT r.brand_id FROM prompt_runs r WHERE r.id = citations.run_id) WHERE brand_id IS NULL;
        UPDATE entity_mentions SET brand_id = (SELECT r.brand_id FROM prompt_runs r WHERE r.id = entity_mentions.run_id) WHERE brand_id IS NULL;
        UPDATE reverse_rag_chunks SET brand_id = (SELECT r.brand_id FROM prompt_runs r WHERE r.id = reverse_rag_chunks.run_id) WHERE brand_id IS NULL;
      `);
    },
  },
  {
    version: 3,
    name: "indexes for brand, batch, prompt and run lookups",
    changesData: false,
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_runs_brand_created ON prompt_runs(brand_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_runs_batch ON prompt_runs(batch_id);
        CREATE INDEX IF NOT EXISTS idx_runs_prompt_engine ON prompt_runs(prompt_id, engine, created_at);
        CREATE INDEX IF NOT EXISTS idx_cit_brand_created ON citations(brand_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_cit_run ON citations(run_id);
        CREATE INDEX IF NOT EXISTS idx_ment_brand ON entity_mentions(brand_id);
        CREATE INDEX IF NOT EXISTS idx_ment_run ON entity_mentions(run_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_brand ON reverse_rag_chunks(brand_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_run ON reverse_rag_chunks(run_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_citation ON reverse_rag_chunks(citation_id);
        CREATE INDEX IF NOT EXISTS idx_batches_brand_status ON crawl_batches(brand_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_prompts_brand ON prompts(brand_id, active);
        CREATE INDEX IF NOT EXISTS idx_competitors_brand ON competitors(brand_id);
      `);
    },
  },
  {
    version: 4,
    name: "one ISO-8601 timestamp format (rewrite SQLite CURRENT_TIMESTAMP values, normalise future writes)",
    changesData: true,
    up(db) {
      const targets: Array<[string, string[]]> = [
        ["brands", ["created_at", "updated_at"]],
        ["competitors", ["created_at"]],
        ["prompts", ["created_at"]],
        ["crawl_batches", ["created_at", "finished_at"]],
        ["prompt_runs", ["created_at"]],
        ["citations", ["created_at"]],
        ["entity_mentions", ["created_at"]],
        ["reverse_rag_chunks", ["created_at"]],
        ["system_settings", ["updated_at"]],
      ];
      for (const [table, cols] of targets) {
        for (const col of cols) {
          db.exec(`UPDATE ${table} SET ${col} = ${isoFix(col)} WHERE ${col} IS NOT NULL AND ${col} NOT LIKE '%T%' AND ${isoFix(col)} IS NOT NULL`);
        }
      }
      // Writers outside the engine (API routes) may still write CURRENT_TIMESTAMP; normalise those on write
      for (const [table, col] of [
        ["crawl_batches", "created_at"],
        ["prompt_runs", "created_at"],
        ["prompts", "created_at"],
        ["brands", "created_at"],
        ["brands", "updated_at"],
      ] as const) {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_${table}_${col}_iso_ins AFTER INSERT ON ${table}
          WHEN NEW.${col} NOT LIKE '%T%' AND ${isoFix(`NEW.${col}`)} IS NOT NULL
          BEGIN UPDATE ${table} SET ${col} = ${isoFix(`NEW.${col}`)} WHERE rowid = NEW.rowid; END;
          CREATE TRIGGER IF NOT EXISTS trg_${table}_${col}_iso_upd AFTER UPDATE OF ${col} ON ${table}
          WHEN NEW.${col} NOT LIKE '%T%' AND ${isoFix(`NEW.${col}`)} IS NOT NULL
          BEGIN UPDATE ${table} SET ${col} = ${isoFix(`NEW.${col}`)} WHERE rowid = NEW.rowid; END;
        `);
      }
    },
  },
  {
    version: 5,
    name: "measurement columns: mention stance/echo/rank/list position/confusion, competitor id; run flags; batch owner; passage evidence",
    changesData: true,
    up(db) {
      addColumnIfMissing(db, "prompt_runs", "flags_json", "TEXT NOT NULL DEFAULT '{}'");
      addColumnIfMissing(db, "crawl_batches", "owner", "TEXT");
      addColumnIfMissing(db, "reverse_rag_chunks", "answer_sentence", "TEXT");
      addColumnIfMissing(db, "reverse_rag_chunks", "shared_shingles", "INTEGER");

      // entity_mentions is rebuilt: position_rank becomes nullable (echoes have no rank)
      db.exec(`
        CREATE TABLE entity_mentions_v5 (
          id TEXT PRIMARY KEY,
          brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
          competitor_id TEXT REFERENCES competitors(id) ON DELETE SET NULL,
          entity_name TEXT NOT NULL,
          is_target_brand INTEGER NOT NULL DEFAULT 0,
          is_competitor INTEGER NOT NULL DEFAULT 0,
          is_prompt_subject INTEGER,
          sentiment TEXT NOT NULL DEFAULT 'neutral',
          stance TEXT,
          has_caveat INTEGER NOT NULL DEFAULT 0,
          prominence_score REAL NOT NULL DEFAULT 0.0,
          position_rank INTEGER,
          list_position INTEGER,
          entity_confusion INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (${ISO_NOW_SQL})
        );
        INSERT INTO entity_mentions_v5 (id, brand_id, run_id, competitor_id, entity_name, is_target_brand, is_competitor, sentiment, prominence_score, position_rank, created_at)
          SELECT m.id, m.brand_id, m.run_id,
                 CASE WHEN m.is_target_brand = 0 THEN
                   (SELECT c.id FROM competitors c WHERE c.brand_id = m.brand_id AND c.name = m.entity_name ORDER BY c.created_at LIMIT 1)
                 END,
                 m.entity_name, m.is_target_brand, m.is_competitor, m.sentiment, m.prominence_score, m.position_rank, m.created_at
          FROM entity_mentions m;
        DROP TABLE entity_mentions;
        ALTER TABLE entity_mentions_v5 RENAME TO entity_mentions;
        CREATE INDEX IF NOT EXISTS idx_ment_brand ON entity_mentions(brand_id);
        CREATE INDEX IF NOT EXISTS idx_ment_run ON entity_mentions(run_id);
        CREATE INDEX IF NOT EXISTS idx_ment_competitor ON entity_mentions(competitor_id);
      `);
    },
  },
  {
    version: 6,
    name: "brand category (short product category used to generate questions)",
    changesData: false,
    up(db) {
      addColumnIfMissing(db, "brands", "category", "TEXT");
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

function hasUserData(db: DatabaseSync): boolean {
  for (const t of ["brands", "prompt_runs"]) {
    if (tableExists(db, t) && db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get()) return true;
  }
  return false;
}

/** Copies the database with VACUUM INTO before a data-changing migration. Returns the backup path. */
export function backupBeforeMigration(db: DatabaseSync, dbPath: string, toVersion: number): string {
  const dir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `prismgeo-pre-v${toVersion}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  fs.chmodSync(file, 0o600);
  return file;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
  backup: string | null;
}

/**
 * Brings the database to SCHEMA_VERSION. Safe to call from several processes at once: each
 * migration re-checks user_version inside its write transaction. Throws on any failure.
 */
export function runMigrations(db: DatabaseSync, dbPath: string, migrations: Migration[] = MIGRATIONS): MigrationResult {
  const from = userVersion(db);
  const target = migrations[migrations.length - 1]?.version ?? 0;
  if (from > target) {
    throw new Error(`This database was written by a newer PrismGEO (schema v${from}; this build knows v${target}). Upgrade PrismGEO before opening it.`);
  }
  const pending = migrations.filter((m) => m.version > from);
  const result: MigrationResult = { from, to: from, applied: [], backup: null };
  if (pending.length === 0) return result;

  const firstDataChange = pending.find((m) => m.changesData);
  if (firstDataChange && dbPath !== ":memory:" && hasUserData(db)) {
    result.backup = backupBeforeMigration(db, dbPath, firstDataChange.version);
    console.log(`[PrismGEO DB] Backed up the database to ${result.backup} before migrating to v${target}`);
  }

  // Foreign keys are checked once at the end instead of during table rebuilds
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const m of pending) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (userVersion(db) >= m.version) {
          db.exec("COMMIT");
          continue;
        }
        m.up(db);
        db.exec(`PRAGMA user_version = ${m.version}`);
        db.exec("COMMIT");
        result.applied.push(`v${m.version} ${m.name}`);
        result.to = m.version;
      } catch (err) {
        db.exec("ROLLBACK");
        throw new Error(`Database migration v${m.version} (${m.name}) failed and was rolled back: ${(err as Error).message}`);
      }
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<{ table: string }>;
  if (violations.length > 0) {
    const tables = [...new Set(violations.map((v) => v.table))].join(", ");
    console.warn(`[PrismGEO DB] ${violations.length} row(s) reference missing parents (${tables}); they predate this migration and were left as they are.`);
  }
  result.to = userVersion(db);
  return result;
}

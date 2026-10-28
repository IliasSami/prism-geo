import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, runMigrations, SCHEMA_VERSION, MIGRATIONS, columnNames, addColumnIfMissing, createBrand, BrandConflictError, db, eq, UnsupportedFilterError } from "@prismgeo/db";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-migrate-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "app", "app.db");

/** A database as an early build created it: no brand_id on answers, no indexes, SQLite timestamps. */
function legacyDb(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE brands (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE, description TEXT, aliases_json TEXT NOT NULL DEFAULT '[]', value_props_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE competitors (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, name TEXT NOT NULL, domain TEXT NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE prompts (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, query_text TEXT NOT NULL, intent_type TEXT NOT NULL, persona_dimension TEXT NOT NULL DEFAULT 'x', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crawl_batches (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sample_size INTEGER NOT NULL DEFAULT 10, completed_runs INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT);
    CREATE TABLE prompt_runs (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, prompt_id TEXT NOT NULL, engine TEXT NOT NULL, run_index INTEGER NOT NULL, response_text TEXT NOT NULL, sub_queries_json TEXT NOT NULL DEFAULT '[]', prompt_tokens INTEGER, execution_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE citations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, domain TEXT NOT NULL, url TEXT NOT NULL, title TEXT, snippet TEXT, anchor_text TEXT, rank INTEGER NOT NULL DEFAULT 1, is_brand_domain INTEGER NOT NULL DEFAULT 0, is_competitor_domain INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entity_mentions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, entity_name TEXT NOT NULL, is_target_brand INTEGER NOT NULL DEFAULT 0, is_competitor INTEGER NOT NULL DEFAULT 0, sentiment TEXT NOT NULL DEFAULT 'neutral', prominence_score REAL NOT NULL DEFAULT 0.0, position_rank INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE reverse_rag_chunks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, citation_id TEXT, source_url TEXT NOT NULL, matched_chunk_text TEXT NOT NULL, similarity_score REAL NOT NULL DEFAULT 0.0, self_contained_score REAL NOT NULL DEFAULT 0.0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO brands (id, slug, name, domain) VALUES ('b1', 'northwind', 'Northwind Voice', 'northwindvoice.ai');
    INSERT INTO competitors (id, brand_id, name, domain) VALUES ('c1', 'b1', 'Talkly', 'talkly.com');
    INSERT INTO prompts (id, brand_id, query_text, intent_type) VALUES ('p1', 'b1', 'best voice agent', 'category');
    INSERT INTO crawl_batches (id, brand_id, status, created_at) VALUES ('bt1', 'b1', 'completed', '2026-01-02 10:00:00');
    INSERT INTO prompt_runs (id, batch_id, prompt_id, engine, run_index, response_text, created_at) VALUES ('r1', 'bt1', 'p1', 'chatgpt', 0, 'Talkly is great', '2026-01-02 10:01:00');
    INSERT INTO citations (id, run_id, domain, url) VALUES ('ct1', 'r1', 'talkly.com', 'https://talkly.com');
    INSERT INTO entity_mentions (id, run_id, entity_name, is_competitor, position_rank) VALUES ('m1', 'r1', 'Talkly', 1, 1);
    INSERT INTO reverse_rag_chunks (id, run_id, citation_id, source_url, matched_chunk_text) VALUES ('ch1', 'r1', 'ct1', 'https://talkly.com', 'x');
  `);
  old.close();
}

test("an old database is upgraded: history visible per brand, columns added, indexes created, backup taken", () => {
  const file = path.join(tmp, "legacy", "prismgeo.db");
  legacyDb(file);
  const sqlite = openDatabase(file);
  assert.equal((sqlite.prepare("PRAGMA user_version").get() as any).user_version, SCHEMA_VERSION);
  // brand_id backfilled everywhere, so the dashboard sees the old answers
  for (const t of ["prompt_runs", "citations", "entity_mentions", "reverse_rag_chunks"]) {
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE brand_id = 'b1'`).get() as any).n, 1, t);
  }
  // new columns
  assert.ok(columnNames(sqlite, "entity_mentions").includes("is_prompt_subject"));
  assert.ok(columnNames(sqlite, "entity_mentions").includes("competitor_id"));
  assert.ok(columnNames(sqlite, "prompt_runs").includes("flags_json"));
  assert.ok(columnNames(sqlite, "brands").includes("category"));
  const m = sqlite.prepare("SELECT competitor_id, position_rank, is_prompt_subject FROM entity_mentions WHERE id = 'm1'").get() as any;
  assert.equal(m.competitor_id, "c1", "backfilled by name");
  assert.equal(m.is_prompt_subject, null, "unknown for old rows");
  const nullable = (sqlite.prepare("PRAGMA table_info(entity_mentions)").all() as any[]).find((c) => c.name === "position_rank");
  assert.equal(nullable.notnull, 0, "echoes can have no rank");
  // one timestamp format
  assert.equal((sqlite.prepare("SELECT created_at FROM crawl_batches WHERE id = 'bt1'").get() as any).created_at, "2026-01-02T10:00:00.000Z");
  sqlite.prepare("INSERT INTO crawl_batches (id, brand_id, created_at) VALUES ('bt2', 'b1', CURRENT_TIMESTAMP)").run();
  assert.match((sqlite.prepare("SELECT created_at FROM crawl_batches WHERE id = 'bt2'").get() as any).created_at, /T.*Z$/);
  // indexes
  const indexes = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as any[]).map((r) => r.name);
  for (const i of ["idx_runs_brand_created", "idx_runs_batch", "idx_cit_run", "idx_ment_run", "idx_batches_brand_status"]) assert.ok(indexes.includes(i), i);
  // pre-migration backup of the non-empty database, private
  const backups = fs.readdirSync(path.join(tmp, "legacy", "backups"));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(path.join(tmp, "legacy", "backups", backups[0]));
  assert.equal((backup.prepare("PRAGMA user_version").get() as any).user_version, 0);
  assert.equal((backup.prepare("SELECT COUNT(*) AS n FROM prompt_runs").get() as any).n, 1);
  backup.close();
  assert.equal(fs.statSync(path.join(tmp, "legacy", "backups", backups[0])).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // re-opening is a no-op
  assert.deepEqual(runMigrations(sqlite, file).applied, []);
  sqlite.close();
});

test("a fresh database gets the current schema without a backup", () => {
  const file = path.join(tmp, "fresh", "prismgeo.db");
  const sqlite = openDatabase(file);
  assert.equal((sqlite.prepare("PRAGMA user_version").get() as any).user_version, SCHEMA_VERSION);
  assert.equal(fs.existsSync(path.join(tmp, "fresh", "backups")), false);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  sqlite.close();
});

test("a failing migration rolls back, is reported, and leaves the version unchanged", () => {
  const file = path.join(tmp, "broken", "prismgeo.db");
  const sqlite = openDatabase(file);
  const broken = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: "broken", changesData: false, up: (d: DatabaseSync) => {
    addColumnIfMissing(d, "brands", "extra_col", "TEXT");
    d.exec("SELECT * FROM no_such_table");
  } }];
  assert.throws(() => runMigrations(sqlite, file, broken), /migration v\d+ \(broken\) failed and was rolled back/);
  assert.equal((sqlite.prepare("PRAGMA user_version").get() as any).user_version, SCHEMA_VERSION);
  assert.ok(!columnNames(sqlite, "brands").includes("extra_col"));
  // a database from a newer build is refused instead of being silently downgraded
  sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
  assert.throws(() => runMigrations(sqlite, file), /newer PrismGEO/);
  sqlite.close();
});

test("clients may share a name; a duplicate domain gets a readable error", () => {
  const a = createBrand({ name: "Northwind Voice", domain: "https://www.northwind-one.example/" });
  const b = createBrand({ name: "Northwind Voice", domain: "northwind-two.example", category: "AI voice agent" });
  assert.notEqual(a.slug, b.slug);
  assert.match(a.slug, /^northwind-voice-[0-9a-f]{6}$/);
  assert.equal(a.domain, "northwind-one.example");
  assert.equal(b.category, "AI voice agent");
  assert.throws(() => createBrand({ name: "Other", domain: "northwind-one.example" }), (e: unknown) => e instanceof BrandConflictError && /already exists/.test((e as Error).message));
  assert.throws(() => createBrand({ name: "Bad", domain: "a b.c" }), /not a valid domain/);
});

test("the query shim refuses unknown or missing filters instead of returning every client's rows", () => {
  assert.throws(() => db.query.competitors.findMany({ where: { domain: "talkly.com" } }), UnsupportedFilterError);
  assert.throws(() => db.query.prompts.findMany(), UnsupportedFilterError);
  assert.throws(() => db.query.citations.findMany({ where: { brandId: "b1", foo: 1 } }), UnsupportedFilterError);
  assert.throws(() => eq(undefined, "x"), UnsupportedFilterError);
  assert.deepEqual(db.query.prompts.findMany({ where: { brandId: "nobody" } }), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the database at a throwaway file before any module opens it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-test-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "test.db");
// Crawls in tests run as if from the default search location (no network check)
process.env.PRISMGEO_CONNECTION_COUNTRY = "us";

test("batches whose process stopped sending heartbeats are closed as interrupted", async () => {
  const { getRawDb } = await import("@prismgeo/db");
  const { closeStaleBatches } = await import("../src/queue/crawler-orchestrator");
  const sqlite = getRawDb();
  sqlite.prepare("INSERT INTO brands (id, slug, name, domain) VALUES ('b1', 'b1', 'Test', 'test.example')").run();
  const insert = sqlite.prepare("INSERT INTO crawl_batches (id, brand_id, status, created_at, heartbeat_at) VALUES (?, 'b1', 'running', ?, ?)");
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  insert.run("dead", old, old);
  insert.run("legacy", "2026-01-01 10:00:00", null); // pre-heartbeat row, SQLite timestamp format
  insert.run("alive", old, new Date().toISOString());

  assert.equal(closeStaleBatches(), 2);
  const status = (id: string) => (sqlite.prepare("SELECT status FROM crawl_batches WHERE id = ?").get(id) as { status: string }).status;
  assert.equal(status("dead"), "failed");
  assert.equal(status("legacy"), "failed");
  assert.equal(status("alive"), "running");
});

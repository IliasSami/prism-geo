import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkSqlShape, readsProtectedTable, runGuardedQuery } from "../src/sql";

let dir: string;
let dbPath: string;
let ro: DatabaseSync;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-sql-"));
  dbPath = path.join(dir, "test.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    INSERT INTO system_settings VALUES ('byok_api_keys', '{"openai":"sk-test-not-a-real-key"}');
    CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO brands VALUES ('b1', 'Northwind Voice');
    CREATE VIEW innocent AS SELECT value_json FROM system_settings;
  `);
  db.close();
  ro = new DatabaseSync(dbPath, { readOnly: true });
});

after(() => {
  ro.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("only one SELECT/WITH statement is accepted", () => {
  assert.equal(checkSqlShape("SELECT 1"), null);
  assert.equal(checkSqlShape("  -- note\n with x as (select 1) select * from x;"), null);
  assert.equal(checkSqlShape("SELECT ';' AS semi, \"a;b\" FROM brands"), null);
  assert.match(checkSqlShape("SELECT 1; SELECT 2") || "", /one statement/);
  assert.match(checkSqlShape("SELECT 1; /* c */ DELETE FROM brands") || "", /one statement/);
  assert.match(checkSqlShape("DELETE FROM brands") || "", /Only SELECT/);
  assert.match(checkSqlShape("/* hi */ PRAGMA table_info(brands)") || "", /Only SELECT/);
});

test("system_settings is refused however it is spelled", () => {
  for (const sql of [
    "SELECT * FROM system_settings",
    'SELECT * FROM "SYSTEM_SETTINGS"',
    "SELECT * FROM [system_settings]",
    "SELECT * FROM main.system_settings",
    "SELECT * FROM system_settings/**/",
    "SELECT key FROM system_settings WHERE key = 'x'",
    "SELECT * FROM innocent",
    "SELECT (SELECT value_json FROM system_settings LIMIT 1) AS v FROM brands",
    "WITH s AS (SELECT * FROM system_settings) SELECT * FROM s",
  ]) {
    assert.equal(readsProtectedTable(ro, sql), true, sql);
  }
  assert.equal(readsProtectedTable(ro, "SELECT * FROM brands"), false);
  assert.equal(readsProtectedTable(ro, "SELECT name FROM sqlite_master"), false);
});

test("queries return rows, refuse secrets and multiple statements", async () => {
  const ok = await runGuardedQuery(ro, dbPath, "SELECT name FROM brands");
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.rows.map((r) => r.name), ["Northwind Voice"]);
  const secret = await runGuardedQuery(ro, dbPath, "SELECT * FROM innocent");
  assert.ok(!secret.ok && /cannot be queried/.test(secret.error));
  const multi = await runGuardedQuery(ro, dbPath, "SELECT 1; SELECT * FROM system_settings");
  assert.ok(!multi.ok);
});

test("a huge result stops at the row cap quickly", async () => {
  const started = Date.now();
  const res = await runGuardedQuery(
    ro,
    dbPath,
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 2000000) SELECT x, printf('%0100d', x) FROM c",
  );
  assert.ok(res.ok);
  assert.equal(res.ok && res.rowCount, 500);
  assert.equal(res.ok && res.truncated, true);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("a single slow step is abandoned at the time budget without blocking the event loop", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 50);
  const res = await runGuardedQuery(
    ro,
    dbPath,
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 50000000) SELECT count(*) FROM c",
    { budgetMs: 300 },
  );
  clearInterval(timer);
  assert.ok(!res.ok && /took longer/.test(res.error), JSON.stringify(res));
  assert.ok(ticks >= 10, `event loop ran ${ticks} ticks`);
});

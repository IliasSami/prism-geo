import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-autopilot-")), "data", "test.db");
const { getRawDb, setSettings } = await import("@prismgeo/db");
const { engineRoom } = await import("../src/queue/autopilot");
const { recordBrowserBlock } = await import("../src/engines/block-memory");
const { raiseActionRequest, setActionStatus } = await import("../src/queue/action-requests");

const sqlite = getRawDb();
sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'acme', 'Acme', 'acme.example', '[]')").run();
const now = Date.parse("2026-11-02T12:00:00Z");

test("a free engine gets its daily budget; resting, waiting for a person or refusing questions pauses it", () => {
  setSettings("engine_settings", { mode: "hybrid" });
  assert.deepEqual(engineRoom("gemini", "b1", now), { room: 50, waiting: null }, "logged-out Gemini: 50 a day");

  recordBrowserBlock("gemini", "x", now);
  assert.match(engineRoom("gemini", "b1", now + 60_000).waiting ?? "", /rests after a block/);

  const r = raiseActionRequest({ brandId: "b1", batchId: null, engine: "chatgpt", kind: "human_check" });
  assert.match(engineRoom("chatgpt", "b1", now).waiting ?? "", /waits for you/);
  setActionStatus(r.id, "resolved");
  assert.equal(engineRoom("chatgpt", "b1", now).waiting, null);

  sqlite
    .prepare("INSERT INTO crawl_batches (id, brand_id, status, created_at, finished_at, errors_json) VALUES ('nb', 'b1', 'completed', ?, ?, ?)")
    .run(new Date(now - 3_600_000).toISOString(), new Date(now - 3_600_000).toISOString(), JSON.stringify([{ engine: "perplexity", promptId: null, kind: "not_accepted", message: "x" }]));
  assert.match(engineRoom("perplexity", "b1", now).waiting ?? "", /did not accept/);
  assert.equal(engineRoom("perplexity", "b1", now + 13 * 3_600_000).waiting, null, "tried again 12 hours later");
});

test("Google AI Mode runs only on today's SerpApi share", () => {
  assert.match(engineRoom("google_ai_mode", "b1", now).waiting ?? "", /needs a SerpApi key/);
  setSettings("byok_api_keys", { serpapi: "k" });
  setSettings("serpapi_ledger", { day: "2026-11-02", usedToday: 3, leftAtDayStart: 229, perMonth: 250, checkedAt: new Date(now).toISOString(), left: 226 });
  assert.deepEqual(engineRoom("google_ai_mode", "b1", now), { room: 4, waiting: null }, "7 a day, 3 used");
  setSettings("serpapi_ledger", { day: "2026-11-02", usedToday: 7, leftAtDayStart: 229, perMonth: 250, checkedAt: new Date(now).toISOString(), left: 222 });
  assert.match(engineRoom("google_ai_mode", "b1", now).waiting ?? "", /continues tomorrow/);
});

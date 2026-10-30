import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-blocks-mem-")), "test.db");
process.env.PRISMGEO_CONNECTION_COUNTRY = "bd";
const { browserCoolingDown, clearBrowserCooldown, recordBrowserBlock, recordBrowserSuccess } = await import("../src/engines/block-memory");
const { requestCalibration, getCalibration, calibrationBlocker } = await import("../src/queue/calibrate");
const { setSettings } = await import("@prismgeo/db");

const H = 3_600_000;

test("each block in a row rests the browser longer: 1, 3, 6, 12, then 24 hours", () => {
  const t0 = Date.parse("2026-10-30T00:00:00Z");
  const hours = [0, 1, 2, 3, 4, 5].map((i) => {
    const b = recordBrowserBlock("google_aio", "unusual traffic", t0 + i * H);
    return (Date.parse(b.until) - (t0 + i * H)) / H;
  });
  assert.deepEqual(hours, [1, 3, 6, 12, 24, 24]);
  assert.ok(browserCoolingDown("google_ai_mode", t0 + 5 * H), "AI Mode shares Google Search's block");
  assert.equal(browserCoolingDown("gemini", t0 + 5 * H), null, "Gemini is a different service");
  assert.equal(browserCoolingDown("google_aio", t0 + 30 * H), null, "the rest ends");
  // Blocks two days apart do not count as in a row
  assert.equal(recordBrowserBlock("google_aio", "x", t0 + 80 * H).blocks, 1);
});

test("a successful answer ends the streak; trying again now keeps the streak", () => {
  const now = Date.now();
  recordBrowserBlock("perplexity", "usage limit", now);
  clearBrowserCooldown("perplexity", now);
  assert.equal(browserCoolingDown("perplexity", now + 1), null);
  assert.equal(recordBrowserBlock("perplexity", "usage limit", now + 2).blocks, 2, "the streak is kept");
  recordBrowserSuccess("perplexity");
  assert.equal(recordBrowserBlock("perplexity", "usage limit", now + 3).blocks, 1);
});

test("a calibration that cannot run yet is queued with the reason, not refused", () => {
  setSettings("browser_blocks", {});
  setSettings("byok_api_keys", {});
  assert.match(calibrationBlocker()!, /SerpApi key/);
  const queued = requestCalibration("b1");
  assert.equal(queued.status, "waiting");
  assert.equal(queued.brandId, "b1");
  assert.match(queued.reason, /starts by itself/);
  assert.equal(getCalibration()?.status, "waiting");
  // With a reference saved, Google resting is the next thing it waits for
  setSettings("byok_api_keys", { serpapi: "k" });
  recordBrowserBlock("google_aio", "unusual traffic");
  assert.match(calibrationBlocker()!, /rests after a block/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-calibrate-")), "test.db");
const { jaccard, summarizeCalibration, CALIBRATION_MIN_QUESTIONS } = await import("../src/queue/calibrate");
type Q = Parameters<typeof summarizeCalibration>[0][number];

const q = (i: number, over: Partial<Q> = {}): Q => ({
  promptId: `p${i}`,
  overview: { browser: true, reference: true, repeat: true },
  sources: { browser: 0.6, repeat: 0.65 },
  companies: { browser: 0.8, repeat: 0.8 },
  ...over,
});

test("overlap is the Jaccard index; nothing to compare is null, not zero", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
  assert.equal(jaccard(new Set(), new Set()), null);
  assert.equal(jaccard(new Set(["a"]), new Set()), 0);
});

test("uule is trusted when it agrees with the reference about as well as the reference agrees with itself", () => {
  const close = summarizeCalibration(Array.from({ length: 10 }, (_, i) => q(i)));
  assert.equal(close.trusted, true, close.reason);
  assert.equal(close.agreement!.overview.browser, 1);
});

test("uule is not trusted when it agrees clearly worse than the noise floor, and the reason says where", () => {
  const sources = summarizeCalibration(Array.from({ length: 10 }, (_, i) => q(i, { sources: { browser: 0.2, repeat: 0.7 } })));
  assert.equal(sources.trusted, false);
  assert.match(sources.reason, /cited sites: 20% overlap vs 70%/);
  // From the wrong country Google often shows no Overview at all
  const overview = summarizeCalibration(Array.from({ length: 10 }, (_, i) => q(i, i < 4 ? { overview: { browser: false, reference: true, repeat: true }, sources: { browser: null, repeat: 0.6 }, companies: { browser: null, repeat: 0.8 } } : {})));
  assert.equal(overview.trusted, false);
  assert.match(overview.reason, /AI Overview shown: 60% agreement vs 100%/);
});

test("too few compared questions are never trusted", () => {
  const few = summarizeCalibration(Array.from({ length: CALIBRATION_MIN_QUESTIONS - 1 }, (_, i) => q(i)));
  assert.equal(few.trusted, false);
  assert.match(few.reason, /at least 8/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-serpapi-")), "test.db");
const { setSettings } = await import("@prismgeo/db");
const { spendSerpApi, dailyAllowance, reserveFor, configureSerpApiAccountFetch, serpApiBudgetState, ApiBudgetError } = await import("../src/engines/serpapi-quota");

let accountChecks = 0;
let left = 229;
configureSerpApiAccountFetch(async () => (accountChecks++, { total_searches_left: left, searches_per_month: 250 }));

test("the free plan is shared out over the month after a reserve", () => {
  assert.equal(reserveFor(250), 25);
  // 229 left on 2 November (29 days left, today included): (229 - 25) / 29 = 7 a day
  assert.equal(dailyAllowance({ leftAtDayStart: 229, perMonth: 250 }, new Date("2026-11-02T10:00:00Z")), 7);
  // Last day of the month: everything beyond the reserve
  assert.equal(dailyAllowance({ leftAtDayStart: 60, perMonth: 250 }, new Date("2026-11-30T10:00:00Z")), 35);
  assert.equal(dailyAllowance({ leftAtDayStart: 20, perMonth: 250 }, new Date("2026-11-30T10:00:00Z")), 0, "never into the reserve");
});

test("audits stop at today's share; calibration spends from the reserve; the account is checked sparingly", async () => {
  const day = new Date("2026-11-02T10:00:00Z");
  for (let i = 0; i < 7; i++) await spendSerpApi("k", 1, "audit", day);
  await assert.rejects(spendSerpApi("k", 1, "audit", day), (e: Error) => e instanceof ApiBudgetError && /Today's share/.test(e.message));
  await spendSerpApi("k", 2, "reserve", day);
  assert.equal(serpApiBudgetState(day).usedToday, 7, "calibration is counted apart");
  assert.equal(serpApiBudgetState(day).usedReserve, 2);
  assert.equal(accountChecks, 1, "one account check per ten minutes");
  // Next day: a fresh share from what is left
  left = 221;
  await spendSerpApi("k", 1, "audit", new Date("2026-11-03T10:00:00Z"));
  assert.equal(serpApiBudgetState(new Date("2026-11-03T10:00:00Z")).usedToday, 1);
});

test("parallel spends are all counted; a renewed plan starts a fresh share", async () => {
  setSettings("serpapi_ledger", {});
  left = 229;
  configureSerpApiAccountFetch(async () => (await new Promise((r) => setTimeout(r, 20)), { total_searches_left: left, searches_per_month: 250 }));
  const day = new Date("2026-11-10T10:00:00Z");
  // 9 in parallel against a share of (229 - 25) / 21 = 9
  await Promise.all(Array.from({ length: 9 }, () => spendSerpApi("k", 1, "audit", day)));
  assert.equal(serpApiBudgetState(day).usedToday, 9);
  await assert.rejects(spendSerpApi("k", 1, "audit", day), ApiBudgetError);
  // Ten minutes later the account shows the plan renewed: 250 left
  left = 250;
  const later = new Date("2026-11-10T10:11:00Z");
  await spendSerpApi("k", 1, "audit", later);
  assert.equal(serpApiBudgetState(later).usedToday, 1);
});

test("nothing is spent when the plan cannot be checked", async () => {
  setSettings("serpapi_ledger", {});
  configureSerpApiAccountFetch(async () => ({ error: "Invalid API key" }));
  await assert.rejects(spendSerpApi("bad", 1, "audit", new Date("2026-11-05T10:00:00Z")), ApiBudgetError);
});

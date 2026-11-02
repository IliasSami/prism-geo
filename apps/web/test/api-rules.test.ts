import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-web-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");
process.env.PRISMGEO_LOG_FILE = "off";

// Loaded after the database path is set (this package compiles tests as CommonJS: no top-level await)
let getRawDb: typeof import("@prismgeo/db").getRawDb;
let describeIssues: typeof import("../src/app/api/_lib/http").describeIssues;
let crawl: typeof import("../src/app/api/_lib/crawl");
let limits: typeof import("../src/app/api/_lib/limits");
let engineSettingsSchema: typeof import("../src/app/api/_lib/validate").engineSettingsSchema;
before(async () => {
  ({ getRawDb } = await import("@prismgeo/db"));
  ({ describeIssues } = await import("../src/app/api/_lib/http"));
  crawl = await import("../src/app/api/_lib/crawl");
  limits = await import("../src/app/api/_lib/limits");
  ({ engineSettingsSchema } = await import("../src/app/api/_lib/validate"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const message = (schema: z.ZodType, body: unknown) => {
  const r = schema.safeParse(body);
  assert.ok(!r.success, JSON.stringify(body));
  return describeIssues(r.error);
};

test("crawl start refuses unknown keys with a readable message", () => {
  assert.equal(message(crawl.crawlStartSchema, { enabled: "yes" }), 'Unknown field: "enabled". Remove it and try again.');
  assert.ok(crawl.crawlStartSchema.safeParse({ engines: ["chatgpt"], sampleSize: 1 }).success);
});

test("validation messages read naturally and never repeat the field", () => {
  const crawler = z.object({
    proxyUrl: z.string().refine(() => false, "Proxy URL must look like http://user:pass@host:port"),
    scheduleEnabled: z.boolean({ error: "scheduleEnabled must be true or false" }),
  });
  assert.equal(message(z.object({ crawler }), { crawler: { proxyUrl: "x", scheduleEnabled: true } }), "Proxy URL must look like http://user:pass@host:port");
  assert.equal(message(z.object({ crawler }), { crawler: { proxyUrl: "x", scheduleEnabled: "on" } }).split("; ")[1], "Daily audit must be true or false");
  assert.equal(message(z.object({ id: z.string() }), {}), "ID is required");
  assert.equal(message(z.object({ sampleSize: z.number() }), { sampleSize: "x" }), "Runs per question must be a number");
  assert.equal(message(engineSettingsSchema, { chatgpt: "yes" }), "ChatGPT must be true or false");
  assert.equal(message(z.object({ competitors: z.array(z.object({ domain: z.string().min(3, "Enter a domain like example.com") })) }), { competitors: [{ domain: "a" }] }), "Competitor 1 website: Enter a domain like example.com");
});

test("question lines: line numbers of the text box, short lines ignored", () => {
  const { LIMITS, questionLines, tooLongMessage } = limits;
  const long = "x".repeat(LIMITS.promptMax + 1);
  const parsed = questionLines(`best voice agent for shopify\n\nabc\n${long}`);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.ignored, 1);
  assert.deepEqual(parsed.tooLong, [{ line: 4, length: LIMITS.promptMax + 1 }]);
  assert.match(tooLongMessage(parsed.tooLong) ?? "", /^Line 4 is 501 characters/);
  assert.equal(tooLongMessage([]), null);
});

test("startCrawl never runs engines switched off in Settings", () => {
  const sqlite = getRawDb();
  sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'b1', 'Northwind', 'northwind.ai', '[]')").run();
  sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension) VALUES ('p1', 'b1', 'best ai voice agent', 'category', 'buyer')").run();
  const setEngines = (v: Record<string, unknown>) =>
    sqlite.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('engine_settings', ?, '')").run(JSON.stringify(v));
  const brand = { id: "b1", name: "Northwind", domain: "northwind.ai" } as Parameters<typeof crawl.startCrawl>[0];

  setEngines({ chatgpt: false, gemini: false, perplexity: false, google_aio: false, google_ai_mode: false, copilot: false });
  const allOff = crawl.startCrawl(brand, {});
  assert.equal(allOff.ok, false);
  assert.ok(!allOff.ok && allOff.status === 400 && /Every engine is switched off/.test(allOff.body.error) && /Settings → Engines & access/.test(allOff.body.error));

  setEngines({ chatgpt: false });
  const named = crawl.startCrawl(brand, { engines: ["chatgpt"] });
  assert.ok(!named.ok);
  assert.ok(!named.ok && /ChatGPT is switched off in Settings/.test(named.body.error));
  assert.deepEqual(!named.ok && named.body.ignoredEngines, [{ engine: "chatgpt", reason: crawl.SWITCHED_OFF_REASON }]);
});

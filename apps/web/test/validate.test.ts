import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byokSchema,
  categorySchema,
  dedupePrompts,
  engineSettingsSchema,
  intSchema,
  normalizeDomain,
  promptListSchema,
} from "../src/app/api/_lib/validate";
import { maskKey, maskProxyUrl, unmaskProxyUrl } from "../src/app/api/_lib/secrets";
import { sanitizeCsvCell } from "../src/app/api/_lib/csv";

test("domains are normalized and validated", () => {
  assert.equal(normalizeDomain("https://www.NorthwindVoice.ai/pricing?x=1"), "northwindvoice.ai");
  assert.equal(normalizeDomain("northwindvoice.ai:443"), "northwindvoice.ai");
  assert.equal(normalizeDomain("app.northwindvoice.ai."), "app.northwindvoice.ai");
  assert.equal(normalizeDomain("a b.c"), null);
  assert.equal(normalizeDomain("nodot"), null);
  assert.equal(normalizeDomain(""), null);
});

test("prompts may be strings or objects, and invalid entries are refused with their position", () => {
  const ok = promptListSchema.safeParse(["best voice agent for shopify", { query: "which tool calls abandoned carts", intent: "category" }]);
  assert.ok(ok.success);
  assert.deepEqual(ok.data?.map((p) => p.queryText), ["best voice agent for shopify", "which tool calls abandoned carts"]);
  assert.equal(ok.data?.[1].intentType, "category");

  for (const bad of [["abc"], [{ foo: 1 }], [{ query: "   " }], ["x".repeat(700)], [42], [{ query: "valid question", intent: { a: 1 } }]]) {
    const res = promptListSchema.safeParse(bad);
    assert.ok(!res.success, JSON.stringify(bad));
    assert.equal(res.error?.issues[0].path[0], 0);
  }
  assert.ok(!promptListSchema.safeParse([]).success);
});

test("duplicate prompts are found case-insensitively", () => {
  const { unique, duplicates } = dedupePrompts(
    [{ queryText: "Same question here" }, { queryText: "same question here" }, { queryText: "Another one" }],
    ["another ONE"],
  );
  assert.deepEqual(unique.map((p) => p.queryText), ["Same question here"]);
  assert.deepEqual(duplicates, ["same question here", "Another one"]);
});

test("numbers accept numeric strings and are range-checked", () => {
  const runs = intSchema(1, 20, "Runs");
  assert.equal(runs.parse("3"), 3);
  assert.equal(runs.parse(5), 5);
  assert.ok(!runs.safeParse(0).success);
  assert.ok(!runs.safeParse("abc").success);
  assert.ok(!runs.safeParse(2.5).success);
});

test("engine settings and API key names are whitelisted", () => {
  assert.ok(engineSettingsSchema.safeParse({ chatgpt: true, mode: "hybrid" }).success);
  assert.ok(engineSettingsSchema.safeParse({ mode: "stealth" }).success);
  assert.ok(!engineSettingsSchema.safeParse({ mode: "turbo" }).success);
  assert.ok(!engineSettingsSchema.safeParse({ chatgpt: "no" }).success);
  assert.ok(!engineSettingsSchema.safeParse({ bogus: true }).success);
  assert.ok(byokSchema.safeParse({ openai: "sk-x", gemini: null }).success);
  assert.ok(!byokSchema.safeParse({ bogus_provider: "x" }).success);
});

test("a category is 2 to 8 words", () => {
  assert.ok(categorySchema.safeParse("AI voice agents for e-commerce").success);
  assert.ok(!categorySchema.safeParse("Voice").success);
  assert.ok(!categorySchema.safeParse("one two three four five six seven eight nine").success);
});

test("secrets are masked to at most the last 4 characters", () => {
  assert.equal(maskKey("sk-test-1234567890"), "••••7890");
  assert.equal(maskKey("short"), "••••");
  assert.equal(maskKey(""), "");
  const masked = maskProxyUrl("http://user:hunter2@proxy.example.com:8080");
  assert.equal(masked, "http://user:••••@proxy.example.com:8080/");
  assert.ok(!masked.includes("hunter2"));
  assert.equal(unmaskProxyUrl(masked, "http://user:hunter2@proxy.example.com:8080"), "http://user:hunter2@proxy.example.com:8080/");
  assert.equal(unmaskProxyUrl("http://user:••••@other.example.com:9090", "http://user:hunter2@proxy.example.com:8080"), "http://user:hunter2@other.example.com:9090/");
  assert.equal(unmaskProxyUrl("http://new:pass@proxy.example.com:1", "http://user:hunter2@proxy.example.com:8080"), "http://new:pass@proxy.example.com:1");
});

test("CSV cells neutralise formulas, also after spaces and in full-width form", () => {
  assert.equal(sanitizeCsvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(sanitizeCsvCell(" =1+1"), `"' =1+1"`);
  assert.equal(sanitizeCsvCell("＝SUM(1)"), `"'＝SUM(1)"`);
  assert.equal(sanitizeCsvCell("plain"), `"plain"`);
  assert.equal(sanitizeCsvCell(null), `""`);
});

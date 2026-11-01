import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway database; never the repo's data/ directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-actions-"));
process.env.PRISMGEO_DB_PATH = path.join(tmp, "data", "test.db");
process.env.PRISMGEO_CONNECTION_COUNTRY = "us";

const { getRawDb, setSettings } = await import("@prismgeo/db");
const { CrawlerOrchestrator, configureCitedPageFetch } = await import("../src/queue/crawler-orchestrator");
const actions = await import("../src/queue/action-requests");
const { ChatGptEngineCrawler } = await import("../src/engines/chatgpt");
const { GeminiEngineCrawler } = await import("../src/engines/gemini");
const { EngineBlockedError } = await import("../src/engines/browser-session");
const { browserCoolingDown } = await import("../src/engines/block-memory");
const { usableVisitorProfile, writeVisitorMarker } = await import("../src/engines/profiles");
const playwright = await import("playwright");

// No browser and no network in tests
(playwright.chromium as any).launch = async () => {
  throw new Error("test harness: browser disabled");
};
configureCitedPageFetch(async () => "");

const sqlite = getRawDb();
const PROMPTS = ["best crm for a small agency", "cheapest email tool", "crm with a free plan", "alternatives to big crm"];
const answer = (q: string, engine: string) => ({
  engine,
  query: q,
  responseText: `A long enough answer to "${q}" that names nobody we track, for the test.`,
  citations: [],
  subQueries: [],
  executionMs: 1,
  captureMethod: "browser" as const,
});
const errorsOf = (batchId: string) => JSON.parse((sqlite.prepare("SELECT errors_json FROM crawl_batches WHERE id = ?").get(batchId) as any).errors_json) as Array<{ kind: string; promptId: string | null; message: string }>;
const stored = (batchId: string, engine: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE batch_id = ? AND engine = ?").get(batchId, engine) as any).n as number;
const ids = PROMPTS.map((_, i) => `p-${i}`);
const human = () => new EngineBlockedError('[ChatGptCrawler] Blocked by engine (a "verify you are human" check)');
const reset = () => {
  sqlite.prepare("DELETE FROM action_requests").run();
  setSettings("browser_blocks", {});
};

before(() => {
  setSettings("engine_settings", { mode: "stealth" });
  sqlite.prepare("INSERT INTO brands (id, slug, name, domain, aliases_json) VALUES ('b1', 'acme', 'Acme', 'acme.example', '[]')").run();
  PROMPTS.forEach((q, i) =>
    sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, active, created_at) VALUES (?, 'b1', ?, 'category', 1, ?)").run(`p-${i}`, q, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
  );
});

test("only steps a person can take are raised: checks and sign-ins, never rate limits", () => {
  assert.equal(actions.needsPerson('[ChatGptCrawler] Blocked by engine (a "verify you are human" check)'), "human_check");
  assert.equal(actions.needsPerson('[GoogleAioCrawler] Blocked by engine ("unusual traffic")'), "human_check");
  assert.equal(actions.needsPerson('[PerplexityCrawler] Blocked by engine ("just a moment")'), "human_check");
  assert.equal(actions.needsPerson("[CopilotCrawler] No chat box: the Microsoft session expired, reconnect it in Settings"), "sign_in");
  assert.equal(actions.needsPerson('[PerplexityCrawler] Blocked by engine ("sign up and repeat your request")'), "sign_in");
  assert.equal(actions.needsPerson('[PerplexityCrawler] The account\'s usage limit is reached ("reached your free search limit"); it resets after a few hours'), null);
  assert.equal(actions.needsPerson('[ChatGptCrawler] Throttled reply instead of an answer ("unusual activity has been detected")'), null);
  assert.equal(actions.needsPerson("[GeminiApi] API rate limit or quota reached (429): quota"), null);
  assert.equal(actions.needsPerson("page.goto: Timeout 30000ms exceeded"), null);
  assert.equal(actions.pageForAction("google_aio", "best crm"), "https://www.google.com/search?q=best%20crm");
});

test("a human check holds only that engine; once the person is done the audit finishes without errors", async () => {
  reset();
  let checkShown = true;
  const asked: string[] = [];
  (ChatGptEngineCrawler as any).execute = async (q: string) => {
    if (checkShown) throw human();
    asked.push(q);
    return answer(q, "chatgpt");
  };
  (GeminiEngineCrawler as any).execute = async (q: string) => answer(q, "gemini");

  // The person sees the bell, completes the check and closes the window a moment later
  const person = (async () => {
    for (let i = 0; i < 200 && !actions.listActionRequests().length; i++) await new Promise((r) => setTimeout(r, 10));
    const [request] = actions.listActionRequests();
    assert.equal(request.engine, "chatgpt");
    assert.equal(request.kind, "human_check");
    assert.equal(request.status, "open");
    assert.equal(request.pendingPromptIds.length, 1, "the question that hit the check is held");
    checkShown = false;
    actions.setActionStatus(request.id, "ready");
    return request.id;
  })();

  const batchId = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt", "gemini"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 10_000 });
  const requestId = await person;
  assert.deepEqual(errorsOf(batchId), [], "no failures: the held question was asked again");
  assert.equal(stored(batchId, "chatgpt"), PROMPTS.length);
  assert.equal(stored(batchId, "gemini"), PROMPTS.length);
  assert.deepEqual([...asked].sort(), [...PROMPTS].sort());
  const done = actions.getActionRequest(requestId)!;
  assert.equal(done.status, "resolved");
  assert.deepEqual(done.pendingPromptIds, []);
  assert.equal(browserCoolingDown("chatgpt"), null, "no rest period after the person cleared it");
  const batch = sqlite.prepare("SELECT status, current_prompt FROM crawl_batches WHERE id = ?").get(batchId) as any;
  assert.equal(batch.status, "completed");
  assert.equal(batch.current_prompt, "Audit completed successfully");
});

test("when nobody comes in time the questions stay on the request; the next audit waits instead of searching; resume asks them", async () => {
  reset();
  let searches = 0;
  (ChatGptEngineCrawler as any).execute = async () => {
    searches++;
    throw human();
  };
  const b1 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 30 });
  assert.equal(searches, 1, "one search hit the check; the rest were not sent into it");
  const e1 = errorsOf(b1);
  assert.deepEqual(e1.map((e) => e.kind), ids.map(() => "waiting_for_person"));
  const [request] = actions.listActionRequests();
  assert.deepEqual([...request.pendingPromptIds].sort(), [...ids].sort(), "every question not asked is on the request");
  assert.equal(request.batchId, b1);

  // The next audit finds the request still open: it holds the engine from the start, no search
  const b2 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 30 });
  assert.equal(searches, 1);
  assert.deepEqual(errorsOf(b2).map((e) => e.kind), ids.map(() => "waiting_for_person"));
  assert.equal(actions.listActionRequests().length, 1, "still one bell entry, not one per audit");

  // Later the person completes it and resumes: exactly the held questions are asked
  assert.ok(browserCoolingDown("chatgpt"), "the browser route rests while nobody has cleared the check");
  actions.markActionDone(request.id);
  assert.equal(browserCoolingDown("chatgpt"), null, "done ends the rest period");
  const asked: string[] = [];
  (ChatGptEngineCrawler as any).execute = async (q: string) => (asked.push(q), answer(q, "chatgpt"));
  const held = actions.getActionRequest(request.id)!.pendingPromptIds;
  actions.setPendingPrompts(request.id, []);
  actions.setActionStatus(request.id, "resolved");
  const b3 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIdsByEngine: { chatgpt: held }, pacingScale: 0, personWaitMs: 0 });
  assert.deepEqual(errorsOf(b3), []);
  assert.deepEqual([...asked].sort(), [...PROMPTS].sort());
});

test("a dismissed request stops the engine for the audit without holding questions", async () => {
  reset();
  (ChatGptEngineCrawler as any).execute = async () => {
    throw human();
  };
  const dismisser = (async () => {
    for (let i = 0; i < 200 && !actions.listActionRequests().length; i++) await new Promise((r) => setTimeout(r, 10));
    actions.setActionStatus(actions.listActionRequests()[0].id, "dismissed");
  })();
  const b = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 10_000 });
  await dismisser;
  assert.deepEqual(errorsOf(b).map((e) => e.kind), ids.map(() => "skipped_after_blocks"));
  assert.equal(actions.listActionRequests().length, 0);
});

test("rate limits are not raised to a person: the engine rests as before", async () => {
  reset();
  (ChatGptEngineCrawler as any).execute = async () => {
    throw new EngineBlockedError('[ChatGptCrawler] Throttled reply instead of an answer ("too many requests")');
  };
  await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids.slice(0, 1), pacingScale: 0, personWaitMs: 10_000 });
  assert.equal(actions.listActionRequests().length, 0);
});

test("a check completed in the visitor profile is reused for 30 days, then asked for again", () => {
  assert.equal(usableVisitorProfile("chatgpt"), null);
  writeVisitorMarker("chatgpt", "Mozilla/5.0 Chrome/141", Date.now() - 31 * 24 * 3_600_000);
  assert.equal(usableVisitorProfile("chatgpt"), null);
  writeVisitorMarker("chatgpt", "Mozilla/5.0 Chrome/141");
  assert.equal(usableVisitorProfile("chatgpt")?.userAgent, "Mozilla/5.0 Chrome/141");
});

test("with no screen, an open check is still shown under the bell but never stops the rest period from applying", async () => {
  reset();
  let searches = 0;
  (ChatGptEngineCrawler as any).execute = async () => {
    searches++;
    throw human();
  };
  await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 0 });
  assert.equal(searches, 1);
  assert.equal(actions.listActionRequests().length, 1, "the request is raised for the bell");
  // The next audit rests instead of being let through by the open request (which nobody can complete here)
  const b2 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 0 });
  assert.deepEqual(errorsOf(b2).map((e) => e.kind), ["cooling_down"]);
  assert.equal(searches, 1);
  // Once the rest period is over the engine searches again rather than being held forever
  setSettings("browser_blocks", {});
  (ChatGptEngineCrawler as any).execute = async (q: string) => (searches++, answer(q, "chatgpt"));
  const b3 = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 0 });
  assert.equal(stored(b3, "chatgpt"), PROMPTS.length);
  assert.equal(actions.listActionRequests().length, 1, "still shown under the bell");
});

test("open requests are kept per client: another brand's audit neither takes over nor rewrites them", () => {
  reset();
  sqlite.prepare("INSERT OR IGNORE INTO brands (id, slug, name, domain, aliases_json) VALUES ('b2', 'other', 'Other', 'other.example', '[]')").run();
  const a = actions.raiseActionRequest({ brandId: "b1", batchId: "x1", engine: "chatgpt", kind: "human_check", promptIds: ["p-0"] });
  const b = actions.raiseActionRequest({ brandId: "b2", batchId: "x2", engine: "chatgpt", kind: "human_check", promptIds: ["q-0"] });
  assert.notEqual(a.id, b.id);
  assert.deepEqual(actions.getActionRequest(a.id)!.pendingPromptIds, ["p-0"]);
  assert.equal(actions.getActionRequest(a.id)!.brandId, "b1");
  assert.equal(actions.openActionFor("chatgpt", "b1")!.id, a.id);
  assert.equal(actions.openActionFor("chatgpt", "b2")!.id, b.id);
  assert.equal(actions.listActionRequests().length, 2, "the bell lists every client's requests");
});

test("a sign-in notice never downgrades an open human check", () => {
  reset();
  const a = actions.raiseActionRequest({ brandId: "b1", batchId: "x1", engine: "chatgpt", kind: "human_check", promptIds: ["p-0"] });
  const b = actions.raiseActionRequest({ brandId: "b1", batchId: "x2", engine: "chatgpt", kind: "sign_in", detail: "The saved session expired" });
  assert.equal(b.id, a.id);
  assert.equal(b.kind, "human_check");
  assert.match(b.message, /verify you are human/);
});

test("an unexpected throw in one engine fails that engine only; the batch closes after the others finish", async () => {
  reset();
  // A malformed result throws outside the engine's own error handling
  (ChatGptEngineCrawler as any).execute = async () => null;
  (GeminiEngineCrawler as any).execute = async (q: string) => {
    await new Promise((r) => setTimeout(r, 20));
    return answer(q, "gemini");
  };
  const b = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt", "gemini"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 0 });
  assert.equal(stored(b, "gemini"), PROMPTS.length, "gemini finished inside the batch");
  const errs = errorsOf(b);
  assert.ok(errs.length > 0 && errs.every((e) => e.kind === "error"));
  const batch = sqlite.prepare("SELECT status, finished_at FROM crawl_batches WHERE id = ?").get(b) as any;
  assert.equal(batch.status, "completed");
  assert.ok(batch.finished_at);
});

test("a step completed in the window that the engine still shows is not asked for again (seen live on Copilot)", async () => {
  reset();
  (ChatGptEngineCrawler as any).execute = async () => {
    throw new EngineBlockedError("[ChatGptCrawler] No chat box: the session expired, reconnect it in Settings");
  };
  let marked = 0;
  const person = (async () => {
    for (let i = 0; i < 300 && !actions.listActionRequests().length; i++) await new Promise((r) => setTimeout(r, 10));
    const [request] = actions.listActionRequests();
    assert.equal(request.kind, "sign_in");
    actions.setActionStatus(request.id, "ready");
    marked++;
  })();
  const b = await CrawlerOrchestrator.executeBatch({ brandId: "b1", engines: ["chatgpt"], sampleSize: 1, promptIds: ids, pacingScale: 0, personWaitMs: 5_000 });
  await person;
  assert.equal(marked, 1);
  assert.equal(actions.listActionRequests({ includeClosed: true }).length, 1, "no second request right after the person completed the first");
  const errs = errorsOf(b);
  assert.ok(errs.some((e) => /completed in the window, but ChatGPT still shows it to the automated browser; use a key or capture by hand/.test(e.message)), JSON.stringify(errs));
  assert.ok(!errs.some((e) => e.kind === "waiting_for_person"));
});

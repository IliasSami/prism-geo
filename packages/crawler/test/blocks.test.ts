import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-blocks-")), "test.db");
const { assertNotBlocked, EngineBlockedError } = await import("../src/engines/browser-session");

/** Just enough of a Playwright page for assertNotBlocked. */
const pageWith = (text: string, challenge = false) =>
  // evaluate(fn) reads the page text; evaluate(fn, selector) asks whether a human check is shown
  ({ evaluate: async (_fn: unknown, arg?: unknown) => (arg === undefined ? text : challenge) }) as unknown as Parameters<typeof assertNotBlocked>[0];

test("a free account's usage-limit dialog is a block, not a missing answer", async () => {
  // The dialog follows a long sidebar of recent threads (seen live on Perplexity)
  const sidebar = "Recents\n" + "an earlier question about abandoned carts\n".repeat(120);
  const page = pageWith(`${sidebar}You've reached your free search limit\nYour access will reset in a few hours. Upgrade to Perplexity Pro.`);
  await assert.rejects(assertNotBlocked(page, "PerplexityCrawler"), (err: Error) => err instanceof EngineBlockedError && /usage limit/.test(err.message));
});

test("an answer that discusses limits is not mistaken for a block", async () => {
  await assertNotBlocked(pageWith("Most SMS tools have a free plan limit of 100 messages; the search limit on APIs varies."), "PerplexityCrawler");
});

test("a Cloudflare 'verify you are human' check drawn in its own frame is a block", async () => {
  // The page text is empty: the check's words live inside Cloudflare's frame (seen live on ChatGPT)
  await assert.rejects(assertNotBlocked(pageWith("", true), "ChatGptCrawler"), (err: Error) => err instanceof EngineBlockedError && /verify you are human/.test(err.message));
});

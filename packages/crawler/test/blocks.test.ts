import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-blocks-")), "test.db");
const { assertNotBlocked, EngineBlockedError } = await import("../src/engines/browser-session");

/** Just enough of a Playwright page for assertNotBlocked. */
const pageWith = (text: string) => ({ evaluate: async () => text }) as unknown as Parameters<typeof assertNotBlocked>[0];

test("a free account's usage-limit dialog is a block, not a missing answer", async () => {
  // The dialog follows a long sidebar of recent threads (seen live on Perplexity)
  const sidebar = "Recents\n" + "an earlier question about abandoned carts\n".repeat(120);
  const page = pageWith(`${sidebar}You've reached your free search limit\nYour access will reset in a few hours. Upgrade to Perplexity Pro.`);
  await assert.rejects(assertNotBlocked(page, "PerplexityCrawler"), (err: Error) => err instanceof EngineBlockedError && /usage limit/.test(err.message));
});

test("an answer that discusses limits is not mistaken for a block", async () => {
  await assertNotBlocked(pageWith("Most SMS tools have a free plan limit of 100 messages; the search limit on APIs varies."), "PerplexityCrawler");
});

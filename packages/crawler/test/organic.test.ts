import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-organic-")), "test.db");
const { readOrganicResults } = await import("../src/engines/google-aio");
const { chromium } = await import("playwright");

let browserAvailable = true;
try {
  await (await chromium.launch()).close();
} catch {
  browserAvailable = false;
}

// The parts of a Google results page that matter: AI Overview, ads, organic results
const PAGE = `
<div id="m-x-content"><a href="https://aio-source.example/page"><h3>Cited in the AI Overview</h3></a></div>
<div id="search">
  <div id="tads"><a href="https://ad.example/landing"><h3>Sponsored result</h3></a></div>
  <div id="rso">
    <div><a href="https://www.klaviyo.com/blog/abandoned-cart?utm_source=google"><h3>Abandoned cart emails | Klaviyo</h3></a></div>
    <div><a href="/url?q=https://www.shopify.com/blog/abandoned-carts&sa=U"><h3>Recover abandoned carts - Shopify</h3></a></div>
    <div><a href="https://www.google.com/search?q=related"><h3>More results</h3></a></div>
    <div><a href="https://www.klaviyo.com/blog/abandoned-cart"><h3>Duplicate of the first</h3></a></div>
    <div><a href="https://example.org/guide"><div role="heading" aria-level="3">A guide</div></a></div>
  </div>
</div>`;

test("organic results are read in order, without ads, AI Overview links, Google's own pages or duplicates", { skip: !browserAvailable && "no Chromium installed" }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://www.google.com/**", (r) => r.fulfill({ contentType: "text/html", body: PAGE }));
    await page.goto("https://www.google.com/search?q=abandoned+carts");
    const results = await readOrganicResults(page);
    assert.deepEqual(
      results.map((r) => [r.position, new URL(r.url).hostname, r.title]),
      [
        [1, "www.klaviyo.com", "Abandoned cart emails | Klaviyo"],
        [2, "www.shopify.com", "Recover abandoned carts - Shopify"],
        [3, "example.org", "A guide"],
      ]
    );
    assert.doesNotMatch(results[0].url, /utm_source/, "tracking parameters are removed");
  } finally {
    await browser.close();
  }
});

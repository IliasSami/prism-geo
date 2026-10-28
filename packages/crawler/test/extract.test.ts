import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { extractAnswer } from "../src/engines/browser-session";

/** Runs the real extractAnswer() DOM routine against static HTML through a small cheerio DOM shim. */
function fakePage(html: string) {
  const $ = cheerio.load(html);
  const wrap = (node: any): any => ({
    get textContent() {
      return $(node).text();
    },
    getAttribute: (n: string) => $(node).attr(n) ?? null,
    remove: () => $(node).remove(),
    get parentElement() {
      return node.parent && node.parent.type !== "root" ? wrap(node.parent) : null;
    },
    insertAdjacentText: (_pos: string, text: string) => $(node).after(text.replace(/&/g, "&amp;").replace(/</g, "&lt;")),
    querySelectorAll: (sel: string) => $(node).find(sel).toArray().map(wrap),
    cloneNode: () => wrap($(node).clone()[0]),
  });
  (globalThis as any).location = { href: "https://chat.example/" };
  (globalThis as any).document = { querySelectorAll: (sel: string) => $(sel).toArray().map(wrap) };
  return { evaluate: async (fn: any, arg: any) => fn(arg) } as any;
}

const html = `
<div data-message-author-role="assistant"><div class="markdown">
  <p>For Shopify cart-recovery phone calls, these are the strongest options:</p>
  <ol>
    <li><p><strong><a href="https://talkly.com/?utm_source=chatgpt.com">Talkly</a></strong> — Shopify-native AI voice agent; calls within minutes.
      <span><a href="https://www.talkly.com/blog/calls?utm_source=chatgpt.com">talkly.com</a></span></p></li>
    <li><p><strong><a href="https://northwindvoice.ai/?utm_source=chatgpt.com">Northwind</a></strong> — pay per recovered order; best fit for smaller brands.
      <a href="https://www.reddit.com/r/shopify/comments/abc?utm_source=chatgpt.com">Reddit +1</a></p></li>
    <li><p><strong>Dialsy AI</strong> — high call volume, Klaviyo sync.</p></li>
    <li><p>Also see <a href="https://vocalyze.io/?utm_source=chatgpt.com">Vocalyze</a> for custom workflows.</p></li>
    <li><p><a href="https://ringocalls.com/">Callora.io</a></p></li>
    <li><p><a href="https://help.example.com/x">helpexample</a></p></li>
  </ol>
</div></div>`;

test("hyperlinked vendor names stay in the answer text; source chips are removed but kept as links", async () => {
  const ex = await extractAnswer(fakePage(html), "[data-message-author-role='assistant']", ["chat.example"]);
  for (const name of ["Talkly —", "Northwind —", "Dialsy AI —", "Also see Vocalyze for custom workflows.", "Callora.io"]) {
    assert.ok(ex.text.includes(name), `"${name}" kept in:\n${ex.text}`);
  }
  assert.ok(!/talkly\.com|Reddit \+1|helpexample/.test(ex.text), `chips removed:\n${ex.text}`);
  const urls = ex.links.map((l) => l.url);
  assert.ok(urls.includes("https://talkly.com/?utm_source=chatgpt.com"));
  assert.ok(urls.includes("https://www.reddit.com/r/shopify/comments/abc?utm_source=chatgpt.com"));
  assert.ok(urls.includes("https://help.example.com/x"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, hostKey, isInternalHost, isPrivateAddress, ReverseRagParser, competitorMatcher } from "../src/index";

test("canonical URL: tracking params, fragment, trailing slash, scheme, case, default port", () => {
  const same = [
    "https://northwindvoice.ai/blog/post",
    "https://northwindvoice.ai/blog/post/",
    "https://northwindvoice.ai/blog/post#pricing",
    "http://northwindvoice.ai/blog/post",
    "HTTPS://NORTHWINDVOICE.AI:443/blog/post?utm_source=chatgpt.com",
    "https://northwindvoice.ai/blog/post?srsltid=AfmBOoq123&gclid=x&fbclid=y&msclkid=z&_gl=1",
  ];
  for (const u of same) assert.equal(canonicalUrl(u), "https://northwindvoice.ai/blog/post", u);
  assert.equal(canonicalUrl("https://talkly.com/p?id=7&utm_medium=x"), "https://talkly.com/p?id=7");
  assert.equal(canonicalUrl("https://www.talkly.com/"), "https://www.talkly.com", "www is kept for fetching");
  assert.equal(canonicalUrl("https://en.wikipedia.org/wiki/Hoop_(company)"), "https://en.wikipedia.org/wiki/Hoop_(company)");
  assert.equal(canonicalUrl("https://example.com/a)."), "https://example.com/a", "unbalanced ) and sentence dot");
  assert.equal(canonicalUrl("https://www.google.com/url?q=https://talkly.com/blog&sa=U"), "https://talkly.com/blog");
  assert.equal(canonicalUrl("ftp://talkly.com/x"), null);
  assert.equal(canonicalUrl("not a url"), null);
  assert.equal(hostKey("https://WWW.Talkly.com:8080/x"), "talkly.com");
});

test("citation extraction: balanced parentheses, document order, de-duplication, brand with scheme", () => {
  const cits = ReverseRagParser.extractCitationsFromText(
    "Intro https://talkly.com/a then [Northwind](https://northwindvoice.ai/b) and [Wiki](https://en.wikipedia.org/wiki/Hoop_(company)). Again https://talkly.com/a/ and http://talkly.com/a#x",
    "https://www.northwindvoice.ai",
    ["talkly.com"]
  );
  assert.deepEqual(
    cits.map((c) => [c.rank, c.url]),
    [
      [1, "https://talkly.com/a"],
      [2, "https://northwindvoice.ai/b"],
      [3, "https://en.wikipedia.org/wiki/Hoop_(company)"],
    ]
  );
  assert.equal(cits[0].isCompetitorDomain, true);
  assert.equal(cits[1].isBrandDomain, true);
  assert.equal(cits[1].anchorText, "Northwind");
});

test("private, loopback, link-local and internal URLs are never citations", () => {
  const text =
    "[creds](http://169.254.169.254/latest/meta-data/) http://localhost:3333/api/connector http://127.0.0.1:3333/api/export http://[::1]:3333/x http://10.0.0.5/admin http://192.168.1.1/ http://100.64.0.1/ http://[fd00::1]/ http://[::ffff:127.0.0.1]/ http://router.local/ https://talkly.com/ok";
  const cits = ReverseRagParser.extractCitationsFromText(text, "northwindvoice.ai", []);
  assert.deepEqual(cits.map((c) => c.url), ["https://talkly.com/ok"]);
});

test("private address ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "::1", "::", "fd12::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isInternalHost("intranet"), true);
  assert.equal(isInternalHost("talkly.com"), false);
});

test("marketplace hosts are attributed by listing path only", () => {
  const hoopListing = competitorMatcher("apps.shopify.com/hoop-voice");
  assert.equal(hoopListing("https://apps.shopify.com/hoop-voice?locale=en"), true);
  assert.equal(hoopListing("https://apps.shopify.com/talkly-voice"), false);
  const bareMarketplace = competitorMatcher("apps.shopify.com");
  assert.equal(bareMarketplace("https://apps.shopify.com/talkly-voice"), false);
  const own = competitorMatcher("https://www.talkly.com");
  assert.equal(own("https://blog.talkly.com/x"), true);
  assert.equal(own("https://talkly.com.evil.example/x"), false);
  const cits = ReverseRagParser.extractCitationsFromText("[x](https://apps.shopify.com/talkly-voice)", "northwindvoice.ai", ["apps.shopify.com"]);
  assert.equal(cits[0].isCompetitorDomain, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMentions, entityTerms, findEntityHits, namesEntity, proseOf, stanceOf, termRegex, listItems, lookalikeDomains, type TrackedEntity } from "../src/index";
import { CASES, PROFILE } from "./fixtures";

const entities: TrackedEntity[] = [
  { key: "brand", name: PROFILE.brand.name, isTarget: true, terms: entityTerms(PROFILE.brand.name, PROFILE.brand.aliases, PROFILE.brand.domain) },
  ...PROFILE.competitors.map((c) => ({ key: c.id, name: c.name, isTarget: false, terms: entityTerms(c.name, c.aliases, c.domain) })),
];

const matches = (entityName: string, text: string) => {
  const e = entities.find((x) => x.name === entityName)!;
  return findEntityHits(proseOf(text), e.terms).length > 0;
};

test("every fixture: mentions, echo handling, rank and stance match the hand labels", () => {
  for (const c of CASES) {
    const { prose, mentions } = detectMentions(c.responseText, entities, c.prompt);
    const starts = mentions.flatMap((m) => m.hits.map((h) => h.index));
    const found = Object.fromEntries(mentions.map((m) => [m.entity.name, m]));
    assert.deepEqual(Object.keys(found).sort(), Object.keys(c.expected).sort(), `case ${c.id}: entities named`);
    for (const [name, exp] of Object.entries(c.expected)) {
      const m = found[name];
      assert.equal(m.positionRank, exp.rank, `case ${c.id}: rank of ${name}`);
      assert.equal(m.isPromptSubject, (c.echoes || []).includes(name), `case ${c.id}: echo flag of ${name}`);
      const isCompetitorEcho = m.isPromptSubject && !m.entity.isTarget;
      if (!isCompetitorEcho) assert.equal(stanceOf(prose, m.hits, starts).sentiment, exp.sentiment, `case ${c.id}: sentiment of ${name}`);
    }
  }
});

test("citation labels and raw URLs are not mentions", () => {
  const caseD = CASES.find((c) => c.id === "D")!;
  assert.equal(detectMentions(caseD.responseText, entities, caseD.prompt).mentions.length, 0);
  assert.equal(matches("Northwind Voice", "Sources: https://www.g2.com/products/northwind-voice/reviews"), false);
  assert.equal(matches("Talkly", "see [talkly.com](https://talkly.com/x) and help.example.com +1"), false);
  assert.equal(matches("Northwind Voice", "Read more at northwindvoice.ai/blog/post"), false, "a domain followed by a path is a citation");
  assert.equal(matches("Northwind Voice", "the dialsy.ai/northwind-voice page"), false);
});

test("a vendor name that is a link label stays a mention", () => {
  assert.equal(matches("Talkly", "**[Talkly](https://talkly.com/?utm_source=x)** - Shopify-native voice agent"), true);
  assert.equal(proseOf("Also see [Vocalyze](https://vocalyze.io/) for custom workflows."), "Also see Vocalyze for custom workflows.");
  assert.equal(proseOf("[Wiki](https://en.wikipedia.org/wiki/Hoop_(company)) text"), "Wiki text");
});

test("dash and space variants of an alias match; homonyms do not", () => {
  for (const s of ["Hoop - AI Voice Agents", "Hoop—AI Voice Agents", "Hoop – AI Voice Agents", "Hoop‑AI Voice Agents", "Hoop Voice is good", "hoopvoice.ai"]) {
    assert.equal(matches("Hoop Voice", s), true, s);
  }
  for (const s of ["Hoop Subscriptions", "Hoop Returns", "jump through a hoop", "hoop voice-over artists"]) {
    assert.equal(matches("Hoop Voice", s), false, s);
  }
  assert.equal(matches("Northwind Voice", "NORTHWIND's agents"), true);
  assert.equal(matches("Northwind Voice", "Northwind’s agents"), true);
  assert.equal(matches("Northwind Voice", "Northwind Voice (northwindvoiceai.com) is an agency"), true);
  assert.equal(matches("Northwind Voice", "see northwindvoiceai.com"), false, "a look-alike domain is not the brand");
});

test("entity terms skip marketplace hosts, ordinary-word stems and short stems", () => {
  assert.deepEqual(entityTerms("Hoop Voice", [], "apps.shopify.com/hoop-voice"), ["Hoop Voice"]);
  assert.deepEqual(entityTerms("Hoop Voice", [], "https://www.g2.com/products/hoop"), ["Hoop Voice"]);
  assert.ok(!entityTerms("Loopy", [], "loop.ai").includes("loop"), "ordinary word stem");
  assert.ok(!entityTerms("Ring Co", [], "ring.io").includes("ring"));
  assert.ok(!entityTerms("Signal AI", [], "signal.ai").includes("Signal"), "a stripped name that is a common word");
  assert.ok(entityTerms("Dialsy AI", [], "dialsy.ai").includes("Dialsy"));
  assert.ok(entityTerms("Dialsy AI", [], "dialsy.ai").includes("dialsy"));
  assert.ok(entityTerms("Talkly", [], "https://www.talkly.com/").includes("talkly.com"));
  // a marketplace domain no longer turns into a term that matches prose
  const listing = { key: "x", name: "Hoop Voice", isTarget: false, terms: entityTerms("Hoop Voice", [], "apps.shopify.com") };
  const r = detectMentions("The best Shopify apps for abandoned-cart calls are Talkly and Northwind.", [listing], "best shopify apps");
  assert.equal(r.mentions.length, 0);
});

test("prompt echoes use the same terms as detection", () => {
  const hoop = entities.find((e) => e.name === "Hoop Voice")!;
  assert.equal(namesEntity("hoop subscriptions alternatives", hoop.terms), false);
  assert.equal(namesEntity("hoop voice alternatives", hoop.terms), true);
  const dialsy = entities.find((e) => e.name === "Dialsy AI")!;
  assert.equal(namesEntity("dialsy ai alternatives", dialsy.terms), true);
});

test("term regex never starts inside a URL path or a domain", () => {
  assert.equal(termRegex("dialsy", "i").test("g2.com/products/dialsy-ai"), false);
  assert.equal(termRegex("dialsy", "i").test("dialsy.ai"), false);
  assert.equal(termRegex("dialsy", "i").test("Dialsy."), true);
  assert.equal(termRegex("dialsy", "i").test("(Dialsy)"), true);
});

test("list positions come from list items and table rows", () => {
  const caseB = CASES.find((c) => c.id === "B")!;
  const { mentions } = detectMentions(caseB.responseText, entities, caseB.prompt);
  const pos = Object.fromEntries(mentions.map((m) => [m.entity.name, m.listPosition]));
  assert.deepEqual(pos, { Talkly: 1, "Dialsy AI": 2, "Northwind Voice": 3, Vocalyze: 4 });
  assert.equal(listItems("one line only").length, 0);
});

test("entity confusion: look-alike domains in text and citations", () => {
  const caseF = CASES.find((c) => c.id === "F")!;
  assert.deepEqual(lookalikeDomains(caseF.responseText, ["northwindvoiceai.com"], PROFILE.brand.domain), ["northwindvoiceai.com"]);
  for (const c of CASES.filter((x) => x.id !== "F")) {
    assert.deepEqual(lookalikeDomains(c.responseText, c.citations.map((x) => new URL(x.url).hostname), PROFILE.brand.domain), [], c.id);
  }
  assert.deepEqual(lookalikeDomains("see northwind-voice.io and app.northwindvoice.ai", [], "https://www.northwindvoice.ai"), ["northwind-voice.io"]);
  assert.deepEqual(lookalikeDomains("anything", [], "ab.io"), [], "stems under 4 characters are not compared");
});

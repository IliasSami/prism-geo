import { test } from "node:test";
import assert from "node:assert/strict";
import { SEARCH_COUNTRIES, languageFor, searchCountry } from "../src/markets";

test("each country lists only languages widely spoken there, main one first", () => {
  assert.deepEqual(searchCountry("United States")?.languages.map((l) => l.code), ["en", "es"]);
  assert.deepEqual(searchCountry("Canada")?.languages.map((l) => l.code), ["en", "fr"]);
  assert.equal(searchCountry("New York,New York,United States")?.code, "us", "a city resolves to its country");
  assert.equal(searchCountry("Atlantis"), null);
  assert.equal(new Set(SEARCH_COUNTRIES.map((c) => c.code)).size, SEARCH_COUNTRIES.length);
  // Names must match the country names Intl uses, so the country code can be derived from them
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (const c of SEARCH_COUNTRIES) assert.equal(names.of(c.code.toUpperCase()), c.name, c.name);
});

test("a language not spoken in the country falls back to its main language", () => {
  assert.equal(languageFor("United States", "es"), "es");
  assert.equal(languageFor("Germany", "fr"), "de");
  assert.equal(languageFor("Japan", undefined), "ja");
  assert.equal(languageFor("Somewhere,Custom", "pt"), "pt", "unlisted locations keep the saved language");
});

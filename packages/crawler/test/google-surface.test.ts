import { test } from "node:test";
import assert from "node:assert/strict";
import { googleAnswerSurface } from "../src/engines/google-aio";

test("an AI Mode reply in Google's Overview slot is labelled AI Mode, without Google's header", () => {
  const raw = "AI Mode reply for which bookkeeping app suits a small online shop\nFor a small online shop, Northwind Ledger is a common pick.";
  assert.deepEqual(googleAnswerSurface(raw), { text: "For a small online shop, Northwind Ledger is a common pick.", surface: "ai_mode" });
});

test("an AI Overview keeps its label and loses only its heading", () => {
  assert.deepEqual(googleAnswerSurface("AI Overview\nNorthwind Ledger and Contoso Books are popular."), { text: "Northwind Ledger and Contoso Books are popular.", surface: "ai_overview" });
});

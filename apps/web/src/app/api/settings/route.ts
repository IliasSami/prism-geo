import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, getRawDb, getDbPath } from "@prismgeo/db";
import { parseBody, route } from "../_lib/http";
import { MASK, isMasked, maskKey, maskProxyUrl, unmaskProxyUrl } from "../_lib/secrets";
import {
  BYOK_PROVIDERS,
  ENGINE_IDS,
  ENGINE_MODES,
  LIMITS,
  byokSchema,
  engineSettingsSchema,
  intSchema,
  type ByokProvider,
} from "../_lib/validate";

export const dynamic = "force-dynamic";

const DEFAULT_ENGINES = {
  perplexity: true,
  google_aio: true,
  google_ai_mode: true,
  copilot: true,
  gemini: true,
  chatgpt: true,
  mode: "hybrid", // 'stealth' (browser only) | 'byok' | 'hybrid'; hybrid equals browser-only until a key is saved
  providerLocation: "United States",
  providerLanguage: "en",
  markets: "",
  // Only use routes that ask from the search location (a browser here only when this computer connects from there)
  strictLocation: true,
};

const DEFAULT_CRAWLER = {
  sampleSize: 1,
  proxyUrl: "",
  scheduleEnabled: false,
  schedulePromptsPerDay: 15,
  scheduleHour: 9,
  // IANA zone the start hour is in; the browser sends its own, the scheduler falls back to the server's
  scheduleTimeZone: "",
};

const crawlerSchema = z.object({
  sampleSize: intSchema(1, 20, "Runs per question").optional(),
  proxyUrl: z
    .string({ error: "The proxy URL must be text" })
    .trim()
    .max(LIMITS.proxyUrl, "The proxy URL is too long")
    .refine(
      (v) => v === "" || v.includes(MASK) || /^(https?|socks5?):\/\/[^\s]+$/i.test(v),
      "Proxy URL must look like http://user:pass@host:port or socks5://host:port",
    )
    .optional(),
  scheduleEnabled: z.boolean({ error: "scheduleEnabled must be true or false" }).optional(),
  schedulePromptsPerDay: intSchema(1, 200, "Questions per day").optional(),
  scheduleHour: intSchema(0, 23, "The start hour").optional(),
  scheduleTimeZone: z
    .string({ error: "The time zone must be text" })
    .trim()
    .max(64)
    .refine((tz) => {
      if (tz === "") return true;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone")
    .optional(),
});

const settingsSchema = z
  .strictObject({ byok: byokSchema.optional(), engines: engineSettingsSchema.optional(), crawler: crawlerSchema.optional() })
  .refine((b) => b.byok || b.engines || b.crawler, "Send byok, engines or crawler");

/** Saved settings, restricted to known keys and types (older versions could store anything). */
function readSettings() {
  const rawByok = getSettings<Record<string, unknown>>("byok_api_keys", {});
  const byok = Object.fromEntries(BYOK_PROVIDERS.map((p) => [p, typeof rawByok[p] === "string" ? (rawByok[p] as string) : ""])) as Record<
    ByokProvider,
    string
  >;
  const storedEngines = { ...DEFAULT_ENGINES, ...getSettings<Record<string, unknown>>("engine_settings", {}) };
  const engines: Record<string, unknown> = Object.fromEntries(ENGINE_IDS.map((e) => [e, storedEngines[e] !== false]));
  engines.mode = (ENGINE_MODES as readonly unknown[]).includes(storedEngines.mode) ? storedEngines.mode : DEFAULT_ENGINES.mode;
  engines.providerLocation = typeof storedEngines.providerLocation === "string" && storedEngines.providerLocation ? storedEngines.providerLocation : DEFAULT_ENGINES.providerLocation;
  engines.markets = typeof storedEngines.markets === "string" ? storedEngines.markets : "";
  engines.strictLocation = storedEngines.strictLocation !== false;
  engines.providerLanguage = typeof storedEngines.providerLanguage === "string" && storedEngines.providerLanguage ? storedEngines.providerLanguage : DEFAULT_ENGINES.providerLanguage;
  const crawler = { ...DEFAULT_CRAWLER, ...getSettings<Record<string, unknown>>("crawler_settings", {}) } as typeof DEFAULT_CRAWLER;
  return { byok, engines, crawler };
}

export const GET = route("settings GET", async () => {
  const { byok, engines, crawler } = readSettings();
  return NextResponse.json({
    byok: Object.fromEntries(Object.entries(byok).map(([k, v]) => [k, maskKey(v)])),
    hasRawByok: Object.fromEntries(Object.entries(byok).map(([k, v]) => [k, Boolean(v)])),
    engines,
    crawler: { ...crawler, proxyUrl: maskProxyUrl(String(crawler.proxyUrl || "")) },
    dbPath: getDbPath(),
  });
});

/**
 * Saves { byok?, engines?, crawler? }. The whole body is validated first and written in one
 * transaction, so a mistake in one field saves nothing. Masked values (as returned by GET) mean
 * "unchanged"; an empty string or null clears a key.
 */
export const POST = route("settings POST", async (request: Request) => {
  const parsed = await parseBody(request, settingsSchema);
  if (!parsed.ok) return parsed.response;
  const { byok, engines, crawler } = parsed.data;
  const current = readSettings();
  const writes: Array<[string, unknown]> = [];

  if (byok) {
    const keys: Record<string, string> = { ...current.byok };
    for (const [provider, value] of Object.entries(byok)) {
      if (value === undefined) continue;
      const trimmed = (value ?? "").trim();
      if (isMasked(trimmed)) continue; // the masked value shown by GET: unchanged
      // DataForSEO authenticates with the API login and password from app.dataforseo.com/api-access
      if (provider === "dataforseo" && trimmed && !/^[^:\s]+:\S+$/.test(trimmed)) {
        return NextResponse.json(
          { error: "DataForSEO: enter your API login and password as login:password (from app.dataforseo.com/api-access)" },
          { status: 400 },
        );
      }
      keys[provider] = trimmed;
    }
    writes.push(["byok_api_keys", keys]);
  }

  if (engines) writes.push(["engine_settings", { ...current.engines, ...engines }]);

  if (crawler) {
    const { proxyUrl, ...rest } = crawler;
    const next = { ...current.crawler };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    // The password is never sent to the browser; a masked one means "keep the saved password"
    if (proxyUrl !== undefined) next.proxyUrl = unmaskProxyUrl(proxyUrl, String(current.crawler.proxyUrl || ""));
    writes.push(["crawler_settings", next]);
  }

  const sqlite = getRawDb();
  const save = sqlite.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of writes) save.run(key, JSON.stringify(value));
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  return NextResponse.json({ success: true, message: "Settings saved" });
});

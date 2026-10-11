import { NextResponse } from "next/server";
import { getSettings, setSettings, getDbPath } from "@prismgeo/db";

export const dynamic = "force-dynamic";

const DEFAULT_BYOK = {
  openai: "",
  anthropic: "",
  gemini: "",
  perplexity: "",
  openrouter: "",
};

const DEFAULT_ENGINES = {
  perplexity: true,
  google_aio: true,
  copilot: true,
  gemini: true,
  chatgpt: true,
  mode: "stealth", // 'stealth' | 'byok' | 'hybrid'
};

const DEFAULT_CRAWLER = {
  sampleSize: 5,
  concurrency: 2,
  timeoutMs: 30000,
  rotateFingerprints: true,
  proxyUrl: "",
};

const DEFAULT_USER = {
  name: "Agency Executive",
  email: "admin@agency.local",
  role: "Owner / Lead Auditor",
};

export async function GET() {
  try {
    const rawByok = { ...DEFAULT_BYOK, ...getSettings<Record<string, string>>("byok_api_keys", DEFAULT_BYOK) };
    const engines = { ...DEFAULT_ENGINES, ...getSettings("engine_settings", DEFAULT_ENGINES) };
    const crawler = { ...DEFAULT_CRAWLER, ...getSettings("crawler_settings", DEFAULT_CRAWLER) };
    const user = { ...DEFAULT_USER, ...getSettings("user_profile", DEFAULT_USER) };

    // Mask API keys for display safety (show only first 4 and last 4 chars for long keys)
    const maskedByok: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawByok)) {
      if (!v || typeof v !== "string") {
        maskedByok[k] = "";
      } else if (v.length <= 10) {
        maskedByok[k] = "••••••••";
      } else {
        maskedByok[k] = `${v.slice(0, 4)}••••${v.slice(-4)}`;
      }
    }

    return NextResponse.json({
      byok: maskedByok,
      hasRawByok: {
        openai: Boolean(rawByok.openai),
        anthropic: Boolean(rawByok.anthropic),
        gemini: Boolean(rawByok.gemini),
        perplexity: Boolean(rawByok.perplexity),
        openrouter: Boolean(rawByok.openrouter),
      },
      engines,
      crawler,
      user,
      dbPath: getDbPath(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    const { byok, engines, crawler, user } = body;

    if (byok && typeof byok === "object") {
      const existing = getSettings<Record<string, string>>("byok_api_keys", DEFAULT_BYOK);
      const updated: Record<string, string> = { ...existing };
      for (const [k, v] of Object.entries(byok as Record<string, any>)) {
        if (typeof v === "string") {
          const trimmed = v.trim();
          if (trimmed === "") {
            // Explicit clear
            updated[k] = "";
          } else if (!trimmed.includes("••••")) {
            // Updated with new unmasked key
            updated[k] = trimmed;
          }
        } else if (v === null) {
          updated[k] = "";
        }
      }
      setSettings("byok_api_keys", updated);
    }

    if (engines && typeof engines === "object") {
      const existing = getSettings("engine_settings", DEFAULT_ENGINES);
      setSettings("engine_settings", { ...existing, ...engines });
    }

    if (crawler && typeof crawler === "object") {
      const existing = getSettings("crawler_settings", DEFAULT_CRAWLER);
      const sampleSize = Number.isFinite(crawler.sampleSize)
        ? Math.min(20, Math.max(1, Number(crawler.sampleSize)))
        : existing.sampleSize;
      const concurrency = Number.isFinite(crawler.concurrency)
        ? Math.min(10, Math.max(1, Number(crawler.concurrency)))
        : existing.concurrency;
      const timeoutMs = Number.isFinite(crawler.timeoutMs)
        ? Math.min(120000, Math.max(5000, Number(crawler.timeoutMs)))
        : existing.timeoutMs;

      setSettings("crawler_settings", {
        ...existing,
        ...crawler,
        sampleSize,
        concurrency,
        timeoutMs,
      });
    }

    if (user && typeof user === "object") {
      const existing = getSettings("user_profile", DEFAULT_USER);
      setSettings("user_profile", { ...existing, ...user });
    }

    return NextResponse.json({ success: true, message: "Settings saved successfully" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

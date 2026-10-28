import { NextResponse } from "next/server";
import { getSettings, setSettings, getDbPath } from "@prismgeo/db";

export const dynamic = "force-dynamic";

const DEFAULT_BYOK = {
  openai: "",
  gemini: "",
  perplexity: "",
  serpapi: "",
};

const DEFAULT_ENGINES = {
  perplexity: true,
  google_aio: true,
  copilot: true,
  gemini: true,
  chatgpt: true,
  mode: "hybrid", // 'stealth' | 'byok' | 'hybrid'; hybrid equals browser-only until a key is saved
};

const DEFAULT_CRAWLER = {
  sampleSize: 1,
  proxyUrl: "",
  scheduleEnabled: false,
  schedulePromptsPerDay: 15,
  scheduleHour: 9,
};

export async function GET() {
  try {
    const rawByok = { ...DEFAULT_BYOK, ...getSettings<Record<string, string>>("byok_api_keys", DEFAULT_BYOK) };
    const engines = { ...DEFAULT_ENGINES, ...getSettings("engine_settings", DEFAULT_ENGINES) };
    const crawler = { ...DEFAULT_CRAWLER, ...getSettings("crawler_settings", DEFAULT_CRAWLER) };

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
        gemini: Boolean(rawByok.gemini),
        perplexity: Boolean(rawByok.perplexity),
        serpapi: Boolean(rawByok.serpapi),
      },
      engines,
      crawler,
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

    const { byok, engines, crawler } = body;

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
      const proxyUrl = typeof crawler.proxyUrl === "string" ? crawler.proxyUrl.trim() : existing.proxyUrl;
      if (proxyUrl && !/^(https?|socks5?):\/\/[^\s]+$/i.test(proxyUrl)) {
        return NextResponse.json({ error: "Proxy URL must look like http://user:pass@host:port or socks5://host:port" }, { status: 400 });
      }

      const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
        Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback;
      setSettings("crawler_settings", {
        sampleSize,
        proxyUrl,
        scheduleEnabled: typeof crawler.scheduleEnabled === "boolean" ? crawler.scheduleEnabled : Boolean(existing.scheduleEnabled),
        schedulePromptsPerDay: clampInt(crawler.schedulePromptsPerDay, 1, 200, existing.schedulePromptsPerDay ?? 15),
        scheduleHour: clampInt(crawler.scheduleHour, 0, 23, existing.scheduleHour ?? 9),
      });
    }


    return NextResponse.json({ success: true, message: "Settings saved successfully" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

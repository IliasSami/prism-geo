import { NextResponse } from "next/server";
import { getSettings, setSettings, getDbPath } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const byok = getSettings("byok_api_keys", {
      openai: "",
      anthropic: "",
      gemini: "",
      perplexity: "",
      openrouter: "",
    });

    const engines = getSettings("engine_settings", {
      perplexity: true,
      google_aio: true,
      copilot: true,
      gemini: true,
      chatgpt: true,
      mode: "stealth", // 'stealth' | 'byok' | 'hybrid'
    });

    const crawler = getSettings("crawler_settings", {
      sampleSize: 5,
      concurrency: 2,
      timeoutMs: 30000,
      rotateFingerprints: true,
      proxyUrl: "",
    });

    const user = getSettings("user_profile", {
      name: "Agency Executive",
      email: "admin@agency.local",
      role: "Owner / Lead Auditor",
    });

    // Mask API keys for display safety (show only first 4 and last 4 chars)
    const maskedByok: Record<string, string> = {};
    for (const [k, v] of Object.entries(byok as Record<string, string>)) {
      if (!v) {
        maskedByok[k] = "";
      } else if (v.length <= 8) {
        maskedByok[k] = "••••••••";
      } else {
        maskedByok[k] = `${v.slice(0, 4)}••••${v.slice(-4)}`;
      }
    }

    return NextResponse.json({
      byok: maskedByok,
      hasRawByok: {
        openai: Boolean((byok as any).openai),
        anthropic: Boolean((byok as any).anthropic),
        gemini: Boolean((byok as any).gemini),
        perplexity: Boolean((byok as any).perplexity),
        openrouter: Boolean((byok as any).openrouter),
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
    const body = await request.json();
    const { byok, engines, crawler, user } = body;

    if (byok) {
      // Retain existing keys if incoming keys are masked or empty
      const existing = getSettings<Record<string, string>>("byok_api_keys", {});
      const updated: Record<string, string> = { ...existing };
      for (const [k, v] of Object.entries(byok as Record<string, string>)) {
        if (v && !v.includes("••••")) {
          updated[k] = v.trim();
        }
      }
      setSettings("byok_api_keys", updated);
    }

    if (engines) {
      setSettings("engine_settings", engines);
    }

    if (crawler) {
      setSettings("crawler_settings", crawler);
    }

    if (user) {
      setSettings("user_profile", user);
    }

    return NextResponse.json({ success: true, message: "Settings saved successfully" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

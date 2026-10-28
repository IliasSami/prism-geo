/**
 * What a user can do, within each service's rules, when an engine keeps failing. Shown next to
 * failures in the dashboard. PrismGEO does not evade bot detection; these are the supported routes.
 */
export type FailureKind = "blocked" | "no_answer" | "no_ai_overview" | "error" | "network" | "setup" | "unavailable" | "skipped_after_blocks" | string;

const BLOCK_REMEDIES: Record<string, string> = {
  google_aio:
    "Google limits automated searches per IP. Add a free SerpApi key (Settings → Engines) to read AI Overviews through SerpApi, connect a signed-in Google session, or lower the daily prompt count.",
  perplexity:
    "Perplexity caps anonymous use. Connect your free Perplexity account (Engines → Connect session) or add a Perplexity API key.",
  chatgpt: "Connect your ChatGPT account (Engines → Connect session) or add an OpenAI API key, and keep the rolling schedule small.",
  gemini: "Add a free Gemini API key from Google AI Studio (Settings → Engines); it also returns sources and search queries.",
  copilot: "Copilot needs a signed-in Microsoft account: Engines → Connect session.",
};

export function engineRemedy(engine: string, kind: FailureKind): string | null {
  if (kind === "blocked" || kind === "skipped_after_blocks" || kind === "unavailable") return BLOCK_REMEDIES[engine] ?? null;
  if (kind === "no_ai_overview") return "Google showed no AI Overview for this search. That is a real result, not an error.";
  if (kind === "no_answer") return "The page loaded without a readable answer. If this repeats, the engine's page may have changed; check data/crawl-debug/.";
  if (kind === "network")
    return "This machine could not reach the engine at all, so the engine itself is not at fault. Check the internet connection, and the proxy in Settings (a proxy that refuses the host gives ERR_TUNNEL_CONNECTION_FAILED).";
  if (kind === "setup")
    return "No browser is installed for the crawler. Run `pnpm exec playwright install chromium`, or point CHROMIUM_PATH at an installed Chrome or Chromium.";
  return null;
}

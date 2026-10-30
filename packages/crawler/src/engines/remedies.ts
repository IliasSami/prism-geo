/**
 * What a user can do, within each service's rules, when an engine keeps failing. Shown next to
 * failures in the dashboard. PrismGEO does not evade bot detection; these are the supported routes.
 */
export type FailureKind = "blocked" | "no_answer" | "no_ai_overview" | "error" | "network" | "setup" | "unavailable" | "skipped_after_blocks" | string;

const BLOCK_REMEDIES: Record<string, string> = {
  google_ai_mode:
    "Google AI Mode is read through a SerpApi key or the DataForSEO data provider (Settings → Engines & access); there is no dependable browser route.",
  google_aio:
    "Google limits automated searches from this computer's address. Add a free SerpApi key or the DataForSEO data provider (Settings → Engines & access) to read AI Overviews; a signed-in Google session helps a little but does not lift the limit.",
  perplexity:
    "Perplexity limits logged-out visitors. Connect your free Perplexity account (Engines → Connect, and sign in fully before closing the window), or add a Perplexity API key or the DataForSEO data provider.",
  chatgpt: "Connect your ChatGPT account (Engines → Connect), or add an OpenAI API key or the DataForSEO data provider, and keep the daily schedule small.",
  gemini: "Connect your Google account, or add a free Gemini API key from Google AI Studio (it also returns sources and searches) or the DataForSEO data provider.",
  copilot: "Copilot needs a signed-in Microsoft account: Engines → Connect, and sign in before closing the window.",
};

export function engineRemedy(engine: string, kind: FailureKind): string | null {
  if (kind === "skipped_after_network") kind = "network";
  if (kind === "skipped_setup") kind = "setup";
  if (kind === "blocked" || kind === "skipped_after_blocks" || kind === "unavailable") return BLOCK_REMEDIES[engine] ?? null;
  if (kind === "session_expired") return "The saved signed-in session expired or was signed out, so the engine ran logged out. Connect it again on the Engines page.";
  if (kind === "no_ai_overview") return "Google showed no AI Overview for this search. That is a real result, not an error.";
  if (kind === "no_answer") return "The page loaded without a readable answer. If this repeats, the engine's page may have changed; check data/crawl-debug/.";
  if (kind === "network")
    return "This machine could not reach the engine at all, so the engine itself is not at fault. Check the internet connection, and the proxy in Settings (a proxy that refuses the host gives ERR_TUNNEL_CONNECTION_FAILED).";
  if (kind === "setup")
    return "No browser is installed for the crawler. Run `pnpm exec playwright install chromium`, or point CHROMIUM_PATH at an installed Chrome or Chromium.";
  return null;
}

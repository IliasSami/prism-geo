/**
 * The single list of engines PrismGEO measures, in priority order (Google's AI surfaces first,
 * then the assistant apps). Every other list (settings, validation, the crawler, the dashboard,
 * the MCP connector) derives from this one, so adding an engine is one change.
 */
export const ENGINE_IDS = ["google_ai_mode", "google_aio", "gemini", "chatgpt", "perplexity", "copilot"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineInfo {
  id: EngineId;
  label: string;
  /** How the engine can be reached. */
  routes: {
    /** A logged-out or signed-in browser on this machine. */
    browser: boolean;
    /** A saved signed-in session is possible (and, for Copilot, required). */
    signIn: "optional" | "required" | "none";
    /** Paid or keyed routes, in preference order. */
    keyed: Array<"dataforseo" | "serpapi" | "openai" | "gemini" | "perplexity">;
  };
}

export const ENGINES: Record<EngineId, EngineInfo> = {
  google_ai_mode: { id: "google_ai_mode", label: "Google AI Mode", routes: { browser: false, signIn: "none", keyed: ["dataforseo", "serpapi"] } },
  google_aio: { id: "google_aio", label: "Google AI Overviews", routes: { browser: true, signIn: "optional", keyed: ["dataforseo", "serpapi"] } },
  gemini: { id: "gemini", label: "Gemini", routes: { browser: true, signIn: "optional", keyed: ["dataforseo", "gemini"] } },
  chatgpt: { id: "chatgpt", label: "ChatGPT", routes: { browser: true, signIn: "optional", keyed: ["dataforseo", "openai"] } },
  perplexity: { id: "perplexity", label: "Perplexity", routes: { browser: true, signIn: "optional", keyed: ["perplexity", "dataforseo"] } },
  copilot: { id: "copilot", label: "Copilot", routes: { browser: true, signIn: "required", keyed: [] } },
};

export const isEngineId = (v: unknown): v is EngineId => (ENGINE_IDS as readonly unknown[]).includes(v);

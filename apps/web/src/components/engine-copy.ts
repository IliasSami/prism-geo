/**
 * One vocabulary for engine and audit status, shared by the header chip, Overview, the Engines
 * page and the audit dialog, so every surface describes the same latest audit in the same words.
 * Plain data and functions only: safe to import from server and client components.
 */
import type { Tone } from "./ui";

export type EngineState = "working" | "partly_blocked" | "blocked" | "not_run" | "not_set_up";

export const STATE_COPY: Record<EngineState, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "success" },
  partly_blocked: { label: "Partly blocked", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  not_run: { label: "Not run yet", tone: "neutral" },
  not_set_up: { label: "Not set up", tone: "warning" },
};

const ENGINE_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google_aio: "Google AI Overviews",
  google_ai_mode: "Google AI Mode",
  copilot: "Copilot",
};
const name = (engine: string) => ENGINE_NAMES[engine] || engine;

/** Failure kinds recorded by the crawler, in words. "no_ai_overview" is a real outcome, not a failure. */
export const KIND_PHRASE: Record<string, string> = {
  blocked: "blocked by the engine",
  skipped_after_blocks: "skipped while the engine kept blocking",
  no_answer: "page loaded without a readable answer",
  no_ai_overview: "Google showed no AI Overview",
  network: "couldn't connect from this computer",
  setup: "the crawler's browser isn't installed",
  skipped_after_network: "skipped after this computer lost its connection",
  skipped_setup: "skipped because the crawler's browser isn't installed",
  prompt_removed: "question deleted during the audit",
  prompt_paused: "question paused during the audit",
  api_key_rejected: "API key rejected",
  unavailable: "needs a signed-in account",
  session_expired: "signed-in session expired; ran logged out",
  error: "unexpected error",
};

export const kindPhrase = (kind: string) => KIND_PHRASE[kind] || "unexpected error";

/**
 * Kinds that are not a failure of anything: the search simply had no AI Overview, or the question
 * was deleted or paused while the audit ran (the audit skipped it, as asked).
 */
export const isRealOutcome = (kind: string) => kind === "no_ai_overview" || kind === "prompt_removed" || kind === "prompt_paused";

/** The setup command that installs the browser the crawler drives. */
export const BROWSER_INSTALL_COMMAND = "pnpm browsers";

export interface ReasonCopy {
  /** Short plain sentence: what happened. */
  title: string;
  /** What to do next, in plain words. */
  next: string;
  /** Where the next step lives. */
  href: string;
  cta: string;
  /** A command or path for whoever runs the server, if any. */
  technical?: string;
}

/** What reliably stops each engine blocking (shown with "blocked" failures). */
const BLOCK_FIX: Record<string, string> = {
  google_ai_mode: "Google AI Mode is read through a SerpApi key (free plan: 250 searches a month), an Apify token or the DataForSEO data provider.",
  perplexity:
    "Perplexity limits logged-out visitors: connect your free Perplexity account (sign in fully before closing the window), or add a Perplexity API key or the DataForSEO data provider.",
  google_aio:
    "Google limits automated searches from this computer's address: add a free SerpApi key or the DataForSEO data provider for AI Overviews. A signed-in Google session helps a little but does not stop the limit.",
  chatgpt: "Connect your ChatGPT account, or add an OpenAI API key or the DataForSEO data provider.",
  gemini: "Connect your Google account, or add a free Gemini API key (Google AI Studio) or the DataForSEO data provider.",
  copilot: "Connect your Microsoft account on the Engines page.",
};

/** Why runs failed and what to do, for one failure kind; `engines` are the engines it hit. */
export function reasonCopy(kind: string, engines: string[] = [], context: "engines-page" | "elsewhere" = "elsewhere"): ReasonCopy {
  const list = engines.map(name).join(", ") || "the engines";
  const onEngines = context === "engines-page";
  switch (kind) {
    case "setup":
    case "skipped_setup":
      return {
        title: "The browser the crawler uses isn't installed",
        next: "Whoever installed PrismGEO can install it with one command on the computer that runs it, then run the audit again. Engines with a saved API key answer without the browser (Gemini's key is free).",
        href: "/engines",
        cta: "See how to fix",
        technical: BROWSER_INSTALL_COMMAND,
      };
    case "network":
    case "skipped_after_network":
      return {
        title: "This computer couldn't reach the engines",
        next: "The engines are not at fault. Check this computer's internet connection, and the proxy in Settings if you use one, then run the audit again.",
        href: "/settings?tab=schedule",
        cta: "Check proxy settings",
      };
    case "blocked":
    case "skipped_after_blocks": {
      // What reliably unblocks each engine differs: Google limits this computer's address, so a key
      // route is the dependable fix; the others mostly limit logged-out visitors, so an account fixes it
      const keyFirst = engines.length > 0 && engines.every((e) => e === "google_aio" || e === "google_ai_mode");
      const fixes = engines.map((e) => BLOCK_FIX[e]).filter(Boolean);
      return {
        title: `${list} blocked the questions`,
        next: fixes.length ? fixes.join(" ") : "Connect a signed-in session, or add an API key or the DataForSEO data provider so blocked questions are still answered.",
        href: keyFirst ? "/settings?tab=engines" : onEngines ? "#sessions" : "/engines#sessions",
        cta: keyFirst ? "Add a key" : "Connect a session",
      };
    }
    case "session_expired":
      return {
        title: `The signed-in session for ${list} expired`,
        next: "Those runs were made logged out. Connect the engine again and sign in before closing the window.",
        href: onEngines ? "#sessions" : "/engines#sessions",
        cta: "Reconnect",
      };
    case "no_answer":
      return {
        title: `${list} loaded without a readable answer`,
        next: "Run the audit again later. If it keeps happening, the engine's page may have changed; screenshots of each failure are saved in data/crawl-debug/.",
        href: "/engines",
        cta: "See engine details",
      };
    case "api_key_rejected":
      return {
        title: `The API key for ${list} was rejected`,
        next: "Check or replace the key, then run the audit again.",
        href: "/settings?tab=engines",
        cta: "Check API keys",
      };
    case "unavailable":
      return {
        title: `${list} needs a signed-in account`,
        next: onEngines ? "Connect a session below." : "Connect a session on the Engines page.",
        href: onEngines ? "#sessions" : "/engines#sessions",
        cta: "Connect a session",
      };
    default:
      return {
        title: "The runs failed with an unexpected error",
        next: "The server log has the details (Settings → Data).",
        href: "/settings?tab=data",
        cta: "Open the server log",
      };
  }
}

export interface Issue {
  engine: string;
  kind: string;
  count: number;
}

/** "ChatGPT: 10 of 10 runs failed (the crawler's browser isn't installed)". */
export function issueLine(i: Issue, attempted?: number): string {
  if (isRealOutcome(i.kind)) return `${name(i.engine)}: ${i.count} ${i.count === 1 ? "search" : "searches"} showed no AI Overview (a real result)`;
  const of = attempted && attempted >= i.count ? ` of ${attempted}` : "";
  return `${name(i.engine)}: ${i.count}${of} ${i.count === 1 && !of ? "run" : "runs"} failed (${kindPhrase(i.kind)})`;
}

/** The most frequent real failure in a list of issues, with the engines it hit. */
export function topFailure(issues: Issue[]): { kind: string; engines: string[]; count: number } | null {
  const byKind = new Map<string, { count: number; engines: Set<string> }>();
  for (const i of issues) {
    if (isRealOutcome(i.kind)) continue;
    // "Skipped" follows "blocked"; report them as one reason
    const kind = i.kind === "skipped_after_blocks" ? "blocked" : i.kind;
    const cur = byKind.get(kind) || { count: 0, engines: new Set<string>() };
    cur.count += i.count;
    cur.engines.add(i.engine);
    byKind.set(kind, cur);
  }
  const top = [...byKind.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  return top ? { kind: top[0], engines: [...top[1].engines], count: top[1].count } : null;
}

export interface AuditOutcome {
  tone: Tone;
  title: string;
  detail: string;
  reason: ReasonCopy | null;
}

/** How one finished audit went, in words, from its captured / failed counts and grouped failures. */
export function auditOutcome(captured: number, failed: number, issues: Issue[], context: "engines-page" | "elsewhere" = "elsewhere"): AuditOutcome {
  const top = topFailure(issues);
  const reason = top ? reasonCopy(top.kind, top.engines, context) : null;
  const total = captured + failed;
  if (captured === 0) {
    return {
      tone: "danger",
      title: reason ? `No answers captured: ${lowerFirst(reason.title)}` : "No answers captured",
      detail: `None of the ${total || "planned"} runs got an answer, so there is nothing to report yet. Nothing was guessed or filled in.`,
      reason,
    };
  }
  if (failed === 0) {
    return { tone: "success", title: "Audit finished", detail: `All ${captured} answers were captured.`, reason: null };
  }
  return {
    tone: "warning",
    title: "Audit finished with gaps",
    detail: `${captured} of ${total} answers captured. ${failed} ${failed === 1 ? "run" : "runs"} failed and ${failed === 1 ? "is" : "are"} left out, never filled in.`,
    reason,
  };
}

function lowerFirst(s: string): string {
  // Keep engine names capitalised ("ChatGPT blocked…"); lower only a leading "The"/"This"/"An"
  return /^(The|This|An|A) /.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

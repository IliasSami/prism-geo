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
  api_key_rejected: "API key rejected",
  unavailable: "needs a signed-in account",
  error: "unexpected error",
};

export const kindPhrase = (kind: string) => KIND_PHRASE[kind] || "unexpected error";

/** Kinds that are not a failure of the run (the search simply had no AI Overview). */
export const isRealOutcome = (kind: string) => kind === "no_ai_overview";

/** The setup command that installs the browser the crawler drives. */
export const BROWSER_INSTALL_COMMAND = "pnpm exec playwright install chromium";

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

/** Why runs failed and what to do, for one failure kind; `engines` are the engines it hit. */
export function reasonCopy(kind: string, engines: string[] = [], context: "engines-page" | "elsewhere" = "elsewhere"): ReasonCopy {
  const list = engines.map(name).join(", ") || "the engines";
  const onEngines = context === "engines-page";
  switch (kind) {
    case "setup":
      return {
        title: "The browser the crawler uses isn't installed",
        next: "Whoever installed PrismGEO can install it with one command on the computer that runs it, then run the audit again. Engines with a saved API key answer without the browser (Gemini's key is free).",
        href: "/engines",
        cta: "See how to fix",
        technical: BROWSER_INSTALL_COMMAND,
      };
    case "network":
      return {
        title: "This computer couldn't reach the engines",
        next: "The engines are not at fault. Check this computer's internet connection, and the proxy in Settings if you use one, then run the audit again.",
        href: "/settings?tab=schedule",
        cta: "Check proxy settings",
      };
    case "blocked":
    case "skipped_after_blocks":
      return {
        title: `${list} blocked the questions`,
        next: onEngines
          ? "Connect a signed-in session below, or add an API key so blocked questions are answered through the engine's API."
          : "Connect a signed-in session on the Engines page, or add an API key so blocked questions are answered through the engine's API.",
        href: onEngines ? "#sessions" : "/engines#sessions",
        cta: "Connect a session",
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

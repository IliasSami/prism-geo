import { getRawDb } from "@prismgeo/db";
import { getEngineHealth, type EngineHealth } from "@/lib/engine-health";
import { STATE_COPY, auditOutcome, kindPhrase, isRealOutcome, reasonCopy, type AuditOutcome, type EngineState, type Issue, type ReasonCopy } from "@/components/engine-copy";
import { engineLabel, type Tone } from "@/components/ui";

/**
 * Display state of each engine and of the latest audit, read once per request and shared by the
 * header chip, Overview, the Engines page and the audit dialog so they all tell the same story.
 *
 * Status comes from lib/engine-health.ts. That module leaves out runs that failed before reaching
 * the engine (browser not installed, no network), so an engine whose latest audit only had those
 * failures reads "untested" there (or keeps an older batch's status). Here the latest audit that
 * involved the engine decides: such engines show "Not set up" or "Not run yet" with the reason.
 */

interface Batch {
  id: string;
  status: string;
  created_at: string;
  failed_runs: number;
  total_runs: number;
  errors_json: string | null;
}

export interface EngineView {
  engine: string;
  enabled: boolean;
  state: EngineState;
  label: string;
  tone: Tone;
  /** Plain reason for anything that is not Working, from the engine's latest audit. */
  reason: string | null;
  /** What to do about it. */
  fix: ReasonCopy | null;
  /** Captured / attempted in the engine's latest audit (0/0 before any). */
  captured: number;
  attempted: number;
  /** Failure counts by kind in that audit. */
  kinds: Record<string, number>;
  lastRunAt: string | null;
  health: EngineHealth;
}

export interface LatestAudit {
  id: string;
  at: string;
  captured: number;
  failed: number;
  issues: Issue[];
  outcome: AuditOutcome;
}

function parse(json: string | null): Array<{ engine: string; kind: string; promptId?: string | null }> {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function group(errors: Array<{ engine: string; kind: string }>): Issue[] {
  const m = new Map<string, Issue>();
  for (const e of errors) {
    const key = `${e.engine}:${e.kind}`;
    const cur = m.get(key) || { engine: e.engine, kind: e.kind, count: 0 };
    cur.count++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const recentBatches = (brandId: string): Batch[] =>
  getRawDb()
    .prepare(
      "SELECT id, status, created_at, failed_runs, total_runs, errors_json FROM crawl_batches WHERE brand_id = ? AND status <> 'running' AND COALESCE(owner, '') <> 'manual-capture' ORDER BY created_at DESC LIMIT 10"
    )
    .all(brandId) as unknown as Batch[];

const runsIn = (batchId: string): Map<string, number> =>
  new Map(
    (getRawDb().prepare("SELECT engine, COUNT(*) AS n FROM prompt_runs WHERE batch_id = ? GROUP BY engine").all(batchId) as Array<{ engine: string; n: number }>).map(
      (r) => [r.engine, Number(r.n)]
    )
  );

/** The most recent finished audit for this client, summarised in plain words. */
export function getLatestAudit(brandId: string | undefined, context: "engines-page" | "elsewhere" = "elsewhere"): LatestAudit | null {
  if (!brandId) return null;
  const b = recentBatches(brandId)[0];
  if (!b) return null;
  const captured = [...runsIn(b.id).values()].reduce((s, n) => s + n, 0);
  const errors = parse(b.errors_json);
  const issues = group(errors);
  const failed = errors.filter((e) => !isRealOutcome(e.kind)).length;
  const outcomes = errors.filter((e) => isRealOutcome(e.kind)).length;
  return { id: b.id, at: b.created_at, captured: captured + outcomes, failed, issues, outcome: auditOutcome(captured + outcomes, failed, issues, context) };
}

export function getEngineViews(brandId: string | undefined, context: "engines-page" | "elsewhere" = "elsewhere"): EngineView[] {
  const health = getEngineHealth(brandId);
  const batches = brandId ? recentBatches(brandId) : [];
  const runCache = new Map<string, Map<string, number>>();
  const runs = (id: string) => runCache.get(id) ?? (runCache.set(id, runsIn(id)), runCache.get(id)!);

  return health.map((h) => {
    // The latest audit that involved this engine at all, including runs that never reached it
    let kinds: Record<string, number> = {};
    let captured = 0;
    let lastRunAt: string | null = null;
    for (const b of batches) {
      const mine = parse(b.errors_json).filter((e) => e.engine === h.engine);
      const n = runs(b.id).get(h.engine) || 0;
      if (n + mine.length === 0) continue;
      kinds = mine.reduce<Record<string, number>>((acc, e) => ((acc[e.kind] = (acc[e.kind] || 0) + 1), acc), {});
      captured = n + (kinds.no_ai_overview || 0);
      lastRunAt = b.created_at;
      break;
    }
    const failures = Object.entries(kinds).filter(([k]) => !isRealOutcome(k));
    const failedCount = failures.reduce((s, [, n]) => s + n, 0);
    const topKind = failures.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    let state: EngineState =
      h.status === "working" ? "working" : h.status === "degraded" ? "partly_blocked" : h.status === "blocked" ? "blocked" : h.status === "not_set_up" ? "not_set_up" : "not_run";
    // Failures before the engine was reached say nothing about the engine itself
    if (captured === 0 && failedCount > 0 && (topKind === "setup" || topKind === "network")) state = topKind === "setup" ? "not_set_up" : "not_run";

    let reason: string | null = null;
    let fix: ReasonCopy | null = null;
    if (state !== "working" && topKind) {
      fix = reasonCopy(topKind, [h.engine], context);
      reason =
        captured === 0
          ? `Last audit: ${failedCount} of ${failedCount} runs failed (${kindPhrase(topKind)}).`
          : `Last audit: ${captured} of ${captured + failedCount} answered; ${failedCount} failed (${kindPhrase(topKind)}).`;
    } else if (state === "not_set_up" && h.engine === "copilot") {
      fix = reasonCopy("unavailable", [h.engine], context);
      reason = "Copilot has no logged-out chat; it needs a signed-in Microsoft account.";
    } else if (state === "not_run") {
      reason = "No audit has asked this engine yet.";
    }
    const copy = STATE_COPY[state];
    return {
      engine: h.engine,
      enabled: h.enabled,
      state,
      label: copy.label,
      tone: copy.tone,
      reason,
      fix,
      captured,
      attempted: captured + failedCount,
      kinds,
      lastRunAt,
      health: h,
    };
  });
}

/** Header chip: "3 working · 1 partly blocked", or the one state every engine shares. */
export function engineSummary(views: EngineView[]): { text: string; tone: Tone; title: string } {
  const on = views.filter((v) => v.enabled && !(v.engine === "copilot" && v.state === "not_set_up"));
  const order: EngineState[] = ["working", "partly_blocked", "blocked", "not_set_up", "not_run"];
  const counts = order.map((s) => [s, on.filter((v) => v.state === s).length] as const).filter(([, n]) => n > 0);
  if (on.length === 0) return { text: "No engines switched on", tone: "neutral", title: "Switch engines on in Settings" };
  if (counts.length === 1 && counts[0][0] === "not_run") return { text: "Engines not run yet", tone: "neutral", title: "Run an audit to check each engine" };
  const text = counts.map(([s, n]) => `${n} ${STATE_COPY[s].label.toLowerCase()}`).join(" · ");
  const tone: Tone = on.some((v) => v.state === "blocked" || v.state === "not_set_up") ? "danger" : on.some((v) => v.state === "partly_blocked") ? "warning" : on.some((v) => v.state === "working") ? "success" : "neutral";
  const title = on.map((v) => `${engineLabel(v.engine)}: ${v.label}${v.reason ? `. ${v.reason}` : ""}`).join("\n");
  return { text, tone, title };
}

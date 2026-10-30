import { ENGINE_IDS, ENGINES } from "@prismgeo/core";
import Link from "next/link";
import type { Metadata } from "next";
import { getRawDb, getSettings } from "@prismgeo/db";
import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { isProfileConnected, apiKeyFor, type ApiKeys } from "@prismgeo/crawler";
import EngineSessionsPanel from "@/components/EngineSessionsPanel";
import { CopyButton } from "@/components/CopyButton";
import { Badge, Card, CardHeader, Dot, Meter, Notice, PageHeader, buttonClass, engineLabel, formatWhen, plural, type Tone } from "@/components/ui";
import { getEngineViews, getLatestAudit } from "@/components/insights/engine-state";
import { kindPhrase, isRealOutcome, reasonCopy } from "@/components/engine-copy";
import { buildReport } from "@/lib/report";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Engines" };

/** Recent audits used for timing, capture methods and the failure list (status comes from engine-state). */
const RECENT_BATCHES = 3;
const API_ENGINES: string[] = ENGINE_IDS.filter((e) => ENGINES[e].routes.keyed.length > 0);
const KEY_NAME: Record<string, string> = { chatgpt: "OpenAI", gemini: "Gemini", perplexity: "Perplexity", google_aio: "SerpApi", google_ai_mode: "SerpApi" };
const METHOD_LABEL: Record<string, string> = {
  browser: "free browser",
  browser_signed_in: "signed-in session",
  api: "API",
  provider: "data provider",
  manual: "captured by hand",
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Failure {
  engine: string;
  promptId: string | null;
  kind: string;
  message: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default async function EnginesPage() {
  const brand = await activeBrandFromCookies();
  const sqlite = getRawDb();
  const report = brand ? buildReport(brand) : null;
  const coverage = report ? report.coverage.filter((c) => c.activeUnbrandedPrompts > 0) : [];
  const mixed = report ? report.captureMethods.filter((m) => m.mixed) : [];

  const batches = brand
    ? (sqlite
        .prepare("SELECT id, created_at, errors_json FROM crawl_batches WHERE brand_id = ? AND status <> 'running' AND COALESCE(owner, '') <> 'manual-capture' ORDER BY created_at DESC LIMIT ?")
        .all(brand.id, RECENT_BATCHES) as Array<{ id: string; created_at: string; errors_json: string | null }>)
    : [];
  const batchIds = batches.map((b) => b.id);
  const placeholders = batchIds.map(() => "?").join(",") || "''";
  const runs = batchIds.length
    ? (sqlite
        .prepare(`SELECT engine, capture_method, execution_ms FROM prompt_runs WHERE batch_id IN (${placeholders})`)
        .all(...batchIds) as Array<{ engine: string; capture_method: string; execution_ms: number }>)
    : [];
  const allTime = brand
    ? (sqlite.prepare("SELECT engine, COUNT(*) AS n FROM prompt_runs WHERE brand_id = ? GROUP BY engine").all(brand.id) as Array<{ engine: string; n: number }>)
    : [];

  const failures: Array<Failure & { at: string }> = [];
  for (const b of batches) {
    try {
      for (const f of JSON.parse(b.errors_json || "[]") as Failure[]) failures.push({ ...f, at: b.created_at });
    } catch {}
  }
  const promptText = new Map<string, string>();
  if (brand) {
    for (const p of sqlite.prepare("SELECT id, query_text FROM prompts WHERE brand_id = ?").all(brand.id) as Array<{ id: string; query_text: string }>) {
      promptText.set(p.id, p.query_text);
    }
  }

  const engineSettings = getSettings<{ mode?: string } & Record<string, unknown>>("engine_settings", {});
  const mode = engineSettings.mode === "byok" || engineSettings.mode === "stealth" ? engineSettings.mode : "hybrid";
  const keys = getSettings<ApiKeys>("byok_api_keys", {});
  const latest = getLatestAudit(brand?.id, "engines-page");

  const rows = getEngineViews(brand?.id, "engines-page").map((v) => {
    const id = v.engine;
    const h = v.health;
    const er = runs.filter((r) => r.engine === id);
    const status: { label: string; tone: Tone } = v.enabled || v.state === "not_set_up" ? { label: v.label, tone: v.tone } : { label: "Switched off", tone: "outline" };
    const keyName = KEY_NAME[id];
    const route =
      id === "copilot" && v.state === "not_set_up"
        ? "Needs a signed-in Microsoft account"
        : h.route === "api"
          ? h.routeLabel || `${keyName} API key`
          : `${h.route === "signed_in" ? "Signed-in session" : "Free browser (logged out)"}${h.apiFallback ? `, ${h.routeLabel || `${keyName} API key`} if blocked` : ""}`;
    const methods = Object.entries(
      er.reduce<Record<string, number>>((acc, r) => ((acc[r.capture_method] = (acc[r.capture_method] || 0) + 1), acc), {})
    ).map(([m, n]) => `${n} via ${METHOD_LABEL[m] || m}`);
    const signedIn = isProfileConnected(h.engine);
    const topKind = Object.entries(v.kinds)
      .filter(([k]) => !isRealOutcome(k))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      ...v,
      status,
      share: v.attempted ? v.captured / v.attempted : null,
      medianMs: median(er.map((r) => r.execution_ms).filter((x) => x > 0)),
      allTime: Number(allTime.find((a) => a.engine === id)?.n || 0),
      route,
      methods,
      needsSession: !signedIn && (id === "copilot" || id === "perplexity" || topKind === "blocked" || topKind === "skipped_after_blocks"),
      canUseKey: API_ENGINES.includes(id) && apiKeyFor(id, keys) === "" && mode !== "stealth",
    };
  });
  // One group per engine and reason: how often, when last, what to do, and which questions
  const groupKind = (k: string) => (k === "skipped_after_blocks" ? "blocked" : k);
  const failureGroups = [
    ...failures
      .filter((f) => f.promptId || f.kind === "session_expired")
      .reduce((acc, f) => {
        const key = `${f.engine}:${groupKind(f.kind)}`;
        const g = acc.get(key) ?? { engine: f.engine, kind: groupKind(f.kind), attempted: 0, skipped: 0, lastAt: f.at, message: f.message, items: [] as Array<{ promptId: string | null; at: string }> };
        if (f.kind === "skipped_after_blocks") g.skipped++;
        else {
          g.attempted++;
          g.message = f.message;
          if (f.promptId && !g.items.some((x) => x.promptId === f.promptId)) g.items.push({ promptId: f.promptId, at: f.at });
        }
        if (f.at > g.lastAt) g.lastAt = f.at;
        acc.set(key, g);
        return acc;
      }, new Map<string, { engine: string; kind: string; attempted: number; skipped: number; lastAt: string; message: string; items: Array<{ promptId: string | null; at: string }> }>())
      .values(),
  ].sort((a, b) => b.attempted + b.skipped - (a.attempted + a.skipped));
  const setupIssue = latest?.outcome.reason?.technical;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Engines"
        description={
          latest
            ? `Status from each engine's latest audit (last audit ${formatWhen(latest.at)}: ${latest.captured} of ${latest.captured + latest.failed} answered).`
            : "How each AI engine is reached. Run an audit to check each one."
        }
        actions={
          <Link href="/settings?tab=engines" className={buttonClass("secondary")}>
            API keys &amp; mode
          </Link>
        }
      />

      {latest && latest.captured === 0 && latest.outcome.reason && (
        <Notice tone="danger" title={latest.outcome.title}>
          <p>{latest.outcome.reason.next}</p>
          {setupIssue && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-white px-2 py-1 font-mono text-sm text-zinc-900 ring-1 ring-red-200">{setupIssue}</code>
              <CopyButton text={setupIssue} label="Copy command" />
            </div>
          )}
        </Notice>
      )}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <li key={r.engine} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.6fr)] md:items-start md:gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Dot tone={r.status.tone} />
                  <h2 className="text-md font-semibold text-zinc-900">{engineLabel(r.engine)}</h2>
                  <Badge tone={r.status.tone}>{r.status.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-500">{r.route}</p>
              </div>

              <div className="space-y-1.5">
                {r.attempted > 0 ? (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-zinc-500">Answered in latest audit</span>
                      <span className="font-medium text-zinc-900 tabular">
                        {r.captured}/{r.attempted}
                      </span>
                    </div>
                    <Meter
                      value={r.share ?? 0}
                      tone={r.status.tone === "success" ? "success" : r.status.tone === "warning" ? "warning" : "danger"}
                      label={`${engineLabel(r.engine)}: ${r.captured} of ${r.attempted} answered`}
                    />
                    <div className="flex justify-between text-xs text-zinc-500 tabular">
                      <span>{r.medianMs ? `Median ${(r.medianMs / 1000).toFixed(1)}s per answer` : "No timing yet"}</span>
                      <span>{r.allTime} stored</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">{r.allTime ? `${plural(r.allTime, "answer")} stored, none in recent audits` : "No answers yet"}</p>
                )}
              </div>

              <div className="min-w-0 space-y-2">
                {r.state === "working" ? (
                  <p className="text-sm text-zinc-500">Nothing to fix.</p>
                ) : (
                  <>
                    {r.reason && <p className="text-sm text-zinc-700">{r.reason}</p>}
                    {r.fix && <p className="text-sm leading-relaxed text-zinc-700">{r.fix.next}</p>}
                    {!r.reason && !r.fix && <p className="text-sm text-zinc-500">Run an audit to check this engine.</p>}
                  </>
                )}
                {r.state !== "working" && (r.attempted > 0 || r.engine === "copilot") && (r.canUseKey || r.needsSession) && (
                  <div className="flex flex-wrap gap-2">
                    {r.canUseKey && (
                      <Link href="/settings?tab=engines" className={buttonClass("secondary", "sm")}>
                        Add {KEY_NAME[r.engine]} key
                      </Link>
                    )}
                    {r.needsSession && (
                      <a href="#sessions" className={buttonClass("secondary", "sm")}>
                        Connect a session below
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <details className="group border-t border-zinc-100">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-zinc-600 hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="transition-transform duration-150 group-open:rotate-90">
              ›
            </span>
            Show technical details
          </summary>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Mode</dt>
              <dd className="text-zinc-800">{mode === "hybrid" ? "Browser, then API key if blocked" : mode === "byok" ? "API key when saved" : "Free browser only"}</dd>
            </div>
            {rows.map((r) => (
              <div key={r.engine}>
                <dt className="text-zinc-500">{engineLabel(r.engine)}</dt>
                <dd className="text-zinc-800">
                  Captured: {r.methods.length ? r.methods.join(", ") : "none in recent audits"}.{" "}
                  {Object.keys(r.kinds).length > 0 &&
                    `Latest audit: ${Object.entries(r.kinds)
                      .map(([k, n]) => `${n} ${kindPhrase(k)}`)
                      .join(", ")}.`}
                  {r.fix?.technical && (
                    <>
                      {" "}
                      Setup command: <code className="font-mono text-zinc-900">{r.fix.technical}</code>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>

      {coverage.length > 0 && report && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Question coverage"
            description="How many of your active unbranded questions each engine has answered at least once. Engines under half are left out of cross-engine comparisons."
          />
          <ul className="divide-y divide-zinc-100">
            {coverage.map((c) => (
              <li key={c.engine} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
                <span className="font-medium text-zinc-900">{engineLabel(c.engine)}</span>
                <Meter value={c.share} tone={c.inHeadline ? "accent" : "neutral"} label={`${engineLabel(c.engine)} coverage`} />
                <span className="text-sm text-zinc-600 tabular">
                  {c.promptsCovered} of {c.activeUnbrandedPrompts}
                  {!c.inHeadline && " · too few to compare"}
                </span>
              </li>
            ))}
          </ul>
          {(report.aioTrigger.overviews + report.aioTrigger.noOverview > 0 || mixed.length > 0) && (
            <div className="space-y-1 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-600">
              {report.aioTrigger.overviews + report.aioTrigger.noOverview > 0 && (
                <p className="tabular">
                  Google showed an AI Overview for {report.aioTrigger.overviews} of{" "}
                  {plural(report.aioTrigger.overviews + report.aioTrigger.noOverview, "search", "searches")} ({report.aioTrigger.rate.pct}%, likely{" "}
                  {report.aioTrigger.rate.low}–{report.aioTrigger.rate.high}%). Searches without one are a real result, not a failure.
                </p>
              )}
              {mixed.map((m) => (
                <p key={m.engine}>
                  {engineLabel(m.engine)} answers mix capture methods ({Object.entries(m.byMethod)
                    .map(([k, n]) => `${n} via ${METHOD_LABEL[k] || k}`)
                    .join(", ")}). The app and the API can answer differently, so compare like with like.
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      <div id="sessions" className="scroll-mt-20">
        <EngineSessionsPanel />
      </div>

      {batches.length > 0 && (
        <Card>
          <CardHeader
            title="Recent failures"
            description={
              <>
                Runs from the last {plural(batches.length, "audit")} that produced no answer. A screenshot and the page HTML of each failure are saved in{" "}
                <code className="font-mono text-zinc-700">data/crawl-debug/</code>.
              </>
            }
          />
          {failureGroups.length === 0 ? (
            <p className="px-5 py-6 text-base text-zinc-500">No failures in recent audits.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {failureGroups.map((g) => {
                const fix = reasonCopy(g.kind, [g.engine], "engines-page");
                return (
                  <li key={`${g.engine}:${g.kind}`} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isRealOutcome(g.kind) ? "outline" : g.kind === "blocked" ? "danger" : "warning"}>{capital(kindPhrase(g.kind))}</Badge>
                      <span className="font-medium text-zinc-900">{engineLabel(g.engine)}</span>
                      <span className="text-sm text-zinc-500 tabular">
                        {g.attempted > 0 && plural(g.attempted, g.kind === "blocked" ? "attempt" : "run")}
                        {g.skipped > 0 && `${g.attempted > 0 ? " · " : ""}${g.skipped} not attempted while it kept blocking`} · last {formatWhen(g.lastAt)}
                      </span>
                    </div>
                    {!isRealOutcome(g.kind) && (
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                        <span className="min-w-0 flex-1">{fix.next}</span>
                        <Link href={fix.href} className={buttonClass("secondary", "sm")}>
                          {fix.cta}
                        </Link>
                      </div>
                    )}
                    <p className="break-words text-xs text-zinc-500">Engine said: {g.message}</p>
                    {g.items.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">{plural(g.items.length, "question")} affected</summary>
                        <ul className="mt-2 space-y-1 pl-4">
                          {g.items.slice(0, 50).map((x) => (
                            <li key={`${x.promptId}-${x.at}`} className="flex justify-between gap-3 text-zinc-700">
                              <span className="min-w-0">{promptText.get(x.promptId || "") || "Deleted prompt"}</span>
                              <time className="shrink-0 text-xs text-zinc-500 tabular" dateTime={x.at}>
                                {formatWhen(x.at)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

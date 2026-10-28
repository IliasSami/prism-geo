import Link from "next/link";
import { getActiveBrand, getRawDb, getSettings } from "@prismgeo/db";
import { isProfileConnected, apiKeyFor, type ApiKeys } from "@prismgeo/crawler";
import { getEngineHealth, type HealthStatus } from "@/lib/engine-health";
import EngineSessionsPanel from "@/components/EngineSessionsPanel";
import { Badge, Card, CardHeader, Dot, Meter, PageHeader, buttonClass, engineLabel, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Recent audits used for timing, capture methods and the failure list (status comes from getEngineHealth). */
const RECENT_BATCHES = 3;
const STATUS: Record<HealthStatus, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  untested: { label: "Not run yet", tone: "neutral" },
  not_set_up: { label: "Not set up", tone: "neutral" },
};
const API_ENGINES = ["chatgpt", "gemini", "perplexity", "google_aio"];
const KEY_NAME: Record<string, string> = { chatgpt: "OpenAI", gemini: "Gemini", perplexity: "Perplexity", google_aio: "SerpApi" };
const METHOD_LABEL: Record<string, string> = { browser: "free browser", browser_signed_in: "signed-in session", api: "API key" };
const REASON: Record<string, string> = {
  blocked: "Blocked by the engine",
  skipped_after_blocks: "Skipped, engine still blocking",
  no_answer: "No readable answer",
  no_ai_overview: "No AI Overview shown",
  error: "Error",
  network: "Could not connect (network or proxy)",
  setup: "Browser not installed",
  unavailable: "Not available",
};

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

export default function EnginesPage() {
  const brand = getActiveBrand();
  const sqlite = getRawDb();

  const batches = brand
    ? (sqlite
        .prepare("SELECT id, created_at, errors_json FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT ?")
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

  const rows = getEngineHealth(brand?.id).map((h) => {
    const id = h.engine;
    const er = runs.filter((r) => r.engine === id);
    const ef = failures.filter((f) => f.engine === id && f.promptId);
    const status = h.enabled || h.status === "not_set_up" ? STATUS[h.status] : { label: "Switched off", tone: "neutral" as Tone };
    const keyName = KEY_NAME[id];
    const route =
      h.status === "not_set_up"
        ? "Needs a signed-in Microsoft account"
        : h.route === "api"
          ? `${keyName} API key`
          : `${h.route === "signed_in" ? "Signed-in session" : "Free browser (logged out)"}${h.apiFallback ? `, ${keyName} API key if blocked` : ""}`;
    const kinds = ef.reduce<Record<string, number>>((acc, f) => ((acc[f.kind] = (acc[f.kind] || 0) + 1), acc), {});
    const topKind = Object.entries(kinds).sort((x, y) => y[1] - x[1])[0]?.[0];
    const methods = Object.entries(
      er.reduce<Record<string, number>>((acc, r) => ((acc[r.capture_method] = (acc[r.capture_method] || 0) + 1), acc), {})
    ).map(([m, n]) => `${n} via ${METHOD_LABEL[m] || m}`);
    const signedIn = isProfileConnected(id);
    return {
      id,
      status,
      share: h.attempted ? h.captured / h.attempted : null,
      received: h.captured,
      attempted: h.attempted,
      kinds,
      medianMs: median(er.map((r) => r.execution_ms).filter((x) => x > 0)),
      allTime: Number(allTime.find((a) => a.engine === id)?.n || 0),
      route,
      remedy: h.remedy,
      needsSession: !signedIn && (id === "copilot" || id === "perplexity" || topKind === "blocked" || topKind === "skipped_after_blocks"),
      canUseKey: API_ENGINES.includes(id) && apiKeyFor(id, keys) === "",
      methods,
    };
  });
  // Skipped runs were never sent to the engine, so they are summarised instead of listed
  const skippedByEngine = failures
    .filter((f) => f.promptId && f.kind === "skipped_after_blocks")
    .reduce<Record<string, number>>((acc, f) => ((acc[f.engine] = (acc[f.engine] || 0) + 1), acc), {});
  const recentFailures = failures
    .filter((f) => f.promptId && f.kind !== "skipped_after_blocks")
    .slice(-400)
    .reverse()
    .filter((f, i, all) => i === all.findIndex((g) => g.engine === f.engine && g.promptId === f.promptId && g.kind === f.kind))
    .slice(0, 20);
  const working = rows.filter((r) => r.status.tone === "success").length;
  const blocked = rows.filter((r) => r.status.tone === "danger").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Engines"
        description={
          batches.length
            ? `Health from the last ${batches.length === 1 ? "audit" : `${batches.length} audits`}: ${working} working${blocked ? `, ${blocked} blocked` : ""}.`
            : "How each AI engine is reached. Run an audit to measure each one."
        }
        actions={
          <Link href="/settings?tab=engines" className={buttonClass("secondary")}>
            API keys &amp; mode
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <ul className="stagger divide-y divide-zinc-100">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)] md:items-start md:gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Dot tone={r.status.tone} />
                  <h2 className="text-md font-semibold text-zinc-900">{engineLabel(r.id)}</h2>
                  <Badge tone={r.status.tone}>{r.status.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-500">{r.route}</p>
              </div>

              <div className="space-y-1.5">
                {r.attempted > 0 ? (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-zinc-500">Answers received</span>
                      <span className="font-medium text-zinc-900 tabular">
                        {r.received}/{r.attempted}
                      </span>
                    </div>
                    <Meter
                      value={r.share ?? 0}
                      tone={r.status.tone === "success" ? "success" : r.status.tone === "warning" ? "warning" : "danger"}
                      label={`${engineLabel(r.id)} answers received`}
                    />
                    <div className="flex justify-between text-xs text-zinc-500 tabular">
                      <span>{r.medianMs ? `Median ${(r.medianMs / 1000).toFixed(1)}s per answer` : "No timing yet"}</span>
                      <span>{r.allTime} stored</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">{r.allTime ? `${r.allTime} answers stored, none in recent audits` : "No answers yet"}</p>
                )}
              </div>

              <div className="min-w-0 space-y-2">
                {r.remedy ? (
                  <p className="text-sm leading-relaxed text-zinc-700">{r.remedy}</p>
                ) : (
                  <p className="text-sm text-zinc-500">{r.status.tone === "success" ? "Nothing to fix." : "Run an audit to check this engine."}</p>
                )}
                {r.remedy && (
                  <div className="flex flex-wrap gap-2">
                    {r.canUseKey && (
                      <Link href="/settings?tab=engines" className={buttonClass("secondary", "sm")}>
                        Add {KEY_NAME[r.id]} key
                      </Link>
                    )}
                    {r.needsSession && (
                      <a href="#sessions" className={buttonClass("secondary", "sm")}>
                        Connect session
                      </a>
                    )}
                  </div>
                )}
                <details className="group text-xs text-zinc-500">
                  <summary className="cursor-pointer select-none rounded text-zinc-500 hover:text-zinc-800">Technical details</summary>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt>Captured by</dt>
                    <dd className="text-zinc-700">{r.methods.length ? r.methods.join(", ") : "none in recent audits"}</dd>
                    <dt>Failures</dt>
                    <dd className="text-zinc-700">
                      {Object.keys(r.kinds).length
                        ? Object.entries(r.kinds)
                            .map(([k, n]) => `${n} ${(REASON[k] || k).toLowerCase()}`)
                            .join(", ")
                        : "none"}
                    </dd>
                    <dt>Mode</dt>
                    <dd className="text-zinc-700">{mode === "hybrid" ? "Browser, then API key if blocked" : mode === "byok" ? "API key when saved" : "Free browser only"}</dd>
                  </dl>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div id="sessions" className="scroll-mt-20">
        <EngineSessionsPanel />
      </div>

      <Card>
        <CardHeader
          title="Recent failures"
          description={
            <>
              Runs from the last {batches.length || 0} audit{batches.length === 1 ? "" : "s"} that produced no answer. A screenshot and the page HTML of each
              failure are saved in <code className="font-mono text-zinc-700">data/crawl-debug/</code>.
            </>
          }
        />
        {Object.keys(skippedByEngine).length > 0 && (
          <p className="border-b border-zinc-100 px-5 py-3 text-sm text-zinc-600">
            Not attempted because the engine was still blocking:{" "}
            {Object.entries(skippedByEngine)
              .map(([e, n]) => `${engineLabel(e)} ${n}`)
              .join(", ")}
            .
          </p>
        )}
        {recentFailures.length === 0 ? (
          <p className="px-5 py-6 text-base text-zinc-500">No failures in recent audits.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {recentFailures.map((f, i) => (
              <li key={`${f.engine}-${f.promptId}-${i}`} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:w-64">
                  <Badge className="whitespace-nowrap" tone={f.kind === "no_ai_overview" ? "neutral" : f.kind === "blocked" || f.kind === "skipped_after_blocks" ? "danger" : "warning"}>
                    {REASON[f.kind] || f.kind}
                  </Badge>
                  <span className="text-sm font-medium text-zinc-700">{engineLabel(f.engine)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-zinc-900" title={promptText.get(f.promptId || "")}>
                    {promptText.get(f.promptId || "") || "Deleted prompt"}
                  </p>
                  <p className="truncate text-xs text-zinc-500" title={f.message}>
                    {f.message}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-zinc-500 tabular" dateTime={f.at}>
                  {new Date(f.at.includes("T") ? f.at : `${f.at.replace(" ", "T")}Z`).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

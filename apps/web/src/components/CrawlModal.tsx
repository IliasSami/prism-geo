"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Play, X, Check, AlertTriangle, Loader2, Info } from "lucide-react";
import { Button, Badge, Dot, cn, engineLabel, buttonClass, type Tone } from "./ui";
import { auditOutcome, issueLine, isRealOutcome, type EngineState, type Issue } from "./engine-copy";
import { NOT_RUNNING } from "./request";

/** Engine status as shown everywhere else (components/insights/engine-state.ts). */
export interface EngineOption {
  engine: string;
  enabled: boolean;
  state: EngineState;
  label: string;
  tone: Tone;
  reason: string | null;
  route: "browser" | "signed_in" | "api";
  apiFallback: boolean;
  /** Name of the paid route ("DataForSEO", "OpenAI API", ...), when one is saved. */
  routeLabel?: string | null;
}

interface AuditStatus {
  batchId?: string;
  status: "idle" | "running" | "completed" | "failed";
  completedRuns: number;
  failedRuns: number;
  totalRuns: number;
  percent: number;
  currentPrompt: string;
  currentEngine: string;
  issues: Issue[];
}

const IDLE: AuditStatus = { status: "idle", completedRuns: 0, failedRuns: 0, totalRuns: 0, percent: 0, currentPrompt: "", currentEngine: "", issues: [] };

/**
 * Seconds per question per engine as measured on live runs (answer time plus pacing between
 * queries). Engines run side by side, so an audit takes as long as its slowest engine.
 */
const SECONDS_PER_QUERY: Record<string, number> = { chatgpt: 36, gemini: 41, perplexity: 37, google_aio: 38, google_ai_mode: 10, copilot: 36 };

function estimate(engines: string[], questions: number, repeats: number): string {
  if (!engines.length || !questions) return "nothing to run";
  const seconds = Math.max(0, ...engines.map((e) => (SECONDS_PER_QUERY[e] || 40) * questions * repeats));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const time = minutes < 60 ? `about ${minutes} min` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return engines.length > 1 ? `${time}, engines run side by side` : time;
}

/** Why an engine cannot be picked in the dialog, with where to fix it; null when it can run. */
function blockedReason(e: EngineOption): { text: string; href: string; cta: string } | null {
  if (!e.enabled) return { text: "Switched off in Settings.", href: "/settings?tab=engines", cta: "Switch it on" };
  if (e.engine === "copilot" && e.state === "not_set_up") return { text: "Copilot needs a signed-in Microsoft account.", href: "/engines#sessions", cta: "Connect it on Engines" };
  if (e.engine === "google_ai_mode" && e.state === "not_set_up")
    return { text: "Google AI Mode needs a SerpApi key, an Apify token or the DataForSEO data provider.", href: "/settings?tab=engines", cta: "Add one in Settings" };
  return null;
}

interface AuditContextValue {
  openAudit: (opener?: HTMLElement | null) => void;
  available: boolean;
  /** Every engine is switched off in Settings, so nothing can run. */
  enginesOff: boolean;
}

const AuditContext = createContext<AuditContextValue>({ openAudit: () => {}, available: false, enginesOff: false });

/** "Every engine is switched off" with a link to Settings → Engines & access. */
export function EnginesOffNote({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <span>
      Every engine is switched off, so an audit has nothing to ask.{" "}
      <Link href="/settings?tab=engines" onClick={onNavigate} className="font-medium text-accent-700 underline-offset-2 hover:underline">
        Switch engines on in Settings → Engines &amp; access
      </Link>
      .
    </span>
  );
}

/** Opens the audit dialog from anywhere: the header, the mobile bar, or an empty state. */
export function useAudit() {
  return useContext(AuditContext);
}

/** The header / mobile-bar trigger. */
export function AuditTrigger({ compact = false }: { compact?: boolean }) {
  const { openAudit, available } = useAudit();
  return compact ? (
    <button
      type="button"
      onClick={(e) => openAudit(e.currentTarget)}
      disabled={!available}
      className={buttonClass("secondary", "sm", "h-10 gap-1.5 px-3")}
      aria-label="Run audit"
    >
      <Play className="h-4 w-4 text-accent-600" aria-hidden />
      Run
    </button>
  ) : (
    <button type="button" onClick={(e) => openAudit(e.currentTarget)} disabled={!available} className={buttonClass("primary", "md")}>
      <Play className="h-4 w-4" aria-hidden />
      Run audit
    </button>
  );
}

/** A call to action for empty states. */
export function RunAuditButton({ label = "Run an audit", variant = "primary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const { openAudit, available, enginesOff } = useAudit();
  if (!available) return null;
  if (enginesOff)
    return (
      <Link href="/settings?tab=engines" className={buttonClass(variant, "md")}>
        Switch engines on to run an audit
      </Link>
    );
  return (
    <button type="button" onClick={(e) => openAudit(e.currentTarget)} className={buttonClass(variant, "md")}>
      <Play className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Holds the one audit dialog for the page. Any `?audit=1` link opens it too, so server-rendered
 * pages can link straight to "run an audit".
 */
export function AuditProvider({
  brandId,
  brandName,
  totalPrompts = 0,
  engines,
  children,
}: {
  brandId?: string;
  brandName?: string;
  totalPrompts?: number;
  engines: EngineOption[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [questions, setQuestions] = useState(() => (totalPrompts > 10 ? 10 : 0));
  const [repeats, setRepeats] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditStatus>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const available = Boolean(brandId);
  const enginesOff = engines.length > 0 && engines.every((e) => !e.enabled);
  // Per engine, the active questions it has never answered (for "Unanswered"); null until loaded
  const [gaps, setGaps] = useState<Record<string, number> | null>(null);

  useEffect(() => setMounted(true), []);

  const openAudit = useCallback(
    (from?: HTMLElement | null) => {
      if (!brandId) return;
      opener.current = from || (document.activeElement as HTMLElement | null);
      setOpen(true);
    },
    [brandId]
  );

  // ?audit=1 on any page opens the dialog once, then the parameter is removed from the URL
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("audit") !== "1") return;
    sp.delete("audit");
    window.history.replaceState(null, "", `${window.location.pathname}${sp.size ? `?${sp}` : ""}${window.location.hash}`);
    openAudit(null);
  }, [pathname, openAudit]);

  const selectable = engines.filter((e) => !blockedReason(e));
  // Only engines that can run are ever sent, even if Settings changed while the dialog was open
  const chosen = selected.filter((id) => selectable.some((e) => e.engine === id));

  // Defaults on open: engines enabled in Settings, repeats from Settings (capped for a first look)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuestions((q) => (q >= totalPrompts ? 0 : q));
    // Engines switched off (or not set up) since the last open are taken out of the selection
    setSelected((cur) => {
      const kept = cur.filter((id) => selectable.some((e) => e.engine === id));
      return kept.length ? kept : selectable.map((e) => e.engine);
    });
    setGaps(null);
    if (brandId)
      fetch(`/api/crawl/gaps?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.gaps && setGaps(d.gaps as Record<string, number>))
        .catch(() => null);
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.crawler?.sampleSize && setRepeats(Math.min(5, Math.max(1, Number(d.crawler.sampleSize)))))
      .catch(() => null);
    // Attach to an audit that is already running for this client
    fetch(`/api/crawl/status${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.status === "running" && setAudit({ ...IDLE, ...d }))
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brandId]);

  // Poll while an audit runs
  useEffect(() => {
    if (!open || audit.status !== "running") return;
    const url = audit.batchId ? `/api/crawl/status?batchId=${encodeURIComponent(audit.batchId)}` : `/api/crawl/status?brandId=${encodeURIComponent(brandId || "")}`;
    const t = setInterval(async () => {
      try {
        const d = await (await fetch(url, { cache: "no-store" })).json();
        if (d?.status) setAudit((s) => ({ ...s, ...d, issues: d.issues || [] }));
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [open, audit.status, audit.batchId, brandId]);

  const close = useCallback(() => {
    setOpen(false);
    if (audit.status === "completed" || audit.status === "failed") {
      setAudit(IDLE);
      router.refresh();
    }
    const el = opener.current;
    opener.current = null;
    if (el && document.contains(el)) el.focus();
  }, [audit.status, router]);

  // Escape closes (a running audit keeps going on the server); focus stays inside the dialog
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])")].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const [firstEl, lastEl] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === firstEl) (e.preventDefault(), lastEl.focus());
        else if (!e.shiftKey && document.activeElement === lastEl) (e.preventDefault(), firstEl.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // -1: each engine asks only the questions it has never answered ("fill the gaps")
  const gapsOnly = questions === -1;
  const fullCount = questions <= 0 ? totalPrompts : Math.min(questions, totalPrompts);
  // Unanswered: each engine asks only its own gaps, so the count comes from the server
  const gapCounts = chosen.map((e) => (gaps ? (gaps[e] ?? 0) : totalPrompts));
  const questionCount = gapsOnly ? Math.max(0, ...gapCounts) : fullCount;
  const runs = gapsOnly ? gapCounts.reduce((sum, n) => sum + n, 0) * repeats : fullCount * repeats * chosen.length;
  const gapEngines = gapsOnly ? chosen.filter((e, i) => gapCounts[i] > 0) : chosen;
  const questionOptions = [10, 25, 50].filter((n) => n < totalPrompts);

  async function start() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/crawl/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, sampleSize: repeats, engines: chosen, promptLimit: questions <= 0 ? undefined : questions, scope: gapsOnly ? "gaps" : "all" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.runningBatchId) {
        setAudit({ ...IDLE, status: "running", batchId: data.runningBatchId, currentPrompt: "An audit is already running; showing its progress" });
      } else if (!res.ok) {
        setError(data.error || `The audit could not be started (error ${res.status}).`);
      } else {
        setAudit({ ...IDLE, status: "running", batchId: data.batchId, totalRuns: runs, currentPrompt: "Starting browsers…" });
      }
    } catch (e) {
      setError(e instanceof TypeError ? NOT_RUNNING : `The audit could not be started: ${(e as Error).message}.`);
    } finally {
      setSubmitting(false);
    }
  }

  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (audit.status !== "running") setStopping(false);
  }, [audit.status]);
  async function stop() {
    if (!audit.batchId) return;
    setStopping(true);
    setError(null);
    try {
      const res = await fetch("/api/crawl/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: audit.batchId }) });
      if (!res.ok) {
        setStopping(false);
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error || `The audit could not be stopped (error ${res.status}).`);
      }
    } catch {
      setStopping(false);
      setError(NOT_RUNNING);
    }
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));

  const running = audit.status === "running";
  const finished = audit.status === "completed" || audit.status === "failed";
  const done = audit.completedRuns + audit.failedRuns;
  const countOf = (pred: (kind: string) => boolean) => audit.issues.filter((i) => pred(i.kind)).reduce((s, i) => s + i.count, 0);
  // "No AI Overview" is a real answer from Google; questions deleted or paused mid-audit were skipped
  // as asked. Neither is a failure, so they are taken out of "not captured".
  const noOverview = countOf((k) => k === "no_ai_overview");
  const skippedByEdit = countOf((k) => isRealOutcome(k) && k !== "no_ai_overview");
  const notCaptured = Math.max(0, audit.failedRuns - noOverview - skippedByEdit);
  const outcome = finished ? auditOutcome(audit.completedRuns + noOverview, notCaptured, audit.issues) : null;
  const realIssues = audit.issues.filter((i) => !isRealOutcome(i.kind));

  const title = running ? "Audit in progress" : outcome ? outcome.title : "Run an audit";
  const subtitle = running
    ? "It keeps running if you close this window."
    : outcome
      ? outcome.detail
      : `Ask the engines ${brandName ? `${brandName}'s` : "your"} questions and store their real answers.`;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[2px] animate-fade-in" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-title"
        aria-describedby="audit-desc"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop animate-sheet-in sm:max-w-lg sm:rounded-2xl sm:animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="audit-title" className="flex items-start gap-2 text-lg font-semibold text-zinc-900">
              {outcome && (outcome.tone === "danger" ? <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-red-600" aria-hidden /> : outcome.tone === "success" ? <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> : <Info className="mt-1 h-4 w-4 shrink-0 text-amber-700" aria-hidden />)}
              {title}
            </h2>
            <p id="audit-desc" className="mt-0.5 text-sm text-zinc-500">
              {subtitle}
            </p>
          </div>
          <button type="button" data-autofocus onClick={close} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
          {!running && !finished && enginesOff && (
            <div role="note" className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
              <EnginesOffNote onNavigate={close} />
            </div>
          )}
          {!running && !finished && (
            <>
              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Questions</legend>
                <div className={cn("mt-2 grid gap-1.5 rounded-lg bg-zinc-100 p-1", ["grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5"][questionOptions.length])}>
                  {[...questionOptions, 0, -1].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuestions(n)}
                      aria-pressed={questions === n}
                      className={cn(
                        "h-9 tap-target rounded-md text-sm font-medium transition duration-150",
                        questions === n ? "bg-white text-zinc-900 shadow-card" : "text-zinc-600 hover:text-zinc-900"
                      )}
                    >
                      {n === -1 ? "Unanswered" : n === 0 ? `All ${totalPrompts}` : `First ${n}`}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  You have {totalPrompts} active {totalPrompts === 1 ? "question" : "questions"}.{" "}
                  {questionOptions.length > 0 && "A smaller audit starts with the first active ones. "}
                  {gapsOnly &&
                    `Unanswered: each engine asks only the questions it has never answered, so every engine ends up covering every question${
                      gaps ? ` (${chosen.map((e) => `${engineLabel(e)} ${gaps[e] ?? 0}`).join(", ") || "no engine selected"})` : ""
                    }. `}
                  To re-check them every day, turn on the daily schedule in{" "}
                  <Link href="/settings?tab=schedule" onClick={close} className="font-medium text-accent-700 underline-offset-2 hover:underline">
                    Settings → Schedule
                  </Link>{" "}
                  (it is off until you do).
                </p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Ask each question</legend>
                <div className="mt-2 grid grid-cols-5 gap-1.5 rounded-lg bg-zinc-100 p-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRepeats(n)}
                      aria-pressed={repeats === n}
                      aria-label={`${n} ${n === 1 ? "time" : "times"} per engine`}
                      className={cn(
                        "h-9 tap-target rounded-md text-sm font-medium transition duration-150",
                        repeats === n ? "bg-white text-zinc-900 shadow-card" : "text-zinc-600 hover:text-zinc-900"
                      )}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">AI answers vary between asks; asking more times gives tighter ranges but takes longer.</p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Engines</legend>
                <ul className="mt-2 space-y-1.5">
                  {engines.map((e) => {
                    const blocked = blockedReason(e);
                    const disabled = Boolean(blocked);
                    const isOn = !disabled && selected.includes(e.engine);
                    return (
                      <li key={e.engine}>
                        <label
                          className={cn(
                            "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition duration-150",
                            disabled ? "cursor-not-allowed border-zinc-200 bg-zinc-50" : isOn ? "cursor-pointer border-accent-200 bg-accent-50/50" : "cursor-pointer border-zinc-300 hover:border-zinc-400"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600"
                            checked={isOn}
                            disabled={disabled}
                            aria-describedby={blocked || e.reason ? `engine-reason-${e.engine}` : undefined}
                            onChange={() => toggle(e.engine)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-medium text-zinc-900">{engineLabel(e.engine)}</span>
                              {e.enabled ? <Badge tone={e.tone}>{e.label}</Badge> : <Badge tone="outline">Switched off</Badge>}
                              {e.route === "signed_in" && <Badge tone="info">Signed in</Badge>}
                              {(e.route === "api" || e.apiFallback) && <Badge tone="info">{e.routeLabel || "API key"}</Badge>}
                            </span>
                            {blocked ? (
                              <span id={`engine-reason-${e.engine}`} className="mt-1 block text-xs text-zinc-600">
                                Can&apos;t be selected: {blocked.text}{" "}
                                <Link href={blocked.href} onClick={close} className="font-medium text-accent-700 underline-offset-2 hover:underline">
                                  {blocked.cta}
                                </Link>
                              </span>
                            ) : (
                              e.reason && (
                                <span id={`engine-reason-${e.engine}`} className="mt-1 block text-xs text-zinc-600">
                                  {e.reason}
                                </span>
                              )
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </>
          )}

          {(running || finished) && (
            <div className="space-y-4" aria-live="polite">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-zinc-900 tabular">
                    {audit.completedRuns + noOverview} captured · {notCaptured} not captured
                    {skippedByEdit > 0 && <> · {skippedByEdit} skipped (question edited)</>}
                  </span>
                  <span className="text-zinc-500 tabular">
                    {done} of {audit.totalRuns || "…"}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500", outcome?.tone === "danger" ? "bg-red-600" : "bg-accent-600")}
                    style={{ width: `${finished ? 100 : Math.max(3, audit.percent)}%` }}
                  />
                </div>
                {running && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-600" aria-hidden />
                    <span className="truncate">
                      {audit.currentEngine ? `${engineLabel(audit.currentEngine)}: ` : ""}
                      {audit.currentPrompt}
                    </span>
                  </p>
                )}
              </div>

              {outcome?.reason && (
                <div className={cn("rounded-xl border p-3", outcome.tone === "danger" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50/60")}>
                  <div className={cn("text-sm font-semibold", outcome.tone === "danger" ? "text-red-900" : "text-amber-900")}>{outcome.reason.title}</div>
                  <p className={cn("mt-1 text-sm", outcome.tone === "danger" ? "text-red-900" : "text-amber-900")}>{outcome.reason.next}</p>
                  {outcome.reason.technical && (
                    <p className="mt-2 text-xs text-zinc-700">
                      Command for the computer running PrismGEO: <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-900 ring-1 ring-zinc-200">{outcome.reason.technical}</code>
                    </p>
                  )}
                </div>
              )}

              {realIssues.length > 0 && (
                <div className="rounded-xl border border-zinc-200 p-3">
                  <div className="text-sm font-medium text-zinc-900">{audit.completedRuns === 0 && finished ? "No engine answered" : running ? "Not every run answered so far" : "Runs that failed"}</div>
                  <ul className="mt-2 space-y-1">
                    {audit.issues.map((i) => (
                      <li key={`${i.engine}:${i.kind}`} className="text-sm text-zinc-700">
                        {issueLine(i)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-zinc-500">Failed runs are recorded with their reason and never filled in.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-5 py-2.5 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
          {!running && !finished ? (
            <>
              <span className="text-sm text-zinc-600 tabular">
                {gapsOnly && !gaps ? "up to " : ""}
                {runs} {runs === 1 ? "answer" : "answers"} · {estimate(gapEngines, questionCount, repeats)}
              </span>
              <Button variant="primary" onClick={start} disabled={submitting || enginesOff || chosen.length === 0 || questionCount === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                Start audit
              </Button>
            </>
          ) : finished && outcome ? (
            outcome.tone === "danger" ? (
              <>
                <Button onClick={close}>Close</Button>
                <Link href={outcome.reason?.href.startsWith("#") ? `/engines${outcome.reason.href}` : outcome.reason?.href || "/engines"} onClick={close} className={buttonClass("primary")}>
                  {outcome.reason?.cta || "See how to fix"}
                </Link>
              </>
            ) : (
              <>
                <Link href="/responses" onClick={close} className={buttonClass("ghost")}>
                  View answers
                </Link>
                <Link href="/" onClick={close} className={buttonClass("primary")}>
                  See results
                </Link>
              </>
            )
          ) : (
            <>
              <span className="flex items-center gap-2 text-sm text-zinc-600">
                <Dot tone="accent" pulse /> {stopping ? "Stopping after the current question…" : "Running"}
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={stop} disabled={stopping || !audit.batchId}>
                  Stop audit
                </Button>
                <Button onClick={close}>Close</Button>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <AuditContext.Provider value={{ openAudit, available, enginesOff }}>
      {children}
      {mounted && open && createPortal(dialog, document.body)}
    </AuditContext.Provider>
  );
}

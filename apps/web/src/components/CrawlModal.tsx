"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Play, X, Check, AlertTriangle, Loader2, Info } from "lucide-react";
import { Button, Badge, Dot, cn, engineLabel, buttonClass, type Tone } from "./ui";
import { auditOutcome, issueLine, isRealOutcome, type EngineState, type Issue } from "./engine-copy";

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

interface AuditContextValue {
  openAudit: (opener?: HTMLElement | null) => void;
  available: boolean;
}

const AuditContext = createContext<AuditContextValue>({ openAudit: () => {}, available: false });

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
  const { openAudit, available } = useAudit();
  if (!available) return null;
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

  const selectable = engines.filter((e) => e.state !== "not_set_up" || e.engine !== "copilot");

  // Defaults on open: engines enabled in Settings, repeats from Settings (capped for a first look)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuestions((q) => (q >= totalPrompts ? 0 : q));
    setSelected((cur) => (cur.length ? cur : selectable.filter((e) => e.enabled).map((e) => e.engine)));
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

  const questionCount = questions === 0 ? totalPrompts : Math.min(questions, totalPrompts);
  const runs = questionCount * repeats * selected.length;
  const questionOptions = [10, 25, 50].filter((n) => n < totalPrompts);

  async function start() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/crawl/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, sampleSize: repeats, engines: selected, promptLimit: questions === 0 ? undefined : questions }),
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
      setError(`The audit could not be started: ${(e as Error).message || "network error"}.`);
    } finally {
      setSubmitting(false);
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
          {!running && !finished && (
            <>
              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Questions</legend>
                <div className={cn("mt-2 grid gap-1.5 rounded-lg bg-zinc-100 p-1", ["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"][questionOptions.length])}>
                  {[...questionOptions, 0].map((n) => (
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
                      {n === 0 ? `All ${totalPrompts}` : `First ${n}`}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  You have {totalPrompts} active {totalPrompts === 1 ? "question" : "questions"}.{" "}
                  {questionOptions.length > 0 && "A smaller audit starts with the first active ones. "}
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
                    const disabled = e.engine === "copilot" && e.state === "not_set_up";
                    const isOn = selected.includes(e.engine);
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
                            aria-describedby={e.reason ? `engine-reason-${e.engine}` : undefined}
                            onChange={() => toggle(e.engine)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-medium text-zinc-900">{engineLabel(e.engine)}</span>
                              <Badge tone={e.tone}>{e.label}</Badge>
                              {e.route === "signed_in" && <Badge tone="info">Signed in</Badge>}
                              {(e.route === "api" || e.apiFallback) && <Badge tone="info">{e.routeLabel || "API key"}</Badge>}
                            </span>
                            {disabled ? (
                              <span id={`engine-reason-${e.engine}`} className="mt-1 block text-xs text-zinc-600">
                                Can&apos;t be selected: Copilot needs a signed-in Microsoft account.{" "}
                                <Link href="/engines#sessions" onClick={close} className="font-medium text-accent-700 underline-offset-2 hover:underline">
                                  Connect it on Engines
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
                {runs} {runs === 1 ? "answer" : "answers"} · {estimate(selected, questionCount, repeats)}
              </span>
              <Button variant="primary" onClick={start} disabled={submitting || selected.length === 0 || questionCount === 0}>
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
                <Dot tone="accent" pulse /> Running
              </span>
              <Button onClick={close}>Close</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <AuditContext.Provider value={{ openAudit, available }}>
      {children}
      {mounted && open && createPortal(dialog, document.body)}
    </AuditContext.Provider>
  );
}

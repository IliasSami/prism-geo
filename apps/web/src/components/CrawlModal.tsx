"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, X, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Button, Badge, Dot, cn, engineLabel, buttonClass } from "./ui";

/** Engine status as computed on the server (lib/engine-health.ts). */
export interface EngineOption {
  engine: string;
  enabled: boolean;
  status: "working" | "degraded" | "blocked" | "untested" | "not_set_up";
  route: "browser" | "signed_in" | "api";
  apiFallback: boolean;
  remedy: string | null;
}

interface Issue {
  engine: string;
  kind: string;
  count: number;
  example: string;
  remedy: string | null;
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
 * queries). Engines run in parallel, so an audit takes as long as its slowest engine.
 */
const SECONDS_PER_QUERY: Record<string, number> = { chatgpt: 36, gemini: 41, perplexity: 37, google_aio: 38, copilot: 36 };

function estimate(engines: string[], questions: number, repeats: number): string {
  const seconds = Math.max(0, ...engines.map((e) => (SECONDS_PER_QUERY[e] || 40) * questions * repeats));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes < 60 ? `about ${minutes} min` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const STATUS_COPY: Record<EngineOption["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  working: { label: "Working", tone: "success" },
  degraded: { label: "Partly blocked", tone: "warning" },
  blocked: { label: "Blocked last audit", tone: "danger" },
  untested: { label: "Not run yet", tone: "neutral" },
  not_set_up: { label: "Needs sign-in", tone: "neutral" },
};

const KIND_COPY: Record<string, string> = {
  blocked: "blocked",
  skipped_after_blocks: "skipped while blocked",
  no_answer: "no readable answer",
  no_ai_overview: "no AI Overview shown",
  error: "errors",
  network: "could not connect",
  setup: "browser not installed",
  unavailable: "not available",
};

export function CrawlModal({
  brandId,
  brandName,
  totalPrompts = 0,
  engines,
  compact = false,
}: {
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
  totalPrompts?: number;
  engines: EngineOption[];
  /** Icon-sized trigger for the mobile top bar. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [questions, setQuestions] = useState(10);
  const [repeats, setRepeats] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditStatus>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const selectable = engines.filter((e) => e.status !== "not_set_up");

  // Defaults on open: engines enabled in Settings, repeats from Settings (capped for a first look)
  useEffect(() => {
    if (!open) return;
    setError(null);
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
    triggerRef.current?.focus();
  }, [audit.status, router]);

  // Escape closes (a running audit keeps going on the server); focus stays inside the dialog
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>("button, [href], input");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])")];
        if (!items.length) return;
        const [firstEl, lastEl] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === firstEl) (e.preventDefault(), lastEl.focus());
        else if (!e.shiftKey && document.activeElement === lastEl) (e.preventDefault(), firstEl.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const questionCount = questions === 0 ? totalPrompts : Math.min(questions, totalPrompts);
  const runs = questionCount * repeats * selected.length;

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
        setError(data.error || "The audit could not be started");
      } else {
        setAudit({ ...IDLE, status: "running", batchId: data.batchId, totalRuns: runs, currentPrompt: "Starting browsers…" });
      }
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));

  const trigger = compact ? (
    <button
      ref={triggerRef}
      onClick={() => setOpen(true)}
      disabled={!brandId}
      className={buttonClass("primary", "md", "h-10 px-3")}
      aria-label="Run audit"
    >
      <Play className="h-4 w-4" />
      Run
    </button>
  ) : (
    <button ref={triggerRef} onClick={() => setOpen(true)} disabled={!brandId} className={buttonClass("primary", "md")}>
      <Play className="h-4 w-4" />
      Run audit
    </button>
  );

  const running = audit.status === "running";
  const finished = audit.status === "completed" || audit.status === "failed";
  const done = audit.completedRuns + audit.failedRuns;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[2px] animate-fade-in" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-title"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop animate-scale-in sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div>
            <h2 id="audit-title" className="text-lg font-semibold text-zinc-900">
              {running ? "Audit in progress" : finished ? "Audit finished" : "Run an audit"}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {running
                ? "It keeps running if you close this window."
                : finished
                  ? `${brandName || "This client"}: results are on Overview and Answers.`
                  : `Ask the engines ${brandName ? `${brandName}'s` : "your"} questions and store their real answers.`}
            </p>
          </div>
          <button onClick={close} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {!running && !finished && (
            <>
              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Questions</legend>
                <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-lg bg-zinc-100 p-1">
                  {[10, 25, 50, 0].map((n) => {
                    const disabled = n > 0 && n > totalPrompts && n !== 10;
                    return (
                      <button
                        key={n}
                        onClick={() => setQuestions(n)}
                        disabled={disabled}
                        aria-pressed={questions === n}
                        className={cn(
                          "h-9 tap-target rounded-md text-sm font-medium transition duration-150 disabled:opacity-40",
                          questions === n ? "bg-white text-zinc-900 shadow-card" : "text-zinc-600 hover:text-zinc-900"
                        )}
                      >
                        {n === 0 ? `All ${totalPrompts}` : n}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">Starts with the first active questions. Use the daily schedule (Settings) to cover all of them gently.</p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Repeats per question</legend>
                <div className="mt-2 grid grid-cols-5 gap-1.5 rounded-lg bg-zinc-100 p-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRepeats(n)}
                      aria-pressed={repeats === n}
                      className={cn(
                        "h-9 tap-target rounded-md text-sm font-medium transition duration-150",
                        repeats === n ? "bg-white text-zinc-900 shadow-card" : "text-zinc-600 hover:text-zinc-900"
                      )}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">Answers vary between asks; more repeats give tighter ranges but take longer.</p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-zinc-700">Engines</legend>
                <ul className="mt-2 space-y-1.5">
                  {engines.map((e) => {
                    const disabled = e.status === "not_set_up";
                    const isOn = selected.includes(e.engine);
                    const copy = STATUS_COPY[e.status];
                    return (
                      <li key={e.engine}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition duration-150",
                            disabled ? "cursor-not-allowed border-zinc-100 bg-zinc-50" : isOn ? "border-accent-200 bg-accent-50/50" : "border-zinc-200 hover:border-zinc-300"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-600"
                            checked={isOn}
                            disabled={disabled}
                            onChange={() => toggle(e.engine)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-medium text-zinc-900">{engineLabel(e.engine)}</span>
                              <Badge tone={copy.tone}>{copy.label}</Badge>
                              {e.route === "signed_in" && <Badge tone="info">Signed in</Badge>}
                              {(e.route === "api" || e.apiFallback) && <Badge tone="accent">API key</Badge>}
                            </span>
                            {e.remedy && <span className="mt-1 block text-xs text-zinc-500">{e.remedy}</span>}
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
                    {audit.completedRuns} captured · {audit.failedRuns} not captured
                  </span>
                  <span className="text-zinc-500 tabular">
                    {done} of {audit.totalRuns || "…"}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500", audit.status === "failed" ? "bg-red-500" : "bg-accent-500")}
                    style={{ width: `${finished ? 100 : Math.max(3, audit.percent)}%` }}
                  />
                </div>
                {running && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-600" />
                    <span className="truncate">
                      {audit.currentEngine ? `${engineLabel(audit.currentEngine)}: ` : ""}
                      {audit.currentPrompt}
                    </span>
                  </p>
                )}
                {finished && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                    {audit.completedRuns > 0 ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
                    {audit.currentPrompt}
                  </p>
                )}
              </div>

              {audit.issues.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="text-sm font-medium text-amber-900">Not every engine answered</div>
                  <ul className="mt-2 space-y-2">
                    {audit.issues.map((i) => (
                      <li key={`${i.engine}:${i.kind}`} className="text-sm text-amber-900">
                        <span className="font-medium">{engineLabel(i.engine)}</span>: {i.count} {KIND_COPY[i.kind] || i.kind}
                        {i.remedy && <span className="mt-0.5 block text-xs text-amber-800">{i.remedy}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-amber-800">Failed runs are recorded with their reason and never filled in.</p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
          {!running && !finished ? (
            <>
              <span className="text-sm text-zinc-600 tabular">
                {runs} answers · {estimate(selected, questionCount, repeats)}
              </span>
              <Button variant="primary" onClick={start} disabled={submitting || selected.length === 0 || questionCount === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start audit
              </Button>
            </>
          ) : finished ? (
            <>
              <Link href="/responses" onClick={close} className={buttonClass("ghost")}>
                View answers
              </Link>
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </>
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
    <>
      {trigger}
      {mounted && open && createPortal(dialog, document.body)}
    </>
  );
}

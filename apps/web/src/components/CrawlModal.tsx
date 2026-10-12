"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  Layers,
  Sparkles,
  RefreshCw,
  Globe,
  Check,
  Terminal,
  ShieldCheck,
} from "lucide-react";

interface CrawlStatus {
  batchId?: string;
  status: "idle" | "running" | "completed" | "failed";
  completedRuns: number;
  totalRuns: number;
  percent: number;
  currentPrompt: string;
  currentEngine: string;
}

const AVAILABLE_ENGINES = [
  {
    id: "perplexity",
    name: "Perplexity AI",
    tag: "Sonar / Live RAG",
    color: "bg-teal-400",
    borderActive: "border-teal-500/60 bg-teal-950/30",
    badge: "text-teal-400 bg-teal-950/80 border-teal-800/60",
  },
  {
    id: "google_aio",
    name: "Google AI Overviews",
    tag: "Gemini Search RAG",
    color: "bg-sky-400",
    borderActive: "border-sky-500/60 bg-sky-950/30",
    badge: "text-sky-400 bg-sky-950/80 border-sky-800/60",
  },
  {
    id: "copilot",
    name: "Microsoft Copilot",
    tag: "Bing Grounding",
    color: "bg-purple-400",
    borderActive: "border-purple-500/60 bg-purple-950/30",
    badge: "text-purple-400 bg-purple-950/80 border-purple-800/60",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tag: "Search Integration",
    color: "bg-indigo-400",
    borderActive: "border-indigo-500/60 bg-indigo-950/30",
    badge: "text-indigo-400 bg-indigo-950/80 border-indigo-800/60",
  },
  {
    id: "chatgpt",
    name: "ChatGPT Search",
    tag: "Autonomous Web",
    color: "bg-emerald-400",
    borderActive: "border-emerald-500/60 bg-emerald-950/30",
    badge: "text-emerald-400 bg-emerald-950/80 border-emerald-800/60",
  },
];

export function CrawlModal({
  brandId,
  brandName,
  brandDomain,
}: {
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
}) {
  const [open, setOpen] = useState(false);
  const [promptScope, setPromptScope] = useState<number>(30);
  const [sampleSize, setSampleSize] = useState(5);
  const [concurrency, setConcurrency] = useState(2);
  const [selectedEngines, setSelectedEngines] = useState<string[]>([
    "perplexity",
    "google_aio",
    "copilot",
    "gemini",
    "chatgpt",
  ]);
  const [status, setStatus] = useState<CrawlStatus>({
    status: "idle",
    completedRuns: 0,
    totalRuns: 0,
    percent: 0,
    currentPrompt: "Ready",
    currentEngine: "idle",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Whenever modal opens, clear any previous error and check if a run is currently active
  useEffect(() => {
    if (open) {
      if (status.status !== "running") {
        setErrorMessage(null);
        const checkActive = async () => {
          try {
            const url = `/api/crawl/status${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (data.status === "running") {
                setStatus(data);
              } else {
                setStatus({
                  status: "idle",
                  completedRuns: 0,
                  totalRuns: 0,
                  percent: 0,
                  currentPrompt: "Ready",
                  currentEngine: "idle",
                });
              }
            }
          } catch {}
        };
        checkActive();
      }
    }
  }, [open, brandId]);

  // Poll status while open and running
  useEffect(() => {
    let interval: any;
    if (open && status.status === "running") {
      interval = setInterval(async () => {
        try {
          const url = status.batchId
            ? `/api/crawl/status?batchId=${encodeURIComponent(status.batchId)}`
            : `/api/crawl/status${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data.status === "completed") {
              setStatus((s) => ({ ...s, ...data, status: "completed" }));
              setIsSubmitting(false);
              setErrorMessage(null);
            } else if (data.status === "failed") {
              setStatus((s) => ({ ...s, ...data, status: "failed" }));
              setIsSubmitting(false);
              setErrorMessage(data.currentPrompt || "Audit run encountered a fatal error.");
            } else if (data.status === "running") {
              setStatus((s) => ({ ...s, ...data }));
            }
          }
        } catch {}
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [open, status.status, status.batchId, brandId]);

  // Handle Escape key and body scroll lock
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open && status.status !== "running") {
        setOpen(false);
      }
    }
    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, status.status]);

  async function handleStartCrawl() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const totalEstRuns = (promptScope > 0 ? promptScope : 42) * selectedEngines.length * sampleSize;
    setStatus({
      status: "running",
      completedRuns: 0,
      totalRuns: totalEstRuns,
      percent: 5,
      currentPrompt: "Initializing stealth browser sessions...",
      currentEngine: "playwright",
    });

    try {
      const res = await fetch("/api/crawl/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          sampleSize,
          concurrency,
          engines: selectedEngines,
          promptLimit: promptScope > 0 ? promptScope : undefined,
          force: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const msg = err.error || "Failed to trigger crawl run";
        setErrorMessage(msg);
        setStatus((s) => ({ ...s, status: "failed", currentPrompt: msg }));
        setIsSubmitting(false);
      } else {
        const data = await res.json();
        setStatus((s) => ({
          ...s,
          batchId: data.batchId,
          status: "running",
          percent: 5,
          currentPrompt: "Initializing stealth crawler engines...",
          currentEngine: selectedEngines[0] || "system",
        }));
      }
    } catch (e) {
      const msg = (e as Error).message || "Network error occurred";
      setErrorMessage(msg);
      setStatus((s) => ({ ...s, status: "failed", currentPrompt: msg }));
      setIsSubmitting(false);
    }
  }

  function toggleEngine(id: string) {
    if (selectedEngines.includes(id)) {
      if (selectedEngines.length > 1) {
        setSelectedEngines(selectedEngines.filter((e) => e !== id));
      }
    } else {
      setSelectedEngines([...selectedEngines, id]);
    }
  }

  function selectAllEngines() {
    setSelectedEngines(AVAILABLE_ENGINES.map((e) => e.id));
  }

  function dismissError() {
    setErrorMessage(null);
    setStatus((s) => ({ ...s, status: "idle", currentPrompt: "Ready" }));
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95 space-x-1.5 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
        <span>Run Monte Carlo Audit</span>
      </button>

      {mounted && open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="crawl-modal-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && status.status !== "running") {
                  setOpen(false);
                }
              }}
              className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/85 backdrop-blur-md p-3 sm:p-6 flex min-h-full items-center justify-center animate-in fade-in duration-150"
            >
              {/* Modal Card with Strict Max-Height and Flex Column layout */}
              <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] overflow-hidden my-auto animate-in zoom-in-95 duration-150">
            {/* Sticky Header */}
            <div className="px-5 sm:px-6 py-4 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between shrink-0 sticky top-0 z-10 backdrop-blur">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </div>
                <div className="min-w-0 truncate">
                  <h3
                    id="crawl-modal-title"
                    className="text-sm font-bold text-white tracking-tight truncate"
                  >
                    Configure Monte Carlo Audit
                  </h3>
                  <div className="flex items-center space-x-1.5 text-xs text-slate-400 mt-0.5 truncate">
                    <span className="text-[11px] text-slate-400">Target:</span>
                    <span className="font-semibold text-slate-200 truncate">
                      {brandName || "Active Client"}
                    </span>
                    {brandDomain && (
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-950/90 px-1.5 py-0.2 rounded border border-sky-800/60 truncate">
                        {brandDomain}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0 ml-3">
                <span className="hidden sm:inline text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/60">
                  ESC
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={status.status === "running"}
                  aria-label="Close dialog"
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-slate-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Modal Body */}
            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
              {/* Dismissable Error Alert Banner */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-200 flex items-start justify-between animate-in fade-in duration-200">
                  <div className="flex items-start space-x-2.5 min-w-0">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-bold block text-rose-300">
                        Audit Execution Error
                      </span>
                      <p className="text-[11px] text-rose-200 leading-relaxed mt-0.5 break-words">
                        {errorMessage}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={dismissError}
                    aria-label="Dismiss error banner"
                    className="p-1 rounded-md text-rose-400 hover:text-rose-100 hover:bg-rose-900/60 transition shrink-0 ml-2"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {status.status === "running" ? (
                /* Active Running Progress State */
                <div className="space-y-4 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-400 mr-2 shrink-0" />
                      Multi-Session Crawl in Progress...
                    </span>
                    <span className="font-mono font-bold text-sky-400 text-sm">
                      {status.percent}%
                    </span>
                  </div>

                  {/* Accessible Smooth Progress Bar */}
                  <div
                    role="progressbar"
                    aria-valuenow={status.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700/60"
                  >
                    <div
                      className="bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-400 h-2.5 rounded-full transition-all duration-500 ease-out shadow-sm shadow-sky-500/30"
                      style={{ width: `${Math.max(5, status.percent)}%` }}
                    />
                  </div>

                  {/* Terminal Execution Inspector */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2.5 font-mono shadow-inner">
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="flex items-center space-x-1.5">
                        <Terminal className="w-3 h-3 text-sky-400" />
                        <span>Active Engine:</span>
                      </span>
                      <span className="font-bold text-sky-300 uppercase px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800/60">
                        {status.currentEngine}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span>Iterations Processed:</span>
                      <span className="font-bold text-slate-200">
                        {status.completedRuns} / {status.totalRuns}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-300 leading-relaxed break-words">
                      <span className="text-emerald-400 font-bold mr-1.5">&gt;</span>
                      {status.currentPrompt}
                    </div>
                  </div>
                </div>
              ) : status.status === "completed" ? (
                /* Completed State */
                <div className="text-center py-6 space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-950/80 border border-emerald-600/50 flex items-center justify-center text-emerald-400 mx-auto shadow-lg shadow-emerald-500/10">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                  <h4 className="text-base font-bold text-white">
                    Monte Carlo Audit Successfully Completed!
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                    All reverse-RAG attribution citations, prominence ranks, and entity mentions have been persisted to SQLite.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        window.location.reload();
                      }}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 transition shadow-lg shadow-sky-500/20 focus:outline-none focus:ring-2 focus:ring-sky-400 active:scale-95"
                    >
                      Refresh & View Updated Metrics
                    </button>
                  </div>
                </div>
              ) : (
                /* Configuration Form State */
                <div className="space-y-4">
                  {/* Engine Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>Target AI Engines ({selectedEngines.length}/5)</span>
                      </label>
                      <button
                        type="button"
                        onClick={selectAllEngines}
                        className="text-[11px] text-sky-400 hover:text-sky-300 font-medium transition"
                      >
                        Select All
                      </button>
                    </div>

                    <div
                      className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                      role="group"
                      aria-label="Engine selection"
                    >
                      {AVAILABLE_ENGINES.map((engine) => {
                        const isSelected = selectedEngines.includes(engine.id);
                        return (
                          <button
                            key={engine.id}
                            type="button"
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Toggle engine ${engine.name}`}
                            onClick={() => toggleEngine(engine.id)}
                            className={`p-2.5 rounded-xl border text-left text-xs transition flex items-center justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                              isSelected
                                ? `${engine.borderActive} text-white shadow-xs`
                                : "border-slate-800 bg-slate-950/40 hover:border-slate-700 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center space-x-1.5">
                                <span
                                  className={`w-2 h-2 rounded-full ${engine.color} shrink-0`}
                                />
                                <span className="font-semibold truncate">
                                  {engine.name}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 block mt-0.5 pl-3.5 truncate">
                                {engine.tag}
                              </span>
                            </div>
                            <span
                              className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition ${
                                isSelected
                                  ? "border-sky-500 bg-sky-500 text-slate-950 font-bold"
                                  : "border-slate-700 bg-slate-900"
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Prompt Scope Selector */}
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                        <span>Prompt Scope</span>
                      </span>
                      <span className="font-mono font-bold text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded text-xs border border-sky-800/60">
                        {promptScope === 0 ? "All Prompts (42)" : `${promptScope} Prompts`}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-0.5">
                      {[
                        { label: "10 Prompts", value: 10, desc: "Quick Scan" },
                        { label: "30 Prompts", value: 30, desc: "Standard Audit" },
                        { label: "All Prompts", value: 0, desc: "Full Scope" },
                      ].map((scope) => (
                        <button
                          key={scope.value}
                          type="button"
                          onClick={() => setPromptScope(scope.value)}
                          className={`py-2 px-2.5 rounded-lg text-xs font-medium border text-center transition ${
                            promptScope === scope.value
                              ? "border-sky-500 bg-sky-950/70 text-sky-200 shadow-sm"
                              : "border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                          }`}
                        >
                          <div className="font-semibold">{scope.label}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{scope.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sampling Controls (Dual Cards) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Sample Size */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                          <Layers className="w-3.5 h-3.5 text-sky-400" />
                          <span>Sample Size (N)</span>
                        </span>
                        <span className="font-mono font-bold text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded text-xs border border-sky-800/60">
                          {sampleSize}x Runs
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="15"
                        value={sampleSize}
                        onChange={(e) => setSampleSize(Number(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-500 h-1.5 bg-slate-800 rounded-lg"
                        aria-label="Sample size iterations"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>1x (Speed)</span>
                        <span>5x (Standard)</span>
                        <span>15x (Deep)</span>
                      </div>
                    </div>

                    {/* Concurrency */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Concurrency</span>
                        </span>
                        <span className="font-mono font-bold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded text-xs border border-indigo-800/60">
                          {concurrency} Workers
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="4"
                        value={concurrency}
                        onChange={(e) => setConcurrency(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 h-1.5 bg-slate-800 rounded-lg"
                        aria-label="Concurrency workers"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>1 (Safe)</span>
                        <span>2 (Balanced)</span>
                        <span>4 (Max)</span>
                      </div>
                    </div>
                  </div>

                  {/* Stealth Architecture Guarantee Banner */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-300 flex items-start space-x-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-200 block">
                        100% Zero-Cost Local Stealth Headless
                      </span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Executes directly via local Playwright stealth browser contexts. Zero commercial API subscriptions required.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Footer */}
            {status.status !== "running" && status.status !== "completed" && (
              <div className="px-5 sm:px-6 py-3.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between shrink-0 sticky bottom-0 z-10 backdrop-blur">
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Estimated: ~{Math.round(((promptScope > 0 ? promptScope : 42) * selectedEngines.length * sampleSize * 0.4) / concurrency)}s multi-engine run
                </span>
                <div className="flex items-center space-x-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setErrorMessage(null);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800/70 transition focus:outline-none focus:ring-1 focus:ring-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleStartCrawl}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 transition shadow-lg shadow-sky-500/20 active:scale-95 flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>{isSubmitting ? "Starting..." : "Start Audit Run"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null}
    </>
  );
}

"use client";

import { useState, useEffect } from "react";
import {
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sliders,
  Cpu,
  Layers,
  Sparkles,
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
  { id: "perplexity", name: "Perplexity AI", tag: "Sonar / Live" },
  { id: "google_aio", name: "Google AI Overviews", tag: "AIO Mode" },
  { id: "copilot", name: "Microsoft Copilot", tag: "Bing Grounded" },
  { id: "gemini", name: "Google Gemini", tag: "Search Tools" },
  { id: "chatgpt", name: "ChatGPT Search", tag: "Web Browsing" },
];

export function CrawlModal({
  brandId,
  brandName,
}: {
  brandId?: string;
  brandName?: string;
}) {
  const [open, setOpen] = useState(false);
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Poll status while open and running
  useEffect(() => {
    let interval: any;
    if (open && status.status === "running") {
      interval = setInterval(async () => {
        try {
          const res = await fetch("/api/crawl/status");
          if (res.ok) {
            const data = await res.json();
            setStatus(data);
            if (data.status === "completed" || data.status === "failed") {
              setIsSubmitting(false);
            }
          }
        } catch {}
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [open, status.status]);

  async function handleStartCrawl() {
    setIsSubmitting(true);
    setStatus({
      status: "running",
      completedRuns: 0,
      totalRuns: 10,
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
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to trigger crawl run");
        setStatus((s) => ({ ...s, status: "failed", currentPrompt: err.error }));
        setIsSubmitting(false);
      }
    } catch (e) {
      setStatus((s) => ({ ...s, status: "failed", currentPrompt: (e as Error).message }));
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95 space-x-1.5 border border-slate-700"
      >
        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
        <span>Run Monte Carlo Audit</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center text-white">
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">
                    Monte Carlo Crawl Orchestrator
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Target: {brandName || "Active Client"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {status.status === "running" ? (
                /* Active Running Progress State */
                <div className="space-y-4 py-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 flex items-center">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-600 mr-2" />
                      Multi-Session Crawl in Progress
                    </span>
                    <span className="font-mono font-bold text-sky-600 text-sm">
                      {status.percent}%
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-sky-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, status.percent)}%` }}
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between text-slate-500 text-[11px]">
                      <span>Current Engine:</span>
                      <span className="font-bold text-slate-800 uppercase">
                        {status.currentEngine}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-500 text-[11px]">
                      <span>Completed Iterations:</span>
                      <span className="font-bold text-slate-800">
                        {status.completedRuns} / {status.totalRuns}
                      </span>
                    </div>
                    <div className="text-slate-600 text-[11px] truncate pt-1 border-t border-slate-200">
                      &gt; {status.currentPrompt}
                    </div>
                  </div>
                </div>
              ) : status.status === "completed" ? (
                /* Completed State */
                <div className="text-center py-6 space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto animate-bounce" />
                  <h4 className="text-base font-bold text-slate-900">
                    Audit Run Successfully Completed!
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    All reverse-RAG attribution citations, prominence scores, and stance classifications have been saved to SQLite.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setOpen(false);
                        window.location.reload();
                      }}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition"
                    >
                      Refresh & View Updated Metrics
                    </button>
                  </div>
                </div>
              ) : (
                /* Configuration Form State */
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      Active Generative Engines
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {AVAILABLE_ENGINES.map((engine) => {
                        const isSelected = selectedEngines.includes(engine.id);
                        return (
                          <button
                            key={engine.id}
                            type="button"
                            onClick={() => toggleEngine(engine.id)}
                            className={`p-2.5 rounded-xl border text-left text-xs transition flex items-center justify-between ${
                              isSelected
                                ? "border-sky-500 bg-sky-50 text-slate-900 font-semibold"
                                : "border-slate-200 hover:border-slate-300 text-slate-600"
                            }`}
                          >
                            <div>
                              <div>{engine.name}</div>
                              <span className="text-[10px] text-slate-400 font-normal">
                                {engine.tag}
                              </span>
                            </div>
                            <span
                              className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                isSelected
                                  ? "border-sky-600 bg-sky-600 text-white text-[9px]"
                                  : "border-slate-300"
                              }`}
                            >
                              {isSelected && "✓"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="font-semibold text-slate-700">
                          Sample Size (N)
                        </span>
                        <span className="font-mono font-bold text-sky-600 text-sm">
                          {sampleSize}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="15"
                        value={sampleSize}
                        onChange={(e) => setSampleSize(Number(e.target.value))}
                        className="w-full accent-sky-600"
                      />
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Monte Carlo variance runs
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="font-semibold text-slate-700">
                          Concurrency
                        </span>
                        <span className="font-mono font-bold text-sky-600 text-sm">
                          {concurrency} Contexts
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="4"
                        value={concurrency}
                        onChange={(e) => setConcurrency(Number(e.target.value))}
                        className="w-full accent-sky-600"
                      />
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Parallel stealth workers
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-100 text-[11px] text-sky-800 flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                    <span>
                      Runs via 100% Zero-Cost Local Headless Browser (no paid API keys required).
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {status.status !== "running" && status.status !== "completed" && (
              <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-200/60 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleStartCrawl}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95 flex items-center space-x-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Audit Run</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

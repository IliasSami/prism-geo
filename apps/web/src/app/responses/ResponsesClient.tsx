"use client";

import { useState, useMemo } from "react";
import {
  MessageSquare,
  Clock,
  Cpu,
  GitBranch,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  X,
  FileText,
} from "lucide-react";

interface PromptRunItem {
  id: string;
  batchId: string;
  promptId: string;
  engine: string;
  runIndex: number;
  responseText: string;
  subQueriesJson: string;
  promptTokens: number | null;
  executionMs: number;
  createdAt: string;
  queryText?: string;
  intentType?: string;
}

export function ResponsesClient({
  runs,
}: {
  runs: PromptRunItem[];
}) {
  const [selectedEngine, setSelectedEngine] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (selectedEngine !== "all" && r.engine !== selectedEngine) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesQuery = r.queryText ? r.queryText.toLowerCase().includes(q) : false;
        const matchesResp = r.responseText.toLowerCase().includes(q);
        if (!matchesQuery && !matchesResp) return false;
      }
      return true;
    });
  }, [runs, selectedEngine, searchQuery]);

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  }

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getEngineBadge(engine: string) {
    const norm = engine.toLowerCase();
    if (norm.includes("perplexity")) {
      return {
        label: "Perplexity AI",
        classes: "bg-teal-50 text-teal-800 border-teal-200/80",
        dot: "bg-teal-500",
      };
    }
    if (norm.includes("google") || norm.includes("aio")) {
      return {
        label: "Google AI Overviews",
        classes: "bg-blue-50 text-blue-800 border-blue-200/80",
        dot: "bg-blue-500",
      };
    }
    if (norm.includes("copilot")) {
      return {
        label: "Microsoft Copilot",
        classes: "bg-violet-50 text-violet-800 border-violet-200/80",
        dot: "bg-violet-500",
      };
    }
    if (norm.includes("gemini")) {
      return {
        label: "Google Gemini",
        classes: "bg-indigo-50 text-indigo-800 border-indigo-200/80",
        dot: "bg-indigo-500",
      };
    }
    if (norm.includes("chatgpt")) {
      return {
        label: "ChatGPT Search",
        classes: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
        dot: "bg-emerald-500",
      };
    }
    return {
      label: engine.toUpperCase(),
      classes: "bg-slate-100 text-slate-800 border-slate-200",
      dot: "bg-slate-500",
    };
  }

  return (
    <div className="space-y-4">
      {/* Search & Engine Filter Controls */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search prompt query or output text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Engine Pills */}
        <div className="flex items-center overflow-x-auto gap-1 text-xs pb-1 sm:pb-0">
          {[
            { id: "all", label: "All Engines" },
            { id: "perplexity", label: "Perplexity" },
            { id: "google_aio", label: "Google AIO" },
            { id: "copilot", label: "Copilot" },
            { id: "gemini", label: "Gemini" },
            { id: "chatgpt", label: "ChatGPT" },
          ].map((eng) => (
            <button
              key={eng.id}
              type="button"
              onClick={() => setSelectedEngine(eng.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${
                selectedEngine === eng.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              {eng.label}
            </button>
          ))}
        </div>
      </div>

      {/* Response Cards Feed */}
      {filteredRuns.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500 space-y-2">
          <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="font-semibold text-slate-700">No responses match the selected filters.</p>
          <p className="text-[11px] text-slate-400">
            Clear search query or switch engine view to see recorded outputs.
          </p>
        </div>
      ) : (
        filteredRuns.map((run) => {
          let subQueries: string[] = [];
          try {
            subQueries = JSON.parse(run.subQueriesJson || "[]");
          } catch {}

          const engineMeta = getEngineBadge(run.engine);
          const isExpanded = expandedIds.has(run.id);
          const isCopied = copiedId === run.id;
          const wordCount = run.responseText.trim().split(/\s+/).length;
          const isLongText = run.responseText.length > 350;

          return (
            <div
              key={run.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-3 transition hover:border-slate-300"
            >
              {/* Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 text-xs gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="font-bold text-slate-900 truncate">
                    {run.queryText || "Search Query"}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-50 text-sky-700 border border-sky-200/60 shrink-0 uppercase">
                    {run.intentType || "general"}
                  </span>
                </div>

                <div className="flex items-center space-x-2.5 shrink-0">
                  {/* Engine Badge */}
                  <div
                    className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-semibold font-mono ${engineMeta.classes}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${engineMeta.dot}`} />
                    <span>{engineMeta.label}</span>
                  </div>

                  <span className="flex items-center text-slate-400 font-mono text-[11px]">
                    <Clock className="w-3 h-3 mr-1" />
                    {run.executionMs}ms
                  </span>

                  <button
                    type="button"
                    onClick={() => handleCopy(run.id, run.responseText)}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    title="Copy full response"
                  >
                    {isCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Response Text with Improved Readability & Collapsible View */}
              <div className="relative">
                <div
                  className={`text-sm text-slate-800 leading-relaxed bg-slate-50/80 p-4 rounded-xl font-sans whitespace-pre-wrap border border-slate-100 transition-all ${
                    !isExpanded && isLongText ? "max-h-36 overflow-hidden relative" : ""
                  }`}
                >
                  {run.responseText}
                  {!isExpanded && isLongText && (
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none rounded-b-xl" />
                  )}
                </div>

                {isLongText && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(run.id)}
                    className="mt-1.5 inline-flex items-center space-x-1 text-xs font-semibold text-sky-600 hover:text-sky-800 transition"
                  >
                    {isExpanded ? (
                      <>
                        <span>Show Less</span>
                        <ChevronUp className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        <span>Show Full Response ({wordCount} words)</span>
                        <ChevronDown className="w-3 h-3" />
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Sub-Queries (Query Fan-Out) */}
              {subQueries.length > 0 && (
                <div className="p-3.5 rounded-xl bg-sky-50/60 border border-sky-100 text-xs space-y-2">
                  <div className="flex items-center space-x-1.5 text-sky-950 font-bold text-[11px]">
                    <GitBranch className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span>Agentic RAG Sub-Queries Triggered ({subQueries.length} Fan-Out Paths):</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {subQueries.map((sq, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-mono bg-white text-slate-800 border border-sky-200/70 shadow-2xs"
                      >
                        <span className="text-sky-600 font-bold text-[10px]">#{idx + 1}</span>
                        <span>"{sq}"</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

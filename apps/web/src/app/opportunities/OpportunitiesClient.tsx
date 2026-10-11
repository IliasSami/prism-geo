"use client";

import { useState, useMemo } from "react";
import {
  Lightbulb,
  Target,
  ArrowRight,
  CheckCircle2,
  Copy,
  Check,
  Filter,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

interface OpportunityItem {
  id: string;
  brandId: string;
  title: string;
  subQueryTarget: string;
  gapType: string;
  recommendedAction: string;
  estimatedImpact: string;
  status: string;
  createdAt: string;
}

export function OpportunitiesClient({
  opportunities,
}: {
  opportunities: OpportunityItem[];
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterImpact, setFilterImpact] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    return opportunities.filter((opp) => {
      if (filterImpact !== "all") {
        const impLower = opp.estimatedImpact.toLowerCase();
        if (filterImpact === "high" && !impLower.includes("high") && !impLower.includes("critical")) return false;
        if (filterImpact === "medium" && !impLower.includes("medium")) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = opp.title.toLowerCase().includes(q);
        const matchesTarget = opp.subQueryTarget.toLowerCase().includes(q);
        const matchesAction = opp.recommendedAction.toLowerCase().includes(q);
        if (!matchesTitle && !matchesTarget && !matchesAction) return false;
      }
      return true;
    });
  }, [opportunities, filterImpact, searchQuery]);

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getImpactBadge(impactStr: string) {
    const norm = impactStr.toLowerCase();
    if (norm.includes("high") || norm.includes("critical")) {
      return {
        label: impactStr,
        classes: "bg-rose-50 text-rose-800 border-rose-200",
        icon: Zap,
      };
    }
    if (norm.includes("medium")) {
      return {
        label: impactStr,
        classes: "bg-amber-50 text-amber-800 border-amber-200",
        icon: Sparkles,
      };
    }
    return {
      label: impactStr,
      classes: "bg-sky-50 text-sky-800 border-sky-200",
      icon: Lightbulb,
    };
  }

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Filter Impact:
          </span>
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs">
            {[
              { id: "all", label: "All Gaps" },
              { id: "high", label: "High Impact" },
              { id: "medium", label: "Medium Impact" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterImpact(f.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                  filterImpact === f.id
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-xs font-mono text-slate-500">
          Showing {filtered.length} of {opportunities.length} opportunities
        </span>
      </div>

      {/* Grid of Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map((opp) => {
          const impactMeta = getImpactBadge(opp.estimatedImpact);
          const isCopied = copiedId === opp.id;

          return (
            <div
              key={opp.id}
              className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition hover:border-slate-300 space-y-4"
            >
              <div>
                {/* Meta Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200 truncate">
                    <Target className="w-3 h-3 mr-1 text-sky-600 shrink-0" />
                    <span className="truncate">Target: {opp.subQueryTarget}</span>
                  </span>

                  <span
                    className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase shrink-0 ${impactMeta.classes}`}
                  >
                    <impactMeta.icon className="w-3 h-3" />
                    <span>{impactMeta.label}</span>
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-sm font-bold text-slate-900 mb-2 leading-snug">
                  {opp.title}
                </h3>

                {/* Recommended Action Box */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs text-slate-700 leading-relaxed space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <span>Reverse-RAG Content Strategy</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(opp.id, opp.recommendedAction)}
                      className="inline-flex items-center space-x-1 text-sky-600 hover:text-sky-800 font-semibold lowercase transition"
                      title="Copy action to clipboard"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-700">copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-400" />
                          <span>copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-slate-600">{opp.recommendedAction}</p>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-medium capitalize">
                  Category: {opp.gapType.replace(/_/g, " ")}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {opp.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

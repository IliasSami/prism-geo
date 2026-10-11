"use client";

import { useState, useMemo } from "react";
import {
  Quote,
  ExternalLink,
  ShieldCheck,
  FileText,
  Download,
  Search,
  Filter,
  Copy,
  Check,
  X,
  Sparkles,
} from "lucide-react";

interface CitationItem {
  id: string;
  domain: string;
  url: string;
  title: string | null;
  snippet: string | null;
  anchorText: string | null;
  rank: number;
  isBrandDomain: boolean;
  isCompetitorDomain: boolean;
  createdAt: string;
}

interface ChunkItem {
  id: string;
  sourceUrl: string;
  matchedChunkText: string;
  similarityScore: number;
  selfContainedScore?: number;
  createdAt: string;
}

export function CitationsClient({
  brandId,
  brandDomain,
  citations,
  chunks,
}: {
  brandId?: string;
  brandDomain?: string;
  citations: CitationItem[];
  chunks: ChunkItem[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "brand" | "competitor" | "editorial">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const brandCount = citations.filter((c) => c.isBrandDomain).length;
  const compCount = citations.filter((c) => c.isCompetitorDomain).length;
  const editorialCount = citations.length - brandCount - compCount;

  // Filter citations
  const filteredCitations = useMemo(() => {
    return citations.filter((c) => {
      // Type filter
      if (typeFilter === "brand" && !c.isBrandDomain) return false;
      if (typeFilter === "competitor" && !c.isCompetitorDomain) return false;
      if (typeFilter === "editorial" && (c.isBrandDomain || c.isCompetitorDomain)) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesDomain = c.domain.toLowerCase().includes(q);
        const matchesUrl = c.url.toLowerCase().includes(q);
        const matchesTitle = c.title ? c.title.toLowerCase().includes(q) : false;
        if (!matchesDomain && !matchesUrl && !matchesTitle) return false;
      }
      return true;
    });
  }, [citations, typeFilter, searchQuery]);

  function handleCopyChunk(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "brand" ? "all" : "brand")}
          className={`p-4 rounded-xl border text-left transition ${
            typeFilter === "brand"
              ? "border-sky-500 bg-sky-50/70 ring-2 ring-sky-500/20 shadow-xs"
              : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
          }`}
        >
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Brand Citations
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-sky-600 font-mono">
              {brandCount}
            </span>
            <span className="text-xs text-slate-400">
              ({citations.length > 0 ? Math.round((brandCount / citations.length) * 100) : 0}%)
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Grounded on official domain {typeFilter === "brand" ? "• Filter Active" : ""}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "competitor" ? "all" : "competitor")}
          className={`p-4 rounded-xl border text-left transition ${
            typeFilter === "competitor"
              ? "border-slate-700 bg-slate-50 ring-2 ring-slate-400/20 shadow-xs"
              : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
          }`}
        >
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Competitor Citations
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-slate-800 font-mono">
              {compCount}
            </span>
            <span className="text-xs text-slate-400">
              ({citations.length > 0 ? Math.round((compCount / citations.length) * 100) : 0}%)
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Rival platforms {typeFilter === "competitor" ? "• Filter Active" : ""}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter(typeFilter === "editorial" ? "all" : "editorial")}
          className={`p-4 rounded-xl border text-left transition ${
            typeFilter === "editorial"
              ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-500/20 shadow-xs"
              : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
          }`}
        >
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Editorial & UGC Dilution
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-amber-600 font-mono">
              {editorialCount}
            </span>
            <span className="text-xs text-slate-400">
              ({citations.length > 0 ? Math.round((editorialCount / citations.length) * 100) : 0}%)
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Reddit, G2, Capterra {typeFilter === "editorial" ? "• Filter Active" : ""}
          </span>
        </button>
      </div>

      {/* Citations Table Card */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        {/* Table Filter Controls Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Quote className="w-4 h-4 text-sky-600 shrink-0" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Verified Footnote Citations ({filteredCitations.length} of {citations.length})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter domain or URL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 w-48 sm:w-56 font-mono"
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

            {/* Entity Type Filter Tabs */}
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "brand", label: "Brand" },
                  { id: "competitor", label: "Competitor" },
                  { id: "editorial", label: "Editorial" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                    typeFilter === tab.id
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {(searchQuery || typeFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("all");
                }}
                className="text-[11px] text-sky-600 hover:text-sky-800 font-semibold px-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Table or Empty State */}
        {filteredCitations.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 space-y-2">
            <Quote className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-700">No citations match the selected filters.</p>
            <p className="text-[11px] text-slate-400">
              Try adjusting your search query or reset type filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-600 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Cited Domain</th>
                  <th className="py-3 px-4">Destination URL</th>
                  <th className="py-3 px-4">Entity Type</th>
                  <th className="py-3 px-4">Attribution Rank</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCitations.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-bold text-slate-900 flex items-center">
                      {c.isBrandDomain && (
                        <ShieldCheck className="w-4 h-4 text-sky-600 mr-1.5 shrink-0" />
                      )}
                      <span>{c.domain}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 max-w-sm truncate">
                      {c.url}
                    </td>
                    <td className="py-3 px-4">
                      {c.isBrandDomain ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
                          Target Brand
                        </span>
                      ) : c.isCompetitorDomain ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                          Competitor
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200/60">
                          Editorial / UGC
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">#{c.rank}</td>
                    <td className="py-3 px-4">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-sky-600 hover:text-sky-700 font-medium"
                      >
                        Visit <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reverse-RAG Grounded Passage Chunks */}
      {chunks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-sky-600 shrink-0" />
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Grounded Reverse-RAG Passage Chunks ({chunks.length})
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Cosine TF-IDF Vector Matched
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {chunks.map((chunk, i) => {
              const simPercent = Math.round(chunk.similarityScore * 100);
              const isCopied = copiedId === chunk.id;

              return (
                <div key={chunk.id || i} className="p-4 space-y-2 hover:bg-slate-50/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <a
                      href={chunk.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-sky-700 hover:underline font-mono truncate max-w-md flex items-center"
                    >
                      <span className="truncate">{chunk.sourceUrl}</span>
                      <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
                    </a>

                    <div className="flex items-center space-x-2 shrink-0">
                      <span
                        className={`inline-flex items-center text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                          simPercent >= 80
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : simPercent >= 60
                            ? "bg-sky-50 text-sky-700 border-sky-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        Similarity: {simPercent}%
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCopyChunk(chunk.id, chunk.matchedChunkText)}
                        className="inline-flex items-center space-x-1 px-2 py-0.5 text-[10px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition"
                        title="Copy chunk text"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-500" />
                            <span>Copy Chunk</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-lg border border-slate-100 font-mono leading-relaxed whitespace-pre-wrap">
                    "{chunk.matchedChunkText}"
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

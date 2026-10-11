"use client";

import { useState, useMemo } from "react";
import {
  Compass,
  Search,
  Filter,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  User,
  X,
  Sparkles,
} from "lucide-react";

interface PromptItem {
  id: string;
  brandId: string;
  queryText: string;
  intentType: string;
  personaDimension: string;
  active: boolean;
  createdAt: string;
}

const ITEMS_PER_PAGE = 20;

export function PromptsClient({
  prompts,
}: {
  prompts: PromptItem[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIntent, setSelectedIntent] = useState<string>("all");
  const [selectedPersona, setSelectedPersona] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Extract unique intents & personas
  const uniqueIntents = useMemo(() => {
    return Array.from(new Set(prompts.map((p) => p.intentType))).filter(Boolean);
  }, [prompts]);

  const uniquePersonas = useMemo(() => {
    return Array.from(new Set(prompts.map((p) => p.personaDimension))).filter(Boolean);
  }, [prompts]);

  // Filtered prompts
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (selectedIntent !== "all" && p.intentType !== selectedIntent) return false;
      if (selectedPersona !== "all" && p.personaDimension !== selectedPersona) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!p.queryText.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [prompts, selectedIntent, selectedPersona, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredPrompts.length / ITEMS_PER_PAGE));
  const currentPrompts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredPrompts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPrompts, currentPage]);

  function handleFilterChange(newIntent: string, newPersona: string, newSearch: string) {
    setSelectedIntent(newIntent);
    setSelectedPersona(newPersona);
    setSearchQuery(newSearch);
    setCurrentPage(1);
  }

  function getIntentBadge(intent: string) {
    const norm = intent.toLowerCase();
    if (norm.includes("commercial")) {
      return {
        label: intent,
        classes: "bg-emerald-50 text-emerald-800 border-emerald-200",
      };
    }
    if (norm.includes("comparison") || norm.includes("alternative")) {
      return {
        label: intent,
        classes: "bg-indigo-50 text-indigo-800 border-indigo-200",
      };
    }
    if (norm.includes("dilemma") || norm.includes("margin") || norm.includes("nda")) {
      return {
        label: intent,
        classes: "bg-amber-50 text-amber-800 border-amber-200",
      };
    }
    if (norm.includes("informational") || norm.includes("pain")) {
      return {
        label: intent,
        classes: "bg-sky-50 text-sky-800 border-sky-200",
      };
    }
    if (norm.includes("technical") || norm.includes("integration")) {
      return {
        label: intent,
        classes: "bg-purple-50 text-purple-800 border-purple-200",
      };
    }
    return {
      label: intent,
      classes: "bg-slate-100 text-slate-700 border-slate-200",
    };
  }

  function formatPersona(p: string) {
    return p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search prompt scenarios or buyer dilemmas..."
            value={searchQuery}
            onChange={(e) => handleFilterChange(selectedIntent, selectedPersona, e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => handleFilterChange(selectedIntent, selectedPersona, "")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Intent Filter */}
          <select
            value={selectedIntent}
            onChange={(e) => handleFilterChange(e.target.value, selectedPersona, searchQuery)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">All Intent Types</option>
            {uniqueIntents.map((it) => (
              <option key={it} value={it}>
                {it.replace(/_/g, " ").toUpperCase()}
              </option>
            ))}
          </select>

          {/* Persona Filter */}
          <select
            value={selectedPersona}
            onChange={(e) => handleFilterChange(selectedIntent, e.target.value, searchQuery)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">All Buyer Personas</option>
            {uniquePersonas.map((pr) => (
              <option key={pr} value={pr}>
                {formatPersona(pr)}
              </option>
            ))}
          </select>

          {(searchQuery || selectedIntent !== "all" || selectedPersona !== "all") && (
            <button
              type="button"
              onClick={() => handleFilterChange("all", "all", "")}
              className="text-xs text-sky-600 hover:text-sky-800 font-semibold px-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Prompts Table Card */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-sky-600 shrink-0" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Calibrated Prompts Matrix ({filteredPrompts.length} of {prompts.length})
            </span>
          </div>
          <span className="text-xs font-mono text-emerald-600 font-semibold flex items-center">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            100% Active in Crawl Batch
          </span>
        </div>

        {filteredPrompts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 space-y-2">
            <Compass className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-700">No prompts match your search criteria.</p>
            <p className="text-[11px] text-slate-400">
              Clear filters or search query to browse calibrated scenarios.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-600 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4 w-12 text-slate-400">#</th>
                  <th className="py-3 px-4">Search Prompt Text</th>
                  <th className="py-3 px-4">Search Intent Taxonomy</th>
                  <th className="py-3 px-4">Target ICP Persona</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentPrompts.map((p, idx) => {
                  const intentMeta = getIntentBadge(p.intentType);
                  const rowNumber = (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                        {rowNumber}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 max-w-lg leading-relaxed">
                        "{p.queryText}"
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${intentMeta.classes}`}
                        >
                          {p.intentType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{formatPersona(p.personaDimension)}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1 shrink-0" />
                          <span>Active</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {filteredPrompts.length > ITEMS_PER_PAGE && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="text-slate-500 font-mono text-[11px]">
              Showing{" "}
              <span className="font-bold text-slate-800">
                {(currentPage - 1) * ITEMS_PER_PAGE + 1}
              </span>{" "}
              to{" "}
              <span className="font-bold text-slate-800">
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredPrompts.length)}
              </span>{" "}
              of <span className="font-bold text-slate-800">{filteredPrompts.length}</span> prompts
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 transition"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 font-mono font-bold text-slate-800 bg-white rounded-lg border border-slate-200">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 transition"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

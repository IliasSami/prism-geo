"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Search, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, cn, inputClass, td, th, type Tone } from "@/components/ui";

interface CitationItem {
  id: string;
  domain: string;
  url: string;
  title: string | null;
  rank: number;
  isBrandDomain: boolean;
  isCompetitorDomain: boolean;
}

interface ChunkItem {
  id: string;
  sourceUrl: string;
  matchedChunkText: string;
  similarityScore: number;
}

type SourceType = "all" | "brand" | "competitor" | "editorial";

const TYPE_META: Record<Exclude<SourceType, "all">, { label: string; tone: Tone; hint: string }> = {
  brand: { label: "Your site", tone: "accent", hint: "Citations of your own domain" },
  competitor: { label: "Competitors", tone: "neutral", hint: "Citations of a tracked competitor" },
  editorial: { label: "Third-party", tone: "warning", hint: "Reviews, blogs, directories and forums" },
};

const kindOf = (c: CitationItem): Exclude<SourceType, "all"> => (c.isBrandDomain ? "brand" : c.isCompetitorDomain ? "competitor" : "editorial");

function matchTone(score: number): Tone {
  return score >= 0.8 ? "success" : score >= 0.6 ? "info" : "warning";
}

function Pager({ label, page, pages, onPage }: { label: string; page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={`${label} pagination`} className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
      <span className="tabular">
        {label} · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

/**
 * Cited sources, filtered and paginated on the server (type, search and pages live in the URL)
 * so every stored citation and matched passage is reachable however many audits have run.
 */
export function CitationsClient({
  citations,
  counts,
  type,
  query,
  page,
  totalPages,
  filteredTotal,
  chunks,
  passagePage,
  passagePages,
  passageTotal,
}: {
  citations: CitationItem[];
  counts: { total: number; brand: number; competitor: number };
  type: SourceType;
  query: string;
  page: number;
  totalPages: number;
  filteredTotal: number;
  chunks: ChunkItem[];
  passagePage: number;
  passagePages: number;
  passageTotal: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState(query);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const go = (next: { type?: SourceType; q?: string; page?: number; pp?: number }) => {
    const params = new URLSearchParams();
    const t = next.type ?? type;
    const q = next.q ?? searchQuery;
    if (t !== "all") params.set("type", t);
    if (q.trim()) params.set("q", q.trim());
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    const pp = next.pp ?? passagePage;
    if (pp > 1) params.set("pp", String(pp));
    router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const summary: Record<Exclude<SourceType, "all">, number> = {
    brand: counts.brand,
    competitor: counts.competitor,
    editorial: counts.total - counts.brand - counts.competitor,
  };
  const share = (n: number) => (counts.total > 0 ? Math.round((n / counts.total) * 100) : 0);

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-6">
      {/* Summary chips double as filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 stagger" role="group" aria-label="Filter by source type">
        {(Object.keys(TYPE_META) as Array<Exclude<SourceType, "all">>).map((k) => {
          const active = type === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => go({ type: active ? "all" : k, page: 1 })}
              className={cn(
                "rounded-xl border bg-white p-4 text-left shadow-card transition duration-150 hover:-translate-y-0.5 hover:shadow-pop active:scale-[0.99]",
                active ? "border-accent-500 ring-2 ring-accent-500/20" : "border-zinc-200 hover:border-zinc-300"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-500">{TYPE_META[k].label}</span>
                {active && <Badge tone="accent">Filtered</Badge>}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular">{summary[k]}</span>
                <span className="text-sm text-zinc-500 tabular">{share(summary[k])}% of citations</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">{TYPE_META[k].hint}</div>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden animate-fade-up">
        <CardHeader
          title="Cited pages"
          description={
            <span className="tabular">
              {filteredTotal === counts.total ? `${counts.total} citations` : `${filteredTotal} of ${counts.total} citations`}
            </span>
          }
          actions={
            <>
              <form
                role="search"
                className="relative w-full sm:w-64"
                onSubmit={(e) => {
                  e.preventDefault();
                  go({ q: searchQuery, page: 1 });
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="search"
                  aria-label="Search domain, URL or title"
                  placeholder="Search domain, URL or title"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(inputClass, "pl-9 pr-9")}
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchQuery("");
                      go({ q: "", page: 1 });
                    }}
                    className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:text-zinc-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>
              {(query || type !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    go({ type: "all", q: "", page: 1 });
                  }}
                >
                  Reset
                </Button>
              )}
            </>
          }
        />

        {citations.length === 0 ? (
          <EmptyState icon={<Search className="h-5 w-5" />} title="No citations match" description="Try another filter or clear the search." />
        ) : (
          <>
            <table className="hidden w-full text-left text-base md:table">
              <thead>
                <tr>
                  <th className={th}>Page</th>
                  <th className={th}>Type</th>
                  <th className={cn(th, "text-right")}>Position</th>
                  <th className={cn(th, "w-12")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {citations.map((c) => {
                  const meta = TYPE_META[kindOf(c)];
                  return (
                    <tr key={c.id} className="transition-colors duration-150 hover:bg-zinc-50">
                      <td className={cn(td, "max-w-xl")}>
                        <div className="font-medium text-zinc-900">{c.domain}</div>
                        {c.title && c.title !== c.domain && <div className="truncate text-sm text-zinc-600">{c.title}</div>}
                        <div className="truncate font-mono text-xs text-zinc-500">{c.url}</div>
                      </td>
                      <td className={td}>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className={cn(td, "text-right tabular text-zinc-700")}>#{c.rank}</td>
                      <td className={td}>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${c.domain} in a new tab`}
                          title="Open in a new tab"
                          className="tap-target inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-zinc-100 md:hidden">
              {citations.map((c) => {
                const meta = TYPE_META[kindOf(c)];
                return (
                  <li key={c.id}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 transition-colors hover:bg-zinc-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-zinc-900">{c.domain}</span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      {c.title && c.title !== c.domain && <div className="mt-0.5 line-clamp-2 text-sm text-zinc-600">{c.title}</div>}
                      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="shrink-0 tabular">Position #{c.rank}</span>
                        <span className="min-w-0 truncate font-mono">{c.url}</span>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Pager label={`${filteredTotal} cited pages`} page={page} pages={totalPages} onPage={(p) => go({ page: p })} />
      </Card>

      {passageTotal > 0 && (
        <Card className="overflow-hidden animate-fade-up">
          <CardHeader
            title="Passages the answer reused"
            description={`${passageTotal} passages from cited pages that closely match what the engine wrote, strongest match first.`}
          />
          <ul className="divide-y divide-zinc-100">
            {chunks.map((chunk) => {
              const strength = Math.round(chunk.similarityScore * 100);
              return (
                <li key={chunk.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900">{chunk.sourceUrl}</span>
                        <span className="block truncate text-sm text-zinc-500">{chunk.matchedChunkText}</span>
                      </span>
                      <Badge tone={matchTone(chunk.similarityScore)}>
                        <span className="hidden sm:inline">Match strength</span> {strength}%
                      </Badge>
                    </summary>
                    <div className="space-y-3 px-4 pb-4 sm:pl-11 animate-fade-in">
                      <blockquote className="whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-base leading-relaxed text-zinc-800">
                        {chunk.matchedChunkText}
                      </blockquote>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => copy(chunk.id, chunk.matchedChunkText)}>
                          {copiedId === chunk.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          {copiedId === chunk.id ? "Copied" : "Copy passage"}
                        </Button>
                        <a
                          href={chunk.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tap-target inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          <ExternalLink className="h-4 w-4" /> Open page
                        </a>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <Pager label={`${passageTotal} passages`} page={passagePage} pages={passagePages} onPage={(p) => go({ pp: p })} />
        </Card>
      )}
    </div>
  );
}

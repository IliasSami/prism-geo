"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Search, X } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, EntityBadge, cn, engineLabel, entityOf, inputClass, td, th } from "@/components/ui";
import { Pager, SegmentLinks } from "@/components/insights/parts";
import { copyText } from "@/components/clipboard";

export type View = "pages" | "domains" | "passages";
export type SourceType = "all" | "brand" | "competitor" | "editorial";

export interface SourceRow {
  key: string;
  domain: string;
  url: string;
  title: string | null;
  isBrand: boolean;
  isCompetitor: boolean;
  answers: number;
  pages: number;
  best: number;
  engines: string[];
}

interface ChunkItem {
  id: string;
  sourceUrl: string;
  matchedChunkText: string;
  similarityScore: number;
}

const TYPE_LABEL: Record<SourceType, string> = { all: "All", brand: "Your site", competitor: "Competitors", editorial: "Third-party" };

/**
 * Cited pages or sites, grouped, filtered and paginated on the server (view, type, search and
 * page live in the URL), plus the passages the answers reused.
 */
export function CitationsClient({
  view,
  rows,
  typeCounts,
  citationTotal,
  type,
  query,
  page,
  totalPages,
  chunks,
  passagePage,
  passagePages,
  passageTotal,
}: {
  view: View;
  rows: SourceRow[];
  typeCounts: Record<SourceType, number>;
  citationTotal: number;
  type: SourceType;
  query: string;
  page: number;
  totalPages: number;
  chunks: ChunkItem[];
  passagePage: number;
  passagePages: number;
  passageTotal: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState(query);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);

  const href = (next: { view?: View; type?: SourceType; q?: string; page?: number; pp?: number }) => {
    const params = new URLSearchParams();
    const v = next.view ?? view;
    const t = next.type ?? type;
    const q = next.q ?? query;
    if (v !== "pages") params.set("view", v);
    if (v !== "passages") {
      if (t !== "all") params.set("type", t);
      if (q.trim()) params.set("q", q.trim());
      if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    } else if ((next.pp ?? 1) > 1) params.set("pp", String(next.pp));
    return `${pathname}${params.size ? `?${params}` : ""}`;
  };

  const copy = async (id: string, text: string) => {
    const ok = await copyText(text);
    setCopied({ id, ok });
    setTimeout(() => setCopied(null), ok ? 1500 : 4000);
  };

  const noun = view === "domains" ? "sites" : "pages";

  return (
    <div className="space-y-4">
      <SegmentLinks
        label="Sources view"
        active={view}
        items={[
          { id: "pages", label: "Cited pages", href: href({ view: "pages", page: 1 }) },
          { id: "domains", label: "Cited sites", href: href({ view: "domains", page: 1 }) },
          ...(passageTotal > 0 ? [{ id: "passages", label: "Reused passages", href: href({ view: "passages", pp: 1 }), count: passageTotal }] : []),
        ]}
      />

      {view !== "passages" ? (
        <Card className="overflow-hidden" id="sources-list">
          <CardHeader
            title={view === "domains" ? "Cited sites" : "Cited pages"}
            description={
              <span className="tabular">
                {typeCounts[type]} {noun} from {citationTotal} citations, most-cited first
              </span>
            }
            actions={
              <form
                role="search"
                className="relative w-full sm:w-64"
                onSubmit={(e) => {
                  e.preventDefault();
                  router.push(href({ q: searchQuery, page: 1 }), { scroll: false });
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
                <input
                  type="search"
                  aria-label="Search site, URL or title"
                  placeholder="Search site, URL or title"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(inputClass, "pl-9 pr-10")}
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchQuery("");
                      router.push(href({ q: "", page: 1 }), { scroll: false });
                    }}
                    className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:text-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </form>
            }
          />
          <div className="border-b border-zinc-100 px-5 py-3">
            <SegmentLinks
              label="Filter by source type"
              active={type}
              items={(["all", "brand", "competitor", "editorial"] as SourceType[]).map((t) => ({ id: t, label: TYPE_LABEL[t], href: href({ type: t, page: 1 }), count: typeCounts[t] }))}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<Search className="h-5 w-5" />} title={`No ${noun} match`} description="Try another filter or clear the search." />
          ) : (
            <>
              <table className="hidden w-full text-left text-base md:table">
                <thead>
                  <tr>
                    <th className={th}>{view === "domains" ? "Site" : "Page"}</th>
                    <th className={th}>Type</th>
                    <th className={cn(th, "whitespace-nowrap text-right")}>Answers citing</th>
                    <th className={th}>Engines</th>
                    <th className={cn(th, "whitespace-nowrap text-right")}>Best position</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="transition-colors duration-150 hover:bg-zinc-50">
                      <td className={cn(td, "max-w-md")}>
                        {view === "domains" ? (
                          <>
                            <div className="font-medium text-zinc-900">{r.domain}</div>
                            <div className="text-xs text-zinc-500 tabular">{r.pages === 1 ? "1 page" : `${r.pages} pages`}</div>
                          </>
                        ) : (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="group flex min-w-0 flex-col justify-center">
                            <span className="flex items-center gap-1.5 font-medium text-zinc-900 group-hover:text-accent-700">
                              <span className="truncate">{r.title && r.title !== r.domain ? r.title : r.domain}</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                              <span className="sr-only">(opens in a new tab)</span>
                            </span>
                            <span className="block truncate text-xs text-zinc-500">{r.url}</span>
                          </a>
                        )}
                      </td>
                      <td className={td}>
                        <EntityBadge entity={entityOf(r)} />
                      </td>
                      <td className={cn(td, "text-right tabular text-zinc-900")}>{r.answers}</td>
                      <td className={cn(td, "text-sm text-zinc-700")}>{r.engines.map(engineLabel).join(", ") || "–"}</td>
                      <td className={cn(td, "text-right tabular text-zinc-700")}>{r.best}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-zinc-100 md:hidden">
                {rows.map((r) => {
                  const body = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-medium text-zinc-900">
                          <span className="line-clamp-2">{view === "domains" ? r.domain : r.title && r.title !== r.domain ? r.title : r.domain}</span>
                        </span>
                        <EntityBadge entity={entityOf(r)} className="shrink-0" />
                      </div>
                      {view !== "domains" && <div className="mt-0.5 truncate text-xs text-zinc-500">{r.url}</div>}
                      <div className="mt-1 text-sm text-zinc-600 tabular">
                        {r.answers} {r.answers === 1 ? "answer" : "answers"} · best position {r.best}
                        {view === "domains" && ` · ${r.pages === 1 ? "1 page" : `${r.pages} pages`}`}
                      </div>
                      <div className="text-xs text-zinc-500">{r.engines.map(engineLabel).join(", ")}</div>
                    </>
                  );
                  return (
                    <li key={r.key}>
                      {view === "domains" ? (
                        <div className="px-4 py-3">{body}</div>
                      ) : (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 transition-colors hover:bg-zinc-50">
                          {body}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <Pager page={page} totalPages={totalPages} total={typeCounts[type]} noun={noun} href={(p) => href({ page: p })} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title="Reused passages" description={`${passageTotal} passages from cited pages that closely match what the engine wrote, strongest match first.`} />
          <ul className="divide-y divide-zinc-100">
            {chunks.map((chunk) => {
              const strength = Math.round(chunk.similarityScore * 100);
              const state = copied?.id === chunk.id ? (copied.ok ? "ok" : "failed") : "idle";
              return (
                <li key={chunk.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900">{chunk.sourceUrl}</span>
                        <span className="block truncate text-sm text-zinc-500">{chunk.matchedChunkText}</span>
                      </span>
                      <span className="shrink-0 text-sm text-zinc-700 tabular" title="How closely the passage matches the answer">
                        <span className="hidden sm:inline">Match </span>
                        {strength}%
                      </span>
                    </summary>
                    <div className="space-y-3 px-4 pb-4 sm:pl-11">
                      <blockquote className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-base leading-relaxed text-zinc-800">
                        {chunk.matchedChunkText}
                      </blockquote>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => copy(chunk.id, chunk.matchedChunkText)}>
                          {state === "ok" ? <Check className="h-4 w-4 text-emerald-700" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                          <span aria-live="polite">{state === "ok" ? "Copied" : "Copy passage"}</span>
                        </Button>
                        <a
                          href={chunk.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tap-target inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden /> Open page
                        </a>
                        {state === "failed" && (
                          <span role="alert" className="flex items-center gap-1 text-xs text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Couldn&apos;t copy; select the text instead
                          </span>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <Pager page={passagePage} totalPages={passagePages} total={passageTotal} noun="passages" href={(p) => href({ view: "passages", pp: p })} />
        </Card>
      )}
    </div>
  );
}

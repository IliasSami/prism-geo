"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Search, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, cn, engineLabel, inputClass, td, th } from "@/components/ui";
import { Drawer, Highlighted, type HighlightGroup } from "@/components/answers/Drawer";

interface RunItem {
  id: string;
  engine: string;
  responseText: string;
  searches: string[];
  executionMs: number;
  createdAt: string;
  captureMethod: string;
  queryText: string;
  namedYou: boolean;
  citations: Array<{ url: string; domain: string; title: string | null }>;
}

const METHOD_LABEL: Record<string, string> = { browser: "Browser", browser_signed_in: "Signed-in browser", api: "API" };
const ENGINE_FILTERS = ["all", "chatgpt", "gemini", "perplexity", "google_aio", "copilot"];

function formatDate(value: string): string {
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Captured answers, filtered and paginated on the server (engine, search and page live in the
 * URL) so every stored run is reachable. A row opens the full answer in a side drawer.
 */
export function ResponsesClient({
  runs,
  engine,
  query,
  page,
  totalPages,
  total,
  brandName,
  highlights,
}: {
  runs: RunItem[];
  engine: string;
  query: string;
  page: number;
  totalPages: number;
  total: number;
  brandName: string;
  highlights: HighlightGroup[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState(query);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const open = runs.find((r) => r.id === openId) || null;

  const go = (next: { engine?: string; q?: string; page?: number }) => {
    const params = new URLSearchParams();
    const e = next.engine ?? engine;
    const q = next.q ?? searchQuery;
    if (e && e !== "all") params.set("engine", e);
    if (q.trim()) params.set("q", q.trim());
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by engine">
          {ENGINE_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={engine === id}
              onClick={() => go({ engine: id, page: 1 })}
              className={cn(
                "h-9 tap-target rounded-full px-3 text-sm font-medium transition duration-150 active:scale-[0.98]",
                engine === id ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              {id === "all" ? "All engines" : engineLabel(id)}
            </button>
          ))}
        </div>
        <form
          role="search"
          className="relative w-full md:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: searchQuery, page: 1 });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            aria-label="Search questions and answers"
            placeholder="Search questions and answers"
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
      </div>

      <Card className="overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No answers match"
            description="Try another engine or clear the search."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  go({ engine: "all", q: "", page: 1 });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-left text-base md:table">
              <thead>
                <tr>
                  <th className={th}>Question</th>
                  <th className={th}>Engine</th>
                  <th className={cn(th, "text-center")}>Names {brandName}</th>
                  <th className={cn(th, "text-right")}>Sources</th>
                  <th className={cn(th, "text-right")}>Captured</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-zinc-50"
                  >
                    <td className={cn(td, "max-w-md")}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(r.id);
                        }}
                        className="line-clamp-2 min-h-9 py-1.5 text-left font-medium text-zinc-900 hover:text-accent-700"
                      >
                        {r.queryText}
                      </button>
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge>{engineLabel(r.engine)}</Badge>
                        <span className="text-xs text-zinc-500">{METHOD_LABEL[r.captureMethod] || r.captureMethod}</span>
                      </div>
                    </td>
                    <td className={cn(td, "text-center")}>
                      {r.namedYou ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>}
                    </td>
                    <td className={cn(td, "text-right tabular text-zinc-700")}>{r.citations.length}</td>
                    <td className={cn(td, "whitespace-nowrap text-right text-sm text-zinc-500")}>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-zinc-100 md:hidden">
              {runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="block w-full px-4 py-3 text-left transition-colors hover:bg-zinc-50">
                    <div className="font-medium text-zinc-900">{r.queryText}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">
                      <Badge>{engineLabel(r.engine)}</Badge>
                      {r.namedYou ? <Badge tone="success">Names you</Badge> : <Badge>Doesn&apos;t name you</Badge>}
                      <span>{r.citations.length} sources</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(r.createdAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
            <span className="tabular">
              {total} answers · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => go({ page: page - 1 })} disabled={page <= 1}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button size="sm" onClick={() => go({ page: page + 1 })} disabled={page >= totalPages}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        )}
      </Card>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open?.queryText}
        subtitle={
          open && (
            <>
              <Badge>{engineLabel(open.engine)}</Badge>
              <Badge tone="neutral">{METHOD_LABEL[open.captureMethod] || open.captureMethod}</Badge>
              {open.namedYou ? <Badge tone="success">Names {brandName}</Badge> : <Badge>Doesn&apos;t name {brandName}</Badge>}
              <span>{formatDate(open.createdAt)}</span>
              {open.executionMs > 0 && <span>· {(open.executionMs / 1000).toFixed(0)}s</span>}
            </>
          )
        }
        footer={
          open && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1">
                  <mark className="rounded bg-accent-100 px-1 text-accent-700">{brandName}</mark> you
                </span>
                <span className="inline-flex items-center gap-1">
                  <mark className="rounded bg-amber-100 px-1 text-amber-900">Name</mark> competitor
                </span>
              </span>
              <Button size="sm" onClick={() => copy(open.responseText)}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy answer"}
              </Button>
            </div>
          )
        }
      >
        {open && (
          <div className="space-y-6">
            <section aria-label="Answer">
              <div className="whitespace-pre-wrap text-base leading-relaxed text-zinc-800">
                <Highlighted text={open.responseText} groups={highlights} />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Sources cited ({open.citations.length})</h3>
              {open.citations.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No sources captured.{" "}
                  {open.engine === "gemini" && open.captureMethod !== "api" ? "Gemini's app does not expose its sources to the browser; the Gemini API route does." : ""}
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {open.citations.map((c, i) => (
                    <li key={`${c.url}-${i}`}>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-50"
                      >
                        <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-zinc-400 tabular">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-zinc-900 group-hover:text-accent-700">{c.title || c.domain}</span>
                          <span className="block truncate text-xs text-zinc-500">{c.domain}</span>
                        </span>
                        <ExternalLink className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Searches the engine ran</h3>
              {open.searches.length === 0 ? (
                <p className="text-sm text-zinc-500">Not exposed by this engine for this capture.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {open.searches.map((q, i) => (
                    <li key={i}>
                      <Badge tone="info">{q}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}


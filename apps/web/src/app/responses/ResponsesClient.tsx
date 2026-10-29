"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Check, Copy, ExternalLink, Search, X, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, EmptyState, cn, engineLabel, inputClass, td, th } from "@/components/ui";
import { Drawer, type HighlightGroup } from "@/components/answers/Drawer";
import { Markdown, makeHighlighter } from "@/components/answers/Markdown";
import { Pager, SegmentLinks } from "@/components/insights/parts";
import { copyText } from "@/components/clipboard";
import { CAPTURE_METHOD_LABELS } from "@prismgeo/core";

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

const METHOD_LABEL: Record<string, string> = CAPTURE_METHOD_LABELS;

/** Gemini's consumer app does not expose its sources to a browser capture; its API does. */
// Gemini in a browser shows sources as buttons; provider, API and hand captures do include them
const sourcesHidden = (r: RunItem) => r.citations.length === 0 && r.engine === "gemini" && (r.captureMethod === "browser" || r.captureMethod === "browser_signed_in");

function formatDate(value: string): string {
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function NamesYou({ named, brandName }: { named: boolean; brandName: string }) {
  return named ? (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700">
      <span className="h-2 w-2 rounded-full bg-accent-600" aria-hidden />
      <span className="sr-only">Names {brandName}: </span>Yes
    </span>
  ) : (
    <span className="text-sm text-zinc-500">
      <span aria-hidden>–</span>
      <span className="sr-only">Does not name {brandName}</span>
    </span>
  );
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
  engineCounts,
}: {
  runs: RunItem[];
  engine: string;
  query: string;
  page: number;
  totalPages: number;
  total: number;
  brandName: string;
  highlights: HighlightGroup[];
  /** Answers per engine for the current search; only engines with answers are offered. */
  engineCounts: Array<{ engine: string; count: number }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState(query);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "failed">("idle");
  const open = runs.find((r) => r.id === openId) || null;
  const highlight = useMemo(() => makeHighlighter(highlights), [highlights]);

  const href = (next: { engine?: string; q?: string; page?: number }) => {
    const params = new URLSearchParams();
    const e = next.engine ?? engine;
    const q = next.q ?? query;
    if (e && e !== "all") params.set("engine", e);
    if (q.trim()) params.set("q", q.trim());
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    return `${pathname}${params.size ? `?${params}` : ""}`;
  };
  const go = (next: { engine?: string; q?: string; page?: number }) => router.push(href(next), { scroll: false });

  const doCopy = async (text: string) => {
    const ok = await copyText(text);
    setCopy(ok ? "ok" : "failed");
    setTimeout(() => setCopy("idle"), ok ? 1500 : 4000);
  };

  const allCount = engineCounts.reduce((s, e) => s + e.count, 0);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentLinks
          label="Filter by engine"
          active={engine}
          items={[
            { id: "all", label: "All engines", href: href({ engine: "all", page: 1 }), count: allCount },
            ...engineCounts.map((e) => ({ id: e.engine, label: engineLabel(e.engine), href: href({ engine: e.engine, page: 1 }), count: e.count })),
          ]}
        />
        <form
          role="search"
          className="relative w-full lg:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: searchQuery, page: 1 });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            type="search"
            aria-label="Search questions and answers"
            placeholder="Search questions and answers"
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
                go({ q: "", page: 1 });
              }}
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:text-zinc-800"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </form>
      </div>

      <Card className="overflow-hidden" id="answers-list">
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
                  <th className={cn(th, "whitespace-nowrap")}>Names you</th>
                  <th className={cn(th, "text-right")}>Sources</th>
                  <th className={cn(th, "whitespace-nowrap text-right")}>Captured</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer transition-colors duration-150 hover:bg-zinc-50">
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
                        <span className="text-sm font-medium text-zinc-800">{engineLabel(r.engine)}</span>
                        <span className="text-xs text-zinc-500">{METHOD_LABEL[r.captureMethod] || r.captureMethod}</span>
                      </div>
                    </td>
                    <td className={td}>
                      <NamesYou named={r.namedYou} brandName={brandName} />
                    </td>
                    <td className={cn(td, "text-right tabular text-zinc-700")}>
                      {sourcesHidden(r) ? (
                        <span className="text-zinc-500" title="Gemini's app does not show its sources to a browser capture">
                          n/a
                        </span>
                      ) : (
                        r.citations.length
                      )}
                    </td>
                    <td className={cn(td, "whitespace-nowrap text-right text-sm text-zinc-500 tabular")}>{formatDate(r.createdAt)}</td>
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
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
                      <span className="font-medium text-zinc-800">{engineLabel(r.engine)}</span>
                      <span aria-hidden="true">·</span>
                      {r.namedYou ? <NamesYou named brandName={brandName} /> : <span>Doesn&apos;t name you</span>}
                      <span aria-hidden="true">·</span>
                      <span>{sourcesHidden(r) ? "sources n/a" : `${r.citations.length} ${r.citations.length === 1 ? "source" : "sources"}`}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular">{formatDate(r.createdAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <Pager page={page} totalPages={totalPages} total={total} noun={total === 1 ? "answer" : "answers"} href={(n) => href({ page: n })} />
      </Card>

      <Drawer
        open={Boolean(open)}
        onClose={() => {
          setOpenId(null);
          setCopy("idle");
        }}
        title={open?.queryText}
        subtitle={
          open && (
            <>
              <Badge>{engineLabel(open.engine)}</Badge>
              <Badge tone="outline">{METHOD_LABEL[open.captureMethod] || open.captureMethod}</Badge>
              {open.namedYou ? <Badge tone="accent">Names {brandName}</Badge> : <Badge tone="outline">Doesn&apos;t name {brandName}</Badge>}
              <span className="tabular">{formatDate(open.createdAt)}</span>
              {open.executionMs > 0 && <span className="tabular">· {(open.executionMs / 1000).toFixed(0)}s</span>}
            </>
          )
        }
        footer={
          open && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-3 text-xs text-zinc-600">
                <span className="inline-flex items-center gap-1">
                  <mark className="rounded bg-accent-100 px-1 text-accent-800 ring-1 ring-inset ring-accent-200">{brandName}</mark> you
                </span>
                <span className="inline-flex items-center gap-1">
                  <mark className="rounded bg-zinc-200 px-1 text-zinc-900">Name</mark> competitor
                </span>
              </span>
              <span className="flex items-center gap-2">
                {copy === "failed" && (
                  <span role="alert" className="flex items-center gap-1 text-xs text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Couldn&apos;t copy; select the text instead
                  </span>
                )}
                <Button size="sm" onClick={() => doCopy(open.responseText)}>
                  {copy === "ok" ? <Check className="h-4 w-4 text-emerald-700" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  <span aria-live="polite">{copy === "ok" ? "Copied" : "Copy answer"}</span>
                </Button>
              </span>
            </div>
          )
        }
      >
        {open && (
          <div className="space-y-6">
            <section aria-label="Answer">
              <Markdown text={open.responseText} highlight={highlight} />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Sources cited ({sourcesHidden(open) ? "n/a" : open.citations.length})</h3>
              {open.citations.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {sourcesHidden(open)
                    ? "Gemini's app does not show its sources to the browser, so none could be captured. The Gemini API route returns them."
                    : "This answer cited no sources."}
                </p>
              ) : (
                <ol className="space-y-1">
                  {open.citations.map((c, i) => (
                    <li key={`${c.url}-${i}`}>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-h-9 items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-50"
                      >
                        <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-zinc-500 tabular">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-zinc-900 group-hover:text-accent-700">{c.title || c.domain}</span>
                          <span className="block truncate text-xs text-zinc-500">{c.domain}</span>
                        </span>
                        <ExternalLink className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
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
                      <span className="inline-flex rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300">{q}</span>
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

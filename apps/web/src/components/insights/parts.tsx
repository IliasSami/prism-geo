import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { Badge, Card, CardHeader, Dot, Meter, cn, engineLabel, type Tone } from "@/components/ui";
import type { Rate } from "@/lib/report";
import type { EngineHealth } from "./data";

/** "7% · 17 of 238" with the 95% range underneath. */
export function RateText({ r, empty = "–" }: { r: Rate; empty?: string }) {
  if (r.n === 0) return <span className="text-zinc-400">{empty}</span>;
  return (
    <div className="tabular">
      <span className="font-semibold text-zinc-900">{r.pct}%</span>
      <span className="text-sm text-zinc-500">
        {" "}
        · {r.hits} of {r.n}
      </span>
      <div className="text-xs text-zinc-500">
        likely {r.low}–{r.high}%
      </div>
    </div>
  );
}

/** Rate bar scaled to `max` (a fraction), so small rates stay readable; the band is the 95% range. */
export function RateMeter({ r, max, tone = "accent", label }: { r: Rate; max: number; tone?: "accent" | "neutral"; label: string }) {
  const scale = (v: number) => (max > 0 ? v / 100 / max : 0);
  return <Meter value={scale(r.pct)} range={[scale(r.low), scale(r.high)]} tone={tone} label={label} />;
}

const HEALTH: Record<EngineHealth["status"], { tone: Tone; label: string }> = {
  working: { tone: "success", label: "Working" },
  degraded: { tone: "warning", label: "Partly blocked" },
  blocked: { tone: "danger", label: "Blocked" },
};

/** One line per engine: answers received, what failed, and the supported way to fix it. */
export function EngineStrip({ health }: { health: EngineHealth[] }) {
  if (health.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Engine coverage"
        description="Answers received per engine across all audits. Failed runs are never filled in."
        actions={
          <Link href="/engines" className="tap-target inline-flex h-9 items-center gap-1 text-sm font-medium text-accent-600 hover:text-accent-700">
            Engines <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <ul className="divide-y divide-zinc-100">
        {health.map((h) => {
          const failed = h.blocked + h.skipped + h.noAnswer;
          return (
            <li key={h.engine} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-[200px] items-center gap-2">
                <Dot tone={HEALTH[h.status].tone} />
                <span className="font-medium text-zinc-900">{engineLabel(h.engine)}</span>
                <Badge tone={HEALTH[h.status].tone}>{HEALTH[h.status].label}</Badge>
              </div>
              <div className="text-sm text-zinc-600 tabular">
                {h.captured} answers
                {failed > 0 && (
                  <>
                    {" "}
                    · {h.blocked > 0 && `${h.blocked} blocked`}
                    {h.blocked > 0 && h.skipped > 0 && ", "}
                    {h.skipped > 0 && `${h.skipped} skipped while blocked`}
                    {(h.blocked > 0 || h.skipped > 0) && h.noAnswer > 0 && ", "}
                    {h.noAnswer > 0 && `${h.noAnswer} without a readable answer`}
                  </>
                )}
                {h.noOverview > 0 && ` · ${h.noOverview} searches showed no AI Overview`}
              </div>
              {h.remedy && <p className="text-sm text-zinc-500 sm:ml-auto sm:max-w-md sm:text-right">{h.remedy}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Shown before the first answers exist: the three steps to a first audit. */
export function FirstRunChecklist({ brandName, counts }: { brandName: string; counts: { competitors: number; prompts: number; answers: number } }) {
  const steps = [
    {
      done: counts.competitors > 0,
      title: "Add the competitors to compare against",
      detail: counts.competitors > 0 ? `${counts.competitors} tracked` : "Name and website of each rival",
      href: "/settings",
      cta: "Add competitors",
    },
    {
      done: counts.prompts > 0,
      title: "Add the questions your buyers ask AI assistants",
      detail: counts.prompts > 0 ? `${counts.prompts} active questions` : "Written the way a buyer would type them",
      href: "/prompts",
      cta: "Add questions",
    },
    {
      done: counts.answers > 0,
      title: "Run a first audit of about 10 questions",
      detail: "Use Run audit in the top bar. Start small: 10 questions, 1 repeat each, takes a few minutes.",
      href: null,
      cta: null,
    },
  ];
  return (
    <Card className="animate-fade-up">
      <CardHeader title={`Get ${brandName} measured`} description="Three steps to the first real answers. Nothing is shown until engines have actually answered." />
      <ol className="stagger divide-y divide-zinc-100">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                s.done ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"
              )}
              aria-label={s.done ? "Done" : `Step ${i + 1}`}
            >
              {s.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("font-medium", s.done ? "text-zinc-500 line-through decoration-zinc-300" : "text-zinc-900")}>{s.title}</div>
              <div className="text-sm text-zinc-500">{s.detail}</div>
            </div>
            {!s.done && s.href && (
              <Link
                href={s.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-base font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50"
              >
                {s.cta} <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Segmented links that set a search param (server-side filtering). */
export function SegmentLinks({ items, active }: { items: Array<{ id: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav className="flex max-w-full flex-wrap gap-1 rounded-lg bg-zinc-100 p-1" aria-label="Filter">
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          scroll={false}
          aria-current={active === it.id ? "page" : undefined}
          className={cn(
            "tap-target inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition duration-150",
            active === it.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="text-xs text-zinc-500 tabular">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Previous / next links for ?page= pagination. */
export function Pager({ page, totalPages, total, noun, href }: { page: number; totalPages: number; total: number; noun: string; href: (page: number) => string }) {
  if (totalPages <= 1) return null;
  const link = "tap-target inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50";
  const off = "pointer-events-none opacity-40";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
      <span className="tabular">
        {total} {noun} · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Link href={href(page - 1)} scroll={false} aria-disabled={page <= 1} className={cn(link, page <= 1 && off)}>
          Previous
        </Link>
        <Link href={href(page + 1)} scroll={false} aria-disabled={page >= totalPages} className={cn(link, page >= totalPages && off)}>
          Next
        </Link>
      </div>
    </div>
  );
}

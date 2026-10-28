import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ArrowRight, AlertTriangle, BarChart3 } from "lucide-react";
import { Card, EmptyState, LinkButton, Meter, Notice, buttonClass, cn, engineLabel, formatWhen } from "@/components/ui";
import { RunAuditButton } from "@/components/CrawlModal";
import type { Rate } from "@/lib/report";
import type { EngineView, LatestAudit } from "./engine-state";

/** "7% · 17 of 238" with the 95% range underneath. */
export function RateText({ r, empty = "–" }: { r: Rate; empty?: string }) {
  if (r.n === 0) return <span className="text-zinc-500">{empty}</span>;
  return (
    <div className="tabular">
      <span className="font-semibold text-zinc-900">{r.pct}%</span>
      <span className="whitespace-nowrap text-sm text-zinc-500">
        {" "}
        · {r.hits} of {r.n}
      </span>
      <div className="whitespace-nowrap text-xs text-zinc-500">
        likely {r.low}–{r.high}%
      </div>
    </div>
  );
}

/** Rate bar on a 0–`scale` axis (see meterScale); the band is the 95% range, the tick the value. */
export function RateMeter({
  r,
  scale,
  tone = "accent",
  label,
  animate,
}: {
  r: Rate;
  scale: number;
  tone?: "accent" | "neutral";
  label: string;
  animate?: boolean;
}) {
  const f = (v: number) => (scale > 0 ? v / 100 / scale : 0);
  return <Meter value={f(r.pct)} range={[f(r.low), f(r.high)]} tone={tone} label={label} animate={animate} />;
}

/** "Scale 0–50%" note for meters that are not drawn on 0–100%. */
export function ScaleNote({ scale }: { scale: number }) {
  return <span className="text-xs text-zinc-500 tabular">Bars: 0–{Math.round(scale * 100)}%</span>;
}

/**
 * One line per engine that is not working, from the latest audit, with the supported fix.
 * Renders nothing when every engine that ran is working (healthy engines live on Engines).
 */
export function EngineIssues({ views }: { views: EngineView[] }) {
  const trouble = views.filter((v) => v.enabled && v.state !== "working" && v.attempted > 0);
  if (trouble.length === 0) return null;
  return (
    <Notice
      tone={trouble.some((v) => v.state === "blocked" || v.state === "not_set_up") ? "danger" : "warning"}
      title={`${trouble.length === 1 ? "1 engine needs" : `${trouble.length} engines need`} attention`}
      action={
        <Link href="/engines" className={buttonClass("secondary", "sm")}>
          Engines <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      <ul className="mt-1 space-y-1 text-sm">
        {trouble.map((v) => (
          <li key={v.engine}>
            <span className="font-medium">
              {engineLabel(v.engine)}: {v.label.toLowerCase()}.
            </span>{" "}
            {v.reason}
            {v.fix && <> {v.fix.next}</>}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Shown on every insight page when the latest audit got no answers at all. */
export function LastAuditFailed({ latest }: { latest: LatestAudit | null }) {
  if (!latest || latest.captured > 0) return null;
  const r = latest.outcome.reason;
  return (
    <Notice
      tone="danger"
      title={`Your last audit (${formatWhen(latest.at)}) got no answers`}
      action={
        <Link href="/engines" className={buttonClass("secondary", "sm")}>
          See why <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {r ? (
        <>
          {r.title}. {r.next}
        </>
      ) : (
        latest.outcome.detail
      )}
    </Notice>
  );
}

/** Empty state for pages that need answers: honest about a failed audit, with a real next step. */
export function NoAnswers({ latest, icon, what }: { latest: LatestAudit | null; icon?: ReactNode; what: string }) {
  const failed = latest && latest.captured === 0;
  return (
    <Card>
      <EmptyState
        icon={failed ? <AlertTriangle className="h-5 w-5" /> : icon || <BarChart3 className="h-5 w-5" />}
        title={failed ? "Your last audit got no answers" : "No answers captured yet"}
        description={
          failed ? (
            <>
              {latest.outcome.reason ? `${latest.outcome.reason.title}. ` : ""}
              {what} only uses answers the engines really gave, so there is nothing to show yet.
            </>
          ) : (
            <>{what} only uses answers the engines really gave. Run a first audit to start; 10 questions take a few minutes.</>
          )
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {failed && (
              <LinkButton href="/engines" variant="primary">
                See how to fix <ArrowRight className="h-4 w-4" aria-hidden />
              </LinkButton>
            )}
            <RunAuditButton label={failed ? "Run again" : "Run an audit"} variant={failed ? "secondary" : "primary"} />
          </div>
        }
      />
    </Card>
  );
}

/** Shown before the first answers exist: the three steps to a first audit. */
export function FirstRunChecklist({
  brandName,
  counts,
  latest,
}: {
  brandName: string;
  counts: { competitors: number; prompts: number; answers: number };
  latest: LatestAudit | null;
}) {
  const tried = Boolean(latest) && counts.answers === 0;
  const steps = [
    {
      done: counts.competitors > 0,
      title: "Add the competitors to compare against",
      detail: counts.competitors > 0 ? `${counts.competitors} tracked` : "Name and website of each rival",
      action: (
        <LinkButton href="/settings?tab=competitors">
          Add competitors <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
      ),
    },
    {
      done: counts.prompts > 0,
      title: "Add the questions your buyers ask AI assistants",
      detail: counts.prompts > 0 ? `${counts.prompts} active ${counts.prompts === 1 ? "question" : "questions"}` : "Written the way a buyer would type them",
      action: (
        <LinkButton href="/prompts">
          Add questions <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
      ),
    },
    {
      done: counts.answers > 0,
      warn: tried,
      title: tried ? "Tried a first audit: no answers yet" : "Run a first audit of about 10 questions",
      detail: tried
        ? latest?.outcome.reason
          ? `${latest.outcome.reason.title}. Fix that, then run it again.`
          : "Every run failed. See Engines for the reason, then run it again."
        : "Start small: 10 questions, asked once each, takes a few minutes.",
      action: tried ? (
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/engines" variant="primary">
            See how to fix <ArrowRight className="h-4 w-4" aria-hidden />
          </LinkButton>
          <RunAuditButton label="Run again" variant="secondary" />
        </div>
      ) : (
        <RunAuditButton label="Run audit" />
      ),
    },
  ];
  return (
    <Card>
      <div className="border-b border-zinc-100 px-5 py-4">
        <h2 className="text-md font-semibold text-zinc-900">Get {brandName} measured</h2>
        <p className="mt-0.5 text-sm text-zinc-500">Three steps to the first real answers. Nothing is shown until engines have actually answered.</p>
      </div>
      <ol className="divide-y divide-zinc-100">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                s.done ? "bg-emerald-100 text-emerald-800" : s.warn ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-700"
              )}
            >
              {s.done ? <Check className="h-4 w-4" aria-hidden /> : s.warn ? <AlertTriangle className="h-4 w-4" aria-hidden /> : i + 1}
              <span className="sr-only">{s.done ? "Done: " : s.warn ? "Needs attention: " : `Step ${i + 1}: `}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("font-medium", s.done ? "text-zinc-500 line-through decoration-zinc-400" : "text-zinc-900")}>{s.title}</div>
              <div className="text-sm text-zinc-500">{s.detail}</div>
            </div>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Segmented links that set a search param (server-side filtering). */
export function SegmentLinks({
  items,
  active,
  label = "Filter",
}: {
  items: Array<{ id: string; label: string; href: string; count?: number }>;
  active: string;
  label?: string;
}) {
  return (
    <nav className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-zinc-100 p-1" aria-label={label}>
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          scroll={false}
          aria-current={active === it.id ? "page" : undefined}
          className={cn(
            "tap-target inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition duration-150",
            active === it.id ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:text-zinc-900"
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="text-xs text-zinc-500 tabular">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Previous / next links for ?page= pagination; following one scrolls back to the top. */
export function Pager({ page, totalPages, total, noun, href }: { page: number; totalPages: number; total: number; noun: string; href: (page: number) => string }) {
  if (totalPages <= 1) return null;
  const link = buttonClass("secondary", "sm");
  const off = "pointer-events-none opacity-40";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
      <span className="tabular">
        {total} {noun} · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={cn(link, page <= 1 && off)}>
          Previous
        </Link>
        <Link href={href(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : undefined} className={cn(link, page >= totalPages && off)}>
          Next
        </Link>
      </div>
    </nav>
  );
}

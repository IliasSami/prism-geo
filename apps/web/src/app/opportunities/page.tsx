import { getActiveBrand } from "@prismgeo/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Lightbulb } from "lucide-react";
import { buildReport, findOpportunities, type Opportunity } from "@/lib/report";
import { Badge, Card, EmptyState, EntityBadge, PageHeader, engineLabel, type Tone } from "@/components/ui";
import { LastAuditFailed, NoAnswers, Pager, SegmentLinks } from "@/components/insights/parts";
import { getLatestAudit } from "@/components/insights/engine-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gaps" };

const PAGE_SIZE = 20;
const PRIORITY: Record<Opportunity["priority"], { label: string; tone: Tone }> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "outline" },
};
// The grid only starts at lg: between 768 and ~1024px the sidebar leaves too little room for the question
const COLS = "lg:grid lg:grid-cols-[minmax(14rem,1fr)_180px_120px_80px] lg:items-center lg:gap-4";

/**
 * Gaps: unbranded questions where you are missing or behind, most urgent first, each with
 * next steps drawn from what the engines actually named and cited when answering it.
 */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ priority?: string; page?: string }> }) {
  const params = await searchParams;
  const brand = getActiveBrand();
  if (!brand) redirect("/setup");
  const report = buildReport(brand);
  const all = findOpportunities(report, brand.name);
  const measured = report.prompts.filter((p) => p.status !== "no_data" && p.active && !p.branded);
  const winning = measured.filter((p) => p.status === "winning").length;

  const priority = ["high", "medium", "low"].includes(params.priority || "") ? (params.priority as Opportunity["priority"]) : "all";
  const filtered = priority === "all" ? all : all.filter((o) => o.priority === priority);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(params.page || "1", 10) || 1));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (next: { priority?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const p = next.priority ?? priority;
    if (p !== "all") sp.set("priority", p);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    return `/opportunities${sp.size ? `?${sp}` : ""}`;
  };
  const count = (p: Opportunity["priority"]) => all.filter((o) => o.priority === p).length;
  const latest = getLatestAudit(brand.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gaps"
        description={
          measured.length
            ? `Unbranded questions where ${brand.name} is missing or behind, most urgent first. You lead on ${winning} of ${measured.length} measured questions.`
            : `Questions where ${brand.name} is missing or behind, once answers are captured.`
        }
      />

      {report.allAnswers > 0 && <LastAuditFailed latest={latest} />}

      {report.allAnswers === 0 ? (
        <NoAnswers latest={latest} icon={<Lightbulb className="h-5 w-5" />} what="Finding gaps" />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb className="h-5 w-5" />}
            title="No gaps on the measured questions"
            description="You are named at least as often as every competitor. Add more buyer questions to widen coverage."
          />
        </Card>
      ) : (
        <>
          <SegmentLinks
            active={priority}
            label="Filter by priority"
            items={[
              { id: "all", label: "All", href: qs({ priority: "all" }), count: all.length },
              ...(["high", "medium", "low"] as const)
                .filter((p) => count(p) > 0 || priority === p)
                .map((p) => ({ id: p, label: PRIORITY[p].label, href: qs({ priority: p }), count: count(p) })),
            ]}
          />

          <Card className="overflow-hidden">
            <div aria-hidden="true" className={`hidden border-b border-zinc-200 bg-zinc-50/80 px-5 py-2.5 pl-12 text-xs font-medium uppercase tracking-wide text-zinc-500 ${COLS}`}>
              <span>Question</span>
              <span>Named instead</span>
              <span>{brand.name}</span>
              <span>Priority</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-base text-zinc-500">No gaps with this priority.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {rows.map((o) => {
                  const leader = o.prompt.competitors[0];
                  return (
                    <li key={o.prompt.id}>
                      <details className="group [&[open]_.chev]:rotate-90">
                        <summary className="flex cursor-pointer list-none gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="chev mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200" aria-hidden />
                          <div className={`min-w-0 flex-1 space-y-1.5 lg:space-y-0 ${COLS}`}>
                            <div className="min-w-0 font-medium text-zinc-900">{o.prompt.text}</div>
                            <div className="text-sm text-zinc-700">
                              <span className="text-zinc-500 lg:sr-only">Named instead: </span>
                              {leader ? (
                                <>
                                  {leader.name} <span className="text-zinc-500 tabular">({leader.answers} of {o.prompt.answers})</span>
                                </>
                              ) : (
                                <span className="text-zinc-500">Nobody yet</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm tabular text-zinc-700">
                              <span className="text-zinc-500 lg:sr-only">{brand.name}: </span>
                              <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200" aria-hidden>
                                <span className="absolute inset-y-0 left-0 rounded-full bg-accent-600" style={{ width: `${o.prompt.answers ? (o.prompt.youMentioned / o.prompt.answers) * 100 : 0}%` }} />
                              </span>
                              {o.prompt.youMentioned}/{o.prompt.answers}
                            </div>
                            <div>
                              <Badge tone={PRIORITY[o.priority].tone}>
                                <span className="lg:sr-only">Priority: </span>
                                {PRIORITY[o.priority].label}
                              </Badge>
                            </div>
                          </div>
                        </summary>
                        <div className="space-y-3 bg-zinc-50/60 px-5 py-4 pl-12">
                          <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">What to do</div>
                            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-base text-zinc-800">
                              {o.actions.map((a) => (
                                <li key={a}>{a}</li>
                              ))}
                            </ol>
                          </div>
                          {o.prompt.sources.length > 0 && (
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sources the engines cited</div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {o.prompt.sources.map((s) => (
                                  <Link key={s.domain} href={`/citations?view=domains&q=${encodeURIComponent(s.domain)}`} className="inline-flex min-h-9 items-center">
                                    <EntityBadge entity={s.isCompetitor ? "competitor" : "thirdParty"}>
                                      {s.domain}
                                      <span className="text-zinc-500 tabular">{s.answers}</span>
                                    </EntityBadge>
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="text-sm text-zinc-500">
                            Answered by {o.prompt.engines.map(engineLabel).join(", ")}
                            {o.prompt.enginesMissingYou.length > 0 && <> · you are missing on {o.prompt.enginesMissingYou.map(engineLabel).join(", ")}</>}
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
            <Pager page={page} totalPages={totalPages} total={filtered.length} noun="gaps" href={(n) => qs({ page: n })} />
          </Card>
        </>
      )}
    </div>
  );
}

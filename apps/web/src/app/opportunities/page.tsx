import { getActiveBrand } from "@prismgeo/db";
import { redirect } from "next/navigation";
import { ChevronRight, Lightbulb } from "lucide-react";
import { buildReport, findOpportunities, type Opportunity } from "@/lib/report";
import { Badge, Card, EmptyState, PageHeader, engineLabel, type Tone } from "@/components/ui";
import { Pager, SegmentLinks } from "@/components/insights/parts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const PRIORITY: Record<Opportunity["priority"], { label: string; tone: Tone }> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};
const COLS = "md:grid md:grid-cols-[minmax(0,1fr)_200px_140px_88px] md:items-center md:gap-4";

/**
 * Opportunities: unbranded questions where you are missing or behind, most urgent first, each with
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunities"
        description={
          measured.length
            ? `Unbranded questions where ${brand.name} is missing or behind, most urgent first. You lead on ${winning} of ${measured.length} measured questions.`
            : `Questions where ${brand.name} is missing or behind, once answers are captured.`
        }
      />

      {report.allAnswers === 0 ? (
        <Card>
          <EmptyState icon={<Lightbulb className="h-5 w-5" />} title="No answers captured yet" description="Run an audit from the top bar; gaps are found from the real answers." />
        </Card>
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
            items={[
              { id: "all", label: "All", href: qs({ priority: "all" }), count: all.length },
              { id: "high", label: "High", href: qs({ priority: "high" }), count: count("high") },
              { id: "medium", label: "Medium", href: qs({ priority: "medium" }), count: count("medium") },
              { id: "low", label: "Low", href: qs({ priority: "low" }), count: count("low") },
            ]}
          />

          <Card className="animate-fade-up overflow-hidden">
            <div className={`hidden border-b border-zinc-200 bg-zinc-50/80 px-5 py-2.5 pl-12 text-xs font-medium uppercase tracking-wide text-zinc-500 ${COLS}`}>
              <span>Question</span>
              <span>Named instead</span>
              <span>{brand.name}</span>
              <span>Priority</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-base text-zinc-500">No gaps with this priority.</p>
            ) : (
              <ul className="stagger divide-y divide-zinc-100">
                {rows.map((o) => {
                  const leader = o.prompt.competitors[0];
                  return (
                    <li key={o.prompt.id}>
                      <details className="group [&[open]_.chev]:rotate-90">
                        <summary className="flex cursor-pointer list-none gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="chev mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200" aria-hidden />
                          <div className={`min-w-0 flex-1 space-y-1.5 md:space-y-0 ${COLS}`}>
                            <div className="min-w-0">
                              <div className="font-medium text-zinc-900">{o.prompt.text}</div>
                              <div className="text-xs text-zinc-500">{o.headline}</div>
                            </div>
                            <div className="text-sm text-zinc-700">
                              {leader ? (
                                <>
                                  {leader.name} <span className="text-zinc-500 tabular">({leader.answers} of {o.prompt.answers})</span>
                                </>
                              ) : (
                                <span className="text-zinc-500">Nobody yet</span>
                              )}
                            </div>
                            <div className="text-sm tabular text-zinc-700">
                              named in {o.prompt.youMentioned} of {o.prompt.answers}
                            </div>
                            <div>
                              <Badge tone={PRIORITY[o.priority].tone}>{PRIORITY[o.priority].label}</Badge>
                            </div>
                          </div>
                        </summary>
                        <div className="animate-fade-in space-y-3 bg-zinc-50/60 px-5 py-4 pl-12">
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
                                  <Badge key={s.domain} tone={s.isCompetitor ? "danger" : "neutral"} className="font-mono">
                                    {s.domain}
                                    <span className="font-sans text-zinc-500 tabular">{s.answers}</span>
                                  </Badge>
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

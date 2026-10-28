import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BarChart3, ChevronRight } from "lucide-react";
import { buildReport, type EntityRow, type PromptRow } from "@/lib/report";
import { Badge, Card, CardHeader, LinkButton, PageHeader, Table, td, th, cn, engineLabel, meterScale, plural, type Tone } from "@/components/ui";
import { LastAuditFailed, NoAnswers, Pager, RateMeter, RateText, ScaleNote, SegmentLinks } from "@/components/insights/parts";
import { trackedCompetitors } from "@/components/insights/data";
import { getLatestAudit } from "@/components/insights/engine-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competitors" };

const STATUS: Record<PromptRow["status"], { label: string; tone: Tone }> = {
  winning: { label: "You lead", tone: "success" },
  shared: { label: "Behind", tone: "warning" },
  losing: { label: "Competitor named", tone: "danger" },
  nobody: { label: "Open ground", tone: "outline" },
  no_data: { label: "No answers yet", tone: "outline" },
};

const PAGE_SIZE = 25;

function CompanyTable({ entities, brandDomainNote }: { entities: EntityRow[]; brandDomainNote: string }) {
  const scale = meterScale(Math.max(0, ...entities.map((e) => e.mentioned.high / 100)));
  return (
    <>
      <Table label="You vs competitors" className="min-w-[640px]">
        <thead>
          <tr>
            <th className={th}>Company</th>
            <th className={cn(th, "min-w-[200px]")}>Named in answers</th>
            <th className={th}>Website cited</th>
            <th className={cn(th, "whitespace-nowrap")}>
              <span title="Average order of first mention among the tracked companies only (1 = named first)">Avg. order</span>
            </th>
            <th className={th}>Tone</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.name} className={cn("transition-colors hover:bg-zinc-50", e.isTarget && "bg-accent-50/50")}>
              <td className={td}>
                <div className={cn("font-medium", e.isTarget ? "text-accent-700" : "text-zinc-900")}>
                  {e.name}
                  {e.isTarget && <span className="ml-1.5 text-xs font-medium text-accent-700">you</span>}
                </div>
                <div className="text-xs text-zinc-500">{e.domain}</div>
              </td>
              <td className={td}>
                <RateText r={e.mentioned} />
                <div className="mt-1.5 max-w-[200px]">
                  <RateMeter r={e.mentioned} scale={scale} tone={e.isTarget ? "accent" : "neutral"} label={`${e.name} named in ${e.mentioned.pct}% of answers`} />
                </div>
              </td>
              <td className={td}>
                <RateText r={e.cited} empty={brandDomainNote} />
              </td>
              <td className={cn(td, "tabular text-zinc-700")}>{e.avgPosition === null ? <span className="text-zinc-500">–</span> : e.avgPosition.toFixed(1)}</td>
              <td className={cn(td, "whitespace-nowrap text-sm text-zinc-700 tabular")}>
                {e.mentioned.hits === 0 ? (
                  <span className="text-zinc-500">–</span>
                ) : (
                  <span title={`${e.positive} positive and ${e.negative} negative mentions; the rest neutral`}>
                    <span aria-hidden>▲</span>
                    {e.positive} <span aria-hidden>▼</span>
                    {e.negative}
                    <span className="sr-only">
                      {" "}
                      ({e.positive} positive, {e.negative} negative)
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex justify-end border-t border-zinc-100 px-5 py-2">
        <ScaleNote scale={scale} />
      </div>
    </>
  );
}

/**
 * Competitors: you versus each competitor, overall or for one engine, plus who is named for each
 * question. Headline rates use unbranded questions only.
 */
export default async function VisibilityPage({ searchParams }: { searchParams: Promise<{ engine?: string; page?: string }> }) {
  const params = await searchParams;
  const brand = await activeBrandFromCookies();
  if (!brand) redirect("/setup");
  const report = buildReport(brand);

  if (report.allAnswers === 0) {
    const tracked = trackedCompetitors(brand.id);
    return (
      <div className="space-y-6">
        <PageHeader title="Competitors" description={`${brand.name} versus competitors in AI answers.`} />
        <NoAnswers latest={getLatestAudit(brand.id)} icon={<BarChart3 className="h-5 w-5" />} what="This comparison" />
        <Card>
          <CardHeader
            title="Tracked companies"
            description={tracked.length ? `${plural(tracked.length, "competitor")} will be compared with ${brand.name}` : "No competitors yet"}
            actions={
              <LinkButton href="/settings?tab=competitors" size="sm">
                Edit competitors
              </LinkButton>
            }
          />
          {tracked.length > 0 && (
            <ul className="divide-y divide-zinc-100">
              {tracked.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="font-medium text-zinc-900">{c.name}</span>
                  <span className="text-sm text-zinc-500">{c.domain}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  const engineIds = report.engines.map((e) => e.engine);
  const engine = engineIds.includes(params.engine || "") ? params.engine! : "all";
  // Per-engine rows come from the same report computation as the headline, so the two never disagree
  const engineRow = engine === "all" ? null : report.engines.find((e) => e.engine === engine) || null;
  const entities = engineRow ? report.entitiesByEngine[engine] || [] : report.entities;
  const answers = engineRow ? engineRow.answers : report.totalAnswers;
  const withSources = engineRow ? engineRow.youCited.n : report.answersWithSources;
  const organic = report.prompts.filter((p) => p.answers > 0 && !p.branded);
  const branded = report.prompts.filter((p) => p.answers > 0 && p.branded);
  const totalPages = Math.max(1, Math.ceil(organic.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(params.page || "1", 10) || 1));
  const pagePrompts = organic.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (next: { engine?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const e = next.engine ?? engine;
    if (e !== "all") sp.set("engine", e);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    return `/visibility${sp.size ? `?${sp}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitors"
        description={`Share of ${plural(answers, "unbranded answer")}${engine === "all" ? "" : ` from ${engineLabel(engine)}`} naming each company. Ranges are 95% likely intervals.`}
      />

      <LastAuditFailed latest={getLatestAudit(brand.id)} />

      <SegmentLinks
        label="Filter by engine"
        active={engine}
        items={[
          { id: "all", label: "All engines", href: qs({ engine: "all" }), count: report.totalAnswers },
          ...report.engines.map((e) => ({ id: e.engine, label: engineLabel(e.engine), href: qs({ engine: e.engine }), count: e.answers })),
        ]}
      />

      <Card className="overflow-hidden">
        <CardHeader title="You vs competitors" description="Named in answers, and cited among answers that show sources" />
        <CompanyTable entities={entities} brandDomainNote={withSources === 0 ? "No sources shown" : "–"} />
      </Card>

      {engine === "all" && (
        <Card className="overflow-hidden">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-150 group-open:rotate-90" aria-hidden />
              <span className="text-md font-semibold text-zinc-900">Compare engines</span>
              <span className="text-sm text-zinc-500">{plural(report.engines.length, "engine")}</span>
            </summary>
            <Table label="By engine" className="min-w-[640px]">
              <thead>
                <tr>
                  <th className={th}>Engine</th>
                  <th className={th}>Answers</th>
                  <th className={th}>{brand.name} named</th>
                  <th className={th}>Site cited</th>
                  <th className={th}>Most-named competitor</th>
                </tr>
              </thead>
              <tbody>
                {report.engines.map((e) => (
                  <tr key={e.engine} className="transition-colors hover:bg-zinc-50">
                    <td className={td}>
                      <Link href={qs({ engine: e.engine })} className="inline-flex min-h-9 items-center font-medium text-zinc-900 hover:text-accent-700">
                        {engineLabel(e.engine)}
                      </Link>
                    </td>
                    <td className={cn(td, "tabular text-zinc-700")}>{e.answers}</td>
                    <td className={td}>
                      <RateText r={e.youMentioned} />
                    </td>
                    <td className={td}>
                      <RateText r={e.youCited} empty="No sources shown" />
                    </td>
                    <td className={cn(td, "text-zinc-700")}>{e.topCompetitor ? `${e.topCompetitor.name} (${e.topCompetitor.answers})` : "None named"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title="By question"
          description="Who gets named for each unbranded buyer question, across all engines"
          actions={
            <Link href="/opportunities" className="tap-target inline-flex h-9 items-center gap-1 text-sm font-medium text-accent-700 hover:text-accent-800">
              Gaps <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        {organic.length === 0 ? (
          <p className="px-5 py-6 text-base text-zinc-500">No unbranded question has answers yet.</p>
        ) : (
          <Table label="By question" className="min-w-[640px]">
            <thead>
              <tr>
                <th className={th}>Question</th>
                <th className={cn(th, "whitespace-nowrap")}>{brand.name} named</th>
                <th className={th}>Competitors named</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pagePrompts.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-zinc-50">
                  <td className={cn(td, "min-w-[220px] max-w-md")}>
                    <div className="text-zinc-900">{p.text}</div>
                    {!p.active && <div className="mt-0.5 text-xs text-zinc-500">paused</div>}
                  </td>
                  <td className={cn(td, "whitespace-nowrap tabular text-zinc-700")}>
                    {p.youMentioned} of {p.answers}
                  </td>
                  <td className={cn(td, "text-sm text-zinc-700")}>{p.competitors.length ? p.competitors.map((c) => `${c.name} (${c.answers})`).join(", ") : <span className="text-zinc-500">–</span>}</td>
                  <td className={td}>
                    <Badge tone={STATUS[p.status].tone} className="whitespace-nowrap">
                      {STATUS[p.status].label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} totalPages={totalPages} total={organic.length} noun="questions with answers" href={(n) => qs({ page: n })} />
      </Card>

      {branded.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Questions that name ${brand.name}`}
            description={`Not scored: an answer to a question about ${brand.name} names it by definition. Shown so you can read what the engines say.`}
          />
          <Table label="Branded questions" className="min-w-[560px]">
            <thead>
              <tr>
                <th className={th}>Question</th>
                <th className={cn(th, "whitespace-nowrap")}>Answers naming you</th>
                <th className={th}>Competitors named</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {branded.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-zinc-50">
                  <td className={cn(td, "min-w-[220px] max-w-md")}>
                    <Link href={`/responses?q=${encodeURIComponent(p.text)}`} className="inline-flex min-h-9 items-center text-zinc-900 hover:text-accent-700">
                      {p.text}
                    </Link>
                    {!p.active && <div className="mt-0.5 text-xs text-zinc-500">paused</div>}
                  </td>
                  <td className={cn(td, "whitespace-nowrap tabular text-zinc-500")}>
                    {p.brandedNamedRuns ?? p.youMentioned} of {p.answers} (branded)
                  </td>
                  <td className={cn(td, "text-sm text-zinc-700")}>{p.competitors.length ? p.competitors.map((c) => `${c.name} (${c.answers})`).join(", ") : <span className="text-zinc-500">–</span>}</td>
                  <td className={td}>
                    <Badge tone="outline" className="whitespace-nowrap">
                      Names you · not scored
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

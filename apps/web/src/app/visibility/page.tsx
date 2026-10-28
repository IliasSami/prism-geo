import { getActiveBrand } from "@prismgeo/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { buildReport, type EntityRow, type PromptRow } from "@/lib/report";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, td, th, cn, engineLabel, type Tone } from "@/components/ui";
import { Pager, RateMeter, RateText, SegmentLinks } from "@/components/insights/parts";
import { entitiesForEngine } from "@/components/insights/data";

export const dynamic = "force-dynamic";

const STATUS: Record<PromptRow["status"], { label: string; tone: Tone }> = {
  winning: { label: "You lead", tone: "success" },
  shared: { label: "Behind", tone: "warning" },
  losing: { label: "Competitor named", tone: "danger" },
  nobody: { label: "Open ground", tone: "neutral" },
  no_data: { label: "No answers yet", tone: "neutral" },
};

const PAGE_SIZE = 25;

function CompanyTable({ entities, brandDomainNote }: { entities: EntityRow[]; brandDomainNote: string }) {
  const max = Math.max(0.05, ...entities.map((e) => e.mentioned.high / 100));
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Company</th>
          <th className={cn(th, "min-w-[220px]")}>Named in answers</th>
          <th className={th}>Website cited</th>
          <th className={th} title="Order of first mention among the tracked companies only">
            Order among tracked
          </th>
          <th className={th}>Tone</th>
        </tr>
      </thead>
      <tbody className="stagger">
        {entities.map((e) => (
          <tr key={e.name} className={cn("transition-colors hover:bg-zinc-50", e.isTarget && "bg-accent-50/40")}>
            <td className={td}>
              <div className="font-medium text-zinc-900">
                {e.name}
                {e.isTarget && <span className="ml-1.5 text-xs font-medium text-accent-600">you</span>}
              </div>
              <div className="font-mono text-xs text-zinc-500">{e.domain}</div>
            </td>
            <td className={td}>
              <RateText r={e.mentioned} />
              <div className="mt-1.5 max-w-[200px]">
                <RateMeter r={e.mentioned} max={max} tone={e.isTarget ? "accent" : "neutral"} label={`${e.name} named in ${e.mentioned.pct}% of answers`} />
              </div>
            </td>
            <td className={td}>
              <RateText r={e.cited} empty={brandDomainNote} />
            </td>
            <td className={cn(td, "tabular text-zinc-700")}>{e.avgPosition === null ? "–" : `#${e.avgPosition}`}</td>
            <td className={cn(td, "whitespace-nowrap text-sm")}>
              {e.mentioned.hits === 0 ? (
                <span className="text-zinc-400">–</span>
              ) : (
                <span className="tabular">
                  <span className="text-emerald-700">{e.positive} positive</span>
                  <span className="text-zinc-400"> · </span>
                  <span className={e.negative ? "text-red-600" : "text-zinc-500"}>{e.negative} negative</span>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Visibility: you versus each competitor, overall or for one engine, plus who is named for each
 * question. Headline rates use unbranded questions only.
 */
export default async function VisibilityPage({ searchParams }: { searchParams: Promise<{ engine?: string; page?: string }> }) {
  const params = await searchParams;
  const brand = getActiveBrand();
  if (!brand) redirect("/setup");
  const report = buildReport(brand);

  if (report.allAnswers === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Visibility" description={`${brand.name} versus competitors in AI answers.`} />
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="No answers captured yet"
            description="Visibility is computed only from answers the engines actually returned. Run an audit from the top bar to start."
          />
        </Card>
      </div>
    );
  }

  const engineIds = report.engines.map((e) => e.engine);
  const engine = engineIds.includes(params.engine || "") ? params.engine! : "all";
  const scoped = engine === "all" ? null : entitiesForEngine(brand, engine);
  const entities = scoped ? scoped.entities : report.entities;
  const answers = scoped ? scoped.answers : report.totalAnswers;
  const withSources = scoped ? scoped.withSources : report.answersWithSources;

  const prompts = report.prompts.filter((p) => p.answers > 0);
  const totalPages = Math.max(1, Math.ceil(prompts.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(params.page || "1", 10) || 1));
  const pagePrompts = prompts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
        title="Visibility"
        description={`${answers} answers to unbranded questions${engine === "all" ? "" : ` from ${engineLabel(engine)}`}; ${withSources} of them showed sources. Ranges are 95% likely intervals: small samples give wide ranges.`}
      />

      <SegmentLinks
        active={engine}
        items={[
          { id: "all", label: "All engines", href: qs({ engine: "all" }), count: report.totalAnswers },
          ...report.engines.map((e) => ({ id: e.engine, label: engineLabel(e.engine), href: qs({ engine: e.engine }), count: e.answers })),
        ]}
      />

      <Card className="animate-fade-up">
        <CardHeader title="You vs competitors" description="Share of answers that name each company, and of answers with sources that cite its website." />
        <CompanyTable entities={entities} brandDomainNote={withSources === 0 ? "No sources shown" : "–"} />
        {engine === "all" && report.branded.n > 0 && (
          <p className="px-5 py-3 text-sm text-zinc-500">
            Questions that name {brand.name} (not counted above): named in {report.branded.pct}% ({report.branded.hits} of {report.branded.n} answers).
          </p>
        )}
      </Card>

      {engine === "all" && (
        <Card className="animate-fade-up">
          <CardHeader title="By engine" />
          <Table>
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
                    <Link href={qs({ engine: e.engine })} className="font-medium text-zinc-900 hover:text-accent-700">
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
        </Card>
      )}

      <Card className="animate-fade-up">
        <CardHeader
          title="By question"
          description="Who gets named for each buyer question, across all engines."
          actions={
            <Link href="/opportunities" className="tap-target inline-flex h-9 items-center text-sm font-medium text-accent-600 hover:text-accent-700">
              What to do →
            </Link>
          }
        />
        <Table>
          <thead>
            <tr>
              <th className={th}>Question</th>
              <th className={th}>Status</th>
              <th className={th}>{brand.name} named</th>
              <th className={th}>Competitors named</th>
            </tr>
          </thead>
          <tbody>
            {pagePrompts.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-zinc-50">
                <td className={cn(td, "max-w-md")}>
                  <div className="text-zinc-900">{p.text}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {p.intent.replace(/_/g, " ")}
                    {p.branded && " · names you"}
                    {!p.active && " · paused"}
                  </div>
                </td>
                <td className={td}>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </td>
                <td className={cn(td, "whitespace-nowrap tabular text-zinc-700")}>
                  {p.youMentioned} of {p.answers}
                </td>
                <td className={cn(td, "text-sm text-zinc-700")}>{p.competitors.length ? p.competitors.map((c) => `${c.name} (${c.answers})`).join(", ") : "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pager page={page} totalPages={totalPages} total={prompts.length} noun="questions with answers" href={(n) => qs({ page: n })} />
      </Card>
    </div>
  );
}

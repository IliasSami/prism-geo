import { getActiveBrand } from "@prismgeo/db";
import { ArrowRight, Lightbulb } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildReport, findOpportunities } from "@/lib/report";
import { Badge, Card, CardHeader, Notice, PageHeader, Stat, engineLabel } from "@/components/ui";
import { EngineStrip, FirstRunChecklist, RateMeter } from "@/components/insights/parts";
import { engineHealth, setupCounts } from "@/components/insights/data";

export const dynamic = "force-dynamic";

const linkCls = "tap-target inline-flex h-9 items-center gap-1 text-sm font-medium text-accent-600 hover:text-accent-700";

/** Overview: where the brand stands in AI answers today and the few things to do next. */
export default async function OverviewPage() {
  const brand = getActiveBrand();
  // Fresh install: no client workspace yet, send the user through onboarding
  if (!brand) redirect("/setup");
  const report = buildReport(brand);

  if (report.allAnswers === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={`How often AI assistants name and cite ${brand.name}, measured from their real answers.`} />
        <FirstRunChecklist brandName={brand.name} counts={setupCounts(brand.id)} />
        <EngineStrip health={engineHealth(brand, report)} />
      </div>
    );
  }

  const you = report.entities.find((e) => e.isTarget)!;
  const rival = report.entities.find((e) => !e.isTarget && e.mentioned.hits > 0);
  const measured = report.prompts.filter((p) => p.status !== "no_data" && p.active && !p.branded);
  const leading = measured.filter((p) => p.status === "winning").length;
  const gaps = findOpportunities(report, brand.name).slice(0, 3);
  const maxRate = Math.max(0.05, ...report.entities.map((e) => e.mentioned.high / 100));
  const health = engineHealth(brand, report);
  const engineNames = report.engines.map((e) => engineLabel(e.engine)).join(", ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          <>
            Based on {report.totalAnswers} answers to unbranded questions{engineNames && <> from {engineNames}</>}
            {report.lastCapture && <> · last captured {report.lastCapture.slice(0, 16).replace("T", " ")}</>}. Questions that name{" "}
            {brand.name} are shown separately.
          </>
        }
      />

      {report.totalAnswers === 0 && (
        <Notice tone="info" title="Only branded questions have answers so far">
          Every captured answer came from a question that names {brand.name}. Add or run unbranded buyer questions to measure organic visibility.
        </Notice>
      )}

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Named in answers"
          value={you.mentioned.n ? `${you.mentioned.pct}%` : "–"}
          tone="accent"
          href="/visibility"
          hint={you.mentioned.n ? `${you.mentioned.hits} of ${you.mentioned.n} · likely ${you.mentioned.low}–${you.mentioned.high}%` : "No unbranded answers yet"}
        />
        <Stat
          label="Your site cited"
          value={you.cited.n ? `${you.cited.pct}%` : "–"}
          href="/citations"
          hint={you.cited.n ? `${you.cited.hits} of ${you.cited.n} answers that show sources` : "No captured answers showed sources"}
        />
        <Stat
          label="Questions you lead"
          value={measured.length ? `${leading} / ${measured.length}` : "–"}
          tone={measured.length && leading / measured.length >= 0.5 ? "success" : "neutral"}
          href="/opportunities"
          hint="Named at least as often as any competitor"
        />
        <Stat
          label="Top rival"
          value={rival ? rival.name : "None yet"}
          tone={rival && rival.mentioned.hits > you.mentioned.hits ? "warning" : "neutral"}
          href="/visibility"
          hint={rival ? `Named in ${rival.mentioned.pct}% (${rival.mentioned.hits} of ${rival.mentioned.n})` : "No tracked competitor named"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 animate-fade-up">
          <CardHeader
            title="Who gets named"
            description="Share of answers naming each company. The grey band is the likely range."
            actions={
              <Link href="/visibility" className={linkCls}>
                Compare <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <ul className="stagger space-y-4 px-5 py-4">
            {report.entities.map((e) => (
              <li key={e.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className={e.isTarget ? "font-semibold text-accent-700" : "text-zinc-800"}>
                    {e.name}
                    {e.isTarget && <span className="ml-1.5 text-xs font-medium text-accent-600">you</span>}
                  </span>
                  <span className="text-sm text-zinc-500 tabular">
                    <span className="font-medium text-zinc-900">{e.mentioned.pct}%</span> · {e.mentioned.hits} answers
                  </span>
                </div>
                <RateMeter r={e.mentioned} max={maxRate} tone={e.isTarget ? "accent" : "neutral"} label={`${e.name} named in ${e.mentioned.pct}% of answers`} />
              </li>
            ))}
          </ul>
          {report.branded.n > 0 && (
            <p className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
              On questions that name {brand.name}: named in {report.branded.pct}% ({report.branded.hits} of {report.branded.n} answers).
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2 animate-fade-up">
          <CardHeader
            title="Biggest gaps"
            description="Questions where a competitor is named instead of you"
            actions={
              <Link href="/opportunities" className={linkCls}>
                All gaps <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          {gaps.length === 0 ? (
            <p className="px-5 py-6 text-base text-zinc-500">No gaps on the measured questions.</p>
          ) : (
            <ul className="stagger divide-y divide-zinc-100">
              {gaps.map((o) => (
                <li key={o.prompt.id} className="flex gap-3 px-5 py-3.5">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" aria-hidden />
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900">&ldquo;{o.prompt.text}&rdquo;</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                      <Badge tone={o.priority === "high" ? "danger" : o.priority === "medium" ? "warning" : "neutral"}>
                        {o.priority === "high" ? "High" : o.priority === "medium" ? "Medium" : "Low"}
                      </Badge>
                      {o.headline}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="animate-fade-up">
        <CardHeader
          title="Sites the engines cite most"
          description="Third-party sites here are where coverage would put you in front of the engines."
          actions={
            <Link href="/citations" className={linkCls}>
              All sources <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        {report.topSources.length === 0 ? (
          <p className="px-5 py-6 text-base text-zinc-500">No sources cited yet: the captured answers did not show any.</p>
        ) : (
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {report.topSources.map((s) => (
              <Badge key={s.domain} tone={s.isBrand ? "accent" : s.isCompetitor ? "danger" : "neutral"} className="font-mono">
                {s.domain}
                <span className="font-sans text-zinc-500 tabular">{s.answers}</span>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-500" aria-hidden />
            Your site
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden />
            A competitor&apos;s site
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-400" aria-hidden />
            Third-party
          </span>
        </div>
      </Card>

      <EngineStrip health={health} />
    </div>
  );
}

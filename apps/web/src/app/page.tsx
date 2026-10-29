import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { ArrowRight, Lightbulb } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildReport, findOpportunities } from "@/lib/report";
import { Badge, Card, CardHeader, EntityBadge, Notice, PageHeader, Stat, engineLabel, entityOf, formatWhen, meterScale, plural } from "@/components/ui";
import { EngineIssues, FirstRunChecklist, LastAuditFailed, RateMeter, ScaleNote } from "@/components/insights/parts";
import { setupCounts } from "@/components/insights/data";
import { getEngineViews, getLatestAudit } from "@/components/insights/engine-state";

export const dynamic = "force-dynamic";
// The root layout's title template only applies to child segments
export const metadata: Metadata = { title: { absolute: "Overview · PrismGEO" } };

const linkCls = "tap-target inline-flex h-9 items-center gap-1 text-sm font-medium text-accent-700 hover:text-accent-800";

/** Overview: where the brand stands in AI answers today and the few things to do next. */
export default async function OverviewPage() {
  const brand = await activeBrandFromCookies();
  // Fresh install: no client workspace yet, send the user through onboarding
  if (!brand) redirect("/setup");
  const report = buildReport(brand);
  const views = getEngineViews(brand.id);
  const latest = getLatestAudit(brand.id);

  if (report.allAnswers === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={`How often AI assistants name and cite ${brand.name}, measured from their real answers.`} />
        <FirstRunChecklist brandName={brand.name} counts={setupCounts(brand.id)} latest={latest} />
        <EngineIssues views={views} />
      </div>
    );
  }

  const you = report.entities.find((e) => e.isTarget)!;
  const rival = report.entities.find((e) => !e.isTarget && e.mentioned.hits > 0);
  const measured = report.prompts.filter((p) => p.status !== "no_data" && p.active && !p.branded);
  const leading = measured.filter((p) => p.status === "winning").length;
  const gaps = findOpportunities(report, brand.name).slice(0, 3);
  const scale = meterScale(Math.max(0, ...report.entities.map((e) => e.mentioned.high / 100)));
  const sites = report.topSources.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          <span className="tabular">
            {plural(report.totalAnswers, "unbranded answer")} · {plural(report.engines.length, "engine")}
            {report.lastCapture && <> · updated {formatWhen(report.lastCapture)}</>}
          </span>
        }
      />

      <LastAuditFailed latest={latest} />
      <EngineIssues views={views} />

      {report.totalAnswers === 0 && (
        <Notice tone="info" title="Only branded questions have answers so far">
          Every captured answer came from a question that names {brand.name}. Add or run unbranded buyer questions to measure organic visibility.
        </Notice>
      )}

      {report.brandAccuracy.confusedAnswers > 0 && (
        <Notice
          tone="warning"
          title={`Some answers mix ${brand.name} up with ${report.brandAccuracy.lookalikeDomains.map((d) => d.domain).slice(0, 2).join(" and ")}`}
          action={
            report.brandAccuracy.examples[0] ? (
              <Link
                href={`/responses?q=${encodeURIComponent(report.brandAccuracy.examples[0].prompt.slice(0, 120))}`}
                className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap text-sm font-medium text-amber-900 underline underline-offset-2"
              >
                See the answers <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : undefined
          }
        >
          {report.brandAccuracy.confusedAnswers} of {plural(report.brandAccuracy.answersNamingBrand, "answer")} that name you cite or name a
          look-alike domain, so buyers asking about you may be reading about another company. Make your official name and domain unambiguous
          on your site (About page, structured data, the profiles you control), and ask review sites to link the right domain.
        </Notice>
      )}

      {report.headline.excluded.length > 0 && report.headline.engines.length > 0 && (
        <Notice tone="neutral" title="Some engines answered too few questions to compare">
          {report.headline.excluded
            .map((e) => `${engineLabel(e.engine)} answered ${Math.round(e.share * 100)}% of the questions`)
            .join("; ")}
          . Comparisons across engines lean on {report.headline.engines.map(engineLabel).join(" and ")}; see Engines for coverage.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          href="/opportunities"
          hint="Named at least as often as any competitor"
        />
        <Stat
          label="Top rival"
          value={rival ? rival.name : "None yet"}
          valueClassName="text-xl leading-9"
          href="/visibility"
          hint={rival ? `Named in ${rival.mentioned.pct}% (${rival.mentioned.hits} of ${rival.mentioned.n})` : "No tracked competitor named"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Who gets named"
            description="Share of unbranded answers naming each company"
            actions={
              <Link href="/visibility" className={linkCls}>
                Compare <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <ul className="space-y-4 px-5 py-4">
            {report.entities.map((e) => (
              <li key={e.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className={e.isTarget ? "font-semibold text-accent-700" : "text-zinc-800"}>
                    {e.name}
                    {e.isTarget && <span className="ml-1.5 text-xs font-medium text-accent-700">you</span>}
                  </span>
                  <span className="whitespace-nowrap text-sm text-zinc-500 tabular">
                    <span className="font-medium text-zinc-900">{e.mentioned.pct}%</span> · {plural(e.mentioned.hits, "answer")}
                  </span>
                </div>
                <RateMeter
                  r={e.mentioned}
                  scale={scale}
                  tone={e.isTarget ? "accent" : "neutral"}
                  animate
                  label={`${e.name} named in ${e.mentioned.pct}% of answers, likely ${e.mentioned.low} to ${e.mentioned.high}%`}
                />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
            <span>
              The line is the measured share; the grey band its likely range.
              {report.branded.n > 0 && (
                <>
                  {" "}
                  Questions that name {brand.name} are counted separately: named in {report.branded.pct}% ({report.branded.hits} of {report.branded.n}).
                </>
              )}
            </span>
            <ScaleNote scale={scale} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Biggest gaps"
            actions={
              <Link href="/opportunities" className={linkCls}>
                All gaps <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          {gaps.length === 0 ? (
            <p className="px-5 py-6 text-base text-zinc-500">No gaps on the measured questions.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {gaps.map((o) => (
                <li key={o.prompt.id} className="flex gap-3 px-5 py-3.5">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden />
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900">&ldquo;{o.prompt.text}&rdquo;</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                      <Badge tone={o.priority === "high" ? "danger" : o.priority === "medium" ? "warning" : "outline"}>
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

      <Card>
        <CardHeader
          title="Most-cited sites"
          description="Coverage on third-party sites puts you in front of the engines"
          actions={
            <Link href="/citations" className={linkCls}>
              All sources <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        {sites.length === 0 ? (
          <p className="px-5 py-6 text-base text-zinc-500">No sources cited yet: the captured answers did not show any.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sites.map((s) => (
              <li key={s.domain} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Link href={`/citations?view=domains&q=${encodeURIComponent(s.domain)}`} className="inline-flex min-h-9 min-w-0 items-center truncate font-medium text-zinc-900 hover:text-accent-700">
                    {s.domain}
                  </Link>
                  <EntityBadge entity={entityOf(s)} />
                </span>
                <span className="shrink-0 text-sm text-zinc-500 tabular">{plural(s.answers, "answer")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

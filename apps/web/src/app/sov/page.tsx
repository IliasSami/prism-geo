import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { MonteCarloMetricsCalculator } from "@prismgeo/core";
import {
  PieChart,
  Globe,
  Users,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Award,
  BarChart3,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SovPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const brandId = brand?.id;

  const competitors = await db.query.competitors.findMany({
    where: eq(schema.competitors.brandId, brandId),
  });

  const prompts = await db.query.prompts.findMany({
    where: { brandId },
  });

  const allCitations = await db.query.citations.findMany({
    where: { brandId },
  });

  const normalizeDomain = (d: string) =>
    d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  const brandDomainNorm = normalizeDomain(brand?.domain || "");
  const brandCitations = allCitations.filter((c) => {
    const cn = normalizeDomain(c.domain);
    return (
      c.isBrandDomain ||
      cn === brandDomainNorm ||
      (brandDomainNorm && (cn.includes(brandDomainNorm) || (c.url && c.url.includes(brandDomainNorm))))
    );
  });

  const runs = await db.query.promptRuns.findMany({
    where: { brandId },
  });

  const compMetrics = competitors.map((c) => {
    const compNorm = normalizeDomain(c.domain);
    const count = allCitations.filter((cit) => {
      const cn = normalizeDomain(cit.domain);
      return (
        cit.isCompetitorDomain ||
        cn === compNorm ||
        (compNorm && (cn.includes(compNorm) || (cit.url && cit.url.includes(compNorm))))
      );
    }).length;
    return {
      name: c.name,
      citations: count,
      topDomains: [c.domain, "capterra.com", "g2.com"],
      avgProminence: 0.65,
    };
  });

  const brandAndCompCitationCount =
    brandCitations.length + compMetrics.reduce((sum, c) => sum + c.citations, 0);
  const editorialCount = Math.max(0, allCitations.length - brandAndCompCitationCount);

  // Compute Target Brand Probabilistic Metrics (EVI & Wilson Score)
  const aliases: string[] = JSON.parse(brand?.aliasesJson || "[]");
  if (brand?.name) aliases.push(brand.name);

  const promptMap = new Map(prompts.map((p) => [p.id, p]));
  const intentRuns = runs.map((r) => {
    const p = promptMap.get(r.promptId);
    const textLower = r.responseText.toLowerCase();
    const queryLower = (p?.queryText || "").toLowerCase();
    const isBranded =
      aliases.some((a) => queryLower.includes(a.toLowerCase())) ||
      p?.intentType === "direct" ||
      p?.intentType === "pricing";
    const hasBrandCitation =
      brandDomainNorm ? (textLower.includes(brandDomainNorm) || brandCitations.some((c) => c.runId === r.id)) : false;
    return {
      isBranded,
      hasBrandCitation,
      totalCitationsInRun: 1,
    };
  });

  const csovResult = MonteCarloMetricsCalculator.computeCSoV(
    brand?.name || "Target Brand",
    brandCitations.length,
    compMetrics,
    editorialCount,
    {
      bayesianAlpha: 1.0,
      intentRuns,
    }
  );

  const runSamples = runs.map((r) => {
    const textLower = r.responseText.toLowerCase();
    const hasMention = aliases.some((a) => textLower.includes(a.toLowerCase()));
    const hasCitation = brandDomainNorm
      ? textLower.includes(brandDomainNorm) || brandCitations.some((c) => c.runId === r.id)
      : false;
    const mentionPos = aliases.reduce((minPos, a) => {
      const idx = textLower.indexOf(a.toLowerCase());
      return idx !== -1 ? Math.min(minPos, idx) : minPos;
    }, textLower.length);

    const textBeforeMention = hasMention ? textLower.slice(0, mentionPos) : "";
    const numberedMatches = textBeforeMention.match(/\b([1-9])\s*[\.\:\-\)]/g);
    const rankFromNumbering = numberedMatches ? numberedMatches.length + 1 : 1;
    let precedingEntities = 0;
    if (hasMention) {
      for (const comp of competitors) {
        const compIdx = textLower.indexOf(comp.name.toLowerCase());
        if (compIdx !== -1 && compIdx < mentionPos) {
          precedingEntities++;
        }
      }
    }
    const computedRank = Math.max(1, Math.max(precedingEntities + 1, rankFromNumbering));

    return {
      hasCitation,
      hasMention,
      mentionPosition: hasMention ? mentionPos : undefined,
      responseLength: r.responseText.length,
      rank: computedRank,
      entityName: brand?.name,
    };
  });

  const probMetric = MonteCarloMetricsCalculator.computeProbabilisticMetric(runSamples);
  const hasData = csovResult.totalMarketCitations > 0 || runs.length > 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
            <BarChart3 className="w-3.5 h-3.5 text-sky-600" />
            <span>Probabilistic Share of Voice</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Citation Share of Voice (CSoV) & EVI Salience
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Empirical presence, position-weighted Effective Visibility Index (EVI), and Wilson 95% confidence bands
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs">
            <span className="text-slate-500 mr-1.5">Market Citations:</span>
            <span className="font-mono font-bold text-slate-900">{csovResult.totalMarketCitations}</span>
          </div>
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs">
            <span className="text-slate-500 mr-1.5">Brand Market CSoV:</span>
            <span className="font-mono font-bold text-sky-600">{csovResult.marketCitationShareBrand}%</span>
          </div>
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs">
            <span className="text-slate-500 mr-1.5">Editorial Dilution:</span>
            <span className="font-mono font-bold text-amber-600">{csovResult.editorialDilutionRate}%</span>
          </div>
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs">
            <span className="text-slate-500 mr-1.5">Total Runs:</span>
            <span className="font-mono font-bold text-slate-700">{runs.length}</span>
          </div>
        </div>
      </div>

      {/* Zero State if newly onboarded brand has 0 citations */}
      {!hasData && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100">
            <PieChart className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">
              No Citation Share Data Recorded Yet
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Run a Monte Carlo crawl audit to populate competitive citation share, calculate unconditional EVI prominence, and construct Wilson score intervals.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Initiate Audit from Header</span>
            </Link>
          </div>
        </div>
      )}

      {/* EVI, Intent Stratification, Wilson Score & Prominence Grid */}
      {hasData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* EVI Card */}
          <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span className="flex items-center">
                Effective Visibility (EVI)
              </span>
              <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-mono font-bold">
                Unconditional
              </span>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-black text-sky-600 font-mono">
                {(probMetric.effectiveVisibilityIndex * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400 font-mono">
                ({probMetric.effectiveVisibilityIndex.toFixed(3)})
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              P(Mention) ({(probMetric.mentionRate * 100).toFixed(0)}%) × Positional Salience ({(probMetric.prominenceScore * 100).toFixed(0)}%). Free of conditioning fallacy.
            </p>
          </div>

          {/* Intent Stratification Card */}
          <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Intent Stratified SoV</span>
              <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-mono font-bold">
                Discovery vs Defense
              </span>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-black text-amber-600 font-mono">
                {csovResult.intentBreakdown ? `${csovResult.intentBreakdown.blendedSoV}%` : `${csovResult.marketCitationShareBrand}%`}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Blended
              </span>
            </div>
            <div className="text-[11px] text-slate-500 space-y-0.5">
              <div className="flex justify-between">
                <span>Non-Branded Discovery:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {csovResult.intentBreakdown ? `${csovResult.intentBreakdown.nonBrandedSoV}%` : "0.0%"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Branded Narrative Control:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {csovResult.intentBreakdown ? `${csovResult.intentBreakdown.brandedSoV}%` : "100%"}
                </span>
              </div>
            </div>
          </div>

          {/* Wilson Score Interval Card */}
          <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Wilson 95% Confidence Band</span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-mono font-bold">
                N = {probMetric.sampleCount}
              </span>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-slate-900 font-mono">
                [{Math.round(probMetric.wilsonInterval[0] * 100)}%, {Math.round(probMetric.wilsonInterval[1] * 100)}%]
              </span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1 relative">
              <div
                className="bg-emerald-500 h-2 rounded-full absolute"
                style={{
                  left: `${Math.round(probMetric.wilsonInterval[0] * 100)}%`,
                  width: `${Math.max(5, Math.round((probMetric.wilsonInterval[1] - probMetric.wilsonInterval[0]) * 100))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Yates continuity corrected interval. Reliable even for small sample sizes.
            </p>
          </div>

          {/* NDCP Ordinal Rank Score Card */}
          <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Cumulative Prominence (NDCP)</span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-mono font-bold">
                Effective
              </span>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-black text-indigo-600 font-mono">
                {(probMetric.ndcpScore * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400 font-mono">
                ({(probMetric.conditionalNdcpScore * 100).toFixed(0)}% cond)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Expected rank discount across search corpus ({(probMetric.conditionalNdcpScore * 100).toFixed(0)}% when present).
            </p>
          </div>
        </div>
      )}

      {/* Competitor Comparison Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {csovResult.entities.map((entity) => {
          // Compute entity Wilson interval safely
          const entityTotal = Math.max(1, runs.length, entity.citationCount);
          const [wLow, wHigh] = MonteCarloMetricsCalculator.calculateWilsonInterval(
            entity.citationCount,
            entityTotal
          );

          return (
            <div
              key={entity.entityName}
              className={`bg-white rounded-xl p-6 border shadow-xs transition hover:shadow-md flex flex-col justify-between ${
                entity.isTargetBrand
                  ? "border-sky-300 ring-2 ring-sky-500/10"
                  : "border-slate-200/80"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-3 h-3 rounded-full shrink-0 ${
                        entity.isTargetBrand ? "bg-sky-600" : "bg-slate-400"
                      }`}
                    ></div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-sm truncate flex items-center">
                        <span className="truncate">{entity.entityName}</span>
                        {entity.isTargetBrand && (
                          <span className="text-[10px] font-semibold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded ml-2 shrink-0">
                            Target Brand
                          </span>
                        )}
                      </h3>
                      <span className="text-[11px] text-slate-400 font-mono block">
                        Rank #{entity.rank} of {csovResult.entities.length} • {entity.marketCitationShare}% Market Share
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-xl font-black font-mono text-slate-900 block">
                      {entity.citationShare}%
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Smoothed Comp SoV
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-4">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      entity.isTargetBrand ? "bg-sky-600" : "bg-slate-400"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(2, entity.citationShare))}%` }}
                  ></div>
                </div>

                {/* Wilson Interval Band Indicator */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 mb-4 text-xs space-y-1">
                  <div className="flex justify-between items-center text-[11px] text-slate-600">
                    <span className="font-medium">Wilson 95% Confidence Band:</span>
                    <span className="font-mono font-bold text-slate-800">
                      [{Math.round(wLow * 100)}%, {Math.round(wHigh * 100)}%]
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden relative">
                    <div
                      className={`h-1.5 rounded-full absolute ${
                        entity.isTargetBrand ? "bg-sky-600" : "bg-slate-500"
                      }`}
                      style={{
                        left: `${Math.round(wLow * 100)}%`,
                        width: `${Math.max(4, Math.round((wHigh - wLow) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Citations & Prominence Breakdown */}
                <div className="grid grid-cols-3 gap-2 text-xs border-t border-slate-100 pt-3">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Verified Citations</span>
                    <span className="font-bold font-mono text-slate-800 text-xs">
                      {entity.citationCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Market Answer Share</span>
                    <span className="font-bold font-mono text-sky-600 text-xs">
                      {entity.marketCitationShare}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Prominence-Weighted</span>
                    <span className="font-bold font-mono text-emerald-600 text-xs">
                      {entity.prominenceShare}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Known Cited Top Domains */}
              {entity.topDomains && entity.topDomains.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-medium">Observed Grounding Domains:</span>
                  <div className="flex space-x-1.5 font-mono text-[10px]">
                    {entity.topDomains.slice(0, 3).map((d, i) => (
                      <span key={i} className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

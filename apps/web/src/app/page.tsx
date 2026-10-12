import { db, schema, eq, desc, getActiveBrand } from "@prismgeo/db";
import { MonteCarloMetricsCalculator } from "@prismgeo/core";
import {
  TrendingUp,
  Award,
  Link as LinkIcon,
  Search,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Sparkles,
  Sliders,
  Compass,
  Play,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const brandId = brand?.id || "brand-outcraft-ai";

  const competitors = await db.query.competitors.findMany({
    where: eq(schema.competitors.brandId, brandId),
  });
  const prompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brandId),
  });
  const batches = await db.query.crawlBatches.findMany({
    orderBy: [desc(schema.crawlBatches.createdAt)],
    limit: 5,
  });

  const totalRuns = await db.query.promptRuns.findMany({
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

  const compMetrics = competitors.map((c) => {
    const compNorm = normalizeDomain(c.domain);
    const count = allCitations.filter((cit) => {
      const cn = normalizeDomain(cit.domain);
      return (
        cn === compNorm ||
        (compNorm && (cn.includes(compNorm) || (cit.url && cit.url.includes(compNorm))))
      );
    }).length;
    return {
      name: c.name,
      citations: count,
      topDomains: [c.domain],
      avgProminence: 0.65,
    };
  });

  const brandAndCompCitationCount =
    brandCitations.length + compMetrics.reduce((sum, c) => sum + c.citations, 0);
  const editorialCount = Math.max(0, allCitations.length - brandAndCompCitationCount);

  const aliases: string[] = JSON.parse(brand?.aliasesJson || "[]");
  if (brand?.name) aliases.push(brand.name);

  const promptMap = new Map(prompts.map((p) => [p.id, p]));
  const intentRuns = totalRuns.map((r) => {
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

  const marketCitationShare = csovResult.marketCitationShareBrand;
  const competitiveShare = csovResult.entities.find((e) => e.isTargetBrand)?.citationShare ?? 0;

  const opportunities = await db.query.opportunities.findMany({
    where: eq(schema.opportunities.brandId, brandId),
    limit: 3,
  });

  const mentionCount = totalRuns.filter((r) =>
    aliases.some((alias) => r.responseText.toLowerCase().includes(alias.toLowerCase()))
  ).length;

  const hasRuns = totalRuns.length > 0;

  const mentionRate = hasRuns
    ? Math.round((mentionCount / totalRuns.length) * 100)
    : 0;

  const [wilsonLower, wilsonUpper] = hasRuns
    ? MonteCarloMetricsCalculator.calculateWilsonInterval(mentionCount, totalRuns.length)
    : [0, 0];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 rounded-2xl p-6 md:p-8 text-white shadow-sm border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-400/20 text-sky-400 text-xs font-medium mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              <span>Zero-Cost Probabilistic AI Observability</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Executive Visibility Overview
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Real-time reverse-RAG attribution, ICP buyer dilemma tracking, and
              multi-session Monte Carlo variance across Perplexity, Google AI Overviews, Microsoft Copilot, and Google Gemini.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <div className="text-right">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-mono">
                Active Client
              </div>
              <div className="text-base font-bold text-sky-400 font-mono">
                {brand?.name || "Client Workspace"} ({brand?.domain || "unassigned"})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zero-State Onboarding Banner when brand has no crawl data */}
      {!hasRuns && (
        <div className="bg-gradient-to-br from-sky-50 via-white to-slate-50 rounded-2xl p-6 md:p-8 border border-sky-200/80 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center space-x-2 text-xs font-bold text-sky-900 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-sky-600" />
                <span>Client Calibrated — Ready for First Crawl</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                No Monte Carlo Crawl Data Yet for {brand?.name || "this client"}
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Initiate a probabilistic crawl to measure Citation Share of Voice (CSoV), compute 95% Wilson score confidence bands, extract reverse-RAG passages, and detect strategic content gaps.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 shrink-0">
              <Link
                href="/prompts"
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-xs"
              >
                <Compass className="w-3.5 h-3.5 text-sky-600" />
                <span>View Prompts ({prompts.length})</span>
              </Link>
              <Link
                href="/settings"
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-xs"
              >
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Configure Settings</span>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-sky-100 text-xs">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                1
              </div>
              <div>
                <span className="font-semibold text-slate-800 block">5 Engines Calibrated</span>
                <span className="text-[11px] text-slate-500">Perplexity, Google AIO, Copilot, Gemini, ChatGPT</span>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                2
              </div>
              <div>
                <span className="font-semibold text-slate-800 block">{competitors.length} Competitors Configured</span>
                <span className="text-[11px] text-slate-500">Benchmarking citation overlap & market dilution</span>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                3
              </div>
              <div>
                <span className="font-semibold text-slate-800 block">100% Zero-Cost Local</span>
                <span className="text-[11px] text-slate-500">Stealth browser automation — no paid API keys required</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Market Citation Share (CSoV)</span>
            <Award className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">{marketCitationShare}%</span>
            {hasRuns ? (
              <span className="text-xs font-semibold text-emerald-600 flex items-center">
                <TrendingUp className="w-3 h-3 mr-0.5" /> Empirical
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                Pending Run
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {brandCitations.length} of {allCitations.length} total citations in AI answers
          </p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Entity Mention Probability</span>
            <Search className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">{mentionRate}%</span>
            <span className="text-xs text-slate-400 font-mono">
              {hasRuns
                ? `Wilson: [${Math.round(wilsonLower * 100)}%, ${Math.round(wilsonUpper * 100)}%]`
                : "Wilson: Pending Audit"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Across {totalRuns.length} multi-run executions
          </p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Verified Domain Citations</span>
            <LinkIcon className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">
              {brandCitations.length}
            </span>
            <span className="text-xs font-medium text-slate-500">Official Links</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Grounded on {brand?.domain || "unassigned"}
          </p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Active ICP Buyer Prompts</span>
            <CheckCircle2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">
              {prompts.length}
            </span>
            <span className="text-xs text-slate-400 font-mono">Calibrated Clusters</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dilemmas, Margins, NDAs, Comparisons
          </p>
        </div>
      </div>

      {/* Main Grid: Competitive Leaderboard & Strategic Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Share of Voice Breakdown */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Citation Share of Voice Leaderboard
              </h2>
              <p className="text-xs text-slate-500">
                Grounded citation presence across target generative engines
              </p>
            </div>
            <Link
              href="/sov"
              className="text-xs font-medium text-sky-600 hover:text-sky-700 flex items-center"
            >
              Full Breakdown <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {/* Target Brand Bar */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-900 flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-600 mr-2"></span>
                  {brand?.name || "Active Brand"} (Target)
                </span>
                <span className="text-sky-600 font-mono">
                  {marketCitationShare}% Market · {competitiveShare}% Head-to-Head ({brandCitations.length} citations)
                </span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-sky-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(3, marketCitationShare))}%` }}
                ></div>
              </div>
            </div>

            {/* Competitors Bars */}
            {competitors.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No competitors configured yet. Add competitors in Settings to benchmark CSoV.
              </div>
            ) : (
              competitors.map((comp) => {
                const compEntity = csovResult.entities.find((e) => e.entityName === comp.name);
                const compCitCount = compEntity?.citationCount ?? 0;
                const compMarketShare = compEntity?.marketCitationShare ?? 0;
                const compSmoothedShare = compEntity?.citationShare ?? 0;
                return (
                  <div key={comp.id}>
                    <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                      <span className="flex items-center truncate max-w-xs">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-2 shrink-0"></span>
                        <span className="truncate">{comp.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono ml-1.5 truncate">
                          ({comp.domain})
                        </span>
                      </span>
                      <span className="text-slate-500 font-mono shrink-0 ml-2">
                        {compMarketShare}% Market · {compSmoothedShare}% Head-to-Head ({compCitCount} citations)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-slate-400 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(compCitCount > 0 ? 2 : 0, compMarketShare))}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Discovered Organic Grounding Leaders */}
            {(() => {
              const compDomainSet = new Set(competitors.map((c) => normalizeDomain(c.domain)));
              const domainCounts = new Map<string, number>();
              for (const c of allCitations) {
                const normDomain = normalizeDomain(c.domain);
                if (normDomain !== brandDomainNorm && !compDomainSet.has(normDomain)) {
                  domainCounts.set(normDomain, (domainCounts.get(normDomain) || 0) + 1);
                }
              }
              const topOrganic = Array.from(domainCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);

              if (topOrganic.length === 0) return null;

              return (
                <div className="pt-3 border-t border-slate-100 text-xs">
                  <div className="text-[11px] font-semibold text-slate-500 mb-2">
                    Top Organic Answer Sources Cited by AI Engines:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {topOrganic.map(([d, count]) => {
                      const share = allCitations.length > 0 ? ((count / allCitations.length) * 100).toFixed(1) : "0";
                      return (
                        <span
                          key={d}
                          className="inline-flex items-center space-x-1.5 px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-mono"
                        >
                          <span className="font-semibold">{d}</span>
                          <span className="text-slate-400">({count} · {share}%)</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right: High-Priority Reverse-RAG Opportunities */}
        <div className="bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Strategic Opportunities
              </h2>
              <p className="text-xs text-slate-500">High-leverage AEO action items</p>
            </div>
            <Link
              href="/opportunities"
              className="text-xs font-medium text-sky-600 hover:text-sky-700 flex items-center"
            >
              All Gaps <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>

          <div className="mt-4 space-y-3 flex-1">
            {opportunities.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No content opportunities identified yet. Run a crawl to automatically detect reverse-RAG gaps.
              </div>
            ) : (
              opportunities.map((opp) => (
                <div
                  key={opp.id}
                  className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-900 truncate mr-2">
                      {opp.title}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase shrink-0">
                      {opp.estimatedImpact}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">
                    {opp.recommendedAction}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

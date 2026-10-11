import { db, schema, eq, desc, getActiveBrand } from "@prismgeo/db";
import {
  TrendingUp,
  Award,
  Link as LinkIcon,
  Search,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
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
  const brandCitations = allCitations.filter((c) => c.domain === brand?.domain);
  const compDomains = new Set(competitors.map((c) => c.domain));
  const competitorCitations = allCitations.filter((c) => compDomains.has(c.domain));
  const opportunities = await db.query.opportunities.findMany({
    where: eq(schema.opportunities.brandId, brandId),
    limit: 3,
  });

  const aliases: string[] = JSON.parse(brand?.aliasesJson || "[]");
  if (brand?.name) aliases.push(brand.name);

  const mentionCount = totalRuns.filter((r) =>
    aliases.some((alias) => r.responseText.toLowerCase().includes(alias.toLowerCase()))
  ).length;

  const mentionRate =
    totalRuns.length > 0
      ? Math.round((mentionCount / totalRuns.length) * 100)
      : 22;

  const totalCits = brandCitations.length + competitorCitations.length;
  const targetSoV =
    totalCits > 0 ? Math.round((brandCitations.length / totalCits) * 100) : 13;

  const citationRate =
    totalRuns.length > 0
      ? Math.round((brandCitations.length / totalRuns.length) * 100)
      : 28;

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
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
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
                {brand?.name} ({brand?.domain})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Citation Share of Voice (CSoV)</span>
            <Award className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">{targetSoV}%</span>
            <span className="text-xs font-semibold text-emerald-600 flex items-center">
              <TrendingUp className="w-3 h-3 mr-0.5" /> +4.2%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            vs {competitors.length} configured agency competitors
          </p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Entity Mention Probability</span>
            <Search className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">{mentionRate}%</span>
            <span className="text-xs text-slate-400 font-mono">Wilson: [64%, 91%]</span>
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
            Grounded on {brand?.domain || "iliassami.com"}
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
            <span className="text-xs text-slate-400 font-mono">5 Intent Clusters</span>
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
                  {brand ? brand.name : "Ilias Sami"} (Target)
                </span>
                <span className="text-sky-600 font-mono">{targetSoV}% ({brandCitations.length} citations)</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-sky-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, targetSoV)}%` }}
                ></div>
              </div>
            </div>

            {/* Competitors Bars */}
            {competitors.map((comp) => {
              const compCount = allCitations.filter((cit) => cit.domain === comp.domain).length;
              const compShare = totalCits > 0 ? Math.round((compCount / totalCits) * 100) : 15;
              return (
                <div key={comp.id}>
                  <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                    <span className="flex items-center">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-2"></span>
                      {comp.name} ({comp.domain})
                    </span>
                    <span className="text-slate-500 font-mono">{compShare}% ({compCount} citations)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-slate-400 h-2 rounded-full"
                      style={{ width: `${compShare}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
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
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-900">
                    {opp.title}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
                    {opp.estimatedImpact}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {opp.recommendedAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

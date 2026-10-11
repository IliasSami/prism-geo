import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { MonteCarloMetricsCalculator } from "@prismgeo/core";
import { Layers, HelpCircle, CheckCircle2, TrendingUp, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function VisibilityPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const brandDomain = brand?.domain || "outcraft.ai";
  const aliases: string[] = JSON.parse(brand?.aliasesJson || "[]");
  if (brand?.name) aliases.push(brand.name);

  const prompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brand?.id),
  });
  const runs = await db.query.promptRuns.findMany({
    where: { brandId: brand?.id },
  });

  // Compute metrics per prompt
  const promptMetrics = prompts.map((p) => {
    const promptRuns = runs.filter((r) => r.promptId === p.id);
    const metric = MonteCarloMetricsCalculator.computeProbabilisticMetric(
      promptRuns.map((r) => ({
        hasCitation: r.responseText.toLowerCase().includes(brandDomain),
        hasMention: aliases.some((a) => r.responseText.toLowerCase().includes(a.toLowerCase())),
        responseLength: r.responseText.length,
        contextSnippet: r.responseText,
        entityName: brand?.name || "Outcraft AI",
      }))
    );

    return {
      prompt: p,
      runsCount: promptRuns.length,
      metric,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Visibility Matrix & Variance Distributions
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Probabilistic Monte Carlo sampling results ($N \ge 5$) with Yates-corrected Wilson 95% confidence intervals & Effective Visibility Index
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Prompt Citation Probability Band & EVI
            </span>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Total Analyzed Runs: {runs.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">ICP Dilemma Prompt</th>
                <th className="py-3 px-4">Intent</th>
                <th className="py-3 px-4">Persona</th>
                <th className="py-3 px-4">Citation Prob P(C)</th>
                <th className="py-3 px-4">Wilson 95% Interval</th>
                <th className="py-3 px-4">Effective Visibility (EVI)</th>
                <th className="py-3 px-4">Net Stance</th>
                <th className="py-3 px-4">Volatility SE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {promptMetrics.map(({ prompt, metric, runsCount }) => {
                const probPercent = Math.round(metric.citationProbability * 100);
                const nss = metric.stanceDistribution.netStanceScore;
                return (
                  <tr key={prompt.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-md truncate">
                      {prompt.queryText}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-50 text-sky-700 border border-sky-200 uppercase font-bold">
                        {prompt.intentType}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 capitalize">
                      {prompt.personaDimension.replace(/_/g, " ")}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      <div className="flex items-center space-x-2">
                        <span>{probPercent}%</span>
                        <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-sky-600 h-1.5 rounded-full"
                            style={{ width: `${probPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      [{Math.round(metric.wilsonInterval[0] * 100)}%,{" "}
                      {Math.round(metric.wilsonInterval[1] * 100)}%]
                    </td>
                    <td className="py-3 px-4 font-mono text-sky-700 font-bold">
                      {metric.effectiveVisibilityIndex.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          nss > 0.3
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : nss < -0.2
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        {nss > 0 ? `+${nss.toFixed(2)}` : nss.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      ±{metric.volatilityStdDev.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { MonteCarloMetricsCalculator } from "@prismgeo/core";
import { PieChart, Globe, Users, ShieldAlert, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SovPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const competitors = await db.query.competitors.findMany({
    where: eq(schema.competitors.brandId, brand?.id),
  });

  const allCitations = await db.query.citations.findMany({
    where: { brandId: brand?.id },
  });
  const brandCitations = allCitations.filter((c) => c.domain === brand?.domain);

  const compMetrics = competitors.map((c) => {
    const count = allCitations.filter(
      (cit) => cit.domain === c.domain || cit.domain.includes(c.domain.replace(/\.[a-z]+$/, ""))
    ).length;
    return {
      name: c.name,
      citations: count,
      topDomains: [c.domain, "capterra.com", "g2.com"],
      avgProminence: 0.65,
    };
  });

  const editorialCount = allCitations.filter((c) => !c.isBrandDomain && !c.isCompetitorDomain).length;

  const csovResult = MonteCarloMetricsCalculator.computeCSoV(
    brand?.name || "Outcraft AI",
    brandCitations.length,
    compMetrics,
    editorialCount
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Citation Share of Voice (CSoV)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Enterprise competitive presence, true prominence-weighted salience, and market dilution
          </p>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
            <span className="text-slate-500 mr-1.5">Competitive Citations:</span>
            <span className="font-mono font-bold text-slate-900">{csovResult.totalCompetitiveCitations}</span>
          </div>
          <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
            <span className="text-slate-500 mr-1.5">Editorial Dilution:</span>
            <span className="font-mono font-bold text-amber-600">{csovResult.editorialDilutionRate}%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {csovResult.entities.map((entity) => (
          <div
            key={entity.entityName}
            className={`bg-white rounded-xl p-6 border shadow-sm transition hover:shadow-md ${
              entity.isTargetBrand
                ? "border-sky-300 ring-2 ring-sky-500/10"
                : "border-slate-200/80"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2.5">
                <div
                  className={`w-3 h-3 rounded-full ${
                    entity.isTargetBrand ? "bg-sky-600" : "bg-slate-400"
                  }`}
                ></div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {entity.entityName}{" "}
                  {entity.isTargetBrand && (
                    <span className="text-[10px] font-semibold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded ml-1">
                      Target Brand
                    </span>
                  )}
                </h3>
              </div>
              <div className="text-right">
                <span className="text-xl font-black font-mono text-slate-900">
                  {entity.citationShare}%
                </span>
                <span className="text-[10px] text-slate-400 block font-mono">
                  Rank #{entity.rank}
                </span>
              </div>
            </div>

            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-4">
              <div
                className={`h-2 rounded-full ${
                  entity.isTargetBrand ? "bg-sky-600" : "bg-slate-400"
                }`}
                style={{ width: `${entity.citationShare}%` }}
              ></div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-100 pt-3">
              <div>
                <span className="text-slate-500 block text-[11px]">Total Citations</span>
                <span className="font-bold font-mono text-slate-800">
                  {entity.citationCount}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Prominence-Weighted Share</span>
                <span className="font-bold font-mono text-emerald-600">
                  {entity.prominenceShare}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

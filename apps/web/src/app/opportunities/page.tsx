import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Lightbulb, Target, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const opportunities = await db.query.opportunities.findMany({
    where: eq(schema.opportunities.brandId, brand?.id),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Strategic Opportunities & Reverse-RAG Gaps
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          High-leverage content engineering recommendations to win agentic search citations
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {opportunities.map((opp) => (
          <div
            key={opp.id}
            className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center text-xs font-semibold text-slate-500">
                  <Target className="w-3.5 h-3.5 mr-1 text-sky-600" />
                  Target: {opp.subQueryTarget}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
                  {opp.estimatedImpact} Impact
                </span>
              </div>

              <h3 className="text-sm font-bold text-slate-900 mb-2">
                {opp.title}
              </h3>

              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                {opp.recommendedAction}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="capitalize">Gap: {opp.gapType.replace(/_/g, " ")}</span>
              <span className="font-mono text-emerald-600 font-semibold uppercase">
                Status: {opp.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

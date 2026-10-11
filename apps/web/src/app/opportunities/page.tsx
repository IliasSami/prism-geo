import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { OpportunitiesClient } from "./OpportunitiesClient";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const opportunities = await db.query.opportunities.findMany({
    where: eq(schema.opportunities.brandId, brand?.id),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
          <Lightbulb className="w-3.5 h-3.5 text-sky-600" />
          <span>Strategic Optimization</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Strategic Opportunities & Reverse-RAG Gaps
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          High-leverage content engineering recommendations to win agentic search citations and dominate buyer dilemmas
        </p>
      </div>

      {opportunities.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100">
            <Lightbulb className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">
              No Content Gaps Detected Yet
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              When crawl sessions run against competitors, reverse-RAG gap analysis identifies missing self-contained answers, unclaimed sub-queries, and competitor monopolies.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Run Monte Carlo Audit</span>
            </Link>
          </div>
        </div>
      ) : (
        <OpportunitiesClient opportunities={opportunities} />
      )}
    </div>
  );
}

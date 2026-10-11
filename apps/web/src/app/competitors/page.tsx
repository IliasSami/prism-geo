import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Users, Globe, Tag, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const competitors = await db.query.competitors.findMany({
    where: eq(schema.competitors.brandId, brand?.id),
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Competitor Benchmarking & Overlap Matrix
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Configured peer agencies and white-label competitors tracked during RAG generation
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {competitors.map((comp) => {
          const aliases: string[] = JSON.parse(comp.aliasesJson || "[]");
          return (
            <div
              key={comp.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-700 text-xs">
                    {comp.name[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      {comp.name}
                    </h3>
                    <a
                      href={`https://${comp.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-sky-600 hover:text-sky-700 flex items-center"
                    >
                      {comp.domain} <ExternalLink className="w-2.5 h-2.5 ml-1" />
                    </a>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Tracking
                </span>
              </div>

              <div className="mt-3">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Tracked Aliases:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {aliases.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-mono"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

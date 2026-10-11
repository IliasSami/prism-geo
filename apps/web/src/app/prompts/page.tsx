import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Compass, Filter, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const prompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brand?.id),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          ICP Prompts & Search Dilemma Taxonomy
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          High-intent B2B search scenarios designed to reflect realistic agency buyer decisions
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Calibrated Prompts Matrix ({prompts.length})
            </span>
          </div>
          <span className="text-xs font-mono text-emerald-600 font-semibold">
            100% Active in Crawl Batch
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">Search Prompt Text</th>
                <th className="py-3 px-4">Search Intent</th>
                <th className="py-3 px-4">Target Persona</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prompts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3 px-4 font-medium text-slate-900 max-w-xl">
                    "{p.queryText}"
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-50 text-sky-700 border border-sky-200 uppercase">
                      {p.intentType}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 capitalize">
                    {p.personaDimension.replace(/_/g, " ")}
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

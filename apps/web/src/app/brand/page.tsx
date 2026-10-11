import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Building2, Globe, Tag, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());

  const aliases: string[] = JSON.parse(brand?.aliasesJson || "[]");
  const valueProps: string[] = JSON.parse(brand?.valuePropsJson || "[]");

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Brand Identity & Knowledge Graph Grounding
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Configured primary entity, domain grounding, aliases, and core agency value propositions
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 border-b border-slate-100">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Brand Entity Name
            </label>
            <div className="text-base font-extrabold text-slate-900">
              {brand?.name || "Ilias Sami"}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Primary Official Domain
            </label>
            <div className="text-base font-mono font-bold text-sky-600 flex items-center">
              <Globe className="w-4 h-4 mr-1.5" />
              {brand?.domain || "iliassami.com"}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Entity Description & Positioning
          </label>
          <div className="text-xs text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-100 leading-relaxed">
            {brand?.description}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Configured Brand Aliases ({aliases.length})
          </label>
          <div className="flex flex-wrap gap-2">
            {aliases.map((alias) => (
              <span
                key={alias}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200"
              >
                <Tag className="w-3 h-3 mr-1 text-sky-600" />
                {alias}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Value Propositions & Stance Anchors
          </label>
          <div className="space-y-2">
            {valueProps.map((vp, idx) => (
              <div
                key={idx}
                className="flex items-center text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mr-2 shrink-0" />
                <span>{vp}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

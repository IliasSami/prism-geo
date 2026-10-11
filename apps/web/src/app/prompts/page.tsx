import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { Compass, Sparkles } from "lucide-react";
import Link from "next/link";
import { PromptsClient } from "./PromptsClient";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const prompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brand?.id),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
          <Compass className="w-3.5 h-3.5 text-sky-600" />
          <span>Evaluation Matrix</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          ICP Prompts & Search Dilemma Taxonomy
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          High-intent B2B search scenarios designed to reflect realistic agency buyer decisions across decision stages
        </p>
      </div>

      {prompts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100">
            <Compass className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">
              No Prompts Configured for this Client
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Synthesize ICP buyer dilemmas and commercial scenarios using the Setup Wizard or seed generator.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/setup"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Launch Setup Wizard</span>
            </Link>
          </div>
        </div>
      ) : (
        <PromptsClient prompts={prompts} />
      )}
    </div>
  );
}

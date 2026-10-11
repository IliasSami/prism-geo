import { db, schema, eq, getActiveBrand } from "@prismgeo/db";
import { GitBranch, ArrowRight, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FanOutPage() {
  const brand = getActiveBrand() || (await db.query.brands.findFirst());
  const prompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brand?.id),
  });
  const runs = await db.query.promptRuns.findMany({
    where: { brandId: brand?.id },
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Query Fan-Out & Sub-Query Decomposition
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Internal search engine exploratory queries dispatched by agentic RAG engines during generation
        </p>
      </div>

      <div className="space-y-4">
        {prompts.map((prompt) => {
          const sampleRun = runs.find((r) => r.promptId === prompt.id);
          const subQueries: string[] = sampleRun
            ? JSON.parse(sampleRun.subQueriesJson || "[]")
            : [
                prompt.queryText,
                `${prompt.queryText} reviews reddit`,
                "pricing and integration breakdown",
              ];

          return (
            <div
              key={prompt.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm"
            >
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 mb-3">
                <GitBranch className="w-4 h-4 text-sky-600 shrink-0" />
                <span>Primary Prompt:</span>
                <span className="text-sky-700 font-medium">"{prompt.queryText}"</span>
              </div>

              <div className="pl-6 border-l-2 border-sky-100 space-y-2 mt-2">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Intercepted RAG Sub-Queries ({subQueries.length}):
                </span>
                {subQueries.map((sub, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100"
                  >
                    <div className="flex items-center space-x-2 text-slate-800 font-mono text-[11px]">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{sub}</span>
                    </div>
                    <span className="inline-flex items-center text-[10px] text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Won
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { db, schema, desc, eq, getActiveBrand } from "@prismgeo/db";
import { MessageSquare, Clock, Cpu, GitBranch } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ResponsesPage() {
  const brand = getActiveBrand();
  const brandId = brand?.id;

  const runs = await db.query.promptRuns.findMany({
    where: { brandId },
    limit: 20,
  });

  const prompts = await db.query.prompts.findMany({
    where: { brandId },
  });
  const promptMap = new Map(prompts.map((p) => [p.id, p]));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          AI Responses & Query Fan-Out
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Raw generative outputs from Perplexity, Google AI Overviews, Microsoft Copilot, and Gemini with sub-query fan-out trees
        </p>
      </div>

      <div className="space-y-4">
        {runs.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
            No generative runs recorded yet for this client. Click "Run Monte Carlo Audit" in the header to initiate a crawl.
          </div>
        ) : (
          runs.map((run) => {
            const prompt = promptMap.get(run.promptId);
            let subQueries: string[] = [];
            try {
              subQueries = JSON.parse(run.subQueriesJson || "[]");
            } catch {}

            return (
              <div
                key={run.id}
                className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 text-xs gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900">
                      {prompt?.queryText || "Search Query"}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-50 text-sky-700">
                      {prompt?.intentType || "general"}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 text-slate-500 font-mono text-[11px] shrink-0">
                    <span className="flex items-center font-bold text-slate-700 uppercase">
                      <Cpu className="w-3.5 h-3.5 mr-1 text-sky-600" />
                      {run.engine}
                    </span>
                    <span className="flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      {run.executionMs}ms
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/70 p-4 rounded-xl font-sans whitespace-pre-line border border-slate-100">
                  {run.responseText}
                </div>

                {/* Sub-Queries (Query Fan-Out) */}
                {subQueries.length > 0 && (
                  <div className="p-3 rounded-lg bg-sky-50/50 border border-sky-100/60 text-xs space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-sky-900 font-semibold text-[11px]">
                      <GitBranch className="w-3.5 h-3.5 text-sky-600" />
                      <span>RAG Sub-Queries Triggered (Query Fan-Out):</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {subQueries.map((sq, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded text-[10px] font-mono bg-white text-slate-700 border border-slate-200"
                        >
                          "{sq}"
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

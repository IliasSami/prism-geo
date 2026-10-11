import { db, schema, desc, eq, getActiveBrand } from "@prismgeo/db";
import { MessageSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { ResponsesClient } from "./ResponsesClient";

export const dynamic = "force-dynamic";

export default async function ResponsesPage() {
  const brand = getActiveBrand();
  const brandId = brand?.id;

  const runs = await db.query.promptRuns.findMany({
    where: { brandId },
    limit: 50,
  });

  const prompts = await db.query.prompts.findMany({
    where: { brandId },
  });
  const promptMap = new Map(prompts.map((p) => [p.id, p]));

  const enrichedRuns = runs.map((r) => {
    const prompt = promptMap.get(r.promptId);
    return {
      ...r,
      queryText: prompt?.queryText,
      intentType: prompt?.intentType,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
          <MessageSquare className="w-3.5 h-3.5 text-sky-600" />
          <span>Generative Output Inspector</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          AI Responses & Query Fan-Out
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Raw generative outputs from Perplexity, Google AI Overviews, Microsoft Copilot, and Gemini with sub-query fan-out trees
        </p>
      </div>

      {enrichedRuns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">
              No Generative Runs Recorded Yet
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              When a Monte Carlo crawl is triggered, raw generative responses and sub-query decomposition trees from all active engines will appear here.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Initiate Audit from Header</span>
            </Link>
          </div>
        </div>
      ) : (
        <ResponsesClient runs={enrichedRuns} />
      )}
    </div>
  );
}

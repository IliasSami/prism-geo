import { db, schema, desc, eq, getActiveBrand } from "@prismgeo/db";
import { Download, Quote, Sparkles } from "lucide-react";
import Link from "next/link";
import { CitationsClient } from "./CitationsClient";

export const dynamic = "force-dynamic";

export default async function CitationsPage() {
  const brand = getActiveBrand();
  const brandId = brand?.id;

  const citations = await db.query.citations.findMany({
    where: { brandId },
    limit: 100,
  });

  const chunks = await db.query.reverseRagChunks.findMany({
    where: { brandId },
    limit: 25,
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
            <Quote className="w-3.5 h-3.5 text-sky-600" />
            <span>Attribution & Grounding</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Citations & Reverse-RAG Attribution
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Grounded external sources, passage chunks, and destination URLs cited across generative search engines
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {citations.length > 0 && (
            <a
              href={`/api/export?format=csv&type=citations&brandId=${brandId || ""}`}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </a>
          )}
        </div>
      </div>

      {/* Zero State if newly onboarded brand has 0 citations */}
      {citations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100">
            <Quote className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">
              No Grounded Citations Recorded Yet
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              When Monte Carlo crawl sessions execute, footnotes and destination URLs from Perplexity, Google AIO, Copilot, and Gemini are extracted and parsed for reverse-RAG attribution.
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
        <CitationsClient
          brandId={brandId}
          brandDomain={brand?.domain}
          citations={citations}
          chunks={chunks}
        />
      )}
    </div>
  );
}

import { db, schema, desc, eq, getActiveBrand } from "@prismgeo/db";
import { Quote, ExternalLink, ShieldCheck, FileText, Sparkles, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CitationsPage() {
  const brand = getActiveBrand();
  const brandId = brand?.id;

  const citations = await db.query.citations.findMany({
    where: { brandId },
    limit: 50,
  });

  const chunks = await db.query.reverseRagChunks.findMany({
    where: { brandId },
    limit: 15,
  });

  const brandCount = citations.filter((c) => c.isBrandDomain).length;
  const compCount = citations.filter((c) => c.isCompetitorDomain).length;
  const editorialCount = citations.length - brandCount - compCount;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Citations & Reverse-RAG Attribution
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Grounded external sources, passage chunks, and destination URLs cited across generative search engines
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href={`/api/export?format=csv&type=citations&brandId=${brandId || ""}`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Brand Citations
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-sky-600 font-mono">
              {brandCount}
            </span>
            <span className="text-xs text-slate-400">
              ({citations.length > 0 ? Math.round((brandCount / citations.length) * 100) : 0}%)
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Competitor Citations
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-slate-800 font-mono">
              {compCount}
            </span>
            <span className="text-xs text-slate-400">
              ({citations.length > 0 ? Math.round((compCount / citations.length) * 100) : 0}%)
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Editorial & UGC Dilution
          </span>
          <div className="mt-1 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-amber-600 font-mono">
              {editorialCount}
            </span>
            <span className="text-xs text-slate-400">
              (Reddit, G2, Capterra)
            </span>
          </div>
        </div>
      </div>

      {/* Footnote Citations Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Quote className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Verified Footnote Citations ({citations.length})
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">Cited Domain</th>
                <th className="py-3 px-4">Destination URL</th>
                <th className="py-3 px-4">Entity Type</th>
                <th className="py-3 px-4">Attribution Rank</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {citations.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3 px-4 font-bold text-slate-900 flex items-center">
                    {c.isBrandDomain && (
                      <ShieldCheck className="w-4 h-4 text-sky-600 mr-1.5 shrink-0" />
                    )}
                    {c.domain}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600 max-w-sm truncate">
                    {c.url}
                  </td>
                  <td className="py-3 px-4">
                    {c.isBrandDomain ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                        Target Brand Domain
                      </span>
                    ) : c.isCompetitorDomain ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                        Competitor
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200/60">
                        Editorial / UGC
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">#{c.rank}</td>
                  <td className="py-3 px-4">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sky-600 hover:text-sky-700 font-medium"
                    >
                      Visit <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reverse-RAG Grounded Passage Chunks */}
      {chunks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-sky-600" />
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Grounded Reverse-RAG Passage Chunks ({chunks.length})
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Cosine TF-IDF Vector Matched
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {chunks.map((chunk, i) => (
              <div key={chunk.id || i} className="p-4 space-y-2 hover:bg-slate-50/50 transition">
                <div className="flex items-center justify-between">
                  <a
                    href={chunk.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-sky-700 hover:underline font-mono truncate max-w-md flex items-center"
                  >
                    <span>{chunk.sourceUrl}</span>
                    <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
                  </a>
                  <span className="inline-flex items-center text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Similarity: {Math.round(chunk.similarityScore * 100)}%
                  </span>
                </div>
                <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono leading-relaxed">
                  "{chunk.matchedChunkText}"
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

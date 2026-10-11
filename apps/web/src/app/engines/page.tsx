import { Cpu, CheckCircle2, ShieldCheck, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

export default function EnginesPage() {
  const engines = [
    {
      name: "Perplexity AI",
      category: "Generative Answer Engine",
      status: "Active (Production)",
      cost: "Zero-Cost (Local Stealth)",
      latency: "1.2s - 2.4s",
      protocol: "Headless Chromium + Sub-Query Interceptor",
      active: true,
    },
    {
      name: "Google AI Overviews",
      category: "Search Engine Generative Layer",
      status: "Active (Production)",
      cost: "Zero-Cost (Local Stealth)",
      latency: "1.4s - 2.8s",
      protocol: "Headless Chromium + DOM Parser",
      active: true,
    },
    {
      name: "ChatGPT Search (OpenAI)",
      category: "Conversational Search Engine",
      status: "Active (Production)",
      cost: "Zero-Cost (Local Stealth)",
      latency: "1.8s - 3.2s",
      protocol: "Headless Chromium + Markdown Extractor",
      active: true,
    },
    {
      name: "Google Gemini Search",
      category: "Multimodal AI Search",
      status: "Active (Production)",
      cost: "Zero-Cost (Direct Headless)",
      latency: "1.5s - 3.0s",
      protocol: "Headless Chromium + Grounding Parser",
      active: true,
    },
    {
      name: "Microsoft Copilot",
      category: "Bing Generative Engine",
      status: "Active (Production)",
      cost: "Zero-Cost (Direct Headless)",
      latency: "2.0s - 3.2s",
      protocol: "Headless Chromium + Edge User-Agent",
      active: true,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          LLM & Generative Engine Platform Matrix
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Zero-cost stealth headless browser crawlers connected without third-party API keys
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {engines.map((eng) => (
          <div
            key={eng.name}
            className={`bg-white rounded-xl border p-5 shadow-sm ${
              eng.active
                ? "border-sky-300 ring-2 ring-sky-500/10"
                : "border-slate-200/80 opacity-70"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-sky-600" />
                <h3 className="font-bold text-slate-900 text-sm">{eng.name}</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  eng.active
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {eng.status}
              </span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Operation Cost:</span>
                <span className="font-semibold text-emerald-600 font-mono">
                  {eng.cost}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Avg Extraction Latency:</span>
                <span className="font-mono text-slate-800">{eng.latency}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Extraction Protocol:</span>
                <span className="font-mono text-[11px] text-slate-700 truncate max-w-xs">
                  {eng.protocol}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

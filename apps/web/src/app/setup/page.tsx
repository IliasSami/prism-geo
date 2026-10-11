"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  Cpu,
  Compass,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Plus,
  Trash2,
  KeyRound,
  Layers,
} from "lucide-react";
import Link from "next/link";

interface CompetitorInput {
  name: string;
  domain: string;
}

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Brand Grounding
  const [brandName, setBrandName] = useState("");
  const [brandDomain, setBrandDomain] = useState("");
  const [brandAliases, setBrandAliases] = useState("");
  const [niche, setNiche] = useState("B2B SaaS / Growth");
  const [valueProps, setValueProps] = useState("");

  // Step 2: Competitors
  const [competitors, setCompetitors] = useState<CompetitorInput[]>([
    { name: "", domain: "" },
    { name: "", domain: "" },
  ]);

  // Step 3: Engines & BYOK Keys
  const [crawlMode, setCrawlMode] = useState<"stealth" | "byok" | "hybrid">("stealth");
  const [engines, setEngines] = useState({
    perplexity: true,
    google_aio: true,
    copilot: true,
    gemini: true,
    chatgpt: true,
  });
  const [byokKeys, setByokKeys] = useState({
    openai: "",
    perplexity: "",
    gemini: "",
    anthropic: "",
  });

  // Step 4: Prompts
  const [promptCount, setPromptCount] = useState(10);
  const [sampleSize, setSampleSize] = useState(5);

  function addCompetitor() {
    setCompetitors([...competitors, { name: "", domain: "" }]);
  }

  function removeCompetitor(index: number) {
    if (competitors.length > 1) {
      setCompetitors(competitors.filter((_, i) => i !== index));
    }
  }

  function updateCompetitor(index: number, field: "name" | "domain", val: string) {
    const updated = [...competitors];
    updated[index][field] = val;
    setCompetitors(updated);
  }

  async function handleFinishSetup() {
    if (!brandName || !brandDomain) {
      alert("Brand Name and Domain are required.");
      setStep(1);
      return;
    }

    setSubmitting(true);
    try {
      const aliases = brandAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const valProps = valueProps
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      const validCompetitors = competitors.filter((c) => c.name && c.domain);

      const payload = {
        brand: {
          name: brandName,
          domain: brandDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
          description: niche,
          aliases,
          valueProps: valProps,
        },
        competitors: validCompetitors,
        byok: byokKeys,
        engines: {
          ...engines,
          mode: crawlMode,
        },
      };

      const res = await fetch("/api/setup/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to complete setup");
      }

      // Success: redirect to dashboard
      window.location.href = "/";
    } catch (e) {
      alert((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      {/* Wizard Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-sky-500" />
          <span>PrismGEO Enterprise Setup Wizard</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
          Client Onboarding & AI Calibration
        </h1>
        <p className="text-xs md:text-sm text-slate-500 max-w-lg mx-auto">
          Configure domain grounding, competitive benchmarks, and AI engine parameters in 4 structured steps.
        </p>
      </div>

      {/* Step Indicators */}
      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {[
          { num: 1, title: "Entity Grounding", icon: Building2 },
          { num: 2, title: "Competitors", icon: Users },
          { num: 3, title: "Engine & BYOK", icon: Cpu },
          { num: 4, title: "Prompts & Launch", icon: Compass },
        ].map((s) => {
          const isCurrent = step === s.num;
          const isPast = step > s.num;
          return (
            <button
              key={s.num}
              onClick={() => (step > s.num ? setStep(s.num) : null)}
              className={`p-3 rounded-xl border text-left transition flex items-center space-x-2.5 ${
                isCurrent
                  ? "border-sky-500 bg-sky-50/80 text-sky-950 font-bold shadow-sm"
                  : isPast
                  ? "border-emerald-200 bg-emerald-50/50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 font-bold ${
                  isCurrent
                    ? "bg-sky-600 text-white"
                    : isPast
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {isPast ? "✓" : s.num}
              </div>
              <span className="hidden sm:inline truncate">{s.title}</span>
            </button>
          );
        })}
      </div>

      {/* Step Container Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 space-y-6">
        {/* STEP 1: ENTITY GROUNDING */}
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Step 1: Target Entity & Domain Grounding
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Define the primary brand identity, canonical website domain, and common brand aliases.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Brand / Client Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Outcraft AI"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Primary Domain *
                </label>
                <input
                  type="text"
                  placeholder="e.g. outcraft.ai"
                  value={brandDomain}
                  onChange={(e) => setBrandDomain(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Brand Aliases & Trade Names (comma-separated)
              </label>
              <input
                type="text"
                placeholder="e.g. Outcraft, Outcraft.ai, Outcraft App"
                value={brandAliases}
                onChange={(e) => setBrandAliases(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Used to detect unlinked brand mentions across generative answer tokens.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Industry / Market Niche
                </label>
                <input
                  type="text"
                  placeholder="e.g. B2B SaaS / AI Appointment Booking"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Core Value Propositions (one per line)
                </label>
                <textarea
                  rows={2}
                  placeholder="Speed to lead under 5 minutes&#10;Automated calendar appointment setting"
                  value={valueProps}
                  onChange={(e) => setValueProps(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: COMPETITORS */}
        {step === 2 && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Step 2: Competitive Benchmark & Rivals
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Specify key market alternatives to calculate Citation Share of Voice (CSoV).
                </p>
              </div>
              <button
                type="button"
                onClick={addCompetitor}
                className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 transition border border-sky-200"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Competitor</span>
              </button>
            </div>

            <div className="space-y-3">
              {competitors.map((comp, idx) => (
                <div key={idx} className="flex items-center space-x-3">
                  <div className="w-8 text-center text-xs font-bold text-slate-400">
                    #{idx + 1}
                  </div>
                  <input
                    type="text"
                    placeholder="Competitor Name (e.g. Fin.ai)"
                    value={comp.name}
                    onChange={(e) => updateCompetitor(idx, "name", e.target.value)}
                    className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Domain (e.g. fin.ai)"
                    value={comp.domain}
                    onChange={(e) => updateCompetitor(idx, "domain", e.target.value)}
                    className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeCompetitor(idx)}
                    className="p-2 text-slate-400 hover:text-rose-600 transition"
                    title="Remove competitor"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
              💡 <strong>Pro-Tip:</strong> Adding 3 to 10 competitors produces highly calibrated CSoV and market overlap metrics across Perplexity, Gemini, and Google AIO.
            </div>
          </div>
        )}

        {/* STEP 3: ENGINE & BYOK KEYS */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in duration-150">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Step 3: Engine Architecture & BYOK Credentials
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose between 100% Free Zero-Cost Stealth Headless Browsing or Bring Your Own Key (BYOK).
              </p>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "stealth",
                  title: "100% Free Zero-Cost",
                  badge: "Default",
                  desc: "Local Playwright stealth browser mimicking real desktop queries without API keys.",
                },
                {
                  id: "byok",
                  title: "Direct BYOK APIs",
                  badge: "Fastest",
                  desc: "Connect your official OpenAI, Gemini, or Perplexity keys for high-speed API crawls.",
                },
                {
                  id: "hybrid",
                  title: "Hybrid Failover",
                  badge: "Resilient",
                  desc: "Tries free stealth browser first, automatically falls back to BYOK keys if challenged.",
                },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCrawlMode(m.id as any)}
                  className={`p-4 rounded-xl border text-left transition flex flex-col justify-between ${
                    crawlMode === m.id
                      ? "border-sky-500 bg-sky-50/70 shadow-sm"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-slate-900">
                        {m.title}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {m.desc}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* BYOK Inputs (Optional) */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-800">
                <KeyRound className="w-4 h-4 text-sky-600" />
                <span>Bring Your Own Key (Optional — Leave blank for Free Stealth)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    OpenAI API Key
                  </label>
                  <input
                    type="password"
                    placeholder="sk-proj-..."
                    value={byokKeys.openai}
                    onChange={(e) => setByokKeys({ ...byokKeys, openai: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Perplexity API Key
                  </label>
                  <input
                    type="password"
                    placeholder="pplx-..."
                    value={byokKeys.perplexity}
                    onChange={(e) => setByokKeys({ ...byokKeys, perplexity: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Google Gemini API Key
                  </label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={byokKeys.gemini}
                    onChange={(e) => setByokKeys({ ...byokKeys, gemini: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Anthropic API Key
                  </label>
                  <input
                    type="password"
                    placeholder="sk-ant-..."
                    value={byokKeys.anthropic}
                    onChange={(e) => setByokKeys({ ...byokKeys, anthropic: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-xs bg-white"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: PROMPTS & LAUNCH */}
        {step === 4 && (
          <div className="space-y-6 animate-in fade-in duration-150">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Step 4: ICP Prompts Generation & Calibration
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Generate high-intent buyer dilemma prompts and configure sampling depth.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-sky-50 border border-sky-100 space-y-2">
              <div className="flex items-center space-x-2 text-xs font-bold text-sky-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Ready to Synthesize Calibrated ICP Prompts</span>
              </div>
              <p className="text-xs text-sky-800">
                PrismGEO will automatically synthesize intent-calibrated queries for <strong>{brandName || "your brand"}</strong> covering SaaS buyer dilemmas, pricing investigations, competitor comparisons, and direct category lookups.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-slate-700">Initial Prompt Pool</span>
                  <span className="font-mono font-bold text-sky-600 text-sm">
                    {promptCount} Prompts
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={promptCount}
                  onChange={(e) => setPromptCount(Number(e.target.value))}
                  className="w-full accent-sky-600"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Seed prompts generated from brand value propositions
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-slate-700">Monte Carlo Sample Size</span>
                  <span className="font-mono font-bold text-sky-600 text-sm">
                    {sampleSize}x Runs
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="15"
                  value={sampleSize}
                  onChange={(e) => setSampleSize(Number(e.target.value))}
                  className="w-full accent-sky-600"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Multi-run iterations per prompt to compute standard error
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Wizard Footer Navigation */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Previous Step</span>
            </button>
          ) : (
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-slate-600 transition"
            >
              Cancel & Return
            </Link>
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && (!brandName || !brandDomain)) {
                  alert("Please enter Brand Name and Domain before proceeding.");
                  return;
                }
                setStep(step + 1);
              }}
              className="inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleFinishSetup}
              className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition shadow-md active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>{submitting ? "Configuring Brand..." : "Complete Setup & Launch"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

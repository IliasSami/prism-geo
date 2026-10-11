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
  AlertCircle,
  Loader2,
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 1: Brand Grounding
  const [brandName, setBrandName] = useState("");
  const [brandDomain, setBrandDomain] = useState("");
  const [brandAliases, setBrandAliases] = useState("");
  const [niche, setNiche] = useState("B2B SaaS / Growth");
  const [valueProps, setValueProps] = useState("");
  const [step1Touched, setStep1Touched] = useState(false);

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

  // Validation rules
  const cleanDomain = brandDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  const isStep1Valid = brandName.trim().length > 0 && cleanDomain.length > 0 && cleanDomain.includes(".");

  // Competitor validation: any non-empty row must have BOTH name and domain
  const invalidCompetitors = competitors.some(
    (c) => (c.name.trim() && !c.domain.trim()) || (!c.name.trim() && c.domain.trim())
  );
  const isStep2Valid = !invalidCompetitors;

  // Step 3 validation: at least 1 engine active
  const isStep3Valid = Object.values(engines).some(Boolean);

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

  function handleKeyDownStep1(e: React.KeyboardEvent) {
    if (e.key === "Enter" && isStep1Valid) {
      e.preventDefault();
      setErrorMessage(null);
      setStep(2);
    }
  }

  async function handleFinishSetup() {
    if (!isStep1Valid) {
      setStep(1);
      setErrorMessage("Please enter a valid Brand Name and Domain (e.g. acme.com).");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const aliases = brandAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const valProps = valueProps
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      const validCompetitors = competitors.filter(
        (c) => c.name.trim() && c.domain.trim()
      );

      const payload = {
        brand: {
          name: brandName.trim(),
          domain: cleanDomain,
          description: niche.trim(),
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
      setErrorMessage((e as Error).message);
      setSubmitting(false);
    }
  }

  const progressPercent = step === 1 ? 25 : step === 2 ? 50 : step === 3 ? 75 : 100;

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-6">
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

      {/* Progress Bar Indicator */}
      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-sky-600 h-1.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Step Indicators */}
      <div className="grid grid-cols-4 gap-2 text-xs font-medium" role="tablist">
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
              type="button"
              role="tab"
              aria-selected={isCurrent}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => {
                if (isPast) {
                  setErrorMessage(null);
                  setStep(s.num);
                }
              }}
              className={`p-3 rounded-xl border text-left transition flex items-center space-x-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                isCurrent
                  ? "border-sky-500 bg-sky-50/80 text-sky-950 font-bold shadow-xs"
                  : isPast
                  ? "border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-50 cursor-pointer"
                  : "border-slate-200 bg-white text-slate-400 cursor-not-allowed"
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

      {/* Error Alert Box */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start justify-between animate-in fade-in duration-150">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Action Required</span>
              <span>{errorMessage}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded text-rose-400 hover:text-rose-700 hover:bg-rose-100"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Step Container Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 space-y-6">
        {/* STEP 1: ENTITY GROUNDING */}
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
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
                  onBlur={() => setStep1Touched(true)}
                  onChange={(e) => {
                    setBrandName(e.target.value);
                    setErrorMessage(null);
                  }}
                  onKeyDown={handleKeyDownStep1}
                  className={`w-full px-3.5 py-2.5 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium ${
                    step1Touched && !brandName.trim()
                      ? "border-rose-300 bg-rose-50/30"
                      : "border-slate-200"
                  }`}
                />
                {step1Touched && !brandName.trim() && (
                  <span className="text-[11px] text-rose-600 mt-1 block">
                    Brand Name is required.
                  </span>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Primary Domain *
                </label>
                <input
                  type="text"
                  placeholder="e.g. outcraft.ai"
                  value={brandDomain}
                  onBlur={() => setStep1Touched(true)}
                  onChange={(e) => {
                    setBrandDomain(e.target.value);
                    setErrorMessage(null);
                  }}
                  onKeyDown={handleKeyDownStep1}
                  className={`w-full px-3.5 py-2.5 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono ${
                    step1Touched && (!cleanDomain || !cleanDomain.includes("."))
                      ? "border-rose-300 bg-rose-50/30"
                      : "border-slate-200"
                  }`}
                />
                {step1Touched && (!cleanDomain || !cleanDomain.includes(".")) && (
                  <span className="text-[11px] text-rose-600 mt-1 block">
                    Please provide a valid domain with extension (e.g. company.com).
                  </span>
                )}
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
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
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
                className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 transition border border-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Competitor</span>
              </button>
            </div>

            <div className="space-y-3">
              {competitors.map((comp, idx) => {
                const isPartiallyFilled =
                  (comp.name.trim() && !comp.domain.trim()) ||
                  (!comp.name.trim() && comp.domain.trim());

                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 text-center text-xs font-bold text-slate-400">
                        #{idx + 1}
                      </div>
                      <input
                        type="text"
                        placeholder="Competitor Name (e.g. Fin.ai)"
                        value={comp.name}
                        onChange={(e) => updateCompetitor(idx, "name", e.target.value)}
                        className={`flex-1 px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          isPartiallyFilled && !comp.name.trim()
                            ? "border-rose-300 bg-rose-50/20"
                            : "border-slate-200"
                        }`}
                      />
                      <input
                        type="text"
                        placeholder="Domain (e.g. fin.ai)"
                        value={comp.domain}
                        onChange={(e) => updateCompetitor(idx, "domain", e.target.value)}
                        className={`flex-1 px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono ${
                          isPartiallyFilled && !comp.domain.trim()
                            ? "border-rose-300 bg-rose-50/20"
                            : "border-slate-200"
                        }`}
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
                    {isPartiallyFilled && (
                      <span className="text-[10px] text-rose-600 pl-11 block">
                        Both Competitor Name and Domain are required for this row.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
              💡 <strong>Pro-Tip:</strong> Configuring 3 to 10 competitors produces highly calibrated CSoV and market overlap metrics across Perplexity, Gemini, and Google AIO.
            </div>
          </div>
        )}

        {/* STEP 3: ENGINE & BYOK KEYS */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-200">
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
                  className={`p-4 rounded-xl border text-left transition flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    crawlMode === m.id
                      ? "border-sky-500 bg-sky-50/70 shadow-xs"
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

            {/* Engine Checkbox Toggles */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">
                Active Generative Engines *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {[
                  { id: "perplexity", name: "Perplexity AI" },
                  { id: "google_aio", name: "Google AIO" },
                  { id: "copilot", name: "Microsoft Copilot" },
                  { id: "gemini", name: "Google Gemini" },
                  { id: "chatgpt", name: "ChatGPT Search" },
                ].map((eng) => {
                  const isChecked = (engines as any)[eng.id];
                  return (
                    <label
                      key={eng.id}
                      className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                        isChecked
                          ? "border-sky-500 bg-sky-50/60 font-semibold text-slate-900"
                          : "border-slate-200 text-slate-500"
                      }`}
                    >
                      <span>{eng.name}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) =>
                          setEngines({ ...engines, [eng.id]: e.target.checked })
                        }
                        className="w-4 h-4 accent-sky-600 rounded"
                      />
                    </label>
                  );
                })}
              </div>
              {!isStep3Valid && (
                <span className="text-[11px] text-rose-600 mt-1 block">
                  Select at least one generative engine to crawl.
                </span>
              )}
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
          <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-200">
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
                  className="w-full accent-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                  className="w-full accent-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
              onClick={() => {
                setErrorMessage(null);
                setStep(step - 1);
              }}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition focus:outline-none focus:ring-2 focus:ring-sky-500"
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
              disabled={
                (step === 1 && !isStep1Valid) ||
                (step === 2 && !isStep2Valid) ||
                (step === 3 && !isStep3Valid)
              }
              onClick={() => {
                if (step === 1 && !isStep1Valid) {
                  setStep1Touched(true);
                  setErrorMessage("Brand Name and a valid Domain are required.");
                  return;
                }
                if (step === 2 && !isStep2Valid) {
                  setErrorMessage("Please complete or remove any half-filled competitor rows.");
                  return;
                }
                if (step === 3 && !isStep3Valid) {
                  setErrorMessage("Please select at least one active engine.");
                  return;
                }
                setErrorMessage(null);
                setStep(step + 1);
              }}
              className="inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleFinishSetup}
              className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition shadow-md active:scale-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Configuring Brand...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Complete Setup & Launch</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

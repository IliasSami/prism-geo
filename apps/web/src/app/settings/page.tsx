"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Shield,
  Database,
  Sliders,
  KeyRound,
  Users,
  Building2,
  Cpu,
  Download,
  Save,
  CheckCircle2,
  Plus,
  Trash2,
  Sparkles,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  X,
  Undo2,
} from "lucide-react";
import Link from "next/link";

interface ToastState {
  type: "success" | "error" | "info";
  message: string;
}

export default function SettingsHubPage() {
  const [activeTab, setActiveTab] = useState<"workspace" | "engines" | "crawler" | "storage">("workspace");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Original snapshot to support discard
  const [initialData, setInitialData] = useState<any>(null);

  // Workspace / Brand Data
  const [brands, setBrands] = useState<any[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string>("");
  const [brandForm, setBrandForm] = useState({
    name: "",
    domain: "",
    description: "",
    aliases: "",
  });

  // Engines & BYOK Data
  const [engines, setEngines] = useState({
    perplexity: true,
    google_aio: true,
    copilot: true,
    gemini: true,
    chatgpt: true,
    mode: "stealth",
  });
  const [byok, setByok] = useState({
    openai: "",
    anthropic: "",
    gemini: "",
    perplexity: "",
    openrouter: "",
  });

  // Crawler Controls
  const [crawler, setCrawler] = useState({
    sampleSize: 5,
    concurrency: 2,
    timeoutMs: 30000,
    rotateFingerprints: true,
    proxyUrl: "",
  });

  // Storage info
  const [dbPath, setDbPath] = useState("");

  // Auto-dismiss toast after 3.5s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    Promise.all([
      fetch("/api/brands").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ])
      .then(([brandData, settingsData]) => {
        let bForm = { name: "", domain: "", description: "", aliases: "" };
        if (brandData.brands) {
          setBrands(brandData.brands);
          setActiveBrandId(brandData.activeBrandId);
          const active = brandData.activeBrand || brandData.brands.find((b: any) => b.id === brandData.activeBrandId);
          if (active) {
            bForm = {
              name: active.name,
              domain: active.domain,
              description: active.description || "",
              aliases: JSON.parse(active.aliasesJson || "[]").join(", "),
            };
            setBrandForm(bForm);
          }
        }
        if (settingsData.engines) setEngines(settingsData.engines);
        if (settingsData.byok) setByok(settingsData.byok);
        if (settingsData.crawler) setCrawler(settingsData.crawler);
        if (settingsData.dbPath) setDbPath(settingsData.dbPath);

        setInitialData({
          brandForm: bForm,
          engines: settingsData.engines || engines,
          byok: settingsData.byok || byok,
          crawler: settingsData.crawler || crawler,
        });

        setLoading(false);
      })
      .catch((err) => {
        setToast({ type: "error", message: "Failed to load settings data" });
        setLoading(false);
      });
  }, []);

  function handleDiscard() {
    if (initialData) {
      setBrandForm(initialData.brandForm);
      setEngines(initialData.engines);
      setByok(initialData.byok);
      setCrawler(initialData.crawler);
      setHasUnsavedChanges(false);
      setToast({ type: "info", message: "Discarded uncommitted changes" });
    }
  }

  async function handleSwitchBrand(brandId: string) {
    try {
      const res = await fetch("/api/brands/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (e) {
      setToast({ type: "error", message: "Failed to switch active brand" });
    }
  }

  async function handleSaveSettings() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          byok,
          engines,
          crawler,
        }),
      });

      if (res.ok) {
        setHasUnsavedChanges(false);
        setInitialData({
          brandForm,
          engines,
          byok,
          crawler,
        });
        setToast({
          type: "success",
          message: "Configuration saved successfully to local SQLite!",
        });
      } else {
        const err = await res.json();
        throw new Error(err.error || "Failed to save configuration");
      }
    } catch (e) {
      setToast({
        type: "error",
        message: (e as Error).message || "Error saving configuration",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Toast Notification Container */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-3 duration-200">
          <div
            role="alert"
            className={`flex items-center space-x-3 px-4 py-3 rounded-xl shadow-xl border text-xs font-medium max-w-md ${
              toast.type === "success"
                ? "bg-slate-900 text-white border-slate-800"
                : toast.type === "error"
                ? "bg-rose-900 text-white border-rose-800"
                : "bg-slate-900 text-white border-slate-800"
            }`}
          >
            {toast.type === "success" && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            {toast.type === "error" && (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            {toast.type === "info" && (
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <span className="flex-1 leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 rounded text-slate-400 hover:text-white transition shrink-0"
              aria-label="Dismiss toast"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Unsaved Changes Pill */}
      {hasUnsavedChanges && (
        <div className="sticky top-16 z-30 bg-amber-50 border border-amber-200/80 p-3 rounded-xl shadow-sm flex items-center justify-between text-xs text-amber-900 animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span className="font-semibold">Unsaved changes detected</span>
            <span className="text-amber-700 hidden sm:inline">— Remember to save your configuration.</span>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={handleDiscard}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition"
            >
              <Undo2 className="w-3 h-3" />
              <span>Discard</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveSettings}
              className="inline-flex items-center space-x-1 px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Save className="w-3 h-3" />
              <span>{saving ? "Saving..." : "Save Now"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold mb-1">
            <Settings className="w-3.5 h-3.5 text-sky-600" />
            <span>Workspace Control</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Settings & Engine Configuration Hub
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-client workspace parameters, BYOK API credentials, Monte Carlo controls, and database backups
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? "Saving..." : "Save Configuration"}</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Settings categories"
        className="flex border-b border-slate-200 space-x-1 overflow-x-auto pb-px"
      >
        {[
          { id: "workspace", name: "Workspace & Clients", icon: Building2 },
          { id: "engines", name: "Engines & BYOK Keys", icon: Cpu },
          { id: "crawler", name: "Monte Carlo & Crawl Controls", icon: Sliders },
          { id: "storage", name: "Storage, Export & Backups", icon: Database },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-t-lg ${
                isActive
                  ? "border-sky-600 text-sky-600 bg-sky-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`}
            >
              <tab.icon className="w-4 h-4 shrink-0" />
              <span>{tab.name}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: WORKSPACE & CLIENTS */}
      {activeTab === "workspace" && (
        <div role="tabpanel" className="space-y-6">
          {/* Active Brand Switcher Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Tracked Clients & Workspaces
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Switch between monitored brands or onboard a new client.
                </p>
              </div>
              <Link
                href="/setup"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 transition border border-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Onboard New Brand</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {brands.map((b) => {
                const isActive = b.id === activeBrandId;
                return (
                  <div
                    key={b.id}
                    className={`p-4 rounded-xl border text-left transition flex flex-col justify-between ${
                      isActive
                        ? "border-sky-500 bg-sky-50/60 shadow-sm ring-1 ring-sky-500"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {b.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        {b.domain}
                      </div>
                    </div>

                    {!isActive && (
                      <button
                        onClick={() => handleSwitchBrand(b.id)}
                        className="mt-3 w-full py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        Set as Active
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Brand Metadata Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Active Client Details ({brandForm.name || "None"})
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={brandForm.name}
                  onChange={(e) => {
                    setBrandForm({ ...brandForm, name: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Primary Domain
                </label>
                <input
                  type="text"
                  value={brandForm.domain}
                  onChange={(e) => {
                    setBrandForm({ ...brandForm, domain: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="font-bold text-slate-700 block mb-1">
                  Brand Aliases (comma-separated)
                </label>
                <input
                  type="text"
                  value={brandForm.aliases}
                  onChange={(e) => {
                    setBrandForm({ ...brandForm, aliases: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ENGINES & BYOK KEYS */}
      {activeTab === "engines" && (
        <div role="tabpanel" className="space-y-6">
          {/* Architecture Mode Selector */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Crawling Architecture & Operational Mode
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Toggle between zero-cost stealth headless browser execution or direct official API keys.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "stealth",
                  title: "Zero-Cost Stealth Headless",
                  badge: "100% Free",
                  desc: "Desktop Playwright browser with fingerprint spoofing and consent bypass. Zero third-party API costs.",
                },
                {
                  id: "byok",
                  title: "Bring Your Own Key (BYOK)",
                  badge: "Direct APIs",
                  desc: "Queries target LLM APIs directly via your personal keys (OpenAI, Gemini, Perplexity).",
                },
                {
                  id: "hybrid",
                  title: "Hybrid Failover",
                  badge: "Enterprise",
                  desc: "Attempts zero-cost stealth browser first; falls back seamlessly to BYOK keys if blocked.",
                },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setEngines({ ...engines, mode: m.id });
                    setHasUnsavedChanges(true);
                  }}
                  className={`p-4 rounded-xl border text-left transition flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    engines.mode === m.id
                      ? "border-sky-500 bg-sky-50/60 shadow-sm ring-1 ring-sky-500"
                      : "border-slate-200 bg-white hover:border-slate-300"
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
          </div>

          {/* Engine Toggles */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Active Search Engines & Generative Surfaces
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { id: "perplexity", name: "Perplexity AI", tag: "Sonar / Live Citations" },
                { id: "google_aio", name: "Google AI Overviews", tag: "SERP Generative Box" },
                { id: "copilot", name: "Microsoft Copilot", tag: "Bing Grounded Index" },
                { id: "gemini", name: "Google Gemini", tag: "Live Search Tools" },
                { id: "chatgpt", name: "ChatGPT Search", tag: "Autonomous Browsing" },
              ].map((eng) => {
                const isEnabled = (engines as any)[eng.id];
                return (
                  <div
                    key={eng.id}
                    className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {eng.name}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {eng.tag}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => {
                        setEngines({ ...engines, [eng.id]: e.target.checked });
                        setHasUnsavedChanges(true);
                      }}
                      className="w-4 h-4 accent-sky-600 rounded focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* BYOK Key Inputs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <KeyRound className="w-4 h-4 text-sky-600" />
              <span>BYOK API Credentials (Saved Locally in SQLite)</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  placeholder="sk-proj-..."
                  value={byok.openai}
                  onChange={(e) => {
                    setByok({ ...byok, openai: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Perplexity API Key
                </label>
                <input
                  type="password"
                  placeholder="pplx-..."
                  value={byok.perplexity}
                  onChange={(e) => {
                    setByok({ ...byok, perplexity: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Google Gemini API Key
                </label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={byok.gemini}
                  onChange={(e) => {
                    setByok({ ...byok, gemini: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={byok.anthropic}
                  onChange={(e) => {
                    setByok({ ...byok, anthropic: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MONTE CARLO & CRAWLER CONTROLS */}
      {activeTab === "crawler" && (
        <div role="tabpanel" className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
            <h3 className="text-sm font-bold text-slate-900">
              Monte Carlo Sampling Parameters
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-700">
                    Sample Size Per Prompt (N)
                  </span>
                  <span className="font-mono font-bold text-sky-600 text-sm">
                    {crawler.sampleSize} Runs
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={crawler.sampleSize}
                  onChange={(e) => {
                    setCrawler({ ...crawler, sampleSize: Number(e.target.value) });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full accent-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-500">
                  Controls the number of independent sessions sampled per prompt to compute Wilson 95% intervals and variance bands.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-700">
                    Playwright Concurrency
                  </span>
                  <span className="font-mono font-bold text-sky-600 text-sm">
                    {crawler.concurrency} Workers
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={crawler.concurrency}
                  onChange={(e) => {
                    setCrawler({ ...crawler, concurrency: Number(e.target.value) });
                    setHasUnsavedChanges(true);
                  }}
                  className="w-full accent-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-500">
                  Parallel headless browser contexts. Keep at 2 for residential networks or 4-5 on high-speed servers.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className="text-xs font-bold text-slate-700 block">
                Proxy Routing (Optional for Residential IP Rotation)
              </label>
              <input
                type="text"
                placeholder="http://username:password@proxy.example.com:8080"
                value={crawler.proxyUrl}
                onChange={(e) => {
                  setCrawler({ ...crawler, proxyUrl: e.target.value });
                  setHasUnsavedChanges(true);
                }}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
              />
              <span className="text-[11px] text-slate-400 block">
                Optional HTTP/SOCKS5 proxy used to rotate IP addresses across engine evaluations.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: STORAGE, EXPORT & BACKUPS */}
      {activeTab === "storage" && (
        <div role="tabpanel" className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Persistence Engine & Health
            </h3>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-600 font-sans">Storage Engine:</span>
                <span className="font-bold text-slate-900">SQLite 3 (WAL Mode)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-sans">Database Location:</span>
                <span className="text-[11px] text-sky-700 truncate max-w-md">
                  {dbPath || "./data/prismgeo.db"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-sans">Cloud Lock-in:</span>
                <span className="font-bold text-emerald-600">Zero (100% Local-First)</span>
              </div>
            </div>
          </div>

          {/* Export & Backup Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Data Export & Offline Backups
            </h3>
            <p className="text-xs text-slate-500">
              Download audit results for reporting or backup the full database for offline archive.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <a
                href="/api/export?format=csv&type=citations"
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <div>
                  <div className="font-bold text-xs text-slate-900 group-hover:text-sky-600">
                    Export Citations (.csv)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Grounded footnote URLs, titles, and snippet rankings.
                  </p>
                </div>
                <span className="text-[11px] font-bold text-sky-600 flex items-center mt-3">
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Download CSV
                </span>
              </a>

              <a
                href="/api/export?format=json&type=full"
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <div>
                  <div className="font-bold text-xs text-slate-900 group-hover:text-sky-600">
                    Full Snapshot (.json)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Complete multi-engine runs, Wilson intervals, and chunks.
                  </p>
                </div>
                <span className="text-[11px] font-bold text-sky-600 flex items-center mt-3">
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Download JSON
                </span>
              </a>

              <a
                href="/api/backup"
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <div>
                  <div className="font-bold text-xs text-slate-900 group-hover:text-sky-600">
                    Database Backup (.db)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Checkpointed binary SQLite database file.
                  </p>
                </div>
                <span className="text-[11px] font-bold text-sky-600 flex items-center mt-3">
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Download SQLite
                </span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

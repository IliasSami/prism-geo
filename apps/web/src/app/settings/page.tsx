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
} from "lucide-react";
import Link from "next/link";

export default function SettingsHubPage() {
  const [activeTab, setActiveTab] = useState<"workspace" | "engines" | "crawler" | "storage">("workspace");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Workspace / Brand Data
  const [brands, setBrands] = useState<any[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string>("");
  const [brandForm, setBrandForm] = useState({
    name: "",
    domain: "",
    description: "",
    aliases: "",
  });

  // Competitors Data
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [newCompName, setNewCompName] = useState("");
  const [newCompDomain, setNewCompDomain] = useState("");

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

  useEffect(() => {
    // Load brands and settings in parallel
    Promise.all([
      fetch("/api/brands").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ])
      .then(([brandData, settingsData]) => {
        if (brandData.brands) {
          setBrands(brandData.brands);
          setActiveBrandId(brandData.activeBrandId);
          const active = brandData.activeBrand || brandData.brands.find((b: any) => b.id === brandData.activeBrandId);
          if (active) {
            setBrandForm({
              name: active.name,
              domain: active.domain,
              description: active.description || "",
              aliases: JSON.parse(active.aliasesJson || "[]").join(", "),
            });
          }
        }
        if (settingsData.engines) setEngines(settingsData.engines);
        if (settingsData.byok) setByok(settingsData.byok);
        if (settingsData.crawler) setCrawler(settingsData.crawler);
        if (settingsData.dbPath) setDbPath(settingsData.dbPath);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
      console.error(e);
    }
  }

  async function handleSaveSettings() {
    setSaving(true);
    setSaveSuccess(false);
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
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Settings & Engine Configuration Hub
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-client workspace parameters, BYOK API credentials, Monte Carlo controls, and database backups
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {saveSuccess && (
            <span className="inline-flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Settings Saved
            </span>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? "Saving..." : "Save Configuration"}</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-1">
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
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-3 text-xs font-semibold border-b-2 transition ${
                isActive
                  ? "border-sky-600 text-sky-600"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.name}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: WORKSPACE & CLIENTS */}
      {activeTab === "workspace" && (
        <div className="space-y-6">
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
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 transition border border-sky-200"
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
                        className="mt-3 w-full py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
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
                  onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
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
                  onChange={(e) => setBrandForm({ ...brandForm, domain: e.target.value })}
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
                  onChange={(e) => setBrandForm({ ...brandForm, aliases: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ENGINES & BYOK KEYS */}
      {activeTab === "engines" && (
        <div className="space-y-6">
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
                  onClick={() => setEngines({ ...engines, mode: m.id })}
                  className={`p-4 rounded-xl border text-left transition flex flex-col justify-between ${
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
                      onChange={(e) =>
                        setEngines({ ...engines, [eng.id]: e.target.checked })
                      }
                      className="w-4 h-4 accent-sky-600 rounded"
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
                  onChange={(e) => setByok({ ...byok, openai: e.target.value })}
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
                  onChange={(e) => setByok({ ...byok, perplexity: e.target.value })}
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
                  onChange={(e) => setByok({ ...byok, gemini: e.target.value })}
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
                  onChange={(e) => setByok({ ...byok, anthropic: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MONTE CARLO & CRAWLER CONTROLS */}
      {activeTab === "crawler" && (
        <div className="space-y-6">
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
                  onChange={(e) =>
                    setCrawler({ ...crawler, sampleSize: Number(e.target.value) })
                  }
                  className="w-full accent-sky-600"
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
                  onChange={(e) =>
                    setCrawler({ ...crawler, concurrency: Number(e.target.value) })
                  }
                  className="w-full accent-sky-600"
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
                onChange={(e) => setCrawler({ ...crawler, proxyUrl: e.target.value })}
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
        <div className="space-y-6">
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
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between"
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
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between"
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
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 text-left transition hover:shadow-sm group flex flex-col justify-between"
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

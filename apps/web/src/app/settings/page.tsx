"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Cpu, CalendarClock, Plug, Database, Download, Plus, Check } from "lucide-react";
import EngineSessionsPanel from "@/components/EngineSessionsPanel";
import ClaudeConnectorPanel from "@/components/ClaudeConnectorPanel";
import CompetitorsPanel from "@/components/CompetitorsPanel";
import { Badge, Button, Card, CardHeader, Field, LinkButton, Notice, PageHeader, cn, inputClass, textareaClass } from "@/components/ui";
import { Tabs, TabPanel, type TabItem } from "@/components/settings/Tabs";
import { SaveBar, Toast, type ToastState } from "@/components/settings/Feedback";
import { ApiKeyField } from "@/components/settings/ApiKeyField";
import { LogViewer } from "@/components/settings/LogViewer";

type TabId = "client" | "engines" | "schedule" | "claude" | "data";

const TABS: TabItem<TabId>[] = [
  { id: "client", label: "Client", icon: <Building2 className="h-4 w-4" aria-hidden /> },
  { id: "engines", label: "Engines & access", icon: <Cpu className="h-4 w-4" aria-hidden /> },
  { id: "schedule", label: "Schedule & network", icon: <CalendarClock className="h-4 w-4" aria-hidden /> },
  { id: "claude", label: "Claude connector", icon: <Plug className="h-4 w-4" aria-hidden /> },
  { id: "data", label: "Data", icon: <Database className="h-4 w-4" aria-hidden /> },
];

const MODES = [
  {
    id: "hybrid",
    title: "Browser, then API if blocked",
    badge: "Recommended",
    desc: "Asks the real apps in a browser; when an engine blocks a question, that one is answered through its API key. Until you save a key it works exactly like free browser mode.",
  },
  {
    id: "stealth",
    title: "Free browser mode",
    badge: "No keys",
    desc: "Only the real consumer apps, in a browser on this machine (signed in if you connect a session). No API costs, but engines may rate-limit you.",
  },
  {
    id: "byok",
    title: "API keys only",
    badge: "Fastest",
    desc: "Engines with a saved key are always asked through their official API. Engines without a key still use the browser.",
  },
];

interface BrandForm {
  name: string;
  domain: string;
  description: string;
  aliases: string;
}
interface Crawler {
  sampleSize: number;
  proxyUrl: string;
  scheduleEnabled: boolean;
  schedulePromptsPerDay: number;
  scheduleHour: number;
}
type Keys = { openai: string; gemini: string; perplexity: string; serpapi: string };
interface Snapshot {
  brandForm: BrandForm;
  engines: Record<string, unknown> & { mode: string };
  byok: Keys;
  crawler: Crawler;
}

const EMPTY: Snapshot = {
  brandForm: { name: "", domain: "", description: "", aliases: "" },
  engines: { mode: "hybrid" },
  byok: { openai: "", gemini: "", perplexity: "", serpapi: "" },
  crawler: { sampleSize: 1, proxyUrl: "", scheduleEnabled: false, schedulePromptsPerDay: 15, scheduleHour: 9 },
};

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("client");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const [brands, setBrands] = useState<Array<{ id: string; name: string; domain: string }>>([]);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

  const [initial, setInitial] = useState<Snapshot>(EMPTY);
  const [draft, setDraft] = useState<Snapshot>(EMPTY);
  const dirty = useMemo(() => JSON.stringify(initial) !== JSON.stringify(draft), [initial, draft]);

  const set = <K extends keyof Snapshot>(key: K, patch: Partial<Snapshot[K]>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  useEffect(() => {
    Promise.all([fetch("/api/brands").then((r) => r.json()), fetch("/api/settings").then((r) => r.json())])
      .then(([brandData, s]) => {
        const active = brandData.activeBrand || brandData.brands?.find((b: any) => b.id === brandData.activeBrandId);
        setBrands(brandData.brands || []);
        setActiveBrandId(brandData.activeBrandId || "");
        setDbPath(s.dbPath || "");
        setSavedKeys(s.hasRawByok || {});
        const snap: Snapshot = {
          brandForm: active
            ? {
                name: active.name,
                domain: active.domain,
                description: active.description || "",
                aliases: JSON.parse(active.aliasesJson || "[]").join(", "),
              }
            : EMPTY.brandForm,
          engines: { ...EMPTY.engines, ...(s.engines || {}) },
          byok: { ...EMPTY.byok, ...(s.byok || {}) },
          crawler: { ...EMPTY.crawler, ...(s.crawler || {}) },
        };
        setInitial(snap);
        setDraft(snap);
      })
      .catch(() => setToast({ type: "error", message: "Could not load settings" }))
      .finally(() => setLoading(false));
  }, []);

  // Leaving the page with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Permanently deletes a non-active client after the user types its name. */
  async function deleteBrand(b: { id: string; name: string }) {
    const typed = window.prompt(`Delete ${b.name} and all of its prompts, competitors and captured answers? This cannot be undone.\n\nType the client name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== b.name) return setToast({ type: "error", message: "The name did not match; nothing was deleted." });
    const res = await fetch("/api/brands", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.id }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setToast({ type: "error", message: data.error || "Could not delete the client" });
    setBrands((list) => list.filter((x) => x.id !== b.id));
    setToast({ type: "success", message: `${b.name} deleted` });
  }

  async function switchBrand(brandId: string) {
    const res = await fetch("/api/brands/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId }),
    }).catch(() => null);
    if (res?.ok) window.location.reload();
    else setToast({ type: "error", message: "Could not switch client" });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ byok: draft.byok, engines: draft.engines, crawler: draft.crawler }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save settings");

      const b = draft.brandForm;
      if (activeBrandId && (b.name || b.domain) && JSON.stringify(b) !== JSON.stringify(initial.brandForm)) {
        const brandRes = await fetch("/api/brands", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: activeBrandId, name: b.name, domain: b.domain, description: b.description, aliases: b.aliases }),
        });
        if (!brandRes.ok) throw new Error((await brandRes.json().catch(() => ({}))).error || "Could not save client details");
      }

      // Re-read so masked keys and saved-key badges reflect what is stored
      const fresh = await fetch("/api/settings", { cache: "no-store" }).then((r) => r.json());
      setSavedKeys(fresh.hasRawByok || {});
      const next = { ...draft, byok: { ...EMPTY.byok, ...(fresh.byok || {}) }, crawler: { ...EMPTY.crawler, ...(fresh.crawler || {}) } };
      setInitial(next);
      setDraft(next);
      setToast({ type: "success", message: "Settings saved" });
    } catch (e) {
      setToast({ type: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(initial);
    setToast({ type: "info", message: "Changes discarded" });
  }

  const { brandForm, byok, crawler } = draft;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <PageHeader title="Settings" description="Client profile, how each engine is reached, the audit schedule, and your data." />

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Settings sections" />

      {loading ? (
        <div className="space-y-4 pt-6" aria-busy="true" aria-label="Loading settings">
          <div className="skeleton h-40 w-full" />
          <div className="skeleton h-56 w-full" />
        </div>
      ) : (
        <>
          <TabPanel id="client" active={tab}>
            <Card>
              <CardHeader
                title="Client profile"
                description="Used to recognise your brand in answers and to write new questions."
              />
              <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
                <Field label="Brand name" htmlFor="brand-name">
                  <input id="brand-name" className={inputClass} value={brandForm.name} onChange={(e) => set("brandForm", { name: e.target.value })} />
                </Field>
                <Field label="Website domain" htmlFor="brand-domain" hint="Without https://, e.g. example.com">
                  <input
                    id="brand-domain"
                    className={cn(inputClass, "font-mono")}
                    value={brandForm.domain}
                    onChange={(e) => set("brandForm", { domain: e.target.value })}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Other names" htmlFor="brand-aliases" hint="Comma separated. Other ways answers refer to you, including alternate domains.">
                    <input
                      id="brand-aliases"
                      className={inputClass}
                      value={brandForm.aliases}
                      placeholder="e.g. Acme, Acme App, acme.io"
                      onChange={(e) => set("brandForm", { aliases: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="What you do" htmlFor="brand-description" hint="One or two sentences. New questions are written from this.">
                    <textarea
                      id="brand-description"
                      rows={3}
                      className={textareaClass}
                      value={brandForm.description}
                      placeholder="e.g. AI voice agents that call shoppers who abandon checkout"
                      onChange={(e) => set("brandForm", { description: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </Card>

            <CompetitorsPanel />

            <Card>
              <CardHeader
                title="Clients"
                description="Each client has its own prompts, competitors and results."
                actions={
                  <LinkButton href="/setup" size="sm">
                    <Plus className="h-4 w-4" aria-hidden />
                    New client
                  </LinkButton>
                }
              />
              <ul className="divide-y divide-zinc-100">
                {brands.map((b) => {
                  const isActive = b.id === activeBrandId;
                  return (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-900">{b.name}</div>
                        <div className="truncate font-mono text-sm text-zinc-500">{b.domain}</div>
                      </div>
                      {isActive ? (
                        <Badge tone="accent">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          Current
                        </Badge>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => switchBrand(b.id)}>
                            Switch to {b.name}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => deleteBrand(b)}>
                            Delete
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </TabPanel>

          <TabPanel id="engines" active={tab}>
            <Card>
              <CardHeader title="How engines are reached" description="Applies to every engine in the next audit." />
              <fieldset className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
                <legend className="sr-only">Engine access mode</legend>
                {MODES.map((m) => {
                  const checked = draft.engines.mode === m.id;
                  return (
                    <label
                      key={m.id}
                      className={cn(
                        "relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 transition duration-150",
                        checked ? "border-accent-500 bg-accent-50/60 ring-1 ring-accent-500" : "border-zinc-200 hover:border-zinc-300"
                      )}
                    >
                      <input
                        type="radio"
                        name="engine-mode"
                        value={m.id}
                        checked={checked}
                        onChange={() => set("engines", { mode: m.id })}
                        className="sr-only peer"
                      />
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-zinc-900">{m.title}</span>
                        <Badge tone={m.id === "hybrid" ? "accent" : "neutral"}>{m.badge}</Badge>
                      </span>
                      <span className="text-sm text-zinc-600">{m.desc}</span>
                      <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2" />
                    </label>
                  );
                })}
              </fieldset>
            </Card>

            <EngineSessionsPanel />

            <Card>
              <CardHeader
                title="Your API keys"
                description="Optional. Stored unencrypted in the local database on this machine; never sent anywhere except the engine's own API."
              />
              <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
                <ApiKeyField
                  id="key-gemini"
                  service="Gemini key"
                  label={
                    <>
                      Google Gemini{" "}
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-normal text-accent-600 hover:underline">
                        free tier
                      </a>
                    </>
                  }
                  hint="Returns the sources and web searches behind each answer."
                  placeholder="AIza…"
                  value={byok.gemini}
                  saved={Boolean(savedKeys.gemini)}
                  onChange={(v) => set("byok", { gemini: v })}
                />
                <ApiKeyField
                  id="key-serpapi"
                  service="SerpApi key"
                  label={
                    <>
                      SerpApi for Google AI Overviews{" "}
                      <a href="https://serpapi.com/users/sign_up" target="_blank" rel="noreferrer" className="font-normal text-accent-600 hover:underline">
                        free tier
                      </a>
                    </>
                  }
                  hint="Reads AI Overviews without Google's &quot;unusual traffic&quot; blocks."
                  placeholder="SerpApi private key"
                  value={byok.serpapi}
                  saved={Boolean(savedKeys.serpapi)}
                  onChange={(v) => set("byok", { serpapi: v })}
                />
                <ApiKeyField
                  id="key-openai"
                  service="OpenAI key"
                  label="OpenAI (ChatGPT)"
                  placeholder="sk-…"
                  value={byok.openai}
                  saved={Boolean(savedKeys.openai)}
                  onChange={(v) => set("byok", { openai: v })}
                />
                <ApiKeyField
                  id="key-perplexity"
                  service="Perplexity key"
                  label="Perplexity"
                  placeholder="pplx-…"
                  value={byok.perplexity}
                  saved={Boolean(savedKeys.perplexity)}
                  onChange={(v) => set("byok", { perplexity: v })}
                />
              </div>
              {draft.engines.mode === "stealth" && Object.values(savedKeys).some(Boolean) && (
                <div className="px-5 pb-5">
                  <Notice tone="warning" title="Saved keys are not used in free browser mode">
                    Switch to &quot;Browser, then API if blocked&quot; so blocked engines fall back to your keys.
                  </Notice>
                </div>
              )}
            </Card>
          </TabPanel>

          <TabPanel id="schedule" active={tab}>
            <Card>
              <CardHeader title="Audit defaults" />
              <div className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <label htmlFor="repeats" className="text-sm font-medium text-zinc-700">
                    Repeats per question
                  </label>
                  <span className="text-base font-semibold tabular text-zinc-900">{crawler.sampleSize}×</span>
                </div>
                <input
                  id="repeats"
                  type="range"
                  min={1}
                  max={Math.max(5, crawler.sampleSize)}
                  value={crawler.sampleSize}
                  onChange={(e) => set("crawler", { sampleSize: Number(e.target.value) })}
                  className="w-full accent-accent-600"
                />
                <p className="text-xs text-zinc-500">
                  How many times each question is asked per engine in a new audit. Answers vary, so more repeats give tighter ranges but take
                  proportionally longer. 1 is a good start; repeat over days with the schedule below.
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Rolling daily audit"
                description="Recommended and free. Each day, re-asks the questions measured longest ago instead of everything at once, so engines see a small, human-paced number of queries. Runs while PrismGEO is running."
                actions={
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={crawler.scheduleEnabled}
                      checked={crawler.scheduleEnabled}
                      onChange={(e) => set("crawler", { scheduleEnabled: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="relative h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-accent-600 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"
                    />
                    {crawler.scheduleEnabled ? "On" : "Off"}
                  </label>
                }
              />
              <div className={cn("grid grid-cols-1 gap-4 p-5 sm:grid-cols-2", !crawler.scheduleEnabled && "opacity-60")}>
                <Field label="Questions per day" htmlFor="per-day" hint="1–200">
                  <input
                    id="per-day"
                    type="number"
                    min={1}
                    max={200}
                    className={inputClass}
                    value={crawler.schedulePromptsPerDay}
                    onChange={(e) => set("crawler", { schedulePromptsPerDay: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Start after (hour, local time)" htmlFor="start-hour" hint="0–23">
                  <input
                    id="start-hour"
                    type="number"
                    min={0}
                    max={23}
                    className={inputClass}
                    value={crawler.scheduleHour}
                    onChange={(e) => set("crawler", { scheduleHour: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="Outbound proxy" description="Optional. Applies to browser engines from the next audit." />
              <div className="space-y-3 p-5">
                <Field label="Proxy URL" htmlFor="proxy" hint="http://user:pass@host:port or socks5://host:port">
                  <input
                    id="proxy"
                    className={cn(inputClass, "font-mono")}
                    placeholder="http://username:password@proxy.example.com:8080"
                    value={crawler.proxyUrl}
                    onChange={(e) => set("crawler", { proxyUrl: e.target.value })}
                  />
                </Field>
                <Notice tone="warning">
                  Use a proxy you control (office network or a paid provider). Free public proxies and VPNs can read or alter your traffic,
                  including signed-in sessions.
                </Notice>
              </div>
            </Card>
          </TabPanel>

          <TabPanel id="claude" active={tab}>
            <ClaudeConnectorPanel />
          </TabPanel>

          <TabPanel id="data" active={tab}>
            <Card>
              <CardHeader title="Storage" description="Everything lives in one SQLite file on this machine. Treat it as a secret: it holds your API keys." />
              <dl className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-[160px_1fr]">
                <dt className="text-sm font-medium text-zinc-500">Database file</dt>
                <dd className="break-all font-mono text-sm text-zinc-900">{dbPath || "Unknown"}</dd>
                <dt className="text-sm font-medium text-zinc-500">Engine</dt>
                <dd className="text-sm text-zinc-900">SQLite (WAL), no cloud service</dd>
              </dl>
            </Card>

            <Card>
              <CardHeader title="Export and backup" description="For the current client unless noted." />
              <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
                {[
                  { href: "/api/export?format=csv&type=citations", title: "Cited pages", desc: "Every cited URL with title and rank.", label: "Download CSV" },
                  { href: "/api/export?format=json&type=full", title: "Full results", desc: "Audits, answers, citations, mentions and matched passages.", label: "Download JSON" },
                  { href: "/api/backup", title: "Database backup", desc: "The whole database, all clients, including API keys.", label: "Download .db" },
                ].map((x) => (
                  <a
                    key={x.href}
                    href={x.href}
                    className="group flex flex-col justify-between gap-3 rounded-xl border border-zinc-200 p-4 transition duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-pop"
                  >
                    <span>
                      <span className="block font-semibold text-zinc-900">{x.title}</span>
                      <span className="mt-1 block text-sm text-zinc-500">{x.desc}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-600">
                      <Download className="h-4 w-4" aria-hidden />
                      {x.label}
                    </span>
                  </a>
                ))}
              </div>
            </Card>

            <LogViewer />
          </TabPanel>

          <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={discard} />
        </>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

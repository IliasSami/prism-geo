"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, IconButton, Notice, cn, inputClass } from "@/components/ui";

interface Competitor {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
}

type Draft = { name: string; domain: string; aliases: string };

/**
 * Add, edit and remove the active brand's competitors. Aliases are the other names AI answers
 * use for a company ("HoopVoice", "Hoop AI Voice Agents"); mention detection uses all of them.
 * Changes are saved immediately, independent of the Settings save bar.
 */
export default function CompetitorsPanel() {
  const [items, setItems] = useState<Competitor[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [form, setForm] = useState<Draft>({ name: "", domain: "", aliases: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/competitors", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setItems([]);
    const list: Competitor[] = (await res.json()).competitors;
    setItems(list);
    setDrafts(Object.fromEntries(list.map((c) => [c.id, { name: c.name, domain: c.domain, aliases: c.aliases.join(", ") }])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (method: "POST" | "PATCH" | "DELETE", body: unknown, ok: string, key: string) => {
    setMessage(null);
    setBusy(key);
    try {
      const res = await fetch("/api/competitors", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMessage({ ok: false, text: data.error || "Request failed" });
      setMessage({ ok: true, text: ok });
      if (method === "POST") setForm({ name: "", domain: "", aliases: "" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const row = "grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1.6fr_auto] md:items-center";

  return (
    <Card>
      <CardHeader
        title="Competitors"
        description="Companies whose mentions and citations are compared with yours. Saved immediately; past answers are not re-scored."
      />
      <div className="space-y-3 p-5">
        {items === null && <div className="skeleton h-24 w-full" />}
        {items?.length === 0 && <EmptyState title="No competitors yet" description="Add the companies buyers compare you with." />}

        {items && items.length > 0 && (
          <div className="hidden px-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500 md:grid md:grid-cols-[1fr_1fr_1.6fr_auto] md:gap-2">
            <span>Name</span>
            <span>Domain</span>
            <span>Other names</span>
            <span className="w-[72px]" />
          </div>
        )}

        <ul className="space-y-2">
          {items?.map((c) => {
            const d = drafts[c.id] || { name: c.name, domain: c.domain, aliases: c.aliases.join(", ") };
            const changed = d.name !== c.name || d.domain !== c.domain || d.aliases !== c.aliases.join(", ");
            const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [c.id]: { ...d, ...patch } });
            return (
              <li key={c.id} className={cn(row, "rounded-lg border border-zinc-100 p-2 md:border-0 md:p-0")}>
                <input aria-label={`${c.name} name`} value={d.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
                <input
                  aria-label={`${c.name} domain`}
                  value={d.domain}
                  onChange={(e) => set({ domain: e.target.value })}
                  className={cn(inputClass, "font-mono")}
                />
                <input
                  aria-label={`${c.name} other names`}
                  value={d.aliases}
                  placeholder="Comma separated"
                  onChange={(e) => set({ aliases: e.target.value })}
                  className={inputClass}
                />
                <div className="flex justify-end gap-1">
                  <IconButton
                    aria-label={`Save ${c.name}`}
                    tone="success"
                    disabled={!changed || busy !== null}
                    onClick={() => send("PATCH", { id: c.id, ...d }, `${d.name} updated`, c.id)}
                    className={cn(!changed && "invisible")}
                  >
                    <Check className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    aria-label={`Remove ${c.name}`}
                    tone="danger"
                    disabled={busy !== null}
                    onClick={() => confirm(`Stop tracking ${c.name}? Its past mentions stay in stored answers.`) && send("DELETE", { id: c.id }, `${c.name} removed`, c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>

        <form
          className={cn(row, "border-t border-zinc-100 pt-4")}
          onSubmit={(e) => {
            e.preventDefault();
            send("POST", form, `${form.name} added`, "new");
          }}
        >
          <input aria-label="New competitor name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          <input
            aria-label="New competitor domain"
            placeholder="domain.com"
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            className={cn(inputClass, "font-mono")}
          />
          <input
            aria-label="New competitor other names"
            placeholder="Other names (optional)"
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            className={inputClass}
          />
          <Button type="submit" variant="primary" disabled={form.name.trim().length < 2 || form.domain.trim().length < 4 || busy !== null}>
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </form>

        {message && (
          <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>
        )}
      </div>
    </Card>
  );
}

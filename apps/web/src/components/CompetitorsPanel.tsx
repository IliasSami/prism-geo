"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, IconButton, Notice, cn, inputClass } from "@/components/ui";
import { cleanDomain, cleanedHint, domainError } from "@/components/domain";

interface Competitor {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
}

type Draft = { name: string; domain: string; aliases: string };

const label = "mb-1 block text-xs font-medium text-zinc-600 md:sr-only";

/**
 * Add, edit and remove the active brand's competitors. Aliases are the other names AI answers
 * use for a company; mention detection uses all of them. Each row is saved with its own ✓
 * button, independent of the Settings save bar.
 */
export default function CompetitorsPanel() {
  const [items, setItems] = useState<Competitor[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [form, setForm] = useState<Draft>({ name: "", domain: "", aliases: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; at: string } | null>(null);

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
      if (!res.ok) return setMessage({ ok: false, text: data.error || "Request failed", at: key });
      setMessage({ ok: true, text: ok, at: key });
      if (method === "POST") setForm({ name: "", domain: "", aliases: "" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const row = "grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1.6fr_auto] md:items-center";
  const newDomainError = domainError(form.domain);
  const newHint = cleanedHint(form.domain);
  const canAdd = form.name.trim().length >= 2 && form.domain.trim() && !newDomainError && busy === null;

  return (
    <Card>
      <CardHeader
        title="Competitors"
        description="Companies whose mentions and citations are compared with yours. A changed row is saved when you click its ✓; past answers are not re-scored."
      />
      <div className="space-y-3 p-5">
        {items === null && <div className="skeleton h-24 w-full" />}
        {items?.length === 0 && <EmptyState title="No competitors yet" description="Add the companies buyers compare you with." />}

        {items && items.length > 0 && (
          <div aria-hidden="true" className="hidden px-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500 md:grid md:grid-cols-[1fr_1fr_1.6fr_auto] md:gap-2">
            <span>Name</span>
            <span>Website</span>
            <span>Other names</span>
            <span className="w-[72px]" />
          </div>
        )}

        <ul className="space-y-2">
          {items?.map((c) => {
            const d = drafts[c.id] || { name: c.name, domain: c.domain, aliases: c.aliases.join(", ") };
            const changed = d.name !== c.name || d.domain !== c.domain || d.aliases !== c.aliases.join(", ");
            const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [c.id]: { ...d, ...patch } });
            const err = domainError(d.domain);
            return (
              <li key={c.id} className="space-y-1">
                <div className={cn(row, "rounded-lg border border-zinc-200 p-3 md:border-0 md:p-0")}>
                  <div className="flex items-end gap-2 md:block">
                    <label className="min-w-0 flex-1">
                      <span className={label}>Name</span>
                      <input aria-label={`${c.name} name`} value={d.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
                    </label>
                    <IconButton
                      aria-label={`Remove ${c.name}`}
                      tone="danger"
                      className="md:hidden"
                      disabled={busy !== null}
                      onClick={() => confirm(`Stop tracking ${c.name}? Its past mentions stay in stored answers.`) && send("DELETE", { id: c.id }, `${c.name} removed`, c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                  <label>
                    <span className={label}>Website</span>
                    <input
                      aria-label={`${c.name} website`}
                      aria-invalid={Boolean(err)}
                      value={d.domain}
                      onChange={(e) => set({ domain: e.target.value })}
                      className={cn(inputClass, err && "border-red-400")}
                    />
                  </label>
                  <label>
                    <span className={label}>Other names</span>
                    <input aria-label={`${c.name} other names`} value={d.aliases} placeholder="Comma separated" onChange={(e) => set({ aliases: e.target.value })} className={inputClass} />
                  </label>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      aria-label={`Save ${c.name}`}
                      disabled={!changed || Boolean(err) || busy !== null}
                      onClick={() => send("PATCH", { id: c.id, ...d, domain: cleanDomain(d.domain) }, `${d.name} updated`, c.id)}
                      className={cn(!changed && "md:invisible", !changed && "hidden md:inline-flex")}
                    >
                      <Check className="h-4 w-4" aria-hidden /> Save
                    </Button>
                    <IconButton
                      aria-label={`Remove ${c.name}`}
                      tone="danger"
                      className="hidden md:inline-flex"
                      disabled={busy !== null}
                      onClick={() => confirm(`Stop tracking ${c.name}? Its past mentions stay in stored answers.`) && send("DELETE", { id: c.id }, `${c.name} removed`, c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
                {err && (
                  <p className="text-xs text-red-700" role="alert">
                    {err}
                  </p>
                )}
                {message && message.at === c.id && <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>}
              </li>
            );
          })}
        </ul>

        <form
          className="space-y-2 border-t border-zinc-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd) return;
            send("POST", { ...form, domain: cleanDomain(form.domain) }, `${form.name} added`, "new");
          }}
        >
          <div className="text-sm font-medium text-zinc-700">Add a competitor</div>
          <div className={row}>
            <label>
              <span className={label}>Name</span>
              <input aria-label="New competitor name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </label>
            <label>
              <span className={label}>Website</span>
              <input
                aria-label="New competitor website"
                aria-invalid={Boolean(newDomainError)}
                aria-describedby="new-competitor-domain-hint"
                placeholder="example.com"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                className={cn(inputClass, newDomainError && "border-red-400")}
              />
            </label>
            <label>
              <span className={label}>Other names</span>
              <input
                aria-label="New competitor other names"
                placeholder="Other names (optional)"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                className={inputClass}
              />
            </label>
            <Button type="submit" variant="secondary" disabled={!canAdd}>
              <Plus className="h-4 w-4" aria-hidden />
              Add
            </Button>
          </div>
          <p id="new-competitor-domain-hint" className={cn("text-xs", newDomainError ? "text-red-700" : "text-zinc-500")}>
            {newDomainError || newHint || "Name and website are needed; other names are optional."}
          </p>
          {message && (message.at === "new" || !items?.some((i) => i.id === message.at)) && <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>}
        </form>
      </div>
    </Card>
  );
}

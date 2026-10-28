"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Lock, PauseCircle, Pencil, PlayCircle, Plus, Search, Trash2, X } from "lucide-react";
import { Badge, Button, Card, IconButton, Notice, cn, inputClass, textareaClass } from "@/components/ui";

interface PromptItem {
  id: string;
  brandId: string;
  queryText: string;
  intentType: string;
  personaDimension: string;
  active: boolean;
  createdAt: string;
  /** Answers captured for this prompt; its wording is locked once this is above zero. */
  runCount: number;
}

type Method = "POST" | "PATCH" | "DELETE";
const ITEMS_PER_PAGE = 20;
const SUGGESTED_INTENTS = ["category", "dilemma", "comparison", "alternatives", "pricing", "risk", "integration", "direct"];

const humanize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function callApi(method: Method, body: unknown) {
  const res = await fetch("/api/prompts", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Tracked prompts: add (one per line), edit, pause/resume and delete, singly or in bulk.
 * Filtering and paging happen in the browser; every change goes through /api/prompts.
 */
export function PromptsClient({ prompts, addOnly = false, brandId }: { prompts: PromptItem[]; addOnly?: boolean; brandId?: string }) {
  // Every write names the client this page shows, so another tab switching clients can't redirect it
  const call = (method: Method, body: object) => callApi(method, brandId ? { ...body, brandId } : body);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [intent, setIntent] = useState("all");
  const [persona, setPersona] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "paused">("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; queryText: string; intentType: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  // Add panel
  const [adding, setAdding] = useState(false);
  const [newPrompts, setNewPrompts] = useState("");
  const [newIntent, setNewIntent] = useState("category");
  const [newPersona, setNewPersona] = useState("buyer");

  const intents = useMemo(() => [...new Set(prompts.map((p) => p.intentType))].filter(Boolean).sort(), [prompts]);
  const personas = useMemo(() => [...new Set(prompts.map((p) => p.personaDimension))].filter(Boolean).sort(), [prompts]);
  const activeCount = prompts.filter((p) => p.active).length;
  const newLines = newPrompts.split("\n").map((l) => l.trim()).filter((l) => l.length >= 5);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return prompts.filter(
      (p) =>
        (intent === "all" || p.intentType === intent) &&
        (persona === "all" || p.personaDimension === persona) &&
        (status === "all" || (status === "active" ? p.active : !p.active)) &&
        (!q || p.queryText.toLowerCase().includes(q))
    );
  }, [prompts, intent, persona, status, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const filtersOn = searchQuery || intent !== "all" || persona !== "all" || status !== "all";
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  // A column whose value is the same on every row says nothing; it stays available as a filter
  const showIntent = intents.length > 1;
  const showPersona = personas.length > 1;

  const resetPage = () => setPage(1);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ ok: true, text: msg });
      router.refresh();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const addPrompts = () =>
    run("add", async () => {
      const data = await call("POST", { prompts: newLines, intent: newIntent, persona: newPersona });
      setNewPrompts("");
      setAdding(false);
      return `Added ${data.added} prompt${data.added === 1 ? "" : "s"}${data.skipped ? ` · ${data.skipped} already tracked` : ""}`;
    });

  const saveEdit = () =>
    editing &&
    run(editing.id, async () => {
      await call("PATCH", editing);
      setEditing(null);
      return "Prompt updated";
    });

  const remove = (p: PromptItem) => {
    const warn = p.runCount > 0 ? ` and its ${p.runCount} captured answer${p.runCount === 1 ? "" : "s"}` : "";
    if (!confirm(`Delete this prompt${warn}? This cannot be undone.`)) return;
    run(p.id, async () => {
      await call("DELETE", { id: p.id });
      selected.delete(p.id);
      setSelected(new Set(selected));
      return "Prompt deleted";
    });
  };

  /** Applies one change to every selected prompt, one request at a time, with progress. */
  const bulk = (kind: "pause" | "resume" | "delete") => {
    const ids = prompts.filter((p) => selected.has(p.id)).map((p) => p.id);
    if (ids.length === 0) return;
    if (kind === "delete") {
      const answers = prompts.filter((p) => selected.has(p.id)).reduce((s, p) => s + p.runCount, 0);
      if (!confirm(`Delete ${ids.length} prompt${ids.length === 1 ? "" : "s"}${answers ? ` and ${answers} captured answers` : ""}? This cannot be undone.`)) return;
    }
    const label = kind === "delete" ? "Deleting" : kind === "pause" ? "Pausing" : "Resuming";
    run("bulk", async () => {
      let failed = 0;
      for (let i = 0; i < ids.length; i++) {
        setProgress({ done: i, total: ids.length, label });
        try {
          await (kind === "delete" ? call("DELETE", { id: ids[i] }) : call("PATCH", { id: ids[i], active: kind === "resume" }));
        } catch {
          failed++;
        }
      }
      setProgress(null);
      setSelected(new Set());
      const verb = kind === "delete" ? "Deleted" : kind === "pause" ? "Paused" : "Resumed";
      if (failed) throw new Error(`${verb} ${ids.length - failed} of ${ids.length}; ${failed} failed`);
      return `${verb} ${ids.length} prompt${ids.length === 1 ? "" : "s"}`;
    });
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleVisible = () => {
    const next = new Set(selected);
    visible.forEach((p) => (allVisibleSelected ? next.delete(p.id) : next.add(p.id)));
    setSelected(next);
  };

  const addPanel = adding ? (
    <Card className="animate-scale-in p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-md font-semibold text-zinc-900">Add prompts</h2>
          <p className="mt-0.5 text-sm text-zinc-500">One question per line, written the way a buyer would ask an AI assistant.</p>
        </div>
        <IconButton aria-label="Close add prompts" onClick={() => setAdding(false)}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <textarea
        autoFocus
        value={newPrompts}
        onChange={(e) => setNewPrompts(e.target.value)}
        rows={4}
        aria-label="New prompts, one per line"
        placeholder={"what's the best way to recover abandoned checkouts without discounts?\nwhich tools call customers who abandon their cart?"}
        className={cn(textareaClass, "mt-3")}
      />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm font-medium text-zinc-700">Intent</span>
          <input value={newIntent} onChange={(e) => setNewIntent(e.target.value)} list="prompt-intents" className={cn(inputClass, "w-44")} />
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-medium text-zinc-700">Persona</span>
          <input value={newPersona} onChange={(e) => setNewPersona(e.target.value)} list="prompt-personas" className={cn(inputClass, "w-44")} />
        </label>
        <datalist id="prompt-intents">
          {[...new Set([...SUGGESTED_INTENTS, ...intents])].map((i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
        <datalist id="prompt-personas">
          {personas.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Button variant="primary" onClick={addPrompts} disabled={busy !== null || newLines.length === 0}>
          <Plus className="h-4 w-4" />
          {busy === "add" ? "Adding…" : newLines.length > 1 ? `Add ${newLines.length} prompts` : "Add prompt"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Use the intent <span className="font-medium text-zinc-700">direct</span> for questions that name your brand. They are reported as branded,
        separately from organic discovery.
      </p>
    </Card>
  ) : (
    <Button variant="primary" onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> Add prompts
    </Button>
  );

  if (addOnly) return addPanel;

  const rowActions = (p: PromptItem) =>
    editing?.id === p.id ? (
      <>
        <IconButton aria-label="Save prompt" tone="success" onClick={saveEdit} disabled={busy !== null || editing.queryText.trim().length < 5}>
          <Check className="h-4 w-4" />
        </IconButton>
        <IconButton aria-label="Cancel editing" onClick={() => setEditing(null)}>
          <X className="h-4 w-4" />
        </IconButton>
      </>
    ) : (
      <>
        <IconButton
          aria-label="Edit prompt"
          disabled={busy !== null}
          onClick={() => setEditing({ id: p.id, queryText: p.queryText, intentType: p.intentType })}
        >
          <Pencil className="h-4 w-4" />
        </IconButton>
        <IconButton
          aria-label={p.active ? "Pause prompt" : "Resume prompt"}
          disabled={busy !== null}
          onClick={() => run(p.id, async () => (await call("PATCH", { id: p.id, active: !p.active }), p.active ? "Prompt paused" : "Prompt resumed"))}
        >
          {p.active ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
        </IconButton>
        <IconButton aria-label="Delete prompt" tone="danger" disabled={busy !== null} onClick={() => remove(p)}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </>
    );

  const promptCell = (p: PromptItem) =>
    editing?.id === p.id ? (
      <div className="space-y-2">
        <textarea
          rows={2}
          autoFocus={p.runCount === 0}
          value={editing.queryText}
          disabled={p.runCount > 0}
          onChange={(e) => setEditing({ ...editing, queryText: e.target.value })}
          aria-label="Prompt text"
          className={textareaClass}
        />
        {p.runCount > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-zinc-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Wording is locked because {p.runCount} answer{p.runCount === 1 ? " was" : "s were"} captured for it. Add a new prompt and pause this one to change it.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          Intent
          <input
            value={editing.intentType}
            onChange={(e) => setEditing({ ...editing, intentType: e.target.value })}
            list="prompt-intents"
            autoFocus={p.runCount > 0}
            className={cn(inputClass, "w-40")}
          />
        </label>
      </div>
    ) : (
      <p className={cn("text-base leading-relaxed", p.active ? "text-zinc-900" : "text-zinc-500")}>{p.queryText}</p>
    );

  const meta = (p: PromptItem) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {p.intentType === "direct" ? <Badge tone="accent">Branded</Badge> : showIntent && <Badge tone="outline">{humanize(p.intentType)}</Badge>}
      {showPersona && p.personaDimension && <span className="text-xs text-zinc-500">{humanize(p.personaDimension)}</span>}
    </div>
  );

  // Active is the default; only a paused prompt gets a badge
  const statusCell = (p: PromptItem) => (p.active ? null : <Badge tone="warning">Paused</Badge>);

  /** Checkbox with a 24px+ hit area (44px on touch screens). */
  const check = (p: PromptItem) => (
    <label className="-m-2 inline-flex cursor-pointer items-center justify-center p-2 tap-target">
      <input type="checkbox" aria-label={`Select prompt: ${p.queryText}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5 accent-accent-600" />
    </label>
  );

  return (
    <div className="space-y-4">
      {/* Summary + add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-zinc-600 tabular">
          <span className="font-semibold text-zinc-900">{prompts.length}</span> prompts · {activeCount} active · {prompts.length - activeCount} paused
        </p>
        {!adding && addPanel}
      </div>
      {adding && addPanel}

      {notice && (
        <Notice tone={notice.ok ? "success" : "danger"} action={<IconButton aria-label="Dismiss message" onClick={() => setNotice(null)}><X className="h-4 w-4" /></IconButton>}>
          {notice.text}
        </Notice>
      )}

      <Card className="overflow-clip">
        {/* Filters */}
        <div className="flex flex-col gap-2 border-b border-zinc-100 p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => (setSearchQuery(e.target.value), resetPage())}
              placeholder="Search prompts"
              aria-label="Search prompts"
              className={cn(inputClass, "pl-9")}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex">
            <select aria-label="Filter by intent" value={intent} onChange={(e) => (setIntent(e.target.value), resetPage())} className={cn(inputClass, "md:w-40")}>
              <option value="all">All intents</option>
              {intents.map((i) => (
                <option key={i} value={i}>
                  {i === "direct" ? "Branded (direct)" : humanize(i)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by persona" value={persona} onChange={(e) => (setPersona(e.target.value), resetPage())} className={cn(inputClass, "md:w-40")}>
              <option value="all">All personas</option>
              {personas.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by status" value={status} onChange={(e) => (setStatus(e.target.value as typeof status), resetPage())} className={cn(inputClass, "md:w-32")}>
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          {filtersOn && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setIntent("all");
                setPersona("all");
                setStatus("all");
                resetPage();
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Bulk bar: sticks to the top of the screen while you scroll and select */}
        {selected.size > 0 && (
          <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-accent-200 bg-accent-50/95 px-3 py-2 backdrop-blur" role="region" aria-label="Bulk actions">
            <span className="mr-1 text-sm font-medium text-accent-700 tabular">
              {progress ? `${progress.label} ${progress.done + 1} of ${progress.total}…` : `${selected.size} selected`}
            </span>
            <Button size="sm" onClick={() => bulk("pause")} disabled={busy !== null}>
              <PauseCircle className="h-4 w-4" aria-hidden /> Pause
            </Button>
            <Button size="sm" onClick={() => bulk("resume")} disabled={busy !== null}>
              <PlayCircle className="h-4 w-4" aria-hidden /> Resume
            </Button>
            <Button size="sm" variant="danger" onClick={() => bulk("delete")} disabled={busy !== null}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy !== null}>
              Clear selection
            </Button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-md font-semibold text-zinc-900">No prompts match these filters</p>
            <p className="mt-1 text-base text-zinc-500">Try another search or clear the filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-left text-base md:table">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80 text-xs font-medium text-zinc-500">
                  <th className="w-12 px-4 py-2.5">
                    <label className="-m-2 inline-flex cursor-pointer p-2">
                      <input type="checkbox" aria-label="Select all prompts on this page" checked={allVisibleSelected} onChange={toggleVisible} className="h-5 w-5 accent-accent-600" />
                    </label>
                  </th>
                  <th className="px-2 py-2.5">Prompt</th>
                  {(showIntent || showPersona || prompts.some((p) => p.intentType === "direct")) && <th className="w-44 px-4 py-2.5">{showIntent ? "Intent" : ""}</th>}
                  <th className="w-24 px-4 py-2.5 text-right">Answers</th>
                  <th className="w-24 px-4 py-2.5">
                    <span className="sr-only">Status</span>
                  </th>
                  <th className="w-32 px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr
                    key={p.id}
                    className={cn("border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50/70", selected.has(p.id) && "bg-accent-50/40", busy === p.id && "opacity-60")}
                  >
                    <td className="px-4 py-3 align-top">{check(p)}</td>
                    <td className="px-2 py-3 align-top">{promptCell(p)}</td>
                    {(showIntent || showPersona || prompts.some((x) => x.intentType === "direct")) && <td className="px-4 py-3 align-top">{meta(p)}</td>}
                    <td className="px-4 py-3 text-right align-top text-zinc-700 tabular">{p.runCount}</td>
                    <td className="px-4 py-3 align-top">{statusCell(p)}</td>
                    <td className="px-4 py-2 align-top">
                      <div className="flex justify-end gap-0.5">{rowActions(p)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-1 md:hidden">
              <label className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-3 px-2 text-sm font-medium text-zinc-700">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} className="h-5 w-5 accent-accent-600" />
                Select all {visible.length} on this page
              </label>
            </div>
            <ul className="divide-y divide-zinc-100 md:hidden">
              {visible.map((p) => (
                <li key={p.id} className={cn("space-y-2 p-4", selected.has(p.id) && "bg-accent-50/40", busy === p.id && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0">{check(p)}</span>
                    <div className="min-w-0 flex-1">{promptCell(p)}</div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pl-10">
                    <div className="flex flex-wrap items-center gap-2">
                      {meta(p)}
                      {statusCell(p)}
                      <span className="text-xs text-zinc-500 tabular">{p.runCount} answers</span>
                    </div>
                    <div className="flex gap-0.5">{rowActions(p)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {filtered.length > ITEMS_PER_PAGE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
            <span className="tabular">
              {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <IconButton aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <span className="px-2 tabular">
                Page {currentPage} of {totalPages}
              </span>
              <IconButton aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

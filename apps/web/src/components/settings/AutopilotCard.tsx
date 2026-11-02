"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardHeader, cn } from "../ui";
import { engineLabel } from "../ui";

interface EngineState {
  engine: string;
  gaps: number;
  room: number;
  waiting: string | null;
}
interface Status {
  enabled: boolean;
  state: { status: "off" | "working" | "waiting" | "complete"; checkedAt: string | null; detail: string; engines: EngineState[] };
  serpapi: { left: number | null; perMonth: number | null; reserve: number; allowanceToday: number; usedToday: number } | null;
}

const TONE = { off: "neutral", working: "accent", waiting: "warning", complete: "success" } as const;
const LABEL = { off: "Off", working: "Working", waiting: "Waiting", complete: "Coverage complete" } as const;

/**
 * Settings → Schedule: the autopilot switch and what it is doing. It keeps asking every engine the
 * questions it has never answered, within each engine's safe limits, until coverage is complete.
 */
export function AutopilotCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilot", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as Status);
      setError(null);
    } catch {
      setError("The autopilot status could not be loaded.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch("/api/autopilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!res.ok) throw new Error();
      await load();
    } catch (e) {
      setError(e instanceof TypeError ? "PrismGEO did not answer. Is it running?" : "The autopilot could not be switched. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const state = status?.state;
  const open = state?.engines.filter((e) => e.gaps > 0) ?? [];

  return (
    <Card>
      <CardHeader
        title="Autopilot"
        description="Keeps auditing by itself, for days or weeks if needed, until every engine has answered every active question: each engine is asked only what it never answered, within its safe daily limits and your SerpApi plan's daily share. Engines resting after a block, or waiting for you in the bell, are retried later. Runs while PrismGEO is running."
        actions={
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              role="switch"
              aria-label="Autopilot"
              aria-checked={status?.enabled === true}
              checked={status?.enabled === true}
              disabled={!status || saving}
              onChange={(e) => toggle(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-accent-600 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"
            />
            {status?.enabled ? "On" : "Off"}
            <span className="text-xs font-normal text-zinc-500">· Saves immediately</span>
          </label>
        }
      />
      <div className="space-y-3 p-5" aria-live="polite">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {state && status?.enabled && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
              <Badge tone={TONE[state.status]}>{LABEL[state.status]}</Badge>
              <span>{state.detail || "Starts within a few minutes."}</span>
            </div>
            {open.length > 0 && (
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm">
                {open.map((e) => (
                  <li key={e.engine} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium text-zinc-800">{engineLabel(e.engine)}</span>
                    <span className={cn("text-zinc-600", e.waiting && "text-amber-800")}>
                      {e.gaps} unanswered · {e.waiting ?? `up to ${e.room} today`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {status?.serpapi && status.serpapi.left !== null && (
          <p className="text-xs text-zinc-500">
            SerpApi: {status.serpapi.left} searches left this month ({status.serpapi.reserve} kept in reserve); today&rsquo;s share {status.serpapi.usedToday} of{" "}
            {status.serpapi.allowanceToday} used. It is used only where no free route exists (Google AI Mode) or when Google&rsquo;s browser route is blocked.
          </p>
        )}
      </div>
    </Card>
  );
}

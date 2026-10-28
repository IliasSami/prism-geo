"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Loader2, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice } from "./ui";

interface SessionStatus {
  engine: string;
  connected: boolean;
  connecting: boolean;
  connectedAt: string | null;
}

const ENGINE_INFO: Record<string, { name: string; benefit: string }> = {
  chatgpt: { name: "ChatGPT", benefit: "Free account: web search runs more often, higher limits" },
  perplexity: { name: "Perplexity", benefit: "Free account: removes the anonymous query cap" },
  gemini: { name: "Google Gemini", benefit: "Google account: full Gemini model instead of the logged-out tier" },
  google_aio: { name: "Google AI Overviews", benefit: "Google account: fewer \"unusual traffic\" checks" },
  copilot: { name: "Microsoft Copilot", benefit: "Microsoft account: required, Copilot has no logged-out chat" },
};

/**
 * Lets the user sign in to each engine in a visible browser window on this machine. The crawler
 * then reuses that saved profile headlessly. Credentials are typed by the user into the engine's
 * own sign-in page and never pass through PrismGEO.
 */
export default function EngineSessionsPanel() {
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/engines/sessions", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setSessions((await res.json()).sessions);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a sign-in window is open so the card flips to "connected" when it is closed
  useEffect(() => {
    if (!sessions.some((s) => s.connecting)) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [sessions, load]);

  const [pending, setPending] = useState<string | null>(null);

  const act = async (engine: string, method: "POST" | "DELETE") => {
    setError(null);
    setPending(engine);
    const res = await fetch("/api/engines/sessions", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engine }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Request failed");
    else if (method === "POST") setSessions((prev) => prev.map((s) => (s.engine === engine ? { ...s, connecting: true } : s)));
    setPending(null);
    setTimeout(load, 800);
  };

  return (
    <Card>
      <CardHeader
        title="Signed-in sessions"
        description="Connect opens a browser window on this computer. Sign in with your own free account, then close the window. Audits reuse that session for higher limits and fewer bot checks. PrismGEO never sees your password."
      />
      {error && (
        <div className="px-5 pt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <ul className="grid gap-3 p-5 sm:grid-cols-2">
        {sessions.length === 0 &&
          [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-[72px] rounded-xl" aria-hidden="true" />)}
        {sessions.map((s) => {
          const info = ENGINE_INFO[s.engine] || { name: s.engine, benefit: "" };
          const busy = pending === s.engine;
          return (
            <li
              key={s.engine}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3.5 transition-colors hover:border-zinc-300 animate-fade-in"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-zinc-900">{info.name}</span>
                  {s.connecting ? (
                    <Badge tone="info">Waiting for sign-in</Badge>
                  ) : s.connected ? (
                    <Badge tone="success">Connected</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {s.connecting
                    ? "Sign in in the browser window, then close it."
                    : s.connected && s.connectedAt
                      ? `Saved ${new Date(s.connectedAt).toLocaleString()}`
                      : info.benefit}
                </p>
              </div>
              {s.connecting ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-600" aria-label="Waiting for sign-in" />
              ) : s.connected ? (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => act(s.engine, "POST")} disabled={busy} aria-label={`Reconnect ${info.name}`}>
                    <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => act(s.engine, "DELETE")} disabled={busy} aria-label={`Forget ${info.name} session`}>
                    <LogOut className="h-3.5 w-3.5" /> Forget
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="primary" onClick={() => act(s.engine, "POST")} disabled={busy} aria-label={`Connect ${info.name}`}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} Connect
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

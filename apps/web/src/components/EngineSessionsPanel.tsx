"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice } from "./ui";

interface SessionStatus {
  engine: string;
  connected: boolean;
  connecting: boolean;
  connectedAt: string | null;
  state: "signed_in" | "not_signed_in" | "expired" | "checking" | "not_connected";
  signedInDetected: boolean;
  sessionExpiresAt: string | null;
  verifiedAt: string | null;
  lastError: string | null;
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

  // Poll while a sign-in window is open or a saved session is being checked
  useEffect(() => {
    if (!sessions.some((s) => s.connecting || s.state === "checking")) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [sessions, load]);

  const [pending, setPending] = useState<string | null>(null);

  const act = async (engine: string, method: "POST" | "DELETE", action?: "verify") => {
    setError(null);
    setPending(engine);
    const res = await fetch("/api/engines/sessions", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action ? { engine, action } : { engine }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Request failed");
    else if (method === "POST" && !action) setSessions((prev) => prev.map((s) => (s.engine === engine ? { ...s, connecting: true } : s)));
    setPending(null);
    setTimeout(load, 800);
  };

  return (
    <Card>
      <CardHeader
        title="Signed-in sessions"
        description="Connect opens a browser window on this computer. Sign in with your own free account, wait for “Signed in” here, then close the window. A session counts only when PrismGEO finds the service's sign-in in it, and it is checked again before every audit. PrismGEO never sees your password."
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
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3.5 transition-colors hover:border-zinc-300"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-zinc-900">{info.name}</span>
                  {s.connecting ? (
                    s.signedInDetected ? <Badge tone="success">Signed in</Badge> : <Badge tone="info">Waiting for sign-in</Badge>
                  ) : s.state === "signed_in" ? (
                    <Badge tone="success">Connected</Badge>
                  ) : s.state === "checking" ? (
                    <Badge tone="neutral">Checking…</Badge>
                  ) : s.state === "not_signed_in" ? (
                    <Badge tone="warning">Not signed in</Badge>
                  ) : s.state === "expired" ? (
                    <Badge tone="warning">Session expired</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {s.connecting
                    ? s.signedInDetected
                      ? "Signed in. You can close the sign-in window now to save the session."
                      : "A sign-in window opened on the computer running PrismGEO (not on this device if you are using another one). Sign in there; this card says “Signed in” when it worked, then close the window."
                    : s.state === "signed_in"
                      ? `Signed in, checked ${new Date(s.verifiedAt || s.connectedAt || Date.now()).toLocaleString()}${s.sessionExpiresAt ? ` · valid until ${new Date(s.sessionExpiresAt).toLocaleDateString()}` : ""}`
                      : s.state === "not_signed_in" || s.state === "expired"
                        ? s.lastError || "No signed-in session was found. Connect again and sign in before closing the window."
                        : s.state === "checking"
                          ? "Checking the saved session…"
                          : s.lastError || info.benefit}
                </p>
              </div>
              {s.connecting ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-600" aria-hidden />
              ) : s.state === "signed_in" || s.state === "not_signed_in" || s.state === "expired" ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {s.state === "signed_in" && (
                    <Button size="sm" variant="ghost" onClick={() => act(s.engine, "POST", "verify")} disabled={busy} aria-label={`Check ${info.name} session`}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Check
                    </Button>
                  )}
                  <Button size="sm" variant={s.state === "signed_in" ? "secondary" : "primary"} onClick={() => act(s.engine, "POST")} disabled={busy} aria-label={`${s.state === "signed_in" ? "Reconnect" : "Sign in to"} ${info.name}`}>
                    <RefreshCw className="h-3.5 w-3.5" /> {s.state === "signed_in" ? "Reconnect" : "Sign in"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => act(s.engine, "DELETE")} disabled={busy} aria-label={`Forget ${info.name} session`}>
                    <LogOut className="h-3.5 w-3.5" /> Forget
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => act(s.engine, "POST")} disabled={busy} aria-label={`Connect ${info.name}`}>
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

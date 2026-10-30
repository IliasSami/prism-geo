"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice, cn, inputClass } from "./ui";

interface SessionStatus {
  engine: string;
  account: string;
  label: string | null;
  active: boolean;
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
  google_aio: { name: "Google AI Overviews", benefit: "Google account: fewer \"unusual traffic\" checks (a SerpApi or DataForSEO key is the dependable route)" },
  gemini: { name: "Google Gemini", benefit: "Google account: the signed-in Gemini model instead of the logged-out tier" },
  chatgpt: { name: "ChatGPT", benefit: "Free account: higher limits; answers come from Temporary Chats, so your history does not shape them" },
  perplexity: { name: "Perplexity", benefit: "Free account: removes the logged-out query cap" },
  copilot: { name: "Microsoft Copilot", benefit: "Microsoft account: required, Copilot has no logged-out chat" },
};
const ORDER = ["google_aio", "gemini", "chatgpt", "perplexity", "copilot"];

const STATE_BADGE: Record<SessionStatus["state"], { label: string; tone: "success" | "neutral" | "warning" } | null> = {
  signed_in: { label: "Connected", tone: "success" },
  checking: { label: "Checking…", tone: "neutral" },
  not_signed_in: { label: "Not signed in", tone: "warning" },
  expired: { label: "Session expired", tone: "warning" },
  not_connected: null,
};

/**
 * Lets the user sign in to each engine in a visible browser window on this machine, with one or
 * more accounts per engine (labelled personas such as "US founder"). The crawler reuses the first
 * account with a verified session. Credentials are typed into the engine's own sign-in page and
 * never pass through PrismGEO.
 */
export default function EngineSessionsPanel() {
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ engine: string; label: string } | null>(null);

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

  const act = async (method: "POST" | "DELETE", body: Record<string, string>) => {
    const key = `${body.engine}@${body.account ?? body.label ?? "default"}`;
    setError(null);
    setPending(key);
    const res = await fetch("/api/engines/sessions", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Request failed");
    setPending(null);
    setTimeout(load, 600);
  };

  const engines = ORDER.filter((e) => sessions.some((s) => s.engine === e));

  return (
    <Card>
      <CardHeader
        title="Signed-in sessions"
        description="Connect opens a browser window on this computer. Sign in with your own account, wait for “Signed in” here, then close the window. Add more accounts per engine to compare buyer personas or markets; audits use the first account with a valid session and skip ones that expired. A session counts only when PrismGEO finds the service's sign-in in it, and it is checked again before every audit. PrismGEO never sees your password."
      />
      {error && (
        <div className="px-5 pt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <ul className="grid gap-3 p-5 lg:grid-cols-2">
        {sessions.length === 0 && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-[96px] rounded-xl" aria-hidden="true" />)}
        {engines.map((engine) => {
          const info = ENGINE_INFO[engine] || { name: engine, benefit: "" };
          const accounts = sessions.filter((s) => s.engine === engine);
          const hasSaved = accounts.some((s) => s.state !== "not_connected" || s.connecting);
          return (
            <li key={engine} className="rounded-xl border border-zinc-200 p-3.5 transition-colors hover:border-zinc-300">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-medium text-zinc-900">{info.name}</div>
                  <p className="mt-0.5 text-sm text-zinc-500">{info.benefit}</p>
                </div>
                {!hasSaved && (
                  <Button size="sm" variant="secondary" onClick={() => act("POST", { engine })} disabled={pending !== null} aria-label={`Connect ${info.name}`}>
                    {pending === `${engine}@default` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} Connect
                  </Button>
                )}
              </div>

              {hasSaved && (
                <ul className="mt-3 space-y-2">
                  {accounts.map((s) => {
                    const key = `${s.engine}@${s.account}`;
                    const busy = pending === key;
                    const badge = s.connecting ? (s.signedInDetected ? STATE_BADGE.signed_in : null) : STATE_BADGE[s.state];
                    const name = s.label || (s.account === "default" ? "Main account" : s.account);
                    const body = { engine: s.engine, account: s.account };
                    return (
                      <li key={key} className={cn("rounded-lg px-3 py-2", s.active ? "bg-emerald-50/60 ring-1 ring-emerald-200" : "bg-zinc-50")}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-zinc-800">{name}</span>
                            {s.connecting && !s.signedInDetected && <Badge tone="info">Waiting for sign-in</Badge>}
                            {badge && <Badge tone={badge.tone}>{s.connecting && s.signedInDetected ? "Signed in" : badge.label}</Badge>}
                            {s.active && <Badge tone="accent">Used in audits</Badge>}
                          </div>
                          {s.connecting ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-600" aria-hidden />
                          ) : (
                            <div className="flex shrink-0 flex-wrap justify-end gap-1">
                              {s.state === "signed_in" && (
                                <Button size="sm" variant="ghost" onClick={() => act("POST", { ...body, action: "verify" })} disabled={busy} aria-label={`Check ${info.name} ${name}`}>
                                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Check
                                </Button>
                              )}
                              <Button size="sm" variant={s.state === "signed_in" ? "ghost" : "primary"} onClick={() => act("POST", body)} disabled={busy} aria-label={`Sign in to ${info.name} ${name}`}>
                                <RefreshCw className="h-3.5 w-3.5" /> {s.state === "signed_in" ? "Reconnect" : "Sign in"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => act("DELETE", body)} disabled={busy} aria-label={`Forget ${info.name} ${name}`}>
                                <LogOut className="h-3.5 w-3.5" /> Forget
                              </Button>
                            </div>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {s.connecting
                            ? s.signedInDetected
                              ? "Signed in. Close the sign-in window to save the session."
                              : "A sign-in window opened on the computer running PrismGEO. Sign in there; this says “Signed in” when it worked."
                            : s.state === "signed_in"
                              ? `Checked ${new Date(s.verifiedAt || s.connectedAt || Date.now()).toLocaleString()}${s.sessionExpiresAt ? ` · valid until ${new Date(s.sessionExpiresAt).toLocaleDateString()}` : ""}`
                              : s.state === "checking"
                                ? "Checking the saved session…"
                                : s.lastError || "No signed-in session was found. Sign in again before closing the window."}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}

              {hasSaved &&
                (adding?.engine === engine ? (
                  <form
                    className="mt-3 flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!adding.label.trim()) return;
                      act("POST", { engine, label: adding.label.trim() });
                      setAdding(null);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={`Label for another ${info.name} account`}
                      placeholder="e.g. UK ecom manager"
                      value={adding.label}
                      onChange={(e) => setAdding({ engine, label: e.target.value })}
                      className={cn(inputClass, "h-8 max-w-[220px] text-sm")}
                    />
                    <Button size="sm" variant="secondary" type="submit" disabled={!adding.label.trim()}>
                      <LogIn className="h-3.5 w-3.5" /> Sign in
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding({ engine, label: "" })}
                    className="mt-2 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-accent-700 hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add another account
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Badge, Button, cn, plural } from "./ui";
import { LocalTime } from "./LocalTime";

/** One step only a person can take, as GET /api/actions returns it. */
interface Action {
  id: string;
  engine: string;
  engineLabel: string;
  brandName: string | null;
  kind: "human_check" | "sign_in";
  message: string;
  status: "open" | "ready";
  pendingPromptIds: string[];
  questions: string[];
  note: string | null;
  createdAt: string;
  auditWaiting: boolean;
  window: { open: boolean; cleared: boolean };
}

const KIND_LABEL = { human_check: "Human check", sign_in: "Sign-in" } as const;
/** Polled often enough that a waiting audit is picked up quickly, without loading the server. */
const POLL_MS = 4000;

/**
 * One store for every bell on the page (the mobile bar and the desktop header both mount one), so
 * the list is polled once and each new request raises at most one desktop alert.
 */
interface Snapshot {
  actions: Action[];
  canOpenWindow: boolean;
  /** False until the first answer: the bell does not claim "nothing needs you" before it knows. */
  loaded: boolean;
}

const INITIAL: Snapshot = { actions: [], canOpenWindow: true, loaded: false };
let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
/** Ids seen in the last answer; null before the first, so existing requests do not alert. */
let seen: Set<string> | null = null;
/** Each load gets a number; an answer older than one already applied is dropped. */
let requested = 0;
let applied = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const alertsGranted = () => typeof Notification !== "undefined" && Notification.permission === "granted";

async function loadActions(): Promise<void> {
  const seq = ++requested;
  let data: { actions: Action[]; canOpenWindow: boolean } | null = null;
  try {
    const res = await fetch("/api/actions", { cache: "no-store" });
    if (res.ok) data = (await res.json()) as { actions: Action[]; canOpenWindow: boolean };
  } catch {
    // Offline or the server is restarting: the next poll tries again
  }
  if (!data || !Array.isArray(data.actions) || seq < applied) return;
  applied = seq;
  snapshot = { actions: data.actions, canOpenWindow: data.canOpenWindow !== false, loaded: true };
  listeners.forEach((l) => l());
  // A new request while the dashboard is in the background: a desktop alert, when allowed
  if (seen) {
    const fresh = data.actions.filter((a) => a.status === "open" && !seen!.has(a.id));
    if (fresh.length && alertsGranted() && document.visibilityState !== "visible") {
      new Notification("PrismGEO needs you", { body: `${fresh[0].engineLabel}: ${KIND_LABEL[fresh[0].kind].toLowerCase()}. The engine waits until you complete it.`, tag: "prismgeo-actions" });
    }
  }
  seen = new Set(data.actions.map((a) => a.id));
}

// In the background only when desktop alerts are on; otherwise the next look refreshes it
const tick = () => {
  if (document.visibilityState === "visible" || alertsGranted()) void loadActions();
};
const onVisible = () => {
  if (document.visibilityState === "visible") void loadActions();
};

/** Polls while at least one bell is mounted. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void loadActions();
    timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => INITIAL;

/**
 * The bell in the header: steps only a person can take (a "verify you are human" check, an expired
 * sign-in). The engine that asked waits for them while the other engines keep running; the person
 * opens a window, completes the step themselves, and the audit carries on.
 */
export function ActionBell({ compact = false }: { compact?: boolean }) {
  const { actions, canOpenWindow, loaded } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<NotificationPermission | "unsupported">("unsupported");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setAlerts(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  // Moves focus into the panel when it opens: its first control, or the panel itself
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>("button:not([disabled]), summary, a[href]");
    (first || panel.current)?.focus();
  }, [open]);

  // Closes on Escape and on a click outside, returning focus to the bell
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const act = async (id: string, action: "open" | "done" | "dismiss" | "resume") => {
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      const res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      if (!res.ok) setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error || "That did not work. Try again.");
      await loadActions();
    } catch {
      setError("Could not reach PrismGEO. Check that it is still running, then try again.");
    } finally {
      setBusy(null);
    }
  };

  const waiting = actions.filter((a) => a.status === "open").length;
  const count = actions.length;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={count ? `${plural(count, "step")} need${count === 1 ? "s" : ""} you` : loaded ? "Notifications: nothing needs you" : "Notifications"}
        title={count ? `${plural(count, "step")} need${count === 1 ? "s" : ""} you` : loaded ? "Nothing needs you" : "Notifications"}
        className={cn(
          "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white shadow-sm transition tap-target",
          waiting ? "border-amber-300 text-amber-700 hover:border-amber-400" : "border-zinc-300 text-zinc-600 hover:border-zinc-400",
          compact && "border-transparent shadow-none"
        )}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white tabular",
              waiting ? "bg-amber-600" : "bg-zinc-700"
            )}
            aria-hidden
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          tabIndex={-1}
          role="dialog"
          aria-label="Steps that need you"
          className="fixed inset-x-4 top-16 z-50 overflow-hidden rounded-xl outline-none border border-zinc-200 bg-white shadow-pop animate-fade-in md:absolute md:inset-x-auto md:right-0 md:top-11 md:w-[400px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
            <div className="text-sm font-medium text-zinc-900">Needs you</div>
            {alerts === "default" && (
              <button
                type="button"
                className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
                onClick={async () => setAlerts(await Notification.requestPermission())}
              >
                Alert me on this computer
              </button>
            )}
          </div>

          {error && <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</div>}

          {!loaded ? (
            <p className="px-4 py-6 text-sm text-zinc-500" role="status">
              Loading…
            </p>
          ) : count === 0 ? (
            <p className="px-4 py-6 text-sm leading-relaxed text-zinc-500">
              Nothing needs you. When an engine asks for a “verify you are human” check or a sign-in, it shows up here and that engine waits for you; the other
              engines keep running.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto">
              {actions.map((a) => {
                const held = a.pendingPromptIds.length;
                const isBusy = (what: string) => busy === `${a.id}:${what}`;
                return (
                  <li key={a.id} className="space-y-2.5 px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900">{a.engineLabel}</span>
                      <Badge tone={a.status === "open" ? "warning" : "success"}>{a.status === "open" ? KIND_LABEL[a.kind] : "Done"}</Badge>
                      {a.brandName && <span className="text-xs text-zinc-500">{a.brandName}</span>}
                      <LocalTime iso={a.createdAt} className="ml-auto text-xs text-zinc-400 tabular" />
                    </div>

                    {a.status === "open" ? (
                      <>
                        <p className="text-sm leading-relaxed text-zinc-600">{a.message}</p>
                        {a.auditWaiting && <p className="text-sm text-amber-800">An audit is waiting for this. The other engines keep running.</p>}
                        {a.window.open && (
                          <p className="text-sm text-zinc-700" role="status">
                            {a.window.cleared
                              ? a.kind === "sign_in"
                                ? "Signed in. Close the window to continue."
                                : "The check is gone. Close the window to continue."
                              : a.kind === "sign_in"
                                ? "Window open: sign in there."
                                : "Window open: complete the check there."}
                          </p>
                        )}
                        {!canOpenWindow && (
                          <p className="text-sm text-zinc-500">This server has no screen to open a window on. Complete it on a computer running PrismGEO with a display, or add an API key for this engine.</p>
                        )}
                      </>
                    ) : a.auditWaiting ? (
                      <p className="text-sm leading-relaxed text-zinc-600" role="status">
                        Completed. The waiting audit asks the {held === 1 ? "question" : "questions"} now.
                      </p>
                    ) : (
                      <p className="text-sm leading-relaxed text-zinc-600">
                        Completed. {held ? `${plural(held, "question")} could not be asked in time; resume to ask ${held === 1 ? "it" : "them"} now.` : ""}
                      </p>
                    )}

                    {held > 0 && (
                      <details className="text-sm text-zinc-600">
                        <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-800">{plural(held, "question")} waiting</summary>
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                          {a.questions.map((q) => (
                            <li key={q} className="truncate" title={q}>
                              {q}
                            </li>
                          ))}
                          {held > a.questions.length && <li className="list-none text-zinc-400">and {held - a.questions.length} more</li>}
                        </ul>
                      </details>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {a.status === "open" ? (
                        <>
                          {canOpenWindow && !a.window.open && (
                            <Button variant="primary" size="sm" disabled={!!busy} onClick={() => act(a.id, "open")}>
                              {isBusy("open") ? "Opening…" : a.kind === "sign_in" ? "Open sign-in window" : "Open window"}
                            </Button>
                          )}
                          <Button size="sm" disabled={!!busy} onClick={() => act(a.id, "done")}>
                            {isBusy("done") ? "Saving…" : "I’ve done it"}
                          </Button>
                          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => act(a.id, "dismiss")}>
                            Dismiss
                          </Button>
                        </>
                      ) : (
                        <>
                          {held > 0 && !a.auditWaiting && (
                            <Button variant="primary" size="sm" disabled={!!busy} onClick={() => act(a.id, "resume")}>
                              {isBusy("resume") ? "Starting…" : `Resume ${plural(held, "question")}`}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => act(a.id, "dismiss")}>
                            {held ? "Skip them" : "Clear"}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

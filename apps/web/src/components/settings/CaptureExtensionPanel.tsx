"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice, inputClass, cn } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";

/**
 * Settings → Engines & access → Capture by hand. The PrismGEO Capture browser extension saves the
 * answer a person is looking at in their own ChatGPT, Gemini, Perplexity, Copilot or Google
 * account. Nothing is automated, so it is free and within each service's terms.
 */
export function CaptureExtensionPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("http://localhost:3333");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/capture/token", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setToken(d.token))
      .catch(() => setError("Could not load the capture token"));
  }, []);

  const rotate = async () => {
    if (!confirm("Create a new token? Installed extensions stop working until you paste the new one.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/capture/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error();
      setToken((await r.json()).token);
      setVisible(true);
    } catch {
      setError("Could not create a new token");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Capture by hand <Badge tone="success">Free</Badge>
          </span>
        }
        description="The most faithful free route: ask a question in your own ChatGPT, Gemini, Perplexity, Copilot or Google account, then click the PrismGEO Capture extension to save that answer here. Nothing is automated or sent in the background; answers are stored as “captured by hand” and scored like any other."
      />
      <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-700">
          <li>
            In Chrome, Edge or Brave open <span className="font-mono text-xs">chrome://extensions</span> and turn on <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the <span className="font-mono text-xs">apps/extension</span> folder of your PrismGEO copy.
          </li>
          <li>Open the extension&apos;s settings, paste the address and token on the right, then click Save and test.</li>
          <li>Ask a tracked question in an engine, wait for the full answer, and click the PrismGEO icon to save it.</li>
        </ol>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-sm font-medium text-zinc-700">PrismGEO address</div>
            <div className="flex gap-2">
              <input readOnly value={origin} aria-label="PrismGEO address" className={cn(inputClass, "font-mono text-sm")} />
              <CopyButton text={origin} label="Copy address" />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-zinc-700">Capture token</div>
            <div className="flex gap-2">
              <input
                readOnly
                type={visible ? "text" : "password"}
                value={token ?? ""}
                placeholder={token === null ? "Loading…" : ""}
                aria-label="Capture token"
                className={cn(inputClass, "font-mono text-sm")}
              />
              <Button size="md" variant="ghost" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide token" : "Show token"}>
                {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </Button>
              {token && <CopyButton text={token} label="Copy token" />}
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              Lets the extension list your questions and save answers, nothing else. It is separate from the Claude connector token.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={rotate} disabled={busy}>
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />
            New token
          </Button>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </div>
    </Card>
  );
}

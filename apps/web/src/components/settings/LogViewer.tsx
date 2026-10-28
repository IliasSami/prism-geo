"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Notice } from "@/components/ui";

/** Tail of data/logs/prismgeo.log (server + crawler), newest line at the bottom. */
export function LogViewer() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logs?lines=200", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLines((await res.json()).lines || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <Card>
      <CardHeader
        title="Server log"
        description="Last 200 lines from data/logs/prismgeo.log: audits, blocks, retries and errors."
        actions={
          <Button size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        }
      />
      <div className="p-5">
        {error && <Notice tone="danger" title="Could not load the log">{error}</Notice>}
        {!error && lines && lines.length === 0 && (
          <EmptyState title="No log file yet" description="No log file yet — restart the server to start logging." />
        )}
        {!error && lines && lines.length > 0 && (
          <pre
            ref={box}
            tabIndex={0}
            aria-label="Server log lines"
            className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-100"
          >
            {lines.map((line, i) => (
              <div key={i} className={/ (ERROR|WARN) /.test(line) ? (/ ERROR /.test(line) ? "text-red-300" : "text-amber-200") : undefined}>
                {line}
              </div>
            ))}
          </pre>
        )}
        {!error && !lines && <div className="skeleton h-40 w-full" />}
      </div>
    </Card>
  );
}

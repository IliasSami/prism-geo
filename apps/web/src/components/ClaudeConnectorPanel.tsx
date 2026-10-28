"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Card, CardHeader, Notice } from "@/components/ui";

interface ConnectorInfo {
  ready: boolean;
  claudeDesktop: { configPath: string; config: unknown };
  claudeCode: string;
  httpUrl: string;
  token: string;
}

const TOOLS: Array<[string, string]> = [
  ["get_workspace_overview", "Brand profile, competitors, prompts, engine setup, recent audits"],
  ["get_visibility_report", "Mention and citation rates per engine and company, top cited sites"],
  ["list_runs / get_run", "The stored answers with their citations, mentions and matched passages"],
  ["start_crawl / get_crawl_status", "Run a new audit and follow its progress and failures"],
  ["add_prompts / set_prompt_active", "Grow or prune the tracked questions"],
  ["add_competitor", "Track another competitor"],
  ["query_database / describe_database", "Read-only SQL for any other analysis"],
];

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Copy ${label}`}
          onClick={() =>
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <pre tabIndex={0} className="overflow-x-auto whitespace-pre rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100">
        {text}
      </pre>
    </div>
  );
}

/**
 * Setup for PrismGEO's MCP connector, which lets Claude read this workspace's data and run its
 * actions from Claude Desktop, Claude Code or claude.ai.
 */
export default function ClaudeConnectorPanel() {
  const [info, setInfo] = useState<ConnectorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connector", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Use PrismGEO from Claude"
          description="Claude can read your real audit data, explain why a competitor is winning, draft content for the questions you are missing, add questions or competitors, and start audits. Works on every Claude plan; nothing here uses your Claude login."
        />
        <ul className="grid grid-cols-1 gap-2 p-5 md:grid-cols-2">
          {TOOLS.map(([name, desc]) => (
            <li key={name} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm">
              <span className="block font-mono text-xs font-medium text-zinc-800">{name}</span>
              <span className="text-zinc-600">{desc}</span>
            </li>
          ))}
        </ul>
      </Card>

      {error && <Notice tone="danger" title="Could not load connector setup">{error}</Notice>}
      {!info && !error && <div className="skeleton h-48 w-full" />}

      {info && (
        <>
          <Card>
            <CardHeader title="1. Claude Desktop (recommended)" />
            <div className="space-y-3 p-5">
              <p className="text-base text-zinc-600">
                In Claude Desktop open Settings → Developer → Edit Config, merge this into{" "}
                <span className="break-all font-mono text-sm">{info.claudeDesktop.configPath}</span>, then restart Claude. Keep PrismGEO running so
                Claude can start audits.
              </p>
              <CopyBlock label="claude_desktop_config.json" text={JSON.stringify(info.claudeDesktop.config, null, 2)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Claude Code" />
            <div className="p-5">
              <CopyBlock label="Terminal command" text={info.claudeCode} />
            </div>
          </Card>

          <Card>
            <CardHeader title="3. claude.ai (web and mobile)" />
            <div className="space-y-3 p-5">
              <p className="text-base text-zinc-600">
                claude.ai reaches connectors from Anthropic&apos;s servers, so it cannot see localhost. Expose PrismGEO through an HTTPS tunnel (for
                example <span className="font-mono text-sm">cloudflared tunnel --url {info.httpUrl.replace("/api/mcp", "")}</span>), then add a custom
                connector in claude.ai → Settings → Connectors with the URL below.
              </p>
              <Notice tone="warning">The token in this URL is the only thing protecting your workspace. Keep it private.</Notice>
              <CopyBlock label="Connector URL (replace the host with your tunnel)" text={`${info.httpUrl}?token=${info.token}`} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, MapPin } from "lucide-react";
import { Button, Notice } from "../ui";

interface Calibration {
  status: "running" | "done" | "failed";
  place: string;
  reference: string | null;
  startedAt: string;
  questions: unknown[];
  agreement?: {
    overview: { browser: number; repeat: number };
    sources: { browser: number | null; repeat: number | null };
    companies: { browser: number | null; repeat: number | null };
  };
  trusted: boolean;
  reason: string;
}

const pct = (x: number | null | undefined) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "–");

/**
 * Compares Google answers asked from this computer with Google's location signal (uule) against
 * answers asked from inside the country, and shows whether the free route can be trusted there.
 */
function CalibrationPanel({ location }: { location: string }) {
  const [cal, setCal] = useState<Calibration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/engines/location/calibrate", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setCal((await r.json()).calibration);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (cal?.status !== "running") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [cal?.status, load]);
  const start = async () => {
    setError(null);
    const r = await fetch("/api/engines/location/calibrate", { method: "POST" });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not start");
    load();
  };
  return (
    <div className="rounded-lg border border-zinc-200 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900">Free Google route: location signal</div>
          <p className="mt-0.5 text-sm text-zinc-500">
            Google AI Overviews searched from this computer carry {location} as Google&apos;s location signal (uule). Calibration checks on 10 of your questions whether
            those answers match answers asked from inside the country (needs SerpApi&apos;s free plan or DataForSEO; uses 20 of their searches). Until it passes, they are
            labelled as asked from this computer.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={start} disabled={cal?.status === "running"}>
          {cal?.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} {cal?.status === "running" ? "Calibrating…" : "Calibrate"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {cal && (
        <div className="mt-3 text-sm text-zinc-700">
          {cal.status === "running" ? (
            <p>{cal.questions.length} of 10 questions compared (about 10 minutes; searches are paced like an audit).</p>
          ) : (
            <>
              <p className={cal.trusted ? "text-emerald-700" : "text-zinc-700"}>
                {cal.trusted ? "Trusted for " + cal.place + ". " : ""}
                {cal.reason}
              </p>
              {cal.agreement && (
                <table className="mt-2 text-left text-xs text-zinc-600">
                  <thead>
                    <tr>
                      <th className="pr-4 font-medium">Agreement with {cal.reference || "the reference"}</th>
                      <th className="pr-4 font-medium">From here (uule)</th>
                      <th className="font-medium">Reference repeated</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="pr-4">AI Overview shown</td>
                      <td className="pr-4">{pct(cal.agreement.overview.browser)}</td>
                      <td>{pct(cal.agreement.overview.repeat)}</td>
                    </tr>
                    <tr>
                      <td className="pr-4">Cited sites overlap</td>
                      <td className="pr-4">{pct(cal.agreement.sources.browser)}</td>
                      <td>{pct(cal.agreement.sources.repeat)}</td>
                    </tr>
                    <tr>
                      <td className="pr-4">Companies named overlap</td>
                      <td className="pr-4">{pct(cal.agreement.companies.browser)}</td>
                      <td>{pct(cal.agreement.companies.repeat)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface LocationStatus {
  location: string;
  target: string | null;
  connection: string | null;
  connectionName: string | null;
  browserInMarket: boolean;
}

/**
 * Where this computer's browser traffic comes from, next to the search location, so it is clear
 * whether a browser here can measure that market. Re-checked when the location changes.
 */
export function SearchLocationStatus({ location, strict }: { location: string; strict: boolean }) {
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/engines/location", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: LocationStatus) => live && setStatus(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [location]);

  const calibration = <CalibrationPanel location={location} />;
  if (failed) return <Notice tone="warning">PrismGEO could not check which country this computer connects from. With “Only search from here” on, browser engines are skipped until it can.</Notice>;
  if (!status) return <p className="text-sm text-zinc-500">Checking where this computer connects from…</p>;
  const here = status.connectionName || "an unknown country";
  if (status.browserInMarket)
    return (
      <p className="flex items-center gap-1.5 text-sm text-zinc-600">
        <MapPin className="h-4 w-4 text-emerald-600" aria-hidden /> This computer connects from {here}, the search location: browser engines measure it directly.
      </p>
    );
  return (
    <div className="space-y-3">
    <Notice tone={strict ? "warning" : "info"}>
      This computer connects from {here}, not {status.location}, and a browser here is answered for {here}.{" "}
      {strict
        ? `Browser engines are skipped; engines run only through routes asked from ${status.location}: the DataForSEO data provider, SerpApi, Apify, OpenAI or Perplexity keys, or a proxy there that you control (Schedule & network).`
        : `Audits run as before and every answer is labelled with the country it was asked from. When DataForSEO, SerpApi or Apify is saved, it is used first for its engines, because it captures the same page from ${status.location}. Turn on “Only search from here” to skip everything else.`}
    </Notice>
      {calibration}
    </div>
  );
}

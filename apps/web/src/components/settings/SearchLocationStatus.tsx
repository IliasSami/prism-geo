"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { Notice } from "../ui";

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

  if (failed) return <Notice tone="warning">PrismGEO could not check which country this computer connects from. With the switch on, browser engines are skipped until it can.</Notice>;
  if (!status) return <p className="text-sm text-zinc-500">Checking where this computer connects from…</p>;
  const here = status.connectionName || "an unknown country";
  if (status.browserInMarket)
    return (
      <p className="flex items-center gap-1.5 text-sm text-zinc-600">
        <MapPin className="h-4 w-4 text-emerald-600" aria-hidden /> This computer connects from {here}, the search location: browser engines measure it directly.
      </p>
    );
  return (
    <Notice tone={strict ? "warning" : "danger"}>
      This computer connects from {here}, not {status.location}. A browser here is answered for {here}.{" "}
      {strict
        ? "Browser engines are skipped; engines run only through routes asked from the search location: the DataForSEO data provider, SerpApi, Apify, OpenAI or Perplexity keys, or a proxy in that country that you control (Schedule & network)."
        : "With the switch off, those answers are stored and labelled with the country they were asked from."}
    </Notice>
  );
}

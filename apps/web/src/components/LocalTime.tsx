"use client";

import { useEffect, useState } from "react";

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO text as a Date, or null when unreadable. */
function parse(value: string): Date | null {
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "1 Nov, 14:03" in the given time zone (the browser's own when none is given). */
export function formatLocal(value: string, timeZone?: string): string {
  const d = parse(value);
  if (!d) return value;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })}`;
}

/**
 * A date and time in the viewer's time zone, for client components. The server does not know that
 * zone, so the first render shows UTC (identical on server and client, no hydration mismatch) and
 * switches to local time once mounted.
 */
export function LocalTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!iso) return null;
  const d = parse(iso);
  return (
    <time dateTime={d?.toISOString()} className={className} suppressHydrationWarning>
      {mounted ? formatLocal(iso) : d ? `${formatLocal(iso, "UTC")} UTC` : iso}
    </time>
  );
}

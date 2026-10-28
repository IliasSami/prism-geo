import { NextResponse } from "next/server";
import { readRecentLogs } from "@prismgeo/db";

export const dynamic = "force-dynamic";

/** Recent server and crawler log lines, for the Settings → Storage log viewer. */
export async function GET(request: Request) {
  const lines = Math.min(2000, Math.max(1, Number(new URL(request.url).searchParams.get("lines")) || 200));
  return NextResponse.json({ lines: readRecentLogs(lines) });
}

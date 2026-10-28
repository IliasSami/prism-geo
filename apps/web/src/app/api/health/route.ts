import { NextResponse } from "next/server";
import { getRawDb } from "@prismgeo/db";

export const dynamic = "force-dynamic";

/**
 * Liveness check for Docker and process managers: the server answers and the database opens.
 * It reveals nothing about the workspace. A hung event loop (a long synchronous query) makes it
 * time out, which is what a health check should notice.
 */
export async function GET() {
  try {
    getRawDb().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api] health check failed:", err);
    return NextResponse.json({ ok: false, error: "The database could not be opened" }, { status: 503 });
  }
}

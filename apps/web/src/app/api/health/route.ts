import { NextResponse } from "next/server";
import { getRawDb, SCHEMA_VERSION } from "@prismgeo/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Liveness check for Docker and process managers: the server answers and the database opens.
 * It reveals nothing about the workspace, only the version, Node.js and database schema for support. A hung event loop (a long synchronous query) makes it
 * time out, which is what a health check should notice.
 */
export async function GET() {
  try {
    getRawDb().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true, version: pkg.version, node: process.versions.node, schema: SCHEMA_VERSION }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api] health check failed:", err);
    return NextResponse.json({ ok: false, error: "The database could not be opened" }, { status: 503 });
  }
}

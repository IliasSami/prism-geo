import { NextResponse } from "next/server";
import { getProfileStatuses, openSignInWindow, removeProfile, PROFILE_ENGINES, type ProfileEngine } from "@prismgeo/crawler";

export const dynamic = "force-dynamic";

const parseEngine = (value: unknown): ProfileEngine | null =>
  PROFILE_ENGINES.includes(value as ProfileEngine) ? (value as ProfileEngine) : null;

/** Signed-in browser session status per engine. */
export async function GET() {
  return NextResponse.json({ sessions: getProfileStatuses() });
}

/**
 * Opens a visible browser window on this machine where the user signs in to the engine
 * themselves. Returns immediately; the session counts as connected once the window is closed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const engine = parseEngine(body.engine);
  if (!engine) return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
  if (getProfileStatuses().find((s) => s.engine === engine)?.connecting) {
    return NextResponse.json({ error: `A sign-in window for ${engine} is already open` }, { status: 409 });
  }
  openSignInWindow(engine).catch((err) => console.error(`[EngineSessions] ${engine} sign-in window failed:`, err));
  return NextResponse.json({ success: true, engine, status: "window_opened" });
}

/** Forgets a saved session (deletes that engine's browser profile and cookies). */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const engine = parseEngine(body.engine);
  if (!engine) return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
  try {
    removeProfile(engine);
    return NextResponse.json({ success: true, engine });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}

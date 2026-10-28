import fs from "node:fs";
import { NextResponse } from "next/server";
import { getProfileStatuses, openSignInWindow, removeProfile, PROFILE_ENGINES, type ProfileEngine } from "@prismgeo/crawler";
import { jsonError, readJsonObject, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

const parseEngine = (value: unknown): ProfileEngine | null =>
  PROFILE_ENGINES.includes(value as ProfileEngine) ? (value as ProfileEngine) : null;

/**
 * Whether this server can show a browser window to the person using it. Linux needs an X11 or
 * Wayland display; a Docker container never has one (macOS and Windows always do).
 */
function hasDisplay(): boolean {
  if (fs.existsSync("/.dockerenv") || process.env.PRISMGEO_IN_DOCKER === "1") return false;
  if (process.platform !== "linux") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** Signed-in browser session status per engine. */
export const GET = route("engines/sessions GET", async () => {
  return NextResponse.json({ sessions: getProfileStatuses(), canOpenWindow: hasDisplay() });
});

/**
 * Opens a visible browser window on this machine where the user signs in to the engine
 * themselves. Returns immediately; the session counts as connected once the window is closed.
 * 501 when the server has no display (a headless Linux server or Docker).
 */
export const POST = route("engines/sessions POST", async (request: Request) => {
  const body = await readJsonObject(request);
  const engine = parseEngine(body?.engine);
  if (!engine) return jsonError(`Unknown engine. Use one of ${PROFILE_ENGINES.join(", ")}.`, 400);
  if (!hasDisplay()) {
    return jsonError(
      "This server has no screen to open a sign-in window on (a headless server or Docker). Signed-in sessions need PrismGEO running on a desktop; here, engines run logged out and Copilot stays off.",
      501,
    );
  }
  if (getProfileStatuses().find((s) => s.engine === engine)?.connecting) {
    return jsonError(`A sign-in window for ${engine} is already open`, 409);
  }
  openSignInWindow(engine).catch((err) => console.error(`[EngineSessions] ${engine} sign-in window failed:`, err));
  return NextResponse.json({ success: true, engine, status: "window_opened" });
});

/** Forgets a saved session (deletes that engine's browser profile and cookies). */
export const DELETE = route("engines/sessions DELETE", async (request: Request) => {
  const body = await readJsonObject(request);
  const engine = parseEngine(body?.engine);
  if (!engine) return jsonError(`Unknown engine. Use one of ${PROFILE_ENGINES.join(", ")}.`, 400);
  if (getProfileStatuses().find((s) => s.engine === engine)?.connecting) {
    return jsonError(`Close the open ${engine} sign-in window first`, 409);
  }
  removeProfile(engine);
  return NextResponse.json({ success: true, engine });
});

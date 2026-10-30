import fs from "node:fs";
import { NextResponse } from "next/server";
import { accountIdFrom, getProfileStatuses, openSignInWindow, removeProfile, verifyProfile, DEFAULT_ACCOUNT, PROFILE_ENGINES, type ProfileEngine } from "@prismgeo/crawler";
import { jsonError, readJsonObject, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

const parseEngine = (value: unknown): ProfileEngine | null =>
  PROFILE_ENGINES.includes(value as ProfileEngine) ? (value as ProfileEngine) : null;

/** Account id from the body: an explicit id, a new account from its label, or the default one. */
function parseAccount(body: Record<string, unknown> | null): string | null {
  const id = typeof body?.account === "string" ? body.account.trim() : "";
  if (id) return /^[a-z0-9-]{1,40}$/.test(id) ? id : null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  return label ? accountIdFrom(label) : DEFAULT_ACCOUNT;
}
const labelOf = (body: Record<string, unknown> | null) => (typeof body?.label === "string" ? body.label.trim().slice(0, 60) : undefined);
const isOpen = (engine: string, account: string) => getProfileStatuses().some((s) => s.engine === engine && s.account === account && s.connecting);

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
 * { engine }: opens a visible browser window on this machine where the user signs in to the
 * engine themselves. Returns immediately; the session counts as connected only if a signed-in
 * session cookie is found when the window closes. 501 when the server has no display.
 * { engine, action: "verify" }: re-checks the saved session without opening a window.
 * Add { account } to act on one account of the engine, or { label } to add a new labelled account
 * ("UK ecom manager"); without either the default account is used.
 */
export const POST = route("engines/sessions POST", async (request: Request) => {
  const body = await readJsonObject(request);
  const engine = parseEngine(body?.engine);
  if (!engine) return jsonError(`Unknown engine. Use one of ${PROFILE_ENGINES.join(", ")}.`, 400);
  const account = parseAccount(body);
  if (!account) return jsonError("Account ids use lower-case letters, digits and dashes (up to 40)", 400);
  if (body?.action === "verify") {
    const result = await verifyProfile(engine, account);
    if (!result) return jsonError("That session cannot be checked right now (nothing saved, or the browser profile is in use by an audit).", 409);
    return NextResponse.json({ success: true, engine, account, ...result });
  }
  if (!hasDisplay()) {
    return jsonError(
      "This server has no screen to open a sign-in window on (a headless server or Docker). Signed-in sessions need PrismGEO running on a desktop; here, engines run logged out and Copilot stays off.",
      501,
    );
  }
  if (isOpen(engine, account)) return jsonError(`A sign-in window for ${engine} (${account}) is already open`, 409);
  openSignInWindow(engine, account, labelOf(body)).catch((err) => console.error(`[EngineSessions] ${engine} (${account}) sign-in window failed:`, err));
  return NextResponse.json({ success: true, engine, account, status: "window_opened" });
});

/** Forgets a saved session (deletes that engine's browser profile and cookies). */
export const DELETE = route("engines/sessions DELETE", async (request: Request) => {
  const body = await readJsonObject(request);
  const engine = parseEngine(body?.engine);
  if (!engine) return jsonError(`Unknown engine. Use one of ${PROFILE_ENGINES.join(", ")}.`, 400);
  const account = parseAccount(body);
  if (!account) return jsonError("Account ids use lower-case letters, digits and dashes (up to 40)", 400);
  if (isOpen(engine, account)) return jsonError(`Close the open ${engine} sign-in window first`, 409);
  removeProfile(engine, account);
  return NextResponse.json({ success: true, engine, account });
});
